// what a Yes holds for: an extension's files hashed (filesHash), a repo's whole folder (repoFiles, dirHash), and what a
// turn-on question shows (widgetWhat). widgets.ts re-exports it.

import { basename, join } from 'node:path'
import { type Dirent, readdirSync, readFileSync, realpathSync, type Stats, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { actionCmd, gateOf, globMatch } from '../shared/widgetSchema.ts'
import { hasScript } from '../shared/widget.ts'
import { type Entry, find, guarded, type Manifest, manifestOf, oneFile, onOf, scanWidgets, sourceOf, under, widgets } from './widgets.ts'
import { gatesOf } from './widgetEvents.ts'

// what turning one on starts, in words, its command or prompt as a code block (a code span breaks on its backticks or
// lines): Laki AI's Yes / No says it (aiQuestion), and a Yes turns it on only while it still says the same and its
// files are the ones it was asked about (aiAnswer: hash, filesHash; widgetSet's seen)
export function widgetWhat(id: string) {
  let w = find(id)
  // its widget.json as it is on disk now (a change the scan hasn't read yet): what's shown is what the hash covers
  const disk = w.file ? oneFile(w.dir, w.file) : manifestOf(w.dir)
  if (typeof disk === 'string') throw new Error(`${w.m.name || w.id}: ${disk}`)
  if (JSON.stringify(disk) !== JSON.stringify(w.m)) scanWidgets(), (w = find(id))
  const hash = filesHash(w, true) // first: a change while it's read gives a hash a Yes can't match
  const src = sourceOf(w)
  const fetch = w.m.script ? `node ${w.m.script}` : w.m.fetch
  const [runs, code]: [string, string?] =
    src.kind === 'static' ? ['runs nothing: its data is typed in']
    : src.kind === 'file' ? ['reads this file', src.path]
    : src.kind === 'url' ? ['fetches this URL', src.url]
    : src.kind === 'ai' ? [`asks an agent this${src.tools ? `, with ${src.tools.replace(/[`*_[\]]/g, '')}` : ''}`, src.prompt && src.prompt.length > 1500 ? `${src.prompt.slice(0, 1500)}…` : src.prompt]
    : fetch ? [`runs this${w.m.stream ? ' and keeps it running' : ''}`, fetch]
    : ['runs nothing (no fetch)']
  const fence = '`'.repeat(Math.max(3, ...[...(code ?? '').matchAll(/`+/g)].map(m => m[0].length + 1))) // longer than any run in it
  const events = Object.keys(w.m.on ?? {}).map(e => `\`${e.replace(/`/g, '')}\``) // its actions run on these, unclicked
  const holds = [...new Set(gatesOf(w).flatMap(([, a]) => gateOf(a)))] // its gates: it can hold these
  const text = `It ${runs}${code ? `:\n\n${fence}\n${code}\n${fence}` : '.'}${events.length ? `\n\nThese events run its actions too: ${events.join(', ')}.` : ''}${holds.length ? `\n\nIt can hold a workspace's ${holds.join(', ')}: its gate runs before each.` : ''}${guarded(w) ? repoShown(w) : ''}`
  return { name: w.m.name || w.id, on: onOf(w), text, hash }
}

// a repo's (not yours, not Laki's): its actions' commands, every file trusting it covers by name, and the text of the
// ones it runs (named in its fetch, script or an action's command, executable, or a script outside node_modules), what
// you say yes to
function repoShown(w: Entry) {
  const block = (t: string) => (f => `${f}\n${t}\n${f}`)('`'.repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))))
  const acts = Object.entries(w.m.actions ?? {}).flatMap(([k, a]) => (c => (c ? [`${k}: ${c}`] : []))(actionCmd(a)))
  const all = w.file ? { names: [w.file] } : repoFiles(w)
  const cmds = [w.m.fetch, w.m.script, ...Object.values(w.m.actions ?? {}).map(a => actionCmd(a))].filter(Boolean).join('\n')
  const runs = (n: string) => n === w.m.script || cmds.includes(n) || (!/(^|\/)node_modules\//.test(n) && (cmds.includes(basename(n)) || SCRIPT.test(n))) || ((statSync(join(w.dir, n), { throwIfNoEntry: false })?.mode ?? 0) & 0o111) !== 0
  let left = 12_000
  const files = (w.file ? [] : all.names.sort())
    .filter(n => n !== 'widget.json' && runs(n))
    .flatMap(n => {
      let t = ''
      try {
        t = readFileSync(join(w.dir, n), 'utf8')
      } catch {
        return []
      }
      if (t.includes('\0')) return [`${n}: not text`]
      const cut = t.length > Math.min(3000, left) ? `${t.slice(0, Math.max(0, Math.min(3000, left)))}\n…` : t
      left -= cut.length
      return [`${n}:\n\n${block(cut.trimEnd())}`]
    })
  const bad = 'bad' in all && all.bad ? `\n\nIt can't be trusted: ${all.bad}.` : ''
  const ig = w.project && !w.file ? ignoredOf(w, all.names) : []
  const state = stateOf(w.m)
  const said = `${ig.length ? `\n\nOf those, the repo ignores (an agent in it could write them):\n\n${block(ig.join('\n'))}` : ''}${state.length ? `\n\nLeft out as what it writes (its state): ${state.join(', ')}` : ''}`
  return `${acts.length ? `\n\nIts actions run:\n\n${block(acts.join('\n'))}` : ''}${files.length ? `\n\nWhat it runs:\n\n${files.join('\n\n')}` : ''}\n\nEvery file it's trusted as (a change to any turns it off):\n\n${block(all.names.sort().join('\n'))}${said}${bad}`
}
// what a Yes holds for (filesHash): the extension's own files (widgetFiles' list, all of them, sorted) and what it runs
// that lives outside them (the store's source; its manifest as read: actions, on, stream…; net), so an edit asks again, one made
// while Laki was closed too (sh do.sh with do.sh changed). Laki AI's turn-on question, widgetSet's seen, a tool's ask and
// an Always's key (grantKey) all compare it. fresh: read now (a check), else as long as their sizes and times are the
// same (the view's). ponytail: its folder's top level and fixtures only, not a lib/ its script sources
export const hashes = new Map<string, { sig: string; hash: string }>()
export function filesHash(w: Entry, fresh = false) {
  const cur = widgets.get(w.id) ?? w // its store as it is now: a source set meanwhile counts
  const out = JSON.stringify([sourceOf(cur), cur.m, !!cur.s.net]) // its manifest as read (widgetWhat's text is made from it)
  return createHash('sha256').update(`${dirHash(w, fresh)}\0${out}`).digest('hex')
}
// what an extension in its folder runs, for a rewrite (widgetWrite, widgetUndo): its manifest's commands, prompts,
// handlers and settings, and every file of it but its looks (widget.html without a script, fixtures, Markdown). A rewrite
// that changes none of it keeps it on (a look, a label, its ui); undefined: no widget.json that reads
export function runsOf(d: string) {
  const m = manifestOf(d)
  if (typeof m === 'string') return
  const said = JSON.stringify([m.fetch, m.script, m.source, m.stream, m.on, m.actions, m.config, m.scope])
  const h = createHash('sha256').update(said)
  for (const n of filesUnder(d).sort()) {
    if (n === 'widget.json' || ((n.startsWith('fixtures/') || /\.md$/i.test(n)) && !said.includes(n))) continue // a look, unless a command names it
    let t: Buffer
    try {
      t = readFileSync(join(d, n))
    } catch {
      continue
    }
    if (n === 'widget.html' && !hasScript(t.toString('utf8'))) continue // a template: sanitized, runs nothing
    h.update(`\0${n}\0`).update(t)
  }
  return h.digest('hex')
}
// its own files' hash (cached by their times and sizes): a repo's extension's trust
// every file under its folder, relative, a folder's files before its subfolders (a link as a file): none hidden, no
// node_modules (a repo's: repoFiles). ponytail: max files at most, a change past them isn't seen
const filesUnder = (d: string, max = 500, rel = '', out: string[] = []) => {
  let es: Dirent[] = []
  try {
    es = readdirSync(join(d, rel), { withFileTypes: true })
  } catch {}
  es = es.filter(x => !x.name.startsWith('.') && x.name !== 'node_modules')
  for (const x of es) if (out.length < max && !x.isDirectory() && (x.isFile() || x.isSymbolicLink())) out.push(rel ? `${rel}/${x.name}` : x.name)
  for (const x of es) if (out.length < max && x.isDirectory()) filesUnder(d, max, rel ? `${rel}/${x.name}` : x.name, out)
  return out
}
// a repo's extension, what trusting it covers (#4): every file under its folder, what git tracks, what it doesn't and
// what the repo ignores (git ls-files --stage and --others --directory: a submodule (a gitlink) and an untracked folder,
// a nested repo too, walked file by file), but its state: what widget.json's "state" names (globs, relative to its
// folder; one with a trailing / a folder) and STATE's clutter, unless it's what it runs (widget.json, its script, a file
// a command names, an executable). Not in a repo (git fails): the same walk from its folder, hidden ones left out. An
// agent's linked folder: the walk, hidden files and node_modules too (code it could hide there). Links: one to a folder
// followed while it stays inside (realpath, each folder once), one to a file as the file. bad: why it can't be trusted
// (a file or link out of it, past REPO_MAX files: a change past them wouldn't be seen)
const REPO_MAX = 2000
const SCRIPT = /\.(sh|bash|zsh|fish|py|rb|pl|php|js|mjs|cjs|ts|mts|lua)$/i
const STATE = ['.DS_Store', '__pycache__/', '*.pyc'] // every folder's; a repo's node_modules/ too (not an agent's)
const stateOf = (m: Manifest) => (Array.isArray(m.state) ? m.state.filter((g): g is string => typeof g === 'string' && !!g.trim()) : [])
// a glob of state: without a /, any file or folder by name; with one, by its path; a trailing /, a folder and all in it
function stateHas(globs: string[], n: string, dir = false) {
  const parts = n.split('/')
  const ups = parts.slice(0, dir ? parts.length : -1).map((_, i) => parts.slice(0, i + 1).join('/')) // the folders it's in (and itself)
  return globs.some(g => (g.endsWith('/') ? ups.some(u => globMatch(g.slice(0, -1), u)) : globMatch(g, n) || ups.some(u => globMatch(g, u))))
}
export function repoFiles(w: Entry): { names: string[]; bad?: string } {
  const d = w.dir
  let top = d
  try {
    top = realpathSync(d)
  } catch {}
  const cmds = [w.m.fetch, ...Object.values(w.m.actions ?? {}).map(a => actionCmd(a))].filter(Boolean).join(' ')
  const named = cmds.split(/[\s'"`;|&()<>=]+/).map(t => t.replace(/^\.\//, '')).filter(t => t && !/^[-/$~]/.test(t) && !t.split('/').includes('..'))
  const stats = new Map<string, Stats | undefined>()
  const file = (n: string) => (stats.has(n) ? stats.get(n) : (st => (stats.set(n, st), st))(statSync(join(d, n), { throwIfNoEntry: false }))) // each file once a scan
  const runs = new Set(['widget.json', w.m.script ?? '', ...named.filter(n => SCRIPT.test(n) || ((file(n)?.mode ?? 0) & 0o111) !== 0)].filter(n => n && file(n)?.isFile())) // a cache.json a command cats isn't code
  const globs = [...STATE, ...(w.agentDev ? [] : ['node_modules/']), ...stateOf(w.m)]
  const kept = (n: string) => runs.has(n) || (file(n)?.isFile() && ((file(n)?.mode ?? 0) & 0o111) !== 0) || !stateHas(globs, n)
  const names = new Set<string>()
  let bad: string | undefined
  // up: the folders it's in now (a link back to one of them would loop)
  const walk = (rel: string, up: Set<string>, hidden: boolean) => {
    let real = join(top, rel)
    try {
      real = realpathSync(join(d, rel))
    } catch {}
    if (up.has(real)) return
    up = new Set(up).add(real)
    let es: Dirent[] = []
    try {
      es = readdirSync(join(d, rel), { withFileTypes: true })
    } catch {}
    const subs: string[] = []
    for (const x of es.filter(x => x.name !== '.git' && (hidden || !x.name.startsWith('.')))) {
      if (bad) return
      const n = rel ? `${rel}/${x.name}` : x.name
      let dir = x.isDirectory()
      if (x.isSymbolicLink()) {
        let to: string
        try {
          to = realpathSync(join(d, n))
        } catch {
          names.add(n) // a broken link: its name only
          continue
        }
        if (!under(to, top)) return void (bad = `${n} links out of its folder (to ${to})`)
        dir = statSync(to, { throwIfNoEntry: false })?.isDirectory() ?? false
        if (dir) names.add(n) // the link itself, as git lists it
      }
      if (dir) !stateHas(globs, n, true) && subs.push(n)
      else if (kept(n) && names.add(n).size > REPO_MAX) return void (bad = `more than ${REPO_MAX} files`)
    }
    for (const n of subs) if (!bad) walk(n, up, hidden)
  }
  let listed: string[] | undefined
  const trees: string[] = [] // a submodule, an untracked folder (a nested repo too): walked
  if (w.project && !w.agentDev) try { // an agent's folder: never git's listing, whose .gitignore it writes
    // ponytail: two sync gits per run (trusted), as the walk was; cache by the index's and the folder's mtimes if it shows
    const ls = (...a: string[]) => execFileSync('git', ['ls-files', '-z', ...a, '--', '.'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 16 << 20 }).split('\0').filter(Boolean)
    const staged = ls('--stage') // <mode> <sha> <stage>\t<path>: 160000, a gitlink
    const others = ls('--others', '--directory') // ignored ones too; a folder git has nothing of as <dir>/
    listed = []
    for (const l of staged) (l.startsWith('160000 ') ? trees : listed).push(l.slice(l.indexOf('\t') + 1))
    for (const n of others) (n.endsWith('/') ? trees : listed).push(n === './' ? '' : n.replace(/\/$/, '')) // ./: its folder isn't git's at all
  } catch {}
  if (listed) {
    for (const n of listed) if (kept(n)) names.add(n)
    for (const n of trees) if (!bad && (!n || !stateHas(globs, n, true))) walk(n, new Set(), true)
    for (const n of runs) names.add(n) // named, though in a folder of its state (node_modules/.bin/x)
    if (bad) return { names: [...names], bad }
    if (names.size > REPO_MAX) return { names: [...names].slice(0, REPO_MAX), bad: `more than ${REPO_MAX} files` }
    for (const n of names) {
      let to: string
      try {
        to = realpathSync(join(d, n))
      } catch {
        continue // gone, or a broken link: its name only
      }
      if (!under(to, top)) return { names: [...names], bad: `${n} links out of its folder (to ${to})` }
    }
    return { names: [...names] }
  }
  walk('', new Set(), !!w.agentDev)
  return { names: [...names], bad }
}
// a repo's files that git ignores, of those it's trusted as: repoShown names them (a change turns it off; what it writes
// belongs in its state)
function ignoredOf(w: Entry, names: string[]) {
  try {
    const ig = new Set(execFileSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', '.'], { cwd: w.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 16 << 20 }).split('\0'))
    return names.filter(n => ig.has(n)).sort()
  } catch {
    return []
  }
}
// a repo's that can't be trusted (repoFiles' bad): never on
export function repoBad(w: Entry) {
  return guarded(w) && !w.file ? repoFiles(w).bad : undefined
}
// a repo's: each file's own hash (12 hex), kept as it's turned on: what changed, untrust names
export function eachHash(w: Entry, names = w.file ? [w.file] : repoFiles(w).names) {
  return Object.fromEntries(names.map(n => [n, (() => {
    try {
      return createHash('sha256').update(readFileSync(join(w.dir, n))).digest('hex').slice(0, 12)
    } catch {
      return ''
    }
  })()]))
}
// a repo's file list for the view (grants' keys, built often): git at most every 2 s; a run's, an ask's, a turn-on's fresh
const listings = new Map<string, { at: number; names: string[] }>()
function repoNames(w: Entry, fresh: boolean) {
  const c = listings.get(w.id)
  if (!fresh && c && Date.now() - c.at < 2000) return c.names
  const names = repoFiles(w).names
  listings.set(w.id, { at: Date.now(), names })
  return names
}
export function dirHash(w: Entry, fresh = false, known?: string[]) {
  const names = (known ? [...known] : w.file ? [w.file] : guarded(w) ? repoNames(w, fresh) : filesUnder(w.dir)).sort() // its subfolders too: a lib/ script a fetch runs
  const sig = JSON.stringify(names.map(n => (st => [n, st?.mtimeMs, st?.size])(statSync(join(w.dir, n), { throwIfNoEntry: false }))))
  let c = hashes.get(w.id)
  if (fresh || c?.sig !== sig) {
    const h = createHash('sha256')
    for (const n of names) {
      h.update(`\0${n}\0`)
      try {
        h.update(readFileSync(join(w.dir, n)))
      } catch {}
    }
    hashes.set(w.id, (c = { sig, hash: h.digest('hex') }))
  }
  return c!.hash
}
