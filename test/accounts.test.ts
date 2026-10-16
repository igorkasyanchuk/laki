// Accounts (daemon/accounts.ts): claude's and codex's other sign-ins, each a folder with the agent's own settings and
// chats linked in; a tab keeps its account; Restart on another account; a profile's account, model and effort; limits
// per account; sign in; remove.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const service = (d: string) => `Claude Code-credentials-${createHash('sha256').update(d).digest('hex').slice(0, 8)}`

test('accounts: shared folder, a tab keeps its account, restart on another, profiles, who signs in, sign in, remove', async t => {
  const rig = await fresh(t)
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, '.claude', 'settings.json'), '{}')
  const a = await rig.rpc('accountAdd', { agent: 'claude', name: 'Work' })
  await assert.rejects(rig.rpc('accountAdd', { agent: 'gemini' }), /claude or codex/)
  // its folder in the data dir: the agent's own chats (made there) and settings linked, what isn't there not
  assert.equal(a.dir, join(rig.data, 'accounts', `claude-${a.id}`))
  assert.equal(readlinkSync(join(a.dir, 'projects')), join(rig.home, '.claude', 'projects'))
  assert.ok(existsSync(join(rig.home, '.claude', 'projects')))
  assert.equal(readlinkSync(join(a.dir, 'settings.json')), join(rig.home, '.claude', 'settings.json'))
  assert.ok(!existsSync(join(a.dir, 'CLAUDE.md')))
  assert.deepEqual(JSON.parse(readFileSync(join(a.dir, '.claude.json'), 'utf8')), { hasCompletedOnboarding: true }) // no intro at its first start
  // settingsSet never takes accounts (an import's folders): Laki's own methods do
  await rig.rpc('settingsSet', { accounts: [{ id: 'x', agent: 'claude', name: 'X', dir: '/tmp' }] })
  assert.deepEqual((await rig.rpc('state')).settings.accounts.map((x: any) => x.id), [a.id])

  // a profile on it, with a model and an effort: its tabs start in its folder with those flags
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'work', agent: 'claude', account: a.id, model: 'opus', effort: 'high' }] })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'work', prompt: 'hi' })
  const tab = await rig.tab(ws.id)
  const runs = () => rig.fakeLog().filter(l => l.bin === 'claude' && l.tab === tab.id)
  await until(async () => (await rig.tab(ws.id)).resumeId, 'started')
  assert.equal(runs()[0].env.CLAUDE_CONFIG_DIR, a.dir)
  assert.match(runs()[0].args.join(' '), /--model opus --effort high/)
  assert.equal((await rig.tab(ws.id)).account, a.id)
  // the plain profile: the agent's default, its own (no env); then Work as the default
  const plain = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await rig.rpc('settingsSet', { accountUse: { claude: a.id } })
  const later = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(() => [plain.id, later.id].every(id => rig.fakeLog().some(l => l.tab === id)), 'both started') // under load either may come first
  assert.equal(rig.fakeLog().find(l => l.tab === plain.id).env.CLAUDE_CONFIG_DIR, undefined)
  assert.equal(rig.fakeLog().find(l => l.tab === later.id).env.CLAUDE_CONFIG_DIR, a.dir)
  await rig.rpc('settingsSet', { accountUse: {} })

  // Restart on another account: the same chat, now on the agent's own sign-in; one it doesn't have is refused
  const chat = (await rig.tab(ws.id)).resumeId
  await assert.rejects(rig.rpc('tabAccount', { tab: tab.id, account: 'nope' }), /no claude account nope/)
  await assert.rejects(rig.rpc('tabAccount', { tab: plain.id.replace(/./g, 'z'), account: 'home' }))
  await rig.rpc('tabAccount', { tab: tab.id, account: 'home' })
  await until(() => runs().length === 2, 'restarted')
  assert.equal(runs()[1].env.CLAUDE_CONFIG_DIR, undefined)
  assert.match(runs()[1].args.join(' '), new RegExp(`--resume ${chat}`))

  // who each signs in as: Work's Keychain item (its folder's name) and its .claude.json; the default marked
  let views = await rig.rpc('accounts')
  assert.deepEqual(views.map((v: any) => [v.agent, v.id, v.name, v.signedIn, v.default]), [
    ['claude', 'home', 'Default', false, true],
    ['claude', a.id, 'Work', false, false],
    ['codex', 'home', 'Default', false, true],
  ])
  // the limits: one row per account, the default marked (asked before Work has a token: no server is asked)
  const u = await rig.rpc('usage')
  assert.deepEqual(u.filter((x: any) => x.agent === 'claude').map((x: any) => [x.account, x.name, x.default]), [['home', 'Default', true], [a.id, 'Work', false]])

  writeFileSync(join(rig.home, `keychain-${service(a.dir)}`), JSON.stringify({ claudeAiOauth: { accessToken: 'w', subscriptionType: 'max' } }))
  writeFileSync(join(a.dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'work@example.com' } }))
  await rig.rpc('accountSet', { id: a.id, name: 'Day job' })
  views = await rig.rpc('accounts')
  assert.deepEqual(views[1], { id: a.id, agent: 'claude', name: 'Day job', dir: a.dir, email: 'work@example.com', plan: 'max', signedIn: true, default: false })
  // sign in: a new terminal with the agent's login typed and run in the account's folder
  const sw = await rig.rpc('accountLogin', { id: a.id, agent: 'claude' })
  assert.equal(sw.name, 'sign in: Day job')
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.join(' ') === 'auth login' && l.env.CLAUDE_CONFIG_DIR === a.dir), 'claude auth login run')

  // remove: refused while a session runs on it; then gone from the list, the profile and its folder (the links only),
  // and its Keychain item
  await assert.rejects(rig.rpc('accountRm', { id: a.id }), /runs on Day job/)
  await rig.rpc('tabClose', { id: later.id })
  await rig.rpc('accountRm', { id: a.id })
  assert.ok(!existsSync(a.dir))
  assert.ok(existsSync(join(rig.home, '.claude', 'settings.json')))
  await until(() => !existsSync(join(rig.home, `keychain-${service(a.dir)}`)), 'its Keychain item deleted')
  const s = (await rig.rpc('state')).settings
  assert.deepEqual(s.accounts, [])
  assert.equal(s.presets[1].account, undefined)
})

