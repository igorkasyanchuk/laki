// What an agent's call may not do through the daemon (main.ts' FROM and agentNo), said by its from: removing things asks
// the user, files and tabs are its own workspace's, a PR isn't merged as you, the settings and switches that are yours,
// and Recording mode's private workspaces. test/caller.test.ts proves the from is its process's, whatever it says
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { AGENT_NO, AGENT_OK, AGENT_OWN } from '../src/daemon/gates.ts'
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

test("S3: the view's secrets are your window's alone: the CLI's and an agent's state, and remote access's link, are masked; masks sent back change nothing", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { env: { API_KEY: 'fake-secret' }, webhook: { url: 'https://api.telegram.example/botfake-secret/sendMessage', format: 'json' }, presets: [{ name: 'mine', agent: 'claude', env: { TOKEN: 'fake-secret' } }] })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await rig.rpc('projectSet', { id: p.id, config: { env: { PROJ: 'fake-secret' } } }) // a project's env too
  // /rpc's state (the CLI, MCP, an agent's laki ls --json): names and hosts, no values
  for (const from of [undefined, { ws: ws.id, tab }]) {
    const v = await rig.rpc('state', { from })
    assert.ok(!JSON.stringify(v).includes('fake-secret'), 'no secret in the view')
    assert.deepEqual([v.settings.env, v.settings.webhook.url, v.settings.presets[0].env], [{ API_KEY: '•••' }, 'https://api.telegram.example/•••', { TOKEN: '•••' }])
  }
  // your own window's: as they are
  const app = await connect(rig)
  const mine = (await until(() => app.events.findLast(m => m.ev === 'state'), 'its first state')).view as View
  assert.equal(mine.settings.env?.API_KEY, 'fake-secret')
  assert.match(mine.settings.webhook?.url ?? '', /botfake-secret/)
  // a masked view's Settings saving every key: the real ones stay
  const seen = (await rig.rpc('state')).settings
  await rig.rpc('settingsSet', { env: seen.env, webhook: seen.webhook, presets: seen.presets, agent: 'codex' })
  const kept = (await until(() => app.events.findLast(m => m.ev === 'state' && (m.view as View).settings.agent === 'codex'), 'saved')).view as View
  assert.deepEqual([kept.settings.env, kept.settings.presets?.[0].env], [{ API_KEY: 'fake-secret' }, { TOKEN: 'fake-secret' }])
  const proj = (await rig.rpc('state')).projects[0]
  assert.deepEqual(proj.config.env, { PROJ: '•••' })
  await rig.rpc('projectSet', { id: p.id, config: proj.config })
  assert.deepEqual((await rig.rpc('stateOwn')).projects[0].config.env, { PROJ: 'fake-secret' })
  // what settingsSet answers with: whole to you, masked to an agent
  assert.deepEqual((await rig.rpc('settingsSet', { from: { ws: ws.id, tab } })).env, { API_KEY: '•••' })
  assert.deepEqual((await rig.rpc('settingsSet', {})).env, { API_KEY: 'fake-secret' })
  // the whole view: stateOwn, never an agent's
  await assert.rejects(rig.rpc('stateOwn', { from: { ws: ws.id, tab } }), /an agent can't read the view's secrets/)
  assert.equal((await rig.rpc('stateOwn')).remote, undefined)
})

