// Where a task's tokens went (wsSpend, laki spend, Info's and the Proof card's "Where it went"): an agent's transcript as
// entries (spendEntries: claude's and codex's JSONL), then spendBreakdown: input tokens by what entered the context (file
// reads by path with their counts, command output by its command's head, searches, MCP results, the conversation carried
// into each turn, the system prompt and rules, your messages) and output tokens by kind (edits, messages, thinking, tool
// calls), plus up to three hints from fixed rules. Every number is an estimate: a transcript's per-request usage gives
// the totals (exact: true) and they're spread by content size (4 characters a token); without usage, sizes alone. Pure:
// no model call, no file read (test/meter.test.ts)
import { nearPath } from './ask.ts'

export type SpendEntry =
  | { kind: 'user'; chars: number } // a message of yours: a turn starts
  | { kind: 'request'; id?: string; input: number; output: number } // a model request's usage (the last one of an id counts)
  | { kind: 'tool'; source: 'file' | 'command' | 'search' | 'mcp' | 'other'; key: string; chars: number; lines?: number } // what a tool's result put in the context
  | { kind: 'out'; what: 'edits' | 'messages' | 'thinking' | 'tools'; chars: number } // what the model wrote
export type SpendSource = 'file' | 'command' | 'search' | 'mcp' | 'carried' | 'system' | 'user' | 'other'
export type SpendPart = { kind: SpendSource; label: string; tokens: number; share: number; reads?: number; lines?: number }
export type Spend = { estimate: true; exact: boolean; turns: number; input: { total: number; parts: SpendPart[] }; output: { total: number; parts: { kind: 'edits' | 'messages' | 'thinking' | 'tools'; tokens: number; share: number }[] }; hints: string[] }

