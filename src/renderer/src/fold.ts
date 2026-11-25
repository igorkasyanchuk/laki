// #9: the sidebar's Recent view: every workspace by when it last worked (its agents' last turn or ask, else when it was
// made), newest first, under Running (one at work now, or being set up), Today, Yesterday, Last 7 days, Last 30 days and
// Older, by the local calendar; groups with none left out. Pure: test/layout.test.ts
export const RECENT = [['running', 'Running'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['older', 'Older']] as const
export function recentGroups<W>(list: W[], at: (w: W) => number, running: (w: W) => boolean, now = Date.now()) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const start = (back: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() - back).getTime()
  const of = (w: W) => (running(w) ? 'running' : at(w) >= start(0) ? 'today' : at(w) >= start(1) ? 'yesterday' : at(w) >= start(6) ? 'week' : at(w) >= start(29) ? 'month' : 'older')
  const sorted = [...list].sort((a, b) => at(b) - at(a))
  return RECENT.map(([id, label]) => ({ id, label, ws: sorted.filter(w => of(w) === id) })).filter(g => g.ws.length)
}

// Fold long projects (the sidebar's shownRows): a project's rows in order, its first cap workspaces in sight and any
// that matters (the open one, working, waiting on you), each in its place, so none moves as one starts or stops
// working; a group head whose rows all fold away goes with them (one empty already stays). more: how many folded.
// Pure: test/layout.test.ts
export function foldRows<R>(rows: R[], isWs: (r: R) => boolean, cap: number, matters: (r: R) => boolean): { rows: R[]; more: number } {
  if (!(cap > 0)) return { rows, more: 0 }
  let n = 0
  let more = 0
  const cut = rows.filter(x => !isWs(x) || n++ < cap || matters(x) || (more++, false))
  if (!more) return { rows, more }
  const under = (list: R[], i: number) => {
    let k = 0
    for (let j = i + 1; j < list.length && isWs(list[j]); j++) k++
    return k
  }
  return { rows: cut.filter((x, i) => isWs(x) || under(cut, i) > 0 || under(rows, rows.indexOf(x)) === 0), more }
}
