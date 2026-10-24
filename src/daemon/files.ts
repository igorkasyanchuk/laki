// a worktree's files: the diff against its base and its size, Changes' revert and redo, and the side panel's tree,
// reads and writes. core.ts re-exports it.

import { randomBytes } from 'node:crypto'
import { closeSync, type Dirent, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { type Stat, type Workspace } from '../shared/types.ts'
import { changed, exec, findWs, firstLine, git, q, run, state, within } from './core.ts'
import { away, hostUp, sshIn } from './hosts.ts'

// ---------- the diff against the base

// what a workspace's changes are against: a worktree's merge base with its base branch, else HEAD
const diffBase = (ws: Workspace) => (ws.kind === 'worktree' ? git(ws, 'merge-base', ws.base, 'HEAD').catch(() => 'HEAD') : Promise.resolve('HEAD'))

// the text as git wrote it but its last newline (git() trims: a last line's trailing spaces would go, and a hunk to
// revert would no longer match the file)
export async function diff(ref: string) {
  const ws = findWs(ref)
  const from = await diffBase(ws)
  const [text, numstat, untracked] = await Promise.all([
    exec(ws, 'git', ['diff', '--no-color', '--no-ext-diff', '-M', from]).then(r => r.stdout.replace(/\n$/, '')),
    git(ws, 'diff', '--numstat', '-M', from),
    git(ws, 'ls-files', '--others', '--exclude-standard'),
  ])
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [add, del, ...p] = l.split('\t')
      return { path: p.join('\t'), add: Number(add) || 0, del: Number(del) || 0, status: 'M' }
    })
  let out = text
  const newFiles = untracked.split('\n').filter(Boolean).slice(0, 100)
  // a host's in one go, each after a NUL (git's diff of a file with one says Binary files … differ)
  const each = 'for f; do printf "\\000"; git diff --no-color --no-index -- /dev/null "$f"; done; true'
  const diffs = !ws.host
    ? await Promise.all(
        newFiles.map(f =>
          run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: ws.path, maxBuffer: 16 << 20 }).then(
            r => r.stdout,
            e => String(e.stdout ?? ''), // exit 1: there are differences
          ),
        ),
      )
    : newFiles.length
      ? await exec(ws, 'sh', ['-c', each, 'sh', ...newFiles]).then(r => r.stdout.split('\0').slice(1), () => [])
      : []
  for (const [i, f] of newFiles.entries()) {
    const d = diffs[i] ?? ''
    out += (out ? '\n' : '') + d.replace(/\n$/, '')
    files.push({ path: f, add: d.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length, del: 0, status: 'A' })
  }
  const MAX = 4 << 20
  return { base: ws.base, from, files, diff: out.length > MAX ? out.slice(0, MAX) + CUT : out }
}
const CUT = '\n… (cut)'

// ---------- revert: Changes' hunks, a few lines of one, or a whole file back to the base, each with an Undo

// a patch to take back (git apply -R), or files as they were (a blob's id, none: there was no file)
type Undo = { id: string; at: number; patch?: string; files?: { path: string; blob?: string }[] }
const undos = new Map<string, Undo[]>() // ponytail: in memory, a daemon restart loses them
const UNDOS = 20 // per workspace
function keepUndo(ws: Workspace, u: Omit<Undo, 'id' | 'at'>) {
  const id = randomBytes(6).toString('hex')
  undos.set(ws.id, [...(undos.get(ws.id) ?? []), { ...u, id, at: Date.now() }].slice(-UNDOS))
  return { id }
}
const gitWs = (ref: string) => {
  const ws = findWs(ref)
  if (state.projects.find(p => p.id === ws.project)?.git === false) throw new Error(`${ws.name}: not a git repo, no changes to revert`)
  return ws
}
// git apply of a patch in the workspace (-R: taken back), --check first: a failure is git's first line
async function apply(ws: Workspace, patch: string, reverse = false) {
  const args = ['apply', ...(reverse ? ['-R'] : [])]
  if (ws.host) {
    const h = await hostUp(ws.host)
    const cmd = (more: string) => `export PATH=${q(h.path)}; cd ${q(ws.path)} && git ${[...args, ...(more ? [more] : []), '-'].join(' ')}`
    for (const more of ['--check', '']) await sshIn(ws.host, cmd(more), patch).catch(e => { throw new Error(firstLine(e)) })
    return
  }
  const f = join(tmpdir(), `laki-${randomBytes(6).toString('hex')}.patch`)
  writeFileSync(f, patch, { mode: 0o600 })
  try {
    for (const more of [['--check'], []]) await run('git', [...args, ...more, f], { cwd: ws.path }).catch(e => { throw new Error(firstLine(e)) })
  } finally {
    rmSync(f, { force: true })
  }
}

