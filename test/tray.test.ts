// Q8: the menu bar icon's state (shared/tray.ts stateOf), its words, and its four pictures drawn to PNGs: a screenshot
// of the menu bar can't be taken here, so each picture is checked as a file (made, not empty, none the same)
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { bounceOf, dockProgress, stateOf, TRAY_PX, TRAY_STATES, trayBitmap, trayTip, trayTitle } from '../src/shared/tray.ts'

const tab = (o: object) => ({ id: Math.random().toString(36).slice(2), workspace: 'w1', kind: 'agent', status: 'idle', done: false, ...o }) as any
const view = (tabs: any[], workspaces: any[] = [{ id: 'w1' }]) => ({ tabs, workspaces }) as any

test('Q8 stateOf: blocked over waiting over working over idle; muted, archived and shells aside', () => {
  const now = 1_000_000
  assert.deepEqual(stateOf(view([]), now), { state: 'idle', needs: 0, working: 0, blocked: 0 })
  assert.equal(stateOf(view([tab({ kind: 'shell', status: 'running' })]), now).state, 'idle', "a shell's command isn't an agent working")
  assert.deepEqual(stateOf(view([tab({ status: 'running' }), tab({ status: 'running' })]), now), { state: 'working', needs: 0, working: 2, blocked: 0 })
  assert.equal(stateOf(view([tab({ status: 'running' }), tab({ status: 'waiting' })]), now).state, 'waiting')
  assert.equal(stateOf(view([tab({ status: 'idle', done: true })]), now).state, 'waiting', 'finished, not looked at')
  assert.deepEqual(stateOf(view([tab({ status: 'waiting' }), tab({ status: 'idle', limit: now + 60e3 })]), now), { state: 'blocked', needs: 1, working: 0, blocked: 1 })
  assert.equal(stateOf(view([tab({ status: 'idle', limit: now - 1 })]), now).state, 'idle', 'a limit past its reset')
  assert.equal(stateOf(view([tab({ status: 'idle', failed: 'API Error: 529 overloaded' })]), now).state, 'blocked')
  // muted tabs and muted or archived workspaces say nothing, as the Dock's count
  assert.equal(stateOf(view([tab({ status: 'waiting', muted: true })]), now).state, 'idle')
  assert.equal(stateOf(view([tab({ status: 'waiting' })], [{ id: 'w1', muted: true }]), now).state, 'idle')
  assert.equal(stateOf(view([tab({ status: 'running' })], [{ id: 'w1', archived: true }]), now).state, 'idle')
})

test('Q8 its words: the tooltip and the title', () => {
  assert.equal(trayTip({ needs: 2, working: 3, blocked: 0 }), 'Laki: 2 need you, 3 working')
  assert.equal(trayTip({ needs: 1, working: 0, blocked: 1 }), 'Laki: 1 needs you, 1 blocked')
  assert.equal(trayTip({ needs: 0, working: 0, blocked: 0 }), 'Laki')
  assert.deepEqual([trayTitle({ needs: 2, blocked: 0 }), trayTitle({ needs: 2, blocked: 1 }), trayTitle({ needs: 0, blocked: 1 }), trayTitle({ needs: 0, blocked: 0 })], ['2', '2!', '!', ''])
})

// a BGRA bitmap as a PNG (RGBA, 8 bits, no filter): what nativeImage would make of it
function png(bgra: Buffer, w: number, h: number) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [s, d] = [(y * w + x) * 4, y * (w * 4 + 1) + 1 + x * 4]
      raw[d] = bgra[s + 2]
      raw[d + 1] = bgra[s + 1]
      raw[d + 2] = bgra[s]
      raw[d + 3] = bgra[s + 3]
    }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

