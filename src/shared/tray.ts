// Q8: the menu bar icon's state, and its four pictures. Pure (no electron): main wraps a bitmap in a template image
// (macOS tints it for a light or dark menu bar and for the highlight from its alpha alone: no color), test/tray.test.ts
// draws all four to PNGs. The renderer works out the state from its view (stateOf) and sends it with the badge.
import { askScope, optLabel } from './ask.ts'
import { counted, heard } from './nextStep.ts'
import type { DigestRow, TabView, View } from './types.ts'

export const TRAY_STATES = ['idle', 'working', 'waiting', 'blocked'] as const
export type TrayState = (typeof TRAY_STATES)[number]
export type TrayInfo = { state: TrayState; needs: number; working: number; blocked: number; quiet?: number /* U8: quiet until (ms) */ }

// the agents' tabs of workspaces you hear from (muted and archived ones aside, as the Dock's count): blocked (one at its
// plan limit, or a turn ended on an error) over waiting (one needs you: asks, a secret, finished unseen) over working (one
// runs) over idle. ponytail: blocked first, since it waits on more than a click; the count still says how many need you
export function stateOf(view: Pick<View, 'tabs' | 'workspaces'>, now = Date.now()): TrayInfo {
  const quiet = new Set(view.workspaces.filter(w => !heard(w)).map(w => w.id))
  const tabs = view.tabs.filter((t: TabView) => !t.muted && !quiet.has(t.workspace))
  const agents = tabs.filter(t => t.kind === 'agent')
  const needs = tabs.filter(t => counted(t, now)).length
  const working = agents.filter(t => t.status === 'running').length
  const blocked = agents.filter(t => (!!t.limit && t.limit > now) || !!t.failed).length
  return { state: blocked ? 'blocked' : needs ? 'waiting' : working ? 'working' : 'idle', needs, working, blocked }
}

// U15: the Dock icon's progress bar (main's setProgressBar, sent with the badge): a Ship at work (its tab: laki
// progress' pct, else unknown) and each workflow run going (the blocks it has been on of all its blocks: a branch not
// taken keeps it under 1; an older daemon's run, no steps: unknown). -1: none; 2: unknown (macOS's indeterminate bar);
// else their mean, 0 to 1
type Run = { status: string; visits: Record<string, number>; steps?: number }
export function dockProgress(view: Pick<View, 'tabs' | 'mergeQueues'> & { flows?: Run[] }): number {
  const parts = [
    ...(view.mergeQueues ?? []).filter(q => !q.stopped && !q.done).map(q => Math.min(q.items.filter(i => i.status === 'merged').length / q.items.length, 0.99)), // a merge queue at work: its merged share
    ...view.tabs.filter(t => t.kind === 'ship' && t.status === 'running').map(t => (t.progress ? Math.max(0, Math.min(1, t.progress.pct / 100)) : NaN)),
    ...(view.flows ?? []).filter(f => f.status === 'running').map(f => (f.steps ? Math.min(Object.keys(f.visits).length / f.steps, 0.99) : NaN)),
  ]
  if (!parts.length) return -1
  return parts.some(Number.isNaN) ? 2 : parts.reduce((a, b) => a + b, 0) / parts.length
}

// U15: the Dock bounces once (informational) as a workspace starts waiting on you (none of its tabs waited the view
// before) while Laki isn't the front app: Settings › Notifications › Bounce the Dock icon (on unless off). Not a muted or
// archived workspace or tab, nor in Do not disturb unless it's important (its ask comes as a card then, as notify's).
// was: the workspaces that waited the view before (null: the first view, nothing bounces); now: this view's
export function bounceOf(was: ReadonlySet<string> | null, view: Pick<View, 'tabs' | 'workspaces' | 'settings' | 'dnd'>, front: boolean) {
  const quiet = new Set(view.workspaces.filter(w => !heard(w) || (!!view.dnd && !w.important)).map(w => w.id))
  const now = new Set(view.tabs.filter(t => t.status === 'waiting' && !t.muted && !quiet.has(t.workspace)).map(t => t.workspace))
  return { now, bounce: !!was && !front && view.settings.dockBounce !== false && [...now].some(w => !was.has(w)) }
}

