// Q7: show and tell's hand-off (the quick bar's, tell.ts handOff): a screenshot's path and what was said reach an
// agent tab (send) or a new workspace's agent (wsNew's prompt), and Laki AI as an image; screencapture itself can't run
// here (scripts/ui-smoke.ts covers the bar with a stub picture)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handOff } from '../src/renderer/src/tell.ts'
import { spokenAnswer } from '../src/shared/talk.ts'
import { spokenMode } from '../src/shared/ask.ts'
import { fresh, until } from './helpers.ts'

test('Q7 handOff: each target gets the picture and the words', () => {
  const p = '/data/images/shot.png'
  assert.deepEqual(handOff({ kind: 'send', tab: 't1' }, ' this button is off by 2px ', [p]), { method: 'send', params: { target: 't1', text: `this button is off by 2px\n\n${p}`, whenIdle: true, agent: true } })
  const n = handOff({ kind: 'new', project: 'web' }, 'make it match', [p], { project: 'web', preset: 'codex', place: 'bottom', model: 'm' })
  assert.equal(n.method, 'wsNew')
  assert.deepEqual([n.params.project, n.params.prompt, n.params.preset, n.params.place, n.params.model], ['web', `make it match\n\n${p}`, 'codex', 'bottom', 'm'])
  // another project's last picks: none of them
  assert.deepEqual(handOff({ kind: 'new', project: 'api' }, 'x', [], { project: 'web', preset: 'codex' }).params, { project: 'api', prompt: 'x', place: 'top' })
  assert.deepEqual(handOff({ kind: 'ai' }, ' what is this? ', [p]), { method: 'aiAsk', params: { text: 'what is this?', images: [p], queue: true } })
})

test('Q7: a screenshot and a transcript reach an agent tab and a new workspace through the daemon', async t => {
  const rig = await fresh(t)
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64') // a PNG's head: enough for imageSave
  const path = await rig.rpc('imageSave', { data: png, ext: 'png' })
  const said = 'the total is wrong here'
  const pr = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: pr.id, kind: 'local', name: 'shop' })
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'its prompt')
  const c = handOff({ kind: 'send', tab: tab.id }, said, [path])
  await rig.rpc(c.method, c.params)
  await until(async () => (s => s.includes(said) && s.includes(path))((await rig.screen(tab.id)).replace(/\s+/g, ' ')), 'the words and the path in the agent', 15000)
  // a new task: its agent's first prompt
  const n = handOff({ kind: 'new', project: pr.id }, said, [path])
  const made = await rig.rpc(n.method, { ...n.params, preset: 'claude' })
  const first = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === made.id && x.kind === 'agent')
  await until(async () => (s => s.includes(said) && s.includes(path))((await rig.screen(first.id)).replace(/\s+/g, ' ')), "the new agent's prompt", 15000)
})

// the talk key answering a waiting ask: only the whole transcript one of a few words, never a sentence
test('spokenAnswer: yes or no when the whole of it is one of the words (fillers and punctuation aside); a sentence, nothing', () => {
  for (const s of ['yes', 'Yes.', 'um, yeah!', 'OK', 'allow', 'так', 'Так!', 'да', 'ja', 'oui', 'はい', '可以']) assert.equal(spokenAnswer(s), 'yes', s)
  for (const s of ['no', 'Nope.', "don't", 'Don’t', 'deny', 'ні', 'не треба', 'нет', 'nein', 'non', 'いいえ', '拒绝']) assert.equal(spokenAnswer(s), 'no', s)
  for (const s of ['yes but use pnpm', 'no, use yarn instead', 'yes please run the tests again', '', '   ', '…', 'maybe', 'yes no']) assert.equal(spokenAnswer(s), undefined, s)
  assert.equal(spokenAnswer('так', 'uk-UA'), 'yes')
  assert.equal(spokenAnswer('ja', 'en-US'), undefined) // English only: German's ja isn't a word of it
  assert.equal(spokenAnswer('ja', 'pt-BR'), 'yes') // a language it has no list for: any
})

test('spokenMode: a plain command answers by itself, a chained one waits for ⏎, a question, a plan, a secret or a risky command is for Laki', () => {
  const menu = [{ n: 1, label: 'Yes' }, { n: 2, label: "Yes, and don't ask again" }, { n: 3, label: 'No' }]
  const ask = (what: string, tool = 'Bash', options = menu) => ({ status: 'waiting', ask: { options, at: 1, tool, what } })
  assert.equal(spokenMode(ask('npm test')), 'auto')
  assert.equal(spokenMode(ask('src/cart.ts', 'Edit')), 'auto')
  assert.equal(spokenMode(ask('npm test && npm run build')), 'enter') // chained: a rule can't take it
  assert.equal(spokenMode(ask('cat /etc/hosts')), 'enter') // outside the worktree
  assert.equal(spokenMode(ask('https://example.com', 'WebFetch')), 'enter') // not a rule's tool
  assert.equal(spokenMode({ status: 'waiting', ask: { options: [{ n: 1, label: 'Postgres' }, { n: 2, label: 'SQLite' }], at: 1, question: 'Which database?' } }), 'laki') // a question
  assert.equal(spokenMode(ask('rm -rf build')), 'laki') // risky
  assert.equal(spokenMode({ ...ask('npm test'), planAsk: '1. do it' }), 'laki')
  assert.equal(spokenMode({ ...ask('npm test'), secret: { id: 's', label: 'Token' } }), 'laki')
  assert.equal(spokenMode(ask('npm test…')), 'laki') // cut: its end unseen
  assert.equal(spokenMode({ ...ask('npm test'), status: 'running' }), 'laki')
})
