// the agent browser (laki browser, MCP's laki_browser): a hidden window per tab, AGENT_TABS per workspace, in the
// preview's session (this Mac's localhost), gone after 10 idle minutes; browse's ops (open, click, type, read, wait,
// screenshot…) through the Chrome DevTools Protocol, each one's errors, blocked loads and the changes it caused; the
// app window only asks (browse), the daemon's call through it
import { AGENT_BROWSER, local } from './guards.ts'
import { type BrowseDid, keyEvent, pageChanges, urlIs } from '../shared/types.ts'
import { BrowserWindow, ipcMain } from 'electron'
import { win } from './index.ts'

// the agent browser (laki browser, MCP's laki_browser): hidden windows per workspace (its tabs, AGENT_TABS at most) in
// the preview's session, kept to this Mac's localhost as the preview is, gone after 10 idle minutes; ops come from the
// daemon through the renderer
type Browse = { ws: string; home: string; op: string; url?: string; selector?: string; text?: string; expect?: string; to?: string; key?: string; px?: number; edge?: string; off?: boolean; act?: string; n?: number; size?: Size } // expect: --expect-url's; size: viewport's
type Size = { w: number; h: number }
// errors, blocked: what the page did during an op (its answer's), 20 of each; turn: the op before (one at a time: two
// at once would mix their clicks and their reports); tabs: its windows, at the one ops go to
// size: laki browser viewport's, every tab's (unset: 1280×800)
type AgentWin = { tabs: BrowserWindow[]; at: number; idle?: ReturnType<typeof setTimeout>; errors: string[]; blocked: string[]; turn: Promise<unknown>; size?: Size }
const AGENT_TABS = 5 // ponytail: five tabs per workspace; a sixth is refused
export const agentWins = new Map<string, AgentWin>()
export const agentEnd = (a: AgentWin) => (clearTimeout(a.idle), a.tabs.forEach(w => !w.isDestroyed() && w.destroy()))
const pageJs = (f: string, ...args: unknown[]) => `(${f})(${args.map(a => JSON.stringify(a)).join(',')})`
// a tab: a hidden window (its timers at full speed), its popups and links off localhost refused and told
function agentTab(a: AgentWin) {
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { partition: AGENT_BROWSER, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const block = (u: string) => a.blocked.length < 20 && a.blocked.push(u.slice(0, 300))
  w.webContents.setWindowOpenHandler(d => (block(d.url), { action: 'deny' }))
  w.webContents.on('will-navigate', (ev, u) => !local(u) && (ev.preventDefault(), block(u)))
  w.webContents.on('will-redirect', (ev, u) => !local(u) && (ev.preventDefault(), block(u)))
  w.webContents.on('console-message', ev => ev.level === 'error' && a.errors.length < 20 && a.errors.push(ev.message.slice(0, 300)))
  if (a.size) w.setContentSize(a.size.w, a.size.h)
  a.tabs.push(w)
  a.at = a.tabs.length - 1
  return w
}
ipcMain.handle('browse', async (e, r: Browse) => {
  if (e.sender !== win?.webContents) throw new Error('not the app window')
  let a = agentWins.get(r.ws)
  if (!a) agentWins.set(r.ws, (a = { tabs: [], at: 0, errors: [], blocked: [], turn: Promise.resolve() }))
  const entry = a
  clearTimeout(entry.idle)
  entry.idle = setTimeout(() => {
    if (agentWins.get(r.ws) === entry) agentWins.delete(r.ws)
    agentEnd(entry)
  }, 10 * 60e3)
  const go = entry.turn.then(() => {
    entry.tabs = entry.tabs.filter(w => !w.isDestroyed()) // closed by Stop (Resources) or a crash
    if (!entry.tabs.length) agentTab(entry)
    entry.at = Math.min(entry.at, entry.tabs.length - 1)
    return browseOp(entry, r)
  })
  entry.turn = go.catch(() => {})
  return go
})
// trusted input (hover, press, drag): Chromium's own events through the DevTools protocol, the page told it has the
// focus (a hidden window has none, and keys go to the focused element)
async function cdp(wc: Electron.WebContents) {
  const d = wc.debugger
  if (!d.isAttached()) {
    d.attach('1.3')
    await d.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  }
  return (method: string, params?: object) => d.sendCommand(method, params)
}
async function browseOp(entry: AgentWin, r: Browse) {
  entry.errors.length = entry.blocked.length = 0 // this op's only
  const wc = entry.tabs[entry.at].webContents
  // what a click starts gets a moment; a page it loads, until it's loaded (5 s at most)
  const settle = async (c = wc) => {
    await new Promise(ok => setTimeout(ok, 300))
    if (c.isLoading())
      await new Promise<void>(ok => {
        const done = () => (clearTimeout(t), c.off('did-stop-loading', done), ok())
        const t = setTimeout(done, 5000)
        c.once('did-stop-loading', done)
      })
  }
  const load = async (c: Electron.WebContents, u: string) => {
    if (!local(u)) throw new Error(`only this Mac's localhost: ${u}`)
    await c.loadURL(u).catch(err => {
      throw new Error(/ERR_CONNECTION_REFUSED/.test(String(err)) ? `nothing listens on ${new URL(u).host}: start the dev server (laki run)` : String(err.message ?? err))
    })
  }
  const lines = () => wc.executeJavaScript(`(document.body?.innerText ?? '').slice(0, 200000)`).then((t: string) => t.split('\n').map(l => l.trim()).filter(Boolean), () => [] as string[])
  const caused = () => ({ ...(entry.errors.length > 0 && { errors: [...entry.errors] }), ...(entry.blocked.length > 0 && { blocked: [...entry.blocked] }) })
  if (r.op === 'open' || (!wc.getURL() && r.op !== 'tabs')) await load(wc, r.url ?? r.home)
  if (r.op === 'open') await settle() // its scripts' first errors
  const page = { url: wc.getURL(), title: wc.getTitle() }
  if (r.expect && !urlIs(page.url, r.expect)) throw new Error(`the agent browser is on ${page.url}, not ${r.expect}: nothing done`)
  if (r.op === 'open') return { ...page, ...caused() }
  if (r.op === 'tabs') {
    // list; new <url> (a blank first tab takes it); select <n>, close <n> (1 is the first)
    const act = r.act ?? 'list'
    const i = (r.n ?? 0) - 1
    if ((act === 'select' || act === 'close') && !entry.tabs[i]) throw new Error(`no tab ${r.n}: ${entry.tabs.length} open`)
    if (act === 'new') {
      if (wc.getURL() && entry.tabs.length >= AGENT_TABS) throw new Error(`${AGENT_TABS} tabs at most: close one first (tabs close <n>)`)
      const c = wc.getURL() ? agentTab(entry).webContents : wc
      await load(c, r.url ?? r.home)
      await settle(c)
    } else if (act === 'select') entry.at = i
    else if (act === 'close') {
      entry.tabs.splice(i, 1)[0].destroy()
      entry.at = Math.max(0, Math.min(entry.at > i ? entry.at - 1 : entry.at, entry.tabs.length - 1))
      if (!entry.tabs.length) agentTab(entry) // the next op opens the workspace's page in it
    } else if (act !== 'list') throw new Error(`browser tabs ${act}? list, new <url>, select <n> or close <n>`)
    return { tabs: entry.tabs.map((w, n) => ({ n: n + 1, url: w.webContents.getURL(), title: w.webContents.getTitle(), ...(n === entry.at && { current: true }) })), ...caused() }
  }
  const viewport = () => (([w, h]) => `${w}×${h}`)(entry.tabs[entry.at].getContentSize())
  if (r.op === 'viewport' && r.size) {
    // #2: every tab laid out at it (a phone's width: its own breakpoints), and the next ones
    entry.size = r.size
    for (const t of entry.tabs) t.setContentSize(r.size.w, r.size.h)
    await settle()
    return { ...page, viewport: viewport(), ...caused() }
  }
  if (r.op === 'screenshot') {
    const img = await wc.capturePage()
    if (img.isEmpty()) throw new Error('nothing painted yet: try again')
    return { url: page.url, png: img.toPNG().toString('base64'), viewport: viewport() }
  }
  if (r.op === 'text') return { ...page, text: await wc.executeJavaScript(`(document.body?.innerText ?? '').slice(0, 20000)`) }
  const was = await lines()
  if (r.op === 'back' || r.op === 'forward' || r.op === 'reload') {
    const h = wc.navigationHistory
    if (r.op === 'back' ? !h.canGoBack() : r.op === 'forward' && !h.canGoForward()) throw new Error(`no page ${r.op === 'back' ? 'before' : 'after'} this one`)
    r.op === 'back' ? h.goBack() : r.op === 'forward' ? h.goForward() : wc.reload()
  } else if (r.op === 'hover' || r.op === 'drag') {
    // the element's middle (the target's too), each scrolled into sight; then the mouse, as yours would move
    const at = await wc.executeJavaScript(
      pageJs(
        String((sels: string[]) => {
          const els = sels.map(s => document.querySelector(s) as HTMLElement | null)
          const no = els.findIndex(x => !x)
          if (no >= 0) return `no element matches ${sels[no]}`
          for (const x of els) x!.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          return els.map(x => {
            const b = x!.getBoundingClientRect()
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          })
        }),
        [r.selector ?? '', ...(r.op === 'drag' ? [r.to ?? ''] : [])],
      ),
    )
    if (typeof at === 'string') throw new Error(at)
    const send = await cdp(wc)
    const [a, b] = at as { x: number; y: number }[]
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y })
    if (r.op === 'drag') {
      // a draggable element's drag (HTML drag and drop) is caught as it starts and dropped on the target with its data;
      // a list that follows the mouse itself (pointer events) gets the moves and the release
      let data: unknown
      const caught = (_e: unknown, method: string, p: { data?: unknown }) => method === 'Input.dragIntercepted' && (data = p.data)
      wc.debugger.on('message', caught)
      try {
        await send('Input.setInterceptDrags', { enabled: true })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
        for (let k = 1; k <= 10; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10, button: 'left', buttons: 1 })
        await new Promise(ok => setTimeout(ok, 50))
        if (data) for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: b.x, y: b.y, data })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
      } finally {
        wc.debugger.off('message', caught)
        await send('Input.setInterceptDrags', { enabled: false }).catch(() => {})
      }
    }
  } else if (r.op === 'press') {
    const k = keyEvent(r.key ?? '') // throws on a key it doesn't know
    const send = await cdp(wc)
    await send('Input.dispatchKeyEvent', { ...k, type: k.text ? 'keyDown' : 'rawKeyDown' })
    await send('Input.dispatchKeyEvent', { ...k, type: 'keyUp', text: undefined })
  } else {
    // click, fill, select, check, scroll: the first element the selector finds, scrolled into sight; fill and select as
    // a user would (input and change events), check clicks it only when it isn't so already
    const found = await wc.executeJavaScript(
      pageJs(
        String((sel: string, op: string, text: string, off: boolean, px: number | null, edge: string | null) => {
          const el = (sel ? document.querySelector(sel) : op === 'scroll' ? (document.scrollingElement ?? document.documentElement) : null) as HTMLElement | null
          if (!el) return `no element matches ${sel}`
          if (op === 'scroll') {
            el.scrollTo({ top: edge === 'top' ? 0 : edge === 'bottom' ? el.scrollHeight : el.scrollTop + (px ?? el.clientHeight), behavior: 'instant' })
            return { top: Math.round(el.scrollTop), max: Math.max(0, el.scrollHeight - el.clientHeight) }
          }
          el.scrollIntoView({ block: 'center' })
          if (op === 'click') return el.click(), ''
          if (op === 'check') {
            const box: HTMLElement | null = el instanceof HTMLLabelElement ? el.control : el
            const input = box instanceof HTMLInputElement && /^(checkbox|radio)$/.test(box.type) ? box : null
            if (!box || (!input && !/^(checkbox|switch|radio)$/.test(box.getAttribute('role') ?? ''))) return `${sel} isn't a checkbox, a radio button or a switch`
            const on = () => (input ? input.checked : box.getAttribute('aria-checked') === 'true')
            if (on() !== !off) box.click()
            return on() === !off ? '' : `${sel} stayed ${on() ? 'on' : 'off'}`
          }
          const f = el as HTMLInputElement
          let value = text
          if (op === 'select') {
            if (!(el instanceof HTMLSelectElement)) return `${sel} isn't a <select>`
            const opts = [...el.options]
            const o = opts.find(x => x.text.trim() === text || x.value === text) ?? opts.find(x => x.text.trim().toLowerCase().includes(text.toLowerCase()))
            if (!o) return `${sel} has no option ${text}: ${opts.map(x => x.text.trim()).slice(0, 20).join(', ')}`
            value = o.value
          } else if (!('value' in f)) return `${sel} isn't a field`
          f.focus()
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), 'value')?.set?.call(f, value)
          f.dispatchEvent(new Event('input', { bubbles: true }))
          f.dispatchEvent(new Event('change', { bubbles: true }))
          return ''
        }),
        r.selector ?? '',
        r.op,
        r.text ?? '',
        !!r.off,
        typeof r.px === 'number' ? r.px : null,
        r.edge ?? null,
      ),
    )
    if (typeof found === 'string' && found) throw new Error(found)
    if (r.op === 'scroll') {
      await settle()
      return { url: wc.getURL(), title: wc.getTitle(), ...caused(), changed: pageChanges(was, await lines()), scrolled: found } satisfies BrowseDid
    }
  }
  await settle()
  let now = { url: wc.getURL(), title: wc.getTitle() }
  let changed = pageChanges(was, await lines())
  // an op that changed nothing yet, on the same page: a fetch it started may answer a moment later (one more look)
  // ponytail: one second; a slower answer still reads as (no changes)
  if (r.op !== 'fill' && !changed.length && now.url === page.url) {
    await new Promise(ok => setTimeout(ok, 1000))
    now = { url: wc.getURL(), title: wc.getTitle() }
    changed = pageChanges(was, await lines())
  }
  return { ...now, ...(now.url !== page.url && { nav: now }), ...caused(), changed } satisfies BrowseDid
}
