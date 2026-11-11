// The bubbles' island (settings.floaterAt notch): a pill at the top of the screen, in the notch or under the menu bar,
// that opens into one card when an agent asks or finishes. Its pure parts: where the pill goes, which card shows next,
// when a card folds, and the words a card shows (main.ts places it, floater.ts draws it)

export type Rect = { x: number; y: number; width: number; height: number }
export type Display = { bounds: Rect; workArea: Rect; internal?: boolean }

// a built-in screen whose menu bar is taller than a plain one (24 points) has a notch. ponytail: Electron says nothing
// of the notch itself; NOTCH is a MacBook's (about 200 points wide)
export const NOTCH = 200
export const menuBarOf = (d: Display) => d.workArea.y - d.bounds.y
export const hasNotch = (d: Display) => !!d.internal && menuBarOf(d) > 24
// a full-screen app's screen has no menu bar: its work area is all of it. ponytail: by the screen, not the front window
export const fullScreen = (d: Display) => d.workArea.y === d.bounds.y && d.workArea.height === d.bounds.height
// the screen it goes on: the built-in one, else the main one
export const islandDisplay = <D extends Display>(all: D[], main: D) => all.find(d => d.internal) ?? main
// the pill: wings either side of the notch, as tall as the menu bar; no notch, under the menu bar, its own height
export const WING = 76
export function pillRect(d: Display): Rect {
  const cx = d.bounds.x + d.bounds.width / 2
  if (hasNotch(d)) {
    const width = NOTCH + 2 * WING
    return { x: Math.round(cx - width / 2), y: d.bounds.y, width, height: menuBarOf(d) }
  }
  const width = 2 * WING + 40
  return { x: Math.round(cx - width / 2), y: d.workArea.y, width, height: 28 }
}
// the card under it: the pill's width or 400, centered on it
export const CARD_W = 400
export const cardRect = (pill: Rect, h: number): Rect => (w => ({ x: Math.round(pill.x + pill.width / 2 - w / 2), y: pill.y + pill.height + 4, width: w, height: Math.round(h) }))(Math.max(CARD_W, pill.width))

// the cards to show, one at a time: those that ask first, then the finished ones, each newest first (at: since when)
export type Needs = { tab: string; status?: string; at?: number }
export const cardQueue = <F extends Needs>(items: F[]) =>
  [...items.filter(f => f.status === 'waiting'), ...items.filter(f => f.status === 'done')].sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || (b.at ?? 0) - (a.at ?? 0))
// "1 of 3"; none for one
export const dotsText = (i: number, n: number) => (n > 1 ? `${i + 1} of ${n}` : '')
// a card's life: an ask stays until you answer it (or Esc); a finished one folds DONE_FOLD after it showed, unless the
// pointer is on it; leaving it after having been on it folds it
export const DONE_FOLD = 6000
export type CardLife = { kind: 'ask' | 'done'; shownAt: number; over: boolean; touched: boolean }
export type CardEvent = 'enter' | 'leave' | 'esc' | 'tick'
export function lifeStep(c: CardLife, ev: CardEvent, now: number): { life: CardLife; fold: boolean } {
  if (ev === 'esc') return { life: c, fold: true }
  if (ev === 'enter') return { life: { ...c, over: true, touched: true }, fold: false }
  if (ev === 'leave') return { life: { ...c, over: false }, fold: c.kind === 'done' && c.touched }
  return { life: c, fold: c.kind === 'done' && !c.over && now - c.shownAt >= DONE_FOLD }
}
// a finished card's time: "done in 4m 12s"
export function tookText(ms?: number) {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
// an answer's first lines as plain text: Markdown's marks out (headings, emphasis, code fences and ticks, links as
// their words, list bullets, quotes), blank lines skipped, each line cut
export function plainLines(md: string | undefined, n = 3, max = 160) {
  return (md ?? '')
    .replace(/```[^\n]*\n?/g, '')
    .split('\n')
    .map(l =>
      l
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|\*|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
        .replace(/(?<!\w)(__|_)(?=\S)([^\n]*?\S)\1(?!\w)/g, '$2') // _emphasis_, never parse_line_end
        .replace(/`/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, n)
    .map(l => (l.length > max ? `${l.slice(0, max - 1)}…` : l))
}
// a reply from the bubbles: to an agent that asks with a menu, only its options (typed keys would pick one); else text,
// queued while it works
export const replyOf = (f: { status: string; ask?: { options: unknown[] } }) => (f.status === 'waiting' && f.ask?.options.length ? 'options' : 'text')

// Q4: an edge bubble's card pinned to answer from (main's pinGo): a click on a waiting circle pins its card (clickable,
// focusable: its options, a reply, Open); a click on the pinned one again (a double click is two clicks), or on one that
// doesn't wait, opens its tab, as before; Esc, a click elsewhere (the card's blur), its answer, or its ask gone
// (list: the waiting ones now) unpin it. A press on the bar blurs the card before its click comes: the one pinned up
// to PIN_GRACE ms before counts as still pinned
export const PIN_GRACE = 500
export type Pin = { tab: string; gone?: { tab: string; at: number } }
export type PinEv = { kind: 'click'; tab: string; waiting: boolean } | { kind: 'esc' | 'blur' | 'answered' } | { kind: 'list'; waiting: string[] }
export function pinStep(p: Pin, ev: PinEv, now: number): { pin: Pin; open?: string } {
  if (ev.kind === 'click') {
    const cur = p.tab || (p.gone && now - p.gone.at < PIN_GRACE ? p.gone.tab : '')
    return ev.tab === cur || !ev.waiting ? { pin: { tab: '' }, open: ev.tab } : { pin: { tab: ev.tab } }
  }
  if (ev.kind === 'list') return { pin: !p.tab || ev.waiting.includes(p.tab) ? p : { tab: '' } }
  if (ev.kind === 'blur') return { pin: { tab: '', ...((p.tab || p.gone) && { gone: p.tab ? { tab: p.tab, at: now } : p.gone }) } }
  return { pin: { tab: '' } }
}
// a permission ask's command or file on a pinned card: its first PIN_LINES lines; cut: no buttons there (you'd allow what
// you can't read), Open shows it all
export const PIN_LINES = 3
export function pinWhat(what: string, n = PIN_LINES, max = 400) {
  const lines = what.split('\n')
  const shown = lines.slice(0, n).join('\n')
  return { shown: shown.length > max ? `${shown.slice(0, max - 1)}…` : shown, cut: lines.length > n || shown.length > max }
}
