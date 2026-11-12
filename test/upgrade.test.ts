// S9: an update from a Laki whose daemon is older than the new app's window (0.48 to 0.49: the window stayed on its
// splash): conn.ts freshDaemon, which main's daemon() calls, restarts a daemon under the window's API, stopping one
// that turns its shutdown down. Here without the app: a fake old daemon (a node server at .../out/main/daemon.js, as a
// built one's command line reads) in the rig's own data folder, never the real ~/.laki
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { daemonInfo, daemonStale, ensureDaemon, freshDaemon, isDaemonCmd, pidRunning, rpc } from '../src/shared/conn.ts'
import { API } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

const ORIGIN_API = 167 // main's: the first API with app://laki
// an old daemon: daemon.json with its port, token and pid (bin: the copy that started it), ping as an old one answers,
// shutdown refused as the old daemon refused the new app's (its token isn't the app's), or done (refuse: false)
const FAKE = `
const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const [data, api, refuse, bin] = process.argv.slice(2)
const token = 'f'.repeat(64)
const s = http.createServer((req, res) => {
  let b = ''
  req.on('data', d => (b += d)).on('end', () => {
    const { method, params } = JSON.parse(b || '{}')
    const out = r => res.end(JSON.stringify(r))
    if (req.headers.authorization !== 'Bearer ' + token) return (res.statusCode = 401), out({ error: 'bad token' })
    if (method === 'ping') return out({ result: params && params.caps ? { pong: true, api: Number(api) } : 'pong' })
    if (method === 'shutdown') {
      if (refuse === '1') return out({ error: "couldn't tell who's calling: try again" })
      fs.writeFileSync(path.join(data, 'fake-shutdown'), JSON.stringify(params))
      out({ result: null })
      return setTimeout(() => (fs.rmSync(path.join(data, 'daemon.json'), { force: true }), process.exit(0)), 50)
    }
    out({ error: 'unknown method ' + method })
  })
})
s.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(data, 'daemon.json'), JSON.stringify({ port: s.address().port, token, pid: process.pid, ...(bin && { bin }) })))
`
async function oldDaemon(t: any, data: string, home: string, api: number, refuse: boolean, bin = '') {
  const dir = join(home, 'old-laki', 'out', 'main')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'daemon.js'), FAKE)
  const c = spawn(process.execPath, [join(dir, 'daemon.js'), data, String(api), refuse ? '1' : '0', bin], { stdio: 'ignore' })
  t.after(() => c.kill('SIGKILL'))
  await until(() => daemonInfo()?.pid === c.pid, 'the old daemon up')
  return c.pid!
}

test('S9: the decision, pure: no answer is gone (not stale), an old API or a plain pong is stale; a daemon by its command line', () => {
  assert.equal(daemonStale(undefined, ORIGIN_API), false)
  assert.equal(daemonStale('pong', ORIGIN_API), true, 'a daemon from before ping caps')
  assert.equal(daemonStale({ pong: true, api: 166 }, ORIGIN_API), true)
  assert.equal(daemonStale({ pong: true, api: 167 }, ORIGIN_API), false)
  assert.equal(daemonStale({ pong: true, api: API }, ORIGIN_API), false)
  assert.ok(isDaemonCmd('/Applications/Laki.app/Contents/MacOS/Laki /Applications/Laki.app/Contents/Resources/app/out/main/daemon.js'))
  assert.ok(!isDaemonCmd('node /tmp/x/daemon.js') && !isDaemonCmd('/usr/bin/vim out/main/daemon.jsx'))
})

test("S9: an update: an old daemon that refuses the new app's shutdown is stopped and a current one starts; one another copy started stops by its shutdown", async t => {
  const rig = await fresh(t)
  await rig.stop()
  Object.assign(process.env, { HOME: rig.home, LAKI_HOME: rig.data }) // conn.ts reads them as it's called: the rig's folder
  const said: string[] = []
  const start = () => ensureDaemon(rig.env)
  // 0.48's daemon: API 166, turns the shutdown down
  const old = await oldDaemon(t, rig.data, rig.home, 166, true)
  const info = await freshDaemon(start, ORIGIN_API, l => said.push(l))
  assert.ok(!pidRunning(old), 'the old daemon stopped')
  assert.notEqual(info.pid, old)
  assert.equal(((await rpc('ping', { caps: true })) as any).api, API, 'a current daemon answers')
  assert.match(said.join('\n'), /is older than this app's window: restarted/)
  assert.match(readFileSync(join(rig.data, 'daemon.log'), 'utf8'), new RegExp(`the app stops the daemon \\(pid ${old}\\): it refused`))
  // a current daemon: left alone
  const again = await freshDaemon(start, ORIGIN_API, l => said.push(l))
  assert.equal(again.pid, info.pid)
  process.kill(info.pid, 'SIGTERM') // its own whole shutdown (this test runs in no terminal: its shutdown call would be refused, S1)
  await until(() => !pidRunning(info.pid), 'the current daemon stopped')
  // one another copy of Laki started (its own binary in daemon.json), older: stopped by its own shutdown, keep: true
  const other = await oldDaemon(t, rig.data, rig.home, 160, false, '/Volumes/Laki/Laki.app/Contents/MacOS/Laki')
  const n = said.length
  const third = await freshDaemon(start, ORIGIN_API, l => said.push(l))
  assert.ok(!pidRunning(other), 'stopped')
  assert.deepEqual(JSON.parse(readFileSync(join(rig.data, 'fake-shutdown'), 'utf8')), { keep: true }, 'by its shutdown, its terminals kept')
  assert.ok(!said.slice(n).some(l => /didn't stop/.test(l)))
  assert.equal(((await rpc('ping', { caps: true })) as any).api, API)
  assert.ok(existsSync(join(rig.data, 'daemon.json')) && daemonInfo()?.pid === third.pid)
  process.kill(third.pid, 'SIGTERM')
  await until(() => !pidRunning(third.pid), 'stopped at the end')
})
