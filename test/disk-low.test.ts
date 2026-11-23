// Before the disk fills: a worktree's volume under settings.diskLow GB says so once a low spell (a notice in Laki's
// window, Make room… opening Settings › Resources › Disk), quiet again once it has twice that; 0: never.
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, seen, sleep, until } from './helpers.ts'

test('disk low: one notice a low spell, Make room… opens the Disk page, again only after it had room', async t => {
  const rig = await fresh(t, { env: { LAKI_DISK_LOW_MS: '200' } })
  const app = await rig.connect()
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const low = join(rig.data, 'test-disk-low')
  writeFileSync(low, String(3e9)) // 3 GB free: under the default 5
  const n = await seen(app, (e: any) => e.ev === 'notice' && e.title === 'The disk is filling up', 'the notice')
  assert.match(n.text, /3\.0 GB free on the disk that holds/)
  assert.deepEqual(n.choices, ['Make room…', 'Later'])
  await sleep(700) // three more ticks, still low: no second notice
  assert.equal(app.events.filter((e: any) => e.ev === 'notice').length, 1)
  await rig.rpc('alertAnswer', { id: n.id, choice: 'Make room…' })
  await seen(app, (e: any) => e.ev === 'ui' && e.do === 'link' && e.link === 'laki://settings/resources?spot=Disk', 'the Disk page opened')
  // room again (twice the threshold), then low: a new spell, a new notice
  writeFileSync(low, String(11e9))
  await sleep(500)
  writeFileSync(low, String(4e9))
  await until(() => app.events.filter((e: any) => e.ev === 'notice').length === 2, 'a second spell')
  // never: no notice at all
  await rig.rpc('settingsSet', { diskLow: 0 })
  writeFileSync(low, String(20e9))
  await sleep(500)
  writeFileSync(low, String(1e9))
  await sleep(700)
  assert.equal(app.events.filter((e: any) => e.ev === 'notice').length, 2)
  rmSync(low)
  app.close()
})
