// Test rig: a temp LAKI_HOME (and HOME), fake claude/codex/gh/open first on PATH, a test $SHELL without
// profiles, a temp git repo, and a daemon started from source. Nothing touches real data or the network.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = fileURLToPath(new URL('..', import.meta.url))
const fakes = join(root, 'test/fakes')
const node = [process.execPath, '--experimental-strip-types', '--no-warnings']

// R9: one multiplier for every wait's limit (until, seen; not sleep): LAKI_TEST_SLOW, else from the load as this file
// starts (1 on a quiet machine, up to 3 with more runnable processes than cores: a release build beside the tests)
export const SLOW = Number(process.env.LAKI_TEST_SLOW) || Math.max(1, Math.min(3, Math.round(loadavg()[0] / cpus().length)))
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) // as written: a settle's length is part of some tests (a timer's seconds, a debounce)

// whether a process exists (signal 0 only checks)
export function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function until<T>(f: () => T | Promise<T>, what = 'condition', ms = 20000): Promise<T> { // room for a loaded machine: a pass returns at once
  const end = Date.now() + ms * SLOW
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await f()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`timed out after ${(ms * SLOW) / 1000} s waiting for ${what}${last ? `: ${last}` : ''}${SLOW > 1 ? ` (waits ×${SLOW}: LAKI_TEST_SLOW or the load)` : ''}`)
}
// a daemon event a connected window (connect's) got, or gets: no sleep, a clear message when it never comes
export const seen = <E extends { ev?: string }>(app: { events: E[] }, is: (e: E) => unknown, what = 'an event', ms?: number) => until(() => app.events.find(is), what, ms)
// E3: a view sent after from (app.events.length before the change) with that tab's status: changed()'s 30 ms passed
export const viewed = (app: { events: any[] }, from: number, tab: string, status: string) => until(() => app.events.slice(from).some(e => e.ev === 'state' && e.view.tabs.some((x: any) => x.id === tab && x.status === status)), `a view with ${tab} ${status}`)

export type Rig = Awaited<ReturnType<typeof fresh>>
// links and my-prs (test/widgets: extensions that came with Laki before 0.44), copied into this rig as a folder of yours
// (Settings' extension folders), never the repo's own files; off until turned on, as any
export async function fixtureWidgets(rig: Rig) {
  const d = join(rig.home, 'fixture-widgets')
  cpSync(join(root, 'test', 'widgets'), d, { recursive: true })
  await rig.rpc('settingsSet', { widgetDirs: [d] })
  return d
}

