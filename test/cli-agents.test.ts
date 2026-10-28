// The laki CLI from an agent's tab: Laki's plugin, what agents are told, project memory, what an agent may start.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test('/laki:new and /laki:extension: claude tabs get Laki’s plugin (its commands); laki new . is the tab’s own project', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const plugin = join(rig.data, 'claude-plugin')
  assert.equal(JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'laki')
  const cmd = readFileSync(join(plugin, 'commands', 'new.md'), 'utf8')
  assert.match(cmd, /^---\ndescription: /)
  assert.match(cmd, /\$ARGUMENTS/)
  assert.match(cmd, / new \. --preset <agent> --prompt '<prompt>'/)
  const ext = readFileSync(join(plugin, 'commands', 'extension.md'), 'utf8') // the laki-widget skill's guide, as a command
  assert.match(ext, /^---\ndescription: Make or change a Laki extension/)
  assert.match(ext, /allowed-tools: Bash\(.* widget ls:\*\), /) // N10: what reads, unasked; only you start it
  assert.match(ext, /\ndisable-model-invocation: true\n/)
  assert.match(ext, /\$ARGUMENTS\n\n# Making a Laki extension/)
  assert.match(ext, /Run the laki CLI as `\/usr\/bin\/env .*`\. Below/)
  const orch = readFileSync(join(plugin, 'commands', 'orchestrate.md'), 'utf8') // the laki-orchestrate skill's guide, as /laki:orchestrate
  assert.match(orch, /allowed-tools: Bash\(.* ls:\*\), Bash\(.* new:\*\), /)
  assert.match(orch, /\ndisable-model-invocation: true\n[\s\S]*\$ARGUMENTS\n\n# Orchestrating agents in Laki/)
  // and in Laki's OpenCode tabs (its OPENCODE_CONFIG_DIR's command/): /laki-orchestrate
  const oc = readFileSync(join(plugin, '..', 'opencode', 'command', 'laki-orchestrate.md'), 'utf8')
  assert.match(oc, /^---\ndescription: Split work across several Laki agents[\s\S]*\$ARGUMENTS\n\n# Orchestrating agents in Laki[\s\S]*Run the laki CLI as `\/usr\/bin\/env /)
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'claude'), 'claude')
  assert.equal(run.args[run.args.indexOf('--plugin-dir') + 1], plugin)
  // in a tab: . is its project; elsewhere it says so
  const here = await rig.cliIn(undefined, 'new', '.', '--preset', 'codex', '--prompt', 'add the export button')
  assert.notEqual(here.code, 0)
  assert.match(here.err, /only in a Laki tab/)
  rig.env.LAKI_WORKSPACE = ws.id
  rig.env.LAKI_TAB = (await rig.rpc('state')).tabs.find((x: { workspace: string }) => x.workspace === ws.id).id // its claude tab
  const made = await rig.cli('new', '.', '--preset', 'codex', '--prompt', 'add the export button')
  const shell = await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })
  rig.env.LAKI_TAB = shell.id // you, in a shell tab: yours, from no workspace
  const mine = await rig.cli('new', '.', '--preset', 'none', '--name', 'mine', '--prompt', 'review https://github.com/o/r/pull/3')
  delete rig.env.LAKI_WORKSPACE
  delete rig.env.LAKI_TAB
  assert.equal(made.code, 0, made.err)
  assert.equal(mine.code, 0, mine.err)
  const v = await rig.rpc('state')
  const w = v.workspaces.find((x: { id: string }) => x.id === 'add-the-export-button')
  assert.equal(w.from, ws.id) // its agent started it
  const m = v.workspaces.find((x: { id: string }) => x.id === 'mine')
  assert.deepEqual([m.from, m.prUrl], [undefined, 'https://github.com/o/r/pull/3'])
  assert.deepEqual([w?.project, w?.kind], [p.id, 'worktree'])
  assert.equal(v.tabs.find((x: { workspace: string }) => x.workspace === w.id)?.preset, 'codex')
})

