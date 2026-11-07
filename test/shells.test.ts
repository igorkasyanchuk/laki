// Shell tabs: running until the prompt is back; the Terminals and Browsers projects.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('a shell tab running a command is running until its prompt is back', async t => {
  const rig = await fresh(t)
  const c = await rig.connect() // shells are checked only while someone looks
  t.after(() => c.ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(() => rig.tab(w.id, 'shell'), 'the shell tab')
  await until(async () => (await rig.screen(shell.id)).includes('$'), 'its prompt')
  assert.equal((await rig.tab(w.id, 'shell')).status, 'idle')
  await rig.rpc('input', { tab: shell.id, data: 'sleep 3\r' })
  await until(async () => (await rig.tab(w.id, 'shell')).status === 'running', 'running while sleep runs', 5000)
  await until(async () => (await rig.tab(w.id, 'shell')).status === 'idle', 'idle once it ends', 8000)

  // an agent typed there (node …/claude): its status off its screen, as an agent tab's; no spinner while it sits idle
  const bin = join(rig.home, 'agent')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'claude'),
    `#!/usr/bin/env node
const say = (s, ms) => setTimeout(() => process.stdout.write('\\x1b[2J\\x1b[H' + s), ms)
say('✻ Working… (esc to interrupt)\\r\\n', 0)
say('› 1. production\\r\\n  2. /admin', 5000)
say('\\x1b[?25lDo it?\\r\\n❯ 1. Yes\\r\\n  2. No\\r\\n', 10000)
setTimeout(() => {}, 60000)
`,
    { mode: 0o755 },
  )
  await rig.rpc('input', { tab: shell.id, data: `${join(bin, 'claude')}\r` })
  const sh = () => rig.tab(w.id, 'shell')
  await until(async () => (await sh()).runs === 'claude' && (await sh()).status === 'running', 'working', 5000)
  await until(async () => (await sh()).status === 'idle', 'idle: no spinner', 7000)
  assert.equal((await sh()).done, true, 'done: no one was looking')
  // a list typed into its prompt, the cursor on it: no menu (its real menus hide the cursor, as below)
  assert.match(await rig.screen(shell.id), /1\. production/)
  assert.equal((await sh()).status, 'idle')
  await until(async () => (await sh()).status === 'waiting', 'its menu', 8000)
  assert.deepEqual((await sh()).ask.options.map((o: any) => o.label), ['Yes', 'No'])
  await rig.rpc('input', { tab: shell.id, data: '\x03' })
  await until(async () => !(await sh()).runs && (await sh()).status === 'idle', 'the agent gone', 5000)
})

test("a project's + › Terminal: a local workspace with a shell in the project's own folder, where it's put", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('quickNew', { kind: 'shells', project: p.id })
  const b = await rig.rpc('quickNew', { kind: 'shells', project: p.id, place: 'top' })
  assert.deepEqual([a.name, b.name, a.kind, a.path, a.project], ['terminal 1', 'terminal 2', 'local', p.path, p.id])
  assert.equal(b.term, true) // its menus close it, never a workspace's delete
  const v = await rig.rpc('state')
  assert.equal(v.tabs.filter((x: any) => x.workspace === b.id && x.kind === 'shell').length, 1)
  assert.equal(v.projects.some((x: any) => x.kind === 'shells'), false) // no Terminals project for it
  assert.equal(v.workspaces.find((w: any) => w.project === p.id).id, b.id) // placed first (a group's + gives its id)
  await assert.rejects(rig.rpc('quickNew', { kind: 'shells', project: 'nope' }), /no project nope/)
  // one made before the mark: marked as the daemon starts, by its name and its shells
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  for (const w of st.workspaces) delete w.term
  writeFileSync(file, JSON.stringify(st))
  await rig.start()
  assert.deepEqual((await rig.rpc('state')).workspaces.filter((w: any) => w.project === p.id).map((w: any) => w.term), [true, true])
})

