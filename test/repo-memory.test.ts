import assert from 'node:assert/strict'
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { memoryParse, memoryText } from '../src/daemon/core.ts'
import { fresh, until } from './helpers.ts'

test('B6: .laki/memory.md: one line each, newest first, read back as Laki keeps it; a line written by hand is the team\'s', () => {
  const l = [
    { id: 'aa11', text: 'Use pnpm,\nnot npm', at: Date.parse('2026-11-01T12:00:00Z') },
    { id: 'bb22', text: 'e2e needs PORT=3100', at: Date.parse('2026-11-10T12:00:00Z'), auto: true },
  ]
  const t = memoryText(l)
  assert.match(t, /^# Project memory\n/)
  assert.ok(t.indexOf('bb22') < t.indexOf('aa11'), 'newest first')
  assert.match(t, /- 2026-11-10 · bb22 · learned · e2e needs PORT=3100\n/)
  assert.match(t, /- 2026-11-01 · aa11 · Use pnpm, not npm\n/, 'one line')
  assert.deepEqual(memoryParse(t), [{ ...l[0], text: 'Use pnpm, not npm' }, l[1]])
  const hand = memoryParse(`${t}- Run the linter before a PR\n`, 5)
  assert.deepEqual((({ text, at, auto }) => ({ text, at, auto }))(hand[0]), { text: 'Run the linter before a PR', at: 5, auto: undefined })
  assert.match(hand[0].id, /^[0-9a-f]{6}$/)
  assert.deepEqual(memoryParse('# Project memory\n\nnot a line\n'), [])
  // a hand-written line with a dot in it: all of it the text (an id only after a date)
  assert.equal(memoryParse('- Postgres · use v15 for tests\n')[0].text, 'Postgres · use v15 for tests')
})

test('B6: notes and memory in the repo: the checkout\'s for the app, a worktree\'s own for its agent; switching back moves nothing', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, notes: 'in Laki', memory: [{ id: 'mine1', text: 'kept in Laki', at: 1 }] })
  await rig.rpc('projectSet', { id: p.id, inRepo: true })
  const proj = async () => (await rig.rpc('state')).projects.find((x: any) => x.id === p.id)
  assert.deepEqual([(await proj()).notes, (await proj()).memory], [undefined, undefined], 'nothing moved: the repo has none yet')
  await rig.rpc('projectSet', { id: p.id, notes: '# How to\nnpm test', memory: [{ id: 'team1', text: 'Use pnpm', at: Date.parse('2026-11-18T12:00:00Z') }] })
  assert.equal(readFileSync(join(rig.repo, '.laki/notes.md'), 'utf8'), '# How to\nnpm test\n')
  assert.match(readFileSync(join(rig.repo, '.laki/memory.md'), 'utf8'), /- 2026-11-18 · team1 · Use pnpm\n/)
  assert.deepEqual([(await proj()).notes, (await proj()).memory.map((m: any) => m.text)], ['# How to\nnpm test', ['Use pnpm']])
  // a teammate's line, pulled: there at once
  writeFileSync(join(rig.repo, '.laki/memory.md'), `${readFileSync(join(rig.repo, '.laki/memory.md'), 'utf8')}- Ask before a migration\n`)
  assert.deepEqual((await proj()).memory.map((m: any) => m.text).sort(), ['Ask before a migration', 'Use pnpm'])

  // an agent in a worktree: its own branch's file (a memory learned there arrives with its merge)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  const m = await rig.rpc('memoryAdd', { project: p.id, text: 'the API mocks live in test/fakes', tab })
  const wt = readFileSync(join(ws.path, '.laki/memory.md'), 'utf8')
  assert.match(wt, new RegExp(`· ${m.id} · learned · the API mocks live in test/fakes`))
  assert.doesNotMatch(readFileSync(join(rig.repo, '.laki/memory.md'), 'utf8'), /API mocks/, "not the checkout's")
  await rig.rpc('memoryRm', { project: p.id, id: m.id, tab })
  assert.doesNotMatch(readFileSync(join(ws.path, '.laki/memory.md'), 'utf8'), /API mocks/)

  // back in Laki: what it kept, as it was; the repo's files stay
  await rig.rpc('projectSet', { id: p.id, inRepo: false })
  assert.deepEqual([(await proj()).notes, (await proj()).memory.map((x: any) => x.text)], ['in Laki', ['kept in Laki']])
  assert.ok(existsSync(join(rig.repo, '.laki/notes.md')))
  // an agent can't move them
  await assert.rejects(rig.rpc('projectSet', { id: p.id, inRepo: true, from: { ws: ws.id, tab } }), /notes and memory place/)
})

test("B6: a repo's .laki/memory.md or .laki as a link (to ~/.zshrc, to ~) is never read or written through", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, inRepo: true })
  const proj = async () => (await rig.rpc('state')).projects.find((x: any) => x.id === p.id)
  const rc = join(rig.home, '.zshrc')
  writeFileSync(rc, '- 2026-11-18 · rc1 · export SECRET=1\n')
  mkdirSync(join(rig.repo, '.laki'))
  symlinkSync(rc, join(rig.repo, '.laki/memory.md'))
  symlinkSync(rc, join(rig.repo, '.laki/notes.md'))
  assert.deepEqual([(await proj()).memory, (await proj()).notes], [undefined, undefined], 'not read')
  await assert.rejects(rig.rpc('projectSet', { id: p.id, memory: [{ id: 'team1', text: 'Use pnpm', at: 1 }] }), /is a link/)
  await assert.rejects(rig.rpc('projectSet', { id: p.id, notes: 'x' }), /is a link/)
  assert.equal(readFileSync(rc, 'utf8'), '- 2026-11-18 · rc1 · export SECRET=1\n', 'yours as it was')
  // .laki itself a link: its memory.md (elsewhere) neither
  rmSync(join(rig.repo, '.laki'), { recursive: true })
  const away = join(rig.home, 'away')
  mkdirSync(away)
  symlinkSync(away, join(rig.repo, '.laki'))
  await assert.rejects(rig.rpc('projectSet', { id: p.id, memory: [{ id: 'team1', text: 'Use pnpm', at: 1 }] }), /is a link/)
  assert.ok(!existsSync(join(away, 'memory.md')))
  // a hard link (an agent's, in its worktree): neither
  unlinkSync(join(rig.repo, '.laki')) // the link, not its folder
  mkdirSync(join(rig.repo, '.laki'))
  linkSync(rc, join(rig.repo, '.laki/memory.md'))
  assert.equal((await proj()).memory, undefined, 'not read')
  await assert.rejects(rig.rpc('projectSet', { id: p.id, memory: [{ id: 'team1', text: 'Use pnpm', at: 1 }] }), /is a link/)
  assert.equal(readFileSync(rc, 'utf8'), '- 2026-11-18 · rc1 · export SECRET=1\n', 'yours as it was')
})
