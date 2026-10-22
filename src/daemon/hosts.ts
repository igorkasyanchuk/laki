// SSH hosts and cloud workspaces: a project on another machine (host:path) through one ssh connection per host, and a
// workspace in a GitHub codespace (codespace.ts runs gh). core.ts re-exports it.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { type Project, type ProjectConfig, type Tab, type Workspace } from '../shared/types.ts'
import * as cs from './codespace.ts'
import { agentCmd, allocPort, type At, branchPrefix, cfgHash, changed, dir, ENV_KEY, exec, fileCfg, findProject, firstLine, git, hookFiles, type Hooks, lakiEnv, log, type NewWs, q, run, runDir, save, slug, type SpawnOpts, state, uniqueWsId, wsLog } from './core.ts'
import { own } from './resources.ts'

// ---------- SSH hosts: a project on another machine (host:path, as scp writes it). One ssh connection per host (a
// ControlMaster the daemon keeps) carries git and gh; each tab has its own (ssh -tt). Nothing of Laki's runs there but a hook
// script, which reports a turn as an escape code on the tab's own terminal (spawnTab's onHook): no way back into this
// Mac. Sign-in is ssh's own (keys, agent, ~/.ssh/config), never a prompt (BatchMode). A workspace's $PORT here reaches
// its $PORT there (forward).