test('Terminals and Browsers: a project each in the home folder, a workspace per terminal or page', async t => {
  const rig = await fresh(t)
  const [a, b] = await Promise.all([rig.rpc('quickNew', { kind: 'shells' }), rig.rpc('quickNew', { kind: 'shells' })]) // at once: one after the other
  const web = await rig.rpc('quickNew', { kind: 'browsers', url: 'https://example.com/' })
  await assert.rejects(rig.rpc('quickNew', { kind: 'browsers', url: 'file:///etc/passwd' }), /http\(s\) only/)
  await assert.rejects(rig.rpc('quickNew', { kind: 'nope' }), /shells or browsers/)
  const v = await rig.rpc('state')
  const shells = v.projects.find((p: any) => p.kind === 'shells')
  assert.deepEqual([shells.name, shells.path, shells.git], ['Terminals', rig.home, false])
  assert.deepEqual([a.name, b.name, a.kind, a.path, a.project, b.project], ['terminal 1', 'terminal 2', 'local', rig.home, shells.id, shells.id])
  assert.equal(v.tabs.filter((x: any) => x.workspace === a.id && x.kind === 'shell').length, 1)
  assert.deepEqual([web.name, web.browser, v.tabs.some((x: any) => x.workspace === web.id)], ['example.com', 'https://example.com/', false]) // the site, until its title
  assert.deepEqual([a.term, web.term], [true, undefined])
  assert.equal((await rig.rpc('quickNew', { kind: 'browsers' })).name, 'browser 1')
  await rig.rpc('wsSet', { id: web.id, browser: 'https://example.org/a', name: 'Example' })
  await assert.rejects(rig.rpc('wsSet', { id: web.id, browser: 'javascript:alert(1)' }), /http\(s\) page/)
  await assert.rejects(rig.rpc('wsSet', { id: a.id, browser: 'https://example.com/' }), /Browsers workspace/)
  await assert.rejects(rig.rpc('tabNew', { ws: web.id }), /a browser page: it has no tabs/)
  const w = (await rig.rpc('state')).workspaces.find((x: any) => x.id === web.id)
  assert.deepEqual([w.browser, w.name], ['https://example.org/a', 'Example'])
  assert.deepEqual((await rig.rpc('files', { ws: a.id })).files, []) // the home folder isn't walked
  // agents see which projects are Terminals and Browsers (the skill tells them to keep out)
  const ls = JSON.parse((await rig.cli('ls', '--json')).out)
  assert.deepEqual(ls.projects.map((p: any) => p.kind).sort(), ['browsers', 'shells'])
  // the home folder added as a project of its own isn't Terminals
  const home = await rig.rpc('projectAdd', { path: rig.home })
  assert.notEqual(home.id, shells.id)
  // a Shells project from 0.7 is Terminals after a restart; one you named stays
  await rig.rpc('projectSet', { id: shells.id, name: 'Shells' })
  await rig.rpc('projectSet', { id: (v.projects.find((p: any) => p.kind === 'browsers')).id, name: 'Shells' })
  await rig.stop()
  await rig.start()
  const names = (await rig.rpc('state')).projects.map((p: any) => `${p.kind}:${p.name}`).sort()
  assert.deepEqual(names.filter((x: string) => !x.startsWith('undefined')), ['browsers:Shells', 'shells:Terminals'])
})