// its tooltip, in words: "Laki: 2 need you, 3 working, 1 blocked"; nothing going on: the name alone; quiet: "quiet until
// 14:30" first
export const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
export function trayTip(i: Pick<TrayInfo, 'needs' | 'working' | 'blocked' | 'quiet'>, name = 'Laki', now = Date.now()) {
  const parts = [(i.quiet ?? 0) > now && `quiet until ${hhmm(i.quiet!)}`, i.needs && `${i.needs} need${i.needs === 1 ? 's' : ''} you`, i.working && `${i.working} working`, i.blocked && `${i.blocked} blocked`].filter(Boolean)
  return parts.length ? `${name}: ${parts.join(', ')}` : name
}

// U8: Quiet's choices, the same in ⌘K and the menu bar's menu: 30 minutes, an hour, until 9:00 (after midnight: this
// morning's, not a day and a night more)
export function quietChoices(now = Date.now()): { label: string; o: { minutes: number } | { until: number } }[] {
  const at9 = new Date(now)
  const early = at9.getHours() < 9
  at9.setHours(early ? 9 : 24 + 9, 0, 0, 0)
  return [
    { label: 'for 30 minutes', o: { minutes: 30 } },
    { label: 'for 1 hour', o: { minutes: 60 } },
    { label: early ? 'until 9:00' : 'until tomorrow 9:00', o: { until: at9.getTime() } },
  ]
}
// what still comes while quiet: an important workspace's ask (its card) and laki alert's card (api.ts notify)
export const quietLets = (card?: { ask?: boolean; alert?: string }) => !!(card?.ask || card?.alert)
// a notification's tab that opens Needs you on a click (main's show sends it on as a tab id; App's onFocusTab)
export const NEEDS = '@needs'
// as it ends, the one notification's words: "While it was quiet: 2 agents are waiting, 3 finished, 1 check failed";
// nothing happened: '' (no notification, no card)
export function quietSummary(rows: Pick<DigestRow, 'kind' | 'text'>[]) {
  const n = (k: DigestRow['kind'], f: (r: Pick<DigestRow, 'text'>) => boolean = () => true) => rows.filter(r => r.kind === k && f(r)).length
  const [wait, done, fail, pr] = [n('wait'), n('done'), n('pr', r => r.text === 'checks fail'), n('pr', r => r.text !== 'checks fail')]
  const parts = [wait && `${wait} agent${wait === 1 ? ' is' : 's are'} waiting`, done && `${done} finished`, fail && `${fail} check${fail === 1 ? '' : 's'} failed`, pr && `${pr} PR${pr === 1 ? '' : 's'} moved`].filter(Boolean)
  return parts.length ? `While it was quiet: ${parts.join(', ')}` : ''
}
// its title beside the icon: the count of those that need you, with ! when one is blocked
export const trayTitle = (i: Pick<TrayInfo, 'needs' | 'blocked'>) => `${i.needs || ''}${i.blocked ? '!' : ''}`

