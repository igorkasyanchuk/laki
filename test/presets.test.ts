// How agents start: the prompt as an env var (never shell-quoted), agent variables, presets, model, effort, permission and fast mode.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type TestContext, test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

// a prompt that would break out of POSIX quoting under fish (\' is an escape there) reaches the agent as typed
const SLY = "fix it \\';echo pwned >> \"$HOME/pwned\";#"
async function slyPrompt(t: TestContext, env?: Record<string, string>) {
  const rig = await fresh(t, env && { env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { devMode: true }) // the workspace's log has each tab's command line
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: SLY })
  const run = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'claude'), 'claude up')
  assert.equal(run.args.at(-1), SLY)
  // the shell's line names it ("$LAKI_ARG_n"); the prompt itself isn't in it
  const line = (await rig.rpc('logs', { key: `ws:${ws.id}` })).map((l: { text: string }) => l.text).find((l: string) => l.includes(' claude '))
  assert.match(line, /"\$LAKI_ARG_\d+"/)
  assert.ok(!line.includes("';echo"), line)
  assert.match(run.args[run.args.indexOf('--append-system-prompt') + 1], /Laki/) // the note, whole
  await sleep(500)
  assert.ok(!existsSync(join(rig.home, 'pwned')), 'nothing ran')
}
test("an agent's prompt goes in as an env var, never shell-quoted: one ending in \\';echo pwned;# reaches claude unchanged", async t => {
  await slyPrompt(t)
})
test('the same through real fish (skipped without it)', async t => {
  const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(f => existsSync(f))
  if (!fish) return t.skip('fish is not installed')
  await slyPrompt(t, { SHELL: fish })
})

test('agent variables: {{branch}}, {{tab}}… filled where asked (vars: a template, an action, a schedule), a message as typed', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'on {{ branch }} at {{port}}', vars: true })
  await until(async () => (await rig.tab(ws.id)).last === `answer: on ${ws.branch} at ${ws.port}`, 'first prompt filled')
  const tab = await rig.tab(ws.id) // named by its first prompt by now
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.pr, 'its PR scanned')
  // an action's: the fake gh has PR 42 for every branch; an unknown {{name}} and a date token stay
  await rig.rpc('send', { target: ws.id, text: '{{tab}}/{{agent}} in {{project}} ({{workspace}}), {{pr}}, {{nope}} {{DD}}', vars: true })
  await until(async () => /^answer: .+\/claude in repo \(.+\), https:\/\/\S+\/42, \{\{nope\}\} \{\{DD\}\}$/.test((await rig.tab(ws.id)).last), 'action filled')
  assert.ok((await rig.tab(ws.id)).last.startsWith(`answer: ${tab.name}/claude in repo (${ws.name ?? ws.id})`))
  // a message as typed: left alone
  await rig.rpc('send', { target: ws.id, text: 'keep {{branch}}' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: keep {{branch}}', 'message kept')
  // a shell's: a value it would read as code goes in quoted, a plain one as it is
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  await rig.rpc('tabSet', { id: sh.id, name: 'x;echo PWNED' })
  await new Promise(r => setTimeout(r, 800)) // its prompt
  await rig.rpc('send', { target: sh.id, text: 'echo {{tab}} > {{path}}/vars.txt', vars: true })
  await until(() => existsSync(join(ws.path, 'vars.txt')) && readFileSync(join(ws.path, 'vars.txt'), 'utf8') === 'x;echo PWNED\n', 'quoted for the shell')
})