test("a new shell beside a shell tab starts in that shell's folder", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(() => rig.tab(w.id, 'shell'), 'the shell tab')
  await until(async () => (await rig.screen(shell.id)).includes('$'), 'its prompt')
  const sub = join(w.path, 'deep')
  mkdirSync(sub)
  await rig.rpc('input', { tab: shell.id, data: 'cd deep\r' })
  await until(async () => (await rig.screen(shell.id)).split('$').length > 2, 'cd done')
  const t2 = await rig.rpc('tabNew', { ws: w.id, cwdOf: shell.id })
  await until(async () => (await rig.screen(t2.id)).includes('$'), 'the new prompt')
  await rig.rpc('input', { tab: t2.id, data: 'pwd\r' })
  await until(async () => (await rig.screen(t2.id)).includes('/deep'), 'pwd in deep')
  // no such shell tab: the workspace's folder, as before
  const t3 = await rig.rpc('tabNew', { ws: w.id, cwdOf: 'nope' })
  await until(async () => (await rig.screen(t3.id)).includes('$'), 'its prompt')
  await rig.rpc('input', { tab: t3.id, data: 'pwd\r' })
  await until(async () => (await rig.screen(t3.id)).split('$').length > 2, 'pwd done')
  assert.equal((await rig.screen(t3.id)).includes('/deep'), false)
})

test('an archived project: out of the view with its workspaces, its shells closed, no new workspace in it; back as it was', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(() => rig.tab(w.id, 'shell'), 'the shell tab')
  await until(async () => (await rig.screen(shell.id)).includes('$'), 'its prompt')
  await rig.rpc('projectArchive', { project: p.id })
  const v = await rig.rpc('state')
  assert.ok(!v.projects.some((x: { id: string }) => x.id === p.id))
  assert.ok(!v.workspaces.some((x: { id: string }) => x.id === w.id))
  assert.deepEqual(v.archivedProjects.map((x: { id: string; workspaces: number }) => [x.id, x.workspaces]), [[p.id, 1]])
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'more' }), /is archived: bring it back first/)
  // back: the project and its workspace again (the shell ended with the archive)
  await rig.rpc('projectArchive', { project: p.id, on: false })
  const back = await rig.rpc('state')
  assert.ok(back.projects.some((x: { id: string }) => x.id === p.id))
  assert.ok(back.workspaces.some((x: { id: string }) => x.id === w.id))
  assert.equal(back.archivedProjects, undefined)
  await until(async () => !(await rig.tab(w.id, 'shell')), 'its shell closed by the archive')
  // its folder added again (a drop on the window or the Dock icon): back from the archive too
  await rig.rpc('projectArchive', { project: p.id })
  assert.equal((await rig.rpc('projectAdd', { path: rig.repo })).id, p.id)
  assert.ok((await rig.rpc('state')).projects.some((x: { id: string }) => x.id === p.id))
})

