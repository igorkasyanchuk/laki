// an extension's files: read and written (Laki AI's, MCP's, the inspector's), each write undoable (the studio's
// history), a copy to change (Remix), and the trash. widgets.ts re-exports it.

import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { needsSample } from '../shared/widgetSchema.ts'
import { copyTree, move, readJson } from '../shared/conn.ts'
import { agents, AI_MAY, find, type Manifest, pathOf, readStore, refetch, repoSays, running, scanWidgets, secretsOf, setSecrets, stopAgents, storePath, widgetHome, widgets, widgetsView, wLog, writeStore } from './widgets.ts'
import { filesHash, hashes, runsOf } from './widgetTrust.ts'
import { fixturesOf } from './widgetDev.ts'
import { dir } from './dir.ts'
import { errAt, flushLogs, lastN, logPath, pending } from './widgetLogs.ts'
import { ungrant } from './widgetTools.ts'
import { agentCaller } from './core.ts'

// an extension's files, as text (Laki AI's and MCP's laki_extension_read: an example to copy, or the one to change):
// its folder's own files only, none hidden, and fixtures/*.json, 20 at most; a one-file extension's file
const filesAndDirs = (d: string) => {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}
export const filesIn = (d: string) => {
  try {
    return readdirSync(d, { withFileTypes: true }).filter(x => x.isFile() && !x.name.startsWith('.')).map(x => x.name)
  } catch {
    return []
  }
}
export function widgetFiles(o: { id: string }) {
  const w = find(o.id)
  const hash = filesHash(w, true) // before they're read: a change in between gives a hash widgetSet's seen won't take
  const files: Record<string, string> = {}
  for (const n of (w.file ? [w.file] : [...filesIn(w.dir), ...fixturesOf(w).map(f => `fixtures/${f}.json`)]).slice(0, 20)) {
    const p = join(w.dir, n)
    const buf = statSync(p).size > 64 << 10 ? null : readFileSync(p)
    files[n] = !buf ? '(over 64 KB: not shown)' : buf.includes(0) ? '(binary: not shown)' : buf.toString('utf8')
  }
  return { id: w.id, builtin: w.builtin || undefined, files, hash }
}

