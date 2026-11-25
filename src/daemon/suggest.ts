// #5: laki suggest: an agent that notices work outside its task (a flaky test, a bug next door) suggests it instead of
// starting it: a card under its tab (its title, why, the prompt folded) with Start, Edit first and Dismiss, and a mark
// on its workspace's row. Nothing starts without you: Start makes a new workspace with its prompt in that project
// (wsNew, yours: no Created by), Edit first opens New workspace filled in (the card goes once that one's made), Dismiss
// drops it. Its agent may withdraw one you haven't answered, never one you have, nor suggest again what you dismissed.
// Workspace.suggests: what's open and what you answered (answered: kept to refuse it again), SUGGEST_MAX of each
import { randomBytes } from 'node:crypto'
import type { NewWs } from './core.ts'
import { agentTab, changed, findWs, save, state, wsLog, wsNew } from './core.ts'
import type { Suggestion, Workspace } from '../shared/types.ts'

export const SUGGEST_MAX = 10
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ')
const keep = (w: Workspace, list: Suggestion[]) => {
  const open = list.filter(s => !s.answered).slice(-SUGGEST_MAX)
  const done = list.filter(s => s.answered).slice(-SUGGEST_MAX)
  w.suggests = [...done, ...open].sort((a, b) => a.at - b.at)
  if (!w.suggests.length) delete w.suggests
  save()
  changed()
}

// an agent's (its tab's workspace), or one named (ws: yours, a script's); withdraw: an open one's id
export function suggest(p: { from?: unknown; ws?: unknown; title?: unknown; why?: unknown; prompt?: unknown; withdraw?: unknown }) {
  const by = agentTab(p.from)
  if (!by && !String(p.ws ?? '').trim()) throw new Error("laki suggest: in an agent's tab, or --ws <ws>")
  const w = by ? state.workspaces.find(x => x.id === by.workspace) : findWs(String(p.ws))
  if (!w) throw new Error("laki suggest: in an agent's tab, or --ws <ws>")
  const list = w.suggests ?? []
  if (p.withdraw !== undefined) {
    const s = list.find(x => x.id === String(p.withdraw))
    if (!s) throw new Error(`no suggestion ${String(p.withdraw)} in ${w.name || w.id}`)
    if (s.answered) throw new Error(`the user ${s.answered === 'started' ? 'started' : 'dismissed'} it already: it stays as they left it`)
    keep(w, list.filter(x => x !== s))
    return { withdrawn: s.id }
  }
  const title = clip(p.title, 120)
  const prompt = clip(p.prompt, 20000)
  if (!title || !prompt) throw new Error('usage: laki suggest "<title>" --prompt "<the task, for an agent of its own>" [--why "<why now>"]')
  const was = list.find(s => same(s.title, title))
  if (was?.answered === 'dismissed') throw new Error(`the user dismissed "${was.title}" already: don't suggest it again`)
  if (was && !was.answered) return { id: was.id, again: true } // open already: the same card
  const s: Suggestion = { id: randomBytes(3).toString('hex'), title, prompt, at: Date.now(), ...(clip(p.why, 400) && { why: clip(p.why, 400) }), ...(by && { tab: by.id }) }
  keep(w, [...list, s])
  wsLog(w, `${by?.name ?? 'a script'} suggests a task: ${title}`)
  return { id: s.id }
}

// yours (the card's): start (a new workspace with its prompt), dismiss, or started (Edit first's workspace was made)
export async function suggestAnswer(p: { ws?: unknown; id?: unknown; act?: unknown; made?: unknown }) {
  const w = findWs(String(p.ws ?? ''))
  const s = w.suggests?.find(x => x.id === String(p.id ?? ''))
  if (!s || s.answered) throw new Error('that suggestion is gone (withdrawn, or answered already)')
  if (!['start', 'dismiss', 'started'].includes(String(p.act))) throw new Error('act: start, dismiss or started')
  let made: Workspace | undefined
  if (p.act === 'start') made = await wsNew({ project: w.project, prompt: s.prompt, name: s.title } as NewWs)
  const cur = state.workspaces.find(x => x.id === w.id) // its list as it is by now
  if (!cur) return { ok: true, ...(made && { made: made.id }) }
  const ws = made?.id ?? (typeof p.made === 'string' ? p.made : undefined)
  keep(cur, (cur.suggests ?? []).map(x => (x.id === s.id ? { ...x, answered: p.act === 'dismiss' ? ('dismissed' as const) : ('started' as const), ...(ws && { ws }) } : x)))
  return { ok: true, ...(made && { made: made.id }) }
}