// hunkUndo: one hunk of Changes back to the base: the diff read again (diff's own: a pathspec would break -M's renames,
// and the hunk wouldn't be what Changes showed), the hunk found by its text (the @@ line and its body, \r kept), then a
// forward patch from the worktree to the base. lines: indexes into its body (0: the line after @@), none: all of it
export async function hunkUndo(o: { ws: string; path: string; hunk: string; lines?: number[] }) {
  const ws = gitWs(o.ws)
  inside(ws, String(o.path ?? ''))
  if (typeof o.hunk !== 'string' || !o.hunk.startsWith('@@')) throw new Error('which hunk?')
  const changed = new Error(`${o.path} changed since you looked: refresh Changes`)
  const { diff: text } = await diff(ws.id)
  const all = text.split('\n')
  const start = all.findIndex(l => l.startsWith('diff --git a/') && l.endsWith(` b/${o.path}`))
  if (start < 0) throw changed
  let end = all.findIndex((l, i) => i > start && l.startsWith('diff --git '))
  if (end < 0) {
    if (text.endsWith(CUT)) throw changed // the file runs into the 4 MB cut: its hunks may be whole only in part
    end = all.length
  }
  const head = all.slice(start, end)
  const at = head.findIndex(l => l.startsWith('@@'))
  if (at < 0) throw changed // binary, or only a rename
  const meta = head.slice(0, at)
  const hunks: string[][] = []
  for (const l of head.slice(at)) l.startsWith('@@') ? hunks.push([l]) : hunks.at(-1)!.push(l)
  const hunk = hunks.find(h => h.join('\n') === o.hunk)
  if (!hunk) throw changed
  const mode = (k: string) => meta.find(l => l.startsWith(`${k} file mode `))?.slice(k.length + 11)
  const [added, deleted] = [mode('new'), mode('deleted')]
  const body = hunk.slice(1)
  if (o.lines !== undefined && (!Array.isArray(o.lines) || !o.lines.every(i => Number.isInteger(i) && i >= 0 && i < body.length))) throw new Error('lines: indexes into the hunk')
  const lines = o.lines && new Set(o.lines)
  if (lines && deleted) throw new Error(`${o.path} was deleted: it comes back whole or not at all`)
  // each line as the undo patch has it: what the agent added goes, what it took out comes back, the rest stays;
  // \ No newline at end of file follows the line before it
  const out: string[] = []
  let kept = false
  for (const [i, l] of body.entries()) {
    const picked = !lines || lines.has(i)
    if (l[0] === '\\') kept && out.push(l)
    else if (l[0] === '+') (kept = true), out.push((picked ? '-' : ' ') + l.slice(1))
    else if (l[0] === '-') (kept = picked) && out.push('+' + l.slice(1))
    else (kept = true), out.push(l)
  }
  if (!out.some(l => l[0] === '+' || l[0] === '-')) throw new Error('pick a line the agent added or took out')
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunk[0])
  if (!h) throw changed
  const first = Number(h[2] ?? 1) ? Number(h[1]) : Number(h[1]) + 1 // the hunk's first line in the worktree (a count of 0: the line before it)
  const a = out.filter(l => l[0] === ' ' || l[0] === '-').length
  const b = out.filter(l => l[0] === ' ' || l[0] === '+').length
  const s = (n: number) => `${n ? first : first - 1},${n}` // git's: with no lines, the start is the line before
  const p = o.path
  const gone = added && !lines // a new file taken whole: it goes
  const fileHead = [`diff --git a/${p} b/${p}`, ...(gone ? [`deleted file mode ${added}`] : deleted ? [`new file mode ${deleted}`] : []), deleted ? '--- /dev/null' : `--- a/${p}`, gone ? '+++ /dev/null' : `+++ b/${p}`]
  const patch = [...fileHead, `@@ -${s(a)} +${s(b)} @@`, ...out, ''].join('\n')
  await apply(ws, patch)
  return keepUndo(ws, { patch })
}

