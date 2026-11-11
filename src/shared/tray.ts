// Q8: the menu bar icon's state, and its four pictures. Pure (no electron): main wraps a bitmap in a template image
// (macOS tints it for a light or dark menu bar and for the highlight from its alpha alone: no color), test/tray.test.ts
// draws all four to PNGs. The renderer works out the state from its view (stateOf) and sends it with the badge.
import { needsTab } from './nextStep.ts'
import type { TabView, View } from './types.ts'

export const TRAY_STATES = ['idle', 'working', 'waiting', 'blocked'] as const
export type TrayState = (typeof TRAY_STATES)[number]
export type TrayInfo = { state: TrayState; needs: number; working: number; blocked: number }

// the agents' tabs of workspaces you hear from (muted and archived ones aside, as the Dock's count): blocked (one at its
// plan limit, or a turn ended on an error) over waiting (one needs you: asks, a secret, finished unseen) over working (one
// runs) over idle. ponytail: blocked first, since it waits on more than a click; the count still says how many need you
export function stateOf(view: Pick<View, 'tabs' | 'workspaces'>, now = Date.now()): TrayInfo {
  const quiet = new Set(view.workspaces.filter(w => w.muted || w.archived).map(w => w.id))
  const tabs = view.tabs.filter((t: TabView) => !t.muted && !quiet.has(t.workspace))
  const agents = tabs.filter(t => t.kind === 'agent')
  const needs = tabs.filter(needsTab).length
  const working = agents.filter(t => t.status === 'running').length
  const blocked = agents.filter(t => (!!t.limit && t.limit > now) || !!t.failed).length
  return { state: blocked ? 'blocked' : needs ? 'waiting' : working ? 'working' : 'idle', needs, working, blocked }
}

// its tooltip, in words: "Laki: 2 need you, 3 working, 1 blocked"; nothing going on: the name alone
export function trayTip(i: Pick<TrayInfo, 'needs' | 'working' | 'blocked'>, name = 'Laki') {
  const parts = [i.needs && `${i.needs} need${i.needs === 1 ? 's' : ''} you`, i.working && `${i.working} working`, i.blocked && `${i.blocked} blocked`].filter(Boolean)
  return parts.length ? `${name}: ${parts.join(', ')}` : name
}
// its title beside the icon: the count of those that need you, with ! when one is blocked
export const trayTitle = (i: Pick<TrayInfo, 'needs' | 'blocked'>) => `${i.needs || ''}${i.blocked ? '!' : ''}`

// Laki's mark (a chevron and a dot) at 32×32 (@2x), BGRA, black with its alpha antialiased from a distance field:
// waiting the filled mark (as it always was), idle its outline, working the outline and a dot under it, blocked the
// filled mark and a bar under it
export const TRAY_PX = 32
export function trayBitmap(state: TrayState): Buffer {
  const S = TRAY_PX
  const px = Buffer.alloc(S * S * 4)
  const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const [dx, dy] = [bx - ax, by - ay]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }
  const filled = state === 'waiting' || state === 'blocked'
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5]
      const mark = Math.min(Math.min(seg(cx, cy, 6, 23, 15, 12), seg(cx, cy, 15, 12, 24, 23)) - 2.6, Math.hypot(cx - 25, cy - 7) - 3)
      let d = filled ? mark : Math.abs(mark + 0.8) - 0.8 // the outline: a band 1.6 px inside its edge
      if (state === 'working') d = Math.min(d, Math.hypot(cx - 15, cy - 28.5) - 2.2)
      if (state === 'blocked') d = Math.min(d, seg(cx, cy, 7, 28.5, 23, 28.5) - 1.3)
      px[(y * S + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - d))) // antialiased edges
    }
  return px
}
