// laki:// links (macOS opens the app with them): a workspace or tab, the new-workspace page filled in, Scheduled
// tasks, Settings, Help. They select and fill in, never start anything: a link from anywhere can't run an agent.
export type Link =
  | { to: 'ws'; ws: string; tab?: string }
  | { to: 'new'; project?: string; prompt?: string; preset?: string; name?: string }
  | { to: 'schedules'; project?: string }
  | { to: 'settings'; section?: string }
  | { to: 'help' }

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseLink(url: string): Link | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'laki:') return null
  const q = (k: string) => u.searchParams.get(k) || undefined
  const arg = u.pathname.split('/').filter(Boolean).map(decode)[0] // laki://ws/<id>
  switch (u.host.toLowerCase()) {
    case 'ws':
      return arg ? { to: 'ws', ws: arg, tab: q('tab') } : null
    case 'new':
      return { to: 'new', project: q('project'), prompt: q('prompt'), preset: q('preset'), name: q('name') }
    case 'schedules':
      return { to: 'schedules', project: arg ?? q('project') }
    case 'settings':
      return { to: 'settings', section: arg ?? q('section') }
    case 'help':
      return { to: 'help' }
  }
  return null
}

export const wsLink = (ws: string, tab?: string) => `laki://ws/${encodeURIComponent(ws)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`
