// An MCP server that needs a sign-in: read off a codex or claude tab's screen (mcpNeeds), a band per server (mcpAuth),
// Sign in runs codex's own `codex mcp login <name>` and restarts the tab once it's in; Dismiss hides it for the session;
// an agent can't.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { mcpNeeds } from '../src/daemon/mcpAuth.ts'
import { fresh, sleep, until } from './helpers.ts'

test('mcpNeeds: codex names it in its warning; claude says needs authentication; claude.ai connectors left out', () => {
  assert.deepEqual(mcpNeeds('codex', '⚠ The planetscale MCP server is not logged in. Run `codex mcp login planetscale`.\n> hi'), ['planetscale'])
  assert.deepEqual(mcpNeeds('codex', 'The linear MCP server is not logged in. Run `codex mcp login other`.'), []) // not its own name: not the warning
  assert.deepEqual(mcpNeeds('claude', '  planetscale · △ needs authentication\n  claude.ai Gmail · △ needs authentication\n  sentry: needs-auth\n  github · ✔ connected'), ['planetscale', 'sentry'])
  assert.deepEqual(mcpNeeds('claude', '1 MCP server needs authentication · /mcp'), []) // a count names none
  assert.deepEqual(mcpNeeds('gemini', 'The x MCP server is not logged in. Run `codex mcp login x`'), [])
})

test("an MCP server's sign-in: the band, codex mcp login for it, the tab restarted once in; Dismiss; never an agent's", async t => {
  const rig = await fresh(t, { env: { LAKI_MCP_AUTH_MS: '150' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  const tab = await until(async () => (x => x?.status === 'idle' && x)(await rig.tab(ws.id)), 'codex up')
  const warn = 'The planetscale MCP server is not logged in. Run `codex mcp login planetscale`.'
  await rig.rpc('send', { target: tab.id, text: warn }) // the fake echoes it: on its screen as codex's own warning would be
  const a = await until(async () => (await rig.tab(ws.id)).mcpAuth, 'the band')
  assert.deepEqual(a.names, ['planetscale'])
  await assert.rejects(rig.rpc('mcpSignIn', { tab: tab.id, name: 'planetscale', act: 'open', from: { ws: ws.id, tab: tab.id } }), /signing an agent's MCP server in is yours/)
  // the fake's log, none yet under load (a release's run: ENOENT): codex's own start in it first, then counted
  const runs = () => {
    try {
      return rig.fakeLog().filter((l: any) => l.bin === 'codex' && l.args[0] !== 'mcp').length
    } catch {
      return 0
    }
  }
  const was = await until(() => runs() || undefined, "codex's start in the fake's log")
  const r = await rig.rpc('mcpSignIn', { tab: tab.id, name: 'planetscale', act: 'open' })
  assert.equal(r.cmd, "codex mcp login 'planetscale'")
  await until(async () => (await rig.tab(ws.id)).mcpAuth === undefined, 'signed in: the band gone')
  await until(() => runs() === was + 1, 'the tab restarted to reconnect it')
  assert.ok(rig.fakeLog().some((l: any) => l.bin === 'codex' && l.args.join(' ') === 'mcp login planetscale'))
  // Dismiss: gone for this session, even while its screen still says so
  await until(async () => (await rig.tab(ws.id))?.status === 'idle', 'codex up again')
  await rig.rpc('send', { target: tab.id, text: warn })
  await until(async () => (await rig.tab(ws.id)).mcpAuth, 'the band again')
  await rig.rpc('mcpSignIn', { tab: tab.id, name: 'planetscale', act: 'dismiss' })
  await sleep(500) // three more looks at the same screen: not told again
  assert.equal((await rig.tab(ws.id)).mcpAuth, undefined)
})

test("claude: only a server of its own config counts (the agent's words don't); Sign in types /mcp", async t => {
  const rig = await fresh(t, { env: { LAKI_MCP_AUTH_MS: '150' } })
  writeFileSync(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { linear: { command: 'linear-mcp' } } }))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.status === 'idle' && x)(await rig.tab(ws.id)), 'claude up')
  await rig.rpc('send', { target: tab.id, text: 'The endpoint · needs authentication, and linear · △ needs authentication' })
  const a = await until(async () => (await rig.tab(ws.id)).mcpAuth, 'the band')
  assert.deepEqual(a.names, ['linear']) // not "endpoint": no such server
  assert.deepEqual(await rig.rpc('mcpSignIn', { tab: tab.id, name: 'linear', act: 'open' }), { typed: '/mcp' })
  assert.equal((await rig.tab(ws.id)).mcpAuth, undefined)
})
