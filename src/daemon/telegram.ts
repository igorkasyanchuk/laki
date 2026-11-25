// Telegram (Settings › Telegram): your own bot (made in @BotFather), paired with you in its private chat. Only this Mac
// calls Telegram: one long poll (getUpdates, 50 s) while it's paired and answers, or while a pairing code waits; nothing
// listens here. The bot's token in the Keychain (keychain.ts; else <data>/telegram-token, 0600), never in state.json,
// the view, a log or an error (scrub: a URL holds it). Only the paired user in their private chat counts; anyone else
// is ignored without a word. What it may do is its level (types.ts TgLevel); what goes out goes through phone.ts' rules
// (Do not disturb, mute, Recording mode, titles only) and redact, a message a second at most.
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { readCapped, writeAtomic } from '../shared/conn.ts'
import { esc, mdToTg } from '../shared/tgmd.ts'
import { type Tab, type Telegram, type TelegramView, type TgLevel, tgBackend, type Webhook } from '../shared/types.ts'
import { LIMITS, limitsOf } from './clients.ts'
import { changed, fileSave, imageSave, log, prs, resolveTarget, rtOf, save, sessions, state, tracked } from './core.ts'
import { dir } from './dir.ts'
import { keyRead, keyUnread, keyWrite } from './keychain.ts'
import { askOfMsg, hidden, pickedFor, takeTap, tgDrop } from './phone.ts'
import { activity, activityList, clip80 } from './remoteLog.ts'
import { type Push, pushText, tapOf } from './push.ts'
import { redact } from './share.ts'

// the Bot API: Telegram's, or tests' fake on this Mac (LAKI_TELEGRAM_API, as fun.ts' LAKI_MEME_API)
const API = () => (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.LAKI_TELEGRAM_API ?? '') ? process.env.LAKI_TELEGRAM_API! : 'https://api.telegram.org')
const POLL_S = 50 // getUpdates' timeout
const GAP = () => Number(process.env.LAKI_TG_GAP_MS ?? 1000) // between two messages out (Telegram's 1 a second per chat; tests' shorter)
const STALE = 120_000 // an update older than this (Telegram keeps them a day): dropped, a /new sent to a Mac asleep never runs in the morning
const PAIR_MS = Number(process.env.LAKI_TG_PAIR_MS) || 10 * 60_000 // tests' shorter
const KEY = 'telegram'
const keyFile = () => join(dir, 'telegram-token')
const token = () => keyRead(KEY, keyFile())
const T = (): Telegram => (state.telegram ??= {})
const RANK: Record<TgLevel, number> = { notify: 0, answer: 1, control: 2 }
export const levelOf = (t = state.telegram): TgLevel => (t?.level && Object.hasOwn(RANK, t.level) ? t.level : 'answer')
export const levelAtLeast = (l: TgLevel) => RANK[levelOf()] >= RANK[l]
// pushes go: a bot and a paired user, not turned off
export const tgOn = () => !!state.telegram?.keyed && !!state.telegram.user && !state.telegram.off
// its buttons answer: answer or control, and more than titles go
export const tgAnswers = () => tgOn() && levelAtLeast('answer') && state.telegram?.detail !== 'titles'

// a bot token's shape (BotFather's <id>:<35 characters>), and every place one could show: a URL, an error
export const TOKEN = /^\d{5,15}:[\w-]{30,60}$/
export const scrub = (s: string, tok = token()) => (tok ? s.split(tok).join('•••') : s).replace(/\d{5,15}:[\w-]{30,60}/g, '•••')
// Telegram's HTML: &, < and > escaped in everything that isn't a tag of ours (tgmd.ts' esc); an agent's Markdown as its tags (mdToTg)
export { esc }

