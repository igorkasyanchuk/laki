// PR feedback to the agent (by hand and automatic) and the side panel's review threads, against the fake gh.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const job = (n: number) => `https://github.com/o/r/actions/runs/1/job/${n}`
const said = (login: string | null, body: string, __typename = 'User', authorAssociation = 'MEMBER') => ({ author: login ? { login, __typename } : null, authorAssociation, body })
const thread = (id: string, comments: object[], o: object = {}) => ({ id, isResolved: false, isOutdated: false, path: 'a.ts', line: 2, comments: { nodes: comments }, ...o })
const graphql = (gh: string, threads: object[]) =>
  writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: threads } } } } }))

test('PR feedback by hand: every kind of check, CI and review messages, threads for the side panel, a PR gh drops', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found') // not a PR
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'ci' }), /has no PR/)
  writeFileSync(
    join(gh, 'pr.json'),
    JSON.stringify({ number: 7, state: 'OPEN', url: 'https://example.invalid/pr/7', headRefOid: 'abc', mergeable: 'CONFLICTING', statusCheckRollup: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: job(1), startedAt: '2026-10-06T10:00:00Z', completedAt: '2026-10-06T10:01:12Z' },
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: 'https://ci.invalid/1' },
      { __typename: 'StatusContext', state: 'SUCCESS' },
    ] }),
  )
  const pr = await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.equal(pr.checks, 'fail')
  assert.equal(pr.conflict, true)
  assert.deepEqual(pr.list, [
    { name: 'test', state: 'fail', url: job(1), took: 72 },
    { name: 'lint', state: 'skip' },
    { name: 'deploy', state: 'pending', url: 'https://ci.invalid/1' },
    { name: '?', state: 'pass' },
  ])

  // CI: gh's failing checks go to the agent (no log when gh has none)
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'ci' }), /no failing checks on PR #7/)
  writeFileSync(join(gh, 'checks.json'), JSON.stringify([{ name: 'test', bucket: 'fail', link: job(1) }, { name: 'e2e', bucket: 'fail', link: 'https://ci.invalid/2' }, { name: 'lint', bucket: 'pass', link: '' }]))
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'ci' }), /has no running agent/)
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('prFix', { ws: ws.id, what: 'ci' })
  const last = () => until(async () => (await rig.tab(ws.id)).last, 'an answer')
  assert.equal(
    await last(),
    `answer: CI fails on PR #7 (https://example.invalid/pr/7). Find the cause and fix it, run what you can locally, then commit and push the fix, then say what you changed.\n\n## test\n${job(1)}\n\n## e2e\nhttps://ci.invalid/2\n`,
  )

  // review: gh failing, no threads, none open; then the open ones (a bot's, a deleted user's)
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /gh couldn't read the review comments: it failed/)
  writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: {} }))
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /no review threads for PR #7/)
  const done = thread('t1', [{ ...said('ann', 'done already'), createdAt: '2026-10-06T10:00:00Z' }], { isResolved: true, line: 1 })
  graphql(gh, [done])
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /no open review comments on PR #7/)
  graphql(gh, [done, thread('t2', [said('lint-bot', 'unused import', 'Bot', 'NONE'), said(null, 'ghost here\nsecond line')], { isOutdated: true, line: null, path: 'b.ts' })])
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), [
    { path: 'a.ts', line: 1, resolved: true, outdated: false, comments: [{ author: 'ann', body: 'done already', at: '2026-10-06T10:00:00Z' }] },
    { path: 'b.ts', resolved: false, outdated: true, comments: [{ author: 'lint-bot', body: 'unused import' }, { author: 'ghost', body: 'ghost here\nsecond line' }] },
  ])
  await rig.rpc('prFix', { ws: ws.id, what: 'review' })
  await until(async () => (await last()).startsWith('answer: Address'), 'review sent')
  assert.equal(
    await last(),
    "answer: Address the open review comments on PR #7 (https://example.invalid/pr/7). Fix what you agree with; then commit and push the fix, then say what you changed, and what you didn't and why. Answer here, not on GitHub.\n\n1. b.ts (outdated: the code moved since)\n   @lint-bot: unused import\n   @?: ghost here\n   second line",
  )

  // gh no longer finds it: no PR
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found')
  await until(async () => !(await rig.rpc('state')).workspaces[0].pr, 'PR dropped')
})

