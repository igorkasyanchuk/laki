// A shared tab (remote.ts' shareStart, the app's Share live view): a view-only page anyone with its link opens, kept up to date. Here: what it
// shows, as Markdown (Copy, Download) and as the page. An agent's chat from its transcript (claude's, codex's): your
// prompts, its answers, its tool calls a line each; anything else (a shell, gemini…): the terminal's text.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { esc, imgsAsLinks, markdownHtml } from '../shared/markdown.ts'
import { planFrom, type TabPlan } from '../shared/todos.ts'
import { costOf, type Retry } from '../shared/types.ts'

export type Said = { who: 'you' | 'agent' | 'tool' | 'screen' | 'new'; text: string; fail?: number; stopped?: true } // fail: a run of tool calls', how many failed (claude's is_error: the Reader's Hide successful keeps that run); stopped: you stopped the turn there (Esc): a prompt of yours with it had no answer (the Reader's Edit and resend); new: the Reader's line where the tab's next chat (a /clear) begins (meters.ts chatRead)

// claude's: <its config>/projects/<the folder's>/<session>.jsonl; codex's: <its home>/sessions/y/m/d/rollout-…-<thread>.jsonl
export function transcriptOf(agent: string, dir: string, id: string): string | undefined {
  if (!/^[\w-]+$/.test(id)) return // an id, never a path
  try {
    if (agent === 'claude') return readdirSync(join(dir, 'projects')).map(d => join(dir, 'projects', d, `${id}.jsonl`)).find(f => existsSync(f))
    if (agent === 'codex') {
      const f = (readdirSync(join(dir, 'sessions'), { recursive: true }) as string[]).find(f => f.endsWith(`-${id}.jsonl`))
      return f && join(dir, 'sessions', f)
    }
  } catch {}
}