test('presets: args and env on top of the project env; Esc ends a turn; reorder; workspace color and pin', async t => {
  const rig = await fresh(t, { config: { env: { TEST_FILE: 'f', TEST_SHARED: 'file' } } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { env: { TEST_SHARED: 'app', 'bad key': 'x' } } })
  await rig.rpc('settingsSet', { agent: 'opus', presets: [{ name: 'opus', agent: 'claude', args: '--model opus', env: { TEST_PRESET: 'yes' } }] })
  const ws = await rig.rpc('wsNew', { project: p.id })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.name, tab.preset, tab.profile], ['opus', 'claude', 'opus'])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  const run = rig.fakeLog().find(l => l.bin === 'claude')
  assert.deepEqual(run.args.slice(-2), ['--model', 'opus'])
  assert.deepEqual(run.env, { TEST_FILE: 'f', TEST_SHARED: 'app', TEST_PRESET: 'yes' })
  // Esc: no hook says the turn ended, the screen does
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await rig.rpc('input', { tab: tab.id, data: 'slow work\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'running')
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle after Esc')

  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'second' })
  await rig.rpc('reorder', { workspaces: [ws2.id, ws.id] })
  await rig.rpc('wsSet', { id: ws2.id, color: 'pink', pinned: true })
  const v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id, ws.id])
  assert.equal(v.workspaces[0].color, 'pink')
  assert.equal(v.workspaces[0].pinned, true)
  assert.equal(v.workspaces[0].run, false)
  await rig.rpc('wsSet', { id: ws2.id, pinned: false }) // unpinned: the field goes
  assert.equal((await rig.rpc('state')).workspaces[0].pinned, undefined)

  // seps: named lines between a project's workspaces; a bad one is dropped, a drag keeps the whole order
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: '  Later  ' }, { id: 'bad id', name: 'x' }, { id: 'sep-b2', name: ' ' }, { id: 'sep-a1', name: 'again' }], rows: [ws2.id, 'sep-a1', ws.id, 7] })
  let pr = (await rig.rpc('state')).projects[0]
  assert.deepEqual(pr.seps, [{ id: 'sep-a1', name: 'Later' }])
  // a sep's color: a color's name, kept; none or a bad one, none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', color: 'teal' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', color: 'teal' }])
  for (const color of ['none', 'url(x)', 7]) {
    await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', color }] })
    assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later' }])
  }
  // its default prompt template: a name, kept trimmed; empty or not a string, none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', template: ' Bugfix ' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', template: 'Bugfix' }])
  for (const template of ['', '  ', 7, null]) {
    await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', template }] })
    assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later' }])
  }
  // a sep's sort (manual too: over the project's); the project's own, manual or a bad one: none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', sort: 'name' }, { id: 'sep-b1', name: 'B', sort: 'manual' }, { id: 'sep-c1', name: 'C', sort: 'size' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', sort: 'name' }, { id: 'sep-b1', name: 'B', sort: 'manual' }, { id: 'sep-c1', name: 'C' }])
  await rig.rpc('projectSet', { id: p.id, sort: 'activity' })
  assert.equal((await rig.rpc('state')).projects[0].sort, 'activity')
  for (const sort of ['manual', 'size']) {
    await rig.rpc('projectSet', { id: p.id, sort })
    assert.equal((await rig.rpc('state')).projects[0].sort, undefined)
  }
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later' }] })
  assert.deepEqual(pr.rows, [ws2.id, 'sep-a1', ws.id])
  await rig.rpc('reorder', { workspaces: ['sep-a1', ws.id, ws2.id] })
  const v2 = await rig.rpc('state')
  assert.deepEqual(v2.projects[0].rows, ['sep-a1', ws.id, ws2.id])
  assert.deepEqual(v2.workspaces.map((w: any) => w.id), [ws.id, ws2.id])
  // a new workspace's place: first under a sep, first in the project, or last
  const under = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'under', place: 'sep-a1' })
  const top = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'top', place: 'top' })
  const last = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'last' })
  assert.deepEqual((await rig.rpc('state')).projects[0].rows, [top.id, 'sep-a1', under.id, ws.id, ws2.id])
  const order = () => rig.rpc('state').then((v: any) => v.workspaces.map((w: any) => w.id))
  assert.equal((await order()).at(-1), last.id)
  await rig.rpc('projectSet', { id: p.id, seps: [] }) // the last one gone: so is the order
  pr = (await rig.rpc('state')).projects[0]
  assert.equal(pr.seps, undefined)
  assert.equal(pr.rows, undefined)
  const first = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'first', place: 'top' }) // no seps: the workspaces' order
  assert.equal((await order())[0], first.id)
})

test('an unknown preset or a custom one without a command is refused before a worktree is made', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'c', preset: 'aider' }), /unknown preset aider/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'c', preset: 'custom' }), /command missing/)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'aider' }), /unknown preset aider/)
  const v = await rig.rpc('state')
  assert.deepEqual([v.workspaces.length, v.tabs.length], [1, 0])
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/c'], { cwd: rig.repo, encoding: 'utf8' }), '')
})

