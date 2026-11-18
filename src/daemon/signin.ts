// A2, C6: an agent tab signed out. A turn that fails as signed out (claude's "Not logged in · Please run /login", an
// expired or revoked token; codex's 401; Cursor's ACP auth_required: acp.ts) marks the tab (rt.signedOut, the view's
// signedOut: the band over its box) and keeps the message it failed on. Sign in runs the agent's own login for that
// tab's account in a script tab of the "sign in" Terminals workspace (its exit says how it went: Open again runs it
// again). A sign-in that takes, there or anywhere else (claude's and codex's credentials for that account changed,
// looked at every 5 s while a tab waits; the login tab ending well), restarts every tab waiting on that account (its chat
// resumes) and sends its message. Auto fallback comes first: an account after this one in the agent's fallback list
// takes the tab and the message instead.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isAccountAgent, type SignedOutView, type Tab } from '../shared/types.ts'
import { CURSOR, isCursor } from '../shared/install.ts'
import { accountFor, accountIds, accountNamed, accounts, loginCmd } from './accounts.ts'
import { changed, presetOf, quickNew, rt, rtOf, save, sessions, spawnTab, state, tabAccount, typeInto, whenPrompt, wsLog } from './core.ts'
import { claudeCred } from './usage.ts'

export type SignedOut = { agent: 'claude' | 'codex' | 'cursor'; step: SignedOutView['step']; account?: string; text?: string; mark?: string; login?: string; at: number } // mark: its credentials as they were ('': none; unset: not read yet); login: the script tab running its login
const NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' }

// words of a failed turn that mean signed out (its error, its last answer; codex's screen)
const OUT = /not logged in|please run \/login|run \/login|invalid api key|oauth token (?:has )?(?:expired|been revoked)|token (?:has )?(?:expired|been revoked)|authentication_(?:error|failed)|401 unauthorized|unauthorized:? .*(?:token|auth)|please (?:re-?)?authenticate|codex login|sign in again|log in again|refresh token (?:was )?(?:expired|revoked|invalid|rejected)/i
// a turn that didn't fail (claude's short answer): only claude's own refusal lines, never words an answer may use
const SAID = /not logged in · please run \/login|invalid api key · please run \/login|oauth token has expired/i
export const signedOutIn = (text: string, strict = false) => (strict ? SAID : OUT).test(text)

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
// the account's credentials, as a fingerprint ('': none): claude's Keychain item or file, codex's auth.json
async function credOf(agent: 'claude' | 'codex', account?: string): Promise<string> {
  const d = accountNamed(account)?.dir
  try {
    if (agent === 'claude') return (c => (c ? hash(`${c.accessToken}:${c.expiresAt ?? ''}`) : ''))(await claudeCred(d))
    const a = JSON.parse(readFileSync(join(d ?? (process.env.CODEX_HOME || join(homedir(), '.codex')), 'auth.json'), 'utf8'))
    const t = a?.tokens?.access_token ?? a?.OPENAI_API_KEY
    return typeof t === 'string' && t ? hash(t) : ''
  } catch {
    return ''
  }
}

// a claude or codex turn that ended: signed out? (core's hook, at a failed turn's end and codex's every end) Auto
// fallback first; else the band, with the message it failed on
export function turnSignedOut(tab: Tab, text: string, strict = false): boolean {
  const agent = tab.preset
  if ((agent !== 'claude' && agent !== 'codex') || !signedOutIn(text, strict)) return false
  if (state.workspaces.find(w => w.id === tab.workspace)?.host) return false // an SSH host's sign-in is that machine's: an API error there
  const r = rtOf(tab.id)
  const account = accountFor(tab, presetOf(tab)?.account)
  const msg = r.asked?.trim() || undefined
  // the accounts it went on from lately: not again (two signed out would hand it back and forth)
  const was = fell.get(tab.id)
  const tried = [...(was && Date.now() - was.at < 10 * 60_000 ? was.ids : []), account ?? '']
  if (fallBack(tab, agent, account, msg, tried)) {
    fell.set(tab.id, { at: Date.now(), ids: tried })
    return true
  }
  if (r.signedOut?.step === 'out' || r.signedOut?.step === 'opened') return true // told already: the same account still
  r.signedOut = { agent, step: 'out', account, text: msg, at: Date.now() }
  void credOf(agent, account).then(m => r.signedOut && r.signedOut.mark === undefined && (r.signedOut.mark = m))
  wsLog({ id: tab.workspace }, `${tab.name}: ${NAMES[agent]} is signed out${account && accountNamed(account) ? ` (${accountNamed(account)!.name})` : ''}`)
  watch()
  changed()
  return true
}

