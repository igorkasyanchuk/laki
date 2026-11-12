// E8: an extension's menu (the sidebar's, the rail's: App) and what it's made of, without Settings › Extensions: that
// loads with the Settings page. SettingsExtensions.tsx imports these back
import { placesOf, type WidgetPlace, type WidgetView } from '../../shared/types'
import type { WidgetsApi } from './SettingsExtensions'
import { type MenuItem, ON } from './ui'

export const SIZES: [number, number][] = [0.5, 1, 2, 3, 4].flatMap(d => [1, 2, 3, 4].map(a => [a, d] as [number, number])) // ½ down: a thin line
// Auto: in the top or status bar, as wide as it needs (a JS page: as its page measures itself)
export const fits = (w: WidgetView) => placesOf(w).some(p => p === 'top' || p === 'status')
export const PLACES: [WidgetPlace, string, string][] = [
  ['side', 'Sidebar', 'In the sidebar, above its buttons'],
  ['top', 'Top bar', 'In the top bar, left of its buttons: a line high'],
  ['status', 'Status bar', "At the status bar's right end: a line high"],
  ['rail', 'Rail', 'A button on the rail, with its icons (no rail: the sidebar’s foot)'],
  ['foot', 'Sidebar foot', 'A button in the sidebar’s foot, beside its ⋯ (Video, Meme, Timer)'],
  ['desk', 'My Desk', 'A tile on the My Desk page, sized there'],
  ['panel', 'Side panel', 'A tab of the side panel (⌥⌘B), beside Info and Files'],
  ['row', 'Workspace rows', 'A mark on each workspace’s row in the sidebar: its badge (per workspace only)'],
]
export const BARS: WidgetPlace[] = ['side', 'top', 'status']

export function extMenuItems(w: WidgetView, api: WidgetsApi): MenuItem[] {
  const places = placesOf(w)
  const offered = PLACES.filter(([v]) => (v !== 'desk' || api.desk || places.includes('desk')) && (v !== 'row' || w.scope === 'workspace'))
  const flip = (v: WidgetPlace) => (next => next.length && void api.set(w.id, { place: next }))(places.includes(v) ? places.filter(x => x !== v) : [...places, v])
  const size = w.size.join('x')
  return [
    { label: w.on ? 'Turn off' : 'Turn on', icon: 'power', sub: w.on ? 'nothing of it runs until you turn it on' : undefined, run: () => void api.set(w.id, { on: !w.on }) },
    { label: 'Show in', icon: 'layout', items: offered.map(([v, n, tip]) => ({ label: n, sub: tip, ...(places.includes(v) && { hint: ON }), run: () => flip(v) })) },
    ...(places.some(p => BARS.includes(p)) && (!w.button || fits(w)) ? [{ label: 'Size', icon: 'grid', items: [...(fits(w) ? [{ label: 'Auto: in a bar, as wide as it needs', ...(w.fit && { hint: ON }), run: () => void api.set(w.id, { fit: true }) }] : []), ...SIZES.map(([a, d]) => ({ label: `${a} across × ${d === 0.5 ? '½' : d} down`, ...(!(w.fit && fits(w)) && size === `${a}x${d}` && { hint: ON }), run: () => void api.set(w.id, { size: [a, d], fit: false }) }))] } as MenuItem] : []),
    null,
    ...(api.remix && !w.oneFile ? [{ label: 'Remix', icon: 'copy', sub: 'a copy of it to change, yours', run: () => void api.remix!(w.id) } as MenuItem] : []),
    // a repo's goes with its repo, a dev link's is your folder: neither to the trash from here
    ...(api.rm && !w.project && !w.dev ? [{ label: 'Delete…', icon: 'trash', danger: true, sub: 'to the trash: Undo brings it back', run: () => void api.rm!(w.id) } as MenuItem] : []),
  ]
}