test('a re-run check counts by its newest run (a queued one is the newest), prRefresh scans now', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const run = (name: string, conclusion: string, startedAt?: string, o: object = {}) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: conclusion ? 'COMPLETED' : 'QUEUED', conclusion, startedAt, ...o })
  const rollup = (list: object[]) => writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 3, state: 'OPEN', url: 'https://example.invalid/pr/3', headRefOid: 'abc', statusCheckRollup: list }))
  // test failed, then passed on a re-run; lint of another workflow keeps its own failure
  rollup([run('test', 'SUCCESS', '2026-10-06T10:05:00Z'), run('test', 'FAILURE', '2026-10-06T10:00:00Z'), run('lint', 'SUCCESS', '2026-10-06T10:00:00Z'), run('lint', 'FAILURE', '2026-10-06T10:01:00Z', { workflowName: 'Style' })])
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const pr = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr, 'PR scanned')
  assert.deepEqual(pr.list.map((c: any) => `${c.name} ${c.state}`), ['test pass', 'lint pass', 'lint fail'])
  // only the other workflow's lint failing; then a re-run of it queued (Go's zero time): running
  rollup([run('test', 'SUCCESS', '2026-10-06T10:05:00Z'), run('lint', 'FAILURE', '2026-10-06T10:01:00Z', { workflowName: 'Style' }), run('lint', '', '0001-01-01T00:00:00Z', { workflowName: 'Style' })])
  await rig.rpc('prRefresh')
  const now = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr
  assert.equal(now.checks, 'pending')
  assert.deepEqual(now.list.map((c: any) => `${c.name} ${c.state}`), ['test pass', 'lint pending'])
})

test('autoFix and autoReview: they wait for an agent; CI goes over to you after 3 fixes in a row; a pass starts over', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (head: string, conclusion = 'FAILURE') =>
    writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 9, state: 'OPEN', url: 'https://example.invalid/pr/9', headRefOid: head, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion }] }))
  pr('c1')
  writeFileSync(join(gh, 'checks.json'), JSON.stringify([{ name: 'test', bucket: 'fail', link: '' }]))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const fix = async () => (await rig.rpc('state')).workspaces[0].fix
  const graphqlCalls = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('gh api graphql')).length

  // no agent: nothing sent, nothing recorded as sent (gh can't read the review yet, then it can)
  await rig.rpc('wsSet', { id: ws.id, autoFix: true, autoReview: true })
  await until(async () => (await fix())?.pr === 9, 'a scan')
  graphql(gh, [thread('t1', [said('bob', 'rename this', 'User', 'OWNER')])])
  const n = graphqlCalls()
  await until(() => graphqlCalls() >= n + 2, 'scans with the review')
  assert.deepEqual(await fix(), { pr: 9 })

  // an agent: both go to it
  await rig.rpc('wsSet', { id: ws.id, autoFix: false, autoReview: false })
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  const c = await rig.connect()
  await rig.rpc('wsSet', { id: ws.id, autoFix: true, autoReview: true })
  await until(async () => (await fix())?.tries === 1 && (await fix()).review === 't1:1', 'CI and review sent')
  const idle = () => until(async () => (await rig.tab(ws.id)).status === 'idle' && !(await rig.tab(ws.id)).queue, 'turns done', 15000)
  for (const head of ['c2', 'c3']) {
    await idle()
    pr(head)
    await until(async () => (await fix())?.ci === head, `CI of ${head} sent`)
  }
  assert.equal((await fix()).tries, 3)
  await idle()
  pr('c4')
  await until(() => c.events.some(e => e.ev === 'turn' && e.kind === 'waiting' && e.text === 'CI still fails after 3 fixes'), 'over to you')
  await until(async () => (await fix())?.ci === 'c4', 'c4 recorded') // saved after the event goes out
  assert.deepEqual(await fix(), { pr: 9, ci: 'c4', tries: 4, review: 't1:1' })
  assert.equal((await rig.tab(ws.id)).status, 'waiting')
  pr('c4', 'SUCCESS')
  await until(async () => (await fix())?.tries === 0, 'a pass starts over')

  // your own comment counts, the agent's doesn't: it comments as you, and yours made while it worked are its own
  const mine = (id: string, body: string, at: number) => ({ id, ...said('me', body, 'User', 'OWNER'), createdAt: new Date(at).toISOString() })
  const bob = thread('t1', [said('bob', 'rename this', 'User', 'OWNER')])
  await rig.rpc('input', { tab: tab.id, data: 'slow\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'the agent works')
  graphql(gh, [bob, thread('t2', [mine('c1', 'renamed it', Date.now())])])
  await until(async () => (await fix())?.mine?.includes('c1'), "the agent's reply seen")
  assert.equal((await fix()).review, 't1:1')
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'interrupted')
  graphql(gh, [bob, thread('t2', [mine('c1', 'renamed it', Date.now() - 60_000)]), thread('t3', [mine('c2', 'and this one', Date.now() + 60_000)])])
  await until(async () => (await fix())?.review === 't1:1 t3:1', 'yours sent')
  await until(async () => (await rig.screen(tab.id)).includes('@me: and this one'), 'to the agent')
  c.close()
})

