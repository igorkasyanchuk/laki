// Remote access through Tailscale and laki serve (headless), Run ▾'s project scripts, laki screen's device ops (the
// iOS Simulator through stand-ins for xcrun and idb), archived workspaces' clean-up and new worktrees' copied files.
// Stand-ins go in the test's own $HOME/bin (first on PATH).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SimCheck } from '../src/shared/types.ts'
import { connect, fresh, type Rig, until } from './helpers.ts'

const script = (path: string, body: string) => (writeFileSync(path, body), chmodSync(path, 0o755))
// a 1×1 PNG: what the fake simulator's screenshot writes
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='

// tailscale: up (or $HOME/ts-state's) with one other device online (none with $HOME/ts-alone), serve (and funnel)
// prints its URL and waits, as the real one's foreground mode does
function fakeTailscale(rig: Rig) {
  script(
    join(rig.home, 'bin/tailscale'),
    `#!/bin/sh
echo "$*" >> "$HOME/ts.log"
case "$1" in
  status) [ -e "$HOME/ts-alone" ] && p='{}' || p='{"a":{"Online":true},"b":{"Online":false}}'; echo "{\\"BackendState\\":\\"$(cat "$HOME/ts-state" 2>/dev/null || echo Running)\\",\\"Peer\\":$p}" ;;
  serve|funnel) echo "Available within your tailnet:"; echo; echo "https://box.tail1234.ts.net/"; echo "|-- proxy $3"; trap 'echo stopped >> "$HOME/ts.log"; exit 0' TERM; while :; do sleep 1; done ;;
esac
`,
  )
}

test('remote access through tailscale: the tailnet only, its token from its origin, stopped with it; laki serve and laki remote', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, via: 'tailscale' }), /tailscale isn't installed/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, via: 'ngrok' }), /through cloudflare or tailscale, not ngrok/)
  fakeTailscale(rig)
  writeFileSync(join(rig.home, 'ts-state'), 'NeedsLogin')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, via: 'tailscale' }), /Tailscale isn't connected \(NeedsLogin\): tailscale up/)
  writeFileSync(join(rig.home, 'ts-state'), 'Running')

  const on = await rig.rpc('remoteStart', { hours: 0, via: 'tailscale' })
  const url = 'https://box.tail1234.ts.net'
  assert.deepEqual([on.url, on.via, on.mail, on.open, on.until, on.peers, on.funnel], [url, 'tailscale', '', undefined, undefined, 1, false]) // no email, never "open"; the other device online
  assert.match(on.link, /^https:\/\/box\.tail1234\.ts\.net\/\?token=[0-9a-f]{64}$/)
  assert.match(readFileSync(join(rig.home, 'ts.log'), 'utf8'), new RegExp(`serve --https=443 http://127\\.0\\.0\\.1:${port}\n`))
  const key = on.link.split('?token=')[1] // good once, for the page's own token
  const own = (await fetch(`http://127.0.0.1:${port}/pin`, { method: 'POST', headers: { origin: url }, body: JSON.stringify({ token: key }) }).then(r => r.json())).token
  const ping = (origin: string) => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${own}`, origin }, body: JSON.stringify({ method: 'ping' }) }).then(r => r.status)
  assert.equal(await ping(url), 200)
  assert.equal(await ping('https://evil.ts.net'), 403)
  const c = await connect(rig, url, own)
  assert.equal(await c.call('ping'), 'pong')
  c.close()

  // the CLI: laki remote says it; laki serve on a daemon that runs starts nothing new
  const r = await rig.cli('remote')
  assert.match(r.out, /box\.tail1234\.ts\.net\/\?token=.*\nyour tailnet's devices only\nuntil stopped/)
  const s = await rig.cli('serve', '--tailscale')
  assert.equal(s.code, 0, s.err)
  assert.match(s.out, /laki: remote access\nhttps:\/\/box\.tail1234\.ts\.net\/\?token=[0-9a-f]{64} \(opened already: a link works once[^\n]*\n[^]*in the daemon already running here/)
  assert.match((await rig.cli('serve')).err, /how do you get in\? laki serve --tailscale/)
  assert.match((await rig.cli('serve', '--cloudflare', '--open')).err, /--open lets in anyone with the link: give it --hours \(24 at most\)/)

  assert.equal((await rig.cli('remote', 'stop')).out.trim(), 'stopped')
  await until(() => readFileSync(join(rig.home, 'ts.log'), 'utf8').includes('stopped'), 'tailscale serve stopped')
  assert.equal(await ping(url), 403) // its origin went with it
  assert.match((await rig.cli('remote')).out, /remote access is off/)

  // Funnel: the internet, with a PIN only; alone on the tailnet: said
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, via: 'tailscale', funnel: true }), /Funnel puts it on the internet: only with a PIN/)
  writeFileSync(join(rig.home, 'ts-alone'), '')
  const f = await rig.rpc('remoteStart', { hours: 1, via: 'tailscale', funnel: true, pin: true })
  assert.deepEqual([f.funnel, f.peers, typeof f.pin], [true, 0, 'string'])
  assert.match(readFileSync(join(rig.home, 'ts.log'), 'utf8'), new RegExp(`funnel --https=443 http://127\\.0\\.0\\.1:${port}\n`))
  assert.match((await rig.cli('remote')).out, /on the internet \(Tailscale Funnel\)\nPIN \d{6}/)
  const logged = (await rig.cli('serve', '--tailscale', '--pin')).out // not a terminal (a service's log): no PIN in it
  assert.match(logged, /PIN: see Settings › Remote access, or laki remote/)
  assert.doesNotMatch(logged, /PIN \d{6}/)
  await rig.rpc('remoteStop')
  const lone = await rig.rpc('remoteStart', { hours: 1, via: 'tailscale' })
  assert.equal(lone.peers, 0)
  assert.match((await rig.cli('remote')).out, /none online but this machine, which can't open its own link/)
  await rig.rpc('remoteStop')
  await until(() => readFileSync(join(rig.home, 'ts.log'), 'utf8').match(/stopped/g)?.length === 3, 'both stopped')

  // laki serve with no daemon: its own, in this process; started by Laki --headless, it ends with it (here: a parent
  // that isn't its own, as after a kill)
  await rig.stop()
  rig.env.LAKI_HEADLESS_PARENT = '1'
  const alone = await rig.cli('serve', '--tailscale')
  delete rig.env.LAKI_HEADLESS_PARENT
  assert.equal(alone.code, 0, alone.err)
  assert.match(alone.out, /laki: remote access\nhttps:\/\/box\.tail1234\.ts\.net\/\?token=[0-9a-f]{64} \(it works once, in one tab\)\n[^]*laki: Laki --headless ended: stopping/)
  await until(() => readFileSync(join(rig.home, 'ts.log'), 'utf8').match(/stopped/g)?.length === 4, 'its tailscale serve went with it')
})

