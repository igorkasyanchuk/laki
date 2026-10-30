// Notes (settings.notes, on unless false; the rail's Notes, ⌘K; App's dialog { note: id ('': the first) }): your own notes,
// one list for every project (daemon/notes.ts). The list on the left: search (every word, its title or text), a color to
// show only those, pinned first, then the newest edit, each its title, a preview of its text and when; a right click pins,
// colors or deletes one. The open one on the right: its title, color, pin, and the editor (SpecEditor: BlockNote, as
// specs have it: headings, lists, checklists, tables, code, images, diagrams), saved 600 ms after a change and as it
// closes. Loaded only as it opens (App's lazy import), BlockNote with it. App.tsx passes a NotesApi.
import { useEffect, useRef, useState } from 'react'
import { ago } from './Info'
import { SpecEditor } from './SpecEditor'
import { ask, colorVar, Edge, Icon, IconButton, keep, load as stored, type MenuItem, Page, TAB_COLORS, useMenu, usePageSide } from './ui'

const SIDE_W = 'laki.notesW' // the list's width
const SIDE_INIT = 290

type Item = { id: string; title: string; color?: string; pinned?: boolean; preview: string; created: number; at: number }
type Note = Item & { blocks: unknown[]; md: string }
export type NotesApi = { call<T = any>(method: string, params?: object): Promise<T> }
type Change = { title?: string; blocks?: unknown[]; md?: string; color?: string | null; pinned?: boolean }

const fileData = (f: File) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader()
    r.onload = () => done(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => fail(r.error)
    r.readAsDataURL(f)
  })
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
const named = (n: { title: string }) => n.title || 'Untitled'
const order = (l: Item[]) => [...l].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at) // as noteList's