// what the agent adds to a prompt (context, a slash command's output), not what you typed
// claude's word that you stopped its turn (Esc), codex's: marks what came before (stopped), never said as yours
const STOPPED = /^\s*(\[Request interrupted by user|<turn_aborted>)/
const NOISE = /^\s*(<(command-|local-command|system-reminder|environment_context|user_instructions|permissions|turn_aborted|user_memory|task-notification|agent-message)|# AGENTS\.md instructions)/ // task-notification, agent-message: claude's word that a background task or subagent ended
const args = (a: unknown) => {
  if (typeof a !== 'string') return a
  try {
    return JSON.parse(a)
  } catch {
    return a
  }
}
// a tool call in a line: its name and what it ran or read
function toolLine(name: string, input: unknown) {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const patch = typeof input === 'string' && [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1]) // codex's apply_patch
  const what = patch && patch.length ? patch.join(', ') : (i.command ?? i.cmd ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? (typeof input === 'string' ? input : ''))
  const s = (Array.isArray(what) ? what.join(' ') : String(what)).replace(/\s+/g, ' ').trim()
  return `${name}${s ? `: ${s.length > 160 ? `${s.slice(0, 159)}…` : s}` : ''}`
}

// a transcript (JSON lines) as what was said, in order, onto out (what its earlier lines said); an agent's answers
// and tool calls in a row are one each
// calls: a claude chat's MCP tool calls (mcp__<server>__<tool>), each with the said line it's in (at) and, once it
// came, its result: the Reader's MCP Apps (mcpApps.ts). ids: a claude chat's every tool call, the said line it's in: a
// result that failed counts on it (fail)
export type McpCall = { id: string; server: string; tool: string; input: unknown; at: number; result?: unknown; error?: boolean }
export function chatOf(agent: string, jsonl: string, out: Said[] = [], calls?: Map<string, McpCall>, ids?: Map<string, number>): Said[] {
  const add = (who: Said['who'], t: unknown) => {
    const text = String(t ?? '').trim()
    if (who === 'you' && STOPPED.test(text)) return void (out.length && (out[out.length - 1].stopped = true))
    if (!text || (who === 'you' && NOISE.test(text))) return
    const last = out.at(-1)
    if (last && last.who === who && who !== 'you') last.text += (who === 'tool' ? '\n' : '\n\n') + text
    else out.push({ who, text })
  }
  for (const line of jsonl.split('\n')) {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (agent === 'claude') {
      if (j.isSidechain || j.isMeta) continue // a subagent's, or what Laki or a command added
      const c = j.message?.content
      const parts: any[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
      for (const x of parts) {
        if (j.type === 'user' && x.type === 'text') add('you', x.text)
        else if (j.type === 'user' && x.type === 'image') add('you', '[an image]')
        else if (j.type === 'assistant' && x.type === 'text') add('agent', x.text)
        else if (j.type === 'assistant' && x.type === 'tool_use') {
          add('tool', toolLine(x.name, x.input))
          if (ids && typeof x.id === 'string') ids.set(x.id, out.length - 1)
          const m = calls && typeof x.id === 'string' && /^mcp__(.+?)__(.+)$/.exec(String(x.name))
          if (m) calls!.set(x.id, { id: x.id, server: m[1], tool: m[2], input: x.input ?? {}, at: out.length - 1 })
        } else if (j.type === 'user' && x.type === 'tool_result') {
          const at = x.is_error ? ids?.get(x.tool_use_id) : undefined
          if (at !== undefined && out[at]) out[at].fail = (out[at].fail ?? 0) + 1
          if (!calls?.has(x.tool_use_id)) continue
          const c = calls.get(x.tool_use_id)!
          const r = j.toolUseResult
          // what the app is told (ui/notifications/tool-result): its content blocks, and structuredContent when claude kept it
          c.result = { content: typeof x.content === 'string' ? [{ type: 'text', text: x.content }] : Array.isArray(x.content) ? x.content : [], ...(r && typeof r === 'object' && !Array.isArray(r) && r.structuredContent && { structuredContent: r.structuredContent }) }
          if (x.is_error) c.error = true
        }
      }
    } else {
      // ponytail: codex's event messages (what its own UI shows); a codex too old to write them shows tool calls only
      const p = j.payload
      if (j.type === 'event_msg' && p?.type === 'user_message') add('you', p.message)
      else if (j.type === 'event_msg' && p?.type === 'agent_message') add('agent', p.message)
      else if (j.type === 'response_item' && ['function_call', 'custom_tool_call', 'local_shell_call'].includes(p?.type)) add('tool', toolLine(p.name ?? 'shell', args(p.arguments ?? p.input ?? p.action)))
    }
  }
  return out
}

// What a claude chat started and still runs (the Reader's chips over its box): its subagents (Agent or Task: running
// until their result, or a background one's task-notification) and background shells (Bash run_in_background: from its
// ID until a task-notification, KillShell or TaskStop ends it), each with the file its output goes to once it's said.
// Read on with its transcript (meters.ts chatRead), onto bg; wait: background shells' calls, until their result says
// their ID. ponytail: claude only; one whose end isn't in the transcript (claude quit) stays until the chat is read anew
export type BgTask = { id: string; kind: 'agent' | 'shell'; name: string; out?: string; cmd?: string } // cmd: a shell's command
// done: how many ended, the newest DONE_KEPT of them, when the last one did (its line's time: the status bar's Background
// card)
export type BgRead = { bg: Map<string, BgTask>; wait: Map<string, { name: string; cmd?: string }>; done?: { n: number; last: BgTask[]; at?: number } }
const DONE_KEPT = 5
const ENDED = /^(completed?|done|failed|killed|stopped|cancell?ed|error|timed?[_ ]?out)$/i
export function bgOf(jsonl: string, r: BgRead): BgRead {
  let at: number | undefined // the line's time
  const end = (id: string) => {
    const t = r.bg.get(id)
    if (!t || !r.bg.delete(id) || !r.done) return
    r.done.n++
    r.done.last = [t, ...r.done.last].slice(0, DONE_KEPT)
    r.done.at = at
  }
  const ended = (text: string) => {
    for (const n of text.split('<task-notification>').slice(1)) {
      const tag = (k: string) => new RegExp(`<${k}>\\s*([^<]*?)\\s*</${k}>`).exec(n)?.[1]
      if (tag('status') && !ENDED.test(tag('status')!)) continue
      for (const id of [tag('task-id'), tag('tool-use-id')]) if (id) end(id)
    }
  }
  for (const line of jsonl.split('\n')) {
    if (!line.includes('tool_use') && !line.includes('task-notification')) continue // most lines: not parsed
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.isSidechain) continue // a subagent's own calls
    at = (t => (Number.isFinite(t) ? t : undefined))(Date.parse(j.timestamp))
    if (j.type === 'queue-operation' && typeof j.content === 'string') ended(j.content)
    const c = j.message?.content
    const parts: any[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
    for (const x of parts) {
      if (j.type === 'user' && x.type === 'text' && typeof x.text === 'string') ended(x.text)
      else if (j.type === 'assistant' && x.type === 'tool_use' && typeof x.id === 'string') {
        const i = x.input ?? {}
        const name = String(i.description || i.subagent_type || i.command || x.name).replace(/\s+/g, ' ').trim().slice(0, 80)
        if (x.name === 'Agent' || x.name === 'Task') r.bg.set(x.id, { id: x.id, kind: 'agent', name })
        else if (x.name === 'Bash' && i.run_in_background === true) r.wait.set(x.id, { name, ...(typeof i.command === 'string' && { cmd: i.command.replace(/\s+/g, ' ').trim().slice(0, 200) }) })
        else if (x.name === 'KillShell' || x.name === 'KillBash' || x.name === 'TaskStop') end(String(i.shell_id ?? i.task_id ?? i.id ?? ''))
      } else if (j.type === 'user' && x.type === 'tool_result' && typeof x.tool_use_id === 'string') {
        const res = j.toolUseResult && typeof j.toolUseResult === 'object' ? j.toolUseResult : {}
        const said = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y: any) => y?.text ?? '').join('\n') : ''
        const a = r.bg.get(x.tool_use_id)
        if (a) {
          // a subagent's result: it's done, or (a background one) it runs on under its own id
          if (res.isAsync && typeof res.agentId === 'string') r.bg.delete(x.tool_use_id), r.bg.set(res.agentId, { ...a, id: res.agentId, ...(typeof res.outputFile === 'string' && { out: res.outputFile }) })
          else end(x.tool_use_id)
        }
        const shell = r.wait.get(x.tool_use_id)
        if (shell !== undefined) {
          r.wait.delete(x.tool_use_id)
          const id = typeof res.backgroundTaskId === 'string' ? res.backgroundTaskId : /with ID:\s*([\w-]+)/.exec(said)?.[1]
          const out = /written to:\s*(\S+?\.output)\b/.exec(said)?.[1]
          if (id && !x.is_error) r.bg.set(id, { id, kind: 'shell', ...shell, ...(out && { out }) })
        }
      }
    }
  }
  return r
}

