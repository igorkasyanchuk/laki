// an extension's tools for agents and the asks before they run: grants (Always), an AI source's permission asks.
// widgets.ts re-exports it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { actionCmd, aiActOf, toolArgs, toolOf, toolSchema } from '../shared/widgetSchema.ts'
import { type WidgetSource } from '../shared/types.ts'
import { agents, type Entry, find, inProj, type Manifest, OFF, onOf, projName, readStore, scoped, sourceOf, widgetAction, widgets, wLog, writeStore, wsOf } from './widgets.ts'
import { filesHash } from './widgetTrust.ts'
import { broadcast, changed, clients, devLog, save, state } from './core.ts'

// ---------- tools (an action's tool, shared/widgetSchema.ts toolOf): agents call them (laki widget tool, MCP's
// laki_extension_call and ext_<id>_<action>, Laki AI). Only an extension that's on has them; a scope workspace one's
// runs in the caller's workspace. Before it runs, the input is checked (toolArgs), then the user asked in the app as its
// tool says: always, first (once per workspace, Always kept in state.widgetGrants) or never; no window: refused, no
// answer in LAKI_TOOL_WAIT (2 minutes): refused. Its stdout goes back (16 KB), with stderr's last line on a failure
const TOOL_OUT = 16 << 10
const toolWait = () => Number(process.env.LAKI_TOOL_WAIT) || 120_000
const asking = new Map<string, (allow: string) => void>()
export const toolsOf = (w: Entry) => Object.entries(w.m.actions ?? {}).flatMap(([a, x]) => (t => (t ? [[a, t] as const] : []))(toolOf(x)))
export const cmdsOf = (w?: Entry) => JSON.stringify(Object.entries(w?.m.actions ?? {}).map(([a, x]) => [a, actionCmd(x)]))
const agentsOf = (w: Entry) => {
  if (w.file) return undefined
  try {
    return readFileSync(join(w.dir, 'AGENTS.md'), 'utf8').slice(0, 4096).trim() || undefined
  } catch {
    return undefined
  }
}
// an Always's key: id.action#hash, the hash over the action's command and filesHash
export function grantKey(w: Entry, action: string, fresh = false) {
  return `${w.id}.${action}#${createHash('sha256').update(`${actionCmd(w.m.actions?.[action]) ?? ''}\0${filesHash(w, fresh)}`).digest('hex').slice(0, 12)}`
}
// an extension's grants gone: off, its commands changed, Revoke (one action)
export function ungrant(id: string, action?: string, ws?: string) {
  const g = state.widgetGrants
  if (!g) return
  let n = 0
  for (const k of Object.keys(g)) {
    if (ws !== undefined && k !== ws) continue
    const keep = g[k].filter(x => !x.startsWith(action ? `${id}.${action}#` : `${id}.`))
    n += g[k].length - keep.length
    if (keep.length) g[k] = keep
    else delete g[k]
  }
  if (n) save(), changed()
}
export const widgetGrantRm = (o: { id: string; action: string; ws: string }) => (ungrant(find(o.id).id, String(o.action), String(o.ws ?? '')), { ok: true })
// each tool of the extensions that are on: its name (id.action), what it does, its input as a JSON Schema, the
// extension's AGENTS.md (when to use them)
export function widgetTools(o: { ws?: unknown } = {}) {
  const x = typeof o.ws === 'string' ? state.workspaces.find(v => v.id === o.ws) : undefined // a repo's only in its project's workspaces
  return [...widgets.values()].filter(w => onOf(w) && inProj(w, x)).flatMap(w => toolsOf(w).map(([action, t]) => ({ tool: `${w.id}.${action}`, id: w.id, action, name: w.m.name || w.id, description: t.description, input: toolSchema(t), ask: t.ask, ...(scoped(w) && { scope: 'workspace' }), ...(a => a && { agents: a })(agentsOf(w)) })))
}
export async function widgetToolCall(o: { id: string; action: string; input?: unknown; from?: { ws?: string; tab?: string; agent?: string } }): Promise<{ ok: boolean; output: string; error?: string }> {
  const w = find(String(o.id))
  if (!onOf(w)) throw new Error(OFF(w))
  const a = w.m.actions && Object.hasOwn(w.m.actions, o.action) ? w.m.actions[o.action] : undefined
  const t = toolOf(a)
  if (!t) throw new Error(`${w.m.name || w.id} has no tool ${o.action}`)
  const input = toolArgs(t, o.input)
  const from = o.from ?? {}
  if (!inProj(w, state.workspaces.find(v => v.id === from.ws))) throw new Error(`${w.m.name || w.id} is ${projName(w)}'s: its tools are for that project's workspaces`)
  const x = wsOf(w, scoped(w) ? from.ws : undefined) // a scope workspace one's: the caller's, refused without one
  const ws = x?.id ?? (state.workspaces.some(v => v.id === from.ws) ? from.ws! : '') // whose Always: '' for none (Laki AI)
  const tab = from.tab ? state.tabs.find(v => v.id === from.tab) : undefined
  const key = grantKey(w, o.action, true) // before the ask: approve refuses a change since, so Always is for what was shown
  let how = t.ask === 'never' ? 'never' : 'always' // 'always': granted before
  if (t.ask === 'always' || (t.ask === 'first' && !state.widgetGrants?.[ws]?.includes(key))) {
    how = await approve(w, o.action, { description: t.description, ask: t.ask, input, ws, tab: tab?.id ?? from.tab, agent: from.agent ?? tab?.name })
    if (how === 'always' && t.ask === 'first') grant(w, o.action, ws, key)
  }
  const env = Object.fromEntries(Object.entries(input).map(([k, v]) => [`WIDGET_INPUT_${k.toUpperCase()}`, Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? '1' : '') : String(v ?? '')]))
  const why = `${ws || 'no workspace'}${from.tab ? `/${from.tab}` : ''}${from.agent ? ` (${from.agent})` : ''}, allowed ${how}`
  if (ws) devLog(`ws:${ws}`, `${w.m.name || w.id}: tool ${o.action} (${why})`)
  const r = await widgetAction({ id: w.id, action: o.action, arg: JSON.stringify(input), ws: x?.id }, `tool:${o.action}`, { env, stdin: JSON.stringify(input), why, full: true })
  if (r.ok && (r.toast || r.modal || r.close)) broadcast({ ev: 'widget-say', widget: w.id, ws: x?.id, toast: r.toast, modal: r.modal, close: r.close })
  const output = (r.stdout ?? '').slice(0, TOOL_OUT)
  return r.ok ? { ok: true, output } : { ok: false, output, error: r.error }
}
// the workspaces with an Always for it (none given: no hash made)
export const grantsOf = (w: Entry, action: string) => !Object.values(state.widgetGrants ?? {}).some(l => l.some(k => k.startsWith(`${w.id}.${action}#`))) ? [] : (k => Object.keys(state.widgetGrants ?? {}).filter(ws => state.widgetGrants![ws].includes(k)))(grantKey(w, action))
// an Always: that action as it is (key: grantKey) in that workspace ('' none); one made for its older files goes
export function grant(w: Entry, action: string, ws: string, key: string) {
  const g = (state.widgetGrants ??= {})
  g[ws] = [...(g[ws] ?? []).filter(k => !k.startsWith(`${w.id}.${action}#`)), key]
  save()
  changed()
}
// the user's answer in the app (toolAsk: its dialog and a notification): once, always (a tool that asks first) or deny.
// Refused with no window, no answer in LAKI_TOOL_WAIT, a deny, or the action changed meanwhile (a dev save, a reload):
// only what the user saw runs
export async function approve(w: Entry, action: string, o: { description: string; ask: string; input?: unknown; ws?: string; tab?: string; agent?: string }) {
  if (!clients.size) throw new Error("Laki's window isn't open: nobody to approve it")
  const def = w.m.actions?.[action]
  const ai = aiActOf(def)
  const req = randomBytes(8).toString('hex')
  const hash = filesHash(w, true) // what the user is shown: its files as they are now
  const how = await answered({ ev: 'toolAsk', req, widget: w.id, action, name: w.m.name || w.id, ...o, command: actionCmd(def) ?? `an agent answers: ${ai?.prompt ?? ''}`, ws: o.ws || undefined, hash })
  if (how === 'none') throw new Error(`${w.m.name || w.id} ${action}: no answer: not run`)
  if (how === 'deny') throw new Error(`${w.m.name || w.id} ${action}: denied`)
  const now = widgets.get(w.id)
  if (!now || filesHash(now, true) !== hash) throw new Error(`${w.m.name || w.id} ${action}: its files changed while you were asked: not run`)
  return how
}
// an ask sent to the app's windows (and to each one that connects while it waits: widgetAsks), the first answer
// (widgetToolAnswer), 'none' past LAKI_TOOL_WAIT; then the other windows' dialogs close
const asks = new Map<string, { ev: string; req: string }>()
export async function answered(msg: { ev: string; req: string; [k: string]: unknown }) {
  const { req } = msg
  asks.set(req, msg)
  broadcast(msg)
  const how = await new Promise<string>(ok => {
    const timer = setTimeout(() => (asking.delete(req), ok('none')), toolWait())
    asking.set(req, allow => (clearTimeout(timer), asking.delete(req), ok(allow)))
  })
  asks.delete(req)
  broadcast({ ev: 'toolDone', req })
  return how
}
export const widgetAsks = (c: { send: (m: unknown) => void }) => asks.forEach(m => c.send(m)) // a window that opened (or came back) meanwhile
// an AI source's or action's claude asking for a tool it may not use unasked (aiOnce's --permission-prompt-tool: laki
// mcp's laki_permission, LAKI_PERM_EXT): asked in the app as a tool call is (toolAsk with perm) and as a notification.
// Always: that tool unasked in its runs from now on (the store's allow; its page lists them, Revoke). Nobody there, no
// answer or a deny: it goes on without it
// #6: only while one of its agent runs is going (agentRun): anyone could run LAKI_PERM_EXT=<id> laki mcp and ask in its
// name. ponytail: a run's own ask isn't told from another's made meanwhile; a token per run would
export async function widgetPermission(p: { ext?: unknown; tool?: unknown; input?: unknown }): Promise<{ allow: boolean; message?: string }> {
  const w = find(String(p.ext ?? ''))
  const tool = String(p.tool ?? '')
  if (!TOOL_NAME.test(tool)) throw new Error('a tool’s name') // it goes into --allowedTools: never an option, nor two names
  if (!agents.get(w.id)?.size) {
    wLog(w, `an ask for ${tool} in its name refused: no agent of its is running`, 'warn')
    throw new Error(`${w.m.name || w.id} has no agent running now: only its own run asks for a tool`)
  }
  if (allowOf(w)?.includes(tool)) return { allow: true }
  if (!clients.size) return { allow: false, message: "Laki's window isn't open, so nobody could allow it: do without it, and say so." }
  const how = await answered({ ev: 'toolAsk', req: randomBytes(8).toString('hex'), widget: w.id, name: w.m.name || w.id, perm: tool, input: p.input ?? {}, ask: 'first' })
  wLog(w, `its agent asked for ${tool}: ${how === 'none' ? 'no answer' : how}`)
  if (how === 'always') {
    const s = readStore(w.id)
    s.allow = [...new Set([...(allowOf(w) ?? []), tool])]
    s.allowFor = aiKey(w.m, sourceOf(w))
    writeStore(w.id, s)
    const cur = widgets.get(w.id)
    if (cur) cur.s = { ...cur.s, allow: s.allow }
    changed()
  }
  return how === 'once' || how === 'always' ? { allow: true } : { allow: false, message: how === 'deny' ? 'The user said no: do without it, and say so.' : 'No one answered: do without it, and say so.' }
}
export const TOOL_NAME = /^\w[\w.-]{0,199}$/ // claude's: Bash, WebFetch, mcp__claude_ai_Slack__slack_read_channel
// the tools an AI source's or action's agent may use unasked: widget.json's (or the source's) and the ones allowed since
// #8: the settings its source (an AI prompt, a file's path, a URL) and its AI actions' prompts read ({{config.x}}): an
// agent changing one would steer what runs with your allowed tools, or what's read
export const steering = (w: Entry) => new Set([...JSON.stringify([sourceOf(w), Object.values(w.m.actions ?? {}).map(a => aiActOf(a))]).matchAll(/\{\{[^}]*?\bconfig\.([A-Za-z_]\w*)/g)].map(m => m[1]))
export const allowedOf = (w: Entry, tools?: string) => [tools, ...(allowOf(w) ?? [])].filter(Boolean).join(',') || undefined
// #6: an Always is for the prompts it was given under: a hash of the AI source's prompt and tools and each AI action's
// (allowFor); once they change (widgetSet source, widget.json read again at a scan) its tools go, asked again
export const aiKey = (m: Manifest, src: WidgetSource) => createHash('sha256').update(JSON.stringify([src.kind === 'ai' ? [src.prompt, src.tools ?? ''] : null, Object.entries(m.actions ?? {}).flatMap(([k, a]) => (x => (x ? [[k, x.prompt, x.tools ?? '']] : []))(aiActOf(a)))])).digest('hex').slice(0, 16)
export function allowOf(w: Entry) {
  const s = readStore(w.id)
  if (!s.allow || s.allowFor === aiKey(w.m, sourceOf(w))) return s.allow
  delete s.allow
  delete s.allowFor
  writeStore(w.id, s)
  w.s = { ...w.s, allow: undefined, allowFor: undefined }
  wLog(w, 'its prompts changed: the tools its agent was allowed go (asked again)', 'warn')
}
// the app's answer (its dialog, a notification's button): once, always, or deny
export function widgetToolAnswer(o: { req: string; allow: string }) {
  const f = asking.get(String(o.req))
  if (!f) return { ok: false } // answered elsewhere, or timed out
  f(['once', 'always', 'deny'].includes(o.allow) ? o.allow : 'deny')
  return { ok: true }
}
