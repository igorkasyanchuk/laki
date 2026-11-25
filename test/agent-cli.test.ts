import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { howOf, older } from '../src/daemon/agentCli.ts'
import { fresh, until } from './helpers.ts'

test('A9: how an agent CLI was installed, from where its command really is; versions compared', () => {
  assert.deepEqual(howOf('/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'), { how: 'npm', pkg: '@openai/codex', cmd: 'npm install -g @openai/codex@latest' })
  assert.deepEqual(howOf('/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js', undefined, '0.50.1').cmd, 'npm install -g @openai/codex@0.50.1', 'the exact version')
  assert.deepEqual(howOf('/Users/me/.bun/install/global/node_modules/opencode-ai/bin/opencode', undefined, '0.9.0').cmd, 'bun add -g opencode-ai@0.9.0')
  assert.deepEqual(howOf('/Users/me/Library/pnpm/global/5/node_modules/@google/gemini-cli/dist/index.js', undefined, '1.0.0').cmd, 'pnpm add -g @google/gemini-cli@1.0.0')
  assert.deepEqual(howOf('/Users/me/.bun/install/global/node_modules/opencode-ai/bin/opencode'), { how: 'bun', pkg: 'opencode-ai', cmd: 'bun add -g opencode-ai@latest' })
  assert.deepEqual(howOf('/Users/me/Library/pnpm/global/5/node_modules/@google/gemini-cli/dist/index.js'), { how: 'pnpm', pkg: '@google/gemini-cli', cmd: 'pnpm add -g @google/gemini-cli@latest' })
  assert.deepEqual(howOf('/opt/homebrew/Cellar/gemini-cli/0.9.0/bin/gemini'), { how: 'Homebrew', cmd: 'brew upgrade gemini-cli' })
  assert.deepEqual(howOf('/opt/homebrew/Caskroom/claude-code/2.0.1/claude'), { how: 'Homebrew', cmd: 'brew upgrade --cask claude-code' })
  assert.deepEqual(howOf('/Users/me/.local/share/claude/versions/2.0.1', 'claude update'), { how: 'its installer', cmd: 'claude update' })
  assert.deepEqual(howOf('/usr/local/bin/codex'), { how: 'its installer', cmd: undefined })
  assert.equal(older('2.1.9', '2.1.10'), true)
  assert.equal(older('2.1.10', '2.1.9'), false)
  assert.equal(older('1.0.0', '1.0.0'), false)
  assert.equal(older('0.9.0-beta.1', '0.9.1'), true)
})

test('A9: Settings › Versions: each CLI, the newest from the registry, a dot in the view; Update in a script tab, a failed one says its code', async t => {
  // a fake npm registry: each package's document, its latest and when that was published (a week ago)
  const asked: string[] = []
  const reg = createServer((q, r) => {
    asked.push(decodeURIComponent(q.url ?? ''))
    const v = { '/@anthropic-ai/claude-code': '2.2.0', '/opencode-ai': '0.9.0' }[decodeURIComponent(q.url ?? '')]
    r.writeHead(v ? 200 : 404, { 'content-type': 'application/json' }).end(v ? JSON.stringify({ 'dist-tags': { latest: v }, time: { [v]: new Date(Date.now() - 7 * 86400e3).toISOString() } }) : '{}')
  })
  await new Promise<void>(ok => reg.listen(0, '127.0.0.1', ok))
  t.after(() => reg.close())
  const rig = await fresh(t, { env: { LAKI_NPM_REGISTRY: `http://127.0.0.1:${(reg.address() as AddressInfo).port}` } })
  // opencode installed by npm (its command a link into a global node_modules), npm itself a fake that fails
  const pkg = join(rig.home, 'lib/node_modules/opencode-ai/bin')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'opencode'), '#!/bin/sh\n[ "$1" = --version ] && echo 0.8.1 && exit 0\nexit 0\n')
  chmodSync(join(pkg, 'opencode'), 0o755)
  mkdirSync(join(rig.home, 'bin'), { recursive: true })
  symlinkSync(join(pkg, 'opencode'), join(rig.home, 'bin/opencode'))
  writeFileSync(join(rig.home, 'bin/npm'), '#!/bin/sh\necho "npm ERR! no network"\nexit 3\n')
  chmodSync(join(rig.home, 'bin/npm'), 0o755)

  const list = await rig.rpc('agentVersions', { fresh: true })
  const by = (id: string) => list.find((a: any) => a.id === id)
  assert.deepEqual([by('claude').version, by('claude').newest, by('claude').how, by('claude').cmd], ['2.1.200', '2.2.0', 'its installer', 'claude update'])
  assert.deepEqual([by('opencode').version, by('opencode').newest, by('opencode').how, by('opencode').cmd], ['0.8.1', '0.9.0', 'npm', 'npm install -g opencode-ai@0.9.0'])
  assert.deepEqual([by('gemini').name, by('gemini').how, by('gemini').cmd], ['Antigravity', 'its installer', 'agy update'], 'agy: its own script, not npm')
  assert.match(by('cursor').path, /fakes\/cursor-agent$/, 'C6: the fake on PATH')
  assert.deepEqual([by('copilot').version, by('copilot').cmd], ['0.0.400', 'copilot update'], 'its version by `copilot version`, its own updater')
  assert.ok(asked.includes('/opencode-ai'))
  assert.deepEqual((await rig.rpc('state')).agentUpdates, ['Claude Code', 'OpenCode'], 'the dot: newer ones out')

  // Update: its command in a script tab of "update agents"; npm's exit 3: failed, with its code
  const u = await rig.rpc('agentUpdate', { agent: 'opencode' })
  assert.equal(u.cmd, 'npm install -g opencode-ai@0.9.0', 'the version it showed, not latest')
  const v = await rig.rpc('state')
  assert.equal(v.workspaces.find((w: any) => w.id === u.ws)?.name, 'update agents')
  assert.deepEqual((({ name, kind }) => [name, kind])(v.tabs.find((x: any) => x.id === u.tab)), ['update OpenCode', 'script'])
  assert.deepEqual(v.agentUpdates, ['Claude Code'], 'updating: no dot for it')
  const failed = await until(async () => (await rig.rpc('agentVersions')).find((a: any) => a.id === 'opencode' && a.update?.state === 'failed'), 'the update fails')
  assert.equal(failed.update.code, 3)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'nope' }), /no agent CLI nope/)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'grok' }), /doesn't know how it was installed/) // (every CLI's fake is on PATH, Cursor's too: none here isn't installed)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'codex' }), /doesn't know how it was installed/)
})

