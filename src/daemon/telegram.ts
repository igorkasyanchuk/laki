// Telegram (Settings › Telegram): your own bot (made in @BotFather), paired with you in its private chat. Only this Mac
// calls Telegram: one long poll (getUpdates, 50 s) while it's paired and answers, or while a pairing code waits; nothing
// listens here. The bot's token in the Keychain (keychain.ts; else <data>/telegram-token, 0600), never in state.json,
// the view, a log or an error (scrub: a URL holds it). Only the paired user in their private chat counts; anyone else
// is ignored without a word. What it may do is its level (types.ts TgLevel); what goes out goes through phone.ts' rules
// (Do not disturb, mute, Recording mode, titles only) and redact, a message a second at most.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { readCapped, writeAtomic } from '../shared/conn.ts'
import type { Telegram, TelegramView, TgLevel, Webhook } from '../shared/types.ts'
import { LIMITS, limitsOf } from './clients.ts'
import { changed, fileSave, imageSave, log, rtOf, save, sessions, state, tracked } from './core.ts'
import { dir } from './dir.ts'
import { keyRead, keyWrite } from './keychain.ts'
import { hidden, takeTap } from './phone.ts'
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
export const levelOf = (t = state.telegram): TgLevel => (t?.level && t.level in RANK ? t.level : 'answer')
export const levelAtLeast = (l: TgLevel) => RANK[levelOf()] >= RANK[l]
// pushes go: a bot and a paired user, not turned off
export const tgOn = () => !!state.telegram?.user && !state.telegram.off && !!token()
// its buttons answer: answer or control, and more than titles go
export const tgAnswers = () => tgOn() && levelAtLeast('answer') && state.telegram?.detail !== 'titles'

// a bot token's shape (BotFather's <id>:<35 characters>), and every place one could show: a URL, an error
export const TOKEN = /^\d{5,15}:[\w-]{30,60}$/
export const scrub = (s: string, tok = token()) => (tok ? s.split(tok).join('•••') : s).replace(/\d{5,15}:[\w-]{30,60}/g, '•••')
// Telegram's HTML: &, < and > escaped in everything that isn't a tag of ours
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

class TgError extends Error {
  code: number
  retry: number
  constructor(m: string, code = 0, retry = 0) {
    super(m)
    this.code = code
    this.retry = retry
  }
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(r => (signal?.aborted ? r() : (t => signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true }))(setTimeout(r, ms))))
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
// main.ts' gate for what a message makes Laki do (TELEGRAM_OK at its level, remote access's answer-level checks), then the call
export const tgHooks: { call?: (method: string, params: Record<string, unknown>) => Promise<unknown> } = {}
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
  method === 'send' ? `to ${tabWords(p.target)}: "${clip80(p.text)}"` : method === 'answer' ? `answered ${tabWords(p.tab)}: ${clip80(p.label ?? p.n)}` : method === 'wsNew' ? `new workspace in ${p.project}: "${clip80(p.prompt)}"` : method === 'dndSet' ? (p.off ? 'Do not disturb off' : `Do not disturb for ${p.minutes} minutes`) : `${method}${p.ws || p.target ? ` (${p.ws ?? tabWords(p.target)})` : ''}`