test('Q8 its four pictures: template images (black, alpha only), each drawn, none the same; waiting is the mark as it was', t => {
  const dir = mkdtempSync(join(tmpdir(), 'laki-tray-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ink = (b: Buffer) => Array.from({ length: b.length / 4 }, (_, i) => b[i * 4 + 3]).reduce((n, a) => n + a, 0)
  const seen = new Set<string>()
  const inks: Record<string, number> = {}
  for (const s of TRAY_STATES) {
    const b = trayBitmap(s)
    assert.equal(b.length, TRAY_PX * TRAY_PX * 4)
    for (let i = 0; i < b.length; i += 4) assert.deepEqual([b[i], b[i + 1], b[i + 2]], [0, 0, 0], `${s}: black, its alpha alone (a template image)`)
    inks[s] = ink(b)
    assert.ok(inks[s] > 255 * 40, `${s}: drawn`)
    const file = join(dir, `${s}.png`)
    writeFileSync(file, png(b, TRAY_PX, TRAY_PX))
    const f = readFileSync(file)
    assert.ok(f.length > 100 && f.subarray(1, 4).toString() === 'PNG', `${s}.png`)
    seen.add(f.toString('base64'))
  }
  assert.equal(seen.size, TRAY_STATES.length, 'four different pictures')
  // the outline has less ink than the filled mark; working and blocked each add to theirs
  assert.ok(inks.idle < inks.waiting && inks.idle < inks.working && inks.waiting < inks.blocked)
})

test('U15 dockProgress: none, a Ship (its pct or unknown), workflow runs by blocks visited, their mean', () => {
  assert.equal(dockProgress({ tabs: [tab({ status: 'running' })] } as any), -1, 'an agent at work is no progress bar')
  assert.equal(dockProgress({ tabs: [tab({ kind: 'ship', status: 'running' })] } as any), 2, "a Ship with no pct: macOS's indeterminate")
  assert.equal(dockProgress({ tabs: [tab({ kind: 'ship', status: 'running', progress: { pct: 40 } })] } as any), 0.4)
  assert.equal(dockProgress({ tabs: [tab({ kind: 'ship', status: 'exited' })] } as any), -1, 'a Ship done: the bar goes')
  const run = (visits: string[], steps?: number, status = 'running') => ({ status, steps, visits: Object.fromEntries(visits.map(v => [v, 1])) })
  assert.equal(dockProgress({ tabs: [], flows: [run(['a'], 4)] } as any), 0.25)
  assert.equal(dockProgress({ tabs: [], flows: [run(['a', 'b'], 2)] } as any), 0.99, 'never full while it runs')
  assert.equal(dockProgress({ tabs: [], flows: [run(['a'], 4), run(['a', 'b', 'c'], 4)] } as any), 0.5, 'two runs: their mean')
  assert.equal(dockProgress({ tabs: [], flows: [run(['a'])] } as any), 2, "an older daemon's run, no steps: unknown")
  assert.equal(dockProgress({ tabs: [], flows: [run(['a'], 4, 'waiting')] } as any), -1, 'waiting on you is no progress')
})

test('U15 bounceOf: once as a workspace starts waiting, Laki not in front; muted, Do not disturb and the setting', () => {
  const v = (tabs: any[], o: any = {}) => ({ tabs, workspaces: o.workspaces ?? [{ id: 'w1' }, { id: 'w2' }], settings: o.settings ?? {}, dnd: o.dnd }) as any
  const w1 = tab({ status: 'waiting' })
  assert.equal(bounceOf(null, v([w1]), false).bounce, false, 'the first view: nothing bounces')
  let r = bounceOf(new Set(), v([w1]), false)
  assert.equal(r.bounce, true)
  assert.deepEqual([...r.now], ['w1'])
  assert.equal(bounceOf(r.now, v([w1, tab({ status: 'waiting' })]), false).bounce, false, 'the same workspace waiting on: once')
  assert.equal(bounceOf(r.now, v([w1, tab({ workspace: 'w2', status: 'waiting' })]), false).bounce, true, 'another workspace: again')
  assert.equal(bounceOf(new Set(), v([w1]), true).bounce, false, 'Laki in front: no bounce')
  assert.equal(bounceOf(new Set(), v([w1], { settings: { dockBounce: false } }), false).bounce, false, 'turned off')
  assert.equal(bounceOf(new Set(), v([tab({ status: 'waiting', muted: true })]), false).bounce, false, 'a muted tab')
  assert.equal(bounceOf(new Set(), v([w1], { workspaces: [{ id: 'w1', muted: true }] }), false).bounce, false, 'a muted workspace')
  assert.equal(bounceOf(new Set(), v([w1], { dnd: { until: 9 } }), false).bounce, false, 'Do not disturb')
  assert.equal(bounceOf(new Set(), v([w1], { dnd: { until: 9 }, workspaces: [{ id: 'w1', important: true }] }), false).bounce, true, 'Do not disturb lets an important one through')
  r = bounceOf(new Set(['w1']), v([]), false)
  assert.equal(bounceOf(r.now, v([w1]), false).bounce, true, 'answered, then waiting again: it bounces again')
})