// the inspector's Files, edited by hand: one of the files widgetFiles lists, written in place (its mode stays). was: the
// text the edit started from (changed meanwhile: refused unless force); a .json one must parse (widget.json: an object),
// so a slip doesn't take the extension away. Not one that comes with Laki (an update would undo it: Remix makes a copy);
// one of Laki's folder is kept for the studio's Undo first. Read again at once (a dev one: its watch does it)
export function widgetFileSave(o: { id: string; path: string; text: string; was?: string; force?: boolean }) {
  const w = find(o.id)
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: Remix it to change a copy`)
  if (w.project) throw new Error(repoSays(w, 'change it'))
  const names = w.file ? [w.file] : [...filesIn(w.dir), ...fixturesOf(w).map(f => `fixtures/${f}.json`)]
  if (typeof o.path !== 'string' || !names.includes(o.path)) throw new Error(`${o.path}: not one of its files`)
  if (typeof o.text !== 'string' || Buffer.byteLength(o.text) > 64 << 10) throw new Error('its text, up to 64 KB (more: open its folder)') // widgetFiles shows no more
  if (o.path.startsWith('fixtures/') && !statOf(join(w.dir, 'fixtures'))?.isDirectory()) throw new Error('fixtures is a link there')
  const p = join(w.dir, o.path)
  if (!statOf(p)?.isFile()) throw new Error(`${o.path} is a link or a folder there`)
  const buf = readFileSync(p)
  if (buf.length > 64 << 10 || buf.includes(0)) throw new Error(`${o.path} is over 64 KB or not text: open its folder to edit it`)
  if (!o.force && typeof o.was === 'string' && buf.toString('utf8') !== o.was) throw new Error(`${o.path} changed since you opened it`)
  if (/\.json$/i.test(o.path)) {
    let j: unknown
    try {
      j = JSON.parse(o.text)
    } catch (e) {
      throw new Error(`${o.path}: not JSON: ${(e as Error).message}`)
    }
    if (o.path === 'widget.json' && (!j || typeof j !== 'object' || Array.isArray(j))) throw new Error('widget.json: an object')
  }
  if (w.dir === join(widgetHome(), w.id)) snapshot(w.id, w.dir)
  writeFileSync(p, o.text)
  wLog(w, `edited by hand: ${o.path}`)
  if (!w.dev) {
    scanWidgets()
    const now = widgets.get(w.id)
    if (now) refetch(now, 'reload', `${o.path} edited`)
  }
  return widgetsView().find(x => x.id === w.id)
}

// an extension made or changed by Laki AI or an MCP client (laki_extension_write): its files in Laki's own folder only
// (<data>/widgets/<id>, never another folder's, the user's own there, nor through a link), files left out kept. A new
// one is saved off: its fetch runs shell commands a model wrote, so the user turns it on in Settings › Extensions after
// a look. One that's on stays on through an edit (the user's ask: Laki AI changing it on its page); agent: written from
// an agent's tab (main.ts' FROM), which stays on only while what it runs is the same (its commands would run outside
// that agent's own sandbox)
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const FILE = /^\w[\w.-]{0,59}$/
const FIXTURE = /^fixtures\/\w[\w.-]{0,59}\.json$/ // the one folder: sample data
export const statOf = (p: string) => {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}
export function widgetWrite(o: { id: string; files: Record<string, unknown>; agent?: boolean; page?: boolean }) {
  const repo = widgets.get(String(o.id))
  if (repo?.project) throw new Error(repoSays(repo, 'change it'))
  if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error('an id: lowercase letters, digits and dashes')
  const files = Object.entries(o.files && typeof o.files === 'object' && !Array.isArray(o.files) ? o.files : {})
  if (!files.length || files.length > 20) throw new Error('1 to 20 files')
  for (const [n, t] of files) {
    if (!(FILE.test(n) || FIXTURE.test(n)) || n.includes('..')) throw new Error(`${n}: a file's name in the extension's folder, no folders but fixtures/<name>.json`)
    if (typeof t !== 'string' || t.length > 256 << 10) throw new Error(`${n}: its text, up to 256 KB`)
  }
  const d = join(widgetHome(), o.id)
  const had = widgets.get(o.id)
  if (had && had.dir !== d) throw new Error(`${o.id} is ${had.builtin ? 'one that comes with Laki' : `in ${had.dir}`}: write a new one under another id`)
  const was = readStore(o.id)
  const theirs = !!statOf(d) && was.by !== 'ai' // the user's own: only after a fresh ask in its page's chat, and it stays theirs
  if (theirs && !(was.aiMay && Date.now() - was.aiMay < AI_MAY)) throw new Error(`${o.id} is the user's own (Laki AI didn't make it): write a new one under another id`) // theirs isn't overwritten
  const json = files.find(([n]) => n === 'widget.json')?.[1] as string | undefined
  if (json === undefined && !statOf(join(d, 'widget.json'))) throw new Error('a new extension needs widget.json')
  if (json !== undefined) {
    let m: unknown
    try {
      m = JSON.parse(json)
    } catch (e) {
      throw new Error(`widget.json: ${(e as Error).message}`)
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('widget.json: an object')
    const j = m as Manifest
    if (needsSample(j) && j.sample === undefined) throw new Error('widget.json: a sample too, made-up data in the shape its data takes, for its preview (laki_extension_guide)') // every extension shows how it looks before it runs
  }
  mkdirSync(widgetHome(), { recursive: true })
  const at = statOf(d)
  if (at && !at.isDirectory()) throw new Error(`${d} isn't a folder`)
  const runs = at && runsOf(d) // what it runs before: the same after, an extension that's on stays on
  snapshot(o.id, d)
  mkdirSync(d, { recursive: true })
  if (files.some(([n]) => n.startsWith('fixtures/'))) {
    const f = statOf(join(d, 'fixtures'))
    if (f && !f.isDirectory()) throw new Error('fixtures is a link or a file there')
    mkdirSync(join(d, 'fixtures'), { recursive: true })
  }
  for (const [n, t] of files) {
    const p = join(d, n)
    const was = statOf(p)
    if (was && !was.isFile()) throw new Error(`${n} is a link or a folder there`)
    writeFileSync(p, t as string)
    chmodSync(p, (t as string).startsWith('#!') ? 0o755 : 0o644) // a script with its interpreter's line runs as ./fetch.sh
  }
  const same = !!runs && runs === runsOf(d) // only its looks changed
  const stays = !!was.on && (same || (!o.agent && !!o.page)) // a new command stays on only from its page's chat (the user's): Laki AI elsewhere reads text it doesn't control
  writeStore(o.id, { ...readStore(o.id), on: stays, net: stays ? was.net : undefined, by: theirs ? was.by : 'ai', aiMay: theirs ? was.aiMay : undefined }) // net too, as it was; the user's own: its hour's leave stays (a write, a check, a fix)
  scanWidgets()
  wLog({ id: o.id }, `written: ${files.map(([n]) => n).join(', ')}; ${stays ? (same ? 'on still: what it runs is the same' : 'on still: it runs the new version') : "off until it's turned on"}`)
  return { ...widgetsView().find(w => w.id === o.id), note: stays ? (same ? 'Saved, still on: what it runs (its commands, scripts, prompts, handlers, settings) is the same as before' : 'Saved, still on: it runs the new version from its next fetch') : 'Saved turned off: the user looks at it on its page (Settings › Extensions, with its sample) and turns it on' }
}

