// The daemon's API beyond the happy paths: errors, tabs and sessions, files, images and open in, the daemon's start,
// timers, the view's sends (remote access: api-remote.test.ts; workspaces and projects: api-workspaces.test.ts)
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, extname, join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until, sleep } from './helpers.ts'
test('errors name what is wrong: methods, lookups, the WebSocket', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('frob'), /unknown method frob/)
  await assert.rejects(rig.rpc('constructor'), /unknown method constructor/) // not an inherited key
  assert.equal((await fetch(`http://127.0.0.1:${rig.info().port}/`)).status, 404)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feat a' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'feat b' })
  await assert.rejects(rig.rpc('send', { target: 'feat', text: 'x' }), /feat matches 2 workspaces/)
  await assert.rejects(rig.rpc('send', { target: 'nope', text: 'x' }), /no workspace nope/)
  await assert.rejects(rig.rpc('send', { target: 'feat-a', text: 'x' }), /no tab \(agent\) in feat-a/)
  await assert.rejects(rig.rpc('send', { target: 'feat-b/9', text: 'x' }), /no tab 9 in feat-b/)
  await assert.rejects(rig.rpc('tabSet', { id: 'nope' }), /no tab nope/)
  await assert.rejects(rig.rpc('wsNew', { project: 'nope' }), /no project nope/)
  assert.equal(await rig.rpc('input', { tab: 'nope', data: 'x' }), null)
  assert.equal(await rig.rpc('hook', { tab: 'nope', state: 'idle' }), null)
  const shell = await rig.tab(b.id, 'shell')
  assert.equal((await rig.rpc('send', { target: 'feat-b/1', text: 'echo by-number' })).tab, shell.id) // a tab by its number
  // over the WebSocket: errors come back as replies; junk is ignored
  const c = await rig.connect()
  c.ws.send('not json')
  await assert.rejects(c.call('frob'), /unknown method frob/)
  await assert.rejects(c.call('attach', { tab: 'nope' }), /no session nope/)
  const first = c.call('attach', { tab: shell.id })
  const second = c.call('attach', { tab: shell.id, cols: 80, rows: 20 })
  // the older one is superseded, unless its snapshot went out before the newer one arrived
  await first.then(() => {}, e => assert.match(e.message, /superseded by a newer attach/))
  assert.equal((await second).cols, 80)
  assert.equal(await c.call('ping'), 'pong')
  c.close()
})

test("tabs: named by their task: a prompt's words, the first prompt typed, a command's words; never over a name you gave", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'Please fix the cart total rounding' })
  const first = await rig.tab(ws.id)
  assert.equal(first.name, 'claude') // the workspace's name says its task
  await rig.rpc('hook', { tab: first.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'and the tax too' } })
  assert.equal((await rig.tab(ws.id)).name, 'claude')
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'Please check the totals' })).name, 'claude: check the totals')
  // started without a prompt: its first prompt names it (claude's UserPromptSubmit, codex's first turn), once
  const cl = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  assert.equal(cl.name, 'claude 2')
  const prompt = (text: string) => rig.rpc('hook', { tab: cl.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: text } })
  await prompt('/clear') // a bare command says nothing
  assert.equal((await rig.tab(ws.id, 'claude 2')).id, cl.id)
  await prompt('can you add dark mode to the settings page')
  assert.ok(await rig.tab(ws.id, 'claude: add dark mode to the settings'))
  await prompt('now something else')
  assert.ok(await rig.tab(ws.id, 'claude: add dark mode to the settings'))
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await rig.rpc('hook', { tab: cx.id, state: 'done', payload: { type: 'agent-turn-complete', 'input-messages': ['review what claude did, focus on tests'] } })
  assert.ok(await rig.tab(ws.id, 'codex: review what claude did, focus'))
  // a name you gave stays
  const mine = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await rig.rpc('tabSet', { id: mine.id, name: 'claude 3' })
  await rig.rpc('hook', { tab: mine.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'write the docs' } })
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === mine.id).name, 'claude 3')
  const named = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'write tests', name: 'tests' })
  assert.equal(named.name, 'tests')
  // a command: its first words
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, cmd: '/usr/bin/env npm run dev --port 3000' })).name, 'env npm run')
  // a given name is trimmed; a workspace made without a prompt or a name (ws-<tail>): its first prompt names the
  // workspace, its tab keeps the agent's name
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'x', name: '  docs  ' })).name, 'docs')
  const bare = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  assert.match(bare.id, /^ws-/)
  const b1 = await rig.tab(bare.id)
  await rig.rpc('hook', { tab: b1.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix the login page' } })
  const wsOf = async (id: string) => (await rig.rpc('state')).workspaces.find((w: any) => w.id === id)
  assert.deepEqual([(await wsOf(bare.id)).name, (await rig.tab(bare.id)).name], ['fix the login page', 'claude'])
})

