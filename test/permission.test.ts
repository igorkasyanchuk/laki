// claude's permission asks (PermissionRequest): what the tool touches and the rule its menu offers, in the tab's ask,
// the hook printing nothing, the phone's push with secrets masked; permOf's words per tool
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { alwaysOf, diffCounts, lineDiff, optLabel, permDiff, permOf, permVerb } from '../src/shared/ask.ts'
import { fresh, until } from './helpers.ts'
import { priorOf } from '../src/shared/conn.ts'

const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `permission-${name}.json`), 'utf8'))

test('permOf: each tool in a line, cut at 300; the first rule or folder suggestion made readable', () => {
  assert.deepEqual(permOf(fx('bash')), { tool: 'Bash', what: 'npm init -y', rule: 'npm init' })
  assert.deepEqual(permOf(fx('webfetch')), { tool: 'WebFetch', what: 'https://example.com', rule: 'example.com' })
  const edit = fx('edit')
  assert.deepEqual(permOf(edit, '/Users/me/projects/demo'), { tool: 'Edit', what: 'notes.txt', diff: '-hello\n+hello world' }) // in the worktree: from its folder; setMode isn't a rule; its change
  assert.equal(permOf(edit, '/elsewhere', '/Users/me')!.what, '~/projects/demo/notes.txt')
  assert.deepEqual(permOf(fx('bash-dir'), undefined, '/Users/me'), { tool: 'Bash', what: 'touch probe.txt', rule: '~/projects/demo' })
  assert.equal(permOf({ tool_name: 'Bash', tool_input: { command: 'cd x\nnpm test' } })!.what, 'cd x ↵ npm test')
  const long = permOf({ tool_name: 'Bash', tool_input: { command: `echo ${'x'.repeat(2048)}` } })!.what
  assert.equal(long.length, 300)
  assert.ok(long.endsWith('…'))
  assert.deepEqual(permOf({ tool_name: 'mcp__github__create_issue', tool_input: { title: 'Bug' } }), { tool: 'github', what: 'github: create_issue {"title":"Bug"}' })
  assert.equal(permOf({ tool_name: 'WebSearch', tool_input: { query: 'laki app' } })!.what, 'laki app')
  assert.equal(permOf({ tool_name: 'Grep', tool_input: { pattern: 'TODO' } })!.what, 'TODO')
  assert.equal(permOf({ tool_name: 'Bash', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }] }] })!.rule, 'npm test')
  assert.equal(permOf({}), undefined)
  assert.equal(permVerb('Bash'), 'wants to run')
  assert.equal(permVerb('github'), 'wants to use github')
  const ask = { options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'Yes, and don’t ask again for: npm init *' }, { n: 3, label: 'No' }], at: 1 }
  assert.equal(alwaysOf(ask)?.n, 2)
  assert.equal(alwaysOf({ options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], at: 1 }), undefined)
  assert.deepEqual(ask.options.map(o => optLabel({ ...ask, rule: 'npm init' }, o)), ['Yes', "Yes, don't ask again for npm init", 'No'])
  assert.equal(optLabel(ask, ask.options[1]), ask.options[1].label) // no rule: as it reads
})

test('permDiff: an Edit, MultiEdit or Write as lines kept, gone and new; capped; none without a change', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [' a', '-b', '+B', ' c', '+d'])
  assert.deepEqual(lineDiff('', 'x'), ['+x'])
  assert.equal(permDiff('Edit', { old_string: 'same', new_string: 'same' }), undefined)
  assert.equal(permDiff('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: '' }] }), '-a\n+b\n…\n-c')
  assert.equal(permDiff('Write', { content: 'one\ntwo' }, ''), '+one\n+two') // a new file
  assert.equal(permDiff('Write', { content: 'one\ntwo' }, 'one'), ' one\n+two')
  assert.equal(permDiff('Write', { content: 'secret' }, null), undefined) // out of its workspace: not shown
  assert.equal(permDiff('Write', { content: 'x' }), undefined)
  assert.equal(permDiff('Bash', { command: 'ls' }), undefined)
  const big = permDiff('Write', { content: Array.from({ length: 250 }, (_, i) => `l${i}${'y'.repeat(i === 0 ? 400 : 0)}`).join('\n') }, '')!.split('\n')
  assert.equal(big.length, 201)
  assert.equal(big[0].length, 300)
  assert.equal(big.at(-1), '…50 more lines (+50 −0)')
  assert.deepEqual(diffCounts(big.join('\n')), { add: 250, del: 0 }, 'the cut lines counted too')
  const wide = permDiff('Write', { content: Array.from({ length: 100 }, () => 'z'.repeat(299)).join('\n') }, '')!.split('\n')
  assert.equal(wide.length, 40, '12,000 characters at most (39 lines of 301), then the rest counted')
  assert.equal(wide.at(-1), '…61 more lines (+61 −0)')
  assert.equal(lineDiff('a\n'.repeat(400), 'b\n'.repeat(400)).length, 802) // past the LCS cap: all out, all in
})

