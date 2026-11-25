// #B2: the weekly backup (daemon/dataBackup.ts backupTick): into Settings' folder once the newest .tgz there is a
// week old (LAKI_BACKUP_MS: the tick and the week, a test's), the newest four of its own kept, nothing else in the
// folder touched; a folder that isn't there: one notice, not one a tick; offered once after your first backup
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, seen, until } from './helpers.ts'

test('#B2: a backup each interval, the newest four of its own kept, a foreign file and your own backup never removed; a missing folder: one notice', async t => {
  const rig = await fresh(t, { env: { LAKI_BACKUP_MS: '1500' } })
  const app = await connect(rig)
  const folder = join(rig.home, 'backups')
  mkdirSync(folder)
  writeFileSync(join(folder, 'notes.txt'), 'not Laki’s')
  const yours = join(folder, 'laki-backup-2026-01-01-090000.tgz') // a backup you made, long ago
  writeFileSync(yours, 'x')
  utimesSync(yours, new Date('2026-01-01'), new Date('2026-01-01'))
  await rig.rpc('settingsSet', { backupEvery: 'weekly', backupDir: folder })
  const mine = () => readdirSync(folder).filter(n => /^laki-weekly-\d{4}-\d{2}-\d{2}-\d{6}\.tgz$/.test(n)).sort()
  const made = new Set<string>()
  const watch = () => (mine().forEach(n => made.add(n)), made.size)
  await until(() => watch() >= 2, 'two ticks, two backups', 30000)
  const last = (await rig.rpc('state')).backupLast
  assert.ok(last && last.bytes > 0 && last.file.startsWith(folder), JSON.stringify(last))
  await until(() => watch() >= 5 && mine().length === 4, 'a fifth run, then the oldest of its own removed', 45000)
  assert.deepEqual(mine(), [...made].sort().slice(-4))
  assert.ok(readdirSync(folder).includes('notes.txt'), 'a foreign file never removed')
  assert.ok(readdirSync(folder).includes('laki-backup-2026-01-01-090000.tgz'), 'your own backup never removed')
  // a folder that isn't there: one notice, however many ticks
  await rig.rpc('settingsSet', { backupDir: join(rig.home, 'gone') })
  await seen(app, (e: any) => e.ev === 'notice' && e.title === "The weekly backup didn't run", 'a notice', 15000)
  const ticks = made.size
  await new Promise(ok => setTimeout(ok, 4000)) // two more ticks
  assert.equal(app.events.filter((e: any) => e.ev === 'notice' && e.title === "The weekly backup didn't run").length, 1, 'once')
  assert.equal(watch(), ticks, 'none made meanwhile')
  assert.match(rig.out, /weekly backup: failed: .*gone isn't there/)
})

test("#B2: off unless you turn it on, offered once after your first backup; an agent can't set it", async t => {
  const rig = await fresh(t)
  const app = await connect(rig)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id).id
  await assert.rejects(rig.rpc('settingsSet', { backupEvery: 'weekly', from: { ws: ws.id, tab } }), /backupEvery|isn't an agent's to change|an agent/)
  await assert.rejects(rig.rpc('settingsSet', { backupEvery: 'daily' }), /weekly or off/)
  const folder = join(rig.home, 'mine')
  mkdirSync(folder)
  await rig.rpc('dataBackup', { file: join(folder, 'first.tgz') })
  const offer: any = await seen(app, (e: any) => e.ev === 'notice' && e.title === 'Back up every week?', 'the offer')
  assert.deepEqual(offer.choices, ['Every week', 'No'])
  await app.call('alertAnswer', { id: offer.id, choice: 'Every week' })
  await until(async () => (await rig.rpc('stateOwn')).settings.backupEvery === 'weekly', 'on')
  assert.equal((await rig.rpc('stateOwn')).settings.backupDir, folder)
  await rig.rpc('dataBackup', { file: join(folder, 'second.tgz') })
  await new Promise(ok => setTimeout(ok, 300))
  assert.equal(app.events.filter((e: any) => e.ev === 'notice' && e.title === 'Back up every week?').length, 1, 'offered once')
})

test('#B2: the default folder (~/Documents/Laki backups) is made the first time, when ~/Documents is there; no folder set: that one', async t => {
  const rig = await fresh(t, { env: { LAKI_BACKUP_MS: '1000' } })
  mkdirSync(join(rig.home, 'Documents'))
  await rig.rpc('settingsSet', { backupEvery: 'weekly', backupDir: '' }) // the field emptied: its placeholder's folder, not none
  const folder = join(rig.home, 'Documents', 'Laki backups')
  await until(() => existsSync(folder) && readdirSync(folder).some(n => /^laki-weekly-.*\.tgz$/.test(n)), 'a backup in the folder it made', 20000)
})
