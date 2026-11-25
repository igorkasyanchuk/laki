// #V1: speech-to-text's project words (shared/vocab.ts): the vocabulary, the spoken forms, the fix after the transcript
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spokenOf, VOCAB_MAX, vocabFix, vocabOf } from '../src/shared/vocab.ts'

test("#V1: a project's words in the transcript: whole spoken runs only, never by sound; ordinary sentences as they were", () => {
  const terms = ['checkout-flow', 'useSession', 'fix_cart_total', 'shop', 'Claude Code']
  assert.equal(vocabFix('open the checkout flow tab', terms).text, 'open the checkout-flow tab')
  assert.deepEqual(vocabFix('Checkout Flow is red', terms).swaps, [{ term: 'checkout-flow', heard: 'Checkout Flow' }])
  assert.equal(vocabFix('call use session in the hook', terms).text, 'call useSession in the hook')
  assert.equal(vocabFix('then fix cart total again', terms).text, 'then fix_cart_total again')
  for (const s of ['the checkout is flowing', 'use the session', 'a shop is open', 'we fix cart totals', 'checkout-flowers']) assert.equal(vocabFix(s, terms).text, s, s)
  assert.equal(vocabFix('nothing', []).text, 'nothing')
  assert.equal(spokenOf('shop'), undefined, 'one plain word: nothing to fix')
  assert.equal(spokenOf('HTTPServer'), 'http server')
  assert.equal(spokenOf('src/cart.js'), 'src cart js')
})

test("#V1: the vocabulary: the focused workspace's first, its changed files' names; Recording mode's private ones left out; at most 100", () => {
  const v = vocabOf({
    focused: 'w2',
    files: ['src/hooks/useSession.ts', 'README.md'],
    workspaces: [
      { id: 'w1', name: 'dark-mode', branch: 'laki/dark-mode', project: 'p1', tabs: ['claude'] },
      { id: 'w2', name: 'checkout-flow', branch: 'laki/checkout-flow', project: 'p1', tabs: ['claude', 'shell'] },
      { id: 'w3', name: 'secret-launch', project: 'p1', hidden: true },
      { id: 'w4', name: 'in-private-project', project: 'p2' },
    ],
    projects: [{ id: 'p1', name: 'shop' }, { id: 'p2', name: 'stealth', hidden: true }],
    agents: ['claude', 'codex'],
  })
  assert.deepEqual(v.slice(0, 5), ['checkout-flow', 'claude', 'shell', 'useSession', 'README'])
  assert.ok(v.includes('dark-mode') && v.includes('shop') && v.includes('codex'))
  for (const no of ['secret-launch', 'in-private-project', 'stealth']) assert.ok(!v.includes(no), `${no}: Recording mode hides it`)
  const many = vocabOf({ workspaces: Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, name: `ws-${i}`, project: 'p' })), projects: [] })
  assert.equal(many.length, VOCAB_MAX)
})
