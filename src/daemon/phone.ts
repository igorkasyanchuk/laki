// phone pushes (push.ts builds them): a turn that waits or is done, a workflow's questions, and the taps that answer
// from the phone. core.ts imports it, and its users import it directly.

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { badgeOf } from '../shared/nextStep.ts'
import { answerOk, pushOn, type Tab, type Webhook, type Workspace } from '../shared/types.ts'
import { answered } from './askStreak.ts'
import { answer, changed, log, rtOf, save, sessions, state, view } from './core.ts'
import { dir } from './dir.ts'
import { stats } from './files.ts'
import { type Push, pushTo, replies, type Tap, tapOf, type Vapid, vapidNew, webPush } from './push.ts'
import { flowHooks } from './schedule.ts'
import { redact } from './share.ts'
import { tgAnswers, tgDone, tgOn, tgPush } from './telegram.ts'
import { register } from './ticks.ts'

// a push to your phone (push.ts, telegram.ts) for a turn that waits or is done: once per state change of a tab (pushed: what went
// since it last ran; view() clears it), never for a muted tab or workspace, nor a private one in Recording mode
// (hidden: a phone on the desk is on camera too). ponytail: a turn that starts and ends
// within the 30 ms before a view is built looks like the same one, and its end isn't pushed
export const pushed = new Map<string, string>()
export const hidden = (ws?: Workspace) => !!ws && !!state.settings?.recording && (!!ws.private || !!state.projects.find(p => p.id === ws.project)?.private)
// #1: where you are, by the app's powerMonitor (main's presence, every 15 s and as the Mac locks): at the Mac is unlocked
// with input in the last settings.pushIdle seconds (120). Nothing heard for a minute (the app quit, laki serve): away
let presence: { idle: number; locked: boolean; at: number } | undefined
export function presenceSet(p: { idle?: unknown; locked?: unknown }) {
  presence = { idle: Math.max(0, Number(p.idle) || 0), locked: p.locked === true, at: Date.now() }
  return { atMac: atMac() }
}
export const atMac = (now = Date.now()) => !!presence && now - presence.at < 60_000 && !presence.locked && presence.idle + (now - presence.at) / 1000 < (state.settings?.pushIdle ?? 120)
// Settings › Phone pushes › When I'm at the Mac: Hold pushes (unset) or Push anyway
const holding = () => state.settings?.pushAtMac !== 'push' && atMac()
// each tab's latest wait, numbered from one count for all (none comes twice): a held push for an earlier one is dropped,
// not sent for this one; the latest's timer takes its entry out
const waits = new Map<string, number>()
let waitN = 0
// U8: Do not disturb holds every push but an important workspace's ask (ask: a wait for you)
const quiet = (ws?: Workspace, ask = false) => (state.dnd?.until ?? 0) > Date.now() && !(ask && ws?.important)
// where a push goes: the webhook (Settings › Phone pushes) and Telegram (Settings › Telegram), each by its own When
// (any: a workflow's, remote access's: not a turn's); bell: T16's one-time bell, whatever they say. Telegram's Only when
// I ask (pushOff): none, but a bell and the workspace you talk to there: its asks and its turns' ends (ws: the push's)
type To = { hook?: Webhook; tg: boolean }
function to(kind: 'waiting' | 'done' | 'any', bell = false, ws?: string): To {
  const w = state.settings?.webhook
  const t = state.telegram
  const on = (waiting?: boolean, done?: boolean) => bell || kind === 'any' || (kind === 'waiting' ? waiting !== false : !!done)
  const asked = !t?.pushOff || bell || (kind !== 'any' && !!ws && t.focus === ws)
  return { hook: pushOn(w) && on(w.waiting, w.done === true) ? w : undefined, tg: tgOn() && asked && on(t?.waiting, t?.done !== false) }
}
// a push to each: buttons (a nonce, kept in awaiting with what it asks) where taps come back (ask), Telegram's message
// id kept with it for tgDone. tgTaps false: none on Telegram (remote access's Keep: never from Telegram)
function send(t: To, p: Push, ask?: Pick<Awaits, 'tab' | 'flow' | 'keep' | 'key'>, o: { ms?: number; what?: string; tgTaps?: boolean; tg?: Partial<Push> } = {}) {
  const hook = !!t.hook && hookAnswers(t.hook)
  const tg = t.tg && tgAnswers() && o.tgTaps !== false
  const nonce = ask && p.options?.length && (hook || tg) ? randomBytes(8).toString('hex') : undefined
  if (nonce) awaiting.set(nonce, { ...ask!, until: Date.now() + (o.ms ?? 864e5), hook, tg, push: p }), hook && listen(t.hook!)
  const what = o.what ?? p.tab
  if (t.hook) pushTo(t.hook, { ...p, ...(nonce && hook && { nonce, key: tapKey() }) }).catch(e => log(`push ${what}: ${e.message}`))
  if (t.tg)
    tgPush({ ...p, ...o.tg, ...(nonce && tg && { nonce }) }).then(
      msg => void (nonce && msg && (a => a && (a.msg = msg))(awaiting.get(nonce))),
      e => log(`telegram ${what}: ${e.message}`),
    )
}
// a muted workspace, or one of a muted project (Mute project)
const mutedWs = (ws?: Workspace) => !!ws && (!!ws.muted || !!state.projects.find(p => p.id === ws.project)?.muted)
export function phone(tab: Tab, kind: 'waiting' | 'done', text: string, bell = false) {
  const ws = state.workspaces.find(x => x.id === tab.workspace)
  if (quiet(ws, kind === 'waiting')) return // U8: Do not disturb: an important workspace's ask only
  const t = to(kind, bell, tab.workspace)
  if ((!t.hook && !t.tg) || pushed.get(tab.id) === kind || (!bell && (tab.muted || mutedWs(ws))) || hidden(ws)) return
  pushed.set(tab.id, kind)
  // #1: at the Mac a turn's end shows there only; an ask goes to the phone only if it still waits after pushAfter (you
  // answered it on the Mac meanwhile: dropped, never sent late). A bell (T16) is pushed anyway
  const hold = !bell && holding()
  const wait = kind === 'waiting' ? ++waitN : 0
  if (wait) waits.set(tab.id, wait)
  if (hold && kind === 'done') return void log(`push held: ${tab.name} is done, you're at the Mac`)
  // a wait's message; a done turn's last line that asks something
  const question = (kind === 'waiting' ? text : text.split('\n').reverse().find(l => l.trim().endsWith('?')) ?? '').trim().slice(0, 500)
  // a wait goes a moment later, with its menu (drawn after the hook, often), unless it's over by then
  const go = () => {
    const s = sessions.get(tab.id)
    const latest = waits.get(tab.id) === wait
    if (wait && latest) waits.delete(tab.id)
    if (kind === 'waiting' && (rtOf(tab.id).status !== 'waiting' || !s || s.exited || !latest)) return
    if (hold && (quiet(ws, true) || tab.muted || mutedWs(ws) || hidden(ws))) return void log(`push held: ${tab.name}'s ask, Quiet, muted or hidden since`) // set while it was held
    const ask = kind === 'waiting' ? s!.ask() : undefined
    // a permission ask's command or file (claude's PermissionRequest), its secrets' shapes masked: it leaves the Mac
    // (Settings' titles only: pushRequest drops it, as any question)
    const perm = kind === 'waiting' ? rtOf(tab.id).perm : undefined
    const said = perm ? `${perm.tool}: ${redact(perm.what)}` : question
    // Telegram's done one: the agent's last line and the workspace's diff (+add −del · files), a reply to it goes back
    const st = kind === 'done' ? stats.get(tab.workspace) : undefined
    const last = kind === 'done' ? (text.split('\n').map(l => l.trim()).filter(Boolean).at(-1) ?? '').slice(0, 500) : ''
    const tg = kind === 'done' ? { question: [last, st && st.files ? `+${st.add} −${st.del} · ${st.files} file${st.files === 1 ? '' : 's'}` : ''].filter(Boolean).join('\n') || undefined } : undefined
    send(t, { event: kind, workspace: ws?.name || tab.workspace, tab: tab.id, agent: tab.name, question: said || undefined, options: ask?.options }, ask && { tab: tab.id, key: JSON.stringify(ask.options) }, { tg })
  }
  if (hold) log(`push held: ${tab.name} asks, you're at the Mac: to the phone in ${state.settings?.pushAfter ?? 90} s if it still waits`)
  if (kind === 'waiting') setTimeout(go, hold ? Number(process.env.LAKI_PUSH_HOLD_MS) || (state.settings?.pushAfter ?? 90) * 1000 : Number(process.env.LAKI_PUSH_WAIT_MS) || 800) // tests' shorter
  else go()
}

