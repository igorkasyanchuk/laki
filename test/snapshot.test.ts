// Snapshot fidelity: a fresh xterm fed only the snapshot ends up in the same state as the live one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import headless from '@xterm/headless'
import { Session } from '../src/daemon/session.ts'
import { sleep, until } from './helpers.ts'

type Term = InstanceType<typeof headless.Terminal>

function state(t: Term) {
  const core = (t as any)._core
  const dump = (b: any) => Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(false))
  return {
    type: t.buffer.active.type,
    cursor: [t.buffer.active.cursorX, t.buffer.active.cursorY],
    normal: dump(t.buffer.normal),
    alt: t.buffer.active.type === 'alternate' ? dump(t.buffer.alternate) : null,
    modes: { ...t.modes },
    hidden: core.coreService.isCursorHidden,
    encoding: core.coreMouseService.activeEncoding,
    style: [core.coreService.decPrivateModes.cursorStyle, core.coreService.decPrivateModes.cursorBlink],
    region: [core.buffer.scrollTop, core.buffer.scrollBottom],
  }
}

async function replay(s: Session) {
  const fresh = new headless.Terminal({ cols: s.term.cols, rows: s.term.rows, scrollback: 5000, allowProposedApi: true })
  await new Promise<void>(r => fresh.write(s.snapshot(), r))
  return fresh
}

// a program that prints `out` and then waits
function session(out: string) {
  const s = new Session('t', '/bin/sh', ['-c', `printf '%b' "$OUT"; sleep 30`], { cwd: '/tmp', env: { ...process.env, OUT: out } as any, cols: 60, rows: 12 })
  return s
}

const colored = Array.from({ length: 30 }, (_, i) => `\\033[3${i % 8};1mline ${i}\\033[0m \\033[48;2;10;20;${i * 8}mtrue\\033[0m\\r\\n`).join('')

test('normal screen: colors, scrollback, cursor, modes', async t => {
  const s = session(`${colored}\\033[?2004h\\033[?1h\\033[?1000h\\033[?1006h\\033[5 q\\033[3;9r\\033[5;7Hcursor-here\\033[?25l`)
  t.after(() => s.kill())
  await until(async () => (await s.flushed(), s.term.modes.bracketedPasteMode && s.term.buffer.active.cursorX > 10), 'output')
  await s.flushed()
  const fresh = await replay(s)
  assert.deepEqual(state(fresh), state(s.term))
  assert.equal(state(fresh).modes.bracketedPasteMode, true)
  assert.equal(state(fresh).encoding, 'SGR')
  assert.equal(state(fresh).hidden, true)
  // colors and attributes: a session fed the snapshot serializes to the very same thing
  const again = new Session('u', '/bin/sh', ['-c', 'sleep 30'], { cwd: '/tmp', env: process.env as any, cols: 60, rows: 12 })
  t.after(() => again.kill())
  again.term.write(s.snapshot())
  await again.flushed()
  assert.equal(again.snapshot(), s.snapshot())
})

test('allText: the scrollback too, a wrapped line joined again, its spaces kept', async t => {
  const long = `${'a'.repeat(58)}  ${'b'.repeat(30)}` // 90 characters on a 60-column screen: two rows, one line
  const s = session(`${Array.from({ length: 20 }, (_, i) => `row ${i}\\r\\n`).join('')}${long}\\r\\nend\\r\\n\\r\\n`)
  t.after(() => s.kill())
  await until(async () => (await s.flushed(), s.screenText(5).includes('end')), 'output')
  const text = s.allText()
  assert.ok(text.startsWith('row 0\n'), 'from the top of the scrollback')
  assert.ok(text.includes(`\n${long}\nend`), 'the wrapped line whole')
  assert.ok(text.endsWith('end'), 'no blank lines after')
  assert.ok(s.screenText(5).includes('b'.repeat(30)) && !s.screenText(5).includes(long), 'screenText still gives rows')
})

// each link's text and URL, in order (OSC 8: xterm keeps the URL beside the cells)
function links(t: Term) {
  const core = (t as any)._core
  const out: [string, string][] = []
  const b = t.buffer.active
  let last = ''
  for (let y = 0; y < b.length; y++) {
    const line = b.getLine(y)!
    for (let x = 0; x < line.length; x++) {
      const c: any = line.getCell(x)
      const uri = c.hasExtendedAttrs() && c.extended.urlId ? core._oscLinkService.getLinkData(c.extended.urlId)?.uri : ''
      if (uri && uri === last) out[out.length - 1][0] += c.getChars()
      else if (uri) out.push([c.getChars(), uri])
      last = uri && c.getChars() ? uri : ''
    }
    last = ''
  }
  return out
}

test('links (OSC 8) come back with their URLs, and the text after them is plain', async t => {
  const link = (uri: string, text: string, id = '') => `\\033]8;${id};${uri}\\033\\\\${text}\\033]8;;\\033\\\\`
  const s = session(`PR ${link('https://github.com/o/r/pull/12', '#12')} and \\033[1m${link('https://e.com/x', 'bold link', 'id=a')}\\033[0m after\\r\\n${link('https://e.com/y', 'last')}`)
  t.after(() => s.kill())
  await until(async () => (await s.flushed(), links(s.term).length === 3), 'output')
  const want = [['#12', 'https://github.com/o/r/pull/12'], ['bold link', 'https://e.com/x'], ['last', 'https://e.com/y']]
  assert.deepEqual(links(s.term), want)
  const fresh = await replay(s)
  assert.deepEqual(links(fresh), want)
  assert.deepEqual(state(fresh), state(s.term))
  // the snapshot ends outside a link: what's written next isn't one
  fresh.write(' more')
  await new Promise<void>(r => fresh.write('', r))
  assert.deepEqual(links(fresh), want)
})