// what a chat used, from its transcript read on (meters.ts; onto m, what its earlier lines said): used, what its
// context holds now (claude: the last answer's prompt, its cache's too; codex: its last token_count's) of max (codex's
// window; claude's transcript doesn't say), the tokens it took so far (input, output, cache writes and reads) and their
// cost by each turn's model (costOf; priced: some had a price), today's of them by each line's time (this Mac's day),
// and each day's by model (days: the Usage page's, meters.ts' usage-days.json)
type Spent = { tokens: number; cost: number; day: string; model?: string }
export type ByModel = Record<string, { tokens: number; cost: number }> // a day's, by the model that answered
export type Meter = { used?: number; max?: number; model?: string; tokens: number; cost: number; priced?: boolean; day: string; today: { tokens: number; cost: number }; days?: Record<string, ByModel>; seen?: Map<string, Spent>; total?: Record<string, number>; plan?: TabPlan; retry?: Retry } // retry: claude's last API error it waits out (api_error), until an answer comes; seen: what claude's last 50 messages counted, by id; total: codex's last running totals; plan: codex's update_plan (claude's comes by its hooks)
export const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
export const dayOf = (t: number) => (d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)(new Date(t))
export const meterNew = (now = Date.now()): Meter => ({ tokens: 0, cost: 0, day: dayOf(now), today: { tokens: 0, cost: 0 } })
export function meterOf(agent: string, jsonl: string, m: Meter, now = Date.now()): Meter {
  const day = dayOf(now)
  if (m.day !== day) (m.day = day), (m.today = { tokens: 0, cost: 0 }) // a new day
  const add = (s: Spent, by = 1) => {
    m.tokens += by * s.tokens
    m.cost += by * s.cost
    if (s.day === day) (m.today.tokens += by * s.tokens), (m.today.cost += by * s.cost)
    const d = ((m.days ??= {})[s.day] ??= {})
    const x = (d[s.model || 'unknown'] ??= { tokens: 0, cost: 0 })
    x.tokens += by * s.tokens
    x.cost += by * s.cost
  }
  for (const line of jsonl.split('\n')) {
    if (!line.includes(agent === 'claude' ? '"usage"' : 'token_count') && !line.includes('"turn_context"') && (agent === 'claude' ? !line.includes('"api_error"') : !/"update_plan"|"user_message"/.test(line))) continue // most lines: not parsed
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const at = dayOf(Date.parse(j.timestamp) || now)
    if (agent === 'claude') {
      if (j.type === 'system' && j.subtype === 'api_error' && !j.isSidechain) {
        const at = Date.parse(j.timestamp) || now
        m.retry = { n: num(j.retryAttempt), max: num(j.maxRetries), at, until: at + (num(j.retryInMs) ?? 0), why: String(j.error?.formatted || j.error?.message || '').slice(0, 120) || undefined }
        continue
      }
      if (j.type === 'assistant' && !j.isSidechain) m.retry = undefined // it answered: the wait's over
      const u = j.type === 'assistant' && j.message?.usage
      if (!u || j.message.model === '<synthetic>') continue // claude's own notes: no call
      const n = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, write: u.cache_creation_input_tokens ?? 0, read: u.cache_read_input_tokens ?? 0 }
      const cost = costOf(j.message.model, n)
      if (cost !== undefined) m.priced = true
      // an answer is a line per block, each with its usage so far: the last one counts, by its id, so a subagent's lines
      // in between don't count it twice
      const id = j.message.id
      const was = id && m.seen?.get(id)
      if (was) add(was, -1)
      const spent: Spent = { tokens: n.input + n.output + n.write + n.read, cost: cost ?? 0, day: at, model: j.message.model }
      add(spent)
      if (id) {
        const seen = (m.seen ??= new Map())
        seen.delete(id)
        seen.set(id, spent)
        if (seen.size > 50) seen.delete(seen.keys().next().value!)
      }
      if (!j.isSidechain) m.used = n.input + n.write + n.read // a subagent's is a context of its own
    } else {
      const p = j.payload
      if (j.type === 'turn_context' && p?.model) m.model = p.model
      if (p?.type === 'user_message' && m.plan) m.plan.stale = true // a new ask: the list is the last one's until it writes one
      if (p?.type === 'function_call' && p.name === 'update_plan') {
        let input: unknown
        try {
          input = JSON.parse(p.arguments)
        } catch {}
        const next = planFrom(m.plan, { tool: 'update_plan', input, post: false })
        if (next) m.plan = next.items.length ? next : undefined
        continue
      }
      const i = j.type === 'event_msg' && p?.type === 'token_count' && p.info
      if (!i) continue
      if (i.model_context_window) m.max = i.model_context_window
      if (i.last_token_usage) m.used = i.last_token_usage.total_tokens ?? 0
      const all = i.total_token_usage
      if (!all) continue
      // its running totals: what grew since the last (smaller: counted anew)
      const was = m.total && (all.total_tokens ?? 0) >= (m.total.total_tokens ?? 0) ? m.total : {}
      const d = (k: string) => (all[k] ?? 0) - (was[k] ?? 0)
      m.total = all
      if (!d('total_tokens')) continue // a rate limit's update: the same totals
      const cost = costOf(m.model, { input: d('input_tokens') - d('cached_input_tokens'), output: d('output_tokens'), read: d('cached_input_tokens') }) // its input has the cached in it
      if (cost !== undefined) m.priced = true
      add({ tokens: d('total_tokens'), cost: cost ?? 0, day: at, model: m.model })
    }
  }
  return m
}

