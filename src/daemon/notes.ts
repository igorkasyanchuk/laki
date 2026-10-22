// Notes (experimental, settings.notes; the rail's Notes, ⌘K): the user's own notes, one list for every project. Each is
// <data>/notes/<id>.json ({ id, title, color, pinned, blocks: BlockNote's, md: its Markdown, created, at }), and what's
// pasted or dropped into it <data>/notes/<id>/<name> (blocks keep files/<name>, noteFile shows an image). noteList is
// the sidebar's: pinned first, then the newest edit, each with a preview of its text; q: every word in its title or text.
// The renderer's Notes.tsx: BlockNote, as specs have it (SpecEditor).
// To-dos (experimental, settings.todoList; the rail's To-dos, ⌘K): one checklist of the user's, Notion's way (checklist
// items, headings, nested ones, dragged into order), its blocks and Markdown in <data>/todo-list.json; no files (TodoList.tsx).
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { basename, extname, join } from 'node:path'
import { dir, state } from './core.ts'

const home = join(dir, 'notes')
const ID = /^[a-z0-9]{6,12}-[0-9a-f]{6}$/
const MAX_FILE = 20 << 20 // a pasted file
const MAX_NOTE = 8 << 20 // a note's blocks as JSON
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

export type Note = { id: string; title: string; color?: string; pinned?: boolean; blocks: unknown[]; md: string; created: number; at: number }
export type NoteItem = { id: string; title: string; color?: string; pinned?: boolean; preview: string; created: number; at: number }

const on = () => {
  if (state.settings?.notes !== true) throw new Error('Notes are off: Settings › General › Experimental')
}
const fileOf = (id: unknown) => {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('no such note')
  return join(home, `${id}.json`)
}
// it's there (a file of it beside it, an image shown): no need to read all of it
const known = (id: unknown) => {
  if (!exists(fileOf(id))) throw new Error('no such note: deleted?')
}
function read(id: unknown): Note {
  try {
    return JSON.parse(readFileSync(fileOf(id), 'utf8'))
  } catch {
    throw new Error('no such note: deleted?')
  }
}
function write(n: Note) {
  writeAtomic(fileOf(n.id), JSON.stringify(n), 0o600)
}
// its text in a line: Markdown's marks out (headings, lists, checkboxes, quotes, emphasis, links' URLs, images)
const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const item = (n: Note): NoteItem => ({ id: n.id, title: n.title, ...(n.color && { color: n.color }), ...(n.pinned && { pinned: true }), preview: plain(n.md ?? '').slice(0, 200), created: n.created, at: n.at })
const colorOk = (c: unknown) => (typeof c === 'string' && /^[a-z]{1,20}$/.test(c) && c !== 'none' ? c : undefined)
const titleOk = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)