// a turn running too long (turns.ts longTurnTick), or an agent failing the same command (loop: core's loopCount, held
// at the Mac as a turn's end is): told, nothing to tap (Stop is the Mac's: a stray tap ends no turn)
export function phoneLong(tab: Tab, text: string, event: 'long' | 'loop' = 'long') {
  const ws = state.workspaces.find(x => x.id === tab.workspace)
  const t = to('any')
  if ((!t.hook && !t.tg) || tab.muted || mutedWs(ws) || hidden(ws) || quiet(ws)) return
  if (event === 'loop' && holding()) return void log(`push held: ${tab.name} loops, you're at the Mac`)
  send(t, { event, workspace: ws?.name || tab.workspace, tab: tab.id, agent: tab.name, title: text })
}

// what signs ntfy's taps (push.ts tapSig): Laki's own, in its data folder (0600), never in settings or state.json
let tapKeyIs = ''
function tapKey() {
  if (tapKeyIs) return tapKeyIs
  const f = join(dir, 'tap-key')
  try {
    tapKeyIs = readFileSync(f, 'utf8').trim()
  } catch {}
  if (!/^[0-9a-f]{64}$/.test(tapKeyIs)) writeFileSync(f, (tapKeyIs = randomBytes(32).toString('hex')), { mode: 0o600 })
  return tapKeyIs
}

