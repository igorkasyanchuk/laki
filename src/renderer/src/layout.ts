// Panes: a workspace's terminal area as a tree of splits, each leaf one tab. Pure functions, no React.
export type Layout = { tab: string } | { dir: 'row' | 'col'; a: Layout; b: Layout; at: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom' | 'center'
export type Box = { x: number; y: number; w: number; h: number } // fractions of the area

export const tabsOf = (l: Layout | null): string[] => (!l ? [] : 'tab' in l ? [l.tab] : [...tabsOf(l.a), ...tabsOf(l.b)])

// keep the panes whose tab passes; a split that loses a side becomes the other side
export function keep(l: Layout | null, ok: (tab: string) => boolean): Layout | null {
  if (!l) return null
  if ('tab' in l) return ok(l.tab) ? l : null
  const a = keep(l.a, ok)
  const b = keep(l.b, ok)
  return !a ? b : !b ? a : { ...l, a, b }
}

const swap = (l: Layout, from: string, to: Layout): Layout =>
  'tab' in l ? (l.tab === from ? to : l) : { ...l, a: swap(l.a, from, to), b: swap(l.b, from, to) }

// make sure tab is on screen: in the pane of `instead` (or the first pane) when it isn't already
export function show(l: Layout | null, tab: string, instead?: string): Layout {
  const on = tabsOf(l)
  if (!l || on.includes(tab)) return l ?? { tab }
  return swap(l, instead && on.includes(instead) ? instead : on[0], { tab })
}

// drop tab on target's pane: an edge splits that pane, the center takes it over
export function drop(l: Layout | null, tab: string, target: string, edge: Edge): Layout | null {
  if (tab === target) return l
  const rest = keep(l, t => t !== tab)
  if (!rest || !tabsOf(rest).includes(target)) return l
  if (edge === 'center') return swap(rest, target, { tab })
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const first = edge === 'left' || edge === 'top'
  return swap(rest, target, { dir, a: first ? { tab } : { tab: target }, b: first ? { tab: target } : { tab }, at: 0.5 })
}

// path: 'a'/'b' steps from the root to a split
export function resize(l: Layout, path: string, at: number): Layout {
  if ('tab' in l) return l
  if (!path) return { ...l, at: Math.min(0.9, Math.max(0.1, at)) }
  return path[0] === 'a' ? { ...l, a: resize(l.a, path.slice(1), at) } : { ...l, b: resize(l.b, path.slice(1), at) }
}

export type Bar = { path: string; dir: 'row' | 'col'; box: Box; at: number }

// where each pane and divider goes, as fractions of the whole area
export function place(l: Layout, box: Box = { x: 0, y: 0, w: 1, h: 1 }, path = '', out = { panes: [] as { tab: string; box: Box }[], bars: [] as Bar[] }) {
  if ('tab' in l) {
    out.panes.push({ tab: l.tab, box })
    return out
  }
  const [a, b]: Box[] =
    l.dir === 'row'
      ? [{ ...box, w: box.w * l.at }, { ...box, x: box.x + box.w * l.at, w: box.w * (1 - l.at) }]
      : [{ ...box, h: box.h * l.at }, { ...box, y: box.y + box.h * l.at, h: box.h * (1 - l.at) }]
  place(l.a, a, path + 'a', out)
  place(l.b, b, path + 'b', out)
  out.bars.push({ path, dir: l.dir, box, at: l.at })
  return out
}
