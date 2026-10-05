// Small text helpers, kept apart from React so tests can load them.

import { fillTemplate, type RunAction, type Template } from '../../shared/types.ts'
export type { Template }
// a prompt template (Settings → Prompt templates, and a project's own): {{prompt}} is what you type, {{project}} and
// {{base}} the new workspace's; an unknown {{name}} stays as it is
export { fillTemplate }

// a project's templates first, then the global ones it doesn't replace (one of the same name)
export const templatesFor = (global: Template[] = [], project: Template[] = []) => [...project, ...global.filter(g => !project.some(t => t.name.trim() === g.name.trim()))]

// the prompt through a template; one without {{prompt}} gets the typed text after it
export function templated(t: Template | undefined, prompt: string, vars: Record<string, string | undefined> = {}) {
  if (!t) return prompt
  const text = fillTemplate(t.text, { ...vars, prompt })
  return /\{\{\s*prompt\s*\}\}/.test(t.text) || !prompt.trim() ? text : `${text}\n\n${prompt}`
}

// a workspace's name from what was typed, not the template around it (as the daemons do: its first words)
export const nameOf = (prompt: string) => prompt.trim().split(/\s+/).slice(0, 4).join(' ') || undefined

// a path for the status bar: ~ for the home folder, and only the last two folders of a long one
export function shortPath(p: string) {
  const parts = p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~').split('/')
  return parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)].join('/') : parts.join('/')
}

// what the daemons take: an address, or *@domain for a whole domain (cloudflared's wildcard domains)
export const MAIL_OK = /^(?:\*|[^\s@*,]+)@[^\s@*,]+\.[^\s@*,]+$/

// who a tunnel lets in, as typed: addresses and whole domains (*@team.com; @team.com and team.com say the same)
export const parseMails = (s: string) =>
  [...new Set(s.split(/[\s,;]+/).filter(Boolean).map(m => (m.includes('@') ? m.replace(/^@/, '*@') : `*@${m}`)))]

// an action (Settings › Actions, or a project's): a prompt for an agent, or a command for a terminal
export type { RunAction }
export type ActionTab = { id: string; agent?: string; shell?: boolean } // a workspace's live tab: its agent, or a shell

// Run ▾'s actions, worked out as it opens: the global ones, then the project's (one with a global one's name and
// target replaces it). An agent's only while the workspace runs that agent (its focused tab first); a terminal's
// always (the focused shell, else any; none: a new one)
export function actionsFor(global: RunAction[] = [], project: RunAction[] = [], tabs: ActionTab[] = [], focused?: string) {
  const same = (a: RunAction, b: RunAction) => a.target === b.target && (a.name ?? '').trim() === (b.name ?? '').trim() // a hand-edited one may lack a name
  const pick = (ok: (t: ActionTab) => boolean) => tabs.find(t => t.id === focused && ok(t)) ?? tabs.find(ok)
  const agent: { action: RunAction; tab: string }[] = []
  const terminal: { action: RunAction; tab?: string }[] = []
  for (const a of [...global.filter(g => !project.some(p => same(p, g))), ...project]) {
    if (!a.name?.trim() || !a.text?.trim()) continue
    if (a.target === 'shell') terminal.push({ action: a, tab: pick(t => !!t.shell)?.id })
    else {
      const t = pick(t => t.agent === a.target)
      if (t) agent.push({ action: a, tab: t.id })
    }
  }
  return { agent, terminal }
}
