// Laki's own AI (Settings › AI, the AI page, `laki ai`): optional, and only when asked. One conversation that works
// Laki with the MCP server's tools (cli/mcp.ts: none archives, deletes, ships or merges), run by OpenRouter (its key in
// <data>/ai-key, 0600) or by an agent's CLI in the background: claude -p or codex exec, each given `laki mcp`. Every ask
// is logged with its tokens and cost in <data>/ai-calls.jsonl; the conversation is <data>/ai-chat.json.
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { type Rpc, type Tool, tools } from '../cli/mcp.ts'
import { AI_MODEL, AI_STEPS, type AiBackend, type AiCall, type AiMsg, aiTotals } from '../shared/types.ts'
import { broadcast, cliArgv, dir, own, presets, state } from './core.ts'

const keyPath = join(dir, 'ai-key')
const chatPath = join(dir, 'ai-chat.json')
const callsPath = join(dir, 'ai-calls.jsonl')
const home = join(dir, 'ai') // the CLI agents' folder: no repo, no project's CLAUDE.md or AGENTS.md
const KEEP = 200 // the conversation's messages kept
const TOOL_TEXT = 4000 // what a tool's result may give the model; the page shows less
const MAX_IMAGE = 8 << 20

// tests: a fake OpenRouter on this Mac only (a session's env can reach a daemon the CLI starts)
const api = () => {
  const t = process.env.LAKI_AI_API
  return t && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : 'https://openrouter.ai/api/v1'
}

const SYSTEM = `You are Laki's assistant. Laki is a Mac app that runs coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in a workspace: a git worktree on its own branch, with tabs (agent sessions, shells).
Do what the user asks with the laki tools, at once, without asking first: look things up with laki_state (workspaces, their PRs with titles, each tab's status and last answer), laki_screen and laki_diff; start work with laki_new_workspace (a PR to review: its pr field and a prompt saying what to do), laki_new_tab (another agent in a workspace that exists), laki_send (a message to a running agent), laki_attach_pr; laki_schedules and laki_schedule_add when asked to schedule work.
Find workspaces by name, branch, PR number or PR title. You cannot archive, delete, ship or merge anything: say so if asked.
Link each workspace or tab you name, so the user opens it with a click: [its name](laki://ws/<workspace id>), or [its name](laki://ws/<workspace id>?tab=<tab id>) for a tab.
A screenshot may hold PR links or other work: act on each item.
Make a Laki extension (also called a widget, the same thing: a small live page in the sidebar, a clock, a count, a chart), or change one you made, yourself (the user's own you can only read): laki_extension_guide first, an example with laki_extension_read, then laki_extension_write. It is saved off: tell the user what its fetch runs and to turn it on in [Settings › Extensions](laki://settings/widgets).
Answer in a few plain sentences: what you did (workspace names) or what you found.`

// the AI's tools: the MCP server's (laki_schedule_add too: it acts only when asked), but laki_progress (an agent's own)
const toolsFor = (rpc: Rpc) => tools(rpc).filter(t => t.name !== 'laki_progress')

// ---------- the key: a file only you can read, never in state.json or the view

export const hasKey = () => !!readKey()
function readKey() {
  try {
    return readFileSync(keyPath, 'utf8').trim()
  } catch {
    return ''
  }
}
export function aiKey(o: { key?: string | null }) {
  const key = o.key?.trim()
  if (!key) return rmSync(keyPath, { force: true }), { key: false }
  if (!/^[\x21-\x7e]{8,400}$/.test(key)) throw new Error('that does not look like an API key')
  writeFileSync(keyPath, key + '\n', { mode: 0o600 })
  return { key: true }
}

// ---------- the conversation

let resume: Record<string, string | undefined> = {} // claude's session, codex's thread, by sessionKey: the next ask goes on with it
let chat: AiMsg[] = load()
let busy: { kill: () => void } | null = null
function load(): AiMsg[] {
  try {
    const j = JSON.parse(readFileSync(chatPath, 'utf8'))
    resume = j.resume ?? {}
    return Array.isArray(j.chat) ? j.chat : []
  } catch {
    return []
  }
}
function changed() {
  chat = chat.slice(-KEEP)
  try {
    writeFileSync(chatPath, JSON.stringify({ chat, resume }), { mode: 0o600 })
  } catch {}
  broadcast({ ev: 'ai', chat, busy: !!busy })
}
const say = (role: AiMsg['role'], text: string, images?: string[]) => (chat.push({ role, text, at: Date.now(), ...(images?.length && { images }) }), changed())