test('development mode: a workspace log of PR scans, what the switches did and why not, turns', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 4, state: 'OPEN', url: 'https://example.invalid/pr/4', headRefOid: 'abcdef123', mergeable: 'MERGEABLE', statusCheckRollup: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] }))
  writeFileSync(join(gh, 'checks.json'), JSON.stringify([{ name: 'lint', bucket: 'fail', link: '' }]))
  graphql(gh, [thread('t1', [said('bob', 'rename this'), said('eve', 'drive-by', 'User', 'NONE')])])
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const lines = async () => ((await rig.rpc('logs', { key: `ws:${ws.id}` })) as { text: string }[]).map(l => l.text).join('\n')
  await rig.rpc('wsSet', { id: ws.id, autoFix: true, autoReview: true })
  await until(async () => (await rig.rpc('state')).workspaces[0].fix?.pr === 4, 'a scan')
  assert.equal(await lines(), '', 'off: nothing kept')
  await rig.rpc('settingsSet', { devMode: true })
  await until(async () => /review: not sent: .* has no running agent/.test(await lines()), 'a scan logged', 15000)
  const l = await lines()
  assert.match(l, /PR #4 OPEN, head abcdef1: checks fail \(1 failing: lint, 0 running, 0 passing\), conflicts no/)
  assert.match(l, /fix CI: not sent \(try 1 of 3\): .* has no running agent/)
  assert.match(l, /review: 1 inline threads, 1 open, 1 with comments that count \(1 from people without write access left out/)
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => /fix CI: gh pr checks: 1 failing: lint/.test(await lines()) && /to claude: (typed in|queued)/.test(await lines()), 'sent, logged', 15000)
  await until(async () => /claude: running → idle/.test(await lines()), 'its turn logged', 15000).catch(async e => assert.fail(`${e.message}\n${await lines()}`))
  assert.ok(tab.id)
  const raw = (await rig.rpc('logs', { key: `ws:${ws.id}` })) as { at: number; text: string; n?: number }[]
  assert.ok(raw.some(x => x.text.startsWith('PR #4 OPEN') && x.n! > 1), 'each scan the same: counted, not repeated')
  assert.ok(raw.every((x, i) => !i || raw[i - 1].at <= x.at), 'in time order')
  await rig.rpc('settingsSet', { devMode: false })
  await rig.rpc('prRefresh')
  assert.equal(await lines(), '', 'off again: let go')
})

