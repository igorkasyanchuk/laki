// The header's fun button: a random meme from r/memes, for a break. Reddit's random.json first, else meme-api.com, which
// serves the same subreddit (Reddit's bot wall, "blocked by network security", turns requests away now and then, more so
// from some networks). Only on a click; nothing NSFW or spoilered; the picture comes back as a data: URL (the page's CSP
// loads nothing from the web), 8 MB at most.
// LAKI_MEME_API: tests' fake server for both, on this Mac only.
const UA = 'web:laki:v1.0.0 (by /u/laki-app)' // Reddit's format: <platform>:<app>:<version> (by /u/<user>)
const MAX = 8 << 20
const fake = () => (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.LAKI_MEME_API ?? '') ? process.env.LAKI_MEME_API! : '')

export type Meme = { title: string; link: string; image: string; by?: string }
type Post = { title: string; link: string; url: string; by?: string }

const json = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return r.json()
}
// a picture's URL: https (or the fake server's), a still or a GIF
const picture = (u: unknown): u is string => typeof u === 'string' && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) && (u.startsWith('https://') || (!!fake() && u.startsWith(`${fake()}/`)))

async function fromReddit(): Promise<Post | undefined> {
  const d = await json(`${fake() || 'https://www.reddit.com'}/r/memes/random.json`)
  const posts = (Array.isArray(d) ? d : [d]).flatMap((l: any) => l?.data?.children ?? []).map((c: any) => c?.data)
  const p = posts.find(p => p && !p.over_18 && !p.spoiler && picture(p.url))
  return p && { title: String(p.title ?? ''), link: `https://www.reddit.com${p.permalink ?? ''}`, url: p.url, by: p.author }
}

async function fromMirror(): Promise<Post | undefined> {
  const p = await json(`${fake() || 'https://meme-api.com'}/gimme/memes`)
  return p && !p.nsfw && !p.spoiler && picture(p.url) ? { title: String(p.title ?? ''), link: String(p.postLink ?? ''), url: p.url, by: p.author } : undefined
}

export async function meme(): Promise<Meme> {
  let why = ''
  for (const from of [fromReddit, fromMirror, fromMirror, fromMirror]) {
    try {
      const m = await from()
      if (!m) continue
      const r = await fetch(m.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) })
      const type = (r.headers.get('content-type') ?? '').split(';')[0]
      if (!r.ok || !type.startsWith('image/') || Number(r.headers.get('content-length')) > MAX) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX) continue
      return { title: m.title, link: m.link, by: m.by, image: `data:${type};base64,${buf.toString('base64')}` }
    } catch (e) {
      why = (e as Error).message
    }
  }
  throw new Error(`no meme this time${why ? ` (${why})` : ''}: try Next again`)
}
