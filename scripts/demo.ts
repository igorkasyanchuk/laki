// A throwaway demo world for trying the UI: temp LAKI_HOME and HOME, a temp git repo, fake claude/codex/gh
// (test/fakes) first on PATH, and a daemon serving the dev renderer origin. Prints the URL to open.
//   node --experimental-strip-types scripts/demo.ts [dir]      stop: LAKI_HOME=<dir>/data laki stop
// LAKI_DEMO_RICH=1: more to show (the README's GIF): three projects in colors, groups, a PR per workspace with its
// checks, reviewers and authors' pictures (GitHub's own octocat and hubot, dependabot)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = process.argv[2] ?? mkdtempSync('/tmp/laki-demo-')
mkdirSync(home, { recursive: true })
const repo = join(home, 'shop')
// LAKI_DEV_ORIGIN: another renderer port than 5199 (the URL printed is its first)
const origins = process.env.LAKI_DEV_ORIGIN || 'http://127.0.0.1:5199,http://localhost:5199'
Object.assign(process.env, {
  HOME: home,
  LAKI_HOME: join(home, 'data'),
  // <dir>/bin: link test/cloudflared there to try Expose to the world
  PATH: `${join(home, 'bin')}:${join(root, 'test/fakes')}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  SHELL: join(root, 'test/fakes/tsh'),
  FAKE_LOG: join(home, 'fake.log'),
  FAKE_TURN_MS: '4000',
  FAKE_GH: join(home, 'gh'),
  LAKI_DEV_ORIGIN: origins,
  GIT_AUTHOR_NAME: 'demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
})
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE') || k.startsWith('ELECTRON_')) delete process.env[k]
const { ensureDaemon, rpc } = await import('../src/shared/conn.ts')

const git = (...a: string[]) => execFileSync('git', a, { cwd: repo })
// a PR with a failing check, for the status bar and the info panel
mkdirSync(join(home, 'gh'), { recursive: true })
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
const check = (name: string, conclusion: string, status = 'COMPLETED', secs = 0) => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: `https://github.com/acme/shop/actions/runs/1/job/${name.length}`, startedAt: ago(600), completedAt: status === 'COMPLETED' ? ago(600 - secs) : '0001-01-01T00:00:00Z' })
writeFileSync(
  join(home, 'gh/pr.json'),
  JSON.stringify({
    number: 42, state: 'OPEN', url: 'https://github.com/acme/shop/pull/42', title: 'Cart: totals with discounts', author: { login: 'ann' }, isDraft: false,
    headRefOid: 'abc123', reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', additions: 120, deletions: 14, updatedAt: ago(3600),
    reviews: [{ author: { login: 'carol' }, state: 'APPROVED' }, { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }],
    body: '## Summary\n\nAdds **discount codes** to the cart, checked at `total()`.\n\n- percent and fixed discounts\n- one code per order\n- tests for both\n\n## Testing\n\n```sh\nnpm test\n```\n\nSee [the design doc](https://example.invalid/design) for the rules.',
    statusCheckRollup: [check('lint', 'SUCCESS', 'COMPLETED', 18), check('test (node 22)', 'FAILURE', 'COMPLETED', 72), check('build', 'SUCCESS', 'COMPLETED', 141), check('e2e', '', 'IN_PROGRESS'), check('deploy preview', 'SKIPPED')],
  }),
)
// the failing check's log (Info's Log) and gh pr checks' answer (its Send to the agent)
const step = (name: string, lines: string[]) => lines.map(l => `test (node 22)\t${name}\t${ago(60)} ${l}`)
writeFileSync(
  join(home, 'gh/run.log'),
  [
    ...step('Run npm ci', ['added 312 packages in 9s']),
    ...step('Run npm test', ['> shop@1.0.0 test', '> node --test', '', '\x1b[32m✔ total sums prices\x1b[0m (0.8ms)', '\x1b[31m✖ total rounds to cents\x1b[0m (1.2ms)', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '', '  0.30000000000000004 !== 0.3', '', '      at TestContext.<anonymous> (file:///home/runner/work/shop/shop/src/cart.test.js:4:10)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', '##[error]Process completed with exit code 1.']),
  ].join('\n') + '\n',
)
writeFileSync(join(home, 'gh/checks.json'), JSON.stringify([{ name: 'test (node 22)', bucket: 'fail', link: check('test (node 22)', 'FAILURE').detailsUrl }]))
// review threads, for the side panel's Review tab; the PR's files as you've marked them viewed, for Changes
const said = (login: string, body: string, secs = 7200) => ({ author: { login, __typename: 'User' }, authorAssociation: 'MEMBER', body, createdAt: ago(secs) })
writeFileSync(
  join(home, 'gh/graphql.json'),
  JSON.stringify({ data: { viewer: { login: 'demo' }, repository: { pullRequest: { id: 'PR_demo', files: { nodes: [{ path: 'src/cart.js', viewerViewedState: 'VIEWED' }, { path: 'src/cart.test.js', viewerViewedState: 'UNVIEWED' }], pageInfo: { hasNextPage: false } }, reviewThreads: { nodes: [
    { id: 't1', isResolved: false, isOutdated: false, path: 'src/cart.js', line: 2, comments: { nodes: [said('ann', 'Round to cents before summing, or `0.1 + 0.2` shows up in totals:\n\n```suggestion\n  const cents = items.reduce((s, i) => s + Math.round(i.price * 100), 0)\n```')] } },
    { id: 't2', isResolved: false, isOutdated: true, path: 'src/cart.test.js', line: 5, comments: { nodes: [said('bob', 'Add a case for an empty cart.'), said('demo', 'On it.', 600)] } },
    { id: 't3', isResolved: true, isOutdated: false, path: 'README.md', line: 1, comments: { nodes: [said('ann', 'Typo.')] } },
    { id: 't4', isResolved: false, isOutdated: false, path: 'src/cart.js', line: 3, comments: { nodes: [{ ...said('dana', 'Would `Math.round(cents) / 100` read clearer here?', 3000), authorAssociation: 'NONE' }] } }, // not a member: the full review shows it, the agent never gets it
  ] },
  // the full review's GitHub tab: the conversation and the reviews' summaries (prTalk)
  comments: { nodes: [{ author: { login: 'carol' }, body: 'Thanks! The discount rules look right to me.', createdAt: ago(5400), url: 'https://github.com/acme/shop/pull/42#issuecomment-1' }] },
  reviews: { nodes: [{ author: { login: 'carol' }, body: '', state: 'APPROVED', submittedAt: ago(5000), url: 'https://github.com/acme/shop/pull/42#pullrequestreview-1' }, { author: { login: 'bob' }, body: 'A test for the empty cart, please.', state: 'CHANGES_REQUESTED', submittedAt: ago(4000), url: 'https://github.com/acme/shop/pull/42#pullrequestreview-2' }] },
  } } } }),
)
mkdirSync(join(repo, 'src'), { recursive: true })
git('init', '-q', '-b', 'main')
writeFileSync(join(repo, 'README.md'), '# shop\n\nA tiny shop.\n')
writeFileSync(join(repo, 'src/cart.js'), 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0)\n}\n')
writeFileSync(
  join(repo, '.laki.json'),
  JSON.stringify({ setup: 'echo installing deps…; sleep 2; echo done', teardown: 'echo bye', run: `exec node -e 'require("http").createServer((q,r)=>r.end("shop on "+process.env.PORT)).listen(process.env.PORT,()=>console.log("http://localhost:"+process.env.PORT))'` }, null, 2),
)
git('add', '-A')
git('commit', '-qm', 'init')
// a second author in the base, for the full review's blame; origin for Open on remote
writeFileSync(join(repo, 'src/cart.js'), 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0)\n}\n\nexport const empty = () => []\n')
execFileSync('git', ['commit', '-qam', 'An empty cart'], { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 'Bob Builder' } })
git('remote', 'add', 'origin', 'git@github.com:acme/shop.git')