test("Run ▾'s scripts: a tab each, named as it, replaced when run again; Enter runs an ended one again; refusals", async t => {
  const rig = await fresh(t, { config: { test: 'echo x >> "$HOME/runs"; echo tests-ran-$PORT', lint: 'sleep 2; echo linted' } })
  const runs = () => (existsSync(join(rig.home, 'runs')) ? readFileSync(join(rig.home, 'runs'), 'utf8').split('\n').length - 1 : 0)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  assert.deepEqual((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).scripts, ['test', 'lint'])
  const tab = await rig.rpc('run', { ws: ws.id, script: 'test' })
  assert.deepEqual([tab.kind, tab.name], ['script', 'test'])
  await until(async () => (await rig.screen(tab.id)).includes(`tests-ran-${ws.port}`), 'the test script ran')
  await until(async () => (await rig.tab(ws.id, 'test'))?.status === 'exited', 'it ended, its tab kept') // a clean exit keeps it
  await rig.rpc('tabSet', { id: tab.id, name: 'my tests' }) // renamed, still the one replaced
  const again = await rig.rpc('run', { ws: ws.id, script: 'test' })
  const tabs = (await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id && x.kind === 'script')
  assert.deepEqual(tabs.map((x: any) => x.id), [again.id]) // the last one's tab went
  await until(async () => (await rig.tab(ws.id, 'test'))?.status === 'exited', 'ended again')
  assert.equal(runs(), 2)
  await rig.rpc('input', { tab: again.id, data: '\r' }) // Enter: once more, in the same tab
  await until(() => runs() === 3, 'ran again on Enter')
  await assert.rejects(rig.rpc('run', { ws: ws.id, script: 'deploy' }), /no "deploy" command: set one in the project settings or \.laki\.json/)
  await assert.rejects(rig.rpc('run', { ws: ws.id, script: 'rm' }), /no script "rm": test, lint, format, deploy/)
  // the project's settings win over .laki.json, and keep these
  await rig.rpc('projectSet', { id: p.id, config: { deploy: ' echo shipped ' } })
  assert.equal((await rig.rpc('state')).projects[0].config.deploy, 'echo shipped')
  assert.deepEqual((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).scripts, ['test', 'lint', 'deploy'])
  // a deploy runs again only through Run ▾ (which asks), never on Enter
  await rig.rpc('projectSet', { id: p.id, config: { deploy: 'echo x >> "$HOME/deploys"' } })
  const dep = await rig.rpc('run', { ws: ws.id, script: 'deploy' })
  await until(async () => (await rig.screen(dep.id)).includes('Run ▾ › Deploy runs it again'), 'the deploy ended')
  await rig.rpc('input', { tab: dep.id, data: '\r' })
  assert.equal((await rig.tab(ws.id, 'deploy'))?.status, 'exited') // a restart would be running at once
  await new Promise(r => setTimeout(r, 500))
  assert.equal(readFileSync(join(rig.home, 'deploys'), 'utf8'), 'x\n')
  assert.match((await rig.cli('run', ws.id, 'lint')).out, /started lint/)
  assert.equal((await rig.tab(ws.id, 'lint'))?.status, 'running') // while its command runs
  await until(async () => (await rig.tab(ws.id, 'lint'))?.status === 'exited', 'lint ended')
})

