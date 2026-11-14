// ACP tabs (Labs): an agent spoken to over the Agent Client Protocol, v1 (agentclientprotocol.com: protocolVersion 1),
// newline-delimited JSON-RPC 2.0 on its stdio instead of a terminal. A profile with acp: true starts its command with
// pipes; its tab's Session gets an AcpPty for a pty, so Laki's own paths work as for every agent:
//   - what's typed (send, the Reader's box, a queue's delivery) is a prompt: Enter sends session/prompt
//   - Esc or ⌃C (Stop) is session/cancel; an ask's arrows and Enter (core's answer, auto-answer rules) pick a
//     session/request_permission option, drawn as a numbered menu askOf reads off the mirror
//   - what the agent says goes to the mirror as plain text and to the Reader (acpChat: chatRead's shapes), its plan to
//     the live plan, and core hears hooks: running as a prompt starts, waiting with a PermissionRequest, Stop as the
//     prompt's answer comes (turn ends: Done check, kept turns), interrupted when it was cancelled
// Client capabilities: none (no fs, no terminal), so the agent uses its own tools; an agent request is -32601.
// ponytail: one session per start (no session/load: a restart starts a new chat); no auth methods run (sign in with the
// agent itself first); Laki's permission modes and sandbox flags aren't applied to it
import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Pty, PtyOpts } from './session.ts'
import type { Said } from './share.ts'
import type { PlanItem } from '../shared/todos.ts'
import { changed, hook, rtOf, state } from './core.ts'
import { toolGate } from './widgetEvents.ts'

