// R8: the real window, walked page by page (npm run test:ui). A demo world of its own (scripts/demo.ts: a temp HOME and
// LAKI_HOME, fake agents), the built app (out/: npm run build first) in Electron with --laki-smoke (main's uiSmoke:
// each page opened, a selector of its own waited for, no Boundary, no console error, a screenshot). The screenshots end
// in dist/ui-smoke; the demo daemon is stopped and the temp folder removed, pass or fail. LAKI_DEMO_RICH=1: the rich
// world, and the README's stills instead of the walk (main's uiSmoke readme), copied to docs/img. LAKI_UI_THEME=<theme id>:
// the walk in that theme (laki, laki-light), not the system's. LAKI_SHEET: scripts/ui-sheet.ts' (npm run test:sheet).
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(root, 'out/main/index.js'))) throw new Error('no build in out/: npm run build first')
const home = mkdtempSync('/tmp/laki-ui-')
const shots = join(root, process.env.LAKI_SHEET ? 'dist/ui-sheet' : 'dist/ui-smoke') // LAKI_SHEET: scripts/ui-sheet.ts' run
const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, LAKI_HOME: join(home, 'data'), ...(process.env.LAKI_DEMO_RICH && { LAKI_OVERLAP_MS: '2000' }) }).filter(([k]) => !k.startsWith('CLAUDE') && !k.startsWith('ELECTRON_')))
const node = (...a: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...a], { cwd: root, env, encoding: 'utf8' })
let code = 1
// E8: the JS the app window loads before it draws: the entry's static imports, and App's chunk (main.tsx' import) with its own
function firstLoad() {
  const dir = join(root, 'out/renderer')
  const entry = /src="\.\/(assets\/[^"]+\.js)"/.exec(readFileSync(join(dir, 'index.html'), 'utf8'))?.[1]
  if (!entry) return 'first load: no entry script in out/renderer/index.html'
  const seen = new Set<string>()
  const walk = (f: string) => {
    if (seen.has(f)) return
    seen.add(f)
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/(?:^|[;\n])\s*import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(`assets/${m[1]}`)
  }
  walk(entry)
  const app = /import\(["']\.\/(App-[^"']+\.js)["']\)/.exec(readFileSync(join(dir, entry), 'utf8'))?.[1]
  if (app) walk(`assets/${app}`)
  const kb = [...seen].reduce((n, f) => n + statSync(join(dir, f)).size, 0) / 1024
  return `first load: ${kb.toFixed(0)} KB of JS in ${seen.size} files (entry ${(statSync(join(dir, entry)).size / 1024).toFixed(0)} KB)`
}
// a daemon gone (5 s at most): its last writes (pty.json) come as it exits
async function gone(pid: number) {
  const alive = () => { try { return !!pid && process.kill(pid, 0) } catch { return false } }
  for (const end = Date.now() + 5000; alive() && Date.now() < end; ) await new Promise(r => setTimeout(r, 100))
  return alive() // still there: 5 s went by
}
type Step = { name: string; ok: boolean; ms: number; why?: string }
const electron = createRequire(import.meta.url)('electron') as string // Electron's binary itself: .bin/electron is a node script, and a version manager's node shim can't find node under the temp HOME
// the first run, before the demo world: a short launch of its own on an empty data folder (no state.json, no project),
// its daemon the app's own, the fakes first on PATH (main's uiSmoke firstRun: Welcome, then Try it on a sample repo)
async function firstRun(): Promise<{ steps: Step[]; shots: string }> {
  const at = mkdtempSync('/tmp/laki-ui-first-')
  const fenv = { ...env, HOME: at, LAKI_HOME: join(at, 'data'), LAKI_SMOKE_FIRST: '1', SHELL: join(root, 'test/fakes/tsh'), PATH: `${join(root, 'test/fakes')}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` }
  delete (fenv as Record<string, string | undefined>).LAKI_APP_TOKEN
  try {
    const app = spawn(electron, [join(root, 'out/main/index.js'), `--user-data-dir=${join(at, 'userdata')}`, `--laki-smoke=${join(at, 'shots')}`], { cwd: root, env: fenv, stdio: 'ignore' })
    const timer = setTimeout(() => app.kill(), 60_000)
    await new Promise(ok => app.on('exit', ok))
    clearTimeout(timer)
    const result = join(at, 'shots/result.json')
    const steps = existsSync(result) ? (JSON.parse(readFileSync(result, 'utf8')) as Step[]) : [{ name: 'first-run', ok: false, ms: 0, why: 'the window never finished: no result.json (60 s at most)' }]
    const keep = mkdtempSync('/tmp/laki-ui-first-shots-')
    if (existsSync(join(at, 'shots'))) cpSync(join(at, 'shots'), keep, { recursive: true })
    return { steps, shots: keep }
  } finally {
    let pid = 0
    try {
      pid = (JSON.parse(readFileSync(join(at, 'data/daemon.json'), 'utf8')) as { pid: number }).pid
      execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'bin/laki.js', 'stop'], { cwd: root, env: fenv, stdio: 'ignore', timeout: 10_000 })
    } catch {}
    // the app started it: it refuses this script's stop (its caller check knows only the app), so its own temp daemon
    // is ended by its pid, or every run leaves one; only while it's there (a pid gone may be another process's by now)
    if (await gone(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
      await gone(pid)
    }
    rmSync(at, { recursive: true, force: true })
    await new Promise(r => setTimeout(r, 1000)) // a fake its daemon started (an agent's version asked) may still write its HOME
    rmSync(at, { recursive: true, force: true })
  }
}
let fr: Awaited<ReturnType<typeof firstRun>> | undefined
try {
  fr = process.env.LAKI_SHEET || process.env.LAKI_DEMO_RICH ? undefined : await firstRun()
  const demo = JSON.parse(node('scripts/demo.ts', home).trim().split('\n').pop()!) as { token?: string }
  // a new install starts without Labs: Workflows on for its step
  process.env.HOME = home
  process.env.LAKI_HOME = join(home, 'data')
  if (demo.token) env.LAKI_APP_TOKEN = process.env.LAKI_APP_TOKEN = demo.token // S1: the app's token (the demo daemon isn't the app's to pair with: plain node)
  const { rpc } = await import('../src/shared/conn.ts')
  await rpc('settingsSet', { labs: true, workflows: true }) // Workflows on the rail (the other Labs pages stay off: it fits)
  if (process.env.LAKI_UI_THEME) await rpc('settingsSet', { theme: process.env.LAKI_UI_THEME, themeAuto: false }) // LAKI_UI_THEME=laki-light: the walk in that theme (a look's check in each)
  const app = spawn(electron, [
    join(root, 'out/main/index.js'), `--user-data-dir=${join(home, 'userdata')}`, `--laki-smoke=${join(home, 'shots')}`], { cwd: root, env, stdio: 'ignore' })
  const timer = setTimeout(() => app.kill(), process.env.LAKI_SHEET ? 1_800_000 : 120_000) // E3: the flows too; the sheet's every look
  code = await new Promise<number>(ok => app.on('exit', c => ok(c ?? 1)))
  clearTimeout(timer)
  const result = join(home, 'shots/result.json')
  if (existsSync(result)) {
    const steps = [...(fr?.steps ?? []), ...(JSON.parse(readFileSync(result, 'utf8')) as Step[])]
    if (!process.env.LAKI_SHEET) for (const s of steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(18)} ${String(s.ms).padStart(5)} ms${s.why ? `  ${s.why}` : ''}`)
    if (fr?.steps.some(s => !s.ok)) code ||= 1
    rmSync(shots, { recursive: true, force: true })
    cpSync(join(home, 'shots'), shots, { recursive: true })
    if (fr) for (const f of readdirSync(fr.shots).filter(f => f.endsWith('.png'))) cpSync(join(fr.shots, f), join(shots, `first-${f}`))
    // M1: the rich world's stills are the README's (docs/img/<name>.png), only when every step passed
    if (process.env.LAKI_DEMO_RICH && !steps.every(s => s.ok)) console.log('docs/img left as it was: a step failed')
    else if (process.env.LAKI_DEMO_RICH) for (const f of readdirSync(shots).filter(f => /^\d+-readme-(?!setup|done)/.test(f))) cpSync(join(shots, f), join(root, 'docs/img', f.replace(/^\d+-readme-/, '')))
    console.log(firstLoad())
    console.log(`screenshots: ${shots}`)
  } else console.log(`the window never finished: no result.json (${process.env.LAKI_SHEET ? 30 * 60 : 120} s at most)`)
} finally {
  let pid = 0
  try {
    pid = (JSON.parse(readFileSync(join(home, 'data/daemon.json'), 'utf8')) as { pid: number }).pid
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'bin/laki.js', 'stop'], { cwd: root, env, stdio: 'ignore' })
  } catch {}
  await gone(pid) // the folder goes once it's gone, or it comes back
  rmSync(home, { recursive: true, force: true })
  if (fr) rmSync(fr.shots, { recursive: true, force: true })
}
process.exit(code)
