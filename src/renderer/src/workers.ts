// The workers dock (panels.tsx WorkersDock, under an orchestrator's tab): each worker's row and the folded summary.
// A worker is a workspace its agent started (wsNew from its tab: fromTab). Its state: waiting on you first (its ask
// shows even folded), then failed (its Done check still fails, an agent failed or ended), else the tabs' rollup.
// Pure: test/layout.test.ts; roll is Glyph's rollup (a .tsx, kept out of the test)
import type { TabView } from '../../shared/types'
import { bulkOk } from '../../shared/ask.ts'

export type Worker = { ws: string; name: string; tabs: TabView[]; failed?: string; dirty?: number } // dirty: its uncommitted files (its stat's)

export const workerOf = (w: { id: string; stat?: { dirty: number }; check?: { status?: string } }, name: string, tabs: TabView[]): Worker => ({
  ws: w.id,
  name,
  tabs: tabs.filter(t => t.workspace === w.id),
  ...(w.stat && { dirty: w.stat.dirty }),
  ...(w.check?.status === 'over' && { failed: 'its Done check still fails' }),
})

export function dockRows(workers: Worker[], cleared: string[], roll: (tabs: TabView[]) => string) {
  return workers
    .map(w => {
      const agents = w.tabs.filter(t => t.kind === 'agent')
      const asks = agents.filter(t => t.status === 'waiting') // each one's question in the dock
      const ask = asks[0]
      const failed = w.failed ?? agents.find(t => t.failed)?.failed ?? (agents.length && agents.every(t => t.status === 'exited') ? 'its agent ended' : undefined)
      const state = ask ? 'waiting' : failed ? 'exited' : roll(agents.length ? agents : w.tabs)
      const pct = Math.max(-1, ...agents.map(t => t.progress?.pct ?? -1))
      const line = (agents.find(t => t.progress?.note)?.progress?.note ?? agents.find(t => t.last)?.last ?? '').trim().split('\n').at(-1)?.slice(0, 140)
      return { ...w, ask, asks, failed, state, pct, line, first: (ask ?? agents[0] ?? w.tabs[0])?.id }
    })
    .filter(w => !(w.failed && cleared.includes(w.ws))) // a failed one you cleared: gone from this dock
}

// "1 needs you · 2 failed · 3 working · 1 done"
export function dockSum(states: string[]) {
  const n = (s: string) => states.filter(x => x === s).length
  const w = n('waiting')
  return [w && `${w} ${w === 1 ? 'needs' : 'need'} you`, n('exited') && `${n('exited')} failed`, n('running') && `${n('running')} working`, n('done') && `${n('done')} done`].filter(Boolean).join(' · ')
}

// the dock's head: what the workers' agents spent (their chats' cost at API prices, as each tab's meter has it; none
// known: undefined), the asks one click may allow (ask.ts bulkOk: a plain yes … no permission ask, none risky, none
// outside the worktree unless its sandbox is on; Allow answers its plain yes, never a standing one: bulkPick), the agent
// tabs at work (Stop all) and the workers done with nothing uncommitted (Archive done; the daemon's ifClean decides)
export function dockFleet(rows: { ws: string; state: string; tabs: TabView[]; dirty?: number }[]) {
  const agents = rows.flatMap(w => w.tabs.filter(t => t.kind === 'agent'))
  const costs = agents.map(t => t.usage?.cost).filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
  return {
    spend: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
    safe: agents.filter(t => bulkOk(t, t.sandbox === true && t.perm !== 'bypassPermissions')),
    running: agents.filter(t => t.status === 'running'),
    done: rows.filter(w => w.state === 'done' && !w.dirty).map(w => w.ws),
  }
}
