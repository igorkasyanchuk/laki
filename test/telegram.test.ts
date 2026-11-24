// Settings › Telegram (daemon/telegram.ts) against a fake Bot API on this Mac (LAKI_TELEGRAM_API): the token kept off
// state.json, the view and the log; pairing by a one-time code; only the paired user's private chat counts; the long
// poll's 409 and 401; the old webhook format migrated
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { AGENT_NO, clientMethod, REMOTE_NO, TELEGRAM_OK } from '../src/daemon/gates.ts'
import { esc, scrub, tgHtml } from '../src/daemon/telegram.ts'
import { mdToTg } from '../src/shared/tgmd.ts'
import { fresh, openrouter, reply, sleep, until } from './helpers.ts'

const TOKEN = '11111:fake-secret-fake-secret-fake-secret'
const ME = 42 // the paired user (a private chat's id is its user's)
type Call = { method: string; tok: string; body: any; id?: number } // id: a sent message's
// the Bot API: getMe for TOKEN only, getUpdates from a queue (held a moment when empty, as a long poll is), a message id
// per sendMessage; next: the next getUpdates' error instead
async function bot(t: { after: (f: () => void) => void }, o: { topics?: boolean; noTopics?: boolean } = {}) {
  const calls: Call[] = []
  const queue: object[] = []
  let id = 0
  let msg = 100
  let next: object | undefined
  const gone = new Set<number>() // topics deleted in Telegram: a message there is refused
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    if (q.url === `/file/bot${TOKEN}/photos/file_1.jpg`) return void r.writeHead(200).end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    if (q.url === `/file/bot${TOKEN}/documents/notes.txt`) return void r.writeHead(200).end('my notes')
    if (q.url === `/file/bot${TOKEN}/voice/file_2.oga`) return void r.writeHead(200).end(Buffer.from('OggS fake opus'))
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url ?? '')
    const call: Call = { method: m?.[2] ?? '', tok: decodeURIComponent(m?.[1] ?? ''), body: body ? JSON.parse(body) : {} }
    calls.push(call)
    const ok = (result: unknown) => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
    if (call.tok !== TOKEN) return void r.writeHead(401).end(JSON.stringify({ ok: false, error_code: 401, description: `Unauthorized: ${call.tok}` }))
    if (call.method === 'getMe') return ok({ id: 777, is_bot: true, first_name: 'Laki test', username: 'laki_test_bot', has_topics_enabled: o.topics })
    if (call.method === 'createForumTopic') return o.noTopics ? void r.writeHead(400).end(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: the chat is not a forum' })) : ok({ message_thread_id: 500 + calls.length, name: call.body.name, icon_color: call.body.icon_color })
    if (call.method === 'getUpdates') {
      if (next) return void (r.writeHead(200).end(JSON.stringify(next)), (next = undefined))
      for (let i = 0; i < 6 && !queue.length; i++) await sleep(50)
      if (r.socket?.destroyed) return // its daemon gone meanwhile: the updates wait for the next one
      return ok(queue.splice(0).filter((u: any) => u.update_id >= (call.body.offset ?? 0)))
    }
    if (call.method === 'getFile') return ok({ file_id: call.body.file_id, file_unique_id: 'u', file_path: call.body.file_id === 'big' ? undefined : call.body.file_id === 'doc' ? 'documents/notes.txt' : call.body.file_id === 'voice' ? 'voice/file_2.oga' : 'photos/file_1.jpg' })
    if (call.method === 'sendMessage' && gone.has(call.body.message_thread_id)) return void r.writeHead(400).end(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message thread not found' }))
    if (call.method === 'sendMessage') return ok({ message_id: (call.id = ++msg), chat: { id: call.body.chat_id, type: 'private' }, date: Math.floor(Date.now() / 1000) })
    ok(true)
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const now = () => Math.floor(Date.now() / 1000)
  return {
    calls,
    gone,
    url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
    of: (method: string) => calls.filter(c => c.method === method),
    fail: (e: object) => (next = e),
    // an update from someone (from, a chat), at a time (date: seconds ago)
    message: (text: string, o: { from?: number; chat?: number; type?: string; ago?: number; reply?: number; photo?: object[]; document?: object; voice?: object; thread?: number } = {}) =>
      queue.push({ update_id: ++id, message: { message_id: 1000 + id, from: { id: o.from ?? ME, first_name: 'Ada' }, chat: { id: o.chat ?? o.from ?? ME, type: o.type ?? 'private' }, date: now() - (o.ago ?? 0), ...(o.voice ? {} : o.photo || o.document ? { caption: text } : { text }), ...(o.photo && { photo: o.photo }), ...(o.document && { document: o.document }), ...(o.voice && { voice: o.voice }), ...(o.reply && { reply_to_message: { message_id: o.reply } }), ...(o.thread && { message_thread_id: o.thread, is_topic_message: true }) } }),
    tap: (data: string, o: { from?: number; chat?: number; type?: string } = {}) =>
      queue.push({ update_id: ++id, callback_query: { id: `q${id}`, from: { id: o.from ?? ME }, data, message: { message_id: 1, chat: { id: o.chat ?? o.from ?? ME, type: o.type ?? 'private' } } } }),
  }
}
const daemonLog = (rig: { data: string; out: string }) => rig.out + (existsSync(join(rig.data, 'daemon.log')) ? readFileSync(join(rig.data, 'daemon.log'), 'utf8') : '')
// a rig with its bot connected and the user paired at answer, its long poll running
async function paired(t: { after: (f: () => void) => void }, env: Record<string, string> = {}, o: { topics?: boolean; noTopics?: boolean } = {}) {
  const b = await bot(t, o)
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

test('Touch ID on: pairing a chat and raising Telegram to control each take a ticket of their own; a lower level, a token or unpair none', async t => {
  const b = await bot(t)
  const rig = await fresh(t, { env: { LAKI_TELEGRAM_API: b.url, LAKI_TG_GAP_MS: '0' } })
  await rig.rpc('telegramSet', { token: TOKEN })
  await rig.rpc('settingsSet', { touchId: true })
  const ticket = async (what: string) => (await rig.rpc('ticketMint', { what })).ticket as string
  await assert.rejects(rig.rpc('telegramPair'), /to pair a Telegram chat with Laki, Laki asks for Touch ID first \(Settings › General\): do it in Laki's window/)
  await assert.rejects(rig.rpc('telegramPair', { touchTicket: await ticket('bypassNew') }), /Touch ID first/, "another action's")
  await assert.rejects(rig.rpc('telegramPair', { touchTicket: await ticket('telegramControl') }), /Touch ID first/, "control's")
  assert.match((await rig.rpc('telegramPair', { touchTicket: await ticket('telegramPair') })).link, /start=/)
  await assert.rejects(rig.rpc('telegramSet', { level: 'control' }), /to let Telegram start workspaces, Laki asks for Touch ID first/)
  await assert.rejects(rig.rpc('telegramSet', { level: 'control', touchTicket: await ticket('bypassNew') }), /Touch ID first/)
  await rig.rpc('telegramSet', { level: 'control', touchTicket: await ticket('telegramControl') })
  assert.equal((await rig.rpc('state')).telegram.level, 'control')
  await rig.rpc('telegramSet', { level: 'control' }) // already control: nothing more let in
  await rig.rpc('telegramSet', { level: 'answer' })
  await rig.rpc('telegramSet', { detail: 'titles' })
  await rig.rpc('telegramSet', { token: TOKEN }) // the same bot again
  await rig.rpc('telegramSet', { unpair: true })
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
  // another person paired after an unpair starts at Answer, whatever the last one had
  await rig.rpc('telegramSet', { level: 'control' })
  await rig.rpc('telegramSet', { unpair: true })
  b.message(`/start ${new URL((await rig.rpc('telegramPair')).link).searchParams.get('start')}`, { from: 70 })
  await until(async () => (await rig.rpc('state')).telegram?.user, 'paired again')
  assert.equal((await rig.rpc('state')).telegram.level, 'answer')
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
  // what waited is read at once (timeout 0); then a long poll, and a tap made during it is fresh
  const first = b.of('getUpdates').findLast(c => c.body.timeout === 0)!
  await until(() => b.calls.indexOf(b.of('getUpdates').at(-1)!) > b.calls.indexOf(first) && b.of('getUpdates').at(-1)!.body.timeout === 50, 'a long poll')
  b.tap('00112233aabbccdd:2')
  await until(() => b.of('answerCallbackQuery').some(c => c.body.text === 'That ask moved on'), 'a fresh tap: not too old')
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
  b.message('/Users/me/app/log.txt has it', { reply: done.id }) // a path, not a command
  await until(async () => /answer: \/Users\/me\/app\/log\.txt has it/.test(await rig.screen(tab.id)), 'a path sent as words')
  b.message('!rm -rf /', { reply: done.id })
  await until(() => b.of('sendMessage').some(c => /Not sent: .*a line that starts with !/.test(c.body.text)), 'a ! line refused')
  b.message('look at this\n!rm -rf /', { reply: done.id })
  await until(() => b.of('sendMessage').filter(c => /Not sent: .*a line that starts with !/.test(c.body.text)).length === 2, 'a later ! line too')
  b.message('hello') // not a reply, no Talk here: where should it go? an agent's button each
  const where = (await until(() => b.of('sendMessage').find(c => /Where should this go/.test(c.body.text)), 'where to'))!
  assert.ok(where.body.reply_markup.inline_keyboard.some((r: any) => r[0].text.startsWith('💬 ')))
  // a waiting menu: its push, and a reply with a choice's number picks it
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const ask = (await until(() => b.of('sendMessage').find(c => c.body.reply_markup?.inline_keyboard?.length && !/Where should this go/.test(c.body.text)), 'the ask'))!
  // "yes" to the older push is words for later, never an Allow of what it asks now
  b.message('Yes', { reply: done.id })
  await until(() => b.of('sendMessage').some(c => /^Queued: claude asks something first/.test(c.body.text)), 'queued')
  assert.doesNotMatch(await rig.screen(tab.id), /picked:/)
  b.message('1', { reply: ask.id })
  await until(async () => /picked: Yes/.test(await rig.screen(tab.id)), 'the reply picked 1')
  await until(() => b.of('editMessageText').some(c => /<i>Picked: Yes<\/i>$/.test(c.body.text)), 'its push says so')
  await until(async () => /answer: Yes/.test(await rig.screen(tab.id)), 'the queued words went once it was free') // before the restart: a queue it left waits for Resume
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

test('P3: TELEGRAM_OK is the whole of what a chat can do: never Stop, Ship, merge, archive, delete, settings, secrets, terminals, remote access', () => {
  assert.deepEqual(Object.keys(TELEGRAM_OK).sort(), ['answer', 'chatRead', 'diff', 'dndSet', 'screen', 'send', 'state', 'voiceText', 'wsNew'])
  for (const m of ['stopAll', 'longStop', 'input', 'run', 'ship', 'prAct', 'wsArchive', 'wsRm', 'settingsSet', 'secretGive', 'remoteStart', 'telegramSet', 'tabNew', 'turnRewind']) assert.ok(!Object.hasOwn(TELEGRAM_OK, m), m)
  assert.equal(TELEGRAM_OK.wsNew, 'control')
})

test('Only when I ask (pushOff): nothing pushed on its own, commands still answer; the workspace you talk to still says its turn ended', async t => {
  const { b, rig } = await paired(t)
  await rig.rpc('telegramSet', { pushOff: true })
  assert.equal((await rig.rpc('state')).telegram?.pushOff, true)
  const { tab } = await claude(rig)
  const from = b.of('sendMessage').length // the pairing's hello before
  const pushes = () => b.of('sendMessage').slice(from).filter(c => /is done<\/b>|^<b>claude in .+ (needs you|waits|asks)/.test(c.body.text) || c.body.reply_markup?.inline_keyboard?.some((r: any) => r.some((k: any) => /^(1\. )?Yes/.test(k.text))))
  const tabNow = async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  await until(async () => (await tabNow())?.status === 'waiting', 'it waits')
  await sleep(500) // past LAKI_PUSH_WAIT_MS (0.15 s): a wait's push would have gone
  const n = b.of('sendMessage').length
  b.message('/status')
  await until(() => b.of('sendMessage').length > n, 'its answer')
  assert.match(b.of('sendMessage').at(-1)!.body.text, /Needs you · 1/, 'you look: it answers')
  await rig.rpc('answer', { tab: tab.id, n: 1 })
  await until(async () => (await tabNow())?.done, 'its turn ends')
  await sleep(300) // a done push goes at once
  assert.deepEqual(pushes().map(c => c.body.text), [], 'no ask, no done')
  // talk to it from the chat: its turn's end comes back
  b.message('hello')
  const where = (await until(() => b.of('sendMessage').find(c => /Where should this go/.test(c.body.text)), 'where to'))!
  b.tap(where.body.reply_markup.inline_keyboard.find((r: any) => r[0].text.startsWith('💬 '))[0].callback_data)
  await until(() => b.of('sendMessage').some(c => /is done<\/b>/.test(c.body.text)), 'the talked-to turn ends: said')
})

test("P3: commands: the level's menu for this chat; /status, /screen, /diff, /quiet at answer, titles only and Recording mode kept; /new only at control; limits; the log", async t => {
  const { b, rig } = await paired(t, { LAKI_TG_LIMITS: 'ws=1,send=2' })
  const menu = (await until(() => b.of('setMyCommands').at(-1), 'the menu'))!
  assert.deepEqual([menu.body.commands.map((c: any) => c.command), menu.body.scope], [['menu', 'status', 'screen', 'diff', 'talk', 'ai', 'quiet'], { type: 'chat', chat_id: ME }])
  const { ws, tab } = await claude(rig)
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const ask = (await until(() => b.of('sendMessage').find(c => c.body.reply_markup?.inline_keyboard?.length), 'the ask'))!
  const last = () => b.of('sendMessage').at(-1)!.body.text as string
  const sent = () => b.of('sendMessage').length
  const ask2 = async (text: string, o = {}) => {
    const n = sent()
    b.message(text, o)
    await until(() => sent() > n, `an answer to ${text}`)
    return last()
  }
  assert.match(await ask2('/status'), /<b>Needs you · 1<\/b>\n🟡 .+ · claude/)
  assert.match(await ask2('/screen', { reply: ask.id }), /^<b>claude<\/b> in <b>.+<\/b>\n<pre>[\s\S]*1\. Yes[\s\S]*<\/pre>$/)
  assert.match(await ask2('/screen'), /Which one\?/)
  assert.match(await ask2(`/diff ${ws.name ?? ws.id}`), /no changes|file/)
  assert.match(await ask2('/new laki fix it'), /needs the Control level/)
  assert.match(await ask2('/nope'), /^No \/nope\. \/menu: /)
  assert.match(await ask2('/quiet 2h'), /Do not disturb until/)
  assert.ok((await rig.rpc('state')).dnd?.until > Date.now() + 3600_000)
  assert.match(await ask2('/quiet off'), /is off/)
  assert.equal((await rig.rpc('state')).dnd, undefined)
  // titles only: nothing off a screen; Recording mode: a private workspace isn't named
  await rig.rpc('telegramSet', { detail: 'titles' })
  assert.match(await ask2('/screen', { reply: ask.id }), /Titles only is on/)
  assert.doesNotMatch(await ask2('/status'), /<code>/, 'no ask words with titles only')
  await rig.rpc('telegramSet', { detail: '' })
  await rig.rpc('wsSet', { id: ws.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  assert.match(await ask2('/status'), /Nothing needs you/)
  assert.match(await ask2('/screen', { reply: ask.id }), /Which one\?/)
  await rig.rpc('settingsSet', { recording: false })
  // control: /new starts one (1 an hour here), and its menu has /new
  await rig.rpc('telegramSet', { level: 'control' })
  await until(() => b.of('setMyCommands').at(-1)!.body.commands.some((c: any) => c.command === 'new'), 'the menu with /new')
  const proj = (await rig.rpc('state')).projects[0]
  assert.match(await ask2(`/new ${proj.name} add a README`), /^Started <b>/)
  await until(async () => (await rig.rpc('state')).workspaces.length === 2, 'the new workspace')
  assert.match(await ask2(`/new ${proj.name} another`), /Not done: 1 new workspaces an hour from Telegram at most/)
  // messages: 2 a minute here (the reply that picked nothing counts too)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  const done = (await until(() => b.of('sendMessage').find(c => c.body.disable_notification), 'a done push'))!
  for (const w of ['one', 'two']) b.message(w, { reply: done.id })
  await until(async () => /answer: two/.test(await rig.screen(tab.id)), 'two sent')
  b.message('three', { reply: done.id })
  await until(() => b.of('sendMessage').some(c => /Not sent: 2 messages a minute from Telegram at most/.test(c.body.text)), 'the third refused')
  const did = await rig.rpc('telegramLog', { n: 50 })
  assert.ok(did.some((d: any) => /^paired with Ada$/.test(d.line)))
  assert.ok(did.some((d: any) => /^Do not disturb for 120 minutes$/.test(d.line)))
  assert.ok(did.some((d: any) => /^to .+ · claude: "one"$/.test(d.line)))
  assert.ok(did.some((d: any) => /^refused to .+: "three": 2 messages a minute/.test(d.line)))
  assert.ok(!JSON.stringify(did).includes('fake-secret'))
})

test("P4: a topic per workspace: needs the bot's topics; its pushes in it, plain words there to its agent, gone with the workspace", async t => {
  const { b, rig } = await paired(t, {}, { topics: true })
  await rig.rpc('telegramSet', { topics: true })
  const { ws, tab } = await claude(rig)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  const made = (await until(() => b.of('createForumTopic').at(-1), 'its topic'))!
  assert.equal(made.body.name, ws.name ?? ws.id)
  const done = (await until(() => b.of('sendMessage').find(c => c.body.disable_notification), 'the done push'))!
  const thread = done.body.message_thread_id
  assert.ok(thread > 500, 'in its topic')
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  await until(() => b.of('sendMessage').filter(c => c.body.disable_notification).length === 2, 'a second push')
  assert.equal(b.of('createForumTopic').length, 1, 'one topic, however many pushes')
  assert.equal(b.of('sendMessage').filter(c => c.body.disable_notification)[1].body.message_thread_id, thread)
  // its topic deleted in Telegram: a new one, the push in it
  b.gone.add(thread)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  await until(() => b.of('createForumTopic').length === 2, 'a new topic')
  const pushes = () => b.of('sendMessage').filter(c => c.body.disable_notification && c.id) // sent (a refused one has no id)
  const again = (await until(() => (pushes().length === 3 ? pushes()[2] : undefined), 'the push in the new topic'))!
  assert.ok(again.body.message_thread_id > thread)
  b.gone.clear()
  b.message('words in the topic', { thread: again.body.message_thread_id })
  await until(async () => /answer: words in the topic/.test(await rig.screen(tab.id)), 'to its agent, no reply needed')
  const now = again.body.message_thread_id
  b.message('/screen', { thread: now })
  await until(() => b.of('sendMessage').some(c => c.body.message_thread_id === now && /^<b>claude<\/b> in .*<pre>/s.test(c.body.text)), 'its screen, in its topic')
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => b.of('deleteForumTopic').some(c => c.body.message_thread_id === now), 'the topic gone with it')
})

test("P4: topics refused until the bot has them; Telegram refusing one turns them off with a notice", async t => {
  const { b, rig } = await paired(t, {}, { noTopics: true })
  await assert.rejects(rig.rpc('telegramSet', { topics: true }), /turn topics on for @laki_test_bot in @BotFather first/)
  await rig.stop()
  const sp = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(sp, 'utf8'))
  Object.assign(st.telegram, { topics: true, bot: { ...st.telegram.bot, topics: true } }) // on, as if BotFather's were
  writeFileSync(sp, JSON.stringify(st))
  await rig.start()
  const { tab } = await claude(rig)
  await rig.rpc('send', { target: tab.id, text: 'hi' })
  await until(async () => (await rig.rpc('state')).telegram.topics === false, 'topics off')
  assert.match((await rig.rpc('state')).telegram.notice, /Topics are off: Telegram didn't make one/)
  await until(() => b.of('sendMessage').some(c => c.body.disable_notification && !c.body.message_thread_id), 'the push in the chat anyway')
})

test("Markdown to Telegram's HTML: code, bold, italic, links, lists, quotes, headings; escaped elsewhere; snake_case and URLs left alone", () => {
  assert.equal(mdToTg('# Done\nFixed **cart** in `src/a_b.js` (a < b && c).'), '<b>Done</b>\nFixed <b>cart</b> in <code>src/a_b.js</code> (a &lt; b &amp;&amp; c).')
  assert.equal(mdToTg('- one *thing*\n- [PR](https://x.io/p?a=1&b=2)'), '• one <i>thing</i>\n• <a href="https://x.io/p?a=1&amp;b=2">PR</a>')
  assert.equal(mdToTg('> quoted _here_\n> more'), '<blockquote>quoted <i>here</i>\nmore</blockquote>')
  assert.equal(mdToTg('```ts\nconst x = a<b\n```'), '<pre><code class="language-ts">const x = a&lt;b</code></pre>')
  assert.equal(mdToTg('snake_case_name, 2*3*4, https://x.io/a/_b_/c'), 'snake_case_name, 2*3*4, https://x.io/a/_b_/c')
  // a push: the agent's words as Markdown; one with code isn't folded (a blockquote can't hold it)
  const p = { event: 'done', workspace: 'w', tab: 't', agent: 'claude', question: '**Ready**: run `npm test`' } as const
  assert.equal(tgHtml(p), '<b>claude in w is done</b>\n<b>Ready</b>: run <code>npm test</code>')
  assert.doesNotMatch(tgHtml({ ...p, question: `${'x'.repeat(400)}\n\`\`\`\ncode\n\`\`\`` }), /blockquote/)
})

test('buttons: /menu › a project › a workspace (⬆ ⬇ ⬅); Talk here; where to?; a new task; a voice note heard', async t => {
  const or = await openrouter(t, [{ text: ' fix the flaky test ' }])
  const { b, rig } = await paired(t, { LAKI_AI_API: or.url, LAKI_FFMPEG: '/nonexistent-ffmpeg' })
  await rig.rpc('telegramSet', { level: 'control' })
  await rig.rpc('aiKey', { key: 'sk-or-v1-voice' }) // Settings › Voice's cloud: OpenRouter's key
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'two' })
  const t1 = await until(async () => (x => x?.status === 'idle' && x)(await rig.tab(one.id)), 'one up')
  const t2 = await until(async () => (x => x?.status === 'idle' && x)(await rig.tab(two.id)), 'two up')
  const keys = (c: Call) => (c.body.reply_markup?.inline_keyboard ?? []).flat() as { text: string; callback_data: string }[]
  const press = async (c: Call, label: RegExp) => {
    const k = keys(c).find(x => label.test(x.text))
    assert.ok(k, `${label} in ${keys(c).map(x => x.text).join(' | ')}`)
    const n = b.of('editMessageText').length
    b.tap(k.callback_data)
    return (await until(() => b.of('editMessageText')[n], `${label}'s view`))!
  }
  b.message('/menu')
  const menu = (await until(() => b.of('sendMessage').find(c => /<b>Projects<\/b>/.test(c.body.text)), 'the menu'))!
  const proj = await press(menu, /^📁 /)
  assert.deepEqual(keys(proj).filter(k => k.callback_data.startsWith('nav:w:')).map(k => k.text.replace(/^\S+ /, '')), ['one', 'two'])
  const card1 = await press(proj, /one$/)
  assert.match(card1.body.text, /^<b>one<\/b> in /)
  const card2 = await press(card1, /⬇ Next/)
  assert.match(card2.body.text, /^<b>two<\/b>/)
  const back = await press(await press(card2, /⬆ Previous/), /^⬅ /)
  assert.ok(keys(back).some(k => k.text === '➕ New task'), 'Control: a new task')
  // Talk here: plain words go to its agent
  await press(await press(back, /one$/), /Talk here/)
  b.message('please add tests')
  await until(async () => /please add tests/.test(await rig.screen(t1.id)), 'to one, no reply needed')
  // a voice note: heard (ogg as it came: no ffmpeg), shown back, then to the same agent
  b.message('', { voice: { file_id: 'voice', duration: 2, mime_type: 'audio/ogg' } })
  await until(async () => /fix the flaky test/.test(await rig.screen(t1.id)), 'the voice note to one')
  assert.equal(or.hits[0].body.input_audio.format, 'ogg')
  assert.ok(b.of('sendMessage').some(c => c.body.text === '🎙 <i>fix the flaky test</i>'))
  // nowhere to go: where to? its button sends it, and talks there from then on
  b.message('/talk off')
  await until(() => b.of('sendMessage').some(c => /go nowhere now/.test(c.body.text)), 'talk off')
  b.message('check the logs')
  const where = (await until(() => b.of('sendMessage').find(c => /Where should this go/.test(c.body.text)), 'where to'))!
  b.tap(keys(where).find(k => k.text === '💬 two')!.callback_data)
  await until(async () => /check the logs/.test(await rig.screen(t2.id)), 'to two by its button')
  assert.equal((await rig.rpc('state')).telegram.focus, two.id)
  // ➕ New task: the next message is its task, a workspace started and talked to
  const before = (await rig.rpc('state')).workspaces.length
  b.tap(keys(back).find(k => k.text === '➕ New task')!.callback_data)
  await until(() => b.of('sendMessage').some(c => /Send the task for/.test(c.body.text)), 'asks for the task')
  b.message('build a login page like this', { photo: [{ file_id: 'p1', file_size: 7 }] }) // a screenshot with its words
  await until(() => b.of('sendMessage').some(c => /^Started <b>/.test(c.body.text)), 'started')
  const v = await rig.rpc('state')
  assert.equal(v.workspaces.length, before + 1)
  assert.equal(v.telegram.focus, v.workspaces.at(-1).id)
  const made = v.tabs.find((x: any) => x.workspace === v.workspaces.at(-1).id && x.kind === 'agent')
  await until(async () => /build a login page like this .*images\/\d+-\w+\.jpg/s.test((await rig.screen(made.id)).replace(/\n/g, ' ')), "the task and its picture's path in the new agent's prompt")
})

test('🤖 Laki AI from the chat: its tools only what the chat may do, its answer as HTML, a photo as its picture; not with a CLI backend or Titles only', async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [])
  const { b, rig } = await paired(t, { LAKI_AI_API: or.url })
  await rig.rpc('telegramSet', { level: 'control' })
  await rig.rpc('aiKey', { key: 'sk-or-v1-tg' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const before = (await rig.rpc('state')).workspaces.length
  b.message('/ai')
  await until(() => b.of('sendMessage').some(c => /Laki AI<\/b>: ask it anything/.test(c.body.text)), 'the hello')
  assert.equal((await rig.rpc('state')).telegram.focus, '@ai')
  // a workspace started through its tool (at Control); an archive refused (not the chat's), said to the model
  or.answers.push(
    call('c1', 'laki_new_workspace', { project: p.id, prompt: 'build a login page', name: 'login' }),
    call('c2', 'laki_archive', { id: 'nope' }), // its ask (aiQuestion) isn't the chat's
    reply({ content: '**Started** `login`: it builds the page.' }),
  )
  b.message('start a task to build a login page')
  await until(() => b.of('sendMessage').some(c => c.body.text === '<b>Started</b> <code>login</code>: it builds the page.'), 'its answer as HTML')
  assert.ok(b.of('sendChatAction').length, 'typing… while it works')
  assert.equal((await rig.rpc('state')).workspaces.length, before + 1)
  assert.match(JSON.stringify(or.hits[2].body.messages), /not from Telegram/, "the archive refused, and the model told")
  assert.match(JSON.stringify(or.hits[0].body.messages), /Telegram, on their phone/, 'it knows where you are')
  assert.equal((await rig.rpc('aiState', {})).chat.find((x: any) => x.role === 'user')?.text, 'start a task to build a login page', "the AI page's chat has it")
  // a photo goes as its picture
  or.answers.push(reply({ content: 'A tiny JPEG.' }))
  b.message('what is this?', { photo: [{ file_id: 'p1', file_size: 7 }] })
  await until(() => b.of('sendMessage').some(c => c.body.text === 'A tiny JPEG.'), 'about the photo')
  assert.match(JSON.stringify(or.hits.at(-1)!.body.messages.at(-1)), /image_url/)
  // Recording mode: a private workspace stays out of it, though its id is known
  const priv = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'secret' })
  await until(async () => (await rig.tab(priv.id))?.status === 'idle', 'secret up')
  await rig.rpc('wsSet', { id: priv.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  or.answers.push(call('c3', 'laki_screen', { target: priv.id }), reply({ content: 'Hidden.' }))
  b.message('show its screen')
  await until(() => b.of('sendMessage').some(c => c.body.text === 'Hidden.'), 'answered')
  assert.match(JSON.stringify(or.hits.at(-1)!.body.messages), /hidden from Telegram/)
  await rig.rpc('settingsSet', { recording: false })
  // Notify: nothing is read, but a pairing code's poll: then a menu's button answers nothing
  await rig.rpc('telegramSet', { level: 'notify' })
  await rig.rpc('telegramPair')
  b.tap('nav:a')
  await until(() => b.of('answerCallbackQuery').some(c => /pushes only/.test(c.body.text ?? '')), 'a tap refused')
  await rig.rpc('telegramSet', { level: 'control' })
  // Titles only, or a CLI backend: refused before anything goes
  const n = or.hits.length
  await rig.rpc('telegramSet', { detail: 'titles' })
  b.message('and now?')
  await until(() => b.of('sendMessage').some(c => /Titles only is on/.test(c.body.text)), 'titles only')
  await rig.rpc('telegramSet', { detail: 'full' })
  await rig.rpc('settingsSet', { ai: { backend: 'claude' } })
  b.message('and now?')
  await until(() => b.of('sendMessage').some(c => /doesn't answer from Telegram/.test(c.body.text)), 'a CLI backend')
  assert.equal(or.hits.length, n, 'nothing asked')
  b.message('/talk off')
  await until(async () => !(await rig.rpc('state')).telegram.focus, 'stopped')
})
