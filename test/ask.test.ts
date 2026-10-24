// a waiting agent's menu, read off its screen (shared/ask.ts): the Allow / Deny buttons and notification actions
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { askOf } from '../src/shared/ask.ts'

test('ask: menus of claude, codex and gemini; not an answer’s numbered list', () => {
  const claude = [
    '╭──────────────────────────────────────────────╮',
    '│ Bash command                                 │',
    '│   npm test                                   │',
    '│ Do you want to proceed?                      │',
    '│ ❯ 1. Yes                                     │',
    "│   2. Yes, and don't ask again for npm test   │",
    '│   3. No, and tell Claude what to do (esc)    │',
    '╰──────────────────────────────────────────────╯',
  ].join('\n')
  assert.deepEqual(askOf(claude), { at: 1, question: 'Do you want to proceed?', options: [{ n: 1, label: 'Yes' }, { n: 2, label: "Yes, and don't ask again for npm test" }, { n: 3, label: 'No, and tell Claude what to do (esc)' }] })
  const codex = 'Allow command?\n  1. Yes, proceed\n› 2. Yes, and don’t ask again\n  3. No (esc)'
  assert.equal(askOf(codex)?.at, 2)
  assert.equal(askOf('● 1. Allow once\n  2. Allow for this session\n  3. No, suggest changes (esc)')?.options.length, 3)
  // an answer's list has no highlight: no menu; the last menu wins over one above it
  assert.equal(askOf('Plan:\n1. Install deps\n2. Run the tests\n3. Ship'), undefined)
  assert.equal(askOf('❯ 1. A\n  2. B\nlater\n  1. C\n❯ 2. D')?.options[1].label, 'D')
  assert.equal(askOf('❯ 1. Only one'), undefined) // a menu has two choices or more
  assert.equal(askOf('❯ 1. One\n  3. Three'), undefined) // not in order: not a menu
})

test('ask: what it asks, the line or two above its menu', () => {
  // claude's permission prompt: the question alone, its command above a blank line left out
  assert.equal(askOf('Bash command\n\n  rm -rf build\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No (esc)')?.question, 'Do you want to proceed?')
  // codex's approval menu: its command, the line above it too when that isn't a question
  const codex = ['Would you like to run the following command?', '', '  Reason: clean the build', '  $ rm -rf build', '', '› 1. Yes, proceed (y)', '  2. Yes, and don’t ask again for this command (a)', '  3. No, and tell Codex what to do differently (esc)'].join('\n')
  assert.equal(askOf(codex)?.question, 'Reason: clean the build · $ rm -rf build')
  // a plain numbered list under a question, a box's rule skipped
  assert.equal(askOf('Which one should I keep?\n────────\n  1. Apple\n❯ 2. Banana')?.question, 'Which one should I keep?')
  // nothing above: no question; a long one cut at 200
  assert.equal(askOf('❯ 1. A\n  2. B')?.question, undefined)
  assert.equal(askOf(`${'x'.repeat(300)}\n❯ 1. A\n  2. B`)?.question?.length, 200)
})