test("Local sessions: named after their prompt, or their agent's first prompt; never the folder's name, never over yours", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const wsOf = async (id: string) => (await rig.rpc('state')).workspaces.find((w: any) => w.id === id)
  const say = async (ws: string, prompt: string) => rig.rpc('hook', { tab: (await rig.tab(ws)).id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt } })
  // the folder's own, with a prompt: its words, not the folder's
  const own = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'claude', prompt: 'Please fix the cart total rounding' })
  assert.deepEqual([own.id, (await wsOf(own.id)).name], [p.id, 'fix the cart total rounding'])
  // beside it, no prompt: <folder>-<tail> until its agent's first prompt names it, once
  const next = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'claude' })
  assert.equal((await wsOf(next.id)).name, undefined)
  await say(next.id, '/model') // a bare command says nothing
  assert.equal((await wsOf(next.id)).name, undefined)
  await say(next.id, 'can you add dark mode to the settings page')
  assert.equal((await wsOf(next.id)).name, 'add dark mode to the settings')
  assert.equal((await rig.tab(next.id)).name, 'claude')
  // a name given, or a rename: kept
  const named = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'claude', name: 'Docs pass' })
  assert.equal((await wsOf(named.id)).name, 'Docs pass')
  const later = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'claude' })
  await rig.rpc('wsSet', { id: later.id, name: 'mine' })
  await say(later.id, 'write the docs')
  assert.equal((await wsOf(later.id)).name, 'mine')
  // renamed back to its id (the folder's): yours too, no prompt names it again
  await rig.rpc('wsSet', { id: own.id, name: own.id })
  const t2 = await rig.rpc('tabNew', { ws: own.id, preset: 'claude' })
  await rig.rpc('hook', { tab: t2.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'write the docs' } })
  assert.equal((await wsOf(own.id)).name, undefined)
  await assert.doesNotReject(rig.rpc('wsNew', { project: p.id, local: true, preset: 'none', another: true, name: 42 })) // a name that isn't text: ignored
})