// Answer from the phone (webhook.answer, Telegram at answer or control): a push with buttons leaves its nonce here, with
// the tab (or a workflow run, flow) and its choices as pushed, until a tap answers it, the tab or run stops waiting or
// asks something else, or a day goes by. While a webhook's is here, phoneTick asks ntfy for taps every 5 s; none: it
// stops (Telegram's come with its long poll). hook: the webhook's taps answer it; tg: Telegram's (its push had buttons);
// msg: its Telegram message (push: what it said), edited as it goes (gone)
type Awaits = { tab?: string; flow?: string; keep?: boolean; key: string; until: number; hook?: boolean; tg?: boolean; msg?: number; push?: Push }
const awaiting = new Map<string, Awaits>()
// an ask's nonce done with (said: the pick's words, else it moved on): its Telegram message edited, buttons gone
const gone = (k: string, said = 'Answered on the Mac, or it moved on') => {
  const a = awaiting.get(k)
  awaiting.delete(k)
  if (a?.msg && a.push) tgDone(a.msg, a.push, said)
}
// the ask a Telegram message is (its buttons', still waiting): its tab and choices as pushed (key); a reply to it may pick one
export const askOfMsg = (msg: number) => [...awaiting.values()].find(a => a.msg === msg && a.tab && a.tg)
// unpaired, another person paired, another bot: Telegram's message ids mean nothing now (another chat's could match);
// the webhook's asks stay
export const tgDrop = () => awaiting.forEach((a, k) => (a.hook ? Object.assign(a, { msg: undefined, tg: false }) : awaiting.delete(k)))
// a tab's pushed ask answered some other way (a Telegram reply's number): its message says what was picked
export const pickedFor = (tab: string, said: string) => awaiting.forEach((a, k) => a.tab === tab && gone(k, said))
// the webhook's taps come back: Answer from the phone where they can (answerOk), never with titles only
const hookAnswers = (w: Webhook) => !!w.answer && answerOk(w) && w.detail !== 'titles' && (w.format === 'webpush' || ((w.format ?? 'ntfy') === 'ntfy' && !!w.replyTopic))
// still asking what it pushed: a tab's menu on screen, a run's wait (workflow.ts' waitKey); remote access's Keep until
// its until (15 minutes)
const stillAsks = (a: { tab?: string; flow?: string; keep?: boolean; key: string }) =>
  !!a.keep || (a.flow ? flowHooks.waitKey?.(a.flow) === a.key : !!a.tab && state.tabs.some(t => t.id === a.tab) && rtOf(a.tab).status === 'waiting')
