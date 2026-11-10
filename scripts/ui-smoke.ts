// R8: the real window, walked page by page (npm run test:ui). A demo world of its own (scripts/demo.ts: a temp HOME and
// LAKI_HOME, fake agents), the built app (out/: npm run build first) in Electron with --laki-smoke (main's uiSmoke:
// each page opened, a selector of its own waited for, no Boundary, no console error, a screenshot). The screenshots end
// in dist/ui-smoke; the demo daemon is stopped and the temp folder removed, pass or fail.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(root, 'out/main/index.js'))) throw new Error('no build in out/: npm run build first')
const home = mkdtempSync('/tmp/laki-ui-')
const shots = join(root, 'dist/ui-smoke')
const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, LAKI_HOME: join(home, 'data') }).filter(([k]) => !k.startsWith('CLAUDE') && !k.startsWith('ELECTRON_')))
const node = (...a: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...a], { cwd: root, env, encoding: 'utf8' })
let code = 1
try {
  const demo = JSON.parse(node('scripts/demo.ts', home).trim().split('\n').pop()!) as { token?: string }
  // a new install starts without Labs: Workflows on for its step
  process.env.HOME = home
  process.env.LAKI_HOME = join(home, 'data')
  if (demo.token) env.LAKI_APP_TOKEN = process.env.LAKI_APP_TOKEN = demo.token // S1: the app's token (the demo daemon isn't the app's to pair with: plain node)
  const { rpc } = await import('../src/shared/conn.ts')
  await rpc('settingsSet', { labs: true, workflows: true }) // Workflows on the rail (the other Labs pages stay off: it fits)
  const app = spawn(join(root, 'node_modules/.bin/electron'), [join(root, 'out/main/index.js'), `--user-data-dir=${join(home, 'userdata')}`, `--laki-smoke=${join(home, 'shots')}`], { cwd: root, env, stdio: 'ignore' })
  const timer = setTimeout(() => app.kill(), 60_000)
  code = await new Promise<number>(ok => app.on('exit', c => ok(c ?? 1)))
  clearTimeout(timer)
  const result = join(home, 'shots/result.json')
  if (existsSync(result)) {
    for (const s of JSON.parse(readFileSync(result, 'utf8')) as { name: string; ok: boolean; ms: number; why?: string }[]) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(14)} ${String(s.ms).padStart(5)} ms${s.why ? `  ${s.why}` : ''}`)
    rmSync(shots, { recursive: true, force: true })
    cpSync(join(home, 'shots'), shots, { recursive: true })
    console.log(`screenshots: ${shots}`)
  } else console.log('the window never finished: no result.json (60 s at most)')
} finally {
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'bin/laki.js', 'stop'], { cwd: root, env, stdio: 'ignore' })
  } catch {}
  rmSync(home, { recursive: true, force: true })
}
process.exit(code)
