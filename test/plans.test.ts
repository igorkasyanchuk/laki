import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { blocksToMarkdown, normalizeDiagram, readmeBody } from '../src/renderer/src/specmd.ts'
import { brainstormPrompt, PLAN_CHAT_IDLE, PLAN_TEMPLATES, planChat, planTemplates, specPrompt } from '../src/shared/plans.ts'
import { fresh } from './helpers.ts'

test('specs and brainstorms: off until turned on, folders outside the repo, the editor’s save, files, agents’ output', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('planList', {}), /off: turn them on in Settings › General › Experimental/)
  await rig.rpc('settingsSet', { specs: true })
  assert.deepEqual(await rig.rpc('planList', {}), [])

  // a new one: README.md with its title, a template's text under it (none: empty), in <data>/plans/<project>
  const s = await rig.rpc('planNew', { project: p.id, kind: 'spec', title: 'Export as CSV!', text: PLAN_TEMPLATES[0].text })
  assert.equal(s.slug, 'export-as-csv')
  assert.equal(s.path, join(rig.data, 'plans', p.id, 'specs', 'export-as-csv'))
  assert.match(readFileSync(join(s.path, 'README.md'), 'utf8'), /^# Export as CSV!\n\n## Goal\n[\s\S]*- \[ \] /)
  assert.equal(readFileSync(join((await rig.rpc('planNew', { project: p.id, kind: 'spec', title: 'Blank' })).path, 'README.md'), 'utf8'), '# Blank\n\n', 'no template: empty')
  assert.equal((await rig.rpc('planNew', { project: p.id, kind: 'spec', title: 'Export as CSV' })).slug, 'export-as-csv-2', 'never a folder that’s there')
  const b = await rig.rpc('planNew', { project: p.id, kind: 'brainstorm', title: 'Login ideas', text: 'Magic links?' })
  assert.equal(readFileSync(join(b.path, 'README.md'), 'utf8'), '# Login ideas\n\nMagic links?\n')
  assert.equal((await rig.rpc('state')).projects[0].plans, join(rig.data, 'plans', p.id), 'the project keeps its folder')

  // no doc yet: the editor loads README.md
  let g = await rig.rpc('planGet', { project: p.id, kind: 'spec', slug: s.slug })
  assert.equal(g.doc, null)
  assert.equal(g.outside, true)
  assert.match(g.markdown, /## Goal/)

  // the editor's save: spec.json and README.md from its Markdown; a newer README.md (an agent's edit) wins again
  await rig.rpc('planSave', { project: p.id, kind: 'spec', slug: s.slug, title: 'CSV export', blocks: [{ type: 'paragraph' }], markdown: 'Rows as CSV.' })
  g = await rig.rpc('planGet', { project: p.id, kind: 'spec', slug: s.slug })
  assert.deepEqual(g.doc, { title: 'CSV export', blocks: [{ type: 'paragraph' }] })
  assert.equal(g.outside, false)
  assert.equal(g.plan.title, 'CSV export')
  assert.equal(readFileSync(join(s.path, 'README.md'), 'utf8'), '# CSV export\n\nRows as CSV.\n')
  const later = new Date(Date.now() + 5000)
  utimesSync(join(s.path, 'README.md'), later, later)
  assert.equal((await rig.rpc('planGet', { project: p.id, kind: 'spec', slug: s.slug })).outside, true)

  // a pasted image goes to files/, read back as a data URL
  const up = await rig.rpc('planUpload', { project: p.id, kind: 'spec', slug: s.slug, name: '../../shot one.png', data: Buffer.from('png!').toString('base64') })
  assert.match(up.path, /^files\/\w+-shot-one\.png$/)
  assert.equal((await rig.rpc('planFile', { project: p.id, kind: 'spec', slug: s.slug, path: up.path })).image, `data:image/png;base64,${Buffer.from('png!').toString('base64')}`)

  // an agent's output: text files beside the brief, never the editor's own, never outside the folder
  const w = { project: p.id, kind: 'brainstorm', slug: b.slug }
  await rig.rpc('planWrite', { ...w, path: 'ideas.md', text: '# Ideas\n```mermaid\nmindmap\n  root\n```\n' })
  await rig.rpc('planWrite', { ...w, path: 'prototype-cards.html', text: '<!doctype html><script>document.title="x"</script><p>cards</p>' })
  await assert.rejects(rig.rpc('planWrite', { ...w, path: 'README.md', text: 'x' }), /the user's/)
  await assert.rejects(rig.rpc('planWrite', { ...w, path: 'spec.json', text: '{}' }), /the user's/)
  await assert.rejects(rig.rpc('planWrite', { ...w, path: './README.md', text: 'x' }), /the user's/)
  await assert.rejects(rig.rpc('planWrite', { ...w, path: 'files/../spec.json', text: '{}' }), /the user's/)
  await assert.rejects(rig.rpc('planWrite', { ...w, path: '.chat.json', text: '{}' }), /the user's/, 'nor its chat')
  await assert.rejects(rig.rpc('planWrite', { ...w, path: 'run.sh', text: 'x' }), /only \.md/)
  await assert.rejects(rig.rpc('planWrite', { ...w, path: '../../x.md', text: 'x' }), /not a path in/)
  mkdirSync(join(rig.home, 'elsewhere'))
  symlinkSync(join(rig.home, 'elsewhere'), join(b.path, 'out'))
  await assert.rejects(rig.rpc('planWrite', { ...w, path: 'out/x.md', text: 'x' }), /not a path in/, 'not through a link either')
  await assert.rejects(rig.rpc('planFile', { ...w, path: '/etc/hosts' }), /not a path in/)
  await assert.rejects(rig.rpc('planGet', { ...w, slug: '../specs' }), /not a spec's name/)
  await assert.rejects(rig.rpc('planGet', { ...w, kind: 'task' }), /kind: spec or brainstorm/)
  g = await rig.rpc('planGet', w)
  assert.deepEqual(g.files.map((f: any) => f.path).sort(), ['ideas.md', 'prototype-cards.html'])

  // the list: newest first, files counted (the editor's own not)
  const list = await rig.rpc('planList', { project: p.id })
  assert.deepEqual(list.map((x: any) => x.slug).sort(), ['blank', 'export-as-csv', 'export-as-csv-2', 'login-ideas'])
  assert.equal(list.find((x: any) => x.slug === 'login-ideas').files, 2)

  // a prototype's page: the key, then its own CSP (sandboxed, no requests out)
  const { port } = rig.info()
  const { key: widgetKey } = await rig.rpc('planGet', { project: p.id, kind: 'brainstorm', slug: b.slug }) // this plan's key
  const url = `http://127.0.0.1:${port}/plan/${p.id}/brainstorm/${b.slug}/prototype-cards.html`
  assert.equal((await fetch(url)).status, 401)
  const other = (await rig.rpc('planGet', { project: p.id, kind: 'spec', slug: s.slug })).key
  assert.equal((await fetch(`${url}?key=${other}`)).status, 401) // another plan's key
  const res = await fetch(`${url}?key=${widgetKey}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy')!, /^sandbox allow-scripts; default-src 'none'/)
  assert.match(await res.text(), /<p>cards<\/p>/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/plan/${p.id}/brainstorm/${b.slug}/..%2f..%2fspecs%2fexport-as-csv%2fREADME.html?key=${widgetKey}`)).status, 404)

  // Delete: the folder goes
  await rig.rpc('planRm', w)
  assert.equal(existsSync(b.path), false)
  await assert.rejects(rig.rpc('planGet', w), /no brainstorm login-ideas/)

  // off again: nothing answers, the page neither
  await rig.rpc('settingsSet', { specs: false })
  await assert.rejects(rig.rpc('planGet', { project: p.id, kind: 'spec', slug: s.slug }), /off/)
  writeFileSync(join(s.path, 'p.html'), '<p>x</p>')
  assert.equal((await fetch(`http://127.0.0.1:${port}/plan/${p.id}/spec/${s.slug}/p.html?key=${other}`)).status, 404)
})

test('specs over MCP: list, read, new and write; the prompts name the folder', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { specs: true })
  const call = (id: number, name: string, args: object) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  const msgs = [
    call(1, 'laki_plan_new', { project: p.id, kind: 'brainstorm', title: 'Dark mode', text: 'Should it follow the OS?' }),
    call(2, 'laki_plan_write', { project: p.id, kind: 'brainstorm', slug: 'dark-mode', path: 'ideas.md', text: '# Two ways' }),
    call(3, 'laki_plans', {}),
    call(4, 'laki_plan_read', { project: p.id, kind: 'brainstorm', slug: 'dark-mode' }),
    call(5, 'laki_plan_write', { project: p.id, kind: 'brainstorm', slug: 'dark-mode', path: 'README.md', text: 'x' }),
    call(6, 'laki_plan_read', { project: p.id, kind: 'brainstorm', slug: 'dark-mode', file: 'ideas.md' }),
    call(7, 'laki_plan_read', { project: p.id, kind: 'brainstorm', slug: 'dark-mode', file: '../../x' }),
  ]
  const r = await rig.cliIn(msgs.map(m => JSON.stringify(m)).join('\n') + '\n', 'mcp')
  const got = Object.fromEntries(r.out.trim().split('\n').map(l => JSON.parse(l)).map(m => [m.id, m]))
  const text = (n: number) => got[n].result.content[0].text
  assert.ok(!got[1].result.isError && !got[2].result.isError, text(1) + text(2))
  assert.equal(JSON.parse(text(3))[0].title, 'Dark mode')
  const read = JSON.parse(text(4))
  assert.match(read.readme, /Should it follow the OS\?/)
  assert.deepEqual(read.files, ['ideas.md (10 bytes)'])
  assert.equal(got[5].result.isError, true)
  assert.equal(text(6), '# Two ways') // one of its files, read
  assert.equal(got[7].result.isError, true, 'nothing outside its folder')
  const plan = JSON.parse(text(3))[0]
  assert.match(specPrompt(plan), new RegExp(`${plan.path}/README\\.md`))
  assert.match(brainstormPrompt(plan), /laki_plan_read \(project \S+, kind brainstorm, slug dark-mode\)/)
})

test('templates: Laki’s two unless set; only whole ones from settings', () => {
  assert.equal(planTemplates({}), PLAN_TEMPLATES)
  assert.deepEqual(planTemplates({ planTemplates: [{ name: 'x' }, { name: 'Bug', kind: 'spec', text: '## Steps' }, { name: 'y', kind: 'task', text: '' }, null] as any }), [{ name: 'Bug', kind: 'spec', text: '## Steps' }])
  assert.deepEqual(planTemplates({ planTemplates: [] }), [], 'all removed: none')
})

test('a spec’s blocks as README.md, and back', () => {
  const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles })
  const md = blocksToMarkdown([
    { type: 'heading', props: { level: 1 }, content: [text('Goal')] },
    { type: 'paragraph', content: [text('Rows as '), text('CSV', { bold: true }), text(', see '), { type: 'link', href: 'https://x.dev', content: [text('docs')] }] },
    { type: 'checkListItem', props: { checked: true }, content: [text('export')] },
    { type: 'checkListItem', props: { checked: false }, content: [text('import')], children: [{ type: 'bulletListItem', content: [text('later')] }] },
    { type: 'image', props: { url: 'files/a.png', caption: 'shot' } },
    { type: 'diagram', props: { data: JSON.stringify({ kind: 'flowchart', nodes: [{ id: 'a', shape: 'process', label: 'Cart' }, { id: 'b', shape: 'process', label: 'Pay' }], edges: [{ from: 'a', to: 'b', label: 'go', dashed: true }] }), png: 'files/d.png' } },
    { type: 'codeBlock', props: { language: 'sh' }, content: [text('## not a heading')] },
  ])
  assert.equal(
    md,
    '## Goal\n\nRows as **CSV**, see [docs](https://x.dev)\n\n- [x] export\n- [ ] import\n  - later\n\n![shot](files/a.png)\n\n```text\nDiagram type: flowchart\nNodes:\n- [process] Cart\n- [process] Pay\nEdges:\n- Cart --> Pay : go\n```\n\n![Diagram](files/d.png)\n\n```sh\n## not a heading\n```',
  )
  // README.md back: the title out, headings up a level, code left as it is
  assert.equal(readmeBody(`# CSV export\n\n${md}`).split('\n')[0], '# Goal')
  assert.match(readmeBody(`# T\n\n${md}`), /```sh\n## not a heading\n```/)
  // an agent's diagram file: only what draws
  assert.equal(normalizeDiagram({ nodes: 'x' }), null)
  const d = normalizeDiagram({ kind: 'state', nodes: [{ label: 'a', fill: 'url(x)', x: 'no' }, { id: 'n0' }, 7], edges: [{ from: 'n0' }, { from: 'n0', to: 'n1', fromSide: 'z' }] })!
  assert.deepEqual(d.nodes.map(n => n.id), ['n1', 'n0'])
  assert.equal(d.nodes[0].fill, undefined)
  assert.equal(d.nodes[0].x, undefined)
  assert.deepEqual(d.edges, [{ id: undefined, from: 'n0', to: 'n1', label: undefined, dashed: undefined, accent: undefined, fromSide: undefined, toSide: undefined }])
})

