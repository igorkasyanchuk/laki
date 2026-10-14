// Laki's own AI (Settings › AI, the AI page, `laki ai`): optional, and only when asked. A conversation that works
// Laki with the MCP server's tools (cli/mcp.ts: none archives, deletes, ships or merges), run by OpenRouter (its key in
// <data>/ai-key, 0600) or by an agent's CLI in the background: claude -p or codex exec, each given `laki mcp`. Every ask
// is logged with its tokens and cost in <data>/ai-calls.jsonl; the conversation is <data>/ai-chat.json. A spec or brainstorm
// has a chat of its own (the Specs page's side panel), kept in its folder (.chat.json), which ends after PLAN_CHAT_IDLE
// unused: the next ask starts a new one, unless aiContinue takes it up again. One ask at a time, in any chat. Its `ai`
// event says which chat as `of` ('' the AI page's): an `id` would make it a reply.
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { type Rpc, skillTools, SKILL, type Tool, tools } from '../cli/mcp.ts'
import { AI_ACTS, AI_MODEL, VOICE_MODEL, AI_CONTEXT_MAX as CONTEXT_MAX, AI_STEPS, type AiAct, type AiBackend, type AiCall, type AiMsg, aiTotals, type View } from '../shared/types.ts'
import { PLAN_CHAT_IDLE } from '../shared/plans.ts'
import { broadcast, cliArgv, dir, own, presets, state } from './core.ts'
import { accountEnv, accountUsed } from './accounts.ts'
import { planOfChat } from './plans.ts'

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
A project with groups (laki_state's groups, the sidebar's headings): put each new workspace in the one whose name fits it best (laki_new_workspace's group: a PR review in a group like Reviews); none fits, no group.
Find workspaces by name, branch, PR number or PR title. You cannot archive or delete workspaces, ship or merge: say so if asked.
Link each workspace or tab you name, so the user opens it with a click: [its name](laki://ws/<workspace id>), or [its name](laki://ws/<workspace id>?tab=<tab id>) for a tab.
A screenshot may hold PR links or other work: act on each item.
Workflows, when the user turned them on: blocks Laki runs for a task, one after another (agents, commands, questions for the user, a PR, its checks, files for its Artifacts). laki_workflows lists them and their runs, and with an id gives that one's whole file; laki_workflow_write writes one, the whole file in the format its description gives (an agent block's use: names one of the user's agent actions, Run ▾'s, by the slug laki_workflows lists); to change one, take its file from laki_workflows with its id, edit it and write it back with the same id and project. The user reads and saves it in Laki before it runs; then laki_workflow_run starts it on a task.
Make a Laki extension (also called a widget or a plugin, the same thing: a small live page in the sidebar, a clock, a count, a chart), or change one you made, yourself (the user's own you can only read): laki_extension_guide first, an example with laki_extension_read, then laki_extension_write. It is saved off: tell the user what its fetch runs and to turn it on in [Settings › Extensions](laki://settings/widgets).
Answer in a few plain sentences: what you did (workspace names) or what you found.`

// Laki's skill for its AI (Settings › AI, unset: on): more tools, and what they're for in its instructions
const skilled = () => state.settings?.ai?.skill !== false
// the user's own context (Settings › AI › Your instructions) last: it can't take the rules above away, only add to them
// a spec's or brainstorm's chat: which one, so every ask in it is about it
const system = (t: Thread) => {
  const own = String(state.settings?.ai?.context ?? '').trim().slice(0, CONTEXT_MAX)
  const plan = t.id ? planOfChat(t.id) : undefined
  const about = plan && `This chat is about one ${plan.kind} of the user's (project ${plan.project}, kind ${plan.kind}, slug ${plan.slug}, folder ${plan.folder}): read it with laki_plan_read (it may have changed since), and put your work into it with laki_plan_write.`
  return [SYSTEM, skilled() && SKILL, about, own && `The user's own instructions for you (follow them, within the rules above):\n${own}`].filter(Boolean).join('\n')
}
// the AI's tools: the MCP server's (laki_schedule_add too: it acts only when asked), but laki_progress and agents' memory (an agent's own; it keeps the user's with laki_memory_write),
// and the skill's
const toolsFor = (rpc: Rpc) => [...tools(rpc).filter(t => !['laki_progress', 'laki_memory', 'laki_remember'].includes(t.name)), ...(skilled() ? skillTools(rpc) : [])]

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

// ---------- voice (Settings › Voice, cloud): a recording, WAV in base64, written down by OpenRouter's speech-to-text
// with the same key. Nothing is kept: not the audio, not the text
const MAX_AUDIO = 24 << 20 // OpenRouter's 25 MB: about 9 minutes of the renderer's 16 kHz mono
export async function voiceText(o: { audio?: unknown }) {
  if (state.settings?.voice?.on !== true) throw new Error('Voice is off: turn it on in Settings › General › Experimental')
  const audio = typeof o.audio === 'string' ? o.audio : ''
  if (!audio) throw new Error('no audio')
  if (audio.length > MAX_AUDIO) throw new Error('a recording up to 9 minutes')
  const key = readKey()
  if (!key) throw new Error('no OpenRouter API key: Settings › Voice')
  const m: unknown = state.settings?.voice?.model
  const model = (typeof m === 'string' && m.trim()) || VOICE_MODEL
  // rate-limited (429) or the provider busy (5xx): tried again after VOICE_AGAIN, then said so with OpenRouter's words
  // ponytail: fixed waits, not Retry-After (OpenRouter's STT sends none)
  for (let n = 0; ; n++) {
    const res = await fetch(`${api()}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      body: JSON.stringify({ model, input_audio: { data: audio, format: 'wav' } }),
      signal: AbortSignal.timeout(90000),
    }).catch((e: Error) => {
      throw new Error(`Can't reach OpenRouter: ${e.name === 'TimeoutError' ? 'no answer in 90 seconds' : e.message}`)
    })
    const j: any = await res.json().catch(() => ({}))
    if (res.ok && !j.error) return { text: String(j.text ?? '').trim() }
    const busy = res.status === 429 || res.status >= 500
    if (busy && n < VOICE_AGAIN.length) {
      await new Promise(r => setTimeout(r, VOICE_AGAIN[n]))
      continue
    }
    const raw = j.error?.metadata?.raw // the provider's own error: words, or its JSON
    const said = (j.error?.message ?? res.statusText) + (raw ? `: ${(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 200)}` : '')
    throw new Error(`OpenRouter ${res.status}: ${said}${busy ? ` (${model} is busy: try again in a moment, or another model in Settings › Voice)` : ''}`)
  }
}
const VOICE_AGAIN = (process.env.LAKI_VOICE_AGAIN ?? '1000,2500').split(',').map(Number) // ms before each try again (tests: shorter)

