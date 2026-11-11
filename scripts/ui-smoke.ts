// R8: the real window, walked page by page (npm run test:ui). A demo world of its own (scripts/demo.ts: a temp HOME and
// LAKI_HOME, fake agents), the built app (out/: npm run build first) in Electron with --laki-smoke (main's uiSmoke:
// each page opened, a selector of its own waited for, no Boundary, no console error, a screenshot). The screenshots end
// in dist/ui-smoke; the demo daemon is stopped and the temp folder removed, pass or fail. LAKI_DEMO_RICH=1: the rich
// world, and the README's stills instead of the walk (main's uiSmoke readme), copied to docs/img.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(root, 'out/main/index.js'))) throw new Error('no build in out/: npm run build first')
const home = mkdtempSync('/tmp/laki-ui-')
const shots = join(root, 'dist/ui-smoke')
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
try {
  const demo = JSON.parse(node('scripts/demo.ts', home).trim().split('\n').pop()!) as { token?: string }
  // a new install starts without Labs: Workflows on for its step
  process.env.HOME = home
  process.env.LAKI_HOME = join(home, 'data')
  if (demo.token) env.LAKI_APP_TOKEN = process.env.LAKI_APP_TOKEN = demo.token // S1: the app's token (the demo daemon isn't the app's to pair with: plain node)
  const { rpc } = await import('../src/shared/conn.ts')
  await rpc('settingsSet', { labs: true, workflows: true }) // Workflows on the rail (the other Labs pages stay off: it fits)
  const app = spawn(createRequire(import.meta.url)('electron') as string, [ // Electron's binary itself: .bin/electron is a node script, and a version manager's node shim can't find node under the temp HOME
    join(root, 'out/main/index.js'), `--user-data-dir=${join(home, 'userdata')}`, `--laki-smoke=${join(home, 'shots')}`], { cwd: root, env, stdio: 'ignore' })
  const timer = setTimeout(() => app.kill(), 120_000) // E3: the flows too
  code = await new Promise<number>(ok => app.on('exit', c => ok(c ?? 1)))
  clearTimeout(timer)
  const result = join(home, 'shots/result.json')
  if (existsSync(result)) {
    const steps = JSON.parse(readFileSync(result, 'utf8')) as { name: string; ok: boolean; ms: number; why?: string }[]
    for (const s of steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(18)} ${String(s.ms).padStart(5)} ms${s.why ? `  ${s.why}` : ''}`)
    rmSync(shots, { recursive: true, force: true })
    cpSync(join(home, 'shots'), shots, { recursive: true })
    // M1: the rich world's stills are the README's (docs/img/<name>.png), only when every step passed
    if (process.env.LAKI_DEMO_RICH && !steps.every(s => s.ok)) console.log('docs/img left as it was: a step failed')
    else if (process.env.LAKI_DEMO_RICH) for (const f of readdirSync(shots).filter(f => /^\d+-readme-(?!setup|done)/.test(f))) cpSync(join(shots, f), join(root, 'docs/img', f.replace(/^\d+-readme-/, '')))
    console.log(firstLoad())
    console.log(`screenshots: ${shots}`)
  } else console.log('the window never finished: no result.json (120 s at most)')
} finally {
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'bin/laki.js', 'stop'], { cwd: root, env, stdio: 'ignore' })
  } catch {}
  rmSync(home, { recursive: true, force: true })
}
process.exit(code)
