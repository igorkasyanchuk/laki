import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionsFor, type RunAction } from '../src/renderer/src/text.ts'

test("Run ▾ actions: the project's replace global ones by name; agents only when running, focused first; terminals always", () => {
  const review: RunAction = { name: 'review', target: 'claude', text: 'review it twice' }
  const global: RunAction[] = [review, { name: 'review', target: 'codex', text: '$code-review' }, { name: 'migrate', target: 'shell', text: 'rails db:migrate' }, { name: ' ', target: 'claude', text: 'unnamed' }]
  const project: RunAction[] = [{ name: 'migrate', target: 'shell', text: 'bin/rails db:migrate' }, { name: 'empty', target: 'shell', text: '  ' }]
  const tabs = [
    { id: 'c1', agent: 'claude' },
    { id: 's1', shell: true },
    { id: 'c2', agent: 'claude' },
    { id: 's2', shell: true },
  ]
  // no codex running: its action is left out; claude's goes to the first claude, the terminal's to the first shell
  assert.deepEqual(actionsFor(global, project, tabs), {
    agent: [{ action: review, tab: 'c1' }],
    terminal: [{ action: project[0], tab: 's1' }],
  })
  // the focused tab wins when it fits
  assert.equal(actionsFor(global, project, tabs, 'c2').agent[0].tab, 'c2')
  assert.equal(actionsFor(global, project, tabs, 's2').terminal[0].tab, 's2')
  assert.equal(actionsFor(global, project, tabs, 's2').agent[0].tab, 'c1')
  // no shell: a terminal action has no tab (a new one opens)
  assert.deepEqual(actionsFor(global, [], [{ id: 'x', agent: 'codex' }]), {
    agent: [{ action: global[1], tab: 'x' }],
    terminal: [{ action: global[2], tab: undefined }],
  })
  assert.deepEqual(actionsFor(), { agent: [], terminal: [] })
  // a hand-edited state.json's action without a name is skipped, not a crash
  assert.deepEqual(actionsFor([{ target: 'shell', text: 'ls' } as RunAction], [{ name: 'x', target: 'shell', text: 'pwd' }], []).terminal.length, 1)
})
