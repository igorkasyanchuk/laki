// The machine scan (daemon/usageScan.ts, usageScanWorker.ts): every agent chat on this Mac read into meters.ts' ledger,
// each answer once whoever reads it (a Laki tab or the scan); only what changed read again; usageAll off: none.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { dayOf } from '../src/daemon/share.ts'
import { type FileState, scan, type ScanOut } from '../src/daemon/usageScanWorker.ts'
import { fresh, until } from './helpers.ts'

const line = (o: object) => `${JSON.stringify(o)}\n`
const now = () => new Date().toISOString()
const ans = (id: string, i: number, o: number, more: object = {}) => line({ type: 'assistant', timestamp: now(), cwd: '/tmp', requestId: `r_${id}`, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: i, output_tokens: o } }, ...more })
const tc = (total: number, h = now()) => line({ type: 'event_msg', timestamp: h, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, total_tokens: total }, last_token_usage: { input_tokens: 1, total_tokens: 1 } } } })
const meta = (id: string, parent?: string) => line({ type: 'session_meta', timestamp: now(), payload: { id, cwd: '/tmp', ...(parent && { source: { subagent: { thread_spawn: { parent_thread_id: parent } } } }) } }) + line({ type: 'turn_context', timestamp: now(), payload: { model: 'gpt-5.4', cwd: '/tmp' } })
const write = (f: string, s: string) => (mkdirSync(dirname(f), { recursive: true }), writeFileSync(f, s))

// the worker's scan alone, on a folder of its own
async function run(home: string, files: Record<string, FileState> = {}, stopAfter = Infinity) {
  const outs: ScanOut[] = []
  let n = 0
  await scan({ claude: [join(home, '.claude')], codex: [join(home, '.codex')], files, since: Date.now() - 90 * 864e5, rate: 1e12 }, o => {
    if (n++ >= stopAfter) throw new Error('stopped') // the daemon quit mid-scan
    outs.push(o)
    for (const [f, s] of Object.entries(o.files)) s ? (files[f] = s) : delete files[f]
  }).catch(e => assert.equal(e.message, 'stopped'))
  return { files, recs: outs.flatMap(o => o.recs) }
}

test('scan: only what changed; read on from where it was; a replaced or rewritten file again from its start; a stopped scan picks up where it stopped', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-scan-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const p = join(home, '.claude/projects/-tmp')
  for (let k = 1; k <= 6; k++) write(join(p, `c${k}.jsonl`), ans(`m${k}`, 10, 1))
  write(join(p, 'c1/subagents/agent-a.jsonl'), ans('s1', 5, 1, { isSidechain: true }))
  // stopped after its first batch: the next scan reads only the rest
  const first = await run(home, {}, 1)
  assert.equal(first.recs.length, 4)
  const rest = await run(home, structuredClone(first.files))
  assert.equal(first.recs.length + rest.recs.length, 7, 'each once over the two')
  assert.deepEqual([...new Set([...first.recs, ...rest.recs].map(r => r.chat))].sort(), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], 'a subagent’s its session’s')
  const state = rest.files
  assert.equal((await run(home, structuredClone(state))).recs.length, 0, 'nothing changed: nothing read')
  // appended: only the new line; rewritten (same size, a new time): from the start; replaced (a new inode): from the start
  appendFileSync(join(p, 'c2.jsonl'), ans('m2b', 3, 1))
  writeFileSync(join(p, 'c3.jsonl'), readFileSync(join(p, 'c3.jsonl')))
  utimesSync(join(p, 'c3.jsonl'), new Date(), new Date(Date.now() + 5000))
  const c4 = readFileSync(join(p, 'c4.jsonl'))
  rmSync(join(p, 'c4.jsonl'))
  write(join(p, 'c4b.jsonl'), 'x') // takes the old inode, maybe
  writeFileSync(join(p, 'c4.jsonl'), c4)
  rmSync(join(p, 'c4b.jsonl'))
  rmSync(join(p, 'c6.jsonl'))
  const again = await run(home, structuredClone(state))
  assert.deepEqual(again.recs.map(r => `${r.chat} ${r.p?.in}`).sort(), ['c2 3', 'c3 10', 'c4 10'])
  assert.equal(again.files[join(p, 'c6.jsonl')], undefined, 'a deleted transcript’s state goes (its rows stay in the ledger)')
  assert.ok(again.recs.every(r => r.cwd === realpathSync('/tmp')), 'its folder, resolved')
})

