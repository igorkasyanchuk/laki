// processes: each workspace's listening ports, memory and CPU by tab (Settings › Resources), process groups, and idle
// agents put to sleep. core.ts re-exports it.

import { type ChildProcess, spawn } from 'node:child_process'
import { basename } from 'node:path'
import { type Proc, type ProcUse, type Resources, SLEEP_AFTER, type Tab } from '../shared/types.ts'
import { scanArtifacts } from './artifacts.ts'
import { changed, findTab, findWs, log, ports, procs, projectConfig, queued, restoreNow, rt, rtOf, run, sessions, spawnTab, state } from './core.ts'
import { syncBranches } from './pr.ts'
import { Session } from './session.ts'
import { widgetEvent } from './widgets.ts'

// what an agent runs without a shell between (its browser bridge, an MCP server, the browser that one drives) and any
// browser listen for the agent, not as the workspace's servers: kept in procs (sleep sees them), left out of ports (the
// status bar's ↗, the menus). What it starts through its shell tool (a dev server) is the workspace's
const SHELLS = /^-?(?:ba|z|fi|da|k|tc|c)?sh$/
const BROWSER = /chrom|firefox|webkit|msedge|headless/i
// a port of a tab brought back at start, in its first minute: noted, no port.open (it listened before the restart).
// ponytail: a minute; a server that takes longer to come back is new to extensions
export const restoredAt = new Map<string, number>()
const RESTORED_QUIET = 60_000
export async function scanPorts() {
  syncBranches()
  void scanArtifacts()
  const root = new Map<number, string>()
  const rootTab = new Map<number, string>() // each pid's tab (the tree it's under)
  const agents: number[] = [] // agent tabs' pids
  for (const [id, s] of sessions) {
    const t = state.tabs.find(t => t.id === id)
    if (t && !s.exited) root.set(s.pty.pid, t.workspace), rootTab.set(s.pty.pid, t.id), t.kind === 'agent' && agents.push(s.pty.pid)
  }
  const next = new Map<string, number[]>()
  const nextProcs = new Map<string, Record<number, Proc>>()
  if (root.size) {
    const kids = new Map<number, number[]>()
    const comm = new Map<number, string>() // each one's program, by name
    const { stdout: ps } = await run('ps', ['-axo', 'pid=,ppid=,comm=']).catch(() => ({ stdout: '' }))
    for (const l of ps.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(l)
      if (!m || !Number(m[1])) continue
      kids.set(Number(m[2]), [...(kids.get(Number(m[2])) ?? []), Number(m[1])])
      comm.set(Number(m[1]), basename(m[3].trim()))
    }
    const own = new Set<number>()
    const mine = (pid: number) => {
      own.add(pid)
      for (const k of kids.get(pid) ?? []) if (!own.has(k) && !SHELLS.test(comm.get(k) ?? '')) mine(k)
    }
    agents.forEach(mine)
    const owner = new Map<number, string>()
    const walk = (pid: number, ws: string, tab: string) => {
      owner.set(pid, ws)
      rootTab.set(pid, tab)
      for (const k of kids.get(pid) ?? []) if (!owner.has(k)) walk(k, ws, tab)
    }
    for (const [pid, ws] of root) walk(pid, ws, rootTab.get(pid)!)
    const out = await run('lsof', ['-nP', '-a', '-p', [...owner.keys()].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpcn']).then(
      r => r.stdout,
      e => String(e.stdout ?? ''),
    )
    let pid = 0
    let cmd = ''
    for (const l of out.split('\n')) {
      if (l[0] === 'p') pid = Number(l.slice(1))
      else if (l[0] === 'c') cmd = l.slice(1)
      else if (l[0] === 'n') {
        const port = Number(l.slice(l.lastIndexOf(':') + 1))
        const ws = owner.get(pid)
        if (!ws || !port) continue
        const inner = own.has(pid) || BROWSER.test(cmd)
        if (!inner && !next.get(ws)?.includes(port)) next.set(ws, [...(next.get(ws) ?? []), port].sort((a, b) => a - b))
        nextProcs.set(ws, { ...nextProcs.get(ws), [port]: { pid, cmd, ...(inner && { own: true }) } })
      }
    }
  }
  // a port newly listening in a workspace
  for (const [w, list] of next)
    for (const port of list)
      if (!ports.get(w)?.includes(port)) {
        const p = nextProcs.get(w)?.[port]
        const tab = p && rootTab.get(p.pid)
        if (tab && Date.now() - (restoredAt.get(tab) ?? 0) < RESTORED_QUIET) continue
        const x = state.workspaces.find(v => v.id === w)
        const name = x && (projectConfig(x).ports as Record<string, unknown> | undefined)?.[port]
        widgetEvent('port.open', { port, pid: p?.pid, command: p?.cmd, ...(typeof name === 'string' && { name }) }, w)
      }
  if (JSON.stringify([...next, ...nextProcs]) !== JSON.stringify([...ports, ...procs])) {
    ports.clear()
    procs.clear()
    for (const [k, v] of next) ports.set(k, v)
    for (const [k, v] of nextProcs) procs.set(k, v)
    changed()
  }
}

// the status bar's ✕ on a port: what listens there, found by the last scan in the workspace's own processes and yours
// (uid), gets SIGTERM, then SIGKILL 3 s later if it's still there; the ports are scanned again after each
export async function portKill(o: { ws: string; port: number }) {
  const ws = findWs(o.ws)
  const p = procs.get(ws.id)?.[Number(o.port)]
  if (!p) throw new Error(`nothing of ${ws.id}'s listens on :${o.port}`)
  // its owner and start time: the SIGKILL goes only to the same process, not one that took its pid since
  const who = () => run('ps', ['-o', 'uid=,lstart=', '-p', String(p.pid)]).then(r => r.stdout.trim(), () => '')
  // and that it still listens there: the scan is up to 5 s old, and a pid may be another process's by now
  const listens = run('lsof', ['-nP', '-a', '-p', String(p.pid), `-iTCP:${Number(o.port)}`, '-sTCP:LISTEN', '-t']).then(r => !!r.stdout.trim(), () => false)
  const [was, still] = await Promise.all([who(), listens])
  if (!still) {
    void scanPorts()
    throw new Error(`${p.cmd} (pid ${p.pid}) no longer listens on :${o.port}`)
  }
  if (was.split(/\s+/)[0] !== String(process.getuid?.())) throw new Error(`${p.cmd} (pid ${p.pid}) isn't yours to stop`)
  try {
    process.kill(p.pid, 'SIGTERM')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e // ESRCH: it ended on its own, as asked
  }
  setTimeout(() => void scanPorts(), 500)
  setTimeout(async () => {
    if ((await who()) === was) {
      try {
        process.kill(p.pid, 'SIGKILL')
        log(`port ${o.port}: ${p.cmd} (pid ${p.pid}) outlived SIGTERM, killed`)
      } catch {}
    }
    void scanPorts()
  }, 3000)
  return p
}

// ---------- resources (Settings): memory and CPU by process; idle agents put to sleep

type PsRow = ProcUse & { ppid: number }
// every process, from one ps (%cpu may have the locale's decimal comma)
async function psAll(): Promise<PsRow[]> {
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,rss=,%cpu=,command='], { maxBuffer: 64 << 20 }).catch(() => ({ stdout: '' }))
  return stdout.split('\n').flatMap(l => {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(.*)$/)
    return m ? [{ pid: +m[1], ppid: +m[2], rss: +m[3], cpu: Number(m[4].replace(',', '.')) || 0, cmd: m[5].slice(0, 300) }] : []
  })
}
// a process and everything under it, the process first
function trees(rows: PsRow[]) {
  const kids = new Map<number, PsRow[]>()
  for (const r of rows) kids.get(r.ppid)?.push(r) ?? kids.set(r.ppid, [r])
  return (pid: number) => {
    const out = new Set<PsRow>()
    const walk = (r?: PsRow) => {
      if (!r || out.has(r)) return
      out.add(r)
      for (const k of kids.get(r.pid) ?? []) walk(k)
    }
    walk(rows.find(r => r.pid === pid))
    return [...out]
  }
}
const use = ({ pid, rss, cpu, cmd }: PsRow): ProcUse => ({ pid, rss, cpu, cmd })
const sum = (ps: PsRow[], k: 'rss' | 'cpu') => Math.round(ps.reduce((n, p) => n + p[k], 0) * 10) / 10