test('tabs: a command preset, numbered names, close, resize, detach, queue, codex Enter, interrupt, a gone folder', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { presets: [{ name: 'tests', agent: 'command', cmd: 'echo preset-ran; exec cat' }, { name: 'claude', agent: 'claude' }, { name: 'codex', agent: 'codex' }] })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'tests' })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.name, tab.preset, tab.profile, tab.cmd], ['tests', 'custom', 'tests', 'echo preset-ran; exec cat'])
  await until(async () => (await rig.screen(tab.id)).includes('preset-ran'), 'the preset command')
  const t2 = await rig.rpc('tabNew', { ws: ws.id, preset: 'tests' })
  assert.equal(t2.name, 'tests 2')
  await rig.rpc('tabClose', { id: t2.id })
  assert.ok(!(await rig.rpc('state')).tabs.some((x: any) => x.id === t2.id))

  // resize reaches the program; a client that detaches hands the queries back
  const sh = await rig.rpc('tabNew', { ws: ws.id })
  await rig.rpc('resize', { tab: sh.id, cols: 100, rows: 40 })
  await rig.rpc('send', { target: sh.id, text: 'stty size' })
  await until(async () => (await rig.screen(sh.id)).includes('40 100'), 'the new size').catch(async e => {
    throw new Error(`${e.message}; its screen then: ${JSON.stringify(await rig.screen(sh.id))}`) // which half was lost: the size or the line
  })
  const a = await rig.connect()
  const b = await rig.connect()
  await a.call('attach', { tab: sh.id })
  await b.call('attach', { tab: sh.id })
  await b.call('detach', { tab: sh.id })
  await until(() => a.events.filter(e => e.ev === 'responder' && e.on).length === 2, 'a answers again')
  a.close()
  b.close()

  // claude: the queue can be cleared; a hook nobody sends (interrupted) still sets idle
  const cl = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'ask me' })
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status === 'waiting', 'waiting')
  await rig.rpc('send', { target: cl.id, text: 'later', whenIdle: true })
  await rig.rpc('queueClear', { target: cl.id })
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).queue, undefined)
  await rig.rpc('hook', { tab: cl.id, state: 'interrupted' })
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).status, 'idle')

  // the queue edited: a reorder and an edit as one list, refused over a list it didn't start from; Send now stops a
  // slow turn (Esc) and types the first
  const sl = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'slow work' })
  await until(async () => (await rig.screen(sl.id)).includes('esc to interrupt'), 'a slow turn')
  await until(async () => (await rig.tab(ws.id, 'claude: slow work')).status === 'running', 'running')
  for (const text of ['one', 'two', 'three']) await rig.rpc('send', { target: sl.id, text, whenIdle: true })
  const qOf = async () => (await rig.tab(ws.id, 'claude: slow work')).queue
  await assert.rejects(rig.rpc('queueSet', { tab: sl.id, queue: ['x'], was: ['one'] }), /changed since you opened it/)
  await assert.rejects(rig.rpc('queueSet', { tab: sl.id, queue: 'x', was: [] }), /lists of messages/)
  assert.deepEqual((await rig.rpc('queueSet', { tab: sl.id, queue: ['three', 'one!', ' '], was: ['one', 'two', 'three'] })).queue, ['three', 'one!']) // a blank one goes
  assert.deepEqual(await qOf(), ['three', 'one!'])
  assert.equal((await rig.rpc('queueNow', { tab: sl.id })).queued, 1)
  await until(async () => (await rig.screen(sl.id)).includes('answer: three'), 'the first one typed after Esc')
  await until(async () => (await rig.screen(sl.id)).includes('answer: one!'), 'the next one at its turn\'s end')
  assert.equal(await qOf(), undefined)
  await assert.rejects(rig.rpc('queueNow', { tab: sl.id }), /nothing is queued/)
  assert.deepEqual((await rig.rpc('queueSet', { tab: sl.id, queue: [], was: [] })).queue, []) // nothing: a clear
  // asleep (or a restart's not started yet): Send now wakes it, and the first goes as it settles
  await until(async () => (await rig.tab(ws.id, 'claude: slow work')).status === 'idle', 'idle')
  assert.equal(await rig.rpc('tabSleep', { tab: sl.id }), true)
  await rig.rpc('queueSet', { tab: sl.id, queue: ['woke'], was: [] })
  assert.equal((await rig.rpc('queueNow', { tab: sl.id })).sent, true)
  await until(async () => (await rig.screen(sl.id)).includes('answer: woke'), 'typed once it woke', 15000)

  // codex reports only a turn's end: Enter starts one
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await until(async () => (await rig.screen(cx.id)).includes('fake codex'), 'codex up')
  await rig.rpc('input', { tab: cx.id, data: 'hi\r' })
  assert.equal((await rig.tab(ws.id, 'codex')).status, 'running')
  await until(async () => (await rig.tab(ws.id, 'codex')).last === 'answer: hi', 'its turn ended')

  // an agent that ends cleanly keeps its tab and last screen; Enter resumes its chat
  const chat = (await rig.tab(ws.id, 'claude: ask me')).resumeId
  await rig.rpc('input', { tab: cl.id, data: 'exit\r' })
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status === 'exited', 'claude ended')
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).code, 0)
  await until(async () => (await rig.screen(cl.id)).includes('press Enter to start it again'), 'its note')
  await rig.rpc('input', { tab: cl.id, data: '\r' })
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status !== 'exited', 'claude again')
  await until(async () => (await rig.screen(cl.id)).includes(`--resume ${chat}`), 'resumed')

  // the folder is gone: no tab
  rmSync(ws.path, { recursive: true, force: true })
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id }), /is gone/)
  assert.equal((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id).length, 5)
})