export const ACP_VERSION = 1
// no fs, no terminal, said outright: the schema's defaults (gemini 0.4's ACP refuses an initialize without fs)
const NONE = { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
const SAID_MAX = 400
type Option = { optionId: string; name: string; kind?: string }
// what Laki reads of the protocol's messages (the rest it passes over)
type ToolCall = { toolCallId?: string; title?: string; kind?: string; status?: string; rawInput?: unknown }
type Update = ToolCall & { sessionUpdate?: string; content?: { type?: string; text?: string }; entries?: { content?: string; status?: string }[] }
type Params = { update?: Update; toolCall?: ToolCall; options?: Partial<Option>[] }
type Result = { protocolVersion?: number; agentInfo?: { name?: string; title?: string }; authMethods?: { id?: string; name?: string }[]; sessionId?: string; stopReason?: string }
type Msg = { jsonrpc?: string; id?: number | string; method?: string; params?: Params; result?: unknown; error?: { code: number; message: string } }

const chats = new Map<string, { said: Said[]; v: number }>() // by tab: the Reader's (its last start's)
// the Reader's chat of an ACP tab (meters.ts chatRead); none: not one
export const acpChat = (tab: string) => chats.get(tab)

// a permission's tool as Laki's rules and asks name it (Bash, Edit…: permOf, a project's auto-answer rules)
const TOOLS: Record<string, string> = { execute: 'Bash', edit: 'Edit', delete: 'Edit', move: 'Edit', read: 'Read', search: 'Grep', fetch: 'WebFetch' }

export class AcpPty implements Pty {
  pid: number
  private child: ChildProcess
  private outs = new Set<(d: string) => void>()
  private exits = new Set<(e: { exitCode: number; signal?: number }) => void>()
  private n = 0
  private waits = new Map<number, { ok: (v: Result | undefined) => void; fail: (e: Error) => void }>()
  private session?: string
  private typed = ''
  private ask?: { id: number | string; options: Option[]; at: number }
  private busy = false
  private next: string[] = [] // typed while a prompt runs: after it
  private chat = { said: [] as Said[], v: 0 }
  private err = '' // its stderr's end: said if it ends badly

  private tab: string
  private first?: string // its start's prompt
  constructor(tab: string, o: PtyOpts, first?: string) {
    this.tab = tab
    this.first = first
    chats.set(tab, this.chat)
    this.child = spawn(o.file, o.args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    this.pid = this.child.pid ?? 0
    createInterface({ input: this.child.stdout! }).on('line', l => this.line(l))
    this.child.stderr!.on('data', (d: Buffer) => (this.err = (this.err + d.toString()).slice(-2000)))
    this.child.stdin!.on('error', () => {}) // it ended: what's written after goes nowhere
    this.child.on('error', e => this.print(`\r\n${e.message}\r\n`))
    this.child.on('exit', (code, sig) => {
      for (const w of this.waits.values()) w.fail(new Error('it ended'))
      this.waits.clear()
      if (code) this.print(`\r\n${this.err.trim().split('\n').slice(-5).join('\r\n')}\r\n`)
      for (const f of this.exits) f({ exitCode: code ?? 0, ...(sig && { signal: 15 }) })
    })
    setImmediate(() => void this.start()) // the Session listens first
  }

  onData(f: (d: string) => void) {
    this.outs.add(f)
  }
  onExit(f: (e: { exitCode: number; signal?: number }) => void) {
    this.exits.add(f)
  }
  resize() {}
  kill(signal = 'SIGTERM') {
    this.child.stdin!.end()
    this.child.kill(signal as NodeJS.Signals)
  }
  group(signal: string) {
    try {
      process.kill(-this.pid, signal)
    } catch {}
  }

  // keys: Esc or ⌃C cancel; an ask's ↑ ↓ (or a digit) and Enter; else a line typed, Enter sends it
  write(d: string) {
    if (d === '\x1b' || d === '\x03') return this.cancel()
    if (this.ask) {
      const a = this.ask
      if (/^\x1b[[O]A$/.test(d)) a.at = Math.max(0, a.at - 1)
      else if (/^\x1b[[O]B$/.test(d)) a.at = Math.min(a.options.length - 1, a.at + 1)
      else if (/^[1-9]$/.test(d) && Number(d) <= a.options.length) return this.pick(Number(d) - 1)
      else if (d.includes('\r')) return this.pick(a.at)
      return this.print(`\x1b8\x1b[J${this.menu()}`)
    }
    for (const c of d.replace(/\x1b\[20[01]~/g, '')) {
      if (c === '\r' || c === '\n') {
        const t = this.typed
        this.typed = ''
        if (t.trim()) this.prompt(t)
      } else if (c === '\x7f') this.typed = this.typed.slice(0, -1)
      else if (c >= ' ' || c === '\t') this.typed += c
    }
  }

  private print(s: string) {
    for (const f of this.outs) f(s)
  }
  private send(m: Omit<Msg, 'params'> & { params?: unknown }) {
    if (this.child.stdin!.writable) this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  }
  private call(method: string, params: unknown): Promise<Result | undefined> {
    const id = ++this.n
    return new Promise((ok, fail) => (this.waits.set(id, { ok, fail }), this.send({ id, method, params })))
  }
  private said(who: Said['who'], text: string, join = false) {
    const last = this.chat.said.at(-1)
    if (join && last?.who === who) last.text += text
    else this.chat.said = [...this.chat.said, { who, text, at: Date.now() }].slice(-SAID_MAX)
    this.chat.v++
  }

  private async start() {
    try {
      const init = await this.call('initialize', { protocolVersion: ACP_VERSION, clientCapabilities: NONE, clientInfo: { name: 'laki', title: 'Laki', version: '1' } })
      if (init?.protocolVersion !== ACP_VERSION) throw new Error(`it speaks ACP ${init?.protocolVersion ?? '?'}; Laki speaks ${ACP_VERSION}`)
      const s = await this.call('session/new', { cwd: (state.workspaces.find(w => w.id === state.tabs.find(t => t.id === this.tab)?.workspace)?.path ?? process.cwd()), mcpServers: [] }).catch((e: Error & { code?: number }) => {
        throw e.code === -32000 ? new Error(`it needs a sign-in (${(init?.authMethods ?? []).map(m => m.name ?? m.id).join(', ') || 'its own'}): sign in with the agent itself, then start the tab again`) : e
      })
      this.session = String(s?.sessionId ?? '')
      if (!this.session) throw new Error('no session')
      const who = init.agentInfo?.title ?? init.agentInfo?.name
      this.print(`\x1b[2m${who ? `${who}, ` : ''}ACP ${ACP_VERSION}: ready\x1b[0m\r\n`)
      if (this.first?.trim()) this.prompt(this.first)
    } catch (e) {
      this.print(`\r\n${(e as Error).message}\r\n`)
      rtOf(this.tab).status = 'idle' // no turn to end: it never started
      changed()
    }
  }

  private line(l: string) {
    let m: Msg
    try {
      m = JSON.parse(l)
    } catch {
      return void (l.trim() && this.print(`${l}\r\n`)) // not ACP: shown as it is
    }
    if (m.id !== undefined && !m.method) {
      const w = this.waits.get(Number(m.id))
      this.waits.delete(Number(m.id))
      if (m.error) w?.fail(Object.assign(new Error(m.error.message), { code: m.error.code }))
      else w?.ok(m.result && typeof m.result === 'object' ? (m.result as Result) : undefined)
      return
    }
    if (m.method === 'session/update') return this.update(m.params?.update ?? {})
    if (m.method === 'session/request_permission' && m.id !== undefined) return void this.permission(m.id, m.params ?? {})
    if (m.id !== undefined) this.send({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } }) // fs/*, terminal/*: not offered
  }

  private update(u: Update) {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const t = u.content?.type === 'text' ? String(u.content.text ?? '') : ''
        if (!t) return
        this.said('agent', t, true)
        return this.print(t.replace(/\r?\n/g, '\r\n'))
      }
      case 'tool_call': {
        const t = String(u.title ?? u.kind ?? 'a tool')
        this.said('tool', t)
        this.print(`\r\n• ${t}\r\n`)
        return hook({ tab: this.tab, state: 'running' })
      }
      case 'tool_call_update':
        if (u.status === 'failed') (l => l?.who === 'tool' && ((l.fail = (l.fail ?? 0) + 1), this.chat.v++))(this.chat.said.at(-1))
        return
      case 'plan': {
        // the live plan, whole each time (ACP's): pending, in_progress, completed
        const items = (Array.isArray(u.entries) ? u.entries : []).map(e => ({ text: String(e.content ?? '').slice(0, 300), state: (e.status === 'completed' ? 'done' : e.status === 'in_progress' ? 'now' : 'todo') as PlanItem['state'] }))
        rtOf(this.tab).plan = items.length ? { items } : undefined
        return changed()
      }
    }
  }

  // a permission: an extension's gate first (its no picks a reject option, said), then an ask like every agent's (the menu
  // on the mirror, a PermissionRequest hook: a project's auto-answer rule may take it)
  private async permission(id: number | string, p: Params) {
    const options: Option[] = (Array.isArray(p.options) ? p.options : []).flatMap(o => (o && typeof o.optionId === 'string' ? [{ optionId: o.optionId, name: String(o.name ?? o.optionId), kind: o.kind }] : []))
    const tc = p.toolCall ?? {}
    const tool = TOOLS[tc.kind ?? ''] ?? String(tc.title ?? 'a tool')
    const input = tc.rawInput && typeof tc.rawInput === 'object' ? tc.rawInput : { description: tc.title }
    if (!options.length) return this.send({ id, result: { outcome: { outcome: 'cancelled' } } })
    const tab = state.tabs.find(t => t.id === this.tab)
    const ws = state.workspaces.find(w => w.id === tab?.workspace)
    const gate = tab && ws ? await toolGate(ws, tab, tool, input).catch(() => undefined) : undefined
    if (gate?.deny) {
      const no = options.find(o => o.kind === 'reject_once') ?? options.find(o => o.kind?.startsWith('reject'))
      this.print(`\r\n${tc.title ?? tool}: refused: ${gate.deny}\r\n`)
      return this.send({ id, result: { outcome: no ? { outcome: 'selected', optionId: no.optionId } : { outcome: 'cancelled' } } })
    }
    this.ask = { id, options, at: 0 }
    this.print(`\r\n${tc.title ?? tool}\r\nAllow it?\r\n\x1b7${this.menu()}`)
    hook({ tab: this.tab, state: 'waiting', payload: { hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input } })
  }
  private menu() {
    const a = this.ask!
    return a.options.map((o, i) => `${i === a.at ? '❯' : ' '} ${i + 1}. ${o.name}`).join('\r\n') + '\r\n'
  }
  private pick(i: number) {
    const a = this.ask!
    this.ask = undefined
    this.send({ id: a.id, result: { outcome: { outcome: 'selected', optionId: a.options[i].optionId } } })
    this.print(`\x1b8\x1b[J→ ${a.options[i].name}\r\n`)
    hook({ tab: this.tab, state: 'running' }) // answered: its tool runs
  }

  private async prompt(text: string) {
    if (!this.session || this.busy) return void this.next.push(text)
    this.busy = true
    this.said('you', text)
    this.print(`\r\n› ${text.replace(/\r?\n/g, '\r\n  ')}\r\n`)
    hook({ tab: this.tab, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: text } })
    const from = this.chat.said.length
    let end: { state: string; payload: Record<string, unknown> }
    try {
      const r = await this.call('session/prompt', { sessionId: this.session, prompt: [{ type: 'text', text }] })
      const last = this.chat.said.slice(from).filter(s => s.who === 'agent').map(s => s.text).join('\n\n').trim()
      end = r?.stopReason === 'cancelled' ? { state: 'interrupted', payload: {} } : { state: r?.stopReason === 'refusal' ? 'failed' : 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: last, ...(r?.stopReason !== 'end_turn' && { error: `stopped: ${r?.stopReason}` }) } }
    } catch (e) {
      end = { state: 'failed', payload: { error: (e as Error).message } }
      this.print(`\r\n${(e as Error).message}\r\n`)
    }
    this.busy = false
    if (end.state === 'interrupted') this.print('\r\nInterrupted\r\n')
    this.print('\r\n')
    hook({ tab: this.tab, ...end })
    const more = this.next.shift()
    if (more !== undefined) void this.prompt(more)
  }

  // Stop: session/cancel, and its ask (if any) answered cancelled, as the protocol asks
  private cancel() {
    this.next = []
    if (!this.session || !this.busy) return
    if (this.ask) this.send({ id: this.ask.id, result: { outcome: { outcome: 'cancelled' } } }), (this.ask = undefined)
    this.send({ method: 'session/cancel', params: { sessionId: this.session } })
  }
}