test("priorOf: a Write's file as it is, only a plain one in its workspace; a new one ''", () => {
  const root = mkdtempSync(join(tmpdir(), 'laki-prior-'))
  const out = mkdtempSync(join(tmpdir(), 'laki-out-'))
  writeFileSync(join(root, 'a.ts'), 'one\n')
  writeFileSync(join(out, 'secret'), 'token')
  symlinkSync(join(out, 'secret'), join(root, 'link'))
  const w = (file_path: unknown) => ({ tool_name: 'Write', tool_input: { file_path, content: 'x' } })
  assert.equal(priorOf(w(join(root, 'a.ts')), { path: root }), 'one\n')
  assert.equal(priorOf(w(join(root, 'new.ts')), { path: root }), '', 'not there yet: new')
  assert.equal(priorOf(w(join(out, 'secret')), { path: root }), null, 'out of its workspace')
  assert.equal(priorOf(w(join(root, 'link')), { path: root }), null, 'a link out of it')
  assert.equal(priorOf(w(root), { path: root }), null, 'a folder')
  assert.equal(priorOf(w(join(root, 'a.ts')), { path: root, host: 'devbox' }), null, "a host's: not this Mac's file")
  assert.equal(priorOf(w('a.ts'), { path: root }), null, 'a relative path')
  assert.equal(priorOf(w(join(root, 'a.ts'))), null, 'no workspace')
  assert.equal(priorOf({ tool_name: 'Edit', tool_input: { file_path: join(root, 'a.ts') } }, { path: root }), undefined)
})

test('a PermissionRequest: the ask names the tool, what and rule; laki hook prints nothing; the next turn clears them', async t => {
  const rig = await fresh(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  const settings = JSON.parse(readFileSync(join(rig.data, 'claude-settings.json'), 'utf8'))
  assert.equal(settings.hooks.PermissionRequest[0].matcher, '*')
  assert.ok(JSON.parse(readFileSync(join(rig.data, 'claude-settings-fast.json'), 'utf8')).hooks.PermissionRequest)
  // the hook command as claude runs it: nothing printed (claude then shows its own menu)
  const out = execSync(settings.hooks.PermissionRequest[0].hooks[0].command, { input: JSON.stringify(fx('bash')), env: { ...process.env, LAKI_HOME: rig.data, LAKI_TAB: tab.id }, encoding: 'utf8' })
  assert.equal(out, '')
  await rig.rpc('send', { target: tab.id, text: 'perm bash' })
  const asks = await until(async () => {
    const t = await rig.tab(ws.id)
    return t.status === 'waiting' && t.ask?.tool ? t.ask : undefined
  }, 'the ask with its tool')
  assert.equal(asks.tool, 'Bash')
  assert.equal(asks.what, 'npm init -y')
  assert.equal(asks.rule, 'npm init')
  assert.equal(alwaysOf(asks)?.label, 'Yes, and don’t ask again for: npm init *')
  await rig.rpc('answer', { tab: tab.id, n: 2, label: 'Yes, and don’t ask again for: npm init *' })
  await until(async () => /picked: Yes, and don’t ask again/.test(await rig.screen(tab.id)), 'picked the always option')
  // a plain menu (Notification only) after: no tool from the last ask
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const plain = await until(async () => {
    const t = await rig.tab(ws.id)
    return t.status === 'waiting' && t.ask ? t.ask : undefined
  }, 'the plain menu')
  assert.equal(plain.tool, undefined)
  assert.equal(plain.what, undefined)
})

test("a PermissionRequest's phone push: the command in the body, a token in it masked; titles only: no command", async t => {
  const posts: string[] = []
  const server = createServer((req, res) => {
    let b = ''
    req.on('data', d => (b += d)).on('end', () => (posts.push(b), res.end('{}')))
  }).listen(0)
  t.after(() => server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, format: 'ntfy' } })
  await rig.rpc('send', { target: tab.id, text: 'perm bash :: curl -H "Authorization: Bearer abcdefghijklmnop0123456789" https://api.example.com' })
  const body = await until(() => posts[0], 'the push')
  assert.match(body, /^Bash: curl -H "Authorization: Bearer ••••" https:\/\/api\.example\.com/)
  assert.doesNotMatch(body, /abcdefghijklmnop/)
  await rig.rpc('answer', { tab: tab.id, n: 3, label: 'No' })
  await until(async () => (await rig.tab(ws.id)).status !== 'waiting', 'answered')
  await rig.rpc('send', { target: tab.id, text: 'hello' }) // a turn between: the next wait pushes again
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'its turn ended')
  await rig.rpc('settingsSet', { webhook: { url, format: 'ntfy', detail: 'titles' } })
  await rig.rpc('send', { target: tab.id, text: 'perm bash' })
  const second = await until(() => posts[1], 'the second push')
  assert.doesNotMatch(second, /npm init/)
})
