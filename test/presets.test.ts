// How agents start: the prompt as an env var (never shell-quoted), agent variables, presets, model, effort, permission and fast mode.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { sandboxStop } from '../src/shared/types.ts'
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
  // S12: emptied for claude itself, so its children don't inherit them (fish: kept, its args would be empty)
  if (!env?.SHELL) assert.ok(run.largs.length > 0 && run.largs.every((v: string) => v === ''), JSON.stringify(run.largs))
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
  await sleep(800) // its prompt
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
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'grok', effort: 'high' }), /grok takes no effort/)
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
  await sleep(100)
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
  // the models each agent says it has (its handshake, hooks off; a gateway's custom one too), and an effort only codex
  // names (ultra) taken once it said so
  assert.deepEqual(await rig.rpc('agentModels', { agent: 'claude' }), [{ id: 'opus', name: 'Opus', sub: 'everyday', efforts: ['low', 'high'] }, { id: 'gw/custom-1', name: 'Custom 1' }])
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'u', preset: 'codex', effort: 'ultra' }), /effort ultra\?/)
  assert.deepEqual(await rig.rpc('agentModels', { agent: 'codex' }), [{ id: 'gpt-x', name: 'GPT-X', efforts: ['medium', 'ultra'], def: true }])
  assert.equal((await rig.rpc('wsNew', { project: p.id, name: 'u', preset: 'codex', effort: 'ultra' })).id, 'u')
  assert.deepEqual(await rig.rpc('agentModels', { agent: 'gemini' }), [])
})

test("a permission mode and fast mode go into the agent's flags, kept for restarts and forks", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', perm: 'yolo' }), /permission mode yolo\? auto, acceptEdits, plan, bypassPermissions/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'grok', perm: 'auto' }), /grok has no permission modes/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', fast: true }), /gemini has no fast mode/)
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/m'], { cwd: rig.repo, encoding: 'utf8' }), '')
  // agy's: --mode, --model, --effort
  await rig.rpc('wsNew', { project: p.id, name: 'agy', preset: 'gemini', perm: 'acceptEdits', model: 'gemini-3-pro', effort: 'high' })
  const agy = (await until(() => rig.fakeLog().find(l => l.bin === 'agy'), 'agy up')).args.join(' ')
  for (const f of ['--mode accept-edits', '--model gemini-3-pro', '--effort high']) assert.ok(agy.includes(f), `${f} in ${agy}`)

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

