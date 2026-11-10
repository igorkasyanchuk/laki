// F1: every turn that changed files is kept on disk (turns.ts turnKeep): the list survives a daemon restart, a turn's
// diff is its own, a rewind puts the files back and is itself undone by rewinding it, a workspace starts on a turn's
// files, the refs that keep the trees go with the workspace; agents rewind and fork nothing
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

test('kept turns: three survive a restart, each diff its own; rewind, and a rewind of the rewind; a workspace from a turn; refs gone with the workspace', async t => {
  const rig = await fresh(t)
  const git = (...a: string[]) => execFileSync('git', ['-C', rig.repo, ...a], { encoding: 'utf8' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x.status === 'idle' && x)(await rig.tab(ws.id)), 'claude up')
  const file = (name: string) => join(ws.path, name)
  const read = (name: string) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8') : null)
  const turn = async (prompt: string, edit: () => void) => {
    await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt } })
    await sleep(300) // its snapshot first, as claude's first tool call comes after the hook
    edit()
    await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
    await until(async () => (await rig.rpc('turnList', { ws: ws.id })).at(-1)?.prompt === prompt.split('\n')[0], `turn kept: ${prompt}`)
  }
  await turn('add a\nand more words', () => writeFileSync(file('a.txt'), 'one\n'))
  await turn('change a, add b', () => (writeFileSync(file('a.txt'), 'one\ntwo\n'), writeFileSync(file('b.txt'), 'b\n')))
  await turn('drop b', () => rmSync(file('b.txt')))
  // a turn that changes nothing isn't kept
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'nothing' } })
  await sleep(300)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
  await sleep(500)
  let list = await rig.rpc('turnList', { ws: ws.id })
  assert.deepEqual(list.map((x: any) => [x.n, x.tab, x.prompt, x.count, x.add, x.del, x.files.map((f: any) => `${f.status} ${f.path}`).join()]), [
    [1, tab.id, 'add a', 1, 1, 0, 'A a.txt'],
    [2, tab.id, 'change a, add b', 2, 2, 0, 'M a.txt,A b.txt'],
    [3, tab.id, 'drop b', 1, 0, 1, 'D b.txt'],
  ])
  assert.ok(list.every((x: any) => x.started <= x.ended && x.ended <= Date.now()))
  const refs = () => git('for-each-ref', '--format=%(refname)', 'refs/laki/').split('\n').filter(Boolean)
  assert.deepEqual(refs(), [1, 2, 3].flatMap(n => [`refs/laki/turns/${ws.id}/${n}/after`, `refs/laki/turns/${ws.id}/${n}/before`]))
  assert.deepEqual(git('for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/tags/').split('\n').filter(r => r.includes('laki/turns')), [], 'nothing a plain push takes')
  // the daemon starts again: the list is there, each turn's diff only its own
  await rig.stop()
  await rig.start()
  assert.deepEqual((await rig.rpc('turnList', { tab: tab.id })).map((x: any) => x.n), [1, 2, 3])
  const d2 = await rig.rpc('turnDiff', { ws: ws.id, n: 2 })
  assert.match(d2.diff, /\+two/)
  assert.match(d2.diff, /b\.txt/)
  assert.ok(!d2.diff.includes('+one'), "the first turn's line isn't the second's")
  assert.deepEqual([d2.n, d2.files.length], [2, 2])
  assert.equal((await rig.rpc('turnDiff', { ws: ws.id })).n, 3, 'This turn after a restart: the newest kept')
  await assert.rejects(rig.rpc('turnDiff', { ws: ws.id, n: 9 }), /turn 9 isn't kept/)
  // an agent rewinds and forks nothing
  await assert.rejects(rig.rpc('turnRewind', { ws: ws.id, n: 2, from: { tab: tab.id } }), /rewind a workspace's files/)
  await assert.rejects(rig.rpc('turnFork', { ws: ws.id, n: 2, from: { tab: tab.id } }), /start a workspace from a kept turn/)
  // your own edit since, then a rewind to before turn 2: the files of then; what was there is turn 4
  writeFileSync(file('mine.txt'), 'my own\n')
  const back = await rig.rpc('turnRewind', { ws: ws.id, n: 2 })
  assert.deepEqual([read('a.txt'), read('b.txt'), read('mine.txt')], ['one\n', null, null])
  assert.equal(back.n, 4)
  list = await rig.rpc('turnList', { ws: ws.id })
  assert.deepEqual([list.at(-1).name, list.at(-1).prompt, list.at(-1).rewind], ['You', 'Rewound to before turn 2', 2])
  // the rewind rewound: exactly what was there
  await rig.rpc('turnRewind', { ws: ws.id, n: back.n })
  assert.deepEqual([read('a.txt'), read('b.txt'), read('mine.txt')], ['one\ntwo\n', null, 'my own\n'])
  assert.deepEqual(await rig.rpc('turnRewind', { ws: ws.id, n: back.n }), { files: 0 }) // already so
  // not while a turn is under way
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'busy' } })
  await assert.rejects(rig.rpc('turnRewind', { ws: ws.id, n: 1 }), /is working/)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
  // a workspace from turn 2: its files, uncommitted over the HEAD of then (no commit of Laki's in its branch); compared with the source's base
  const made = await rig.rpc('turnFork', { ws: ws.id, n: 2 })
  assert.deepEqual([readFileSync(join(made.path, 'a.txt'), 'utf8'), readFileSync(join(made.path, 'b.txt'), 'utf8')], ['one\ntwo\n', 'b\n'])
  assert.equal(made.base, ws.base)
  assert.doesNotMatch(execFileSync('git', ['-C', made.path, 'log', '--format=%an %s'], { encoding: 'utf8' }), /Laki/)
  assert.match(execFileSync('git', ['-C', made.path, 'status', '--porcelain'], { encoding: 'utf8' }), /a\.txt[^]*b\.txt/)
  // settings.turnsKept: the newest only, the others' refs let go
  await rig.rpc('settingsSet', { turnsKept: 2 })
  await turn('one more', () => writeFileSync(file('c.txt'), 'c\n'))
  list = await rig.rpc('turnList', { ws: ws.id })
  assert.equal(list.length, 2)
  assert.deepEqual(refs().length, 4)
  // Turns kept 0: nothing more is kept, but a rewind still keeps what was there (or it couldn't be undone)
  await rig.rpc('settingsSet', { turnsKept: 0 })
  const last = (await rig.rpc('turnList', { ws: ws.id })).at(-1)
  const r0 = await rig.rpc('turnRewind', { ws: ws.id, n: last.n })
  assert.equal(read('c.txt'), null)
  assert.ok(r0.n > last.n)
  await rig.rpc('turnRewind', { ws: ws.id, n: r0.n })
  assert.equal(read('c.txt'), 'c\n')
  // the workspace removed: its refs and its list with it; the other workspace's own turns untouched (it has none)
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => refs().length === 0 && !existsSync(join(rig.data, 'turns', `${ws.id}.json`)), 'its refs and list gone')
})
