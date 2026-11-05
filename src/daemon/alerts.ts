// An important alert (laki alert "<text>" [--choice A]…, MCP's laki_alert): an agent or a script puts a card on your
// screen, the app's cards on screen (main's addCard: bottom right, over every app, until you close it). With choices it
// waits for your pick (or ×, or ALERT_WAIT) and the caller gets it, so an agent can ask you a question that can't be
// missed. main.ts imports it. ponytail: in memory, so a daemon restart drops a wait (the caller's command fails); a
// caller killed while it waits (a tool's timeout) leaves its card up to ALERT_WAIT, its pick going nowhere: the RPC
// layer has no cancel to hear it by
import { randomUUID } from 'node:crypto'
import { ALERT_WAIT } from '../shared/types.ts'
import { broadcast, clients, log, state } from './core.ts'
import { hidden } from './phone.ts'

const CHOICES = 6
type Answer = { id: string; choice?: string; closed?: true; timedOut?: true }
const waits = new Map<string, { choices: string[]; finish: (a: Answer) => void }>()
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max)

export function alertShow(o: { text?: unknown; title?: unknown; choices?: unknown; from?: { tab?: string; ws?: string } }) {
  const text = clean(o.text, 600)
  if (!text) throw new Error('what should it say? laki alert "Deploy is ready: ship it?" --choice Ship --choice Wait')
  const choices = [...new Set((Array.isArray(o.choices) ? o.choices : []).map(c => clean(c, 60)).filter(Boolean))]
  if (choices.length > CHOICES) throw new Error(`${CHOICES} choices at most`)
  if (!clients.size) throw new Error("Laki's app isn't open: the card shows there (open Laki)")
  const tab = state.tabs.find(t => t.id === o.from?.tab)
  if (hidden(state.workspaces.find(w => w.id === tab?.workspace))) throw new Error('Recording mode hides this workspace: no alert from it while that is on') // its words would show on screen
  const id = randomUUID().slice(0, 8)
  const title = clean(o.title, 80) || (tab ? `${state.workspaces.find(w => w.id === tab.workspace)?.name ?? tab.workspace} · ${tab.name}` : 'Laki')
  broadcast({ ev: 'alert', id, title, text, choices, ...(tab && { tab: tab.id }) })
  log(`alert ${id}${tab ? ` from ${tab.id}` : ''}: ${text.slice(0, 80)}`)
  if (!choices.length) return { id, shown: true }
  return new Promise<Answer>(ok => {
    const timer = setTimeout(() => finish({ id, timedOut: true }), ALERT_WAIT)
    const finish = (a: Answer) => {
      clearTimeout(timer)
      waits.delete(id)
      broadcast({ ev: 'alertDone', id }) // its card goes, in every window
      ok(a)
    }
    waits.set(id, { choices, finish })
  })
}

// your answer, from the card: a choice, or none (×, Close all)
export function alertAnswer(o: { id?: unknown; choice?: unknown }) {
  const w = waits.get(String(o.id))
  if (!w) return { gone: true } // shown only, or it stopped waiting
  if (o.choice !== undefined && !w.choices.includes(o.choice as string)) throw new Error('not one of its choices')
  w.finish(o.choice !== undefined ? { id: String(o.id), choice: o.choice as string } : { id: String(o.id), closed: true })
  return { ok: true }
}