// S1: daemon.json's token says nothing of who calls: a process in no tab is you only with a terminal of its own (yours),
// else (an agent's setsid and double fork out of its tab) it's refused; the app's own token is you, from anywhere
test("S1: a detached process with daemon.json's token is refused what's yours; the CLI from a terminal and the app's window aren't", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, kind: 'local', name: 'one' })
  const tab = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const { port, token } = rig.info()
  const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))
  const node = [process.execPath, '--experimental-strip-types', '--no-warnings']
  const env = { ...rig.env } // no LAKI_APP_TOKEN: daemon.json's
  // setsid (detached): no terminal, its parent in no tab, not the daemon's
  const loose = (code: string) =>
    new Promise<string>(ok => {
      const c = spawn(node[0], [...node.slice(1), '-e', code], { env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      c.stdout.on('data', d => (out += d))
      c.on('exit', () => ok(out))
    })
  const post = (method: string, params: object) => `fetch('http://127.0.0.1:${port}/rpc', { method: 'POST', headers: { authorization: 'Bearer ${token}' }, body: ${JSON.stringify(JSON.stringify({ method, params }))} }).then(r => r.json())`
  const calls = { tabNew: { ws: ws.id, cmd: 'touch pwned' }, settingsSet: { nextPrompt: true }, answer: { tab, n: 1 }, prAct: { ws: ws.id, act: 'merge' }, wsSet: { id: ws.id, name: 'taken' } }
  const said = JSON.parse(await loose(`Promise.all([${Object.entries(calls).map(([m, x]) => post(m, x)).join(', ')}, ${post('ping', {})}, ${post('appPair', {})}]).then(r => console.log(JSON.stringify(r)))`))
  for (const [i, m] of Object.keys(calls).entries()) assert.equal(said[i].error, "couldn't tell who's calling: try again", m)
  assert.equal(said[5].result, 'pong', 'what asks no one who: still answered')
  assert.match(said[6].error, /only Laki's app gets its token/)
  assert.ok(!existsSync(join(ws.path, 'pwned')))
  assert.equal((await rig.rpc('state')).settings.nextPrompt, undefined)
  // the CLI from a terminal of yours (script gives it one): you, once you allowed that terminal in the window
  const app = await connect(rig)
  const term = spawn('script', ['-q', '/dev/null', ...node, cli, 'rename', ws.id, 'by-you'], { env, stdio: 'ignore' })
  const ask: any = await seen(app, (e: any) => e.ev === 'termAsk', 'the terminal asked about')
  await app.call('termAnswer', { req: ask.req, allow: true })
  await new Promise(ok => term.on('exit', ok))
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).name, 'by-you')
  // the same command detached: refused
  const d = await loose(`require('node:child_process').execFile(${JSON.stringify(node[0])}, ${JSON.stringify([...node.slice(1), cli, 'rename', ws.id, 'by-it'])}, (e, o, er) => console.log(er))`)
  assert.match(d, /couldn't tell who's calling/)
  // the app's window (its token, from main's conn): yours, no terminal needed
  await app.call('settingsSet', { nextPrompt: true })
  await app.call('wsSet', { id: ws.id, name: 'from-the-app' })
  assert.equal((await rig.rpc('state')).settings.nextPrompt, true)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).name, 'from-the-app')
  app.close()
})

// S5: deny unless allowed: every method of api is classified (main.ts checks it as it loads; this reads its source)
test('S5: every api method is in FROM, CALLER or OPEN', () => {
  const s = readFileSync(fileURLToPath(new URL('../src/daemon/main.ts', import.meta.url)), 'utf8')
  const at = s.indexOf('const api: Record<string, Handler> = {')
  const keys = [...s.slice(at, s.indexOf('\n}\n', at)).matchAll(/^ {2}(\w+): /gm)].map(m => m[1])
  const set = (n: string) => new Set(JSON.parse(`[${new RegExp(`const ${n} = new Set\\(\\[([^\\]]*)\\]`).exec(s)![1].replace(/'/g, '"')}]`) as string[])
  const [from, caller, open] = ['FROM', 'CALLER', 'OPEN'].map(set)
  assert.ok(keys.length > 250, 'the api table read')
  assert.deepEqual(keys.filter(k => !from.has(k) && !caller.has(k) && !open.has(k)), [])
  assert.deepEqual(keys.filter(k => open.has(k) && (from.has(k) || caller.has(k))), [], 'in one class each')
  // the agent gate's own classes (gates.ts): an agent's, the user's, or a branch of agentNo's or boxNo's: once each
  const sets = [AGENT_OK, new Set(Object.keys(AGENT_NO)), AGENT_OWN]
  assert.deepEqual(keys.filter(k => sets.filter(x => x.has(k)).length !== 1), [], 'each in exactly one of AGENT_OK, AGENT_NO, AGENT_OWN')
  assert.deepEqual(sets.flatMap(x => [...x]).filter(k => !keys.includes(k)), [], 'every name listed is a method')
  assert.deepEqual(Object.keys(AGENT_NO).filter(k => !from.has(k) && !caller.has(k)), [], "a refusal reads a from the daemon filled in")
  const gate = s.slice(s.indexOf('function boxNo('), s.indexOf('const crossOk'))
  assert.deepEqual([...AGENT_OWN].filter(k => !gate.includes(`'${k}'`) && !/^(file|hunk)/.test(k)), [], 'AGENT_OWN: a branch of its own names it')
})

