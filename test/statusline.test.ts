// Claude's status line (meters.ts): Laki's statusline.sh keeps each local claude tab's status line JSON, then runs
// your own status line with the same input; the context meter and the plan limits take its numbers while fresh.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const said = (rig: any, tab: string) => rig.fakeLog().filter((l: any) => l.bin === 'statusline' && l.tab === tab)

test('statusline: a claude tab keeps its JSON, your own runs with it; the meter and plan limits read it while fresh', async t => {
  let hits = 0
  const srv = createServer((_q, r) => {
    hits++
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ five_hour: { utilization: 41 }, limits: [{ kind: 'weekly_scoped', percent: 9, scope: { model: { display_name: 'Fable' } } }] }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200', LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('settingsSet', { usage: { claude: true } }) // R4: the endpoint asked for, when its own are old
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 86_400_000 } }))
  // yours: what it reads kept, a line printed
  writeFileSync(join(rig.home, '.claude/settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'cat > "$HOME/mine.json"; echo my line' } }))

  // Laki's settings files name its script (the fast one too)
  for (const f of ['claude-settings.json', 'claude-settings-fast.json']) assert.match(JSON.parse(readFileSync(join(rig.data, f), 'utf8')).statusLine.command, /statusline\.sh/)

  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const line = await until(() => said(rig, tab.id)[0], 'its status line')
  assert.equal(line.out, 'my line\n') // yours, as claude would show it
  const kept = join(rig.data, 'statusline', `${tab.id}.json`)
  assert.equal(JSON.parse(readFileSync(kept, 'utf8')).session_id, tab.resumeId)
  assert.equal(readFileSync(join(rig.home, 'mine.json'), 'utf8'), readFileSync(kept, 'utf8')) // the same input
  assert.equal(rig.fakeLog().find((l: any) => l.bin === 'claude' && l.tab === tab.id).env.LAKI_STATUSLINE_CMD, 'cat > "$HOME/mine.json"; echo my line')

  // the meter: its current_usage against the window it said (1M), not the transcript's guess
  await until(async () => (await rig.tab(ws.id))?.context?.max === 1e6, 'the status line’s context')
  assert.deepEqual((await rig.tab(ws.id)).context, { used: 2 + 116 + 50866, max: 1e6 })
  // only a percentage (before an answer's usage): of its window
  writeFileSync(kept + '.x', JSON.stringify({ session_id: tab.resumeId, context_window: { current_usage: null, used_percentage: 40, context_window_size: 200000 } }))
  renameSync(kept + '.x', kept)
  await until(async () => (await rig.tab(ws.id))?.context?.used === 80000, 'its percentage')
  assert.equal((await rig.tab(ws.id)).context.max, 200000)

  // plan limits: its rate_limits win; the endpoint, still asked on its TTL, adds its per-model windows (Fable's week:
  // the status line has none)
  writeFileSync(kept, readFileSync(join(rig.home, 'mine.json')))
  let u = (await rig.rpc('usage'))[0]
  assert.deepEqual(u.windows.slice(0, 2), [{ label: '5-hour', used: 37, resets: 1793832000000 }, { label: 'Weekly', used: 16, resets: 1794326400000 }])
  assert.deepEqual([hits, u.source, u.windows.map((w: any) => [w.label, w.used])], [1, 'own', [['5-hour', 37], ['Weekly', 16], ['Weekly · Fable', 9]]])
  await rig.rpc('usage')
  assert.equal(hits, 1) // kept 7.5 minutes
  // 10 minutes on, it's old: the endpoint's alone
  const later = Date.now() + 11 * 60_000
  u = (await rig.rpc('usage', { now: later }))[0]
  assert.deepEqual([hits, u.windows.map((w: any) => [w.label, w.used])], [2, [['5-hour', 41], ['Weekly · Fable', 9]]])
  u = (await rig.rpc('usage'))[0]
  assert.deepEqual([hits, u.windows.map((w: any) => [w.label, w.used])], [2, [['5-hour', 37], ['Weekly', 16], ['Weekly · Fable', 9]]])

  // R4: the endpoint off (the default): its own numbers however old, their time; the server not asked
  await rig.rpc('settingsSet', { usage: { claude: false } })
  u = (await rig.rpc('usage', { now: Date.now() + 60 * 60_000 }))[0]
  assert.deepEqual([hits, u.source, u.windows.map((w: any) => w.label), u.at < Date.now()], [2, 'own', ['5-hour', 'Weekly'], true])

  // a closed tab's goes
  await rig.rpc('tabClose', { id: tab.id })
  assert.equal(existsSync(kept), false)
})

