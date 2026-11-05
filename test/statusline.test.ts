// Claude's status line (meters.ts): Laki's statusline.sh keeps each local claude tab's status line JSON, then runs
// your own status line with the same input; the context meter and the plan limits take its numbers while fresh.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ five_hour: { utilization: 41 }, seven_day_opus: { utilization: 9 } }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200', LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('settingsSet', { usage: { codex: false } })
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

  // plan limits: its rate_limits, the endpoint not asked; its other windows (per model) once it has been
  writeFileSync(kept, readFileSync(join(rig.home, 'mine.json')))
  let u = (await rig.rpc('usage'))[0]
  assert.deepEqual(u.windows, [{ label: '5-hour', used: 37, resets: 1793832000000 }, { label: 'Weekly', used: 16, resets: 1794326400000 }])
  assert.equal(hits, 0)
  // 10 minutes on, it's old: the endpoint again
  const later = Date.now() + 11 * 60_000
  u = (await rig.rpc('usage', { now: later }))[0]
  assert.deepEqual([hits, u.windows.map((w: any) => [w.label, w.used])], [1, [['5-hour', 41], ['Weekly · Opus', 9]]])
  u = (await rig.rpc('usage'))[0]
  assert.deepEqual([hits, u.windows.map((w: any) => [w.label, w.used])], [1, [['5-hour', 37], ['Weekly', 16], ['Weekly · Opus', 9]]])

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
