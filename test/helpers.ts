// Test rig: a temp LAKI_HOME (and HOME), fake claude/codex/gh/open first on PATH, a test $SHELL without
// profiles, a temp git repo, and a daemon started from source. Nothing touches real data or the network.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = fileURLToPath(new URL('..', import.meta.url))
const fakes = join(root, 'test/fakes')
const node = [process.execPath, '--experimental-strip-types', '--no-warnings']

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// whether a process exists (signal 0 only checks)
export function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function until<T>(f: () => T | Promise<T>, what = 'condition', ms = 8000): Promise<T> {
  const end = Date.now() + ms
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await f()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last}` : ''}`)
}

export type Rig = Awaited<ReturnType<typeof fresh>>

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
    LAKI_PORT_SCAN_MS: '300',
    LAKI_PR_SCAN_MS: '500',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE') || k.startsWith('ELECTRON_') || k === 'TMUX' || k === 'CODEX_HOME') delete env[k]
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
    async start() {
      daemon = spawn(node[0], [...node.slice(1), join(root, 'src/daemon/main.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let log = ''
      daemon.stdout!.on('data', d => (log += d))
      daemon.stderr!.on('data', d => (log += d))
      await until(() => rig.rpc('ping').then(r => r === 'pong'), `daemon start (${log})`)
    },
    async stop() {
      if (!daemon) return
      const d = daemon
      daemon = null
      const gone = new Promise(r => d.once('exit', r))
      d.kill('SIGTERM')
      await gone
    },
    info: () => JSON.parse(readFileSync(join(env.LAKI_HOME, 'daemon.json'), 'utf8')) as { port: number; token: string; pid: number },
    async rpc(method: string, params: object = {}): Promise<any> {
      const { port, token } = rig.info()
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ method, params }),
      })
      const b = await res.json()
      if (b.error) throw new Error(b.error)
      return b.result
    },
    // the CLI, from source, against this rig's daemon
    cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
      return new Promise(r => {
        const p = spawn(node[0], [...node.slice(1), join(root, 'src/cli/main.ts'), ...args], { env })
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
    // a daemon the CLI started in this home (autostart): shut down through its own daemon.json
    if (existsSync(join(env.LAKI_HOME, 'daemon.json'))) {
      const { pid } = rig.info()
      if (await rig.rpc('shutdown').then(() => true, () => false)) await until(() => !running(pid), 'autostarted daemon gone').catch(() => {})
    }
    rmSync(home, { recursive: true, force: true })
  })
  await rig.start()
  return rig
}

// A WebSocket client like the renderer's: requests by id, events collected.
export async function connect(rig: { info(): { port: number; token: string } }, origin?: string, token?: string) {
  const { port, token: tk } = rig.info()
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token ?? tk}`, origin ? { origin } : {})
  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })
  let seq = 0
  const waiting = new Map<number, (m: any) => void>()
  const events: any[] = []
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.id !== undefined) waiting.get(m.id)?.(m)
    else events.push(m)
  })
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