test('a command without a preset runs as the custom preset, for a new workspace too', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, name: 'cmd', cmd: 'echo from-new; sleep 5' })
  const tab = (await rig.rpc('state')).tabs.find((x: { workspace: string }) => x.workspace === ws.id)
  assert.equal(tab.preset, 'custom')
  await until(async () => (await rig.screen(tab.id)).includes('from-new'), 'the command ran')
})

test('a model and effort go into the agent\'s flags (a wrong one makes nothing); a turn\'s start; the board\'s to-dos', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', model: 'opus; rm -rf ~' }), /model opus; rm -rf ~\?/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', effort: 'huge' }), /effort huge\? low, medium, high, xhigh, max/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', effort: 'high' }), /gemini takes no effort/)
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/m'], { cwd: rig.repo, encoding: 'utf8' }), '')

  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', model: ' opus ', effort: 'high' })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.model, tab.effort, tab.runAt], ['opus', 'high', undefined])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'claude').args.slice(-4), ['--model', 'opus', '--effort', 'high'])
  // runAt: while a turn goes, from its start
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'settled') // the fake's first turn (an Enter at start)
  const before = Date.now()
  await rig.rpc('input', { tab: tab.id, data: 'slow work\r' })
  const at = await until(async () => (await rig.tab(ws.id)).runAt, 'a turn started')
  assert.ok(at >= before && at <= Date.now())
  await new Promise(r => setTimeout(r, 100))
  assert.equal((await rig.tab(ws.id)).runAt, at) // the same turn: the same start
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle after Esc')
  assert.equal((await rig.tab(ws.id)).runAt, undefined)
  // a fork keeps them
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.deepEqual([(await rig.tab(fork.id)).model, (await rig.tab(fork.id)).effort], ['opus', 'high'])

  const cx = await rig.rpc('wsNew', { project: p.id, preset: 'codex', model: 'gpt-x', effort: 'low' })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'codex').args.slice(-4), ['-m', 'gpt-x', '-c', 'model_reasoning_effort="low"'])
  assert.equal((await rig.tab(cx.id)).effort, 'low')

  // to-dos: a project's prompts, waiting
  await assert.rejects(rig.rpc('todoAdd', { project: p.id, text: ' ' }), /needs its text/)
  await assert.rejects(rig.rpc('todoAdd', { project: 'nope', text: 'x' }))
  const todo = await rig.rpc('todoAdd', { project: p.id, text: ' fix the footer ' })
  assert.deepEqual((await rig.rpc('state')).todos, [{ ...todo, text: 'fix the footer' }])
  await rig.rpc('todoRm', { id: todo.id })
  assert.deepEqual((await rig.rpc('state')).todos, [])
  // a to-do's pasted images: imageSave's only, the image alone is enough
  const img = await rig.rpc('imageSave', { data: Buffer.from('png').toString('base64'), ext: 'png' })
  const shot = await rig.rpc('todoAdd', { project: p.id, text: '', images: [img, '/etc/passwd', `${img}/../../state.json`, 7] })
  assert.deepEqual(shot.images, [img])
  // a waiting to-do's image outlives imageDays (the tidy at each imageSave); one no to-do holds goes
  const then = Date.now() - 400 * 86400e3
  const old = (n: string) => join(rig.data, 'images', `${then}-${n}.png`)
  writeFileSync(old('held'), 'png')
  writeFileSync(old('loose'), 'png')
  const held = await rig.rpc('todoAdd', { project: p.id, text: 'look', images: [old('held')] })
  await rig.rpc('imageSave', { data: Buffer.from('png').toString('base64'), ext: 'png' })
  assert.equal(existsSync(old('held')), true)
  assert.equal(existsSync(old('loose')), false)
  // an attached file too (fileSave's), held by its folder; nothing out of it
  const oldFile = (n: string) => join(rig.data, 'files', `${then}-${n}`, 'notes.txt')
  for (const n of ['held', 'loose']) mkdirSync(dirname(oldFile(n)), { recursive: true }), writeFileSync(oldFile(n), 'notes')
  const doc = await rig.rpc('todoAdd', { project: p.id, text: 'read', images: [oldFile('held'), `${rig.data}/files/../state.json`] })
  assert.deepEqual(doc.images, [oldFile('held')])
  await rig.rpc('fileSave', { name: 'x.txt', data: '' })
  assert.equal(existsSync(oldFile('held')), true)
  assert.equal(existsSync(dirname(oldFile('loose'))), false)
  await rig.rpc('todoRm', { id: doc.id })
  await rig.rpc('todoRm', { id: held.id })
  await rig.rpc('todoRm', { id: shot.id })

  // a model isn't a flag; one picked comes after a preset's own args, so it wins
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'claude', model: '-p' }), /model -p\?/)
  await rig.rpc('settingsSet', { presets: [{ name: 'fast', agent: 'claude', args: '--model sonnet' }] })
  const n = rig.fakeLog().filter(l => l.bin === 'claude').length
  await rig.rpc('tabNew', { ws: ws.id, preset: 'fast', model: 'haiku' })
  await until(() => rig.fakeLog().filter(l => l.bin === 'claude').length > n, 'the preset\'s claude')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'claude')[n].args.slice(-4), ['--model', 'sonnet', '--model', 'haiku'])
})

