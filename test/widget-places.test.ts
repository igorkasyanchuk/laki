// Extensions where you work (Part C): an action's menu fields (title, show, match, key, ask, confirm, insert, view),
// widgetAction's ctx (a workspace, a tab, a file of it), the panel and row places
import { strict as assert } from 'node:assert'
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { actionMenu, globMatch, manifestCheck, normKey, pressOf } from '../src/shared/widgetSchema.ts'
import { fresh, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const find = async (rig: any, id: string) => (await rig.rpc('state')).widgets?.find((w: any) => w.id === id)

test('an action offered where you work: its fields read, checked, a key and a glob as Laki takes them', () => {
  assert.deepEqual(actionMenu('explain-file', { run: 'x', show: ['file', 'palette', 'nope'], match: ['*.ts'], key: 'cmd+alt+e', ask: 'Focus on?', insert: true }), { title: 'Explain file', show: ['file', 'palette'], match: ['*.ts'], key: 'Alt+Cmd+E', ask: 'Focus on?', insert: true })
  assert.equal(actionMenu('a', 'echo hi'), undefined, 'a plain command: only its buttons')
  assert.equal(actionMenu('a', { run: 'x', title: 'A' }), undefined, 'no show, no key: nowhere')
  assert.equal(normKey('Shift+E'), undefined, 'Cmd, Ctrl or Alt needed')
  assert.equal(normKey('Ctrl+Cmd+K+J'), undefined, 'one key')
  assert.equal(pressOf({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, key: '´', code: 'KeyE' }), 'Alt+Cmd+E', 'Alt+E types ´ on a Mac: by its place')
  assert.equal(pressOf({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, key: '≤', code: 'Comma' }), normKey('Alt+Cmd+,'), 'punctuation by its place too')
  assert.equal(pressOf({ metaKey: false, ctrlKey: true, altKey: true, shiftKey: false, key: '\u00a0', code: 'Space' }), normKey('Ctrl+Alt+Space'))
  assert.ok(globMatch('*.ts', 'src/a.ts') && !globMatch('*.ts', 'src/a.tsx') && globMatch('docs/**/*.md', 'docs/a/b.md') && globMatch('docs/**/*.md', 'docs/b.md') && !globMatch('src/*.ts', 'src/x/a.ts'))
  const ps = manifestCheck({ name: 'M', fetch: 'echo {}', sample: {}, place: 'row', actions: { a: { run: 'x', show: ['files'], key: 'E', match: '*.ts', insert: 'yes', tilte: 'A' }, b: { ai: 'Explain {{file.path}}', show: ['file'], match: ['*.md'], view: true } } })
  const has = (level: string, where: string, text: RegExp) => assert.ok(ps.some(p => p.level === level && p.where === where && text.test(p.text)), `${level} ${where} ${text} in ${JSON.stringify(ps, null, 1)}`)
  has('error', 'widget.json actions.a.show', /"files": one of palette, workspace, tab, file, prompt \(did you mean file\?\)/)
  has('error', 'widget.json actions.a.key', /Cmd, Ctrl or Alt/)
  has('error', 'widget.json actions.a.match', /a list of globs/)
  has('error', 'widget.json actions.a.insert', /true or false/)
  has('warn', 'widget.json actions.a', /no key tilte \(did you mean title\?\)/)
  has('error', 'widget.json place', /row is a mark on each workspace’s row: it needs "scope": "workspace"/)
  assert.ok(!ps.some(p => p.where.startsWith('widget.json actions.b')), 'an AI action takes them too')
  assert.ok(manifestCheck({ name: 'K', actions: { a: { run: 'x', key: 'Cmd+E' } } }).some(p => p.level === 'warn' && /Cmd and Cmd\+Shift alone are Laki's own keys/.test(p.text)), "⌘E is Laki's")
  assert.ok(manifestCheck({ name: 'K', actions: { a: { run: 'x', key: 'Ctrl+E' } } }).some(p => p.level === 'warn' && /Ctrl alone is a terminal's/.test(p.text)), "⌃E is the terminal's")
  assert.ok(!manifestCheck({ name: 'K', actions: { a: { run: 'x', key: 'Ctrl+Alt+E' } } }).some(p => p.where.endsWith('.key')), 'with Alt: fine')
})

test("widgetAction's ctx: the workspace, tab and file it was picked on, checked; its insert; never an agent's", async t => {
  const rig = await fresh(t)
  make(rig, 'ex', {
    name: 'Explain',
    actions: {
      explain: { run: 'printf "%s|%s|%s|%s" "$LAKI_FILE" "$LAKI_TAB" "$LAKI_BRANCH" "$WIDGET_ARG"', title: 'Explain this file', show: ['file', 'palette'], match: ['*.ts'], key: 'Alt+Cmd+E', ask: 'Focus on?', insert: true },
      opener: { run: `printf '{"data": {"seen": "%s"}}' "$(basename "$LAKI_FILE")"`, show: ['file'], view: true },
      ctx: { run: 'printf "%s" "$LAKI_CTX"', show: ['tab'] },
    },
  })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'ex', on: true })
  const w = await find(rig, 'ex')
  assert.deepEqual(w.menus.map((m: any) => [m.action, m.title, m.show.join()]), [['explain', 'Explain this file', 'file,palette'], ['opener', 'Opener', 'file'], ['ctx', 'Ctx', 'tab']])
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const tab = await until(() => rig.tab(a.id), 'its tab')
  writeFileSync(join(a.path, 'a.ts'), 'x')
  const r = await rig.rpc('widgetAction', { id: 'ex', action: 'explain', arg: 'errors', ctx: { ws: a.id, tab: tab.id, file: 'a.ts' } })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.insert, `${join(a.path, 'a.ts')}|${tab.id}|${a.branch}|errors`, 'what it printed, for the prompt')
  const c = JSON.parse((await rig.rpc('widgetAction', { id: 'ex', action: 'ctx', ctx: { ws: a.id, tab: tab.id } })).out)
  assert.deepEqual([c.ws.id, c.ws.branch, c.tab.id, c.tab.agent], [a.id, a.branch, tab.id, 'claude'])
  // a file opener: its data kept, the app opens its full view
  await rig.rpc('widgetAction', { id: 'ex', action: 'opener', ctx: { ws: a.id, file: 'a.ts' } })
  assert.deepEqual(JSON.parse(readFileSync(join(rig.data, 'widget-data', 'ex.json'), 'utf8')).data, { seen: 'a.ts' })
  // checked: a file outside it, a tab of another, a workspace gone
  await assert.rejects(rig.rpc('widgetAction', { id: 'ex', action: 'explain', ctx: { ws: a.id, file: '../../etc/passwd' } }), /not a path inside the workspace/)
  await assert.rejects(rig.rpc('widgetAction', { id: 'ex', action: 'explain', ctx: { ws: 'nope' } }), /no workspace nope/)
  await assert.rejects(rig.rpc('widgetAction', { id: 'ex', action: 'explain', ctx: { tab: tab.id } }), /which workspace/)
  // an agent's call: no ctx (it has $LAKI_WORKSPACE); it's asked first, and no one is here to answer
  const ag = await rig.rpc('widgetAction', { id: 'ex', action: 'ctx', ctx: { ws: a.id, file: 'a.ts' }, from: { ws: a.id, tab: tab.id } })
  assert.equal(ag.ok, false)
})

test('row: a per-workspace one fetches every live workspace’s instance, not only the one on screen; a global one is refused', async t => {
  const rig = await fresh(t)
  make(rig, 'mark', { name: 'Mark', scope: 'workspace', place: 'row', badge: '{{n}}', fetch: 'printf \'{"n": "%s"}\' "$LAKI_WORKSPACE_NAME"', sample: { n: 'x' } })
  make(rig, 'glob', { name: 'Glob', fetch: 'echo {}', sample: {} })
  await rig.rpc('widgetReload')
  await assert.rejects(rig.rpc('widgetSet', { id: 'glob', place: ['side', 'row'] }), /a row's mark is per workspace/)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  await rig.rpc('widgetSet', { id: 'mark', on: true })
  const w = await until(async () => (x => x?.inst?.[a.id]?.badge && x?.inst?.[b.id]?.badge && x)(await find(rig, 'mark')), 'both rows have a mark')
  assert.deepEqual([w.inst[a.id].badge, w.inst[b.id].badge], ['one', 'two'])
})

// #25: a file action on an artifact: the file inside the workspace's storage folder, by the same inside check
test('#25: an action on an artifact gets its path in the storage folder; one out of it is refused', async t => {
  const rig = await fresh(t)
  make(rig, 'art', { name: 'Art', actions: { see: { run: 'printf "%s" "$LAKI_FILE"', show: ['file'], insert: true } } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'art', on: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const ws = await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === a.id && w.storage), 'its storage folder')
  writeFileSync(join(ws.storage, 'report.md'), '# hi')
  const r = await rig.rpc('widgetAction', { id: 'art', action: 'see', ctx: { ws: a.id, file: 'report.md', storage: true } })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.insert, join(ws.storage, 'report.md'))
  await assert.rejects(rig.rpc('widgetAction', { id: 'art', action: 'see', ctx: { ws: a.id, file: '../x.md', storage: true } }), /not a path inside/)
})

// #22: a row mark's tone is its instance data's own `tone`, one of the kit's; any other word is none
test("#22: a row mark takes its tone from its instance's data, only a kit tone", async t => {
  const rig = await fresh(t)
  make(rig, 'tone', { name: 'Tone', scope: 'workspace', place: 'row', badge: '{{n}}', fetch: 'n="$LAKI_WORKSPACE_NAME"; [ "$n" = one ] && t=bad || t=loud; printf \'{"n": "%s", "tone": "%s"}\' "$n" "$t"', sample: { n: 'x' } })
  await rig.rpc('widgetReload')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  await rig.rpc('widgetSet', { id: 'tone', on: true })
  const w = await until(async () => (x => x?.inst?.[a.id]?.badge && x?.inst?.[b.id]?.badge && x)(await find(rig, 'tone')), 'both rows have a mark')
  assert.equal(w.inst[a.id].tone, 'bad')
  assert.equal(w.inst[b.id].tone, undefined, 'loud is no tone of the kit')
})

// #26: an action's open (a link the app opens after it) and files (attached where an insert goes), both checked: a
// javascript: link and a path outside its workspace, storage or folder are dropped and said in its log
test("an action's open and files come back checked; a javascript: link and a path outside are dropped and logged", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  writeFileSync(join(a.path, 'a.txt'), 'notes')
  symlinkSync('/etc/hosts', join(a.path, 'out'))
  const ws = join(a.path, 'a.txt')
  const say = (o: object) => `cat <<'EOF'\n${JSON.stringify(o)}\nEOF`
  make(rig, 'outs', {
    name: 'Outs',
    actions: {
      give: { run: say({ open: 'https://example.com/pr/1', files: [ws, 'shot.png', '../../../../etc/passwd', join(a.path, 'out'), 5] }), show: ['palette'] },
      bad: { run: say({ open: 'javascript:alert(1)', files: 'a.txt' }), show: ['palette'] },
      link: { run: say({ open: 'laki://settings' }), show: ['palette'] },
    },
  })
  writeFileSync(join(rig.data, 'widgets', 'outs', 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64'))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'outs', on: true, log: true })
  const r = await rig.rpc('widgetAction', { id: 'outs', action: 'give', ctx: { ws: a.id } })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.open, 'https://example.com/pr/1')
  assert.deepEqual(r.files.map((f: any) => [f.path.startsWith(join(rig.data, 'images')) ? 'images' : f.path, f.image ?? false, f.size]), [[realpathSync(ws), false, 5], ['images', true, 70]])
  assert.equal((await rig.rpc('widgetAction', { id: 'outs', action: 'link', ctx: { ws: a.id } })).open, 'laki://settings')
  const b = await rig.rpc('widgetAction', { id: 'outs', action: 'bad', ctx: { ws: a.id } })
  assert.deepEqual([b.ok, b.open, b.files], [true, undefined, undefined])
  const logs = await until(async () => (l => l.some((x: string) => x.includes('open refused')) && l)((await rig.rpc('widgetLogs', { id: 'outs' })).lines.map((x: any) => x.text)), 'said in its log')
  assert.ok(logs.some((x: string) => x === 'action bad: open refused, not an http(s), mailto or laki:// link: javascript:alert(1)'), logs.join('\n'))
  assert.ok(logs.some((x: string) => x.includes('action give: files refused') && x.includes('../../../../etc/passwd') && x.includes(join(a.path, 'out')) && x.endsWith(', 5')), logs.join('\n'))
  assert.ok(logs.some((x: string) => x.includes('action bad: files refused') && x.endsWith('"a.txt"')), logs.join('\n'))
})
