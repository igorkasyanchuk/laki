import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

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
