// A2: an agent signed out mid-turn: the band, Sign in (its own login in a terminal tab), the message sent once it's in;
// a sign-in done elsewhere noticed. C6: Cursor, a ready-made ACP profile: its models and effort before the first
// message, set over ACP; signed out until cursor-agent login; its chat loaded after a restart (test/fakes/cursor-agent)
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { signedOutIn } from '../src/daemon/signin.ts'
import { connect, fresh, seen, until, sleep } from './helpers.ts'

test('A2: the words that mean signed out (claude, codex), and ones that don\'t', () => {
  for (const s of ['Not logged in · Please run /login', 'Invalid API key · Please run /login', 'OAuth token has expired. Please obtain a new token or refresh your existing token.', 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', 'ChatGPT account ID not available, please re-run codex login', 'OAuth refresh token was rejected: sign in again'])
    assert.ok(signedOutIn(s), s)
  for (const s of ['API Error: 529 Overloaded', "You've hit your usage limit. Try again in 2 hours.", 'Added a login page with a form', 'Done: tests pass'])
    assert.ok(!signedOutIn(s), s)
  // a turn that didn't fail: only claude's own lines
  assert.ok(signedOutIn('Not logged in · Please run /login', true))
  assert.ok(!signedOutIn('You will need to sign in again after the token rotates', true))
})

test('A2: signed out: the band keeps the message; Sign in runs claude auth login in a terminal tab, then the message goes; a sign-in elsewhere is noticed too', async t => {
  const rig = await fresh(t, { env: { LAKI_SIGNIN_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await connect(rig)
  t.after(() => app.close())
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'auth' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'its prompt')
  await rig.rpc('send', { target: tab, text: 'needlogin fix the header' })
  const out = await until(async () => (await rig.tab(ws.id)).signedOut, 'signed out')
  assert.deepEqual([out.agent, out.step, out.waiting], ['Claude Code', 'out', true])
  assert.equal((await rig.tab(ws.id)).failed, undefined, 'not an API error: no Continue')
  const told = await seen(app, (e: any) => e.ev === 'turn' && e.tab === tab && e.kind === 'signedout', 'told as signed out')
  assert.match(told.text, /^Signed out: sign in to Claude Code/)

  // Sign in: its own login in the "sign in" Terminals workspace; it ends well: restarted, its message sent again
  const r = await rig.rpc('signIn', { tab, act: 'open' })
  assert.equal(r.cmd, 'claude auth login')
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === r.ws).name, 'sign in')
  await until(async () => (await rig.tab(ws.id)).signedOut?.step === 'in', 'signed in')
  await until(async () => /needlogin fix the header/.test(await rig.rpc('screen', { target: tab })) && (await rig.tab(ws.id)).status === 'idle' && !(await rig.tab(ws.id)).failed, 'its message, sent again, answered')
  await assert.rejects(rig.rpc('signIn', { tab, act: 'open', from: { ws: ws.id, tab } }), /signing an agent in is yours/)

  // signed out again; a login in another terminal (its Keychain item written): every waiting tab goes on
  rmSync(join(rig.home, 'keychain'))
  await until(async () => !(await rig.tab(ws.id)).signedOut, 'the band gone')
  await rig.rpc('send', { target: tab, text: 'needlogin once more' })
  await until(async () => (await rig.tab(ws.id)).signedOut?.step === 'out', 'signed out again')
  await sleep(400) // its credentials (none) read first
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-elsewhere' } }))
  await until(async () => (await rig.tab(ws.id)).signedOut?.step === 'in', 'noticed')
  await until(async () => !(await rig.tab(ws.id)).signedOut && (await rig.tab(ws.id)).status === 'idle', 'sent, answered')
  // Dismiss drops the band
  rmSync(join(rig.home, 'keychain'))
  await until(async () => !(await rig.tab(ws.id)).signedOut, 'gone')
  await rig.rpc('send', { target: tab, text: 'needlogin and again' })
  await until(async () => (await rig.tab(ws.id)).signedOut?.step === 'out', 'out')
  await rig.rpc('signIn', { tab, act: 'dismiss' })
  assert.equal((await rig.tab(ws.id)).signedOut, undefined)
})

test('C6: Cursor: a ready-made ACP profile, its models and effort before the first message, Sign in, its chat loaded after a restart', async t => {
  const rig = await fresh(t, { env: { LAKI_SIGNIN_MS: '300', LAKI_MODELS_RETRY_MS: '200' } })
  const log = join(rig.data, 'acp.log')
  const got = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  // on PATH: in the profiles from the start
  const cur = (await rig.rpc('state')).presets.find((x: any) => x.name === 'cursor')
  assert.deepEqual(cur, { name: 'cursor', agent: 'command', cmd: 'cursor-agent acp', acp: true })
  await rig.rpc('presetSave', { name: 'cursor', set: { env: { FAKE_ACP_LOG: log } } })

  // its models before the first message: its configOptions' model select, thought_level's efforts each
  const models = await rig.rpc('agentModels', { agent: 'acp', preset: 'cursor' })
  assert.deepEqual(models, [], 'signed out: none said (asked again later)')

  // signed out: the band, the prompt kept; Sign in runs cursor-agent login, then the tab starts again and sends it
  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'cursor', prompt: 'add a footer', model: 'composer-2' })
  const tab = (await until(() => rig.tab(ws2.id))).id
  assert.equal((await rig.tab(ws2.id)).preset, 'acp')
  const out = await until(async () => (await rig.tab(ws2.id)).signedOut, 'signed out')
  assert.deepEqual([out.agent, out.step, out.waiting], ['Cursor', 'out', true])
  const r = await rig.rpc('signIn', { tab, act: 'open' })
  assert.equal(r.cmd, 'cursor-agent login')
  await until(async () => (await rig.rpc('chatRead', { tab })).said?.some((s: any) => s.who === 'agent' && s.text === 'cursor composer-2/medium: add a footer'), 'its message answered on its model')
  assert.ok(got().some(m => m.method === 'session/set_config_option' && m.params.configId === 'model' && m.params.value === 'composer-2'), 'the model set over ACP')

  // now signed in: the models and efforts it says
  const said = await until(async () => (l => (l.length ? l : undefined))(await rig.rpc('agentModels', { agent: 'acp', preset: 'cursor' }).catch(() => [])), 'its models', 15000)
  assert.deepEqual(said.map((m: any) => [m.id, m.name, m.efforts, !!m.def]), [['auto', 'Auto', ['low', 'medium', 'high'], true], ['composer-2', 'Composer 2', ['low', 'medium', 'high'], false], ['gpt-5', 'GPT-5', ['low', 'medium', 'high'], false]])
  // an effort it said: taken, set over ACP at the start
  const ws3 = await rig.rpc('wsNew', { project: p.id, preset: 'cursor', prompt: 'hello', model: 'gpt-5', effort: 'high' })
  const tab3 = (await until(() => rig.tab(ws3.id))).id
  await until(async () => (await rig.rpc('chatRead', { tab: tab3 })).said?.some((s: any) => s.text === 'cursor gpt-5/high: hello'), 'on gpt-5, high')

  // a restart (Enter on the ended tab after a stop; the daemon's is the same start): its chat loads, not a new one
  const sid = (await rig.rpc('state')).tabs.find((x: any) => x.id === tab3).resumeId
  assert.match(sid, /^cur-/)
  await rig.rpc('tabSleep', { tab: tab3 })
  await rig.rpc('tabWake', { tab: tab3 })
  await until(() => got().some(m => m.method === 'session/load' && m.params.sessionId === sid), 'session/load')
  const chat = await until(async () => (c => (c.said?.length >= 2 ? c : undefined))(await rig.rpc('chatRead', { tab: tab3 })), 'the chat replayed')
  assert.deepEqual(chat.said.slice(0, 2).map((s: any) => [s.who, s.text]), [['you', 'hello'], ['agent', 'cursor gpt-5/high: hello']])
  await rig.rpc('send', { target: tab3, text: 'more' })
  await until(async () => (await rig.rpc('chatRead', { tab: tab3 })).said?.some((s: any) => s.text === 'cursor gpt-5/high: more'), 'the same chat goes on')
  // a message of two lines: one prompt (pasted), not two
  await rig.rpc('send', { target: tab3, text: 'two\nlines' })
  await until(async () => (await rig.rpc('chatRead', { tab: tab3 })).said?.some((s: any) => s.text === 'cursor gpt-5/high: two\nlines'), 'one prompt')
})
