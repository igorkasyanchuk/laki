// laki:// links (macOS opens the app with them): a workspace or tab, the new-workspace page filled in, Scheduled
// tasks, the board, achievements, the AI page, My Desk, the UI kit and its icons, the extension starters, Settings, Help,
// About and Get started (the app menu's). They select and fill in, never start anything: a link from anywhere can't run an agent.
export type Link =
  | { to: 'ws'; ws: string; tab?: string }
  | { to: 'new'; project?: string; prompt?: string; name?: string } // never a preset (L12): the agent and its mode are yours to pick
  | { to: 'schedules'; project?: string }
  | { to: 'settings'; section?: string; spot?: string } // spot: a group's title, lit (the app menu's Check for Updates…)
  | { to: 'extension'; id: string; inspect?: boolean } // laki://settings/widgets/<id>[/inspect]: its page, or its inspector
  | { to: 'studio'; id: string } // laki://settings/widgets/new, laki://settings/widgets/<id>/studio: its page with Laki AI's chat ('': a new one)
  | { to: 'help' }
  | { to: 'board' }
  | { to: 'achievements' }
  | { to: 'ai' }
  | { to: 'about' }
  | { to: 'onboard' }
  | { to: 'desk' }
  | { to: 'uikit'; icons?: boolean } // laki://uikit[/icons]: the UI kit's page, or its icon gallery
  | { to: 'starters' } // laki://starters: the starter picker (New extension from a starter…); a pick makes one

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
      return { to: 'new', project: q('project'), prompt: q('prompt'), name: q('name') }
    case 'schedules':
      return { to: 'schedules', project: arg ?? q('project') }
    case 'settings':
      if (arg === 'widgets' && parts[1] === 'new' && !parts[2]) return { to: 'studio', id: '' }
      if (arg === 'widgets' && parts[1] && parts[2] === 'studio') return { to: 'studio', id: parts[1] }
      if (arg === 'widgets' && parts[1]) return { to: 'extension', id: parts[1], ...(parts[2] === 'inspect' && { inspect: true }) }
      return { to: 'settings', section: arg ?? q('section'), ...(q('spot') && { spot: q('spot') }) }
    case 'help':
      return { to: 'help' }
    case 'board':
      return { to: 'board' }
    case 'achievements':
      return { to: 'achievements' }
    case 'ai':
      return { to: 'ai' }
    case 'about':
      return { to: 'about' }
    case 'onboard':
      return { to: 'onboard' }
    case 'desk':
      return { to: 'desk' }
    case 'uikit':
      return { to: 'uikit', ...(arg === 'icons' && { icons: true }) }
    case 'starters':
      return { to: 'starters' }
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
