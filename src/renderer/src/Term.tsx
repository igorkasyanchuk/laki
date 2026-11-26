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
import { type Big, IMAGE, LinkPeek, MD, type Peek, peekOf, TEXT } from './LinkPeek'
import { ago } from './Info'
import { Markdown } from './MarkdownView'
import { Modal } from './panels'
import { FONT_SIZE, fontStack, termLook } from './settingsBase'
import { wordTrim } from './text'
import { termTheme, transparent } from './themes'
import { closeTo, Icon, type IconName, openFrom } from './ui'
import { cellRange, wrappedLine } from './termLines'
import { osc52 } from '../../shared/osc52'

export const xterms = new Map<string, Terminal>() // per tab: the KeyBar asks for its cursor-key mode
// K1: two views of one terminal in a window (an extension's cell and its full view) share the window's socket: it
// detaches only as the last one goes, and the one left attaches again (its snapshot, its size); a read-only view doesn't
// size it while a live one shows it
const views = new Map<string, Map<() => void, boolean>>() // tab → each view's attach again, and whether it's read only

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
// a picture's path in plain text (claude's Read(src/a.png), a pasted screenshot's): a link that shows it on hover
// ponytail: a wide character (CJK) before it shifts the cells; a path broken over two lines isn't one
const PIC = /(?<=^|[\s'"`(\[<])\.{0,2}\/?(?:[\w@%+.-]+\/)*[\w@%+-][\w@%+.-]*\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?![\w/])/gi
// any other file's: a path with a folder in it (src/app.ts, ./lib/x.go, an absolute one), or a bare name with a line
// (App.tsx:42); its line (and column) after it. ponytail: a site's path in plain text (example.com/a.md) reads as one too
const CODE = /(?<=^|[\s'"`(\[<])(?:\.{0,2}\/?(?:[\w@%+.-]+\/)+[\w@%+-][\w@%+.-]*\.[A-Za-z]\w{0,9}|[\w@%+-][\w@%+.-]*\.[A-Za-z]\w{0,9}(?=:\d))(?::(\d+)(?::\d+)?)?(?![\w/])/g
const PICTURE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(:|$)/i

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
  onReply,
  onSelection,
  onCode,
  codeTo = 'preview',
  image,
  text,
  cwd,
  readOnly = false,
  pictures = true,
  savePicture,
  onClip,
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
  onReply?: (text: string, at: { x: number; y: number }) => void // Reply on selected text (none: no Reply)
  onSelection?: (text: string, how: SelectionUse) => void // ⌥ held by Reply: the selection as a new workspace's, tab's or Laki AI's prompt
  onCode?: (path: string, line: number | undefined, other: boolean) => void // a file path in its text clicked (other: ⌥ held)
  codeTo?: 'preview' | 'editor' // where a click opens one (Settings' fileClick), for its hover's words
  image?: (path: string) => Promise<string | undefined | null> // a hovered picture's data URL (an absolute path); null: no card
  text?: (path: string) => Promise<string | undefined | null> // a hovered Markdown file's text (an absolute path); null: no card
  cwd?: string // the workspace's folder: a relative picture path's
  readOnly?: boolean // K1: an extension's terminal in a cell: shown, no keys
  pictures?: boolean // its last pictures pasted or dropped, as chips at its top (Settings › Terminal: termPictures)
  savePicture?: (f: File) => Promise<string> // a pasted picture kept (imageSave): its path, typed in as a drop's
  onClip?: (text: string) => void // OSC 52: a program's copy (vim's, tmux's, over ssh), parsed (shared/osc52.ts); none: dropped
}) {
  const copy = useRef(copyOnSelect)
  copy.current = copyOnSelect
  const edit = useRef(editKeys)
  edit.current = editKeys
  const box = useRef<HTMLDivElement>(null)
  const file = useRef(onFile)
  file.current = onFile
  const props = useRef({ onReply, onSelection, onCode, codeTo, image, text, cwd, onClip })
  props.current = { onReply, onSelection, onCode, codeTo, image, text, cwd, onClip }
  // a link's hover card (LinkPeek): shown 400 ms after the pointer rests on one, gone 250 ms after it leaves both. xterm
  // drops the hovered link as its rows redraw and finds it again at once (a leave, then a hover): a TUI that redraws
  // often (claude's and codex's spinners) would start the wait over each time, so a card on its way, or shown, for that
  // link stays (peekAt) and only a leave that lasts 500 ms ends it (time to move onto the card and click it)
  const [peek, setPeek] = useState<Peek | null>(null)
  const [big, setBig] = useState<Big | null>(null) // a hovered picture opened larger
  const [pics, setPics] = useState<Pic[]>([]) // its last pictures pasted or dropped, the newest first
  const picsAdd = (paths: string[], pasted = false) => {
    const at = Date.now()
    const got = paths.filter(p => IMAGE.test(p)).map(path => ({ path, at, pasted }))
    if (got.length) setPics(was => [...got.reverse(), ...was.filter(x => !got.some(g => g.path === x.path))].slice(0, PICS))
  }
  const showT = useRef(0)
  const hideT = useRef(0)
  const peekAt = useRef('')
  // a path as an absolute one: a relative one under the workspace's folder ('' with none: a floated tab's)
  const absOf = (p: string) => (p.startsWith('/') ? p : props.current.cwd ? `${props.current.cwd}/${p.replace(/^\.\//, '')}` : '')
  const peekOn = (e: MouseEvent, uri: string) => {
    const path = filePath(uri) || (/^[a-z]+:/i.test(uri) ? '' : uri)
    const abs = path && absOf(path)
    const at = abs || uri
    const kind = peekOf(at)
    const read = kind === 'md' || kind === 'text' ? props.current.text : props.current.image
    // a file's picture, Markdown or text needs a reader; a web link, only GitHub's card
    if ((path && !abs) || !kind || (abs ? !read : kind !== 'gh')) return false
    clearTimeout(hideT.current)
    if (peekAt.current === at) return true
    clearTimeout(showT.current)
    peekAt.current = at
    const { clientX: x, clientY: y } = e
    // a Markdown file with no card (not the workspace's): its path and ⌘-click as any file link's
    const said = (s: string | null | undefined) => (s === null && kind !== 'img' && peekAt.current === at && box.current && (box.current.title = `${abs}\n⌘-click to open`), s)
    showT.current = window.setTimeout(() => setPeek({ uri: at, x, y, read: abs ? () => read!(abs).then(said) : undefined }), 400)
    return true
  }
  const peekGone = () => (clearTimeout(showT.current), clearTimeout(hideT.current), (peekAt.current = ''), setPeek(null))
  const peekOff = () => (clearTimeout(hideT.current), (hideT.current = window.setTimeout(peekGone, 500))) // time to reach the card
  // Reply: a pill under the selection as the mouse lets go, to quote it to an agent
  const [pill, setPill] = useState<{ x: number; y: number; text: string } | null>(null)
  const [alt, setAlt] = useState(false) // ⌥ held: the pill's other uses of the selection
  useEffect(() => {
    if (!pill) return
    const on = (e: KeyboardEvent) => setAlt(e.altKey)
    const off = () => setAlt(false) // ⌥ let go in another app: no keyup here
    addEventListener('keydown', on, true)
    addEventListener('keyup', on, true)
    addEventListener('blur', off)
    return () => (removeEventListener('keydown', on, true), removeEventListener('keyup', on, true), removeEventListener('blur', off))
  }, [pill])
  const [xt, setXt] = useState<{ term: Terminal; search: SearchAddon; fit: FitAddon } | null>(null)
  const [closedAt, setClosedAt] = useState(findSeq) // ⌘F presses (findSeq) after this open the find bar
  // the scroll button (on hover): to the top of the scrollback, and back down from there. ponytail: xterm's own scrollback
  // only; a TUI on the alternate screen (claude's fullscreen) keeps its own, so none there
  const [jump, setJump] = useState<'top' | 'end' | null>(null)
  const find = findSeq !== closedAt
  useEffect(() => {
    let over = false // the pointer is on a link
    const term = new Terminal({
      fontFamily: fontStack(fontFamily),
      fontSize,
      ...look,
      disableStdin: api.answerOnly, // D7
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: transparent(),
      macOptionIsMeta: true,
      cursorInactiveStyle: 'outline', // a split's other panes (Dim other panes): their cursor an outline, the focused one's as set
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
        hover: (e, uri) => ((over = true), !peekOn(e, uri) && box.current && (box.current.title = `${filePath(uri) || uri}\n⌘-click to open`)),
        leave: () => ((over = false), peekOff(), box.current && (box.current.title = '')),
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // a plain URL (its words are its address): a click, ⌘-click when an app has the mouse (codex opens its own: `ours`)
    term.loadAddon(new WebLinksAddon((e, uri) => ours(e) && openExternal(uri), { hover: (e, uri) => ((over = true), !peekOn(e, uri) && box.current && (box.current.title = uri)), leave: () => ((over = false), peekOff(), box.current && (box.current.title = '')) }))
    term.registerLinkProvider({
      provideLinks: (y, cb) => {
        // the whole line row y is in: a path wrapped over rows is one link on each of them (termLines.ts)
        const { top, text: line } = wrappedLine(i => term.buffer.active.getLine(i), y - 1)
        const at = (m: RegExpMatchArray) => cellRange(m.index!, m[0].length, term.cols, top)
        const here = (m: RegExpMatchArray) => (r => r.start.y <= y && y <= r.end.y)(at(m)) // the ones on this row
        const found = /\.(png|jpe?g|gif|webp|svg|bmp|avif)\b/i.test(line) ? [...line.matchAll(PIC)].filter(m => here(m) && absOf(m[0])) : []
        // a file's: ⌘-click (⌃ too, unless an app has the mouse), as a picture's and a file:// link's: a plain click, or a
        // double-click's first, would open it as you select a path. It opens where Settings says, ⌥ the other way
        const code = props.current.onCode && props.current.cwd && /\.[A-Za-z]/.test(line) ? [...line.matchAll(CODE)].filter(m => here(m) && !PICTURE.test(m[0]) && !found.some(p => p.index < m.index + m[0].length && m.index < p.index + p[0].length)) : []
        const to = (alt: boolean) => ((props.current.codeTo === 'editor') !== alt ? 'your editor' : "Laki's preview")
        cb(
          found.length || code.length
            ? [
                ...found.map(m => ({
                  range: at(m),
                  text: m[0],
                  // ⌘-click (⌃ too, unless an app has the mouse) opens it as a file:// link's
                  activate: (e: MouseEvent, t: string) => (e.metaKey || (e.ctrlKey && !tracked())) && file.current?.(absOf(t)),
                  hover: (e: MouseEvent, t: string) => ((over = true), peekOn(e, t)),
                  leave: () => ((over = false), peekOff()),
                })),
                ...code.map(m => ({
                  range: at(m),
                  text: m[0],
                  activate: (e: MouseEvent, t: string) => (e.metaKey || (e.ctrlKey && !tracked())) && props.current.onCode?.(absOf(t.replace(/(:\d+)+$/, '')), m[1] ? Number(m[1]) : undefined, e.altKey),
                  hover: (e: MouseEvent, t: string) => ((over = true), ((MD.test(t) || TEXT.test(t)) && peekOn(e, t)) || (box.current && (box.current.title = `${m[0]}\n⌘-click: ${to(false)} · ⌘⌥-click: ${to(true)}`))), // a Markdown file's: its card
                  leave: () => ((over = false), peekOff(), box.current && (box.current.title = '')),
                })),
              ]
            : undefined,
        )
      },
    })
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
    term.element?.addEventListener('mousedown', () => ((term.options.altClickMovesCursor = !tracked()), setPill(null)), true)
    // a selection made where an app has every move (claude's fullscreen: ⌥-drag) stays while the mouse moves: xterm sends
    // a move as input, and input clears the selection (gone before ⌘C or Reply). A click, a key or a scroll still does
    box.current!.addEventListener('mousemove', e => !e.buttons && tracked() && term.hasSelection() && e.stopPropagation(), true)
    term.element?.addEventListener('mouseup', e => {
      if (e.button === 0 && (props.current.onReply || props.current.onSelection)) setTimeout(() => term.getSelection().trim() && (setAlt(e.altKey), setPill({ x: e.clientX, y: e.clientY, text: term.getSelection() }))) // after xterm's own mouseup ends the selection
    })
    term.element?.addEventListener('wheel', () => setPill(null), { passive: true }) // a scroll of yours: new output scrolls too, and keeps it
    const where = () => {
      const b = term.buffer.active
      setJump(b.type !== 'normal' || !b.baseY ? null : b.viewportY > 0 ? 'top' : 'end')
    }
    term.onScroll(where)
    term.buffer.onBufferChange(where)
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
      // OSC 52: a copy to the Mac's clipboard, only in the app's own window (the bridge: never a phone's page) and a view
      // with keys (one write per window); a read ("?") never answered. Always swallowed
      p.registerOscHandler(52, d => (!readOnly && bridge && (c => c && props.current.onClip?.(c.text))(osc52(d)), true)),
    ]

    let alive = true
    const peers = views.get(tab) ?? new Map<() => void, boolean>()
    views.set(tab, peers)
    const sizing = () => !readOnly || ![...peers.values()].some(r => !r) // a live view of it sizes it
    const attach = async (quiet = false) => {
      try {
        // attach: the socket's own, not in the api table (callAny)
        const r = await api.callAny('attach', { tab, ...(sizing() && { cols: term.cols, rows: term.rows }), ...(readOnly && { ro: true }) }) // ro: it can't answer the program's queries (disableStdin), so never the responder
        if (!alive) return
        term.reset()
        term.write(r.snapshot, where) // the scroll button as the snapshot leaves it
      } catch (e) {
        if (alive && !quiet) term.write(`\r\n\x1b[2m[${(e as Error).message}]\x1b[0m\r\n`) // quiet: a closed tab's, going
      }
    }
    const off = api.on(m => {
      if (m.tab === tab && m.ev === 'data') term.write(m.d)
      else if (m.tab === tab && m.ev === 'responder') responder = m.on
      else if (m.tab === tab && m.ev === 'exit' && m.code === -1) attach(true) // the daemon replaced its session (a restart, a wake): the new one's
      else if (m.ev === 'open') attach()
      else if (m.ev === 'state') term.options.disableStdin = api.answerOnly // D7: answer only: no keys (the Reader's box sends to an agent)
    })
    // a keypress whose keydown went elsewhere isn't ours: Enter that closed a dialog and so focused this
    let down = false
    term.textarea?.addEventListener('focus', () => (down = false))
    term.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && !MODS.includes(e.key) && !(e.metaKey && e.key === 'c')) setPill(null) // ⌥ alone, ⌘C: Reply stays
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
    if (readOnly) term.options.disableStdin = true
    term.onData(d => readOnly || api.send('input', { tab, data: d }))
    term.onBinary(d => readOnly || api.send('input', { tab, data: d }))
    term.onResize(({ cols, rows }) => sizing() && api.send('resize', { tab, cols, rows }))
    // a selection goes to the clipboard as you make it (Settings: Copy selected text)
    term.onSelectionChange(() => {
      const text = term.getSelection()
      if (copy.current && text) navigator.clipboard.writeText(text).catch(() => {})
      if (!text) setPill(null)
    })
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => box.current?.offsetParent && fit.fit())
    })
    ro.observe(box.current!)
    // the size is the last client's to look (a phone, then this Mac): back here, it's this one's again
    const mine = () => document.visibilityState === 'visible' && sizing() && api.send('resize', { tab, cols: term.cols, rows: term.rows })
    window.addEventListener('focus', mine)
    document.addEventListener('visibilitychange', mine)
    const again = () => void attach(true)
    peers.set(again, readOnly)
    if (api.connected) attach()
    setXt({ term, search, fit })
    ;(window as any).__term = term // for inspection in dev tools
    xterms.set(tab, term)
    return () => {
      alive = false
      clearTimeout(showT.current)
      clearTimeout(hideT.current)
      peers.delete(again)
      if (peers.size) [...peers.keys()].at(-1)!() // another view of it here: it stays attached, as that one
      else views.delete(tab), api.send('detach', { tab })
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
          const paths = [...e.dataTransfer.files].map(f => bridge!.pathOf!(f))
          xt.term.paste(`${paths.map(quote).join(' ')} `)
          picsAdd(paths)
          xt.term.focus()
        }}
        // a picture pasted (⌘V of a screenshot, no text with it): kept, its path typed in as a drop's, before xterm,
        // which pastes text only, sees it
        onPasteCapture={e => {
          const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/'))
          if (!f || !savePicture || !xt || readOnly || e.clipboardData.getData('text/plain')) return
          e.preventDefault()
          e.stopPropagation()
          void savePicture(f).then(
            path => void (xt.term.element?.isConnected && (xt.term.paste(`${quote(path)} `), picsAdd([path], true))), // its tab closed meanwhile: nothing
            err => xt.term.element?.isConnected && xt.term.write(`\r\n\x1b[2m(the picture was not pasted: ${String(err?.message ?? err).replace(/[\x00-\x1f]/g, ' ')})\x1b[0m\r\n`),
          )
        }}
      />
      {pictures && pics.length > 0 && !find && <TermPics pics={pics} image={image} cwd={cwd} onOpen={setBig} />}
      {jump && xt && !find && (
        <button type="button" className={`term-jump ${jump}`} aria-label={jump === 'top' ? 'Scroll to the top' : 'Scroll to the end'} data-tip={jump === 'top' ? 'Scroll to the top' : 'Back to the end'} onMouseDown={e => e.preventDefault() /* the keyboard stays in the terminal */} onClick={() => (jump === 'top' ? xt.term.scrollToTop() : xt.term.scrollToBottom())}>
          <Icon name={jump === 'top' ? 'arrowUp' : 'arrowDown'} size={13} />
        </button>
      )}
      {find && xt && <FindBar term={xt.term} search={xt.search} seq={findSeq} onClose={() => setClosedAt(findSeq)} />}
      {pill && (onReply || (alt && onSelection)) && (
        <span className="term-reply" style={{ left: Math.min(pill.x + 6, innerWidth - (alt && onSelection ? 420 : 90)), top: Math.min(pill.y + 10, innerHeight - 34) }} onMouseDown={e => e.preventDefault() /* the selection stays */}>
          {onReply && (
            <button type="button" data-tip={onSelection && !alt ? 'Hold ⌥ for a new workspace, tab or Laki AI with it' : undefined} onClick={() => (onReply(pill.text, { x: pill.x, y: pill.y }), setPill(null))}>
              <Icon name="reply" size={12} /> Reply
            </button>
          )}
          {alt &&
            onSelection &&
            USES.map(([how, icon, label]) => (
              <button key={how} type="button" onClick={() => (onSelection(pill.text, how), setPill(null))}>
                <Icon name={icon} size={12} /> {label}
              </button>
            ))}
        </span>
      )}
      {peek && <LinkPeek key={peek.uri /* another link: a card of its own */} peek={peek} onEnter={() => clearTimeout(hideT.current)} onLeave={peekGone} onOpen={b => openFrom(document.querySelector('.link-peek .lp-img'), () => (peekGone(), setBig(b)))} />}
      {big && (
        <Modal title={big.size ? `${big.name} · ${big.size}` : big.name} onClose={() => closeTo(() => setBig(null))} loose>
          <div className="art-big lp-big" data-zoom>
            {big.kind === 'md' ? <div className="lp-big-md"><Markdown src={big.src.slice(0, 200_000)} /></div> : big.kind === 'text' ? <pre className="lp-big-text">{big.src.slice(0, 500_000)}</pre> : <img src={big.src} alt={big.name} />}
          </div>
        </Modal>
      )}
    </>
  )
}

