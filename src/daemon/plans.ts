// Specs and brainstorms (on unless Settings › General › Pages turns them off: specsOn): a folder each, outside the
// repo and its worktrees, at <data>/plans/<project>/specs|brainstorms/<slug>/ (the project's folder kept as its `plans`). In it:
// spec.json (the app's editor: BlockNote's blocks and the title), README.md (the same as Markdown, what agents read;
// one newer than spec.json, written by someone else, is what the editor loads), files/ (what's pasted or drawn in it)
// and whatever Laki AI or an agent puts beside them (ideas.md, prototype-*.html, *.diagram.json): a brainstorm's output.
// The app's Specs page and a project's Specs tab; MCP's laki_plans, laki_plan_read, laki_plan_new, laki_plan_write.
// ponytail: a removed project's plans stay in <data>/plans (they're the user's documents); a project added again with
// the same id finds them
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { PLAN_KINDS, type Plan, type PlanFile, type PlanKind, specsOn } from '../shared/types.ts'
import { dir, findProject, IMAGES, save, slug, state } from './core.ts'
import { urlKey, urlKeyOk } from './widgets.ts'

type Ref = { project: string; kind: PlanKind; slug: string }
const FOLDER: Record<PlanKind, string> = { spec: 'specs', brainstorm: 'brainstorms' }
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const OWN = ['spec.json', 'README.md', '.chat.json'] // the editor's and its chat's: never an agent's to write
const WRITABLE = ['.md', '.html', '.txt', '.json', '.csv', '.svg', '.mmd'] // what laki_plan_write may make
const MAX_WRITE = 2 << 20
const MAX_TEXT = 2 << 20

const on = () => {
  if (!specsOn(state.settings)) throw new Error('Specs & Brainstorms are off: turn them on in Settings › General › Pages')
}

// a project's plans folder: <data>/plans/<name>-<id> (just <id> when that's its name), made at its first plan and kept
function rootOf(ref: string, make: boolean) {
  const p = findProject(ref)
  if (p.kind) throw new Error('Terminals and Browsers have no specs')
  if (!p.plans && make) {
    const name = slug(p.name)
    p.plans = join(dir, 'plans', name && name !== p.id ? `${name}-${p.id}` : p.id)
    save()
  }
  return { p, root: p.plans }
}

function folderOf(o: Ref, make = false) {
  if (!PLAN_KINDS.includes(o.kind)) throw new Error(`kind: spec or brainstorm, not ${o.kind}`)
  if (!SLUG.test(String(o.slug))) throw new Error(`${o.slug}: not a spec's name`)
  const { root } = rootOf(o.project, make)
  const at = root && join(root, FOLDER[o.kind], o.slug)
  if (!at || (!make && !existsSync(at))) throw new Error(`no ${o.kind} ${o.slug} in ${o.project}`)
  return at
}

// a path in the plan's folder, links followed (as core's inside does for a workspace)
function inside(folder: string, rel: string) {
  const abs = resolve(folder, String(rel ?? ''))
  if (abs.startsWith(folder + sep))
    try {
      let up = abs
      while (!lstatSync(up, { throwIfNoEntry: false })) up = dirname(up)
      const root = realpathSync(folder)
      const real = realpathSync(up)
      if (real === root || real.startsWith(root + sep)) return abs
    } catch {}
  throw new Error(`${rel}: not a path in the ${basename(folder)} folder`)
}

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return null
  }
}
const mtime = (f: string) => statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0