test("a permission mode and fast mode go into the agent's flags, kept for restarts and forks", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', perm: 'yolo' }), /permission mode yolo\? auto, acceptEdits, plan, bypassPermissions/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', perm: 'auto' }), /gemini has no permission modes/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', fast: true }), /gemini has no fast mode/)
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/m'], { cwd: rig.repo, encoding: 'utf8' }), '')

  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', perm: 'plan', fast: true })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.perm, tab.fast], ['plan', true])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  const args = rig.fakeLog().find(l => l.bin === 'claude').args
  assert.deepEqual(args.slice(-2), ['--permission-mode', 'plan'])
  const settings = args[args.indexOf('--settings') + 1]
  assert.match(settings, /claude-settings-fast\.json$/)
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).fastMode, true)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'settled') // its chat's id: a fork resumes it
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.deepEqual([(await rig.tab(fork.id)).perm, (await rig.tab(fork.id)).fast], ['plan', true])

  const cx = await rig.rpc('wsNew', { project: p.id, preset: 'codex', perm: 'acceptEdits', fast: true })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'codex').args.slice(-6), ['-s', 'workspace-write', '-a', 'never', '-c', 'service_tier="fast"'])
  assert.equal((await rig.tab(cx.id)).perm, 'acceptEdits')

  // a profile's mode and fast mode when the workspace picks none ('' and false: none, over the profile's), read at each
  // start; a profile whose flags set a mode keeps its own, no second flag
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'codex', agent: 'codex' }, { name: 'planner', agent: 'claude', perm: 'plan', fast: true }, { name: 'cx', agent: 'codex', perm: 'plan', fast: true }, { name: 'mine', agent: 'claude', args: '--permission-mode acceptEdits', perm: 'plan' }, { name: 'cxs', agent: 'codex', args: '-s read-only', perm: 'bypassPermissions' }] })
  const start = async (o: object) => {
    const t = await rig.tab((await rig.rpc('wsNew', { project: p.id, ...o })).id)
    const args: string[] = (await until(() => rig.fakeLog().find(l => l.tab === t.id), 'its start')).args
    const fast = args.includes('service_tier="fast"') || /claude-settings-fast\.json$/.test(args[args.indexOf('--settings') + 1])
    return { t, modes: args.flatMap((a, i) => (['--permission-mode', '-s', '-a'].includes(args[i - 1]) || a.startsWith('--dangerously') ? [a] : [])), fast }
  }
  const planner = await start({ preset: 'planner' })
  assert.deepEqual([planner.t.perm, planner.t.fast, planner.modes, planner.fast], [undefined, undefined, ['plan'], true], 'the profile’s, not kept on the tab')
  const over = await start({ preset: 'planner', perm: 'auto', fast: false })
  assert.deepEqual([over.t.perm, over.t.fast, over.modes, over.fast], ['auto', false, ['auto'], false], 'the tab’s own wins')
  const asks = await start({ preset: 'planner', perm: '' })
  assert.deepEqual([asks.t.perm, asks.modes, asks.fast], ['', [], true], 'ask first, over the profile’s mode')
  const cxp = await start({ preset: 'cx' })
  assert.deepEqual([cxp.modes, cxp.fast], [['read-only'], true])
  assert.deepEqual((await start({ preset: 'mine' })).modes, ['acceptEdits'], 'its flags’ own')
  assert.deepEqual((await start({ preset: 'mine', perm: 'auto' })).modes, ['acceptEdits'])
  assert.deepEqual((await start({ preset: 'cxs' })).modes, ['read-only'])
})
