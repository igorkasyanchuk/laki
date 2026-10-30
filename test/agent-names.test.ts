// Agents by name: laki name gives an agent's tab an @name, laki agents lists them, laki ask asks one and prints its
// reply, @name works wherever a target goes (send, screen).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('laki name, agents, ask: an @name per live agent, its reply to a question', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'front' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'back' })
  const ta = await until(() => rig.tab(a.id))
  const tb = await until(() => rig.tab(b.id))
  await until(async () => (await rig.rpc('state')).tabs.filter((x: any) => x.status === 'idle').length === 2, 'both idle')
  const as = async (tab: any, ...args: string[]) => {
    Object.assign(rig.env, { LAKI_WORKSPACE: tab.workspace, LAKI_TAB: tab.id })
    try {
      return await rig.cli(...args)
    } finally {
      delete rig.env.LAKI_WORKSPACE
      delete rig.env.LAKI_TAB
    }
  }
  let r = await as(tb, 'name', '@Backend')
  assert.equal(r.out, '@backend\n', r.err)
  assert.match((await as(ta, 'name', 'backend')).err, /@backend is taken: claude/) // one live agent per name
  assert.match((await as(ta, 'name', '9 lives')).err, /a name is a word/)
  assert.match((await as(ta, 'name', 'mine', '--tab', tb.id)).err, /an agent can't name another agent's tab/) // it could take @backend's messages
  assert.match((await as(ta, 'ask', a.id, 'hi')).err, /that's you/) // its own workspace's agent: it
  r = await rig.cli('agents')
  assert.match(r.out, /^@backend {2}claude {2}idle {2}back\//, r.err)
  // asked from outside any tab (yours): typed in, its reply printed
  r = await rig.cli('ask', '@backend', 'which endpoint lists teams?')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^answer: A question from the user, sent with laki ask\. Answer it in your reply[^]*which endpoint lists teams\?\n$/)
  // @name as a send's target; unknown: said
  await rig.rpc('send', { target: '@backend', text: 'rebase on main' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tb.id).last === 'answer: rebase on main', 'sent by name')
  await assert.rejects(rig.rpc('send', { target: '@nobody', text: 'x' }), /no agent is named @nobody/)
  // '' drops it; the name is free again
  await as(tb, 'name', '')
  assert.equal((await as(ta, 'name', 'backend')).out, '@backend\n')
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === ta.id).alias, 'backend')
})
