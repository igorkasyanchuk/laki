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

test("kept secrets: who got one: each give's workspace newest first, the count, 20 kept; a card says the last give and a workspace's first; never to an agent", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const up = async () => {
    const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
    const tab = await until(async () => (x => x?.resumeId && x.status === 'idle' && x)(await rig.tab(ws.id)), 'claude up')
    return { ws, tab }
  }
  const ask = async (who: { ws: any; tab: any }) => {
    const asked = rig.rpc('secretAsk', { label: 'Stripe key', from: { tab: who.tab.id } })
    asked.catch(() => {})
    const card = await until(async () => (await rig.rpc('stateOwn')).tabs.find((x: any) => x.id === who.tab.id)?.secret, 'the card') // your own window's
    return { asked, card }
  }
  const kept = async () => (await rig.rpc('stateOwn')).secretsKept[0]
  const a = await up()
  const b = await up()
  // kept with its first give: a's
  const one = await ask(a)
  await rig.rpc('secretGive', { id: one.card.id, value: 'sk_test_given', keep: 'project' })
  await one.asked
  assert.deepEqual([(await kept()).count, (await kept()).given.map((g: any) => g.ws)], [1, [a.ws.id]])
  // b asks: its first time; the last give was a's
  const two = await ask(b)
  assert.equal(two.card.first, true)
  assert.equal(two.card.last.name, (w => w.name || w.id)((await rig.rpc('state')).workspaces.find((w: any) => w.id === a.ws.id)), 'its name as shown')
  // an agent's view (the masked one) has neither the list nor the last give's workspace
  const masked = (await rig.rpc('state')).tabs.find((x: any) => x.id === b.tab.id).secret
  assert.equal(masked.last, undefined)
  assert.equal((await rig.rpc('state')).secretsKept, undefined)
  await rig.rpc('secretGive', { id: two.card.id, saved: true })
  await two.asked
  const k = await kept()
  assert.equal(k.count, 2)
  assert.deepEqual(k.given.map((g: any) => g.ws), [b.ws.id, a.ws.id], 'the newest first')
  assert.ok(k.given[0].at >= k.given[1].at)
  // a asks again: not its first
  const three = await ask(a)
  assert.equal(three.card.first, false)
  await rig.rpc('secretGive', { id: three.card.id, saved: true })
  await three.asked
  // 20 kept, every one counted
  for (let i = 0; i < 20; i++) {
    const x = await ask(i % 2 ? a : b)
    await rig.rpc('secretGive', { id: x.card.id, saved: true })
    await x.asked
  }
  const all = await kept()
  assert.equal(all.count, 23)
  assert.equal(all.given.length, 20)
  assert.ok(!JSON.stringify(all).includes('sk_test_given'), 'no value')
  assert.ok(!JSON.stringify(all).includes('.laki-secrets'), 'no path')
})
