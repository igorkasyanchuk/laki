// An important alert (laki alert "<text>" [--choice A]…, MCP's laki_alert): an agent or a script puts a card on your
// screen, the app's cards on screen (main's addCard: bottom right, over every app, until you close it). With choices it
// waits for your pick (or ×, or ALERT_WAIT) and the caller gets it, so an agent can ask you a question that can't be
// missed. main.ts imports it. ponytail: in memory, so a daemon restart drops a wait (the caller's command fails); a
// caller killed while it waits (a tool's timeout) leaves its card up to ALERT_WAIT, its pick going nowhere: the RPC
// layer has no cancel to hear it by.
// A notice (laki notice, MCP's laki_notice) is the same card inside Laki's window instead: bottom right over whatever
// page is open, kept here until it's answered or closed, so a window that opens or connects later shows it too
// (noticesTo); --to names the session it's about, its Open button goes there
import { randomUUID } from 'node:crypto'
import { ALERT_WAIT, HIDDEN, type Tab } from '../shared/types.ts'
import { broadcast, clients, findWs, log, resolveTarget, state, type Conn } from './core.ts'
import { aiMayAlert } from './ai.ts'
import { hidden } from './phone.ts'

const CHOICES = 6
type Answer = { id: string; choice?: string; closed?: true; timedOut?: true }
const waits = new Map<string, { choices: string[]; finish: (a: Answer) => void }>()
// what it says as you'd read it: nothing HIDDEN (a direction or zero-width character would make a choice look like another)
const UNSEEN = new RegExp(HIDDEN.source, 'gu')
const clean = (v: unknown, max: number) => String(v ?? '').replace(UNSEEN, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max)
// a few a minute from each tab (or from outside one): an agent's real questions, never a wall of cards over your apps.
// ponytail: in memory, a minute's window
const RATE = 5
const sent = new Map<string, number[]>()
// the notices up (their events, as sent), oldest first. ponytail: in memory, the newest NOTICES
const notices = new Map<string, Record<string, unknown>>()
const NOTICES = 20
// the alerts up that only tell (no choices), from a tab: id → that tab. A focused window showing the tab closes them
// (alertsSeen): you're where it was sent from. ponytail: in memory, the newest TOLD
const tells = new Map<string, string>()
const TOLD = 50
// --to: as laki send's target (a tab, @name, <workspace>[/<tab>]); a workspace without an agent: the workspace
const about = (ref: string): { ws: string; tab?: Tab } => {
  try {
    const tab = resolveTarget(ref)
    return { ws: tab.workspace, tab }
  } catch (e) {
    if (/[/@]/.test(ref)) throw e
    return { ws: findWs(ref).id }
  }
}
const wsName = (id: string) => state.workspaces.find(w => w.id === id)?.name ?? id
const named = (tab: { workspace: string; name: string }) => `${wsName(tab.workspace)} · ${tab.name}`
const hides = (ws?: string) => hidden(state.workspaces.find(w => w.id === ws))

