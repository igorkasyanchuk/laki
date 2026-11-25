// core.ts view() as JSON, pinned (test/fixtures/view-snapshot.json): tabs in each state (running, waiting with an ask,
// idle and done, exited, asleep), their workspace and project, with ids, paths, keys, times and what moves on its own
// (ports, processes, git's numbers) normalized. A refactor of view() must leave it byte-equal; a change on purpose
// writes it again with UPDATE_SNAPSHOT=1
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until, sleep } from './helpers.ts'

const FILE = join(import.meta.dirname, 'fixtures', 'view-snapshot.json')
const MOVES = new Set(['ports', 'procs', 'stat', 'usedAt', 'usual', 'claudeHas', 'resumeId', 'pid', 'cols', 'rows', 'last', 'code'])
const DROP = new Set(['mode', 'modeUnknown', 'bypassNo', 'titled', 'context', 'meter', 'ctx', 'cost', 'tokens', 'spend', 'model', 'effort', 'turnCost'])

test('view: tabs in each state, their workspace and project, as pinned', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (id: string) => until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === id), `tab ${id}`)
  const first = await until(() => rig.tab(ws.id), 'its agent')
  const named = async (name: string, o: object) => (await rig.rpc('tabNew', { ws: ws.id, name, ...o })).id as string
  const wait = await named('waits', { preset: 'claude' })
  const done = await named('done', { preset: 'claude' })
  const gone = await named('gone', { cmd: 'exit 3' })
  const sleepy = await named('sleepy', { preset: 'claude', prompt: 'hi' }) // a chat to resume: it can sleep
  await rig.rpc('hook', { tab: first.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'work' } })
  await until(async () => /fake claude/.test(await rig.rpc('screen', { target: wait, lines: 10 })), 'its claude started')
  await rig.rpc('send', { target: wait, text: 'perm bash :: npm test' })
  await rig.rpc('hook', { tab: done, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'All done.' } })
  await until(async () => (x => x.resumeId && x.status === 'idle')(await tab(sleepy)), 'its first turn')
  await rig.rpc('tabSleep', { tab: sleepy })
  await until(async () => (await tab(wait)).status === 'waiting' && (await tab(gone)).status === 'exited' && (await tab(sleepy)).asleep && (await tab(first.id)).status === 'running', 'each in its state')

  const names = new Map<string, string>([[realpathSync(rig.home), '<home>'], [rig.home, '<home>'], [rig.data, '<data>'], [ws.id, '<ws>'], [p.id, '<project>'], [first.id, '<t-run>'], [wait, '<t-wait>'], [done, '<t-done>'], [gone, '<t-gone>'], [sleepy, '<t-sleep>']])
  const norm = (s: string) => [...names].reduce((x, [a, b]) => x.split(a).join(b), s).replace(/\b[0-9a-f]{32,}\b/g, '<key>')
  const snap = async () => {
    const v = await rig.rpc('state')
    return JSON.stringify({ projects: v.projects, workspaces: v.workspaces, tabs: v.tabs }, (k, x) => {
      if (DROP.has(k)) return undefined // there or not by timing: a transcript read, a hook heard
      if (MOVES.has(k)) return x === undefined ? undefined : '<moves>'
      if (typeof x === 'number' && (/At$|^at$|^ts$/.test(k) || x > 1.6e12)) return '<time>'
      if (typeof x === 'string') return norm(x)
      return x
    }, 1)
  }
  // settled: the same twice, half a second apart (a Stop hook, a transcript's meter land a little later)
  let was = ''
  const text = await until(async () => (now => (now === was ? now : ((was = now), false)))(await snap().then(async x => (await sleep(500), x))), 'the view settled')
  if (process.env.UPDATE_SNAPSHOT || !existsSync(FILE)) {
    mkdirSync(join(import.meta.dirname, 'fixtures'), { recursive: true })
    writeFileSync(FILE, `${text}\n`)
  }
  assert.equal(text, readFileSync(FILE, 'utf8').trimEnd(), 'view() as pinned: UPDATE_SNAPSHOT=1 writes it again')
})