test('autoMerge: merge conflicts go to the agent once per head commit, with your prompt and tries; unknown keeps the count, none starts it over', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (head: string, mergeable = 'CONFLICTING') =>
    writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 5, state: 'OPEN', url: 'https://example.invalid/pr/5', headRefOid: head, baseRefName: 'dev', mergeable, statusCheckRollup: [] }))
  pr('h1', 'MERGEABLE')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const fix = async () => (await rig.rpc('state')).workspaces[0].fix
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'conflict' }), /PR #5 has no merge conflicts/)
  await until(async () => (await rig.screen((await rig.tab(ws.id)).id)).includes('>'), 'claude up')
  pr('h1')
  await rig.rpc('settingsSet', { prTries: 2, prPrompts: { conflict: 'Merge {{base}} into #{{ pr }} ({{url}}), {{nope}} {{constructor}}' } })
  const c = await rig.connect()
  await rig.rpc('wsSet', { id: ws.id, autoMerge: true })
  await until(async () => (await fix())?.merge === 'h1', 'conflicts sent')
  assert.equal((await fix()).merges, 1)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: Merge dev into #5 (https://example.invalid/pr/5), {{nope}} {{constructor}}', 'your prompt, filled in')
  pr('h2') // its push still conflicts: again
  await until(async () => (await fix())?.merges === 2, 'sent again')
  pr('h2b') // and again: over the 2 tries, over to you
  await until(() => c.events.some(e => e.ev === 'turn' && e.kind === 'waiting' && e.text === 'Merge conflicts remain after 2 tries'), 'over to you')
  await until(async () => (await fix())?.merges === 3, 'counted')
  c.close()
  await rig.rpc('wsSet', { id: ws.id, autoMerge: false })
  await rig.rpc('wsSet', { id: ws.id, autoMerge: true })
  await until(async () => (await fix())?.merges === 1, 'off and on: its tries back, sent again')
  pr('h3', 'UNKNOWN') // GitHub right after a push
  const n = readFileSync(rig.env.FAKE_LOG, 'utf8').split('gh pr view').length
  await until(() => readFileSync(rig.env.FAKE_LOG, 'utf8').split('gh pr view').length > n + 1, 'scanned')
  assert.equal((await fix()).merges, 1)
  pr('h3', 'MERGEABLE')
  await until(async () => (await fix())?.merges === 0, 'resolved: the count starts over')
  assert.equal((await fix()).merge, 'h2b')
})

test('a diff line comment on the PR: gh api with the head commit, a line not in the PR, checks', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const c = { ws: ws.id, path: 'a.ts', line: 3, side: 'RIGHT', body: 'why "this"?' }
  await assert.rejects(rig.rpc('prComment', c), /has no PR/)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 9, state: 'OPEN', url: 'https://example.invalid/pr/9', headRefOid: 'beef', statusCheckRollup: [] }))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  await assert.rejects(rig.rpc('prComment', { ...c, path: '../x' }), /not a path inside/)
  await assert.rejects(rig.rpc('prComment', { ...c, path: undefined }), /not a path inside/)
  await assert.rejects(rig.rpc('prComment', { ...c, line: 0 }), /which line/)
  await assert.rejects(rig.rpc('prComment', { ...c, body: ' ' }), /empty/)
  await assert.rejects(rig.rpc('prComment', c), /isn't in the PR's diff/)
  writeFileSync(join(gh, 'comment.json'), JSON.stringify({ html_url: 'https://example.invalid/pr/9#c1' }))
  assert.deepEqual(await rig.rpc('prComment', { ...c, side: 'LEFT' }), { url: 'https://example.invalid/pr/9#c1' })
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh api repos\/\{owner\}\/\{repo\}\/pulls\/9\/comments -f body=why "this"\? -f commit_id=beef -f path=a\.ts -F line=3 -f side=LEFT/)
})

test("a PR's author: yours (gh api user) is mine; its whole diff (gh pr diff) for Changes, each file's status and lines", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('prDiff', { ws: ws.id }), /has no PR/)
  const pr = { number: 9, state: 'OPEN', url: 'https://github.com/o/r/pull/9', baseRefName: 'main', author: { login: 'ann' }, statusCheckRollup: [] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.equal((await rig.rpc('state')).workspaces[0].pr.mine, undefined) // ann's, and you are me
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, author: { login: 'me' } }))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr.mine === true, 'yours')
  const diff = [
    'diff --git a/a.ts b/a.ts',
    'index 1..2 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+++ a line that starts with ++',
    ' same',
    'diff --git a/new.md b/new.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.md',
    '@@ -0,0 +1 @@',
    '+hi',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/x b/y',
    'similarity index 100%',
    'rename from x',
    'rename to y',
    '',
  ].join('\n')
  writeFileSync(join(gh, 'pr.diff'), diff)
  const d = await rig.rpc('prDiff', { ws: ws.id })
  assert.equal(d.base, 'main')
  assert.equal(d.diff, diff)
  assert.deepEqual(d.files, [
    { path: 'a.ts', status: 'M', add: 1, del: 1 },
    { path: 'new.md', status: 'A', add: 1, del: 0 },
    { path: 'gone.txt', status: 'D', add: 0, del: 1 },
    { path: 'y', status: 'R', add: 0, del: 0 },
  ])
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh pr diff --color=never -- https:\/\/github.com\/o\/r\/pull\/9\n/)
})

