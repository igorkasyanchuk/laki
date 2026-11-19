// What a daemon can do, by name (docs/rpc-namespaces.md): its namespaced methods (`note.list`…) and the behaviors the
// renderer gates on. A daemon without caps (before API 150) is judged by its API number, CAP_SINCE's
import type { View } from './types.ts'

// a namespaced name → the flat one the daemon's api table keeps (and every check keyed by a method's name). The daemon
// resolves it first thing in call(), so an alias passes the same checks as its old name
export const RPC_NAMES = {
  'note.list': 'noteList',
  'note.get': 'noteGet',
  'note.new': 'noteNew',
  'note.save': 'noteSave',
  'note.rm': 'noteRm',
  'note.restore': 'noteRestore',
  'note.upload': 'noteUpload',
  'note.file': 'noteFile',
} as const satisfies Record<string, string>
export const oldName = (method: string): string => (Object.hasOwn(RPC_NAMES, method) ? (RPC_NAMES as Record<string, string>)[method] : method)
// the name a client with a view sends: the namespaced one when the daemon's caps list its namespace, else the old one
// (an older daemon, or none read yet)
export const sendAs = (method: string, caps: readonly string[]) => (caps.includes(`ns:${method.split('.')[0]}`) ? method : oldName(method))

// the behaviors the renderer asks about, and the API number each came with: what an older daemon is judged by
export const CAP_SINCE: Record<string, number> = { 'term.shell': 210, 'prompt.questions': 209, 'project.mcp': 208, 'answer.say': 207, 'schedule.after': 204, 'goals.own': 205, 'git.tidy': 206, 'always.ask': 201, backup: 200, goals: 199, signin: 199, 'cursor.models': 199, 'kept.artifacts': 199, uninstall: 199, 'skills.loaded': 199, 'agent.versions': 199, 'secret.keep': 198, 'ws.spend': 197, 'archive.dirty': 12, layouts: 60, 'ws.peek': 94, 'project.terminal': 107, 'hooks.seen': 146, sample: 160, 'ship.sheet': 161, 'pr.revert': 179, 'diff.since': 179, 'merge.queue': 180, 'chat.search': 181, 'agent.log': 183, 'touch.id': 184, 'note.restore': 185, 'disk.usage': 186, 'widget.term': 187, 'widget.ui': 188, 'widget.order': 189, 'widget.store': 190, 'kit.term': 191 }
// this build's: each one above, and ns:<namespace> for each namespace RPC_NAMES has
export const CAPS = [...Object.keys(CAP_SINCE), ...new Set(Object.keys(RPC_NAMES).map(m => `ns:${m.split('.')[0]}`))]

export const hasCap = (v: Pick<View, 'api' | 'caps'> | null | undefined, cap: string) => (v?.caps ? v.caps.includes(cap) : (v?.api ?? 0) >= (CAP_SINCE[cap] ?? Infinity))
