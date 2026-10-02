// One xterm.js per visible tab. It attaches to the daemon's session (snapshot, then the live stream)
// and detaches on unmount; switching tabs re-attaches. WebGL renders only this visible terminal.
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { api, openExternal } from './api'

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

export function Term({ tab, onReady }: { tab: string; onReady?: (t: Terminal) => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 13,
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
        term.write(`\r\n\x1b[2m[${(e as Error).message}]\x1b[0m\r\n`)
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
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => box.current?.offsetParent && fit.fit())
    })
    ro.observe(box.current!)
    if (api.connected) attach()
    term.focus()
    onReady?.(term)
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
  return <div className="term" ref={box} />
}
