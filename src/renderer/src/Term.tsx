// One xterm.js per visible tab. It attaches to the daemon's session (snapshot, then the live stream)
// and detaches on unmount; switching tabs re-attaches. WebGL renders only this visible terminal.
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { api, openExternal } from './api'
import { FindBar } from './Find'
import { FONT_SIZE, fontStack } from './Settings'

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

function theme() {
  return {
    background: css('--term-bg'),
    foreground: css('--fg'),
    cursor: css('--accent'),
    selectionBackground: css('--sel'),
    black: '#1b1e25', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
    brightBlack: '#565f89', brightRed: '#ff899d', brightGreen: '#b9f27c', brightYellow: '#ffc777', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff', brightCyan: '#a4daff', brightWhite: '#e6e9f5',
  }
}

export function Term({
  tab,
  active = true,
  findSeq = 0,
  fontSize = FONT_SIZE,
  fontFamily,
  copyOnSelect = true,
}: {
  tab: string
  active?: boolean
  findSeq?: number
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
}) {
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
      lineHeight: 1.15,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      cursorBlink: true,
      theme: theme(),
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
    if (api.connected) attach()
    setXt({ term, search, fit })
    ;(window as any).__term = term // for inspection in dev tools
    return () => {
      alive = false
      api.send('detach', { tab })
      off()
      ro.disconnect()
      hooks.forEach(h => h.dispose())
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
  return (
    <>
      <div className="term" ref={box} />
      {find && xt && <FindBar term={xt.term} search={xt.search} seq={findSeq} onClose={() => setClosedAt(findSeq)} />}
    </>
  )
}
