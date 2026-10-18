import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlight, highlightWorkflow, HL_MAX } from '../src/renderer/src/highlight.ts'

const of = (path: string, text: string) => highlight(path, text).map(l => l.filter(([c]) => c).map(([c, s]) => `${c}:${s}`))

test("a workflow's file: headings, keys, prompts, options, vars; long text stays plain", () => {
  const wf = (text: string) => highlightWorkflow(text).map(l => l.filter(([c]) => c).map(([c, s]) => `${c}:${s}`))
  const src = `# New workflow
What it does, in a line.

runs in: worktree · session: new
var TEAM: core

## work
agent: claude · json: yes
> Fix {{task}} in 2 steps
next: done
max: 3 → retry
at: 70,110
choice: steps.review.answer contains "LGTM"
- steps.t.p >= 0.8 → ship
  - a level
end: success · notify: no
`
  assert.deepEqual(wf(src), [
    ['hl-h:# New workflow'],
    [],
    [],
    ['hl-p:runs in', 'hl-c:·', 'hl-p:session'],
    ['hl-k:var', 'hl-v:TEAM'],
    [],
    ['hl-h:## work'],
    ['hl-p:agent', 'hl-c:·', 'hl-p:json', 'hl-k:yes'],
    ['hl-c:>', 'hl-s: Fix ', 'hl-v:{{task}}', 'hl-s: in 2 steps'], // a prompt's numbers are words
    ['hl-p:next', 'hl-f:done'],
    ['hl-p:max', 'hl-n:3', 'hl-k:→', 'hl-f:retry'],
    ['hl-p:at', 'hl-n:70', 'hl-n:110'],
    ['hl-p:choice', 'hl-s:"LGTM"'],
    ['hl-a:-', 'hl-n:0.8', 'hl-k:→', 'hl-f:ship'],
    ['hl-a:-'],
    ['hl-p:end', 'hl-c:·', 'hl-p:notify', 'hl-k:no'],
    [],
  ])
  // a WHOLE key's value is the rest of the line: no key after its ·
  assert.deepEqual(wf('question: urgent · yes/no · Does it: matter?'), [['hl-p:question', 'hl-c:·', 'hl-c:·']])
  assert.deepEqual(wf('v2: claude-3-5'), [['hl-p:v2']]) // digits in a word aren't numbers
  // the text comes back whole, in order
  assert.equal(highlightWorkflow(src).map(l => l.map(([, s]) => s).join('')).join('\n'), src)
  assert.deepEqual(wf('## a\n'.repeat(HL_MAX / 5 + 1)).flat(), []) // over 50 KB: plain
})

test('syntax tokens by language; long or unknown text stays plain', () => {
  assert.deepEqual(of('a.ts', 'const x = "hi" // say\nfoo(42)'), [['hl-k:const', 'hl-s:"hi"', 'hl-c:// say'], ['hl-f:foo', 'hl-n:42']])
  assert.deepEqual(of('a.ts', '/* one\ntwo */ Map'), [['hl-c:/* one'], ['hl-c:two */', 'hl-t:Map']]) // a comment over two lines
  assert.deepEqual(of('a.json', '{"name": "laki", "n": 1}'), [['hl-p:"name"', 'hl-s:"laki"', 'hl-p:"n"', 'hl-n:1']])
  assert.deepEqual(of('x.py', 'def f(s="# not a comment"):  # one\n    return None'), [['hl-k:def', 'hl-f:f', 'hl-s:"# not a comment"', 'hl-c:# one'], ['hl-k:return', 'hl-k:None']])
  assert.deepEqual(of('ci.yml', 'name: test\n# c'), [['hl-p:name'], ['hl-c:# c']])
  assert.deepEqual(of('a.md', '```\nx\n```\n**b**'), [['hl-s:```'], ['hl-s:x'], ['hl-s:```'], ['hl-k:**b**']])
  assert.deepEqual(of('run.sh', 'if [ $# -eq 0 ]; then # none'), [['hl-k:if', 'hl-n:0', 'hl-k:then', 'hl-c:# none']])
  assert.deepEqual(of('t.py', 'n = 1#one'), [['hl-n:1', 'hl-c:#one']])
  assert.deepEqual(of('a.sql', 'SELECT id FROM t -- all'), [['hl-k:SELECT', 'hl-k:FROM', 'hl-c:-- all']])
  assert.deepEqual(of('i.html', '<a href="/x">hi</a>'), [['hl-p:<a', 'hl-a:href', 'hl-s:"/x"', 'hl-p:</a']])
  assert.deepEqual(of('README.md', '# Laki\nrun `npm test`'), [['hl-h:# Laki'], ['hl-s:`npm test`']])
  assert.deepEqual(of('.env.local', 'KEY=1 # x'), [['hl-p:KEY', 'hl-n:1', 'hl-c:# x']])
  assert.deepEqual(highlight('notes.txt', 'a\n\nb'), [[['', 'a']], [], [['', 'b']]])
  assert.deepEqual(of('big.ts', 'const x\n'.repeat(HL_MAX / 8 + 1)).flat(), []) // over 50 KB: plain
  // the text comes back whole, in order
  const src = 'fn main() {\n  let s = "a\\"b"; // c\n}\n'
  assert.equal(highlight('m.rs', src).map(l => l.map(([, s]) => s).join('')).join('\n'), src)
})