test('scan: a codex rollout read on from its middle counts what its totals grew by; a spawned thread is its root’s chat', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-scan-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const d = join(home, '.codex/sessions/2026/11/28')
  const id = '11111111-1111-4111-8111-111111111111'
  const kid = '22222222-2222-4222-8222-222222222222'
  const kid2 = '33333333-3333-4333-8333-333333333333'
  write(join(d, `rollout-2026-11-28T10-00-00-${id}.jsonl`), meta(id) + tc(100))
  write(join(d, `rollout-2026-11-28T10-01-00-${kid}.jsonl`), meta(kid, id) + tc(40))
  write(join(d, `rollout-2026-11-28T10-02-00-${kid2}.jsonl`), meta(kid2, kid) + tc(7))
  const a = await run(home)
  assert.deepEqual(a.recs.map(r => [r.chat, r.p?.in]).sort(), [[id, 100], [id, 40], [id, 7]].sort())
  appendFileSync(join(d, `rollout-2026-11-28T10-00-00-${id}.jsonl`), tc(130))
  const b = await run(home, structuredClone(a.files))
  assert.deepEqual(b.recs.map(r => [r.chat, r.p?.in, r.model]), [[id, 30, 'gpt-5.4']], 'the growth, its model as it was')
})

test('scan: a pi session counts each answer once by its entry, a /fork\'s copy of it is the first chat\'s (the ledger owns it), its folder from its header', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-scan-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const d = join(home, '.pi/agent/sessions/--tmp--')
  const id = '44444444-4444-4444-8444-444444444444'
  const fork = '55555555-5555-4555-8555-555555555555'
  const msg = (eid: string, input: number) => line({ type: 'message', id: eid, parentId: null, timestamp: '2026-11-28T10:00:00.000Z', message: { role: 'assistant', content: [], provider: 'anthropic', model: 'claude-sonnet-4-5', usage: { input, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: input + 105, cost: { total: 0.01 } }, stopReason: 'stop', timestamp: 1 } })
  const head = (sid: string) => line({ type: 'session', version: 3, id: sid, timestamp: '2026-11-28T09:59:00.000Z', cwd: '/tmp' })
  write(join(d, `2026-11-28T09-59-00-000Z_${id}.jsonl`), head(id) + msg('aaaa0001', 1000) + line({ type: 'message', id: 'u1', message: { role: 'user', content: 'usage of "assistant"' } }))
  write(join(d, `2026-11-28T10-30-00-000Z_${fork}.jsonl`), head(fork) + msg('aaaa0001', 1000) + msg('bbbb0002', 7))
  const outs: ScanOut[] = []
  await scan({ claude: [], codex: [], pi: [join(home, '.pi/agent/sessions')], files: {}, since: Date.now() - 90 * 864e5, rate: 1e12 }, o => void outs.push(o))
  const recs = outs.flatMap(o => o.recs)
  assert.deepEqual(recs.map(r => [r.chat, r.p?.in, r.p?.rd]).sort(), [[id, 1000, 100], [fork, 1000, 100], [fork, 7, 100]].sort(), 'every answer read; the ledger keeps the copy for the first chat (the same key)')
  assert.equal(new Set(recs.filter(r => r.p?.in === 1000).map(r => r.key)).size, 1, 'one key for the answer and its copy')
  assert.ok(recs.every(r => r.agent === 'pi' && r.cwd === realpathSync('/tmp') && r.day === dayOf(Date.parse('2026-11-28T10:00:00.000Z'))))
})

const rows = async (rig: any) => (await rig.rpc('usageDays')).rows as any[]
const total = (rs: any[]) => rs.reduce((n, r) => n + r.tokens, 0)
const SCAN = { LAKI_METER_MS: '200', LAKI_SCAN_AGAIN_MS: '100' }

