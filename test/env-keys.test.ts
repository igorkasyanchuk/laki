// Secret values out of state.json (daemon/envKeys.ts): Settings' env, a profile's, a project's, the phone push's URL,
// in the Keychain (test/fakes/keychain-security, LAKI_KEYCHAIN=1) or 0600 files of their own; tabs still get them; an
// old state.json migrates
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const SECURITY = readFileSync(new URL('./fakes/keychain-security', import.meta.url), 'utf8')
const SECRETS = ['ghp_fake_secret_one', 'proj_fake_secret_two', 'profile_fake_secret_three', 'push_fake_token_four']
const onDisk = (data: string) =>
  readdirSync(data)
    .filter(f => f.startsWith('state.json'))
    .map(f => readFileSync(join(data, f), 'utf8'))
    .join('\n')
const echoed = async (rig: Awaited<ReturnType<typeof fresh>>, ws: string, line: string) => {
  const sh = await rig.rpc('tabNew', { ws })
  await rig.rpc('send', { target: sh.id, text: 'echo "[$GH_TOKEN|$API_KEY]"' })
  await until(async () => (await rig.screen(sh.id)).includes(line), `a tab with ${line}`)
}

test('secret values in Settings, a profile, a project and the push URL: in the Keychain, only their names in state.json; tabs get them; removed with their names', async t => {
  const rig = await fresh(t, { env: { LAKI_KEYCHAIN: '1' } })
  writeFileSync(join(rig.home, 'bin', 'security'), SECURITY, { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', {
    env: { GH_TOKEN: SECRETS[0], PLAIN_NAME: 'plain-value' },
    presets: [{ name: 'tests', agent: 'command', cmd: 'exec cat', env: { OTHER_SECRET: SECRETS[2] } }],
    webhook: { url: `https://ntfy.example.com/laki-topic?auth=${SECRETS[3]}`, format: 'ntfy', answer: true, replyTopic: 'r1' },
  })
  await rig.rpc('projectSet', { id: p.id, config: { env: { API_KEY: SECRETS[1] } } })
  const disk = JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8'))
  for (const s of SECRETS) assert.ok(!onDisk(rig.data).includes(s), `${s} is not in state.json`)
  assert.equal(disk.settings.env.GH_TOKEN, null, 'its name stays')
  assert.equal(disk.settings.env.PLAIN_NAME, 'plain-value', 'a plain one stays as it is')
  assert.equal(disk.projects[0].config.env.API_KEY, null)
  assert.equal(disk.settings.presets[0].env.OTHER_SECRET, null)
  assert.equal(disk.settings.webhook.url, null)
  assert.equal(readFileSync(join(rig.home, 'keychain', 'Laki AI__env:GH_TOKEN'), 'utf8'), SECRETS[0])
  assert.equal(readFileSync(join(rig.home, 'keychain', `Laki AI__env:project:${p.id}:API_KEY`), 'utf8'), SECRETS[1])
  const log = readFileSync(rig.env.FAKE_LOG, 'utf8')
  for (const s of SECRETS) assert.ok(!log.includes(s), `${s} on no command line`)
  // a tab gets them, now and after a restart (read back from the Keychain)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'tests' })
  await echoed(rig, ws.id, `[${SECRETS[0]}|${SECRETS[1]}]`)
  // twice: the first start after it was written (the values null in state.json from then on) and one more
  for (const _ of [1, 2]) {
    await rig.stop()
    await rig.start()
    const hook = (await rig.rpc('stateOwn')).settings.webhook
    assert.equal(hook.answer, true, "the push's answers stay on: its URL read back before it's checked")
    assert.equal(hook.answerOff, undefined)
  }
  await echoed(rig, ws.id, `[${SECRETS[0]}|${SECRETS[1]}]`)
  assert.match(await rig.rpc('diagnostics'), /env:GH_TOKEN in Keychain/)
  for (const s of SECRETS) assert.ok(!onDisk(rig.data).includes(s), `${s} still not in state.json after a restart`)
  const daemonLog = rig.out
  for (const s of SECRETS) assert.ok(!daemonLog.includes(s), `${s} in no log`)
  // laki backup: the archive's state.json has the names, not the values; its manifest says where they are
  const tgz = join(rig.home, 'b.tgz')
  const { manifest } = await rig.rpc('dataBackup', { file: tgz })
  assert.ok(manifest.secrets.names.includes('env:GH_TOKEN'))
  assert.match(manifest.secrets.note, /Keychain/)
  const out = mkdtempSync(join(rig.home, 'x-'))
  execFileSync('tar', ['-xzf', tgz, '-C', out])
  for (const s of SECRETS) assert.ok(!readFileSync(join(out, 'state.json'), 'utf8').includes(s), `${s} not in the backup`)
  // a changed value replaces it; a removed name takes its value with it
  await rig.rpc('settingsSet', { env: { GH_TOKEN: 'ghp_fake_changed' } })
  assert.equal(readFileSync(join(rig.home, 'keychain', 'Laki AI__env:GH_TOKEN'), 'utf8'), 'ghp_fake_changed')
  await rig.rpc('settingsSet', { env: {} })
  assert.throws(() => statSync(join(rig.home, 'keychain', 'Laki AI__env:GH_TOKEN')))
})