export function aiNew() {
  if (busy) throw new Error('the AI is at work: stop it first')
  chat = []
  resume = {}
  changed()
}
export function aiStop() {
  busy?.kill()
  return { stopped: !!busy }
}

// the page's: the conversation, whether it works, the key's there, the last calls and totals
export function aiState() {
  const calls = readCalls()
  return { chat, busy: !!busy, key: hasKey(), calls: calls.slice(-100).reverse(), totals: aiTotals(calls) }
}

// ---------- asking

type Run = { text: string; model: string; calls: number; in: number; out: number; cost?: number }
// r: what the ask spent so far, kept when it fails too
type Opts = { ask: string; images: string[]; rpc: Rpc; signal: AbortSignal; spawned: (c: ChildProcess) => void; r: Run }

export async function aiAsk(p: { text?: string; images?: string[] }, rpc: Rpc) {
  const s = state.settings?.ai ?? {}
  if (!s.on) throw new Error('Laki AI is off: Settings › AI')
  const ask = (p.text ?? '').trim()
  const images = (p.images ?? []).filter(imageOk)
  if (!ask && !images.length) throw new Error('ask something')
  if (busy) throw new Error('the AI is still on the last ask')
  const backend: AiBackend = s.backend ?? 'openrouter'
  if (backend === 'openrouter' && !hasKey()) throw new Error('no OpenRouter API key: Settings › AI')
  const ctl = new AbortController()
  let child: ChildProcess | undefined
  busy = { kill: () => (ctl.abort(), child?.kill('SIGTERM')) }
  say('user', ask, images)
  const t0 = Date.now()
  const r: Run = { text: '', model: s.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : backend), calls: 0, in: 0, out: 0 }
  const o: Opts = { ask, images, rpc, signal: ctl.signal, spawned: c => (child = c), r }
  const call: AiCall = { at: t0, backend, model: r.model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: ask.slice(0, 120) }
  try {
    await (backend === 'claude' ? claude(o) : backend === 'codex' ? codex(o) : openrouter(o))
    call.ok = true
    say('ai', r.text || '(no answer)')
    return { text: r.text }
  } catch (e) {
    const msg = ctl.signal.aborted ? 'stopped' : (e as Error).message
    call.error = msg
    say('error', msg)
    throw new Error(msg)
  } finally {
    Object.assign(call, { model: r.model, in: r.in, out: r.out, cost: r.cost, tools: r.calls, ms: Date.now() - t0 })
    busy = null
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
    changed()
  }
}

// a pasted image is the daemon's own (imageSave: <data>/images): nothing else of the Mac goes to a model
function imageOk(path: unknown) {
  if (typeof path !== 'string') return false
  try {
    return realpathSync(path).startsWith(realpathSync(join(dir, 'images')) + sep)
  } catch {
    return false
  }
}

// a tool the model asked for, shown in the conversation; its result (or failure) goes back to the model
async function runTool(list: Tool[], name: string, args: unknown) {
  const tool = list.find(t => t.name === name)
  say('tool', `${name} ${JSON.stringify(args ?? {})}`)
  try {
    if (!tool) throw new Error(`no tool ${name}`)
    const r = await tool.run(args ?? {})
    return (typeof r === 'string' ? r : JSON.stringify(r)).slice(0, tool.max ?? TOOL_TEXT)
  } catch (e) {
    return `failed: ${(e as Error).message}`
  }
}

// the earlier asks and answers, for a model that keeps no session of its own (OpenRouter)
// ponytail: the last 20, without the tools' results (it looks again); a summary of older ones if it forgets too much
const history = () =>
  chat
    .slice(0, -1)
    .filter(m => m.role === 'user' || m.role === 'ai')
    .slice(-20)
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text || '(an image)' }))

