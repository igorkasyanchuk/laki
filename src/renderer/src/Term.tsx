// One xterm.js per visible tab. It attaches to the daemon's session (snapshot, then the live stream)
// and detaches on unmount; switching tabs re-attaches. WebGL renders only this visible terminal.
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { api, bridge, openExternal } from './api'
import { FindBar } from './Find'
import { FONT_SIZE, fontStack, termLook } from './Settings'
import { wordTrim } from './text'
import { termTheme, transparent } from './themes'

export const xterms = new Map<string, Terminal>() // per tab: the KeyBar asks for its cursor-key mode

// a file:// link's path (any host: claude puts the Mac's name there), or a bare absolute path; '' for any other link
const filePath = (uri: string) => {
  if (uri.startsWith('/')) return uri
  try {
    const u = new URL(uri)
    return u.protocol === 'file:' ? decodeURIComponent(u.pathname) : ''
  } catch {
    return ''
  }
}

export function Term({
  tab,
  active = true,
  findSeq = 0,
  fontSize = FONT_SIZE,
  fontFamily,
  copyOnSelect = true,
  editKeys = true,
  theme = '',
  look = termLook({}),
  onFile,
}: {
  tab: string
  active?: boolean
  findSeq?: number
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  editKeys?: boolean // ⌘← ⌘→ ⌘⌫ ⌥← ⌥→: EDIT_KEYS
  theme?: string // the app's (themes.ts): the colors come from its CSS
  look?: ReturnType<typeof termLook> // line height, weight, cursor… (Settings)
  onFile?: (path: string) => void // a ⌘-clicked file:// link's path
}) {
  const copy = useRef(copyOnSelect)
  copy.current = copyOnSelect
  const edit = useRef(editKeys)
  edit.current = editKeys
  const box = useRef<HTMLDivElement>(null)
  const file = useRef(onFile)
  file.current = onFile
  const [xt, setXt] = useState<{ term: Terminal; search: SearchAddon; fit: FitAddon } | null>(null)
  const [closedAt, setClosedAt] = useState(findSeq) // ⌘F presses (findSeq) after this open the find bar
  const find = findSeq !== closedAt
  useEffect(() => {
    let over = false // the pointer is on a link
    const term = new Terminal({
      fontFamily: fontStack(fontFamily),
      fontSize,
      ...look,
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: transparent(),
      macOptionIsMeta: true,
      // ⌥-click and ⌥-drag select even while an app has the mouse (claude's fullscreen TUI picks its own words, the dot
      // in): xterm's selection, trimmed and copied as any. ponytail: ⌥-drag's block selection goes with it
      macOptionClickForcesSelection: true,
      theme: termTheme(),
      // OSC 8 links (text over an address, claude's PR links and paths): on ⌘-click only (L13: the words may not be where
      // it goes), its address on hover; a file:// one also on ⌃-click unless an app has the mouse. In a browser elsewhere
      // (a phone, no bridge) a tap opens a web one. main opens http(s) only
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (e, uri) => (/^https?:/i.test(uri) ? (e.metaKey || !bridge) && openExternal(uri) : filePath(uri) && (e.metaKey || (e.ctrlKey && !tracked())) && file.current?.(filePath(uri))),
        hover: (_e, uri) => ((over = true), box.current && (box.current.title = `${filePath(uri) || uri}\n⌘-click to open`)),
        leave: () => ((over = false), box.current && (box.current.title = '')),
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // a plain URL (its words are its address): a click, ⌘-click when an app has the mouse (codex opens its own: `ours`)
    term.loadAddon(new WebLinksAddon((e, uri) => ours(e) && openExternal(uri), { hover: (_e, uri) => ((over = true), box.current && (box.current.title = uri)), leave: () => ((over = false), box.current && (box.current.title = '')) }))
    const search = new SearchAddon()
    term.loadAddon(search)
    term.open(box.current!)
    // ⌘-click on a link with the mouse captured: the link's ours, and the app never hears of it (it would open it too: two
    // tabs). xterm's link handler is on .xterm-screen, its mouse report on .xterm above it: stop the press in between. In
    // a browser elsewhere (a phone) a tap is ours too: the app's would open on the Mac
    const tracked = () => term.modes.mouseTrackingMode !== 'none'
    const ours = (e: MouseEvent) => e.metaKey || !tracked() || !bridge
    term.element?.querySelector('.xterm-screen')?.addEventListener('mousedown', e => {
      const m = e as MouseEvent
      if (!m.metaKey || m.button !== 0 || !over || !tracked()) return
      e.stopPropagation()
      e.preventDefault()
      term.focus()
    })
    // a double-clicked word without the punctuation after it ("it." is it): xterm's word breaks leave . : ; ! ? in, so
    // file.ts and a URL stay whole; the trailing ones go (one cell each). ponytail: a leading one stays
    term.element?.addEventListener('dblclick', () => {
      const at = term.getSelectionPosition()
      const n = wordTrim(term.getSelection())
      if (!at || !n) return
      const cells = (at.end.y - at.start.y) * term.cols + at.end.x - at.start.x
      term.select(at.start.x, at.start.y, cells - n)
    })
    // a quick ⌥-click moves a shell's cursor there (arrow keys); with the mouse an app's, that click is a forced
    // selection's (above), and ↑ would be claude's last prompt: off then
    term.element?.addEventListener('mousedown', () => (term.options.altClickMovesCursor = !tracked()), true)
    try {
      const gl = new WebglAddon()
      gl.onContextLoss(() => gl.dispose())
      term.loadAddon(gl)
    } catch {} // no WebGL: the DOM renderer it is
    fit.fit()

    // Replies to terminal queries come from exactly one emulator: this one only while the daemon says
    // we're the responder (newest attached client). A handler returning true swallows the query.
    let responder = false
    const mute = () => !responder
    const p = term.parser
    const hooks = [
      p.registerCsiHandler({ final: 'c' }, mute), // DA1
      p.registerCsiHandler({ prefix: '>', final: 'c' }, mute), // DA2
      p.registerCsiHandler({ final: 'n' }, ps => mute() && (ps[0] === 5 || ps[0] === 6)), // DSR, CPR
      p.registerCsiHandler({ prefix: '?', final: 'n' }, mute),
      p.registerCsiHandler({ intermediates: '$', final: 'p' }, mute), // DECRQM
      p.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, mute),
      p.registerCsiHandler({ prefix: '>', final: 'q' }, mute), // XTVERSION
      p.registerDcsHandler({ intermediates: '$', final: 'q' }, mute), // DECRQSS
      ...[4, 10, 11, 12].map(n => p.registerOscHandler(n, d => mute() && d.includes('?'))), // color queries
    ]

    let alive = true
    const attach = async (quiet = false) => {
      try {
        const r = await api.call('attach', { tab, cols: term.cols, rows: term.rows })
        if (!alive) return
        term.reset()
        term.write(r.snapshot)
      } catch (e) {
        if (alive && !quiet) term.write(`\r\n\x1b[2m[${(e as Error).message}]\x1b[0m\r\n`) // quiet: a closed tab's, going
      }
    }
    const off = api.on(m => {
      if (m.tab === tab && m.ev === 'data') term.write(m.d)
      else if (m.tab === tab && m.ev === 'responder') responder = m.on
      else if (m.tab === tab && m.ev === 'exit' && m.code === -1) attach(true) // the daemon replaced its session (a restart, a wake): the new one's
      else if (m.ev === 'open') attach()
    })
    // a keypress whose keydown went elsewhere isn't ours: Enter that closed a dialog and so focused this
    let down = false
    term.textarea?.addEventListener('focus', () => (down = false))
    term.attachCustomKeyEventHandler(e => {
      // ⌘⏎ / ⇧⏎: ⌃J, a new line in claude's, codex's and opencode's prompt (xterm would send ⏎: submit), in any tab: claude
      // started in a terminal tab too; a shell runs the line on ⌃J as on ⏎. ponytail: a TUI that reads ⌃J as ↓ (fzf) gets ↓
      if (e.key === 'Enter' && (e.metaKey || e.shiftKey) && !e.ctrlKey && !e.altKey && !e.isComposing) {
        if (e.type === 'keydown') api.send('input', { tab, data: '\n' })
        return false
      }
      const only = !e.ctrlKey && !e.shiftKey && e.metaKey !== e.altKey // ⌘ or ⌥, not both
      const seq = edit.current && only && EDIT_KEYS[`${e.metaKey ? '⌘' : '⌥'}${e.key}`]
      if (seq) {
        e.preventDefault() // a browser's own: ⌘← and Alt+← are Back
        if (e.type === 'keydown') api.send('input', { tab, data: seq })
        return false
      }
      return e.type === 'keydown' ? (down = true) : e.type === 'keyup' ? !(down = false) : down
    })
    term.onData(d => api.send('input', { tab, data: d }))
    term.onBinary(d => api.send('input', { tab, data: d }))
    term.onResize(({ cols, rows }) => api.send('resize', { tab, cols, rows }))
    // a selection goes to the clipboard as you make it (Settings: Copy selected text)
    term.onSelectionChange(() => {
      const text = term.getSelection()
      if (copy.current && text) navigator.clipboard.writeText(text).catch(() => {})
    })
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => box.current?.offsetParent && fit.fit())
    })
    ro.observe(box.current!)
    // the size is the last client's to look (a phone, then this Mac): back here, it's this one's again
    const mine = () => document.visibilityState === 'visible' && api.send('resize', { tab, cols: term.cols, rows: term.rows })
    window.addEventListener('focus', mine)
    document.addEventListener('visibilitychange', mine)
    if (api.connected) attach()
    setXt({ term, search, fit })
    ;(window as any).__term = term // for inspection in dev tools
    xterms.set(tab, term)
    return () => {
      alive = false
      api.send('detach', { tab })
      off()
      ro.disconnect()
      window.removeEventListener('focus', mine)
      document.removeEventListener('visibilitychange', mine)
      hooks.forEach(h => h.dispose())
      if (xterms.get(tab) === term) xterms.delete(tab)
      term.dispose()
    }
  }, [tab])
  useEffect(() => {
    if (active) xt?.term.focus()
  }, [active, xt])
  useEffect(() => {
    if (!xt) return
    const family = fontStack(fontFamily)
    if (xt.term.options.fontSize === fontSize && xt.term.options.fontFamily === family) return
    xt.term.options.fontSize = fontSize
    xt.term.options.fontFamily = family
    xt.fit.fit()
  }, [fontSize, fontFamily, xt])
  const lookKey = JSON.stringify(look)
  useEffect(() => {
    if (!xt) return
    Object.assign(xt.term.options, look)
    xt.fit.fit()
  }, [lookKey, xt])
  useEffect(() => {
    if (!xt) return
    xt.term.options.allowTransparency = transparent()
    xt.term.options.theme = termTheme()
  }, [theme, xt])
  return (
    <>
      <div
        className="term"
        ref={box}
        // files dropped on it: their paths, typed in (quoted for a shell), as Finder's drop does in Terminal; the window's
        // own drop (a folder becomes a project) then leaves it
        onDragOver={e => bridge?.pathOf && e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={e => {
          if (!bridge?.pathOf || !e.dataTransfer.files.length || !xt) return
          e.preventDefault()
          xt.term.paste(`${[...e.dataTransfer.files].map(f => quote(bridge!.pathOf!(f))).join(' ')} `)
          xt.term.focus()
        }}
      />
      {find && xt && <FindBar term={xt.term} search={xt.search} seq={findSeq} onClose={() => setClosedAt(findSeq)} />}
    </>
  )
}

// macOS editing keys as iTerm's Natural Text Editing sends them (xterm sends nothing for ⌘← ⌘→, a plain ⌫ for ⌘⌫):
// line start and end (⌃A ⌃E), delete the line (⌃U), a word back and on (Esc b, Esc f)
const EDIT_KEYS: Record<string, string> = { '⌘ArrowLeft': '\x01', '⌘ArrowRight': '\x05', '⌘Backspace': '\x15', '⌥ArrowLeft': '\x1bb', '⌥ArrowRight': '\x1bf' }

const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