test('an old state.json with secret values migrates: into the Keychain, out of state.json and its backups; without the Keychain, 0600 files of their own', async t => {
  const rig = await fresh(t, { env: { LAKI_KEYCHAIN: '1' } })
  writeFileSync(join(rig.home, 'bin', 'security'), SECURITY, { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  await rig.stop()
  // as Laki before it wrote them (state v1): the values in state.json
  const file = join(rig.data, 'state.json')
  const old = JSON.parse(readFileSync(file, 'utf8'))
  old.v = 1
  old.settings = { ...old.settings, env: { GH_TOKEN: SECRETS[0] } }
  old.projects[0].config = { env: { API_KEY: SECRETS[1] } }
  writeFileSync(file, JSON.stringify(old, null, 2), { mode: 0o600 })
  await rig.start()
  await until(() => !onDisk(rig.data).includes(SECRETS[0]), 'state.json and its backups without the value')
  assert.ok(!onDisk(rig.data).includes(SECRETS[1]))
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).v, 2)
  assert.equal(readFileSync(join(rig.home, 'keychain', 'Laki AI__env:GH_TOKEN'), 'utf8'), SECRETS[0])
  await echoed(rig, ws.id, `[${SECRETS[0]}|${SECRETS[1]}]`)

  // the Keychain off (a test's daemon without LAKI_KEYCHAIN): each value a 0600 file in <data>/env-keys
  const plain = await fresh(t)
  await plain.rpc('settingsSet', { env: { GH_TOKEN: SECRETS[0] } })
  assert.ok(!onDisk(plain.data).includes(SECRETS[0]))
  const files = readdirSync(join(plain.data, 'env-keys')).map(f => join(plain.data, 'env-keys', f))
  assert.deepEqual(files.map(f => readFileSync(f, 'utf8').trim()), [SECRETS[0]])
  assert.equal(statSync(files[0]).mode & 0o777, 0o600)
})

test("a value with a line break never goes to security -i (its next line would run as another command): kept in its 0600 file; extensions' secrets move into the Keychain", async t => {
  const rig = await fresh(t, { env: { LAKI_KEYCHAIN: '1' } })
  writeFileSync(join(rig.home, 'bin', 'security'), SECURITY, { mode: 0o755 })
  const two = 'x\nadd-generic-password -s injected -a evil -w 1'
  await rig.rpc('settingsSet', { env: { PRIVATE_KEY: two } })
  assert.throws(() => statSync(join(rig.home, 'keychain', 'injected__evil')), 'its second line never ran')
  assert.throws(() => statSync(join(rig.home, 'keychain', 'Laki AI__env:PRIVATE_KEY')), 'not in the Keychain')
  assert.ok(!readFileSync(rig.env.FAKE_LOG, 'utf8').includes('-i'), 'security -i never called for it')
  assert.ok(!onDisk(rig.data).includes('add-generic-password'), 'not in state.json either')
  const kept = readdirSync(join(rig.data, 'env-keys')).map(f => readFileSync(join(rig.data, 'env-keys', f), 'utf8'))
  assert.deepEqual(kept, [`${two}\n`], 'its own 0600 file has it whole')
  assert.match(await rig.rpc('diagnostics'), /env:PRIVATE_KEY in file \(the Keychain didn't take it\)/)

  // an extension's secret settings: one Keychain item, an old widget-secrets.json moved in at its first read
  const d = join(rig.data, 'widgets', 'sec')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Sec', config: { apiToken: { type: 'secret' } }, fetch: 'echo {}', sample: {} }))
  writeFileSync(join(d, 'widget.html'), '<template preview>hi</template>')
  const file = join(rig.data, 'widget-secrets.json')
  await rig.stop() // an older Laki's file, there as this one starts
  writeFileSync(file, JSON.stringify({ old: { token: 'fake-old-widget-secret' } }), { mode: 0o600 })
  await rig.start()
  await rig.rpc('widgetSet', { id: 'sec', config: { apiToken: 'fake-new-widget-secret' } })
  assert.equal(existsSync(file), false, 'the file moved into the Keychain')
  assert.deepEqual(JSON.parse(readFileSync(join(rig.home, 'keychain', 'Laki AI__widget-secrets'), 'utf8')), { old: { token: 'fake-old-widget-secret' }, sec: { apiToken: 'fake-new-widget-secret' } })
  assert.ok(!readFileSync(rig.env.FAKE_LOG, 'utf8').includes('fake-new-widget-secret'), 'on no command line')
})