test("S5: what was never classified: Laki AI's key, the CLI, remote access, a test push, Resources, notes and to-dos are yours; PR links and ports its own; removals ask", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, kind: 'local', name: 'two' })
  const tab = (await until(() => rig.tab(one.id))).id
  const from = { ws: one.id, tab }
  const note = await rig.rpc('noteNew', { title: 'mine' })
  const no: [string, object][] = [
    ['aiKey', { key: 'fake-secret' }],
    ['aiEndpointKey', { key: 'fake-secret' }],
    ['aiEndpointTest', {}],
    ['settingsSet', { aiEndpoint: { url: 'https://example.com/v1', model: 'm' } }],
    ['cliInstall', {}],
    ['cliRemove', {}],
    ['remoteStop', {}],
    ['webhookTest', { url: 'https://example.com/x' }],
    ['resourceStop', { key: 'ai' }],
    ['flowTest', {}],
    ['noteList', {}],
    ['noteGet', { id: note.id }],
    ['noteFile', { id: note.id, name: 'x' }],
    ['noteNew', {}],
    ['noteSave', { id: note.id, md: 'x' }],
    ['noteUpload', { id: note.id, data: '' }],
    ['todoListGet', {}],
    ['todoListSave', { items: [] }],
    // what nobody had listed (gates.ts): the clock, accounts, skills, the user's chats and review marks
    ['archivedTidy', { now: 9e15 }],
    ['flowTick', { now: 9e15 }],
    ['accountAdd', { agent: 'claude', name: 'x' }],
    ['accountSet', { id: 'x', name: 'y' }],
    ['skillSet', { agent: 'claude', on: false }],
    ['tabSleep', { tab }],
    ['prViewed', { ws: one.id, path: 'a', viewed: true }],
    ['sideState', { tab }],
    ['studioChats', {}],
    ['aiImage', { path: 'x' }],
    ['passkeyPin', { pin: '0000' }],
  ]
  for (const [m, x] of no) await assert.rejects(rig.rpc(m, { ...x, from }), /an agent can't .*: it's the user's \(ask them\)/, m)
  for (const m of ['prAttach', 'prDetach', 'prLabel']) await assert.rejects(rig.rpc(m, { ws: two.id, pr: '1', label: 'x', on: true, from }), /its own workspace's PR only/, m)
  await assert.rejects(rig.rpc('portKill', { ws: two.id, port: 1, from }), /its own workspace only/)
  // removals: asked in the app (none open here: refused)
  await assert.rejects(rig.rpc('noteRm', { id: note.id, from }), /says yes in Laki's window, and it isn't open/)
  await assert.rejects(rig.rpc('planRm', { project: p.id, kind: 'spec', slug: 'nope', from }), /isn't open/)
  await assert.rejects(rig.rpc('widgetRm', { id: 'nope', from }), /isn't open/)
  assert.equal((await rig.rpc('noteGet', { id: note.id })).title, 'mine', 'yours: kept')
  // a sandboxed agent: no Terminals workspace either
  const boxed = await rig.rpc('tabNew', { ws: one.id, preset: 'claude', sandbox: true, perm: '' })
  await assert.rejects(rig.rpc('quickNew', { kind: 'shells', from: { ws: one.id, tab: boxed.id } }), /a sandboxed agent can't open a terminal/)
  // yours: a test push never to your network's addresses; the rest as before
  await assert.rejects(rig.rpc('webhookTest', { url: 'https://192.168.1.2/hook' }), /on the internet/)
  await rig.rpc('noteRm', { id: note.id })
  await assert.rejects(rig.rpc('noteGet', { id: note.id }))
})

// S7: a page an agent wrote runs nowhere outside Laki's viewer (no browser either), and its Expose to the world asks you
// unless the project says who gets in, which then holds for every caller
test("S7: an agent's file in a browser is refused; its tunnel asks (a no leaves none); a project's expose holds for everyone", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  const from = { ws: ws.id, tab }
  await rig.rpc('fileNew', { ws: ws.id, path: 'page.html', from })
  for (const app of ['chrome', 'safari', 'default']) await assert.rejects(rig.rpc('openIn', { ws: ws.id, app, file: 'page.html', from }), /an agent can't open a file (in a browser|with its default app)/, app)
  await rig.rpc('openIn', { ws: ws.id, app: 'chrome', file: 'page.html' }) // yours
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  // no window: refused; asked: a no, no tunnel
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, hours: 0, from }), /says yes in Laki's window, and it isn't open/)
  const app = await connect(rig)
  const going = rig.rpc('tunnelStart', { ws: ws.id, port: 5173, hours: 0, from }).then(() => '', e => String(e.message))
  const ask = await seen(app, m => m.ev === 'toolAsk' && m.cross === 'expose', 'asked in the app')
  assert.equal(ask.target, 'Expose localhost:5173 to the world?')
  assert.match(ask.text, /Anyone with the link, until you stop it/)
  await rig.rpc('widgetToolAnswer', { req: ask.req, allow: 'deny' })
  assert.match(await going, /the user said no/)
  assert.deepEqual((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).tunnels ?? [], [])
  // the project's expose: no ask, and only those, for you too
  await rig.rpc('projectSet', { id: p.id, config: { expose: 'me@x.dev, team.dev' } })
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), /lets in only me@x\.dev, \*@team\.dev \(its expose\), not anyone with the link/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: ['you@y.dev'], from }), /not you@y\.dev/)
  const tn = await rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: ['bob@team.dev'], from })
  assert.deepEqual(tn.mails, ['bob@team.dev'])
  assert.ok(!app.events.some(m => m.ev === 'toolAsk' && m.cross === 'expose' && m.req !== ask.req), 'not asked')
  await rig.rpc('tunnelStop', { ws: ws.id, port: 5173 })
  app.close()
})