test('agents are told about Laki (a preset can say no); a storage folder per workspace, gone with it; laki rename and pr', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'quiet', agent: 'claude', laki: false }, { name: 'codex', agent: 'codex' }] })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'work' })
  const started = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find((l: any) => l.bin === 'claude'), 'claude started')
  const note = started.args[started.args.indexOf('--append-system-prompt') + 1]
  assert.match(note, /`laki rename \. "<a few words>"`/)
  assert.match(note, /LAKI_STORAGE_FOLDER/)
  const allow: string[] = JSON.parse(readFileSync(started.args[started.args.indexOf('--settings') + 1], 'utf8')).permissions.allow
  assert.ok(['rename', 'pr'].every(c => allow.some(a => a.endsWith(` ${c} .:*)`))), allow.join(', ')) // its own workspace, without asking
  const dir = started.storage
  assert.ok(dir.startsWith(join(rig.data, 'storage', '')) && dir.endsWith(ws.id) && existsSync(dir), dir)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).storage, dir)
  // the same folder for every tab; none of the note for a preset that says no
  await rig.rpc('tabNew', { ws: ws.id, preset: 'quiet' })
  const quiet = await until(() => rig.fakeLog().filter((l: any) => l.bin === 'claude')[1], 'the quiet one started')
  assert.ok(!quiet.args.includes('--append-system-prompt'), quiet.args.join(' '))
  assert.equal(quiet.storage, dir)
  await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  const codex = await until(() => rig.fakeLog().find((l: any) => l.bin === 'codex'), 'codex started')
  assert.ok(codex.args.includes(`developer_instructions=${JSON.stringify(note)}`), 'codex is told the same')
  // codex's own developer_instructions: -c would replace them, so no note
  mkdirSync(join(rig.env.HOME, '.codex'), { recursive: true })
  writeFileSync(join(rig.env.HOME, '.codex', 'config.toml'), 'model = "x"\ndeveloper_instructions = "mine"\n')
  await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  const own = await until(() => rig.fakeLog().filter((l: any) => l.bin === 'codex')[1], 'the second codex started')
  assert.ok(!own.args.some((a: string) => a.startsWith('developer_instructions=')), own.args.join(' '))
  // laki rename . / laki pr . in a tab
  rig.env.LAKI_WORKSPACE = ws.id
  t.after(() => delete rig.env.LAKI_WORKSPACE)
  assert.equal((await rig.cli('rename', '.', 'fix', 'the', 'cart')).out, `renamed ${ws.id}\n`)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).name, 'fix the cart')
  mkdirSync(rig.env.FAKE_GH, { recursive: true })
  writeFileSync(join(rig.env.FAKE_GH, 'prhead.json'), JSON.stringify({ number: 42, title: 'x', url: 'https://github.com/o/r/pull/42', headRefName: 'feat', baseRefName: 'main' }))
  const r = await rig.cli('pr', '.', '42')
  assert.equal(r.out, `attached 42 to ${ws.id}\n`, r.err)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).prUrl, 'https://github.com/o/r/pull/42')
  assert.match((await rig.cli('rename', '.')).err, /usage: laki rename/)
  delete rig.env.LAKI_WORKSPACE
  assert.match((await rig.cli('pr', '.', '42')).err, /only in a Laki tab/)
  rig.env.LAKI_WORKSPACE = ws.id
  // deleted: its folder too; kept with keepStorage
  writeFileSync(join(dir, 'shot.png'), 'x')
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => !existsSync(dir), 'gone with the workspace')
  // a folder that's there already is never a workspace's: another name, so a delete can't take it
  const mine = join(rig.data, 'storage', 'taken')
  mkdirSync(mine, { recursive: true })
  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'more', name: 'taken' })
  const dir2 = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws2.id).storage, 'its storage')
  assert.match(dir2, /\/taken-[0-9a-f]{6}$/)
  await rig.rpc('wsRm', { id: ws2.id })
  await until(() => !existsSync(dir2), 'its own gone')
  assert.ok(existsSync(mine), 'the folder that was there stays')
  await rig.rpc('settingsSet', { keepStorage: true })
  const ws3 = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'more' })
  const dir3 = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws3.id).storage, 'its storage')
  await rig.rpc('wsRm', { id: ws3.id })
  await new Promise(r => setTimeout(r, 200))
  assert.ok(existsSync(dir3), 'kept')
})

