// npm run test:sheet's pages (src/main/smoke.ts): each with what must show (`want`: some match visible) and what must
// not (`not`: no match visible), checked before its picture is taken. `not` is what the page before it in the walk can
// leave over it (the Review tab on Projects and the Reader once did); test/sheet-pages.test.ts holds every page to both
export const SHEET_PAGES = ['projects', 'reader', 'review', 'new-workspace', 'settings', 'board', 'schedule', 'schedule-scrolled', 'ai', 'workflows', 'palette'] as const
// ponytail: PHONE by hand, the pages a phone gets to from the remote page's rail
export const SHEET_PHONE = ['projects', 'reader', 'settings', 'board'] as const

export type SheetSel = { want: string; not: string }
const SEL: Record<string, SheetSel> = {
  projects: { want: '.sidebar .ws', not: '.full-review, .palette-input' },
  reader: { want: '.reader', not: '.full-review' },
  review: { want: '.full-review', not: '.reader' }, // under the review the panes (and their Reader) are hidden
  'new-workspace': { want: '.nw-composer', not: '.full-review' },
  settings: { want: '.settings-page .settings-nav > button.on', not: '.nw-composer' },
  board: { want: '.board', not: '.palette-input, .ask-box' }, // a Page: .settings-page itself
  schedule: { want: '.sched-empty, .sched-row, .ghosts', not: '.board' },
  'schedule-scrolled': { want: '.settings-page[data-scrolled] > .settings-head > .page-title-s', not: '.board' }, // its title small in the head
  ai: { want: '.ai-page', not: '.sched-row, .ghosts' },
  workflows: { want: '.wf-page, .sched-empty', not: '.ai-page' },
  palette: { want: '.palette-input', not: '.ask-box' },
}
// a phone's row click hides the sidebar: its workspace's tab bar instead, no rail page (the Board, its last) over it
const PHONE: Record<string, Partial<SheetSel>> = { projects: { want: '.app.narrow .tab-list', not: '.full-review, .board' } }

export const sheetSel = (page: string, phone = false): SheetSel | undefined => SEL[page] && { ...SEL[page], ...(phone ? PHONE[page] : {}) }
