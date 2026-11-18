import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test("C5: a deleted workspace's artifacts are kept, listed, opened and deleted; Also delete and the setting's off drop them", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const made = async (name: string) => {
    const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name })
    const at = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.storage, 'its storage folder')
    mkdirSync(join(at, 'shots'), { recursive: true })
    writeFileSync(join(at, 'report.md'), '# Done')
    writeFileSync(join(at, 'shots/login.png'), 'png')
    return { ...ws, storage: at as string }
  }
  const one = await made('login page')
  await rig.rpc('wsRm', { id: one.id })
  assert.ok(!existsSync(one.storage), 'moved out')
  let kept = await rig.rpc('keptList')
  assert.equal(kept.length, 1)
  assert.deepEqual([kept[0].id, kept[0].name, kept[0].project, kept[0].n, kept[0].files.map((f: any) => f.path).sort()], [one.id, one.name ?? one.id, p.id, 2, ['report.md', 'shots/login.png']])
  assert.equal(readFileSync(join(kept[0].path, 'report.md'), 'utf8'), '# Done')
  // open a file (macOS's open, the fake's log), or its folder; nothing outside it
  await rig.rpc('keptOpen', { dir: kept[0].dir, file: 'report.md' })
  await rig.rpc('keptOpen', { dir: kept[0].dir })
  const opened = readFileSync(join(rig.home, 'fake.log'), 'utf8').split('\n').filter(l => l.startsWith('open '))
  assert.ok(opened.includes(`open ${join(kept[0].path, 'report.md')}`) && opened.includes(`open ${kept[0].path}`), opened.join('\n'))
  await assert.rejects(rig.rpc('keptOpen', { dir: kept[0].dir, file: '../../state.json' }), /which file/)
  await assert.rejects(rig.rpc('keptOpen', { dir: '..' }), /no kept artifacts/)

  // Also delete its artifacts: gone with it
  const two = await made('two')
  await rig.rpc('wsRm', { id: two.id, dropArtifacts: true })
  await until(() => !existsSync(two.storage), 'its storage deleted')
  assert.equal((await rig.rpc('keptList')).length, 1)
  // the setting off: deleted as before
  await rig.rpc('settingsSet', { keepStorage: false })
  const three = await made('three')
  await rig.rpc('wsRm', { id: three.id })
  await until(() => !existsSync(three.storage), 'its storage deleted')
  assert.equal((await rig.rpc('keptList')).length, 1)
  await rig.rpc('settingsSet', { keepStorage: true })

  // an archive deleted by its age keeps them too
  const four = await made('four')
  await rig.rpc('wsArchive', { id: four.id, force: true })
  await rig.rpc('settingsSet', { archivedDays: 1 })
  const now = Date.now() + 3 * 86400e3
  await rig.rpc('archivedTidy', { now })
  await rig.rpc('archivedTidy', { now: now + 2 * 86400e3 })
  await until(async () => (await rig.rpc('keptList')).some((k: any) => k.id === four.id), 'kept as its archive is deleted')

  // Delete one, then all
  kept = await rig.rpc('keptList')
  await rig.rpc('keptRm', { dir: kept[0].dir })
  assert.equal((await rig.rpc('keptList')).length, kept.length - 1)
  await rig.rpc('keptRm', { all: true })
  assert.deepEqual(await rig.rpc('keptList'), [])
})
