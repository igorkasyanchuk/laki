// A fork's GitHub remotes: # completion's issues and laki_prs' PRs from each (origin's first, a repo once whatever its
// URL), each with its repo; one gh can't read left out; upstream's PR on its own branch never origin's workspace.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

const issue = (repo: string, number: number, title: string) => ({ number, title, url: `https://github.com/${repo}/issues/${number}`, assignees: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] } })
const issues = (...nodes: object[]) => JSON.stringify({ data: { repository: { issues: { nodes } } } })
const pr = (repo: string, number: number, head: string, owner: string) => ({ number, title: `PR ${number}`, author: { login: 'bob' }, url: `https://github.com/${repo}/pull/${number}`, headRefName: head, baseRefName: 'main', isDraft: false, reviewDecision: '', updatedAt: '2026-11-07T00:00:00Z', headRepository: { name: 'shop' }, headRepositoryOwner: { login: owner } })

test("every GitHub remote: each one's issues and PRs with its repo, #42 twice; one gh can't read left out; upstream's PR on its own branch", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh, { recursive: true })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: rig.repo })
  git('remote', 'add', 'upstream', 'https://github.com/acme/shop.git')
  git('remote', 'add', 'origin', 'git@github.com:me/shop.git')
  git('remote', 'add', 'again', 'https://github.com/ME/Shop') // origin's repo by HTTPS, another case: once
  git('remote', 'add', 'gone', 'https://github.com/old/shop.git') // gh can't read it
  git('remote', 'add', 'work', 'git@gitlab.example:me/shop.git') // not GitHub: not asked
  git('remote', 'add', 'look', 'https://notgithub.com/evil/shop.git') // a host that only ends in github.com: not GitHub
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')

  writeFileSync(join(gh, 'issues-me_shop.json'), issues(issue('me/shop', 42, 'Fork fix')))
  writeFileSync(join(gh, 'issues-acme_shop.json'), issues(issue('acme/shop', 42, 'Upstream bug'), issue('acme/shop', 41, 'Older')))
  const list = await rig.rpc('issueList', { project: p.id })
  assert.deepEqual(list.map((x: any) => [x.repo, x.number, x.title, x.url]), [
    ['me/shop', 42, 'Fork fix', 'https://github.com/me/shop/issues/42'],
    ['acme/shop', 42, 'Upstream bug', 'https://github.com/acme/shop/issues/42'],
    ['acme/shop', 41, 'Older', 'https://github.com/acme/shop/issues/41'],
  ])
  assert.match(log(), /gh api graphql -f owner=me -f name=shop /)
  assert.match(log(), /gh api graphql -f owner=acme -f name=shop /)
  assert.match(log(), /gh api graphql -f owner=old -f name=shop /)
  assert.doesNotMatch(log(), /owner=ME|owner=evil|gitlab\.example|owner=\{owner\}/)

  // PRs: each repo's (--repo), its repo with it; a worktree on its branch only for a PR whose head is origin's
  const mine = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feature' })
  writeFileSync(join(gh, 'prlist-me_shop.json'), JSON.stringify([pr('me/shop', 5, mine.branch, 'me')]))
  writeFileSync(join(gh, 'prlist-acme_shop.json'), JSON.stringify([pr('acme/shop', 5, mine.branch, 'acme'), pr('acme/shop', 6, mine.branch, 'me')]))
  const prs = await rig.rpc('prList', { project: p.id })
  assert.deepEqual(prs.map((x: any) => [x.repo, x.number, x.workspace]), [['me/shop', 5, mine.id], ['acme/shop', 5, undefined], ['acme/shop', 6, mine.id]])
  assert.match(log(), /gh pr list --repo me\/shop --state open/)

  // upstream's PR on its own branch named as origin's workspace's: acme/<branch>, its own worktree
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 5, title: 'Upstream feature', url: 'https://github.com/acme/shop/pull/5', headRefName: mine.branch, baseRefName: 'main', isCrossRepository: false }))
  writeFileSync(join(gh, 'checkout'), mine.branch)
  const up = await rig.rpc('wsNew', { project: p.id, preset: 'none', pr: 'https://github.com/acme/shop/pull/5' })
  assert.equal(up.branch, `acme/${mine.branch}`)
  assert.notEqual(up.id, mine.id)
  assert.equal(up.prUrl, 'https://github.com/acme/shop/pull/5')
  assert.match(log(), new RegExp(`gh pr checkout https://github.com/acme/shop/pull/5 --branch acme/${mine.branch}`))
  // origin's own PR on that branch keeps its name: it's mine's
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 5, title: 'Fork feature', url: 'https://github.com/me/shop/pull/5', headRefName: mine.branch, baseRefName: 'main', isCrossRepository: false }))
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', pr: 'https://github.com/me/shop/pull/5' }), new RegExp(`already checked out in workspace ${mine.id}$`))
})