test('links across a soft wrap: one ending at the edge, one going over it, plain text after each', async t => {
  const link = (uri: string, text: string) => `\\033]8;;${uri}\\033\\\\${text}\\033]8;;\\033\\\\`
  // 60 columns: the first link ends at the edge, "after" goes on in the wrapped row; the second crosses the edge
  const s = session(`${'a'.repeat(54)}${link('https://e.com/1', 'edge12')}after${' '.repeat(50)}${link('https://e.com/2', 'acrossTheWrap')} plain\\r\\n`)
  t.after(() => s.kill())
  await until(async () => (await s.flushed(), links(s.term).length >= 3), 'output')
  const live = links(s.term)
  assert.deepEqual(live, [['edge12', 'https://e.com/1'], ['acros', 'https://e.com/2'], ['sTheWrap', 'https://e.com/2']])
  const fresh = await replay(s)
  assert.deepEqual(links(fresh), live)
  assert.deepEqual(state(fresh), state(s.term))
})

test('alternate screen with a TUI on it', async t => {
  const s = session(`before alt\\r\\n\\033[?1049h\\033[H\\033[2J\\033[44m TUI \\033[0m\\033[10;3Hstatus \\033[1;31mred\\033[0m\\033[?2004h\\033[4;4H`)
  t.after(() => s.kill())
  await until(async () => (await s.flushed(), s.term.buffer.active.type === 'alternate' && s.term.buffer.active.cursorY === 3), 'alt screen')
  const fresh = await replay(s)
  assert.deepEqual(state(fresh), state(s.term))
  assert.equal(fresh.buffer.active.type, 'alternate')
  assert.match(fresh.buffer.normal.getLine(0)!.translateToString(true), /before alt/)
})

test('queries are answered once: by the headless terminal only while no client is attached', async t => {
  // on each "q" the program asks for the cursor position (DSR 6) and prints the reply it read, or "none"
  const prog = String.raw`stty raw -echo; while IFS= read -r -n1 c; do if [ "$c" = q ]; then printf '\033[6n'; if IFS= read -r -d R -t 1 r; then printf 'got:%q\r\n' "$r"; else printf 'none\r\n'; fi; fi; done`
  const s = new Session('q', '/bin/bash', ['--noprofile', '--norc', '-c', prog], { cwd: '/tmp', env: process.env as any, cols: 40, rows: 10 })
  t.after(() => s.kill())
  const count = (re: RegExp) => (s.screenText(50).match(re) ?? []).length
  const ask = async (re: RegExp, n: number) => {
    s.write('q')
    await until(async () => (await s.flushed(), count(re) === n), String(re))
  }
  await sleep(200)
  await ask(/got:/g, 1) // nobody attached: the headless terminal answered
  const sent: any[] = []
  const client = { id: 1, send: (m: any) => sent.push(m) }
  let snap = ''
  s.attach(client, 40, 10, r => (snap = r!.snapshot))
  await until(() => sent.some(m => m.ev === 'responder' && m.on), 'responder')
  assert.ok(snap.includes('got:'))
  await ask(/none/g, 1) // attached: the headless terminal kept quiet (this fake client doesn't answer)
  assert.ok(sent.some(m => m.ev === 'data' && m.d.includes('\x1b[6n')), 'the client saw the query')
  s.write('q')
  await until(() => sent.filter(m => m.ev === 'data' && m.d.includes('\x1b[6n')).length === 2, 'second query')
  s.write('\x1b[3;3R') // the client's xterm.js answers
  await until(async () => (await s.flushed(), count(/got:/g) === 2), 'client reply')
  s.detach(client)
  assert.equal(s.responder, null)
  await ask(/got:/g, 3) // detached: the headless terminal answers again
})

test('snapshot: pixel mouse reports and every cursor style come back', async t => {
  const s = new Session('m', '/bin/sh', ['-c', 'sleep 30'], { cwd: '/tmp', env: process.env as any })
  t.after(() => s.kill())
  assert.deepEqual([s.term.cols, s.term.rows], [120, 32]) // the default size
  s.term.write('\x1b[?1000h\x1b[?1016h')
  await s.flushed()
  assert.equal(state(await replay(s)).encoding, 'SGR_PIXELS')
  for (const seq of ['\x1b[2 q', '\x1b[3 q', '\x1b[4 q', '\x1b[6 q']) {
    s.term.write(seq)
    await s.flushed()
    assert.deepEqual(state(await replay(s)).style, state(s.term).style, JSON.stringify(seq))
  }
})

test('attach: a newer attach of the same client wins; attached clients hear the exit, a signal as 128+n', async t => {
  const s = new Session('a', '/bin/sh', ['-c', 'sleep 30'], { cwd: '/tmp', env: process.env as any })
  t.after(() => s.kill())
  const sent: any[] = []
  const c = { id: 1, send: (m: any) => sent.push(m) }
  const replies: any[] = []
  s.attach(c, undefined, undefined, r => replies.push(r))
  s.attach(c, 80, 24, r => replies.push(r))
  await until(() => replies.length === 2, 'both replies')
  assert.equal(replies[0], null)
  assert.deepEqual([replies[1].cols, replies[1].rows], [80, 24])
  assert.deepEqual(s.attachedClients(), [c])
  s.detach({ id: 2, send() {} }) // never attached: nothing changes
  assert.equal(s.responder, c)
  process.kill(s.pty.pid, 'SIGTERM') // this test's own child
  await until(() => s.exited, 'exit')
  assert.equal(s.exitCode, 128 + 15)
  assert.ok(sent.some(m => m.ev === 'exit' && m.code === 143))
  assert.match(s.screenText(2), /process exited with code 143/)
})
