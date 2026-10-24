// The full review's daemon calls: blame (the base's and the worktree's), a file's page on origin's site, and everyone's
// comments on the PR (prThreads all, prTalk), against the fake gh.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, type Rig, until } from './helpers.ts'

const gitIn = (rig: Rig, cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: rig.env, encoding: 'utf8' })
const commitAs = (rig: Rig, cwd: string, name: string, ...a: string[]) => execFileSync('git', ['commit', '-q', ...a], { cwd, env: { ...rig.env, GIT_AUTHOR_NAME: name }, encoding: 'utf8' })

test("blame: the base's commits for the old side, the worktree's (not committed: the zero commit) for the new; refusals", async t => {
  const rig = await fresh(t)
  writeFileSync(join(rig.repo, 'a.txt'), 'one\ntwo\nthree\n')
  gitIn(rig, rig.repo, 'add', '-A')
  commitAs(rig, rig.repo, 'Bea Base', '-m', 'the base')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'a.txt'), 'one\nTWO\nthree\n')
  commitAs(rig, ws.path, 'Ann Branch', '-am', 'two loud')
  writeFileSync(join(ws.path, 'a.txt'), 'one\nTWO\nthree\nfour\n')

  const old = await rig.rpc('blame', { ws: ws.id, path: 'a.txt', side: 'old' })
  assert.deepEqual(old.lines, [0, 0, 0])
  assert.deepEqual([old.commits[0].author, old.commits[0].summary], ['Bea Base', 'the base'])
  assert.ok(old.commits[0].at > 1e9)
  const now = await rig.rpc('blame', { ws: ws.id, path: 'a.txt', side: 'new' })
  const who = now.lines.map((i: number) => now.commits[i])
  assert.deepEqual(
    who.map((c: any) => (/^0+$/.test(c.sha) ? 'uncommitted' : c.author)),
    ['Bea Base', 'Ann Branch', 'Bea Base', 'uncommitted'],
  )

  writeFileSync(join(ws.path, 'new.txt'), 'brand new\n')
  await assert.rejects(rig.rpc('blame', { ws: ws.id, path: 'new.txt', side: 'new' }), /not committed yet/)
  gitIn(rig, ws.path, 'add', 'new.txt')
  gitIn(rig, ws.path, 'commit', '-qm', 'new')
  await assert.rejects(rig.rpc('blame', { ws: ws.id, path: 'new.txt', side: 'old' }), /not in main/)
  await assert.rejects(rig.rpc('blame', { ws: ws.id, path: '../outside.txt' }), /not a path inside the workspace/)
})

test("a file's page on origin's site: GitHub's, GitLab's and Bitbucket's shapes, at the base or the pushed branch, a line's anchor", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const web = (o: object) => rig.rpc('fileWeb', { ws: ws.id, path: 'docs/a b.md', ...o })
  await assert.rejects(web({}), /no origin remote with a web address/)

  gitIn(rig, rig.repo, 'remote', 'add', 'origin', 'git@github.com:o/r.git')
  assert.deepEqual(await web({ at: 'base', line: 3 }), { url: 'https://github.com/o/r/blob/main/docs/a%20b.md#L3' })
  await assert.rejects(web({ at: 'branch' }), new RegExp(`${ws.branch} isn't on origin: push it first`))
  gitIn(rig, ws.path, 'update-ref', `refs/remotes/origin/${ws.branch}`, 'HEAD')
  assert.deepEqual(await web({ at: 'branch' }), { url: `https://github.com/o/r/blob/${ws.branch.split('/').map(encodeURIComponent).join('/')}/docs/a%20b.md` })

  gitIn(rig, rig.repo, 'remote', 'set-url', 'origin', 'https://bot:secret@gitlab.example.com/g/sub/r.git')
  assert.deepEqual(await web({ line: 2 }), { url: 'https://gitlab.example.com/g/sub/r/-/blob/main/docs/a%20b.md#L2' }) // the user and token never in it
  gitIn(rig, rig.repo, 'remote', 'set-url', 'origin', 'https://gitlab.example.com:8443/g/r.git')
  assert.deepEqual(await web({}), { url: 'https://gitlab.example.com:8443/g/r/-/blob/main/docs/a%20b.md' }) // an https remote's port is its site's
  gitIn(rig, rig.repo, 'remote', 'set-url', 'origin', 'ssh://git@bitbucket.org:22/o/r.git') // an ssh one's isn't
  assert.deepEqual(await web({ line: 2 }), { url: 'https://bitbucket.org/o/r/src/main/docs/a%20b.md#lines-2' })
  await assert.rejects(web({ path: '../x' }), /not a path inside the workspace/)
})

test("everyone's comments for the full review: prThreads all keeps them, the agent's list doesn't; prTalk's conversation and reviews", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 7, state: 'OPEN', url: 'https://example.invalid/pr/7', headRefOid: 'abc', statusCheckRollup: [] }))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')

  const said = (login: string, body: string, authorAssociation: string) => ({ author: { login, __typename: 'User' }, authorAssociation, body, createdAt: '2026-10-06T10:00:00Z' })
  const threads = [{ id: 't1', isResolved: false, isOutdated: false, path: 'a.ts', line: 2, comments: { nodes: [said('ann', 'from a member', 'MEMBER'), said('passerby', 'from anyone', 'NONE')] } }]
  writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: threads } } } } }))
  assert.deepEqual((await rig.rpc('prThreads', { ws: ws.id }))[0].comments.map((c: any) => c.author), ['ann'])
  assert.deepEqual((await rig.rpc('prThreads', { ws: ws.id, all: true }))[0].comments.map((c: any) => c.author), ['ann', 'passerby'])

  await assert.rejects(rig.rpc('prTalk', { ws: ws.id }), /no comments for PR #7/)
  const talk = {
    comments: { nodes: [{ author: { login: 'passerby' }, body: 'nice one', createdAt: '2026-10-06T12:00:00Z', url: 'https://example.invalid/c1' }, { author: null, body: 'gone user', createdAt: '2026-10-06T09:00:00Z' }] },
    reviews: {
      nodes: [
        { author: { login: 'ann' }, body: '', state: 'APPROVED', submittedAt: '2026-10-06T11:00:00Z', url: 'https://example.invalid/r1' },
        { author: { login: 'bo' }, body: '', state: 'COMMENTED', submittedAt: '2026-10-06T11:30:00Z' }, // only its threads: none here
        { author: { login: 'me' }, body: 'draft', state: 'PENDING', submittedAt: null }, // not sent yet
        { author: { login: 'cy' }, body: 'see inline', state: 'COMMENTED', submittedAt: '2026-10-06T10:30:00Z' },
      ],
    },
  }
  writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: { repository: { pullRequest: talk } } }))
  assert.deepEqual(await rig.rpc('prTalk', { ws: ws.id }), [
    { author: 'ghost', body: 'gone user', at: '2026-10-06T09:00:00Z' },
    { author: 'cy', body: 'see inline', at: '2026-10-06T10:30:00Z', state: 'COMMENTED' },
    { author: 'ann', body: '', at: '2026-10-06T11:00:00Z', url: 'https://example.invalid/r1', state: 'APPROVED' },
    { author: 'passerby', body: 'nice one', at: '2026-10-06T12:00:00Z', url: 'https://example.invalid/c1' },
  ])
})
