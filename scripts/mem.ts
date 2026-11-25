// npm run mem: Laki's memory held to a budget, as npm run size holds the first load (a local gate: release.sh runs it
// after the build, LAKI_SKIP_MEM=1 skips it loudly; not in check: it needs the packaged app). The demo world
// (scripts/demo.ts, three workspaces, fake agents) in a temp folder, its own daemon stopped, then the packaged app (APP,
// else dist/mac-arm64 or dist/mac) started on that world with an env of its own: it starts its daemon, which brings the
// workspaces back. Once every tab is back and no agent runs (90 s at most), 15 s more, then five RSS samples 3 s apart, the median of each: the daemon
// (daemon.json's pid), the window's renderer (the app's largest), the pty host (ptyhost.log's pid since). Held to
// package.json's lakiMem { daemon, renderer, ptyhost } in MB, 10% allowed; -- --write sets it to what it is now. Never
// the real ~/.laki: the temp folder only, removed after. scripts/mem.sh: the same by hand, with idle CPU
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MEM_KEYS = ['daemon', 'renderer', 'ptyhost'] as const
export type Mem = Record<(typeof MEM_KEYS)[number], number>
export const MEM_ALLOWED = 0.1
const SAMPLE_MS = 3000 // five samples over 12 s: a renderer's garbage collection in one moves the median little
const SETTLE_MS = 15_000 // after the last agent is idle: what restoring them allocated, collected
// over: the ones past their budget by more than allowed; missing: no budget for it (--write sets one)
export function memCheck(now: Mem, budget: Partial<Mem> | undefined, allowed = MEM_ALLOWED): { over: (keyof Mem)[]; missing: (keyof Mem)[] } {
  const missing = MEM_KEYS.filter(k => !(Number(budget?.[k]) > 0))
  return {
    over: MEM_KEYS.filter(k => !missing.includes(k) && now[k] > budget![k]! * (1 + allowed)),
    missing,
  }
}
export const median = (xs: number[]) => (s => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2))([...xs].sort((a, b) => a - b))

