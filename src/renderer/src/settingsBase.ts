// E8: what the rest of the app reads of Settings (the window, the terminal, the sidebar's rows, the rail, a link's
// section), without the Settings page: that loads as it opens (Dialogs.tsx' lazy pages). Settings.tsx re-exports it
import type { FontWeight } from '@xterm/xterm'
import { SECTIONS } from '../../shared/settingsMap'
import { aiOn, type Design, flowsOn, specsOn } from '../../shared/types'
import type { AppSettings } from './Settings'
import type { IconName } from './ui'

// the window's frame (App's data-design and data-dz, styles.css' Design block): how its parts sit together, over the
// theme; each a set of traits (data-dz's words), the CSS keyed on them
export const DESIGNS: [Design, string, string, string][] = [
  ['classic', 'Classic', 'Edge to edge, a line between the parts', ''],
  ['sections', 'Sections', 'The sidebar a card with each project boxed; the terminals and the side panel cards inside one card', 'chrome side-card boxed body inner pills'],
  ['cards', 'Cards', 'The sidebar, the terminals and the side panel each a card', 'chrome side-card parts pills shadow'],
  ['inset', 'Inset', 'One raised card for the terminals and the side panel, the sidebar flat beside the rail', 'chrome body joined'],
  ['tiles', 'Tiles', 'Every split pane a tile of its own, projects boxed', 'chrome side-card boxed parts tiles pills shadow'],
  ['soft', 'Soft', 'No lines: tints, round shapes, more room, the side panel floating over the terminals', 'boxed float pills lineless'],
  ['frosted', 'Frosted', "macOS glass over any theme: its colors, floating panels on your desktop, capsule tabs, Mac controls", 'pills float lineless frosted'], // look.css' Frosted: applyTheme's data-look, always glass
]
export const designTraits = (d?: Design) => DESIGNS.find(x => x[0] === d)?.[3] || undefined

// a sidebar row's marks, each on or off: Appearance › Sidebar rows and a sidebar right click's Show › (App's showItems).
// Older ones keep their own settings (prIcon, prMarks, diffStat), the rest are rowMarks: on unless false, but the next
// step's chip (off unless true); conflicts and failing checks, unset: as the PR's mark
export type RowMark = 'step' | 'pr' | 'author' | 'approved' | 'mine' | 'commented' | 'conflict' | 'ci' | 'radar' | 'plan' | 'stat' | 'ticket'
export const ROW_MARKS: [RowMark, string, string][] = [
  ['step', 'Next step', 'A chip with what it needs from you now: Merge, Archive, Answer… (its ⋯ menu has it first either way)'],
  ['pr', 'Pull request', "GitHub's mark: green open, purple merged, red closed, gray draft"],
  ['author', "Author's picture", "The PR author's GitHub picture beside the mark"],
  ['approved', '✓ Approved', 'Its reviews approve it (GitHub\'s decision, or an approval where none is required)'],
  ['mine', '✓✓ Approved by you too', 'Approved, and your approval is one of them'],
  ['commented', '👀 You commented', "Someone else's PR you commented on or reviewed with comments"],
  ['conflict', 'Conflicts', 'A warning when its PR has merge conflicts'],
  ['ci', 'Failing checks', 'A red mark when its PR\'s checks fail'],
  ['radar', 'Overlaps', 'How many other workspaces change the same lines (Collision radar)'],
  ['plan', "The agent's plan", 'n/m of its to-do list'],
  ['ticket', 'Linked ticket', "Its ticket's key and status, from the project's Ticket script (a click opens it)"],
  ['stat', 'Diff size', 'Lines added and removed against its base, new files too; checked every 10 seconds'],
]
export function rowMarkOn(s: Pick<AppSettings, 'prIcon' | 'prMarks' | 'diffStat' | 'rowMarks'>, m: RowMark): boolean {
  if (m === 'pr') return s.prIcon !== false
  if (m === 'approved' || m === 'mine' || m === 'commented') return s.prMarks?.[m] !== false
  if (m === 'stat') return s.diffStat === true
  if (m === 'step') return s.rowMarks?.step === true
  if (m === 'conflict' || m === 'ci') return s.rowMarks?.[m] ?? s.prIcon !== false
  return s.rowMarks?.[m] !== false
}
// one that can show at all: its feature on (One next step, Collision radar, the live plan; the author's: GitHub pictures
// and the PR's mark), else no switch for it here or in Show ›
export const rowMarkUsed = (s: Pick<AppSettings, 'nextStep' | 'radar' | 'livePlan' | 'avatars' | 'prIcon' | 'prMarks' | 'diffStat' | 'rowMarks'>, m: RowMark) =>
  m === 'step' ? s.nextStep !== false : m === 'radar' ? s.radar === true : m === 'plan' ? s.livePlan !== false : m === 'author' ? s.avatars !== false && rowMarkOn(s, 'pr') : true