const tok = (chars: number) => Math.round(chars / 4)
const pct = (x: number) => `${Math.round(x * 100)}%`
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : '')).join('\n') : '')
const linesOf = (s: string) => (s ? s.split('\n').length : 0)
// a command's head: its first word, and its second unless that's a flag or a path (npm test, git status, pytest); cd …
// && and VAR=value before it skipped
export function cmdHead(cmd: string) {
  const last = cmd.split(/&&|;|\|\|/).map(s => s.trim()).filter(s => s && !/^cd\s/.test(s))[0] ?? cmd.trim()
  const w = last.split(/\s+/).filter(x => !/^\w+=/.test(x))
  return (w[1] && !/^[-./~'"$]/.test(w[1]) ? `${w[0]} ${w[1]}` : w[0] ?? '').slice(0, 60)
}
// a shell command that only reads a file (codex reads files this way): the file
const READS = /^(?:cat|nl -ba|head(?: -n \d+)?|tail(?: -n \d+)?|sed -n ['"]?[\d,]+p['"]?)\s+(['"]?)([^\s'"|;&]+)\1\s*$/

// a transcript's line, the fields read here (claude's: type, message; codex's: type, payload)
type Line = {
  type?: string
  isMeta?: boolean
  isSidechain?: boolean
  message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, number> }
  payload?: { type?: string; role?: string; name?: string; call_id?: string; arguments?: unknown; input?: unknown; output?: unknown; content?: unknown; summary?: unknown; message?: unknown; info?: { total_token_usage?: Record<string, number> } }
}
// claude's and codex's JSONL as entries (root: the worktree, for paths as from its folder)
export function spendEntries(agent: string, jsonl: string, root?: string): SpendEntry[] {
  const out: SpendEntry[] = []
  const calls = new Map<string, { name: string; input: unknown }>()
  let total: Record<string, number> | undefined // codex's running totals
  const result = (name: string, args: unknown, body: string): SpendEntry => {
    const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const chars = body.length
    if (name === 'Read' || name === 'NotebookRead') return { kind: 'tool', source: 'file', key: nearPath(String(input.file_path ?? input.notebook_path ?? '?'), root), chars }
    if (name === 'Bash' || name === 'BashOutput' || name === 'shell' || name === 'exec_command') {
      const cmd = Array.isArray(input.command) ? String(input.command.at(-1) ?? '') : String(input.command ?? input.cmd ?? '')
      const r = READS.exec(cmd.trim())
      if (r) return { kind: 'tool', source: 'file', key: nearPath(r[2], root), chars }
      if (/^(rg|grep|find|ls|fd|ag)\b/.test(cmd.trim())) return { kind: 'tool', source: 'search', key: cmdHead(cmd), chars }
      return { kind: 'tool', source: 'command', key: cmdHead(cmd) || name, chars, lines: linesOf(body) }
    }
    if (/^(Grep|Glob|LS|WebSearch|WebFetch|ToolSearch)$/.test(name)) return { kind: 'tool', source: 'search', key: name, chars }
    const mcp = /^mcp__(.+?)__/.exec(name)
    if (mcp) return { kind: 'tool', source: 'mcp', key: mcp[1], chars }
    return { kind: 'tool', source: 'other', key: name === 'Task' || name === 'Agent' ? 'subagents' : name, chars }
  }
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let j: Line
    try {
      j = JSON.parse(line) as Line
    } catch {
      continue
    }
    if (agent === 'claude') {
      const c = j.message?.content
      if (j.type === 'user' && !j.isMeta) {
        if (typeof c === 'string' || (Array.isArray(c) && c.every((b: { type?: unknown }) => b?.type === 'text'))) {
          if (!j.isSidechain) out.push({ kind: 'user', chars: text(c).length })
        } else if (Array.isArray(c))
          for (const b of c)
            if (b?.type === 'tool_result') {
              const call = calls.get(b.tool_use_id)
              out.push(result(call?.name ?? '?', call?.input, text(b.content)))
            }
      } else if (j.type === 'assistant' && j.message) {
        for (const b of Array.isArray(c) ? c : []) {
          if (b?.type === 'text') out.push({ kind: 'out', what: 'messages', chars: String(b.text ?? '').length })
          else if (b?.type === 'thinking') out.push({ kind: 'out', what: 'thinking', chars: String(b.thinking ?? '').length })
          else if (b?.type === 'tool_use') {
            calls.set(b.id, { name: String(b.name), input: b.input })
            out.push({ kind: 'out', what: /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) ? 'edits' : 'tools', chars: JSON.stringify(b.input ?? {}).length })
          }
        }
        const u = j.message.usage
        if (u && j.message.model !== '<synthetic>') out.push({ kind: 'request', id: j.message.id, input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), output: n(u.output_tokens) })
      }
    } else if (agent === 'codex') {
      const p = j.payload
      if (j.type === 'event_msg' && p?.type === 'user_message') out.push({ kind: 'user', chars: String(p.message ?? '').length })
      else if (p?.type === 'function_call' || p?.type === 'custom_tool_call') {
        let input: unknown = p.input
        try {
          input = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments ?? p.input
        } catch {}
        calls.set(String(p.call_id), { name: String(p.name), input })
        const cmd = (input as { command?: unknown } | undefined)?.command
        const patch = p.name === 'apply_patch' || (Array.isArray(cmd) && cmd[0] === 'apply_patch')
        out.push({ kind: 'out', what: patch ? 'edits' : 'tools', chars: String(p.arguments ?? p.input ?? '').length })
      } else if (p?.type === 'function_call_output' || p?.type === 'custom_tool_call_output') {
        const call = calls.get(String(p.call_id))
        let body = typeof p.output === 'string' ? p.output : text((p.output as { content?: unknown } | undefined)?.content ?? p.output)
        try {
          const o = JSON.parse(body)
          if (typeof o?.output === 'string') body = o.output
        } catch {}
        if (call?.name !== 'apply_patch') out.push(result(call?.name ?? '?', call?.input, body))
      } else if (p?.type === 'message' && p.role === 'assistant') out.push({ kind: 'out', what: 'messages', chars: text(p.content).length })
      else if (p?.type === 'reasoning') out.push({ kind: 'out', what: 'thinking', chars: text(p.summary).length })
      else if (j.type === 'event_msg' && p?.type === 'token_count' && p.info?.total_token_usage) {
        const all = p.info.total_token_usage
        const was = total && n(all.total_tokens) >= n(total.total_tokens) ? total : {}
        const d = (k: string) => n(all[k]) - n(was[k])
        total = all
        if (d('total_tokens')) out.push({ kind: 'request', id: JSON.stringify(p), input: d('input_tokens'), output: d('total_tokens') - d('input_tokens') }) // as the meter counts it; its id its totals and limits: a spawned thread's copy of its parent's counts once (meters.ts wsSpend reads them together)
      }
    }
  }
  return out
}

