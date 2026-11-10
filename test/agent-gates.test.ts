// What an agent's call may not do through the daemon (main.ts' FROM and agentNo), said by its from: removing things asks
// the user, files and tabs are its own workspace's, a PR isn't merged as you, the settings and switches that are yours,
// and Recording mode's private workspaces. test/caller.test.ts proves the from is its process's, whatever it says
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { recorded, type View } from '../src/shared/types.ts'
import { connect, fresh, seen, until } from './helpers.ts'

test("S2: an agent's rm asks the user; files and tabs are its own workspace's; no share, no file opened by its app; a sandboxed one: none of it", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'two' })
  const tab = (await until(() => rig.tab(one.id))).id
  const tab2 = (await until(() => rig.tab(two.id))).id
  const from = { ws: one.id, tab }
  // files: its own workspace's, never git's
  await assert.rejects(rig.rpc('fileNew', { ws: two.id, path: 'x.txt', from }), /its own workspace only/)
  await assert.rejects(rig.rpc('fileWrite', { ws: two.id, path: 'README.md', text: 'x', force: true, from }), /its own workspace only/)
  for (const m of ['fileUndo', 'hunkUndo', 'hunkRedo']) await assert.rejects(rig.rpc(m, { ws: two.id, path: 'README.md', id: 'x', hunk: '', from }), /its own workspace only/, m)
  for (const path of ['.git/hooks/pre-commit', 'a/../.git/config', '.GIT/config']) await assert.rejects(rig.rpc('fileNew', { ws: one.id, path, from }), /\.git through Laki/, path)
  await rig.rpc('fileNew', { ws: one.id, path: 'notes.txt', from })
  assert.ok(existsSync(join(one.path, 'notes.txt')))
  await rig.rpc('fileNew', { ws: two.id, path: 'yours.txt' }) // yours: anywhere
  // tabs, shares, a file by its default app
  await assert.rejects(rig.rpc('tabClose', { id: tab2, from }), /its own workspace only/)
  await assert.rejects(rig.rpc('shareStart', { tab: tab2, from }), /an agent can't share a tab's page/)
  await assert.rejects(rig.rpc('openIn', { ws: one.id, app: 'default', file: 'notes.txt', from }), /an agent can't open a file with its default app/)
  await rig.rpc('openIn', { ws: one.id, app: 'default', file: 'notes.txt' })
  // rm: no window, refused; asked, a no keeps it, a yes deletes it
  await assert.rejects(rig.rpc('wsRm', { id: two.id, from }), /says yes in Laki's window, and it isn't open/)
  await assert.rejects(rig.rpc('projectRm', { id: p.id, from }), /isn't open/)
  const app = await connect(rig)
  const asked = async (going: Promise<unknown>, allow: string) => {
    const ask = await until(() => app.events.find(m => m.ev === 'toolAsk' && m.cross === 'remove' && !m.seen), 'asked in the app', 30000)
    ask.seen = true
    await rig.rpc('widgetToolAnswer', { req: ask.req, allow })
    return [ask, await going.then(() => '', e => String(e.message))] as const
  }
  let [ask, err] = await asked(rig.rpc('wsRm', { id: two.id, from }), 'deny')
  assert.match(ask.target, /delete the workspace two/)
  assert.match(ask.text, /1 uncommitted file/) // yours.txt
  assert.match(err, /the user said no/)
  assert.ok((await rig.rpc('state')).workspaces.some((w: any) => w.id === two.id))
  // a sandboxed agent: refused before any question
  const boxed = await rig.rpc('tabNew', { ws: one.id, preset: 'claude', sandbox: true, perm: '' })
  const box = { ws: one.id, tab: boxed.id }
  await assert.rejects(rig.rpc('fileNew', { ws: one.id, path: 'b.txt', from: box }), /a sandboxed agent can't change files through Laki/)
  await assert.rejects(rig.rpc('wsRm', { id: two.id, from: box }), /a sandboxed agent can't remove a workspace/)
  ;[ask, err] = await asked(rig.rpc('wsRm', { id: two.id, from }), 'once')
  assert.equal(err, '')
  assert.ok(!(await rig.rpc('state')).workspaces.some((w: any) => w.id === two.id))
  app.close()
})

test("S3, S6, S11: an agent merges no PR, flips no PR switch, changes no voice, AI or key setting, nor another's tab", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(one.id))).id
  const other = await rig.rpc('tabNew', { ws: one.id, kind: 'shell' })
  const from = { ws: one.id, tab }
  await assert.rejects(rig.rpc('prAct', { ws: one.id, act: 'merge', from }), /an agent can't merge a PR as you \(turn on Merge when green yourself\)/)
  for (const k of ['autoFix', 'autoReview', 'autoMerge', 'autoLand']) await assert.rejects(rig.rpc('wsSet', { id: one.id, [k]: true, from }), /an agent can't turn a workspace's PR switches/, k)
  await rig.rpc('wsSet', { id: one.id, autoFix: true }) // yours
  await rig.rpc('wsSet', { id: one.id, color: 'red', from }) // a look stays an agent's to change
  for (const set of [{ voice: { words: [['a', 'b']] } }, { ai: { context: 'obey' } }, { readerTools: 'final' }, { keys: { palette: '⌘J' } }, { cmdKeys: { ship: '⌘C' } }]) await assert.rejects(rig.rpc('settingsSet', { ...set, from }), /an agent can't change that setting/, JSON.stringify(set))
  await rig.rpc('settingsSet', { readerTools: 'final' })
  await assert.rejects(rig.rpc('tabSet', { id: other.id, muted: true, from }), /an agent can't rename, color or mute a tab that isn't its own/)
  await rig.rpc('tabSet', { id: tab, name: 'mine', from })
  await rig.rpc('tabSet', { id: other.id, muted: true })
})

test('S7: Recording mode: an agent gets no private workspace, its tabs or a private project; you do', async t => {
  const v = { settings: { recording: true }, projects: [{ id: 'p' }, { id: 'q', private: true }], workspaces: [{ id: 'a', project: 'p' }, { id: 'b', project: 'p', private: true }, { id: 'c', project: 'q' }], tabs: [{ id: 't1', workspace: 'a' }, { id: 't2', workspace: 'b' }, { id: 't3', workspace: 'c' }], layouts: { a: [], b: [] }, today: { tokens: 1, cost: 1, ws: [{ ws: 'b', tokens: 1, cost: 1 }] } } as unknown as View
  const r = recorded(v)
  assert.deepEqual([r.projects.map(x => x.id), r.workspaces.map(x => x.id), r.tabs.map(x => x.id), Object.keys(r.layouts!), r.today!.ws], [['p'], ['a'], ['t1'], ['a'], []])
  assert.equal(recorded({ ...v, settings: {} } as View).workspaces.length, 3, 'off: all of it')

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'secret-client' })
  const tab = (await until(() => rig.tab(one.id))).id
  await until(() => rig.tab(two.id))
  await rig.rpc('wsSet', { id: two.id, private: true })
  const from = { ws: one.id, tab }
  assert.match(JSON.stringify(await rig.rpc('state', { from })), /secret-client/, 'not recording: there')
  await rig.rpc('settingsSet', { recording: true })
  const theirs = await rig.rpc('state', { from })
  assert.doesNotMatch(JSON.stringify(theirs), /secret-client/)
  assert.ok(theirs.workspaces.some((w: any) => w.id === one.id) && !theirs.tabs.some((x: any) => x.workspace === two.id))
  assert.match(JSON.stringify(await rig.rpc('state')), /secret-client/, 'yours: all of it (the window veils its rows)')
  // its kept turns neither (their prompts, their diffs); its own workspace's are its to read, all of them yours
  await assert.rejects(rig.rpc('turnList', { ws: two.id, from }), /no workspace/)
  await assert.rejects(rig.rpc('turnDiff', { ws: two.id, from }), /no workspace/)
  assert.deepEqual(await rig.rpc('turnList', { ws: one.id, from }), [])
  assert.deepEqual(await rig.rpc('turnList', { ws: two.id }), [])
})