test("the Sandbox switch: claude's sandbox settings with the repo's git folder added, codex's workspace-write with its files writable (never commondir) and its network on; never with bypass permissions", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const git = realpathSync(join(rig.repo, '.git'))
  const argsOf = async (ws: any) => {
    const tab = await rig.tab(ws.id)
    return { tab, args: (await until(() => rig.fakeLog().find(l => l.tab === tab.id), 'its start')).args as string[] }
  }
  const dirs = (args: string[]) => args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []))
  // what git commit writes in a worktree: the repo's objects, refs and logs, the worktree's own folder; not .git's hooks or config
  const writes = (ws: any) => [...['objects', 'refs', 'logs'].map(d => join(git, d)), realpathSync(join(git, 'worktrees', basename(ws.path)))]
  // codex's: that folder's files git writes, never the folder (its commondir, gitdir, config.worktree: where git finds the repo's config)
  const own = (ws: any) => realpathSync(join(git, 'worktrees', basename(ws.path)))
  const codexWrites = (ws: any) => [...writes(ws).slice(0, 3), join(git, 'packed-refs'), join(git, 'packed-refs.lock'), join(git, 'packed-refs.new'), ...[...['index', 'HEAD', 'ORIG_HEAD', 'AUTO_MERGE', 'FETCH_HEAD', 'COMMIT_EDITMSG', 'MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'SQUASH_MSG', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].flatMap(f => [f, `${f}.lock`]), 'logs', 'refs'].map(f => join(own(ws), f))]
  // claude: its settings file with the sandbox on, laki outside it; those folders added, first (--add-dir takes every word up to a flag)
  const cw = await rig.rpc('wsNew', { project: p.id, preset: 'claude', sandbox: true, fast: true })
  const c = await argsOf(cw)
  assert.equal(c.tab.sandbox, true)
  const file = c.args[c.args.indexOf('--settings') + 1]
  assert.match(file, /claude-settings-fast-sandbox\.json$/)
  const box = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual([box.fastMode, box.sandbox.enabled, box.sandbox.autoAllowBashIfSandboxed, box.sandbox.excludedCommands[0]], [true, true, true, 'laki *'])
  assert.match(box.sandbox.excludedCommands[1], /cli(\.js|\/main\.ts)' \*$/) // the laki command agents are told
  assert.deepEqual(dirs(c.args), writes(cw))
  assert.equal(c.args[0], '--add-dir')
  assert.ok(!('sandbox' in JSON.parse(readFileSync(join(rig.data, 'claude-settings.json'), 'utf8'))))
  // S6: Laki's data folder out of its reach, but pasted images and files, the storage folders and worktrees (its own);
  // its Read tool: each other entry (an allow can't carve a deny), the secrets made later too
  assert.deepEqual(box.sandbox.filesystem.denyRead, [rig.data])
  assert.deepEqual(box.sandbox.filesystem.allowRead, ['images', 'files', 'storage', 'worktrees'].map(d => join(rig.data, d)))
  for (const f of ['daemon.json', 'state.json', 'tap-key', 'ai-key', 'accounts', 'hooks', 'pty.json']) assert.ok(box.permissions.deny.includes(`Read(/${join(rig.data, f)}/**)`) && box.permissions.deny.includes(`Read(/${join(rig.data, f)})`), f)
  for (const d of ['images', 'files', 'storage', 'worktrees']) assert.ok(!box.permissions.deny.some((r: string) => r.startsWith(`Read(/${join(rig.data, d)}`)), d)
  assert.ok(cw.path.startsWith(join(rig.data, 'worktrees')), 'its worktree: in an allowed folder')
  // codex: workspace-write, those folders writable, the network on; with its own mode, only those two
  const xw = await rig.rpc('wsNew', { project: p.id, preset: 'codex', sandbox: true })
  const x = await argsOf(xw)
  const roots = (ws: any) => `sandbox_workspace_write.writable_roots=${JSON.stringify(codexWrites(ws))}`
  assert.deepEqual(x.args.slice(-6), ['-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', roots(xw)])
  const listed = (a => JSON.parse(a.slice(a.indexOf('=') + 1)))(x.args.at(-1)!) as string[]
  for (const f of ['', 'commondir', 'gitdir', 'config.worktree', 'rebase-merge']) assert.ok(!listed.includes(join(own(xw), f)), `not ${f || 'the folder'}`)
  const rw = await rig.rpc('wsNew', { project: p.id, preset: 'codex', sandbox: true, perm: 'plan' })
  assert.deepEqual((await argsOf(rw)).args.slice(-6), ['-s', 'read-only', '-c', 'sandbox_workspace_write.network_access=true', '-c', roots(rw)], 'read-only: stricter, kept')
  // a profile's approval flag picks no sandbox: workspace-write still goes in
  await rig.rpc('presetSave', { name: 'cx-never', add: true, set: { agent: 'codex', args: '-a never', sandbox: true } })
  assert.ok((await argsOf(await rig.rpc('wsNew', { project: p.id, preset: 'cx-never' }))).args.join(' ').includes('-s workspace-write'))
  // a local workspace (the repo itself): its objects, refs and logs only; never .git itself (its hooks, config, index)
  const local = await argsOf(await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true, sandbox: true }))
  assert.deepEqual(dirs(local.args), ['objects', 'refs', 'logs'].map(d => join(git, d)))
  // never with bypass permissions: the tab's, the profile's mode or flags; gemini has none
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'b1', preset: 'claude', sandbox: true, perm: 'bypassPermissions' }), /turns the agent's sandbox off/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'b2', preset: 'gemini', sandbox: true }), /gemini has no sandbox/)
  await assert.rejects(rig.rpc('presetSave', { name: 'boxed', add: true, set: { agent: 'codex', sandbox: true, args: '--dangerously-bypass-approvals-and-sandbox' } }), /turns the agent's sandbox off/)
  await assert.rejects(rig.rpc('presetSave', { name: 'boxed', add: true, set: { agent: 'claude', sandbox: true, perm: 'bypassPermissions' } }), /turns the agent's sandbox off/)
  // a profile's, for its tabs; off over it for a workspace (yours), never from an agent's tab
  await rig.rpc('presetSave', { name: 'boxed', add: true, set: { agent: 'codex', sandbox: true } })
  assert.ok((await argsOf(await rig.rpc('wsNew', { project: p.id, preset: 'boxed' }))).args.includes('workspace-write'))
  const off = await argsOf(await rig.rpc('wsNew', { project: p.id, preset: 'boxed', sandbox: false }))
  assert.ok(!off.args.includes('workspace-write') && !off.args.some(a => a.includes('writable_roots')))
  await assert.rejects(rig.rpc('tabNew', { ws: off.tab.workspace, preset: 'boxed', sandbox: false, from: { tab: off.tab.id } }), /outside its profile's sandbox/)
  await assert.rejects(rig.rpc('tabNew', { ws: off.tab.workspace, preset: 'boxed', perm: 'bypassPermissions' }), /turns the agent's sandbox off/)
})

test("a new install starts claude and codex in their sandbox, one from before keeps none; a command its sandbox stopped: its card's line and a restart without it, the user's only", async t => {
  const rig = await fresh(t, { env: { LAKI_TEST_LEAN: '1' } }) // a new install as you get it (the rig's others start without)
  const boxes = async () => Object.fromEntries((await rig.rpc('state')).presets.map((p: { name: string; sandbox?: boolean }) => [p.name, p.sandbox]))
  const now = await boxes()
  assert.deepEqual([now.claude, now.codex], [true, true])
  assert.deepEqual((await rig.rpc('state')).presets.map((p: { name: string; net?: string }) => [p.name, p.net]).filter((x: string[]) => x[0] === 'claude' || x[0] === 'codex'), [['claude', 'list'], ['codex', undefined]])
  assert.equal((await rig.rpc('state')).settings.sandboxNew, true)
  // the words a stop is read from: a failure that says so, the ask to run it outside; anything else is none
  assert.deepEqual(sandboxStop({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'touch /etc/x\nmore' }, error: 'Exit code 1\ntouch: /etc/x: Operation not permitted' }), { cmd: 'touch /etc/x', why: 'touch: /etc/x: Operation not permitted' })
  assert.deepEqual(sandboxStop({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'curl x.dev', dangerouslyDisableSandbox: true } }), { cmd: 'curl x.dev', why: 'it asks to run it outside the sandbox' })
  assert.equal(sandboxStop({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\n2 failing' }), undefined)
  assert.equal(sandboxStop({ hook_event_name: 'PostToolUseFailure', tool_name: 'Edit', error: 'Operation not permitted' }), undefined)
  // a stopped command: the tab's boxed until its next turn; an agent can't take it out of its sandbox, you can
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', local: true })
  const tab = await until(() => rig.tab(ws.id, 'claude'), 'its claude')
  const started = () => rig.fakeLog().filter(l => l.bin === 'claude')
  await until(() => existsSync(rig.env.FAKE_LOG) && started().length === 1, 'claude up')
  const boxOf = (args: string[]) => JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8')).sandbox
  assert.equal(boxOf(started()[0].args)?.enabled, true, 'in its sandbox')
  assert.ok(boxOf(started()[0].args).network.allowedDomains.includes('api.anthropic.com'), "a new install's claude: its list")
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'touch /etc/x' }, error: 'Exit code 1\ntouch: /etc/x: Operation not permitted' } })
  await rig.rpc('hook', { tab: tab.id, state: 'idle' })
  assert.deepEqual((await rig.tab(ws.id, 'claude')).boxed, { cmd: 'touch /etc/x', why: 'touch: /etc/x: Operation not permitted' })
  await assert.rejects(rig.rpc('tabUnbox', { tab: tab.id, from: { ws: ws.id, tab: tab.id } }), /an agent can't restart a tab outside its sandbox/)
  assert.deepEqual(await rig.rpc('tabUnbox', { tab: tab.id }), { restarted: true })
  const after = await rig.tab(ws.id, 'claude')
  assert.deepEqual([after.sandbox, after.boxed], [false, undefined])
  await until(() => started().length === 2, 'started again')
  assert.equal(boxOf(started()[1].args), undefined, 'out of its sandbox')
  assert.equal((await boxes()).claude, true, 'its profile keeps its sandbox')
  await assert.rejects(rig.rpc('tabUnbox', { tab: tab.id }), /isn't in a sandbox/)
  // an install from before (its state.json without the key): its default profiles have no sandbox, and never get one
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  delete st.settings.sandboxNew
  writeFileSync(file, JSON.stringify(st))
  await rig.start()
  const old = await boxes()
  assert.deepEqual([old.claude, old.codex], [undefined, undefined])
  assert.equal((await rig.rpc('state')).settings.sandboxNew, undefined)
})
test("a sandboxed profile's network: claude's list in a settings file of its own (net: list), none for all; codex's off by its flag; the list is the user's", async t => {
  const rig = await fresh(t)
  writeFileSync(join(rig.repo, 'package.json'), '{}') // a project on npm: its registry is on the list
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'listed', add: true, set: { agent: 'claude', sandbox: true, net: 'list' } })
  await rig.rpc('presetSave', { name: 'open', add: true, set: { agent: 'claude', sandbox: true } })
  await rig.rpc('presetSave', { name: 'cut', add: true, set: { agent: 'codex', sandbox: true, net: 'off' } })
  await assert.rejects(rig.rpc('presetSave', { name: 'cut', set: { net: 'list' } }), /Codex's sandbox network is on or off: no list of hosts/)
  await assert.rejects(rig.rpc('presetSave', { name: 'open', set: { net: 'off' } }), /Claude Code has no switch that turns its network off/)
  assert.deepEqual(await rig.rpc('projectNetAllow', { project: p.id, host: 'Example.org' }), { project: p.id, netAllow: ['example.org'] })
  await assert.rejects(rig.rpc('projectNetAllow', { project: p.id, host: 'https://x.dev/path' }), /a host's name/)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'listed', prompt: 'hi', local: true })
  const listed = await until(() => rig.tab(ws.id, 'listed'), 'its claude')
  const run = (bin: string, n: number) => until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().filter(l => l.bin === bin)[n], `${bin} #${n + 1} up`)
  const fileOf = (args: string[]) => args[args.indexOf('--settings') + 1]
  const own = fileOf((await run('claude', 0)).args)
  assert.equal(own, join(rig.data, 'net', `${listed.id}.json`))
  assert.deepEqual(JSON.parse(readFileSync(own, 'utf8')).sandbox.network.allowedDomains, ['registry.npmjs.org', 'github.com', 'api.github.com', 'api.anthropic.com', 'localhost', 'example.org'])
  assert.ok(JSON.parse(readFileSync(own, 'utf8')).sandbox.enabled, "the sandbox variant's own keys stay")
  // all: the variant as it is, no network key
  await rig.rpc('tabNew', { ws: ws.id, preset: 'open' })
  const shared = fileOf((await run('claude', 1)).args)
  assert.ok(shared.endsWith('claude-settings-sandbox.json'), shared)
  assert.equal(JSON.parse(readFileSync(shared, 'utf8')).sandbox.network, undefined)
  // codex off: its flag
  await rig.rpc('tabNew', { ws: ws.id, preset: 'cut' })
  assert.ok((await run('codex', 0)).args.includes('sandbox_workspace_write.network_access=false'))
  // the host its sandbox named as it refused: the card's Allow this domain
  await rig.rpc('hook', { tab: listed.id, state: 'running', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'curl https://evil.dev' }, tool_response: { stdout: 'Connection to evil.dev blocked by the sandbox proxy', stderr: '' } } })
  await rig.rpc('hook', { tab: listed.id, state: 'idle' })
  assert.equal((await until(async () => (await rig.tab(ws.id, 'listed'))?.boxed, 'its card')).host, 'evil.dev')
  // an agent can't change its network, nor the list
  const from = { ws: ws.id, tab: listed.id }
  await assert.rejects(rig.rpc('projectNetAllow', { project: p.id, host: 'evil.dev', from }), /an agent can't change the hosts a sandboxed agent may reach/)
  await assert.rejects(rig.rpc('presetSave', { name: 'listed', set: { net: 'all' }, from }), /an agent can't change a profile's network/)
  assert.deepEqual((await rig.rpc('state')).projects.find((x: { id: string }) => x.id === p.id).netAllow, ['example.org'])
})
test("Hide secret-looking variables from agents: on, claude's env lacks NPM_TOKEN, keeps its own key and its profile's env; off, all of it; the user's alone", async t => {
  const rig = await fresh(t, { env: { NPM_TOKEN: 'fake-npm', ANTHROPIC_API_KEY: 'fake-key', TEST_PLAIN: 'plain' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'claude', set: { env: { TEST_PROFILE_TOKEN: 'mine' } } })
  const envOf = async (n: number) => (await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().filter(l => l.bin === 'claude' && l.args)[n], `claude #${n + 1}`)).env
  assert.equal((await rig.rpc('state')).settings.hideSecrets, undefined, "the rig's: off, as an install from before")
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', local: true })
  assert.deepEqual(await envOf(0), { NPM_TOKEN: 'fake-npm', ANTHROPIC_API_KEY: 'fake-key', TEST_PLAIN: 'plain', TEST_PROFILE_TOKEN: 'mine' })
  await rig.rpc('settingsSet', { hideSecrets: true })
  await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  assert.deepEqual(await envOf(1), { ANTHROPIC_API_KEY: 'fake-key', TEST_PLAIN: 'plain', TEST_PROFILE_TOKEN: 'mine' })
  // what it sees: the names held, never a value; let through for the profile, it's back
  const seen = await rig.rpc('agentContext', { agent: 'claude' })
  assert.equal(seen.profile, 'claude')
  assert.ok(seen.held.includes('NPM_TOKEN') && !seen.held.includes('ANTHROPIC_API_KEY') && !seen.held.some((n: string) => n.startsWith('TEST_')), seen.held.join(' ')) // the shell's own may be there too
  assert.match((await rig.cli('doctor')).out, /\d+ secret-looking variables? kept from agents/)
  const tab = (await rig.tab(ws.id, 'claude')).id
  const from = { ws: ws.id, tab }
  await assert.rejects(rig.rpc('settingsSet', { hideSecrets: false, from }), /an agent can't change that setting/)
  await assert.rejects(rig.rpc('presetSave', { name: 'claude', set: { envAllow: ['NPM_TOKEN'] }, from }), /an agent can't let secret-looking variables through/)
  await rig.rpc('presetSave', { name: 'claude', set: { envAllow: ['NPM_TOKEN', 'not a name'] } })
  assert.ok(!(await rig.rpc('agentContext', { agent: 'claude' })).held.includes('NPM_TOKEN'))
  await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  assert.equal((await envOf(2)).NPM_TOKEN, 'fake-npm')
})
test("an agent's models: none said, or a failure, asked again after a while; a list, kept", async t => {
  const rig = await fresh(t, { env: { LAKI_MODELS_RETRY_MS: '1000' } }) // a failure or none asked again 1 s on: room for two calls under load
  const asks = () => rig.fakeLog().filter((l: any) => l.bin === 'codex' && l.args[0] === 'app-server').length
  await rig.rpc('settingsSet', { env: { FAKE_MODELS: 'fail' } })
  await assert.rejects(rig.rpc('agentModels', { agent: 'codex' }), /ended without its models/)
  await assert.rejects(rig.rpc('agentModels', { agent: 'codex' }), /ended without its models/) // kept: not started again
  assert.equal(asks(), 1)
  await sleep(1100) // past MODELS_RETRY (1 s here)
  await rig.rpc('settingsSet', { env: { FAKE_MODELS: 'empty' } })
  assert.deepEqual(await rig.rpc('agentModels', { agent: 'codex' }), [])
  assert.deepEqual(await rig.rpc('agentModels', { agent: 'codex' }), [])
  assert.equal(asks(), 2)
  await sleep(1100) // past MODELS_RETRY (1 s here)
  await rig.rpc('settingsSet', { env: {} })
  assert.equal((await rig.rpc('agentModels', { agent: 'codex' }))[0].id, 'gpt-x')
  await sleep(1100) // past MODELS_RETRY (1 s here)
  assert.equal((await rig.rpc('agentModels', { agent: 'codex' }))[0].id, 'gpt-x') // a list: a day
  assert.equal(asks(), 3)
})

// the macOS wrapper sandbox (shared/wrap.ts): a fake sandbox-exec first on PATH, recording its arguments, then running
// what it was given
test('wrapper sandbox: a wrapped agy starts through sandbox-exec; a missing one stops the tab and says why; an agent cannot turn it off', { skip: process.platform !== 'darwin' }, async t => {
  const rig = await fresh(t)
  const args = join(rig.home, 'sandbox-exec.args')
  writeFileSync(join(rig.home, 'bin', 'sandbox-exec'), `#!/bin/sh\nprintf '%s\\0' "$@" > '${args}'\nwhile [ $# -gt 0 ]; do case "$1" in -p|-D|-f) shift 2;; *) break;; esac; done\nexec "$@"\n`, { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'gem-box', add: true, set: { agent: 'gemini', wrap: true } })
  assert.equal((await rig.rpc('state')).presets.find((x: { name: string }) => x.name === 'gem-box').wrap, 'macos')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gem-box', prompt: 'hello' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'agy'), 'agy, through the wrapper')
  assert.ok(run.args.some((a: string) => a.endsWith('\n\nhello'))) // after Laki's note (core.ts memoryFirst)
  const said = readFileSync(args, 'utf8').split('\0')
  assert.equal(said[0], '-p')
  assert.match(said[1], /^\(version 1\)\n\(allow default\)/)
  assert.ok(!said[1].includes(rig.home), 'no path in the profile')
  assert.ok(said.some(x => x.endsWith(`=${realpathSync(ws.path)}`) && /^P\d+=/.test(x)), 'its worktree, realpath-ed, a parameter')
  // its worktree's git folder: the files git commit writes, never the folder (a config.worktree there would run as you in Laki's git)
  const own = realpathSync(resolve(ws.path, readFileSync(join(ws.path, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)![1].trim()))
  assert.ok(said.some(x => x.endsWith(`=${own}/index`)), "its git folder's index")
  assert.ok(!said.some(x => x.endsWith(`=${own}`) || x.endsWith('/config') || x.endsWith('/config.worktree')), 'not its whole git folder, no config')
  assert.deepEqual(said.slice(-4, -1), ['/bin/sh', '-c', said.at(-2)!]) // the agent's line, run by sh
  // not with its own sandbox on, nor around claude's; an agent's call can't change it
  await assert.rejects(rig.rpc('presetSave', { name: 'gem-box', set: { args: '--sandbox' } }), /agent's own sandbox on/)
  await assert.rejects(rig.rpc('presetSave', { name: 'cl-box', add: true, set: { agent: 'claude', sandbox: true, wrap: true } }), /one or the other/)
  const tab = (await until(() => rig.tab(ws.id))).id
  await assert.rejects(rig.rpc('presetSave', { name: 'gem-box', set: { wrap: false }, from: { ws: ws.id, tab } }), /an agent can't change a profile's wrapper sandbox/)
  assert.equal((await rig.rpc('state')).presets.find((x: { name: string }) => x.name === 'gem-box').wrap, 'macos')
})

// its network on a list: sandbox-exec's profile denies all but this Mac, the agent's HTTPS_PROXY is Laki's proxy for its
// tab, a host off the list gets the card (Allow this domain in this project), allowed at once once you do
test("wrapper sandbox's network: listed hosts through Laki's proxy, another refused with a card, allowed by you only", { skip: process.platform !== 'darwin' }, async t => {
  const rig = await fresh(t)
  const args = join(rig.home, 'sandbox-exec.args')
  writeFileSync(join(rig.home, 'bin', 'sandbox-exec'), `#!/bin/sh\nprintf '%s\\0' "$@" > '${args}'\nwhile [ $# -gt 0 ]; do case "$1" in -p|-D|-f) shift 2;; *) break;; esac; done\nexec "$@"\n`, { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('presetSave', { name: 'gem-box', add: true, set: { agent: 'gemini', wrap: true, net: 'off' } }), /net: all, list/)
  await rig.rpc('presetSave', { name: 'gem-box', add: true, set: { agent: 'gemini', wrap: true, net: 'list' } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gem-box', prompt: 'hello' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'agy'), 'agy, through the wrapper')
  const tab = run.tab as string
  assert.match(run.proxy ?? '', new RegExp(`^http://${tab}:[0-9a-f]{36}@127\\.0\\.0\\.1:\\d+$`), 'its own proxy URL')
  assert.match(readFileSync(args, 'utf8').split('\0')[1], /\(deny network-outbound\)/)
  const u = new URL(run.proxy)
  const connectTo = (host: string) =>
    new Promise<string>((ok, fail) => {
      const s = connect(Number(u.port), '127.0.0.1', () => s.write(`CONNECT ${host}:443 HTTP/1.1\r\nProxy-Authorization: Basic ${Buffer.from(`${u.username}:${u.password}`).toString('base64')}\r\n\r\n`))
      s.once('data', d => (s.destroy(), ok(String(d).split('\r\n')[0])))
      s.on('error', fail)
    })
  await until(async () => (await rig.rpc('state')).tabs.find((x: { id: string }) => x.id === tab)?.status === 'idle', 'its turn done') // a card shows on a tab that waits or is done
  assert.match(await connectTo('evil.example'), / 403 /)
  const boxed = await until(async () => (await rig.rpc('state')).tabs.find((x: { id: string }) => x.id === tab)?.boxed, 'its card')
  assert.deepEqual([boxed.host, boxed.wrap], ['evil.example', true])
  // Allow this domain in this project: yours, never its agent's; then at once (502: let through, and no such host)
  await assert.rejects(rig.rpc('projectNetAllow', { project: p.id, host: 'evil.example', from: { ws: ws.id, tab } }), /an agent can't/)
  await rig.rpc('projectNetAllow', { project: p.id, host: 'evil.example' })
  assert.match(await connectTo('evil.example'), / 502 /)
})

test('wrapper sandbox: no sandbox-exec on this Mac: the tab does not start, and says why', { skip: process.platform !== 'darwin' }, async t => {
  const rig = await fresh(t, { env: { LAKI_TEST_NO_SANDBOX_EXEC: '1' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'gem-box', add: true, set: { agent: 'gemini', wrap: true } })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'gem-box', prompt: 'hello', name: 'boxless' }), /sandbox-exec .* isn't on this Mac/)
  await sleep(500)
  assert.ok(!rig.fakeLog().some(l => l.bin === 'agy'), 'never without the sandbox')
  const ws = (await rig.rpc('state')).workspaces.find((w: { id: string; name?: string }) => w.id === 'boxless' || w.name === 'boxless')
  assert.ok(ws, 'the workspace is made')
})

test("a project's MCP servers go in by flags: claude one more --mcp-config (a 0600 file), codex -c overrides with an env's values in its environment, never argv; a profile not picked gets none", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('projectSet', { id: p.id, config: { mcp: [{ name: 'a b', command: 'x' }] } }), /a name of letters, digits, _ and -/)
  await assert.rejects(rig.rpc('projectSet', { id: p.id, config: { mcp: [{ name: 'x', command: 'y', url: 'https://x.test' }] } }), /a command or a URL/)
  await rig.rpc('projectSet', { id: p.id, config: { mcp: [{ name: 'docs', command: 'npx', args: ['-y', '@acme/docs mcp'], env: { DOCS_TOKEN: 'fake-secret' } }, { name: 'web', url: 'https://mcp.example.test/mcp', presets: ['codex'] }] } })
  const shown = (await rig.rpc('state')).projects.find((x: any) => x.id === p.id).config
  await rig.rpc('projectSet', { id: p.id, config: shown }) // the page saves the masked view back: the value stays

  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  const c = rig.fakeLog().find(l => l.bin === 'claude')
  assert.equal(c.mcp.mode, 0o600)
  assert.match(c.mcp.path, /\/mcp\/[\w-]+\.json$/)
  assert.deepEqual(c.mcp.cfg, { mcpServers: { docs: { command: 'npx', args: ['-y', '@acme/docs mcp'], env: { DOCS_TOKEN: 'fake-secret' } } } }) // web is codex's only
  assert.ok(!c.args.join(' ').includes('fake-secret'), 'the value in the file, never in argv')

  await rig.rpc('tabNew', { ws: ws.id, kind: 'agent', preset: 'codex' })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex')
  const cx = rig.fakeLog().find(l => l.bin === 'codex')
  const x = cx.args.join('\n')
  for (const l of ['mcp_servers.docs.command="/bin/sh"', 'mcp_servers.docs.args=["-c", "export DOCS_TOKEN=\\"$LAKI_MCP_0_DOCS_TOKEN\\"; unset LAKI_MCP_0_DOCS_TOKEN; exec \\"$0\\" \\"$@\\"", "npx", "-y", "@acme/docs mcp"]', 'mcp_servers.docs.env_vars=["LAKI_MCP_0_DOCS_TOKEN"]', 'mcp_servers.web.url="https://mcp.example.test/mcp"']) assert.ok(x.includes(l), l)
  assert.ok(!x.includes('fake-secret'), "the value never in codex's argv")
  assert.equal(cx.env.LAKI_MCP_0_DOCS_TOKEN, 'fake-secret', "it's in codex's environment")

  await rig.rpc('tabNew', { ws: ws.id, kind: 'agent', preset: 'gemini' })
  await until(() => rig.fakeLog().some(l => l.bin === 'agy'), 'agy')
  assert.ok(!rig.fakeLog().find(l => l.bin === 'agy').args.join(' ').includes('mcp'), 'agy: none yet')
})

// the wrapper sandbox keeps the data folder from the agent: a wrapped claude's own --mcp-config is read back out of it
// (its file only); a workspace deleted takes its tabs' MCP files with it
test("a wrapped claude reads its own MCP file, no other; a deleted workspace's tabs' MCP files go", { skip: process.platform !== 'darwin' }, async t => {
  const rig = await fresh(t)
  const args = join(rig.home, 'sandbox-exec.args')
  writeFileSync(join(rig.home, 'bin', 'sandbox-exec'), `#!/bin/sh\nprintf '%s\\0' "$@" > '${args}'\nwhile [ $# -gt 0 ]; do case "$1" in -p|-D|-f) shift 2;; *) break;; esac; done\nexec "$@"\n`, { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { mcp: [{ name: 'docs', command: 'npx', env: { DOCS_TOKEN: 'fake-secret' } }] } })
  await rig.rpc('presetSave', { name: 'claude-box', add: true, set: { agent: 'claude', wrap: true } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude-box' })
  const c = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'claude'), 'claude, through the wrapper')
  const said = readFileSync(args, 'utf8').split('\0')
  const mine = said.filter(a => /^P\d+=.*\/mcp\/[\w-]+\.json$/.test(a)) // the profile's parameters: what it reads back
  assert.deepEqual(mine.map(a => a.split('/').pop()), [`${c.tab}.json`], 'its own file read back, no other')
  assert.equal(realpathSync(c.mcp.path), realpathSync(mine[0].replace(/^[^=]*=/, '')))
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => !existsSync(c.mcp.path), 'its MCP file gone with the workspace')
})

test("#6: Settings' MCP servers go to every project's agents (a project's of the same name wins), opencode's too; Import copies the agents' own, never theirs changed; Only Laki's", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('settingsSet', { mcp: [{ name: 'a b', command: 'x' }] }), /a name of letters, digits, _ and -/)
  await rig.rpc('settingsSet', { mcp: [{ name: 'docs', command: 'all-docs' }, { name: 'search', command: 'npx', args: ['search-mcp'], env: { SEARCH_TOKEN: 'fake-secret' } }] })
  const shown = (await rig.rpc('state')).settings.mcp
  assert.notEqual(shown[1].env.SEARCH_TOKEN, 'fake-secret', 'masked in the view')
  await rig.rpc('settingsSet', { mcp: shown }) // Settings sends it back masked: the value stays
  await rig.rpc('projectSet', { id: p.id, config: { mcp: [{ name: 'docs', command: 'project-docs' }], env: { OPENCODE_CONFIG_CONTENT: '{"share":"disabled"}' } } })
  await rig.rpc('presetSave', { name: 'claude-only', add: true, set: { agent: 'claude', mcpOnly: true } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const c = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'claude'), 'claude')
  assert.deepEqual(c.mcp.cfg, { mcpServers: { search: { command: 'npx', args: ['search-mcp'], env: { SEARCH_TOKEN: 'fake-secret' } }, docs: { command: 'project-docs' } } })
  assert.ok(!c.args.includes('--strict-mcp-config'))
  await rig.rpc('tabNew', { ws: ws.id, kind: 'agent', preset: 'opencode' })
  const oc = await until(() => rig.fakeLog().find(l => l.bin === 'opencode'), 'opencode')
  assert.equal(JSON.parse(oc.config).share, 'disabled', "the project's own inline config kept")
  assert.deepEqual(JSON.parse(oc.config).mcp, { search: { type: 'local', command: ['npx', 'search-mcp'], environment: { SEARCH_TOKEN: 'fake-secret' } }, docs: { type: 'local', command: ['project-docs'] } })
  // Only Laki's MCP servers: none of claude's own config's, Laki's own kept
  await rig.rpc('tabNew', { ws: ws.id, preset: 'claude-only' })
  const only = await until(() => rig.fakeLog().filter(l => l.bin === 'claude' && l.args?.includes('--strict-mcp-config'))[0], 'claude-only')
  assert.equal(only.args.filter((a: string) => a === '--mcp-config').length, 1, 'one file: the wrapper sandbox reads only its own')
  assert.deepEqual(Object.keys(only.mcp.cfg.mcpServers), ['search', 'docs', 'laki'], "Laki's own in it")
  // Import: listed (no values), then the picked ones copied; the agents' own files as they were
  writeFileSync(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.test/mcp' }, docs: { command: 'x' } } }))
  mkdirSync(join(rig.home, '.codex'), { recursive: true })
  const toml = '[mcp_servers.pg]\ncommand = "pg-mcp"\nargs = ["--ro"]\n[mcp_servers.pg.env]\nPG_PASSWORD = "fake-pass"\n'
  writeFileSync(join(rig.home, '.codex', 'config.toml'), toml)
  const { found } = await rig.rpc('mcpImport', {})
  assert.deepEqual(found.map((f: any) => [f.agent, f.name, f.has, f.env]), [['claude', 'linear', false, []], ['claude', 'docs', true, []], ['codex', 'pg', false, ['PG_PASSWORD']]])
  assert.ok(!JSON.stringify(found).includes('fake-pass'), 'its values never listed')
  await assert.rejects(rig.rpc('mcpImport', { pick: ['codex:pg'], from: { tab: c.tab } }), /read the agents' own MCP servers/)
  assert.deepEqual((await rig.rpc('mcpImport', { pick: ['codex:pg', 'claude:linear', 'claude:docs'] })).added, ['linear', 'pg'])
  assert.deepEqual((await rig.rpc('state')).settings.mcp.map((s: any) => s.name), ['docs', 'search', 'linear', 'pg'])
  assert.equal(readFileSync(join(rig.home, '.codex', 'config.toml'), 'utf8'), toml, "codex's own as it was")
  await until(() => !readFileSync(join(rig.data, 'state.json'), 'utf8').includes('fake-pass'), 'a secret value kept out of state.json')
})

test("a profile's system prompt: told to claude by --append-system-prompt and to codex by developer_instructions, with Laki's note; a command's dropped", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'reviewer', add: true, set: { agent: 'claude', system: '  Review only: never edit files.  ' } })
  await rig.rpc('presetSave', { name: 'cx', add: true, set: { agent: 'codex', system: 'Be terse.' } })
  const pr = (await rig.rpc('state')).presets.find((x: { name: string }) => x.name === 'reviewer')
  assert.equal(pr.system, 'Review only: never edit files.') // trimmed
  await rig.rpc('wsNew', { project: p.id, preset: 'reviewer', prompt: 'hi' })
  const run = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'claude'), 'claude up')
  const note = run.args[run.args.indexOf('--append-system-prompt') + 1]
  assert.match(note, /Laki/)
  assert.match(note, /standing instructions for this profile \(reviewer\):\nReview only: never edit files\.$/)
  await rig.rpc('wsNew', { project: p.id, preset: 'cx', prompt: 'hi' })
  const cx = await until(() => rig.fakeLog().find(l => l.bin === 'codex'), 'codex up')
  assert.ok(cx.args.some((a: string) => a.startsWith('developer_instructions=') && a.includes('Be terse.')), cx.args.join(' '))
  // laki off: the profile's own still goes
  await rig.rpc('presetSave', { name: 'reviewer', set: { laki: false } })
  await rig.rpc('wsNew', { project: p.id, preset: 'reviewer', prompt: 'again' })
  const quiet = await until(() => rig.fakeLog().filter(l => l.bin === 'claude')[1], 'second claude')
  assert.equal(quiet.args[quiet.args.indexOf('--append-system-prompt') + 1], "The user's standing instructions for this profile (reviewer):\nReview only: never edit files.")
  await assert.rejects(rig.rpc('presetSave', { name: 'reviewer', set: { system: 'x'.repeat(20001) } }), /20,000/)
  await rig.rpc('presetSave', { name: 'cmd', add: true, set: { agent: 'command', cmd: 'true', system: 'nope' } })
  assert.equal((await rig.rpc('state')).presets.find((x: { name: string }) => x.name === 'cmd').system, undefined)
})

