// GitLab merge requests through glab (fakes/glab: its answers in $HOME/glab): the scan, the actions, Ship, issues.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const log = (rig: { env: Record<string, string> }) => readFileSync(rig.env.FAKE_LOG, 'utf8')

test('GitLab: a gitlab.com project’s MR by glab (its pipeline’s jobs as checks), its actions by glab, the GitHub-only parts say so; gh never asked', async t => {
  const rig = await fresh(t)
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:o/repo.git'], { cwd: rig.repo })
  const lab = join(rig.home, 'glab')
  mkdirSync(lab)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(lab, `mr-${ws.branch.replaceAll('/', '-')}.json`), JSON.stringify({ iid: 12, state: 'opened', web_url: 'https://gitlab.com/o/repo/-/merge_requests/12', title: 'Fix the cart', author: { username: 'ann' }, draft: true, sha: 'abc1234', target_branch: 'main', has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { id: 44 } }))
  writeFileSync(join(lab, 'jobs-44.json'), JSON.stringify([{ name: 'test', status: 'failed', web_url: 'https://gitlab.com/o/repo/-/jobs/1', duration: 61.4 }, { name: 'lint', status: 'success' }, { name: 'deploy', status: 'manual' }]))
  await rig.rpc('prRefresh', {})
  const pr = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr, 'its MR')
  assert.deepEqual(
    { number: pr.number, state: pr.state, forge: pr.forge, draft: pr.draft, conflict: pr.conflict, ready: pr.ready, base: pr.base, checks: pr.checks, author: pr.author },
    { number: 12, state: 'OPEN', forge: 'gitlab', draft: true, conflict: false, ready: true, base: 'main', checks: 'fail', author: 'ann' },
  )
  assert.deepEqual(pr.list, [{ name: 'test', state: 'fail', url: 'https://gitlab.com/o/repo/-/jobs/1', took: 61 }, { name: 'lint', state: 'pass' }, { name: 'deploy', state: 'skip' }])
  assert.match(log(rig), new RegExp(`^glab mr view ${ws.branch} --output json$`, 'm'))
  assert.match(log(rig), /^glab api projects\/:id\/pipelines\/44\/jobs\?per_page=100$/m)
  // the actions: glab's, by the MR's number
  await rig.rpc('prDraft', { ws: ws.id, draft: false })
  await rig.rpc('prAct', { ws: ws.id, act: 'approve' })
  await rig.rpc('prAct', { ws: ws.id, act: 'merge', method: 'rebase', deleteBranch: false })
  await rig.rpc('prAct', { ws: ws.id, act: 'merge' })
  await rig.rpc('prAct', { ws: ws.id, act: 'close' })
  for (const l of ['glab mr update 12 --ready', 'glab mr approve 12', 'glab mr merge 12 --yes --rebase --sha abc1234', 'glab mr merge 12 --yes --squash --remove-source-branch --sha abc1234', 'glab mr close 12']) assert.match(log(rig), new RegExp(`^${l}$`, 'm'), l)
  writeFileSync(join(lab, 'refuse'), "you can't approve your own merge request")
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'approve' }), /glab, MR !12: you can't approve your own merge request/)
  rmSync(join(lab, 'refuse'))
  writeFileSync(join(lab, 'noauth'), '')
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'approve' }), /glab isn't signed in: run glab auth login/)
  rmSync(join(lab, 'noauth'))
  // GitHub's only: said, or nothing
  await assert.rejects(rig.rpc('prSay', { ws: ws.id, body: 'hi' }), /GitHub only/)
  await assert.rejects(rig.rpc('prDiff', { ws: ws.id }), /GitHub only/)
  await assert.rejects(rig.rpc('prComment', { ws: ws.id, path: 'README.md', line: 1, body: 'x' }), /GitHub only/)
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), [])
  assert.deepEqual(await rig.rpc('prTalk', { ws: ws.id }), [])
  assert.ok(!log(rig).split('\n').some(l => l.startsWith('gh pr ')), 'gh not asked')
  // a merged one reverted: a branch off the target, its merge commit reverted onto it (the commits API), an MR from
  // it; a revert GitLab can't make takes the branch off again; not merged, no merge commit: said
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'revert' }), /isn't merged/)
  const merged = { iid: 12, state: 'merged', web_url: 'https://gitlab.com/o/repo/-/merge_requests/12', title: 'Fix the cart', author: { username: 'ann' }, sha: 'abc1234', target_branch: 'main', merge_commit_sha: 'feedc0de1234' }
  for (const f of [`mr-${ws.branch.replaceAll('/', '-')}.json`, 'mr-12.json']) writeFileSync(join(lab, f), JSON.stringify(merged))
  await rig.rpc('prRefresh', {})
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr?.state === 'MERGED', 'merged')
  assert.deepEqual(await rig.rpc('prAct', { ws: ws.id, act: 'revert' }), { pr: { number: 7, url: 'https://gitlab.com/o/repo/-/merge_requests/7', title: 'Revert "Fix the cart"' } })
  for (const l of ['glab api -X POST projects/:id/repository/branches -f branch=revert-feedc0de -f ref=main', 'glab api -X POST projects/:id/repository/commits/feedc0de1234/revert -f branch=revert-feedc0de', 'glab mr create --source-branch revert-feedc0de --target-branch main --title Revert "Fix the cart" --description Reverts !12 --yes']) assert.ok(log(rig).split('\n').includes(l), l)
  writeFileSync(join(lab, 'mr-12.json'), JSON.stringify({ ...merged, merge_commit_sha: null }))
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'revert' }), /MR !12 has no merge commit to revert/)
  // none any more: the MR gone from the view
  rmSync(join(lab, `mr-${ws.branch.replaceAll('/', '-')}.json`))
  await rig.rpc('prRefresh', {})
  await until(async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr, 'no MR')
})