// each changed file's status against the base (M, A, D, R: R's old path too); an untracked one is A
async function statusOf(ws: Workspace, from: string, path: string): Promise<{ status: string; old?: string }> {
  const z = (await exec(ws, 'git', ['diff', '--name-status', '-z', '-M', from])).stdout.split('\0')
  for (let i = 0; i < z.length - 1; ) {
    const st = z[i]
    const two = st[0] === 'R' || st[0] === 'C'
    const [old, now] = two ? [z[i + 1], z[i + 2]] : [undefined, z[i + 1]]
    if (now === path) return { status: st[0] === 'C' ? 'A' : st[0], old: st[0] === 'R' ? old : undefined }
    i += two ? 3 : 2
  }
  const untracked = await git(ws, 'ls-files', '--others', '--exclude-standard', '--', path)
  if (untracked.split('\n').includes(path)) return { status: 'A' }
  throw new Error(`${path} has no changes to revert: refresh Changes`)
}
// a file's content kept in git's object store (binaries too), none when there's no file
async function blobOf(ws: Workspace, path: string) {
  const there = await exec(ws, 'test', ['-e', path]).then(() => true, () => false)
  return there ? git(ws, 'hash-object', '-w', '--', path) : undefined
}
async function rmFile(ws: Workspace, path: string) {
  const abs = inside(ws, path)
  if (ws.host) await exec(ws, 'rm', ['-f', '--', path])
  else rmSync(abs, { force: true })
}

// fileUndo: a whole file back to the base (binaries and images too); what it was kept for Undo. Nothing is staged:
// git restore --worktree, never checkout. ponytail: Undo doesn't put back mode bits
export async function fileUndo(o: { ws: string; path: string }) {
  const ws = gitWs(o.ws)
  const path = String(o.path ?? '')
  inside(ws, path)
  const from = await diffBase(ws)
  const { status, old } = await statusOf(ws, from, path)
  if (old) inside(ws, old)
  const touched = [path, ...(old ? [old] : [])]
  const files = await Promise.all(touched.map(async p => ({ path: p, blob: await blobOf(ws, p) })))
  const restore = (p: string) => git(ws, 'restore', `--source=${from}`, '--worktree', '--', p)
  if (status === 'A') await rmFile(ws, path)
  else if (status === 'R') await restore(old!), await rmFile(ws, path)
  else await restore(path) // M, D (T: a type change, as M)
  return keepUndo(ws, { files })
}

// hunkRedo: an Undo of a revert: a patch taken back, or files written as they were (a blob back, a file it brought back
// removed); then it's gone
export async function hunkRedo(o: { ws: string; id: string }) {
  const ws = gitWs(o.ws)
  const list = undos.get(ws.id) ?? []
  const u = list.find(x => x.id === o.id)
  if (!u) throw new Error('nothing to undo')
  if (u.patch) await apply(ws, u.patch, true)
  for (const f of u.files ?? []) {
    inside(ws, f.path)
    if (!f.blob) await rmFile(ws, f.path)
    else await exec(ws, 'sh', ['-c', 'mkdir -p "$(dirname "$2")" && git cat-file blob "$1" > "$2"', 'sh', f.blob, f.path])
  }
  undos.set(ws.id, list.filter(x => x !== u))
  return {}
}

