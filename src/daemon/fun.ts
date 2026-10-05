// The header's fun button: a random meme, for a break, from r/memes, r/ProgrammerHumor or r/wholesomememes, pictures
// only. A subreddit's hot posts come from Reddit (hot.json), else meme-api.com, which serves the same (Reddit's bot wall,
// "blocked by network security", turns requests away now and then, more so from some networks); they're kept 15 minutes,
// and a click gets one at random that wasn't shown yet (the last 500). Only on a click; nothing NSFW or spoilered; the
// picture comes back as a data: URL (the page's CSP loads nothing from the web), 8 MB at most.
// LAKI_MEME_API: tests' fake server for both, on this Mac only.
const UA = 'web:laki:v1.0.0 (by /u/laki-app)' // Reddit's format: <platform>:<app>:<version> (by /u/<user>)
const MAX = 8 << 20
const fake = () => (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.LAKI_MEME_API ?? '') ? process.env.LAKI_MEME_API! : '')

export type Meme = { title: string; link: string; image: string; by?: string; sub?: string }
type Post = { title: string; link: string; url: string; by?: string; sub: string }

const SUBS = ['memes', 'ProgrammerHumor', 'wholesomememes']
const KEEP = 15 * 60000
const pools = new Map<string, { at: number; posts: Post[] }>() // each subreddit's pictures, as last fetched
const seen: string[] = [] // pictures shown (their URLs), oldest first

const json = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return r.json()
}
// a picture's URL: https (or the fake server's), a still or a GIF
const picture = (u: unknown): u is string => typeof u === 'string' && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) && (u.startsWith('https://') || (!!fake() && u.startsWith(`${fake()}/`)))

async function fromReddit(sub: string): Promise<Post[]> {
  const d = await json(`${fake() || 'https://www.reddit.com'}/r/${sub}/hot.json?limit=100&raw_json=1`)
  return (d?.data?.children ?? [])
    .map((c: any) => c?.data)
    .filter((p: any) => p && !p.over_18 && !p.spoiler && !p.stickied && picture(p.url))
    .map((p: any) => ({ title: String(p.title ?? ''), link: `https://www.reddit.com${p.permalink ?? ''}`, url: p.url, by: p.author, sub }))
}

async function fromMirror(sub: string): Promise<Post[]> {
  const d = await json(`${fake() || 'https://meme-api.com'}/gimme/${sub}/50`)
  return (Array.isArray(d?.memes) ? d.memes : [])
    .filter((p: any) => p && !p.nsfw && !p.spoiler && picture(p.url))
    .map((p: any) => ({ title: String(p.title ?? ''), link: /^https:\/\//.test(p.postLink) ? p.postLink : `https://www.reddit.com/r/${sub}`, url: p.url, by: p.author, sub })) // a link it gives: only https
}

// a subreddit's pictures: the kept ones, fetched again once 15 minutes old or all shown
async function postsOf(sub: string) {
  const kept = pools.get(sub)
  if (kept && Date.now() - kept.at < KEEP && kept.posts.some(p => !seen.includes(p.url))) return kept.posts
  const posts = await fromReddit(sub).then(
    ps => (ps.length ? ps : fromMirror(sub)),
    () => fromMirror(sub),
  )
  pools.set(sub, { at: Date.now(), posts })
  return posts
}

const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function meme(): Promise<Meme> {
  let why = ''
  for (const sub of shuffle([...SUBS])) {
    try {
      const posts = await postsOf(sub)
      const fresh = posts.filter(p => !seen.includes(p.url))
      for (const m of shuffle(fresh.length ? fresh : [...posts]).slice(0, 3)) {
        seen.push(m.url)
        if (seen.length > 500) seen.shift()
        const r = await fetch(m.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }).catch(e => ((why = (e as Error).message), null))
        const type = (r?.headers.get('content-type') ?? '').split(';')[0]
        if (!r?.ok || !type.startsWith('image/') || Number(r.headers.get('content-length')) > MAX) continue
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > MAX) continue
        return { title: m.title, link: m.link, by: m.by, sub, image: `data:${type};base64,${buf.toString('base64')}` }
      }
    } catch (e) {
      why = (e as Error).message
    }
  }
  throw new Error(`no meme this time${why ? ` (${why})` : ''}: try Next again`)
}
