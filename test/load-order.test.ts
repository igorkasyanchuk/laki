// core.ts and the modules it re-exports (hosts, pr, files…) import each other: none may read another's const or let
// as it loads, or whichever is imported first throws "Cannot access … before initialization". Each daemon module
// imported first, in a process of its own, finds such a read in at least one order.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const daemon = fileURLToPath(new URL('../src/daemon/', import.meta.url))

test('every daemon module loads first without reading another before it is there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'laki-load-'))
  const env = { ...process.env, HOME: home, LAKI_HOME: join(home, 'data') }
  const mods = readdirSync(daemon).filter(f => f.endsWith('.ts') && f !== 'main.ts') // main.ts starts the server
  const fails = await Promise.all(
    mods.map(
      f =>
        new Promise<string>(done =>
          execFile(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `await import(${JSON.stringify(join(daemon, f))}); process.exit(0)`], { env, timeout: 60000 }, (e, _out, err) =>
            done(e ? `${f}: ${err.split('\n').find(l => /Error/.test(l)) ?? e.message}` : ''),
          ),
        ),
    ),
  )
  assert.deepEqual(fails.filter(Boolean), [])
})