async function openrouter(o: Opts) {
  const key = readKey()
  const s = state.settings?.ai ?? {}
  const model = s.models?.openrouter || AI_MODEL
  const list = toolsFor(o.rpc)
  const fns = list.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  const pics = o.images.map(p => ({ type: 'image_url', image_url: { url: dataUrl(p) } }))
  const messages: object[] = [{ role: 'system', content: SYSTEM }, ...history(), { role: 'user', content: pics.length ? [{ type: 'text', text: o.ask || 'See the image.' }, ...pics] : o.ask }]
  const r = o.r
  r.cost = 0
  for (let i = 0; ; i++) {
    const res = await fetch(`${api()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      body: JSON.stringify({ model, messages, tools: fns, usage: { include: true } }),
      signal: AbortSignal.any([o.signal, AbortSignal.timeout(120000)]),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`OpenRouter: ${j.error?.message ?? res.status}`)
    r.model = j.model || model
    r.in += j.usage?.prompt_tokens ?? 0
    r.out += j.usage?.completion_tokens ?? 0
    r.cost! += j.usage?.cost ?? 0
    const m = j.choices?.[0]?.message
    if (!m) throw new Error('OpenRouter: no answer')
    if (!m.tool_calls?.length) return void (r.text = m.content ?? '')
    if (i >= (s.steps || AI_STEPS)) throw new Error(`stopped after ${i} rounds of tools (Settings › AI › Steps)`)
    messages.push(m) // as it came: a reasoning model's next request needs its reasoning_details
    if (m.content) say('ai', m.content)
    // ponytail: Stop takes effect between tools: one under way (a wsNew) finishes first
    for (const c of m.tool_calls) {
      let args: unknown = {}
      try {
        args = JSON.parse(c.function?.arguments || '{}')
      } catch {}
      r.calls++
      messages.push({ role: 'tool', tool_call_id: c.id, content: await runTool(list, c.function?.name, args) })
    }
  }
}
function dataUrl(path: string) {
  const buf = readFileSync(path)
  if (buf.length > MAX_IMAGE) throw new Error('an image up to 8 MB')
  const ext = extname(path).slice(1).toLowerCase()
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
}

// `laki mcp` as an MCP server for a CLI agent: this daemon's (LAKI_HOME), through node or Electron as node
const mcpServer = () => ({ command: cliArgv[0], args: [...cliArgv.slice(1), 'mcp'], env: { LAKI_HOME: dir, ...(process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) } })

// Settings › AI's preset of the agent (an account of its own: CLAUDE_CONFIG_DIR, CODEX_HOME…): its env, over Settings'
// env as a tab of it gets; its args are a tab's, not used here
const presetOf = (agent: AiBackend) => {
  const name = state.settings?.ai?.preset
  return name ? presets().find(p => p.name === name && p.agent === agent) : undefined
}
// its session goes with the preset: another one's account doesn't know it
const sessionKey = (agent: AiBackend) => `${agent}:${presetOf(agent)?.name ?? ''}`

// an agent's CLI, its JSON lines to `line`; it fails with the last of what it printed to stderr
function cli(o: Opts, cmd: AiBackend, args: string[], line: (j: any) => void) {
  mkdirSync(home, { recursive: true })
  return new Promise<void>((resolve, reject) => {
    const env = { ...process.env, ...state.settings?.env, ...presetOf(cmd)?.env, MCP_TOOL_TIMEOUT: '300000' }
    const c = spawn(cmd, args, { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
    o.spawned(c)
    own(c, `Laki AI · ${cmd}`, 'ai')
    let out = ''
    let err = ''
    c.stdout.on('data', d => {
      out += d
      const lines = out.split('\n')
      out = lines.pop()!
      for (const l of lines) {
        try {
          if (l.trim()) line(JSON.parse(l))
        } catch {}
      }
    })
    c.stdout.on('end', () => {
      try {
        if (out.trim()) line(JSON.parse(out)) // a last line without its newline
      } catch {}
    })
    c.stderr.on('data', d => (err = (err + d).slice(-2000)))
    c.on('error', e => reject(new Error(`${cmd}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed (not on PATH)' : e.message}`)))
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ended with ${code}: ${err.trim().split('\n').pop() || 'no output'}`))))
  })
}

// claude -p: only Read (a screenshot: its folder added when there is one, it runs elsewhere) and the laki tools; stream-json shows each tool call as it happens
async function claude(o: Opts) {
  const model = state.settings?.ai?.models?.claude
  const sk = sessionKey('claude')
  const prompt = o.images.length ? `${o.ask}\n\nImages (read them): ${o.images.join(' ')}` : o.ask
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', JSON.stringify({ mcpServers: { laki: mcpServer() } }), '--strict-mcp-config', '--tools', 'Read', ...(o.images.length ? ['--add-dir', join(dir, 'images')] : []), '--allowedTools', 'mcp__laki', '--append-system-prompt', SYSTEM, ...(model ? ['--model', model] : []), ...(resume[sk] ? ['--resume', resume[sk]] : []), '--', prompt]
  const r = o.r
  let failed = ''
  await cli(o, 'claude', args, j => {
    if (j.session_id) resume[sk] = j.session_id
    if (j.type === 'system' && j.model) r.model = j.model
    if (j.type === 'assistant')
      for (const b of j.message?.content ?? []) {
        if (b.type === 'tool_use') (r.calls++, say('tool', `${String(b.name).replace(/^mcp__laki__/, '')} ${JSON.stringify(b.input ?? {})}`))
      }
    if (j.type === 'result') {
      r.text = j.result ?? ''
      r.cost = j.total_cost_usd
      const u = j.usage ?? {}
      r.in = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      r.out = u.output_tokens ?? 0
      if (j.is_error) failed = j.result || j.subtype
    }
  }).catch(e => {
    if (resume[sk] && /session|conversation/i.test(e.message)) resume[sk] = undefined // gone: the next ask starts afresh
    throw failed ? new Error(failed) : e // its own words over the exit code
  })
  if (failed) throw new Error(failed)
}

// codex exec, read-only, only the laki tools (a long wsNew: 5 minutes); resume goes on with its thread
async function codex(o: Opts) {
  const model = state.settings?.ai?.models?.codex
  const sk = sessionKey('codex')
  const m = mcpServer()
  const toml = (v: unknown) => JSON.stringify(v) // a TOML basic string or array of them reads as JSON does
  const env = `{${Object.entries(m.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`
  const args = [
    'exec',
    ...(resume[sk] ? ['resume', resume[sk]!] : []),
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config', // the user's config.toml: its MCP servers would be tools past Laki's (claude: --strict-mcp-config)
    '-c', 'sandbox_mode="read-only"',
    '-c', `developer_instructions=${toml(SYSTEM)}`,
    '-c', `mcp_servers.laki.command=${toml(m.command)}`,
    '-c', `mcp_servers.laki.args=${toml(m.args)}`,
    '-c', `mcp_servers.laki.env=${env}`,
    '-c', 'mcp_servers.laki.tool_timeout_sec=300',
    ...(model ? ['-m', model] : []),
    ...o.images.flatMap(i => ['-i', i]),
    '--',
    o.ask || 'See the image.',
  ]
  const r = o.r
  let failed = ''
  await cli(o, 'codex', args, j => {
    if (j.type === 'thread.started' && j.thread_id) resume[sk] = j.thread_id
    const it = j.item
    if (j.type === 'item.started' && it?.type === 'mcp_tool_call') (r.calls++, say('tool', `${it.tool} ${JSON.stringify(it.arguments ?? {})}`))
    if (j.type === 'item.completed' && it?.type === 'agent_message') r.text = it.text ?? ''
    if (j.type === 'turn.completed') (r.in += j.usage?.input_tokens ?? 0), (r.out += j.usage?.output_tokens ?? 0)
    if (j.type === 'turn.failed' || j.type === 'error') failed = j.error?.message ?? j.message ?? 'failed'
  }).catch(e => {
    if (resume[sk] && /thread|session|conversation|not found/i.test(e.message + failed)) resume[sk] = undefined // gone: the next ask starts afresh
    throw failed ? new Error(failed) : e // its own words over the exit code
  })
  if (failed) throw new Error(failed)
}

// ---------- the call log

// ponytail: the whole log is read for the page and the totals; keep only this month's lines if it ever gets slow
function readCalls(): AiCall[] {
  try {
    return readFileSync(callsPath, 'utf8')
      .split('\n')
      .flatMap(l => {
        try {
          return l ? [JSON.parse(l)] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