export async function fresh(t: TestContext, o: { setup?: string; config?: object; env?: Record<string, string> } = {}) {
  const home = mkdtempSync('/tmp/laki-')
  const repo = join(home, 'repo')
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    LAKI_HOME: join(home, 'data'),
    // $HOME/bin: fakes a test installs (cloudflared); node for the fakes
    PATH: `${join(home, 'bin')}:${fakes}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    SHELL: join(fakes, 'tsh'),
    FAKE_LOG: join(home, 'fake.log'),
    FAKE_GH: join(home, 'gh'), // the fake gh's answers, when there (fakes/gh)
    LAKI_PAGE: join(home, 'page'), // the page remote access serves: a test's own, never the build
    LAKI_TAILSCALE_APP: join(home, 'no-tailscale'), // the Mac app's place: none here, whatever this Mac has
    LAKI_TEST_PARENT: String(process.pid), // the daemon goes when this test process does (killed midway too)
    LAKI_PORT_SCAN_MS: '300',
    LAKI_PR_SCAN_MS: '500',
    LAKI_STAT_SCAN_MS: '300',
    LAKI_RESTORE_GAP: '0', // a restart's tabs all at once (restart.test.ts tries the queue)
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE') || k.startsWith('ELECTRON_') || k === 'TMUX' || k === 'LAKI_TAB_TOKEN' || k === 'CODEX_HOME' || k.startsWith('ANDROID_')) delete env[k] // ANDROID_HOME: the Simulator's adb, never this Mac's
  Object.assign(env, o.env)
  mkdirSync(join(home, 'bin'))
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env })
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  if (o.config) writeFileSync(join(repo, '.laki.json'), JSON.stringify(o.config))
  execFileSync('git', ['add', '-A'], { cwd: repo, env })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, env })

  let daemon: ChildProcess | null = null
  const rig = {
    home,
    repo,
    env,
    data: env.LAKI_HOME,
    out: '', // what the daemon said (its daemon.log when detached), every start's
    app: '', // S1: the app's token, as main reads it from the daemon it starts (fd 3): the rig's calls are the app's window
    async start() {
      daemon = spawn(node[0], [...node.slice(1), join(root, 'src/daemon/main.ts')], { env: { ...env, LAKI_APP_PIPE: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
      daemon.stdout!.on('data', d => (rig.out += d))
      daemon.stderr!.on('data', d => (rig.out += d))
      let said = ''
      daemon.stdio[3]!.on('data', d => (said += d))
      await until(() => /^[0-9a-f]{64}\n/.test(said) && (rig.app = said.slice(0, 64)), `daemon start (${rig.out})`)
      await until(() => rig.rpc('ping').then(r => r === 'pong'), `daemon start (${rig.out})`)
    },
    async stop() {
      if (!daemon) return
      const d = daemon
      daemon = null
      rig.app = '' // that daemon's: a CLI's autostart gives none (S1)
      const gone = new Promise(r => d.once('exit', r))
      d.kill('SIGTERM')
      await gone
    },
    info: () => JSON.parse(readFileSync(join(env.LAKI_HOME, 'daemon.json'), 'utf8')) as { port: number; token: string; pid: number },
    async rpc(method: string, params: object = {}): Promise<any> {
      const { port, token } = rig.info()
      // the app's token; a daemon the CLI started (no fd 3) or a stopped one's: daemon.json's
      const ask = (t: string) => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ method, params }) })
      let res = await ask(rig.app || token)
      if (res.status === 401 && rig.app) res = await ask(token)
      return rig.answer(method, params, res)
    },
    async answer(method: string, params: object, res: Response): Promise<any> {
      if (res.status === 401) throw new Error('bad token')
      const b = await res.json()
      if (b.error) throw new Error(b.error)
      // a test's own .laki.json is trusted as its project comes (H1's tests add with untrusted: true)
      if (method === 'projectAdd' && !(params as { untrusted?: boolean }).untrusted) await rig.trust(b.result.id)
      return b.result
    },
    // its .laki.json trusted as it is now (the app's sheet: projectTrust)
    async trust(project: string) {
      const { hash, trusted } = await rig.rpc('projectTrust', { id: project })
      if (!trusted) await rig.rpc('projectTrust', { id: project, hash })
    },
    // the CLI, from source, against this rig's daemon; stdin: what it reads, then the end
    cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
      return rig.cliIn(undefined, ...args)
    },
    cliIn(stdin: string | undefined, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
      return new Promise(r => {
        const p = spawn(node[0], [...node.slice(1), join(root, 'src/cli/main.ts'), ...args], { env: { ...env, ...(rig.app && { LAKI_APP_TOKEN: rig.app }) } }) // S1: the app's, as your window's calls
        if (stdin !== undefined) p.stdin.end(stdin)
        let out = ''
        let err = ''
        p.stdout.on('data', d => (out += d))
        p.stderr.on('data', d => (err += d))
        p.on('exit', code => r({ code: code ?? 1, out, err }))
      })
    },
    fakeLog: () =>
      readFileSync(env.FAKE_LOG, 'utf8')
        .split('\n')
        .filter(l => l.startsWith('{'))
        .map(l => JSON.parse(l)),
    tab: async (ws: string, name?: string) => {
      const v = await rig.rpc('state')
      return v.tabs.find((t: any) => t.workspace === ws && (name ? t.name === name : t.kind === 'agent'))
    },
    screen: (target: string) => rig.rpc('screen', { target, lines: 200 }) as Promise<string>,
    connect: (origin?: string) => connect(rig, origin),
  }
  t.after(async () => {
    await rig.stop()
    // a daemon the CLI started in this home (autostart): shut down by its pid (SIGTERM: its shutdown), daemon.json's
    if (existsSync(join(env.LAKI_HOME, 'daemon.json'))) {
      const { pid } = rig.info()
      try {
        process.kill(pid, 'SIGTERM')
        await until(() => !running(pid), 'autostarted daemon gone').catch(() => {})
      } catch {}
    }
    // a child the daemon started (a PR scan's gh) may still write here a moment after it stopped
    for (let i = 0; ; i++) {
      try { rmSync(home, { recursive: true, force: true }); break } catch (e) {
        if (i === 4) throw e
        await new Promise(r => setTimeout(r, 300))
      }
    }
  })
  await rig.start()
  return rig
}

// A WebSocket client like the renderer's: requests by id, events collected.
// auth: as remote access's page (S11): the token in its first message, none in the URL
export async function connect(rig: { info(): { port: number; token: string }; app?: string }, origin?: string, token?: string, auth = false) {
  const { port, token: tk } = rig.info()
  const ws = new WebSocket(auth ? `ws://127.0.0.1:${port}/ws` : `ws://127.0.0.1:${port}/ws?token=${token ?? (rig.app || tk)}`, origin ? { origin } : {}) // S1: the app's window's token
  let seq = 0
  const waiting = new Map<number, (m: any) => void>()
  const events: any[] = []
  // before open: what the daemon sends as it connects (a due reminder) can come in the handshake's packet
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.id !== undefined && !m.ev) waiting.get(m.id)?.(m) // an event with an id (a workflow run's) is still an event, as api.ts reads it
    else events.push(m)
  })
  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })
  if (auth) ws.send(JSON.stringify({ auth: token }))
  return {
    ws,
    events,
    call(method: string, params: object = {}): Promise<any> {
      const id = ++seq
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((res, rej) => waiting.set(id, m => (m.error ? rej(new Error(m.error)) : res(m.result))))
    },
    notify(method: string, params: object) {
      ws.send(JSON.stringify({ method, params }))
    },
    data: (tab: string) =>
      events
        .filter(e => e.ev === 'data' && e.tab === tab)
        .map(e => e.d)
        .join(''),
    close() {
      ws.close()
    },
  }
}