// the editor's doc, if it's there and reads
function docOf(folder: string): { title?: string; blocks?: unknown[] } | null {
  const d = readJson(join(folder, 'spec.json'))
  return d && typeof d === 'object' && Array.isArray(d.blocks) ? d : null
}
const headOf = (md: string | null) => md?.match(/^#\s+(.+)$/m)?.[1].trim()

// every file but the editor's own, hidden ones and their folders left out, newest first (500 at most)
function filesOf(folder: string): PlanFile[] {
  const out: PlanFile[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || out.length >= 500) continue
      const abs = join(d, e.name)
      const path = relative(folder, abs)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile() && !OWN.includes(path) && !path.endsWith('.tmp')) {
        const st = statSync(abs)
        out.push({ path, size: st.size, at: st.mtimeMs })
      }
    }
  }
  walk(folder)
  return out.sort((a, b) => b.at - a.at)
}

function planOf(project: string, kind: PlanKind, s: string, folder: string, doc = docOf(folder)): Plan {
  const md = read(join(folder, 'README.md'))
  return { project, kind, slug: s, title: doc?.title || headOf(md) || s, at: Math.max(mtime(join(folder, 'spec.json')), mtime(join(folder, 'README.md'))), path: folder, files: filesOf(folder).length }
}

export function planList(o: { project?: string } = {}): Plan[] {
  on()
  const out: Plan[] = []
  for (const p of o.project ? [findProject(o.project)] : state.projects) {
    if (!p.plans) continue
    for (const kind of PLAN_KINDS) {
      const at = join(p.plans, FOLDER[kind])
      for (const e of existsSync(at) ? readdirSync(at, { withFileTypes: true }) : []) if (e.isDirectory() && SLUG.test(e.name)) out.push(planOf(p.id, kind, e.name, join(at, e.name)))
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

// a new one: a folder named by its title, README.md with it and text (a template's, or none: empty)
export function planNew(o: { project: string; kind: PlanKind; title?: string; text?: string }): Plan {
  on()
  const title = String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || (o.kind === 'brainstorm' ? 'Untitled brainstorm' : 'Untitled spec')
  const base = slug(title) || o.kind
  let s = base
  for (let n = 2; existsSync(folderOf({ ...o, slug: s }, true)); n++) s = `${base}-${n}`
  const folder = folderOf({ ...o, slug: s }, true)
  writeAtomic(join(folder, 'README.md'), `# ${title}\n\n${typeof o.text === 'string' && o.text.trim() ? `${o.text.trim()}\n` : ''}`)
  return planOf(findProject(o.project).id, o.kind, s, folder)
}

// one to open: the editor's doc, README.md (outside: newer than the doc, or no doc: the editor loads it), its files
export function planGet(o: Ref) {
  on()
  const folder = folderOf(o)
  const doc = docOf(folder)
  const markdown = read(join(folder, 'README.md')) ?? ''
  const outside = !doc || mtime(join(folder, 'README.md')) > mtime(join(folder, 'spec.json')) + 1000
  const id = findProject(o.project).id
  return { plan: planOf(id, o.kind, o.slug, folder, doc), doc, markdown, outside, files: filesOf(folder), key: urlKey(planScope(id, o.kind, o.slug)) } // key: its prototypes' pages
}
const planScope = (project: string, kind: string, slug: string) => `plan:${project}/${kind}/${slug}`

// the editor's save: its blocks and title, and README.md from its Markdown
export function planSave(o: Ref & { title?: string; blocks: unknown[]; markdown?: string }) {
  on()
  if (!Array.isArray(o.blocks)) throw new Error('blocks: a list')
  const folder = folderOf(o)
  const title = String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || o.slug
  writeAtomic(join(folder, 'spec.json'), JSON.stringify({ title, blocks: o.blocks }))
  writeAtomic(join(folder, 'README.md'), `# ${title}\n\n${String(o.markdown ?? '').trim()}\n`)
  return planOf(findProject(o.project).id, o.kind, o.slug, folder)
}

// a file of it: text (2 MB at most), an image as a data URL (10 MB), else its size
export function planFile(o: Ref & { path: string }) {
  on()
  const abs = inside(folderOf(o), o.path)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`${o.path} isn't a file`)
  const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
  if (mime) return st.size > 10 << 20 ? { size: st.size } : { size: st.size, image: `data:${mime};base64,${readFileSync(abs).toString('base64')}` }
  const buf = readFileSync(abs).subarray(0, MAX_TEXT)
  return buf.subarray(0, 8000).includes(0) ? { size: st.size } : { size: st.size, text: buf.toString('utf8'), cut: st.size > MAX_TEXT || undefined }
}

// what's pasted, dropped or drawn in the editor (base64): files/<random>-<name>, the path for its block
export function planUpload(o: Ref & { name: string; data: string }) {
  on()
  const folder = folderOf(o)
  const name = String(o.name ?? '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '').slice(-80) || 'file'
  const path = `files/${Date.now().toString(36)}-${name}`
  writeAtomic(inside(folder, path), Buffer.from(String(o.data ?? ''), 'base64'))
  return { path }
}

// an agent's or Laki AI's output (a brainstorm's ideas, a prototype, a diagram): a text file of WRITABLE's kinds, never
// the editor's own (spec.json, README.md: the brief is the user's)
export function planWrite(o: Ref & { path: string; text: string }) {
  on()
  const folder = folderOf(o)
  const abs = inside(folder, String(o.path ?? '').trim())
  const rel = relative(folder, abs) // ./README.md and x/../spec.json are the editor's too
  if (OWN.includes(rel)) throw new Error(`${rel} is the user's (the editor's); write another file beside it`)
  if (!WRITABLE.includes(extname(rel).toLowerCase())) throw new Error(`${rel}: only ${WRITABLE.join(' ')} files`)
  const text = String(o.text ?? '')
  if (Buffer.byteLength(text) > MAX_WRITE) throw new Error('over 2 MB')
  writeAtomic(abs, text)
  return { path: rel, folder }
}

// a chat's id (shared/plans.ts planChat): its spec or brainstorm, folder and file (daemon/ai.ts keeps the chat there)
export function planOfChat(id: string) {
  const m = /^plan:([\w.-]+)\/(spec|brainstorm)\/([\w-]+)$/.exec(id)
  if (!m) throw new Error(`no chat ${id}`)
  on()
  const ref: Ref = { project: m[1], kind: m[2] as PlanKind, slug: m[3] }
  const folder = folderOf(ref)
  return { ...ref, folder, file: join(folder, '.chat.json') }
}

// the app's Delete, after its confirm (never MCP's nor Laki AI's): the folder and everything in it
export function planRm(o: Ref) {
  on()
  rmSync(folderOf(o), { recursive: true, force: true })
}

// GET /plan/<project>/<kind>/<slug>/<file>.html?key=…: a prototype's page in the app's sandboxed frame, with the CSP
// a JS widget's page has (an origin of its own, inline scripts and styles, images as data:, fonts from Google's; no
// requests out: not even an image, which would carry its URL's key): it never reaches the app, the daemon or the user's files
export function planPage(path: string, query: URLSearchParams): { code: number; headers: Record<string, string>; body: string } {
  const bad = (code: number, body: string) => ({ code, headers: { 'content-type': 'text/plain' }, body })
  const m = /^\/plan\/([\w.-]+)\/(spec|brainstorm)\/([\w-]+)\/(.+\.html?)$/.exec(path)
  const id = (() => {
    try {
      return m && findProject(decodeURIComponent(m[1])).id
    } catch {
      return undefined
    }
  })()
  if (!m || !id || !urlKeyOk(query.get('key'), planScope(id, m[2], m[3]))) return bad(401, 'bad key') // this plan's own key
  let body: string
  try {
    const file = planFile({ project: decodeURIComponent(m[1]), kind: m[2] as PlanKind, slug: m[3], path: decodeURIComponent(m[4]) })
    if (file.text === undefined) throw new Error('not text')
    body = file.text
  } catch {
    return bad(404, 'no such page')
  }
  return {
    code: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data:; font-src data: https://fonts.gstatic.com",
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
    body,
  }
}
