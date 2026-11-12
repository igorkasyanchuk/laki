// The start-up snapshot: the window's last layout, drawn (inert, dimmed) while the daemon's first view comes, in place
// of the splash (App.tsx' SnapSkeleton). Only names and sizes: up to 30 rows (name, color, project), the open
// workspace's tab names, the widths, the theme; never a Private project's or workspace's, a prompt, a path or a
// terminal's text (a tab's name is Laki's, not its terminal's title). Pure (test/units-more.test.ts); App keeps it in
// localStorage on pagehide and every minute, the app's main window only (not remote access, not the small windows)
import type { View } from '../../shared/types'

export const SNAP_KEY = 'laki.snap'
export const SNAP_VERSION = 1
export const SNAP_MAX = 20_000 // characters of its JSON
export type SnapRow = { name: string; color?: string; project: string }
export type Snap = { v: number; theme?: string; sideW: number; panelW: number; panelOpen: boolean; rail: string; railOn: boolean; rows: SnapRow[]; tabs: string[]; sel: number }
export type SnapUi = { sideW: number; panelW: number; panelOpen: boolean; rail: string; railOn: boolean; ws?: string; tab?: string }

const cut = (s: string, n = 80) => (s.length > n ? s.slice(0, n) : s)

export function snapshotOf(view: Pick<View, 'projects' | 'workspaces' | 'tabs' | 'settings'>, ui: SnapUi): Snap {
  const hidden = new Set(view.projects.filter(p => p.private).map(p => p.id))
  const rows: SnapRow[] = []
  for (const p of view.projects) {
    if (hidden.has(p.id)) continue
    for (const w of view.workspaces) if (w.project === p.id && !w.private && !w.archived && rows.length < 30) rows.push({ name: cut(w.name || w.id), ...(w.color && { color: w.color }), project: cut(p.name) })
  }
  const open = view.workspaces.find(w => w.id === ui.ws)
  const shown = open && !open.private && !hidden.has(open.project) ? view.tabs.filter(t => t.workspace === open.id) : []
  const snap: Snap = { v: SNAP_VERSION, ...(view.settings.theme && { theme: cut(view.settings.theme, 40) }), sideW: ui.sideW, panelW: ui.panelW, panelOpen: ui.panelOpen, rail: cut(ui.rail, 20), railOn: ui.railOn, rows, tabs: shown.slice(0, 20).map(t => cut(t.name, 40)), sel: Math.max(0, shown.findIndex(t => t.id === ui.tab)) }
  while (JSON.stringify(snap).length > SNAP_MAX && (snap.rows.length || snap.tabs.length)) snap.rows.length ? snap.rows.pop() : snap.tabs.pop() // ponytail: one at a time, a few hundred at most
  return snap
}

// the kept one, or none: another version's, a broken one, or too big
export function snapOf(raw: string | null): Snap | undefined {
  if (!raw || raw.length > SNAP_MAX) return
  try {
    const s = JSON.parse(raw) as Snap
    return s && s.v === SNAP_VERSION && Array.isArray(s.rows) && Array.isArray(s.tabs) ? s : undefined
  } catch {
    return
  }
}