test('claude StopFailure on a usage limit: ◷ until it resets; a time gone by is tomorrow\'s', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x.resumeId && x
  }, 'claude up')
  const c = await rig.connect()
  const ago = new Date(Date.now() - 3600e3) // an hour ago, in UTC
  const at = `${ago.getUTCHours() % 12 || 12}:${String(ago.getUTCMinutes()).padStart(2, '0')}${ago.getUTCHours() < 12 ? 'am' : 'pm'}`
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: { error: 'rate_limit', last_assistant_message: `You've hit your limit · resets ${at} (UTC)` } })
  const limit = (await rig.tab(ws.id)).limit
  const hours = (limit - Date.now()) / 3600e3
  assert.ok(hours > 22.9 && hours < 23.1, `resets in 23h, got ${hours}`)
  await until(() => c.events.some(e => e.ev === 'turn' && e.kind === 'limit' && e.tab === tab.id), 'limit event')
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  assert.equal((await rig.tab(ws.id)).limit, undefined)
  c.close()
})

test('claude PreCompact: the tab says compacting (and runs) until its next hook', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x.resumeId && x.status === 'idle' && x
  }, 'claude up')
  const hooks = JSON.parse(readFileSync(join(rig.data, 'claude-settings.json'), 'utf8')).hooks
  assert.match(hooks.PreCompact[0].hooks[0].command, / hook compacting$/)
  await rig.rpc('hook', { tab: tab.id, state: 'compacting', payload: { hook_event_name: 'PreCompact', trigger: 'auto' } })
  const x = await rig.tab(ws.id)
  assert.equal(x.status, 'running')
  assert.equal(x.compacting, true)
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { hook_event_name: 'SessionStart', source: 'compact', session_id: tab.resumeId } })
  assert.equal((await rig.tab(ws.id)).compacting, undefined) // done: back to working
  await rig.rpc('hook', { tab: tab.id, state: 'compacting' })
  await rig.rpc('hook', { tab: tab.id, state: 'idle' })
  assert.equal((await rig.tab(ws.id)).compacting, undefined)
})

test('apps and open in: Finder, an app, a file, the editor; errors', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.ok((await rig.rpc('apps')).some((a: any) => a.id === 'finder' && a.name === 'Finder'))
  await rig.rpc('openIn', { project: p.id, app: 'finder' })
  await rig.rpc('openIn', { ws: ws.id, app: 'zed', file: 'README.md' })
  await rig.rpc('openIn', { ws: ws.id, app: 'antigravity' })
  await rig.rpc('openIn', { ws: ws.id, app: 'editor' }) // Cursor, unless Settings say otherwise
  // a file: its default app, a browser, revealed in Finder, its folder in a terminal
  for (const app of ['default', 'safari', 'finder', 'terminal']) await rig.rpc('openIn', { ws: ws.id, app, file: 'README.md' })
  mkdirSync(join(ws.path, 'docs'))
  await rig.rpc('openIn', { ws: ws.id, app: 'terminal', file: 'docs' }) // a folder: itself
  const opened = readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open '))
  const readme = join(ws.path, 'README.md')
  assert.deepEqual(opened, [`open ${p.path}`, `open -a Zed ${readme}`, `open -a Antigravity ${ws.path}`, `open -a Cursor ${ws.path}`, `open ${readme}`, `open -a Safari ${readme}`, `open -R ${readme}`, `open -a Terminal ${ws.path}`, `open -a Terminal ${join(ws.path, 'docs')}`])
  // L11: a file that would run, by default: shown in Finder, not opened
  writeFileSync(join(ws.path, 'go.command'), 'echo hi')
  writeFileSync(join(ws.path, 'build'), '#!/bin/sh\necho hi', { mode: 0o755 })
  writeFileSync(join(ws.path, 'run.fileloc'), '<plist/>') // opens its target: a script there would run
  for (const f of ['go.command', 'build', 'run.fileloc']) await rig.rpc('openIn', { ws: ws.id, app: 'default', file: f })
  assert.deepEqual(readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open ')).slice(-3), [`open -R ${join(ws.path, 'go.command')}`, `open -R ${join(ws.path, 'build')}`, `open -R ${join(ws.path, 'run.fileloc')}`])
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'zed', file: 'gone.txt' }), /The file \S+gone\.txt does not exist\./)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'emacs' }), /no app emacs/)
  // a project's own editor (Open in's pick for its folder) over Settings': its workspaces' and the project's folder
  await rig.rpc('settingsSet', { editors: { [p.id]: 'xcode' } })
  await rig.rpc('openIn', { ws: ws.id, app: 'editor' })
  await rig.rpc('openIn', { project: p.id, app: 'editor' })
  assert.deepEqual(readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open ')).slice(-2), [`open -a Xcode ${ws.path}`, `open -a Xcode ${p.path}`])
  await rig.rpc('settingsSet', { editor: 'custom', editors: {} })
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'editor' }), /set the editor command in Settings/)
})