const READ = new Set(['state', 'screen', 'diff'])
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
// its HTML: the title bold, the rest escaped (a long one folded: blockquote expandable), secrets' shapes masked
export function tgHtml(p: Push) {
  const { title, body } = pushText({ ...p, options: undefined })
  const b = redact(cut(body, 3000))
  return `<b>${esc(redact(title))}</b>${b ? (b.length > 300 || b.split('\n').length > 6 ? `\n<blockquote expandable>${esc(b)}</blockquote>` : `\n${esc(b)}`) : ''}`
}
// titles only: who needs you, nothing off the screen
const shown = (p: Push): Push => (state.telegram?.detail === 'titles' ? { ...p, question: undefined, options: undefined, nonce: undefined } : p)
// a push to the paired chat: its message's id (for tgDone's edit), or undefined
export async function tgPush(p: Push): Promise<number | undefined> {
  if (!tgOn()) return
  p = shown(p)
  const taps = p.nonce && p.options?.length && tgAnswers() ? p.options : []
  const markup = taps.length ? { inline_keyboard: taps.map(o => [{ text: cut(`${o.n}. ${o.label}`, 60), callback_data: `${p.nonce}:${o.n}` }]) } : p.url ? { inline_keyboard: [[{ text: 'Open it', url: p.url }]] } : undefined
  const m = await out<Msg>('sendMessage', { chat_id: chat(), text: tgHtml(p), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(p.event === 'done' && { disable_notification: true }), ...(markup && { reply_markup: markup }) })
  if (m?.message_id && p.tab) remember(m.message_id, p.tab) // a reply to it goes to its tab
  return m?.message_id
}
// an ask answered (said: what was picked) or gone: its message says so, its buttons gone (an empty keyboard)
export function tgDone(msg: number, p: Push, said: string) {
  if (!state.telegram?.user) return
  out('editMessageText', { chat_id: chat(), message_id: msg, text: `${tgHtml(shown(p))}\n<i>${esc(said)}</i>`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(e => log(`telegram: ${(e as Error).message}`))
}
const say = (text: string) => out('sendMessage', { chat_id: chat(), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(e => log(`telegram: ${(e as Error).message}`))

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
type TgMessage = { message_id: number; from?: User; chat: Chat; date: number; text?: string; caption?: string; reply_to_message?: { message_id: number }; photo?: TgFile[]; document?: TgFile & { file_name?: string } }
type Update = { update_id: number; message?: TgMessage; callback_query?: { id: string; from: User; message?: { message_id: number; chat: Chat }; data?: string } }
let ctl: AbortController | undefined
let offset = 0
let lastOk = 0 // a poll answered then: a tap in the first batch after a gap may be from hours ago (a callback has no date)
let ignored = 0 // updates from anyone else, since the last log line
// it runs while a pairing code waits, or paired, on, and at answer or control
const wanted = () => !!token() && !!state.telegram?.bot && (!!pair && pair.until > Date.now() ? true : tgOn() && levelAtLeast('answer'))
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
  changed()
  while (!c.signal.aborted) {
    if (!wanted()) break // a pairing code ran out
    try {
      const ups = await tg<Update[]>('getUpdates', { offset, timeout: POLL_S, allowed_updates: ['message', 'callback_query'] }, { signal: AbortSignal.any([c.signal, AbortSignal.timeout((POLL_S + 15) * 1000)]) })
      const gap = !lastOk || Date.now() - lastOk > STALE
      lastOk = Date.now()
      wait = 1000
      if (failed) log('telegram: reached again'), (failed = '')
      for (const u of ups) {
        offset = Math.max(offset, u.update_id + 1)
        await take(u, gap).catch(e => log(`telegram: ${scrub((e as Error).message)}`))
      }
    } catch (e) {
      if (c.signal.aborted) break
      const err = e as TgError
      if (err.code === 409) return stop('Another program reads this bot (or it has a webhook): use a bot made only for Laki. Laki stopped listening; nothing of the other one was changed')
      if (err.code === 401) return stop("Telegram refused the bot's token (revoked, or the bot deleted): paste a new one", true)
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
    Object.assign(T(), { user: { id: from.id, name: nameOf(from), at: Date.now() }, notice: undefined, off: undefined, threads: was?.id === from.id ? state.telegram?.threads : undefined })
    T().level ??= 'answer'
    save()
    changed()
    log(`telegram: paired with ${nameOf(from)}`)
    said(`paired with ${nameOf(from)}`)
    void say(`<b>Paired with Laki.</b> Pushes from this Mac come here; what this chat may do is set in Laki's Settings › Telegram (now: <b>${levelOf()}</b>).${levelAtLeast('answer') ? ' Reply to a push to talk to its agent; /status for who needs you.' : ''}`)
    commandsSet()
    return sync()
  }
  if (from.id !== state.telegram?.user?.id) return void ignore()
  if (q) {
    const tap = !gap && levelAtLeast('answer') ? tapOf(q.data, '', false) : undefined
    const said = tap && (await takeTap(tap))
    return void out('answerCallbackQuery', { callback_query_id: q.id, text: gap ? 'Laki was off: that tap is too old' : said || 'That ask moved on' }).catch(() => {})
  }
  if (!m) return
  if (Date.now() / 1000 - m.date > STALE / 1000) return void say('Laki was off when you sent that: send it again.')
  if (!levelAtLeast('answer')) return
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(m.text?.trim() ?? '')
  if (cmd) return command(cmd[1].toLowerCase(), (cmd[2] ?? '').trim(), m).catch(e => void say(`Not done: ${esc(scrub((e as Error).message))}`))
  const tab = m.reply_to_message && msgMap().get(m.reply_to_message.message_id)
  if (!tab) return void say("Reply to one of my messages about an agent (swipe it left, or long-press it › Reply) and what you write goes to that agent.")
  await deliver(tab, m).then(
    () => react(m),
    e => say(`Not sent: ${esc(scrub((e as Error).message))}`),
  )
}
// a reply's words (and its photo's or file's path) to its tab: a waiting ask's choice when it names one (its number or
// its words), else a message to the agent, queued until it's free (send's whenIdle). Through tgHooks' gate: an agent's
// tab only, the whole message, never a line that starts with !
async function deliver(tab: string, m: TgMessage) {
  const t = state.tabs.find(x => x.id === tab)
  if (!t) throw new Error('that tab is gone')
  let text = (m.text ?? m.caption ?? '').trim().slice(0, 8000)
  const f = m.photo?.length ? m.photo.at(-1)! : m.document
  const s = sessions.get(tab)
  const ask = !f && rtOf(tab).status === 'waiting' && s && !s.exited ? s.ask() : undefined
  const o = ask?.options.find(x => String(x.n) === text || x.label.toLowerCase() === text.toLowerCase())
  if (o) return void (await act('answer', { tab, n: o.n, label: o.label }))
  if (f) text = `${text ? `${text}\n` : ''}${await fileIn(f, !m.photo?.length && m.document?.file_name)}`
  if (!text) throw new Error('nothing to send')
  await act('send', { target: tab, text, whenIdle: true })
  if (ask) void say(`Queued: ${esc(t.name)} asks something first (reply with a choice's number to answer it).`)
}
// a photo or a file from the chat into Laki's images or files (core's imageSave, fileSave): its path. Telegram gives a
// bot 20 MB at most
const FILE_MAX = 20 << 20
async function fileIn(f: TgFile, name: string | false | undefined) {
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
  const ext = extname(got.file_path).slice(1).toLowerCase()
  return name || !['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? fileSave({ name: name || basename(got.file_path), data: buf.toString('base64') }) : imageSave({ data: buf.toString('base64'), ext })
}
// ---------- P3: commands (setMyCommands, for this chat only: the level's). Each acts through act's gate; with titles only,
// nothing off a screen comes; a workspace Recording mode hides isn't named
const COMMANDS: [string, string, TgLevel][] = [
  ['status', 'Who needs you, who is working, who is done', 'answer'],
  ['screen', "An agent's screen: reply to its push, or /screen <workspace>", 'answer'],
  ['diff', "A workspace's changed files: reply to a push, or /diff <workspace>", 'answer'],
  ['quiet', 'Do not disturb: /quiet 2h, /quiet 30m, /quiet off', 'answer'],
  ['new', 'Start a workspace: /new <project> <task>', 'control'],
]
const commandsSet = () => {
  if (!state.telegram?.user) return
  out('setMyCommands', { commands: COMMANDS.filter(c => levelAtLeast(c[2])).map(([command, description]) => ({ command, description })), scope: { type: 'chat', chat_id: chat() } }).catch(e => log(`telegram: ${(e as Error).message}`))
}
const shownWs = (id: string) => (w => (w && !w.archived && !hidden(w) ? w : undefined))(state.workspaces.find(x => x.id === id))
// a command's agent tab: the push it replies to, else the workspace it names (its first agent tab)
function tabFor(m: TgMessage, arg: string) {
  const id = m.reply_to_message && msgMap().get(m.reply_to_message.message_id)
  const by = id ? state.tabs.find(t => t.id === id) : undefined
  if (by) return shownWs(by.workspace) && by
  const w = arg && state.workspaces.find(x => shownWs(x.id) && (x.name ?? x.id).toLowerCase() === arg.toLowerCase())
  return w ? state.tabs.find(t => t.workspace === w.id && tracked(t)) : undefined
}
const DOT: Record<string, string> = { waiting: '🟡', running: '🔵', idle: '🟢' }
async function command(c: string, arg: string, m: TgMessage) {
  const known = COMMANDS.find(x => x[0] === c)
  if (c === 'start' || c === 'help' || !known) return void say(`${c === 'start' || c === 'help' ? '' : `No /${esc(c)}. `}${COMMANDS.filter(x => levelAtLeast(x[2])).map(x => `/${x[0]}: ${esc(x[1])}`).join('\n')}\nReply to a push to talk to its agent.`)
  if (!levelAtLeast(known[2])) return void say(`/${c} needs the Control level: Settings › Telegram, on your Mac`)
  const titles = state.telegram?.detail === 'titles'
  if (c === 'status') {
    const v = await act<{ tabs: { id: string; name: string; workspace: string; status: string; done: boolean }[] }>('state', {})
    const rows = v.tabs.filter(t => tracked(state.tabs.find(x => x.id === t.id) ?? ({} as never)) && shownWs(t.workspace))
    const group = (title: string, l: typeof rows, q = false) =>
      l.length ? [`<b>${title} · ${l.length}</b>`, ...l.slice(0, 15).map(t => `${DOT[t.status] ?? '⚪'} ${esc(shownWs(t.workspace)!.name ?? t.workspace)} · ${esc(t.name)}${q && !titles ? (p => (p ? `: <code>${esc(redact(cut(`${p.tool}: ${p.what}`, 120)))}</code>` : ''))(rtOf(t.id).perm) : ''}`)] : []
    const text = [...group('Needs you', rows.filter(t => t.status === 'waiting'), true), ...group('Working', rows.filter(t => t.status === 'running')), ...group('Done', rows.filter(t => t.status === 'idle' && t.done))].join('\n')
    return void say(text || 'Nothing needs you, nothing is working.')
  }
  if (c === 'quiet') {
    if (/^off$/i.test(arg)) return void (await act('dndSet', { off: true }), say('Do not disturb is off.'))
    const n = /^(\d{1,4})\s*(m|min|h|hours?)?$/i.exec(arg || '1h')
    if (!n) return void say('How long? /quiet 2h, /quiet 30m, /quiet off')
    const minutes = Number(n[1]) * (/^h/i.test(n[2] ?? 'm') ? 60 : 1)
    const r = await act<{ until: number }>('dndSet', { minutes })
    return void say(`Do not disturb until ${new Date(r.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: only an important workspace's asks come.`)
  }
  if (c === 'new') {
    const [name, ...words] = arg.split(/\s+/)
    const task = words.join(' ').trim()
    const p = state.projects.find(x => !x.kind && !x.archived && !(state.settings?.recording && x.private) && [x.name, x.id].some(n => n?.toLowerCase() === name?.toLowerCase()))
    if (!p || !task) return void say(`/new &lt;project&gt; &lt;task&gt;, a project of: ${esc(state.projects.filter(x => !x.kind && !x.archived && !(state.settings?.recording && x.private)).map(x => x.name).join(', ') || 'none yet')}`)
    const w = await act<{ id: string; name?: string }>('wsNew', { project: p.id, prompt: task })
    return void say(`Started <b>${esc(w.name ?? w.id)}</b> in ${esc(p.name)}. Its pushes come here; reply to one to talk to it.`)
  }
  if (titles) return void say('Titles only is on (Settings › Telegram): nothing off a screen comes here.')
  const t = tabFor(m, arg)
  if (!t) return void say(`Which one? Reply /${c} to an agent's push, or /${c} &lt;workspace&gt;.`)
  const head = `<b>${esc(t.name)}</b> in <b>${esc(shownWs(t.workspace)!.name ?? t.workspace)}</b>`
  if (c === 'screen') {
    const text = await act<string>('screen', { target: t.id, lines: 40 })
    return void say(`${head}\n<pre>${esc(redact(text.trimEnd()).slice(-3500))}</pre>`)
  }
  const d = await act<{ files: { path: string; add: number; del: number }[] }>('diff', { ws: t.workspace })
  const add = d.files.reduce((n, f) => n + f.add, 0)
  const del = d.files.reduce((n, f) => n + f.del, 0)
  return void say(d.files.length ? `${head}: +${add} −${del} · ${d.files.length} file${d.files.length === 1 ? '' : 's'}\n${d.files.slice(0, 40).map(f => `<code>${esc(cut(f.path, 120))}</code> +${f.add} −${f.del}`).join('\n')}` : `${head}: no changes`)
}

// the receipt: a 👍 on your message (Telegram may refuse a reaction: then none)
const react = (m: TgMessage) => void out('setMessageReaction', { chat_id: chat(), message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => {})
const ignore = () => ++ignored === 1 && setTimeout(() => (log(`telegram: ignored ${ignored} update(s) from someone else`), (ignored = 0)), 60_000).unref()

// ---------- Settings › Telegram: the bot's token (checked with getMe), switches, Unpair; Send test
export async function telegramSet(p: { token?: unknown; level?: unknown; off?: unknown; waiting?: unknown; done?: unknown; detail?: unknown; topics?: unknown; unpair?: unknown }) {
  const t = T()
  if (typeof p.token === 'string') {
    const tok = p.token.trim()
    if (!tok) {
      keyWrite(KEY, keyFile(), '')
      Object.assign(t, { bot: undefined, user: undefined, threads: undefined, notice: undefined })
      pair = undefined
    } else {
      if (!TOKEN.test(tok)) throw new Error("that isn't a bot token: BotFather's looks like 123456789:AA… (35 characters after the colon)")
      const me = await tg<{ id: number; username?: string; first_name?: string; has_topics_enabled?: boolean }>('getMe', {}, { tok })
      if (!me.username) throw new Error('Telegram says that token is no bot')
      keyWrite(KEY, keyFile(), tok)
      if (t.bot?.id !== me.id) Object.assign(t, { user: undefined, threads: undefined }) // another bot: pair again
      Object.assign(t, { bot: { id: me.id, username: me.username, name: me.first_name ?? me.username, topics: !!me.has_topics_enabled }, notice: undefined, off: undefined })
      offset = 0
    }
  }
  if (p.level !== undefined) {
    if (typeof p.level !== 'string' || !(p.level in RANK)) throw new Error('level: notify, answer or control')
    t.level = p.level as TgLevel
  }
  for (const k of ['off', 'waiting', 'done', 'topics'] as const) if (typeof p[k] === 'boolean') t[k] = p[k]
  if (p.off === false) t.notice = undefined // on again (Try again after a 409): its notice read
  if (p.detail !== undefined) t.detail = p.detail === 'titles' ? 'titles' : undefined
  if (p.unpair === true) Object.assign(t, { user: undefined, threads: undefined }), (pair = undefined), log('telegram: unpaired'), said('unpaired')
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
  const has = !!token()
  if (!t && !has) return undefined
  const { user, threads: _, bot, ...rest } = t ?? {}
  return { ...rest, token: has, ...(bot && { bot: { username: bot.username, name: bot.name, topics: bot.topics } }), ...(user && { user: { name: user.name, at: user.at } }), ...(pair && pair.until > Date.now() && { pairing: pair.until }), ...(ctl && { polling: true }) }
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
  if (!tok || !TOKEN.test(decodeURIComponent(tok))) return
  keyWrite(KEY, keyFile(), decodeURIComponent(tok))
  const t = T()
  Object.assign(t, { level: 'answer', waiting: w.waiting, done: w.done === true, detail: w.detail })
  if (Number.isSafeInteger(id) && id > 0) t.user = { id, name: '', at: Date.now() }
  else t.notice = 'Your Telegram pushes went to a group: Laki now pairs one person in their private chat with the bot. Pair again (step 2)'
  log('telegram: the phone push to Telegram moved to Settings › Telegram')
}
// the bot's name (getMe) once, for one migrated or kept from before
export async function tgStart() {
  if (token() && !state.telegram?.bot)
    await tg<{ id: number; username?: string; first_name?: string; has_topics_enabled?: boolean }>('getMe').then(
      me => me.username && ((T().bot = { id: me.id, username: me.username, name: me.first_name ?? me.username, topics: !!me.has_topics_enabled }), save()),
      e => log(`telegram: ${(e as Error).message}`),
    )
  sync()
}
