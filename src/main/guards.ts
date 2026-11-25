// Electron main's checks, pure (no electron import, so test/main-guards.test.ts runs them on plain node): who sent an
// IPC message (fromApp, from), and the URLs main lets through (open-external, the webviews, the agent browser)
import { confirmKnown } from '../shared/confirm.ts'
export { titleOf } from '../shared/title.ts' // a window's title, cleaned (the bridge's title)

// S9: the built pages' origin, a privileged standard scheme main serves out/renderer on (protocol.handle): 'self' in
// their CSP is this origin alone, not every file:// on the disk (an agent's worktree among them)
export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://laki`
// the app's own pages, its windows' (built: app://laki/, nothing else serves one; dev: the dev server's origin), not a
// site. Node's URL gives a custom scheme's origin as 'null': the built one by its prefix
export const appPage = (url: string | undefined, devOrigin = '') => !!url && URL.canParse(url) && (devOrigin ? new URL(url).origin === devOrigin : url.startsWith(`${APP_ORIGIN}/`))
// S9: a page that gets the daemon's token (conn): index.html's (the app window and its ?window= ones: new, ai, tab, sim,
// quick), not ask.html, floater.html or annotate.html (cards, bubbles, the screenshot editor: no daemon of their own)
export const tokenPage = (url: string | undefined, devOrigin = '') => appPage(url, devOrigin) && /^\/(index\.html)?$/.test(new URL(url!).pathname)
// a file of out/renderer for an app:// request's URL, or undefined: another host, or a path out of it (.., %2e%2e)
export const appFile = (url: string, root: string, sep = '/') => {
  if (!URL.canParse(url)) return
  const u = new URL(url)
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== 'laki') return
  let path: string
  try {
    path = decodeURIComponent(u.pathname)
  } catch {
    return
  }
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (!parts.length || parts.some(p => p === '..' || p === '.' || p.includes('\0'))) return
  return root.replace(/[/\\]+$/, '') + sep + parts.join(sep)
}

// an IPC sender as main sees it: its webContents' type, whether the frame is its main one, the frame's URL
export type Sender = { type: string; main: boolean; url?: string }
export const fromApp = (s: Sender, devOrigin = '') => s.type === 'window' && s.main && appPage(s.url, devOrigin)
export const fromTokenPage = (s: Sender, devOrigin = '') => fromApp(s, devOrigin) && tokenPage(s.url, devOrigin)
// Touch ID's confirm IPC (main's 'confirm', shared/confirm.ts): the app window's own page (isWin: its webContents), never a
// small window, a webview or a frame, and only for one of CONFIRM's actions (main says its words, not the page)
// #G1: Go back's IPC (update-back): the app window's own page (isWin: its webContents), never a small window or a frame
export const backAsk = (s: Sender, isWin: boolean, devOrigin = '') => fromApp(s, devOrigin) && isWin
export const confirmAsk = (s: Sender, isWin: boolean, what: unknown, devOrigin = '') => fromApp(s, devOrigin) && isWin && confirmKnown(what)
// one of the app's other pages by name: its ?window= (new, ai, tab, sim)
// a double click on the title bar's empty room, as macOS's own (System Settings › Desktop & Dock › Double-click a
// window's title bar to): AppleActionOnDoubleClick's Minimize, None, else zoom (Maximize, Fill, unset)
export const dblClickAction = (pref: unknown): 'minimize' | 'none' | 'zoom' => (pref === 'Minimize' ? 'minimize' : pref === 'None' ? 'none' : 'zoom')
export const pageIs = (url: string | undefined, page: string) => !!url && URL.canParse(url) && new URL(url).searchParams.get('window') === page

// C10: a file dragged out of the app (main's drag-out): its real path (links followed) inside one of roots (a
// workspace's folder, its storage folder), never a root itself, '/' or home as a root
export const dragOk = (real: string, roots: string[], home: string) =>
  real.startsWith('/') && !real.includes('\0') && roots.some(r => r.startsWith('/') && r !== '/' && r.replace(/\/+$/, '') !== home.replace(/\/+$/, '') && real.startsWith(`${r.replace(/\/+$/, '')}/`))

// this Mac's localhost over http, no userinfo (http://localhost@evil.example is evil.example's), any port
export const local = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
// a website: http(s) only (not file:, javascript:, a custom scheme)
export const web = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)

export const PREVIEW = 'persist:preview' // the preview pane: starts on localhost
export const BROWSER = 'persist:browser' // the sidebar's Browsers: any site, its sign-ins kept between runs
export const AGENT_BROWSER = 'agent-browser' // S12: the agent browser's hidden windows: in memory, never the Preview's cookies
// a <webview> may attach: a Browsers page on a website or about:blank, else only the Preview on localhost
export const webviewOk = (partition: string | undefined, src: string) => (partition === BROWSER ? web(src) || src === 'about:blank' : partition === PREVIEW && local(src))
// Handoff (Settings › Remote access › Offer on my nearby devices): the address a nearby Apple device is offered, the
// remote page's own: only at a lasting one (Tailscale's, My domain's; never a quick tunnel's, which changes and whose
// link is its key), https only, no # (the link's token or PIN) and no query. Else none
export function handoffUrl(r: unknown): string | undefined {
  const x = r && typeof r === 'object' ? (r as { url?: unknown; via?: unknown; host?: unknown }) : {}
  if (typeof x.url !== 'string' || (x.via !== 'tailscale' && !(typeof x.host === 'string' && x.host))) return
  try {
    const u = new URL(x.url)
    return u.protocol === 'https:' && !u.username && !u.password ? `${u.origin}${u.pathname}` : undefined
  } catch {
    return undefined
  }
}

