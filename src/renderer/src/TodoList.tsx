// To-dos (experimental, settings.todoList; the rail's To-dos, ⌘K; App's dialog 'todos'): one checklist of your own,
// Notion's way, in SpecEditor (BlockNote): Enter makes the next to-do, "# " a heading, Tab nests one under the one
// above, its handle (⋮⋮ on hover) drags it, and its nested ones, into place; / for any other block. Saved 600 ms after a
// change and as it closes (daemon/notes.ts' todoListGet and todoListSave). No files: a pasted picture says so. Loaded
// only as it opens (App's lazy import), BlockNote with it. App.tsx passes a TodoListApi.
import { useEffect, useRef, useState } from 'react'
import { SpecEditor } from './SpecEditor'
import { Page } from './ui'

export type TodoListApi = { call<T = any>(method: string, params?: object): Promise<T> }
type List = { blocks: unknown[]; md: string; at: number }
const FIRST = [{ type: 'checkListItem' }] // a new list: a to-do to write in
// how many are done: its Markdown's checkboxes (specmd.ts writes "- [x] "), an empty one (a new list's) not counted
export const doneOf = (md: string) => ({ all: (md.match(/^\s*- \[[ x]\] +\S/gm) ?? []).length, done: (md.match(/^\s*- \[x\] +\S/gm) ?? []).length })

export default function TodoListPage({ api, onClose }: { api: TodoListApi; onClose: () => void }) {
  const [list, setList] = useState<List | null>(null)
  const [md, setMd] = useState('')
  const [err, setErr] = useState('')
  const pending = useRef<{ blocks: unknown[]; md: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = () => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    // a failed one stays pending (unless a newer edit came meanwhile): the next change or the close sends it again
    if (p) void api.call('todoListSave', p).then(() => setErr(''), e => ((pending.current ??= p), setErr((e as Error).message)))
  }
  useEffect(() => {
    api.call<List>('todoListGet').then(l => (setList(l), setMd(l.md)), e => setErr((e as Error).message))
    return flush // what's typed in its last 600 ms too
  }, [])
  const { all, done } = doneOf(md)
  return (
    <Page title="To-dos" esc={false} /* a page to stay on, as the rail's others: Esc is the editor's */ onClose={onClose} tools={all > 0 && <span className="muted small">{done} of {all} done</span>}>
      <div className="todo-list">
        {err && <p className="warn small">{err}</p>}
        {!list ? (
          !err && <p className="muted small">Loading…</p>
        ) : (
          <SpecEditor
            initial={{ blocks: list.blocks.length ? list.blocks : FIRST }}
            files={{ upload: () => Promise.reject(new Error('to-dos keep text: put files in a note')), resolve: p => Promise.resolve(p) }}
            onChange={(blocks, text) => {
              pending.current = { blocks, md: text }
              setMd(text)
              clearTimeout(timer.current)
              timer.current = setTimeout(flush, 600)
            }}
          />
        )}
        <p className="muted small todo-keys">Enter: the next to-do · [] and a space: a to-do · # and a space: a heading · Tab: under the one above · drag ⋮⋮ to move one · / for more</p>
      </div>
    </Page>
  )
}
