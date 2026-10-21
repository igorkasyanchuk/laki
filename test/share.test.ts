// Shared tabs (core.ts' shareStart, daemon/share.ts): a tab as a read-only page at a quick tunnel's /s/<uuid>, an agent's
// chat from its transcript (claude's, codex's) or the terminal's text; kept up to date; its own server, never the API.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { chatOf, redact, shareBody, shareMd } from '../src/daemon/share.ts'
import { fresh, until } from './helpers.ts'

const line = (o: object) => `${JSON.stringify(o)}\n`
const claudeSays = (type: 'user' | 'assistant', content: unknown, more = {}) => line({ type, message: { role: type, content }, ...more })

test('share: transcripts as what was said, Markdown, the page escaped', () => {
  const claude =
    claudeSays('user', 'add <b>CSV</b> export') +
    claudeSays('user', '<command-name>/clear</command-name>') +
    claudeSays('user', 'meta', { isMeta: true }) +
    claudeSays('assistant', [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'On it: [docs](javascript:alert(1)) and [site](https://x.dev)' }]) +
    claudeSays('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }]) +
    claudeSays('assistant', [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/a.ts' } }]) +
    claudeSays('user', [{ type: 'tool_result', content: 'ok' }]) +
    claudeSays('assistant', [{ type: 'text', text: 'side' }], { isSidechain: true }) +
    claudeSays('assistant', [{ type: 'text', text: 'Done.' }]) +
    'not json\n'
  const said = chatOf('claude', claude)
  assert.deepEqual(said, [
    { who: 'you', text: 'add <b>CSV</b> export' },
    { who: 'agent', text: 'On it: [docs](javascript:alert(1)) and [site](https://x.dev)' },
    { who: 'tool', text: 'Bash: npm test\nRead: /r/a.ts' },
    { who: 'agent', text: 'Done.' },
  ])
  const codex =
    line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } }) +
    line({ type: 'event_msg', payload: { type: 'user_message', message: 'fix it' } }) +
    line({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","npm test"]}' } }) +
    line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: a.ts\n@@\n*** Add File: b.ts\n*** End Patch' } }) +
    line({ type: 'event_msg', payload: { type: 'agent_message', message: 'Fixed.' } })
  assert.deepEqual(chatOf('codex', codex), [
    { who: 'you', text: 'fix it' },
    { who: 'tool', text: 'shell: bash -lc npm test\napply_patch: a.ts, b.ts' },
    { who: 'agent', text: 'Fixed.' },
  ])
  // read in parts: a chat goes on where the last part left it
  const parts = chatOf('claude', claudeSays('assistant', [{ type: 'text', text: 'a' }]))
  chatOf('claude', claudeSays('assistant', [{ type: 'text', text: 'b' }]), parts)
  assert.deepEqual(parts, [{ who: 'agent', text: 'a\n\nb' }])

  assert.equal(shareMd('T', 'Claude Code', said), '# T\n\n**You**\n\nadd <b>CSV</b> export\n\n**Claude Code**\n\nOn it: [docs](javascript:alert(1)) and [site](https://x.dev)\n\n> ⚙ Bash: npm test  \n> ⚙ Read: /r/a.ts\n\n**Claude Code**\n\nDone.\n')
  assert.equal(shareMd('T', 'x', [{ who: 'screen', text: 'a ``` b' }]), '# T\n\n````\na ``` b\n````\n', 'a fence longer than any in it')
  const body = shareBody('Claude Code', said)
  assert.ok(!body.includes('<b>') && body.includes('add &#60;b&#62;CSV&#60;/b&#62; export'), 'what was said is text, never HTML')
  assert.ok(!body.includes('javascript:') && body.includes('<a href="https://x.dev" target="_blank" rel="noopener noreferrer nofollow">site</a>'), 'links: http(s) only')
  assert.match(body, /<details class="tools" open><summary>2 tool calls<\/summary><div>Bash: npm test<\/div><div>Read: \/r\/a.ts<\/div><\/details>/)
  assert.equal(shareBody('x', []), '<p class="empty">Nothing here yet.</p>')
})

test('share: token-shaped strings masked; a picture shown as its link (L9)', () => {
  const said = [
    'export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234',
    'gh auth token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
    'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwx" https://x.dev/api?token=s3cr3t&page=2',
    'AKIAIOSFODNN7EXAMPLE and xoxb-1234567890-abcdef and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijkl',
  ].join('\n')
  const out = redact(said)
  for (const s of ['sk-proj-abcdefghijklmnop1234', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'abcdefghijklmnopqrstuvwx', 's3cr3t', 'AKIAIOSFODNN7EXAMPLE', 'xoxb-1234567890-abcdef', 'eyJhbGciOiJIUzI1NiJ9']) assert.ok(!out.includes(s), s)
  assert.match(out, /Bearer ••••/)
  assert.match(out, /\?token=••••&page=2/)
  assert.equal(redact('git push origin main; npm test'), 'git push origin main; npm test') // plain words stay
  const body = shareBody('Claude', [{ who: 'agent', text: 'Look: ![the chart](https://evil.example/pixel.png)' }])
  assert.doesNotMatch(body, /<img/)
  assert.match(body, /<a href="https:\/\/evil\.example\/pixel\.png"[^>]*>the chart<\/a>/)
})

test('share: a tab read-only at its link, kept up to date; the API out of its reach; stopped with the tab', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  await assert.rejects(rig.rpc('shareStart', { tab: tab.id }), /cloudflared isn't installed: brew install cloudflared/)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  // its transcript, where claude keeps it ($HOME/.claude: the rig's)
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${tab.resumeId}.jsonl`)
  writeFileSync(file, claudeSays('user', 'add CSV export') + claudeSays('assistant', [{ type: 'text', text: 'Added **CSV**.' }]))

  const { url } = await rig.rpc('shareStart', { tab: tab.id })
  const [, port, id] = /^https:\/\/fake-(\d+)\.trycloudflare\.com\/s\/([0-9a-f-]{36})$/.exec(url)!
  assert.equal((await rig.rpc('shareStart', { tab: tab.id })).url, url, 'shared once')
  assert.deepEqual((await rig.tab(ws.id)).share, { url }, 'the view has its link (no hours: until stopped)')
  const at = `http://127.0.0.1:${port}/s/${id}`
  const page = await fetch(at)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy')!, /default-src 'none'; style-src 'nonce-[^']+'; script-src 'nonce-/)
  const html = await page.text()
  assert.match(html, /<section class="m you"><div class="who">You<\/div><div class="md"><p>add CSV export<\/p><\/div><\/section><section class="m agent"><div class="who">Claude Code<\/div><div class="md"><p>Added <strong>CSV<\/strong>.<\/p>/)
  assert.equal(await (await fetch(`${at}.md`)).text(), `# ${tab.name}\n\n**You**\n\nadd CSV export\n\n**Claude Code**\n\nAdded **CSV**.\n`)
  assert.match((await fetch(`${at}.md?download=1`)).headers.get('content-disposition')!, /^attachment; filename="[\w.-]+\.md"$/)
  const j = await (await fetch(`${at}.json?v=1`)).json()
  assert.deepEqual([j.v, j.body], [1, undefined], 'the same version: no body')
  // the chat goes on: the page's next ask has it (a half-written line waits for its end)
  appendFileSync(file, claudeSays('user', 'and tests') + '{"type":"assistant","mess')
  const next = await until(async () => (x => x.v > 1 && x)(await (await fetch(`${at}.json?v=1`)).json()), 'the new version', 5000)
  assert.match(next.body, /and tests/)
  assert.match(next.sub, /^Live/)
  // only the pages: not the daemon's API, nor another id
  assert.equal((await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', body: '{"method":"state"}' })).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${port}/s/00000000-0000-0000-0000-000000000000`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404)

  // a shell: its terminal's text
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  await until(async () => (await rig.screen(sh.id)).includes('$'), 'the shell prompt')
  await rig.rpc('input', { tab: sh.id, data: 'echo shared-$((40+2))\r' })
  const shUrl = (await rig.rpc('shareStart', { tab: sh.id })).url
  assert.equal(new URL(shUrl).host, new URL(url).host, 'one tunnel for all')
  const shAt = `http://127.0.0.1:${port}${new URL(shUrl).pathname}`
  await until(async () => (await (await fetch(`${shAt}.md`)).text()).includes('shared-42'), 'the shell’s text', 5000)

  // closing the tab stops its share; the last one stops the server and the tunnel
  await rig.rpc('tabClose', { id: sh.id })
  assert.equal((await fetch(`${shAt}.json`)).status, 404)
  await rig.rpc('shareStop', { tab: tab.id })
  assert.equal((await rig.tab(ws.id)).share, undefined)
  await assert.rejects(fetch(at), 'its server is gone')

  // for some hours: the view says until when; past it, the link is dead (the tick, or a reader's next ask)
  await assert.rejects(rig.rpc('shareStart', { tab: tab.id, hours: 5 }), /for how long: 1, 8, 24 hours, or 0/)
  const t0 = Date.now()
  const timed = await rig.rpc('shareStart', { tab: tab.id, hours: 1 })
  assert.ok(timed.until >= t0 + 3600e3 && timed.until <= Date.now() + 3600e3)
  assert.equal((await rig.tab(ws.id)).share.until, timed.until)
  await rig.rpc('shareTick', { now: Date.now() + 30 * 60e3 })
  assert.ok((await rig.tab(ws.id)).share, 'not yet')
  await rig.rpc('shareTick', { now: timed.until + 1 })
  assert.equal((await rig.tab(ws.id)).share, undefined, 'its hours are up')
  await until(() => /cloudflared \d+ stopped/.test(readFileSync(rig.env.FAKE_LOG, 'utf8')), 'the tunnel stopped')
})
