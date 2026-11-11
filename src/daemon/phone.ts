// phone pushes (push.ts builds them): a turn that waits or is done, a workflow's questions, and the taps that answer
// from the phone. core.ts imports it, and its users import it directly.

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { answerOk, pushOn, type Tab, type Webhook, type Workspace } from '../shared/types.ts'
import { answer, changed, log, rtOf, save, sessions, state } from './core.ts'
import { dir } from './dir.ts'
import { pushTo, replies, type Tap, tapOf, type Vapid, vapidNew, webPush } from './push.ts'
import { flowHooks } from './schedule.ts'
import { redact } from './share.ts'
import { register } from './ticks.ts'

// a push to your phone (push.ts) for a turn that waits or is done: once per state change of a tab (pushed: what went
// since it last ran; view() clears it), never for a muted tab or workspace, nor a private one in Recording mode
// (hidden: a phone on the desk is on camera too). ponytail: a turn that starts and ends
// within the 30 ms before a view is built looks like the same one, and its end isn't pushed
export const pushed = new Map<string, string>()
export const hidden = (ws?: Workspace) => !!ws && !!state.settings?.recording && (!!ws.private || !!state.projects.find(p => p.id === ws.project)?.private)
export function phone(tab: Tab, kind: 'waiting' | 'done', text: string) {
  const w = state.settings?.webhook
  const ws = state.workspaces.find(x => x.id === tab.workspace)
  if ((state.dnd?.until ?? 0) > Date.now() && !(kind === 'waiting' && ws?.important)) return // U8: Do not disturb: an important workspace's ask only
  if (!pushOn(w) || (kind === 'waiting' ? w.waiting === false : w.done !== true) || pushed.get(tab.id) === kind || tab.muted || ws?.muted || hidden(ws)) return
  pushed.set(tab.id, kind)
  // a wait's message; a done turn's last line that asks something
  const question = (kind === 'waiting' ? text : text.split('\n').reverse().find(l => l.trim().endsWith('?')) ?? '').trim().slice(0, 500)
  // a wait goes a moment later, with its menu (drawn after the hook, often), unless it's over by then
  const go = () => {
    const s = sessions.get(tab.id)
    if (kind === 'waiting' && (rtOf(tab.id).status !== 'waiting' || !s || s.exited)) return
    const ask = kind === 'waiting' ? s!.ask() : undefined
    const nonce = ask && nonceFor(w)
    if (nonce) awaiting.set(nonce, { tab: tab.id, key: JSON.stringify(ask!.options), until: Date.now() + 864e5 }), listen(w)
    // a permission ask's command or file (claude's PermissionRequest), its secrets' shapes masked: it leaves the Mac
    // (Settings' titles only: pushRequest drops it, as any question)
    const perm = kind === 'waiting' ? rtOf(tab.id).perm : undefined
    const said = perm ? `${perm.tool}: ${redact(perm.what)}` : question
    pushTo(w, { event: kind, workspace: ws?.name || tab.workspace, tab: tab.id, agent: tab.name, question: said || undefined, options: ask?.options, nonce, ...(nonce && { key: tapKey() }) }).catch(e => log(`push ${tab.id}: ${e.message}`))
  }
  if (kind === 'waiting') setTimeout(go, 800)
  else go()
}