const SHOWN = 8 // files and commands named one by one; the rest as one line each
export function spendBreakdown(entries: SpendEntry[]): Spend {
  // requests: an id's last usage counts (claude writes one per block, each with the usage so far)
  const reqs: { input: number; output: number; turn: number }[] = []
  const byId = new Map<string, number>()
  const users: number[] = [] // each turn's message, in tokens
  const firstReq: (number | undefined)[] = [] // each turn's first request
  const content = new Map<string, { kind: SpendSource; label: string; chars: number; reads: number; lines: number }>()
  const outChars = { edits: 0, messages: 0, thinking: 0, tools: 0 }
  const put = (kind: SpendSource, label: string, chars: number, lines = 0) => {
    const k = `${kind}\0${label}`
    const c = content.get(k) ?? (content.set(k, { kind, label, chars: 0, reads: 0, lines: 0 }), content.get(k)!)
    ;(c.chars += chars), c.reads++, (c.lines += lines)
  }
  for (const e of entries) {
    if (e.kind === 'user') users.push(tok(e.chars)), firstReq.push(undefined), put('user', 'your messages', e.chars)
    else if (e.kind === 'tool') put(e.source, e.key, e.chars, e.lines ?? 0)
    else if (e.kind === 'out') outChars[e.what] += e.chars
    else {
      const turn = Math.max(0, users.length - 1)
      const at = e.id ? byId.get(e.id) : undefined
      if (at !== undefined) reqs[at] = { ...reqs[at], input: e.input, output: e.output }
      else {
        if (e.id) byId.set(e.id, reqs.length)
        if (users.length && firstReq[turn] === undefined) firstReq[turn] = reqs.length
        reqs.push({ input: e.input, output: e.output, turn })
      }
    }
  }
  const exact = reqs.length > 0
  const sizes = [...content.values()]
  const sizeTotal = sizes.reduce((s, c) => s + c.chars, 0)
  let inTotal = exact ? reqs.reduce((s, r) => s + r.input, 0) : tok(sizeTotal)
  const outTotal = exact ? reqs.reduce((s, r) => s + r.output, 0) : tok(Object.values(outChars).reduce((a, b) => a + b, 0))
  const parts: SpendPart[] = []
  let rest = inTotal
  if (exact && users.length) {
    // the system prompt and rules: the first turn's first request less its message, in every request; the conversation
    // carried into each later turn: its first request less its message and the system prompt, in each of its requests
    const first = firstReq[0] !== undefined ? reqs[firstReq[0]!].input : 0
    const sys = Math.max(0, first - users[0])
    const system = Math.min(rest, sys * reqs.length)
    rest -= system
    let carried = 0
    for (let t = 1; t < users.length; t++) {
      const i = firstReq[t]
      if (i === undefined) continue
      const history = Math.max(0, reqs[i].input - users[t] - sys)
      carried += history * reqs.filter(r => r.turn === t).length
    }
    carried = Math.min(rest, carried)
    rest -= carried
    if (system) parts.push({ kind: 'system', label: 'system prompt and rules', tokens: system, share: 0 })
    if (carried) parts.push({ kind: 'carried', label: 'conversation carried into each turn', tokens: carried, share: 0 })
  }
  // the rest spread over what entered the context, by size
  for (const c of sizes) parts.push({ kind: c.kind, label: c.label, tokens: sizeTotal ? Math.round((rest * c.chars) / sizeTotal) : 0, share: 0, ...(c.kind === 'file' && { reads: c.reads }), ...(c.kind === 'command' && { reads: c.reads, lines: Math.round(c.lines / Math.max(1, c.reads)) }) })
  if (!sizeTotal && rest > 0) parts.push({ kind: 'other', label: 'other', tokens: rest, share: 0 })
  if (!exact) inTotal = parts.reduce((s, p) => s + p.tokens, 0)
  // the biggest files and commands one by one, the rest folded
  const fold = (kind: SpendSource, label: string) => {
    const mine = parts.filter(p => p.kind === kind).sort((a, b) => b.tokens - a.tokens)
    const tail = mine.slice(SHOWN)
    if (tail.length < 2) return
    for (const p of tail) parts.splice(parts.indexOf(p), 1)
    parts.push({ kind, label: `${tail.length} ${label}`, tokens: tail.reduce((s, p) => s + p.tokens, 0), share: 0, ...(kind === 'file' && { reads: tail.reduce((s, p) => s + (p.reads ?? 0), 0) }) })
  }
  fold('file', 'other files')
  fold('command', 'other commands')
  for (const p of parts) p.share = inTotal ? p.tokens / inTotal : 0
  parts.sort((a, b) => b.tokens - a.tokens)
  const outSum = Object.values(outChars).reduce((a, b) => a + b, 0)
  const outParts = (Object.keys(outChars) as (keyof typeof outChars)[]).filter(k => outChars[k] > 0 || (!outSum && k === 'messages' && outTotal > 0)).map(kind => ({ kind, tokens: outSum ? Math.round((outTotal * outChars[kind]) / outSum) : outTotal, share: outSum ? outChars[kind] / outSum : 1 }))
  // hints, each from a fixed rule with its number; none when nothing crosses its line
  const hints: string[] = []
  const files = parts.filter(p => p.kind === 'file' && !/^\d+ other files$/.test(p.label))
  const fileTokens = parts.filter(p => p.kind === 'file').reduce((s, p) => s + p.tokens, 0)
  const reread = files.filter(p => (p.reads ?? 0) >= 3 && fileTokens && p.tokens / fileTokens > 0.15).sort((a, b) => b.tokens - a.tokens)[0]
  if (reread) hints.push(`${reread.label} was read ${reread.reads} times, ${pct(reread.tokens / fileTokens)} of file reads: consider excluding it in the project rules or asking for line ranges`)
  const loud = parts.filter(p => p.kind === 'command' && !/^\d+ other commands$/.test(p.label) && p.share > 0.25).sort((a, b) => b.tokens - a.tokens)[0]
  if (loud) hints.push(`${loud.label} printed ${(loud.lines ?? 0).toLocaleString('en-US')} lines each run, ${pct(loud.share)} of the input: use a quieter reporter`)
  const carried = parts.find(p => p.kind === 'carried')
  if (carried && carried.share > 0.5 && users.length >= 6) hints.push(`The conversation carried into each turn is ${pct(carried.share)} of the input over ${users.length} turns: compact earlier`)
  return { estimate: true, exact, turns: users.length, input: { total: inTotal, parts }, output: { total: outTotal, parts: outParts }, hints: hints.slice(0, 3) }
}
