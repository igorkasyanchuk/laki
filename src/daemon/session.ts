// A Session is one PTY plus a headless xterm that mirrors it, so any client can (re)attach and get the
// exact screen back (snapshot) followed by the live stream.
//
// Terminal queries (DA, DSR, CPR, OSC color…) are answered exactly once: by the newest attached client's
// xterm.js (the "responder"; the renderer mutes its own replies when it isn't one), otherwise by the
// headless terminal. A client becomes attached at the snapshot point, i.e. after the headless terminal has
// parsed everything written before it, so every query is seen by exactly one answering emulator.
import pty from '@lydell/node-pty'
import headless from '@xterm/headless'
import serializeAddon from '@xterm/addon-serialize'

export type Client = { id: number; send(msg: unknown): void }

type IPty = ReturnType<typeof pty.spawn>

const SCROLLBACK = 5000

// The serialize addon drops OSC 8 links (claude's [#12](url), with FORCE_HYPERLINK): a reattached terminal would show
// #12 and lose the URL. Its row writer gets a buffer whose cells carry the link's open and close in their text: a
// link's first character opens it, the next character outside it closes it. The writer reads the cells in order, and
// peeks around a soft wrap (a row's last cells, the next row's first) and back (the cursor style's): only a cell past
// the furthest one read moves the link on. ponytail: the addon's private _serializeBufferByRange and xterm's cell
// internals (extended.urlId, the link service); test/snapshot.test.ts fails when either moves
const CLOSE = '\x1b]8;;\x1b\\'
function keepLinks(ser: any, core: any) {
  const byRange = ser._serializeBufferByRange
  if (typeof byRange !== 'function') return
  ser._serializeBufferByRange = (term: unknown, buf: any, range: unknown, excl: unknown) => {
    let open = 0 // the link the text written so far is in
    let at = -1 // the furthest cell read (row * 65536 + column), and what its text starts with
    let seq = ''
    const mark = (cell: any, y: number, x: number) => {
      const pos = y * 65536 + x
      if (pos > at) {
        at = pos
        seq = ''
        if (cell && cell.getWidth() > 0 && cell.getChars() !== '') {
          // blanks are cursor moves: no text to carry it
          const id = cell.hasExtendedAttrs() ? cell.extended?.urlId || 0 : 0
          if (id !== open) {
            const data = id ? core._oscLinkService?.getLinkData(id) : undefined
            seq = (open ? CLOSE : '') + (data?.uri ? `\x1b]8;${data.id ? `id=${data.id}` : ''};${data.uri}\x1b\\` : '')
            open = data?.uri ? id : 0
          }
        }
      }
      if (pos < at || !seq) return cell
      const chars = seq + cell.getChars()
      return Object.create(cell, { getChars: { value: () => chars } }) // the cell as it is, its text with the link's
    }
    let last: { y: number; line: any } | undefined // the writer asks for a row again at each style change
    const getLine = (y: number) => {
      if (last?.y === y) return last.line
      const line = buf.getLine(y)
      last = { y, line: line && Object.create(line, { getCell: { value: (x: number, c?: unknown) => mark(line.getCell(x, c), y, x) } }) }
      return last.line
    }
    return byRange.call(ser, term, Object.create(buf, { getLine: { value: getLine } }), range, excl) + (open ? CLOSE : '')
  }
}

export class Session {
  readonly tab: string
  readonly pty: IPty
  readonly term: InstanceType<typeof headless.Terminal>
  private ser = new serializeAddon.SerializeAddon()
  private clients = new Map<Client, { ready: boolean; pending: string[]; size?: [number, number] }>() // size: the client's own
  responder: Client | null = null
  exited = false
  exitCode = 0
  note = '' // what end() said: printed instead of the exit line
  readonly born = Date.now()
  lastOutput = Date.now() // when the program last printed
  lookedAt = 0 // when a client last stopped looking (detach): a sleep counts from then too
  title = '' // the window title it set (OSC 0/2): gemini's and grok's say whether they work or ask
  onExit: (code: number) => void = () => {}
  onOutput: (data: string) => void = () => {}
  onHook: (data: string) => void = () => {} // OSC 7717: a hook on an SSH host reports through the tab's own terminal (core.ts)

