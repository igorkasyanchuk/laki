// Which settings an agent may change (gates.ts AGENT_SETTINGS_OK, main.ts agentNo): every key of the Settings type in
// src/shared/types.ts is said on purpose, the look and layout or the user's (AGENT_SETTINGS_NO). No daemon: test:fast
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { AGENT_SETTINGS_NO, AGENT_SETTINGS_OK, REMOTE_KEYS } from '../src/daemon/gates.ts'

const types = readFileSync(new URL('../src/shared/types.ts', import.meta.url), 'utf8')
const body = /\nexport type Settings = \{\n([\s\S]*?)\n\}\n/.exec(types)?.[1] ?? ''
const keys = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map(m => m[1])

test("every Settings key is an agent's to change (the look and layout) or said to be the user's", () => {
  assert.ok(keys.length > 200, 'the Settings type read')
  assert.deepEqual(keys.filter(k => !AGENT_SETTINGS_OK.has(k) && !AGENT_SETTINGS_NO.has(k)), [], 'in neither list: decide it in src/daemon/gates.ts')
  assert.deepEqual([...AGENT_SETTINGS_OK].filter(k => AGENT_SETTINGS_NO.has(k)), [], 'in both')
  assert.deepEqual([...AGENT_SETTINGS_OK, ...AGENT_SETTINGS_NO].filter(k => !keys.includes(k)), [], 'no longer a setting')
  assert.deepEqual([...AGENT_SETTINGS_OK].filter(k => REMOTE_KEYS.test(k)), [], "a phone's no is an agent's no")
  for (const k of ['memory', 'flowVars', 'storageDir', 'worktrees', 'notify', 'env', 'presets']) assert.ok(AGENT_SETTINGS_NO.has(k), k)
})