// a turn running too long (turns.ts longTurnTick): told, nothing to tap (Stop is the Mac's: a stray tap ends no turn)
export function phoneLong(tab: Tab, text: string) {
  const w = state.settings?.webhook
  const ws = state.workspaces.find(x => x.id === tab.workspace)
  if (!pushOn(w) || tab.muted || ws?.muted || hidden(ws)) return
  pushTo(w, { event: 'long', workspace: ws?.name || tab.workspace, tab: tab.id, agent: tab.name, title: text }).catch(e => log(`push ${tab.id}: ${e.message}`))
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

// Answer from the phone (webhook.answer): a push with buttons leaves its nonce here, with the tab (or a workflow run,
// flow) and its choices as pushed, until a tap answers it, the tab or run stops waiting or asks something else, or a day
// goes by. While any is here, phoneTick asks Telegram or ntfy for taps every 5 s; none: it stops
const awaiting = new Map<string, { tab?: string; flow?: string; key: string; until: number }>()
// a push's nonce: its buttons, only with Answer from the phone where taps can come back (answerOk)
const nonceFor = (w: Webhook) => (w.answer && answerOk(w) && w.detail !== 'titles' && (w.format === 'telegram' || w.format === 'webpush' || ((w.format ?? 'ntfy') === 'ntfy' && w.replyTopic)) ? randomBytes(8).toString('hex') : undefined)
// still asking what it pushed: a tab's menu on screen, a run's wait (workflow.ts' waitKey)
const stillAsks = (a: { tab?: string; flow?: string; key: string }) =>
  a.flow ? flowHooks.waitKey?.(a.flow) === a.key : !!a.tab && state.tabs.some(t => t.id === a.tab) && rtOf(a.tab).status === 'waiting'
let tapCursor = '' // replies()'s: Telegram's next update, ntfy's last message (a unix time at first)
let tapStop: (() => void) | undefined // ticks.ts' phoneTick, while any ask waits for a tap
let tapping = false
let tapFailed = '' // the last failure, logged once until a poll works
let tapFor = '' // the webhook tapCursor is for: another one (Settings changed meanwhile) starts over
const tapStart = (w: Webhook) => ((tapFor = `${w.format}|${w.url}`), (tapCursor = w.format === 'telegram' ? '' : String(Math.floor(Date.now() / 1000) - 5)))
// the asks past their day, or no longer on screen as pushed: their taps dropped
const prune = () => awaiting.forEach((a, k) => (a.until < Date.now() || !stillAsks(a)) && awaiting.delete(k))
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
  if (w?.format === 'webpush') return void (tapStop?.(), (tapStop = undefined)) // switched to Web Push: its taps come to /tap, its asks kept
  if (!awaiting.size || !w?.answer || !w.url) return void (tapStop?.(), (tapStop = undefined), awaiting.clear())
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
// the same, answered as a click in Laki would
export async function takeTap(tap: Tap) {
  const a = awaiting.get(tap.nonce)
  if (!a) return
  awaiting.delete(tap.nonce)
  if (a.flow) {
    // a run's choice: its wait as pushed (0-based in flowAnswer)
    if (flowHooks.waitKey?.(a.flow) !== a.key || !flowHooks.answer) return
    const label = (JSON.parse(a.key) as { options: string[] }).options[tap.n - 1]
    if (label === undefined) return
    return void (await flowHooks.answer({ id: a.flow, n: tap.n - 1 }).then(
      () => log(`answered run ${a.flow} from the phone: ${label}`),
      e => log(`answer from the phone, run ${a.flow}: ${(e as Error).message}`),
    ))
  }
  if (!a.tab) return
  const s = sessions.get(a.tab)
  const now = s && !s.exited && rtOf(a.tab).status === 'waiting' ? s.ask() : undefined
  const o = now && JSON.stringify(now.options) === a.key ? now.options.find(x => x.n === tap.n) : undefined
  if (!o) return // it moved on
  await answer({ tab: a.tab, n: o.n, label: o.label }).then(
    () => log(`answered ${a.tab} from the phone: ${o.label}`),
    e => log(`answer from the phone ${a.tab}: ${e.message}`),
  )
}

// a workflow's notify with phone: yes (workflow.ts): a push like an agent's done one, when Settings has phone pushes
// what: how it says it (shows you, is done, failed)
export function flowPhone(name: string, ws: string | undefined, what: string, text: string, kind = 'Workflow') {
  const w = state.settings?.webhook
  if (!pushOn(w)) return
  pushTo(w, { event: 'done', workspace: ws ?? 'Laki', tab: '', agent: `${kind} ${name}`, title: `${kind} ${name}${ws ? ` in ${ws}` : ''} ${what}`, question: text.slice(0, 500) }).catch(e => log(`push ${name}: ${e.message}`))
}
// a workflow's Ask you, confirm, stuck or unsure decision (workflow.ts' ask, unsure): a waiting push like a tab's, its
// choices as text, and buttons with Answer from the phone (a tap is flowHooks.answer; ponytail: ntfy shows the first 3);
// typed words ({{answer}}) only in the app. An agent's question in a run isn't one: its tab pushed it
export function flowAsk(run: { id: string; name: string; ws?: string }, question: string, options: string[], show?: string) {
  const w = state.settings?.webhook
  const ws = run.ws ? state.workspaces.find(x => x.id === run.ws) : undefined
  if (!pushOn(w) || w.waiting === false || ws?.muted || hidden(ws)) return
  const key = flowHooks.waitKey?.(run.id) // its block, question and choices, as phoneTick checks them
  const nonce = key && options.length ? nonceFor(w) : undefined
  if (nonce) awaiting.set(nonce, { flow: run.id, key: key!, until: Date.now() + 864e5 }), listen(w)
  const where = ws ? ws.name || ws.id : undefined
  pushTo(w, { event: 'waiting', workspace: where ?? 'Laki', tab: '', agent: `Workflow ${run.name}`, title: `Workflow ${run.name}${where ? ` in ${where}` : ''} asks you`, question: [question, show].filter(Boolean).join('\n').slice(0, 500), options: options.map((label, i) => ({ n: i + 1, label })), nonce, ...(nonce && { key: tapKey() }) }).catch(e => log(`push ${run.name}: ${e.message}`))
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
webPush.devices = () => (state.remoteDevices ?? []).filter(d => d.push && d.until > Date.now()).map(d => d.push!)
webPush.gone = endpoint => {
  for (const d of state.remoteDevices ?? []) if (d.push?.endpoint === endpoint) delete d.push, log(`push: ${d.name}'s notifications are gone (its push service says so)`)
  save()
  changed()
}