// ---------- the studio (WidgetStudio.tsx): each write undoable, a copy to change, a name for a new one

// before each write: the folder as it was, <data>/widget-data/<id>.history/<ms>/ (none yet: an empty one with .none),
// the last HISTORY. widgetUndo puts one back
const HISTORY = 20
const KEPT = /^(\.git|node_modules)$/ // a folder's own, never in its versions: a snapshot, Undo and Remix leave them be
const fetching = (id: string) => [...running].some(k => k === id || k.startsWith(`${id}@`)) // it, or one of its instances
const histDir = (id: string) => join(dir, 'widget-data', `${id}.history`)
const hist = new Map<string, number[]>() // read once per id, then kept in step by snapshot, widgetUndo and widgetRm
export const historyOf = (id: string) => {
  let h = hist.get(id)
  if (!h) {
    try {
      h = readdirSync(histDir(id)).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b)
    } catch {
      h = []
    }
    hist.set(id, h)
  }
  return h
}
export function snapshot(id: string, d: string) {
  const all = historyOf(id)
  const at = Math.max(Date.now(), (all.at(-1) ?? 0) + 1) // two in one ms: still in order
  const to = join(histDir(id), String(at))
  if (statOf(d)?.isDirectory()) copyTree(d, to, p => dirname(p) !== d || !KEPT.test(basename(p))) // its fetch may be writing there
  else mkdirSync(to, { recursive: true }), writeFileSync(join(to, '.none'), '')
  for (const n of all.slice(0, Math.max(0, all.length + 1 - HISTORY))) rmSync(join(histDir(id), String(n)), { recursive: true, force: true })
  hist.delete(id)
}
// Undo (after: the first one taken after then, a turn's Undo to here; none: the newest): that one back, it and the
// newer ones gone. Laki's own folder only; off again, as a write leaves it, unless what it runs is the same
export function widgetUndo(o: { id: string; after?: number; agent?: boolean }) {
  if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error('an id: lowercase letters, digits and dashes')
  const all = historyOf(o.id)
  const at = o.after === undefined ? all.at(-1) : all.find(n => n > Number(o.after))
  if (at === undefined) throw new Error('nothing to undo')
  const d = join(widgetHome(), o.id)
  const had = widgets.get(o.id)
  if (had && had.dir !== d) throw new Error(`${o.id} isn't in Laki's folder`)
  if (fetching(o.id)) throw new Error(`${o.id} is fetching: try again in a moment`)
  if (statOf(d)?.isSymbolicLink()) throw new Error(`${d} is a link: not undone`)
  const from = join(histDir(o.id), String(at))
  const runs = runsOf(d)
  if (existsSync(join(from, '.none'))) rmSync(d, { recursive: true, force: true })
  else {
    for (const n of filesAndDirs(d)) if (!KEPT.test(n)) rmSync(join(d, n), { recursive: true, force: true }) // its node_modules and .git stay
    cpSync(from, d, { recursive: true, verbatimSymlinks: true })
  }
  for (const n of all.filter(n => n >= at)) rmSync(join(histDir(o.id), String(n)), { recursive: true, force: true })
  hist.delete(o.id)
  if (existsSync(storePath(o.id))) (st => writeStore(o.id, { ...st, on: !!st.on && (!o.agent || (!!runs && runs === runsOf(d))) }))(readStore(o.id)) // on stays on (the user's Undo), an agent's only while what it runs is the same
  scanWidgets()
  wLog({ id: o.id }, `undone: back to before ${new Date(at).toLocaleTimeString()}`)
  return { ok: true, at, gone: !widgets.has(o.id) }
}
// Remix: a copy in Laki's folder under a new id (any one's: built-in, a folder of yours), the user's own (not by Laki
// AI), off, with Laki AI's leave to rewrite it (aiMay). Not a one-file extension's (its file name is its id)
export function widgetRemix(o: { id: string; newId?: string }) {
  const w = find(String(o.id))
  if (w.file) throw new Error(`${w.m.name || w.id} is one file: copy ${w.file} and rename it`)
  const id = o.newId === undefined ? freeId(`${(w.project ? w.id.slice(w.project.length + 1) : w.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '') || 'extension'}-copy`) : String(o.newId) // a repo's: yours now, under its own name (a folder's My_Ext.v2: my-ext-v2)
  if (!ID.test(id)) throw new Error('an id: lowercase letters, digits and dashes')
  const d = join(widgetHome(), id)
  if (widgets.has(id) || statOf(d)) throw new Error(`${id} is taken`)
  mkdirSync(widgetHome(), { recursive: true })
  const src = realpathSync(w.dir) // a linked folder: what it links to, not the link
  copyTree(src, d, p => p === src || !KEPT.test(basename(p))) // its fetch may be writing there
  try {
    const m = JSON.parse(readFileSync(join(d, 'widget.json'), 'utf8'))
    writeFileSync(join(d, 'widget.json'), `${JSON.stringify({ ...m, name: `${m.name || w.id} (copy)` }, null, 2)}\n`)
  } catch {} // its scan says what's wrong
  writeStore(id, { on: false, aiMay: Date.now() })
  scanWidgets()
  wLog({ id }, `a copy of ${w.id}`)
  return { id }
}
// a new one's id from the first words of its first ask: lowercase, dashes, free (no extension, folder or chat of it)
const freeId = (base: string) => {
  const b = base.slice(0, 34).replace(/-+$/, '') || 'extension'
  for (let i = 1; ; i++) {
    const id = i === 1 ? b : `${b}-${i}`
    if (!widgets.has(id) && !statOf(join(widgetHome(), id)) && !statOf(join(dir, 'widget-data', `widget:${id}.chat.json`))) return id
  }
}
export const widgetSlug = (o: { text?: string }) => ({
  id: freeId(
    String(o.text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(x => x && !/^(a|an|the|my|me|show|make|of|for|with|to|and|in|on|i|want|please|that|which|as|is|at|from|by)$/.test(x))
      .slice(0, 3)
      .join('-'),
  ),
})
// a widget chat's file (ai.ts' thread): <data>/widget-data/widget:<id>.chat.json, gone with widgetRm
export const widgetChatFile = (chat: string) => {
  const m = /^widget:([a-z0-9][a-z0-9-]{0,39})$/.exec(chat)
  if (!m) throw new Error(`no chat ${chat}`)
  mkdirSync(join(dir, 'widget-data'), { recursive: true })
  return join(dir, 'widget-data', `${chat}.chat.json`)
}

// Settings › Extensions' Delete: its folder (a link: only the link; a one-file extension: its file), its store, its
// instances, its history, its chat and its secrets go to the trash (widgetRestore puts them back: Undo). Not one that
// comes with Laki (turn it off), nor a folder that holds more than it (your home, Laki's own). Its grants go for good
export async function widgetRm(o: { id: string }) {
  const w = find(o.id)
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: turn it off instead`)
  if (w.project) throw new Error(repoSays(w, 'remove it'))
  if (w.dev) throw new Error(`${w.m.name || w.id} is your code, linked by laki widget dev: unlink it instead (laki widget dev --off ${w.id})`)
  if (agents.has(w.id)) {
    stopAgents(w.id) // an agent at work: stopped, and its run ends before its files go
    for (let i = 0; i < 50 && (agents.has(w.id) || fetching(w.id)); i++) await new Promise(r => setTimeout(r, 100))
  }
  if (fetching(w.id)) throw new Error(`${w.m.name || w.id} is fetching: try again in a moment`)
  const d = resolve(pathOf(w))
  if (!w.file && [homedir(), dir, widgetHome(), '/'].includes(d)) throw new Error(`${d} isn't one extension's own folder`) // a widget.json put in one of those
  wLog(w, `deleted: ${d}, to the trash`)
  flushLogs() // its log goes with it, whole
  const at = Date.now()
  const t = join(trashDir(), `${w.id}-${at}`)
  mkdirSync(t, { recursive: true })
  const link = statOf(d)?.isSymbolicLink() ? readlinkSync(d) : undefined // made again on restore, never followed
  if (link) unlinkSync(d)
  else if (statOf(d)) move(d, join(t, 'ext'))
  for (const [from, to] of keptOf(w.id)) if (statOf(from)) move(from, join(t, to))
  const sec = secretsOf(w.id)
  if (Object.keys(sec).length) writeFileSync(join(t, 'secrets.json'), JSON.stringify(sec), { mode: 0o600 }), setSecrets(w.id, s => Object.keys(s).forEach(k => delete s[k]))
  writeFileSync(join(t, 'trash.json'), JSON.stringify({ id: w.id, name: w.m.name || w.id, from: d, ...(link && { link }), ...(w.file && { file: w.file }), at } satisfies Trashed))
  hist.delete(w.id)
  hashes.delete(w.id)
  pending.delete(w.id), lastN.delete(w.id), errAt.delete(w.id)
  ungrant(w.id)
  scanWidgets()
  return { deleted: w.id, trash: basename(t) }
}

// ---------- the trash: <data>/widget-trash/<id>-<ms>/ (ext: its folder or file; store.json, inst/, history/,
// chat.json, secrets.json; trash.json says what and from where). Kept TRASH_DAYS, the newest TRASH_MAX
type Trashed = { id: string; name: string; from: string; link?: string; file?: string; at: number }
const TRASH_DAYS = 30
const TRASH_MAX = 20
const trashDir = () => join(dir, 'widget-trash')
// what of an extension is kept beside its folder, and its name in the trash
const keptOf = (id: string): [string, string][] => [
  [storePath(id), 'store.json'],
  [join(dir, 'widget-data', id), 'inst'], // its workspaces' instances
  [histDir(id), 'history'], // the studio's Undo
  [join(dir, 'widget-data', `widget:${id}.chat.json`), 'chat.json'],
  [logPath(id), 'log'], // its log (flushLogs first)
  [`${logPath(id)}.1`, 'log.1'],
]
export function widgetTrash() {
  let names: string[] = []
  try {
    names = readdirSync(trashDir())
  } catch {}
  return names
    .flatMap(n => (m => (m ? [{ trash: n, ...m }] : []))(readJson<Trashed>(join(trashDir(), n, 'trash.json'))))
    .sort((a, b) => b.at - a.at)
}
// Undo: back where it was (its link made again), on or off as it was (an agent's: off, N10); refused when its id or its
// place is taken now
export function widgetRestore(o: { trash: string; from?: { ws?: string; tab?: string } }) {
  const n = String(o.trash ?? '')
  const m = /^[\w.-]+-\d+$/.test(n) ? readJson<Trashed>(join(trashDir(), n, 'trash.json')) : undefined
  if (!m) throw new Error(`no ${n} in the trash: laki widget trash lists it`)
  const t = join(trashDir(), n)
  if (widgets.has(m.id) || statOf(storePath(m.id))) throw new Error(`${m.id} is taken now: not restored`)
  if (statOf(m.from)) throw new Error(`${m.from} is there now: not restored`)
  mkdirSync(dirname(m.from), { recursive: true })
  if (m.link) symlinkSync(m.link, m.from)
  else if (statOf(join(t, 'ext'))) move(join(t, 'ext'), m.from)
  for (const [to, from] of keptOf(m.id)) if (statOf(join(t, from))) mkdirSync(dirname(to), { recursive: true }), move(join(t, from), to)
  const sec = readJson<Record<string, string>>(join(t, 'secrets.json'))
  if (sec) setSecrets(m.id, s => Object.assign(s, sec))
  const agent = !!agentCaller(o.from)
  if (agent) writeStore(m.id, { ...readStore(m.id), on: false }), ungrant(m.id)
  rmSync(t, { recursive: true, force: true })
  hist.delete(m.id)
  lastN.delete(m.id) // its log's n read again from its file
  scanWidgets()
  wLog(m, `restored from the trash: ${m.from}`)
  return { ...(widgetsView().find(w => w.id === m.id) ?? { id: m.id }), ...(agent && { note: 'restored off: only the user turns it on (Settings › Extensions)' }) }
}
// at start and hourly: past TRASH_DAYS, and past the newest TRASH_MAX, gone for good
export function widgetTrashTidy(now = Date.now()) {
  for (const [i, e] of widgetTrash().entries()) if (i >= TRASH_MAX || now - e.at > TRASH_DAYS * 86400e3) rmSync(join(trashDir(), e.trash), { recursive: true, force: true })
}