test("laki screen: the booted simulator's screenshot (in points), tap, swipe, type, describe; refusals", async t => {
  const rig = await fresh(t)
  const bin = join(rig.home, 'bin')
  await assert.rejects(rig.rpc('device', { op: 'zoom' }), /screen: zoom\? one of shot, windows, tap, swipe, type, describe/)
  script(
    join(bin, 'xcrun'),
    `#!/bin/sh
echo "xcrun $*" >> "$HOME/dev.log"
[ "$3" = devices ] && { [ -f "$HOME/no-sim" ] && echo '{"devices":{}}' || echo '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-0":[{"udid":"U-1","name":"iPhone 17","state":"Booted"}]}}'; exit 0; }
[ "$2" = io ] && { echo '${PNG}' | base64 -d > "$5"; exit 0; }
[ "$2" = getenv ] && case "$4" in *WIDTH) echo 6 ;; *HEIGHT) echo 9 ;; *SCALE) echo 3.000000 ;; esac && exit 0
exit 1
`,
  )
  writeFileSync(join(rig.home, 'no-sim'), '')
  await assert.rejects(rig.rpc('device', { op: 'shot' }), /no iOS Simulator is booted/)
  execFileSync('rm', [join(rig.home, 'no-sim')])
  const shot = await rig.rpc('device', { op: 'shot' })
  assert.equal(shot.simulator, 'iPhone 17')
  assert.ok(shot.path.startsWith(join(rig.data, 'images')) && existsSync(shot.path))
  await assert.rejects(rig.rpc('device', { op: 'tap', x: 1, y: 2 }), /need idb: brew install facebook\/fb\/idb-companion/)

  script(
    join(bin, 'idb'),
    `#!/bin/sh
echo "idb $*" >> "$HOME/dev.log"
[ "$2" = describe-all ] && echo '[{"AXLabel":"App","frame":{"x":0,"y":0,"width":2,"height":3}}]'
exit 0
`,
  )
  await rig.rpc('device', { op: 'tap', x: 10.25, y: '20' })
  await rig.rpc('device', { op: 'swipe', x: 1, y: 2, x2: 3, y2: 4 })
  await rig.rpc('device', { op: 'type', text: '-n hello' })
  assert.deepEqual(await rig.rpc('device', { op: 'describe' }), [{ AXLabel: 'App', frame: { x: 0, y: 0, width: 2, height: 3 } }])
  await assert.rejects(rig.rpc('device', { op: 'tap', x: 'left', y: 2 }), /x: a number \(points\)/)
  await assert.rejects(rig.rpc('device', { op: 'type' }), /type: what text\?/)
  const log = readFileSync(join(rig.home, 'dev.log'), 'utf8')
  for (const l of ['idb ui tap --udid U-1 -- 10 20', 'idb ui swipe --udid U-1 -- 1 2 3 4', 'idb ui text --udid U-1 -- -n hello', 'idb ui describe-all --udid U-1 --json'])
    assert.ok(log.includes(`${l}\n`), `${l} in\n${log}`)
  // the picture at its size in points, simctl's screen over its scale (sips: macOS's)
  const pts = await rig.rpc('device', { op: 'shot' })
  assert.match(pts.note ?? '', /pixels are points/)
  if (process.platform === 'darwin') {
    const png = readFileSync(pts.path)
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2, 3])
  }
  // the CLI's verbs; anything else is still a tab's screen
  assert.equal((await rig.cli('screen', 'tap', '5', '6')).out.trim(), 'ok')
  assert.match((await rig.cli('screen', 'shot')).out, /\/images\/\d+-\w+\.png/)
  assert.match((await rig.cli('screen', 'nope')).err, /no workspace|not found|no tab/i)
})