test("statusline: the project's own wins over yours, Laki's never wraps itself, and the switch takes it out", async t => {
  const rig = await fresh(t)
  const script = join(rig.data, 'statusline.sh')
  mkdirSync(join(rig.home, '.claude'))
  const home = join(rig.home, '.claude/settings.json')
  // yours is Laki's own script: none run after it
  writeFileSync(home, JSON.stringify({ statusLine: { type: 'command', command: `'${script}'` } }))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const ta = await until(async () => (await rig.tab(a.id))?.resumeId && (await rig.tab(a.id)), 'its chat')
  assert.equal((await until(() => said(rig, ta.id)[0], 'its status line')).out, '')
  assert.equal(rig.fakeLog().find((l: any) => l.bin === 'claude' && l.tab === ta.id).env.LAKI_STATUSLINE_CMD, undefined)
  assert.ok(existsSync(join(rig.data, 'statusline', `${ta.id}.json`)))
  // even named as yours, it runs once and ends
  const out = execFileSync(script, { input: '{}', encoding: 'utf8', timeout: 5000, env: { ...rig.env, LAKI_TAB: 'x', LAKI_STATUSLINE_DIR: join(rig.data, 'statusline'), LAKI_STATUSLINE_CMD: `'${script}'; echo once` } })
  assert.equal(out, 'once\n')

  // the project's (committed, so its worktree has it) over yours
  writeFileSync(home, JSON.stringify({ statusLine: { type: 'command', command: 'echo home' } }))
  mkdirSync(join(rig.repo, '.claude'))
  writeFileSync(join(rig.repo, '.claude/settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo project' } }))
  execFileSync('git', ['add', '-A'], { cwd: rig.repo, env: rig.env })
  execFileSync('git', ['commit', '-qm', 'status line'], { cwd: rig.repo, env: rig.env })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tb = await until(async () => await rig.tab(b.id), 'its tab')
  assert.equal((await until(() => said(rig, tb.id)[0], 'its status line')).out, 'project\n')
  // a worktree's own (its branch's, an agent's edit) never picks it: the project's folder's only
  writeFileSync(join(b.path, '.claude/settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo worktree' } }))
  const tc = await rig.rpc('tabNew', { ws: b.id, preset: 'claude' })
  assert.equal((await until(() => said(rig, tc.id)[0], 'its status line')).out, 'project\n')

  // off: no statusLine in Laki's settings files; on again: back
  const has = () => ['claude-settings.json', 'claude-settings-fast.json'].map(f => 'statusLine' in JSON.parse(readFileSync(join(rig.data, f), 'utf8')))
  await rig.rpc('settingsSet', { statusBridge: false })
  assert.deepEqual(has(), [false, false])
  await rig.rpc('settingsSet', { statusBridge: true })
  assert.deepEqual(has(), [true, true])
})

test("statusline: an account's plan limits window by window across its tabs: the later reset, then the higher percent", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200', FAKE_CODEX_LIMITS: 'unknown' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const a = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const b = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  for (const x of [a, b]) await until(() => said(rig, x.id)[0], 'its status line')
  const reset = Math.floor(Date.now() / 1000) + 3600 // seconds, as claude says it
  const week = reset + 5 * 86400
  // a: idle, its file rewritten just now with the numbers it had; b: busier, its file older
  const put = (tab: string, five: [number, number], seven: [number, number], ago: number) => {
    const f = join(rig.data, 'statusline', `${tab}.json`)
    writeFileSync(f, JSON.stringify({ session_id: 'x', rate_limits: { five_hour: { used_percentage: five[0], resets_at: five[1] }, seven_day: { used_percentage: seven[0], resets_at: seven[1] } } }))
    utimesSync(f, new Date(Date.now() - ago), new Date(Date.now() - ago))
  }
  put(a.id, [12, reset], [30, week - 7 * 86400], 1000) // its week's window is the one before
  put(b.id, [40, reset], [5, week], 60_000)
  const u = (await rig.rpc('usage'))[0]
  assert.deepEqual(u.windows.map((w: any) => [w.label, w.used, w.resets]), [['5-hour', 40, reset * 1000], ['Weekly', 5, week * 1000]])
  assert.ok(Math.abs(u.at - (Date.now() - 60_000)) < 5000, 'as of the oldest reading chosen')

  // codex: each tab's last token_count rate_limits, chosen the same way (its app-server says none: FAKE_CODEX_LIMITS)
  const day = join(rig.home, '.codex/sessions/2026/11/20')
  mkdirSync(day, { recursive: true })
  const rl = (id: string, used: number, resetsAt: number, ago: number) =>
    writeFileSync(join(day, `rollout-2026-11-20T10-00-00-${id}.jsonl`), `${JSON.stringify({ timestamp: new Date(Date.now() - ago).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: resetsAt } } } })}\n`)
  const cx = []
  for (const [id, used, ago] of [['cx-a', 9, 1000], ['cx-b', 33, 120_000]] as const) {
    rl(id, used, reset, ago)
    const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
    await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: id } })
    cx.push(tab)
  }
  const c = await until(async () => (x => x?.windows?.[0]?.used === 33 && x)((await rig.rpc('usage')).find((r: any) => r.agent === 'codex')), 'codex’s, the higher one')
  assert.deepEqual(c.windows.map((w: any) => [w.label, w.used, w.resets]), [['5-hour', 33, reset * 1000]])
})
