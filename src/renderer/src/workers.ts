// The workers dock (panels.tsx WorkersDock, under an orchestrator's tab): each worker's row and the folded summary.
// A worker is a workspace its agent started (wsNew from its tab: fromTab). Its state: waiting on you first (its ask
// shows even folded), then failed (its Done check still fails, an agent failed or ended), else the tabs' rollup.
// Pure: test/layout.test.ts; roll is Glyph's rollup (a .tsx, kept out of the test)
import type { TabView } from '../../shared/types'

export type Worker = { ws: string; name: string; tabs: TabView[]; failed?: string }

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
