// npm run eval:ai's plumbing, without a key: its own demo world and daemon (not in test:fast: it starts a daemon, as
// fresh() would), Laki AI pointed at the fake OpenRouter through the script's proxy, each ask's first tool call read
// back and judged, the results file written
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openrouter, reply } from './helpers.ts'

const script = fileURLToPath(new URL('../scripts/ai-evals.ts', import.meta.url))
const run = (args: string[], env: Record<string, string | undefined> = {}) =>
  new Promise<{ code: number; out: string }>(ok => {
    const c = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', script, ...args], { env: { ...process.env, OPENROUTER_API_KEY: undefined, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    c.stdout.on('data', d => (out += d))
    c.stderr.on('data', d => (out += d))
    c.on('exit', code => ok({ code: code ?? 1, out }))
  })

test('eval:ai: no key and no local upstream: refused; against the fake OpenRouter: two asks judged, a results file, no key sent', async t => {
  const none = await run(['--model', 'x/y'])
  assert.equal(none.code, 2)
  assert.match(none.out, /OPENROUTER_API_KEY is needed/)
  const state = (id: string) => reply({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'laki_state', arguments: '{}' } }] })
  const fake = await openrouter(t, [state('c1'), reply({ role: 'assistant', content: 'Two need you.' }), state('c2'), reply({ role: 'assistant', content: 'Nothing runs.' })])
  const out = mkdtempSync(join(tmpdir(), 'laki-evals-out-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const r = await run(['--api', fake.url, '--only', 'status-needs,status-running', '--out', out])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /pass {2}status-needs/)
  assert.match(r.out, /2 of 2 passed/)
  const [file] = readdirSync(out)
  const res = JSON.parse(readFileSync(join(out, file), 'utf8'))
  assert.deepEqual([res.passed, res.total, res.rows.map((x: any) => x.got.name)], [2, 2, ['laki_state', 'laki_state']])
  assert.ok(fake.hits.length >= 4 && fake.hits.every(h => h.url === '/chat/completions' && !h.auth), JSON.stringify(fake.hits.map(h => [h.url, h.auth])))
  assert.ok(fake.hits[0].body.messages.some((m: any) => m.role === 'user' && /Which workspaces need me/.test(JSON.stringify(m.content))))
})
