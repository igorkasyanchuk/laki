// core.ts and the modules it re-exports (hosts, pr, files…) import each other: none may read another's const or let
// as it loads, or whichever is imported first throws "Cannot access … before initialization". Each daemon module
// imported first, in a process of its own, finds such a read in at least one order.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const daemon = fileURLToPath(new URL('../src/daemon/', import.meta.url))
const AT_ONCE = 4 // each type-strips the whole daemon: the other test files run beside them

const load = (f: string, env: NodeJS.ProcessEnv) =>
  new Promise<string>(done =>
    execFile(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `await import(${JSON.stringify(join(daemon, f))}); process.exit(0)`], { env, timeout: 60000 }, (e, _out, err) =>
      done(e ? `${f}: ${err.split('\n').find(l => /Error/.test(l)) ?? e.message}` : ''),
    ),
  )

test('every daemon module loads first without reading another before it is there', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-load-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const env = { ...process.env, HOME: home, LAKI_HOME: join(home, 'data') }
  const mods = readdirSync(daemon).filter(f => f.endsWith('.ts') && f !== 'main.ts') // main.ts starts the server
  const fails: string[] = []
  for (let i = 0; i < mods.length; i += AT_ONCE) fails.push(...(await Promise.all(mods.slice(i, i + AT_ONCE).map(f => load(f, env)))))
  assert.deepEqual(fails.filter(Boolean), [])
})