export const rowMarkSet = (s: Pick<AppSettings, 'prMarks' | 'rowMarks'>, m: RowMark, v: boolean): Partial<AppSettings> =>
  m === 'pr' ? { prIcon: v } : m === 'approved' || m === 'mine' || m === 'commented' ? { prMarks: { ...s.prMarks, [m]: v } } : m === 'stat' ? { diffStat: v } : { rowMarks: { ...s.rowMarks, [m]: v } }

export const FONT_SIZE = 13

export const PAGE_ZOOMS = [0.9, 1, 1.1, 1.25, 1.5]

// a font name for xterm, with fallbacks
export const fontStack = (f?: string) => [f?.trim() && JSON.stringify(f.trim()), '"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Monaco', 'monospace'].filter(Boolean).join(', ')

export const SCROLL = 3 // xterm's own 1 crawls through a long agent session
// the terminal's typography and cursor, as xterm options (size and family: Term's props, zoom changes them)
export const termLook = (s: AppSettings) => ({
  lineHeight: s.lineHeight ?? 1.15,
  letterSpacing: s.letterSpacing ?? 0,
  fontWeight: (s.fontWeight || 'normal') as FontWeight,
  fontWeightBold: 'bold' as FontWeight,
  minimumContrastRatio: s.minContrast ?? 1,
  cursorStyle: s.cursorStyle ?? 'block',
  cursorBlink: s.cursorBlink !== false,
  scrollSensitivity: s.scrollSpeed ?? SCROLL,
  fastScrollSensitivity: (s.scrollSpeed ?? SCROLL) * 3, // with ⌥
})

export const isSection = (id: string) => SECTIONS.some(x => x.id === id)

// the rail's buttons after Projects (Settings › Appearance › Rail, Slack's way: which show, in what order; the rest
// go into its ⋯ More): key, words, icon; when: what has it there at all. AI stays at the rail's foot
export type RailHas = { specs?: boolean; workflows?: boolean; desk?: boolean; notes?: boolean; todoList?: boolean; calendar?: boolean; railShells?: boolean; railBrowsers?: boolean; ai?: { on?: boolean } }
export const RAIL_ITEMS: { key: string; label: string; icon: IconName; when?: (s: RailHas) => boolean }[] = [
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'schedules', label: 'Schedule', icon: 'clock' },
  { key: 'specs', label: 'Specs', icon: 'spec', when: s => specsOn(s) },
  { key: 'workflows', label: 'Workflows', icon: 'flow', when: s => flowsOn(s) },
  { key: 'desk', label: 'My Desk', icon: 'desk', when: s => s.desk !== false },
  { key: 'notes', label: 'Notes', icon: 'note', when: s => s.notes !== false },
  { key: 'todos', label: 'To-dos', icon: 'listChecks', when: s => s.todoList !== false },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', when: s => s.calendar !== false },
  { key: 'shells', label: 'Terminal', icon: 'terminal', when: s => s.railShells !== false },
  { key: 'browsers', label: 'Browser', icon: 'globe', when: s => s.railBrowsers !== false },
  { key: 'ai', label: 'AI', icon: 'ai', when: s => aiOn(s) },
]
// in the order set (one not in it, a page turned on since: after them, in RAIL_ITEMS' order)
export const railSorted = <T extends { key: string }>(xs: T[], order: string[] = []) => {
  const at = (k: string) => (i => (i < 0 ? order.length + RAIL_ITEMS.findIndex(x => x.key === k) : i))(order.indexOf(k))
  return [...xs].sort((a, b) => at(a.key) - at(b.key))
}