// open-external's: a website to the default browser, a laki: link to the app window, nothing else
export const externalOf = (u: unknown) => (web(u) ? 'web' : typeof u === 'string' && u.startsWith('laki:') ? 'laki' : undefined)

// A menu as macOS draws it (Settings › Layout's Menus: macOS; the renderer's menuModel): what main's menu-popup takes
// from the window, checked: an array of items, strings and booleans only, 4 deep and 300 items at most. A copy of
// what passed, or undefined (then nothing pops up)
export type NativeItem = { id?: string; label?: string; sublabel?: string; enabled?: boolean; checked?: boolean; separator?: true; sub?: NativeItem[] }
export const MENU_DEPTH = 4
export const MENU_ITEMS = 300
export function menuModelOk(m: unknown): NativeItem[] | undefined {
  let n = 0
  const str = (v: unknown, max: number) => (v === undefined ? undefined : typeof v === 'string' && v.length <= max ? v : null)
  const bool = (v: unknown) => (v === undefined ? undefined : typeof v === 'boolean' ? v : null)
  const list = (a: unknown, depth: number): NativeItem[] | undefined => {
    if (!Array.isArray(a) || depth > MENU_DEPTH) return
    const out: NativeItem[] = []
    for (const x of a) {
      if (++n > MENU_ITEMS || !x || typeof x !== 'object' || Array.isArray(x)) return
      const o = x as Record<string, unknown>
      if (Object.keys(o).some(k => !['id', 'label', 'sublabel', 'enabled', 'checked', 'separator', 'sub'].includes(k))) return
      if (o.separator !== undefined) {
        if (o.separator !== true) return
        out.push({ separator: true })
        continue
      }
      const it = { id: str(o.id, 40), label: str(o.label, 200), sublabel: str(o.sublabel, 200), enabled: bool(o.enabled), checked: bool(o.checked) }
      if (Object.values(it).includes(null) || !it.label) return
      const sub = o.sub === undefined ? undefined : list(o.sub, depth + 1)
      if (o.sub !== undefined && !sub) return
      out.push(Object.fromEntries(Object.entries({ ...it, sub }).filter(([, v]) => v !== undefined)) as NativeItem)
    }
    return out
  }
  return list(m, 1)
}

// 10c: the windows that float over other apps, kept out of screen recording, sharing and screenshots
// (setContentProtection): the bubbles' bar (the notch island too: the same window), its card, + menu and voice window,
// the cards on screen (ask.html), the menu bar's Inbox, the quick bar and the talk pill. With Settings' Hide bubbles and
// cards from screen recording (hideFloats: true, a new install's), or while Recording mode is on, whatever it says. Never
// the app's window, the annotate editor or a floated tab: you may want to show those
export const FLOAT_KINDS = ['bar', 'card', 'menu', 'voice', 'ask', 'inbox', 'quick', 'talk'] as const
export const protectedKind = (kind: string, s: { hideFloats?: boolean }, recording: boolean) => (FLOAT_KINDS as readonly string[]).includes(kind) && (s.hideFloats === true || recording)

// a launch's window: shown, unless macOS opened Laki at login (Settings › General › Start Laki at login: the daemon and
// the menu bar item then, the window made but hidden: its notifications go on). A smoke run's or a capture's: shown
export const showAtLaunch = (o: { mac: boolean; atLogin: boolean; check?: boolean }) => !(o.mac && o.atLogin && !o.check)

// the Dock's menu (macOS): up to five agents waiting, from the window's list (names only; Recording mode's private
// workspaces never in it, the window leaves them out), each checked here
export type DockAgent = { ws: string; tab: string; name: string }
const idOk = (x: unknown) => (typeof x === 'string' && /^[\w-]{1,64}$/.test(x) ? x : undefined)
export function dockAgents(v: unknown): DockAgent[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 5).flatMap((a: { ws?: unknown; tab?: unknown; name?: unknown } | null) => {
    const ws = idOk(a?.ws)
    const tab = idOk(a?.tab)
    const name = typeof a?.name === 'string' ? a.name.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    return ws && tab && name ? [{ ws, tab, name }] : []
  })
}
// its items by id (main gives each its click): New Task…, the agents waiting, Quiet for an Hour or End Quiet
export type DockItem = { type: 'separator' } | { id: string; label: string }
export const dockMenu = (agents: DockAgent[], quiet: boolean): DockItem[] => [
  { id: 'new', label: 'New Task…' },
  ...(agents.length ? [{ type: 'separator' } as const, ...agents.map(a => ({ id: `tab:${a.tab}`, label: `${a.name} — waiting` }))] : []),
  { type: 'separator' },
  quiet ? { id: 'quiet-off', label: 'End Quiet' } : { id: 'quiet', label: 'Quiet for an Hour' },
]
// a project's folder for the Dock's recent items: an absolute path on this Mac (an SSH host's is never sent)
export const recentOk = (p: unknown): p is string => typeof p === 'string' && p.length > 1 && p.length <= 1024 && p.startsWith('/') && !p.includes('\0')
// a working bubble's turn (the renderer's float item): started, when its turn began (ms, not later than a minute from
// now), and usual, its project's and profile's usual turn (ms, up to a day); else neither (floater.ts draws no ring)
export function floatTimes(x: unknown, now = Date.now()): { started?: number; usual?: number } {
  const o = (x && typeof x === 'object' ? x : {}) as { started?: unknown; usual?: unknown }
  const ok = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi
  return ok(o.started, 1, now + 60_000) && ok(o.usual, 1000, 86_400_000) ? { started: o.started, usual: o.usual } : {}
}