test('scan + tabs: a tab’s chat, its fork, its resume and a codex spawned thread each count once; an outside chat resumed in a tab moves there; Laki’s own claude -p chat isn’t counted', async t => {
  const rig = await fresh(t, { env: SCAN })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  write(join(dir, 'chat-a.jsonl'), ans('a1', 100, 10) + ans('a2', 200, 20))
  write(join(dir, 'chat-a/subagents/agent-x.jsonl'), ans('ax', 50, 5, { isSidechain: true }))
  write(join(dir, 'fork-a.jsonl'), readFileSync(join(dir, 'chat-a.jsonl'), 'utf8') + ans('f1', 1, 1)) // a fork: the lines it copied, then its own
  write(join(dir, 'out-1.jsonl'), ans('o1', 7, 3, { cwd: '/Users/nobody/elsewhere/proj' }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-a' } })
  await until(async () => total(await rows(rig)) === 110 + 220 + 55 + 2 + 10, 'every chat once', 20000)
  const by = (rs: any[]) => Object.fromEntries(['', ws.id].map(w => [w, total(rs.filter(r => (r.ws ?? '') === w))]))
  await until(async () => (x => x[''] === 2 + 10 && x[ws.id] === 385)(by(await rows(rig))), 'the fork’s own and the outside chat outside Laki, the tab’s chat its workspace’s')
  // where the outside ones show: by their folder; Today has them apart
  const wsPath = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).path
  write(join(dir, 'in-folder.jsonl'), ans('i1', 4, 1, { cwd: join(wsPath, 'src') }) )
  write(join(dir, 'no-cwd.jsonl'), line({ type: 'assistant', timestamp: now(), requestId: 'r_n1', message: { id: 'n1', model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 1 } } }))
  await rig.rpc('quickNew', { kind: 'shells' }) // the sidebar's Terminals: your home folder, never a chat's name
  write(join(dir, 'home-chat.jsonl'), ans('h1', 1, 1, { cwd: join(rig.home, 'code', 'foo') }))
  const named = await until(async () => (r => (r.length === 5 ? r : undefined))([...new Set((await rows(rig)).filter(r => !r.ws).map(r => r.where))].sort()), 'each outside chat named')
  const w0 = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)
  const tmp = realpathSync('/tmp').split('/').filter(Boolean).slice(-2).join('/')
  assert.deepEqual(named, [`${(await rig.rpc('state')).projects[0].name} · ${w0.name || w0.id}`, 'Outside Laki · elsewhere/proj', `Outside Laki · ${tmp}`, 'Outside Laki · code/foo', 'Unknown folder'].sort(), 'a Laki worktree’s folder names it (never Terminals’ home folder); else its last two folders; none: unknown')
  const today = (await rig.rpc('state')).today
  assert.deepEqual(today.out, { tokens: 2 + 10 + 5 + 3 + 2, cost: today.out.cost })
  assert.deepEqual(today.ws.map((w: any) => w.ws), [ws.id], 'Today’s workspaces: Laki’s')
  // the outside chat resumed in a tab: one chat, its rows move to that workspace
  const t2 = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === t2.id)?.resumeId, 'its own chat first')
  await rig.rpc('hook', { tab: t2.id, state: 'start', payload: { session_id: 'out-1' } })
  appendFileSync(join(dir, 'out-1.jsonl'), ans('o2', 1, 1))
  await until(async () => by(await rows(rig))[ws.id] === 385 + 10 + 2, 'moved, with its new answer')
  assert.ok(!(await rows(rig)).some(r => r.where === 'Outside Laki · elsewhere/proj'))
  // codex: a tab's chat and the thread it spawned, the scan reading both too
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await new Promise(r => setTimeout(r, 500))
  const d = join(rig.home, '.codex/sessions', ...dayOf(Date.now()).split('-').map(x => x.padStart(2, '0')))
  const id = '44444444-4444-4444-8444-444444444444'
  const kid = '55555555-5555-4555-8555-555555555555'
  write(join(d, `rollout-2026-11-28T10-00-00-${id}.jsonl`), meta(id) + tc(1000))
  write(join(d, `rollout-2026-11-28T10-01-00-${kid}.jsonl`), meta(kid, id) + tc(1000) + tc(1300)) // its copy of its parent's turn, then its own
  await rig.rpc('hook', { tab: cx.id, state: 'start', payload: { session_id: id } })
  await until(async () => total((await rows(rig)).filter(r => r.agent === 'codex')) === 1300, 'the parent’s and the thread’s own, once', 20000)
  // Laki AI's own claude -p chat (its session kept in skip): its transcript isn't counted, even one the scan read first
  const before = total(await rows(rig))
  write(join(dir, 'sess-p1.jsonl'), ans('lk', 500, 50))
  await until(async () => total(await rows(rig)) === before + 550, 'read before Laki AI says it is its own')
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude' } })
  await rig.rpc('aiAsk', { text: 'hi' })
  await until(async () => total(await rows(rig)) === before, 'its rows gone with it')
  appendFileSync(join(dir, 'sess-p1.jsonl'), ans('lk2', 5, 5))
  await new Promise(r => setTimeout(r, 1500))
  await rows(rig)
  await new Promise(r => setTimeout(r, 1500))
  assert.equal(total(await rows(rig)), before)
})

