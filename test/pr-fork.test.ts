// A fork's PR whose workflow runs GitHub holds for a maintainer's approval: not failing, held (pr.held), Approve and
// run (prAct ci) under the project's Approve switch, pinned to the head the app showed (an agent can't: agent-gates).
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const HEAD = 'a'.repeat(40)

test("a fork's held CI: waiting, not failed; Approve and run approves each held run of that head", async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 7, state: 'OPEN', url: 'https://github.com/o/r/pull/7', headRefOid: HEAD, isCrossRepository: true, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }] }))
  writeFileSync(join(gh, 'held.json'), '[11,12]')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const pr = await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.equal(pr.held, 2)
  assert.equal(pr.checks, 'pending') // held: waiting, never "failing"
  assert.equal(pr.list[0].state, 'pending')
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'ci', head: 'b'.repeat(40) }), /new head since/)
  assert.deepEqual(await rig.rpc('prAct', { ws: ws.id, act: 'ci', head: HEAD }), { approved: 2 })
  const log = readFileSync(rig.env.FAKE_LOG, 'utf8')
  assert.match(log, /gh api repos\/o\/r\/actions\/runs\?head_sha=a{40}&status=action_required/)
  assert.match(log, /gh api -X POST repos\/o\/r\/actions\/runs\/11\/approve/)
  assert.match(log, /gh api -X POST repos\/o\/r\/actions\/runs\/12\/approve/)
  // the project's Approve switch off: no Approve and run either
  await rig.rpc('projectSet', { id: p.id, config: { pr: { approve: false } } })
  await assert.rejects(rig.rpc('prAct', { ws: ws.id, act: 'ci', head: HEAD }), /approving PRs is off/)
  // none held (approved): no mark; a PR from the repo itself is never asked about
  writeFileSync(join(gh, 'held.json'), '[]')
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 7, state: 'OPEN', url: 'https://github.com/o/r/pull/7', headRefOid: HEAD, isCrossRepository: false, statusCheckRollup: [] }))
  await rig.rpc('prRefresh')
  await until(async () => !(await rig.rpc('state')).workspaces[0].pr?.held, 'held gone')
})