class TgError extends Error {
  code: number
  retry: number
  constructor(m: string, code = 0, retry = 0) {
    super(m)
    this.code = code
    this.retry = retry
  }
}
// signal: over at once as it aborts; its listener goes either way (a long offline run adds none up)
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(r => {
    if (signal?.aborted) return r()
    const done = () => (clearTimeout(t), signal?.removeEventListener('abort', done), r())
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
// one Bot API call: POST JSON, its result, or a TgError with Telegram's code (-1: no answer) and words, scrubbed
async function tg<R = unknown>(method: string, body: object = {}, o: { signal?: AbortSignal; tok?: string } = {}): Promise<R> {
  const tok = o.tok ?? token()
  if (!tok) throw new TgError('no bot yet: paste its token in Settings › Telegram')
  let res: Response
  try {
    res = await fetch(`${API()}/bot${tok}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: o.signal ?? AbortSignal.timeout(15_000), redirect: 'error' })
  } catch (e) {
    throw new TgError(scrub(`Telegram didn't answer (${(e as Error).message})`, tok), -1)
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: R; error_code?: number; description?: string; parameters?: { retry_after?: number } }
  if (!j.ok) throw new TgError(scrub(`Telegram: ${j.description ?? `${res.status}`}`, tok), j.error_code ?? res.status, j.parameters?.retry_after ?? 0)
  return j.result as R
}
// what goes out, in order, GAP apart; Telegram's 429 waited out once
let queue: Promise<unknown> = Promise.resolve()
let lastOut = 0
function out<R = unknown>(method: string, body: object): Promise<R> {
  const run = async (): Promise<R> => {
    const wait = lastOut + GAP() - Date.now()
    if (wait > 0) await sleep(wait)
    lastOut = Date.now()
    try {
      return await tg<R>(method, body)
    } catch (e) {
      // an agent's Markdown whose tags Telegram can't take (they overlap, or nest where it won't): the same words, plain
      if (e instanceof TgError && e.code === 400 && /parse entities|can't find end/i.test(e.message) && 'parse_mode' in body) return tg<R>(method, { ...body, parse_mode: undefined, text: plainOf(String((body as { text?: unknown }).text ?? '')) })
      if (!(e instanceof TgError) || e.code !== 429 || !e.retry) throw e
      await sleep(Math.min(e.retry, 300) * 1000)
      lastOut = Date.now()
      return tg<R>(method, body)
    }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}
const chat = () => T().user!.id
// our HTML's words without its tags, as plain text
const plainOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
// main.ts' gate for what a message makes Laki do (TELEGRAM_OK at its level, remote access's answer-level checks), then the call
type AiRpc = (method: string, params?: Record<string, unknown>) => Promise<any>
// ai: main.ts' aiAsk; aiPick: its aiAnswer (a laki_ask button's tap); aiAsked: Laki AI's open plain question, if any
export const tgHooks: { call?: (method: string, params: Record<string, unknown>) => Promise<unknown>; ai?: (p: { text: string; images: string[]; context: string }, rpc: AiRpc) => Promise<{ text?: string }>; aiPick?: (p: { id: string; n: number; context: string }, rpc: AiRpc) => Promise<{ text?: string }>; aiAsked?: () => { id: string; text: string; options: string[] } | undefined } = {}
// P3: trusted clients' limits (clients.ts LIMITS): messages and answers a sliding minute, workspaces a sliding hour
const used: Record<'send' | 'ws', number[]> = { send: [], ws: [] }
function spend(kind: 'send' | 'ws') {
  const l0 = process.env.LAKI_TG_LIMITS ? limitsOf(process.env.LAKI_TG_LIMITS) : LIMITS // tests' smaller (ws=1,send=2)
  const [n, ms] = kind === 'ws' ? [l0.wsPerHour, 3_600_000] : [l0.sendsPerMinute, 60_000]
  const now = Date.now()
  const l = (used[kind] = used[kind].filter(at => at > now - ms))
  if (l.length >= n) throw new Error(kind === 'ws' ? `${n} new workspaces an hour from Telegram at most` : `${n} messages a minute from Telegram at most`)
  l.push(now)
}
// P3: what Telegram did, for you to look back at (remoteLog.ts' log, <data>/telegram-log.jsonl): a line per action or
// refusal, a message's first 80 characters, never a secret
const said = (line: string) => activity({ device: 'Telegram', line }, Date.now(), 'telegram-log')
export const telegramLog = (p: { n?: unknown } = {}) => activityList(Math.min(1000, Math.max(1, Number(p?.n) || 200)), 'telegram-log')
const tabWords = (id: unknown) => (t => (t ? `${state.workspaces.find(w => w.id === t.workspace)?.name ?? t.workspace} · ${t.name}` : String(id)))(state.tabs.find(x => x.id === id))
const lineOf = (method: string, p: Record<string, unknown>) =>
  method === 'send' ? `to ${tabWords(p.target)}: "${clip80(p.text)}"` : method === 'answer' ? `answered ${tabWords(p.tab)}: ${clip80(p.label ?? p.n)}` : method === 'wsNew' ? `new workspace in ${p.project}: "${clip80(p.prompt)}"` : method === 'dndSet' ? (p.off ? 'Do not disturb off' : `Do not disturb for ${p.minutes} minutes`) : method === 'stopAll' ? `stopped ${tabWords(p.tab)}` : method === 'aiQuestion' ? `Laki AI asked: "${clip80(p.text)}"` : method === 'prAct' ? `merged ${String(p.ws)}'s PR` : `${method}${p.ws || p.target ? ` (${p.ws ?? tabWords(p.target)})` : ''}`
const READ = new Set(['state', 'screen', 'diff', 'chatRead']) // chatRead: a card's last reply, read as it shows
async function act<R = unknown>(method: string, params: Record<string, unknown>): Promise<R> {
  try {
    if (!tgHooks.call) throw new Error('not ready')
    if (method === 'send' || method === 'answer') spend('send')
    if (method === 'wsNew') spend('ws')
    const r = (await tgHooks.call(method, params)) as R
    if (!READ.has(method)) said(lineOf(method, params))
    return r
  } catch (e) {
    said(`refused ${lineOf(method, params)}: ${(e as Error).message}`)
    throw e
  }
}

// P2: which tab each pushed message is about, so a reply to it goes there: the newest 500, in <data>/telegram-msgs.json
const MSGS = 500
let msgs: Map<number, string> | undefined
const msgFile = () => join(dir, 'telegram-msgs.json')
function msgMap() {
  if (msgs) return msgs
  try {
    msgs = new Map(JSON.parse(readFileSync(msgFile(), 'utf8')) as [number, string][])
  } catch {
    msgs = new Map()
  }
  return msgs
}
// a new bot or none, or unpaired: the old chat's ids mean nothing (a new chat's could collide)
function forget() {
  msgs = new Map()
  rmSync(msgFile(), { force: true })
  tgDrop() // its asks' message ids: never edited or answered in another chat
}
function remember(msg: number, tab: string) {
  const m = msgMap()
  m.delete(msg)
  m.set(msg, tab)
  for (const k of m.keys()) if (m.size > MSGS) m.delete(k)
  try {
    writeAtomic(msgFile(), JSON.stringify([...m]), 0o600)
  } catch (e) {
    log(`telegram: ${(e as Error).message}`)
  }
}

// ---------- pushes (phone.ts): a message each, its buttons a tap each (callback_data nonce:n), a done one silent
type Msg = { message_id: number }
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
// its HTML: the title bold, the rest the agent's Markdown as Telegram's tags (a long one folded: blockquote expandable,
// unless it holds code or a quote of its own: those don't nest), secrets' shapes masked; the choices as lines when no
// buttons go (choices)
export function tgHtml(p: Push, choices = false) {
  const { title, body } = pushText(choices ? p : { ...p, options: undefined })
  const b = redact(cut(body, 3000))
  const h = mdToTg(b)
  const fold = (b.length > 300 || b.split('\n').length > 6) && !/<(pre|blockquote)>/.test(h)
  return `<b>${esc(redact(title))}</b>${b ? (fold ? `\n<blockquote expandable>${h}</blockquote>` : `\n${h}`) : ''}`
}
// titles only: who needs you, nothing off the screen
const shown = (p: Push): Push => (state.telegram?.detail === 'titles' ? { ...p, question: undefined, options: undefined, nonce: undefined } : p)
// a push to the paired chat: its message's id (for tgDone's edit), or undefined
export async function tgPush(p: Push): Promise<number | undefined> {
  if (!tgOn()) return
  p = shown(p)
  const taps = p.nonce && p.options?.length && tgAnswers() ? p.options : []
  const markup = taps.length ? { inline_keyboard: taps.map(o => [{ text: cut(`${o.n}. ${o.label}`, 60), callback_data: `${p.nonce}:${o.n}` }]) } : p.url ? { inline_keyboard: [[{ text: 'Open it', url: p.url }]] } : undefined
  const msg = (thread?: number) => out<Msg>('sendMessage', { chat_id: chat(), text: tgHtml(p, !taps.length), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(thread && { message_thread_id: thread }), ...(p.event === 'done' && { disable_notification: true }), ...(markup && { reply_markup: markup }) })
  const thread = await threadOf(p.tab)
  const m = await msg(thread).catch(async (e: Error) => {
    // its topic deleted or closed in Telegram (thread not found, TOPIC_CLOSED): forgotten, then a new one (or the chat)
    if (!thread || !(e instanceof TgError) || e.code !== 400 || !/thread|topic/i.test(e.message)) throw e
    for (const [ws, id] of Object.entries(state.telegram?.threads ?? {})) if (id === thread) delete state.telegram!.threads![ws]
    save()
    return msg(await threadOf(p.tab))
  })
  if (m?.message_id && p.tab) remember(m.message_id, p.tab) // a reply to it goes to its tab
  return m?.message_id
}
// an ask answered (said: what was picked) or gone: its message says so, its buttons gone (an empty keyboard)
export function tgDone(msg: number, p: Push, said: string) {
  if (!state.telegram?.user) return
  out('editMessageText', { chat_id: chat(), message_id: msg, text: `${tgHtml(shown(p))}\n<i>${esc(said)}</i>`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(e => log(`telegram: ${(e as Error).message}`))
}
const say = (text: string, thread?: number) => out('sendMessage', { chat_id: chat(), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(thread && { message_thread_id: thread }) }).catch(e => log(`telegram: ${(e as Error).message}`))
// an answer where the message was: its topic (P4), else the chat
const sayIn = (m: { message_thread_id?: number }, text: string) => say(text, m.message_thread_id)

// ---------- P4: a topic per workspace in the private chat (settings' topics, and the bot's own: BotFather's topics on,
// getMe's has_topics_enabled): made as its first push goes (createForumTopic), its pushes in it (message_thread_id),
// plain words there to its agent, gone with the workspace (deleteForumTopic). Off, or none made: the chat as it is
export const topicsOn = () => !!state.telegram?.topics && !!state.telegram.bot?.topics
const COLORS = [7322096, 16766590, 13338331, 9367192, 16749490, 16478047] // the six a topic's icon may be
const making = new Map<string, Promise<number | undefined>>() // a workspace's topic on its way: one, however many pushes
async function threadOf(tab?: string) {
  const ws = tab && state.workspaces.find(w => w.id === state.tabs.find(t => t.id === tab)?.workspace)
  if (!ws || !topicsOn()) return
  const had = state.telegram?.threads?.[ws.id]
  if (had) return had
  if (!making.has(ws.id))
    making.set(
      ws.id,
      out<{ message_thread_id: number }>('createForumTopic', { chat_id: chat(), name: cut(ws.name || ws.id, 128), icon_color: COLORS[[...ws.id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length] }) // ponytail: a color by its id, not its own color's nearest
        .then(
          r => {
            if (!state.workspaces.some(w => w.id === ws.id)) return void out('deleteForumTopic', { chat_id: chat(), message_thread_id: r.message_thread_id }).catch(() => {}) // gone meanwhile
            ;(T().threads ??= {})[ws.id] = r.message_thread_id
            save()
            return r.message_thread_id
          },
          (e: TgError): undefined => {
            log(`telegram: ${scrub(e.message)}`)
            if (e.code !== 400 && e.code !== 403) return // offline, or Telegram busy: this push in the chat, a topic next time
            Object.assign(T(), { topics: false, notice: `Topics are off: Telegram didn't make one (${scrub(e.message)}). Turn topics on for the bot in @BotFather, then here again` })
            save()
            changed()
          },
        )
        .finally(() => making.delete(ws.id)),
    )
  return making.get(ws.id)
}
// a workspace gone (core's dropWs): its topic too
export function tgWsGone(ws: string) {
  if (state.telegram?.focus === ws) state.telegram.focus = undefined // talked to: gone with it
  const id = state.telegram?.threads?.[ws]
  if (!id) return
  delete state.telegram!.threads![ws]
  if (tgOn()) out('deleteForumTopic', { chat_id: chat(), message_thread_id: id }).catch(e => log(`telegram: ${(e as Error).message}`))
}
// the workspace a topic is (its thread id), shown (not archived, nor Recording mode's)
const wsOfThread = (thread?: number) => (thread ? Object.entries(state.telegram?.threads ?? {}).find(([, id]) => id === thread)?.[0] : undefined)

// ---------- pairing: a one-time code (128 bits) for 10 minutes, shown only in Laki's window as t.me/<bot>?start=<code>
let pair: { code: string; until: number } | undefined
export function telegramPair() {
  const bot = state.telegram?.bot
  if (!bot || !token()) throw new Error('paste your bot\'s token first (step 1)')
  pair = { code: randomBytes(16).toString('base64url'), until: Date.now() + PAIR_MS } // 22 characters of A-Z a-z 0-9 _ -: a start parameter takes 64
  sync()
  changed()
  return { link: `https://t.me/${bot.username}?start=${pair.code}`, until: pair.until }
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// ---------- the long poll: one getUpdates at a time, its own loop (not a tick), stopped by its AbortController
type User = { id: number; first_name?: string; last_name?: string; username?: string }
type Chat = { id: number; type: string }
type TgFile = { file_id: string; file_size?: number }
type TgMessage = { message_id: number; from?: User; chat: Chat; date: number; text?: string; caption?: string; reply_to_message?: { message_id: number }; photo?: TgFile[]; document?: TgFile & { file_name?: string }; voice?: TgFile; audio?: TgFile; message_thread_id?: number }
type Update = { update_id: number; message?: TgMessage; callback_query?: { id: string; from: User; message?: { message_id: number; chat: Chat }; data?: string } }
let ctl: AbortController | undefined
let offset = 0
let lastOk = 0 // a poll answered then: a tap waiting since before a gap may be from hours ago (a callback has no date)
let ignored = 0 // updates from anyone else, since the last log line
// it runs while a pairing code waits, or paired, on, and at answer or control
const wanted = () => !!state.telegram?.keyed && (!!pair && pair.until > Date.now() ? true : tgOn() && levelAtLeast('answer'))
export function sync() {
  if (wanted() && !ctl) void loop()
  else if (!wanted() && ctl) ctl.abort(), (ctl = undefined)
}
const stop = (notice: string, off = false) => {
  Object.assign(T(), { notice }, off && { off: true })
  pair = undefined
  log(`telegram: ${notice}`)
  said(`stopped: ${notice}`)
  ctl?.abort()
  ctl = undefined
  save()
  changed()
}
async function loop() {
  const c = (ctl = new AbortController())
  let wait = 1000
  let failed = ''
  let behind = false // after a gap: what waited is read at once (timeout 0) until a batch isn't full, and is old
  changed()
  while (!c.signal.aborted) {
    if (!wanted()) break // a pairing code ran out
    try {
      if (!lastOk || Date.now() - lastOk > STALE) behind = true
      const ups = await tg<Update[]>('getUpdates', { offset, timeout: behind ? 0 : POLL_S, allowed_updates: ['message', 'callback_query'] }, { signal: AbortSignal.any([c.signal, AbortSignal.timeout((POLL_S + 15) * 1000)]) })
      const gap = behind // a long poll's answer came as you tapped: fresh
      if (ups.length < 100) behind = false // getUpdates gives 100 at most
      lastOk = Date.now()
      wait = 1000
      if (failed) log('telegram: reached again'), (failed = '')
      if (!state.telegram?.bot) void named() // its name not known yet (offline as Laki started)
      for (const u of ups) {
        if (c.signal.aborted) break // a new loop reads the rest from this offset: never twice
        offset = Math.max(offset, u.update_id + 1)
        await take(u, gap).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
      }
    } catch (e) {
      if (c.signal.aborted) break
      const err = e as TgError
      if (err.code === 409) return stop('Another program reads this bot (or it has a webhook): use a bot made only for Laki. Laki stopped listening; nothing of the other one was changed')
      if (err.code === 401) return stop("Telegram refused the bot's token (revoked, or the bot deleted): paste a new one", true)
      if (!token() && !keyUnread(KEY)) return stop("Laki has no bot token now (the Keychain didn't give it, or a backup from another Mac): Try again, else Remove bot and paste its token again") // unread (wrapped, Laki's window not open yet; the Keychain didn't answer): tried again below
      if (err.code === 429 && err.retry) await sleep(Math.min(err.retry, 300) * 1000, c.signal)
      else {
        if (err.message !== failed) log(`telegram: ${(failed = err.message)}`)
        await sleep(wait, c.signal)
        wait = Math.min(wait * 2, 60_000) // 1, 2, 4… 60 s
      }
    }
  }
  if (ctl === c) ctl = undefined
  changed()
}
const nameOf = (u: User) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'you'
// an update: only the paired user in their private chat (or the pairing code's sender), else nothing at all
async function take(u: Update, gap: boolean) {
  const q = u.callback_query
  const m = u.message
  const from = q?.from ?? m?.from
  const where = q?.message?.chat ?? m?.chat
  if (!from || !where || where.type !== 'private' || where.id !== from.id) return void ignore()
  // /start <code>: pairs whoever sends the code first while it waits; a code is used once
  const code = /^\/start(?:@\w+)?\s+([\w-]{1,64})$/.exec(m?.text?.trim() ?? '')?.[1]
  if (m && code && pair && pair.until > Date.now() && same(code, pair.code) && Date.now() / 1000 - m.date < STALE / 1000) {
    pair = undefined
    const was = state.telegram?.user
    if (was?.id !== from.id) commandsGone(), forget(), (T().level = 'answer') // another person: from Answer, as every pairing starts; the old chat's menu gone
    Object.assign(T(), { user: { id: from.id, name: nameOf(from), at: Date.now() }, notice: undefined, off: undefined, threads: was?.id === from.id ? state.telegram?.threads : undefined, focus: was?.id === from.id ? state.telegram?.focus : undefined })
    T().level ??= 'answer'
    save()
    changed()
    log(`telegram: paired with ${nameOf(from)}`)
    said(`paired with ${nameOf(from)}`)
    void say(`<b>Paired with Laki.</b> Pushes from this Mac come here; what this chat may do is set in Laki's Settings › Telegram (now: <b>${levelOf()}</b>).${levelAtLeast('answer') ? ' Reply to a push to talk to its agent, or /menu to open a workspace and talk to it (type, or send a voice note); /status for who needs you.' : ''}`)
    commandsSet()
    return sync()
  }
  if (from.id !== state.telegram?.user?.id) return void ignore()
  if (!tgOn()) return // turned off (a pairing code's poll reads the chat): nothing acted on
  if (q?.data?.startsWith('nav:')) return void nav(q as Tap, gap).catch(e => void out('answerCallbackQuery', { callback_query_id: q.id, text: cut(`Not done: ${scrub((e as Error).message)}`, 200) }).catch(() => {}))
  if (q) {
    const tap = !gap && tgAnswers() ? tapOf(q.data, '', false) : undefined // titles only: an old push's buttons answer nothing
    let did: string | undefined
    try {
      if (tap) spend('send') // a tap is an answer: the same minute's limit
      did = tap && (await takeTap(tap, true))
      if (did) said(`tapped: ${clip80(did)}`)
    } catch (e) {
      did = (e as Error).message
      said(`refused a tap: ${did}`)
    }
    return void out('answerCallbackQuery', { callback_query_id: q.id, text: cut(gap ? 'Laki was off: that tap is too old' : !tgAnswers() ? 'Titles only is on: answer it on the Mac' : did || 'That ask moved on', 200) }).catch(() => {})
  }
  if (!m) return
  if (Date.now() / 1000 - m.date > STALE / 1000) return void sayIn(m, 'Laki was off when you sent that: send it again.')
  if (!levelAtLeast('answer')) return
  const inWs = wsOfThread(m.message_thread_id)
  const to = m.reply_to_message && msgMap().get(m.reply_to_message.message_id)
  // a voice note: heard (Settings › Voice's cloud), its words shown back, then as if typed
  let heardText: string | undefined
  if (m.voice || m.audio) {
    try {
      heardText = await heard((m.voice ?? m.audio)!)
    } catch (e) {
      return void sayIn(m, `Not heard: ${esc(scrub((e as Error).message))}`)
    }
    if (!heardText) return void sayIn(m, "Not heard: no words in it.")
    void sayIn(m, `🎙 <i>${esc(cut(heardText, 500))}</i>`)
  }
  const text = heardText ?? m.text?.trim() ?? ''
  // a command; in a reply or a topic only a known one (a path like /Users/… is words for the agent)
  const cmd = heardText ? null : /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text)
  const name = cmd?.[1].toLowerCase()
  if (cmd && (!(to || inWs) || name === 'start' || name === 'help' || COMMANDS.some(x => x[0] === name)))
    return command(name!, (cmd[2] ?? '').trim(), m).catch(e => void sayIn(m, `Not done: ${esc(scrub((e as Error).message))}`))
  const tab = (to && (t => t && shownWs(t.workspace) && t.id)(state.tabs.find(x => x.id === to))) || (inWs && shownWs(inWs) ? state.tabs.find(t => t.workspace === inWs && tracked(t))?.id : undefined)
  if (tab) return void (await deliver(tab, m, heardText).then(() => react(m), e => sayIn(m, `Not sent: ${esc(scrub((e as Error).message))}`)))
  if (to || inWs) return void sayIn(m, inWs ? 'This workspace has no agent now.' : 'That agent is gone (or hidden now).')
  // no reply, no topic: Laki AI when you talk to it, a task asked for (➕ New task), else the workspace you talk to
  // (💬 Talk here), else where to?
  if (state.telegram?.focus === AI && !(newIn && newIn.until > Date.now())) return void askAi(m, heardText)
  const words = heardText ?? (await wordsOf(m).catch(e => void sayIn(m, `Not taken: ${esc(scrub((e as Error).message))}`)))
  if (!words) return
  if (newIn && newIn.until > Date.now()) {
    const p = newIn.project
    newIn = undefined
    return void (await started(p, words).then(r => sayIn(m, r), e => sayIn(m, `Not started: ${esc(scrub((e as Error).message))}`)))
  }
  const f = state.telegram?.focus && shownWs(state.telegram.focus) && agentsOf(state.telegram.focus)[0]
  if (f) return void (await act('send', { target: f.id, text: words, whenIdle: true }).then(() => react(m), e => sayIn(m, `Not sent: ${esc(scrub((e as Error).message))}`)))
  return void whereTo(m, words)
}
// a reply's words (and its photo's or file's path) to its tab: a waiting ask's choice when it names one (its number or
// its words), else a message to the agent, queued until it's free (send's whenIdle). Through tgHooks' gate: an agent's
// tab only, the whole message, never a line that starts with !
async function deliver(tab: string, m: TgMessage, heardText?: string) {
  const t = state.tabs.find(x => x.id === tab)
  if (!t) throw new Error('that tab is gone')
  let text = (heardText ?? m.text ?? m.caption ?? '').trim().slice(0, 8000)
  const f = m.photo?.length ? m.photo.at(-1)! : m.document
  const s = sessions.get(tab)
  const ask = rtOf(tab).status === 'waiting' && s && !s.exited ? s.ask() : undefined
  // a choice only in a reply to that ask's own push, still the same menu, where Telegram answers (not titles only): "yes"
  // to an older one is words, never an Allow
  const a = m.reply_to_message && askOfMsg(m.reply_to_message.message_id)
  const own = !f && !!ask && tgAnswers() && a?.tab === tab && a.key === JSON.stringify(ask.options)
  const o = own ? ask.options.find(x => String(x.n) === text || x.label.toLowerCase() === text.toLowerCase()) : undefined
  if (o) return void (await act('answer', { tab, n: o.n, label: o.label }), pickedFor(tab, `Picked: ${o.label}`))
  if (f) text = `${text ? `${text}\n` : ''}${await fileIn(f, !m.photo?.length && m.document?.file_name)}`
  if (!text) throw new Error('nothing to send')
  await act('send', { target: tab, text, whenIdle: true })
  if (ask) void sayIn(m, `Queued: ${esc(t.name)} asks something first (${tgAnswers() ? "reply to its question's message with a choice's number to answer it" : 'Titles only is on: answer it on the Mac'}).`)
}
// a photo or a file from the chat into Laki's images or files (core's imageSave, fileSave): its path. Telegram gives a
// bot 20 MB at most
const FILE_MAX = 20 << 20
async function download(f: TgFile) {
  if ((f.file_size ?? 0) > FILE_MAX) throw new Error('over 20 MB: Telegram gives bots 20 MB at most')
  const got = await tg<{ file_path?: string }>('getFile', { file_id: f.file_id })
  if (!got.file_path) throw new Error("Telegram didn't give the file")
  const tok = token()
  const res = await fetch(`${API()}/file/bot${tok}/${got.file_path}`, { signal: AbortSignal.timeout(60_000), redirect: 'error' }).catch((e: Error) => {
    throw new Error(scrub(`Telegram didn't send the file (${e.message})`, tok))
  })
  if (!res.ok) throw new Error(`Telegram didn't send the file (${res.status})`)
  const { buf, cut } = await readCapped(res, FILE_MAX)
  if (cut) throw new Error('over 20 MB')
  return { buf, path: got.file_path }
}
async function fileIn(f: TgFile, name: string | false | undefined) {
  const { buf, path } = await download(f)
  const got = { file_path: path }
  const ext = extname(got.file_path).slice(1).toLowerCase()
  return name || !['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? fileSave({ name: name || basename(got.file_path), data: buf.toString('base64') }) : imageSave({ data: buf.toString('base64'), ext })
}
// ---------- navigation by buttons (/menu): Projects › a project's workspaces › a workspace's card, each in the same
// message (edited), ◀ ▶ a page of PAGE, ⬆ ⬇ the workspace before or after, ⬅ back up. A card: its agents' state and the
// last thing its agent said (Markdown as Telegram's tags), 💬 Talk here (plain words go to its agent from then on),
// 📺 Screen, 📝 Diff (each in the card's place, ⬅ Back to it, 🔄 Again), ➕ New task (Control: the next message, typed or said, is its task). A button's data names a
// project or workspace by a short key this daemon gave (Telegram takes 64 bytes): one from before a restart says to open
// /menu again. Archived workspaces and Recording mode's private ones are never listed (shownWs)
const PAGE = 8
const navKeys = new Map<string, string>()
const navIds = new Map<string, string>()
const kOf = (id: string) => navKeys.get(id) ?? (k => (navKeys.set(id, k), navIds.set(k, id), k))(navKeys.size.toString(36))
const idOfK = (k: string, kind: 'p' | 'w') => (id => (id?.startsWith(`${kind}:`) ? id.slice(2) : undefined))(navIds.get(k))
type Btn = { text: string; callback_data: string }
type NavView = { text: string; kb: Btn[][] }
type Tap = { id: string; data: string; message?: { message_id: number; chat: Chat } }
const btn = (text: string, data: string): Btn => ({ text: cut(text, 60), callback_data: data })
const projectsOk = () => state.projects.filter(x => !x.kind && !x.archived && !(state.settings?.recording && x.private))
const wsIn = (p: string) => state.workspaces.filter(w => w.project === p && shownWs(w.id))
const agentsOf = (ws: string) => state.tabs.filter(t => t.workspace === ws && tracked(t))
const wsState = (ws: string) => (st => (st.some(r => r.status === 'waiting') ? 'waiting' : st.some(r => r.status === 'running') ? 'running' : st.some(r => r.done) ? 'done' : st.length ? 'idle' : 'none'))(agentsOf(ws).map(t => rtOf(t.id)))
const DOTS: Record<string, string> = { waiting: '🟡', running: '🔵', done: '🟢', idle: '⚪', none: '▫️' }
const wsName = (id: string) => (w => (w ? w.name || w.id : id))(state.workspaces.find(x => x.id === id))
// ◀ n/m ▶ under a list longer than a page
const pager = (n: number, at: number, data: (page: number) => string): Btn[][] =>
  n <= PAGE ? [] : [[...(at > 0 ? [btn('◀', data(at - 1))] : []), btn(`${at + 1}/${Math.ceil(n / PAGE)}`, 'nav:noop'), ...((at + 1) * PAGE < n ? [btn('▶', data(at + 1))] : [])]]
const pageOf = (n: number, page: number) => Math.min(Math.max(0, page), Math.max(0, Math.ceil(n / PAGE) - 1))
const talkLine = () => (f => (f ? `\n💬 Your messages go to <b>${f === AI ? 'Laki AI' : esc(wsName(f))}</b> (/talk off stops it)` : ''))(state.telegram?.focus === AI || (state.telegram?.focus && shownWs(state.telegram.focus)) ? state.telegram.focus : undefined)
function projectsView(page = 0): NavView {
  const ps = projectsOk()
  const at = pageOf(ps.length, page)
  const rows = ps.slice(at * PAGE, (at + 1) * PAGE).map(p => {
    const ws = wsIn(p.id)
    const n = (s: string) => ws.filter(w => wsState(w.id) === s).length
    return [btn(`📁 ${p.name} · ${ws.length}${n('waiting') ? ` · 🟡${n('waiting')}` : ''}${n('running') ? ` · 🔵${n('running')}` : ''}`, `nav:p:${kOf(`p:${p.id}`)}`)]
  })
  return { text: ps.length ? `<b>Projects</b> · ${ps.length}${talkLine()}` : 'No projects yet: add one in Laki on your Mac.', kb: [...rows, ...pager(ps.length, at, n => `nav:P:${n}`), [btn(state.telegram?.focus === AI ? '🤖 Laki AI 💬' : '🤖 Laki AI', 'nav:a'), btn('🔄 Refresh', `nav:P:${at}`)]] }
}
function projectView(id: string, page = 0): NavView | undefined {
  const p = projectsOk().find(x => x.id === id)
  if (!p) return
  const ws = wsIn(p.id)
  const at = pageOf(ws.length, page)
  const pk = kOf(`p:${p.id}`)
  return {
    text: `<b>${esc(p.name)}</b> · ${ws.length} workspace${ws.length === 1 ? '' : 's'}${ws.length ? '\n🟡 needs you · 🔵 working · 🟢 done' : ''}${talkLine()}`,
    kb: [
      ...ws.slice(at * PAGE, (at + 1) * PAGE).map(w => [btn(`${DOTS[wsState(w.id)]} ${w.name || w.id}${state.telegram?.focus === w.id ? ' 💬' : ''}`, `nav:w:${kOf(`w:${w.id}`)}`)]),
      ...pager(ws.length, at, n => `nav:p:${pk}:${n}`),
      [btn('⬅ Projects', 'nav:P:0'), ...(levelAtLeast('control') ? [btn('➕ New task', `nav:n:${pk}`)] : []), btn('🔄', `nav:p:${pk}:${at}`)],
    ],
  }
}
// the last thing its agent said (the Reader's chat), for its card
async function lastSaid(tab?: string) {
  if (!tab) return ''
  const r = await act<{ said?: { who: string; text: string }[] }>('chatRead', { tab }).catch(() => undefined)
  return [...(r?.said ?? [])].reverse().find(x => x.who === 'agent')?.text?.trim() ?? ''
}
async function wsView(id: string): Promise<NavView | undefined> {
  const w = shownWs(id)
  if (!w) return
  const list = wsIn(w.project)
  const i = list.findIndex(x => x.id === w.id)
  const titles = state.telegram?.detail === 'titles'
  const tabs = agentsOf(w.id)
  const k = kOf(`w:${w.id}`)
  const talking = state.telegram?.focus === w.id
  const lines = tabs.map(t => (r => `${DOTS[r.status === 'waiting' ? 'waiting' : r.status === 'running' ? 'running' : r.done ? 'done' : 'idle']} ${esc(t.name)}: ${r.status === 'waiting' ? 'needs you' : r.status === 'running' ? 'working' : r.done ? 'done' : r.status}${!titles && r.status === 'waiting' && r.perm ? `\n<code>${esc(redact(cut(`${r.perm.tool}: ${r.perm.what}`, 160)))}</code>` : ''}`)(rtOf(t.id)))
  const last = titles ? '' : await lastSaid(tabs[0]?.id)
  const proj = state.projects.find(x => x.id === w.project)
  return {
    text: [`<b>${esc(w.name || w.id)}</b> in ${esc(proj?.name ?? w.project)}${w.branch ? ` · <code>${esc(w.branch)}</code>` : ''}`, ...(lines.length ? lines : ['No agent in it now.']), ...(last ? ['', mdToTg(redact(cut(last, 1500)))] : []), ...(talking ? ['', '💬 Your messages go here.'] : [])].join('\n'),
    kb: [
      [...(tabs.length ? [btn(talking ? '🔇 Stop talking here' : '💬 Talk here', `nav:t:${k}`)] : []), ...(titles || !tabs.length ? [] : [btn('📺 Screen', `nav:s:${k}`), btn('📝 Diff', `nav:d:${k}`)])],
      [...(levelAtLeast('control') && tabs.some(t => rtOf(t.id).status === 'running') ? [btn('⏹ Stop', `nav:x:${k}`)] : []), ...(levelAtLeast('control') && greenPr(w.id) ? [btn(`🔀 Merge #${greenPr(w.id)!.number}`, `nav:m1:${k}`)] : [])],
      [...(i > 0 ? [btn('⬆ Previous', `nav:w:${kOf(`w:${list[i - 1].id}`)}`)] : []), ...(i >= 0 && i < list.length - 1 ? [btn('⬇ Next', `nav:w:${kOf(`w:${list[i + 1].id}`)}`)] : [])],
      [btn(`⬅ ${proj?.name ?? 'Back'}`, `nav:p:${kOf(`p:${w.project}`)}:${Math.floor(Math.max(0, i) / PAGE)}`), btn('🔄', `nav:w:${k}`)],
    ].filter(r => r.length),
  }
}
const sendView = (m: { message_thread_id?: number }, v: NavView) => out('sendMessage', { chat_id: chat(), text: v.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(m.message_thread_id && { message_thread_id: m.message_thread_id }), reply_markup: { inline_keyboard: v.kb } }).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
// what you send with no reply, topic or Talk here: kept 10 minutes as a key, Where should this go? with an agent's
// button each (the newest six) and, at Control, a new workspace in a project with it as the task
const pend = new Map<string, { text: string; until: number }>()
let pendN = 0
let newIn: { project: string; until: number } | undefined // ➕ New task's project: the next message is its task
const TEN_MIN = 10 * 60_000
function whereTo(m: TgMessage, words: string) {
  for (const [k, v] of pend) if (v.until < Date.now() || pend.size > 50) pend.delete(k)
  const k = (++pendN).toString(36)
  pend.set(k, { text: words, until: Date.now() + TEN_MIN })
  const agents = state.workspaces.filter(w => shownWs(w.id) && agentsOf(w.id).length).slice(-6).reverse()
  const kb = [...(aiNo() ? [] : [[btn('🤖 Laki AI', `nav:ta:${k}`)]]), ...agents.map(w => [btn(`💬 ${w.name || w.id}`, `nav:to:${k}:${kOf(`w:${w.id}`)}`)]), ...(levelAtLeast('control') ? projectsOk().slice(0, 6).map(p => [btn(`➕ New in ${p.name}`, `nav:mk:${k}:${kOf(`p:${p.id}`)}`)]) : [])]
  if (!kb.length) return void sayIn(m, 'Nothing to send it to: no agent here, and starting one needs the Control level (Settings › Telegram).')
  void out('sendMessage', { chat_id: chat(), text: 'Where should this go? Laki AI, an agent, or a new workspace with it as its task. (A reply to a push, or 💬 Talk here in /menu, skips this.)', ...(m.message_thread_id && { message_thread_id: m.message_thread_id }), reply_parameters: { message_id: m.message_id }, reply_markup: { inline_keyboard: kb } }).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
}
// a new workspace from the chat (Control): talked to from then on
async function started(project: string, task: string) {
  const p = projectsOk().find(x => x.id === project)
  if (!p) throw new Error('that project is gone, or hidden now')
  const w = await act<{ id: string; name?: string }>('wsNew', { project: p.id, prompt: task })
  T().focus = w.id
  save()
  return `Started <b>${esc(w.name ?? w.id)}</b> in ${esc(p.name)}. Your next messages go to it (/talk off stops that); its pushes come here.`
}
// a tap on a menu's button: its view in place, or what it does
async function nav(q: Tap, gap: boolean) {
  const [, kind, a = '', c = ''] = q.data.split(':')
  const ans = (text?: string) => void out('answerCallbackQuery', { callback_query_id: q.id, ...(text && { text: cut(text, 200) }) }).catch(() => {})
  const old = () => ans('That menu is from before Laki restarted: /menu again')
  const edit = (text: string, kb: Btn[][] = []) => (q.message ? out('editMessageText', { chat_id: chat(), message_id: q.message.message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: kb } }).catch((e: Error) => void (/not modified/i.test(e.message) || log(`telegram: ${scrub(e.message)}`))) : Promise.resolve())
  const show = async (v: NavView | undefined, said?: string) => (v ? (await edit(v.text, v.kb), ans(said)) : old())
  if (!levelAtLeast('answer')) return ans('This chat gets pushes only now (Settings › Telegram): do it on the Mac')
  const p = idOfK(a, 'p')
  const w = idOfK(a, 'w')
  if (kind === 'noop') return ans()
  if (kind === 'a') {
    const why = aiNo()
    if (why) return ans(why)
    T().focus = AI
    save()
    said('talking to Laki AI')
    ans('Your messages go to Laki AI now')
    return void say(AI_HELLO)
  }
  if (kind === 'q') {
    // a laki_ask button: its option goes back to Laki AI (aiAnswer), its next answer comes here; the question says what was picked
    const q = tgHooks.aiAsked?.()
    const why = aiNo() || (aiAt ? 'Laki AI is still answering' : '')
    if (why) return ans(why)
    if (!q || q.id !== a || q.options[Number(c)] === undefined) return void (ans('That question moved on: ask again'), q?.id !== a && edit('<i>That question moved on.</i>'))
    ans()
    await edit(`🤖 ${mdToTg(redact(cut(q.text, 1500)))}\n<i>Picked: ${esc(cut(q.options[Number(c)], 80))}</i>`)
    return aiGo(q.options[Number(c)], [], undefined, { id: q.id, n: Number(c) })
  }
  if (kind === 'P') return show(projectsView(Number(a) || 0))
  if (kind === 'p') return p ? show(projectView(p, Number(c) || 0)) : old()
  if (kind === 'w') return w ? show(await wsView(w)) : old()
  if (kind === 't') {
    if (!w || !shownWs(w) || !agentsOf(w).length) return old()
    const on = state.telegram?.focus !== w
    T().focus = on ? w : undefined
    save()
    said(on ? `talking to ${wsName(w)}` : 'talking stopped')
    return show(await wsView(w), on ? `Your messages go to ${wsName(w)} now` : 'Stopped: reply to a push, or pick again')
  }
  if (kind === 'x' || kind === 'm1' || kind === 'm2') {
    if (!levelAtLeast('control')) return ans('That needs the Control level: Settings › Telegram')
    if (!w || !shownWs(w)) return old()
    if (kind === 'x') return void (ans(), say(await stopIn(w)))
    const pr = greenPr(w)
    if (!pr || (kind === 'm2' && String(pr.number) !== c)) return show(await wsView(w), 'Not green now (its checks, a conflict, or GitHub would not merge it): look again')
    // two steps: what it merges, then Merge #n; a stale confirm (another PR since) is refused above
    if (kind === 'm1') return void (ans(), edit(`Merge <b>#${pr.number}</b> ${esc(cut(pr.title ?? '', 120))} into <code>${esc(pr.base ?? 'its base')}</code>?\nIts checks passed and GitHub would merge it now. It can't be undone from here.`, [[btn(`✅ Merge #${pr.number}`, `nav:m2:${a}:${pr.number}`)], [btn('Cancel', `nav:w:${a}`)]]))
    ans('Merging…')
    const r = await act<{ held?: { name?: string; why?: string }[] } | undefined>('prAct', { ws: w, act: 'merge' }).then(
      h => (h?.held?.length ? `Not merged: ${esc(h.held.map(x => [x.name, x.why].filter(Boolean).join(': ')).join('; ') || 'an extension holds it')}` : `Merged <b>#${pr.number}</b> in <b>${esc(wsName(w))}</b>.`), // an extension's gate held it: not merged
      e => `Not merged: ${esc(scrub((e as Error).message))}`,
    )
    return void edit(r, [[btn('⬅ Back', `nav:w:${a}`)]])
  }
  if (kind === 's' || kind === 'd') {
    if (state.telegram?.detail === 'titles') return ans('Titles only is on: nothing off a screen comes here')
    const t = w && shownWs(w) ? agentsOf(w)[0] : undefined
    if (!t) return old()
    ans()
    // in the card's place, with ⬅ Back to it (a menu never starts over from Projects) and 🔄 Again
    return void edit(kind === 's' ? await screenOf(t) : await diffOf(t), [[btn('⬅ Back', `nav:w:${a}`), btn('🔄 Again', `nav:${kind}:${a}`)]])
  }
  if (kind === 'n') {
    if (!levelAtLeast('control')) return ans('Starting a workspace needs the Control level: Settings › Telegram')
    if (!p || !projectsOk().some(x => x.id === p)) return old()
    newIn = { project: p, until: Date.now() + TEN_MIN }
    ans()
    return void say(`Send the task for <b>${esc(projectsOk().find(x => x.id === p)!.name)}</b>: type it or send a voice note. /cancel drops it.`)
  }
  if (kind === 'ta') {
    const x = pend.get(a)
    if (gap || !x || x.until < Date.now()) return ans('That message is too old: send it again')
    const why = aiNo() || (aiAt ? 'Laki AI is still answering: send it once it has' : '')
    if (why) return ans(why)
    pend.delete(a)
    T().focus = AI
    save()
    ans()
    await edit('Sent to <b>Laki AI</b>. Your next messages go there too (/talk off stops that).')
    return aiGo(x.text, [])
  }
  if (kind === 'to' || kind === 'mk') {
    if (gap) return ans('Laki was off: that tap is too old')
    const x = pend.get(a)
    const target = kind === 'to' ? idOfK(c, 'w') : idOfK(c, 'p')
    if (!x || x.until < Date.now() || !target) return ans('That message is too old: send it again')
    if (kind === 'mk') {
      if (!levelAtLeast('control')) return ans('Starting a workspace needs the Control level: Settings › Telegram')
      pend.delete(a)
      const r = await started(target, x.text)
      return void (await edit(r), ans())
    }
    const t = shownWs(target) ? agentsOf(target)[0] : undefined
    if (!t) return ans('That workspace has no agent now')
    await act('send', { target: t.id, text: x.text, whenIdle: true })
    pend.delete(a)
    T().focus = target
    save()
    return void (await edit(`Sent to <b>${esc(wsName(target))}</b>. Your next messages go there too (/talk off stops that).`), ans())
  }
  ans()
}
// 🤖 Laki AI from the chat (/ai, /menu's button, Where should this go?): your words, or a photo as its picture, in
// Laki AI's own chat (the AI page's, on the Mac too); its tools only what this chat may do (act: TELEGRAM_OK at its
// level, the limits, What Telegram did), its answer back as Telegram's HTML. Never with a CLI backend (claude, codex:
// their tools call Laki as you, past this gate) nor with Titles only (an answer can carry a screen). One ask at a time.
// Its laki_ask (a plain question) comes as buttons, a tap its answer (aiPick); one Laki acts on (a removal, a run, an
// extension) is refused by the gate: it asks in words, and the Mac's AI page shows the rest
const AI = '@ai' // focus: Laki AI, not a workspace
const AI_HELLO = '🤖 <b>Laki AI</b>: ask it anything: type, or send a voice note or a photo. It can look at your workspaces, message their agents and, at Control, start new ones. /talk off stops.'
const AI_WHERE = "Telegram, on their phone: answer short, in plain Markdown; laki:// links and Laki's pages don't open there. From there your tools do only what the chat may: read the workspaces, screens and diffs, message an agent, and at the Control level start a workspace; anything else is for the Mac"
const AI_MAX = 3500
let aiAt = 0 // our ask at work since
function aiNo() {
  const b = state.settings?.ai?.backend
  if (!levelAtLeast('answer')) return 'This chat gets pushes only now (Settings › Telegram)'
  if (state.settings?.ai?.on === false) return 'Laki AI is off: Settings › AI, on your Mac'
  if (!tgBackend(state.settings)) return `Laki AI on ${b} doesn't answer from Telegram: Settings › AI › From Telegram picks OpenRouter or Your endpoint for it (or, at full access, ${b} as on your Mac)`
  return state.telegram?.detail === 'titles' ? "Titles only is on: Laki AI's answers could carry what's on a screen" : ''
}
// a tool's call from Laki AI in the chat: act's gate, and never about a workspace or project the chat doesn't show
// (Recording mode's private ones: their ids may be in the AI page's history)
function aiCall(method: string, p: Record<string, unknown> = {}) {
  const ref = p.target ?? p.tab
  let ws = typeof p.ws === 'string' ? (state.workspaces.find(w => w.id === p.ws || w.name === p.ws)?.id ?? p.ws) : undefined
  if (ref !== undefined)
    try {
      ws = resolveTarget(String(ref)).workspace
    } catch {} // none: the method says so itself
  if (ws && !shownWs(ws)) return Promise.reject(new Error('that workspace is hidden from Telegram'))
  if (typeof p.project === 'string' && !projectsOk().some(x => x.id === p.project)) return Promise.reject(new Error('that project is hidden from Telegram'))
  return act(method, p)
}
async function askAi(m: TgMessage, heardText?: string) {
  const photo = m.photo?.length ? m.photo.at(-1)! : undefined
  let text: string
  let images: string[] = []
  try {
    if (photo) images = [await fileIn(photo, false)]
    text = heardText ?? (photo ? (m.caption ?? '').trim().slice(0, 8000) : await wordsOf(m))
  } catch (e) {
    return void sayIn(m, `Not taken: ${esc(scrub((e as Error).message))}`)
  }
  if (text || images.length) return aiGo(text, images, m.message_thread_id)
}
function aiGo(text: string, images: string[], thread?: number, pick?: { id: string; n: number }) {
  const why = aiNo() || (aiAt ? 'Laki AI is still answering: send it once it has' : !tgHooks.ai ? 'not ready' : '')
  if (why) return void say(esc(why), thread)
  try {
    spend('send')
  } catch (e) {
    return void say(esc((e as Error).message), thread)
  }
  aiAt = Date.now()
  said(pick ? `picked for Laki AI: "${clip80(text)}"` : `asked Laki AI: "${clip80(text || '(a picture)')}"`)
  // its answer to the person who asked: nothing once unpaired or another paired meanwhile (chat() is whoever is now)
  const who = chat()
  const still = () => state.telegram?.user?.id === who
  const typing = () => void (still() && out('sendChatAction', { chat_id: who, action: 'typing', ...(thread && { message_thread_id: thread }) }).catch(() => {}))
  typing()
  const tick = setInterval(typing, 4500)
  ;(pick && tgHooks.aiPick ? tgHooks.aiPick({ ...pick, context: AI_WHERE }, aiCall) : tgHooks.ai!({ text, images, context: AI_WHERE }, aiCall))
    .then(
      r => {
        if (!still()) return
        const q = tgHooks.aiAsked?.() // its laki_ask: the question, a button per option
        const t = (r.text ?? '').trim()
        if (t || !q) void say(`${mdToTg(redact(cut(t || '(no answer)', AI_MAX)))}${t.length > AI_MAX ? "\n<i>The rest: Laki AI's page on your Mac.</i>" : ''}`, thread)
        if (q) void out('sendMessage', { chat_id: who, text: `🤖 ${mdToTg(redact(cut(q.text, 1500)))}`, parse_mode: 'HTML', ...(thread && { message_thread_id: thread }), reply_markup: { inline_keyboard: q.options.slice(0, 6).map((o, n) => [btn(o, `nav:q:${q.id}:${n}`)]) } }).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
      },
      e => still() && say(`Laki AI: ${esc(scrub((e as Error).message))}`, thread),
    )
    .finally(() => (clearInterval(tick), (aiAt = 0)))
}
// a voice note's words (Settings › Voice's cloud, as the talk key's): Telegram's ogg as WAV through ffmpeg when this Mac
// has it, else as it came. LAKI_FFMPEG: tests' (none). ponytail: no ffmpeg and a model that takes no ogg: refused, said so
const toWav = (buf: Buffer) =>
  new Promise<Buffer | undefined>(ok => {
    const p = spawn(process.env.LAKI_FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const parts: Buffer[] = []
    const t = setTimeout(() => p.kill(), 30_000)
    p.stdout.on('data', (d: Buffer) => parts.push(d))
    p.on('error', () => (clearTimeout(t), ok(undefined))) // none here
    p.on('close', code => (clearTimeout(t), ok(code === 0 && parts.length ? Buffer.concat(parts) : undefined)))
    p.stdin.on('error', () => {})
    p.stdin.end(buf)
  })
async function heard(f: TgFile) {
  spend('send')
  const { buf, path } = await download(f)
  const wav = await toWav(buf)
  const r = await act<{ text?: string }>('voiceText', { audio: (wav ?? buf).toString('base64'), format: wav ? 'wav' : extname(path).slice(1).toLowerCase() || 'ogg' })
  return (r?.text ?? '').trim()
}
// a message's words, a photo's or a file's path after them (Laki's images or files)
async function wordsOf(m: TgMessage) {
  let text = (m.text ?? m.caption ?? '').trim().slice(0, 8000)
  const f = m.photo?.length ? m.photo.at(-1)! : m.document
  if (f) text = `${text ? `${text}\n` : ''}${await fileIn(f, !m.photo?.length && m.document?.file_name)}`
  return text
}

// ---------- P3: commands (setMyCommands, for this chat only: the level's). Each acts through act's gate; with titles only,
// nothing off a screen comes; a workspace Recording mode hides isn't named
const COMMANDS: [string, string, TgLevel][] = [
  ['menu', 'Projects and workspaces as buttons: open one, talk to it', 'answer'],
  ['status', 'Who needs you, who is working, who is done', 'answer'],
  ['screen', "An agent's screen: reply to its push, or /screen <workspace>", 'answer'],
  ['diff', "A workspace's changed files: reply to a push, or /diff <workspace>", 'answer'],
  ['talk', 'Where your messages go: /talk <workspace>, /talk off', 'answer'],
  ['ai', 'Laki AI: /ai <question>, or /ai and then just type', 'answer'],
  ['quiet', 'Do not disturb: /quiet 2h, /quiet 30m, /quiet off', 'answer'],
  ['new', 'Start a workspace: /new <project> <task>', 'control'],
  ['stop', "Stop an agent's turn: reply to its push, or /stop <workspace>", 'control'],
]
const commandsSet = () => {
  if (!state.telegram?.user) return
  out('setMyCommands', { commands: COMMANDS.filter(c => levelAtLeast(c[2])).map(([command, description]) => ({ command, description })), scope: { type: 'chat', chat_id: chat() } }).catch(e => log(`telegram: ${(e as Error).message}`))
}
// unpaired, or another person paired: the old chat's menu gone (its commands would do nothing there)
const commandsGone = () => {
  if (state.telegram?.user) out('deleteMyCommands', { scope: { type: 'chat', chat_id: chat() } }).catch(e => log(`telegram: ${(e as Error).message}`))
}
const shownWs = (id: string) => (w => (w && !w.archived && !hidden(w) ? w : undefined))(state.workspaces.find(x => x.id === id))
// a command's agent tab: the push it replies to, else the workspace it names (its first agent tab)
function tabFor(m: TgMessage, arg: string) {
  const id = m.reply_to_message && msgMap().get(m.reply_to_message.message_id)
  const by = id ? state.tabs.find(t => t.id === id) : undefined
  if (by) return shownWs(by.workspace) && by
  const here = !arg && wsOfThread(m.message_thread_id) // in a workspace's topic: that one
  const w = here ? shownWs(here) : arg && state.workspaces.find(x => shownWs(x.id) && (x.name ?? x.id).toLowerCase() === arg.toLowerCase())
  return w ? state.tabs.find(t => t.workspace === w.id && tracked(t)) : undefined
}
const DOT: Record<string, string> = { waiting: '🟡', running: '🔵', idle: '🟢' }
async function command(c: string, arg: string, m: TgMessage) {
  const known = COMMANDS.find(x => x[0] === c)
  if (c === 'cancel') return void sayIn(m, newIn ? ((newIn = undefined), 'Dropped: no new workspace.') : 'Nothing to cancel.')
  if (c === 'start' || c === 'help' || !known)
    return void out('sendMessage', { chat_id: chat(), text: `${c === 'start' || c === 'help' ? '' : `No /${esc(c)}. `}${COMMANDS.filter(x => levelAtLeast(x[2])).map(x => `/${x[0]}: ${esc(x[1])}`).join('\n')}\nReply to a push to talk to its agent, or open one in /menu and 💬 Talk here: then just type, or send a voice note.`, parse_mode: 'HTML', ...(m.message_thread_id && { message_thread_id: m.message_thread_id }), reply_markup: { inline_keyboard: [[btn('📂 Projects', 'nav:P:0')]] } }).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
  if (!levelAtLeast(known[2])) return void sayIn(m, `/${c} needs the Control level: Settings › Telegram, on your Mac`)
  if (c === 'menu') return void sendView(m, projectsView())
  if (c === 'ai') {
    const why = aiNo()
    if (why) return void sayIn(m, esc(why))
    T().focus = AI
    save()
    said('talking to Laki AI')
    return void (arg ? aiGo(arg.slice(0, 8000), [], m.message_thread_id) : sayIn(m, AI_HELLO))
  }
  if (c === 'talk') {
    const f = state.telegram?.focus
    if (/^off$/i.test(arg)) return void ((T().focus = undefined), save(), said('talking stopped'), sayIn(m, 'Your messages go nowhere now: reply to a push, or pick a workspace in /menu.'))
    const named = arg && state.workspaces.find(x => shownWs(x.id) && agentsOf(x.id).length && (x.name || x.id).toLowerCase() === arg.toLowerCase())
    if (arg && !named) return void sayIn(m, `No workspace ${esc(arg)} with an agent: /menu lists them.`)
    if (named) (T().focus = named.id), save(), said(`talking to ${wsName(named.id)}`)
    if (!named && f === AI) return void sayIn(m, AI_HELLO)
    const v = (named || f) && shownWs(named ? named.id : f!) ? await wsView(named ? named.id : f!) : undefined
    return void (v ? sendView(m, v) : sayIn(m, 'Not talking to any: open a workspace in /menu and tap 💬 Talk here.'))
  }
  const titles = state.telegram?.detail === 'titles'
  if (c === 'status') {
    const v = await act<{ tabs: { id: string; name: string; workspace: string; status: string; done: boolean }[] }>('state', {})
    const rows = v.tabs.filter(t => tracked(state.tabs.find(x => x.id === t.id) ?? ({} as never)) && shownWs(t.workspace))
    const group = (title: string, l: typeof rows, q = false) =>
      l.length ? [`<b>${title} · ${l.length}</b>`, ...l.slice(0, 15).map(t => `${DOT[t.status] ?? '⚪'} ${esc(shownWs(t.workspace)!.name ?? t.workspace)} · ${esc(t.name)}${q && !titles ? (p => (p ? `: <code>${esc(redact(cut(`${p.tool}: ${p.what}`, 120)))}</code>` : ''))(rtOf(t.id).perm) : ''}`)] : []
    const all = [...group('Needs you', rows.filter(t => t.status === 'waiting'), true), ...group('Working', rows.filter(t => t.status === 'running')), ...group('Done', rows.filter(t => t.status === 'idle' && t.done))]
    // Telegram takes 4,096 characters: the lines that fit, then how many more
    let size = 0
    const fit = all.filter(l => (size += l.length + 1) <= 3600)
    return void sayIn(m, fit.length ? `${fit.join('\n')}${fit.length < all.length ? `\n…and ${all.length - fit.length} more` : ''}` : 'Nothing needs you, nothing is working.')
  }
  if (c === 'quiet') {
    if (/^off$/i.test(arg)) return void (await act('dndSet', { off: true }), sayIn(m, 'Do not disturb is off.'))
    const n = /^(\d{1,4})\s*(m|min|h|hours?)?$/i.exec(arg || '1h')
    if (!n || !Number(n[1])) return void sayIn(m, 'How long? /quiet 2h, /quiet 30m, /quiet off')
    const minutes = Number(n[1]) * (/^h/i.test(n[2] ?? 'm') ? 60 : 1)
    const r = await act<{ until: number }>('dndSet', { minutes })
    return void sayIn(m, `Do not disturb until ${new Date(r.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: only an important workspace's asks come.`)
  }
  if (c === 'new') {
    // its project: the longest name (or id) the words start with, so a name with spaces works
    const low = arg.toLowerCase()
    const [p, said] = state.projects
      .filter(x => !x.kind && !x.archived && !(state.settings?.recording && x.private))
      .flatMap(x => [x.name, x.id].filter(n => n && low.startsWith(n.toLowerCase()) && /\s/.test(low[n.length] ?? '')).map(n => [x, n!] as const))
      .sort((a, b) => b[1].length - a[1].length)[0] ?? []
    const task = said ? arg.slice(said.length).trim() : ''
    if (!p || !task) return void sayIn(m, `/new &lt;project&gt; &lt;task&gt;, a project of: ${esc(state.projects.filter(x => !x.kind && !x.archived && !(state.settings?.recording && x.private)).map(x => x.name).join(', ') || 'none yet')}`)
    return void sayIn(m, await started(p.id, task))
  }
  if (c === 'stop') {
    // the push it replies to, else the workspace it names (or the one talked to): its agents' turns under way, each Esc
    const one = m.reply_to_message && tabFor(m, '')
    // a reply to a push whose tab isn't shown (Recording mode) or known: which one, never the talked-to one instead
    const w = one ? one.workspace : arg ? state.workspaces.find(x => shownWs(x.id) && (x.name ?? x.id).toLowerCase() === arg.toLowerCase())?.id : m.reply_to_message ? undefined : (f => (f && f !== AI && shownWs(f) ? f : undefined))(state.telegram?.focus)
    if (!w) return void sayIn(m, 'Which one? Reply /stop to an agent\'s push, or /stop &lt;workspace&gt;.')
    return void sayIn(m, await stopIn(w, one || undefined))
  }
  if (titles) return void sayIn(m, 'Titles only is on (Settings › Telegram): nothing off a screen comes here.')
  const t = tabFor(m, arg)
  if (!t) return void sayIn(m, `Which one? Reply /${c} to an agent's push, or /${c} &lt;workspace&gt;.`)
  return void sayIn(m, c === 'screen' ? await screenOf(t) : await diffOf(t))
}
const headOf = (t: Tab) => `<b>${esc(t.name)}</b> in <b>${esc(shownWs(t.workspace)?.name ?? t.workspace)}</b>`
// /stop's and a card's ⏹ (Control): each agent turn under way in a workspace (or one tab's) gets Esc, as its Stop
async function stopIn(ws: string, one?: Tab) {
  const ts = (one ? [one] : agentsOf(ws)).filter(t => rtOf(t.id).status === 'running') // a waiting one's Esc would be a No: answer it instead
  if (!ts.length) return `Nothing is working in <b>${esc(wsName(ws))}</b>.`
  for (const t of ts) await act('stopAll', { tab: t.id })
  return `Stopped ${ts.map(t => `<b>${esc(t.name)}</b>`).join(', ')} in <b>${esc(wsName(ws))}</b>: its tab and its work stay.`
}
// a workspace's PR that may be merged from the chat (Control): open, not a draft, its checks passed, GitHub would merge
// it now, GitHub's (not a GitLab MR), not a fork's
const greenPr = (ws: string) => (p => (p && p.state === 'OPEN' && !p.draft && p.checks === 'pass' && p.ready === true && !p.conflict && !p.forge && !p.cross ? p : undefined))(prs.get(ws))
// /screen's and a card's 📺: its last 40 lines
async function screenOf(t: Tab) {
  const text = await act<string>('screen', { target: t.id, lines: 40 })
  return `${headOf(t)}\n<pre>${esc(redact(text.trimEnd()).slice(-3500))}</pre>`
}
// /diff's and a card's 📝: its changed files, the ones that fit (Telegram takes 4,096 characters), then how many more
async function diffOf(t: Tab) {
  const head = headOf(t)
  const d = await act<{ files: { path: string; add: number; del: number }[] }>('diff', { ws: t.workspace })
  const add = d.files.reduce((n, f) => n + f.add, 0)
  const del = d.files.reduce((n, f) => n + f.del, 0)
  if (!d.files.length) return `${head}: no changes`
  const lines: string[] = []
  let size = head.length + 60
  for (const f of d.files) {
    const l = `<code>${esc(cut(f.path, 120))}</code> +${f.add} −${f.del}`
    if (size + l.length > 3500) break
    lines.push(l), (size += l.length + 1)
  }
  const more = d.files.length - lines.length
  return `${head}: +${add} −${del} · ${d.files.length} file${d.files.length === 1 ? '' : 's'}\n${lines.join('\n')}${more ? `\n…and ${more} more` : ''}`
}

// the receipt: a 👍 on your message (Telegram may refuse a reaction: then none)
const react = (m: TgMessage) => void out('setMessageReaction', { chat_id: chat(), message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => {})
const ignore = () => ++ignored === 1 && setTimeout(() => (log(`telegram: ignored ${ignored} update(s) from someone else`), (ignored = 0)), 60_000).unref()

// ---------- Settings › Telegram: the bot's token (checked with getMe), switches, Unpair; Send test
export async function telegramSet(p: { token?: unknown; level?: unknown; off?: unknown; pushOff?: unknown; waiting?: unknown; done?: unknown; detail?: unknown; topics?: unknown; unpair?: unknown }) {
  const t = T()
  if (typeof p.token === 'string') {
    const tok = p.token.trim()
    if (!tok) {
      const old = token()
      if (old && t.user) void tg('deleteMyCommands', { scope: { type: 'chat', chat_id: t.user.id } }, { tok: old }).catch(() => {}) // its menu, while the token is here
      keyWrite(KEY, keyFile(), '')
      Object.assign(t, { keyed: undefined, bot: undefined, user: undefined, threads: undefined, notice: undefined, focus: undefined })
      forget()
      pair = undefined
    } else {
      if (!TOKEN.test(tok)) throw new Error("that isn't a bot token: BotFather's looks like 123456789:AA… (35 characters after the colon)")
      const me = await tg<{ id: number; username?: string; first_name?: string; has_topics_enabled?: boolean }>('getMe', {}, { tok })
      if (!me.username) throw new Error('Telegram says that token is no bot')
      keyWrite(KEY, keyFile(), tok)
      t.keyed = true
      if (t.bot?.id !== me.id) Object.assign(t, { user: undefined, threads: undefined, focus: undefined }), forget() // another bot: pair again
      Object.assign(t, { bot: { id: me.id, username: me.username, name: me.first_name ?? me.username, topics: !!me.has_topics_enabled }, notice: undefined, off: undefined })
      ctl?.abort() // a poll of the old token's: its updates' ids aren't this bot's
      ctl = undefined
      offset = 0
    }
  }
  if (p.level !== undefined) {
    if (typeof p.level !== 'string' || !Object.hasOwn(RANK, p.level)) throw new Error('level: notify, answer or control')
    t.level = p.level as TgLevel
  }
  if (p.topics === true && t.bot && !t.bot.topics) {
    // BotFather's switch may be new since the token was pasted: ask again
    const me = await tg<{ has_topics_enabled?: boolean }>('getMe')
    t.bot.topics = !!me.has_topics_enabled
    if (!t.bot.topics) throw new Error(`turn topics on for @${t.bot.username} in @BotFather first (its Bot Settings), then here`)
  }
  if (p.topics === true && t.notice?.startsWith('Topics are off')) t.notice = undefined
  for (const k of ['off', 'pushOff', 'waiting', 'done', 'topics'] as const) if (typeof p[k] === 'boolean') t[k] = p[k]
  if (p.off === false) t.notice = undefined // on again (Try again after a 409): its notice read
  if (p.detail !== undefined) t.detail = p.detail === 'titles' ? 'titles' : undefined
  if (p.unpair === true) commandsGone(), Object.assign(t, { user: undefined, threads: undefined, focus: undefined }), (pair = undefined), forget(), log('telegram: unpaired'), said('unpaired')
  if (p.level !== undefined) commandsSet(), said(`level ${t.level}`)
  save()
  sync()
  changed()
  return tgView()
}
export async function telegramTest() {
  if (!tgOn()) throw new Error(state.telegram?.user ? 'turned off: turn it on first' : 'pair your chat first (step 2)')
  await out('sendMessage', { chat_id: chat(), text: '<b>Laki: pushes reach you.</b>', parse_mode: 'HTML' })
  return true
}
export function tgView(): TelegramView | undefined {
  const t = state.telegram
  if (!t) return undefined
  const { user, threads: _, bot, keyed, ...rest } = t
  return { ...rest, token: !!keyed, ...(bot && { bot: { username: bot.username, name: bot.name, topics: bot.topics } }), ...(user && { user: { name: user.name, at: user.at } }), ...(pair && pair.until > Date.now() && { pairing: pair.until }), ...(ctl && { polling: true }) }
}

// ---------- the old phone push format (settings.webhook format telegram, before Settings › Telegram): its token to the
// Keychain and off state.json; a private chat's id (positive: its user's) paired at answer, a group's nothing but a notice
export function tgMigrate(w: Webhook) {
  let u: URL | undefined
  try {
    u = new URL(String(w.url ?? ''))
  } catch {}
  const tok = u && /^\/bot([^/]+)\//.exec(u.pathname)?.[1]
  const id = Number(u?.searchParams.get('chat_id'))
  delete state.settings!.webhook
  setImmediate(save) // the URL (its token) off state.json on disk now, not at the next change
  if (!tok || !TOKEN.test(decodeURIComponent(tok))) return void (T().notice = "Your Telegram push's URL had no bot token Laki could read: set your bot up again here (step 1)")
  keyWrite(KEY, keyFile(), decodeURIComponent(tok))
  const t = T()
  Object.assign(t, { keyed: true, level: 'answer', waiting: w.waiting, done: w.done === true, detail: w.detail })
  if (Number.isSafeInteger(id) && id > 0) t.user = { id, name: '', at: Date.now() }
  else t.notice = 'Your Telegram pushes went to a group: Laki now pairs one person in their private chat with the bot. Pair again (step 2)'
  log('telegram: the phone push to Telegram moved to Settings › Telegram')
}
// the bot's name (getMe), for one migrated or kept from before: as Laki starts, else as the poll first works
let naming = false
async function named() {
  if (naming || !state.telegram?.keyed || state.telegram.bot) return
  naming = true
  await tg<{ id: number; username?: string; first_name?: string; has_topics_enabled?: boolean }>('getMe')
    .then(
      me => void (me.username && ((T().bot = { id: me.id, username: me.username, name: me.first_name ?? me.username, topics: !!me.has_topics_enabled }), save(), changed())),
      e => log(`telegram: ${(e as Error).message}`),
    )
    .finally(() => (naming = false))
}
export async function tgStart() {
  await named()
  sync()
  if (tgOn()) commandsSet() // the level's menu, a migrated pairing's too
}
