// Pushes to your phone (Settings › Notifications webhook): an agent waiting for you or done, posted to the URL you give
// as ntfy, Slack, Telegram (its whole sendMessage URL, chat_id included) or plain JSON wants it. Only to that URL: no
// telemetry. Fire and forget, 5 s at most; the caller logs a failure.
import type { Webhook } from '../shared/types.ts'

export type Push = { event: 'waiting' | 'done' | 'test'; workspace: string; tab: string; agent: string; question?: string }

export function pushText(p: Push) {
  const title = p.event === 'test' ? 'Laki: pushes reach you' : `${p.agent} in ${p.workspace} is ${p.event === 'waiting' ? 'waiting for you' : 'done'}`
  return { title, text: p.question ? `${title}\n${p.question}` : title }
}

// the request the webhook's format wants
export function pushRequest(w: Webhook, p: Push, now = Date.now()): RequestInit {
  const { title, text } = pushText(p)
  const json = (b: object): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  switch (w.format ?? 'ntfy') {
    case 'ntfy': // a header is bytes: anything past ASCII (an emoji in a name) as RFC 2047, which ntfy reads
      return { method: 'POST', headers: { title: /^[\x20-\x7e]*$/.test(title) ? title : `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=` }, body: p.question || title }
    case 'slack': // Slack reads <…> as links and mentions (<!channel>)
      return json({ text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') })
    case 'telegram':
      return json({ text })
    default:
      return json({ event: p.event, workspace: p.workspace, tab: p.tab, agent: p.agent, message: text, ts: now })
  }
}

export function webhookUrl(url?: string) {
  let u: URL
  try {
    u = new URL(String(url ?? '').trim())
  } catch {
    throw new Error('the webhook needs a URL')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('the webhook URL must start with https://')
  return u.href
}

export async function pushTo(w: Webhook, p: Push) {
  const res = await fetch(webhookUrl(w.url), { ...pushRequest(w, p), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`the webhook answered ${res.status} ${res.statusText}`.trim())
}
