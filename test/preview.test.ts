import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { completions } from '../src/renderer/src/text.ts'
import { fresh, until } from './helpers.ts'

test('preview: audio and video as data URLs only when asked, a storage file opened in its app, editor or Finder', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const ws = async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id)
  const dir = await until(async () => (await ws()).storage, 'its storage folder')
  writeFileSync(join(w.path, 'voice.mp3'), Buffer.from('ID3fake'))
  writeFileSync(join(dir, 'demo.mp4'), Buffer.from('fakevideo'))
  writeFileSync(join(dir, 'build.zip'), Buffer.from([0x50, 0x4b, 0, 0]))
  // its kind always; its bytes only with media: true (the strip's previews never carry them)
  assert.deepEqual(await rig.rpc('fileRead', { ws: w.id, path: 'voice.mp3' }), { size: 7, media: 'audio' })
  assert.deepEqual(await rig.rpc('fileRead', { ws: w.id, path: 'voice.mp3', media: true }), { size: 7, media: 'audio', src: `data:audio/mpeg;base64,${Buffer.from('ID3fake').toString('base64')}` })
  assert.equal((await rig.rpc('fileRead', { ws: w.id, path: 'demo.mp4', storage: true, media: true })).src, `data:video/mp4;base64,${Buffer.from('fakevideo').toString('base64')}`)
  assert.deepEqual(await rig.rpc('fileRead', { ws: w.id, path: 'build.zip', storage: true, media: true }), { size: 4 }, 'not media: its size, as before')

  // the card's buttons for a storage file: the default app, the editor, Finder; never outside the folder
  await rig.rpc('openIn', { ws: w.id, app: 'default', file: 'build.zip', storage: true })
  await rig.rpc('openIn', { ws: w.id, app: 'editor', file: 'build.zip', storage: true })
  await rig.rpc('openIn', { ws: w.id, app: 'finder', file: 'demo.mp4', storage: true })
  await assert.rejects(rig.rpc('openIn', { ws: w.id, app: 'default', file: '../../state.json', storage: true }), /not a path inside/)
  const opened = readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open '))
  assert.deepEqual(opened, [`open ${join(dir, 'build.zip')}`, `open -a Cursor ${join(dir, 'build.zip')}`, `open -R ${join(dir, 'demo.mp4')}`])
})

test("the / menu: an agent's own commands and skills, its project's first; Laki's plugin's as /laki:…", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const put = (file: string, text: string) => (mkdirSync(join(file, '..'), { recursive: true }), writeFileSync(file, text))
  put(join(rig.home, '.claude/commands/ship-it.md'), '---\ndescription: Ship the branch as a PR\n---\nShip it.')
  put(join(rig.home, '.claude/commands/front/test.md'), '# Run the frontend tests\n')
  put(join(rig.home, '.claude/skills/pdf/SKILL.md'), '---\nname: pdf\ndescription: "Read and fill PDFs"\n---\n')
  put(join(rig.repo, '.claude/commands/ship-it.md'), '---\ndescription: The repo’s own ship\n---\n')
  put(join(rig.home, '.codex/prompts/review.md'), 'Review the diff\n')
  put(join(rig.home, '.codex/skills/sql/SKILL.md'), '---\ndescription: >-\n  Write\n  SQL\n---\n') // a block scalar: its lines as one
  const claude = await rig.rpc('agentCommands', { agent: 'claude', project: p.id })
  assert.deepEqual(claude.filter((c: { name: string }) => c.name.startsWith('laki:')).map((c: { name: string }) => c.name), ['laki:extension', 'laki:new', 'laki:orchestrate']) // the plugin the daemon writes
  assert.deepEqual(claude.filter((c: { name: string }) => !c.name.startsWith('laki:')), [
    { name: 'front:test', sub: 'Run the frontend tests' },
    { name: 'pdf', sub: 'Read and fill PDFs', skill: true },
    { name: 'ship-it', sub: 'The repo’s own ship' }, // the project's wins over yours of the same name
  ])
  assert.deepEqual(await rig.rpc('agentCommands', { agent: 'codex', project: p.id }), [
    { name: '$sql', sub: 'Write SQL', skill: true },
    { name: 'prompts:review', sub: 'Review the diff' },
  ])
  assert.deepEqual(await rig.rpc('agentCommands', { agent: 'gemini' }), [])
  // the box: your templates first, then these; a pick types /name (a codex skill: $name)
  const rows = completions({ ch: '/', q: '', from: 0 }, { templates: [{ name: 'spec', text: 'Write a spec' }], commands: [...claude.filter((c: { name: string }) => !c.name.startsWith('laki:')), { name: '$sql', sub: 'Write SQL', skill: true }] })
  assert.deepEqual(rows.map(r => [r.label, r.value]), [['/spec', 'Write a spec'], ['/front:test', '/front:test'], ['/pdf', '/pdf'], ['/ship-it', '/ship-it'], ['$sql', '$sql']])
  assert.equal(rows[2].sub, 'skill · Read and fill PDFs')
})

test('laki plan: list, read, new and write specs and brainstorms from a tab', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  let r = await rig.cli('plan', 'new', p.id, 'spec', 'CSV export', '## Goal\nRows as CSV', '--json')
  assert.equal(r.code, 0, r.err)
  const spec = JSON.parse(r.out)
  assert.equal(readFileSync(join(spec.path, 'README.md'), 'utf8'), '# CSV export\n\n## Goal\nRows as CSV\n')
  assert.match((await rig.cli('plan', p.id)).out, new RegExp(`${p.id}  spec        csv-export  CSV export  `))
  r = await rig.cli('plan', 'write', p.id, 'spec', 'csv-export', 'notes.md', 'Edge cases: quotes')
  assert.equal(r.code, 0, r.err)
  r = await rig.cli('plan', 'read', p.id, 'spec', 'csv-export')
  assert.match(r.out, /## Goal\nRows as CSV[\s\S]*Files: notes\.md/)
  assert.equal((await rig.cli('plan', 'read', p.id, 'spec', 'csv-export', 'notes.md')).out.trim(), 'Edge cases: quotes')
  r = await rig.cli('plan', 'write', p.id, 'spec', 'csv-export', 'README.md', 'mine now')
  assert.notEqual(r.code, 0, 'never the user’s README.md')
  assert.match((await rig.cli('plan', 'read', p.id, 'idea', 'x')).err, /kind: spec or brainstorm, not idea/)
})