// ⇧⌘T: a tab you closed comes back in its workspace (tabReopen), its chat resumed; kept in state.json, 10 at most
test('a closed tab reopens: claude and codex resumed, a gone chat starts anew, a shell in its folder; 10 kept, archive clears; an agent only in its own workspace, only what it could start', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const wsOf = async (id: string) => (await rig.rpc('state')).workspaces.find((w: any) => w.id === id)
  const argsOf = (tab: string) => until(() => rig.fakeLog().find((l: any) => l.tab === tab)?.args, 'its start') as Promise<string[]>
  const transcript = (path: string) => (mkdirSync(join(path, '..'), { recursive: true }), writeFileSync(path, ''))
  // claude: its chat id (a turn ran), its transcript there: --resume
  const cw = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task', name: 'cl' })
  const c = await until(async () => (x => x?.resumeId && x)(await rig.tab(cw.id)), 'its chat id')
  transcript(join(rig.home, '.claude', 'projects', 'x', `${c.resumeId}.jsonl`))
  await rig.rpc('tabClose', { id: c.id })
  assert.deepEqual([(await wsOf(cw.id)).closed.length, (await wsOf(cw.id)).closed[0].resumeId], [1, c.resumeId])
  const c2 = await rig.rpc('tabReopen', { ws: cw.id })
  assert.deepEqual([c2.name, c2.fresh], [c.name, undefined])
  const a2 = await argsOf(c2.id)
  assert.equal(a2[a2.indexOf('--resume') + 1], c.resumeId)
  assert.equal((await wsOf(cw.id)).closed, undefined, 'taken off the list')
  // its chat gone: a new one, and the app is told (fresh)
  rmSync(join(rig.home, '.claude', 'projects'), { recursive: true })
  await rig.rpc('tabClose', { id: c2.id })
  const c3 = await rig.rpc('tabReopen', { ws: cw.id })
  assert.equal(c3.fresh, true)
  assert.ok(!(await argsOf(c3.id)).includes('--resume'))
  // codex: resume <thread>
  const xw = await rig.rpc('wsNew', { project: p.id, preset: 'codex', name: 'cx' })
  const x = await rig.tab(xw.id)
  await until(async () => (await rig.screen(x.id)).includes('fake codex'), 'codex up')
  await rig.rpc('send', { target: xw.id, text: 'hello codex' })
  const xr = (await until(async () => (await rig.tab(xw.id)).resumeId, 'its thread')) as string
  transcript(join(rig.home, '.codex', 'sessions', '2026', '11', '06', `rollout-1-${xr}.jsonl`))
  await rig.rpc('tabClose', { id: x.id })
  const x2 = await rig.rpc('tabReopen', { ws: xw.id })
  const xa = await argsOf(x2.id)
  assert.equal(xa[xa.indexOf('resume') + 1], xr)
  // a shell: back in the folder it was in
  const sh = await rig.rpc('tabNew', { ws: xw.id })
  await until(async () => (await rig.screen(sh.id)).includes('$'), 'its prompt')
  mkdirSync(join(xw.path, 'deep'))
  await rig.rpc('input', { tab: sh.id, data: 'cd deep\r' })
  await until(async () => (await rig.screen(sh.id)).split('$').length > 2, 'cd done')
  await rig.rpc('tabClose', { id: sh.id })
  assert.match((await wsOf(xw.id)).closed[0].cwd, /\/deep$/)
  const sh2 = await rig.rpc('tabReopen', { ws: xw.id })
  await until(async () => (await rig.screen(sh2.id)).includes('$'), 'the new prompt')
  await rig.rpc('input', { tab: sh2.id, data: 'pwd\r' })
  await until(async () => (await rig.screen(sh2.id)).includes('/deep'), 'pwd in deep')
  // an agent of another workspace can't; its own can, but not one it couldn't start itself: bypass permissions, a command
  await assert.rejects(rig.rpc('tabReopen', { ws: xw.id, from: { ws: cw.id, tab: c3.id } }), /in its own workspace only/)
  const by = { ws: xw.id, tab: x2.id }
  await rig.rpc('tabClose', { id: (await rig.rpc('tabNew', { ws: xw.id, preset: 'claude', perm: 'bypassPermissions', name: 'yolo' })).id })
  await assert.rejects(rig.rpc('tabReopen', { ws: xw.id, from: by }), /never asks/)
  await rig.rpc('tabClose', { id: (await rig.rpc('tabNew', { ws: xw.id, cmd: 'sleep 60', name: 'own' })).id })
  await assert.rejects(rig.rpc('tabReopen', { ws: xw.id, from: by }), /a command of its own/)
  assert.deepEqual((await wsOf(xw.id)).closed.map((c: any) => c.name).slice(0, 2), ['own', 'yolo'], 'kept for you')
  assert.equal((await rig.rpc('tabReopen', { ws: xw.id, index: 1 })).name, 'yolo') // yours
  // 10 at most, the newest first; an archive clears them
  for (let i = 0; i < 12; i++) await rig.rpc('tabClose', { id: (await rig.rpc('tabNew', { ws: xw.id, name: `s${i}` })).id })
  assert.deepEqual((await wsOf(xw.id)).closed.map((c: any) => c.name).slice(0, 2), ['s11', 's10'])
  assert.equal((await wsOf(xw.id)).closed.length, 10)
  await rig.rpc('wsArchive', { id: xw.id })
  assert.equal((await wsOf(xw.id)).closed, undefined)
})