let tapCursor = '' // replies()'s: ntfy's last message (a unix time at first)
let tapStop: (() => void) | undefined // ticks.ts' phoneTick, while any ask waits for a tap
let tapping = false
let tapFailed = '' // the last failure, logged once until a poll works
let tapFor = '' // the webhook tapCursor is for: another one (Settings changed meanwhile) starts over
const tapStart = (w: Webhook) => ((tapFor = `${w.format}|${w.url}`), (tapCursor = String(Math.floor(Date.now() / 1000) - 5)))
// the asks past their day, or no longer on screen as pushed: their taps dropped, Telegram's messages edited (core's
// changed() runs it as the view changes: an ask answered on the Mac says so on the phone at once)
export const prune = () => awaiting.forEach((a, k) => (a.until < Date.now() || !stillAsks(a)) && gone(k))
function listen(w: Webhook) {
  if (w.format === 'webpush') return prune() // its taps come to /tap: nothing to poll; the stale ones go as each new one comes
  if (tapStop) return
  tapStart(w)
  tapStop = register('phoneTick', 5000, () => void phoneTick())
}
export async function phoneTick() {
  if (tapping) return
  const w = state.settings?.webhook
  prune()
  const off = () => void (tapStop?.(), (tapStop = undefined))
  if (w?.format === 'webpush') return off() // switched to Web Push: its taps come to /tap, its asks kept
  // answers off: the webhook's asks go (one Telegram has too stays Telegram's)
  if (!w?.answer || !w.url) return void (awaiting.forEach((a, k) => a.hook && (a.msg ? (a.hook = false) : awaiting.delete(k))), off())
  if (![...awaiting.values()].some(a => a.hook)) return off()
  if (tapFor !== `${w.format}|${w.url}`) tapStart(w)
  tapping = true
  try {
    const r = await replies(w, tapCursor, tapKey())
    tapCursor = r.cursor
    tapFailed = ''
    for (const tap of r.taps) await takeTap(tap)
  } catch (e) {
    if ((e as Error).message !== tapFailed) log(`answers from the phone: ${(tapFailed = (e as Error).message)}`)
  } finally {
    tapping = false
  }
}

// a tap on a pushed button (Telegram's, ntfy's, a Web Push notification's action): the ask it was for, if it still asks
// the same, answered as a click in Laki would; what it did (Picked: …), else undefined. Telegram's (tg): an agent's ask
// only, never a workflow's (its confirm may merge) nor remote access's Keep (gates.ts TELEGRAM_OK has neither)
export async function takeTap(tap: Tap, tg = false): Promise<string | undefined> {
  const a = awaiting.get(tap.nonce)
  if (!a || (tg && (!a.tab || !a.tg))) return
  awaiting.delete(tap.nonce) // taken: a second tap of it finds nothing
  // its message says what became of it (said: what was picked; none: it moved on, or failed), its buttons gone
  const done = <S extends string | undefined>(said: S) => (awaiting.set(tap.nonce, a), gone(tap.nonce, said), said)
  if (a.keep) return (remoteKeepHook.fn?.(), log('remote access kept on from the phone'), done('Kept on'))
  if (a.flow) {
    // a run's choice: its wait as pushed (0-based in flowAnswer)
    if (flowHooks.waitKey?.(a.flow) !== a.key || !flowHooks.answer) return done(undefined)
    const label = (JSON.parse(a.key) as { options: string[] }).options[tap.n - 1]
    if (label === undefined) return
    return flowHooks.answer({ id: a.flow, n: tap.n - 1 }).then(
      () => (log(`answered run ${a.flow} from the phone: ${label}`), done(`Picked: ${label}`)),
      e => void (log(`answer from the phone, run ${a.flow}: ${(e as Error).message}`), done(undefined)),
    )
  }
  if (!a.tab) return
  const s = sessions.get(a.tab)
  const now = s && !s.exited && rtOf(a.tab).status === 'waiting' ? s.ask() : undefined
  const o = now && JSON.stringify(now.options) === a.key ? now.options.find(x => x.n === tap.n) : undefined
  if (!o) return done(undefined) // it moved on
  const perm = rtOf(a.tab).perm // the ask as it was, for F15's count (askStreak.ts), as main.ts' answer does
  return answer({ tab: a.tab, n: o.n, label: o.label }).then(
    r => (answered(state.tabs.find(t => t.id === a.tab)?.workspace, perm, r.picked), log(`answered ${a.tab} from the phone: ${o.label}`), done(`Picked: ${r.picked}`)),
    e => void (log(`answer from the phone ${a.tab}: ${e.message}`), done(undefined)),
  )
}

