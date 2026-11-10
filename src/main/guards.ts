// Electron main's checks, pure (no electron import, so test/main-guards.test.ts runs them on plain node): who sent an
// IPC message (fromApp, from), and the URLs main lets through (open-external, the webviews, the agent browser)

// the app's own pages, its windows' (built: file:, nothing else loads one; dev: the dev server's origin), not a site
export const appPage = (url: string | undefined, devOrigin = '') => !!url && (devOrigin ? URL.canParse(url) && new URL(url).origin === devOrigin : url.startsWith('file:'))

// an IPC sender as main sees it: its webContents' type, whether the frame is its main one, the frame's URL
export type Sender = { type: string; main: boolean; url?: string }
export const fromApp = (s: Sender, devOrigin = '') => s.type === 'window' && s.main && appPage(s.url, devOrigin)
// one of the app's other pages by name: its ?window= (new, ai, tab, sim)
export const pageIs = (url: string | undefined, page: string) => !!url && URL.canParse(url) && new URL(url).searchParams.get('window') === page

// this Mac's localhost over http, no userinfo (http://localhost@evil.example is evil.example's), any port
export const local = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
// a website: http(s) only (not file:, javascript:, a custom scheme)
export const web = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)

export const PREVIEW = 'persist:preview' // the preview pane: starts on localhost
export const BROWSER = 'persist:browser' // the sidebar's Browsers: any site, its sign-ins kept between runs
export const AGENT_BROWSER = 'agent-browser' // S12: the agent browser's hidden windows: in memory, never the Preview's cookies
// a <webview> may attach: a Browsers page on a website or about:blank, else only the Preview on localhost
export const webviewOk = (partition: string | undefined, src: string) => (partition === BROWSER ? web(src) || src === 'about:blank' : partition === PREVIEW && local(src))
// open-external's: a website to the default browser, a laki: link to the app window, nothing else
export const externalOf = (u: unknown) => (web(u) ? 'web' : typeof u === 'string' && u.startsWith('laki:') ? 'laki' : undefined)
