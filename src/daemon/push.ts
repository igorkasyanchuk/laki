// Pushes to your phone (Settings › Notifications webhook): an agent waiting for you or done, posted to the URL you give
// as ntfy, Slack, Telegram (its whole sendMessage URL, chat_id included) or plain JSON wants it. Only to that URL: no
// telemetry. Fire and forget, 5 s at most; the caller logs a failure. A waiting agent's menu goes as lines of text;
// with Answer from the phone (webhook.answer), Telegram and ntfy get a button per choice, whose tap comes back
// through replies() with the push's nonce.
import { type Webhook, webhookUrl } from '../shared/types.ts'

export type Option = { n: number; label: string }
export type Push = { event: 'waiting' | 'done' | 'test'; workspace: string; tab: string; agent: string; question?: string; options?: Option[]; nonce?: string }

export function pushText(p: Push) {
  const title = p.event === 'test' ? 'Laki: pushes reach you' : `${p.agent} in ${p.workspace} is ${p.event === 'waiting' ? 'waiting for you' : 'done'}`
  const body = [p.question, ...(p.options ?? []).map(o => `${o.n}. ${o.label}`)].filter(Boolean).join('\n')
  return { title, body, text: body ? `${title}\n${body}` : title }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
// buttons: only with a nonce (answer on) and choices
const buttons = (p: Push) => (p.nonce && p.options?.length ? p.options : [])
// a Telegram bot URL's parts: https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
const telegram = (url?: string) => {
  const m = URL.canParse(url ?? '') ? /^\/(bot[^/]+)\//.exec(new URL(url!).pathname) : null
  return m ? { api: `${new URL(url!).origin}/${m[1]}`, chat: new URL(url!).searchParams.get('chat_id') ?? undefined } : undefined
}
// where taps on an ntfy push's buttons go: the topic's URL with -<replyTopic> after it (a random part, Settings'), and
// the topic's query (an ?auth=) to go with it
const ntfyJson = (w: Webhook, p: Push) => (w.format ?? 'ntfy') === 'ntfy' && buttons(p).length > 0 && !!ntfyReplies(w)
export const ntfyReplies = (w: Webhook) => {
  if (!w.replyTopic || !URL.canParse(w.url ?? '')) return undefined
  const u = new URL(w.url!)
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}-${w.replyTopic}`, query: u.search }
}

// the request the webhook's format wants
export function pushRequest(w: Webhook, p: Push, now = Date.now()): RequestInit {
  const { title, body, text } = pushText(p)
  const taps = buttons(p)
  const json = (b: object): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  switch (w.format ?? 'ntfy') {
    case 'ntfy': {
      // buttons: JSON to the server's root (ntfy takes 3 actions at most: the first 3 choices; all are in the text),
      // each posting its nonce:n to the reply topic. Else a header is bytes: anything past ASCII (an emoji in a
      // name) as RFC 2047, which ntfy reads
      if (ntfyJson(w, p))
        return json({ topic: new URL(w.url!).pathname.replace(/^\/+|\/+$/g, ''), title, message: body || title, actions: taps.slice(0, 3).map(o => ({ action: 'http', label: cut(`${o.n}. ${o.label}`, 40), url: `${ntfyReplies(w)!.url}${ntfyReplies(w)!.query}`, method: 'POST', body: `${p.nonce}:${o.n}`, clear: true })) })
      return { method: 'POST', headers: { title: /^[\x20-\x7e]*$/.test(title) ? title : `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=` }, body: body || title }
    }
    case 'slack': // Slack reads <…> as links and mentions (<!channel>)
      return json({ text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') })
    case 'telegram': // chat_id from the URL in the body too: Telegram reads either; a button per choice, a row each
      return json({ chat_id: telegram(w.url)?.chat, text, ...(taps.length && { reply_markup: { inline_keyboard: taps.map(o => [{ text: cut(`${o.n}. ${o.label}`, 60), callback_data: `${p.nonce}:${o.n}` }]) } }) })
    default:
      return json({ event: p.event, workspace: p.workspace, tab: p.tab, agent: p.agent, message: text, ...(p.options?.length && { options: p.options }), ts: now })
  }
}

export async function pushTo(w: Webhook, p: Push) {
  const u = new URL(webhookUrl(w.url))
  const to = ntfyJson(w, p) ? `${u.origin}/${u.search}` : u.href // ntfy's JSON goes to the server's root (an ?auth= kept)
  const res = await fetch(to, { ...pushRequest(w, p), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`the webhook answered ${res.status} ${res.statusText}`.trim())
}

// taps on the buttons since the last look: Telegram's callback queries from the webhook's own chat (getUpdates, from
// offset; each one acknowledged, so the button stops spinning), ntfy's messages on the reply topic (since: a message
// id or a unix time). The cursor moves on whatever they say; only nonce:n bodies count
export type Tap = { nonce: string; n: number }
const TAP = /^([0-9a-f]{16}):(\d{1,2})$/
export async function replies(w: Webhook, cursor: string): Promise<{ taps: Tap[]; cursor: string }> {
  const taps: Tap[] = []
  const tap = (s: unknown) => {
    const m = typeof s === 'string' ? TAP.exec(s.trim()) : null
    if (m) taps.push({ nonce: m[1], n: Number(m[2]) })
  }
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
    return res.text()
  }
  if (w.format === 'telegram') {
    const t = telegram(webhookUrl(w.url))
    if (!t?.chat) return { taps, cursor }
    const j = JSON.parse(await get(`${t.api}/getUpdates?offset=${Number(cursor) || 0}&timeout=0&allowed_updates=${encodeURIComponent('["callback_query"]')}`))
    for (const u of j.result ?? []) {
      cursor = String(Math.max(Number(cursor) || 0, u.update_id + 1))
      const q = u.callback_query
      if (!q || String(q.message?.chat?.id) !== t.chat) continue
      tap(q.data)
      void fetch(`${t.api}/answerCallbackQuery?callback_query_id=${encodeURIComponent(q.id)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
    }
    return { taps, cursor }
  }
  const to = ntfyReplies(w)
  if (!to) return { taps, cursor }
  for (const line of (await get(`${webhookUrl(to.url)}/json?poll=1&since=${encodeURIComponent(cursor)}${to.query.replace(/^\?/, '&')}`)).split('\n')) {
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.event !== 'message') continue
    cursor = m.id
    tap(m.message)
  }
  return { taps, cursor }
}
