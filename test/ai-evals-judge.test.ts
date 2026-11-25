// scripts/ai-evals.ts' comparison: the first tool call (after lookups) against what an ask expects
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callOf, judge } from '../scripts/ai-evals.ts'

test("eval:ai's judge: the tool and a few arguments, in any order and case; lookups first skipped; a wrong tool fails", () => {
  const send = { id: 's', ask: 'tell it', tool: ['laki_send'], args: { target: 'a1', text: 'tax' } }
  assert.equal(judge(send, [{ name: 'laki_send', args: { text: 'Also round the TAX', target: 'a1' } }]).pass, true, 'its arguments in another order')
  assert.match(judge(send, [{ name: 'laki_new_workspace', args: {} }]).why, /called laki_new_workspace, not laki_send/)
  assert.match(judge(send, [{ name: 'laki_send', args: { target: 'a1', text: 'shipping' } }]).why, /without text: "tax"/)
  assert.equal(judge(send, [{ name: 'laki_state', args: {} }, { name: 'laki_send', args: { target: 'a1', text: 'tax' } }]).pass, true, 'a lookup first: the next call is the one')
  assert.equal(judge({ id: 'q', ask: 'what runs', tool: ['laki_state'] }, [{ name: 'laki_state', args: {} }, { name: 'laki_send', args: {} }]).pass, true, 'a lookup expected: the first')
  assert.match(judge(send, []).why, /no tool called/)
  const rm = { id: 'r', ask: 'archive it', tool: ['laki_archive', 'laki_remove'], asks: true }
  assert.match(judge(rm, [{ name: 'laki_archive', args: {} }]).why, /without asking first/)
  assert.equal(judge(rm, [{ name: 'laki_remove', args: {} }], true).pass, true)
  assert.deepEqual(callOf('laki_send {"target":"a1","text":"hi"}'), { name: 'laki_send', args: { target: 'a1', text: 'hi' } })
  assert.deepEqual(callOf('laki_state'), { name: 'laki_state', args: {} })
})