// a command in a process group of its own (detached), so a timeout or a Stop ends what it started too (python3 fetch.py,
// npm run…, a sleep holding its stdout): SIGTERM to the group, SIGKILL 3 s later if it's still there
export function killGroup(c: ChildProcess) {
  try {
    process.kill(-c.pid!, 'SIGTERM')
    setTimeout(() => {
      try {
        process.kill(-c.pid!, 'SIGKILL')
      } catch {}
    }, 3000).unref()
  } catch {}
}
// execFile's shape (its callback's error has code, the exit code or an errno, and killed) for a command run as a group:
// its timeout and signal end the group; stdin is ended with what's given; past maxBuffer it's stopped
export type GroupError = Error & { code?: number | string; killed?: boolean }
export function execGroup(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number; signal?: AbortSignal; stdin?: string }, cb: (e: GroupError | null, stdout: string, stderr: string) => void): ChildProcess {
  const p = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const out: Buffer[] = []
  const err: Buffer[] = []
  let size = 0
  let killed = false
  let over = false
  let done = false
  const stop = () => {
    if (killed) return
    killed = true
    killGroup(p)
    setTimeout(() => (p.stdout?.destroy(), p.stderr?.destroy()), 5000).unref() // one that left the group keeps the pipe: close anyway
  }
  const take = (l: Buffer[]) => (b: Buffer) => {
    size += b.length
    if (size > (o.maxBuffer ?? 1 << 20)) return (over = true), stop()
    l.push(b)
  }
  p.stdout!.on('data', take(out))
  p.stderr!.on('data', take(err))
  const timer = o.timeout ? setTimeout(stop, o.timeout) : undefined
  o.signal?.addEventListener('abort', stop, { once: true })
  if (o.signal?.aborted) stop()
  const end = (e: GroupError | null) => {
    if (done) return
    done = true
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', stop)
    cb(e, Buffer.concat(out).toString(), Buffer.concat(err).toString())
  }
  p.on('error', e => !p.pid && end(Object.assign(e, { killed }))) // never started (ENOENT)
  p.on('close', code => end(code === 0 && !killed ? null : Object.assign(new Error(over ? 'maxBuffer exceeded' : `Command failed: ${cmd} ${args.join(' ')}`), { code: code ?? undefined, killed })))
  p.stdin!.on('error', () => {}) // one that never reads it
  p.stdin!.end(o.stdin ?? '')
  return p
}