type HostRun = { dir: string; home: string; path: string; master: ChildProcess } // dir: this Mac's folder there; path: its login PATH
export const hosts = new Map<string, Promise<HostRun>>()
// this Mac's folder on hosts (two Macs on one host keep apart): named once and kept, since macOS's hostname changes
// with the network
let macName: string | undefined
export function mac() {
  if (macName) return macName
  const f = join(dir, 'ssh', 'mac')
  try {
    macName = readFileSync(f, 'utf8').trim()
  } catch {}
  if (!macName) {
    macName = slug(hostname().replace(/\.local$/, '')) || 'mac'
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
    writeFileSync(f, macName)
  }
  return macName
}
const ctlOf = (host: string) => join(dir, 'ssh', createHash('sha1').update(host).digest('hex').slice(0, 16)) // a socket's path: short
// ServerAlive: one that connects by itself (the master just gone) still ends when the network does
export const sshOpts = (host: string) => [...cs.sshF(), '-S', ctlOf(host), '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
// a tab's own connection: sshd takes 10 sessions per connection (MaxSessions), which tabs on the master would use up
const TAB_SSH = ['-o', 'ControlPath=none', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-o', 'LogLevel=ERROR', '-tt'] // LogLevel: no "Connection … closed."

// a host's commands through its connection, 8 at a time (MaxSessions: 10); a finished one hands its slot over
const SLOTS = 8
const slots = new Map<string, { n: number; queue: (() => void)[] }>()
export async function slot<T>(host: string, f: () => Promise<T>): Promise<T> {
  let b = slots.get(host)
  if (!b) slots.set(host, (b = { n: 0, queue: [] }))
  if (b.n < SLOTS) b.n++
  else await new Promise<void>(r => b!.queue.push(r))
  try {
    return await f()
  } finally {
    const next = b.queue.shift()
    if (next) next()
    else b.n--
  }
}

// ssh's failure as a line you can act on
function sshSays(host: string, err: string) {
  const last = err.trim().split('\n').filter(l => l.trim() && !/^warning:/i.test(l)).at(-1) ?? ''
  if (/host key verification failed|remote host identification/i.test(err)) return `ssh ${host}: its host key isn't known (or changed): ssh ${host} once in a terminal`
  if (/permission denied/i.test(last)) return `ssh ${host}: ${last.replace(/\.+$/, '')}. Laki signs in with your SSH keys or agent, never a password` // ssh's line ends with its own .
  return `ssh ${host}: ${last || "can't connect"}`
}

// the host's connection, made once (a failure stands 10 s: the tabs that asked at once get one answer, and a host
// that's down isn't tried at every scan)
export function hostUp(host: string): Promise<HostRun> {
  let p = hosts.get(host)
  if (!p) {
    hosts.set(host, (p = connect(host)))
    p.catch(() => setTimeout(() => hosts.get(host) === p && hosts.delete(host), 10_000))
  }
  return p
}

async function connect(host: string): Promise<HostRun> {
  const cloud = state.workspaces.find(w => w.host === host && w.codespace !== undefined)
  if (cloud) await csUp(cloud) // made (minutes: its tabs wait here), running, its Host entry there
  const ctl = ctlOf(host)
  mkdirSync(dirname(ctl), { recursive: true, mode: 0o700 })
  await run('ssh', ['-S', ctl, '-O', 'exit', host], { timeout: 5000 }).catch(() => {}) // one a crashed daemon left
  const mine = hosts.get(host) // this connection's (hostUp set it before the first await)
  let up = false
  const master = spawn('ssh', ['-M', '-N', ...cs.sshF(), '-S', ctl, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', host], { stdio: ['ignore', 'ignore', 'pipe'] })
  own(master, `SSH · ${host}`)
  let err = ''
  let gone = false
  master.stderr!.on('data', d => (err = (err + d).slice(-4000)))
  master.on('error', e => ((err += e.message), (gone = true)))
  master.on('close', () => (gone = true))
  master.on('exit', () => {
    if (!up) return // connect's own failure: hostUp keeps it 10 s
    log(`ssh ${host}: disconnected`)
    if (hosts.get(host) === mine) hosts.delete(host), live.delete(host) // the next use connects again
    if (cloud) void csRefresh() // stopped (its idle timeout), or the network went
  })
  try {
    for (let i = 0; !(await run('ssh', ['-S', ctl, '-O', 'check', host], { timeout: 5000 }).then(() => true, () => false)); i++) {
      if (gone || i > 120) throw new Error(sshSays(host, err))
      await new Promise(r => setTimeout(r, 250))
    }
    const sh = (cmd: string, timeout = 20000) => run('ssh', [...sshOpts(host), host, cmd], { timeout }).then(r => r.stdout)
    const home = (await sh('printf %s "$HOME"')).trim()
    if (!home.startsWith('/')) throw new Error(`ssh ${host}: no home folder there`)
    // its login shell's PATH (gh and agents may be where only a profile says), as adoptLoginPath does here
    const login = await sh(`"$SHELL" -lic 'printf "__LAKI__%s__LAKI__" "$PATH"' </dev/null 2>/dev/null`, 10000).catch(() => '')
    const h: HostRun = { dir: `${home}/.laki-host/${mac()}`, home, path: login.match(/__LAKI__(.*)__LAKI__/)?.[1] || '/usr/local/bin:/usr/bin:/bin', master }
    await sshIn(host, 'sh -s', hostFiles(h.dir))
    if (master.exitCode !== null || master.signalCode !== null) throw new Error(sshSays(host, err || 'disconnected'))
    up = true
    live.add(host)
    for (const w of state.workspaces) if (w.host === host && !w.archived) forward(w)
    log(`ssh ${host}: connected (${h.dir})`)
    return h
  } catch (e) {
    master.kill()
    throw e
  }
}

export function stopHosts() {
  for (const p of hosts.values()) void p.then(h => h.master.kill(), () => {})
}

// a command on the host with input on its stdin (a script, a file: never on a command line, which ps there shows)
export function sshIn(host: string, cmd: string, input: string | Buffer, timeout = 60000): Promise<string> {
  return slot(
    host,
    () =>
      new Promise((resolve, reject) => {
        const p = execFile('ssh', [...sshOpts(host), host, cmd], { timeout, maxBuffer: 16 << 20 }, (e, out, err) => (e ? reject(new Error(sshSays(host, String(err || e.message)))) : resolve(String(out))))
        p.stdin!.on('error', () => {}) // ssh gone early: its exit says why
        p.stdin!.end(input)
      }),
  )
}

// the hook on a host: a turn's state as OSC 7717 on its tab's terminal (LAKI_TTY, LAKI_HOOK: hostTab's), which the
// daemon reads off the stream; as `laki hook`, the payload is an argument (codex, opencode) or stdin (claude, gemini)
const HOST_HOOK = `#!/bin/sh
# Laki's hook (Laki on your Mac writes it): an agent's turn, as an escape code on its tab's terminal, where Laki reads it
[ "$1" = hook ] && shift
[ -n "$LAKI_TTY" ] && [ -n "$LAKI_HOOK" ] || exit 0
# running needs no payload (PreToolUse's holds whole files: too much for a terminal); else stdin read for 1 s at most,
# so a hook never holds the agent up
if [ "$1" = running ]; then p={}; elif [ -n "$2" ]; then p=$2; elif [ ! -t 0 ]; then exec 3<&0; p=$(cat <&3 & c=$!; (sleep 1; kill $c) >/dev/null 2>&1 & wait $c); fi
[ -n "$p" ] || p={}
printf '\\033]7717;%s;%s;%s\\007' "$LAKI_HOOK" "$1" "$(printf %s "$p" | base64 | tr -d '\\n')" >"$LAKI_TTY" 2>/dev/null
exit 0
`
const hostHooks = (d: string): Hooks => ({ dir: d, argv: [`${d}/hook`], cmd: st => `${q(`${d}/hook`)} ${st}` })

// a script that puts the hook and the agents' files that run it in d (heredocs: the files' text never on a command line)
function hostFiles(d: string) {
  const files = { hook: HOST_HOOK, ...hookFiles(hostHooks(d)) }
  const put = Object.entries(files).flatMap(([f, text]) => [`mkdir -p ${q(dirname(`${d}/${f}`))}`, `cat > ${q(`${d}/${f}`)} <<'LAKI_EOF'`, text.replace(/\n$/, ''), 'LAKI_EOF'])
  // tab scripts no tab ran (closed first): they hold env values
  return ['set -e', 'umask 077', ...put, `chmod 700 ${q(`${d}/hook`)}`, `rm -f ${q(`${d}/run`)}/*.sh`, ''].join('\n')
}

// a script for the host's sh: the workspace's folder, Laki's env (exported: its values stay off command lines), then cmd
export const hostScript = (ws: Workspace, env: Record<string, string>, cmd: string, pre: string[] = []) =>
  [...pre, `cd ${q(ws.path)} || exit 1`, ...Object.entries(env).filter(([k]) => ENV_KEY.test(k)).map(([k, v]) => `export ${k}=${q(v)}`), cmd, ''].join('\n')

// a tab on an SSH host: what its PTY runs here. Meanwhile the host's connection comes up and the tab's script goes
// there (its folder, env and command); the PTY waits for that (<run>/<key>.go), then runs it with ssh -tt on a
// connection of its own (TAB_SSH), or prints why it can't (<key>.err)
export function hostTab(ws: Workspace, tab: Tab, o: SpawnOpts, hookKey: string) {
  const key = `${tab.id}-${randomUUID().slice(0, 6)}`
  const f = join(runDir, key)
  void (async () => {
    const h = await hostUp(ws.host!)
    await readHostCfgs(ws, false) // after a daemon restart: its env and setup
    const prompt = await toHost(ws.host!, h, o.prompt)
    const a = tab.kind === 'agent' && o.cmd === undefined ? agentCmd(tab, prompt, !!o.resume, hostHooks(h.dir)) : undefined
    const cmd = tab.kind === 'shell' ? undefined : (o.cmd ?? a?.cmd ?? (tab.cmd || 'true'))
    const env = { ...lakiEnv(ws, tab, { ...o.env, ...a?.env }, h.dir), LAKI_HOOK: hookKey } // its values exported here, where q is right
    const script = hostScript(ws, env, cmd === undefined ? 'exec "$SHELL" -l' : `exec "$SHELL" -lic ${q(cmd)}`, ['rm -f "$0"', 'LAKI_TTY=$(tty) && export LAKI_TTY'])
    await sshIn(ws.host!, `umask 077 && mkdir -p ${q(`${h.dir}/run`)} && cat > ${q(`${h.dir}/run/${key}.sh`)}`, script)
    await spaced(ws.host!)
    writeFileSync(`${f}.go`, '')
  })().catch(e => writeFileSync(`${f}.err`, `\x1b[31m${(e as Error).message}\x1b[0m\r\n`))
  return [
    `f=${q(f)}`,
    'while [ ! -e "$f.go" ]; do [ -e "$f.err" ] && { cat "$f.err"; rm -f "$f.err"; exit 255; }; sleep 0.1; done',
    'rm -f "$f.go"',
    `exec ssh ${[...cs.sshF(), ...TAB_SSH, ws.host!, `exec sh "$HOME/.laki-host/${mac()}/run/${key}.sh"`].map(q).join(' ')}`,
  ].join('\n')
}

// tabs' own connections start 300 ms apart per host: sshd drops handshakes past 10 at once (MaxStartups), as a daemon
// restart with many tabs would make. ponytail: a fixed pace, not a count of handshakes under way
const opened = new Map<string, Promise<void>>()
function spaced(host: string) {
  const turn = opened.get(host) ?? Promise.resolve()
  opened.set(host, turn.then(() => new Promise(r => setTimeout(r, 300))))
  return turn
}

// pasted images, attached files (fileSave's) and the preview's screenshots are files on this Mac: a host's agent gets
// copies there, by their paths. An image by its whole path; a file by its folder, whatever its name after it (quoted,
// with spaces), which stays the same there
export async function toHost(host: string, h: HostRun, text?: string) {
  const at = (sub: string) => `${join(dir, sub)}/`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const p of new Set(text?.match(new RegExp(`${at('images')}[\\w-]+\\.[A-Za-z]+|${at('files')}[\\w-]+/`, 'g')) ?? [])) {
    const file = p.endsWith('/')
    const there = `${h.dir}/${file ? 'files' : 'images'}/${basename(p)}${file ? '/' : ''}`
    try {
      const name = file ? (readdirSync(p)[0] ?? '') : '' // fileSave's folder holds the one
      await sshIn(host, `umask 077 && mkdir -p ${q(dirname(there + name))} && cat > ${q(there + name)}`, readFileSync(p + name))
      text = text!.split(p).join(there)
    } catch (e) {
      log(`ssh ${host}: ${p}: ${(e as Error).message}`)
    }
  }
  return text
}

// a host's workspace's $PORT here reaches its $PORT there, through the connection: its preview, Open in browser,
// Expose to the world and the agent browser work as they do here. ponytail: $PORT only, not ports a dev server picks
// itself (the status bar lists none of a host's)
export function forward(ws: Workspace, on = true) {
  if (!ws.host || !ws.port || !hosts.has(ws.host)) return
  const L = `${ws.port}:localhost:${ws.port}`
  run('ssh', ['-S', ctlOf(ws.host), '-O', on ? 'forward' : 'cancel', '-L', L, ws.host], { timeout: 10000 }).catch(e => log(`ssh ${ws.host}: ${on ? 'forward' : 'cancel'} -L ${L}: ${String(e.stderr || e.message).trim()}`))
}

// .laki.json of folders on SSH hosts, read there when a project or workspace comes, a tab starts (once) and at each PR
// scan: projectConfig runs in every view. null: none there (or not JSON)
export const hostCfg = new Map<string, ProjectConfig | null>() // by host:path
export async function readHostCfg(at: At) {
  const text = await exec(at, 'sh', ['-c', 'cat .laki.json 2>/dev/null; true'], { timeout: 20000 }).then(r => r.stdout, () => undefined)
  if (text === undefined) return // the host unreachable: what was read last stays
  try {
    hostCfg.set(`${at.host}:${at.path}`, text.trim() ? JSON.parse(text) : null)
  } catch {
    hostCfg.set(`${at.host}:${at.path}`, null)
  }
  for (const p of state.projects) if (p.trusted === 'as-read' && p.host === at.host && p.path === at.path) (p.trusted = cfgHash(fileCfg(p)), save()) // from before trust (load)
}
// a host workspace's: its project's, never its own folder's (projectConfig; fresh: again, else only when not read yet).
// A cloud workspace's project is here: cfgRead reads it
export const readHostCfgs = async (ws: Workspace, fresh = true) => {
  const p = state.projects.find(p => p.id === ws.project)
  if (p?.host && (fresh || !hostCfg.has(`${p.host}:${p.path}`))) await readHostCfg(p)
}

// ---------- cloud workspaces (settings.cloud, experimental): a workspace of a GitHub project here that runs in a
// Codespace, an SSH host of its own. host: Laki's name for it (codespace.ts' Host entry); path: the repo there
// (/workspaces/<repo>), on a branch of its own off the base, as a worktree's. gh here makes it in the background
// (wsNew answers at once, csState Creating); its tabs wait in hostTab, since connect waits for it (csUp), and print
// why it failed. Archive stops it, Restore starts it again, Delete deletes it. ponytail: one machine type, picked as
// it's made; no prebuilds; no .env copied (copyIncludes); ports only $PORT (forward); PRs and ship through gh on it

export const making = new Map<string, Promise<void>>() // by workspace: gh making its codespace
export const live = new Set<string>() // hosts with a connection up (connect)
// one no scan should reach now: being made, stopped, not connected (a scan never wakes one, nor waits minutes for it)
export const away = (ws: Workspace) => ws.codespace !== undefined && !live.has(ws.host!)
const csSet = (ws: Workspace, st: string, err?: string) => ((ws.csState = st), (ws.csError = err), save(), changed())

// what makeWs refuses before gh
export function cloudCheck(proj: Project, o: Pick<NewWs, 'from' | 'local' | 'pr' | 'race'>) {
  if (state.settings?.cloud !== true) throw new Error('Cloud workspaces are off: Settings › General › Experimental')
  if (o.from) throw new Error('a codespace is yours to make, from the app: GitHub bills it') // an agent's
  if (proj.host || proj.kind || proj.git === false) throw new Error(`a codespace needs a GitHub repository on this Mac: ${proj.name} isn't one`)
  if (o.local || o.pr?.trim() || o.race) throw new Error("a codespace starts on a branch of its own: not Local, a PR's or a race")
}
const ghRepoOf = async (p: Project) => {
  const r = cs.ghRepo(await git(p, 'remote', 'get-url', 'origin').catch(() => ''))
  if (!r) throw new Error(`${p.name}'s origin isn't on GitHub: codespaces are GitHub's`)
  return r
}

// the new-workspace page's machine types for a project's repo
export async function csMachines(o: { project: string }) {
  const p = findProject(o.project)
  cloudCheck(p, {})
  const repo = await ghRepoOf(p)
  return { repo, machines: await cs.machines(repo) }
}

// a cloud workspace as makeWs pushes it, its codespace on its way (csMake); the scope, the repo and the machine
// type asked now, not minutes later
export async function cloudNew(proj: Project, o: NewWs, base: string, step: (text: string) => void): Promise<Workspace> {
  const repo = await ghRepoOf(proj)
  const ms = await cs.machines(repo)
  const machine = o.codespace?.trim() || ms[0]?.name
  if (!machine || !ms.some(m => m.name === machine)) throw new Error(`no machine type ${machine ?? ''} for ${repo}${ms.length ? `: ${ms.map(m => m.name).join(', ')}` : ''}`)
  const id = await uniqueWsId(slug(o.name || (o.prompt ?? '').split(/\s+/).slice(0, 4).join(' ')), proj)
  base = base.replace(/^origin\//, '')
  const ws: Workspace = { id, project: proj.id, path: `${cs.CS_ROOT}/${repo.split('/')[1]}`, host: `laki-cs-${id}`, branch: `${branchPrefix()}${id}`, base, kind: 'worktree', port: allocPort(), created: Date.now(), codespace: '', csState: 'Creating' }
  step(`gh codespace create -R ${repo} -b ${base} -m ${machine}: in the background`)
  cs.sshConfig() // its tabs' ssh lines take -F from now
  making.set(id, csMake(ws, proj, repo, machine))
  return ws
}

// gh makes it (minutes), it's Available, its Host entry written, its branch made there; a failure is the workspace's
// (Failed and why: the row, the status bar, its tabs). One deleted meanwhile goes too
async function csMake(ws: Workspace, proj: Project, repo: string, machine: string) {
  try {
    ws.codespace = await cs.create(proj.path, repo, ws.base, machine)
    save()
    changed()
    if (!state.workspaces.includes(ws)) return void cs.remove(ws.codespace).catch(e => log(`codespace ${ws.codespace}: ${(e as Error).message}`))
    wsLog(ws, `codespace ${ws.codespace}: made (${machine})`)
    await cs.until(ws.codespace)
    await cs.sshEntry(ws.codespace, ws.host!)
    // a connection of its own: connect waits for this
    await run('ssh', [...cs.sshF(), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=60', ws.host!, `cd ${q(ws.path)} && git checkout -q -b ${q(ws.branch)}`], { timeout: 120000 }).catch(e => {
      throw new Error(`git checkout -b ${ws.branch} there: ${firstLine(e)}`)
    })
    csSet(ws, 'Available')
    void hostUp(ws.host!).catch(() => {}) // connected: scans reach it (away), with tabs or none
  } catch (e) {
    csSet(ws, 'Failed', (e as Error).message)
    wsLog(ws, `codespace: ${ws.csError}`)
  } finally {
    making.delete(ws.id)
  }
}

// connect's for a cloud workspace's host: made (or why not), running (a stopped one started: Restore, Enter in a tab,
// a restart's tabs), its Host entry there. ponytail: restoreAll starts every live one's tabs, and so it: archive one
// to keep it stopped
async function csUp(ws: Workspace) {
  await making.get(ws.id)
  if (!state.workspaces.includes(ws)) throw new Error('codespace: its workspace is gone')
  if (!ws.codespace || ws.csState === 'Failed') throw new Error(`codespace: ${ws.csError ?? 'not made'}`)
  let st = ws.csState
  try {
    st = await cs.stateOf(ws.codespace)
    if (st !== 'Available') (csSet(ws, 'Starting'), await cs.start(ws.codespace, st))
    if (!cs.hasEntry(ws.host!)) await cs.sshEntry(ws.codespace, ws.host!)
    csSet(ws, 'Available')
  } catch (e) {
    csSet(ws, st ?? 'Shutdown', (e as Error).message)
    throw new Error(`codespace ${ws.codespace}: ${(e as Error).message}`)
  }
}

// each one's state as gh lists it, with the PR scan and as a connection ends: one its idle timeout stopped says so
let listing = false
let listSaid = ''
export async function csRefresh() {
  const mine = state.workspaces.filter(w => w.codespace && w.csState !== 'Failed' && !making.has(w.id))
  if (!mine.length || listing) return
  listing = true
  try {
    const was = new Map(mine.map(w => [w, w.csState]))
    const st = await cs.list()
    const moved = mine.filter(w => st.has(w.codespace!) && st.get(w.codespace!) !== w.csState && w.csState === was.get(w)) // not what Laki set meanwhile (an archive's stop)
    for (const w of moved) w.csState = st.get(w.codespace!)
    if (moved.length) save(), changed()
  } catch (e) {
    if ((e as Error).message !== listSaid) log((listSaid = (e as Error).message)) // once, not each minute
  } finally {
    listing = false
  }
}

// a cloud workspace's codespace goes with it (archivedTidy, its project removed: wsRm deletes it first, and waits),
// and its Host entry
export function csGone(ws: Workspace) {
  if (ws.codespace) void cs.remove(ws.codespace).catch(e => log(`codespace ${ws.codespace}: ${(e as Error).message}`))
  cs.forget(ws.host!)
}
