// Import chats (a project's ⋯ › Import chats…): Claude Code's and Codex's sessions run in the project's folder, or one
// of its workspaces', outside Laki (a plain terminal), listed from their transcripts; each one picked opens as a tab
// that resumes it: in the workspace whose folder it ran in, else the project's own folder's (made if missing).
// ponytail: this Mac's agents' own folders only (accounts link theirs in), not a host's; a path Claude Code shortens
// past 200 characters isn't found; a side chat's fork shows again once the daemon restarts (sides are in memory)
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { taskTitle } from '../shared/types.ts'
import { homeDir } from './accounts.ts'
import { addTab, presets, state, wsNew } from './core.ts'
import { chatOf } from './share.ts'
import { sideSessions } from './turns.ts'

export type OutsideChat = { agent: 'claude' | 'codex'; id: string; title: string; at: number; ws?: string }
const HEAD = 256 * 1024 // a transcript's start: its folder, id and first prompt are there
const CODEX_LOOK = 3000 // codex's newest sessions looked at (one folder for every repo)
function head(f: string, n = HEAD) {
  const fd = openSync(f, 'r')
  try {
    const b = Buffer.alloc(n)
    const got = readSync(fd, b, 0, n, 0)
    const t = b.toString('utf8', 0, got)
    return got < n ? t : t.slice(0, t.lastIndexOf('\n') + 1) // whole lines only
  } finally {
    closeSync(fd)
  }
}
const list = (d: string, deep = false) => {
  try {
    return readdirSync(d, { recursive: deep }) as string[]
  } catch {
    return []
  }
}
// a codex transcript's first line (its folder and id) never changes: read once per file, not at every list (and the
// import's list again). ponytail: in memory, every file looked at stays
const metas = new Map<string, { cwd: string; id: string } | null>()
function metaOf(file: string) {
  if (metas.has(file)) return metas.get(file)!
  let m: { cwd: string; id: string } | null = null
  try {
    const j = JSON.parse(head(file, 64 * 1024).split('\n')[0])
    if (j?.type === 'session_meta' && typeof j.payload?.cwd === 'string' && /^[\w-]+$/.test(j.payload.id ?? '')) m = { cwd: j.payload.cwd, id: j.payload.id }
  } catch {} // not a session's: skipped
  metas.set(file, m)
  return m
}
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

export function chatList(p: { project: string }): OutsideChat[] {
  const proj = state.projects.find(x => x.id === p.project)
  if (!proj) throw new Error(`no project ${p.project}`)
  if (proj.host || proj.kind) return []
  // each folder the chats may have run in: the project's (no workspace: its own folder's) and its live workspaces'
  const at = new Map<string, string | undefined>()
  for (const w of state.workspaces.filter(w => w.project === proj.id && !w.archived && !w.host)) at.set(w.path, w.id).set(real(w.path), w.id)
  at.set(proj.path, at.get(proj.path)).set(real(proj.path), at.get(real(proj.path)))
  const open = new Set([...state.tabs.map(t => t.resumeId).filter(Boolean), ...sideSessions()]) // in Laki already, a side chat's fork too
  const out: OutsideChat[] = []
  const add = (agent: OutsideChat['agent'], id: string, file: string, text: string, ws?: string) => {
    if (open.has(id) || out.some(x => x.id === id)) return
    const first = chatOf(agent, text).find(s => s.who === 'you')?.text
    if (first) out.push({ agent, id, title: first.replace(/\s+/g, ' ').slice(0, 120), at: statSync(file).mtimeMs, ...(ws && { ws }) })
  }
  // claude's: <its home>/projects/<the folder, every character but a letter or digit a dash>/<session>.jsonl
  const cd = join(homeDir('claude'), 'projects')
  for (const [path, ws] of at) {
    const d = join(cd, path.replace(/[^A-Za-z0-9]/g, '-'))
    for (const f of list(d))
      try {
        if (/^[\w-]+\.jsonl$/.test(f) && !open.has(f.slice(0, -6))) add('claude', f.slice(0, -6), join(d, f), head(join(d, f)), ws) // an open one's not read
      } catch {} // gone meanwhile: skipped
  }
  // codex's: <its home>/sessions/y/m/d/rollout-<time>-<id>.jsonl, its first line the session's folder (cwd) and id
  const sd = join(homeDir('codex'), 'sessions')
  for (const f of list(sd, true).filter(f => f.endsWith('.jsonl')).sort().reverse().slice(0, CODEX_LOOK)) {
    const file = join(sd, f)
    const m = metaOf(file)
    try {
      if (m && at.has(m.cwd) && !open.has(m.id)) add('codex', m.id, file, head(file), at.get(m.cwd))
    } catch {} // gone meanwhile (codex tidies its own): skipped
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 200)
}

// the picked ones (by id: only what chatList finds now), a tab each resuming its chat
export async function chatImport(p: { project: string; ids: string[] }) {
  const found = chatList(p).filter(c => p.ids?.includes(c.id))
  if (!found.length) throw new Error('none of those chats is there to import')
  const tabs = []
  let local: string | undefined
  for (const c of found) {
    const ws = c.ws ?? (local ??= (await wsNew({ project: p.project, local: true, preset: 'none' })).id) // the folder's own workspace
    const preset = presets().find(x => x.agent === c.agent && !x.off)?.name ?? c.agent
    tabs.push(addTab(ws, { preset, resume: c.id, name: `${c.agent}: ${taskTitle(c.title)}` }))
  }
  return tabs.map(t => ({ id: t.id, workspace: t.workspace, name: t.name }))
}