// the sidebar's +/-: diff's numbers without its text, for each live git workspace; one scan at a time
export const stats = new Map<string, Stat>()
let statting = false
let restat = false // asked for while one ran: again after it
async function statOf(w: Workspace): Promise<Stat> {
  // --no-optional-locks: a scan never holds index.lock while an agent or you commit
  const from = await diffBase(w)
  const [numstat, untracked, status] = await Promise.all([
    git(w, '--no-optional-locks', 'diff', '--numstat', '-M', from),
    git(w, '--no-optional-locks', 'ls-files', '--others', '--exclude-standard'),
    git(w, '--no-optional-locks', 'status', '--porcelain'),
  ])
  const st: Stat = { add: 0, del: 0, files: 0, dirty: status.split('\n').filter(Boolean).length }
  for (const l of numstat.split('\n').filter(Boolean)) {
    const [a, d] = l.split('\t')
    st.add += Number(a) || 0 // a binary file: -
    st.del += Number(d) || 0
    st.files++
  }
  // ponytail: new files' lines read here (async: the loop streams terminals), the first 100 up to 1 MB each; a text
  // file's newlines, a binary's none
  const fresh = untracked.split('\n').filter(Boolean)
  st.files += fresh.length
  for (const f of w.host ? [] : fresh.slice(0, 100)) { // ponytail: a host's new files count, not their lines
    try {
      const p = join(w.path, f)
      if ((await stat(p)).size > 1 << 20) continue
      const b = await readFile(p)
      if (!b.subarray(0, 8000).includes(0)) st.add += b.length && b.toString('utf8').split('\n').length - (b[b.length - 1] === 10 ? 1 : 0)
    } catch {}
  }
  return st
}
export async function scanStats(): Promise<void> {
  if (statting) return void (restat = true)
  statting = true
  try {
    // the sidebar's (settings.diffStat, off by default) or the full review's tab (settings.fullReview: shown while
    // there's a diff), and a race's always: Compare shows them
    const on = state.settings?.diffStat === true || state.settings?.fullReview === true
    const wanted = (w: Workspace) => !w.archived && !away(w) && (on || !!w.race) && state.projects.find(p => p.id === w.project)?.git !== false
    for (const id of stats.keys()) if (!state.workspaces.some(w => w.id === id && wanted(w))) (stats.delete(id), changed())
    for (const w of state.workspaces) {
      if (!wanted(w) || (!w.host && !existsSync(w.path))) continue
      const s = await statOf(w).catch(() => undefined)
      if (JSON.stringify(s) === JSON.stringify(stats.get(w.id))) continue
      s ? stats.set(w.id, s) : stats.delete(w.id)
      changed()
    }
  } finally {
    statting = false
  }
  if (restat) (restat = false), await scanStats()
}

// ---------- files: the side panel's tree, changed files marked

// a path in the workspace, links followed: a tracked link (or a linked folder) may point anywhere. A new file's
// nearest folder there already is what's checked; a dangling link is out. ponytail: on an SSH host by name only
export function inside(ws: Workspace, rel: string) {
  const abs = resolve(ws.path, rel)
  if (rel.trim() && abs.startsWith(ws.path + '/'))
    try {
      if (ws.host) return abs
      let up = abs
      while (!lstatSync(up, { throwIfNoEntry: false })) up = dirname(up)
      if (within(realpathSync(ws.path), realpathSync(up))) return abs
    } catch {} // a dangling link, a file as a folder, the workspace gone
  throw new Error(`${rel}: not a path inside the workspace`)
}

const MAX_FILES = 50000

