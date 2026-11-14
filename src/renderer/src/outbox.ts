// The remote page's outbox (remote access; never the Mac's window: api.ts calls it only without the app's bridge). A
// send or an answer whose call failed as the socket went down, or got no reply in OUT_WAIT, waits here, mirrored to
// sessionStorage (ids, text and its send's switches only; gone with the tab), shown with Not sent yet and Cancel
// (OutboxStrip.tsx). Once the page is back and has a view (api.ts), they go again in order: a message as typed; an answer
// only while its ask still waits (its tab waiting since the same moment: needAt), else dropped and said. Each carries
// its own id (cid): one that got there but lost its reply is applied once (the daemon keeps the last 100 of each device
// or connection: main.ts). Older than OUT_MAX: dropped, said. Nothing else is kept. Pure: outAdd, outReplay (units-more)
export type OutItem = { cid: string; at: number; method: 'send' | 'answer'; tab: string; text?: string; n?: number; label?: string; ask?: number; whenIdle?: boolean; steer?: boolean; enter?: boolean }
export type OutNote = { cid: string; text: string; why: string }
export const OUT_MAX = 30 * 60e3
export const OUT_WAIT = 15e3
const KEY = 'laki.outbox'
const GONE = /^(not connected|disconnected|no reply)$/ // the socket's, not the daemon's: kept

export const outAdd = (box: OutItem[], it: OutItem) => [...box.filter(x => x.cid !== it.cid), it]
// what goes again now, in order, and what's dropped (and why): too old, or an answer whose ask is over
export function outReplay(box: OutItem[], now: number, waitingSince: (tab: string) => number | undefined) {
  const go: OutItem[] = []
  const dropped: { item: OutItem; why: string }[] = []
  for (const it of box)
    if (now - it.at > OUT_MAX) dropped.push({ item: it, why: 'Not sent: it waited over 30 minutes' })
    else if (it.method === 'answer' && (it.ask === undefined || waitingSince(it.tab) !== it.ask)) dropped.push({ item: it, why: 'This question was already answered or is gone' })
    else go.push(it)
  return { go, dropped }
}
// what an item sends: its call's params, with its id
export const outParams = (it: OutItem) =>
  it.method === 'send' ? { target: it.tab, text: it.text ?? '', cid: it.cid, ...(it.whenIdle && { whenIdle: true }), ...(it.steer && { steer: true }), ...(it.enter === false && { enter: false }) } : { tab: it.tab, n: it.n, label: it.label, cid: it.cid }
export const outText = (it: OutItem) => (it.method === 'send' ? it.text ?? '' : `Answer: ${it.label ?? it.n}`)

// ---------- the page's own (not pure): the box, its notes, who's told
let box: OutItem[] = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as OutItem[]
  } catch {
    return []
  }
})()
let notes: OutNote[] = []
let snap = { box, notes }
const subs = new Set<() => void>()
function put(next: OutItem[], more: OutNote[] = notes) {
  box = next
  notes = more
  snap = { box, notes }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(box))
  } catch {}
  for (const f of subs) f()
}
export const outbox = {
  get: () => snap,
  on: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
  cancel: (cid: string) => put(box.filter(x => x.cid !== cid)),
  seen: (cid: string) => put(box, notes.filter(x => x.cid !== cid)),
}

const timed = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('no reply')), OUT_WAIT))])
const cidNew = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 40)

// a send or an answer: done now, else kept (the socket's failure only; the daemon's no is the caller's, as before)
export async function outCall(raw: (m: string, p: object) => Promise<unknown>, method: 'send' | 'answer', params: Record<string, unknown>, askOf: (tab: string) => number | undefined) {
  const cid = cidNew()
  try {
    return await timed(raw(method, { ...params, cid }))
  } catch (e) {
    if (!GONE.test((e as Error).message)) throw e
    const tab = String((method === 'send' ? params.target : params.tab) ?? '')
    const it: OutItem =
      method === 'send'
        ? { cid, at: Date.now(), method, tab, text: String(params.text ?? ''), ...(params.whenIdle === true && { whenIdle: true }), ...(params.steer === true && { steer: true }), ...(params.enter === false && { enter: false }) }
        : { cid, at: Date.now(), method, tab, n: Number(params.n), ...(typeof params.label === 'string' && { label: params.label }), ask: askOf(tab) }
    put(outAdd(box, it))
    return { kept: cid }
  }
}

// back and with a view: what waits goes, in order; the socket going again stops it there (the rest wait on)
let flushing = false
export async function outFlush(raw: (m: string, p: object) => Promise<unknown>, waitingSince: (tab: string) => number | undefined) {
  if (flushing || !box.length) return
  flushing = true
  try {
    const { go, dropped } = outReplay(box, Date.now(), waitingSince)
    if (dropped.length) put(box.filter(x => !dropped.some(d => d.item.cid === x.cid)), [...notes, ...dropped.map(d => ({ cid: d.item.cid, text: outText(d.item), why: d.why }))])
    for (const it of go) {
      if (!box.some(x => x.cid === it.cid)) continue // cancelled meanwhile
      try {
        await timed(raw(it.method, outParams(it)))
        put(box.filter(x => x.cid !== it.cid))
      } catch (e) {
        if (GONE.test((e as Error).message)) break
        put(box.filter(x => x.cid !== it.cid), [...notes, { cid: it.cid, text: outText(it), why: `Not sent: ${(e as Error).message}` }])
      }
    }
  } finally {
    flushing = false
  }
}
