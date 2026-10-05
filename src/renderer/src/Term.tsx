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
import { termTheme, transparent } from './themes'

export const xterms = new Map<string, Terminal>() // per tab: the KeyBar asks for its cursor-key mode

export function Term({
  tab,
  active = true,
  findSeq = 0,
  fontSize = FONT_SIZE,
  fontFamily,
  copyOnSelect = true,
  theme = '',
  look = termLook({}),
  newline = false,
}: {
  tab: string
  active?: boolean
  findSeq?: number
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  theme?: string // the app's (themes.ts): the colors come from its CSS
  look?: ReturnType<typeof termLook> // line height, weight, cursor… (Settings)
  newline?: boolean // an agent's: ⌘⏎ and ⇧⏎ make a new line in its prompt
}) {
  const nl = useRef(newline)
  nl.current = newline
  const copy = useRef(copyOnSelect)
  copy.current = copyOnSelect
  const box = useRef<HTMLDivElement>(null)
  const [xt, setXt] = useState<{ term: Terminal; search: SearchAddon; fit: FitAddon } | null>(null)
  const [closedAt, setClosedAt] = useState(findSeq) // ⌘F presses (findSeq) after this open the find bar
  const find = findSeq !== closedAt
  useEffect(() => {
    const term = new Terminal({
      fontFamily: fontStack(fontFamily),
      fontSize,
      ...look,
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: transparent(),
      macOptionIsMeta: true,
      theme: termTheme(),
      // OSC 8 links (claude's PR links): opened at once, as plain URLs are; xterm's own asks first. Main opens http(s) only
      linkHandler: { activate: (_e, uri) => openExternal(uri) },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => openExternal(uri)))
    const search = new SearchAddon()
    term.loadAddon(search)
    term.open(box.current!)
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
    const attach = async () => {
      try {
        const r = await api.call('attach', { tab, cols: term.cols, rows: term.rows })
        if (!alive) return
        term.reset()
        term.write(r.snapshot)
      } catch (e) {
        if (alive) term.write(`\r\n\x1b[2m[${(e as Error).message}]\x1b[0m\r\n`)
      }
    }
    const off = api.on(m => {
      if (m.tab === tab && m.ev === 'data') term.write(m.d)
      else if (m.tab === tab && m.ev === 'responder') responder = m.on
      else if (m.ev === 'open') attach()
    })
    // a keypress whose keydown went elsewhere isn't ours: Enter that closed a dialog and so focused this
    let down = false
    term.textarea?.addEventListener('focus', () => (down = false))
    term.attachCustomKeyEventHandler(e => {
      // ⌘⏎ / ⇧⏎ in an agent: ⌃J, a new line in claude's, codex's and opencode's prompt (xterm would send ⏎: submit)
      if (nl.current && e.key === 'Enter' && (e.metaKey || e.shiftKey) && !e.ctrlKey && !e.altKey) {
        if (e.type === 'keydown') api.send('input', { tab, data: '\n' })
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

const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