const root = fileURLToPath(new URL('..', import.meta.url))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(f: () => T | Promise<T>, what: string, ms: number): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const v = await f()
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(250)
  }
}
const ps = () =>
  execFileSync('/bin/ps', ['-axo', 'pid=,rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
    .split('\n')
    .map(l => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(m => !!m)
    .map(m => ({ pid: Number(m[1]), mb: Number(m[2]) / 1024, cmd: m[3] }))

async function main() {
  const app = process.env.APP ?? join(root, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Laki.app')
  const bin = join(app, 'Contents/MacOS/Laki')
  if (!existsSync(bin)) throw new Error(`no ${bin}: npm run pack first (or APP=…/Laki.app)`)
  const home = mkdtempSync(join(tmpdir(), 'laki-mem-'))
  const data = join(home, 'data')
  let appPid: number | undefined
  let failed = true
  let daemonPid: number | undefined
  try {
    // the demo world, made by its own daemon (from source), which then stops
    const demo = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts/demo.ts'), home], { stdio: ['ignore', 'pipe', 'inherit'] })
    let said = ''
    demo.stdout.on('data', d => (said += d))
    await new Promise(ok => demo.on('exit', ok))
    const made = said
      .split('\n')
      .map(l => (l.startsWith('{') ? JSON.parse(l) : undefined))
      .find(x => x?.url) as { url: string } | undefined
    if (!made) throw new Error(`the demo world didn't start: ${said.slice(-300)}`)
    const u = new URL(made.url.replace('#', '?'))
    await fetch(`http://127.0.0.1:${u.searchParams.get('port')}/rpc`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${u.searchParams.get('token')}`,
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:5199',
      },
      body: JSON.stringify({ method: 'shutdown', params: {} }),
    }).catch(() => {})
    await until(() => !existsSync(join(data, 'daemon.json')), "the demo's daemon to stop", 15_000)
    // the packaged app on that world: the env the demo's agents need (test/fakes first on PATH), nothing of this shell's
    const ptyLog = join(data, 'ptyhost.log')
    const ptyFrom = existsSync(ptyLog) ? statSync(ptyLog).size : 0
    const env: Record<string, string> = {
      HOME: home,
      LAKI_HOME: data,
      PATH: `${join(root, 'test/fakes')}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: join(root, 'test/fakes/tsh'),
      FAKE_LOG: join(home, 'fake.log'),
      FAKE_TURN_MS: '4000',
      FAKE_SCRIPT: join(home, 'scripts.json'),
      FAKE_GH: join(home, 'gh'),
      TMPDIR: tmpdir(),
      LANG: 'en_US.UTF-8',
      GIT_AUTHOR_NAME: 'demo',
      GIT_AUTHOR_EMAIL: 'demo@example.invalid',
      GIT_COMMITTER_NAME: 'demo',
      GIT_COMMITTER_EMAIL: 'demo@example.invalid',
    }
    const out = openSync(join(home, 'app.out'), 'a')
    const a = spawn(bin, [`--user-data-dir=${join(home, 'userdata')}`], {
      env,
      stdio: ['ignore', out, out],
    }) // its own: beside a Laki that's open (one instance per userData)
    appPid = a.pid
    const info = await until(
      () => {
        try {
          return JSON.parse(readFileSync(join(data, 'daemon.json'), 'utf8')) as { pid: number; port: number; token: string }
        } catch {
          return undefined
        }
      },
      "the app's daemon",
      60_000,
    )
    daemonPid = info.pid
    const rpc = async (method: string, params = {}): Promise<any> => {
      const r = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${info.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(15_000),
      })
      const j = (await r.json()) as {
        result?: any
        error?: string | { message?: string }
      }
      if (j.error) throw new Error(typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error)))
      return j.result
    }
    const renderer = () =>
      Math.max(
        0,
        ...ps()
          .filter(p => p.cmd.startsWith(join(app, 'Contents/')) && p.cmd.includes('--type=renderer'))
          .map(p => p.mb),
      )
    const ptyPid = () =>
      existsSync(ptyLog)
        ? [
            ...readFileSync(ptyLog)
              .subarray(ptyFrom)
              .toString('utf8')
              .matchAll(/\(protocol \d+, pid (\d+)\)/g),
          ]
            .map(m => Number(m[1]))
            .at(-1)
        : undefined
    await until(() => renderer() > 0, 'the window', 60_000)
    const started = Date.now()
    // settled: every workspace back, no agent running or queued, the window connected; at least 10 s in
    await until(
      async () => {
        const v = await rpc('state').catch(() => undefined)
        return v && v.workspaces.length >= 3 && v.tabs.length > 0 && !v.tabs.some((t: { status: string; queued?: boolean; asleep?: boolean }) => t.status === 'running' || t.queued || t.asleep) && Date.now() - started > 10_000
      },
      'the agents to be idle',
      90_000,
    )
    const host = await until(ptyPid, 'the pty host', 15_000)
    await sleep(SETTLE_MS)
    const rows: Mem[] = []
    for (let i = 0; i < 5; i++) {
      const all = ps()
      const of = (pid: number) => all.find(p => p.pid === pid)?.mb ?? 0
      rows.push({
        daemon: of(info.pid),
        renderer: renderer(),
        ptyhost: of(host),
      })
      await sleep(SAMPLE_MS)
    }
    const now = Object.fromEntries(MEM_KEYS.map(k => [k, Math.round(median(rows.map(r => r[k])) * 10) / 10])) as Mem
    if (MEM_KEYS.some(k => !now[k])) throw new Error(`a process wasn't found: ${JSON.stringify(now)}`)
    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (process.argv.includes('--write')) {
      pkg.lakiMem = Object.fromEntries(MEM_KEYS.map(k => [k, Math.ceil(now[k])]))
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
      failed = false
      return console.log(`memory budget written: ${MEM_KEYS.map(k => `${k} ${pkg.lakiMem[k]} MB`).join(', ')}`)
    }
    const budget = pkg.lakiMem as Partial<Mem> | undefined
    const r = memCheck(now, budget)
    console.log(`${'RSS, median of 5'.padEnd(18)}${'now'.padStart(9)}${'budget'.padStart(9)}`)
    for (const k of MEM_KEYS)
      console.log(
        `${k.padEnd(18)}${`${now[k]} MB`.padStart(9)}${(budget?.[k] ? `${budget[k]} MB` : '-').padStart(9)}${r.over.includes(k) ? `  over by ${Math.round((now[k] / budget![k]! - 1) * 100)}%` : ''}`,
      )
    if (r.missing.length) throw new Error(`package.json's lakiMem has no ${r.missing.join(', ')}: npm run mem -- --write sets it`)
    if (r.over.length) {
      console.log(`over the budget (${MEM_ALLOWED * 100}% allowed): ${r.over.join(', ')}. Make it smaller, or raise the budget on purpose: npm run mem -- --write`)
      process.exitCode = 1
    }
    failed = false
  } finally {
    if (appPid)
      try {
        process.kill(appPid, 'SIGTERM')
      } catch {} // gone already
    if (failed && process.env.LAKI_MEM_KEEP) console.error(`mem: kept ${home} (its app.out, data/daemon.log)`)
    // its daemon (this temp world's: daemon.json's pid) stops as on a SIGTERM, its pty host and agents with it
    if (daemonPid)
      try {
        process.kill(daemonPid, 'SIGTERM')
        await until(
          () => {
            try {
              return (process.kill(daemonPid!, 0), false)
            } catch {
              return true
            }
          },
          'its daemon to stop',
          10_000,
        ).catch(() => {})
      } catch {}
    await sleep(500)
    if (!(failed && process.env.LAKI_MEM_KEEP)) rmSync(home, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => (console.error(`mem: ${(e as Error).message}`), process.exit(2)))
