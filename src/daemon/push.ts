// Pushes to your phone (Settings › Phone pushes): an agent waiting for you or done, posted to the URL you give
// as ntfy, Slack, Telegram (its whole sendMessage URL, chat_id included) or plain JSON wants it. Only to that URL: no
// telemetry. Fire and forget, 5 s at most; the caller logs a failure. A waiting agent's menu goes as lines of text;
// with Answer from the phone (webhook.answer), Telegram and ntfy get a button per choice, whose tap comes back
// through replies() with the push's nonce. Web Push (M4): to the phones paired with remote access that turned
// notifications on, encrypted for each (RFC 8291) through its browser vendor's push service; a tap posts back to /tap.
import { createCipheriv, createECDH, createHmac, createPrivateKey, type ECDH, generateKeyPairSync, hkdfSync, randomBytes, sign, timingSafeEqual } from 'node:crypto'
import { type Webhook, webhookUrl } from '../shared/types.ts'

export type Option = { n: number; label: string }
export type Push = { event: 'waiting' | 'done' | 'test' | 'long'; workspace: string; tab: string; agent: string; question?: string; options?: Option[]; nonce?: string; key?: string; title?: string } // title: its own (a workflow's); key: what signs ntfy's taps

// an ntfy tap is nonce:n:<sig>, signed with a key in Laki's data folder (never in settings): a tap made up without it
// is ignored. ponytail: anyone who reads the pushed topic sees the taps too, so answers need a topic only you read (answerOk)
export const tapSig = (key: string, nonce: string, n: number) => createHmac('sha256', key).update(`${nonce}:${n}`).digest('hex').slice(0, 16)

