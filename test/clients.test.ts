// T1: trusted clients: an app outside Laki (no tab, no terminal: what S1 refuses) drives it with a named, revocable token
// of its own: made only after Allow in Laki's window, its scopes enforced, a revoked one refused loudly, a token used from
// inside a tab that tab's call, laki mcp's tools cut to its scopes
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { connect, fresh, seen, until } from './helpers.ts'

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))
const node = [process.execPath, '--experimental-strip-types', '--no-warnings']

test('T1: the store keeps only a hash; rotate and revoke kill the old token at once; scopes are checked', async () => {
  const home = mkdtempSync(join(tmpdir(), 'laki-clients-'))
  process.env.LAKI_HOME = home
  const c = await import('../src/daemon/clients.ts')
  const made = c.clientMint('Grok Bot', c.scopesOf(undefined))
  assert.equal(made.id, 'grok-bot')
  assert.deepEqual(made.scopes, ['create', 'send'])
  const token = readFileSync(made.file, 'utf8').trim()
  assert.match(token, /^lakic_[0-9a-f]{64}$/)
  assert.equal(statSync(made.file).mode & 0o777, 0o600)
  assert.equal(statSync(join(home, 'clients')).mode & 0o777, 0o700)
  assert.equal(statSync(join(home, 'clients.json')).mode & 0o777, 0o600)
  assert.ok(!readFileSync(join(home, 'clients.json'), 'utf8').includes(token.slice(6)), 'only its hash on disk')
  assert.equal(c.clientOf(token)?.label, 'Grok Bot')
  assert.equal(c.clientOf(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')) ?? c.clientOf('lakic_x') ?? c.clientOf(token.slice(6)), undefined)
  assert.throws(() => c.clientMint('grok bot', ['send']), /is a client already/)
  const again = c.clientMint('Grok Bot', ['send'], made.id)
  assert.equal(c.clientOf(token), undefined, 'the rotated-away token: gone')
  assert.deepEqual(c.clientOf(readFileSync(again.file, 'utf8').trim())?.scopes, ['send'])
  assert.throws(() => c.scopesOf('create,root'), /no scope root/)
  assert.deepEqual(c.scopesOf(['Send', 'send', 'yolo']), ['send', 'yolo'])
  // one's id and another's name: refused, never the id picked (review #12)
  const other = c.clientMint('Grok-Bot', ['send'])
  assert.equal(other.id, 'grok-bot-2')
  assert.throws(() => c.clientFind('grok-bot'), /grok-bot is Grok Bot's id \(grok-bot\) and Grok-Bot's name \(grok-bot-2\)/)
  assert.equal(c.clientFind('Grok Bot').id, 'grok-bot')
  c.clientRm('grok-bot-2')
  const left = readFileSync(again.file, 'utf8').trim()
  c.clientRm('GROK BOT')
  assert.equal(c.clientOf(left), undefined, 'revoked')
  assert.ok(!existsSync(again.file))
  assert.throws(() => c.clientRm('grok-bot'), /no client grok-bot/)
  rmSync(home, { recursive: true, force: true })
})

test("T1: a client from no tab and no terminal: added after Allow in the window, within its scopes, Created by its name; revoked: refused loudly; laki mcp's tools cut to its scopes", async t => {
  const rig = await fresh(t, { env: { LAKI_TERM_WAIT: '5000' } }) // the window's ask: no answer in 5 s is a no
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { templates: [{ name: 'Implement', text: 'Implement: {{prompt}}' }] })
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-im', name: 'Implementation' }], rows: ['sep-im'] })
  await rig.rpc('presetSave', { name: 'yolo', add: true, set: { agent: 'claude', perm: 'bypassPermissions' } })
  // a process as Grok Bot's shell is: setsid (no terminal), its parent in no tab, no tab's env
  const env: Record<string, string> = { ...rig.env }
  for (const k of ['LAKI_TAB', 'LAKI_WORKSPACE', 'LAKI_TAB_TOKEN', 'LAKI_TAB_TOKEN_FILE', 'LAKI_APP_TOKEN']) delete env[k]
  const loose = (extra: Record<string, string>, args: string[], stdin?: string) =>
    new Promise<{ code: number; out: string; err: string }>(ok => {
      const c = spawn(node[0], [...node.slice(1), cli, ...args], { env: { ...env, ...extra }, detached: true, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
      if (stdin !== undefined) c.stdin!.end(stdin)
      let out = ''
      let err = ''
      c.stdout!.on('data', d => (out += d))
      c.stderr!.on('data', d => (err += d))
      c.on('exit', code => ok({ code: code ?? 1, out, err }))
    })
  const make = ['new', p.id, '--name', 'test', '--group', 'Implementation', '--template', 'Implement', '--preset', 'claude', '--prompt', 'hello']
  // no token: as before, refused
  assert.match((await loose({}, make)).err, /couldn't tell who's calling/)

  // made only once you allow it in the window; Deny and no window refuse
  const app = await connect(rig)
  const added = rig.rpc('clientAdd', { label: 'Grok Bot' })
  const ask: any = await seen(app, (e: any) => e.ev === 'clientAsk', 'the window asked')
  assert.deepEqual([ask.what, ask.label, ask.scopes.length, ask.file], ['add', 'Grok Bot', 2, join(rig.data, 'clients', 'grok-bot.token')])
  await app.call('clientAnswer', { req: ask.req, allow: true })
  const c = await added
  assert.equal(statSync(c.file).mode & 0o777, 0o600)
  const denied = rig.rpc('clientAdd', { label: 'Other' }).catch(e => e)
  await app.call('clientAnswer', { req: (await seen(app, (e: any) => e.ev === 'clientAsk' && e.label === 'Other', 'asked again')).req, allow: false })
  assert.match(String(await denied), /Other wasn't added: not allowed in Laki's window/)
  await assert.rejects(rig.rpc('clientAdd', { label: 'Tabbed', from: { ws: 'w', tab: 't' } }), /from your own terminal, not from a Laki tab/)
  const file = { LAKI_CLIENT_TOKEN_FILE: c.file }
  // a client can't add one, nor answer the window's ask
  const token = readFileSync(c.file, 'utf8').trim()
  const post = async (method: string, params: object, bearer = token) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, params }) })).json()
  assert.match((await post('clientAdd', { label: 'Mine' })).error, /Grok Bot can't call clientAdd: no trusted client can/)
  assert.match((await post('clientAnswer', { req: 'x', allow: true })).error, /only Laki's window allows a trusted client/)

  // with its token: the workspace, under its group, through the template, its agent started; Created by Grok Bot
  let r = await loose(file, make)
  assert.equal(r.code, 0, r.err)
  const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === r.out.split(/\s/)[0])
  assert.equal(ws.client, 'Grok Bot')
  assert.deepEqual((await rig.rpc('state')).projects[0].rows, ['sep-im', ws.id])
  await until(() => rig.fakeLog().some((l: any) => l.bin === 'claude' && l.args.includes('Implement: hello')), 'its agent, through the template')
  assert.match((await loose(file, ['ls'])).out, /created by Grok Bot/)
  assert.match(rig.out, /client Grok Bot: wsNew \(project \S+, preset claude, name test\)/)
  const tab = (await until(() => rig.tab(ws.id))).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  r = await loose(file, ['send', ws.id, 'how is it going'])
  assert.equal(r.code, 0, r.err)
  assert.equal((await loose(file, ['wait', ws.id, '--timeout', '20s'])).code, 0)
  // outside its scopes: refused, saying which scope it takes
  const shell = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const no: [string[], RegExp][] = [
    [['rm', ws.id], /can't call wsRm: that takes the remove scope \(it has create, send\)/],
    [['tab', ws.id, '--cmd', 'touch pwned'], /can't start a command of its own \(--cmd, or a command profile\): that takes the cmd scope/],
    [['new', p.id, '--name', 'y', '--perm', 'bypassPermissions', '--prompt', 'x'], /can't start an agent that never asks \(bypass permissions, or approvals off\) or outside its sandbox: that takes the yolo scope/],
    [['new', p.id, '--name', 'y2', '--preset', 'yolo', '--prompt', 'x'], /that takes the yolo scope/],
    [['send', `${ws.id}/${shell}`, 'ls'], /can't send to .*, a terminal: that takes the cmd scope/],
    [['send', ws.id, '!rm -rf .'], /can't send a ! line/],
    [['preset', 'add', 'x', '--agent', 'claude'], /no trusted client can/],
  ]
  for (const [args, why] of no) assert.match((await loose(file, args)).err, why, args.join(' '))
  assert.ok(!existsSync(join(ws.path, 'pwned')))
  assert.ok(!(await rig.rpc('state')).workspaces.some((w: any) => w.id === 'y' || w.id === 'y2'))
  assert.match(rig.out, /client Grok Bot: wsRm \(id \S+\) refused: Grok Bot can't call wsRm/)

  // laki mcp with its token: only its tools, new_workspace and send work, the others refused
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'laki_new_workspace', arguments: { project: p.id, name: 'from-mcp', prompt: 'hi there', group: 'Implementation' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'laki_send', arguments: { target: ws.id, text: 'and now?' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'laki_archive', arguments: { ws: ws.id } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'laki_state', arguments: {} } },
  ]
  r = await loose(file, ['mcp'], msgs.map(m => JSON.stringify(m)).join('\n') + '\n')
  const res = Object.fromEntries(r.out.trim().split('\n').map(l => JSON.parse(l)).filter(m => m.id).map(m => [m.id, m]))
  assert.deepEqual(res[2].result.tools.map((x: any) => x.name).sort(), ['laki_ask_agent', 'laki_diff', 'laki_new_tab', 'laki_new_workspace', 'laki_screen', 'laki_send', 'laki_state', 'laki_wait'])
  assert.equal(res[3].result.isError, undefined, res[3].result.content[0].text)
  assert.equal(res[4].result.isError, undefined, res[4].result.content[0].text)
  assert.match(res[5].result.content[0].text, /laki_archive isn't one of this client's tools/)
  assert.equal(res[6].result.isError, undefined)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === 'from-mcp')?.client, 'Grok Bot')

  // its token read by an agent in its tab: that agent's call (S12's rule), not the client's
  const out = join(rig.home, 'agent-out')
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run curl -s -H 'Authorization: Bearer ${token}' --data '{"method":"settingsSet","params":{"nextPrompt":true}}' http://127.0.0.1:${rig.info().port}/rpc > ${out}` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('error'), 'the agent ran it', 60000)
  assert.match(readFileSync(out, 'utf8'), /an agent can't change that setting/)
  // the CLI in a tab with a client token too: the tab's own token wins
  writeFileSync(join(rig.home, 'cmd.sh'), `LAKI_CLIENT_TOKEN_FILE=${c.file} ${node.join(' ')} ${cli} ls > ${out}2 2>&1\n`)
  await rig.rpc('send', { target: `${ws.id}/${shell}`, text: `sh ${join(rig.home, 'cmd.sh')}` })
  await until(() => existsSync(`${out}2`) && readFileSync(`${out}2`, 'utf8').includes('its own token is used'), 'the tab ran it', 30000)

  // rotated: the old token refused at once; revoked: refused loudly, never daemon.json's instead, no second daemon
  const rotated = rig.rpc('clientRotate', { id: 'grok-bot', scopes: 'send' })
  await app.call('clientAnswer', { req: (await seen(app, (e: any) => e.ev === 'clientAsk' && e.what === 'rotate', 'rotate asked')).req, allow: true })
  const c2 = await rotated
  assert.deepEqual(c2.scopes, ['send'])
  assert.match((await post('state', {})).error, /this client's token was revoked or isn't known/)
  assert.match((await loose(file, ['new', p.id, '--prompt', 'x'])).err, /can't call wsNew: that takes the create scope \(it has send\)/)
  const t2 = readFileSync(c2.file, 'utf8').trim()
  await rig.rpc('clientRm', { id: 'Grok Bot' })
  const pid = rig.info().pid
  r = await loose({ LAKI_CLIENT_TOKEN: t2 }, ['ls'])
  assert.equal(r.code, 1)
  assert.match(r.err, /this client's token was revoked or isn't known/)
  assert.equal(rig.info().pid, pid, 'no daemon started for it')
  assert.match((await loose({ LAKI_CLIENT_TOKEN_FILE: join(rig.home, 'nope') }, ['ls'])).err, /LAKI_CLIENT_TOKEN_FILE: can't read/)
  assert.deepEqual(await rig.rpc('clientList'), [])
  // no window: refused at once
  await new Promise(ok => (app.ws.once('close', ok), app.ws.close()))
  await until(() => rig.rpc('clientAdd', { label: 'Late' }).then(() => false, e => /Laki's window isn't open to allow Late/.test(e.message)), 'refused with no window', 20000) // its close handled
})

// review of #12: no scope answers an ask, a control key can't make a ! line, no force, no cloud workspace; Recording
// mode hides a private workspace by any id; a rotate revoked while it waits stays revoked
test('T1: a client never answers an ask, sends no control keys, forces nothing; Recording mode hides by id; a revoked rotate stays revoked', async t => {
  const rig = await fresh(t, { env: { LAKI_TERM_WAIT: '5000' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await connect(rig)
  const add = async (label: string, scopes?: string) => {
    const made = rig.rpc('clientAdd', { label, ...(scopes && { scopes }) })
    await app.call('clientAnswer', { req: (await seen(app, (e: any) => e.ev === 'clientAsk' && e.what === 'add' && e.label === label, `${label} asked`)).req, allow: true })
    const token = readFileSync((await made).file, 'utf8').trim()
    return async (method: string, params: object) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) })).json()
  }
  const grok = await add('Grok Bot')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  const target = `${ws.id}/${tab}`
  await until(async () => (await rig.screen(target)).includes('> '), 'its prompt')
  // a ! line however it's dressed: refused, nothing run
  for (const text of ['\x01!touch pwned', '\x1b!touch pwned', '\x9b!touch pwned']) assert.match((await grok('send', { target, text })).error, /Grok Bot can't send editing keys into .*: that takes the cmd scope/, JSON.stringify(text))
  assert.match((await grok('send', { target, text: '!touch pwned' })).error, /can't send a ! line/)
  // its agent asks (a permission menu): a send is refused, the menu stays, nothing picked; when_idle queues it for after
  await rig.rpc('send', { target, text: 'menu' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab).status === 'waiting', 'its menu')
  assert.match((await grok('send', { target, text: 'go on' })).error, /is asking the user something: only they answer it \(or send with when_idle\)/)
  assert.match((await grok('send', { target, text: 'go on', steer: true })).error, /is asking the user something/)
  assert.equal((await grok('send', { target, text: 'after', whenIdle: true })).result.queued, 1)
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === tab).status, 'waiting')
  assert.ok(!(await rig.screen(target)).includes('picked:'), 'no option picked')
  assert.ok(!existsSync(join(ws.path, 'pwned')))
  // no force, whatever its scopes; no cloud workspace
  const shipper = await add('Shipper', 'create,ship,remove,cmd,send')
  assert.match((await shipper('prAct', { ws: ws.id, act: 'merge', force: true })).error, /Shipper can't override a gate or the secret check: no trusted client can/)
  assert.match((await shipper('wsRm', { id: ws.id, force: true })).error, /can't override a gate/)
  assert.match((await shipper('wsNew', { project: p.id, name: 'cloud', codespace: '' })).error, /can't start a cloud workspace/)
  // Recording mode: a private workspace is none to it, by any id, in a missing one's words
  const hid = await rig.rpc('wsNew', { project: p.id, kind: 'local', name: 'hidden' })
  const htab = (await rig.rpc('tabNew', { ws: hid.id, kind: 'shell' })).id
  await rig.rpc('wsSet', { id: hid.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  assert.ok(!JSON.stringify((await grok('state', {})).result).includes(hid.id), 'not in its state')
  const said: [string, object][] = [['screen', { target: `${hid.id}/${htab}` }], ['screen', { target: htab }], ['send', { target: hid.id, text: 'hi' }], ['diff', { ws: hid.id }], ['wsStat', { ws: hid.id }], ['wsPeek', { id: hid.id }], ['tabNew', { ws: hid.id, preset: 'claude' }]]
  for (const [m, params] of said) assert.equal((await grok(m, params)).error, `no workspace ${m === 'screen' && !(params as any).target.includes('/') ? htab : hid.id}`, m)
  assert.equal((await grok('wsStat', { ws: 'nope' })).error, 'no workspace nope', 'a missing one: the same words')
  // what the other scopes name a workspace in: the same words (a client with remove, ship and cmd)
  const scoped: [string, object][] = [['wsPeek', { id: hid.id, ws: ws.id }], ['wsArchive', { id: hid.id, ws: ws.id }], ['wsRm', { id: hid.id, ws: ws.id }], ['wsArchive', { id: hid.id }], ['wsRm', { id: hid.id }], ['ship', { ws: hid.id, message: 'x' }], ['prAct', { ws: hid.id, act: 'draft' }], ['run', { ws: hid.id, script: 'run' }], ['send', { target: `${hid.id}/${htab}`, text: 'ls' }]]
  for (const [m, params] of scoped) assert.equal((await shipper(m, params)).error, `no workspace ${hid.id}`, m)
  // a private project: none for a new workspace either
  await rig.rpc('projectSet', { id: p.id, private: true })
  assert.equal((await shipper('wsNew', { project: p.id, prompt: 'x' })).error, `no project ${p.id}`)
  await rig.rpc('projectSet', { id: p.id, private: false })
  await rig.rpc('settingsSet', { recording: false })
  assert.equal((await grok('wsPeek', { id: hid.id })).error, undefined, 'shown again')
  // with cmd, a terminal is a target, but not while the agent running in it asks (claude typed in a shell tab)
  const sh = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const shTarget = `${ws.id}/${sh}`
  assert.equal((await shipper('send', { target: shTarget, text: 'echo hi' })).error, undefined, 'a terminal: fine with cmd')
  await until(async () => /\nhi\n/.test(await rig.screen(shTarget)), 'its echo') // typed and run before the next keys
  // a claude typed there, at its permission menu as the real one draws it (its cursor hidden: askOf's rule); any key picks
  const bin = join(rig.home, 'shellbin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node\nprocess.stdout.write('\\x1b[?25lBash command\\r\\n\\r\\n  rm -rf build\\r\\n\\r\\nDo you want to proceed?\\r\\n❯ 1. Yes\\r\\n  2. No\\r\\n')\nprocess.stdin.setRawMode(true)\nprocess.stdin.once('data', d => (process.stdout.write('\\x1b[?25hpicked: ' + JSON.stringify(String(d)) + '\\r\\n'), process.exit(0)))\n`, { mode: 0o755 })
  await rig.rpc('input', { tab: sh, data: `${join(bin, 'claude')}\r` })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === sh).runs === 'claude', 'claude running in the shell tab')
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === sh).status === 'waiting', 'its menu in the shell tab')
  assert.match((await shipper('send', { target: shTarget, text: 'go on' })).error, /is asking the user something: only they answer it/)
  assert.ok(!(await rig.screen(shTarget)).includes('picked:'), 'nothing picked in the shell tab')
  // a rotate whose client is revoked while it waits for Allow: revoked it stays
  const rotated = rig.rpc('clientRotate', { id: 'shipper' }).catch(e => e)
  const ask: any = await seen(app, (e: any) => e.ev === 'clientAsk' && e.what === 'rotate' && e.label === 'Shipper', 'the rotate asked')
  await rig.rpc('clientRm', { id: 'shipper' })
  await app.call('clientAnswer', { req: ask.req, allow: true })
  assert.match(String(await rotated), /Shipper was revoked while its new token waited for Allow/)
  assert.deepEqual((await rig.rpc('clientList')).map((c: any) => c.id), ['grok-bot'])
})

// each scope: the same call allowed with it, refused without it naming it (review of #12: a test per scope)
test('T1: each scope lifts its own refusal: create, send, cmd, yolo, remove, ship; --projects keeps it to its own', async t => {
  const rig = await fresh(t, { env: { LAKI_TERM_WAIT: '5000' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await connect(rig)
  const add = async (label: string, scopes: string) => {
    const made = rig.rpc('clientAdd', { label, scopes })
    await app.call('clientAnswer', { req: (await seen(app, (e: any) => e.ev === 'clientAsk' && e.label === label, `${label} asked`)).req, allow: true })
    const token = readFileSync((await made).file, 'utf8').trim()
    return async (method: string, params: object) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) })).json()
  }
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await until(async () => (await rig.screen(`${ws.id}/${tab}`)).includes('> '), 'its prompt')
  const shell = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const spare = async (name: string) => (await rig.rpc('wsNew', { project: p.id, kind: 'local', name, another: true })).id
  // [scope, the other scopes it needs, the call]: refused without the scope (naming it), not refused by the gate with it
  const rows: [string, string, string, () => Promise<object>][] = [
    ['create', '', 'wsNew', async () => ({ project: p.id, name: 'made', preset: 'claude', prompt: 'hi' })],
    ['send', '', 'send', async () => ({ target: `${ws.id}/${tab}`, text: 'hello' })],
    ['cmd', 'create', 'tabNew', async () => ({ ws: ws.id, cmd: 'true' })],
    ['cmd', 'send', 'send', async () => ({ target: `${ws.id}/${shell}`, text: 'true' })],
    ['yolo', 'create', 'wsNew', async () => ({ project: p.id, name: `y${Math.random().toString(36).slice(2, 6)}`, preset: 'claude', perm: 'bypassPermissions', prompt: 'hi' })],
    ['remove', '', 'wsArchive', async () => ({ id: await spare(`a${Math.random().toString(36).slice(2, 6)}`) })],
    ['ship', '', 'prAct', async () => ({ ws: ws.id, act: 'draft' })],
  ]
  for (const [i, [scope, also, method, params]] of rows.entries()) {
    const without = await add(`no-${i}`, also || (scope === 'remove' ? 'ship' : 'remove')) // '' would be the defaults
    const withIt = await add(`with-${i}`, [also, scope].filter(Boolean).join(','))
    assert.match(String((await without(method, await params())).error), new RegExp(`that takes the ${scope} scope`), `${method} without ${scope}`)
    const r = await withIt(method, await params())
    assert.doesNotMatch(String(r.error ?? ''), /scope|no trusted client can/, `${method} with ${scope}: ${r.error}`)
  }
  // kept to some projects (shown on the Allow card): another project's workspace, tab or new workspace refused; its state only its own
  const other = join(rig.home, 'other')
  mkdirSync(other)
  for (const a of [['init', '-q', '-b', 'main'], ['commit', '-q', '--allow-empty', '-m', 'init']]) execFileSync('git', a, { cwd: other, env: rig.env })
  const o = await rig.rpc('projectAdd', { path: other })
  const made = rig.rpc('clientAdd', { label: 'Kept', projects: o.name })
  const ask: any = await seen(app, (e: any) => e.ev === 'clientAsk' && e.label === 'Kept', 'Kept asked')
  assert.deepEqual(ask.projects, [o.name])
  await app.call('clientAnswer', { req: ask.req, allow: true })
  const kept = (await made) as { projects: string[]; file: string }
  assert.deepEqual(kept.projects, [o.id])
  const token = readFileSync(kept.file, 'utf8').trim()
  const as = async (method: string, params: object) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) })).json()
  const not = new RegExp(`Kept works in ${o.name} only, not ${p.name}`)
  for (const [m, params] of [['wsNew', { project: p.id, prompt: 'x' }], ['send', { target: `${ws.id}/${tab}`, text: 'hi' }], ['screen', { target: ws.id }], ['diff', { ws: ws.id }]] as [string, object][]) assert.match((await as(m, params)).error, not, m)
  const v = (await as('state', {})).result
  assert.deepEqual([v.projects.map((x: any) => x.id), v.workspaces.some((w: any) => w.project === p.id)], [[o.id], false])
  assert.equal((await as('wsNew', { project: o.id, name: 'theirs', preset: 'claude', prompt: 'hi' })).error, undefined)
  // the workspace a call acts on is the one checked: a ws of its own project beside another's id is no decoy (review)
  const keeper = rig.rpc('clientAdd', { label: 'Keeper', scopes: 'create,send,remove', projects: o.id })
  await app.call('clientAnswer', { req: (await seen(app, (e: any) => e.ev === 'clientAsk' && e.label === 'Keeper', 'Keeper asked')).req, allow: true })
  const kt = readFileSync((await keeper).file, 'utf8').trim()
  const keep = async (method: string, params: object) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${kt}` }, body: JSON.stringify({ method, params }) })).json()
  const b = await spare('b-decoy')
  for (const m of ['wsPeek', 'wsArchive', 'wsRm']) assert.match((await keep(m, { id: b, ws: 'theirs' })).error, new RegExp(`Keeper works in ${o.name} only, not ${p.name}`), m)
  const bw = (await rig.rpc('state')).workspaces.find((w: any) => w.id === b)
  assert.ok(bw && !bw.archived, "the other project's workspace: neither archived nor gone")
  // a chat by its id (forkOf, resume): any project's, so never a client's, its own project's included
  for (const [m, params] of [['tabNew', { ws: 'theirs', preset: 'claude', forkOf: 'sess-any' }], ['wsNew', { project: o.id, forkOf: 'sess-any', prompt: 'x' }], ['tabNew', { ws: 'theirs', preset: 'claude', resume: 'sess-any' }]] as [string, object][])
    assert.match((await keep(m, params)).error, /Keeper can't fork or resume a chat by its id/, m)
})