// Laki's mark (a chevron and a dot) at 32×32 (@2x), BGRA, black with its alpha antialiased from a distance field:
// waiting the filled mark (as it always was), idle its outline, working the outline and a dot under it, blocked the
// filled mark and a bar under it. quiet (U8): a slash through it, a gap cut either side; drop (Q9: something dragged
// over the item): the filled mark in a rounded frame
export const TRAY_PX = 32
export function trayBitmap(state: TrayState, o: { quiet?: boolean; drop?: boolean } = {}): Buffer {
  const S = TRAY_PX
  const px = Buffer.alloc(S * S * 4)
  const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const [dx, dy] = [bx - ax, by - ay]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }
  const filled = state === 'waiting' || state === 'blocked' || !!o.drop
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5]
      const mark = Math.min(Math.min(seg(cx, cy, 6, 23, 15, 12), seg(cx, cy, 15, 12, 24, 23)) - 2.6, Math.hypot(cx - 25, cy - 7) - 3)
      let d = filled ? mark : Math.abs(mark + 0.8) - 0.8 // the outline: a band 1.6 px inside its edge
      if (state === 'working') d = Math.min(d, Math.hypot(cx - 15, cy - 28.5) - 2.2)
      if (state === 'blocked') d = Math.min(d, seg(cx, cy, 7, 28.5, 23, 28.5) - 1.3)
      if (o.drop) d = Math.min(mark, Math.abs(Math.hypot(Math.max(Math.abs(cx - 16) - 11, 0), Math.max(Math.abs(cy - 16) - 11, 0)) - 3.5) - 1)
      if (o.quiet) {
        const slash = seg(cx, cy, 2, 21, 30, 12) // across both arms, under the dot
        d = Math.min(Math.max(d, 2.6 - slash), slash - 1.2) // a gap 2.6 px either side of the line's middle, then the line
      }
      px[(y * S + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - d))) // antialiased edges
    }
  return px
}

// the menu bar's Inbox (Settings › General › Menu bar click: Inbox; main's inbox window, ask.html?window=inbox): what
// it lists, from the view as drawn (Recording mode's private workspaces already out). The agents waiting on you first,
// the oldest first, each with its question and its menu's choices (9 at most: keys 1-9), then the ones at work, 3 at
// most; muted and archived workspaces aside, as the Dock's count
// an ask's as the cards on screen have it: its Edit's or Write's diff, explain (a command's ?, Laki AI on), each standing
// choice's scope (its words, whole: the card shows the rule and warns on a broad one)
// at: the ask's own time (Ask.at): which ask a card is, as a tab asks one after another (an explanation is that ask's)
export type InboxItem = { tab: string; title: string; body: string; kind: 'ask' | 'working'; options?: { n: number; label: string; scope?: string }[]; diff?: string; explain?: boolean; at?: number }
export const INBOX_ASKS = 9
export const INBOX_WORKING = 3
export function inboxOf(view: Pick<View, 'tabs' | 'workspaces'>, said: (tab: string) => string | undefined = () => undefined, explain = false): InboxItem[] {
  const ws = new Map(view.workspaces.map(w => [w.id, w]))
  const tabs = view.tabs.filter(t => t.kind === 'agent' && !t.muted && ws.has(t.workspace) && !ws.get(t.workspace)!.muted && !ws.get(t.workspace)!.archived)
  const title = (t: TabView) => (w => `${w.name || w.id} · ${t.name}`.slice(0, 90))(ws.get(t.workspace)!)
  const asks = tabs
    .filter(t => t.status === 'waiting')
    .sort((a, b) => (a.needAt ?? 0) - (b.needAt ?? 0))
    .slice(0, INBOX_ASKS)
    .map((t): InboxItem => ({ tab: t.id, title: title(t), body: (t.ask?.question || said(t.id) || 'Waiting for you').replace(/\s+/g, ' ').slice(0, 300), kind: 'ask', ...(t.ask?.options.length && { options: t.ask.options.slice(0, 9).map(o => (s => ({ n: o.n, label: o.label.slice(0, 80), ...(s && { scope: optLabel(t.ask!, o) }) }))(askScope(optLabel(t.ask!, o), t.preset))) }), ...(t.ask?.diff && { diff: t.ask.diff }), ...(explain && t.ask?.tool === 'Bash' && { explain: true }), ...(t.ask?.at && { at: t.ask.at }) }))
  const working = tabs
    .filter(t => t.status === 'running')
    .slice(0, INBOX_WORKING)
    .map((t): InboxItem => ({ tab: t.id, title: title(t), body: (t.progress?.note || 'Working').slice(0, 120), kind: 'working' }))
  return [...asks, ...working]
}