// ponytail: every note read for each list; an index file if there are ever thousands
export function noteList(p: { q?: string } = {}) {
  on()
  let names: string[] = []
  try {
    names = readdirSync(home).filter(f => f.endsWith('.json'))
  } catch {}
  const words = String(p.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const all: Note[] = names.flatMap(f => (n => (n ? [n] : []))(readJson<Note>(join(home, f))))
  return all
    .filter(n => !words.length || (t => words.every(w => t.includes(w)))(`${n.title}\n${n.md ?? ''}`.toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
    .map(item)
}

export const noteGet = (p: { id: string }) => (on(), read(p.id))

export function noteNew(p: { title?: string; color?: string } = {}) {
  on()
  const now = Date.now()
  const n: Note = { id: `${now.toString(36)}-${randomBytes(3).toString('hex')}`, title: titleOk(p.title), ...(colorOk(p.color) && { color: colorOk(p.color) }), blocks: [], md: '', created: now, at: now }
  write(n)
  return n
}

// what changed: a title or its text moves it up the list (at); a color or a pin doesn't
export function noteSave(p: { id: string; title?: string; color?: string | null; pinned?: boolean; blocks?: unknown[]; md?: string }) {
  on()
  const n = read(p.id)
  if (p.blocks !== undefined) {
    if (!Array.isArray(p.blocks)) throw new Error('blocks: a list')
    if (JSON.stringify(p.blocks).length > MAX_NOTE) throw new Error('too long for a note')
    n.blocks = p.blocks
    n.md = String(p.md ?? '')
    n.at = Date.now()
  }
  if (p.title !== undefined && titleOk(p.title) !== n.title) (n.title = titleOk(p.title)), (n.at = Date.now())
  if (p.color !== undefined) n.color = colorOk(p.color)
  if (p.pinned !== undefined) n.pinned = !!p.pinned || undefined
  write(n)
  return item(n)
}

export function noteRm(p: { id: string }) {
  on()
  rmSync(fileOf(p.id), { force: true })
  rmSync(join(home, p.id), { recursive: true, force: true })
  return {}
}

// a file pasted or dropped into it: <id>/<name> (a name taken: -2, -3…), as files/<name> in its blocks
export function noteUpload(p: { id: string; name?: string; data?: string }) {
  on()
  known(p.id)
  const buf = Buffer.from(String(p.data ?? ''), 'base64')
  if (!buf.length) throw new Error('an empty file')
  if (buf.length > MAX_FILE) throw new Error('over 20 MB')
  const folder = join(home, p.id)
  mkdirSync(folder, { recursive: true })
  const clean = basename(String(p.name || 'file')).replace(/[^\w.-]+/g, '-').slice(-80).replace(/^\.+/, '') || 'file'
  const ext = extname(clean)
  let name = clean
  for (let k = 2; exists(join(folder, name)); k++) name = `${clean.slice(0, clean.length - ext.length)}-${k}${ext}`
  writeFileSync(join(folder, name), buf, { mode: 0o600 })
  return { path: `files/${name}` }
}

const listFile = join(dir, 'todo-list.json')
const listOn = () => {
  if (state.settings?.todoList !== true) throw new Error('To-dos are off: Settings › General › Experimental')
}
export type TodoList = { blocks: unknown[]; md: string; at: number }
export function todoListGet(): TodoList {
  listOn()
  let text: string
  try {
    text = readFileSync(listFile, 'utf8')
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { blocks: [], md: '', at: 0 } // none yet
    throw e
  }
  let l: Partial<TodoList> | null = null
  try {
    l = JSON.parse(text)
  } catch {}
  // never an empty list saved over it
  if (!l || !Array.isArray(l.blocks)) throw new Error(`To-dos: ${listFile} doesn't read as JSON; fix or move it (it isn't written over meanwhile)`)
  return { blocks: l.blocks, md: String(l.md ?? ''), at: Number(l.at) || 0 }
}
export function todoListSave(p: { blocks?: unknown[]; md?: string }) {
  listOn()
  if (!Array.isArray(p.blocks)) throw new Error('blocks: a list')
  if (JSON.stringify(p.blocks).length + String(p.md ?? '').length > MAX_NOTE) throw new Error('too long for the list')
  const l: TodoList = { blocks: p.blocks, md: String(p.md ?? ''), at: Date.now() }
  writeAtomic(listFile, JSON.stringify(l), 0o600)
  return { at: l.at }
}
const exists = (f: string) => {
  try {
    return !!statSync(f)
  } catch {
    return false
  }
}

// an image it holds, as a data URL (the editor shows files/<name> through it); anything else: none
export function noteFile(p: { id: string; path?: string }) {
  on()
  known(p.id)
  const name = /^files\/([^/\\]+)$/.exec(String(p.path ?? ''))?.[1]
  const type = name && IMAGES[extname(name).toLowerCase()]
  if (!name || name.startsWith('.') || !type) return {}
  try {
    return { image: `data:${type};base64,${readFileSync(join(home, p.id, name)).toString('base64')}` }
  } catch {
    return {}
  }
}
