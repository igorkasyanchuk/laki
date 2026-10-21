import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { deskLayout } from '../src/shared/types.ts'
import { fresh } from './helpers.ts'

test("the Desk's tiles: each in its cell, gaps kept, one in the way pushed down, unplaced ones as the flow put them", () => {
  const at = (l: ReturnType<typeof deskLayout>) => Object.fromEntries(l.map(t => [t.id, [t.x, t.y, t.w, t.h]]))
  // none placed (before cells): row by row, as the grid's flow did
  assert.deepEqual(at(deskLayout([{ id: 'a', w: 4, h: 6 }, { id: 'b', w: 6, h: 2 }, { id: 'c', w: 4, h: 3 }])), { a: [0, 0, 4, 6], b: [4, 0, 6, 2], c: [4, 2, 4, 3] }, "c doesn't fit beside b: under it, as CSS grid's sparse flow")
  // a gap stays where it was left
  assert.deepEqual(at(deskLayout([{ id: 'a', w: 4, h: 2, x: 8, y: 10 }])), { a: [8, 10, 4, 2] })
  // the one dragged keeps its cell; one it overlaps moves down past it, and one under that past it in turn
  const l = deskLayout(
    [
      { id: 'a', w: 4, h: 4, x: 0, y: 0 },
      { id: 'b', w: 4, h: 4, x: 0, y: 4 },
      { id: 'c', w: 4, h: 2, x: 2, y: 2 },
    ],
    'c',
  )
  assert.deepEqual(at(l), { c: [2, 2, 4, 2], a: [0, 4, 4, 4], b: [0, 8, 4, 4] })
  // out of the grid: back in it; a new one in the first spot it fits after the placed ones
  assert.deepEqual(at(deskLayout([{ id: 'a', w: 20, h: 0, x: -3, y: -1 }, { id: 'n', w: 4, h: 6 }])), { a: [0, 0, 12, 1], n: [0, 1, 4, 6] })
})

test('extensions: in several places at once (desk among them)', async t => {
  const rig = await fresh(t)
  const of = async (id: string) => (await rig.rpc('state')).widgets.find((w: any) => w.id === id)
  let w = await of('my-prs')
  assert.deepEqual([w.place, w.places, w.on], ['side', ['side'], false], "widget.json's place (none: the sidebar), off until turned on")
  await assert.rejects(rig.rpc('widgetSet', { id: 'my-prs', place: ['side', 'nowhere'] }), /no place nowhere: side, top/, 'an unknown place refused')
  w = await rig.rpc('widgetSet', { id: 'my-prs', place: ['side', 'desk', 'side'] })
  assert.deepEqual(w.places, ['side', 'desk'], 'each place once')
  assert.equal(w.place, 'side')
  assert.equal(w.button, undefined, 'a tile where it has a preview')
  w = await rig.rpc('widgetSet', { id: 'my-prs', place: ['rail'] })
  assert.deepEqual([w.places, w.button], [['rail'], true])
  w = await rig.rpc('widgetSet', { id: 'my-prs', place: [] })
  assert.deepEqual(w.places, ['side'], "none: widget.json's again")
})

test('the laki command for any shell: installed where it can write, run from anywhere, removed (only its own)', async t => {
  const spots = mkdtempSync('/tmp/laki-cli-')
  t.after(() => rmSync(spots, { recursive: true, force: true }))
  const rig = await fresh(t, { env: { LAKI_CLI_DIRS: `${spots}/nope:${spots}/bin2` } })
  let s = await rig.rpc('cliState')
  assert.deepEqual([s.path, s.to], [undefined, `${spots}/bin2/laki`], 'none to write in: the last, made')
  s = await rig.rpc('cliInstall')
  assert.deepEqual([s.path, s.current, s.onPath], [`${spots}/bin2/laki`, true, false])
  const text = readFileSync(s.path, 'utf8')
  assert.match(text, /LAKI_HOME=/)
  assert.match(text, /Settings › General › Command line/)
  s = await rig.rpc('cliRemove')
  assert.equal(s.path, undefined)
  assert.ok(!existsSync(join(spots, 'bin2/laki')))

  // another laki where it would go (an npm link's symlink): never written through, a spot further on, else refused
  mkdirSync(join(spots, 'nope'))
  writeFileSync(join(spots, 'target.js'), 'npm link target\n')
  symlinkSync(join(spots, 'target.js'), join(spots, 'nope/laki'))
  s = await rig.rpc('cliInstall')
  assert.equal(s.path, `${spots}/bin2/laki`, 'past the other one')
  assert.equal(readFileSync(join(spots, 'target.js'), 'utf8'), 'npm link target\n')
  await rig.rpc('cliRemove')
  symlinkSync(join(spots, 'target.js'), join(spots, 'bin2/laki'))
  await assert.rejects(rig.rpc('cliInstall'), /another laki/)
  assert.equal(readFileSync(join(spots, 'target.js'), 'utf8'), 'npm link target\n')
  rmSync(join(spots, 'target.js')) // links to nothing now: still not written through
  await assert.rejects(rig.rpc('cliInstall'), /another laki/)
  assert.ok(!existsSync(join(spots, 'target.js')))
})