test('scan: lines appended after a restart count once; 0.68.0’s old rows recounted where the transcript is, kept where it isn’t; usageAll off reads nothing outside Laki', async t => {
  const rig = await fresh(t, { env: SCAN })
  const dir = join(rig.home, '.claude/projects/-x')
  write(join(dir, 'o1.jsonl'), ans('x1', 10, 1))
  await until(async () => total(await rows(rig)) === 11, 'the first scan')
  await rig.stop()
  appendFileSync(join(dir, 'o1.jsonl'), ans('x2', 20, 2))
  const f = join(rig.data, 'usage-days.json')
  const k = JSON.parse(readFileSync(f, 'utf8'))
  delete k.v
  const y = dayOf(Date.now() - 864e5)
  k.chats.o1.days[y] = { 'claude-opus-5-5': { tokens: 999, cost: 2 } }
  k.chats.o1.days[dayOf(Date.now())] = { 'claude-opus-5-5': { tokens: 9, cost: 2 } } // an old row 0.68.0 kept over x1's parts (its key claimed)
  rmSync(join(rig.data, 'usage-scan-v1.json')) // as an upgrade finds it: no scan yet
  k.chats.gone = { ws: '', agent: 'claude', days: { [y]: { 'claude-opus-5-5': { tokens: 500, cost: 1 } } } }
  writeFileSync(f, JSON.stringify(k))
  await rig.start()
  await until(async () => total(await rows(rig)) === 11 + 22 + 500, 'x2 once; o1’s old row recounted, gone’s kept')
  const base = 11 + 22 + 500 + 1e6
  // a price of your own: the kept days re-priced at once
  write(join(dir, 'gw.jsonl'), line({ type: 'assistant', timestamp: now(), requestId: 'r_gw', message: { id: 'gw1', model: 'my-gateway-1', usage: { input_tokens: 1e6, output_tokens: 0 } } }))
  const gw = async () => (await rows(rig)).find(r => r.model === 'my-gateway-1')
  await until(async () => (await gw())?.priced === false, 'no price')
  await rig.rpc('settingsSet', { prices: { 'my-gateway-1': { in: 3, out: 9 } } })
  assert.deepEqual([(await gw()).priced, (await gw()).cost], [true, 3])
  await assert.rejects(rig.rpc('settingsSet', { prices: { x: { in: 'lots' } } }), /USD per million/)
  // off: nothing new outside Laki is read
  await rig.rpc('settingsSet', { usageAll: false })
  write(join(dir, 'o2.jsonl'), ans('y1', 1000, 1))
  await new Promise(r => setTimeout(r, 1000))
  assert.equal(total(await rows(rig)), base)
  const off = await fresh(t, { env: SCAN })
  await off.rpc('settingsSet', { usageAll: false })
  write(join(off.home, '.claude/projects/-x/z.jsonl'), ans('z1', 5, 5))
  await rows(off)
  await new Promise(r => setTimeout(r, 1000))
  assert.deepEqual([total(await rows(off)), existsSync(join(off.data, 'usage-scan-v1.json'))], [0, false])
})
