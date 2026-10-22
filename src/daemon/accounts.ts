// Accounts: claude's and codex's other sign-ins (Settings › Agents & profiles). Each is a folder Laki makes in
// <data>/accounts, given to the agent as CLAUDE_CONFIG_DIR or CODEX_HOME. What the agent keeps there besides its
// sign-in links to its own folder (SHARED: settings, skills, plugins, chats), so a chat resumes on any account. The
// agent's own sign-in is HOME_ACCOUNT: no env at all (CLAUDE_CONFIG_DIR set to ~/.claude would read another Keychain
// item).
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readJson } from '../shared/conn.ts'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { type Account, ACCOUNT_AGENTS, type AccountAgent, type AccountView, AGENT_NAMES, HOME_ACCOUNT, isAccountAgent, type Tab } from '../shared/types.ts'
import { changed, dir, isLive, q, save, state } from './core.ts'
import { claudeCred, keychainService, type Who } from './usage.ts'

export const ENV: Record<AccountAgent, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }
// the agent's own folder: what a session without an account's env uses
export const homeDir = (agent: AccountAgent) => process.env[ENV[agent]] || join(homedir(), agent === 'claude' ? '.claude' : '.codex')

// what an account shares with the agent's own folder: folders (made there when missing, so both write to one) and
// files (linked once they're there). Claude: chats (projects: --resume) and what goes with them, settings, skills,
// plugins, commands, agents, hooks, CLAUDE.md; Codex: chats (sessions: resume), config.toml, skills, prompts, AGENTS.md.
// ponytail: claude's history.jsonl (the ↑ prompt history) can't be a link (its reader refuses one): per account
const SHARED: Record<AccountAgent, { dirs: string[]; files: string[] }> = {
  claude: { dirs: ['projects', 'file-history', 'todos', 'plans', 'skills', 'plugins', 'commands', 'agents', 'hooks', 'output-styles'], files: ['settings.json', 'CLAUDE.md', 'keybindings.json'] },
  codex: { dirs: ['sessions', 'archived_sessions', 'skills', 'prompts'], files: ['config.toml', 'AGENTS.md'] },
}

const there = (p: string) => !!lstatSync(p, { throwIfNoEntry: false }) // a link too, even a broken one

// links what's shared into an account's folder: at its making, and at each start (a file made at home since). Claude's
// missing folders are made in ~/.claude first (both write to one); ~/.codex is never written (AGENTS.md): only what's there
function linkShared(a: Account) {
  const home = homeDir(a.agent)
  const { dirs, files } = SHARED[a.agent]
  for (const n of [...dirs, ...files]) {
    const to = join(home, n)
    const at = join(a.dir, n)
    if (there(at)) continue // its own (a file the agent made before it was shared), or linked already
    if (dirs.includes(n) && a.agent === 'claude') mkdirSync(to, { recursive: true })
    else if (!existsSync(to)) continue
    try {
      symlinkSync(to, at)
    } catch {} // ponytail: two starts at once: the other one linked it
  }
}

export const accounts = (agent?: AccountAgent): Account[] => (state.settings?.accounts ?? []).filter(a => !agent || a.agent === agent)
export const accountNamed = (id?: string) => accounts().find(a => a.id === id)
const ok = (agent: AccountAgent, id?: string) => (id && (id === HOME_ACCOUNT || accountNamed(id)?.agent === agent) ? id : undefined)

// the account a tab starts on: its own (kept from its first start), else its profile's, else the agent's default;
// one removed since: the agent's own. Not claude or codex: none
export function accountFor(t: Tab, profile?: string) {
  const agent = t.preset
  if (!isAccountAgent(agent)) return undefined
  return ok(agent, t.account) ?? ok(agent, profile) ?? ok(agent, state.settings?.accountUse?.[agent]) ?? HOME_ACCOUNT
}

// what a session on that account gets: its folder as the agent's config folder
export function accountEnv(id?: string): Record<string, string> {
  const a = accountNamed(id)
  if (!a) return {}
  mkdirSync(a.dir, { recursive: true, mode: 0o700 })
  linkShared(a)
  return { [ENV[a.agent]]: a.dir }
}

export function accountAdd(p: { agent?: string; name?: string }): Account {
  if (!isAccountAgent(p.agent)) throw new Error('accounts are for claude or codex')
  const name = String(p.name ?? '').trim().slice(0, 40) || `${AGENT_NAMES[p.agent]} ${accounts(p.agent).length + 2}`
  const id = randomBytes(4).toString('hex')
  const a: Account = { id, agent: p.agent, name, dir: join(dir, 'accounts', `${p.agent}-${id}`) }
  mkdirSync(a.dir, { recursive: true, mode: 0o700 })
  linkShared(a)
  // Claude's first start in a new folder asks for a theme and walks through its intro: done already, in your theme
  // (.claude.json is per account: its sign-in's name is there too)
  if (a.agent === 'claude') writeFileSync(join(a.dir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, ...(typeof ownClaude()?.theme === 'string' && { theme: ownClaude().theme }) }), { mode: 0o600, flag: 'wx' })
  state.settings = { ...state.settings, accounts: [...accounts(), a] }
  save()
  changed()
  return a
}