test('approve or close the PR: gh as you, by its URL; refused with none, when not open, or as gh says', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const act = (act: string) => rig.rpc('prAct', { ws: ws.id, act })
  await assert.rejects(act('approve'), /has no PR/)
  const pr = { number: 9, state: 'OPEN', url: 'https://github.com/o/r/pull/9', statusCheckRollup: [] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  await assert.rejects(act('rebase'), /approve, close or merge/)
  await act('approve')
  writeFileSync(join(gh, 'refuse'), 'failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)')
  await assert.rejects(act('approve'), /^Error: gh: failed to create review: GraphQL: Can not approve your own pull request/)
  rmSync(join(gh, 'refuse'))
  await act('close')
  const log = readFileSync(rig.env.FAKE_LOG, 'utf8')
  assert.match(log, /gh pr review --approve -- https:\/\/github.com\/o\/r\/pull\/9\n/)
  assert.match(log, /gh pr close -- https:\/\/github.com\/o\/r\/pull\/9\n/)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, state: 'CLOSED' }))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr?.state === 'CLOSED', 'closed, scanned')
  await assert.rejects(act('close'), /PR #9 is closed/)
})

test('merge: gh pr merge by the way picked (kept as the project\'s next), -R off this worktree; the project\'s switches allow each act; merge when green once per head, only allowed', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const pr = { number: 9, state: 'OPEN', url: 'https://github.com/o/r/pull/9', headRefOid: 'aaa', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, isDraft: true }))
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  await rig.rpc('prAct', { ws: ws.id, act: 'merge', method: 'rebase', deleteBranch: false })
  assert.match(log(), /gh pr merge --rebase -R github.com\/o\/r -- https:\/\/github.com\/o\/r\/pull\/9\n/)
  assert.equal((await rig.rpc('state')).projects[0].config.mergeMethod, 'rebase')
  await rig.rpc('prAct', { ws: ws.id, act: 'merge' }) // no way: squash, the branch deleted
  assert.match(log(), /gh pr merge --squash --delete-branch -R github.com\/o\/r -- /)
  // the project's switches: off, refused; a page saving its config keeps the last way
  await rig.rpc('projectSet', { id: p.id, config: { pr: { merge: false, close: false, approve: true, land: false } } })
  const cfg = (await rig.rpc('state')).projects[0].config
  assert.deepEqual([cfg.pr, cfg.mergeMethod], [{ merge: false, close: false }, 'squash'])
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'merge' }), /merging PRs is off for this project/)
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'close' }), /closing PRs is off/)
  await assert.rejects(rig.rpc('wsSet', { id: ws.id, autoLand: true }), /merge when green is off for this project/)
  // merge when green: allowed, then waits for green (a draft isn't), merges once per head
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: true } } })
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  await rig.rpc('prRefresh')
  const merges = () => log().split('\n').filter(l => l.startsWith('gh pr merge')).length
  assert.equal(merges(), 2, 'a draft waits')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await rig.rpc('prRefresh')
  await until(async () => merges() === 3, 'merged when green')
  assert.match(log(), /gh pr merge --squash --delete-branch -R github.com\/o\/r -- https:\/\/github.com\/o\/r\/pull\/9\n$/)
  await rig.rpc('prRefresh')
  assert.equal(merges(), 3, 'once per head')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, headRefOid: 'bbb', reviewDecision: 'REVIEW_REQUIRED' }))
  await rig.rpc('prRefresh')
  assert.equal(merges(), 3, 'a review it needs first')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, headRefOid: 'ccc', mergeStateStatus: 'BLOCKED' }))
  await rig.rpc('prRefresh')
  assert.equal(merges(), 3, 'GitHub blocks it: a required check to come')
  // turned off and on: the head it tried goes again
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await rig.rpc('wsSet', { id: ws.id, autoLand: false })
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  await until(async () => merges() === 4, 'tried again')
})

test("merge when green waits while the workspace's agent works; the project's switch turned off clears the workspaces'", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = { number: 9, state: 'OPEN', url: 'https://github.com/o/r/pull/9', headRefOid: 'aaa', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: true } } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('input', { tab: tab.id, data: 'slow\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'the agent works')
  const merges = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('gh pr merge')).length
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  await rig.rpc('prRefresh')
  assert.equal(merges(), 0, 'green, but its agent may push yet')
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'interrupted')
  await rig.rpc('prRefresh')
  await until(async () => merges() === 1, 'merged once the agent is done')
  // off for the project: the switch goes with it, and turning the project's on again merges nothing unasked
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: false } } })
  assert.equal((await rig.rpc('state')).workspaces[0].autoLand, undefined)
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: true } } })
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, headRefOid: 'bbb' }))
  await rig.rpc('prRefresh')
  assert.equal(merges(), 1)
})