// a terminal's recent pictures (pasted or dropped, PICS at most): chips at its top right, its name each; resting on one
// shows its thumbnail, path, when, size and dimensions, with Open (larger, Term's modal), Copy path and Reveal in Finder
const PICS = 4
type Pic = { path: string; at: number; pasted: boolean }
const sizeOf = (url: string) => (n => (n < 1 << 20 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1 << 20)).toFixed(1)} MB`))(Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4))
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const picName = (p: Pic) => (p.pasted ? `Pasted image ${hhmm(p.at)}` : (p.path.split('/').pop() ?? p.path))
function TermPics({ pics, image, cwd, onOpen }: { pics: Pic[]; image?: (path: string) => Promise<string | undefined | null>; cwd?: string; onOpen: (b: Big) => void }) {
  const [on, setOn] = useState<Pic | null>(null)
  const [src, setSrc] = useState<{ path: string; url?: string; dim?: string; err?: string }>()
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  useEffect(() => {
    const p = on?.path
    if (!p || src?.path === p) return
    setSrc({ path: p })
    void (image?.(p) ?? Promise.resolve(undefined)).then(
      url => setSrc(s => (s?.path === p ? { path: p, ...(url ? { url } : { err: 'No preview' }) } : s)),
      e => setSrc(s => (s?.path === p ? { path: p, err: String(e?.message ?? e) } : s)),
    )
  }, [on?.path])
  const rest = (pic: Pic | null) => (clearTimeout(t.current), (t.current = window.setTimeout(() => setOn(pic), pic ? (on ? 0 : 300) : 250)))
  const shown = on && src?.path === on.path ? src : undefined
  const rel = (p: string) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p.replace(/^\/Users\/[^/]+/, '~'))
  return (
    <div className="term-pics" onPointerLeave={() => rest(null)}>
      {pics.map(p => (
        <button key={p.path} type="button" className={`term-pic ${on?.path === p.path ? 'on' : ''}`} aria-label={`${picName(p)}: ${p.path}`} onPointerEnter={() => rest(p)} onFocus={() => rest(p)} onClick={() => shown?.url && onOpen({ src: shown.url, name: picName(p), size: [shown.dim, sizeOf(shown.url)].filter(Boolean).join(' · ') })}>
          <Icon name="image" size={11} />
          <span>{picName(p)}</span>
        </button>
      ))}
      {on && (
        <div className="term-pic-card" role="dialog" aria-label={picName(on)} onPointerEnter={() => clearTimeout(t.current)}>
          <div className="term-pic-thumb">
            {shown?.url ? <img src={shown.url} alt={picName(on)} onLoad={e => (img => setSrc(s => (s?.path === on.path ? { ...s, dim: `${img.naturalWidth}×${img.naturalHeight}` } : s)))(e.currentTarget)} /> : <span className="muted small">{shown?.err ?? 'Loading…'}</span>}
          </div>
          <div className="term-pic-meta">
            <b className="mono" data-tip={on.path}>{rel(on.path)}</b>
            <span className="muted small">{[`${on.pasted ? 'pasted' : 'dropped'} ${ago(on.at)}`, shown?.url && sizeOf(shown.url), shown?.dim].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="term-pic-acts">
            <button type="button" className="sm" disabled={!shown?.url} onClick={() => shown?.url && onOpen({ src: shown.url, name: picName(on), size: [shown.dim, sizeOf(shown.url)].filter(Boolean).join(' · ') })}>Open</button>
            <button type="button" className="sm" onClick={() => void navigator.clipboard.writeText(on.path).catch(() => {})}>Copy path</button>
            {bridge?.reveal && <button type="button" className="sm" onClick={() => void bridge!.reveal!(on.path)}>Reveal in Finder</button>}
          </div>
        </div>
      )}
    </div>
  )
}

const MODS = ['Alt', 'Meta', 'Shift', 'Control', 'CapsLock']
export type SelectionUse = 'workspace' | 'tab' | 'ai'
const USES: [SelectionUse, IconName, string][] = [
  ['workspace', 'plus', 'New workspace'],
  ['tab', 'agent', 'New tab here'],
  ['ai', 'ai', 'Ask Laki AI'],
]
// macOS editing keys as iTerm's Natural Text Editing sends them (xterm sends nothing for ⌘← ⌘→, a plain ⌫ for ⌘⌫):
// line start and end (⌃A ⌃E), delete the line (⌃U), a word back and on (Esc b, Esc f)
const EDIT_KEYS: Record<string, string> = { '⌘ArrowLeft': '\x01', '⌘ArrowRight': '\x05', '⌘Backspace': '\x15', '⌥ArrowLeft': '\x1bb', '⌥ArrowRight': '\x1bf' }

const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