  constructor(tab: string, file: string, args: string[], opts: { cwd: string; env: Record<string, string>; cols?: number; rows?: number }) {
    this.tab = tab
    const cols = opts.cols || 120
    const rows = opts.rows || 32
    this.term = new headless.Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
    this.term.loadAddon(this.ser as any)
    keepLinks(this.ser, (this.term as any)._core)
    this.term.onTitleChange(t => (this.title = t))
    this.term.parser.registerOscHandler(7717, d => (this.onHook(d), true))
    // headless replies go to the PTY only while no client answers instead
    this.term.onData(d => {
      if (!this.responder && !this.exited) this.pty.write(d)
    })
    this.pty = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: opts.cwd, env: opts.env })
    this.pty.onData(d => this.output(d))
    this.pty.onExit(({ exitCode: code, signal }) => {
      const exitCode = signal ? 128 + signal : code // killed: not a clean exit
      this.exited = true
      this.exitCode = exitCode
      this.output(this.note || `\r\n\x1b[2m[process exited${exitCode ? ` with code ${exitCode}` : ''}]\x1b[0m\r\n`)
      for (const c of this.clients.keys()) c.send({ ev: 'exit', tab: this.tab, code: exitCode })
      this.onExit(exitCode)
    })
  }

  output(d: string) {
    this.lastOutput = Date.now()
    this.term.write(d)
    for (const [c, st] of this.clients) {
      if (st.ready) c.send({ ev: 'data', tab: this.tab, d })
      else st.pending.push(d)
    }
    this.onOutput(d)
  }

  // attach hands the snapshot to reply; live data for this client follows it, in order, on the same channel.
  // reply gets null when a newer attach (or a detach) of the same client came first.
  attach(c: Client, cols: number | undefined, rows: number | undefined, reply: (r: { snapshot: string; cols: number; rows: number } | null) => void) {
    if (cols && rows) this.resize(cols, rows)
    const st = { ready: false, pending: [] as string[], size: cols && rows ? ([cols, rows] as [number, number]) : undefined }
    this.clients.set(c, st)
    // the callback runs once the headless terminal parsed everything written so far
    this.term.write('', () => {
      if (this.clients.get(c) !== st) return reply(null)
      reply({ snapshot: this.snapshot(), cols: this.term.cols, rows: this.term.rows })
      for (const d of st.pending) c.send({ ev: 'data', tab: this.tab, d })
      st.ready = true
      st.pending = []
      this.setResponder(c)
    })
  }

  detach(c: Client) {
    if (!this.clients.delete(c)) return
    this.lookedAt = Date.now()
    if (this.responder === c) {
      const ready = [...this.clients].filter(([, s]) => s.ready).map(([k]) => k)
      this.setResponder(ready.at(-1) ?? null)
    }
  }

  attachedClients() {
    return [...this.clients.keys()]
  }

  private setResponder(c: Client | null) {
    const old = this.responder
    this.responder = c
    if (old && old !== c && this.clients.has(old)) old.send({ ev: 'responder', tab: this.tab, on: false })
    if (c) c.send({ ev: 'responder', tab: this.tab, on: true })
  }

  write(data: string) {
    if (!this.exited) this.pty.write(data)
  }

  // one PTY, clients of different sizes (a phone, a Mac): it takes the size of the one that typed or resized last
  resizeFor(c: Client, cols: number, rows: number) {
    const st = this.clients.get(c)
    if (st) st.size = [cols, rows]
    this.resize(cols, rows)
  }
  follow(c: Client) {
    const z = this.clients.get(c)?.size
    if (z) this.resize(z[0], z[1])
  }

  resize(cols: number, rows: number) {
    cols = Math.max(2, Math.min(1000, cols | 0))
    rows = Math.max(1, Math.min(500, rows | 0))
    if (cols === this.term.cols && rows === this.term.rows) return
    this.term.resize(cols, rows)
    if (!this.exited) this.pty.resize(cols, rows)
  }

  // snapshot is the serialize addon's output plus the state it leaves out: cursor visibility and style,
  // mouse encoding, scroll region.
  snapshot(): string {
    let s = this.ser.serialize({ scrollback: SCROLLBACK })
    const core = (this.term as any)._core
    const enc = core?.coreMouseService?.activeEncoding
    if (enc === 'SGR') s += '\x1b[?1006h'
    else if (enc === 'SGR_PIXELS') s += '\x1b[?1016h'
    else if (enc === 'URXVT') s += '\x1b[?1015h'
    else if (enc === 'UTF8') s += '\x1b[?1005h'
    const dec = core?.coreService?.decPrivateModes
    if (dec?.cursorStyle) {
      const n = { block: 1, underline: 3, bar: 5 }[dec.cursorStyle as string] ?? 1
      s += `\x1b[${n + (dec.cursorBlink === false ? 1 : 0)} q`
    }
    const buf = core?.buffer
    if (buf && (buf.scrollTop !== 0 || buf.scrollBottom !== this.term.rows - 1)) {
      // DECSTBM homes the cursor: put it back
      s += `\x1b[${buf.scrollTop + 1};${buf.scrollBottom + 1}r\x1b[${buf.y + 1};${buf.x + 1}H`
    }
    if (core?.coreService?.isCursorHidden) s += '\x1b[?25l'
    return s
  }

  // screenText is the bottom of the active screen: its last `lines` lines with text, from line `from` on.
  screenText(lines = 20, from = 0): string {
    const b = this.term.buffer.active
    const out: string[] = []
    for (let i = from; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
    while (out.length && !out.at(-1)!.trim()) out.pop()
    return out.slice(-lines).join('\n')
  }

  // the keys arrows send now (a TUI may have asked for application cursor keys)
  get appCursor(): boolean {
    return !!this.term.modes.applicationCursorKeysMode
  }

  // lineCount: the line after the last one with text (scrollback included)
  lineCount(): number {
    const b = this.term.buffer.active
    let n = b.length
    while (n > 0 && !b.getLine(n - 1)?.translateToString(true).trim()) n--
    return n
  }

  // flushed resolves once the headless terminal parsed everything written so far.
  flushed(): Promise<void> {
    return new Promise(r => this.term.write('', r))
  }

  // end ends the program and keeps its screen and clients (an agent put to sleep): note is the line it leaves
  end(note: string) {
    this.note = note
    this.hup()
    // one still there 5 s later (it traps SIGHUP) gets SIGKILL: freeing its memory is the point
    setTimeout(() => {
      if (this.exited) return
      try {
        process.kill(-this.pty.pid, 'SIGKILL')
      } catch {}
    }, 5000).unref()
  }

  private hup() {
    if (this.exited) return
    try {
      process.kill(-this.pty.pid, 'SIGHUP') // the whole job: node-pty makes the child a session leader
    } catch {}
    try {
      this.pty.kill('SIGHUP')
    } catch {}
  }

  kill() {
    this.hup()
    for (const c of this.clients.keys()) c.send({ ev: 'exit', tab: this.tab, code: -1 })
    this.clients.clear()
    setTimeout(() => this.term.dispose(), 1000)
  }
}