test('files: a plain folder\'s (no dependencies), git\'s renamed, deleted and added; not a file', async t => {
  const rig = await fresh(t)
  const plain = join(rig.home, 'notes')
  mkdirSync(join(plain, 'node_modules/x'), { recursive: true })
  mkdirSync(join(plain, 'docs'))
  writeFileSync(join(plain, 'a.md'), 'a')
  writeFileSync(join(plain, 'docs/b.md'), 'b')
  writeFileSync(join(plain, 'node_modules/x/i.js'), '')
  const np = await rig.rpc('projectAdd', { path: plain })
  const nw = await rig.rpc('wsNew', { project: np.id, preset: 'none' })
  const f = await rig.rpc('files', { ws: nw.id })
  assert.deepEqual({ ...f, files: f.files.sort() }, { files: ['a.md', 'docs/b.md'], changed: {}, cut: false })
  await assert.rejects(rig.rpc('fileRead', { ws: nw.id, path: 'docs' }), /docs isn't a file/)

  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env })
  writeFileSync(join(ws.path, 'gone.txt'), 'old\n')
  writeFileSync(join(ws.path, 'added.txt'), 'new\n')
  git('add', 'gone.txt')
  git('commit', '-qm', 'gone')
  git('mv', 'README.md', 'README2.md')
  git('rm', '-q', 'gone.txt')
  git('add', 'added.txt')
  assert.deepEqual((await rig.rpc('files', { ws: ws.id })).changed, { 'README2.md': 'R', 'gone.txt': 'D', 'added.txt': 'A' })
})

test('images: the kind kept, empty ones refused, month-old ones cleaned up', async t => {
  const rig = await fresh(t)
  const images = join(rig.data, 'images')
  mkdirSync(images)
  writeFileSync(join(images, `${Date.now() - 31 * 86400e3}-old.png`), 'x')
  const path = await rig.rpc('imageSave', { data: Buffer.from('jpeg!').toString('base64'), ext: 'jpg' })
  assert.match(path, /\.jpg$/)
  assert.deepEqual(readdirSync(images), [path.slice(images.length + 1)])
  await assert.rejects(rig.rpc('imageSave', { data: '' }), /an image up to 20 MB/)
})

