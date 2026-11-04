// Hooks not heard: a tab whose agent sends Laki no hooks says so, with the likely why (core.ts hookTick, hookHealth.ts)
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hookCause } from '../src/daemon/hookHealth.ts'
import { fresh, until } from './helpers.ts'

const LATER = 3 * 60_000 // past DEAF_AFTER

test('a claude tab with hooks off says so once prompted, with why; a hook clears it; a working one never; doctor', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  // hooks on: heard at once (its SessionStart), never marked
  const ok = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'fine' })
  await until(async () => (await rig.tab(ok.id))?.last === 'answer: fine', 'its Stop')
  await rig.rpc('hookTick', { now: Date.now() + LATER })
  assert.equal((await rig.tab(ok.id)).hookless, undefined)
  const seen = await rig.rpc('hooksSeen')
  assert.ok(seen.claude.at > 0)
  assert.equal(seen.claude.deaf, 0)
  assert.equal(seen.codex.at, undefined)

  // "disableAllHooks": true in your settings: the fake, as the real one, runs none
  mkdirSync(join(rig.home, '.claude'), { recursive: true })
  writeFileSync(join(rig.home, '.claude/settings.json'), JSON.stringify({ disableAllHooks: true }, null, 2))
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('fake claude'), 'it started')
  // no prompt yet: nothing to hear
  await rig.rpc('hookTick', { now: Date.now() + LATER })
  assert.equal((await rig.tab(ws.id)).hookless, undefined)
  // a prompt it answers, on screen only
  await rig.rpc('send', { target: tab.id, text: 'hello' })
  await until(async () => (await rig.screen(tab.id)).includes('answer: hello'), 'its answer')
  await rig.rpc('hookTick', {}) // just started: not yet
  assert.equal((await rig.tab(ws.id)).hookless, undefined)
  await rig.rpc('hookTick', { now: Date.now() + LATER })
  const h = (await until(async () => (await rig.tab(ws.id)).hookless, 'hookless')) as { why: string; detail: string }
  assert.equal(h.why, '"disableAllHooks": true in ~/.claude/settings.json')
  assert.equal(h.detail, `${join(rig.home, '.claude/settings.json')}:2`)
  assert.equal((await rig.rpc('hooksSeen')).claude.deaf, 1)
  // a hook after all: gone
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await until(async () => !(await rig.tab(ws.id)).hookless, 'cleared by a hook')
  await rig.rpc('hookTick', { now: Date.now() + LATER })
  assert.equal((await rig.tab(ws.id)).hookless, undefined)

  // heard before, then started again with its hooks off (a moved app under a daemon that outlived it): checked anew
  const was = await rig.tab(ok.id)
  await rig.rpc('tabSleep', { tab: was.id })
  await rig.rpc('send', { target: was.id, text: 'again' }) // wakes it: a new start
  await until(async () => (await rig.screen(was.id)).includes('answer: again'), 'its answer after the restart')
  await rig.rpc('hookTick', { now: Date.now() + LATER })
  await until(async () => (await rig.tab(ok.id)).hookless, 'hookless after its restart')

  // doctor: Laki's hook command runs (hook ping), its files are there
  const d = await rig.rpc('doctor')
  assert.deepEqual([d.hooks, d.hookFiles], [{ ok: true }, { ok: true }])
  const ping = await rig.cli('hook', 'ping')
  assert.deepEqual([ping.code, ping.out, ping.err], [0, '', ''])
})

test('hookCause: the first likely why', t => {
  const d = mkdtempSync(join(tmpdir(), 'laki-hooks-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const node = [process.execPath, join(d, 'hook.js')]
  writeFileSync(node[1], '')
  const ws = join(d, 'ws')
  mkdirSync(join(ws, '.claude'), { recursive: true })
  writeFileSync(join(ws, '.claude/settings.local.json'), '{\n  "model": "opus",\n  "disableAllHooks": true\n}\n')
  writeFileSync(join(ws, '.claude/settings.json'), '{ "disableAllHooks": false }')
  const files = [join(ws, '.claude/settings.json'), join(ws, '.claude/settings.local.json'), join(d, 'none.json')]
  assert.deepEqual(hookCause({ agent: 'claude', cwd: ws, files, argv: node }), { why: '"disableAllHooks": true in .claude/settings.local.json', detail: `${join(ws, '.claude/settings.local.json')}:3` })
  assert.match(hookCause({ agent: 'claude', cwd: ws, files: files.slice(0, 1), args: '--model opus --settings ~/mine.json', argv: node }).why, /own --settings/)
  assert.match(hookCause({ agent: 'claude', args: '--settings=x.json', argv: node }).why, /own --settings/)
  assert.doesNotMatch(hookCause({ agent: 'claude', args: '--setting-sources user', argv: node }).why, /--settings/)
  const env = hookCause({ agent: 'claude', env: { where: "its profile's env", dir: '/x/claude' }, argv: node })
  assert.match(env.why, /^CLAUDE_CONFIG_DIR is set in its profile's env: claude reads its settings from \/x\/claude/)
  assert.equal(env.detail, 'CLAUDE_CONFIG_DIR=/x/claude')
  // Laki's hook command: its node gone (a moved app), not executable, its script gone
  assert.match(hookCause({ agent: 'claude', argv: [join(d, 'gone/node'), node[1]] }).why, /hook command doesn't run: .*gone\/node is gone/)
  chmodSync(node[1], 0o644)
  assert.match(hookCause({ agent: 'opencode', argv: [node[1], node[1]] }).why, /isn't executable/)
  assert.match(hookCause({ agent: 'claude', argv: [process.execPath, join(d, 'hook.ts')] }).why, /hook\.ts is gone/)
  // else the agent's own
  assert.equal(hookCause({ agent: 'claude', argv: node }).why, 'unknown: claude may be too old for hooks')
  assert.deepEqual(hookCause({ agent: 'gemini', cwd: ws, argv: node }), { why: 'gemini runs hooks only in versions that have them, in a folder it trusts', detail: ws })
})
