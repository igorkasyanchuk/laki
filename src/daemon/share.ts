// A shared tab (remote.ts' shareStart, the app's Share live view): a view-only page anyone with its link opens, kept up to date. Here: what it
// shows, as Markdown (Copy, Download) and as the page. An agent's chat from its transcript (claude's, codex's): your
// prompts, its answers, its tool calls a line each; anything else (a shell, agy…): the terminal's text.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { esc, imgsAsLinks, markdownHtml } from '../shared/markdown.ts'
import { planFrom, type TabPlan } from '../shared/todos.ts'
import { costOf, type Goal, type Parts, partsAdd, partsOf, partsTokens, priceOf, type GoalState, type Retry, type SecretFound, type UsageWindow } from '../shared/types.ts'
import { codexRateWindows } from './usage.ts'
import { SECRETS } from '../shared/secrets.ts'

export type Said = { who: 'you' | 'agent' | 'tool' | 'screen' | 'new'; text: string; fail?: number; stopped?: true; at?: number; end?: number; cost?: number } // F6: at, end: its first and last line's time (the transcript's); cost: on a `you`, what the turn it started cost so far (claude's usage at API prices; none: a model with no price, codex) // fail: a run of tool calls', how many failed (claude's is_error: the Reader's Hide successful keeps that run); stopped: you stopped the turn there (Esc): a prompt of yours with it had no answer (the Reader's Edit and resend); new: the Reader's line where the tab's next chat (a /clear) begins (meters.ts chatRead)

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
  const what = patch && patch.length ? patch.join(', ') : (i.command ?? i.cmd ?? i.skill ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? (typeof input === 'string' ? input : ''))
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
  let at: number | undefined // the line's time
  const add = (who: Said['who'], t: unknown) => {
    const text = String(t ?? '').trim()
    if (who === 'you' && STOPPED.test(text)) return void (out.length && (out[out.length - 1].stopped = true))
    if (!text || (who === 'you' && NOISE.test(text))) return
    const last = out.at(-1)
    if (last && last.who === who && who !== 'you') (last.text += (who === 'tool' ? '\n' : '\n\n') + text), at && (last.end = at)
    else out.push({ who, text, ...(at && { at }) })
  }
  // F6: a claude answer's usage, at API prices, onto the message that started its turn. An answer is a line per block,
  // each with its usage so far: the last one counts, by its id (ids' "$" keys: what was counted for it)
  const spent = (j: any) => {
    const u = j.message?.usage
    const you = ids && u && j.message.model !== '<synthetic>' ? out.findLast(x => x.who === 'you') : undefined
    const cost = you && costOf(j.message.model, usageParts(j.message.model, u))
    if (!you || cost === undefined) return
    const key = '$' + (j.message.id ?? '')
    you.cost = (you.cost ?? 0) + cost - (j.message.id ? (ids!.get(key) ?? 0) : 0)
    if (j.message.id) ids!.set(key, cost)
  }
  for (const line of jsonl.split('\n')) {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    at = (t => (Number.isFinite(t) ? t : undefined))(Date.parse(j.timestamp))
    if (agent === 'claude') {
      if (j.isSidechain || j.isMeta) continue // a subagent's, or what Laki or a command added
      if (j.type === 'assistant') spent(j)
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
// window; claude's transcript doesn't say), the tokens it took so far (input, output, cache writes and reads) as parts by
// each answer's model (by: types.ts partsOf; meterCost prices them now) and each day's of them (days: this Mac's day, the
// Usage page's and Today's, meters.ts' usage-days.json). owns: an answer's key (answerKey: claude's message id and
// request id, codex's token_count: its totals and limits), its day, model and parts (the largest of each so far), true
// when this chat counts it (meters.ts' ledger: the first chat to report it owns it and counts it there, once; a forked or
// resumed chat's copied lines are another's)
type Spent = { p: Parts; day: string; model: string }
export type ByModel = Record<string, Parts> // a day's, by the model that answered
export type Owns = (key: string, day: string, model: string, p: Parts) => boolean
// one answer as a reader found it, for meters.ts' ledger: the chat it's in (its session id), its key (answerKey), this
// Mac's day, the model, its parts (priced by costOf) or the agent's own count (own: Grok's and OpenCode's price; none:
// tokens only), and the folder it ran in (cwd: the machine scan's, where a chat outside Laki shows)
export type UseRec = { chat: string; agent: string; key: string; day: string; model: string; p?: Parts; own?: { tokens: number; cost?: number }; cwd?: string }
// part by part the larger of two readings of one answer
export const partsMax = (a: Parts, b: Parts): Parts => { const out = { ...a }; for (const [k, v] of Object.entries(b)) if (v > (out[k] ?? 0)) out[k] = v; return out }
export type Meter = { limits?: { windows: UsageWindow[]; at: number } /* R4: codex's rate_limits, its last */; used?: number; max?: number; model?: string; tokens: number; by: ByModel; days?: Record<string, ByModel>; seen?: Map<string, Spent>; total?: Record<string, number>; plan?: TabPlan; retry?: Retry; skills?: SkillUse[]; goal?: Goal } // goal (A1): its /goal, the last said (goalIn); skills (B7): the skills the chat loaded, in that order (skillsIn); retry: claude's last API error it waits out (api_error), until an answer comes; seen: what claude's last 50 messages counted, by id; total: codex's last running totals; plan: codex's update_plan (claude's comes by its hooks)
// claude's usage as parts: its cache writes split by how long they're kept (cache_creation's ephemeral_1h_input_tokens:
// an hour, the rest 5 minutes; no split said: all 5 minutes), fast mode by usage.speed
export function usageParts(model: string | undefined, u: Record<string, any>): Parts {
  const w = num(u.cache_creation_input_tokens) ?? 0
  const w1 = Math.min(w, num(u.cache_creation?.ephemeral_1h_input_tokens) ?? 0)
  return partsOf(model, { in: num(u.input_tokens), out: num(u.output_tokens), w5: w - w1, w1, rd: num(u.cache_read_input_tokens) }, u.speed === 'fast')
}
export const answerKey = (a: string, b?: string) => createHash('sha256').update(b ? `${a}\0${b}` : a).digest('base64url').slice(0, 11) // 11 characters: 66 bits
// parts by model at today's prices: what the priced cost, the tokens of each model with no price (none)
export function meterCost(by: ByModel) {
  let cost = 0
  let priced = false
  const none: Record<string, number> = {}
  for (const [model, p] of Object.entries(by)) {
    const c = costOf(model, p)
    if (c === undefined) (none[model] = (none[model] ?? 0) + partsTokens(p))
    else (cost += c), (priced = true)
  }
  return { cost, priced, none }
}
// B7: a skill the chat loaded: its name, its folder once the transcript says it (claude's "Base directory for this
// skill:" line, or the SKILL.md a tool read)
export type SkillUse = { name: string; path?: string }
const SKILL_MD = /((?:~|\/)[^\s"'`]*\/([^/\s"'`]+))\/SKILL\.md\b/
const SKILLS_MAX = 50
// claude: its Skill tool's calls ({ skill }), the message that loads one (its base directory) and a SKILL.md read with
// Read; codex: a SKILL.md its shell read (codex loads a skill so). The main chat's only, not a subagent's
type SkillLine = { isSidechain?: boolean; type?: string; message?: { content?: unknown }; payload?: { type?: string; arguments?: unknown; input?: unknown; action?: unknown } }
type SkillPart = { type?: string; name?: string; input?: { skill?: unknown; file_path?: unknown }; text?: unknown }
function skillsIn(agent: string, j: SkillLine, m: Meter) {
  const seen = (m.skills ??= [])
  const add = (name: string, path?: string) => {
    if (!name || name.length > 120) return
    const had = seen.find(x => x.name === name)
    if (had) return void (path && !had.path && (had.path = path))
    if (seen.length < SKILLS_MAX) seen.push({ name, ...(path && { path }) })
  }
  if (agent === 'claude') {
    if (j.isSidechain) return
    const c = j.message?.content
    for (const x of (typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []) as SkillPart[]) {
      if (j.type === 'assistant' && x?.type === 'tool_use') {
        if (x.name === 'Skill' && typeof x.input?.skill === 'string') add(x.input.skill.trim())
        else if (x.name === 'Read' && typeof x.input?.file_path === 'string') (f => f && add(f[2], f[1]))(SKILL_MD.exec(x.input.file_path))
      } else if (j.type === 'user' && x?.type === 'text' && typeof x.text === 'string') {
        const d = /^Base directory for this skill: (\S[^\n]*)/m.exec(x.text)?.[1]?.trim()
        if (!d) continue
        const base = d.replace(/\/+$/, '').split('/').pop()!
        const named = seen.findLast(s => !s.path && (s.name === base || s.name.endsWith(`:${base}`)))
        named ? (named.path = d) : add(base, d)
      }
    }
  } else {
    const p = j.payload
    if (!p || j.type !== 'response_item' || !['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type ?? '')) return
    const a = p.arguments ?? p.input ?? p.action ?? ''
    const f = SKILL_MD.exec(typeof a === 'string' ? a : JSON.stringify(a))
    if (f) add(f[2], f[1])
  }
}
// A1: a /goal's state from its transcript: claude's goal_status attachments (a sentinel as it's set or cleared, met or
// not at each check, failed when it can't be), codex's thread_goal_updated (its status; none: cleared)
const CODEX_GOAL: Record<string, GoalState> = { active: 'working', paused: 'paused', budgetlimited: 'budget', usagelimited: 'limit', blocked: 'blocked', complete: 'reached', completed: 'reached' }
type GoalLine = { type?: string; isSidechain?: boolean; timestamp?: string; attachment?: { type?: string; met?: boolean; failed?: boolean; sentinel?: boolean; condition?: unknown }; payload?: { type?: string; goal?: { objective?: unknown; status?: unknown } | null; objective?: unknown; status?: unknown } }
function goalIn(agent: string, j: GoalLine, m: Meter, now: number) {
  const at = Date.parse(j.timestamp ?? '') || now
  if (agent === 'claude') {
    const a = j.attachment
    if (j.type !== 'attachment' || a?.type !== 'goal_status' || j.isSidechain) return
    const text = String(a.condition ?? '').trim().slice(0, 300)
    m.goal = a.met ? (a.sentinel ? undefined : { text, state: 'reached', at }) : { text, state: a.failed ? 'failed' : 'working', at }
  } else if (j.type === 'event_msg' && j.payload?.type === 'thread_goal_updated') {
    const p = j.payload
    const g = 'goal' in p ? p.goal : p.objective !== undefined ? p : undefined
    m.goal = g ? { text: String(g.objective ?? '').trim().slice(0, 300), state: CODEX_GOAL[String(g.status ?? 'active').toLowerCase().replace(/_/g, '')] ?? 'working', at } : undefined
  }
}
export const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
export const dayOf = (t: number) => (d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)(new Date(t))
export const meterNew = (): Meter => ({ tokens: 0, by: {} })
export function meterOf(agent: string, jsonl: string, m: Meter, now = Date.now(), owns?: Owns): Meter {
  const add = (s: Spent, by = 1) => {
    m.tokens += by * partsTokens(s.p)
    partsAdd((m.by[s.model] ??= {}), s.p, by)
    partsAdd(((m.days ??= {})[s.day] ??= {})[s.model] ??= {}, s.p, by)
  }
  for (const line of jsonl.split('\n')) {
    const skill = line.includes('SKILL.md') || line.includes('"Skill"') || line.includes('Base directory for this skill')
    const goal = line.includes(agent === 'claude' ? '"goal_status"' : '"thread_goal_updated"')
    if (!skill && !goal && !line.includes(agent === 'claude' ? '"usage"' : 'token_count') && !line.includes('"turn_context"') && (agent === 'claude' ? !line.includes('"api_error"') : !/"update_plan"|"user_message"/.test(line))) continue // most lines: not parsed
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const at = dayOf(Date.parse(j.timestamp) || now)
    if (skill) skillsIn(agent, j, m)
    if (goal) goalIn(agent, j, m, now)
    if (agent === 'claude') {
      if (j.type === 'system' && j.subtype === 'api_error' && !j.isSidechain) {
        const at = Date.parse(j.timestamp) || now
        m.retry = { n: num(j.retryAttempt), max: num(j.maxRetries), at, until: at + (num(j.retryInMs) ?? 0), why: String(j.error?.formatted || j.error?.message || '').slice(0, 120) || undefined }
        continue
      }
      if (j.type === 'assistant' && !j.isSidechain) m.retry = undefined // it answered: the wait's over
      const u = j.type === 'assistant' && j.message?.usage
      if (!u || j.message.model === '<synthetic>') continue // claude's own notes: no call
      const model = String(j.message.model || 'unknown')
      const p = usageParts(model, u)
      if (!j.isSidechain) m.used = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) // a subagent's is a context of its own
      // an answer is a line per block, each with its usage so far: of its lines the largest of each part counts (a
      // subagent's output grows as it streams; T3 Code's rule), once, by its id, so a subagent's lines in between don't
      // count it twice; one another chat owns (copied in) counts there. No id: the line's own (its uuid)
      const id = typeof j.message.id === 'string' ? j.message.id : undefined
      const key = id ? answerKey(id, typeof j.requestId === 'string' ? j.requestId : undefined) : typeof j.uuid === 'string' ? answerKey(`u:${j.uuid}`) : undefined
      const was = id ? m.seen?.get(id) : undefined
      const spent: Spent = was ? { ...was, p: partsMax(was.p, p) } : { p, day: at, model }
      if (key && owns && !owns(key, spent.day, spent.model, spent.p)) continue
      if (was) add(was, -1)
      add(spent)
      if (id) {
        const seen = (m.seen ??= new Map())
        seen.delete(id)
        seen.set(id, spent)
        if (seen.size > 50) seen.delete(seen.keys().next().value!)
      }
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
      if (j.type === 'event_msg' && p?.type === 'token_count' && p.rate_limits) {
        const t = Date.parse(j.timestamp) || now
        const windows = codexRateWindows(p.rate_limits, t)
        if (windows.length && t >= (m.limits?.at ?? 0)) m.limits = { windows, at: t }
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
      // its input has the cached in it; a long prompt by the request's whole input (partsOf)
      const p2 = partsOf(m.model, { in: d('input_tokens') - d('cached_input_tokens'), out: d('output_tokens'), rd: d('cached_input_tokens') })
      if (owns && !owns(answerKey(JSON.stringify(p)), at, m.model || 'unknown', p2)) continue // a fork's or spawned thread's copy of its parent's: its totals and limits as they were (its line's time is the copy's)
      add({ p: p2, day: at, model: m.model || 'unknown' })
    }
  }
  return m
}

// a day's tokens of one model, kept: its parts (p: priced by costOf now), the agent's own count (own: Grok's price,
// OpenCode's; no cost: no price, agy's), or one kept before parts (neither: its cost as it was, old)
export type Row = { p: Parts } | { tokens: number; cost?: number; own?: true }
export const isOld = (r: Row) => !('p' in r) && !r.own
export const rowTokens = (r: Row) => ('p' in r ? partsTokens(r.p) : (r.tokens ?? 0))
export const rowCost = (model: string, r: Row) => ('p' in r ? costOf(model, r.p) : r.cost)
export function daysRows(chats: Record<string, { ws: string; agent: string; days: Record<string, Record<string, Row>> }>) {
  type Day = { day: string; agent: string; model: string; ws: string; tokens: number; cost: number; priced: boolean; old?: true; read?: number; input?: number }
  const sum = new Map<string, Day>()
  for (const c of Object.values(chats))
    for (const [d, models] of Object.entries(c.days))
      for (const [model, r] of Object.entries(models)) {
        const day = (([y, m, dd]) => `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)(d.split('-'))
        const key = `${day}|${c.agent}|${model}|${c.ws}`
        const x = sum.get(key) ?? (sum.set(key, { day, agent: c.agent, model, ws: c.ws, tokens: 0, cost: 0, priced: true }), sum.get(key)!)
        const usd = rowCost(model, r)
        x.tokens += rowTokens(r)
        x.cost += usd ?? 0
        if (usd === undefined || (isOld(r) && !usd && !priceOf(model))) x.priced = false
        if (isOld(r)) x.old = true
        if ('p' in r) for (const [k, v] of Object.entries(r.p)) k.startsWith('rd') && (x.read = (x.read ?? 0) + v), k.startsWith('out') || (x.input = (x.input ?? 0) + v)
      }
  return [...sum.values()].map(r => ({ ...r, cost: Math.round(r.cost * 1e4) / 1e4 })).sort((a, b) => a.day.localeCompare(b.day))
}

export const redact = (t: string) => SECRETS.reduce((s, [re, to]) => s.replace(re, to), t)
// Ship's secret check (core.ts shipSecrets): each of SECRETS' shapes in the text, by its line (1-based, where it starts),
// with its kind and itself masked (one masked whole keeps its first 4 characters: sk_l••••), and hash, salt's and its
// sha-256 (a "Not a secret" is remembered by it). One match where two shapes overlap (PASSWORD=sk-…). Never the match
export function findSecrets(text: string, salt = ''): Omit<SecretFound, 'file'>[] {
  const out: (Omit<SecretFound, 'file'> & { at: number })[] = []
  const took: [number, number][] = []
  for (const [re, to, kind] of SECRETS)
    for (const m of text.matchAll(re)) {
      const at = m.index, end = at + m[0].length
      if (took.some(([a, b]) => at < b && end > a)) continue
      took.push([at, end])
      const masked = to === '••••' ? `${m[0].slice(0, 4)}••••` : m[0].replace(re, to)
      out.push({ at, line: 0, kind, masked: masked.length > 80 ? `${masked.slice(0, 40)}…${masked.slice(-8)}` : masked, hash: createHash('sha256').update(`${salt}\0${m[0]}`).digest('hex').slice(0, 32) })
    }
  out.sort((x, y) => x.at - y.at)
  let line = 1, i = 0
  return out.map(({ at, ...f }) => {
    for (; i < at; i++) if (text.charCodeAt(i) === 10) line++
    return { ...f, line }
  })
}
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
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; text-size-adjust: 100% }
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
