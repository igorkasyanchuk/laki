// OSC 7501 (daemon/program.ts): the protocol's reports, one terminal's records, the query answered once, and the shadow
// comparison with hooks, which changes no tab's status.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseReport, ProgramRecords } from '../src/daemon/program.ts'
import { Session } from '../src/daemon/session.ts'
import { fresh, until } from './helpers.ts'

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('OSC 7501: a report parsed by the protocol, a bad one dropped whole', () => {
  assert.deepEqual({ ...parseReport(`state=blocked:kind=permission:app=terraform:msg=${b64('Apply 3?')}`), at: 0 }, { id: '', state: 'blocked', kind: 'permission', app: 'terraform', at: 0 })
  assert.equal((parseReport('state=working:progress=40') as any).progress, 40)
  assert.equal((parseReport('state=working:progress=101') as any).progress, undefined)
  assert.equal((parseReport('state=done:progress=40') as any).progress, undefined, 'only while working or blocked')
  assert.equal((parseReport('state=idle:kind=permission') as any).kind, undefined, 'only when blocked')
  assert.equal((parseReport('state=blocked:kind=nope') as any).state, 'blocked')
  assert.equal((parseReport('state=idle:state=done') as any).state, 'done', 'the last value')
  assert.equal((parseReport('nonsense:state=idle:BAD=1:x=a b') as any).state, 'idle', 'a bad pair skipped')
  assert.equal((parseReport(' state = idle ') as any).state, 'idle')
  assert.deepEqual(parseReport('state=clear:id=a/b'), { clear: true, id: 'a/b' })
  assert.equal(parseReport('state=sleeping'), undefined)
  assert.equal(parseReport('app=x'), undefined, 'no state')
  assert.equal(parseReport('state=clear:id=a@b'), undefined, "a bad id is not the root's")
  assert.equal(parseReport(`state=idle:id=${'a/'.repeat(8)}a`), undefined, 'too deep')
  assert.equal(parseReport(`state=idle:id=${'a'.repeat(33)}`), undefined)
  assert.equal(parseReport(`state=idle:${'k'.repeat(17)}=1`), undefined, 'a key too long')
  assert.equal(parseReport(`state=idle:x=${'a'.repeat(4100)}`), undefined, 'over the limit')
  assert.equal(parseReport(`state=idle:msg=${b64('two\nlines')}`), undefined, 'a control character')
  assert.equal(parseReport('state=idle:msg=a'), undefined, "base64 that doesn't decode")
  assert.equal(parseReport(`state=idle:msg=${Buffer.from([0xff, 0xfe]).toString('base64')}`), undefined, 'not UTF-8')
  assert.equal(parseReport(`state=idle:title=${b64('x'.repeat(193))}`), undefined)
})

test('OSC 7501: a child never moves its parent; clear takes what is under it; the prompt ends what was working', () => {
  const r = new ProgramRecords()
  assert.equal(r.report('state=working:app=claude-code'), true)
  assert.equal(r.report('state=idle:id=sub1'), false, "a child's isn't the root's")
  assert.equal(r.report('state=working:id=sub1/x'), false)
  assert.equal(r.root()!.state, 'working')
  r.report('state=clear:id=sub1')
  assert.equal(r.get('sub1'), undefined)
  assert.equal(r.get('sub1/x'), undefined)
  assert.equal(r.root()!.state, 'working')
  for (let i = 0; i < 70; i++) r.report(`state=done:id=c${i}`)
  assert.equal(r.root()!.state, 'working', "a flood of children can't push it out")
  assert.equal(r.get('c0'), undefined, 'the least recently updated went')
  assert.ok(r.get('c69'))
  r.prompt()
  assert.equal(r.root(), undefined, 'working: over at a new prompt')
  assert.ok(r.get('c69'), 'done stays')
  r.report('state=idle')
  assert.equal(r.report('state=clear'), true)
  assert.equal(r.get('c69'), undefined)
  assert.equal(r.report('state=clear'), false)
})

const until2 = (f: () => boolean, what: string) => until(() => f(), what)

test("OSC 7501: an agent's tab answers the query once, a shell's doesn't; exit clears; a malformed report is nothing", async t => {
  const prog = `stty raw -echo; printf '\\033]7501;?\\033\\\\'; IFS= read -r -t 3 -d '\\' r; case "$r" in *states=idle*) printf 'REPLIED';; *) printf 'NOREPLY';; esac; IFS= read -r -t 1 -n 1 more || printf ':ONCE'; printf '\\033]7501;state=working:app=x\\007\\033]7501;state=nope\\007\\033]7501;state=idle:id=a@b\\007'; printf ':SENT'; sleep 2`
  const run = (agent: boolean) => {
    const s = new Session(agent ? 'a' : 's', '/bin/bash', ['--noprofile', '--norc', '-c', prog], { cwd: '/tmp', env: process.env as any, cols: 60, rows: 12 })
    s.agent = agent
    let out = ''
    s.onOutput = d => (out += d)
    t.after(() => s.pty.kill())
    return { s, out: () => out }
  }
  const a = run(true)
  await until2(() => a.out().includes(':SENT'), 'the program done')
  assert.match(a.out(), /REPLIED:ONCE/)
  await until2(() => !!a.s.program.root(), 'its report')
  assert.equal(a.s.program.root()!.state, 'working')
  assert.equal(a.s.program.get('a@b'), undefined)
  await until2(() => a.s.exited, 'its exit')
  assert.equal(a.s.program.root(), undefined, 'gone with the program')

  const s = run(false)
  await until2(() => s.out().includes(':SENT'), 'the shell done')
  assert.match(s.out(), /NOREPLY/)
  assert.equal(s.s.program.root(), undefined)
})

test('OSC 7501 in shadow: counted against hooks, the tab keeps the status hooks gave', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: first', 'the first turn')
  assert.equal((await rig.rpc('hooksSeen')).claude.native, undefined, 'none reported yet')

  await rig.rpc('send', { target: ws.id, text: 'osc \\e]7501;state=working:app=claude-code\\a' })
  const differ = await until(async () => (await rig.rpc('hooksSeen')).claude.native?.differ === 1 && (await rig.rpc('hooksSeen')).claude.native, 'working against idle')
  assert.deepEqual([differ.last.native, differ.last.hook, differ.last.app], ['working', 'idle', 'claude-code'])
  assert.equal((await rig.tab(ws.id)).status, 'idle', "a report doesn't move it")

  await rig.rpc('send', { target: ws.id, text: 'osc \\e]7501;state=done\\a' })
  await until(async () => (await rig.rpc('hooksSeen')).claude.native?.agree === 1, 'done against idle')
  assert.equal((await rig.rpc('hooksSeen')).claude.native.differ, 1)
})
