// PR feedback to the agent (by hand and automatic) and the side panel's review threads, against the fake gh.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    JSON.stringify({ number: 7, state: 'OPEN', url: 'https://example.invalid/pr/7', headRefOid: 'abc', statusCheckRollup: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: job(1) },
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: 'https://ci.invalid/1' },
      { __typename: 'StatusContext', state: 'SUCCESS' },
    ] }),
  )
  const pr = await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.equal(pr.checks, 'fail')
  assert.deepEqual(pr.list, [
    { name: 'test', state: 'fail', url: job(1) },
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
    `answer: CI fails on PR #7 (https://example.invalid/pr/7). Find the cause and fix it, run what you can locally, then say what you changed.\n\n## test\n${job(1)}\n\n## e2e\nhttps://ci.invalid/2\n`,
  )

  // review: gh failing, no threads, none open; then the open ones (a bot's, a deleted user's)
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /gh couldn't read the review comments: it failed/)
  writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: {} }))
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /no review threads for PR #7/)
  const done = thread('t1', [said('ann', 'done already')], { isResolved: true, line: 1 })
  graphql(gh, [done])
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'review' }), /no open review comments on PR #7/)
  graphql(gh, [done, thread('t2', [said('lint-bot', 'unused import', 'Bot', 'NONE'), said(null, 'ghost here\nsecond line')], { isOutdated: true, line: null, path: 'b.ts' })])
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), [
    { path: 'a.ts', line: 1, resolved: true, outdated: false, comments: [{ author: 'ann', body: 'done already' }] },
    { path: 'b.ts', resolved: false, outdated: true, comments: [{ author: 'lint-bot', body: 'unused import' }, { author: 'ghost', body: 'ghost here\nsecond line' }] },
  ])
  await rig.rpc('prFix', { ws: ws.id, what: 'review', push: true })
  await until(async () => (await last()).startsWith('answer: Address'), 'review sent')
  assert.equal(
    await last(),
    "answer: Address the open review comments on PR #7 (https://example.invalid/pr/7). Fix what you agree with; then commit and push the fix, then say what you changed, and what you didn't and why.\n\n1. b.ts (outdated: the code moved since)\n   @lint-bot: unused import\n   @?: ghost here\n   second line",
  )

  // gh no longer finds it: no PR
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found')
  await until(async () => !(await rig.rpc('state')).workspaces[0].pr, 'PR dropped')
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
  c.close()
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