test('files: any kind, its name kept (its last part, readable, never out of its folder), 25 MB at most, old ones cleaned up', async t => {
  const rig = await fresh(t)
  const files = join(rig.data, 'files')
  const old = join(files, `${Date.now() - 31 * 86400e3}-old`)
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'a.pdf'), 'x')
  const b64 = (s: string) => Buffer.from(s).toString('base64')
  const path = await rig.rpc('fileSave', { name: 'Q3 report.pdf', data: b64('pdf!') })
  assert.equal(path, join(files, basename(dirname(path)), 'Q3 report.pdf'))
  assert.equal(readFileSync(path, 'utf8'), 'pdf!')
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700)
  assert.deepEqual(readdirSync(files), [basename(dirname(path))]) // the month-old one went
  const named = async (name: unknown) => {
    const p = await rig.rpc('fileSave', { name, data: '' })
    assert.equal(dirname(dirname(p)), files)
    return basename(p)
  }
  assert.equal(await named('../../state.json'), 'state.json')
  assert.equal(await named('a/b\\c.txt'), 'c.txt')
  for (const n of ['..', '.', '', ' ', undefined]) assert.equal(await named(n), 'file')
  assert.equal(await named('bad\x00\x1b[31m\u202ename\n.sh'), 'bad[31mname.sh')
  for (const n of [`${'x'.repeat(300)}.txt`, `${'日本'.repeat(100)}.md`]) {
    const cut = await named(n)
    assert.ok(Buffer.byteLength(cut) <= 200 && cut.endsWith(extname(n)) && n.startsWith(cut.slice(0, 20)), cut)
  }
  await assert.rejects(rig.rpc('fileSave', { name: 'x' }), /a file up to 25 MB/)
  // the app's go over the socket: 25 MB, in base64, fits
  const c = await rig.connect()
  assert.equal(statSync(await c.call('fileSave', { name: 'big.bin', data: Buffer.alloc(25 << 20).toString('base64') })).size, 25 << 20)
  await assert.rejects(c.call('fileSave', { name: 'big.bin', data: Buffer.alloc((25 << 20) + 1).toString('base64') }), /a file up to 25 MB/)
  c.close()
})

test("daemon start: its starter's GIT_DIR, FORCE_COLOR and npm_* are left out (STARTER_ENV): a workspace's git is its own, a tab gets neither, doctor names them", async t => {
  const rig = await fresh(t)
  const other = join(rig.home, 'other')
  execFileSync('git', ['init', '-q', '-b', 'main', other], { env: rig.env })
  writeFileSync(join(other, 'other.txt'), 'x\n')
  execFileSync('git', ['add', '-A'], { cwd: other, env: rig.env })
  execFileSync('git', ['commit', '-qm', 'other'], { cwd: other, env: rig.env })
  // started from inside another repo's git hook, by npm run, from node --test on a terminal
  await rig.stop()
  const starter = { GIT_DIR: join(other, '.git'), GIT_INDEX_FILE: join(other, '.git', 'index'), FORCE_COLOR: '1', npm_lifecycle_event: 'test', INIT_CWD: other }
  Object.assign(rig.env, starter)
  await rig.start()
  for (const k of Object.keys(starter)) delete rig.env[k]
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'mine' })
  writeFileSync(join(ws.path, 'mine.txt'), 'y\n')
  const d = await rig.rpc('diff', { ws: ws.id })
  assert.deepEqual(d.files.map((f: any) => f.path), ['mine.txt'], "its own repo's diff")
  assert.doesNotMatch(execFileSync('git', ['worktree', 'list'], { cwd: other, env: rig.env, encoding: 'utf8' }), /mine/, "no worktree in the other repo")
  const tab = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const out = join(rig.home, 'tab-env')
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('$'), 'its prompt')
  await rig.rpc('input', { tab, data: `env > ${out}.tmp; mv ${out}.tmp ${out}\r` })
  const env = (await until(() => existsSync(out) && readFileSync(out, 'utf8'), 'its env', 20000)) as string
  for (const k of Object.keys(starter)) assert.doesNotMatch(env, new RegExp(`^${k}=`, 'm'), k)
  assert.match(env, /^HOME=/m, 'the rest as it was')
  const named = (await rig.rpc('doctor')).starterEnv as string[]
  for (const k of Object.keys(starter)) assert.ok(named.includes(k), `doctor names ${k}`)
  assert.ok(!named.includes('HOME') && !named.includes('PATH'), 'names it left out only')
})

