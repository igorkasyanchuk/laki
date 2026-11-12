// PR work on a timer, against the fake gh: the scans' GitHub quota, a merged PR's workspace archived, idle ones archived.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test("the timer's scans spare GitHub's quota: a quiet PR waits, a low quota waits; Refresh asks at once", async t => {
  const rig = await fresh(t, { env: { LAKI_PR_BG: '1' } })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (o: object) => writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 5, state: 'OPEN', url: 'https://example.invalid/pr/5', mergeable: 'MERGEABLE', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...o }))
  const views = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('gh pr view')).length
  pr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' }] })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const prOf = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr
  // checks running: asked each scan
  await until(async () => (await prOf())?.number === 5 && views() >= 3, 'scanned while running')
  // done and as it was: quiet, the timer's scans leave it
  pr({})
  await until(async () => (await prOf())?.checks === 'pass', 'its checks pass')
  const n = views()
  await new Promise(r => setTimeout(r, 2500))
  assert.ok(views() <= n + 1, `quiet: ${views() - n} more`) // the one that found it as it was
  // Refresh (yours) asks at once
  const m = views()
  await rig.rpc('prRefresh')
  assert.equal(views(), m + 1)
  // its pace is yours (Settings › Pull requests › Check a quiet PR every, prQuiet minutes): a short one asks it again
  await rig.rpc('settingsSet', { prQuiet: 0.03 })
  const q = views()
  await until(() => views() > q, 'a quiet PR asked again after prQuiet', 6000)
  // ponytail: the default 10 minutes (PR_QUIET) aren't waited out here; the quota under FLOOR is
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh api rate_limit --jq \.resources\.graphql/)
})

test("a low GraphQL quota: the timer's scans wait for its reset, Laki's log says so with its own gh calls", async t => {
  const rig = await fresh(t, { env: { LAKI_PR_BG: '1' } })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'ratelimit.json'), JSON.stringify({ limit: 5000, remaining: 12, reset: Math.floor(Date.now() / 1000) + 3600 }))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await until(() => /GraphQL quota has 12 left, the timer's scans wait until \d\d:\d\d \(Laki's own gh calls \d+ since/.test(rig.out), 'said')
  const views = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('gh pr view')).length
  const n = views()
  await new Promise(r => setTimeout(r, 2500))
  assert.ok(views() <= n + 1, `none while low (a new branch's own scan aside): ${views() - n} more`) // the timer's: ~5 in that time
  const m = views()
  await rig.rpc('prRefresh') // yours: at once
  assert.equal(views(), m + 1)
})

test('a merged PR archives its workspace once it is clean (archiveMerged), not with changes or unpushed commits; Undo stays', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' }).trim()
  const head = git('rev-parse', 'HEAD')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 8, state: 'MERGED', url: 'https://example.invalid/pr/8', headRefOid: head, statusCheckRollup: [] }))
  const c = await rig.connect()
  const live = async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived
  const views = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('gh pr view').length
  const scans = async () => {
    const n = views()
    await until(() => views() > n + 1, 'two scans', 20000) // a loaded machine scans slower
  }
  await until(async () => (await rig.rpc('state')).workspaces[0].pr?.state === 'MERGED', 'scanned')
  await scans()
  assert.ok(await live(), 'off by default')
  await rig.rpc('settingsSet', { archiveMerged: true })
  writeFileSync(join(ws.path, 'wip.txt'), 'x')
  await scans()
  assert.ok(await live(), 'uncommitted')
  git('add', '-A')
  git('commit', '-qm', 'wip')
  await scans()
  assert.ok(await live(), 'past the PR head')
  git('reset', '-q', '--hard', head)
  await until(async () => !(await live()), 'archived')
  assert.ok(c.events.some(e => e.ev === 'archived' && e.ws === ws.id && e.pr === 8))
  await rig.rpc('wsRestore', { id: ws.id })
  await scans()
  assert.ok(await live(), 'once: an Undo stays')
  c.close()
})

