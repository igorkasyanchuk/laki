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
  // a fake npm registry: each package's latest
  const asked: string[] = []
  const reg = createServer((q, r) => {
    asked.push(decodeURIComponent(q.url ?? ''))
    const v = { '/@anthropic-ai/claude-code/latest': '2.2.0', '/@google/gemini-cli/latest': '0.9.0' }[decodeURIComponent(q.url ?? '')]
    r.writeHead(v ? 200 : 404, { 'content-type': 'application/json' }).end(v ? JSON.stringify({ version: v }) : '{}')
  })
  await new Promise<void>(ok => reg.listen(0, '127.0.0.1', ok))
  t.after(() => reg.close())
  const rig = await fresh(t, { env: { LAKI_NPM_REGISTRY: `http://127.0.0.1:${(reg.address() as AddressInfo).port}` } })
  // gemini installed by npm (its command a link into a global node_modules), npm itself a fake that fails
  const pkg = join(rig.home, 'lib/node_modules/@google/gemini-cli/bin')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'gemini'), '#!/bin/sh\n[ "$1" = --version ] && echo 0.8.1 && exit 0\nexit 0\n')
  chmodSync(join(pkg, 'gemini'), 0o755)
  mkdirSync(join(rig.home, 'bin'), { recursive: true })
  symlinkSync(join(pkg, 'gemini'), join(rig.home, 'bin/gemini'))
  writeFileSync(join(rig.home, 'bin/npm'), '#!/bin/sh\necho "npm ERR! no network"\nexit 3\n')
  chmodSync(join(rig.home, 'bin/npm'), 0o755)

  const list = await rig.rpc('agentVersions', { fresh: true })
  const by = (id: string) => list.find((a: any) => a.id === id)
  assert.deepEqual([by('claude').version, by('claude').newest, by('claude').how, by('claude').cmd], ['2.1.200', '2.2.0', 'its installer', 'claude update'])
  assert.deepEqual([by('gemini').version, by('gemini').newest, by('gemini').how, by('gemini').cmd], ['0.8.1', '0.9.0', 'npm', 'npm install -g @google/gemini-cli@latest'])
  assert.equal(by('cursor').path, undefined, 'not installed: no path')
  assert.ok(asked.includes('/@google/gemini-cli/latest'))
  assert.deepEqual((await rig.rpc('state')).agentUpdates, ['Claude Code', 'Gemini'], 'the dot: newer ones out')

  // Update: its command in a script tab of "update agents"; npm's exit 3: failed, with its code
  const u = await rig.rpc('agentUpdate', { agent: 'gemini' })
  assert.equal(u.cmd, 'npm install -g @google/gemini-cli@latest')
  const v = await rig.rpc('state')
  assert.equal(v.workspaces.find((w: any) => w.id === u.ws)?.name, 'update agents')
  assert.deepEqual((({ name, kind }) => [name, kind])(v.tabs.find((x: any) => x.id === u.tab)), ['update Gemini', 'script'])
  assert.deepEqual(v.agentUpdates, ['Claude Code'], 'updating: no dot for it')
  const failed = await until(async () => (await rig.rpc('agentVersions')).find((a: any) => a.id === 'gemini' && a.update?.state === 'failed'), 'the update fails')
  assert.equal(failed.update.code, 3)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'nope' }), /no agent CLI nope/)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'cursor' }), /isn't installed/)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'codex' }), /doesn't know how it was installed/)
})