test("your shell's alias for an agent: its permission flags count as the profile's (no second mode of Laki's beside them), and its never-asks checks see them", async t => {
  const { aliasFlags } = await import('../src/shared/types.ts')
  assert.deepEqual(aliasFlags(["codex='codex --dangerously-bypass-approvals-and-sandbox'", "alias claude='/Users/me/.claude/local/claude'", "agy='agy --mode auto'", "alias grok='npx grok --x'", 'll=\'ls -l\'', "alias opencode 'opencode --print-logs'", "codex2='codex --x'"].join('\n')), { codex: '--dangerously-bypass-approvals-and-sandbox', gemini: '--mode auto', opencode: '--print-logs' })
  assert.deepEqual(aliasFlags("codex='codex -c '\\''model=\"x\"'\\'''"), { codex: `-c 'model="x"'` }, "zsh's quoted quote")
  // a shell whose interactive login has the alias (tsh's has none): its -lic runs bash with it, aliases on
  const dir = mkdtempSync(join(tmpdir(), 'laki-alias-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sh = join(dir, 'ash')
  writeFileSync(sh, `#!/bin/bash\nif [ "$1" = "-lic" ] || [ "$1" = "-lc" ]; then c=$2; shift 2; BASH_SILENCE_DEPRECATION_WARNING=1 exec /bin/bash --noprofile --norc -O expand_aliases -c "alias codex='codex --dangerously-bypass-approvals-and-sandbox'
$c" "$@"; fi\nBASH_SILENCE_DEPRECATION_WARNING=1 exec /bin/bash --noprofile --norc -i\n`, { mode: 0o755 })
  const rig = await fresh(t, { env: { SHELL: sh } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'cx', add: true, set: { agent: 'codex', perm: 'auto' } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'cx', prompt: 'hi' })
  const run = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'codex' && l.args[0] !== 'app-server'), 'codex up')
  assert.ok(run.args.includes('--dangerously-bypass-approvals-and-sandbox'), run.args.join(' '))
  assert.ok(!run.args.includes('--approve-for-me'), 'no mode of its own beside the alias’s')
  // an agent's call may not start one that never asks: the alias's counts
  const tab = await until(async () => await rig.tab(ws.id), 'its tab')
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'cx', prompt: 'x', from: tab.id }), /never asks|approval|bypass/i)
})

