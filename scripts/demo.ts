// A throwaway demo world for trying the UI: temp WBS_HOME and HOME, a temp git repo, fake claude/codex/gh
// (test/fakes) first on PATH, and a daemon serving the dev renderer origin. Prints the URL to open.
//   node --experimental-strip-types scripts/demo.ts [dir]      stop: WBS_HOME=<dir>/data wbs stop
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = process.argv[2] ?? mkdtempSync('/tmp/wbs-demo-')
mkdirSync(home, { recursive: true })
const repo = join(home, 'shop')
Object.assign(process.env, {
  HOME: home,
  WBS_HOME: join(home, 'data'),
  PATH: `${join(root, 'test/fakes')}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  SHELL: join(root, 'test/fakes/tsh'),
  FAKE_LOG: join(home, 'fake.log'),
  FAKE_TURN_MS: '4000',
  WBS_DEV_ORIGIN: 'http://127.0.0.1:5199,http://localhost:5199',
  GIT_AUTHOR_NAME: 'demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
})
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE') || k.startsWith('ELECTRON_')) delete process.env[k]
const { ensureDaemon, rpc } = await import('../src/shared/conn.ts')

const git = (...a: string[]) => execFileSync('git', a, { cwd: repo })
mkdirSync(join(repo, 'src'), { recursive: true })
git('init', '-q', '-b', 'main')
writeFileSync(join(repo, 'README.md'), '# shop\n\nA tiny shop.\n')
writeFileSync(join(repo, 'src/cart.js'), 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0)\n}\n')
writeFileSync(
  join(repo, '.wb.json'),
  JSON.stringify({ setup: 'echo installing deps…; sleep 2; echo done', teardown: 'echo bye', run: `exec node -e 'require("http").createServer((q,r)=>r.end("shop on "+process.env.PORT)).listen(process.env.PORT,()=>console.log("http://localhost:"+process.env.PORT))'` }, null, 2),
)
git('add', '-A')
git('commit', '-qm', 'init')

const info = await ensureDaemon()
const p = await rpc('projectAdd', { path: repo })
const a = await rpc('wsNew', { project: p.id, preset: 'claude', name: 'fix-cart-total', prompt: 'fix the cart total rounding' })
const b = await rpc('wsNew', { project: p.id, preset: 'codex', name: 'dark-mode' })
const c = await rpc('wsNew', { project: p.id, preset: 'claude', name: 'checkout-flow' })
for (const w of [a, b, c]) await rpc('tabNew', { ws: w.id })
await new Promise(r => setTimeout(r, 3000))
// some changes to look at in the diff
writeFileSync(join(a.path, 'src/cart.js'), 'export function total(items) {\n  const cents = items.reduce((s, i) => s + Math.round(i.price * 100), 0)\n  return cents / 100\n}\n')
writeFileSync(join(a.path, 'src/cart.test.js'), "import { total } from './cart.js'\nconsole.assert(total([{ price: 0.1 }, { price: 0.2 }]) === 0.3)\n")
await rpc('run', { ws: a.id })
await rpc('send', { target: c.id, text: 'ask before deleting' })
console.log(JSON.stringify({ home, url: `http://127.0.0.1:5199/#port=${info.port}&token=${info.token}` }))
