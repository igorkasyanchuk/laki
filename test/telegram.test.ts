// Settings › Telegram (daemon/telegram.ts) against a fake Bot API on this Mac (LAKI_TELEGRAM_API): the token kept off
// state.json, the view and the log; pairing by a one-time code; only the paired user's private chat counts; the long
// poll's 409 and 401; the old webhook format migrated
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { AGENT_NO, clientMethod, REMOTE_NO } from '../src/daemon/gates.ts'
import { esc, scrub, tgHtml } from '../src/daemon/telegram.ts'
import { fresh, sleep, until } from './helpers.ts'

const TOKEN = '11111:fake-secret-fake-secret-fake-secret'
const ME = 42 // the paired user (a private chat's id is its user's)
type Call = { method: string; tok: string; body: any; id?: number } // id: a sent message's
// the Bot API: getMe for TOKEN only, getUpdates from a queue (held a moment when empty, as a long poll is), a message id
// per sendMessage; next: the next getUpdates' error instead
async function bot(t: { after: (f: () => void) => void }) {
  const calls: Call[] = []
  const queue: object[] = []
  let id = 0
  let msg = 100
  let next: object | undefined
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    if (q.url === `/file/bot${TOKEN}/photos/file_1.jpg`) return void r.writeHead(200).end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    if (q.url === `/file/bot${TOKEN}/documents/notes.txt`) return void r.writeHead(200).end('my notes')
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url ?? '')
    const call: Call = { method: m?.[2] ?? '', tok: decodeURIComponent(m?.[1] ?? ''), body: body ? JSON.parse(body) : {} }
    calls.push(call)
    const ok = (result: unknown) => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
    if (call.tok !== TOKEN) return void r.writeHead(401).end(JSON.stringify({ ok: false, error_code: 401, description: `Unauthorized: ${call.tok}` }))
    if (call.method === 'getMe') return ok({ id: 777, is_bot: true, first_name: 'Laki test', username: 'laki_test_bot', has_topics_enabled: false })
    if (call.method === 'getUpdates') {
      if (next) return void (r.writeHead(200).end(JSON.stringify(next)), (next = undefined))
      for (let i = 0; i < 6 && !queue.length; i++) await sleep(50)
      if (r.socket?.destroyed) return // its daemon gone meanwhile: the updates wait for the next one
      return ok(queue.splice(0).filter((u: any) => u.update_id >= (call.body.offset ?? 0)))
    }
    if (call.method === 'getFile') return ok({ file_id: call.body.file_id, file_unique_id: 'u', file_path: call.body.file_id === 'big' ? undefined : call.body.file_id === 'doc' ? 'documents/notes.txt' : 'photos/file_1.jpg' })
    if (call.method === 'sendMessage') return ok({ message_id: (call.id = ++msg), chat: { id: call.body.chat_id, type: 'private' }, date: Math.floor(Date.now() / 1000) })
    ok(true)
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const now = () => Math.floor(Date.now() / 1000)
  return {
    calls,
    url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
    of: (method: string) => calls.filter(c => c.method === method),
    fail: (e: object) => (next = e),
    // an update from someone (from, a chat), at a time (date: seconds ago)
    message: (text: string, o: { from?: number; chat?: number; type?: string; ago?: number; reply?: number; photo?: object[]; document?: object } = {}) =>
      queue.push({ update_id: ++id, message: { message_id: 1000 + id, from: { id: o.from ?? ME, first_name: 'Ada' }, chat: { id: o.chat ?? o.from ?? ME, type: o.type ?? 'private' }, date: now() - (o.ago ?? 0), ...(o.photo || o.document ? { caption: text } : { text }), ...(o.photo && { photo: o.photo }), ...(o.document && { document: o.document }), ...(o.reply && { reply_to_message: { message_id: o.reply } }) } }),
    tap: (data: string, o: { from?: number; chat?: number; type?: string } = {}) =>
      queue.push({ update_id: ++id, callback_query: { id: `q${id}`, from: { id: o.from ?? ME }, data, message: { message_id: 1, chat: { id: o.chat ?? o.from ?? ME, type: o.type ?? 'private' } } } }),
  }
}
const daemonLog = (rig: { data: string; out: string }) => rig.out + (existsSync(join(rig.data, 'daemon.log')) ? readFileSync(join(rig.data, 'daemon.log'), 'utf8') : '')
// a rig with its bot connected and the user paired at answer, its long poll running
async function paired(t: { after: (f: () => void) => void }, env: Record<string, string> = {}) {
  const b = await bot(t)
  const rig = await fresh(t as never, { env: { LAKI_TELEGRAM_API: b.url, LAKI_TG_GAP_MS: '0', LAKI_PUSH_WAIT_MS: '150', LAKI_ANSWER_HOLD_MS: '200', ...env } })
  await rig.rpc('telegramSet', { token: TOKEN })
  const { link } = await rig.rpc('telegramPair')
  b.message(`/start ${new URL(link).searchParams.get('start')}`)
  await until(async () => (await rig.rpc('state')).telegram?.user, 'paired')
  await until(() => b.of('getUpdates').length >= 3, 'polling past the first batch')
  return { b, rig }
}