test('a workspace from a PR: gh pr checkout on its branch, named after it, its PR by URL, a fork’s as <owner>/<branch>; gh and branch errors', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const fromPR = (pr: string) => rig.rpc('wsNew', { project: p.id, pr, preset: 'none' })
  await assert.rejects(fromPR('99'), /PR 99 not found/)
  writeFileSync(join(gh, 'noauth'), '')
  await assert.rejects(fromPR('99'), /gh isn't signed in: run gh auth login/)
  rmSync(join(gh, 'noauth'))
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 123, title: 'Fix the login page!', url: 'https://github.com/o/r/pull/123', headRefName: 'fix-login', baseRefName: 'main', isCrossRepository: false }))
  writeFileSync(join(gh, 'checkout'), 'fix-login')
  const ws = await fromPR('https://github.com/o/r/pull/123')
  assert.deepEqual([ws.id, ws.branch, ws.base, ws.prUrl], ['pr-123-fix-the-login-page', 'fix-login', 'main', 'https://github.com/o/r/pull/123'])
  assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws.path, encoding: 'utf8' }).trim(), 'fix-login')
  await until(() => readFileSync(rig.env.FAKE_LOG, 'utf8').includes('gh pr view https://github.com/o/r/pull/123 --json number,state'), 'its PR, by URL')
  await assert.rejects(fromPR('123'), new RegExp(`already checked out in workspace ${ws.id}$`))
  await assert.rejects(rig.rpc('wsFan', { project: p.id, pr: '123', presets: ['claude', 'codex'] }), /can't start from a PR/)
  await rig.rpc('wsRm', { id: ws.id }) // the branch stays: gh checks it out again
  const r = await rig.cli('new', p.id, '--pr', '123', '--preset', 'none')
  assert.match(r.out, /^pr-123-fix-the-login-page .*\(branch fix-login,/)
  // a fork's PR from its main (the repo's own branch here): <owner>/main, not "checked out in the repo"
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 7, title: 'Typo', url: 'https://github.com/o/r/pull/7', headRefName: 'main', baseRefName: 'main', isCrossRepository: true, headRepositoryOwner: { login: 'alice' } }))
  const fork = await fromPR('7')
  assert.equal(fork.branch, 'alice/main')
  // a fork's .laki.json isn't read (its setup would run a stranger's code): the repo's is
  writeFileSync(join(fork.path, '.laki.json'), JSON.stringify({ run: 'echo pwned' }))
  assert.deepEqual(((await rig.rpc('state')).workspaces as { id: string; run: boolean; fork?: boolean }[]).filter(w => w.id === fork.id).map(w => [w.fork, w.run]), [[true, false]])
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh pr checkout https:\/\/github.com\/o\/r\/pull\/7 --branch alice\/main/)
})

test('a prompt naming a PR: the workspace named after it and linked to it (gh failing: by its number); a name given, a race, a local session', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const url = 'https://github.com/o/r/pull/14080'
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', prompt: `Run advanced code review for ${url}` })
  assert.deepEqual([a.id, a.prUrl], ['pr-14080', url]) // no prhead.json: gh fails
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 14080, title: 'Lazy-load gift frames', url, headRefName: 'gifts', baseRefName: 'main', isCrossRepository: false }))
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', prompt: `review ${url}, then fix what you find` })
  assert.deepEqual([b.id, b.prUrl, b.prLinked], ['pr-14080-lazy-load-gift-frames', url, true])
  assert.notEqual(b.branch, 'gifts') // linked, not checked out (that's --pr)
  await until(() => readFileSync(rig.env.FAKE_LOG, 'utf8').includes(`gh pr view ${url} --json number,state`), 'its PR, by URL')
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none', prompt: url, name: 'mine' })
  assert.deepEqual([c.id, c.prUrl], ['mine', url])
  const plain = await rig.rpc('wsNew', { project: p.id, preset: 'none', prompt: 'https://github.com/o/r/issues/3 and pull/4' })
  assert.deepEqual([plain.id.startsWith('https-github-com'), plain.prUrl], [true, undefined])
  const race = await rig.rpc('wsFan', { project: p.id, prompt: `review ${url}`, presets: ['claude', 'codex'] })
  assert.deepEqual(race.map((w: any) => [w.id, w.prUrl]), [['pr-14080-lazy-load-gift-f-claude', url], ['pr-14080-lazy-load-gift-fr-codex', url]]) // the agent's name kept whole
  // linked, not checked out: failing CI doesn't go to the agent (its push wouldn't reach the PR)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 14080, state: 'OPEN', url, headRefOid: 'beef', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }))
  await rig.rpc('wsSet', { id: b.id, autoFix: true })
  const views = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split(`gh pr view ${url}`).length
  const n = views()
  await until(() => views() > n + 2, 'scans')
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === b.id).fix, undefined)
  const local = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true, another: true, prompt: `look at ${url}` })
  assert.equal(local.prUrl, url)
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === local.id)?.pr, "a local session's PR too")
})