test('daemon start: a stale lock is taken over; from the app, the login shell\'s PATH; a dev origin when configured', async t => {
  const rig = await fresh(t)
  await rig.stop()
  writeFileSync(join(rig.data, 'daemon.lock'), String(spawnSync('true').pid)) // that process is gone
  // a login shell whose profile adds /login/bin (only the PATH probe sees it: tabs show what the daemon took)
  const sh = join(rig.home, 'login-sh')
  writeFileSync(sh, `#!/bin/sh\ncase "$2" in *__LAKI__*) PATH="$PATH:/login/bin" ;; esac\nexec '${rig.env.SHELL}' "$@"\n`, { mode: 0o755 })
  Object.assign(rig.env, { SHELL: sh, LAKI_FROM_APP: '1', LAKI_DEV_ORIGIN: 'http://127.0.0.1:5199,https://evil.example' })
  await rig.start()
  assert.equal(readFileSync(join(rig.data, 'daemon.lock'), 'utf8'), String(rig.info().pid))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = await rig.rpc('tabNew', { ws: ws.id, cmd: 'case ":$PATH:" in *:/login/bin:*) echo login-path: yes ;; *) echo login-path: no ;; esac; exec cat' })
  await until(async () => /login-path: \w+/.test(await rig.screen(tab.id)), 'the PATH checked')
  assert.match(await rig.screen(tab.id), /login-path: yes/)
  const c = await connect(rig, 'http://127.0.0.1:5199')
  assert.equal(await c.call('ping'), 'pong')
  c.close()
  await assert.rejects(connect(rig, 'http://localhost:5199'))
  await assert.rejects(connect(rig, 'https://evil.example')) // only this Mac's: a site in the env isn't let in
})

test('the view goes out only when it changed: tool calls that keep a tab running send none', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.tab(ws.id)).resumeId, 'its SessionStart') // its own hook, else it goes out below
  const app = await connect(rig)
  t.after(() => app.close())
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PreToolUse' } })
  await until(() => app.events.some((m: any) => m.ev === 'state' && m.view.tabs.find((x: any) => x.id === tab.id)?.status === 'running' && m.view.workspaces[0].pr), 'running, its PR scanned')
  // a window's first view comes once the daemon knows whose it is (S3), and the change after it goes out to all,
  // the same or not (core's hello): have that one out before counting
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUse' } })
  await sleep(300) // anything else under way goes out
  app.events.splice(0)
  for (const h of ['PostToolUse', 'PreToolUse', 'PostToolUse']) await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: h } })
  await sleep(200)
  assert.equal(app.events.filter((m: any) => m.ev === 'state').length, 0)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'done' } })
  await until(() => app.events.some((m: any) => m.ev === 'state' && m.view.tabs.find((x: any) => x.id === tab.id)?.status === 'idle'), 'idle goes out')
})

test("Laki AI's timers: checked here, done by the app's window, its answer back", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('timer', { act: 'nap' }), /one of timer, remind/)
  await assert.rejects(rig.rpc('timer', { act: 'timer' }), /for how long/)
  await assert.rejects(rig.rpc('timer', { act: 'remind', minutes: 5, ws: 'nope' }), /nope/)
  await assert.rejects(rig.rpc('timer', { act: 'send', minutes: 5, tab: 'nope', text: 'hi' }), /an agent tab's id/)
  await assert.rejects(rig.rpc('timer', { act: 'timer', minutes: 5 }), /open the app/)
  const app = await connect(rig)
  t.after(() => app.close())
  app.notify('view', { tab: null, tabs: [], focused: false, browse: true })
  const got: any[] = []
  const relay = setInterval(() => {
    for (const m of app.events.splice(0)) if (m.ev === 'timer') (got.push(m), app.call('browseDone', m.act === 'stop' ? { id: m.req, ok: false, error: `no timer or stopwatch ${m.which}` } : { id: m.req, ok: true, result: { id: 'x1' } }))
  }, 20)
  t.after(() => clearInterval(relay))
  await until(async () => (await rig.rpc('timer', { act: 'remind', minutes: 0.5, ws: ws.id, note: ' stand up ' }).catch(() => null))?.id === 'x1', 'the app answers')
  assert.deepEqual([got.at(-1).act, got.at(-1).ms, got.at(-1).ws, got.at(-1).note], ['remind', 30000, ws.id, 'stand up'])
  await assert.rejects(rig.rpc('timer', { act: 'stop', id: 'zz' }), /no timer or stopwatch zz/)
})

