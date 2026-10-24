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
    const k = keep(g, id => ids.includes(id) && !seen.has(id) && !!seen.add(id)) // once in all, within a tab too
    if (k) out.push(k)
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

// where a dragged pane or tab lands: beside a pane (center: in its place, the two trade places), or in the tab bar
// before its bar'th tab (groups.length: last)
export type Spot = { pane: string; edge: Edge | 'center' } | { bar: number }

// move a pane (whole, or alone in its tab: its entire tab) to a spot ('bar': right after its own tab); a move that
// changes nothing returns groups itself
export function move(groups: Layout[], tab: string, whole: boolean, to: Spot | 'bar'): Layout[] {
  const gi = groups.findIndex(g => tabsOf(g).includes(tab))
  if (gi < 0) return groups
  const rest = whole ? null : keep(groups[gi], t => t !== tab) // what stays in its tab
  const node: Layout = rest ? { tab } : groups[gi]
  if (to === 'bar') to = { bar: gi + 1 }
  if ('bar' in to) {
    if (!rest && (to.bar === gi || to.bar === gi + 1)) return groups // already there
    const out = groups.map((g, i) => (i === gi ? rest : g))
    out.splice(to.bar, 0, node)
    return out.filter((g): g is Layout => !!g)
  }
  const { pane, edge } = to
  if (tabsOf(node).includes(pane)) return groups // onto itself
  if (edge === 'center') {
    const trade = (l: Layout): Layout => ('tab' in l ? (l.tab === pane ? node : l.tab === tab ? { tab: pane } : l) : { ...l, a: trade(l.a), b: trade(l.b) })
    return groups.map((g, i) => (i === gi && !rest ? { tab: pane } : trade(g)))
  }
  return groups.flatMap((g, i) => (i !== gi ? [g] : rest ? [rest] : [])).map(g => (tabsOf(g).includes(pane) ? insert(g, node, pane, edge) : g))
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

// a tab in words, for Laki AI and the CLI: a | b side by side, a / b stacked (a above), nested in parentheses
export function describe(l: Layout, name: (tab: string) => string = t => t): string {
  if ('tab' in l) return name(l.tab)
  const part = (x: Layout) => ('tab' in x || x.dir === l.dir ? describe(x, name) : `(${describe(x, name)})`)
  return `${part(l.a)} ${l.dir === 'row' ? '|' : '/'} ${part(l.b)}`
}

// One-click layouts (App's Layout menu; settings.layouts, a project's config.layout): a split tree by role, filled from
// the workspace's tabs. agent n: 0 the focused agent tab (else the first live one), then the others in order; dev the
// Run tab; shell the shell tabs in order. A role with no tab drops out (its split becomes the other side)
export type Role = 'agent' | 'dev' | 'shell'
export type RoleLayout = { role: Role; n?: number } | { dir: 'row' | 'col'; a: RoleLayout; b: RoleLayout; at: number }
export type SavedLayout = { name: string; tree: RoleLayout; panel?: { open: boolean; tab?: string; w?: number } }
export type RoleTab = { id: string; role?: Role } // a workspace's live tabs in their order; role: what it is, if any
const split = (dir: 'row' | 'col', a: RoleLayout, b: RoleLayout): RoleLayout => ({ dir, a, b, at: 0.5 })
export const LAYOUT_PRESETS: { id: string; name: string; tree: RoleLayout; panel?: string; needs?: Role }[] = [
  { id: 'agent', name: 'Just the agent', tree: { role: 'agent' } },
  { id: 'preview', name: 'Agent | Preview', tree: { role: 'agent' }, panel: 'preview' },
  { id: 'changes', name: 'Agent | Changes', tree: { role: 'agent' }, panel: 'changes' },
  { id: 'dev', name: 'Agent | dev server', tree: split('row', { role: 'agent' }, { role: 'dev' }), needs: 'dev' },
  { id: 'shell', name: 'Agent / shell', tree: split('col', { role: 'agent' }, { role: 'shell' }), needs: 'shell' },
]
// All agents: 2 side by side, 3–4 as 2 × 2 (the first four)
export const allAgents = (n: number): RoleLayout =>
  n <= 2 ? split('row', { role: 'agent' }, { role: 'agent', n: 1 }) : split('col', split('row', { role: 'agent' }, { role: 'agent', n: 1 }), split('row', { role: 'agent', n: 2 }, { role: 'agent', n: 3 }))

export const rolesIn = (l: RoleLayout): Role[] => ('role' in l ? [l.role] : [...rolesIn(l.a), ...rolesIn(l.b)])

// the tree's tabs as the first group, every other live tab a tab of its own after it, in order; null: no tab for any role
export function fillRoles(tree: RoleLayout, tabs: RoleTab[], focused?: string): Layout[] | null {
  const of = (r: Role) => tabs.filter(t => t.role === r)
  const agents = of('agent')
  const lists: Record<Role, RoleTab[]> = { agent: [...agents.filter(t => t.id === focused), ...agents.filter(t => t.id !== focused)], dev: of('dev'), shell: of('shell') }
  const used = new Set<string>()
  const fill = (l: RoleLayout): Layout | null => {
    if ('role' in l) {
      const t = lists[l.role][l.n ?? 0]
      return t && !used.has(t.id) && used.add(t.id) ? { tab: t.id } : null
    }
    const a = fill(l.a)
    const b = fill(l.b)
    return !a ? b : !b ? a : { dir: l.dir, a, b, at: l.at }
  }
  const first = fill(tree)
  return first && [first, ...tabs.filter(t => !used.has(t.id)).map(t => ({ tab: t.id }))]
}

// the other way, to save one: a tab's tree with its sessions as roles (n: its place among its kind's, the focused agent first)
export function toRoles(l: Layout, tabs: RoleTab[], focused?: string): RoleLayout | null {
  const of = (r: Role) => tabs.filter(t => t.role === r)
  const agents = of('agent')
  const order: Record<Role, RoleTab[]> = { agent: [...agents.filter(t => t.id === focused), ...agents.filter(t => t.id !== focused)], dev: of('dev'), shell: of('shell') }
  const go = (x: Layout): RoleLayout | null => {
    if ('tab' in x) {
      const t = tabs.find(t => t.id === x.tab)
      if (!t?.role) return null
      const n = order[t.role].indexOf(t)
      return n ? { role: t.role, n } : { role: t.role }
    }
    const a = go(x.a)
    const b = go(x.b)
    return !a ? b : !b ? a : { dir: x.dir, a, b, at: x.at }
  }
  return go(l)
}