test('a merged PR archives its workspace once it is clean (archiveMerged), not with changes or unpushed commits; Undo stays', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' }).trim()
  const head = git('rev-parse', 'HEAD')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 8, state: 'MERGED', url: 'https://example.invalid/pr/8', headRefOid: head, statusCheckRollup: [] }))
  const c = await rig.connect()
  const live = async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived
  const views = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('gh pr view').length
  const scans = async () => {
    const n = views()
    await until(() => views() > n + 1, 'two scans')
  }
  await until(async () => (await rig.rpc('state')).workspaces[0].pr?.state === 'MERGED', 'scanned')
  await scans()
  assert.ok(await live(), 'off by default')
  await rig.rpc('settingsSet', { archiveMerged: true })
  writeFileSync(join(ws.path, 'wip.txt'), 'x')
  await scans()
  assert.ok(await live(), 'uncommitted')
  git('add', '-A')
  git('commit', '-qm', 'wip')
  await scans()
  assert.ok(await live(), 'past the PR head')
  git('reset', '-q', '--hard', head)
  await until(async () => !(await live()), 'archived')
  assert.ok(c.events.some(e => e.ev === 'archived' && e.ws === ws.id && e.pr === 8))
  await rig.rpc('wsRestore', { id: ws.id })
  await scans()
  assert.ok(await live(), 'once: an Undo stays')
  c.close()
})

test('Attach PR: one by URL or number becomes the workspace’s (asked for by URL); another branch’s only linked; a folder refused', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'login' })
  await assert.rejects(rig.rpc('prAttach', { ws: ws.id, pr: '99' }), /PR 99 not found/)
  await assert.rejects(rig.rpc('prAttach', { ws: ws.id, pr: ' ' }), /its URL or number/)
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 77, title: 'Login', url: 'https://github.com/o/r/pull/77', headRefName: ws.branch, baseRefName: 'main', isCrossRepository: false }))
  assert.deepEqual(await rig.rpc('prAttach', { ws: ws.id, pr: '77' }), { number: 77, url: 'https://github.com/o/r/pull/77', linked: false })
  let w = (await rig.rpc('state')).workspaces.find((x: { id: string }) => x.id === ws.id)
  assert.deepEqual([w.prUrl, w.prLinked], ['https://github.com/o/r/pull/77', undefined])
  await until(() => readFileSync(rig.env.FAKE_LOG, 'utf8').includes('gh pr view https://github.com/o/r/pull/77 --json number,state'), 'scanned by its URL')
  // a PR on another branch: linked (its status, no switches: a push here wouldn't reach it)
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 78, title: 'Other', url: 'https://github.com/o/r/pull/78', headRefName: 'someone-else', baseRefName: 'main', isCrossRepository: false }))
  assert.equal((await rig.rpc('prAttach', { ws: ws.id, pr: 'https://github.com/o/r/pull/78' })).linked, true)
  w = (await rig.rpc('state')).workspaces.find((x: { id: string }) => x.id === ws.id)
  assert.deepEqual([w.prUrl, w.prLinked], ['https://github.com/o/r/pull/78', true])
  const folder = join(rig.home, 'plain')
  mkdirSync(folder)
  const fp = await rig.rpc('projectAdd', { path: folder })
  const fw = await rig.rpc('wsNew', { project: fp.id, preset: 'none' })
  await assert.rejects(rig.rpc('prAttach', { ws: fw.id, pr: '77' }), /only a git project/)
})
