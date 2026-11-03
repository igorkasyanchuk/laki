// The side panel's Commits (what a branch adds over its base, each pushed or not, one commit's diff), a PR back to a
// draft or ready (gh pr ready [--undo]), groups for scheduled tasks and workflows (a task's group, a workflow's group:),
// and a ```diff block in a chat read as a proposal (text.ts proposalOf)
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse, toFile } from '../src/shared/workflow.ts'
import { proposalOf } from '../src/renderer/src/text.ts'
import { fresh, until } from './helpers.ts'

test("commits: the branch's own over its base, newest first, each pushed or not; a commit's diff in diff's shape", async t => {
  const rig = await fresh(t)
  const remote = join(rig.home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote], { env: rig.env })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: rig.repo, env: rig.env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.deepEqual((await rig.rpc('commits', { ws: ws.id })).commits, [])
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' }).trim()
  writeFileSync(join(ws.path, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'Add a')
  git('push', '-q', 'origin', `HEAD:refs/heads/${ws.branch}`)
  writeFileSync(join(ws.path, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(ws.path, 'b.txt'), 'b\n')
  git('add', '.')
  git('commit', '-qm', 'More: two and b')
  const c = await rig.rpc('commits', { ws: ws.id })
  assert.equal(c.base, ws.base)
  assert.deepEqual(c.commits.map((x: any) => [x.subject, x.pushed]), [['More: two and b', false], ['Add a', true]])
  assert.match(c.commits[0].sha, /^[0-9a-f]{40}$/)
  assert.ok(c.commits[0].at > Date.now() - 600e3)
  const d = await rig.rpc('commitDiff', { ws: ws.id, sha: c.commits[0].sha })
  assert.deepEqual(d.files.map((f: any) => [f.path, f.status, f.add, f.del]), [['a.txt', 'M', 1, 0], ['b.txt', 'A', 1, 0]])
  assert.match(d.diff, /^diff --git a\/a.txt b\/a.txt/)
  assert.match(d.diff, /\n\+two$/m)
  await assert.rejects(rig.rpc('commitDiff', { ws: ws.id, sha: 'HEAD; rm -rf /' }), /a commit: its hash/)
  await assert.rejects(rig.rpc('commitDiff', { ws: ws.id, sha: 'f'.repeat(40) }), /git show/)
})

test("a PR back to a draft or ready for review: gh pr ready [--undo] by its URL; an agent's own workspace's only", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), 'no pull requests found')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'other' })
  await assert.rejects(rig.rpc('prDraft', { ws: ws.id, draft: true }), /has no PR/)
  const pr = { number: 9, state: 'OPEN', url: 'https://github.com/o/r/pull/9', statusCheckRollup: [] }
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await until(async () => (await rig.rpc('state')).workspaces.every((w: any) => w.pr), 'PRs scanned')
  assert.deepEqual(await rig.rpc('prDraft', { ws: ws.id, draft: true }), { draft: true })
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ ...pr, isDraft: true }))
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr.draft, 'a draft')
  assert.deepEqual(await rig.rpc('prDraft', { ws: ws.id, draft: true }), { draft: true }) // already: nothing asked of gh
  assert.deepEqual(await rig.rpc('prDraft', { ws: ws.id, draft: false }), { draft: false })
  const log = readFileSync(rig.env.FAKE_LOG, 'utf8')
  assert.equal(log.match(/gh pr ready --undo -- https:\/\/github.com\/o\/r\/pull\/9\n/g)?.length, 1)
  assert.match(log, /gh pr ready -- https:\/\/github.com\/o\/r\/pull\/9\n/)
  // an agent: its own workspace's PR, not another's
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id && x.kind === 'agent')
  await assert.rejects(rig.rpc('prDraft', { ws: other.id, draft: true, from: { ws: ws.id, tab: tab.id } }), /its own workspace's PR only/)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify(pr))
  await until(async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr.draft, 'ready again')
  assert.deepEqual(await rig.rpc('prDraft', { ws: ws.id, draft: true, from: { ws: ws.id, tab: tab.id } }), { draft: true })
  const cli = await rig.cli('pr', ws.id, '--ready')
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /ready for review/)
})

test("groups: a task's group (kept, cleared, moved without its checks); a workflow's group: in its file's head", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const s = await rig.rpc('scheduleSet', { project: p.id, prompt: 'review', when: 'weekdays at 9:00', group: '  Nightly  ' })
  assert.equal(s.group, 'Nightly')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'kept' })
  const inWs = await rig.rpc('scheduleSet', { project: p.id, prompt: 'x', when: 'daily at 8am', ws: ws.id })
  await rig.rpc('wsRm', { id: ws.id })
  // its workspace gone: a change would be refused, a group or off still goes
  assert.equal((await rig.rpc('scheduleSet', { id: inWs.id, group: 'Old' })).group, 'Old')
  assert.equal((await rig.rpc('scheduleSet', { id: inWs.id, on: false, group: 'Older' })).group, 'Older')
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, group: '' })).group, undefined)
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, group: 'x'.repeat(80) })).group, 'x'.repeat(60))

  const text = '# Release\n\nShips it.\n\nruns in: worktree · session: new · group: Release flows\n\n## start\nstart\n'
  const { workflow } = parse(text, 'release')
  assert.equal(workflow.group, 'Release flows')
  assert.match(toFile(workflow), /· group: Release flows\n/)
  assert.equal(parse(toFile({ ...workflow, group: undefined }), 'release').workflow.group, undefined)
})

test('proposalOf: a ```diff block as lines with kinds, file names and numbers from its @@ heads; not a diff: null', () => {
  const p = proposalOf('diff --git a/src/a.ts b/src/a.ts\nindex 1a2b..3c4d 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,3 +10,3 @@ export\n keep\n--- a removed line that starts with --\n+new\n\\ No newline at end of file\n')!
  assert.deepEqual(p.map(l => [l.kind, l.text, l.old, l.new]), [
    ['file', 'src/a.ts', undefined, undefined],
    ['hunk', '@@ -10,3 +10,3 @@ export', undefined, undefined],
    ['ctx', 'keep', 10, 10],
    ['del', '-- a removed line that starts with --', 11, undefined],
    ['add', 'new', undefined, 11],
  ])
  // no heads: no numbers; a deleted file's name from ---
  assert.deepEqual(proposalOf('-old\n+new')!.map(l => [l.kind, l.old, l.new]), [['del', undefined, undefined], ['add', undefined, undefined]])
  assert.equal(proposalOf('--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n')![0].text, 'gone.ts')
  assert.equal(proposalOf(' just\n context'), null)
  // inside a hunk, '-- x' out and '++ y' in read as --- / +++ with no @@ after: changed lines, not a file
  assert.deepEqual(proposalOf('@@ -1,2 +1,2 @@\n--- x\n+++ y\n same\n')!.map(l => [l.kind, l.text]), [['hunk', '@@ -1,2 +1,2 @@'], ['del', '-- x'], ['add', '++ y'], ['ctx', 'same']])
})