// files lists the workspace's files (git's: tracked and untracked, not ignored; a plain folder's: all
// but dependencies), and how the changed ones changed: M, A (new), D, R
export async function files(ref: string) {
  const ws = findWs(ref)
  // Terminals and Browsers: your home folder, whose walk would be junk and macOS's prompts (Desktop, Documents…)
  if (state.projects.find(p => p.id === ws.project)?.kind) return { files: [], changed: {}, cut: false }
  if (ws.host && state.projects.find(p => p.id === ws.project)?.git === false) {
    const skip = [...SKIP_DIRS].flatMap((d, i) => [...(i ? ['-o'] : []), '-name', d])
    const { stdout } = await exec(ws, 'find', ['.', '(', ...skip, ')', '-prune', '-o', '-type', 'f', '-print'])
    const out = stdout.split('\n').filter(Boolean).map(l => l.slice(2))
    return { files: out.slice(0, MAX_FILES), changed: {}, cut: out.length > MAX_FILES }
  }
  if (!ws.host && !existsSync(join(ws.path, '.git'))) {
    const out: string[] = []
    const walk = (dir: string) => {
      let es: Dirent[]
      try {
        es = readdirSync(join(ws.path, dir), { withFileTypes: true })
      } catch {
        return // unreadable: left out
      }
      for (const e of es) {
        if (out.length >= MAX_FILES) return
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) !SKIP_DIRS.has(e.name) && walk(rel)
        else out.push(rel)
      }
    }
    walk('')
    return { files: out, changed: {}, cut: out.length >= MAX_FILES }
  }
  const z = (args: string[]) => exec(ws, 'git', args).then(r => r.stdout.split('\0'))
  const [list, st] = await Promise.all([z(['ls-files', '-z', '--cached', '--others', '--exclude-standard']), z(['status', '--porcelain', '-z', '--untracked-files=all'])])
  const changed: Record<string, string> = {}
  for (let i = 0; i < st.length; i++) {
    const [xy, path] = [st[i].slice(0, 2), st[i].slice(3)]
    if (!path) continue
    changed[path] = xy === '??' ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M'
    if (xy.includes('R') || xy.includes('C')) i++ // the old name follows
  }
  const all = [...new Set(list.filter(Boolean))]
  return { files: all.slice(0, MAX_FILES), changed, cut: all.length > MAX_FILES }
}
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'target', 'dist', 'build', '.venv', '__pycache__'])

export async function fileNew(o: { ws: string; path: string; dir?: boolean }) {
  const ws = findWs(o.ws)
  const abs = inside(ws, o.path)
  if (ws.host) {
    const make = '[ ! -e "$1" ] || { echo "$3 is there already" >&2; exit 1; }; if [ "$2" = dir ]; then mkdir -p "$1"; else mkdir -p "$(dirname "$1")" && : > "$1"; fi'
    await exec(ws, 'sh', ['-c', make, 'sh', abs, o.dir ? 'dir' : 'file', o.path]).catch(e => {
      throw new Error(String(e.stderr || e.message).trim().split('\n').at(-1))
    })
    return { path: abs.slice(ws.path.length + 1) }
  }
  if (existsSync(abs)) throw new Error(`${o.path} is there already`)
  mkdirSync(o.dir ? abs : dirname(abs), { recursive: true })
  if (!o.dir) writeFileSync(abs, '', { flag: 'wx' })
  return { path: abs.slice(ws.path.length + 1) }
}

// a file of a workspace's storage folder (its Artifacts), for the app's viewer (main.ts' GET /artifact/…): its path,
// inside the folder (links followed, none out of it); never on a host
export function artifactFile(id: string, rel: string) {
  const ws = findWs(id)
  if (!ws.storage || ws.host) throw new Error('no storage folder')
  return inside({ ...ws, path: ws.storage }, rel)
}

export const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' }
const MAX_TEXT = 512 << 10

// fileRead: a file for the preview: text (the first 512 KB), an image (up to 10 MB), or only its size. base: an image
// as it was where the workspace's changes start (diff's base, through git show), for Changes' before and after
export async function fileRead(o: { ws: string; path: string; base?: boolean; storage?: boolean }) {
  let ws = findWs(o.ws)
  if (o.storage) {
    // a file in its storage folder (the status bar's Artifacts), never on a host: read as one of its own
    if (!ws.storage || ws.host || o.base) throw new Error('no storage folder')
    ws = { ...ws, path: ws.storage }
  }
  const abs = inside(ws, o.path)
  if (o.base) {
    const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
    if (!mime) throw new Error(`${o.path} isn't an image`)
    const rel = abs.slice(ws.path.length + 1)
    const show = `${await diffBase(ws)}:${rel}`
    const stdout = ws.host
      ? Buffer.from((await exec(ws, 'sh', ['-c', 'git show "$1" | head -c 10485761 | base64', 'sh', show])).stdout, 'base64') // base64: text over ssh
      : (
          await run('git', ['show', show], { cwd: ws.path, encoding: 'buffer', maxBuffer: 10 << 20 }).catch(e => {
            throw new Error(/maxBuffer/i.test(String(e.message)) ? 'over 10 MB' : `not in ${ws.base}`)
          })
        ).stdout
    if (ws.host && !stdout.length) throw new Error(`not in ${ws.base}`)
    if (stdout.length > 10 << 20) throw new Error('over 10 MB')
    return { size: stdout.length, image: `data:${mime};base64,${stdout.toString('base64')}` }
  }
  if (ws.host) return hostFileRead(ws, abs, o.path)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`${o.path} isn't a file`)
  const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
  if (mime) return st.size > 10 << 20 ? { size: st.size } : { size: st.size, image: `data:${mime};base64,${readFileSync(abs).toString('base64')}` }
  let buf = Buffer.alloc(Math.min(st.size, MAX_TEXT))
  const fd = openSync(abs, 'r')
  try {
    buf = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)) // less when it shrank since statSync
  } finally {
    closeSync(fd)
  }
  if (buf.subarray(0, 8000).includes(0)) return { size: st.size } // binary
  return textOf(buf, st.size)
}