// L9: token-shaped strings masked in what a share shows (its page and Markdown) and a phone push says: API keys (sk-…,
// Stripe's, GitHub's, Slack's, Google's, npm's, Hugging Face's, AWS's key ids), a private key's PEM block, a Bearer
// token, a JWT, a token's, key's or secret's value in a URL, a URL's password, a NAME=value whose name says secret.
// ponytail: shapes, not every secret
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '••••'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g, '••••'],
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/'"<>]{1,256}:)[^\s@/'"<>]{1,256}@/gi, '$1••••@'], // bounded: an unbounded scheme or name backtracks over a long word (100 KB: seconds)
  [/\b([A-Z0-9_]{0,64}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY)[A-Z0-9_]{0,64}\s*[=:]\s*)(?:(['"])[^'"\n]{2,}\2|(?![\d.]+(?![^\s'"&]))[^\s'"&]{4,})/g, '$1••••'], // an env var's way: in capitals; a number isn't one (MAX_TOKENS=4096)
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1••••'],
  [/(?<![\w-])eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '••••'], // at a run's start, not \b: after each - of eyJ-eyJ-… it scanned the rest again (100 KB: 3 s). ponytail: x-eyJ… stays
  [/([?&](?:token|access_token|key|api_key|apikey|secret|password|auth|sig|signature)=)[^&\s"'#<>]+/gi, '$1••••'],
]
export const redact = (t: string) => SECRETS.reduce((s, [re, to]) => s.replace(re, to), t)
const fence = (t: string) => (f => `${f}\n${t}\n${f}`)('`'.repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))))
export function shareMd(title: string, agent: string, said: Said[]) {
  const parts = [`# ${title}`]
  for (const s of said) {
    if (s.who === 'screen') parts.push(fence(s.text))
    else if (s.who === 'new') parts.push('---')
    else if (s.who === 'tool') parts.push(s.text.split('\n').map(l => `> ⚙ ${l}`).join('  \n'))
    else parts.push(`**${s.who === 'you' ? 'You' : agent}**\n\n${s.text}`)
  }
  return `${parts.join('\n\n')}\n`
}