test('project memory: yours and what agents learned, 50 each, given to claude at its start; laki memory', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, memory: [{ id: 'm1', text: 'deploys go\nthrough\u0000 fly', at: 1 }] }) // a NUL would fail the spawn
  // an agent's: auto, the same text only dated anew, the oldest past 50 goes
  const first = await rig.rpc('memoryAdd', { project: p.id, text: 'tests: npm test' })
  assert.equal(first.auto, true)
  assert.equal((await rig.rpc('memoryAdd', { project: p.id, text: 'Tests: npm test' })).id, first.id)
  for (let i = 0; i < 50; i++) await rig.rpc('memoryAdd', { project: p.id, text: `fact ${i}` })
  const mem = (await rig.rpc('state')).projects[0].memory
  assert.equal(mem.filter((m: any) => m.auto).length, 50)
  assert.ok(!mem.some((m: any) => m.text === 'tests: npm test'), 'the oldest learned one went')
  assert.deepEqual(mem.filter((m: any) => !m.auto).map((m: any) => m.id), ['m1'])
  await assert.rejects(rig.rpc('memoryAdd', { project: p.id, text: 'x'.repeat(700) }), /600 characters at most/)
  await assert.rejects(rig.rpc('memoryRm', { project: p.id, id: 'm1' }), /that one is the user's/)
  // yours: 50 at most
  const many = Array.from({ length: 51 }, (_, i) => ({ id: `u${i}`, text: `mine ${i}`, at: i + 1 }))
  await assert.rejects(rig.rpc('projectSet', { id: p.id, memory: [...mem, ...many] }), /keeps 50 memories of yours/)

  // claude gets both at its start, with how to add to it (allowed without asking)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'work' })
  const started = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find((l: any) => l.bin === 'claude'), 'claude started')
  const note = started.args[started.args.indexOf('--append-system-prompt') + 1]
  assert.match(note, /From the user \(follow these\):\n- 1970-01-01: deploys go\n {2}through fly/)
  assert.match(note, /Learned by agents [^\n]*\n(- \[\w+\] \d{4}-\d\d-\d\d: fact \d+\n?){50}/)
  assert.match(note, /`laki memory add \. "<what to remember>"`/)
  const allow: string[] = JSON.parse(readFileSync(started.args[started.args.indexOf('--settings') + 1], 'utf8')).permissions.allow
  assert.ok(allow.some(a => a.endsWith(' memory add .:*)')), allow.join(', '))

  // the CLI in a tab: `.` is its project, an agent's memory with who said it; rm only a learned one
  rig.env.LAKI_WORKSPACE = ws.id
  rig.env.LAKI_TAB = started.tab ?? ''
  t.after(() => (delete rig.env.LAKI_WORKSPACE, delete rig.env.LAKI_TAB))
  const add = await rig.cli('memory', 'add', '.', 'the', 'API', 'is', 'in', 'api/')
  assert.equal(add.code, 0, add.err)
  const id = /remembered \((\w+)\)/.exec(add.out)![1]
  assert.match((await rig.cli('memory')).out, new RegExp(`learned by agents[\\s\\S]*${id}  \\d{4}-\\d\\d-\\d\\d  the API is in api/`))
  assert.match((await rig.cli('memory', 'add', '.', 'mine', 'too', '--mine')).out, /remembered/)
  assert.equal((await rig.cli('memory', 'rm', '.', id)).code, 0)
  const after = (await rig.rpc('state')).projects[0].memory
  assert.ok(!after.some((m: any) => m.id === id))
  assert.ok(after.some((m: any) => m.text === 'mine too' && !m.auto))
})

test("cli: an agent's laki new and laki tab can't start a command of its own (--cmd, a command preset); yours can", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'sh-x', agent: 'command', cmd: 'echo hi' }] })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const tab = await until(() => rig.tab(ws.id))
  const as = async (...args: string[]) => {
    Object.assign(rig.env, { LAKI_WORKSPACE: ws.id, LAKI_TAB: tab.id })
    try {
      return await rig.cli(...args)
    } finally {
      delete rig.env.LAKI_WORKSPACE
      delete rig.env.LAKI_TAB
    }
  }
  for (const args of [['new', '.', '--cmd', 'touch x', '--local'], ['new', '.', '--preset', 'sh-x', 'go'], ['tab', ws.id, '--cmd', 'touch x'], ['tab', ws.id, '--preset', 'sh-x']]) {
    const r = await as(...args)
    assert.notEqual(r.code, 0, args.join(' '))
    assert.match(r.err, /an agent can't start a command of its own/, args.join(' '))
  }
  // nor a profile that never asks: its mode, or its flags
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'sh-x', agent: 'command', cmd: 'echo hi' }, { name: 'yolo', agent: 'claude', perm: 'bypassPermissions' }, { name: 'yolo2', agent: 'claude', args: '--dangerously-skip-permissions' }] })
  for (const args of [['new', '.', '--preset', 'yolo', 'go'], ['tab', ws.id, '--preset', 'yolo'], ['tab', ws.id, '--preset', 'yolo2']]) {
    const r = await as(...args)
    assert.notEqual(r.code, 0, args.join(' '))
    assert.match(r.err, /an agent can't start an agent that never asks/, args.join(' '))
  }
  assert.equal((await rig.cli('tab', ws.id, '--preset', 'yolo')).code, 0, 'yours can')
  // an agent of a preset still works; and yours with --cmd
  assert.equal((await as('tab', ws.id, '--preset', 'claude')).code, 0)
  const mine = await rig.cli('tab', ws.id, '--cmd', 'sleep 5')
  assert.equal(mine.code, 0, mine.err)
  const n = await rig.cli('new', p.id, '--cmd', 'sleep 5', '--name', 'mine')
  assert.equal(n.code, 0, n.err)
})

