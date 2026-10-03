// A workspace's tabs, tmux style: each tab is a tree of splits whose leaves are terminals (the daemon's
// tabs, called sessions here). Pure functions, no React.
export type Layout = { tab: string } | { dir: 'row' | 'col'; a: Layout; b: Layout; at: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Box = { x: number; y: number; w: number; h: number } // fractions of the area

export const tabsOf = (l: Layout | null): string[] => (!l ? [] : 'tab' in l ? [l.tab] : [...tabsOf(l.a), ...tabsOf(l.b)])

// keep the panes whose session passes; a split that loses a side becomes the other side
export function keep(l: Layout | null, ok: (tab: string) => boolean): Layout | null {
  if (!l) return null
  if ('tab' in l) return ok(l.tab) ? l : null
  const a = keep(l.a, ok)
  const b = keep(l.b, ok)
  return !a ? b : !b ? a : { ...l, a, b }
}

// the tabs to show: the stored ones minus ended sessions, then a tab for each session in none
export function groupsOf(stored: Layout[] | undefined, ids: string[]): Layout[] {
  const seen = new Set<string>()
  const out: Layout[] = []
  for (const g of stored ?? []) {
    const k = keep(g, id => ids.includes(id) && !seen.has(id))
    if (!k) continue
    tabsOf(k).forEach(id => seen.add(id))
    out.push(k)
  }
  return [...out, ...ids.filter(id => !seen.has(id)).map(tab => ({ tab }))]
}

const swap = (l: Layout, from: string, to: Layout): Layout =>
  'tab' in l ? (l.tab === from ? to : l) : { ...l, a: swap(l.a, from, to), b: swap(l.b, from, to) }

// split target's pane: node goes on the edge's side
export function insert(l: Layout, node: Layout, target: string, edge: Edge): Layout {
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const first = edge === 'left' || edge === 'top'
  return swap(l, target, { dir, a: first ? node : { tab: target }, b: first ? { tab: target } : node, at: 0.5 })
}

// move a pane (whole: its entire tab) next to another pane, or ('bar') out into a tab of its own
export function move(groups: Layout[], tab: string, whole: boolean, to: { pane: string; edge: Edge } | 'bar'): Layout[] {
  const gi = groups.findIndex(g => tabsOf(g).includes(tab))
  if (gi < 0) return groups
  if (to === 'bar') {
    const rest = keep(groups[gi], t => t !== tab)
    if (whole || !rest) return groups // ponytail: tabs aren't reordered by dragging
    return [...groups.slice(0, gi), rest, { tab }, ...groups.slice(gi + 1)]
  }
  const node: Layout = whole ? groups[gi] : { tab }
  if (tabsOf(node).includes(to.pane)) return groups
  const out = whole ? groups.filter((_, i) => i !== gi) : groups.map(g => keep(g, t => t !== tab)).filter((g): g is Layout => !!g)
  return out.map(g => (tabsOf(g).includes(to.pane) ? insert(g, node, to.pane, to.edge) : g))
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