// ---------- the page: everything escaped here (markdown.ts' tree holds no HTML); links http(s) and mailto only

// what was said as the page's main part (the page swaps it as it changes)
export function shareBody(agent: string, said: Said[]) {
  if (!said.length) return '<p class="empty">Nothing here yet.</p>'
  return said
    .map(s => {
      if (s.who === 'screen') return `<pre class="screen">${esc(s.text)}</pre>`
      if (s.who === 'new') return '<hr>'
      if (s.who === 'tool') {
        const lines = s.text.split('\n').map(l => `<div>${esc(l)}</div>`).join('')
        const n = s.text.split('\n').length
        return `<details class="tools"${n <= 3 ? ' open' : ''}><summary>${n} tool call${n === 1 ? '' : 's'}</summary>${lines}</details>`
      }
      const md = imgsAsLinks(markdownHtml(s.text)) // its CSP: img-src data:
      return `<section class="m ${s.who}"><div class="who">${s.who === 'you' ? 'You' : esc(agent)}</div><div class="md">${md}</div></section>`
    })
    .join('')
}

export function sharePage(o: { id: string; title: string; sub: string; body: string; v: number; nonce: string }) {
  const id = esc(o.id)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(o.title)} · Laki</title>
<style nonce="${o.nonce}">
:root { --bg: #f6f7fb; --panel: #fff; --line: #e4e7ef; --fg: #161a26; --muted: #687087; --accent: #4f6bed; --accent-2: #8b5cf6; --you: #eef1ff; --you-line: #d9e0ff; --code: #f2f4f9; --live: #22c55e; --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 8px 24px -12px rgba(16, 24, 40, .12); --mono: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Monaco, monospace; --ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color-scheme: light dark }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0d12; --panel: #13161e; --line: #232836; --fg: #e3e6ef; --muted: #8a92a6; --accent: #8ea2ff; --accent-2: #b794f6; --you: #171c2e; --you-line: #262f4d; --code: #181c26; --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -16px rgba(0, 0, 0, .6) } }
* { box-sizing: border-box }
html { scroll-behavior: smooth }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15.5px/1.65 var(--ui); -webkit-font-smoothing: antialiased }
header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(1.6) blur(14px); -webkit-backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent) }
.bar { max-width: 820px; margin: 0 auto; padding: 12px 20px; display: flex; gap: 14px; align-items: center }
.mark { width: 30px; height: 30px; flex: none; border-radius: 9px; display: grid; place-items: center; color: #fff; font: 700 15px/1 var(--ui); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) 60%, transparent) }
.t { flex: 1; min-width: 0 }
h1 { margin: 0; font-size: 15.5px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sub { color: var(--muted); font-size: 12.5px; display: flex; gap: 7px; align-items: center; min-width: 0 }
.sub span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.live { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--live); background: color-mix(in srgb, var(--live) 12%, transparent) }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 0 color-mix(in srgb, var(--live) 60%, transparent); animation: pulse 2s infinite }
@keyframes pulse { 70% { box-shadow: 0 0 0 6px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
.ended .live { color: var(--muted); background: color-mix(in srgb, var(--muted) 14%, transparent) }
.ended .dot { background: var(--muted); animation: none }
.acts { display: flex; gap: 6px; align-items: center }
button, .btn { font: inherit; font-size: 13px; font-weight: 500; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 6px 12px; cursor: pointer; text-decoration: none; white-space: nowrap; transition: border-color .15s, background .15s }
button:hover, .btn:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)) }
button:focus-visible, .btn:focus-visible, .tog:focus-within { outline: 2px solid var(--accent); outline-offset: 2px }
.tog { display: inline-flex; gap: 7px; align-items: center; font-size: 13px; color: var(--muted); white-space: nowrap; cursor: pointer; border-radius: 9px; padding: 4px 6px }
.tog input { appearance: none; width: 28px; height: 16px; margin: 0; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; transition: background .15s }
.tog input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s }
.tog input:checked { background: var(--accent) }
.tog input:checked::after { transform: translateX(12px) }
main { max-width: 820px; margin: 0 auto; padding: 20px 20px 72px; display: flex; flex-direction: column; gap: 14px }
.m { padding: 14px 18px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); min-width: 0 }
.m.you { align-self: flex-end; max-width: 88%; background: var(--you); border-color: var(--you-line); box-shadow: none; border-bottom-right-radius: 6px }
.m.agent { border-bottom-left-radius: 6px }
.who { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 6px; text-transform: capitalize }
.m.agent .who::before { content: ''; width: 18px; height: 18px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), var(--accent-2)) }
.m.you .who { justify-content: flex-end }
.md { overflow-wrap: anywhere }
.md > :first-child { margin-top: 0 } .md > :last-child { margin-bottom: 0 }
.md p { margin: .55em 0 }
.md h1, .md h2, .md h3 { font-size: 1.08em; letter-spacing: -.01em; margin: 1.1em 0 .4em }
.md ul, .md ol { padding-left: 1.4em }
a { color: var(--accent); text-underline-offset: 2px }
code { font: 13px var(--mono); background: var(--code); border-radius: 5px; padding: 1px 5px }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; overflow-x: auto; font-size: 13px; line-height: 1.5 }
pre code { background: none; padding: 0 }
pre.screen { margin: 0; font: 12.5px/1.5 var(--mono); white-space: pre-wrap; word-break: break-word; background: var(--panel); box-shadow: var(--shadow) }
blockquote { margin: 0; padding: 2px 0 2px 14px; border-left: 3px solid color-mix(in srgb, var(--accent) 40%, var(--line)); color: var(--muted) }
.tw { overflow-x: auto } table { border-collapse: collapse; font-size: 14px } th, td { border: 1px solid var(--line); padding: 6px 10px } th { background: var(--code) } .center { text-align: center } .right { text-align: right }
img { max-width: 100%; border-radius: 10px }
.tools { align-self: flex-start; max-width: 100%; color: var(--muted); font: 12.5px/1.6 var(--mono); padding: 4px 12px; border-radius: 10px; border: 1px dashed var(--line) }
.tools[open] { align-self: stretch }
.tools summary { cursor: pointer; font: 500 12.5px var(--ui); list-style: none; display: flex; align-items: center; gap: 6px }
.tools summary::-webkit-details-marker { display: none }
.tools summary::before { content: '›'; display: inline-block; transition: transform .15s; font-size: 15px }
.tools[open] summary::before { transform: rotate(90deg) }
.tools div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 14px }
.empty { color: var(--muted); text-align: center; padding: 72px 0 }
body.notools .tools { display: none }
#latest { position: fixed; bottom: 22px; right: 22px; z-index: 2; border-radius: 999px; padding: 8px 14px; background: var(--accent); color: #fff; border: none; box-shadow: var(--shadow); opacity: 0; pointer-events: none; transform: translateY(6px); transition: opacity .2s, transform .2s }
#latest.on { opacity: 1; pointer-events: auto; transform: none }
footer { max-width: 820px; margin: -48px auto 0; padding: 0 20px 28px; color: var(--muted); font-size: 12px; text-align: center }
.toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 7px 14px; border-radius: 999px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none }
.toast.on { opacity: 1 }
@media (max-width: 600px) { body { font-size: 15px } .bar { flex-wrap: wrap; padding: 10px 14px; gap: 10px } .t { flex-basis: calc(100% - 44px) } .acts { width: 100%; justify-content: flex-end } .dl { display: none } main { padding: 14px 12px 64px } .m { padding: 12px 14px } .m.you { max-width: 94% } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } .dot { animation: none } }
</style></head>
<body><header><div class="bar"><div class="mark" aria-hidden="true">L</div><div class="t"><h1 id="title">${esc(o.title)}</h1><div class="sub" id="sub"><span class="live"><span class="dot"></span><span id="live">LIVE</span></span><span id="state">${esc(o.sub)}</span></div></div>
<div class="acts"><label class="tog"><input type="checkbox" id="tools" checked> Tool calls</label><button id="copy" type="button">Copy as Markdown</button><a class="btn dl" href="${id}.md?download=1" download>Download .md</a></div></div></header>
<main id="main">${o.body}</main><footer>Shared from Laki · view-only · it updates as it goes</footer><button id="latest" type="button">↓ New below</button><div class="toast" id="toast"></div>
<script nonce="${o.nonce}">
(() => {
  let v = ${o.v}
  const $ = id => document.getElementById(id)
  // tool calls shown or not: the reader's pick, kept in this browser (none kept: shown)
  const tools = on => { document.body.classList.toggle('notools', !on); $('tools').checked = on; try { localStorage.setItem('laki.tools', on ? '1' : '0') } catch {} }
  try { if (localStorage.getItem('laki.tools') === '0') tools(false) } catch {}
  $('tools').onchange = e => tools(e.target.checked)
  const toast = t => { $('toast').textContent = t; $('toast').classList.add('on'); setTimeout(() => $('toast').classList.remove('on'), 1600) }
  // the write starts in the click (Safari's rule), the text comes when fetched
  const md = () => fetch('${id}.md', { cache: 'no-store' }).then(r => r.text())
  $('copy').onclick = () => (window.ClipboardItem ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': md().then(t => new Blob([t], { type: 'text/plain' })) })]) : md().then(t => navigator.clipboard.writeText(t))).then(() => toast('Copied as Markdown'), () => toast('Couldn\\u2019t copy'))
  const end = (why, word = 'ENDED') => { document.body.classList.add('ended'); $('live').textContent = word; $('state').textContent = why }
  const poll = () => fetch('${id}.json?v=' + v, { cache: 'no-store' }).then(r => (r.status === 404 ? end('This share has ended') : r.json().then(j => {
    $('state').textContent = j.sub
    document.body.classList.remove('ended')
    $('live').textContent = 'LIVE'
    if (j.v !== v) {
      const low = innerHeight + scrollY >= document.body.scrollHeight - 80 // at the end: follow what's new
      v = j.v
      const open = [...document.querySelectorAll('main details')].map(d => d.open) // the reader's picks: kept
      $('main').innerHTML = j.body // the server's, escaped there
      document.querySelectorAll('main details').forEach((d, k) => k < open.length && (d.open = open[k]))
      $('title').textContent = j.title
      document.title = j.title + ' \\u00b7 Laki'
      if (low) scrollTo(0, document.body.scrollHeight)
      else $('latest').classList.add('on') // something new below where the reader is
    }
    setTimeout(poll, 2500)
  }))).catch(() => (end('Can\\u2019t reach it now \\u00b7 trying again', 'OFFLINE'), setTimeout(poll, 5000))) // offline, the tunnel's error page
  $('latest').onclick = () => scrollTo(0, document.body.scrollHeight)
  addEventListener('scroll', () => innerHeight + scrollY >= document.body.scrollHeight - 80 && $('latest').classList.remove('on'), { passive: true })
  setTimeout(poll, 2500)
})()
</script></body></html>`
}
