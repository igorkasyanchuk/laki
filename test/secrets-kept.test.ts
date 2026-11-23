// A secret kept for next time (laki secret's card: Keep for this project or all projects): its value in the Keychain or a
// 0600 file of Laki's data, only its name in the view; the next ask of the same name shows it saved, one click gives it;
// the project's wins over the global one; Remove forgets it; an agent can't.
import assert from 'node:assert/strict'
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('kept secrets: kept for a project or all, given with one click, the project one first, forgotten', async t => {
  const rig = await fresh(t)
  const repo2 = join(rig.home, 'two')
  cpSync(rig.repo, repo2, { recursive: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const p2 = await rig.rpc('projectAdd', { path: repo2 })
  const up = async (project: string) => {
    const ws = await rig.rpc('wsNew', { project, preset: 'claude' })
    const tab = await until(async () => (x => x?.resumeId && x.status === 'idle' && x)(await rig.tab(ws.id)), 'claude up')
    return { ws, tab }
  }
  const a = await up(p.id)
  const ask = async (who: { ws: any; tab: any }, label: string) => {
    const asked = rig.rpc('secretAsk', { label, from: { tab: who.tab.id } })
    asked.catch(() => {})
    const card = await until(async () => (await rig.tab(who.ws.id)).secret, 'the card')
    return { asked, card }
  }
  // kept for this project: the next ask of the same name (any case) says so, one click gives it
  const one = await ask(a, 'Stripe key')
  assert.equal(one.card.saved, undefined)
  await rig.rpc('secretGive', { id: one.card.id, value: 'sk_test_project', keep: 'project' })
  await one.asked
  const v = await rig.rpc('stateOwn') // your own window's: the names; the masked state (an agent's) has none
  assert.ok(!JSON.stringify(v).includes('sk_test_project'), 'never in the view')
  assert.deepEqual(v.secretsKept.map((k: any) => [k.scope, k.label]), [[p.id, 'Stripe key']])
  assert.equal((await rig.rpc('state')).secretsKept, undefined)
  const file = join(rig.data, 'secrets', `${p.id}.stripe-key`) // a dot: no slug has one, so no two (project, name) pairs share a file
  assert.equal(readFileSync(file, 'utf8').trim(), 'sk_test_project')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const two = await ask(a, 'stripe KEY')
  assert.equal(two.card.saved, 'project')
  await rig.rpc('secretGive', { id: two.card.id, saved: true })
  assert.equal(readFileSync((await two.asked).path, 'utf8'), 'sk_test_project')
  // another project: not this one's; kept for all projects, then the first project's own still wins there
  const b = await up(p2.id)
  const three = await ask(b, 'Stripe key')
  assert.equal(three.card.saved, undefined)
  await rig.rpc('secretGive', { id: three.card.id, value: 'sk_test_all', keep: 'all' })
  await three.asked
  const four = await ask(a, 'Stripe key')
  assert.equal(four.card.saved, 'project')
  await rig.rpc('secretGive', { id: four.card.id, saved: true })
  assert.equal(readFileSync((await four.asked).path, 'utf8'), 'sk_test_project')
  // Remove: the user's alone; forgotten, the next ask is the global one's
  await assert.rejects(rig.rpc('secretForget', { scope: p.id, label: 'Stripe key', from: { ws: a.ws.id, tab: a.tab.id } }), /an agent can't forget a kept secret/)
  await rig.rpc('secretForget', { scope: p.id, label: 'Stripe key' })
  const five = await ask(a, 'Stripe key')
  assert.equal(five.card.saved, 'all')
  await rig.rpc('secretGive', { id: five.card.id, saved: true })
  assert.equal(readFileSync((await five.asked).path, 'utf8'), 'sk_test_all')
  assert.deepEqual((await rig.rpc('stateOwn')).secretsKept.map((k: any) => k.scope), ['*'])
  // a card open as its kept one is removed: it says so (no Saved to click into an error)
  const six = await ask(a, 'Stripe key')
  assert.equal(six.card.saved, 'all')
  await rig.rpc('secretForget', { scope: '*', label: 'Stripe key' })
  await until(async () => (s => s && s.id === six.card.id && s.saved === undefined)((await rig.tab(a.ws.id)).secret), 'the card without Saved')
  await rig.rpc('secretGive', { id: six.card.id, refuse: true })
  await assert.rejects(six.asked)
  // a project removed: its kept ones go with it, values too; one added later under its name (its id) starts with none
  const seven = await ask(b, 'Deploy token')
  await rig.rpc('secretGive', { id: seven.card.id, value: 'dt_test', keep: 'project' })
  await seven.asked
  const dt = join(rig.data, 'secrets', `${p2.id}.deploy-token`)
  assert.equal(readFileSync(dt, 'utf8').trim(), 'dt_test')
  await rig.rpc('wsRm', { id: b.ws.id })
  await rig.rpc('projectRm', { id: p2.id })
  assert.deepEqual((await rig.rpc('stateOwn')).secretsKept ?? [], [])
  assert.ok(!existsSync(dt), 'its value gone')
})