// what this daemon runs besides tabs, by pid, for Resources: Laki AI's agent, a tunnel, remote access, an SSH host's
// connection, a widget's fetch; stop: main.ts' resourceStop key. Dropped as it exits
const owned = new Map<number, { name: string; stop?: string }>()
export function own(c: ChildProcess, name: string, stop?: string) {
  const pid = c.pid
  if (!pid) return
  owned.set(pid, { name, ...(stop && { stop }) })
  c.once('exit', () => owned.delete(pid))
}

// macOS counts everything Laki starts as Laki's: each tab's agent, its MCP servers, its dev servers. Laki's own are the
// app bundle's processes (main, windows, GPU, network…; none in dev, on plain node), this daemon and the short commands
// it runs (git, gh, lsof: in app, as their names); what own named is others, a row each.
// ponytail: a process that left its tab's tree (a double fork) shows nowhere, nor main's own short helpers (screencapture,
// afplay), nor, for a refresh, a closed tab's still exiting
export async function resources(): Promise<Resources> {
  const rows = await psAll()
  const tree = trees(rows)
  const tabs = [...sessions].flatMap(([tab, s]) => {
    if (s.exited || !state.tabs.some(t => t.id === tab)) return []
    const ps = tree(s.pty.pid)
    return [{ tab, rss: sum(ps, 'rss'), cpu: sum(ps, 'cpu'), procs: ps.map(use) }]
  })
  const mine = new Set([process.pid, ...tabs.flatMap(t => t.procs.map(p => p.pid))])
  const others: NonNullable<Resources['others']> = []
  const rest: PsRow[] = []
  for (const k of rows.filter(r => r.ppid === process.pid && !mine.has(r.pid) && !r.cmd.startsWith('ps -axo '))) {
    const ps = tree(k.pid)
    const o = owned.get(k.pid)
    if (o) others.push({ ...o, rss: sum(ps, 'rss'), cpu: sum(ps, 'cpu'), procs: ps.map(use) })
    else rest.push(...ps)
  }
  for (const o of others) for (const p of o.procs) mine.add(p.pid)
  for (const r of rest) mine.add(r.pid)
  const bundle = process.execPath.match(/^(.*?\.app)\//)?.[1]
  const kind = (cmd: string) => cmd.match(/--utility-sub-type=(\w+)/)?.[1] ?? cmd.match(/--type=([\w-]+)/)?.[1] ?? 'main'
  const app = [
    ...(bundle ? rows.filter(r => r.cmd.startsWith(`${bundle}/`) && !mine.has(r.pid)).map(r => ({ ...use(r), kind: kind(r.cmd) })) : []),
    ...rest.map(r => ({ ...use(r), kind: basename(r.cmd.split(' ')[0]) })), // a moment's git or gh: Laki's own work
  ]
  const me = rows.find(r => r.pid === process.pid)
  const mem = process.memoryUsage()
  const kb = (b: number) => Math.round(b / 1024)
  return { app, daemon: { ...(me ? use(me) : { pid: process.pid, rss: kb(mem.rss), cpu: 0, cmd: process.argv.join(' ') }), heap: kb(mem.heapUsed) }, tabs, others }
}

// An idle claude or codex nobody looks at, quiet for settings.sleepAfter minutes, is put to sleep: its process ends
// (it frees what it holds, and a long one grows), its screen stays, and a look (attach), a key or a message resumes
// its chat (wake). Not one with a queue or a usage limit, without a chat to resume, on an SSH host, in a workspace
// whose PR feedback goes to it (autoFix…), nor one with a port listening under it (a dev server it started).
// ponytail: in memory; a daemon restart resumes every tab, asleep or not, in turn (core.ts restoreAll)
export const asleep = new Set<string>()
export const isLive = (t: Tab) => asleep.has(t.id) || !!(sessions.get(t.id) && !sessions.get(t.id)!.exited)
// why a tab can't sleep even when asked: a chat it can resume, here, idle with nothing waiting for it
function cantSleep(t: Tab) {
  const r = rt.get(t.id)
  if ((t.preset !== 'claude' && t.preset !== 'codex') || !t.resumeId) return `${t.name} can't resume a chat: claude and codex can, once they have one`
  if (state.workspaces.find(w => w.id === t.workspace)?.host) return `${t.name} runs on an SSH host: its memory is there`
  if (r?.status !== 'idle' || r.limit || t.queue?.length) return `${t.name} is busy: it can sleep once its turn ends${r?.limit ? ' and its usage limit resets' : ''}`
}
// quiet: idle since (view sets idleAt) and since anyone last looked at it, not since it last printed: a TUI may redraw
// while it waits (a status line)
function sleepy(t: Tab, now: number) {
  const min = Number(state.settings?.sleepAfter ?? SLEEP_AFTER) || 0 // 0: never
  const s = sessions.get(t.id)
  const ws = state.workspaces.find(w => w.id === t.workspace)
  return !!(min > 0 && s && !s.exited && !asleep.has(t.id) && !s.attachedClients().length && !cantSleep(t) && now - Math.max(rt.get(t.id)?.idleAt ?? now, s.lookedAt) > min * 60000 && ws && !ws.archived && !ws.autoFix && !ws.autoReview && !ws.autoMerge)
}
export async function sleepTick(now = Date.now()) {
  if (!state.tabs.some(t => sleepy(t, now))) return []
  const tree = trees(await psAll())
  const slept: string[] = []
  for (const t of state.tabs) {
    if (!sleepy(t, now)) continue // again: a look or a turn may have come during ps
    const s = sessions.get(t.id)!
    const pids = new Set(tree(s.pty.pid).map(r => r.pid))
    if (Object.values(procs.get(t.workspace) ?? {}).some(p => pids.has(p.pid))) continue
    toSleep(t.id, s)
    slept.push(t.id)
  }
  if (slept.length) log(`asleep: ${slept.join(', ')}`), changed()
  return slept
}
function toSleep(id: string, s: Session) {
  asleep.add(id)
  s.end('\r\n\x1b[2m[asleep: ended to free memory · look at it, type or send it a message to resume it]\x1b[0m\r\n')
}

// Resources' Sleep: now, looked at or not (a dev server it started goes with it: your call)
export function sleepNow(id: string) {
  const t = findTab(id)
  const s = sessions.get(t.id)
  if (!s || s.exited || asleep.has(t.id)) return false
  const why = cantSleep(t)
  if (why) throw new Error(why)
  toSleep(t.id, s)
  changed()
  return true
}

// an agent put to sleep resumes its chat; it counts as running until its screen goes quiet (sweepRunning), which
// then delivers what was sent meanwhile. Its unread ● stays
export function wake(id: string) {
  const tab = state.tabs.find(t => t.id === id)
  // no session: a restart's, not started yet (core's queue: a shell's key or message goes straight in), else the
  // daemon dropped it (shutdown)
  if (!tab || !asleep.has(id) || !(sessions.has(id) || queued.has(id))) return false
  const done = rtOf(id).done
  if (!queued.has(id)) spawnTab(tab, { resume: true })
  else if (!restoreNow(id)) return false
  Object.assign(rtOf(id), { status: 'running', done })
  changed()
  return true
}