export function pushText(p: Push) {
  const title = p.title ?? (p.event === 'test' ? 'Laki: pushes reach you' : `${p.agent} in ${p.workspace} is ${p.event === 'waiting' ? 'waiting for you' : 'done'}`)
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

// nothing off the screen goes (L8): who needs you only
const shown = (w: Webhook, p: Push): Push => (w.detail === 'titles' ? { ...p, question: undefined, options: undefined, nonce: undefined } : p)
// the request the webhook's format wants
export function pushRequest(w: Webhook, p: Push, now = Date.now()): RequestInit {
  p = shown(w, p)
  const { title, body, text } = pushText(p)
  const taps = buttons(p)
  const json = (b: object): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  switch (w.format ?? 'ntfy') {
    case 'ntfy': {
      // buttons: JSON to the server's root (ntfy takes 3 actions at most: the first 3 choices; all are in the text),
      // each posting its nonce:n to the reply topic. Else a header is bytes: anything past ASCII (an emoji in a
      // name) as RFC 2047, which ntfy reads
      if (ntfyJson(w, p))
        return json({ topic: new URL(w.url!).pathname.replace(/^\/+|\/+$/g, ''), title, message: body || title, actions: taps.slice(0, 3).map(o => ({ action: 'http', label: cut(`${o.n}. ${o.label}`, 40), url: `${ntfyReplies(w)!.url}${ntfyReplies(w)!.query}`, method: 'POST', body: `${p.nonce}:${o.n}:${tapSig(p.key ?? '', p.nonce!, o.n)}`, clear: true })) })
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

// ---------- Web Push (format webpush): RFC 8291's aes128gcm, RFC 8292's VAPID. The subscriptions are paired devices'
// (phone.ts fills webPush: remote.ts keeps one per device), the keys this Mac's (vapid.json, 0600)
export type WebSub = { endpoint: string; p256dh: string; auth: string } // a browser's PushSubscription: its keys base64url
export type Vapid = { pub: string; key: string } // pub: the raw P-256 public point, base64url (the page's applicationServerKey); key: the private one, PKCS8 PEM
export const webPush: { devices?: () => WebSub[]; vapid?: () => Vapid; gone?: (endpoint: string) => void } = {}
// only a browser vendor's push service takes our bytes (Chrome's, Firefox's, Safari's, Edge's): never this Mac or a
// network's, whatever a page sent as its endpoint
export const PUSH_HOSTS = /^(fcm\.googleapis\.com|([\w-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([\w-]+\.)*notify\.windows\.com)$/
export const subOk = (s: unknown): s is WebSub => {
  const o = s as WebSub
  return !!o && typeof o.endpoint === 'string' && o.endpoint.length < 2048 && URL.canParse(o.endpoint) && new URL(o.endpoint).protocol === 'https:' && PUSH_HOSTS.test(new URL(o.endpoint).hostname) && /^[\w-]{80,100}$/.test(String(o.p256dh)) && /^[\w-]{16,32}$/.test(String(o.auth))
}
const b64u = (b: Buffer) => b.toString('base64url')
export function vapidNew(): Vapid {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const j = publicKey.export({ format: 'jwk' })
  return { pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(j.x!, 'base64url'), Buffer.from(j.y!, 'base64url')])), key: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string }
}
// VAPID's Authorization: an ES256 JWT for the push service's origin, 12 hours (24 at most), and our public key. sub: Laki's
// site, never the user's address
export function vapidAuth(endpoint: string, v: Vapid, now = Date.now()) {
  const part = (o: object) => b64u(Buffer.from(JSON.stringify(o)))
  const signed = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'https://laki.sh' })}`
  return `vapid t=${signed}.${b64u(sign('sha256', Buffer.from(signed), { key: createPrivateKey(v.key), dsaEncoding: 'ieee-p1363' }))}, k=${v.pub}`
}
// RFC 8291: an ECDH P-256 key of its own (ecdh, salt: tests'), the subscription's auth secret, HKDF, AES-128-GCM, one
// record (RFC 8188's header: salt, 4096, the key)
export function webPushEncrypt(sub: WebSub, plain: Buffer, o: { ecdh?: ECDH; salt?: Buffer } = {}) {
  const ua = Buffer.from(sub.p256dh, 'base64url')
  const ecdh = o.ecdh ?? createECDH('prime256v1')
  if (!o.ecdh) ecdh.generateKeys()
  const as = ecdh.getPublicKey()
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(ua), Buffer.from(sub.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32))
  const salt = o.salt ?? randomBytes(16)
  const key = (info: string, n: number) => Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(`Content-Encoding: ${info}\0`), n))
  const c = createCipheriv('aes-128-gcm', key('aes128gcm', 16), key('nonce', 12))
  const body = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]) // 2: the last record
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, body])
}
// what the service worker shows: title, body, a tag (one per tab: a newer one replaces it), and at most 2 actions (what
// browsers show): the first and the last choice, each the tap ntfy's buttons send (nonce:n:sig)
export function webPushPayload(w: Webhook, p: Push) {
  p = shown(w, p)
  const { title, body } = pushText(p)
  const taps = buttons(p)
  return { title, body: cut(body, 1500), tag: p.tab || title, actions: (taps.length > 2 ? [taps[0], taps.at(-1)!] : taps).map(o => ({ title: cut(o.label, 40), tap: `${p.nonce}:${o.n}:${tapSig(p.key ?? '', p.nonce!, o.n)}` })) }
}
export function webPushRequest(w: Webhook, sub: WebSub, p: Push, v: Vapid, now = Date.now(), o?: { ecdh?: ECDH; salt?: Buffer }): { url: string; init: RequestInit } {
  return { url: sub.endpoint, init: { method: 'POST', headers: { authorization: vapidAuth(sub.endpoint, v, now), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: p.event === 'waiting' ? 'high' : 'normal' }, body: webPushEncrypt(sub, Buffer.from(JSON.stringify(webPushPayload(w, p))), o) } }
}

export async function pushTo(w: Webhook, p: Push) {
  if (w.format === 'webpush') {
    const subs = webPush.devices?.() ?? []
    if (!subs.length) throw new Error('no phone has notifications on: open remote access there (Tailscale or My domain), add Laki to its Home Screen, then turn notifications on')
    let ok = 0
    for (const s of subs) {
      const r = webPushRequest(w, s, p, webPush.vapid!())
      const res = await fetch(r.url, { ...r.init, signal: AbortSignal.timeout(5000), redirect: 'error' }).catch(() => undefined)
      if (res?.status === 404 || res?.status === 410) webPush.gone?.(s.endpoint) // unsubscribed, or the app removed
      else if (res?.ok) ok++
    }
    if (!ok) throw new Error('no push service took it')
    return
  }
  const u = new URL(webhookUrl(w.url))
  const to = ntfyJson(w, p) ? `${u.origin}/${u.search}` : u.href // ntfy's JSON goes to the server's root (an ?auth= kept)
  const res = await fetch(to, { ...pushRequest(w, p), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`the webhook answered ${res.status} ${res.statusText}`.trim())
}

// taps on the buttons since the last look: Telegram's callback queries from the webhook's own chat (getUpdates, from
// offset; each one acknowledged, so the button stops spinning), ntfy's messages on the reply topic (since: a message
// id or a unix time). The cursor moves on whatever they say; only nonce:n bodies count
export type Tap = { nonce: string; n: number }
const TAP = /^([0-9a-f]{16}):(\d{1,2})(?::([0-9a-f]{16}))?$/
// a tap's text (nonce:n, signed: nonce:n:sig with key's tapSig): ntfy's from its reply topic, Web Push's from /tap
export function tapOf(s: unknown, key: string, signed = true): Tap | undefined {
  const m = typeof s === 'string' ? TAP.exec(s.trim()) : null
  if (m && (!signed || (m[3] && timingSafeEqual(Buffer.from(m[3]), Buffer.from(tapSig(key, m[1], Number(m[2]))))))) return { nonce: m[1], n: Number(m[2]) }
}
// key: ntfy's taps' (tapSig); one without its signature is ignored
export async function replies(w: Webhook, cursor: string, key = ''): Promise<{ taps: Tap[]; cursor: string }> {
  const taps: Tap[] = []
  const tap = (s: unknown, signed = false) => (t => t && taps.push(t))(tapOf(s, key, signed))
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
    tap(m.message, true)
  }
  return { taps, cursor }
}
