// Laki's own keys that Settings › Keys rebinds (settings.keys over these: { id: keys }, '' none), as keyLabel writes
// them. App's capture-phase keys match a press to one (keyFor), main's menu shows them (the keys IPC), Help lists
// them. The rest (⌘1…⌘9, ⌘↑ ⌘↓, ⌘O, ⌘E…) stay fixed: FIXED, for the clash check

// a key with its modifiers as macOS writes it (⌃⌥⇧⌘ then the key: ⇧⌘C), by the physical key (⌥C would be ç); byKey:
// by the character the layout gives (Dvorak's ⌘K is the key labeled K), as a browser's ⌘ keys go
type Press = { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
export const keyLabel = (e: Press, byKey = false) => {
  const k = !byKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : !byKey && /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.code === 'Space' || e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return `${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey ? '⌘' : ''}${k}`
}

export const KEYS = [
  { id: 'newWs', label: 'New workspace', key: '⌘N' },
  { id: 'newTab', label: 'New tab (in a browser: a new page)', key: '⌘T' },
  { id: 'closeTab', label: 'Close the tab (or the file in front in the preview)', key: '⌘W' },
  { id: 'reopenTab', label: 'Reopen the closed tab (its chat resumed)', key: '⇧⌘T' },
  { id: 'sidebar', label: 'Hide / show the sidebar', key: '⌘B' },
  { id: 'panel', label: 'Side panel', key: '⌥⌘B' },
  { id: 'info', label: 'Workspace info', key: '⌘I' },
  { id: 'palette', label: 'Palette', key: '⌘K' },
  { id: 'files', label: 'Find a file', key: '⌘P' },
  { id: 'find', label: 'Find in the terminal or a diff', key: '⌘F' },
  { id: 'filter', label: 'Filter the sidebar (its box gets the keys)', key: '⇧⌘F' },
  { id: 'next', label: 'Next tab that needs you', key: '⌘J' },
  { id: 'step', label: "Do the workspace's next step", key: '⌘G' },
  { id: 'later', label: 'Send a message later', key: '⌘L' },
  { id: 'history', label: 'Prompt history (in a prompt box; ↑ in an empty one too)', key: '⌥ArrowUp' },
  { id: 'artifacts', label: 'Show / hide artifacts', key: '⇧⌘A' },
  { id: 'full', label: 'Full screen: just the tab', key: '⇧⌘Enter' },
  { id: 'back', label: 'Back', key: '⌘[' },
  { id: 'forward', label: 'Forward', key: '⌘]' },
  { id: 'settings', label: 'Settings', key: '⌘,' },
  { id: 'help', label: 'Help', key: '⌘/' },
  { id: 'layout', label: 'Layout menu', key: '' }, // none until you give it one
  { id: 'stopAll', label: 'Stop all agents', key: '' }, // U8: the File menu's and ⌘K's
] as const
export type KeyId = (typeof KEYS)[number]['id']
export type KeyMap = Record<KeyId, string>
export const isKeyId = (s: string): s is KeyId => KEYS.some(x => x.id === s)

// keys of their own (App's, the Edit menu's, macOS's): one of KEYS rebound there takes them over
export const FIXED: [string, string][] = [
  ['⌘O', 'Open a project'],
  ['⌘E', 'Open in your editor'],
  ['⌘D', 'Changes'],
  ['⇧⌘N', "the tab bar's + menu"],
  ['⌘=', 'Bigger text'],
  ['⌘-', 'Smaller text'],
  ['⌘0', 'Default text size'],
  ['⌘ArrowUp', 'Previous workspace'],
  ['⌘ArrowDown', 'Next workspace'],
  ...Array.from({ length: 9 }, (_, i): [string, string] => [`⌘${i + 1}`, 'a tab (⌘1…⌘9)']),
  ['⌘S', 'Save the file in the preview'],
  ['⌘C', 'Copy'],
  ['⌘V', 'Paste'],
  ['⌘X', 'Cut'],
  ['⌘Z', 'Undo'],
  ['⇧⌘Z', 'Redo'],
  ['⌘A', 'Select all'],
  ['⌘Q', 'Quit'],
  ['⌘H', 'Hide Laki'],
  ['⌘M', 'Minimize'],
]

// the ⌘K commands that can get a key (Settings › Keys; settings.cmdKeys: { id: keys }): none has one until you give it.
// Their ids are Palette.tsx's: a command that doesn't apply right now (no workspace, no PR) lets the key go on
export const COMMANDS: { id: string; label: string }[] = [
  ['ship', 'Ship: commit, push, open a PR'], ['overlaps', 'Check overlaps'], ['share', 'Share live view'], ['recording', 'Recording mode on / off'], ['notify', 'macOS notifications on / off'],
  ['layout-agent', 'Layout: Just the agent'], ['layout-preview', 'Layout: Agent | Preview'], ['layout-changes', 'Layout: Agent | Changes'], ['layout-dev', 'Layout: Agent | dev server'], ['layout-shell', 'Layout: Agent / shell'],
  ['run', 'Run the run script'], ['stopRun', 'Stop the run script'], ['script-test', 'Run the test script'], ['script-lint', 'Run the lint script'], ['script-format', 'Run the format script'], ['script-deploy', 'Run the deploy script'],
  ['review', 'Review: PR checks and comments'], ['openPR', "Open the workspace's PR"], ['openPort', 'Open localhost at $PORT'], ['projectSettings', 'Project settings'], ['copyTab', "Copy the tab's contents"], ['floatTab', 'Float the tab in its own window'], ['remind', 'Remind me about this workspace'],
  ['terminal', 'New terminal'], ['browser', 'New browser'], ['ssh', 'Open a project over SSH'], ['start', 'Get started'], ['themes', 'Themes'], ['schedules', 'Scheduled tasks'], ['board', 'Board'], ['achievements', 'Achievements'], ['specs', 'Specs & Brainstorms'], ['workflows', 'Workflows'], ['bird', 'Bird view'], ['usage', 'Usage'], ['calendar', 'Calendar'], ['desk', 'My Desk'], ['notes', 'Notes'], ['todos', 'To-dos'],
  ['ai', 'Laki AI'], ['aiLater', 'Ask Laki AI later'], ['extensions', 'Extensions'], ['newExtension', 'New extension'], ['starters', 'New extension from a starter'], ['uikit', 'UI kit'], ['icons', 'Icons'], ['resources', 'Resources'], ['about', 'About Laki'], ['collapseAll', 'Collapse all projects'], ['expandAll', 'Expand all projects'], ['timer', 'Start a timer'], ['remote', 'Remote access'], ['remoteStop', 'Stop remote access'],
].map(([id, label]) => ({ id, label }))
export type CmdMap = Record<string, string>
// settings.cmdKeys as usable: known commands, keys Laki may take
export const cmdMap = (over?: unknown): CmdMap => Object.fromEntries(Object.entries(over && typeof over === 'object' ? (over as Record<string, unknown>) : {}).filter((x): x is [string, string] => typeof x[1] === 'string' && keyOk(x[1]) && COMMANDS.some(c => c.id === x[0])))

// the ones a press runs: none on a fixed key (⌘C, ⌘V, ⌘Q, ⌘1…: a command there would take Copy or Quit away; Settings
// shows the clash, cmdClash)
export const cmdLive = (over?: unknown): CmdMap => Object.fromEntries(Object.entries(cmdMap(over)).filter(([, k]) => !FIXED.some(([f]) => f === k)))

// keys Laki may take: ⌘, ⌥ or ⌃ with a key (one alone, or with ⇧, would be typed: a terminal never loses it)
export const keyOk = (k: string) => (m => !!m && !!(m[1] || m[2] || m[4]) && !/[⌃⌥⇧⌘]/.test(m[5]) && m[5].length <= 12)(/^(⌃?)(⌥?)(⇧?)(⌘?)(.+)$/.exec(k))

// the keys in use: each one's default, or yours ('' none; one that isn't keys: the default)
export const keyMap = (over?: unknown): KeyMap =>
  Object.fromEntries(
    KEYS.map(x => {
      const v = over && typeof over === 'object' ? (over as Record<string, unknown>)[x.id] : undefined
      return [x.id, typeof v === 'string' && (v === '' || keyOk(v)) ? v : x.key]
    }),
  ) as KeyMap

// the action a press is: by the layout's character first (macOS's way), then by the physical key (another alphabet, ⌥)
export const keyFor = (e: Press, m: KeyMap): KeyId | undefined => {
  for (const l of [keyLabel(e, true), keyLabel(e)]) {
    const x = KEYS.find(x => m[x.id] && m[x.id] === l)
    if (x) return x.id
  }
}

// what else has these keys: another of KEYS (the first takes them), others ([keys, name]: the global hotkey's, the
// picker's), a fixed one, or the terminal (⌃ without ⌘ or ⌥: ⌃C, ⌃R). '': nothing
const clashOr = (k: string, named: string | undefined, others: [string, string][]) => named ?? [...others, ...FIXED].find(([c]) => c === k)?.[1] ?? (k.includes('⌃') && !/[⌥⌘]/.test(k) ? 'the terminal (⌃ keys without ⌘ or ⌥ are its own)' : '')
export const keyClash = (id: KeyId, m: KeyMap, others: [string, string][] = []) => {
  const k = m[id]
  if (!k) return ''
  return clashOr(k, KEYS.find(x => x.id !== id && m[x.id] === k)?.label, others)
}

// the command a press is, by the character first, as keyFor
export const cmdFor = (e: Press, m: CmdMap) => {
  for (const l of [keyLabel(e, true), keyLabel(e)]) {
    const id = Object.keys(m).find(x => m[x] === l)
    if (id) return id
  }
}
// what else has this command's keys: as keyClash, with Laki's own actions and the other commands
export const cmdClash = (id: string, cmds: CmdMap, keys: KeyMap, others: [string, string][] = []) => {
  const k = cmds[id]
  if (!k) return ''
  return clashOr(k, KEYS.find(x => keys[x.id] === k)?.label ?? COMMANDS.find(c => c.id !== id && cmds[c.id] === k)?.label, others)
}
// the commands' keys as keyClash's others
export const cmdOthers = (cmds: CmdMap): [string, string][] => COMMANDS.filter(c => cmds[c.id]).map(c => [cmds[c.id], c.label])

// keys to read: ⏎, the arrows and ⌫ for their names
// Settings › Keys › Send with (sendKey): ⏎ (unset; ⇧⏎ a new line) or ⌘⏎ (mod; ⏎ a new line) in a chat's box: the
// Reader, Laki AI's, an extension's or a spec's chat, Side chat. ⌘⏎ sends either way. Each window sets it as its
// settings come (setSendKey), as setIconLook. ponytail: the bubbles' reply box keeps ⏎ (its window has no settings)
let sendMod = false
export const setSendKey = (k?: string) => void (sendMod = k === 'mod')
export const sendIs = (e: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!sendMod && !e.shiftKey && !e.altKey))
export const sendKeyName = () => (sendMod ? '⌘⏎' : '⏎')
export const sendTip = (what: string) => `${what} (${sendKeyName()}) · ${sendMod ? '⏎' : '⇧⏎'} a new line`
export const keyShow = (k: string) => k.replace(/Enter$/, '⏎').replace(/Arrow(Up|Down|Left|Right)$/, (_, d: string) => ({ Up: '↑', Down: '↓', Left: '←', Right: '→' })[d]!).replace(/Backspace$/, '⌫')

// hold ⌘ (App's KeyOverlay): a badge beside each element marked data-key="<id>" (the ones on screen), and a strip for
// the rest; an unbound one ('' in settings.keys) shows nowhere
export const overlayKeys = (over: unknown, onScreen: Set<string>) => {
  const m = keyMap(over)
  const bound = KEYS.filter(x => m[x.id])
  return {
    badges: Object.fromEntries(bound.filter(x => onScreen.has(x.id)).map(x => [x.id, keyShow(m[x.id])])) as Partial<Record<KeyId, string>>,
    strip: bound.filter(x => !onScreen.has(x.id)).map(x => [keyShow(m[x.id]), x.label.replace(/ \(.*\)$/, '')] as [string, string]), // its words without the aside
  }
}
