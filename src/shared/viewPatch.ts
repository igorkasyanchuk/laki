// P2: a view's change as a patch: only the top-level keys whose JSON changed (gone: the ones that left), and for
// workspaces and tabs only the items whose JSON changed, by id, with the order of ids when it changed. The daemon diffs
// what it sends each client against what that client got last (main.ts, after the client's own masking: a phone's view
// differs from the window's), only for one that asked (its socket's ?patch=1); a client that connects gets the whole
// view first. api.ts applies a patch onto its last view, so every listener still reads a whole one. Pure:
// test/view-patch.test.ts

export const ITEMS = ['workspaces', 'tabs'] as const
type ItemKey = (typeof ITEMS)[number]
type Obj = Record<string, unknown>
type Item = { id: string }
export type ViewMsg = { ev: 'state'; view?: Obj; patch?: Obj; gone?: string[]; items?: Partial<Record<ItemKey, { set: Item[]; order?: string[] }>> }
// what a client got last: each key's JSON, each item's by id, the ids' order
export type Sent = { keys: Map<string, string>; items: Record<ItemKey, Map<string, string>>; order: Record<ItemKey, string> }

const isItems = (k: string): k is ItemKey => (ITEMS as readonly string[]).includes(k)
const listOf = (v: Obj, k: ItemKey) => (Array.isArray(v[k]) ? (v[k] as Item[]) : [])

// the message for this view, given what the client got last (none: the whole view), and what it has after it; no
// message when nothing changed
export function viewDiff(last: Sent | undefined, v: Obj): { msg?: ViewMsg; sent: Sent } {
  const sent: Sent = { keys: new Map(), items: { workspaces: new Map(), tabs: new Map() }, order: { workspaces: '', tabs: '' } }
  const patch: Obj = {}
  const items: ViewMsg['items'] = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (isItems(k)) {
      const list = listOf(v, k)
      const set = list.filter(it => {
        const j = JSON.stringify(it)
        sent.items[k].set(it.id, j)
        return last?.items[k].get(it.id) !== j
      })
      sent.order[k] = list.map(it => it.id).join('\0')
      const moved = last?.order[k] !== sent.order[k]
      if (set.length || moved) items[k] = { set, ...(moved && { order: list.map(it => it.id) }) }
      continue
    }
    const j = JSON.stringify(x)
    sent.keys.set(k, j)
    if (last?.keys.get(k) !== j) patch[k] = x
  }
  if (!last) return { msg: { ev: 'state', view: v }, sent }
  const gone = [...last.keys.keys()].filter(k => !sent.keys.has(k))
  if (!Object.keys(patch).length && !gone.length && !Object.keys(items).length) return { sent }
  return { msg: { ev: 'state', patch, ...(gone.length && { gone }), ...(Object.keys(items).length && { items }) }, sent }
}

// a patch onto the last view: what didn't come keeps its object (memo'd rows draw again only where something did)
export function viewPatch<V extends object>(prev: V, m: ViewMsg): V {
  const out: Obj = { ...(prev as Obj) }
  for (const k of m.gone ?? []) delete out[k]
  Object.assign(out, m.patch ?? {})
  for (const k of ITEMS) {
    const it = m.items?.[k]
    if (!it) continue
    const old = new Map(listOf(prev as Obj, k).map(x => [x.id, x]))
    const set = new Map(it.set.map(x => [x.id, x]))
    out[k] = (it.order ?? listOf(prev as Obj, k).map(x => x.id)).flatMap(id => set.get(id) ?? old.get(id) ?? [])
  }
  return out as V
}
