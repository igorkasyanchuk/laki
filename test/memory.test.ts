import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { MEMORY_MAX } from '../src/shared/types.ts'
import { fresh } from './helpers.ts'

// a fake OpenRouter: each request answered with `answer(body)`, recorded
async function openrouter(t: { after: (f: () => void) => void }, answer: (body: any) => object | Promise<object>) {
  const hits: any[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push(JSON.parse(body))
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await answer(hits.at(-1))))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  return { hits, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }
}
const says = (content: string) => ({ model: 'm', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } })

test("memory compaction: the learned ones (never yours) through Laki AI's model, a shorter list in their place, logged; on its own every few days or when full", async t => {
  let reply = ''
  const or = await openrouter(t, () => says(reply))
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('projectAdd', { path: rig.repo })
  const [p] = (await rig.rpc('state')).projects
  await rig.rpc('memoryAdd', { project: p.id, text: 'Run tests with npm test', auto: false }) // yours
  const a = await rig.rpc('memoryAdd', { project: p.id, text: 'npm test runs the tests' })
  const b = await rig.rpc('memoryAdd', { project: p.id, text: 'tests: npm test (95 s)' })
  await rig.rpc('memoryAdd', { project: p.id, text: 'the API lives in src/daemon/main.ts' })

  await rig.rpc('settingsSet', { ai: { on: false } }) // on unless turned off
  await assert.rejects(rig.rpc('memoryCompact', { project: p.id }), /Laki AI is off/)
  await rig.rpc('settingsSet', { ai: {} }) // on: unset
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc' })

  // an answer that isn't the list: nothing changes, the failure is the run's
  reply = 'I cannot'
  await assert.rejects(rig.rpc('memoryCompact', { project: p.id }), /something else than the list/)
  let mem = (await rig.rpc('state')).projects[0]
  assert.equal(mem.memory.length, 4)
  assert.equal(mem.compacted.ok, false)

  reply = '```json\n' + JSON.stringify({ memories: [{ text: 'Tests: npm test (about 95 s)', from: [a.id, b.id] }, { text: 'The API: src/daemon/main.ts', from: [] }] }) + '\n```'
  const run = await rig.rpc('memoryCompact', { project: p.id })
  assert.deepEqual([run.ok, run.before, run.after, run.why], [true, 3, 2, 'you'])
  const sent = JSON.parse(or.hits.at(-1).messages.at(-1).content)
  assert.deepEqual(sent.map((m: any) => m.text), ['npm test runs the tests', 'tests: npm test (95 s)', 'the API lives in src/daemon/main.ts'], 'only the learned ones go')
  mem = (await rig.rpc('state')).projects[0]
  assert.deepEqual(mem.memory.filter((m: any) => !m.auto).map((m: any) => m.text), ['Run tests with npm test'], 'yours stay')
  assert.deepEqual(mem.memory.filter((m: any) => m.auto).map((m: any) => m.text).sort(), ['Tests: npm test (about 95 s)', 'The API: src/daemon/main.ts'].sort())
  assert.equal(mem.memory.find((m: any) => m.text.startsWith('Tests')).at, b.at, 'dated as the newest it came from')

  const log = await rig.rpc('memoryCompactLog', { project: p.id })
  assert.equal(log.length, 2)
  assert.deepEqual(log[0].now, ['Tests: npm test (about 95 s)', 'The API: src/daemon/main.ts'])
  assert.equal(log[0].was.length, 3)
  assert.ok(readFileSync(join(rig.data, 'memory-compact.jsonl'), 'utf8').includes('npm test runs the tests'))

  // on its own, on by default (a key saved, Laki AI on): not yet due, a week later, and never once turned off
  await rig.rpc('memoryAdd', { project: p.id, text: 'one more thing learned' })
  reply = JSON.stringify({ memories: [{ text: 'All of it', from: [] }] })
  assert.deepEqual(await rig.rpc('memoryTick', { now: Date.now() + 86400000 }), [])
  assert.deepEqual(await rig.rpc('memoryTick', { now: Date.now() + 8 * 86400000 }), [p.id])
  assert.equal((await rig.rpc('state')).projects[0].compacted.why, 'days')
  await rig.rpc('settingsSet', { memoryCompact: { on: false } })
  await rig.rpc('memoryAdd', { project: p.id, text: 'and another' })
  assert.deepEqual(await rig.rpc('memoryTick', { now: Date.now() + 30 * 86400000 }), [])

  // a choice from before the default: 0.24's off, or 0.25's switch turned off (the key dropped), stays off at the next start
  for (const was of [{ off: true, days: 7 }, { days: 3 }]) {
    await rig.stop()
    const st = JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8'))
    st.settings.memoryCompact = was
    writeFileSync(join(rig.data, 'state.json'), JSON.stringify(st))
    await rig.start()
    assert.equal((await rig.rpc('state')).settings.memoryCompact.on, false)
    assert.deepEqual(await rig.rpc('memoryTick', { now: Date.now() + 30 * 86400000 }), [])
  }
})