test("a group's agent, model, effort and permission mode: laki new --group starts them (the new-workspace page's too); another agent named keeps its own", async t => {
  const { groupDefaults } = await import('../src/shared/tools.ts')
  const g = { preset: 'cx', where: 'bare', perm: 'ask', model: 'gpt-x', effort: 'high', base: 'dev' }
  assert.deepEqual(groupDefaults({}, g), { local: false, noSetup: true, base: 'dev', perm: '', model: 'gpt-x', effort: 'high' })
  assert.deepEqual(groupDefaults({ preset: 'claude', local: true, model: 'opus' }, g), { preset: 'claude', local: true, model: 'opus', base: 'dev' }, 'another agent: only where it goes')
  assert.deepEqual(groupDefaults({ effort: 'low' }, undefined), { effort: 'low' })
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'cx', add: true, set: { agent: 'codex' } })
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a', name: 'Astra', preset: 'cx', model: 'gpt-x', effort: 'high', perm: 'acceptEdits', where: 'bare' }, { id: 'sep-b', name: 'Odd', preset: 'cx', effort: 'max' }] })
  const r = await rig.cli('new', p.id, '--group', 'astra', '--prompt', 'hi')
  assert.equal(r.code, 0, r.out + r.err)
  const run = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find(l => l.bin === 'codex' && l.args[0] !== 'app-server'), 'codex up')
  const line = run.args.join(' ')
  for (const want of ['-m gpt-x', 'model_reasoning_effort="high"', '-s workspace-write -a never']) assert.ok(line.includes(want), `${want}: ${line}`)
  // an effort its agent doesn't take (codex has no max): left out, the start goes on
  await rig.cli('new', p.id, '--group', 'odd', '--prompt', 'again')
  const two = await until(() => rig.fakeLog().filter(l => l.bin === 'codex' && l.args[0] !== 'app-server')[1], 'second codex')
  assert.ok(!two.args.join(' ').includes('model_reasoning_effort'), two.args.join(' '))
})
