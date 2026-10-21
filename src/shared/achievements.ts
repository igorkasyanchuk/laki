// Achievements (the status bar's trophy, Achievements.tsx' page, Settings › Achievements, ⌘K): one action each, a
// quick tour of what Laki does. Only what you do from now on counts, never what's there already: App's earn, from a
// call to the daemon that went well (rpc: a method, or several by |; ok: its params), a page opened (page), a number
// or a value in the view that moved (up), or a key or a click App earns by its id. Kept in settings.achievements
// (state.json; Reset the interface keeps it)
import type { IconName } from './icons'
import type { View } from './types'

export const ACH_GROUPS = ['Getting started', 'Agents', 'Git & PRs', 'Workspaces', 'Power user', 'Extensions & AI', 'Experimental'] as const
export type AchGroup = (typeof ACH_GROUPS)[number]
// go: where it's done (App's achGo): a page, new (the new-workspace page), project, newtab (the tab bar's +), shells,
// browsers, section:<id>[:<spot>] (Settings), panel:<tab> (the right panel), workflows, specs, notes, calendar
export type Achievement = { id: string; group: AchGroup; title: string; how: string; icon: IconName; go?: string; rpc?: string; ok?: (p: any) => boolean; page?: string; up?: (v: View) => number | string }

const count = (v: View, f: (p: View['projects'][number]) => number) => v.projects.reduce((n, p) => n + f(p), 0)
const splits = (l: unknown): number => (l && typeof l === 'object' && 'dir' in l ? 1 + splits((l as any).a) + splits((l as any).b) : 0)

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'project', group: 'Getting started', title: 'Add a project', how: "A git repository or any folder: + at the sidebar's top, ⌘O, or drop a folder on the window", icon: 'folderPlus', go: 'project', rpc: 'projectAdd' },
  { id: 'workspace', group: 'Getting started', title: 'Start a workspace', how: 'An agent and a prompt in a worktree of its own (⌘N)', icon: 'plus', go: 'new', rpc: 'wsNew' },
  { id: 'tab', group: 'Getting started', title: 'Open another tab', how: "The tab bar's + (⌘⇧N): another agent or a shell beside the first", icon: 'terminal', go: 'newtab', rpc: 'tabNew' },
  { id: 'settings', group: 'Getting started', title: 'Look around Settings', how: 'Themes, fonts, notifications, your agents (⌘,)', icon: 'gear', go: 'settings', page: 'settings' },
  { id: 'theme', group: 'Getting started', title: 'Pick a theme', how: 'Settings › Appearance: a theme painted as you hover it', icon: 'palette', go: 'section:appearance', up: v => v.settings.theme ?? '' },
  { id: 'help', group: 'Getting started', title: 'Read the keys', how: 'Help (⌘/): every key and where things are', icon: 'help', go: 'help', page: 'help' },
  { id: 'palette', group: 'Getting started', title: 'Open the command palette', how: '⌘K: every workspace, page and action by name', icon: 'command', go: 'palette', page: 'palette' },

  { id: 'answer', group: 'Agents', title: 'Answer an agent with a click', how: 'When an agent asks, its choices show as buttons over the terminal', icon: 'message', rpc: 'answer' },
  { id: 'jump', group: 'Agents', title: 'Jump to who needs you', how: '⌘J: the next tab waiting for you, wherever it is', icon: 'arrowRight' },
  { id: 'later', group: 'Agents', title: 'Send a message later', how: '⌘L: to an agent in 20 minutes or at 6pm', icon: 'clock' },
  { id: 'race', group: 'Agents', title: 'Race two agents', how: "The new-workspace page's More › Race: one prompt, a worktree each, then compare", icon: 'race', go: 'new', rpc: 'wsFan' },
  { id: 'profile', group: 'Agents', title: 'Make an agent profile', how: 'An agent with its own model, effort or account', icon: 'agent', go: 'section:presets', up: v => v.presets.length },
  { id: 'template', group: 'Agents', title: 'Write a prompt template', how: "A new workspace's prompt with your rules around it", icon: 'pencil', go: 'section:templates', up: v => (v.settings.templates?.length ?? 0) + count(v, p => p.config?.templates?.length ?? 0) },
  { id: 'memory', group: 'Agents', title: 'Give agents a rule', how: 'Global memory: what claude and codex should always know', icon: 'bulb', go: 'section:memory', up: v => (v.settings.memory?.length ?? 0) + count(v, p => p.memory?.filter(m => !m.auto).length ?? 0) },

  { id: 'changes', group: 'Git & PRs', title: 'Look at the changes', how: "The right panel's Changes: a workspace's diff, file by file", icon: 'diff', go: 'panel:changes' },
  { id: 'revert', group: 'Git & PRs', title: 'Revert a hunk', how: "In Changes, a hunk's Revert: take back one part, keep the rest", icon: 'undo', go: 'panel:changes', rpc: 'hunkUndo|fileUndo' },
  { id: 'comment', group: 'Git & PRs', title: 'Comment on a line', how: 'In Changes, click a line: a note to the agent or the PR', icon: 'messageDots', go: 'panel:changes' },
  { id: 'ship', group: 'Git & PRs', title: 'Ship it', how: "The toolbar's Ship: commit, push and open a PR in one go", icon: 'ship', go: 'ship', rpc: 'ship' },
  { id: 'autofix', group: 'Git & PRs', title: 'Let the agent fix CI', how: "A PR's switches: failing checks, review comments and conflicts go to the agent", icon: 'ciFail', go: 'panel:info', rpc: 'wsSet', ok: p => [p.autoFix, p.autoReview, p.autoMerge, p.autoLand].includes(true) },
  { id: 'merge', group: 'Git & PRs', title: 'Approve or merge in Laki', how: "Info's PR: Approve, or Merge with squash, merge or rebase", icon: 'gitMerge', go: 'panel:info', rpc: 'prAct', ok: p => p.act !== 'close' },
  { id: 'archive', group: 'Git & PRs', title: 'Archive a finished one', how: "A workspace's ⋯ › Archive: the worktree goes, the branch stays, Undo brings it back", icon: 'archive', rpc: 'wsArchive' },

  { id: 'rename', group: 'Workspaces', title: 'Rename a workspace', how: "Its right click › Rename: a name that says what it's for", icon: 'pencil', go: 'rename', rpc: 'wsSet', ok: p => typeof p.name === 'string' && p.browser === undefined },
  { id: 'pin', group: 'Workspaces', title: 'Pin a workspace', how: 'Its right click › Pin to top, or to the rail', icon: 'pin', rpc: 'wsSet', ok: p => p.pinned === true || !!p.railPin },
  { id: 'group', group: 'Workspaces', title: 'Make a sidebar group', how: "A project's ⋯ › New group: a named head over workspaces", icon: 'sep', up: v => count(v, p => p.seps?.length ?? 0) },
  { id: 'split', group: 'Workspaces', title: 'Split panes', how: 'Drag a tab to a pane\'s edge: two sessions side by side', icon: 'splitRight', up: v => Object.values(v.layouts ?? {}).flat().reduce((n, l) => n + splits(l), 0) },
  { id: 'board', group: 'Workspaces', title: 'Open the Board', how: 'Every workspace in columns by where it is, and your to-dos', icon: 'board', go: 'board', page: 'board' },
  { id: 'filter', group: 'Workspaces', title: 'Filter the sidebar', how: "The funnel at the sidebar's top: by name, branch or PR; the ones that need you", icon: 'filter' },

  { id: 'terminal', group: 'Power user', title: 'Open a terminal', how: "+ at the sidebar's top › Terminal: a shell in your home folder", icon: 'terminal', go: 'shells', rpc: 'quickNew', ok: p => p.kind === 'shells' },
  { id: 'browser', group: 'Power user', title: 'Open a browser', how: "+ at the sidebar's top › Browser: any website, without leaving Laki", icon: 'globe', go: 'browsers', rpc: 'quickNew', ok: p => p.kind === 'browsers' },
  { id: 'schedule', group: 'Power user', title: 'Schedule a prompt', how: 'An agent on a prompt every weekday at 9am, or once tomorrow', icon: 'calendarPlus', go: 'schedules', rpc: 'scheduleSet', ok: p => !p.id },
  { id: 'timer', group: 'Power user', title: 'Start a timer', how: "The sidebar foot's Timer: a break, a pomodoro, a reminder", icon: 'timer', go: 'timer' },
  { id: 'tunnel', group: 'Power user', title: 'Expose to the world', how: "The globe beside a port in the status bar: a public link to your dev server", icon: 'share', rpc: 'tunnelStart' },
  { id: 'phone', group: 'Power user', title: 'Open Laki on your phone', how: 'Remote access: a link signed in by email, a PIN or Tailscale', icon: 'smartphone', go: 'section:remote', rpc: 'remoteStart' },

  { id: 'ai', group: 'Extensions & AI', title: 'Ask Laki AI', how: 'Laki AI starts, checks and steers your agents for you', icon: 'ai', go: 'ai', rpc: 'aiAsk' },
  { id: 'extension', group: 'Extensions & AI', title: 'Turn on an extension', how: 'Small live pages in the sidebar or on My Desk: your PRs, your links, or one you make', icon: 'panel', go: 'section:widgets', rpc: 'widgetSet', ok: p => p.on === true },
  { id: 'desk', group: 'Extensions & AI', title: 'Open My Desk', how: 'Your extensions as tiles on a page of their own', icon: 'desk', go: 'desk', page: 'desk' },

  { id: 'workflows', group: 'Experimental', title: 'Run a workflow', how: 'Blocks Laki runs for a task: agents, commands, your answers', icon: 'flow', go: 'workflows', rpc: 'flowStart' },
  { id: 'specs', group: 'Experimental', title: 'Write a spec', how: 'Requirements to hand an agent, or a brainstorm with Laki AI', icon: 'spec', go: 'specs', rpc: 'planNew' },
  { id: 'notes', group: 'Experimental', title: 'Take a note', how: 'Notes: yours, for any project', icon: 'note', go: 'notes', rpc: 'noteNew' },
  { id: 'calendar', group: 'Experimental', title: 'Set a reminder', how: 'Calendar: your scheduled tasks and reminders by week or month', icon: 'calendar', go: 'calendar', rpc: 'reminderAdd' },
]

// the ones a call earns: its method, and its params when they say more
export const earnedBy = (method: string, params: any) => ACHIEVEMENTS.filter(a => a.rpc?.split('|').includes(method) && (!a.ok || a.ok(params ?? {}))).map(a => a.id)
// the ones a page earns: its dialog's name (App's pageOf)
export const pageEarns = (page: string) => ACHIEVEMENTS.filter(a => a.page === page).map(a => a.id)
// each up's value in a view; then the ones that went up (a number) or changed (a value) since the last
export const upsOf = (v: View) => Object.fromEntries(ACHIEVEMENTS.filter(a => a.up).map(a => [a.id, a.up!(v)]))
export const wentUp = (was: Record<string, number | string>, now: Record<string, number | string>) =>
  Object.keys(now).filter(id => id in was && (typeof now[id] === 'number' ? now[id] > (was[id] as number) : now[id] !== was[id]))
