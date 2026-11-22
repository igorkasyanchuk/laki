// A daemon `state` event's view, sharing the last one's objects where nothing changed (structural sharing): every
// workspace, tab, project and widget whose JSON is the same keeps its old object (matched by id), an array whose items
// all were kept keeps its old array, any other top-level field equal by JSON keeps its old value. So memo'd parts
// (Sidebar's rows, TabBar's tabs, Panes' panes) see the same object where nothing of theirs changed, and draw again only
// where something did. Pure: test/view-share.test.ts
import type { View } from '../../shared/types'

type Any = Record<string, unknown>
const json = (x: unknown) => JSON.stringify(x)
const BY_ID = ['workspaces', 'tabs', 'projects', 'widgets'] as const
// next's items, each its old one when that has its id and the same JSON; the old array itself when nothing changed
function shareList<T extends { id?: unknown }>(prev: T[] | undefined, next: T[] | undefined): T[] | undefined {
  if (!prev || !next) return next
  const old = new Map(prev.map(x => [x?.id, x]))
  let same = prev.length === next.length
  const out = next.map((x, i) => {
    const o = old.get(x?.id)
    const keep = o !== undefined && json(o) === json(x) ? o : x
    if (keep !== prev[i]) same = false
    return keep
  })
  return same ? prev : out
}
export function viewShare(prev: View | null | undefined, next: View): View {
  if (!prev) return next
  const out: Any = { ...(next as unknown as Any) }
  const p = prev as unknown as Any
  for (const k of Object.keys(out)) {
    if ((BY_ID as readonly string[]).includes(k)) out[k] = shareList(p[k] as { id?: unknown }[] | undefined, out[k] as { id?: unknown }[] | undefined)
    else if (k in p && json(p[k]) === json(out[k])) out[k] = p[k]
  }
  return out as unknown as View
}