export default function NotesPage({ id, api, onOpen, onClose }: { id: string; api: NotesApi; onOpen: (id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<Item[] | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<string | null>(null) // a color: only those
  const [err, setErr] = useState('')
  const [sideW, setSideW] = useState(() => stored(SIDE_W, SIDE_INIT))
  const [side, sideBtn] = usePageSide('notes')
  const [menu, openMenu] = useMenu()
  const qNow = useRef(q)
  qNow.current = q
  const load = () => api.call<Item[]>('noteList', { q: qNow.current }).then(l => (setList(l), setErr('')), e => setErr((e as Error).message))
  useEffect(() => {
    const t = setTimeout(load, q ? 150 : 0)
    return () => clearTimeout(t)
  }, [q])
  const shown = (list ?? []).filter(n => !only || n.color === only)
  const open = id || (!q && !only ? list?.[0]?.id : undefined) // none asked for: the first
  const colors = TAB_COLORS.filter(c => list?.some(n => n.color === c))
  const make = () => api.call<Note>('noteNew', { color: only ?? undefined }).then(n => (q ? setQ('') : void load(), onOpen(n.id)), e => setErr((e as Error).message)) // a search typed: clearing it loads
  // a save's item in the list as it is now, not the whole list read again (a search's match: at the next one)
  const saved = (it: Item) => setList(l => l && order(l.map(x => (x.id === it.id ? it : x))))
  const save = (nid: string, c: Change) => api.call<Item>('noteSave', { id: nid, ...c }).then(saved)
  const remove = (n: Item) =>
    void ask(`Delete ${named(n)}?`, { text: 'The note and the files in it go for good.', ok: 'Delete', danger: true }).then(y => {
      if (!y) return
      const next = shown[shown.findIndex(x => x.id === n.id) + 1] ?? shown[shown.findIndex(x => x.id === n.id) - 1]
      api.call('noteRm', { id: n.id }).then(() => (setList(l => l && l.filter(x => x.id !== n.id)), n.id === open && onOpen(next?.id ?? '')), e => setErr((e as Error).message)) // out of the list at once: the first open next isn't it
    })
  const colorItems = (n: Item, set: (c: string | null) => void): MenuItem[] => [{ colors: TAB_COLORS, value: n.color, pick: c => set(c === 'none' ? null : c) }, ...(n.color ? [{ label: 'No color', icon: 'x', run: () => set(null) } as MenuItem] : [])]
  const rowMenu = (e: React.MouseEvent, n: Item) => (
    e.preventDefault(),
    openMenu(e, [
      { label: n.pinned ? 'Unpin' : 'Pin to the top', icon: 'pin', run: () => void save(n.id, { pinned: !n.pinned }) },
      null,
      ...colorItems(n, c => void save(n.id, { color: c })),
      null,
      { label: 'Delete…', icon: 'trash', danger: true, run: () => remove(n) },
    ])
  )
  return (
    <Page
      title="Notes"
      head={
        <>
          {sideBtn}
          <b>Notes</b>
        </>
      }
      wide
      esc={false} /* a page to stay on, as the rail's others: Esc never closes it (the editor's own Esc) */
      onClose={onClose}
      tools={
        <button type="button" className="primary" onClick={make}>
          <Icon name="plus" size={12} /> New note
        </button>
      }
    >
      {menu}
      <div className="notes">
        <aside className="notes-side" hidden={!side} style={{ width: sideW }}>
          <div className="notes-find find-field">
            <Icon name="search" size={13} />
            <input value={q} placeholder="Search notes" spellCheck={false} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && q && (e.preventDefault(), setQ(''))} />
            {q && <IconButton icon="x" title="Clear" onClick={() => setQ('')} />}
          </div>
          {colors.length > 0 && (
            <div className="notes-colors" role="group" aria-label="Only this color">
              {colors.map(c => (
                <button key={c} type="button" className={`notes-dot ${only === c ? 'on' : ''}`} style={colorVar(c)} aria-pressed={only === c} data-tip={only === c ? 'Show every color' : `Only ${c}`} onClick={() => setOnly(o => (o === c ? null : c))} />
              ))}
            </div>
          )}
          <div className="notes-list">
            {err && <p className="warn small">{err}</p>}
            {list && !shown.length && <p className="muted small notes-none">{q || only ? 'No note matches.' : 'No notes yet: New note writes one.'}</p>}
            {shown.map(n => (
              <button key={n.id} type="button" className={`note-row ${n.id === open ? 'on' : ''}`} style={colorVar(n.color)} onClick={() => onOpen(n.id)} onContextMenu={e => rowMenu(e, n)}>
                <span className="note-row-head">
                  <b>{named(n)}</b>
                  {n.pinned && <Icon name="pin" size={11} />}
                </span>
                {n.preview && <span className="note-prev">{n.preview}</span>}
                <span className="note-when">{ago(n.at) || day(n.at)}</span>
              </button>
            ))}
          </div>
        </aside>
        {side && <Edge x={{ left: sideW }} to={(x, box) => setSideW(Math.round(Math.max(200, Math.min(x - box.left, 560, box.width - 360))))} done={() => keep(SIDE_W, sideW)} reset={() => (setSideW(SIDE_INIT), keep(SIDE_W, SIDE_INIT))} />}
        {open ? (
          <NoteEdit key={open} id={open} meta={list?.find(x => x.id === open)} api={api} onSaved={saved} colorItems={colorItems} onRemove={remove} openMenu={openMenu} />
        ) : (
          <div className="note-empty">
            <Icon name="note" size={28} />
            <b>{list?.length ? 'Pick a note' : 'Your notes'}</b>
            <p className="muted small">Notes for you, about any project: written like a Notion page, with headings, checklists, tables, code, images and diagrams (type / for them).</p>
            <button type="button" className="primary" onClick={make}>
              <Icon name="plus" size={12} /> New note
            </button>
          </div>
        )}
      </div>
    </Page>
  )
}

// the open note: its title, color, pin, the editor; a change saved 600 ms later, and as it closes
function NoteEdit({ id, meta, api, onSaved, colorItems, onRemove, openMenu }: { id: string; meta?: Item; api: NotesApi; onSaved: (it: Item) => void; colorItems: (n: Item, set: (c: string | null) => void) => MenuItem[]; onRemove: (n: Item) => void; openMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const [n, setN] = useState<Note | null>(null)
  const [err, setErr] = useState('')
  const pending = useRef<Change | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => void api.call<Note>('noteGet', { id }).then(setN, e => setErr((e as Error).message)), [])
  const flush = () => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    if (p) return api.call<Item>('noteSave', { id, ...p }).then(onSaved, e => setErr((e as Error).message))
  }
  useEffect(() => () => void flush(), []) // leaving it (another note, the page closed) saves
  // a row's right click pins or colors it too: the list's item, as it changes
  useEffect(() => void (meta && setN(x => x && { ...x, color: meta.color, pinned: meta.pinned })), [meta?.color, meta?.pinned])
  const later = (c: Change) => {
    pending.current = { ...pending.current, ...c }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }
  const now = (c: Change) => (setN(x => x && { ...x, ...c, color: c.color === null ? undefined : (c.color ?? x.color) }), api.call<Item>('noteSave', { id, ...c }).then(onSaved, e => setErr((e as Error).message)))
  if (err) return <div className="note-edit"><p className="warn small">{err}</p></div>
  if (!n) return <div className="note-edit muted small">Loading…</div>
  const { color, pinned } = n
  return (
    <div className="note-edit">
      <div className="note-page">
        <div className="note-head">
          <input className="note-title" value={n.title} placeholder="Untitled" autoFocus={!n.title && !n.md} aria-label="Title" onChange={e => (setN({ ...n, title: e.target.value }), later({ title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), document.querySelector<HTMLElement>('.note-edit .bn-editor')?.focus())} />
          <button type="button" className={`note-color ${color ? 'set' : ''}`} style={colorVar(color)} data-tip={color ? `Color: ${color}` : 'A color'} aria-label="Color" onClick={e => openMenu(e, colorItems({ ...n, color }, c => void now({ color: c })))} />
          <IconButton icon="pin" title={pinned ? 'Unpin' : 'Pin to the top of the list'} on={!!pinned} onClick={() => void now({ pinned: !pinned })} />
          <IconButton icon="trash" title="Delete this note" onClick={() => (void flush(), onRemove(n))} />
        </div>
        <div className="muted small note-meta">
          Edited {ago(n.at) || day(n.at)} · created {day(n.created)}
        </div>
        <SpecEditor
          initial={{ blocks: n.blocks }}
          files={{
            upload: f => fileData(f).then(data => api.call<{ path: string }>('noteUpload', { id, name: f.name, data }).then(r => r.path)),
            resolve: path => api.call<{ image?: string }>('noteFile', { id, path }).then(r => r.image ?? path),
          }}
          onChange={(blocks, md) => later({ blocks, md })}
        />
      </div>
    </div>
  )
}