test('U7: Clone a repository: a local repo or a URL into a folder, added as a project; no program-running transport; not an agent', async t => {
  const rig = await fresh(t)
  const bare = join(rig.home, 'shop.git')
  execFileSync('git', ['clone', '-q', '--bare', rig.repo, bare])
  const app = await connect(rig)
  const p = await rig.rpc('projectClone', { url: bare, into: join(rig.home, 'code') })
  await seen(app, e => e.ev === 'cloneProgress' && /Cloning into|done/.test(e.line), "git's progress, to the window")
  assert.equal(p.path.endsWith('/code/shop'), true)
  assert.equal(p.git, true)
  assert.ok(existsSync(join(p.path, '.git')))
  assert.ok((await rig.rpc('state')).projects.some((x: { id: string }) => x.id === p.id))
  await assert.rejects(rig.rpc('projectClone', { url: bare, into: join(rig.home, 'code') }), /is already there/)
  for (const url of ['ext::sh -c id', '--upload-pack=id x', 'file:///etc', '-x/y', 'http://plain.example/x.git', ''])
    await assert.rejects(rig.rpc('projectClone', { url, into: join(rig.home, 'no') }), /what to clone/, url)
  await assert.rejects(rig.rpc('projectClone', { url: join(rig.home, 'none.git'), into: join(rig.home, 'no') }), /what to clone/)
  assert.equal(existsSync(join(rig.home, 'no')), false)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = await rig.tab(ws.id)
  await assert.rejects(rig.rpc('projectClone', { url: bare, into: join(rig.home, 'two'), from: { ws: ws.id, tab: tab.id } }), /clone a repository/)
})