// F14: a project's auto-answer rules are the user's: an agent can't add or change one; a matching ask is answered Allow
// as the user's click would (counted on the rule, said on the tab), a near miss and a risky command stay asked
test("F14: an agent can't add an auto-answer rule; a matching ask is answered, a near miss and the deny list aren't", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = await until(() => rig.tab(ws.id))
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  const from = { ws: ws.id, tab: tab.id }
  await assert.rejects(rig.rpc('projectSet', { id: p.id, allow: [{ tool: 'Bash', pattern: 'npm test' }], from }), /an agent can't change a project's auto-answer rules/)
  await assert.rejects(rig.rpc('projectSet', { id: p.id, allow: [{ tool: 'Bash', pattern: 'rm -rf build' }] }), /not a rule Laki takes/)
  await rig.rpc('projectSet', { id: p.id, allow: [{ tool: 'Bash', pattern: 'npm test' }, { tool: 'Bash', pattern: 'git' }] })
  const now = async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)
  // npm test: answered with Yes, no one asked
  await rig.rpc('send', { target: tab.id, text: 'perm bash :: npm test -- --watch' })
  await until(async () => /picked: Yes\b/.test(await rig.screen(tab.id)), 'answered Yes by the rule', 15000)
  const after = await until(async () => (t => t.allowed?.length && t)(await now()), 'the tab says so')
  assert.deepEqual(after.allowed.map((a: any) => [a.tool, a.what, a.rule]), [['Bash', 'npm test -- --watch', 'Bash: npm test']])
  assert.equal((await rig.rpc('state')).projects.find((x: any) => x.id === p.id).allow[0].hits, 1)
  // a near miss and a risky command under a matching rule (git …): asked as ever
  for (const cmd of ['npm testx', 'git push --force origin main']) {
    await rig.rpc('send', { target: tab.id, text: `perm bash :: ${cmd}` })
    await until(async () => (t => t.status === 'waiting' && t.ask?.what === cmd)(await now()), `${cmd} asked`)
    await new Promise(r => setTimeout(r, 1500)) // past the rule's wait for the menu
    assert.equal((await now()).status, 'waiting', cmd)
    await rig.rpc('answer', { tab: tab.id, pick: 'last' })
    await until(async () => (await now()).status !== 'waiting', 'answered No')
  }
  assert.equal((await now()).allowed.length, 1)
})