test('an image as it was where the changes start (Changes before and after), and as it is now', async t => {
  const rig = await fresh(t)
  const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n])
  writeFileSync(join(rig.repo, 'logo.png'), png(1))
  writeFileSync(join(rig.repo, 'notes.txt'), 'x\n')
  execFileSync('git', ['add', '-A'], { cwd: rig.repo, env: rig.env })
  execFileSync('git', ['commit', '-qm', 'logo'], { cwd: rig.repo, env: rig.env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'logo.png'), png(2))
  execFileSync('git', ['commit', '-qam', 'new logo'], { cwd: ws.path, env: rig.env }) // committed: still against the base
  writeFileSync(join(ws.path, 'added.png'), png(3))
  const read = (path: string, base?: boolean) => rig.rpc('fileRead', { ws: ws.id, path, base })
  assert.deepEqual(await read('logo.png', true), { size: 5, image: `data:image/png;base64,${png(1).toString('base64')}` })
  assert.deepEqual(await read('logo.png'), { size: 5, image: `data:image/png;base64,${png(2).toString('base64')}` })
  await assert.rejects(read('added.png', true), /not in main/)
  await assert.rejects(read('notes.txt', true), /isn't an image/)
  await assert.rejects(read('../x.png', true), /not a path inside/)
})

test("a caller's clock (now) moves the ticks only in a test's daemon: elsewhere a date years ahead tidies nothing", async t => {
  const rig = await fresh(t, { env: { LAKI_TEST_CLOCK: '0' } }) // a daemon that takes no caller's clock, as every other does
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const dir: string = await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).storage, 'its storage folder')
  writeFileSync(join(dir, 'keep.md'), 'mine')
  await rig.rpc('settingsSet', { storageDays: 30 })
  const far = Date.now() + 10 * 365 * 86400000
  assert.equal(await rig.rpc('storageTidy', { now: far }), 0)
  assert.ok(existsSync(join(dir, 'keep.md')))
})

test("an extension's https picture comes through the daemon's /img, behind its own key: never the app window's fetch (L7)", async t => {
  const rig = await fresh(t, { env: { LAKI_TEST_DNS: JSON.stringify({ 'pics.example': '127.0.0.1', 'v6.example': '::1' }) } })
  const { port } = rig.info()
  const v = await rig.rpc('state')
  assert.match(v.imgKey, /\w{16,}/)
  const img = (k: string, u: string) => fetch(`http://127.0.0.1:${port}/img?k=${k}&u=${encodeURIComponent(u)}`)
  assert.equal((await img('nope', 'https://example.com/a.png')).status, 401)
  assert.equal((await img(v.imgKey, 'http://example.com/a.png')).status, 400) // https only
  assert.equal((await img(v.imgKey, 'file:///etc/passwd')).status, 400)
  for (const u of ['https://127.0.0.1:1/a.png', 'https://localhost/a.png', 'https://192.168.1.1/a.png', 'https://[::1]/a.png']) assert.equal((await img(v.imgKey, u)).status, 400, u) // never this Mac's or the LAN's
  // nor a name that resolves to one (the rig's resolver: LAKI_TEST_DNS), refused before any connection
  const hit = createServer((_q, r) => (hits++, r.end()))
  let hits = 0
  await new Promise<void>(ok => hit.listen(0, '127.0.0.1', ok))
  t.after(() => hit.close())
  for (const name of ['pics.example', 'v6.example']) assert.equal((await img(v.imgKey, `https://${name}:${(hit.address() as AddressInfo).port}/a.png`)).status, 400, name)
  assert.equal(hits, 0, 'nothing reached this Mac')
})