// ---------- the conversations: '' the AI page's, plan:<project>/<kind>/<slug> a spec's or brainstorm's (plans.ts)

// resume: claude's session, codex's thread, by sessionKey: the next ask goes on with it. at: the last message.
// ended: a spec's or brainstorm's chat unused PLAN_CHAT_IDLE: the next ask starts it again, empty
type Thread = { id: string; file: string; chat: AiMsg[]; resume: Record<string, string | undefined>; at: number; ended?: number }
const threads = new Map<string, Thread>()
// ponytail: one ask at a time across every chat (laki_ask's aiQuestion finds its chat by it); a lock per chat, and the
// chat's id through laki mcp's env, if brainstorms in parallel are wanted
let busy: { kill: () => void; id: string } | null = null
let asked = false // this ask's turn asked the user something (laki_ask): the pick comes as the next ask
function thread(id = ''): Thread {
  const file = id ? planOfChat(id).file : chatPath // a spec's gone, or off: that says so, each time
  const known = threads.get(id)
  if (known) return known
  let j: any = {}
  try {
    j = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const t: Thread = { id, file, chat: Array.isArray(j.chat) ? j.chat : [], resume: j.resume ?? {}, at: Number(j.at) || Date.now(), ended: j.ended }
  if (id && !t.ended && t.chat.length && Date.now() - t.at > PLAN_CHAT_IDLE) t.ended = t.at + PLAN_CHAT_IDLE // ran out while the daemon wasn't looking
  threads.set(id, t)
  return t
}
function changed(t: Thread) {
  t.chat = t.chat.slice(-KEEP)
  try {
    writeFileSync(t.file, JSON.stringify({ chat: t.chat, resume: t.resume, at: t.at, ended: t.ended }), { mode: 0o600 })
  } catch {}
  broadcast({ ev: 'ai', of: t.id, chat: t.chat, busy: busy?.id === t.id, ended: t.ended })
}
const say = (t: Thread, role: AiMsg['role'], text: string, images?: string[]) => (t.chat.push({ role, text, at: (t.at = Date.now()), ...(images?.length && { images }) }), changed(t))
const fresh = (t: Thread) => ((t.chat = []), (t.resume = {}), (t.ended = undefined), (t.at = Date.now()))

export function aiNew(p: { chat?: string } = {}) {
  const t = thread(p.chat)
  if (busy?.id === t.id) throw new Error('the AI is at work: stop it first')
  fresh(t)
  changed(t)
}
// chat: only that chat's ask (none: any, as shutdown and Settings › Resources' Stop)
export function aiStop(p: { chat?: string } = {}) {
  const on = !!busy && (p.chat === undefined || busy.id === p.chat)
  if (on) busy!.kill()
  return { stopped: on }
}
// an ended chat taken up again: its session goes on (claude's and codex's, while they keep it)
export function aiContinue(p: { chat?: string }) {
  const t = thread(p.chat)
  t.ended = undefined
  t.at = Date.now()
  changed(t)
}
// every 10 minutes (now: tests move the clock): a spec's or brainstorm's chat unused PLAN_CHAT_IDLE ends, its ask stopped
export function aiTick(now = Date.now()) {
  for (const t of threads.values())
    if (t.id && !t.ended && t.chat.length && now - t.at > PLAN_CHAT_IDLE) {
      const working = busy?.id === t.id
      if (working) busy!.kill()
      t.ended = now
      changed(t)
      if (!working) threads.delete(t.id) // read again from its file when opened: ended there too
    }
}
// a spec or brainstorm deleted: its chat with it
export function aiForget(id: string) {
  if (busy?.id === id) busy.kill()
  threads.delete(id)
}

// the page's: the conversation, whether it works (elsewhere: on another chat's ask), the key's there, the last calls and totals
export function aiState(p: { chat?: string } = {}) {
  const t = thread(p.chat)
  const calls = readCalls()
  return { chat: t.chat, busy: busy?.id === t.id, elsewhere: !!busy && busy.id !== t.id, ended: t.ended, key: hasKey(), calls: calls.slice(-100).reverse(), totals: aiTotals(calls) }
}

// ---------- asking

type Run = { text: string; model: string; calls: number; in: number; out: number; cost?: number }
// r: what the ask spent so far, kept when it fails too
type Opts = { t: Thread; ask: string; images: string[]; rpc: Rpc; signal: AbortSignal; spawned: (c: ChildProcess) => void; r: Run }

// chat: a spec's or brainstorm's (planChat), else the AI page's; one that ended starts again, empty
// context: where the user is as they ask (the floating chat's: the page, workspace and tab), for the model only: the
// conversation keeps their words alone
export async function aiAsk(p: { text?: string; images?: string[]; chat?: string; context?: string }, rpc: Rpc) {
  const s = state.settings?.ai ?? {}
  if (!s.on) throw new Error('Laki AI is off: Settings › AI')
  const ask = (p.text ?? '').trim()
  const images = (p.images ?? []).filter(imageOk)
  if (!ask && !images.length) throw new Error('ask something')
  const t = thread(p.chat)
  if (busy) throw new Error(busy.id === t.id ? 'the AI is still on the last ask' : 'Laki AI is busy in another chat: wait for it, or stop it')
  const backend: AiBackend = s.backend ?? 'openrouter'
  if (backend === 'openrouter' && !hasKey()) throw new Error('no OpenRouter API key: Settings › AI')
  if (t.ended) fresh(t)
  const ctl = new AbortController()
  let child: ChildProcess | undefined
  busy = { kill: () => (ctl.abort(), child?.kill('SIGTERM')), id: t.id }
  say(t, 'user', ask, images)
  asked = false
  const t0 = Date.now()
  const r: Run = { text: '', model: s.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : backend), calls: 0, in: 0, out: 0 }
  const where = typeof p.context === 'string' ? p.context.trim().slice(0, CONTEXT_MAX) : ''
  const o: Opts = { t, ask: where ? `${ask || 'See the image.'}\n\n[Where the user is in Laki as they ask this: ${where}]` : ask, images, rpc, signal: ctl.signal, spawned: c => (child = c), r }
  const call: AiCall = { at: t0, backend, model: r.model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: ask.slice(0, 120) }
  try {
    await (backend === 'claude' ? claude(o) : backend === 'codex' ? codex(o) : openrouter(o))
    call.ok = true
    if (r.text.trim() || !asked) say(t, 'ai', r.text || '(no answer)') // a question it asked is the answer
    return { text: r.text }
  } catch (e) {
    const msg = ctl.signal.aborted ? 'stopped' : (e as Error).message
    call.error = msg
    say(t, 'error', msg)
    throw new Error(msg)
  } finally {
    Object.assign(call, { model: r.model, in: r.in, out: r.out, cost: r.cost, tools: r.calls, ms: Date.now() - t0 })
    busy = null
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
    changed(t)
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
async function runTool(t: Thread, list: Tool[], name: string, args: unknown) {
  const tool = list.find(x => x.name === name)
  say(t, 'tool', `${name} ${JSON.stringify(args ?? {})}`)
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
const history = (t: Thread) =>
  t.chat
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
  const messages: object[] = [{ role: 'system', content: system(o.t) }, ...history(o.t), { role: 'user', content: pics.length ? [{ type: 'text', text: o.ask || 'See the image.' }, ...pics] : o.ask }]
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
    if (m.content) say(o.t, 'ai', m.content)
    // ponytail: Stop takes effect between tools: one under way (a wsNew) finishes first
    for (const c of m.tool_calls) {
      let args: unknown = {}
      try {
        args = JSON.parse(c.function?.arguments || '{}')
      } catch {}
      r.calls++
      messages.push({ role: 'tool', tool_call_id: c.id, content: await runTool(o.t, list, c.function?.name, args) })
    }
    if (asked) return void (r.text = '') // it asked the user: their pick goes on from here, as the next ask
  }
}
function dataUrl(path: string) {
  const buf = readFileSync(path)
  if (buf.length > MAX_IMAGE) throw new Error('an image up to 8 MB')
  const ext = extname(path).slice(1).toLowerCase()
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
}

// `laki mcp` as an MCP server for a CLI agent: this daemon's (LAKI_HOME), through node or Electron as node
const mcpServer = () => ({ command: cliArgv[0], args: [...cliArgv.slice(1), 'mcp'], env: { LAKI_HOME: dir, ...(skilled() && { LAKI_AI_SKILL: '1' }), ...(process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) } })

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
    const env = { ...process.env, ...state.settings?.env, ...presetOf(cmd)?.env, ...(cmd !== 'openrouter' && accountEnv(presetOf(cmd)?.account ?? accountUsed(cmd))), MCP_TOOL_TIMEOUT: '300000' } // its account: the preset's, else the default
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
  const resume = o.t.resume
  const prompt = o.images.length ? `${o.ask}\n\nImages (read them): ${o.images.join(' ')}` : o.ask
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', JSON.stringify({ mcpServers: { laki: mcpServer() } }), '--strict-mcp-config', '--tools', 'Read', ...(o.images.length ? ['--add-dir', join(dir, 'images')] : []), '--allowedTools', 'mcp__laki', '--append-system-prompt', system(o.t), ...(model ? ['--model', model] : []), ...(resume[sk] ? ['--resume', resume[sk]] : []), '--', prompt]
  const r = o.r
  let failed = ''
  await cli(o, 'claude', args, j => {
    if (j.session_id) resume[sk] = j.session_id
    if (j.type === 'system' && j.model) r.model = j.model
    if (j.type === 'assistant')
      for (const b of j.message?.content ?? []) {
        if (b.type === 'tool_use') (r.calls++, say(o.t, 'tool', `${String(b.name).replace(/^mcp__laki__/, '')} ${JSON.stringify(b.input ?? {})}`))
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
  const resume = o.t.resume
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
    '-c', `developer_instructions=${toml(system(o.t))}`,
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
    if (j.type === 'item.started' && it?.type === 'mcp_tool_call') (r.calls++, say(o.t, 'tool', `${it.tool} ${JSON.stringify(it.arguments ?? {})}`))
    if (j.type === 'item.completed' && it?.type === 'agent_message') r.text = it.text ?? ''
    if (j.type === 'turn.completed') (r.in += j.usage?.input_tokens ?? 0), (r.out += j.usage?.output_tokens ?? 0)
    if (j.type === 'turn.failed' || j.type === 'error') failed = j.error?.message ?? j.message ?? 'failed'
  }).catch(e => {
    if (resume[sk] && /thread|session|conversation|not found/i.test(e.message + failed)) resume[sk] = undefined // gone: the next ask starts afresh
    throw failed ? new Error(failed) : e // its own words over the exit code
  })
  if (failed) throw new Error(failed)
}

// ---------- asking the user (the skill's laki_ask and laki_remove)

// a question in the conversation, its options as buttons on the AI page; only while an ask is at work (its tools'). act:
// a removal the AI asked about, done here when the user picks Yes (the AI itself never removes anything)
export function aiQuestion(p: { text?: string; options?: unknown[]; act?: AiAct }) {
  if (!busy) throw new Error('only while Laki AI works on an ask')
  const t = thread(busy.id) // the chat whose ask is at work
  const act = p.act && AI_ACTS.includes(p.act.kind) && typeof p.act.id === 'string' && p.act.id ? { kind: p.act.kind, id: p.act.id, project: typeof p.act.project === 'string' ? p.act.project : undefined, label: '' } : undefined
  if (act) act.label = whatOf(act) ?? '' // the thing itself, never the model's words: a Yes removes what it says
  if (act && !act.label) throw new Error(`no ${act.kind} ${act.id}${act.kind === 'memory' ? ' in that project' : ''}`)
  const text = act ? `Remove ${act.label}?` : String(p.text ?? '').trim().slice(0, 2000)
  if (!text) throw new Error('a question')
  const options = act ? [`Yes, remove ${act.label}`, 'No, keep it'] : [...new Set((Array.isArray(p.options) ? p.options : []).map(o => String(o).trim().slice(0, 200)).filter(Boolean))].slice(0, 6)
  if (options.length < 2) throw new Error('2 to 6 options')
  const id = randomBytes(6).toString('hex')
  t.chat.push({ role: 'ai', text, at: (t.at = Date.now()), ask: { id, options, act } })
  asked = true
  changed(t)
  return { asked: id, note: act ? 'The user sees Yes / No buttons; a Yes removes it (you do not). End your turn now, without more words.' : 'The user sees the options as buttons. End your turn now, without more words: their pick comes as the next message.' }
}

// the user's pick (the AI page's buttons): a removal is done here on Yes; any other pick goes on as the next ask
export async function aiAnswer(p: { id: string; n: number; chat?: string }, rpc: Rpc) {
  const t = thread(p.chat)
  const chat = t.chat
  const m = chat.find(m => m.ask?.id === p.id)
  if (!m?.ask) throw new Error('no such question: a new chat started since')
  if (m.ask.picked !== undefined) throw new Error('answered already')
  if (t.ended) throw new Error('this chat ended: Continue it, or ask again') // a pick would start a new chat without the question
  if (chat.slice(chat.indexOf(m) + 1).some(x => x.role === 'user')) throw new Error('a newer ask came since: ask again') // its context is gone
  if (busy) throw new Error(busy.id === t.id ? 'the AI is still on the last ask' : 'Laki AI is busy in another chat: wait for it, or stop it')
  const pick = m.ask.options[Number(p.n)]
  if (pick === undefined) throw new Error('no such option')
  const act = m.ask.act
  if (!act) {
    const r = aiAsk({ text: pick, chat: p.chat }, rpc) // its checks (on, a key) are before its first await: busy once they pass
    if (busy) (m.ask.picked = pick), changed(t) // refused: the buttons stay, for another try
    return r
  }
  m.ask.picked = pick
  say(t, 'user', pick)
  if (Number(p.n) !== 0) return say(t, 'ai', `Kept ${act.label}.`), { kept: true }
  try {
    await remove(act, rpc)
    say(t, 'ai', `Removed ${act.label}.`)
    return { removed: true }
  } catch (e) {
    say(t, 'error', `${act.label}: ${(e as Error).message}`)
    throw e
  }
}
// what a removal would take, in words, from Laki's own state
function whatOf(a: AiAct) {
  const cut = (t: string) => `“${t.length > 80 ? `${t.slice(0, 79)}…` : t}”`
  if (a.kind === 'schedule') {
    const x = state.schedules?.find(x => x.id === a.id)
    return x && `the scheduled task ${cut(x.name || x.prompt)}`
  }
  if (a.kind === 'tab') {
    const x = state.tabs.find(x => x.id === a.id)
    return x && `the tab ${cut(x.name)}`
  }
  if (a.kind === 'todo') {
    const x = state.todos?.find(x => x.id === a.id)
    return x && `the to-do ${cut(x.text)}`
  }
  const x = state.projects.find(x => x.id === a.project)?.memory?.find(m => m.id === a.id)
  return x && `the memory ${cut(x.text)}`
}

async function remove(a: AiAct, rpc: Rpc) {
  if (a.kind === 'schedule') return rpc('scheduleRm', { id: a.id })
  if (a.kind === 'tab') return rpc('tabClose', { id: a.id })
  if (a.kind === 'todo') return rpc('todoRm', { id: a.id })
  const p = (await rpc<View>('state')).projects.find(x => x.id === a.project)
  if (!p?.memory?.some(m => m.id === a.id)) throw new Error('not in that project’s memory any more')
  return rpc('projectSet', { id: p.id, memory: p.memory.filter(m => m.id !== a.id) })
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