test('memory compaction when full: once, not again while a run leaves it full; again once it fills up after a shorter list', async t => {
  let reply: string[] = []
  let during: (() => Promise<unknown>) | undefined // the user's doing while the model works
  const or = await openrouter(t, async () => (await during?.(), says(JSON.stringify({ memories: reply.map(text => ({ text, from: [] })) }))))
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('projectAdd', { path: rig.repo })
  const [p] = (await rig.rpc('state')).projects
  await rig.rpc('settingsSet', { memoryCompact: { on: true, days: 0 } }) // only when full; Laki AI on by default
  const learn = async (n: number, from: number) => {
    for (let i = from; i < from + n; i++) await rig.rpc('memoryAdd', { project: p.id, text: `fact ${i}` })
  }
  await learn(MEMORY_MAX, 0)
  assert.deepEqual(await rig.rpc('memoryTick', {}), [], 'full, but OpenRouter without a key: not tried')
  assert.equal((await rig.rpc('state')).projects[0].compacted, undefined)
  await rig.rpc('memoryRm', { project: p.id, id: (await rig.rpc('state')).projects[0].memory.at(-1).id })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc' })
  assert.deepEqual(await rig.rpc('memoryTick', {}), [], 'not full yet')
  await learn(1, MEMORY_MAX)
  reply = Array.from({ length: MEMORY_MAX }, (_, i) => `merged ${i}`) // the model can't make it shorter
  assert.deepEqual(await rig.rpc('memoryTick', {}), [p.id], 'full: compacted')
  assert.equal((await rig.rpc('state')).projects[0].compacted.why, 'full')
  assert.deepEqual(await rig.rpc('memoryTick', { now: Date.now() + 3 * 3600000 }), [], 'it left them full: not again (days 0: never by days)')
  assert.equal(or.hits.length, 1)

  reply = ['short 1', 'short 2']
  during = async () => {
    const mem: any[] = (await rig.rpc('state')).projects[0].memory
    await rig.rpc('projectSet', { id: p.id, memory: mem.map(m => (m.text === 'merged 0' ? { ...m, auto: undefined } : m)) }) // pinned as yours meanwhile
  }
  await rig.rpc('memoryCompact', { project: p.id }) // Compact now: 2 left
  during = undefined
  assert.ok((await rig.rpc('state')).projects[0].memory.some((m: any) => m.text === 'merged 0' && !m.auto), 'pinned while it ran: kept, as yours')
  await learn(MEMORY_MAX - 2, 100)
  assert.deepEqual(await rig.rpc('memoryTick', {}), [p.id], 'full again since the shorter list')
})

test("memory compaction: an OpenRouter that never answers ends at the wait (LAKI_AI_WAIT_MS; 5 minutes), nothing changed", async t => {
  const srv = createServer(() => {}) // takes the request, never answers
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, LAKI_AI_WAIT_MS: '500' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('memoryAdd', { project: p.id, text: 'one' })
  await rig.rpc('memoryAdd', { project: p.id, text: 'two' })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc' })
  const t0 = Date.now()
  await assert.rejects(rig.rpc('memoryCompact', { project: p.id }), /timeout|timed out|aborted/i)
  assert.ok(Date.now() - t0 < 10_000)
  assert.equal((await rig.rpc('state')).projects[0].memory.length, 2)
})

test('memory compaction through claude -p: no tools, no MCP server of yours (what it reads is what agents wrote)', async t => {
  const rig = await fresh(t)
  await rig.rpc('projectAdd', { path: rig.repo })
  const [p] = (await rig.rpc('state')).projects
  await rig.rpc('memoryAdd', { project: p.id, text: 'npm test runs the tests' })
  await rig.rpc('memoryAdd', { project: p.id, text: 'the API lives in src/daemon/main.ts' }) // two at least
  await rig.rpc('settingsSet', { ai: { backend: 'claude' } })
  await rig.rpc('memoryCompact', { project: p.id }).catch(() => {}) // what the fake answers doesn't matter here
  const run = rig.fakeLog().find(l => l.bin === 'claude' && l.args[0] === '-p')
  assert.ok(run, 'claude -p ran')
  assert.equal(run.args[run.args.indexOf('--tools') + 1], '')
  assert.ok(run.args.includes('--strict-mcp-config') && !run.args.includes('--mcp-config'), run.args.join(' '))
  // codex: not your config.toml, and none of its own tools (a shell reads any file in its read-only sandbox)
  await rig.rpc('settingsSet', { ai: { backend: 'codex' } })
  await rig.rpc('memoryCompact', { project: p.id }).catch(() => {})
  const cx = rig.fakeLog().find(l => l.bin === 'codex' && l.args[0] === 'exec')
  assert.ok(cx, 'codex exec ran')
  assert.ok(cx.args.includes('--ignore-user-config'), cx.args.join(' '))
  for (const f of ['shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use']) assert.ok(cx.args.includes(`features.${f}=false`), f)
})
