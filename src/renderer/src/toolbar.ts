// The tab bar's toolbar as data (settingsBase re-exports it): its buttons by group, which show (settings.toolbar, an
// ordered list of ids; unset: the default), the rest in its ⋯ menu; which groups fold into ⋯ when the bar is narrow;
// and how many tabs fit before a +n button (fitTabs). ⋯ and Run are fixed: never in the list, never hidden. Pure
// (test/units-more.test.ts). ponytail: groups keep their order (view, open, workspace, extensions); the list orders
// the buttons within each
import type { IconName } from './ui'

export type ToolGroupId = 'view' | 'open' | 'workspace' | 'ext'
export const TOOLBAR_GROUPS: { id: ToolGroupId; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'open', label: 'Open elsewhere' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'ext', label: 'Extensions' },
]
export type ToolbarItem = { id: string; title: string; icon: IconName; group: ToolGroupId; off?: true } // off: not shown by default
export const TOOLBAR_ITEMS: ToolbarItem[] = [
  { id: 'reader', title: 'Terminal | Reader', icon: 'bookOpen', group: 'view' },
  { id: 'full', title: 'Full screen: just this tab', icon: 'maximize', group: 'view', off: true },
  { id: 'panel', title: 'Side panel', icon: 'panel', group: 'view' },
  { id: 'layout', title: 'Layout', icon: 'layers', group: 'view', off: true },
  { id: 'editor', title: 'Open in…', icon: 'code', group: 'open' },
  { id: 'preview', title: 'Preview', icon: 'globe', group: 'open' },
  { id: 'share', title: 'Share live view', icon: 'share', group: 'open', off: true },
  { id: 'ship', title: 'Ship', icon: 'ship', group: 'workspace' },
  { id: 'timer', title: 'Send a message later', icon: 'timer', group: 'workspace' },
]

// shown: in the order set, an unknown id dropped, one new since `seen` (a later version's, an extension's) at its
// default place; menu: the rest, for ⋯; seen: every id now, kept with a custom list
export function toolbarOf(setting: unknown, items: { id: string; off?: boolean }[], seen?: unknown) {
  const ids = items.map(x => x.id)
  const def = items.filter(x => !x.off).map(x => x.id)
  const list = Array.isArray(setting) ? [...new Set(setting.filter((x): x is string => typeof x === 'string' && ids.includes(x)))] : null
  const was = new Set(Array.isArray(seen) ? seen.filter(x => typeof x === 'string') : [])
  const shown = list ?? def
  if (list)
    for (const id of def)
      if (!was.has(id) && !shown.includes(id)) {
        const before = def.slice(0, def.indexOf(id)).reverse().find(x => shown.includes(x))
        shown.splice(before ? shown.indexOf(before) + 1 : 0, 0, id)
      }
  return { shown, menu: ids.filter(x => !shown.includes(x)), seen: ids }
}

// the capsules the bar draws: each group's buttons, a group of one joined to the next (the last to the one before), so
// no capsule holds a single icon unless it's the only one
export function capsulesOf(groups: { id: string; label: string; ids: string[] }[]) {
  const out = groups.filter(g => g.ids.length).map(g => ({ id: g.id, label: g.label, ids: [...g.ids] }))
  for (let i = 0; i < out.length && out.length > 1; ) {
    if (out[i].ids.length > 1) {
      i++
      continue
    }
    const at = i + 1 < out.length ? i : i - 1
    const [a, b] = [out[at], out[at + 1]]
    out.splice(at, 2, { id: `${a.id} ${b.id}`, label: `${a.label}, ${b.label}`, ids: [...a.ids, ...b.ids] })
    i = at
  }
  return out
}

// the groups that fold into ⋯ (from the right, each whole) so the shown ones' buttons fit in room px
export function collapseOf(groups: { id: string; n: number }[], room: number, button = 28) {
  const width = (g: { n: number }) => g.n * button + 12 // a capsule's padding and the gap before it
  const out: string[] = []
  let used = groups.reduce((s, g) => s + width(g), 0)
  for (const g of [...groups].reverse()) {
    if (used <= room) break
    out.push(g.id)
    used -= width(g)
  }
  return out
}

// which tabs show in available px, each at least min wide, the rest behind a +n button (a tab's min wide): in order,
// the selected one always shown (it takes the last slot when it would be hidden); no room: only the selected
export function fitTabs(widths: number[], available: number, selected: number, min: number): { shown: number[]; hidden: number[] } {
  const w = widths.map(x => Math.max(x, min))
  const all = w.map((_, i) => i)
  if (w.reduce((s, x) => s + x, 0) <= available) return { shown: all, hidden: [] }
  const room = available - min
  const shown: number[] = []
  let used = 0
  for (const i of all) {
    if (used + w[i] > room) break
    shown.push(i)
    used += w[i]
  }
  if (selected >= 0 && selected < w.length && !shown.includes(selected)) {
    while (shown.length && used + w[selected] > room) used -= w[shown.pop()!]
    shown.push(selected)
  }
  if (!shown.length && selected >= 0 && selected < w.length) shown.push(selected)
  return { shown, hidden: all.filter(i => !shown.includes(i)) }
}