// an ACP agent's start that needs a sign-in (acp.ts): Cursor's, whose login Laki knows; the message typed meanwhile
export function acpSignedOut(tab: string, text?: string): boolean {
  const t = state.tabs.find(x => x.id === tab)
  if (!t || !isCursor(presetOf(t) ?? { cmd: t.cmd, acp: t.preset === 'acp' })) return false
  const r = rtOf(tab)
  r.signedOut = { ...r.signedOut, agent: 'cursor', step: r.signedOut?.step === 'opened' ? 'opened' : 'out', text: text?.trim() || r.signedOut?.text, at: r.signedOut?.at ?? Date.now() }
  changed()
  return true
}
// a message typed into an ACP tab that waits for its sign-in: it goes once it's in
export const acpWaiting = (tab: string, text: string) => (r => !!r?.signedOut && ((r.signedOut.text = text.trim() || r.signedOut.text), changed(), true))(rt.get(tab))

// Auto fallback (settings.limitFallback): the next account in the agent's list after this one, not one it left signed
// out lately (tried), takes it and the message
const fell = new Map<string, { at: number; ids: string[] }>() // by tab. ponytail: a closed tab's stays (a few ids)
function fallBack(tab: Tab, agent: 'claude' | 'codex', here: string | undefined, msg: string | undefined, tried: string[]): boolean {
  const order = (x => (Array.isArray(x) ? x.filter((id): id is string => typeof id === 'string') : []))(state.settings?.limitFallback?.[agent])
  const ids = accountIds(agent)
  const from = order.indexOf(here ?? '')
  const next = [...order.slice(from + 1), ...order.slice(0, Math.max(from, 0))].find(id => id !== here && ids.includes(id) && !tried.includes(id))
  if (!next || state.workspaces.find(w => w.id === tab.workspace)?.host) return false
  try {
    tabAccount({ tab: tab.id, account: next })
  } catch {
    return false
  }
  const name = (id?: string) => accounts().find(a => a.id === id)?.name ?? 'Default'
  rtOf(tab.id).last = `Signed out on ${name(here)}: it goes on on ${name(next)}.`
  wsLog({ id: tab.workspace }, `${tab.name}: signed out on ${name(here)}; goes on on ${name(next)}`)
  goOn(tab, msg)
  return true
}

// its session (new, or restarted) at its prompt: the message typed in
function goOn(tab: Tab, msg?: string) {
  const s = sessions.get(tab.id)
  if (s && msg) whenPrompt(s, () => (typeInto(s, msg), (rtOf(tab.id).status = 'running'), changed()))
}