test('Telegram HTML: values escaped, the title bold, a long body folded; a token scrubbed anywhere', () => {
  const p = { event: 'waiting', workspace: 'fix<1>', tab: 't', agent: 'claude', question: 'Run a && b > c?' } as const
  assert.equal(tgHtml(p), '<b>claude in fix&lt;1&gt; is waiting for you</b>\nRun a &amp;&amp; b &gt; c?')
  assert.match(tgHtml({ ...p, question: 'x'.repeat(400) }), /\n<blockquote expandable>x{400}<\/blockquote>$/)
  assert.equal(esc('<&>'), '&lt;&amp;&gt;')
  assert.equal(scrub(`fetch https://api.telegram.org/bot${TOKEN}/getMe failed`, ''), 'fetch https://api.telegram.org/bot•••/getMe failed')
})

test('P1: a bot token checked with getMe and kept off state.json, the view and the log; a wrong one refused without it', async t => {
  const b = await bot(t)
  const rig = await fresh(t, { env: { LAKI_TELEGRAM_API: b.url, LAKI_TG_GAP_MS: '0' } })
  await assert.rejects(rig.rpc('telegramSet', { token: 'not a token' }), /isn't a bot token/)
  const wrong = '11111:fake-secret-wrong-wrong-wrong-wrong'
  const e = await rig.rpc('telegramSet', { token: wrong }).then(() => '', (x: Error) => x.message)
  assert.match(e, /Unauthorized/)
  assert.ok(!e.includes(wrong) && !e.includes('fake-secret-wrong'), `no token in the error: ${e}`)
  const v = await rig.rpc('telegramSet', { token: TOKEN })
  assert.deepEqual([v.token, v.bot], [true, { username: 'laki_test_bot', name: 'Laki test', topics: false }])
  await assert.rejects(rig.rpc('telegramTest'), /pair your chat first/)
  await rig.rpc('telegramPair')
  await until(() => b.of('getUpdates').length, 'polling for the code')
  await rig.stop()
  const kept = readFileSync(join(rig.data, 'state.json'), 'utf8')
  assert.ok(kept.includes('laki_test_bot') && !kept.includes('fake-secret'), 'state.json: the bot, never its token')
  assert.ok(!daemonLog(rig).includes('fake-secret'), 'nor the log')
  assert.equal(readFileSync(join(rig.data, 'telegram-token'), 'utf8').trim(), TOKEN) // the rig has no Keychain: its 0600 file
  await rig.start()
  assert.ok(!JSON.stringify(await rig.rpc('stateOwn')).includes('fake-secret'), 'nor the whole view')
  // an agent, remote access or a trusted client never sets it up (gates.ts' tables; a client's are an allowlist)
  for (const m of ['telegramSet', 'telegramPair', 'telegramTest']) {
    assert.ok(AGENT_NO[m] && REMOTE_NO.has(m), m)
    assert.deepEqual(clientMethod(m, ['create', 'send', 'cmd', 'yolo', 'remove', 'ship']), { scope: undefined }, m)
  }
})

test('P1: pairing: only a private /start with the live code pairs, once; a wrong, reused, group or expired code: nothing at all', async t => {
  const b = await bot(t)
  const rig = await fresh(t, { env: { LAKI_TELEGRAM_API: b.url, LAKI_TG_GAP_MS: '0', LAKI_TG_PAIR_MS: '2500' } })
  await rig.rpc('telegramSet', { token: TOKEN })
  const { link, until: end } = await rig.rpc('telegramPair')
  const code = new URL(link).searchParams.get('start')!
  assert.match(link, /^https:\/\/t\.me\/laki_test_bot\?start=[\w-]{22}$/)
  assert.ok(end > Date.now())
  assert.ok((await rig.rpc('state')).telegram.pairing, 'the view says a code waits, not which')
  assert.ok(!JSON.stringify(await rig.rpc('state')).includes(code), 'never the code itself')
  b.message('/start AAAAAAAAAAAAAAAAAAAAAA', { from: 66 }) // a guess
  b.message(`/start ${code}`, { from: 67, chat: -100, type: 'group' }) // in a group
  b.message('hello', { from: 68 })
  await until(() => b.of('getUpdates').length >= 3, 'those read')
  assert.equal((await rig.rpc('state')).telegram.user, undefined)
  assert.equal(b.of('sendMessage').length, 0, 'not a word to anyone')
  b.message(`/start ${code}`)
  await until(async () => (await rig.rpc('state')).telegram?.user, 'paired')
  assert.deepEqual([(await rig.rpc('state')).telegram.user.name, (await rig.rpc('state')).telegram.level], ['Ada', 'answer'])
  await until(() => b.of('sendMessage').some(c => c.body.chat_id === ME && /Paired with Laki/.test(c.body.text)), 'told')
  b.message(`/start ${code}`, { from: 69 }) // used: another user's try with it changes nothing
  await until(() => b.of('getUpdates').length >= 6, 'read')
  assert.equal((await rig.rpc('state')).telegram.user.name, 'Ada')
  // a new code, run out before its /start
  await rig.rpc('telegramSet', { unpair: true })
  const late = new URL((await rig.rpc('telegramPair')).link).searchParams.get('start')
  await sleep(3000) // past LAKI_TG_PAIR_MS (2.5 s)
  b.message(`/start ${late}`)
  await sleep(500)
  assert.equal((await rig.rpc('state')).telegram.user, undefined, 'an expired code pairs nobody')
  assert.equal((await rig.rpc('state')).telegram.polling, undefined, 'and nothing polls once it ran out')
})

test('P1: a tap counts only from the paired user in their private chat, never a stale one; the message then says what was picked', async t => {
  const { b, rig } = await paired(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const push = (await until(() => b.of('sendMessage').find(c => c.body.reply_markup?.inline_keyboard?.length), 'the push with buttons'))!
  assert.equal(push.body.parse_mode, 'HTML')
  const nonce = push.body.reply_markup.inline_keyboard[0][0].callback_data.split(':')[0]
  b.tap(`${nonce}:3`, { from: 99 }) // someone else's private chat
  b.tap(`${nonce}:3`, { from: 99, chat: ME }) // another user in a chat of the paired one's id
  b.tap(`${nonce}:3`, { chat: -5, type: 'group' }) // the paired user, in a group
  const polls = b.of('getUpdates').length
  await until(() => b.of('getUpdates').length >= polls + 2, 'those read')
  await sleep(300)
  assert.doesNotMatch(await rig.screen(tab.id), /picked:/)
  b.tap(`${nonce}:1`)
  await until(async () => /picked: Yes/.test(await rig.screen(tab.id)), 'the tap picked 1')
  const edit = (await until(() => b.of('editMessageText').at(-1), 'its message edited'))!
  assert.deepEqual([edit.body.message_id, edit.body.reply_markup], [push.id, { inline_keyboard: [] }])
  assert.match(edit.body.text, /<i>Picked: Yes<\/i>$/)
  assert.ok(b.of('answerCallbackQuery').some(c => c.body.text === 'Picked: Yes'), 'the tap answered')
})

test('P1: a message older than two minutes is dropped with a word; a tap in the first batch after a gap too', async t => {
  const { b, rig } = await paired(t)
  b.message('hello from the morning', { ago: 600 })
  await until(() => b.of('sendMessage').some(c => /Laki was off/.test(c.body.text)), 'told it was off')
  await rig.stop()
  b.tap('00112233aabbccdd:1') // made while Laki was off
  await rig.start()
  await until(() => b.of('answerCallbackQuery').some(c => /too old/.test(c.body.text)), 'the old tap dropped')
})

test('P1: a 409 stops the poll and says to use a bot only for Laki (no webhook touched); a 401 turns it off with a notice', async t => {
  const { b, rig } = await paired(t)
  b.fail({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
  await until(async () => /a bot made only for Laki/.test((await rig.rpc('state')).telegram.notice ?? ''), 'the notice')
  assert.equal((await rig.rpc('state')).telegram.polling, undefined)
  assert.ok(!b.calls.some(c => /Webhook/i.test(c.method)), 'no deleteWebhook, no setWebhook')
  await rig.rpc('telegramSet', { off: false }) // on again: it polls again
  await until(async () => (await rig.rpc('state')).telegram.polling, 'polling again')
  b.fail({ ok: false, error_code: 401, description: 'Unauthorized' })
  await until(async () => (await rig.rpc('state')).telegram.off, 'off')
  assert.match((await rig.rpc('state')).telegram.notice, /refused the bot's token/)
  assert.ok(!daemonLog(rig).includes('fake-secret'), 'no token in the log')
})

test('P1: the old telegram webhook moves to Settings › Telegram: a private chat paired at answer, a group only a notice; the URL gone from state.json', async t => {
  const b = await bot(t)
  const rig = await fresh(t, { env: { LAKI_TELEGRAM_API: b.url, LAKI_TG_GAP_MS: '0' } })
  const sp = join(rig.data, 'state.json')
  for (const [chat, user] of [[String(ME), true], ['-100123', false]] as const) {
    await rig.stop()
    const st = JSON.parse(readFileSync(sp, 'utf8'))
    st.settings = { ...st.settings, webhook: { url: `${b.url}/bot${TOKEN}/sendMessage?chat_id=${chat}`, format: 'telegram', answer: true, done: true } }
    delete st.telegram
    writeFileSync(sp, JSON.stringify(st))
    await rig.start()
    const v = await rig.rpc('state')
    assert.equal(v.settings.webhook, undefined, 'no webhook left')
    assert.equal(!!v.telegram.user, user, chat)
    assert.equal(v.telegram.done, true)
    if (!user) assert.match(v.telegram.notice, /went to a group: .*Pair again/)
    await until(async () => (await rig.rpc('state')).telegram.bot?.username === 'laki_test_bot', 'its bot named')
    assert.ok(!readFileSync(sp, 'utf8').includes('fake-secret'), 'the token off state.json')
  }
  await assert.rejects(rig.rpc('settingsSet', { webhook: { url: 'https://example.com/x', format: 'telegram' } }), /its own section now/)
})

// an agent tab with claude up, its project and workspace
async function claude(rig: Awaited<ReturnType<typeof fresh>>) {
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  return { ws, tab }
}

test('P2: a reply to a push goes to its tab (a waiting ask: a choice by its number), a 👍 its receipt; never a ! line; across a restart', async t => {
  const { b, rig } = await paired(t)
  const { ws, tab } = await claude(rig)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  const done = (await until(() => b.of('sendMessage').find(c => c.body.disable_notification), 'the done push, silent'))!
  assert.match(done.body.text, /^<b>claude in .+ is done<\/b>\n.*hi/, 'with its last line')
  b.message('and the empty email too', { reply: done.id })
  await until(async () => /answer: and the empty email too/.test(await rig.screen(tab.id)), 'the reply sent to claude')
  await until(() => b.of('setMessageReaction').some(c => c.body.reaction[0].emoji === '👍'), 'the receipt')
  b.message('!rm -rf /', { reply: done.id })
  await until(() => b.of('sendMessage').some(c => /Not sent: .*a line that starts with !/.test(c.body.text)), 'a ! line refused')
  b.message('hello') // not a reply: how to send one
  await until(() => b.of('sendMessage').some(c => /Reply to one of my messages/.test(c.body.text)), 'the hint')
  // a waiting menu: its push, and a reply with a choice's number picks it
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const ask = (await until(() => b.of('sendMessage').find(c => c.body.reply_markup?.inline_keyboard?.length), 'the ask'))!
  b.message('1', { reply: ask.id })
  await until(async () => /picked: Yes/.test(await rig.screen(tab.id)), 'the reply picked 1')
  // the map outlives a restart: a reply to the done push still reaches its tab
  await rig.stop()
  await rig.start()
  await until(async () => (await rig.rpc('state')).telegram?.polling, 'polling again')
  await until(async () => (await rig.tab(ws.id)) && /> $/m.test(await rig.screen(tab.id)), 'claude back')
  await until(() => b.of('getUpdates').length > 0, 'polling')
  await sleep(400) // past the first batch (a gap's)
  b.message('after the restart', { reply: done.id })
  await until(async () => /answer: after the restart/.test(await rig.screen(tab.id)), 'still its tab')
})

test('P2: a photo or a file in a reply is saved through Laki and its path goes to the agent; past 20 MB refused', async t => {
  const { b, rig } = await paired(t)
  const { tab } = await claude(rig)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  const done = (await until(() => b.of('sendMessage').find(c => c.body.disable_notification), 'the done push'))!
  b.message('look', { reply: done.id, photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'p1', file_size: 7 }] })
  await until(async () => /answer: look .*images\/\d+-\w+\.jpg/s.test((await rig.screen(tab.id)).replace(/\n/g, ' ')), 'the picture\'s path sent')
  assert.equal(b.of('getFile').at(-1)!.body.file_id, 'p1', 'the biggest size')
  b.message('', { reply: done.id, document: { file_id: 'doc', file_name: 'notes.txt', file_size: 8 } })
  await until(async () => /files\/\d+-\w+\/notes\.txt/.test((await rig.screen(tab.id)).replace(/\n/g, '')), 'the file\'s path sent')
  b.message('', { reply: done.id, document: { file_id: 'huge', file_name: 'x.bin', file_size: 21 << 20 } })
  await until(() => b.of('sendMessage').some(c => /Not sent: over 20 MB/.test(c.body.text)), 'too big')
})