export function accountSet(p: { id: string; name?: string }) {
  const a = accountNamed(p.id)
  if (!a) throw new Error(`no account ${p.id}`)
  if (typeof p.name === 'string' && p.name.trim()) a.name = p.name.trim().slice(0, 40)
  save()
  changed()
  return a
}

// gone from the list, the profiles and the default; its folder (its sign-in and links: not what they point to) and
// Claude's Keychain item for it too. Tabs on it start on the agent's own next time (accountFor)
export function accountRm(p: { id: string }) {
  const a = accountNamed(p.id)
  if (!a) throw new Error(`no account ${p.id}`)
  // a session at work there would lose its folder and sign-in under it
  const on = state.tabs.filter(t => t.account === a.id && isLive(t))
  if (on.length) throw new Error(`${on.map(t => t.name).join(', ')} ${on.length > 1 ? 'run' : 'runs'} on ${a.name}: close ${on.length > 1 ? 'them' : 'it'} or restart ${on.length > 1 ? 'them' : 'it'} on another account first`)
  const s = state.settings!
  s.accounts = accounts().filter(x => x !== a)
  if (s.accountUse?.[a.agent] === a.id) delete s.accountUse[a.agent]
  for (const pr of s.presets ?? []) if (pr.account === a.id) delete pr.account
  if (resolve(a.dir).startsWith(join(dir, 'accounts') + sep)) rmSync(a.dir, { recursive: true, force: true }) // only one Laki made
  if (a.agent === 'claude') execFile('security', ['delete-generic-password', '-s', keychainService(a.dir)], () => {}) // none: fine
  save()
  changed()
}

// ---------- who each signs in as

// the agent's own .claude.json: in CLAUDE_CONFIG_DIR when the daemon has one, else ~/.claude.json
const ownClaude = () => readJson(process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'))
// a JWT's payload (Codex's id_token): its email and plan, nothing checked (it's the agent's own file)
const jwt = (t: unknown) => {
  try {
    return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

// the default account for new sessions: the one picked, unless removed since
export const accountUsed = (agent: AccountAgent) => ok(agent, state.settings?.accountUse?.[agent]) ?? HOME_ACCOUNT

// an account as the app shows it: who, which plan. Claude's from its .claude.json (the agent's own: ~/.claude.json),
// signed in when the usage reader finds its token; Codex's from auth.json
export async function accountView(agent: AccountAgent, id: string): Promise<AccountView> {
  const a = accountNamed(id)
  const d = a?.dir ?? homeDir(agent)
  const base = { id, agent, name: a?.name ?? 'Default', dir: d, default: accountUsed(agent) === id }
  if (agent === 'codex') {
    const auth = readJson(join(d, 'auth.json'))
    const claims = jwt(auth?.tokens?.id_token)
    const plan = claims?.['https://api.openai.com/auth']?.chatgpt_plan_type
    return { ...base, email: typeof claims?.email === 'string' ? claims.email : undefined, plan: typeof plan === 'string' ? plan : undefined, signedIn: !!(auth?.tokens?.access_token || auth?.OPENAI_API_KEY) }
  }
  const cfg = a ? readJson(join(d, '.claude.json')) : ownClaude()
  const cred = await claudeCred(a?.dir).catch(() => undefined)
  return { ...base, email: typeof cfg?.oauthAccount?.emailAddress === 'string' ? cfg.oauthAccount.emailAddress : undefined, plan: cred?.subscriptionType || undefined, signedIn: !!cred }
}
// whose limits the usage ring reads: every account, the agent's own first
export const usageWho = (): Who[] => ACCOUNT_AGENTS.flatMap(agent => accountIds(agent).map(id => ({ agent, account: id, name: accountNamed(id)?.name ?? 'Default', dir: accountNamed(id)?.dir, default: accountUsed(agent) === id })))
export const accountViews = () => Promise.all(ACCOUNT_AGENTS.flatMap(agent => accountIds(agent).map(id => accountView(agent, id))))

// every account of claude and codex, the agent's own first
export const accountIds = (agent: AccountAgent) => [HOME_ACCOUNT, ...accounts(agent).map(a => a.id)]

// the command that signs an account in, typed into a new terminal: the agent's own login, in its folder
export function loginCmd(id: string, agent: AccountAgent) {
  const a = accountNamed(id)
  const login = agent === 'claude' ? 'claude auth login' : 'codex login'
  return a ? `${ENV[a.agent]}=${q(a.dir)} ${login}` : login
}