export function alertShow(o: { text?: unknown; title?: unknown; choices?: unknown; to?: unknown; from?: { tab?: string; ws?: string }; by?: unknown; chat?: unknown }, kind: 'alert' | 'notice' = 'alert') {
  // Laki AI's (aiRpc's by and chat): only when you asked for one, or allowed it
  if (kind === 'alert' && o.by === 'ai' && !aiMayAlert(typeof o.chat === 'string' ? o.chat : undefined)) throw new Error("not sent: Laki AI puts an important alert on the user's screen only when they ask for one (or Settings › AI › Important alerts on its own is on). Say it in the chat instead")
  const text = clean(o.text, 600)
  if (!text) throw new Error(`what should it say? laki ${kind} "Deploy is ready: ship it?" --choice Ship --choice Wait`)
  const choices = [...new Set((Array.isArray(o.choices) ? o.choices : []).map(c => clean(c, 60)).filter(Boolean))]
  if (choices.length > CHOICES) throw new Error(`${CHOICES} choices at most`)
  if (kind === 'alert' && !clients.size) throw new Error("Laki's app isn't open: the card shows there (open Laki)") // a notice waits for it
  const tab = state.tabs.find(t => t.id === o.from?.tab)
  const to = kind === 'notice' && o.to ? about(String(o.to)) : undefined
  if (hides(tab?.workspace)) throw new Error(`Recording mode hides this workspace: no ${kind} from it while that is on`) // its words would show on screen
  if (hides(to?.ws)) throw new Error('Recording mode hides that workspace: no notice about it while that is on')
  const now = Date.now()
  for (const [k, at] of sent) if (now - at[at.length - 1] >= 60_000) sent.delete(k) // a minute quiet: forgotten (closed tabs')
  const recent = (sent.get(tab?.id ?? '') ?? []).filter(at => now - at < 60_000)
  if (recent.length >= RATE) throw new Error(`${RATE} alerts or notices a minute at most: wait a minute, or say it in one`)
  sent.set(tab?.id ?? '', [...recent, now])
  const id = randomUUID().slice(0, 8)
  const title = clean(o.title, 80) || (tab ? named(tab) : 'Laki')
  const ev = { ev: kind, id, title, text, choices, ...(tab && { tab: tab.id }), ...(to && { to: { ws: to.ws, ...(to.tab && { tab: to.tab.id }), name: to.tab ? named(to.tab) : wsName(to.ws) } }) }
  if (kind === 'notice') {
    // past NOTICES, the oldest that only tell go: one that waits stays (its caller would hear a close you never
    // made); its wait ends by ALERT_WAIT anyway
    const told = [...notices.keys()].filter(k => !waits.has(k))
    for (const old of told.slice(0, Math.max(0, notices.size + 1 - NOTICES))) close(old)
    notices.set(id, ev)
  }
  if (kind === 'alert' && !choices.length && tab) {
    tells.set(id, tab.id)
    if (tells.size > TOLD) tells.delete(tells.keys().next().value!)
  }
  broadcast(ev)
  log(`${kind} ${id}${tab ? ` from ${tab.id}` : ''}${to ? ` about ${to.tab?.id ?? to.ws}` : ''}: ${text.slice(0, 80)}`)
  if (!choices.length) return { id, shown: true }
  return new Promise<Answer>(ok => {
    const timer = setTimeout(() => finish({ id, timedOut: true }), ALERT_WAIT)
    const finish = (a: Answer) => {
      clearTimeout(timer)
      waits.delete(id)
      notices.delete(id)
      broadcast({ ev: 'alertDone', id }) // its card goes, in every window
      ok(a)
    }
    waits.set(id, { choices, finish })
  })
}

// a notice without a wait goes on its ×; one with, as a close
const close = (id: string) => {
  tells.delete(id) // a told alert closed: nothing to close later
  const w = waits.get(id)
  if (w) return w.finish({ id, closed: true }), true
  if (!notices.delete(id)) return false
  broadcast({ ev: 'alertDone', id })
  return true
}

// a window's view (main.ts' view): focused on a tab an alert that only tells came from, that card goes
export function alertsSeen(c: Conn) {
  const v = c.view
  if (!v?.focused || c.remote) return
  const on = v.tabs ?? (v.tab ? [v.tab] : [])
  for (const [id, tab] of tells) if (on.includes(tab)) tells.delete(id), broadcast({ ev: 'alertDone', id })
}

// the notices up, for a window that connects (main.ts): none from or about a workspace Recording mode hides now
export function noticesTo(c: Conn) {
  for (const ev of notices.values()) {
    const from = state.tabs.find(t => t.id === ev.tab)?.workspace
    if (!hides(from) && !hides((ev.to as { ws?: string } | undefined)?.ws)) c.send(ev)
  }
}

// your answer, from the card: a choice, or none (×, Close all)
export function alertAnswer(o: { id?: unknown; choice?: unknown }) {
  const w = waits.get(String(o.id))
  if (!w) return close(String(o.id)) ? { ok: true } : { gone: true } // a notice closed; or shown only, or it stopped waiting
  if (o.choice !== undefined && !w.choices.includes(o.choice as string)) throw new Error('not one of its choices')
  w.finish(o.choice !== undefined ? { id: String(o.id), choice: o.choice as string } : { id: String(o.id), closed: true })
  return { ok: true }
}