test('Brainstorm with Laki AI: a chat of its own, in its folder; its ideas land there; 12 hours unused ends it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { specs: true, ai: { on: true, backend: 'claude' } })
  const b = await rig.rpc('planNew', { project: p.id, kind: 'brainstorm', title: 'Dark mode', text: 'Should it follow the OS?' })
  const chat = planChat(b)
  const r = await rig.rpc('aiAsk', { text: brainstormPrompt(b), chat })
  assert.match(JSON.stringify(r), /wrote ideas\.md/)
  assert.equal(readFileSync(join(b.path, 'ideas.md'), 'utf8'), '# Two options')
  // its own conversation, kept in the brainstorm's folder (hidden from its files); the AI page's has none of it
  let st = await rig.rpc('aiState', { chat })
  assert.deepEqual(st.chat.map((m: any) => m.role), ['user', 'ai'])
  assert.equal((await rig.rpc('aiState', {})).chat.length, 0)
  assert.equal(JSON.parse(readFileSync(join(b.path, '.chat.json'), 'utf8')).chat.length, 2)
  assert.deepEqual((await rig.rpc('planGet', { project: p.id, kind: 'brainstorm', slug: b.slug })).files.map((f: any) => f.path), ['ideas.md'])
  // the claude session goes on in the next ask (--resume)
  await rig.rpc('aiAsk', { text: 'one more', chat })
  const log = () => readFileSync(join(rig.home, 'fake.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter((l: any) => l.bin === 'claude' && l.args[0] === '-p')
  assert.ok(log().at(-1).args.includes('--resume'))
  assert.ok(log().at(-1).args.some((a: string) => a.includes(`slug ${b.slug}`)), 'its instructions name the brainstorm')
  // and hold its brief as it is now, and its files: an ask that doesn't name it is about it
  writeFileSync(join(b.path, 'README.md'), '# Dark mode\n\nShould it follow the OS? Only on macOS.\n')
  await rig.rpc('aiAsk', { text: 'what do you think?', chat })
  const told = log().at(-1).args.find((a: string) => a.includes('This chat is about'))
  assert.match(told, /"Dark mode"[^]*<readme>\n# Dark mode\n\nShould it follow the OS\? Only on macOS\.\n<\/readme>\nFiles in its folder: ideas\.md\./)
  // 12 hours unused: it ends, kept as ended; Continue takes it up again; else the next ask starts a new chat
  await rig.rpc('aiTick', { now: Date.now() + PLAN_CHAT_IDLE + 60000 })
  st = await rig.rpc('aiState', { chat })
  assert.ok(st.ended)
  assert.ok(st.chat.some((m: any) => m.text === 'one more'), 'what was said stays to read')
  assert.ok(JSON.parse(readFileSync(join(b.path, '.chat.json'), 'utf8')).ended)
  await rig.rpc('aiContinue', { chat })
  assert.equal((await rig.rpc('aiState', { chat })).ended, undefined)
  await rig.rpc('aiTick', { now: Date.now() + PLAN_CHAT_IDLE + 60000 })
  await rig.rpc('aiAsk', { text: 'start over', chat })
  st = await rig.rpc('aiState', { chat })
  assert.equal(st.chat[0].text, 'start over')
  assert.ok(!st.chat.some((m: any) => m.text === 'one more'), 'a new chat, empty but for the new ask')
  assert.ok(!log().at(-1).args.includes('--resume'), 'a new chat: a new session')
  // a question left in an ended chat: its pick would start a new chat without it, so it's refused
  const b2 = await rig.rpc('planNew', { project: p.id, kind: 'brainstorm', title: 'Old question' })
  writeFileSync(join(b2.path, '.chat.json'), JSON.stringify({ chat: [{ role: 'ai', text: 'A or B?', at: 1, ask: { id: 'q1', options: ['A', 'B'] } }], at: 1 }))
  await assert.rejects(rig.rpc('aiAnswer', { id: 'q1', n: 0, chat: planChat(b2) }), /this chat ended/)
  assert.ok((await rig.rpc('aiState', { chat: planChat(b2) })).ended, 'ended as it was read: 12 hours past its last message')
  // deleted: its chat with it
  await rig.rpc('planRm', { project: p.id, kind: 'brainstorm', slug: b.slug })
  await assert.rejects(rig.rpc('aiState', { chat }), /no brainstorm dark-mode/)
})