// a text file's answer; lossy: not UTF-8 (the text isn't its bytes: saving it would change them)
function textOf(buf: Buffer, size: number) {
  const text = buf.toString('utf8')
  return { size, text, cut: size > MAX_TEXT || undefined, lossy: (size <= MAX_TEXT && !Buffer.from(text).equals(buf)) || undefined }
}

// fileRead on an SSH host: the same answers, read there (base64: text over ssh)
async function hostFileRead(ws: Workspace, abs: string, rel: string) {
  const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
  const max = mime ? 10 << 20 : MAX_TEXT
  const read = `[ -f "$1" ] || { echo "$3 isn't a file" >&2; exit 3; }; n=$(wc -c < "$1"); echo $n; if [ "$2" = text ] || [ "$n" -le "$4" ]; then head -c "$4" "$1" | base64; fi`
  const { stdout } = await exec(ws, 'sh', ['-c', read, 'sh', abs, mime ? 'image' : 'text', rel, String(max)]).catch(e => {
    throw new Error(String(e.stderr || e.message).trim().split('\n').at(-1))
  })
  const nl = stdout.indexOf('\n')
  const size = Number(stdout.slice(0, nl).trim())
  const buf = Buffer.from(stdout.slice(nl + 1), 'base64')
  if (mime) return size > max ? { size } : { size, image: `data:${mime};base64,${buf.toString('base64')}` }
  if (buf.subarray(0, 8000).includes(0)) return { size } // binary
  return textOf(buf, size)
}

// fileWrite: the file preview's edit, saved over the file (its mode kept). Only a whole UTF-8 text file the preview
// could show; was: the text the edit started from, so a file changed since (an agent at work) isn't written over
// unless force
export async function fileWrite(o: { ws: string; path: string; text: string; was?: string; force?: boolean }) {
  const ws = findWs(o.ws)
  const abs = inside(ws, o.path)
  if (typeof o.text !== 'string') throw new Error('no text to save')
  if (Buffer.byteLength(o.text) > MAX_TEXT) throw new Error('over 512 KB: edit it in your editor')
  const now = await fileRead({ ws: o.ws, path: o.path })
  if (!('text' in now) || now.cut || now.lossy) throw new Error(`${o.path} can't be edited here: open it in your editor`)
  if (!o.force && now.text !== o.was) throw new Error(`${o.path} changed since you opened it`)
  // there: inside() only read the path, so the shell checks where it leads (pwd -P: its folders' links followed; the
  // file itself no link), as realpath does here
  if (ws.host) await sshIn(ws.host, `r=$(cd ${q(ws.path)} && pwd -P) && d=$(cd ${q(dirname(abs))} && pwd -P) && f="$d"/${q(basename(abs))} && case "$f" in "$r"/*) [ -f "$f" ] && [ ! -L "$f" ] ;; *) false ;; esac || { echo ${q(`${o.path}: not a file inside the workspace`)} >&2; exit 3; }; cat > "$f"`, o.text)
  else writeFileSync(abs, o.text)
  return { size: Buffer.byteLength(o.text) }
}
