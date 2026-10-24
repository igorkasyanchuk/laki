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