test('the Simulator tab: iOS Simulators and adb devices listed, frames, taps and swipes in points or pixels, typing, keys, a screenshot; refusals; Settings › Simulators\' checks', async t => {
  const rig = await fresh(t)
  const bin = join(rig.home, 'bin')
  const log = () => readFileSync(join(rig.home, 'sim.log'), 'utf8')
  await assert.rejects(rig.rpc('sim', { op: 'zoom' }), /sim: zoom\? one of list, frame/)
  assert.match((await rig.rpc('sim', { op: 'list' })).why.join('\n'), /Android: adb isn't on PATH/, 'none: why')
  // a project's own Simulator switch: kept as a boolean, over Settings' (the renderer's); anything else unset
  const pj = await rig.rpc('projectAdd', { path: rig.repo })
  assert.equal((await rig.rpc('projectSet', { id: pj.id, config: { simulator: false } })).config.simulator, false, "a project's own off")
  assert.equal((await rig.rpc('projectSet', { id: pj.id, config: { simulator: 'yes' } })).config.simulator, undefined, 'not a boolean: as Settings say')
  const ios = process.platform === 'darwin' // simctl: macOS's
  script(
    join(bin, 'xcrun'),
    `#!/bin/sh
echo "xcrun $*" >> "$HOME/sim.log"
[ "$3" = devices ] && { echo '{"devices":{"iOS-26":[{"udid":"U-1","name":"iPhone 17","state":"Booted"},{"udid":"U-2","name":"iPad","state":"Shutdown"}]}}'; exit 0; }
[ "$3" = runtimes ] && { echo '{"runtimes":[{"name":"iOS 26.0","platform":"iOS","isAvailable":true},{"name":"watchOS 12.0","platform":"watchOS","isAvailable":true}]}'; exit 0; }
[ "$2" = io ] && { echo '${PNG}' | base64 -d > "$6"; exit 0; }
[ "$2" = getenv ] && case "$4" in *WIDTH) echo 1170 ;; *HEIGHT) echo 2532 ;; *SCALE) echo 3.000000 ;; esac && exit 0
exit 1
`,
  )
  script(
    join(bin, 'idb'),
    `#!/bin/sh
echo "idb $*" >> "$HOME/sim.log"
exit 0
`,
  )
  script(join(bin, 'idb_companion'), '#!/bin/sh\n')
  script(join(bin, 'xcode-select'), '#!/bin/sh\necho /Applications/Xcode.app/Contents/Developer\n')
  // adb and the emulator where Android Studio puts them, not on PATH
  const sdk = join(rig.home, process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk')
  mkdirSync(join(sdk, 'platform-tools'), { recursive: true })
  mkdirSync(join(sdk, 'emulator'), { recursive: true })
  script(join(sdk, 'emulator/emulator'), '#!/bin/sh\necho "INFO    | Storing crashdata"\necho Pixel_9\n')
  // a screen of 1080 by 2400 pixels (its header's; sips may not read the rest: it goes as it came)
  const png = Buffer.from(PNG, 'base64')
  png.writeUInt32BE(1080, 16)
  png.writeUInt32BE(2400, 20)
  writeFileSync(join(rig.home, 'screen.png'), png)
  script(
    join(sdk, 'platform-tools/adb'),
    `#!/bin/sh
echo "adb $*" >> "$HOME/sim.log"
case "$*" in
  "devices -l") printf 'List of devices attached\\nemulator-5554          device product:sdk_gphone64 model:sdk_gphone64_arm64 transport_id:1\\nR58M  offline\\nZX1  unauthorized usb:1-1 transport_id:2\\n' ;;
  *"exec-out screencap -p") cat "$HOME/screen.png" ;;
  "-s emulator-5554 emu avd name") if [ -f "$HOME/avd-ko" ]; then printf 'KO: unknown command\\r\\n'; else printf 'Pixel_9\\r\\nOK\\r\\n'; fi ;;
esac
exit 0
`,
  )
  const l = await rig.rpc('sim', { op: 'list' })
  assert.deepEqual(l.devices, [...(ios ? [{ id: 'ios:U-1', name: 'iPhone 17', os: 'ios' }] : []), { id: 'android:emulator-5554', name: 'Pixel 9', os: 'android' }], 'booted ones, ready ones; an emulator by its AVD')
  assert.match(l.why.join('\n'), /ZX1 waits for you to allow USB debugging/, 'a phone that asks: said')
  writeFileSync(join(rig.home, 'avd-ko'), '')
  assert.equal((await rig.rpc('sim', { op: 'list' })).devices.at(-1).name, 'sdk gphone64 arm64', "a console that doesn't answer OK: its model")
  rmSync(join(rig.home, 'avd-ko'))
  const checks = async () => (await rig.rpc('sim', { op: 'check' })).checks as SimCheck[]
  let c = await checks()
  const by = (id: string) => c.find(x => x.id === id)!
  assert.ok(by('adb').ok && by('adb').says.endsWith('platform-tools/adb'), "adb found in Android Studio's SDK")
  assert.deepEqual([by('emulator').ok, by('emulator').says], [true, 'Pixel_9'], "its AVDs, the emulator's own lines left out")
  assert.deepEqual([by('device').ok, by('device').says], [true, 'Pixel 9; ZX1 waits for you to allow USB debugging on it'])
  if (ios) {
    assert.deepEqual(c.filter(x => x.os === 'ios').map(x => [x.id, x.ok]), [['xcode', true], ['simctl', true], ['runtime', true], ['booted', true], ['idb', true]])
    assert.equal(by('runtime').says, 'iOS 26.0', 'iOS runtimes only')
    script(join(bin, 'xcode-select'), '#!/bin/sh\necho /Library/Developer/CommandLineTools\n')
    c = await checks()
    assert.deepEqual(c.filter(x => x.os === 'ios').map(x => x.id), ['xcode'], 'no Xcode: nothing after it')
    assert.ok(!by('xcode').ok && !by('xcode').warn && /xcode-select -s/.test(by('xcode').fix!), 'the Command Line Tools alone: Xcode and the switch to it')
  }
  const droid = 'android:emulator-5554'
  await assert.rejects(rig.rpc('sim', { op: 'tap', device: droid, x: 0.5, y: 0.5 }), /no frame of it yet/)
  assert.match((await rig.rpc('sim', { op: 'frame', device: droid })).frame, /^data:image\/(png|jpeg);base64,/)
  await rig.rpc('sim', { op: 'tap', device: droid, x: 0.5, y: 0.5 })
  await rig.rpc('sim', { op: 'swipe', device: droid, x: 0, y: 0, x2: 1, y2: 1 })
  await rig.rpc('sim', { op: 'type', device: droid, text: "it's a test" })
  await rig.rpc('sim', { op: 'key', device: droid, key: 'back' })
  for (const l of ['adb -s emulator-5554 shell input tap 540 1200', 'adb -s emulator-5554 shell input swipe 0 0 1079 2399 300', "adb -s emulator-5554 shell input text 'it'\\''s%sa%stest'", 'adb -s emulator-5554 shell input keyevent KEYCODE_BACK'])
    assert.ok(log().includes(`${l}\n`), `${l} in\n${log()}`)
  await assert.rejects(rig.rpc('sim', { op: 'tap', device: droid, x: 2, y: 0 }), /x: a fraction of the picture/)
  await assert.rejects(rig.rpc('sim', { op: 'key', device: droid, key: 'nope' }), /key: one of home, back/)
  await assert.rejects(rig.rpc('sim', { op: 'frame', device: 'ios:U 1; rm' }), /which device\?/)
  const shot = await rig.rpc('sim', { op: 'shot', device: droid })
  assert.ok(shot.path.startsWith(join(rig.data, 'images')) && existsSync(shot.path), 'a screenshot for a prompt, in images/')
  if (!ios) return
  assert.match((await rig.rpc('sim', { op: 'frame', device: 'ios:U-1' })).frame, /^data:image\/jpeg;base64,/)
  await rig.rpc('sim', { op: 'tap', device: 'ios:U-1', x: 0.5, y: 0.25 })
  await rig.rpc('sim', { op: 'key', device: 'ios:U-1', key: 'home' })
  await rig.rpc('sim', { op: 'type', device: 'ios:U-1', text: '-n hi' })
  await assert.rejects(rig.rpc('sim', { op: 'key', device: 'ios:U-1', key: 'back' }), /on iOS, one of home, lock/)
  for (const l of ['xcrun simctl io U-1 screenshot --type=jpeg', 'xcrun simctl getenv U-1 SIMULATOR_MAINSCREEN_SCALE', 'idb ui tap --udid U-1 -- 195 211', 'idb ui button --udid U-1 -- HOME', 'idb ui text --udid U-1 -- -n hi']) assert.ok(log().includes(l), `${l} in\n${log()}`)
})

test('archived workspaces deleted after settings.archivedDays (their branch kept); copy ignored and untracked files into new worktrees', async t => {
  const rig = await fresh(t)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: rig.repo, env: rig.env, encoding: 'utf8' })
  writeFileSync(join(rig.repo, '.gitignore'), 'secret.env\nbuild/\n')
  git('add', '.gitignore')
  git('commit', '-qm', 'ignore')
  writeFileSync(join(rig.repo, 'secret.env'), 'KEY=1\n')
  execFileSync('mkdir', ['-p', join(rig.repo, 'build')])
  writeFileSync(join(rig.repo, 'build/out.js'), 'x\n')
  // links stay links (node_modules/.bin's, pnpm's folders), to the worktree's own copy
  execFileSync('mkdir', ['-p', join(rig.repo, 'build/lib'), join(rig.repo, 'build/bin')])
  writeFileSync(join(rig.repo, 'build/lib/tool.js'), 'tool\n')
  symlinkSync('../lib/tool.js', join(rig.repo, 'build/bin/tool'))
  symlinkSync('lib', join(rig.repo, 'build/pkg'))
  writeFileSync(join(rig.repo, 'notes.md'), 'mine\n')
  writeFileSync(join(rig.repo, '.worktreeinclude'), 'local.cfg\n') // untracked, not ignored: copied with copyIgnored on too
  writeFileSync(join(rig.repo, 'local.cfg'), 'cfg\n')
  const p = await rig.rpc('projectAdd', { path: rig.repo })

  const plain = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'plain' })
  assert.deepEqual(['secret.env', 'build/out.js', 'notes.md'].map(f => existsSync(join(plain.path, f))), [false, false, false])
  await rig.rpc('settingsSet', { copyIgnored: true })
  const ign = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'ign' })
  assert.deepEqual(['secret.env', 'local.cfg', 'notes.md'].map(f => existsSync(join(ign.path, f))), [true, true, false])
  await rig.rpc('settingsSet', { copyUntracked: true })
  const all = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'all' })
  assert.deepEqual(['secret.env', 'build/out.js', 'notes.md'].map(f => existsSync(join(all.path, f))), [true, true, true])
  assert.equal(readFileSync(join(all.path, 'secret.env'), 'utf8'), 'KEY=1\n')
  assert.equal(readlinkSync(join(all.path, 'build/bin/tool')), '../lib/tool.js')
  assert.ok(lstatSync(join(all.path, 'build/pkg')).isSymbolicLink())
  assert.equal(readFileSync(join(all.path, 'build/pkg/tool.js'), 'utf8'), 'tool\n')

  await rig.rpc('wsArchive', { id: plain.id })
  const now = Date.now()
  await rig.rpc('archivedTidy', { now: now + 30 * 86400e3 }) // off: nothing goes
  assert.ok((await rig.rpc('state')).workspaces.some((w: any) => w.id === plain.id))
  await rig.rpc('settingsSet', { archivedDays: 7 })
  await rig.rpc('archivedTidy', { now: now + 6 * 86400e3 })
  assert.ok((await rig.rpc('state')).workspaces.some((w: any) => w.id === plain.id))
  await rig.rpc('archivedTidy', { now: now + 8 * 86400e3 })
  const v = await rig.rpc('state')
  assert.ok(!v.workspaces.some((w: any) => w.id === plain.id))
  assert.ok(v.workspaces.some((w: any) => w.id === all.id)) // not archived: stays
  assert.match(git('branch', '--list', plain.branch), new RegExp(plain.branch)) // its branch stays
})