// M5: who calls is the tab its process runs in, not what its env says
test('cli: an agent is the tab its process is in, whatever its env says; outside any tab, you', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  const { id } = await rig.rpc('widgetNew', { kind: 'number', name: 'Probe' })
  await rig.rpc('widgetSet', { id, on: false })
  const { hash } = await rig.rpc('widgetWhat', { id })
  const laki = [process.execPath, '--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))].join(' ')
  const out = join(rig.home, 'agent-out')
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  // its Bash tool, with Laki's variables taken out
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run env -u LAKI_TAB -u LAKI_WORKSPACE ${laki} widget on ${id} --seen ${hash} > ${out} 2>&1; ${laki} schedule run nope >> ${out} 2>&1; echo done >> ${out}` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'the agent ran it', 60000)
  const said = readFileSync(out, 'utf8')
  assert.match(said, /only you can turn an extension on/) // an agent's, by its process
  assert.match(said, /an agent can't run a scheduled task now/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id)?.on, false)
  // the same command outside any tab: yours
  const r = await rig.cli('widget', 'on', id, '--seen', hash)
  assert.equal(r.out, `${id} on\n`, r.err)
  // an agent's schedule is saved off
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${laki} schedule add ${p.id} --when "every day at 9am" check the build > ${out} 2>&1; echo done >> ${out}` })
  await until(() => readFileSync(out, 'utf8').includes('done'), 'scheduled')
  await until(async () => (await rig.rpc('state')).schedules?.length === 1, 'the task saved')
  assert.equal((await rig.rpc('state')).schedules[0].on, false)
  // another workspace's tab: the user is asked first in the app (toolAsk with cross); a no is a refusal, Allow once reads it
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'other' })
  const shell = (await rig.rpc('tabNew', { ws: other.id })).id
  const app = await connect(rig)
  for (const [allow, said] of [['deny', /another workspace: the user said no/], ['once', /^(?![^]*another workspace)[^]*done/]] as const) {
    rmSync(out, { force: true })
    await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${laki} screen ${other.id}/${shell} > ${out} 2>&1; echo done >> ${out}` })
    const ask = await until(() => app.events.find(m => m.ev === 'toolAsk' && m.cross === 'screen' && !m.seen), 'asked in the app', 30000)
    ask.seen = true
    assert.equal(ask.to, 'other')
    await rig.rpc('widgetToolAnswer', { req: ask.req, allow })
    await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'it went on', 30000)
    assert.match(readFileSync(out, 'utf8'), said)
  }
  // one this workspace started (a worker: laki new from its tab): no question, as for its own (laki-orchestrate)
  const kid = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'kid', from: ws.id })
  const kidShell = (await rig.rpc('tabNew', { ws: kid.id })).id
  rmSync(out, { force: true })
  const asks = app.events.filter(m => m.ev === 'toolAsk').length
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${laki} screen ${kid.id}/${kidShell} > ${out} 2>&1; echo done >> ${out}` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'read unasked', 30000)
  assert.doesNotMatch(readFileSync(out, 'utf8'), /another workspace/)
  assert.equal(app.events.filter(m => m.ev === 'toolAsk').length, asks)
  // a new agent tab with a prompt in another workspace asks as a send does
  rmSync(out, { force: true })
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${laki} tab ${other.id} --preset claude --prompt hello > ${out} 2>&1; echo done >> ${out}` })
  const tabAsk = await until(() => app.events.find(m => m.ev === 'toolAsk' && m.cross === 'send' && !m.seen), 'a tab asked for', 30000)
  assert.deepEqual([tabAsk.to, tabAsk.target, tabAsk.text], ['other', 'a new agent tab', 'hello'])
  await rig.rpc('widgetToolAnswer', { req: tabAsk.req, allow: 'deny' })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'refused', 30000)
  assert.match(readFileSync(out, 'utf8'), /another workspace: the user said no/)
  assert.ok(!(await rig.rpc('state')).tabs.some((x: any) => x.workspace === other.id && x.kind === 'agent'))
  app.close()
})
