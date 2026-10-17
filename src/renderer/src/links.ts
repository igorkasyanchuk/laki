// laki:// links (macOS opens the app with them): a workspace or tab, the new-workspace page filled in, Scheduled
// tasks, the board, the AI page, Settings, Help, About and Get started (the app menu's). They select and fill in, never start anything: a link from anywhere can't run an agent.
export type Link =
  | { to: 'ws'; ws: string; tab?: string }
  | { to: 'new'; project?: string; prompt?: string; preset?: string; name?: string }
  | { to: 'schedules'; project?: string }
  | { to: 'settings'; section?: string }
  | { to: 'extension'; id: string; inspect?: boolean } // laki://settings/widgets/<id>[/inspect]: its page, or its inspector
  | { to: 'help' }
  | { to: 'board' }
  | { to: 'ai' }
  | { to: 'about' }
  | { to: 'onboard' }

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
  const parts = u.pathname.split('/').filter(Boolean).map(decode)
  const arg = parts[0] // laki://ws/<id>
  switch (u.host.toLowerCase()) {
    case 'ws':
      return arg ? { to: 'ws', ws: arg, tab: q('tab') } : null
    case 'new':
      return { to: 'new', project: q('project'), prompt: q('prompt'), preset: q('preset'), name: q('name') }
    case 'schedules':
      return { to: 'schedules', project: arg ?? q('project') }
    case 'settings':
      if (arg === 'widgets' && parts[1]) return { to: 'extension', id: parts[1], ...(parts[2] === 'inspect' && { inspect: true }) }
      return { to: 'settings', section: arg ?? q('section') }
    case 'help':
      return { to: 'help' }
    case 'board':
      return { to: 'board' }
    case 'ai':
      return { to: 'ai' }
    case 'about':
      return { to: 'about' }
    case 'onboard':
      return { to: 'onboard' }
  }
  return null
}

// an AI answer's workspaces in bold, as links: **name** → [**name**](laki://ws/<id>), not in a link or code it has
// already. linkWorkspaces(wss) makes the function once (one pattern, the longest names first); it's run per answer
export function linkWorkspaces(wss: { id: string; name: string }[]) {
  const ids = new Map(wss.map(w => [w.name, w.id]))
  if (!ids.size) return (text: string) => text
  const names = [...ids.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const bold = new RegExp(`\\*\\*(${names.join('|')})\\*\\*`, 'g')
  // the parts between links ([…](…)) and code (`…`, ```…```): only those
  return (text: string) =>
    text
      .split(/(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\))/)
      .map((part, i) => (i % 2 ? part : part.replace(bold, (m, n: string) => `[${m}](${wsLink(ids.get(n)!)})`)))
      .join('')
}

export const wsLink = (ws: string, tab?: string) => `laki://ws/${encodeURIComponent(ws)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`
