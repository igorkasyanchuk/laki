// S18: the artifacts viewer's network (the daemon's GET /artifact and /worktree, main.ts artCsp): scripts, styles and
// fonts from these CDNs, pictures and media only from the page's own folder, any other host once the user allows it
// (for one report: artifactAllow, kept in memory; always: settings.artifactHosts). What a page would load from where,
// read from its HTML (artLoads), so the viewer can say what the CSP blocked: a securitypolicyviolation listener can't run
// in the sandboxed page from outside. Pure: test/art-hosts.test.ts

export const ART_CDNS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com']
export type ArtKind = 'script' | 'style' | 'font' | 'image' | 'media'
export type ArtBlocked = { host: string; loads: Partial<Record<ArtKind, number>> }

// a host a user may allow: a name with a dot and an optional port; no IP, no localhost or .local (this Mac, the LAN)
export const artHostOk = (h: unknown): h is string =>
  typeof h === 'string' && h.length <= 253 && /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?(:\d{1,5})?$/i.test(h) && !/\.(local|localhost|internal)(:\d+)?$/i.test(h)

const TAG = /<(script|link|img|source|video|audio|track|image|use|input)\b([^>]*)>/gi
const ATTR = /\b(src|href|srcset|poster|xlink:href|rel|as)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const FONT = /\.(woff2?|ttf|otf|eot)([?#]|$)/i
const hostOf = (u: string) => (/^https:\/\//i.test(u.trim()) && URL.canParse(u.trim()) ? new URL(u.trim()).host.toLowerCase() : undefined)

// every https host the page names in a tag or its CSS, with what it loads from there
export function artLoads(html: string): Map<string, Partial<Record<ArtKind, number>>> {
  const out = new Map<string, Partial<Record<ArtKind, number>>>()
  const add = (u: string | undefined, kind: ArtKind | undefined) => {
    const h = u && kind && hostOf(u)
    if (!h) return
    const m = out.get(h) ?? out.set(h, {}).get(h)!
    m[kind!] = (m[kind!] ?? 0) + 1
  }
  for (const [, tag, attrs] of html.matchAll(TAG)) {
    const a: Record<string, string> = {}
    for (const m of attrs.matchAll(ATTR)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    const t = tag.toLowerCase()
    const rel = (a.rel ?? '').toLowerCase()
    if (t === 'script') add(a.src, 'script')
    else if (t === 'link') add(a.href, /stylesheet/.test(rel) ? 'style' : /icon/.test(rel) ? 'image' : /preload|prefetch/.test(rel) ? (a.as === 'script' ? 'script' : a.as === 'style' ? 'style' : a.as === 'font' ? 'font' : 'image') : undefined)
    else if (t === 'video' || t === 'audio' || t === 'track') add(a.src, 'media'), add(a.poster, 'image')
    else if (t === 'source') add(a.src, 'media')
    else add(a.src ?? a.href ?? a['xlink:href'], 'image')
    for (const s of (a.srcset ?? '').split(',')) add(s.trim().split(/\s+/)[0], 'image')
  }
  for (const [, , u] of html.matchAll(/(?<!@import\s*)url\(\s*(['"]?)(https:\/\/[^'")\s]+)\1\s*\)/gi)) add(u, FONT.test(u) ? 'font' : 'image')
  for (const [, , u] of html.matchAll(/@import\s+(?:url\(\s*)?(['"]?)(https:\/\/[^'")\s;]+)\1/gi)) add(u, 'style')
  return out
}

// what the CSP blocks of a page's loads, with these hosts allowed: a CDN's script, style or font goes; any other host's
// load, and a CDN's picture or media, is blocked
export function artBlocked(html: string, allowed: string[]): ArtBlocked[] {
  const ok = new Set(allowed.map(h => h.toLowerCase()))
  const out: ArtBlocked[] = []
  for (const [host, loads] of artLoads(html)) {
    if (ok.has(host)) continue
    const cdn = ART_CDNS.includes(host)
    const left = Object.fromEntries(Object.entries(loads).filter(([k]) => !cdn || k === 'image' || k === 'media'))
    if (Object.keys(left).length) out.push({ host, loads: left })
  }
  return out
}

// the CSP's sources for a kind: the CDNs (scripts, styles, fonts) and the hosts allowed
export function artCsp(allowed: string[]): string {
  const own = allowed.filter(artHostOk).map(h => `https://${h}`)
  const cdn = [...ART_CDNS.map(h => `https://${h}`), ...own].join(' ')
  const pics = ["'self'", 'data:', 'blob:', ...own].join(' ')
  return `sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' ${cdn}; style-src 'self' 'unsafe-inline' ${cdn}; img-src ${pics}; font-src 'self' data: ${cdn}; media-src ${pics}`
}

// the words for the viewer's bar: "cdn.example (1 script) · i.imgur.com (2 images)"
const WORD: Record<ArtKind, string> = { script: 'script', style: 'stylesheet', font: 'font', image: 'image', media: 'media file' }
export const artSay = (b: ArtBlocked[]) => b.map(x => `${x.host} (${Object.entries(x.loads).map(([k, n]) => `${n} ${WORD[k as ArtKind]}${n === 1 ? '' : 's'}`).join(', ')})`).join(' · ')