const info = await ensureDaemon()
const p = await rpc('projectAdd', { path: repo })
await rpc('projectTrust', { id: p.id, hash: (await rpc<{ hash: string }>('projectTrust', { id: p.id })).hash }) // its .laki.json, as you would in the app
const a = await rpc('wsNew', { project: p.id, preset: 'claude', name: 'fix-cart-total', prompt: 'fix the cart total rounding' })
const b = await rpc('wsNew', { project: p.id, preset: 'codex', name: 'dark-mode' })
const c = await rpc('wsNew', { project: p.id, preset: 'claude', name: 'checkout-flow' })
for (const w of [a, b, c]) await rpc('tabNew', { ws: w.id })
await new Promise(r => setTimeout(r, 3000))
// some changes to look at in the diff
writeFileSync(join(a.path, 'src/cart.js'), 'export function total(items) {\n  const cents = items.reduce((s, i) => s + Math.round(i.price * 100), 0)\n  return cents / 100\n}\n\nexport const empty = () => []\n')
writeFileSync(join(a.path, 'src/cart.test.js'), "import { total } from './cart.js'\nconsole.assert(total([{ price: 0.1 }, { price: 0.2 }]) === 0.3)\n")
await rpc('run', { ws: a.id })
// what its agents kept: the status bar's Artifacts
const kept = (await rpc<{ workspaces: { id: string; storage?: string }[] }>('state')).workspaces.find(w => w.id === a.id)?.storage
if (kept) for (const [f, text] of [['smoke/report.md', '# Smoke test\n\nAll pages load.\n'], ['smoke/home.txt', 'home ok\n'], ['links.md', '- https://example.invalid/artifact\n']]) mkdirSync(dirname(join(kept, f)), { recursive: true }), writeFileSync(join(kept, f), text)
await rpc('send', { target: c.id, text: 'ask before deleting' })
if (process.env.LAKI_DEMO_RICH) {
  type W = { id: string; branch: string; path: string }
  const pr = (branch: string, o: Record<string, unknown>) => writeFileSync(join(home, 'gh', `pr-${branch.replace(/\//g, '_')}.json`), JSON.stringify({ state: 'OPEN', isDraft: false, headRefOid: 'def456', reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', updatedAt: ago(1800), reviews: [], body: '', ...o }))
  const pass = [check('lint', 'SUCCESS', 'COMPLETED', 21), check('test', 'SUCCESS', 'COMPLETED', 95), check('build', 'SUCCESS', 'COMPLETED', 130)]
  const repoOf = (name: string, file: string) => {
    const dir = join(home, name)
    mkdirSync(dir, { recursive: true })
    for (const a of [['init', '-q', '-b', 'main'], ['remote', 'add', 'origin', `git@github.com:acme/${name}.git`]]) execFileSync('git', a, { cwd: dir })
    writeFileSync(join(dir, file), `// ${name}\n`)
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
    return dir
  }
  const ws = async (project: string, name: string, preset: string, prompt?: string) => rpc<W>('wsNew', { project, preset, name, ...(prompt && { prompt }) })
  // shop: the PRs to look at, a group each way
  await rpc('projectSet', { id: p.id, color: 'orange', icon: 'cart' })
  const d = await ws(p.id, 'deps-bump', 'none')
  pr(a.branch, { ...JSON.parse(readFileSync(join(home, 'gh/pr.json'), 'utf8')), author: { login: 'octocat' }, reviews: [{ author: { login: 'hubot' }, state: 'CHANGES_REQUESTED' }] })
  pr(b.branch, { number: 57, url: 'https://github.com/acme/shop/pull/57', title: 'Dark mode for the storefront', author: { login: 'octocat' }, reviewDecision: 'APPROVED', reviews: [{ author: { login: 'hubot' }, state: 'APPROVED' }], additions: 342, deletions: 61, statusCheckRollup: pass })
  pr(d.branch, { number: 61, url: 'https://github.com/acme/shop/pull/61', title: 'Bump vite from 6.2 to 6.3', author: { login: 'app/dependabot', is_bot: true }, additions: 12, deletions: 12, statusCheckRollup: [check('lint', 'SUCCESS', 'COMPLETED', 19), check('test', '', 'IN_PROGRESS')] })
  pr(c.branch, { number: 63, url: 'https://github.com/acme/shop/pull/63', title: 'One-page checkout', author: { login: 'hubot' }, isDraft: true, additions: 88, deletions: 9, statusCheckRollup: [check('lint', 'SUCCESS', 'COMPLETED', 17)] })
  const sep = (name: string, color: string) => ({ id: `sep-${name.toLowerCase().replace(/\W/g, '')}`, name, color })
  const [review, build] = [sep('In review', 'blue'), sep('Building', 'green')]
  await rpc('projectSet', { id: p.id, seps: [review, build], rows: [review.id, a.id, b.id, d.id, build.id, c.id] })
  // api and mobile: two more projects, an agent at work in each
  const api = await rpc<{ id: string }>('projectAdd', { path: repoOf('api', 'server.js') })
  await rpc('projectSet', { id: api.id, color: 'teal', icon: 'server' })
  const rl = await ws(api.id, 'rate-limiter', 'claude', 'add a rate limiter to the public API')
  const wh = await ws(api.id, 'webhook-retries', 'codex', 'retry failed webhooks with backoff')
  pr(rl.branch, { number: 108, url: 'https://github.com/acme/api/pull/108', title: 'Rate limit the public API', author: { login: 'octocat' }, reviewDecision: 'APPROVED', reviews: [{ author: { login: 'hubot' }, state: 'APPROVED' }, { author: { login: 'octocat' }, state: 'COMMENTED' }], additions: 214, deletions: 30, statusCheckRollup: pass })
  pr(wh.branch, { number: 111, url: 'https://github.com/acme/api/pull/111', title: 'Retry failed webhooks with backoff', author: { login: 'hubot' }, reviewDecision: 'REVIEW_REQUIRED', additions: 97, deletions: 4, statusCheckRollup: [check('lint', 'SUCCESS', 'COMPLETED', 20), check('test', 'FAILURE', 'COMPLETED', 64), check('build', 'SUCCESS', 'COMPLETED', 120)] })
  const mob = await rpc<{ id: string }>('projectAdd', { path: repoOf('mobile', 'App.tsx') })
  await rpc('projectSet', { id: mob.id, color: 'purple', icon: 'smartphone' })
  const ob = await ws(mob.id, 'onboarding-screens', 'claude', 'build the three onboarding screens')
  const pn = await ws(mob.id, 'push-notifications', 'codex', 'ask before adding push notifications')
  pr(ob.branch, { number: 24, url: 'https://github.com/acme/mobile/pull/24', title: 'Onboarding: three screens', author: { login: 'octocat' }, isDraft: true, additions: 410, deletions: 2, statusCheckRollup: [check('lint', 'SUCCESS', 'COMPLETED', 25), check('test', '', 'IN_PROGRESS')] })
  pr(pn.branch, { number: 27, url: 'https://github.com/acme/mobile/pull/27', title: 'Push notifications', author: { login: 'hubot' }, reviewDecision: 'APPROVED', reviews: [{ author: { login: 'octocat' }, state: 'APPROVED' }], additions: 156, deletions: 18, statusCheckRollup: pass })
  for (const w of [api, mob]) await rpc('projectTrust', { id: w.id, hash: (await rpc<{ hash: string }>('projectTrust', { id: w.id })).hash }).catch(() => {})
  await rpc('prRefresh', {}).catch(() => {})
}
console.log(JSON.stringify({ home, url: `${origins.split(',')[0]}/#port=${info.port}&token=${info.token}` }))