// the band's buttons: open (Sign in, Open again: its login in a script tab), send (Send again: restart and send, as if in),
// dismiss (the band goes, the message with it)
export async function signIn(p: { tab: string; act?: 'open' | 'send' | 'dismiss' }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) throw new Error(`no tab ${p.tab}`)
  const r = rt.get(tab.id)
  const o = r?.signedOut
  if (!o) throw new Error(`${tab.name} isn't waiting for a sign-in`)
  if (p.act === 'dismiss') return void ((r!.signedOut = undefined), changed())
  if (p.act === 'send') return void signedIn(tab, o, true)
  const cmd = o.agent === 'cursor' ? `${CURSOR.cmd.split(' ')[0]} login` : loginCmd(o.account ?? '', o.agent)
  let ws = state.workspaces.find(w => w.name === 'sign in' && w.term && !w.archived)
  if (!ws) {
    ws = await quickNew({ kind: 'shells' })
    ws.name = 'sign in'
  }
  // a script tab: its exit code says whether the login took
  const t: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name: `sign in ${NAMES[o.agent]}`, kind: 'script', cmd }
  state.tabs.push(t)
  save()
  spawnTab(t, { cmd })
  o.login = t.id
  o.step = 'opened'
  watch()
  changed()
  return { ws: ws.id, tab: t.id, cmd }
}

// signed in: every tab waiting on that agent and account goes on (restarted, its chat resumed; its message sent)
function signedIn(tab: Tab, o: SignedOut, one = false) {
  for (const t of one ? [tab] : state.tabs.filter(x => (y => y && y.agent === o.agent && y.account === o.account && y.step !== 'in')(rt.get(x.id)?.signedOut))) {
    const r = rtOf(t.id)
    const msg = r.signedOut?.text
    r.signedOut = { ...r.signedOut!, step: 'in' }
    wsLog({ id: t.workspace }, `${t.name}: signed in${msg ? ', its message sent again' : ''}`)
    spawnTab(t, { resume: true })
    if (o.agent === 'cursor') {
      if (msg) sessions.get(t.id)?.write(`\x1b[200~${msg}\x1b[201~\r`) // ACP: pasted (its lines one prompt), it waits for its session
    } else goOn(t, msg)
    setTimeout(() => r.signedOut?.step === 'in' && ((r.signedOut = undefined), changed()), process.env.LAKI_SIGNIN_MS ? 1500 : 8000) // "Signed in · sending your message", then gone (tests': sooner)
  }
  changed()
}

// every 5 s while a tab waits: its account's credentials changed (claude, codex), or its login tab ended well
let timer: NodeJS.Timeout | undefined
function watch() {
  timer ??= setInterval(() => void signTick(), Number(process.env.LAKI_SIGNIN_MS) || 5000)
}
let ticking = false // one look at a time: two would both see the sign-in and send the message twice
export async function signTick() {
  if (ticking) return
  ticking = true
  try {
    await look()
  } finally {
    ticking = false
  }
}
async function look() {
  const waiting = state.tabs.filter(t => (o => o && o.step !== 'in')(rt.get(t.id)?.signedOut))
  if (!waiting.length) return void (timer && (clearInterval(timer), (timer = undefined)))
  const done = new Set<string>()
  for (const t of waiting) {
    const o = rt.get(t.id)?.signedOut
    if (!o || o.step === 'in' || done.has(`${o.agent}:${o.account}`)) continue
    const s = o.login ? sessions.get(o.login) : undefined
    let ok = !!s?.exited && s.exitCode === 0
    if (s?.exited && s.exitCode !== 0 && o.step === 'opened') ((o.step = 'out'), changed()) // its login failed or was closed: Sign in again
    if (!ok && o.agent !== 'cursor' && o.mark !== undefined) ok = (m => m !== '' && m !== o.mark)(await credOf(o.agent, o.account)) // another than the one it failed on
    if (ok) {
      done.add(`${o.agent}:${o.account}`)
      if (o.login) o.login = undefined
      signedIn(t, o)
    }
  }
}

// the view's
export const signedOutView = (r?: { signedOut?: SignedOut }): SignedOutView | undefined => {
  const o = r?.signedOut
  if (!o) return
  const acct = isAccountAgent(o.agent) && o.account ? accountNamed(o.account)?.name : undefined
  return { agent: NAMES[o.agent], step: o.step, ...(acct && { account: acct }), ...(o.text && { waiting: true }), at: o.at }
}