// a workflow's notify with phone: yes (workflow.ts): a push like an agent's done one, when Settings has phone pushes
// what: how it says it (shows you, is done, failed)
export function flowPhone(name: string, ws: string | undefined, what: string, text: string, kind = 'Workflow') {
  const t = to('any')
  if ((t.hook || t.tg) && !quiet()) send(t, { event: 'done', workspace: ws ?? 'Laki', tab: '', agent: `${kind} ${name}`, title: `${kind} ${name}${ws ? ` in ${ws}` : ''} ${what}`, question: text.slice(0, 500) }, undefined, { what: name })
}
// a workflow's Ask you, confirm, stuck or unsure decision (workflow.ts' ask, unsure): a waiting push like a tab's, its
// choices as text, and buttons with Answer from the phone (a tap is flowHooks.answer; ponytail: ntfy shows the first 3);
// typed words ({{answer}}) only in the app. An agent's question in a run isn't one: its tab pushed it
export function flowAsk(run: { id: string; name: string; ws?: string }, question: string, options: string[], show?: string) {
  const ws = run.ws ? state.workspaces.find(x => x.id === run.ws) : undefined
  const t = to('waiting')
  if ((!t.hook && !t.tg) || mutedWs(ws) || hidden(ws) || quiet(ws, true)) return
  const key = flowHooks.waitKey?.(run.id) // its block, question and choices, as phoneTick checks them
  const where = ws ? ws.name || ws.id : undefined
  send(t, { event: 'waiting', workspace: where ?? 'Laki', tab: '', agent: `Workflow ${run.name}`, title: `Workflow ${run.name}${where ? ` in ${where}` : ''} asks you`, question: [question, show].filter(Boolean).join('\n').slice(0, 500), options: options.map((label, i) => ({ n: i + 1, label })) }, key ? { flow: run.id, key } : undefined, { what: run.name, tgTaps: false }) // Telegram: its choices as text (a workflow's answer isn't Telegram's)
}
// D4: remote access's link to your phone (settings.remotePush, off unless set): as it starts, moves to a new address,
// stops on its own (why) or pairs a new device. Never with *anyone with the link* (open): the webhook's host sees the
// link, so the page must ask for more (a PIN, an email, the tailnet). Never the PIN, never to Telegram
export function phoneRemote(title: string, o: { url?: string; open?: boolean } = {}) {
  const t = { ...to('any'), tg: false } // never to Telegram: the link holds remote access's token and key, and Settings › Remote access names only the webhook's host
  if (state.settings?.remotePush !== true || (!t.hook && !t.tg) || o.open) return
  send(t, { event: 'remote', workspace: '', tab: '', agent: 'Laki', title, ...(o.url && { url: o.url }) }, undefined, { what: 'remote access' })
}
// T10: remote access about to turn itself off: a push (with remote pushes or not: the webhook's host sees no link here)
// with Keep where taps come back (its tap: remoteKeepHook, remote.ts' remoteKeep); never on Telegram (remote access isn't
// Telegram's to keep on)
export const remoteKeepHook: { fn?: () => void } = {}
export function phoneRemoteIdle(text: string) {
  const t = to('any')
  if (t.hook || t.tg) send(t, { event: 'remote', workspace: '', tab: '', agent: 'Laki', title: text, options: [{ n: 1, label: 'Keep' }] }, { keep: true, key: 'keep' }, { ms: 15 * 60_000, what: 'remote access', tgTaps: false, tg: { options: undefined } })
}
// Settings' Send test: the webhook as the page has it, answered (not fired and forgotten)
export const webhookTest = (w: Webhook) => pushTo(w ?? {}, { event: 'test', workspace: '', tab: '', agent: 'Laki' }).then(() => true)

// M4: Web Push's taps (the service worker's action, POST /tap: main.ts), signed as ntfy's are
export async function tapIn(body: string) {
  const t = tapOf(body, tapKey())
  if (!t) throw new Error('not a tap')
  await takeTap(t)
}
// Web Push: this Mac's VAPID keys (<data>/vapid.json, 0600, made once), the paired devices' subscriptions (remote.ts
// keeps one on each device: unexpired ones only), one the push service says is gone dropped
let vapidIs: Vapid | undefined
export function vapid(): Vapid {
  if (vapidIs) return vapidIs
  const f = join(dir, 'vapid.json')
  try {
    const v = JSON.parse(readFileSync(f, 'utf8')) as Vapid
    if (/^[\w-]{87}$/.test(v.pub) && v.key.includes('PRIVATE KEY')) return (vapidIs = v)
  } catch {}
  writeFileSync(f, JSON.stringify((vapidIs = vapidNew())), { mode: 0o600 })
  return vapidIs
}
webPush.vapid = vapid
webPush.badge = () => badgeOf(view()) // the remote page's icon count, as each push goes
webPush.devices = () => (state.remoteDevices ?? []).filter(d => d.push && d.until > Date.now()).map(d => d.push!)
webPush.gone = endpoint => {
  for (const d of state.remoteDevices ?? []) if (d.push?.endpoint === endpoint) delete d.push, log(`push: ${d.name}'s notifications are gone (its push service says so)`)
  save()
  changed()
}