test('GitLab: a canceled job is cancelled, never a pass', async t => {
  const rig = await fresh(t)
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:o/repo.git'], { cwd: rig.repo })
  const lab = join(rig.home, 'glab')
  mkdirSync(lab)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(lab, `mr-${ws.branch.replaceAll('/', '-')}.json`), JSON.stringify({ iid: 12, state: 'opened', web_url: 'https://gitlab.com/o/repo/-/merge_requests/12', title: 'x', author: { username: 'ann' }, sha: 'abc', target_branch: 'main', head_pipeline: { id: 44 } }))
  writeFileSync(join(lab, 'jobs-44.json'), JSON.stringify([{ name: 'lint', status: 'success' }, { name: 'test', status: 'canceled' }]))
  await rig.rpc('prRefresh', {})
  const pr = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr, 'its MR')
  assert.equal(pr.checks, 'cancelled')
  assert.deepEqual(pr.list.map((c: any) => `${c.name} ${c.state}`), ['lint pass', 'test cancelled'])
})

test('GitLab: Ship pushes and opens the MR with glab; an issue by number and the # list by glab; a self-hosted GitLab when glab is signed in to it, else gh as before', async t => {
  const rig = await fresh(t)
  const remote = join(rig.home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/o/repo.git'], { cwd: rig.repo })
  execFileSync('git', ['config', 'remote.origin.pushurl', remote], { cwd: rig.repo })
  const lab = join(rig.home, 'glab')
  mkdirSync(lab)
  const issue = { iid: 5, title: 'Cart rounds wrong', description: 'Two items at $0.10 show $0.30.', web_url: 'https://gitlab.com/o/repo/-/issues/5', assignees: [{ username: 'ann' }] }
  writeFileSync(join(lab, 'issue-5.json'), JSON.stringify(issue))
  writeFileSync(join(lab, 'issues.json'), JSON.stringify([issue]))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.deepEqual(await rig.rpc('issueList', { project: p.id }), [{ number: 5, title: 'Cart rounds wrong', url: 'https://gitlab.com/o/repo/-/issues/5', assignees: ['ann'], prs: [] }])
  await assert.rejects(rig.rpc('wsNew', { project: p.id, issue: '--repo=x/y' }), /which GitLab issue\? its number/, 'never a flag to glab')
  const iw = await rig.rpc('wsNew', { project: p.id, issue: '#5', prompt: 'keep it small' })
  assert.equal(iw.id, 'issue-5-cart-rounds-wrong')
  const agent = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === iw.id && x.kind === 'agent')
  await until(async () => /Work on GitLab issue #5: Cart rounds wrong\s+https:\/\/gitlab.com\/o\/repo\/-\/issues\/5\s+Two items/.test((await rig.rpc('screen', { target: agent.id, lines: 60 })).replace(/\n/g, ' ')), 'the issue in the prompt')
  // Ship: the branch pushed, then glab mr create from it; the MR scanned after
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'cart' })
  writeFileSync(join(ws.path, 'cart.ts'), 'fixed\n')
  const tab = await rig.rpc('ship', { ws: ws.id, message: 'Fix the cart' })
  const ended = await until(async () => (x => x.status === 'exited' && x)((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)), 'ship done', 15000)
  assert.equal(ended.code, 0, await rig.screen(tab.id))
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s', ws.branch], { cwd: remote, encoding: 'utf8' }).trim(), 'Fix the cart')
  assert.match(log(rig), new RegExp(`^glab mr create --fill --yes --source-branch ${ws.branch} --target-branch main$`, 'm'))
  assert.ok(!log(rig).includes('gh pr create'))
  assert.equal((await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).pr, 'the new MR')).forge, 'gitlab')
  // U5: the Ship sheet's title, description, draft, base and reviewers, glab's flags
  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'cart-2' })
  writeFileSync(join(ws2.path, 'cart2.ts'), 'fixed\n')
  const tab2 = await rig.rpc('ship', { ws: ws2.id, message: 'Fix it', title: 'Cart totals', body: 'Rounds once', draft: true, base: 'main', reviewers: ['ann'] })
  assert.equal((await until(async () => (x => x.status === 'exited' && x)((await rig.rpc('state')).tabs.find((x: any) => x.id === tab2.id)), 'ship done', 15000)).code, 0, await rig.screen(tab2.id))
  assert.match(log(rig), new RegExp(`^glab mr create --title Cart totals --description Rounds once --yes --source-branch ${ws2.branch} --target-branch main --draft --reviewer ann$`, 'm'))
  // self-hosted: glab signed in to gitlab.acme.dev, not to code.acme.dev
  writeFileSync(join(lab, 'host'), 'gitlab.acme.dev')
  const forge = async (url: string, name: string) => {
    const dir = join(rig.home, name)
    execFileSync('git', ['clone', '-q', rig.repo, dir])
    execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: dir })
    const q = await rig.rpc('projectAdd', { path: dir })
    return rig.rpc('wsNew', { project: q.id, preset: 'none', name: `${name}-ws` })
  }
  const self = await forge('git@gitlab.acme.dev:o/x.git', 'self')
  const plain = await forge('ssh://git@code.acme.dev/o/y.git', 'plain')
  await rig.rpc('prRefresh', {})
  await until(() => log(rig).includes(`glab mr view ${self.branch} --output json`) && log(rig).includes(`gh pr view ${plain.branch}`), 'each one asked by its own')
  assert.match(log(rig), /^glab auth status --hostname gitlab\.acme\.dev$/m)
  assert.match(log(rig), /^glab auth status --hostname code\.acme\.dev$/m)
  assert.ok(!log(rig).includes(`glab mr view ${plain.branch}`))
})
