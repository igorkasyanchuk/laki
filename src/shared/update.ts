// Updates: the newest release on the public releases repo (package.json's build.publish), compared with this app's
// version. Main checks (src/main/update.ts) and, on a signed Mac, downloads through Electron's autoUpdater
// (Squirrel.Mac) from the feed scripts/release.sh uploads with each release: update-mac-<arch>.json.

export const RELEASES = 'igorkasyanchuk/laki-releases'
export const RELEASES_URL = `https://github.com/${RELEASES}/releases`
export const UPDATE_EVERY = 4 * 60 * 60_000 // auto checks: at launch, then every 4 hours

export type Release = { version: string; notes: string; url: string; at?: string; feed: boolean } // feed: this Mac's
export type UpdateState = {
  version: string // this app's
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  latest?: Release // the newest release, once a check found one newer
  checked?: number // the last check that answered (ms)
  error?: string
  install: boolean // this copy replaces itself: a Mac, packaged, Developer ID signed; else Download is the release page
  found?: boolean // this state's check found a version not told about before (the app's toast)
  held?: { version: string; until: number } // a newer release Settings' Update delay holds back until then (ms)
  passed?: string // R7: the newest release is one you chose to skip (Skip this version): not offered until a newer one is out
}

// R7: what the newest release is to this copy: none (not newer), passed (the one you skipped, exactly), a time it's
// held until (the update delay; skip: Skip the delay once let that version in), or offer
export function verdict(latest: Release | null | undefined, version: string, o: { skip?: string; pass?: string }, delay: number, now = Date.now()): 'none' | 'passed' | 'offer' | number {
  if (!latest || !newer(latest.version, version)) return 'none'
  if (o.pass === latest.version) return 'passed'
  return (o.skip === latest.version ? undefined : heldUntil(latest.at, delay, now)) ?? 'offer'
}

// Settings › Updates' Update delay: a release is offered once it's that many days old (unset: at once)
export const UPDATE_DELAYS = [0, 1, 3, 7, 14, 30]

// when a release published at `at` is offered under a delay of `days`: undefined once it is (or with no date or delay)
export function heldUntil(at: string | undefined, days: number, now = Date.now()): number | undefined {
  const t = at ? Date.parse(at) : Number.NaN
  if (!(days > 0) || Number.isNaN(t)) return undefined
  const until = t + days * 86_400_000
  return until > now ? until : undefined
}

// 1.2.3 vs 1.2.10, a pre-release before its release (1.3.0-beta.1 < 1.3.0); a leading v allowed
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const t = v.replace(/^v/, '')
    const i = t.indexOf('-') // the pre-release is all after the first hyphen: rc-2
    return { n: (i < 0 ? t : t.slice(0, i)).split('.').map(x => Number.parseInt(x, 10) || 0), pre: i < 0 ? '' : t.slice(i + 1) }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0)
  if (x.pre === y.pre) return false
  if (!x.pre) return true // the release after its pre-releases
  if (!y.pre) return false
  return x.pre.localeCompare(y.pre, 'en', { numeric: true }) > 0
}

// GitHub's releases/latest answer: its version, notes and page, and whether it has this Mac's feed
export function releaseOf(r: { tag_name?: string; body?: string | null; html_url?: string; published_at?: string; assets?: { name: string }[] }, arch: string): Release | null {
  if (!r.tag_name) return null
  return {
    version: r.tag_name.replace(/^v/, ''),
    notes: (r.body ?? '').trim(),
    url: r.html_url || RELEASES_URL,
    at: r.published_at,
    feed: !!r.assets?.some(a => a.name === feedName(arch)),
  }
}

export const feedName = (arch: string) => `update-mac-${arch}.json`

// Squirrel.Mac's static feed (Electron's autoUpdater, serverType 'json'): this version only, its zip for one Mac.
// currentRelease must be the app's CFBundleShortVersionString (package.json's version) to count as new. pub_date
// without fractional seconds: Squirrel.Mac reads RFC 3339's yyyy-MM-ddTHH:mm:ssZ
export function feedOf(version: string, arch: string, notes: string, at: string, repo = RELEASES): string {
  const url = `https://github.com/${repo}/releases/download/v${version}/Laki-${version}-${arch}.zip`
  const pub_date = at.replace(/\.\d+(?=Z$|[+-]\d\d:\d\d$)/, '')
  return JSON.stringify({ currentRelease: version, releases: [{ version, updateTo: { version, name: `Laki ${version}`, notes, pub_date, url } }] })
}

// U13: What's new after an update: the first three lines of a version's section of docs/release-notes.md (`## 0.49.0 ·
// date`), each with its trailing `[Try it](laki://…)` link apart (a line may end with one; scripts/notes.ts keeps it).
// None: no such section (a build between releases)
export type NewLine = { text: string; link?: string }
export function notesOf(md: string, version: string, n = 3): NewLine[] {
  const text = md.replace(/<!--[\s\S]*?-->/g, '')
  const at = text.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}( ·|\\s*$)`, 'm'))
  if (at < 0) return []
  const body = text.slice(at).split('\n').slice(1)
  const end = body.findIndex(l => l.startsWith('## '))
  return (end < 0 ? body : body.slice(0, end))
    .filter(l => l.startsWith('- '))
    .slice(0, n)
    .map(l => {
      const m = /\s*\[[^\]]*\]\((laki:\/\/[^)\s]+)\)\s*$/.exec(l)
      return { text: (m ? l.slice(0, m.index) : l).slice(2).trim(), ...(m && { link: m[1] }) }
    })
}