test('archiveIdle: a worktree untouched for the period goes, with Undo; each reason to keep one holds and is logged once', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { devMode: true }) // the workspace's log
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' }).trim()
  const days = (n: number) => Date.now() + n * 86400e3
  const tick = (n: number) => rig.rpc('archiveIdleTick', { now: days(n) })
  const c = await rig.connect()
  const set = (o: object) => rig.rpc('wsSet', { id: ws.id, ...o })
  assert.deepEqual(await tick(30), [], 'off by default')
  await rig.rpc('settingsSet', { archiveIdle: 7, archiveIdleKeepPR: false }) // the fake gh's open PR, once a scan comes: the next test's
  assert.deepEqual(await tick(6), [], 'not yet')

  // what keeps one, each lifted in turn
  await set({ pinned: true })
  assert.deepEqual(await tick(8), [], 'pinned')
  await set({ pinned: false, important: true })
  assert.deepEqual(await tick(8), [], 'important')
  assert.deepEqual(await tick(8), [], 'the same reason: logged once')
  await set({ important: false })
  writeFileSync(join(ws.path, 'wip.txt'), 'x')
  assert.deepEqual(await tick(8), [], 'uncommitted')
  git('add', '-A')
  git('commit', '-qm', 'wip')
  assert.deepEqual(await tick(6), [], 'a commit counts as touched')
  assert.deepEqual(await tick(8), [], 'unpushed')
  git('reset', '-q', '--hard', 'HEAD~1')
  const said = (await rig.rpc('logs', { key: `ws:${ws.id}` })).map((l: any) => l.text).filter((x: string) => x.startsWith('archive when idle'))
  assert.deepEqual(said, ['archive when idle: no, pinned', 'archive when idle: no, marked important', 'archive when idle: no, uncommitted changes', 'archive when idle: no, unpushed commits'], 'each reason, once')

  assert.deepEqual(await tick(8), [ws.id])
  const live = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)
  assert.ok((await live()).archived)
  await until(() => c.events.some(e => e.ev === 'archived' && e.ws === ws.id && e.idle === 7), 'the toast')

  // Undo: a full period from the restore
  const before = Date.now()
  await rig.rpc('wsRestore', { id: ws.id })
  assert.ok((await live()).touchedAt >= before)
  assert.deepEqual(await tick(6), [], 'not again until another full period')
  c.close()
})

test('archiveIdle keeps a workspace whose shell tab runs a program', async t => {
  const rig = await fresh(t)
  const c = await rig.connect() // shells are checked only while someone looks
  t.after(() => c.ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(() => rig.tab(ws.id, 'shell'), 'the shell tab')
  await until(async () => (await rig.screen(shell.id)).includes('$'), 'its prompt')
  await rig.rpc('settingsSet', { archiveIdle: 3, archiveIdleKeepPR: false, devMode: true }) // the fake gh's open PR
  await rig.rpc('input', { tab: shell.id, data: 'sleep 100\r' })
  await until(async () => (await rig.tab(ws.id, 'shell')).status === 'running', 'running', 5000)
  const tick = () => rig.rpc('archiveIdleTick', { now: Date.now() + 4 * 86400e3 })
  assert.deepEqual(await tick(), [], 'its job would be killed')
  assert.ok((await rig.rpc('logs', { key: `ws:${ws.id}` })).some((l: any) => l.text === 'archive when idle: no, a program is running in a terminal'))
  await rig.rpc('input', { tab: shell.id, data: '\x03' })
  await until(async () => (await rig.tab(ws.id, 'shell')).status === 'idle', 'back at its prompt', 5000)
  assert.deepEqual(await tick(), [ws.id])
})

test('archiveIdle keeps a workspace with a working agent, a queued message, a dev server or an open PR (unless told not to)', async t => {
  const rig = await fresh(t, { config: { run: 'sleep 100', test: 'sleep 100' } })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.status === 'idle' && x
  }, 'first turn')
  await rig.rpc('settingsSet', { archiveIdle: 3 })
  const tick = () => rig.rpc('archiveIdleTick', { now: Date.now() + 4 * 86400e3 })
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: {} })
  assert.deepEqual(await tick(), [], 'an agent at work')
  await rig.rpc('send', { target: tab.id, text: 'later', whenIdle: true })
  assert.deepEqual(await tick(), [], 'a queued message')
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await until(async () => {
    const x = await rig.tab(ws.id)
    return x.status === 'idle' && !x.queue?.length
  }, 'the queue delivered')
  const pr = { number: 3, state: 'OPEN', url: 'https://example.invalid/pr/3', headRefOid: 'a1', statusCheckRollup: [] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr?.state === 'OPEN', 'scanned', 20000)
  assert.deepEqual(await tick(), [], 'an open PR')
  const dev = await rig.rpc('run', { ws: ws.id })
  await rig.rpc('settingsSet', { archiveIdleKeepPR: false })
  assert.deepEqual(await tick(), [], 'a dev server')
  await rig.rpc('tabClose', { id: dev.id })
  const script = await rig.rpc('run', { ws: ws.id, script: 'test' })
  assert.deepEqual(await tick(), [], 'a script')
  await rig.rpc('tabClose', { id: script.id })
  assert.deepEqual(await tick(), [ws.id], 'told not to keep it')
})