test("accounts: codex's in CODEX_HOME with its config and chats linked, who from auth.json", async t => {
  const rig = await fresh(t)
  mkdirSync(join(rig.home, '.codex'))
  writeFileSync(join(rig.home, '.codex', 'config.toml'), 'model = "x"\n')
  mkdirSync(join(rig.home, '.codex', 'sessions'))
  const a = await rig.rpc('accountAdd', { agent: 'codex', name: 'Team' })
  assert.equal(readlinkSync(join(a.dir, 'sessions')), join(rig.home, '.codex', 'sessions'))
  assert.equal(readlinkSync(join(a.dir, 'config.toml')), join(rig.home, '.codex', 'config.toml'))
  assert.ok(!existsSync(join(rig.home, '.codex', 'prompts'))) // ~/.codex is never written: only what's there is linked
  // signed in: its id_token says who and which plan
  const jwt = `x.${Buffer.from(JSON.stringify({ email: 'team@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'team' } })).toString('base64url')}.y`
  writeFileSync(join(a.dir, 'auth.json'), JSON.stringify({ tokens: { access_token: 't', id_token: jwt } }))
  const v = (await rig.rpc('accounts')).find((x: any) => x.id === a.id)
  assert.deepEqual([v.email, v.plan, v.signedIn], ['team@example.com', 'team', true])
  // the default for new sessions: a codex tab starts there
  await rig.rpc('settingsSet', { accountUse: { codex: a.id } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex started')
  assert.equal(rig.fakeLog().find(l => l.bin === 'codex').env.CODEX_HOME, a.dir)
  assert.equal((await rig.tab(ws.id)).account, a.id)
})
