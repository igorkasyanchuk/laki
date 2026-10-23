// Shell tabs: running until the prompt is back; the Terminals and Browsers projects.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
say('> \\r\\n', 5000)
say('Do it?\\r\\n❯ 1. Yes\\r\\n  2. No\\r\\n', 10000)
setTimeout(() => {}, 60000)
`,
    { mode: 0o755 },
  )
  await rig.rpc('input', { tab: shell.id, data: `${join(bin, 'claude')}\r` })
  const sh = () => rig.tab(w.id, 'shell')
  await until(async () => (await sh()).runs === 'claude' && (await sh()).status === 'running', 'working', 5000)
  await until(async () => (await sh()).status === 'idle', 'idle: no spinner', 7000)
  assert.equal((await sh()).done, true, 'done: no one was looking')
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