test("#A9b: Settings' Update delay holds back an agent CLI's version until it's that old; one without a date with it; the update installs the version shown", async t => {
  // opencode 0.9.0 published an hour ago; claude's package without a date
  const reg = createServer((q, r) => {
    const u = decodeURIComponent(q.url ?? '')
    const doc = u === '/opencode-ai' ? { 'dist-tags': { latest: '0.9.0' }, time: { '0.9.0': new Date(Date.now() - 3600e3).toISOString() } } : u === '/@anthropic-ai/claude-code' || u === '/@openai/codex' ? { 'dist-tags': { latest: u === '/@openai/codex' ? '0.2.0' : '2.2.0' } } : undefined
    r.writeHead(doc ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(doc ?? {}))
  })
  await new Promise<void>(ok => reg.listen(0, '127.0.0.1', ok))
  t.after(() => reg.close())
  const rig = await fresh(t, { env: { LAKI_NPM_REGISTRY: `http://127.0.0.1:${(reg.address() as AddressInfo).port}` } })
  const pkg = join(rig.home, 'lib/node_modules/opencode-ai/bin')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'opencode'), '#!/bin/sh\n[ "$1" = --version ] && echo 0.8.1 && exit 0\nexit 0\n')
  chmodSync(join(pkg, 'opencode'), 0o755)
  mkdirSync(join(rig.home, 'bin'), { recursive: true })
  symlinkSync(join(pkg, 'opencode'), join(rig.home, 'bin/opencode'))
  writeFileSync(join(rig.home, 'bin/npm'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(rig.home, 'bin/npm'), 0o755)
  // codex by npm too, its newest without a date
  const cx = join(rig.home, 'lib/node_modules/@openai/codex/bin')
  mkdirSync(cx, { recursive: true })
  writeFileSync(join(cx, 'codex'), '#!/bin/sh\n[ "$1" = --version ] && echo codex-cli 0.1.0 && exit 0\nexit 0\n')
  chmodSync(join(cx, 'codex'), 0o755)
  symlinkSync(join(cx, 'codex'), join(rig.home, 'bin/codex'))
  // no delay: at once, a missing date or not
  let list = await rig.rpc('agentVersions', { fresh: true })
  let by = (id: string) => list.find((a: any) => a.id === id)
  assert.equal(by('opencode').offerAt, undefined)
  assert.deepEqual((await rig.rpc('state')).agentUpdates, ['Claude Code', 'Codex', 'OpenCode'])
  // 3 days: the hour-old one listed with when it's offered, not counted; the one with no date held back
  await rig.rpc('settingsSet', { updateDelay: 3 })
  list = await rig.rpc('agentVersions')
  by = (id: string) => list.find((a: any) => a.id === id)
  assert.equal(by('opencode').newest, '0.9.0')
  assert.ok(Math.abs(by('opencode').offerAt - (by('opencode').newestAt + 3 * 86400e3)) < 1000, JSON.stringify(by('opencode')))
  assert.ok(Date.now() - by('opencode').newestAt < 2 * 3600e3)
  assert.equal(by('claude').noDelay, true, 'its own updater: the delay does not apply there')
  assert.equal(by('codex').offerAt, -1, 'no date from the registry: held back')
  await until(async () => (await rig.rpc('state')).agentUpdates.length === 1, 'the young one left out of the dot')
  assert.deepEqual((await rig.rpc('state')).agentUpdates, ['Claude Code'])
  // Update now (the window asked once more): the exact version it showed
  const u = await rig.rpc('agentUpdate', { agent: 'opencode' })
  assert.equal(u.cmd, 'npm install -g opencode-ai@0.9.0')
})
