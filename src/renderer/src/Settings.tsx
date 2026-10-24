// The app's settings, a page of its own (⌘,): saved as you change them. The daemon keeps
// the settings. The sections' parts are SettingsKit.tsx (Says, Group, Scope), SettingsAgents.tsx,
// SettingsProject.tsx, SettingsConnect.tsx, SettingsResources.tsx and SettingsExtensions.tsx, which it re-exports.
import { FitAddon } from '@xterm/addon-fit'
import { type FontWeight, Terminal } from '@xterm/xterm'
import { type CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ACCOUNT_AGENTS, type AccountAgent, type AccountView, type AchievementsKept, type Agent, AGENT_NAMES, AGENTS, type AgentUsage, aiOn, type AiSettings, COMPACT_DAYS, EFFORTS, FAST, type FixWhat, flowsOn, HOME_ACCOUNT, isAccountAgent, type Memory, MEMORY_MAX, MODELS, type NotifyKind, permInArgs, PERMS, PR_BOTS, PR_PROMPTS, PR_SCAN, PR_TRIES, type Preset, type PRMarks, type ProjectLook, REMOTE_TRIES, type SideLook, type SideStyle, SLEEP_AFTER, specsOn, type VoiceSettings, type Webhook } from '../../shared/types'
import { RELEASES_URL, type UpdateState } from '../../shared/update'
import { ago } from '../../shared/widget'
import { exportable, importable, type RunAction, type Template, USAGE_AT } from './text'
import { bridge, openExternal } from './api'
import { DOCK_ICONS } from './dock'
import { applyTheme, GLASS, type Paint, paintKey, preview, termTheme, THEMES, transparent, UI_FONTS } from './themes'
import './floater.css'
import { ask, HOTKEY, SHOT_KEY, Icon, IconButton, type IconName, keep, keyLabel, keyRec, load, ProjectMark, Switch } from './ui'
import { PICKER_KEY } from './Picker'
import { type KeyId, keyClash, keyMap, KEYS, keyShow } from '../../shared/keys'
import { USAGE_AGENTS } from './Usage'
import { Markdown } from './MarkdownView'
import { MemoryList } from './Project'
import notes from '../../../docs/release-notes.md?raw'
import { version } from '../../../package.json'
import { Group, Says, Scope } from './SettingsKit'
import { ActionsField, ARGS_EG, ENV_VARS, EnvField, FolderField, type ProjectConfig, type ProjectInfo, ProjectSection, type Scripts, TemplatesField, VarChips } from './SettingsProject'
import { type AccountsApi, AccountsBlock, type AiApi, AiSection, type SkillApi, SkillSection, VoiceSection } from './SettingsAgents'
import { type RemoteApi, RemoteSection, type SimApi, SimSection, WebhookSection } from './SettingsConnect'
import { ChipsInput, type WidgetsApi, WidgetsSection } from './SettingsExtensions'
import { type ResourcesApi, ResourcesSection } from './SettingsResources'
export * from './SettingsKit'
export * from './SettingsAgents'
export * from './SettingsProject'
export * from './SettingsConnect'
export * from './SettingsResources'
export * from './SettingsExtensions'

export type { Preset }

// the sidebar's project names (ProjectLook): each option over the theme's; App.tsx puts them on the sidebar as data-ph-*

const PROJECT_LOOK: [keyof ProjectLook, string, [string, string][]][] = [
  ['font', 'Font', [['theme', "Theme's"], ['ui', 'Interface'], ['mono', 'Monospace']]],
  ['case', 'Case', [['theme', "Theme's"], ['upper', 'UPPERCASE'], ['none', 'As named']]],
  ['spacing', 'Letter spacing', [['theme', "Theme's"], ['0', 'None'], ['0.4px', 'Tight'], ['1px', 'Normal'], ['2px', 'Wide']]],
  ['size', 'Size', [['theme', "Theme's"], ['10px', '10'], ['11px', '11'], ['12px', '12'], ['13px', '13'], ['14px', '14']]],
  ['weight', 'Weight', [['theme', "Theme's"], ['400', 'Regular'], ['600', 'Semibold'], ['800', 'Bold']]],
]
// the sidebar's lines and rows (SideLook): CSS values, App.tsx puts them on the sidebar as the variables looks set
const SIDE_LOOK: [Exclude<keyof SideLook, 'labels'>, string, [string, string][]][] = [
  ['guide', 'Guide line', [['theme', "Theme's"], ['1px solid var(--line)', 'Thin'], ['2px solid var(--line)', 'Thick'], ['1px dashed var(--line)', 'Dashed'], ['1px dotted var(--muted)', 'Dotted'], ['2px dotted var(--muted)', 'Big dots'], ['2px solid color-mix(in srgb, var(--accent) 60%, transparent)', 'Accent'], ['2px dotted var(--accent)', 'Accent dots'], ['none', 'None']]],
  ['divider', 'Between projects', [['theme', "Theme's"], ['1px solid var(--line)', 'A line'], ['1px dashed var(--line)', 'Dashed'], ['1px dotted var(--muted)', 'Dotted'], ['3px double var(--line)', 'Double'], ['none', 'Nothing']]],
  ['indent', 'Indent', [['theme', "Theme's"], ['0px', 'None'], ['11px', 'Small'], ['20px', 'Large']]],
  ['rows', 'Row height', [['theme', "Theme's"], ['22px', 'Compact'], ['26px', 'Snug'], ['28px', 'Normal'], ['32px', 'Roomy']]],
  ['text', 'Text size', [['theme', "Theme's"], ['11px', '11'], ['12px', '12'], ['13px', '13'], ['14px', '14'], ['15px', '15']]],
  ['icons', 'Icon size', [['theme', 'Default (13)'], ['11px', '11'], ['12px', '12'], ['14px', '14'], ['16px', '16'], ['18px', '18']]],
]
// the floating bubbles' look while an agent works (floater.css draws them, here as previews too)
type FloaterStyle = 'glow' | 'gradient' | 'arc' | 'bricks' | 'comet' | 'wave' | 'still'
const FLOATER_STYLES: [FloaterStyle, string, string][] = [
  ['glow', 'Glow', 'a soft halo, breathing'],
  ['gradient', 'Gradient', 'its color turning slowly inside'],
  ['arc', 'Arc', 'an arc going round'],
  ['bricks', 'Bricks', 'pixel bars rising and falling inside it'],
  ['comet', 'Comet', 'a bright head going round, its tail fading behind'],
  ['wave', 'Wave', 'filled with its color, a slow tide rolling over'],
  ['still', 'Still', 'a ring, nothing moving'],
]
// the sidebar's rows (App.tsx wsRow, styles.css [data-style]): how much each says
export const SIDE_STYLES: [SideStyle, string, string][] = [
  ['compact', 'Compact', 'one short line: its state and name'],
  ['default', 'Default', 'a line with its marks: PR, author, timers'],
  ['extended', 'Extended', 'a second line: branch, what the agent is doing, the PR, the diff'],
  ['words', 'Words', 'a second line that says what needs doing; one PR pill instead of the marks'],
  ['cards', 'Cards', 'a card each, with the agent’s last answer'],
  ['status', 'Status', 'an edge in the color of what its agent is doing, and a line under it that fills as the agent reports progress'],
]
// Appearance's corners (--radius) and where the tabs go
const MOTION: [NonNullable<AppSettings['motion']>, string][] = [['high', 'High: more of them'], ['low', 'Low (default)'], ['none', 'None']]
const CORNERS: [string, string][] = [['', "Theme's"], ['0px', 'Square'], ['3px', 'Slight'], ['6px', 'Rounded'], ['10px', 'Round'], ['14px', 'Very round']]
// where a workspace row's PR marks go: by the status circle, after the name, or with the GitHub mark
const MARKS_AT: [NonNullable<PRMarks['at']>, string][] = [['end', "With GitHub's mark"], ['start', 'By the status circle'], ['name', 'After the name']]
const CTX_LOOKS: [string, string][] = [['line', 'A line under its tab'], ['ring', 'A ring on its tab'], ['status', 'The status bar only'], ['off', 'Off']] // the context meter's
const TABS_AT: [NonNullable<AppSettings['tabsAt']>, string][] = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]

export type AppSettings = Paint & {
  achievements?: AchievementsKept // App's own (earn): App's onSave leaves it out, so an unlock while this page is open stays
  favThemes?: string[] // Appearance's starred themes: a group of their own, first
  editor?: string // an app id from the daemon's list, or 'custom' (editorCmd)
  editorCmd?: string
  agent?: string // the preset new workspaces start
  branchPrefix?: string
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  editKeys?: boolean // ⌘← ⌘→ ⌘⌫ ⌥← ⌥→ as macOS editors have them (unset: on)
  lineHeight?: number
  letterSpacing?: number // px
  fontWeight?: string // 300…700
  minContrast?: number // 1: the theme's colors as they are
  cursorStyle?: 'block' | 'bar' | 'underline'
  cursorBlink?: boolean
  termPad?: 'tiny' | 'normal' | 'roomy' // the space around a terminal's text (unset: normal)
  scrollSpeed?: number // lines per wheel step, xterm's scrollSensitivity (unset: SCROLL)
  templates?: Template[] // prompt templates: {{prompt}}, {{project}}, {{base}}
  actions?: RunAction[] // Run ▾'s actions, with each project's
  env?: Record<string, string> // every session's
  notify?: boolean
  prIcon?: boolean // the sidebar's GitHub mark on a workspace with a PR (unset: on)
  needsList?: boolean // the sidebar's Needs you list (unset: on)
  keyOverlay?: boolean // Settings › Keys: hold ⌘ for the keys (unset: on)
  ownAvatar?: boolean // your GitHub picture on your own PR's mark (unset: on)
  avatars?: boolean // GitHub's pictures of PR authors and reviewers (unset: on; off: none loaded)
  prMarks?: PRMarks // the sidebar's ✓, ✓✓ and 👀 on an open PR
  timers?: boolean // a turn's time on its tab and row (unset: off)
  contextMeter?: boolean | 'line' | 'ring' | 'status' // a claude or codex chat's context: the status bar's, and its tab's line (unset, true) or ring; false: none
  costs?: boolean // what each chat used, tokens and ≈ API price, and today's (unset: on)
  diffStat?: boolean // each workspace's +/- in the sidebar (unset: off)
  dimPanes?: boolean // a split's other panes faded (unset: on)
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: on)
  splitNew?: boolean // a new tab opens beside the pane you're on (the daemon's layoutPlace)
  closeNoAsk?: boolean // closing a tab whose process still runs doesn't ask first (unset: it asks)
  pageZoom?: number // Settings and Help's size, one of PAGE_ZOOMS (unset: 1)
  worktrees?: string // where new worktrees go, a folder per project inside (unset: <data>/worktrees)
  storageDir?: string // workspaces' storage folders, one per workspace inside (unset: <data>/storage)
  keepStorage?: boolean // a deleted workspace's storage folder stays
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  projectLook?: ProjectLook // the sidebar's project names
  sideLook?: SideLook // the sidebar's lines, rows and button labels
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  usageAt?: number // a plan limit's % that notifies: 75, 90, 95 (unset: 90)
  notifySound?: string // a macOS sound, 'none', or unset: the default
  timerAlert?: 'dialog' | 'notification' // what a timer's end shows (unset: the dialog)
  timerSound?: string // a macOS sound or 'none' as a timer ends (unset: Glass)
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  presets?: Preset[] | null // null: the daemon's defaults (every agent installed)
  accountUse?: Partial<Record<AccountAgent, string>> // each agent's default account for new sessions (unset: its own sign-in)
  remoteMail?: string // the one address remote access lets in
  remoteAuth?: 'email' | 'pin' | 'tailscale' // remote access by Cloudflare's email code (unset too), Laki's PIN, or your tailnet
  remoteTries?: number // wrong PINs that stop it (unset: REMOTE_TRIES)
  remoteTsPin?: boolean // Tailscale: a PIN as well
  remoteFunnel?: boolean // Tailscale: Funnel, the internet (a PIN always)
  prPrompts?: Partial<Record<FixWhat, string>> // what the PR switches tell the agent (unset: PR_PROMPTS)
  prScan?: number // minutes between PR checks
  bgRefresh?: boolean // PR checks on their own (unset: on)
  copyIgnored?: boolean // new worktrees get every ignored file (unset: off)
  copyUntracked?: boolean // and the untracked ones (unset: off)
  archivedDays?: number // archived workspaces deleted after so many days (unset or 0: never)
  prTries?: number // fix CI's and fix conflicts' tries in a row
  prBots?: string[] // review bots whose threads go to the agent (unset: PR_BOTS)
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (unset: SLEEP_AFTER, 8 hours; 0: always)
  webhook?: Webhook // pushes to your phone
  ai?: AiSettings // Laki AI (Settings › AI)
  voice?: VoiceSettings // the mic and hold Fn (Settings › Voice)
  archiveMerged?: boolean // a merged PR's clean workspace archived, with Undo
  syncBase?: '' | 'origin' | 'ff' // a new worktree's base fetched first ('': off)
  menuBar?: boolean // the menu bar's item (unset: on)
  floater?: boolean // the floating bubbles over other apps (unset: on)
  floaterStyle?: FloaterStyle // a working agent's bubble (unset: gradient)
  floaterRecent?: number // the bubbles' recent agents, idle or done, after the ones at work (unset: 3)
  floaterRecentHours?: number // a recent one drops out after this many hours idle; 0: never (unset: 4)
  floaterVoiceTo?: 'pick' | 'new' // the voice prompt: an agent picked each time, or always a new session (unset: pick)
  floaterMax?: number // the bubbles at most (unset: 12)
  floaterCards?: boolean // a bubble's card on hover (unset: on)
  floaterDone?: boolean // a finished agent you haven't seen: a green, pulsing bubble until a click or a look (unset: on)
  floaterNew?: boolean // the bubbles' + (unset: on)
  floaterMenu?: 'stack' | 'card' // its actions: stacked in the drop, or a menu beside it (unset: stack)
  dockIcon?: string // the Dock's icon while Laki runs (dock.ts DOCK_ICONS; unset: the app's own)
  fun?: boolean // the sidebar foot's smiley, Meme (unset: on)
  widgetDirs?: string[] // folders of widgets, besides Laki's own
  widgetAgent?: string // the claude or codex profile an AI source runs (unset: the first claude one)
  widgetHours?: string // when they fetch on their own: 9am-9pm weekdays (unset: always)
  widgetLogs?: boolean // every extension keeps a log (each one's own Keep a log otherwise)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs)
  pickerKey?: string // the element picker's hotkey (unset: PICKER_KEY; '': none)
  keys?: Record<string, string> // Settings › Keys: App's own actions' keys over shared/keys.ts KEYS ('': none)
  hotkeyOn?: boolean // the global hotkey (unset: on)
  hotkey?: string // its keys (unset: HOTKEY; '': none)
  shotAsk?: boolean // Screenshot to Laki AI (off unless true)
  shotKey?: string // its keys (unset: SHOT_KEY; '': none)
  updateCheck?: boolean // Check for updates at launch, then daily (main's update.ts), on unless false
  specs?: boolean // Specs & Brainstorms (Specs.tsx), on unless false
  workflows?: boolean // Workflows (Workflows.tsx), on unless false
  birdView?: boolean // Bird view (Bird.tsx), every live session's screen at once, on unless false
  calendar?: boolean // experimental: Calendar (Calendar.tsx), scheduled tasks and reminders by week or month, off unless true
  desk?: boolean // My Desk (Desk.tsx), extensions on a page of their own, resized there, on unless false
  notes?: boolean // experimental: Notes (Notes.tsx), your own notes, the rail's Notes, off unless true
  todoList?: boolean // experimental: To-dos (TodoList.tsx), one checklist of your own, the rail's To-dos, off unless true
  fullReview?: boolean // experimental: the tab bar's Review tab (FullReview.tsx), off unless true
  cloud?: boolean // experimental: Cloud workspaces, a workspace in a GitHub Codespace (the new-workspace page's In a codespace), off unless true
  simulator?: boolean // Simulators: the side panel's Simulator tab, off unless true
  history?: boolean // back and forward (App's travel): ‹ ›, ⌘[ ⌘], on unless false
  aiGlow?: boolean // Laki AI's glow (App's PeekGlow) over what it looks at, on unless false
  progress?: boolean // LAKI_PROGRESS=1 for agents: their laki progress on the tab
  progressAt?: 'tab' | 'sidebar' | 'both' // where that percent shows (unset: tab)
  progressLook?: 'pct' | 'bar' | 'both' // in the sidebar: the percent, a filling line, or both (unset: pct)
  railLabels?: boolean // the rail's words under its icons (unset: on)
  railShells?: boolean // the rail's Terminal (unset: on)
  railBrowsers?: boolean // the rail's Browser (unset: on)
  railOrder?: string[] // its buttons' order (RAIL_ITEMS' keys)
  railHide?: string[] // its buttons in ⋯ More
  sideStyle?: SideStyle // the sidebar's rows
  memory?: Memory[] // Global memory: the user's rules for every project's agents
  memoryCompact?: { on?: boolean; days?: number } // agents' learned memories compacted by Laki AI on their own, off unless on (daemon/memory.ts)
  imageDays?: number // pasted images and attached files kept this many days (unset: IMAGE_DAYS)
  artifactsIn?: 'app' | 'browser' // HTML and Markdown artifacts: the app's viewer, or the default browser (unset: app)
}

export type AppInfo = { id: string; name: string; browser?: boolean } // somewhere a folder can open; a browser: only a file

// the PR switches' prompts (Settings › Pull requests): the status bar's names
const ARCHIVED_DAYS: [number, string][] = [[0, 'Never'], [1, 'After a day'], [3, 'After 3 days'], [7, 'After a week'], [14, 'After 2 weeks'], [30, 'After a month']]
const PR_KINDS: [FixWhat, string, string][] = [
  ['ci', 'Fix CI', 'the failing checks and the end of their logs go after it'],
  ['review', 'Review', 'the open review threads go after it'],
  ['conflict', 'Fix conflicts', ''],
]

const NOTIFY_KINDS: readonly (readonly [NotifyKind, string, string])[] = [
  ['waiting', 'Waiting for you', 'A permission prompt, or CI that keeps failing'],
  ['done', 'Finished', 'The end of a turn, with its last words'],
  ['limit', 'Usage limit', 'An agent hit its plan limit'],
  ['usage', 'Plan limit nearly used', "Claude's or Codex's 5-hour or weekly limit reaching the share below, once a reset, while Laki is open"],
]
const SOUNDS = ['Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink']

export const FONT_SIZE = 13
// Settings and Help's own size (Appearance), over the terminal font's: ⌘± step through these while one is open
export const PAGE_ZOOMS = [0.9, 1, 1.1, 1.25, 1.5]
export const FONTS = ['SF Mono', 'Menlo', 'Monaco', 'Courier New', 'JetBrains Mono', 'Fira Code', 'Fira Mono', 'Cascadia Code', 'Cascadia Mono',
  'Source Code Pro', 'IBM Plex Mono', 'Hack', 'Iosevka', 'Victor Mono', 'Roboto Mono', 'Ubuntu Mono', 'Inconsolata', 'Geist Mono', 'Commit Mono',
  'Monaspace Neon', 'Berkeley Mono', 'Input Mono', 'Hasklig', 'Anonymous Pro', 'DejaVu Sans Mono', 'Meslo LG S', 'MesloLGS NF', 'MesloLGS Nerd Font',
  'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'Hack Nerd Font', 'Operator Mono', 'Dank Mono', 'PT Mono', 'Andale Mono']
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32]

// the FONTS this Mac has: an installed font draws text at another width than at least one fallback
export function installedFonts() {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return FONTS
  const width = (f: string) => {
    c.font = `20px ${f}`
    return c.measureText('mmmmmmmmmmlli1WQ@#').width
  }
  const fallbacks = ['monospace', 'serif']
  const base = fallbacks.map(width)
  return FONTS.filter(f => fallbacks.some((b, i) => width(`"${f}", ${b}`) !== base[i]))
}
// a font name for xterm, with fallbacks
export const fontStack = (f?: string) => [f?.trim() && JSON.stringify(f.trim()), '"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Monaco', 'monospace'].filter(Boolean).join(', ')

export const SCROLL = 3 // xterm's own 1 crawls through a long agent session
// the terminal's typography and cursor, as xterm options (size and family: Term's props, zoom changes them)
export const termLook = (s: AppSettings) => ({
  lineHeight: s.lineHeight ?? 1.15,
  letterSpacing: s.letterSpacing ?? 0,
  fontWeight: (s.fontWeight || 'normal') as FontWeight,
  fontWeightBold: 'bold' as FontWeight,
  minimumContrastRatio: s.minContrast ?? 1,
  cursorStyle: s.cursorStyle ?? 'block',
  cursorBlink: s.cursorBlink !== false,
  scrollSensitivity: s.scrollSpeed ?? SCROLL,
  fastScrollSensitivity: (s.scrollSpeed ?? SCROLL) * 3, // with ⌥
})

const SAMPLE = [
  '\x1b[32m~/projects/app\x1b[0m \x1b[35mmain\x1b[0m ❯ npm run dev -- --port $PORT',
  '\x1b[2m→ ready on http://localhost:3000 in 412 ms\x1b[0m',
  '\x1b[32m~/projects/app\x1b[0m ❯ npm test',
  '\x1b[32m✓\x1b[0m 14 tests passed · 0.24s',
  '\x1b[32m~/projects/app\x1b[0m ❯ git status --short',
  '\x1b[33m M\x1b[0m src/settings.tsx   \x1b[31m D\x1b[0m old.ts   \x1b[32m??\x1b[0m panel.tsx',
  '\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[4munderline\x1b[0m \x1b[2mdim\x1b[0m  => !== >= <= -> ||',
  '\x1b[32m~/projects/app\x1b[0m ❯ ',
].join('\r\n')

// a terminal drawing SAMPLE with the settings; click it to see the cursor as in a focused tab
function TermPreview({ s }: { s: AppSettings }) {
  const box = useRef<HTMLDivElement>(null)
  const [xt, setXt] = useState<{ term: Terminal; fit: FitAddon } | null>(null)
  const opts = () => ({ fontFamily: fontStack(s.fontFamily), fontSize: s.fontSize ?? FONT_SIZE, ...termLook(s), theme: termTheme(), allowTransparency: transparent() })
  useEffect(() => {
    const term = new Terminal({ ...opts(), disableStdin: true, allowProposedApi: true, scrollback: 0 }) // transparency only takes at the start
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(box.current!)
    term.write(SAMPLE)
    setXt({ term, fit })
    return () => term.dispose()
  }, [])
  const look = JSON.stringify([s.fontFamily, s.fontSize, paintKey(s), termLook(s)])
  useEffect(() => {
    if (!xt) return
    Object.assign(xt.term.options, opts())
    xt.fit.fit()
  }, [xt, look])
  return <div className="term-preview" ref={box} />
}

const WEIGHTS: Record<string, string> = { 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' }
const TERM_DEFAULTS = { fontFamily: '', fontSize: FONT_SIZE, fontWeight: '400', lineHeight: 1.15, letterSpacing: 0, minContrast: 1, cursorStyle: 'block', cursorBlink: true, termPad: 'normal', dimPanes: true, hoverFocus: true, splitNew: false, scrollSpeed: SCROLL, copyOnSelect: true, editKeys: true } satisfies Partial<AppSettings>
const CONTRAST: Record<number, string> = { 1: "the theme's colors", 3: 'low (3:1)', 4.5: 'medium (4.5:1)', 7: 'high (7:1)' }

// Find a setting (the nav's search box): each setting's title as the page writes it, its section, words it goes by.
// A result opens the section and shows the first label, row or heading starting with the title. Add new settings here.
const FIND: [string, string, string?][] = [
  ['general', 'New workspaces start', 'default agent preset'],
  ['git', 'Branch prefix', 'git worktree'],
  ['git', 'Sync the base branch', 'fetch pull origin main master up to date latest fast-forward worktree'],
  ['general', 'macOS notifications', 'notify waiting done limit mute'],
  ['general', 'Sound', 'notification'],
  ['general', 'Plan limit nearly used', 'usage 5-hour weekly session quota notify 90% threshold claude codex'],
  ['webhook', 'Phone pushes', 'notifications webhook phone push ntfy slack telegram json notify waiting done'],
  ['notes', 'Release notes', "what's new changelog version changes added recently"],
  ['ai', 'Turn on Laki AI', 'assistant orchestrate llm chat openrouter'],
  ['ai', 'Runs with', 'backend openrouter claude -p codex exec model'],
  ['ai', 'OpenRouter API key', 'token secret ai'],
  ['ai', 'Spending', 'cost usage tokens ai today month'],
  ['ai', "Laki's skill", 'tools prs notes memory shells actions templates ask options remove'],
  ['ai', 'Show costs ($)', 'hide cost money dollars price spend'],
  ['ai', 'Your instructions', 'custom context system prompt my own rules'],
  ['ai', 'Keep pasted images (days)', 'images screenshots files attached storage retention delete older clean thumbnails 30'],
  ['webhook', 'Send test', 'webhook phone push'],
  ['webhook', 'Answer from the phone', 'buttons reply tap telegram ntfy choices menu permission allow'],
  ['appearance', 'Fun button', 'meme reddit smiley break joke'],
  ['appearance', 'Pull requests in the sidebar', 'pr github icon'],
  ['appearance', 'Your picture on your PRs', 'avatar picture photo own mine pr github sidebar'],
  ['appearance', 'Pull request marks', 'approved approval check double eyes commented review me sidebar'],
  ['appearance', 'Turn timers', 'elapsed time'],
  ['appearance', 'Diff size in the sidebar', 'lines added removed changes stat'],
  ['appearance', 'Needs you list', 'inbox waiting done answer seen review attention sidebar top'],
  ['appearance', 'Claude Code plan limits', 'usage ring 5-hour weekly'],
  ['appearance', 'Codex plan limits', 'usage ring 5-hour weekly'],
  ['appearance', 'Context meter', 'context window full tokens compact fill bar line ring status 200k 1m'],
  ['appearance', 'Tokens and cost', 'tokens cost price dollars spend usage today api estimate money'],
  ['general', 'Environment', 'env variables'],
  ['general', 'Move to another Mac', 'export import backup file'],
  ['appearance', 'Interface font', 'ui type'],
  ['appearance', 'Accent color', 'colour highlight'],
  ['appearance', 'Corners', 'radius rounded square'],
  ['appearance', 'Settings & Help size', 'zoom text font size small bigger larger readable page'],
  ['appearance', 'Tabs', 'tab bar position location top bottom left right vertical'],
  ['appearance', 'Animations', 'motion animation movement reduce high low none effects transitions'],
  ['appearance', 'Project names', 'sidebar font case letter spacing size weight'],
  ['appearance', 'Rail', 'layout rail list slack kinds projects board schedule terminals browsers settings icons labels icons only'],
  ['appearance', 'Terminals', 'rail terminal shells button show hide list'],
  ['appearance', 'Browsers', 'rail browser web button show hide list'],
  ['appearance', 'Sidebar', 'status guide line divider indent row height dotted dashed text size icon size avatar github style compact extended cards'],
  ['appearance', 'Button labels', 'sidebar schedule scheduled board settings video timer words'],
  ['appearance', 'Glass', 'transparent see-through blur vibrancy'],
  ['appearance', 'Sidebar see-through', 'transparent translucent sidebar rail blur vibrancy desktop'],
  ['appearance', 'Glow', 'glass colors'],
  ['appearance', 'Terminals use', 'theme themes colors palette dark light'],
  ['appearance', 'Favorites', 'theme star starred favorite'],
  ['general', 'Storage', 'storage folder files artifacts LAKI_STORAGE_FOLDER keep deleted'],
  ['general', 'Open HTML and Markdown artifacts', 'artifacts viewer html markdown md browser embed inline modal open in laki default browser'],
  ['appearance', 'Finished ones stand out', 'floating bubbles done finished green pulse attention'],
  ['presets', 'Tell it about Laki', 'note system prompt skill rename pr storage'],
  ['terminal', 'Font', 'monospace family'],
  ['terminal', 'Font size', 'zoom bigger smaller'],
  ['terminal', 'Line height', ''],
  ['terminal', 'Letter spacing', ''],
  ['terminal', 'Font weight', 'bold light'],
  ['terminal', 'Minimum contrast', 'readable'],
  ['terminal', 'Cursor style', 'block bar underline'],
  ['terminal', 'Padding', 'tiny minimal roomy space around margin inner edge'],
  ['terminal', 'Scroll speed', 'wheel trackpad faster slow scrolling'],
  ['terminal', 'Blinking cursor', 'blink'],
  ['terminal', 'Copy selected text', 'clipboard selection'],
  ['terminal', 'Mac editing keys: ⌘← ⌘→ ⌥← ⌥→ ⌘⌫', 'cmd option arrow keys line start end word caret cursor home natural text editing iterm'],
  ['terminal', 'Dim other panes', 'split focus fade'],
  ['terminal', 'Focus the pane under the mouse', 'split hover caret cursor follows'],
  ['terminal', 'New tabs open as a split', 'pane panel nested inside tab beside'],
  ['open', 'Default', 'editor cursor vs code zed windsurf antigravity sublime jetbrains xcode open in'],
  ['open', 'Custom command', 'editor'],
  ['presets', 'Agents & profiles', 'claude codex gemini args flags env model effort permission mode fast presets'],
  ['presets', 'Accounts', 'sign in login switch account claude max codex plan another second CLAUDE_CONFIG_DIR CODEX_HOME'],
  ['pr', 'Check pull requests every', 'pr github scan frequency interval minutes how often'],
  ['git', 'Archive workspace when its PR merges', 'merged auto archive clean cleanup'],
  ['pr', 'Tries in a row', 'pr fix ci conflicts limit attempts how many times'],
  ['pr', 'Fix CI', 'pr prompt failing checks auto'],
  ['pr', 'Review', 'pr prompt comments auto'],
  ['pr', 'Fix conflicts', 'pr prompt merge auto'],
  ['templates', 'Prompt templates', 'prompt'],
  ['memory', 'Global memory', 'rules instructions every project all projects claude md agents memory custom remember always'],
  ['actions', 'Actions', 'run menu prompt command'],
  ['skill', 'Agent skill', 'mcp server laki cli'],
  ['skill', 'Extension creator', 'agent skill widgets laki-widget make extension ai'],
  ['widgets', 'Extensions', 'sidebar widgets plugins folder reload fetch schedule delete remove uninstall top bar status bar where place network internet https'],
  ['widgets', 'More folders', 'extensions widgets'],
  ['widgets', 'Keep logs for every extension', 'extensions widgets log logs debug stderr errors'],
  ['general', 'Progress on tabs', 'percent estimate completion laki progress LAKI_PROGRESS'],
  ['general', 'Show progress', 'percent sidebar tab both'],
  ['general', 'Progress in the sidebar', 'percent line bar row'],
  ['ai', 'Chat button in the corner', 'floating chat ask laki ai anywhere'],
  ['voice', 'Speech to text', 'voice dictation dictate microphone mic speak talk speech transcribe whisper cloud openrouter engine'],
  ['voice', 'Model', 'voice speech to text transcribe mai whisper parakeet openrouter'],
  ['voice', 'Hold Fn to talk', 'push to talk fn globe key hold voice dictation'],
  ['general', 'Timers', 'timer countdown ends alarm sound dialog modal notification'],
  ['git', 'Copy ignored files to new worktrees', 'gitignored env node_modules worktreeinclude untracked copy'],
  ['git', 'Refresh PR status in the background', 'background refresh scan status rate limit ssh passphrase github'],
  ['git', 'Delete archived workspaces', 'auto delete archived clean up cleanup days'],
  ['git', 'Folder for worktrees', 'folder directory location path where worktree workspaces disk'],
  ['general', 'Close tabs without asking', 'confirm confirmation dialog close tab running process stop ask'],
  ['general', 'Development mode', 'debug logs log events troubleshoot pr checks auto fix'],
  ['general', 'Specs & Brainstorms', 'pages spec specs brainstorm requirements notion ideas prototypes diagrams mind map'],
  ['general', 'Workflows', 'pages workflow flow flows blocks graph automation pipeline runs decisions'],
  ['general', 'Menu bar icon', 'tray item status bar count waiting needs you hide show'],
  ['general', 'Updates', 'update updates upgrade new version check download release restart latest'],
  ['keys', "Laki's keys", 'keys shortcuts keyboard rebind remap bindings hotkeys record reset conflict cmd command'],
  ['keys', 'Show the keys while ⌘ is held', 'hold command overlay badges cheat sheet hints which key'],
  ...KEYS.map((x): [string, string, string] => ['keys', x.label, 'key shortcut rebind']),
  ['general', 'Global hotkey', 'shortcut key focus bring forward show from any app anywhere record'],
  ['general', 'Screenshot to Laki AI', 'global hotkey screenshot region area capture dictation voice mic ask ai menu bar tray'],
  ['general', 'Developer', 'command line tool cli laki install path terminal reference skill'],
  ['general', 'Pick an element', 'picker inspect element hotkey shortcut key development dev mode selector screenshot'],
  ['general', 'Bird view', 'pages overview all sessions screens preview eye running'],
  ['general', 'Calendar', 'experimental reminders follow-ups week month scheduled tasks dates'],
  ['general', 'My Desk', 'pages desk dashboard overview widgets extensions tiles resize build'],
  ['general', 'Notes', 'experimental notes notebook notion editor write pages memo colors search'],
  ['general', 'To-dos', 'experimental todo todos to do checklist tasks list slack notion check off rail'],
  ['general', 'Full review', 'experimental review diff changes files viewed comments pending post github pr tab code review'],
  ['general', 'Cloud workspaces', 'experimental cloud codespace codespaces github remote machine vm devcontainer'],
  ['appearance', 'Back and forward', 'rail history back forward previous next pages navigation'],
  ['ai', "Laki AI's glow", 'ai glow animation computer use screen reading looking peek effect gradient'],
  ['voice', 'Speech to text', 'voice dictation dictate speech to text cloud hold fn mic talk whisper engine'],
  ['appearance', 'Dock icon', 'app icon dock logo picture dawn terminal glacier bubbles neon'],
  ['appearance', 'Floating bubbles', 'floater drop bubble overlay glow gradient arc still style while working recent sessions idle how many icons card hover new session plus menu stack actions microphone voice say it dictation record screenshot area screen'],
  ['general', 'Creation log', 'new workspace create logs what ran command development'],
  ['general', 'Reset the interface', 'reset ui layout default defaults factory theme rail settings experimental extensions off get started onboarding widths sidebar panels broken localstorage development'],
  ['widgets', 'Fetch only', 'working hours night weekends sync schedule when'],
  ['remote', 'Remote access', 'phone email cloudflare tunnel qr tailscale tailnet ts.net headless server'],
  ['simulator', 'Simulators', 'simulator emulator ios android iphone ipad xcode simctl adb idb avd phone device mobile app'],
  ['achievements', 'Show achievements', 'trophy trophies badges unlock tour learn gamification'],
  ['resources', 'Memory', 'ram cpu usage processes monitor activity heavy slow'],
  ['resources', 'Sleep idle agents after', 'memory ram free idle suspend hibernate'],
]

// the nav's sections, under a head each (group): the app, its agents, what it connects to
const SECTIONS: { id: string; label: string; icon: IconName; group: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', group: 'Laki' },
  { id: 'git', label: 'Git & worktrees', icon: 'fork', group: 'Laki' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Laki' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', group: 'Laki' },
  { id: 'keys', label: 'Keys', icon: 'keyboard', group: 'Laki' },
  { id: 'resources', label: 'Resources', icon: 'memory', group: 'Laki' },
  { id: 'achievements', label: 'Achievements', icon: 'trophy', group: 'Laki' },
  { id: 'notes', label: 'Release notes', icon: 'file', group: 'Laki' },
  { id: 'presets', label: 'Agents & profiles', icon: 'agent', group: 'Agents' },
  { id: 'memory', label: 'Global memory', icon: 'bulb', group: 'Agents' },
  { id: 'templates', label: 'Prompt templates', icon: 'pencil', group: 'Agents' },
  { id: 'actions', label: 'Actions', icon: 'run', group: 'Agents' },
  { id: 'pr', label: 'Pull requests', icon: 'pr', group: 'Agents' },
  { id: 'skill', label: 'Agent skill', icon: 'import', group: 'Agents' },
  { id: 'ai', label: 'AI', icon: 'ai', group: 'Agents' },
  { id: 'voice', label: 'Voice', icon: 'mic', group: 'Agents' },
  { id: 'open', label: 'Open in', icon: 'code', group: 'Connect' },
  { id: 'webhook', label: 'Phone pushes', icon: 'bell', group: 'Connect' },
  { id: 'widgets', label: 'Extensions', icon: 'panel', group: 'Connect' },
  { id: 'remote', label: 'Remote access', icon: 'globe', group: 'Connect' },
  { id: 'simulator', label: 'Simulators', icon: 'phone', group: 'Connect' },
]
export const isSection = (id: string) => SECTIONS.some(x => x.id === id)

// Achievements (App's, achievements.ts): on or off, how many, the page, the hidden ones back. Not a setting of this
// page's: App writes settings.achievements itself, so an unlock while Settings is open isn't lost
export type AchievementsApi = { n: number; of: number; hidden: number; off: boolean; setOff: (off: boolean) => void; unhide: () => void; open: () => void }
function AchievementsSection({ api }: { api: AchievementsApi }) {
  return (
    <>
      <h2>Achievements</h2>
      <p className="muted small">One thing to do each, a quick tour of what Laki does. They unlock as you do them; only what you do counts, not what was there before.</p>
      <Group title="Achievements" act={!api.off && <button onClick={api.open}>Open achievements</button>}>
        <div className="setting-box">
          <Switch className="switch-row" on={!api.off} onChange={on => api.setOff(!on)}>
            <Says title="Show achievements" hint={api.off ? 'Off: no trophy in the status bar, nothing unlocks' : `${api.n} of ${api.of} unlocked: the trophy at the status bar's end, ⌘K › Achievements`} />
          </Switch>
          {api.hidden > 0 && (
            <div className="row">
              <span className="muted small grow">
                {api.hidden} hidden: {api.hidden === 1 ? "it doesn't" : "they don't"} count or unlock
              </span>
              <button onClick={api.unhide}>Show {api.hidden === 1 ? 'it' : 'them'} again</button>
            </div>
          )}
        </div>
      </Group>
    </>
  )
}

// the rail's buttons after Projects (Settings › Appearance › Rail, Slack's way: which show, in what order; the rest
// go into its ⋯ More): key, words, icon; when: what has it there at all. AI stays at the rail's foot
type RailHas = { specs?: boolean; workflows?: boolean; desk?: boolean; notes?: boolean; todoList?: boolean; calendar?: boolean; railShells?: boolean; railBrowsers?: boolean; ai?: { on?: boolean } }
export const RAIL_ITEMS: { key: string; label: string; icon: IconName; when?: (s: RailHas) => boolean }[] = [
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'schedules', label: 'Schedule', icon: 'clock' },
  { key: 'specs', label: 'Specs', icon: 'spec', when: s => specsOn(s) },
  { key: 'workflows', label: 'Flows', icon: 'flow', when: s => flowsOn(s) },
  { key: 'desk', label: 'My Desk', icon: 'desk', when: s => s.desk !== false },
  { key: 'notes', label: 'Notes', icon: 'note', when: s => s.notes === true },
  { key: 'todos', label: 'To-dos', icon: 'listChecks', when: s => s.todoList === true },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', when: s => s.calendar === true },
  { key: 'shells', label: 'Terminal', icon: 'terminal', when: s => s.railShells !== false },
  { key: 'browsers', label: 'Browser', icon: 'globe', when: s => s.railBrowsers !== false },
  { key: 'ai', label: 'AI', icon: 'ai', when: s => aiOn(s) },
]
// in the order set (one not in it, a page turned on since: after them, in RAIL_ITEMS' order)
export const railSorted = <T extends { key: string }>(xs: T[], order: string[] = []) => {
  const at = (k: string) => (i => (i < 0 ? order.length + RAIL_ITEMS.findIndex(x => x.key === k) : i))(order.indexOf(k))
  return [...xs].sort((a, b) => at(a.key) - at(b.key))
}

// the rail's buttons: a box each (off: in ⋯ More), dragged into an order; AI keeps its place at the foot
function RailField({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const items = railSorted(RAIL_ITEMS.filter(x => !x.when || x.when(s as RailHas)), s.railOrder).sort((a, b) => Number(a.key === 'ai') - Number(b.key === 'ai'))
  const hide = s.railHide ?? []
  const [drag, setDrag] = useState<string | null>(null)
  const drop = (on: string) => {
    if (!drag || drag === on) return
    const keys = railSorted(RAIL_ITEMS, s.railOrder).map(x => x.key).filter(k => k !== 'ai' && k !== drag) // every one, a page off now too: it keeps its place
    keys.splice(keys.indexOf(on), 0, drag)
    set({ railOrder: keys })
  }
  return (
    <div className="rail-items" role="list" aria-label="The rail's buttons">
      {items.map(x => {
        const fixed = x.key === 'ai'
        return (
          <div
            key={x.key}
            role="listitem"
            className={`rail-item ${drag === x.key ? 'dragging' : ''}`}
            draggable={!fixed}
            onDragStart={e => (e.dataTransfer.setData('text/plain', x.key), (e.dataTransfer.effectAllowed = 'move'), setDrag(x.key))}
            onDragEnd={() => setDrag(null)}
            onDragOver={e => !fixed && drag && (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))}
            onDrop={e => (e.preventDefault(), drop(x.key), setDrag(null))}
          >
            <span className="rail-grip" data-tip={fixed ? 'At the rail’s foot' : 'Drag to move it'} aria-hidden>
              {fixed ? '' : '⋮⋮'}
            </span>
            <label className="rail-check">
              <input type="checkbox" checked={!hide.includes(x.key)} onChange={e => set({ railHide: e.target.checked ? hide.filter(k => k !== x.key) : [...hide, x.key] })} />
              <Icon name={x.icon} />
              {x.label}
            </label>
            {hide.includes(x.key) && <span className="muted small">in ⋯ More</span>}
          </div>
        )
      })}
    </div>
  )
}

// a hotkey: Record, then the keys (⌘, ⌃ or ⌥ with a key); Esc cancels, ⌫ alone leaves none
function KeyField({ value, def, onSet }: { value: string; def: string; onSet: (v: string) => void }) {
  const [rec, setRec] = useState(false)
  useEffect(() => {
    if (!rec) return
    const f = (e: KeyboardEvent) => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey
      if (bare && e.key === 'Escape') return setRec(false)
      if (bare && e.key === 'Backspace') return (onSet(''), setRec(false))
      if (bare) return // a key alone would be typed everywhere
      onSet(keyLabel(e))
      setRec(false)
    }
    keyRec.on = true
    window.addEventListener('keydown', f, true)
    return () => ((keyRec.on = false), window.removeEventListener('keydown', f, true))
  }, [rec])
  return (
    <span className="key-field">
      <button type="button" className={rec ? 'on' : ''} onClick={() => setRec(r => !r)} data-tip={rec ? 'Press the keys: ⌘, ⌃ or ⌥ with a key. Esc cancels, ⌫ leaves none' : 'Click, then press the keys'}>
        {rec ? 'Press the keys…' : value ? <kbd>{keyShow(value)}</kbd> : 'None'}
      </button>
      {value !== def && !rec && <IconButton icon="restore" title={`Back to ${keyShow(def)}`} onClick={() => onSet(def)} />}
    </span>
  )
}

// Settings › Keys: App's own actions (shared/keys.ts KEYS), each recorded over its default (settings.keys: only the
// ones changed); others: [keys, name] the clash check counts too (the global hotkeys, the picker)
function KeysSection({ over, others, onChange, overlay, onOverlay }: { over?: Record<string, string>; others: [string, string][]; onChange: (keys: Record<string, string>) => void; overlay: boolean; onOverlay: (on: boolean) => void }) {
  const m = keyMap(over)
  const set = (id: KeyId, k: string) => onChange(Object.fromEntries(KEYS.map(x => [x.id, x.id === id ? k : m[x.id]] as const).filter(([i, v]) => v !== KEYS.find(x => x.id === i)!.key)))
  return (
    <>
      <h2>Keys</h2>
      <p className="muted small">The keys of Laki's own actions: Record, then press new ones (⌘, ⌥ or ⌃ with a key, so typing in a terminal is never taken; ⌫ leaves none). The others (⌘1…⌘9, ⌘↑ ⌘↓, ⌘O, ⌘E, ⌘D, ⌘⇧N, text size) stay; Help lists them all, and the menu bar shows these as you set them.</p>
      <Group
        title="Laki's keys"
        act={
          <button type="button" disabled={KEYS.every(x => m[x.id] === x.key)} onClick={() => onChange({})}>
            <Icon name="restore" /> Reset all
          </button>
        }
      >
        <div className="setting-box">
          {KEYS.map(x => {
            const c = keyClash(x.id, m, others)
            return (
              <div className="switch-row" key={x.id}>
                <KeyField value={m[x.id]} def={x.key} onSet={k => set(x.id, k)} />
                <Says title={x.label} hint={c && <span className="warn-soft">{keyShow(m[x.id])} is also {c}: one of them won't get it</span>} />
              </div>
            )
          })}
        </div>
      </Group>
      <Group title="Show the keys">
        <div className="setting-box">
          <Switch className="switch-row" on={overlay} onChange={onOverlay}>
            <Says title="Show the keys while ⌘ is held" hint="Hold ⌘ alone a moment: a badge beside each tab, button and row that has a key, and the rest of these keys in a strip at the bottom. Any other key, or letting go, hides it" />
          </Switch>
        </div>
      </Group>
    </>
  )
}

// a global hotkey (main's globalShortcut, registered by App as the settings come): on, and its keys; main says when
// another app (or Laki's other one) has them. bind: main's (false: off); off: why it can't be on now
function HotkeyField(p: { on: boolean; keys: string; def: string; title: string; hint: string; off?: string; bind: (keys: string | false) => Promise<boolean>; onOn: (on: boolean) => void; onKeys: (keys: string) => void }) {
  const [taken, setTaken] = useState(false)
  const live = p.on && !p.off
  useEffect(() => void p.bind(live ? p.keys : false).then(ok => setTaken(live && !ok)), [live, p.keys])
  return (
    <div className="setting-box">
      <Switch className="switch-row" on={p.on} onChange={p.onOn}>
        <Says title={p.title} hint={p.on && p.off ? p.off : p.hint} />
      </Switch>
      {live && (
        <div className="row">
          <Says title="Hotkey" hint={taken ? "These keys can't be Laki's: record others" : 'Two of ⌃ ⌥ ⌘ with a key, or one of them with Space'} />
          <span className="grow" />
          <KeyField value={p.keys} def={p.def} onSet={p.onKeys} />
        </div>
      )}
      {live && taken && <p className="field-err">{p.keys}: another app (or macOS, or Laki's other hotkey) has these keys, or they need two of ⌃ ⌥ ⌘ (one is enough with Space or an F key)</p>}
    </div>
  )
}

// main's update.ts: this version, the newest release (its notes), and the one next step: Download (a signed Mac:
// here, then Restart to update; elsewhere the release's page), or Check now
function UpdatesField({ on, onOn }: { on: boolean; onOn: (on: boolean) => void }) {
  const [u, setU] = useState<UpdateState | null>(null)
  const [, tick] = useState(0) // "checked … ago" moves on while the page stays open
  useEffect(() => {
    void bridge!.update!('state').then(setU)
    const t = setInterval(() => tick(n => n + 1), 60_000)
    const off = bridge!.onUpdate!(setU)
    return () => (clearInterval(t), off())
  }, [])
  if (!u) return null
  const run = (op: 'check' | 'download' | 'install') =>
    void bridge!.update!(op).then(setU, (e: Error) => setU(x => x && { ...x, status: 'error', error: e.message }))
  const l = u.latest
  const page = () => openExternal(l?.url ?? RELEASES_URL)
  const here = !!l && u.install && l.feed // Laki replaces itself; else the release's page
  const says =
    u.status === 'checking' ? 'Checking…'
    : u.status === 'downloading' ? `Downloading ${l?.version}…`
    : u.status === 'ready' ? `${l?.version} is downloaded: restart to finish. Your agents keep running.`
    : u.status === 'error' ? u.error
    : l ? `Laki ${l.version} is out`
    : u.checked ? `Up to date · checked ${ago(u.checked)}`
    : 'Not checked yet'
  return (
    <div className="setting-box">
      <div className="row">
        <Says title={`Laki ${u.version}`} hint={says} />
        <span className="grow" />
        {u.status === 'ready' ? (
          <button type="button" className="primary" onClick={() => run('install')}>
            Restart to update
          </button>
        ) : l && u.status !== 'downloading' && u.status !== 'checking' ? (
          <button type="button" className="primary" onClick={() => (here ? run('download') : page())}>
            {here ? `Update to ${l.version}` : 'Download'}
          </button>
        ) : null}
        <button type="button" disabled={u.status === 'checking' || u.status === 'downloading' || u.status === 'ready'} onClick={() => run('check')}>
          Check now
        </button>
      </div>
      {l && u.status !== 'ready' && (
        <div className="update-notes">
          {l.notes && <Markdown src={l.notes} />}
          <a href={l.url} onClick={e => (e.preventDefault(), page())}>
            Release page ↗
          </a>
        </div>
      )}
      <Switch className="switch-row" on={on} onChange={onOn}>
        <Says title="Check for updates" hint="At launch and once a day Laki asks GitHub for its newest release, and tells you once per version. Nothing downloads until you click Update." />
      </Switch>
      <p className="muted small">
        After an update the yellow bar offers to restart Laki's daemon when you're ready. <a href={RELEASES_URL} onClick={e => (e.preventDefault(), openExternal(RELEASES_URL))}>All releases ↗</a>
      </p>
    </div>
  )
}

const CLI_DOCS = 'https://github.com/igorkasyanchuk/laki/blob/main/docs/guide.md#cli' // panels.tsx' REPO
// the laki command for any shell (core.ts cliInstall): a launcher in Homebrew's bin, /usr/local/bin or ~/.local/bin
export type CliState = { path?: string; current: boolean; onPath: boolean; other?: string; to: string }
export type CliApi = { state(): Promise<CliState>; install(): Promise<CliState>; remove(): Promise<CliState> }
function CliField({ api, onSkill }: { api: CliApi; onSkill?: () => void }) {
  const [st, setSt] = useState<CliState | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => void api.state().then(setSt, e => setErr((e as Error).message)), [])
  const run = (f: () => Promise<CliState>) => f().then(x => (setSt(x), setErr('')), e => setErr((e as Error).message))
  if (!st) return <p className="muted small">{err || 'Looking…'}</p>
  const dir = st.to.replace(/\/laki$/, '')
  return (
    <div className="setting-box">
      <div className="row cli-row">
        <Says
          title={st.path ? (st.current ? 'Command line tool: installed' : 'Command line tool: installed, from another copy of Laki') : 'Command line tool'}
          hint={
            <>
              {st.path ? `${st.path}${st.current ? '' : ': install again to point it at this one'}` : `Puts a small launcher at ${st.to}`}
              <span className="cli-links">
                <a href={CLI_DOCS} onClick={e => (e.preventDefault(), openExternal(CLI_DOCS))}>
                  CLI reference ↗
                </a>
                {onSkill && (
                  <a href="#skill" onClick={e => (e.preventDefault(), onSkill())}>
                    Agent skill ›
                  </a>
                )}
              </span>
            </>
          }
        />
        <span className="grow" />
        {(!st.path || !st.current) && (
          <button type="button" className="primary" onClick={() => run(api.install)}>
            {st.path ? 'Install again' : 'Install the laki command'}
          </button>
        )}
        {st.path && (
          <button type="button" onClick={() => run(api.remove)}>
            Remove
          </button>
        )}
      </div>
      {st.path && !st.onPath && (
        <p className="muted small">
          {dir} isn't on your PATH: add <code>export PATH="{dir}:$PATH"</code> to your shell's profile (~/.zshrc), then open a new terminal.
        </p>
      )}
      {st.other && <p className="muted small">Another laki comes first on your PATH: {st.other} (npm link?). Your shell runs that one.</p>}
      {err && <p className="field-err">{err}</p>}
    </div>
  )
}

// what Reset the interface keeps of this viewer's: what you made (timers, stopwatches, drafts). Get started shows again
const UI_KEEP = ['laki.timers', 'laki.watches', 'laki.newDraft', 'laki.scheduleDraft', 'laki.aiDrafts']

export function SettingsPage(p: {
  settings: AppSettings
  apps: AppInfo[]
  onSave: (s: AppSettings) => void
  onClose: () => void
  projects?: ProjectInfo[]
  projectFile?: (id: string) => Promise<ProjectConfig> // its .laki.json
  onSaveProject?: (id: string, o: { name?: string; config: ProjectConfig; notes?: string; color?: string; icon?: string }) => unknown
  renameProjects?: boolean
  section?: string // where it opens: a section's id, or project:<id>
  script?: keyof Scripts // a project's script tab to show
  spot?: string // a group's title to open at, lit (Run ▾'s Edit the run script…, Edit actions…)
  skill?: SkillApi
  ai?: AiApi
  remote?: RemoteApi
  widgets?: WidgetsApi
  resources?: ResourcesApi
  simulator?: SimApi // Simulators: the daemon's sim (its checks, the devices to start and stop)
  webhookTest?: (w: Webhook) => Promise<unknown> // Phone pushes' Send test
  cli?: CliApi // General › Developer: the laki command in any shell
  uiReset?: () => Promise<unknown> // Reset the interface: the daemon's settings to their defaults (SETTINGS_KEPT kept), every extension off
  logs?: (key: string, title: string) => void // development mode's: new: what making a workspace ran
  presets: Preset[] // the daemon's: the settings', or its defaults
  accounts?: AccountsApi // claude's and codex's sign-ins (an older daemon: none)
  onSection?: (id: string) => void // each section it shows (Get started's steps)
  onMemory?: (project: string) => void // a project's Memory row: its page's Memory tab
  achievements?: AchievementsApi // App's: the count, on or off, the page
}) {
  const { settings, apps, onSave, onClose } = p
  const [s, setS] = useState<AppSettings>(settings)
  // the section it was on last (closing it, a click in the sidebar, doesn't lose your place), unless it's gone
  const sections = SECTIONS.filter(x => (x.id !== 'notes' || s.devMode === true) && (x.id !== 'skill' || p.skill) && (x.id !== 'ai' || p.ai) && (x.id !== 'voice' || p.ai) && (x.id !== 'remote' || p.remote) && (x.id !== 'widgets' || p.widgets) && (x.id !== 'resources' || p.resources) && (x.id !== 'achievements' || p.achievements))
  const [sec, setSec] = useState(() => (x => (sections.some(y => y.id === x) || p.projects?.some(y => `project:${y.id}` === x) ? x : 'general'))(p.section ?? load('laki.settingsSec', 'general')))
  useEffect(() => {
    keep('laki.settingsSec', sec)
    p.onSection?.(sec)
  }, [sec])
  const [themeQ, setThemeQ] = useState('') // the themes' name filter
  const [findQ, setFindQ] = useState('') // Find a setting
  const findRef = useRef(findQ)
  findRef.current = findQ
  const [spot, setSpot] = useState<{ title: string; n: number; group?: boolean }>() // the setting a result goes to; group: a whole card
  useEffect(() => void (p.spot && setSpot({ title: p.spot, n: Date.now(), group: true })), [p.spot])
  const favs = (s.favThemes ?? []).filter(id => THEMES.some(t => t.id === id)) // starred: their own group, first
  const shownThemes = [...THEMES].reverse().filter(t => `${t.name} ${t.aka ?? ''}`.toLowerCase().includes(themeQ.trim().toLowerCase())) // the newest first; by name, or what it's after
  // a section picked opens at its top, the one already open too (a Find result scrolls to its setting instead)
  const openSec = (id: string) => (setSec(id), document.querySelector('.settings-main')?.scrollTo(0, 0))
  const set = (k: Partial<AppSettings>) => setS(x => ({ ...x, ...k }))
  // a theme under the mouse is painted, the chosen one again as it leaves the grid or the page closes
  const latest = useRef(s)
  latest.current = s
  useEffect(() => () => applyTheme(latest.current), [])
  // a result's setting, once its section is on: in sight and lit for a moment
  useEffect(() => {
    if (!spot) return
    const t = spot.title.toLowerCase()
    const el = spot.group
      ? [...document.querySelectorAll<HTMLElement>('.settings-main .set-head > h3')].find(e => e.textContent?.trim().toLowerCase() === t)?.closest<HTMLElement>('.set-group')
      : [...document.querySelectorAll<HTMLElement>('.settings-main :is(h2, h3, label, .field, .switch-row, .switch-text, .muted.small)')].find(e => e.textContent?.trim().toLowerCase().startsWith(t))
    el?.scrollIntoView({ block: spot.group ? 'start' : 'center' })
    el?.classList.add('spot')
    const off = setTimeout(() => el?.classList.remove('spot'), 2600)
    return () => clearTimeout(off)
  }, [spot]) // set with its section: rendered by now
  // a row of selects over one of the sidebar's looks: 'theme' is the theme's own
  const lookGrid = (key: 'projectLook' | 'sideLook', rows: [string, string, [string, string][]][]) => (
    <div className="grid5">
      {rows.map(([k, label, opts]) => (
        <label key={k}>
          {label}
          <select value={String((s[key] as Record<string, unknown> | undefined)?.[k] ?? 'theme')} onChange={e => set({ [key]: { ...s[key], [k]: e.target.value } })}>
            {opts.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
  // theme, glass, interface font: painted now (the app paints again once saved)
  const paint = (k: Partial<AppSettings>) => (applyTheme({ ...s, ...k }), set(k))
  // Export / Import (General): every setting in a file, for another Mac; an import goes through the page, so it's
  // painted and saved as if typed
  const [moved, setMoved] = useState('') // what the last export or import did
  const file = useRef<HTMLInputElement>(null)
  const exportAll = () => {
    // without its secrets and private values (text.ts exportable), set again on that Mac; an import leaves the ones there
    const out = exportable(s)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ laki: 'settings', version: 1, settings: out }, null, 2)], { type: 'application/json' }))
    a.download = 'laki-settings.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
    setMoved('Exported as laki-settings.json')
  }
  const importAll = (f?: File) =>
    f?.text()
      .then(t => {
        const j = JSON.parse(t)
        const v = j?.laki === 'settings' ? j.settings : undefined
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error("it isn't a file Export made")
        const { ok, bad } = importable(v, s)
        paint(ok)
        setMoved(`Imported ${f.name}${bad.length ? `, without ${bad.join(', ')}: not what Laki keeps there now` : ''}`)
      })
      .catch(e => setMoved(`Couldn't import ${f.name}: ${e.message}`))
  // ⌘+ / ⌘− while the page is open change the size behind its back
  useEffect(() => setS(x => (x.fontSize === settings.fontSize ? x : { ...x, fontSize: settings.fontSize })), [settings.fontSize])
  useEffect(() => setS(x => (x.pageZoom === settings.pageZoom ? x : { ...x, pageZoom: settings.pageZoom })), [settings.pageZoom])
  useEffect(() => setS(x => (x.notify === settings.notify ? x : { ...x, notify: settings.notify })), [settings.notify]) // ⌘K's switch
  // the page grows with the terminal's font size, from 13px as 100%, times its own size (Appearance)
  const scale = ((s.fontSize ?? FONT_SIZE) / FONT_SIZE) * (PAGE_ZOOMS.includes(s.pageZoom as number) ? s.pageZoom! : 1)
  const project = p.projects?.find(x => `project:${x.id}` === sec)
  // saved a moment after the last change, or on closing before that
  const first = useRef(true)
  const unsaved = useRef<AppSettings | null>(null)
  const save = useRef(onSave)
  save.current = onSave
  useEffect(() => {
    if (first.current) return void (first.current = false)
    unsaved.current = s
    const t = setTimeout(() => {
      unsaved.current = null
      onSave(s)
    }, 300)
    return () => clearTimeout(t)
  }, [s])
  useEffect(() => () => void (unsaved.current && save.current(unsaved.current)), [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.settings-page .overlay') && (findRef.current ? (e.stopPropagation(), setFindQ('')) : onClose()) // Esc clears a search first; a dialog in it (a widget's) takes it
    window.addEventListener('keydown', f, true) // before the preview terminal takes it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])

  const presets = s.presets ?? p.presets
  // Development › Reset the interface: Laki as it starts. The daemon's settings (uiReset), then this viewer's laki.*
  // (App.tsx' localStorage), then a reload
  const resetUi = async () => {
    if (!(await ask('Reset the interface?', { text: 'Every setting goes back to its default: the theme, the rail and sidebar, the terminal, notifications, the experimental features. Every extension turns off, Get started shows again, and widths, open panels and text sizes go back to how Laki starts. Projects, workspaces, sessions, profiles and accounts, Laki AI, phone pushes, remote access, env, actions, templates, timers and drafts stay.', ok: 'Reset', danger: true }))) return
    try {
      await p.uiReset?.()
    } catch (e) {
      return void ask("Couldn't reset the interface", { text: (e as Error).message })
    }
    for (const k of Object.keys(localStorage)) if (k.startsWith('laki.') && !UI_KEEP.includes(k)) localStorage.removeItem(k)
    location.reload()
  }
  const freeProfile = (base: string) => (presets.some(x => x.name === base) ? `${base}-${[...Array(99).keys()].find(n => n > 1 && !presets.some(x => x.name === `${base}-${n}`))}` : base)
  // the accounts and their limits while Agents & profiles is open (a sign-in in its terminal shows up)
  const [accts, setAccts] = useState<AccountView[]>([])
  const [usage, setUsage] = useState<AgentUsage[]>([])
  const loadAccts = () => void p.accounts?.load().then(setAccts, () => {})
  useEffect(() => {
    if (sec !== 'presets' || !p.accounts) return
    loadAccts()
    p.accounts.usage().then(setUsage, () => {})
    const t = setInterval(() => !document.hidden && loadAccts(), 10000) // each read asks the Keychain: not too often
    return () => clearInterval(t)
  }, [sec, !!p.accounts])
  const setPreset = (i: number, p: Partial<Preset>) => set({ presets: presets.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  // a key per preset card that survives removing one above it (names change as you type)
  const keys = useRef<number[]>([])
  while (keys.current.length < presets.length) keys.current.push(Math.random())
  const setPresets = (next: Preset[] | null, drop?: number) => {
    if (drop !== undefined) keys.current.splice(drop, 1)
    if (!next) keys.current = []
    set({ presets: next })
  }
  const editor = s.editor || 'cursor'
  const fonts = useMemo(installedFonts, [])
  const font = s.fontFamily?.trim() ?? ''
  const [otherFont, setOtherFont] = useState(() => !!font && !FONTS.includes(font))
  // a select for one setting; the default is saved as a value (an unset key wouldn't replace the saved one)
  const pick = <K extends keyof AppSettings, V extends string | number>(label: string, k: K, def: V, opts: V[], text: (v: V) => string = String) => {
    const v = (s[k] ?? def) as V
    return (
      <label>
        {label}
        <select value={String(v)} onChange={e => set({ [k]: typeof def === 'number' ? Number(e.target.value) : e.target.value } as Partial<AppSettings>)}>
          {[...new Set([...opts, v])].map(o => (
            <option key={o} value={String(o)}>
              {text(o)}
              {o === def ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
    )
  }
  // a setting-box row: its words on the left, a select (row) or a segmented control (seg) on the right
  const row = <K extends keyof AppSettings, V extends string | number>(title: string, hint: string | undefined, k: K, def: V, opts: V[], text: (v: V) => string = String) => {
    const v = (s[k] ?? def) as V
    return (
      <label className="switch-row">
        <select value={String(v)} onChange={e => set({ [k]: typeof def === 'number' ? Number(e.target.value) : e.target.value } as Partial<AppSettings>)}>
          {[...new Set([...opts, v])].map(o => (
            <option key={o} value={String(o)}>
              {text(o)}
              {o === def ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <Says title={title} hint={hint} />
      </label>
    )
  }
  const seg = <K extends keyof AppSettings>(title: string, hint: string | undefined, k: K, def: string, opts: [string, string, string?][]) => {
    const v = String(s[k] ?? def)
    return (
      <div className="switch-row">
        <div className="seg" role="radiogroup" aria-label={title}>
          {opts.map(([o, label, glyph]) => (
            <button key={o} type="button" role="radio" aria-checked={v === o} className={v === o ? 'on' : ''} onClick={() => set({ [k]: o } as Partial<AppSettings>)}>
              {glyph && <span className="seg-glyph">{glyph}</span>}
              {label}
            </button>
          ))}
        </div>
        <Says title={title} hint={hint} />
      </div>
    )
  }
  // the Terminal page's Reset: each of its settings as Laki has it (stated: an unset key wouldn't replace the saved one)
  const termChanged = (Object.keys(TERM_DEFAULTS) as (keyof typeof TERM_DEFAULTS)[]).some(k => (String(s[k] ?? TERM_DEFAULTS[k]) || String(TERM_DEFAULTS[k])) !== String(TERM_DEFAULTS[k]))
  // Find a setting: every word typed in a setting's title, words or section (and projects by name)
  const words = findQ.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = (text: string) => words.every(w => text.toLowerCase().includes(w))
  const found = !words.length
    ? []
    : [
        ...FIND.flatMap(([sec, title, more]) => {
          const where = sections.find(x => x.id === sec)?.label
          return where && hits(`${title} ${more ?? ''} ${where}`) ? [{ sec, title, where }] : []
        }),
        ...(p.projects ?? []).filter(x => hits(`${x.name} project`)).map(x => ({ sec: `project:${x.id}`, title: x.name, where: 'Project' })),
      ].slice(0, 12)
  const go = (r: { sec: string; title: string }) => (setSec(r.sec), setFindQ(''), setSpot({ title: r.title, n: Date.now() }))
  return (
    <div className="settings-page" style={{ zoom: scale }}>
      <div className="settings-head">
        <b>Settings</b>
        <span className="grow" />
        <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className="settings-body">
        <nav className="settings-nav">
          <input
            type="search"
            className="settings-find"
            value={findQ}
            placeholder="Find a setting"
            spellCheck={false}
            onChange={e => setFindQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && found[0] && go(found[0])}
          />
          {findQ.trim() && (
            <>
              {found.map(r => (
                <button key={r.sec + r.title} onClick={() => go(r)}>
                  <span className="find-hit">
                    {r.title}
                    <span className="muted small">{r.where}</span>
                  </span>
                </button>
              ))}
              {!found.length && <div className="muted small pad">Nothing called that.</div>}
            </>
          )}
          {!findQ.trim() && sections.map((x, i) => (
            <Fragment key={x.id}>
              {x.group !== sections[i - 1]?.group && <div className="settings-nav-head">{x.group}</div>}
              <button className={sec === x.id ? 'on' : ''} onClick={() => openSec(x.id)}>
                <Icon name={x.icon} /> {x.label}
              </button>
            </Fragment>
          ))}
          {!findQ.trim() && !!p.projects?.length && <div className="settings-nav-head">Project settings</div>}
          {!findQ.trim() && p.projects?.map(x => (
            <button key={x.id} className={sec === `project:${x.id}` ? 'on' : ''} onClick={() => openSec(`project:${x.id}`)} data-tip={x.path}>
              <ProjectMark p={x} or={x.host ? 'server' : x.git === false ? 'folder' : 'fork'} size={14} /> <span>{x.name}</span>
            </button>
          ))}
        </nav>
        <div className="settings-main form">
          {project && (
            <ProjectSection
              key={project.id}
              project={project}
              file={p.projectFile}
              rename={p.renameProjects}
              script={p.script}
              global={{ actions: s.actions, templates: s.templates, simulator: s.simulator === true }}
              taken={p.projects?.filter(x => x.id !== project.id).flatMap(x => x.config?.actions?.map(a => a.slug) ?? [])}
              onGlobal={openSec}
              onMemory={p.onMemory && (() => p.onMemory!(project.id))}
              onSave={o => p.onSaveProject?.(project.id, o)}
            />
          )}
          {sec === 'git' && (
            <>
              <h2>Git &amp; worktrees</h2>
              <Group title="New worktrees" hint="Each new workspace is a git worktree on a branch of its own, off the base branch the new-workspace page picks (the repo's main one unless you pick another)">
              <label>
                <span>
                  Branch prefix <span className="muted">· for new worktrees' branches</span>
                </span>
                <input className="mono" value={s.branchPrefix ?? ''} placeholder="laki/" onChange={e => set({ branchPrefix: e.target.value })} />
              </label>
              <div className="setting-box">
                <label className="switch-row">
                  <select value={s.syncBase ?? ''} onChange={e => set({ syncBase: e.target.value as AppSettings['syncBase'] }) /* '': off (an unset key wouldn't replace the saved one) */}>
                    <option value="">Off</option>
                    <option value="origin">Origin's (recommended)</option>
                    <option value="ff">Fast-forward mine</option>
                  </select>
                  <Says title="Sync the base branch" hint="git fetch before each new worktree, so it starts from origin's latest. A failed fetch never stops it" />
                </label>
              </div>
              <p className="muted small">Origin's: the worktree starts off <code>origin/&lt;base&gt;</code>, your own branch as it is. Fast-forward mine: your base branch moves up to origin's first, when it can (not while it's checked out, nor with commits of its own: then origin's). Off: your branch as it is, no network.</p>
              <div className="field">
                <span>
                  Folder for worktrees <span className="muted">· a folder per project inside it; a project can pick its own (Settings › the project). Ones made already stay where they are</span>
                </span>
                <FolderField value={s.worktrees} label="Folder for worktrees" placeholder="Laki's data folder: ~/.laki/worktrees" onChange={v => set({ worktrees: v })} />
              </div>
              </Group>
              <Group title="Files git doesn't keep" hint="A new worktree gets, from the repo's own folder, what .worktreeinclude (at the repo's root) and .laki.json's copy name; with these, more. Applies to projects on this Mac only">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.copyIgnored} onChange={v => set({ copyIgnored: v })}>
                  <Says title="Copy ignored files to new worktrees" hint="Every file .gitignore leaves out (.env, builds, node_modules: can be big and slow to copy)" />
                </Switch>
                <Switch className="switch-row" on={!!s.copyUntracked} onChange={v => set({ copyUntracked: v })}>
                  <Says title="Copy untracked files to new worktrees" hint="New files you haven't committed (or ignored) yet" />
                </Switch>
              </div>
              </Group>
              <Group title="In the background">
              <div className="setting-box">
                <Switch className="switch-row" on={s.bgRefresh !== false} onChange={v => set({ bgRefresh: v })}>
                  <Says title="Refresh PR status in the background" hint="Checks each workspace's PR, CI and reviews every few minutes (Settings › Pull requests) and as an agent's turn ends. Off: only a PR's right click › Refresh, if gh asks for an SSH passphrase or GitHub limits you. The PR switches need it" />
                </Switch>
              </div>
              </Group>
              <Group title="Clean-up">
              <div className="setting-box">
              <label className="switch-row">
                <select value={s.archivedDays ?? 0} onChange={e => set({ archivedDays: Number(e.target.value) })}>
                  {[...ARCHIVED_DAYS, ...(ARCHIVED_DAYS.some(([d]) => d === (s.archivedDays ?? 0)) ? [] : [[s.archivedDays!, `After ${s.archivedDays} days`] as [number, string]])].map(([d, t]) => (
                    <option key={d} value={d}>
                      {t}
                    </option>
                  ))}
                </select>
                <Says title="Delete archived workspaces" hint="Archiving already removes the worktree's folder; this deletes the workspace too (its branch stays), so it can't be restored" />
              </label>
              </div>
              </Group>
              <Group title="When a PR merges">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.archiveMerged} onChange={v => set({ archiveMerged: v })}>
                  <Says title="Archive workspace when its PR merges" hint="Only a clean one: nothing uncommitted or unpushed, no agent at work. A toast offers Undo; one left alone says merged in the sidebar." />
                </Switch>
              </div>
              </Group>
            </>
          )}
          {sec === 'general' && (
            <>
              <h2>General</h2>
              <Group title="New workspaces">
              <label>
                New workspaces start
                <select value={s.agent || 'claude'} onChange={e => set({ agent: e.target.value })}>
                  {presets.filter(p => !p.off || p.name === s.agent).map(p => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                  <option value="shell">shell</option>
                  <option value="none">nothing</option>
                </select>
              </label>
              </Group>
              {bridge?.update && (
                <Group title="Updates">
                  <UpdatesField on={s.updateCheck !== false} onOn={updateCheck => set({ updateCheck })} />
                </Group>
              )}
              {bridge?.badge && (
                <Group title="Menu bar">
                  <div className="setting-box">
                    <Switch className="switch-row" on={s.menuBar !== false} onChange={v => set({ menuBar: v })}>
                      <Says title="Menu bar icon" hint="Laki's mark in the menu bar (the tray) with the count of agents that need you, as the Dock's badge; its menu lists them, new workspaces, screenshots and Open Laki with its hotkey" />
                    </Switch>
                  </div>
                </Group>
              )}
              {bridge?.hotkey && (
                <Group title="Global hotkey">
                  <HotkeyField
                    on={s.hotkeyOn !== false}
                    keys={s.hotkey ?? HOTKEY}
                    def={HOTKEY}
                    title="Bring Laki forward from any app"
                    hint="Whatever app you're in, these keys show Laki's window"
                    bind={k => bridge!.hotkey!(k || '')}
                    onOn={hotkeyOn => set({ hotkeyOn })}
                    onKeys={hotkey => set({ hotkey })}
                  />
                  {bridge.shotKey && (
                    <HotkeyField
                      on={s.shotAsk === true}
                      keys={s.shotKey ?? SHOT_KEY}
                      def={SHOT_KEY}
                      title="Screenshot to Laki AI"
                      hint="From any app: pick a part of the screen, and Laki AI's window opens with it attached and the mic listening. Say what to do, then send. The menu bar has it too."
                      off={aiOn(s) ? undefined : 'Laki AI answers it: turn Laki AI on in Settings › AI'}
                      bind={k => bridge!.shotKey!(k)}
                      onOn={shotAsk => set({ shotAsk })}
                      onKeys={shotKey => set({ shotKey })}
                    />
                  )}
                </Group>
              )}
              <Group title="Notifications" hint="Phone pushes are in their own section">
              <div className="setting-box">
                <Switch className="switch-row" on={s.notify !== false} onChange={v => set({ notify: v })}>
                  <Says title="macOS notifications" hint="When an agent off screen waits or finishes, or CI keeps failing. A workspace's or tab's menu mutes just it." />
                </Switch>
                {s.notify !== false && (
                  <>
                    {NOTIFY_KINDS.map(([k, title, hint]) => (
                      <Switch key={k} className="switch-row sub" on={s.notifyOn?.[k] !== false} onChange={v => set({ notifyOn: { ...s.notifyOn, [k]: v } })}>
                        <Says title={title} hint={hint} />
                      </Switch>
                    ))}
                    {s.notifyOn?.usage !== false && (
                      <label className="switch-row sub">
                        <select value={s.usageAt ?? USAGE_AT} onChange={e => set({ usageAt: Number(e.target.value) })}>
                          {[75, 90, 95].map(x => (
                            <option key={x} value={x}>
                              {x}%
                            </option>
                          ))}
                        </select>
                        <Says title="Plan limit at" hint="How much of a limit is used when it tells you" />
                      </label>
                    )}
                    <label className="switch-row sub">
                      <select value={s.notifySound ?? ''} onChange={e => set({ notifySound: e.target.value })}>
                        <option value="">Default</option>
                        <option value="none">None</option>
                        {SOUNDS.map(x => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                      <Says title="Sound" hint="macOS's sounds, as in System Settings › Sound" />
                    </label>
                  </>
                )}
              </div>
              </Group>
              <Group title="Timers" hint="As a timer in the sidebar ends">
              <div className="setting-box">
                <label className="switch-row">
                  <select value={s.timerAlert ?? 'dialog'} onChange={e => set({ timerAlert: e.target.value as 'dialog' | 'notification' })}>
                    <option value="dialog">A dialog</option>
                    <option value="notification">A notification</option>
                  </select>
                  <Says title="Show" hint="A dialog in Laki stays until you close it (Again starts the timer over); a notification is macOS's" />
                </label>
                <label className="switch-row">
                  <select value={s.timerSound ?? 'Glass'} onChange={e => (set({ timerSound: e.target.value }), e.target.value !== 'none' && bridge?.sound?.(e.target.value))}>
                    <option value="none">None</option>
                    {SOUNDS.map(x => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <Says title="Sound" hint="Played as it ends, whatever the notifications' settings; picking one plays it" />
                </label>
              </div>
              </Group>
              <Group title="Storage" hint="Each workspace's own folder, outside the repo, for what its agents make for you (screenshots, reports, exports): $LAKI_STORAGE_FOLDER in its tabs, a folder per workspace inside this one; the info panel opens it">
                <FolderField value={s.storageDir} label="Folder for storage" placeholder="Laki's data folder: ~/.laki/storage" onChange={v => set({ storageDir: v })} />
                <div className="setting-box">
                  <Switch className="switch-row" on={!!s.keepStorage} onChange={v => set({ keepStorage: v })}>
                    <Says title="Keep a deleted workspace's storage" hint="Off: deleting a workspace deletes its storage folder too (archiving keeps it)" />
                  </Switch>
                  <label className="switch-row">
                    <select value={s.artifactsIn ?? 'app'} onChange={e => set({ artifactsIn: e.target.value === 'browser' ? 'browser' : 'app' })}>
                      <option value="app">In Laki</option>
                      <option value="browser">In the browser</option>
                    </select>
                    <Says title="Open HTML and Markdown artifacts" hint="In Laki: a viewer over the app (HTML sandboxed: its scripts run, it can't read Laki or your files; Markdown rendered), with Open in the browser. In the browser: your default browser, as Finder opens them" />
                  </label>
                </div>
              </Group>
              <Group title="Tabs">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.closeNoAsk} onChange={v => set({ closeNoAsk: v })}>
                  <Says title="Close tabs without asking" hint="No question when a tab you close still runs something (an agent, a server): it's stopped at once" />
                </Switch>
                <Switch className="switch-row" on={!!s.progress} onChange={v => set({ progress: v })}>
                  <Says title="Progress on tabs" hint="Claude and Codex estimate how far along their task is and report it every 20-30 seconds, shown on the tab; agents started from now on (other agents need the laki skill, Settings › Agent skill)" />
                </Switch>
                {s.progress && (
                  <label className="switch-row">
                    <select value={s.progressAt ?? 'tab'} onChange={e => set({ progressAt: e.target.value as AppSettings['progressAt'] })}>
                      <option value="tab">On the tab</option>
                      <option value="sidebar">In the sidebar</option>
                      <option value="both">Both</option>
                    </select>
                    <Says title="Show progress" hint="Where an agent's percent shows: its tab, its workspace's row in the sidebar, or both" />
                  </label>
                )}
                {s.progress && (s.progressAt === 'sidebar' || s.progressAt === 'both') && (
                  <label className="switch-row">
                    <select value={s.progressLook ?? 'pct'} onChange={e => set({ progressLook: e.target.value as AppSettings['progressLook'] })}>
                      <option value="pct">42%</option>
                      <option value="bar">A line</option>
                      <option value="both">Both</option>
                    </select>
                    <Says title="Progress in the sidebar" hint="On a workspace's row: its percent, a line along the row's bottom that fills, or both" />
                  </label>
                )}
              </div>
              </Group>
              <Group title="Development">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.devMode} onChange={v => set({ devMode: v })}>
                  <Says title="Development mode" hint="Keeps what happens to each workspace (PR checks, what the PR switches sent and why not, its agents' turns and commands) and extension (fetches, actions): ⋯ › Logs, and Logs on an extension in Settings › Extensions" />
                </Switch>
                {s.devMode && (
                  <div className="row">
                    <Says title="Pick an element" hint="Its hotkey, over any page or dialog: what's under the pointer, to copy into a prompt (also the rail's Pick)" />
                    <span className="grow" />
                    <KeyField value={s.pickerKey ?? PICKER_KEY} def={PICKER_KEY} onSet={pickerKey => set({ pickerKey })} />
                  </div>
                )}
                {s.devMode && p.logs && (
                  <div className="row">
                    <span className="muted small grow">Creation log: what making a workspace ran (what was asked, git, the setup, the agent) or why it failed</span>
                    <button onClick={() => p.logs!('new', 'Logs · new workspaces')}>
                      <Icon name="file" /> Open
                    </button>
                  </div>
                )}
                <div className="button-row">
                  <Says title="Reset the interface" hint="Laki as it starts: every setting at its default (the theme, the rail, the experimental features), every extension off, Get started again, the window's layout. Projects, workspaces, sessions, profiles, accounts, keys and connections stay" />
                  <button type="button" onClick={resetUi}>
                    <Icon name="restore" /> Reset
                  </button>
                </div>
              </div>
              </Group>
              {p.cli && (
                <Group title="Developer" hint="The laki command in any terminal, not only in Laki's tabs: laki ls, laki new, laki screen…; the skill teaches agents the same">
                  <CliField api={p.cli} onSkill={() => openSec('skill')} />
                </Group>
              )}
              <Group title="Pages" hint="On unless you turn them off">
              <div className="setting-box">
                <Switch className="switch-row" on={s.desk !== false} onChange={v => set({ desk: v })}>
                  <Says title="My Desk" hint="A page of your extensions as tiles you drag and resize: an overview of what's going on (your PRs, links, ones you build there with Laki AI). An extension can be on My Desk and in the sidebar at once. Shows the rail's My Desk and ⌘K" />
                </Switch>
                <Switch className="switch-row" on={s.birdView !== false} onChange={v => set({ birdView: v })}>
                  <Says title="Bird view" hint="Every live session at once, each with its screen as it is now: the eye beside Help. A click opens one" />
                </Switch>
                <Switch className="switch-row" on={specsOn(s)} onChange={v => set({ specs: v })}>
                  <Says title="Specs & Brainstorms" hint="Write a project's requirements like a Notion page (checklists, images, diagrams) and brainstorm ideas with Laki AI (options, a mind map, diagrams, clickable prototypes). Each is a folder outside the repo with a README.md any agent can read. Shows the rail's Specs and a project's Specs tab" />
                </Switch>
                <Switch className="switch-row" on={flowsOn(s)} onChange={v => set({ workflows: v })}>
                  <Says title="Workflows" hint="Blocks Laki runs for a task: agents, commands, choices, questions for you, a PR, CI. Each run keeps its decisions and log, and resumes after a restart. Shows the rail's Flows" />
                </Switch>
              </div>
              </Group>
              <Group title="Experimental" hint="New things to try: they may change, or go">
              <div className="setting-box">
                <Switch className="switch-row" on={s.calendar === true} onChange={v => set({ calendar: v })}>
                  <Says title="Calendar" hint="A week or a month of scheduled tasks at their times, their runs, and reminders you, Laki AI or an agent add (laki remind). A reminder notifies as it's due. Shows the rail's Calendar and ⌘K" />
                </Switch>
                <Switch className="switch-row" on={s.notes === true} onChange={v => set({ notes: v })}>
                  <Says title="Notes" hint="Your own notes, one list for every project: written like a Notion page (headings, checklists, tables, images, code, diagrams), each with a color, pinned or not, found by search. Shows the rail's Notes and ⌘K" />
                </Switch>
                <Switch className="switch-row" on={s.todoList === true} onChange={v => set({ todoList: v })}>
                  <Says title="To-dos" hint="One checklist of your own, written like a Notion page: Enter for the next to-do, headings, ones nested under others, dragged into order. Shows the rail's To-dos (or in its ⋯ More: Appearance › Rail) and ⌘K" />
                </Switch>
                <Switch className="switch-row" on={s.fullReview === true} onChange={v => set({ fullReview: v })}>
                  <Says title="Full review" hint="A Review tab first in the tab bar (⌘1) while a workspace has changes: every file's diff with Viewed boxes, comments you gather on lines, then sent to its agent or posted on the PR as one review" />
                </Switch>
                <Switch className="switch-row" on={s.cloud === true} onChange={v => set({ cloud: v })}>
                  <Says title="Cloud workspaces" hint="A workspace in a GitHub Codespace of its own, made through your gh (it needs the codespace scope: gh auth refresh -s codespace): the new-workspace page's In a codespace, with a machine type. Archive stops it, Restore starts it again, Delete deletes it. GitHub bills it" />
                </Switch>
              </div>
              </Group>
              <Group title="Environment" hint="Every session's (agents, shells, setup); a project's or preset's env wins. New sessions get it.">
                <EnvField value={s.env} onChange={env => set({ env })} />
              </Group>
              <Group title="Move to another Mac" hint="Every setting on these pages in a file, but env, presets' env, the phone webhook, remote access's and tunnels' emails and workflows' variables (set them again there); projects and their own settings stay here">
                <div className="row-buttons">
                  <button type="button" onClick={exportAll}>
                    Export…
                  </button>
                  <button type="button" onClick={() => file.current?.click()}>
                    Import…
                  </button>
                  <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => (importAll(e.target.files?.[0]), (e.target.value = ''))} />
                  {moved && <span className="muted small">{moved}</span>}
                </div>
              </Group>
            </>
          )}
          {sec === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <Group title="Interface">
              <div className="grid2">
                <label>
                  Interface font
                  <select
                    value={s.uiFont ?? ''}
                    onChange={e => paint({ uiFont: e.target.value })}
                  >
                    <option value="">Default (Inter, or the theme's)</option>
                    {s.uiFont && !UI_FONTS.includes(s.uiFont) && <option value={s.uiFont}>{s.uiFont}</option>}
                    {UI_FONTS.map(f => (
                      <option key={f} value={f}>
                        {f === 'system' ? 'SF Pro (the Mac’s)' : f}
                      </option>
                    ))}
                  </select>
                </label>
                <label data-tip="While Settings or Help is open, ⌘+ and ⌘− change it too (⌘0: 100%)">
                  Settings &amp; Help size
                  <select value={PAGE_ZOOMS.includes(s.pageZoom as number) ? s.pageZoom : 1} onChange={e => set({ pageZoom: Number(e.target.value) })}>
                    {PAGE_ZOOMS.map(z => (
                      <option key={z} value={z}>
                        {Math.round(z * 100)}%{z === 1 ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Accent color
                  <span className="row-buttons">
                    <input type="color" className="color-pick" value={s.accent || THEMES.find(t => t.id === (s.theme || 'default'))?.c?.accent || '#7aa2f7'} onChange={e => paint({ accent: e.target.value })} />
                    {s.accent && (
                      <button type="button" onClick={() => paint({ accent: '' })}>
                        Theme's
                      </button>
                    )}
                  </span>
                </label>
                <label>
                  Corners
                  <select value={s.radius ?? ''} onChange={e => paint({ radius: e.target.value })}>
                    {CORNERS.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tabs
                  <select value={s.tabsAt ?? 'top'} onChange={e => set({ tabsAt: e.target.value as AppSettings['tabsAt'] })}>
                    {TABS_AT.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label data-tip="High: pages, dialogs, menus and lists come in with a little motion, buttons give a little when pressed. None: nothing moves (spinners stand still)">
                  Animations
                  <select value={s.motion ?? 'low'} onChange={e => paint({ motion: e.target.value as AppSettings['motion'] })}>
                    {MOTION.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              </Group>
              <Group title="Rail" hint="Projects, Board, Schedule, Terminal and Browser on the left, with what needs you on each; the list beside it shows the one you pick">
                <div className="setting-row rail-buttons">
                  <Says title="Its buttons" hint="Tick the ones to show and drag them into an order; the others go into ⋯ More. A right click on the rail does it too" />
                  <RailField s={s} set={set} />
                </div>
                <Switch className="switch-row" on={s.railShells !== false} onChange={v => set({ railShells: v })}>
                  <Says title="Terminals" hint="The rail's Terminal: your terminals in a list of their own. Off: Terminals is a project in Projects' list" />
                </Switch>
                <Switch className="switch-row" on={s.railBrowsers !== false} onChange={v => set({ railBrowsers: v })}>
                  <Says title="Browsers" hint="The rail's Browser: your browsers in a list of their own. Off: Browsers is a project in Projects' list" />
                </Switch>
                <Switch className="switch-row" on={s.history !== false} onChange={v => set({ history: v })}>
                  <Says title="Back and forward" hint="‹ › at the rail's top (else the sidebar's head), ⌘[ and ⌘]: back to the pages and workspaces you were on, the last 25, as in a browser. A right click on one lists where it goes" />
                </Switch>
                <Switch className="switch-row" on={s.railLabels !== false} onChange={v => set({ railLabels: v })}>
                  <Says title="Labels" hint="Words under the rail's icons: Projects, Board, Schedule, Terminal, Browser, Settings; off: icons only, and a narrower rail" />
                </Switch>
              </Group>
              <Group title="Sidebar" hint="How a workspace's row looks; each choice is over the theme's">
              <div className="setting-box">
                <Switch className="switch-row" on={s.needsList !== false} onChange={v => set({ needsList: v })}>
                  <Says title="Needs you list" hint="At the top of the sidebar: every agent waiting for you, its question and options to answer it there, then the ones done while you looked away (Review, Seen). ⌘J goes through the same list" />
                </Switch>
                <Switch className="switch-row" on={s.diffStat === true} onChange={v => set({ diffStat: v })}>
                  <Says title="Diff size in the sidebar" hint="Lines each workspace added and removed against its base, new files too; checked every 10 seconds" />
                </Switch>
              </div>
              <div className="field">
                <div className="seg side-styles" role="radiogroup" aria-label="Sidebar style">
                  {SIDE_STYLES.map(([k, name, what]) => (
                    <button key={k} role="radio" aria-checked={(s.sideStyle ?? 'default') === k} className={(s.sideStyle ?? 'default') === k ? 'on' : ''} data-tip={what} onClick={() => set({ sideStyle: k })}>
                      {name}
                    </button>
                  ))}
                </div>
                <p className="muted small">{(SIDE_STYLES.find(x => x[0] === (s.sideStyle ?? 'default')) ?? SIDE_STYLES[1])[2]}</p>
              </div>
              {lookGrid('sideLook', SIDE_LOOK)}
              <Switch className="switch-row" on={s.sideLook?.labels !== false} onChange={v => set({ sideLook: { ...s.sideLook, labels: v } })}>
                <Says title="Button labels" hint="Words beside the buttons at the bottom of the sidebar: Schedule, Board, Video, Timer, Settings (Rail and list: Video, Meme, Timer); the last ones drop theirs when the row is too narrow" />
              </Switch>
              </Group>
              <Group title="What the window shows">
              <div className="setting-box">
                <Switch className="switch-row" on={s.fun !== false} onChange={v => set({ fun: v })}>
                  <Says title="Fun button" hint="The smiley at the bottom of the sidebar: a random meme from r/memes for a break (→ or N for another)" />
                </Switch>
                <Switch className="switch-row" on={s.prIcon !== false} onChange={v => set({ prIcon: v })}>
                  <Says title="Pull requests in the sidebar" hint="GitHub's mark on a workspace with a PR: green open, purple merged, red failing checks, gray draft or closed" />
                </Switch>
                {s.prIcon !== false && (
                  <Switch className="switch-row sub" on={s.ownAvatar !== false} onChange={v => set({ ownAvatar: v })}>
                    <Says title="Your picture on your PRs" hint="Your GitHub picture beside the mark on your own PRs, as others' show theirs; off: the mark alone on yours" />
                  </Switch>
                )}
                <Switch className="switch-row" on={s.avatars !== false} onChange={v => set({ avatars: v })}>
                  <Says title="GitHub pictures" hint="PR authors' and reviewers' pictures, loaded from avatars.githubusercontent.com; off: GitHub never sees the app ask for them" />
                </Switch>
                <Switch className="switch-row" on={!!s.timers} onChange={v => set({ timers: v })}>
                  <Says title="Turn timers" hint="How long each agent has been at its turn, on its tab and in the sidebar" />
                </Switch>
                {Object.entries(USAGE_AGENTS).map(([a, name]) => (
                  <Switch key={a} className="switch-row" on={s.usage?.[a] !== false} onChange={v => set({ usage: { ...s.usage, [a]: v } })}>
                    <Says title={`${name} plan limits`} hint={`The status bar's ring: the 5-hour and weekly windows, read with ${name}'s own sign-in every 5 minutes`} />
                  </Switch>
                ))}
                <label className="switch-row">
                  <select value={s.contextMeter === false ? 'off' : s.contextMeter === 'ring' || s.contextMeter === 'status' ? s.contextMeter : 'line'} onChange={e => set({ contextMeter: e.target.value === 'off' ? false : (e.target.value as 'line' | 'ring' | 'status') })}>
                    {CTX_LOOKS.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <Says title="Context meter" hint="How full each Claude Code and Codex chat's context is, amber past 70%, red past 90%, so you /compact or start fresh in time: a bar in the status bar, and on its tab a line along its bottom edge or a ring" />
                </label>
                <Switch className="switch-row" on={s.costs !== false} onChange={v => set({ costs: v })}>
                  <Says title="Tokens and cost" hint="What each Claude Code and Codex chat used, on its tab's tooltip, and today's in the plan limits' popup: tokens, and ≈ what they'd cost at API prices (an estimate; your plan bills its own way)" />
                </Switch>
              </div>
              </Group>
              <Group title="Pull request marks" hint="On a workspace whose open PR is approved, or one you looked at: in the sidebar, at a glance">
              <div className="setting-box">
                <Switch className="switch-row" on={s.prMarks?.approved !== false} onChange={v => set({ prMarks: { ...s.prMarks, approved: v } })}>
                  <Says title="✓ Approved" hint="Its reviews approve it (GitHub's decision, or an approval where none is required)" />
                </Switch>
                <Switch className="switch-row" on={s.prMarks?.mine !== false} onChange={v => set({ prMarks: { ...s.prMarks, mine: v } })}>
                  <Says title="✓✓ Approved by you too" hint="Approved, and your approval is one of them" />
                </Switch>
                <Switch className="switch-row" on={s.prMarks?.commented !== false} onChange={v => set({ prMarks: { ...s.prMarks, commented: v } })}>
                  <Says title="👀 You commented" hint="Someone else's PR you commented on or reviewed with comments" />
                </Switch>
                <label>
                  Where they go
                  <select value={s.prMarks?.at ?? 'end'} onChange={e => set({ prMarks: { ...s.prMarks, at: e.target.value as PRMarks['at'] } })}>
                    {MARKS_AT.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              </Group>
              <Group title="Floating bubbles" hint="While you're in another app: a drop on the screen's edge, over every app and Space, with a circle per agent; hover one to see what it said, click to open it, drag it to the other edge or up and down">
              <div className="setting-box">
                <Switch className="switch-row" on={s.floater !== false} onChange={v => set({ floater: v })}>
                  <Says title="Show them" hint="A circle per agent working or waiting for you" />
                </Switch>
                {s.floater !== false && (
                  <>
                    <div className="switch-row sub fl-styles" role="radiogroup" aria-label="A working agent's bubble">
                      <span className="muted small">While working</span>
                      {FLOATER_STYLES.map(([k, name, what]) => (
                        <button key={k} role="radio" aria-checked={(s.floaterStyle ?? 'gradient') === k} className={(s.floaterStyle ?? 'gradient') === k ? 'on' : ''} data-tip={what} data-fstyle={k} onClick={() => set({ floaterStyle: k })}>
                          <span className="fl-dot running">FC</span>
                          {name}
                        </button>
                      ))}
                      <button className="fl-wait" data-tip="Waiting for you: a pulse, in every style" disabled>
                        <span className="fl-dot waiting">FC</span>
                        waiting
                      </button>
                      {s.floaterDone !== false && (
                        <button className="fl-wait" data-done="on" data-tip="Finished, not seen yet: green, a slow pulse" disabled>
                          <span className="fl-dot done">FC</span>
                          finished
                        </button>
                      )}
                    </div>
                    <label className="switch-row">
                      <select value={s.floaterRecent ?? 3} onChange={e => set({ floaterRecent: Number(e.target.value) })}>
                        {[0, 1, 2, 3, 4, 5].map(n => (
                          <option key={n} value={n}>
                            {n ? `The last ${n}` : 'None'}
                          </option>
                        ))}
                      </select>
                      <Says title="Recent sessions too" hint="Agents you used last, idle or finished, after the ones at work: a dimmer circle each, finished ones you haven't seen first" />
                    </label>
                    {(s.floaterRecent ?? 3) > 0 && (
                      <label className="switch-row sub">
                        <select value={s.floaterRecentHours ?? 4} onChange={e => set({ floaterRecentHours: Number(e.target.value) })}>
                          {[1, 4, 8, 24, 0].map(n => (
                            <option key={n} value={n}>
                              {n ? `After ${n}h idle` : 'Never'}
                            </option>
                          ))}
                        </select>
                        <Says title="Drop a recent one" hint="How long an idle agent stays a bubble after its last turn" />
                      </label>
                    )}
                    <label className="switch-row">
                      <select value={s.floaterMax ?? 12} onChange={e => set({ floaterMax: Number(e.target.value) })}>
                        {[3, 5, 8, 12].map(n => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <Says title="Bubbles at most" hint="Waiting ones first, then working, then recent" />
                    </label>
                    <Switch className="switch-row" on={s.floaterDone !== false} onChange={v => set({ floaterDone: v })}>
                      <Says title="Finished ones stand out" hint="An agent that finished while you weren't looking: its bubble turns green and pulses slowly, until you click it or look at it in Laki" />
                    </Switch>
                    <Switch className="switch-row" on={s.floaterCards !== false} onChange={v => set({ floaterCards: v })}>
                      <Says title="Card on hover" hint="Its name, project and what it asked or last said, beside the drop" />
                    </Switch>
                    <Switch className="switch-row" on={s.floaterNew !== false} onChange={v => set({ floaterNew: v })}>
                      <Says title="+ button" hint="A + under the circles; a click shows New task (the new-workspace page in a window of its own, over the app you're in), Say it, Screenshot area and Whole screen, as the menu bar's. With it the drop stays when no agent is at work" />
                    </Switch>
                    {s.floaterNew !== false && (
                      <>
                        <label className="switch-row sub">
                          <select value={s.floaterMenu ?? 'stack'} onChange={e => set({ floaterMenu: e.target.value as 'stack' | 'card' })}>
                            <option value="stack">Stacked in the drop</option>
                            <option value="card">A menu beside it</option>
                          </select>
                          <Says title="Its actions" hint="Stacked: buttons over the +, the drop grows, a hover names each. A menu: a card beside the drop with their names, a number key picks one. Ask Laki AI joins them while Laki AI is on" />
                        </label>
                        <label className="switch-row sub">
                          <select value={s.floaterVoiceTo ?? 'pick'} onChange={e => set({ floaterVoiceTo: e.target.value as 'pick' | 'new' })}>
                            <option value="pick">An agent I pick each time</option>
                            <option value="new">Always a new session</option>
                          </select>
                          <Says title="Say it goes to" hint="Say a prompt (macOS dictation), then: pick each time from the bubbles' agents or a new session, nothing chosen until you do; or always a new session, the new-workspace window with what you said" />
                        </label>
                      </>
                    )}
                  </>
                )}
              </div>
              </Group>
              {bridge?.dockIcon && (
                <Group title="Dock icon" hint="Laki's icon in the Dock and the app switcher, kept after a restart or an update; Finder keeps the app's own">
                  <div className="setting-box">
                    <div className="switch-row dock-icons" role="radiogroup" aria-label="Dock icon">
                      {DOCK_ICONS.map(([id, name, src]) => (
                        <button key={id} role="radio" aria-checked={(s.dockIcon ?? 'laki') === id} className={(s.dockIcon ?? 'laki') === id ? 'on' : ''} onClick={() => set({ dockIcon: id })}>
                          <img src={src} width={48} height={48} alt="" />
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                </Group>
              )}
              <Group title="Project names" hint="The projects' heads in the sidebar, over the theme's">
                {lookGrid('projectLook', PROJECT_LOOK)}
              </Group>
              <Group title="Window">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.glass} onChange={v => paint({ glass: v }) /* the window's own blur follows once saved */}>
                  <Says title="Glass" hint="A see-through window: the desktop shows through, blurred" />
                </Switch>
                {(s.glass || (s.sideClear ?? 0) > 0) && matchMedia('(prefers-reduced-transparency: reduce)').matches && (
                  <div className="muted small">macOS's Reduce transparency is on, so the window stays solid: turn it off in System Settings › Accessibility › Display.</div>
                )}
                {s.glass && (
                  <>
                    <div className="sliders">
                      <span className="muted small">How see-through</span>
                      {(
                        [
                          ['glassWindow', 'Window'],
                          ['glassSide', 'Sidebar'],
                          ['glassTerm', 'Terminals'],
                        ] as const
                      ).map(([k, label]) => {
                        const v = s[k] ?? GLASS[k]
                        return (
                          <label key={k} className="slider-row">
                            <span>{label}</span>
                            <input
                              type="range"
                              className="range"
                              min={0}
                              max={100}
                              step={5}
                              value={v}
                              style={{ '--p': v } as CSSProperties /* the filled part of the track */}
                              onChange={e => paint({ [k]: Number(e.target.value) })}
                            />
                            <span className="slider-val">{v}%</span>
                          </label>
                        )
                      })}
                    </div>
                    <Switch className="switch-row" on={s.glassGlow !== false} onChange={v => paint({ glassGlow: v })}>
                      <Says title="Glow" hint="The theme's colors, lit from two corners behind the glass" />
                    </Switch>
                  </>
                )}
                {!s.glass && (
                  <div className="sliders">
                    <Says title="Sidebar see-through" hint="The sidebar and the rail let the desktop through, blurred, as macOS's own sidebars; the rest stays solid. 0: off" />
                    <label className="slider-row">
                      <span>Sidebar</span>
                      <input
                        type="range"
                        className="range"
                        min={0}
                        max={100}
                        step={5}
                        value={s.sideClear ?? 0}
                        style={{ '--p': s.sideClear ?? 0 } as CSSProperties}
                        onChange={e => paint({ sideClear: Number(e.target.value) })}
                      />
                      <span className="slider-val">{s.sideClear ?? 0}%</span>
                    </label>
                  </div>
                )}
              </div>
              </Group>
              <Group title="Theme" hint="Terminals use the Terminal section's font. Themes marked ✦ also change shapes, borders and type.">
              <input type="search" className="theme-find" value={themeQ} placeholder={`Find a theme by name, game or film (${THEMES.length})`} spellCheck={false} onChange={e => setThemeQ(e.target.value)} />
              {!shownThemes.length && <div className="muted small">No theme called “{themeQ.trim()}”.</div>}
              {(
                [
                  ['Favorites', shownThemes.filter(t => favs.includes(t.id))],
                  [favs.length ? 'All themes' : '', shownThemes], // a starred one stays here too
                ] as [string, typeof THEMES][]
              ).map(([head, list]) =>
                list.length ? (
                  <Fragment key={head}>
                    {head && <h4 className="themes-head">{head}</h4>}
                    <div className="themes" onMouseLeave={() => applyTheme(s)}>
                      {list.map(t => {
                        const [bg, panel, fg, accent, ...ansi] = preview(t)
                        const on = (s.theme || 'default') === t.id
                        const fav = favs.includes(t.id)
                        return (
                          <div key={t.id} className="theme-wrap">
                            <button
                              className={`theme ${on ? 'on' : ''}`}
                              aria-pressed={on}
                              style={{ background: bg, color: fg }}
                              onClick={() => paint({ theme: t.id })}
                              onMouseEnter={() => applyTheme({ ...s, theme: t.id }) /* a look before choosing */}
                            >
                              <span className="theme-bar" style={{ background: panel }}>
                                <span style={{ background: accent }} />
                                {on && (
                                  <b className="theme-check" style={{ background: fg, color: bg }}>
                                    <Icon name="check" size={10} />
                                  </b>
                                )}
                              </span>
                              <span className="theme-dots">
                                {ansi.map((c, i) => (
                                  <span key={i} style={{ background: c }} />
                                ))}
                              </span>
                              <span className="theme-name">
                                {t.name}
                                {t.look && ' ✦'}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`theme-fav ${fav ? 'on' : ''}`}
                              style={{ color: fg }}
                              aria-pressed={fav}
                              data-tip={fav ? 'Out of Favorites' : 'Add to Favorites'}
                              onClick={() => paint({ favThemes: fav ? favs.filter(x => x !== t.id) : [...favs, t.id] })}
                            >
                              {fav ? '★' : '☆'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </Fragment>
                ) : null,
              )}
              </Group>
            </>
          )}
          {sec === 'terminal' && (
            <>
              <h2>Terminal</h2>
              <p className="muted">How every tab's terminal looks and behaves: agents', shells' and dev servers'. The preview changes as you do.</p>
              <section className="set-group term-top">
                <div className="term-top-head">
                  <div className="set-head">
                    <h3>Preview</h3>
                    <p className="muted small">
                      {font || 'JetBrains Mono'} · {s.fontSize ?? FONT_SIZE}px · {WEIGHTS[s.fontWeight || '400']} · {s.lineHeight ?? 1.15} line height · click it for the cursor
                    </p>
                  </div>
                  <button type="button" disabled={!termChanged} data-tip="Every setting on this page back to Laki's" onClick={() => (setOtherFont(false), set(TERM_DEFAULTS))}>
                    <Icon name="refresh" /> Reset to defaults
                  </button>
                </div>
                <div style={{ zoom: 1 / scale }}>
                  <TermPreview key={String(transparent())} s={s} />
                </div>
              </section>
              <Group title="Text" hint="Ligatures (=> as one glyph) aren't drawn: xterm needs an add-on for them that Laki doesn't ship.">
                <div className="setting-box">
                  <label className="switch-row">
                    <select
                      value={otherFont ? 'other' : font}
                      onChange={e => {
                        setOtherFont(e.target.value === 'other')
                        if (e.target.value !== 'other') set({ fontFamily: e.target.value }) // '': the default (undefined wouldn't be saved)
                      }}
                    >
                      <option value="">JetBrains Mono (default)</option>
                      {font && !otherFont && !fonts.includes(font) && <option value={font}>{font} (not found)</option>}
                      {fonts.map(f => (
                        <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>
                          {f}
                        </option>
                      ))}
                      <option value="other">Other…</option>
                    </select>
                    <Says title="Font" hint="The monospace fonts on this Mac; Other… takes any by its name" />
                  </label>
                  {otherFont && (
                    <label className="switch-row sub">
                      <input className="term-font-name" value={s.fontFamily ?? ''} placeholder="As in Font Book" onChange={e => set({ fontFamily: e.target.value })} autoFocus />
                      <Says title="Font name" />
                    </label>
                  )}
                  {row('Size', "Every tab's; ⌘+ ⌘− ⌘0 change one tab's", 'fontSize', FONT_SIZE, FONT_SIZES, n => `${n}px`)}
                  {row('Weight', undefined, 'fontWeight', '400', ['300', '400', '500', '600', '700'], w => `${w} · ${WEIGHTS[w]}`)}
                  {row('Line height', undefined, 'lineHeight', 1.15, [1, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.8])}
                  {row('Letter spacing', undefined, 'letterSpacing', 0, [-1, -0.5, 0, 0.5, 1, 1.5, 2, 3], n => `${n}px`)}
                  {row('Minimum contrast', 'Lifts colors too faint to read on the background', 'minContrast', 1, [1, 3, 4.5, 7], n => CONTRAST[n])}
                </div>
              </Group>
              <Group title="Cursor">
                <div className="setting-box">
                  {seg('Style', undefined, 'cursorStyle', 'block', [['block', 'Block', '█'], ['bar', 'Bar', '▏'], ['underline', 'Underline', '▁']])}
                  <Switch className="switch-row" on={s.cursorBlink !== false} onChange={v => set({ cursorBlink: v })}>
                    <Says title="Blink" hint="In the tab you're typing in" />
                  </Switch>
                </div>
              </Group>
              <Group title="Panes and tabs">
                <div className="setting-box">
                  {seg('Padding', 'Room between the text and the pane\'s edges', 'termPad', 'normal', [['tiny', 'Tiny'], ['normal', 'Normal'], ['roomy', 'Roomy']])}
                  <Switch className="switch-row" on={s.dimPanes !== false} onChange={v => set({ dimPanes: v })}>
                    <Says title="Dim other panes" hint="In a split, the panes you're not typing in fade back" />
                  </Switch>
                  <Switch className="switch-row" on={s.hoverFocus !== false} onChange={v => set({ hoverFocus: v })}>
                    <Says title="Focus the pane under the mouse" hint="Type into a split without clicking it first" />
                  </Switch>
                  <Switch className="switch-row" on={!!s.splitNew} onChange={v => set({ splitNew: v })}>
                    <Says title="New tabs open as a split" hint="A new tab (⌘⇧N, the + menu, Laki AI's) goes beside the pane you're on, in the same tab, instead of a tab of its own" />
                  </Switch>
                </div>
              </Group>
              <Group title="Keyboard, mouse and clipboard">
                <div className="setting-box">
                  {row('Scroll speed', 'With ⌥: three times that', 'scrollSpeed', SCROLL, [1, 2, 3, 4, 5, 8], n => `${n}×${n === 1 ? ' · xterm\u2019s' : ''}`)}
                  <Switch className="switch-row" on={s.copyOnSelect !== false} onChange={v => set({ copyOnSelect: v })}>
                    <Says title="Copy selected text" hint="What you select is on the clipboard, no ⌘C needed" />
                  </Switch>
                  <Switch className="switch-row" on={s.editKeys !== false} onChange={v => set({ editKeys: v })}>
                    <Says title="Mac editing keys" hint="⌘← ⌘→ to the line's start and end, ⌥← ⌥→ a word at a time, ⌘⌫ the line before the cursor" />
                  </Switch>
                </div>
              </Group>
            </>
          )}
          {sec === 'open' && (
            <>
              <h2>Open in</h2>
              <Group title="Editor" hint="Where a workspace's folder opens">
              <label>
                <span>
                  Default <span className="muted">· ⌘E; the editor icon lists the rest</span>
                </span>
                <select value={editor} onChange={e => set({ editor: e.target.value })}>
                  {!apps.some(a => a.id === editor) && editor !== 'custom' && <option value={editor}>{editor} (not found)</option>}
                  {apps
                    .filter(a => a.id !== 'custom' && !a.browser)
                    .map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  <option value="custom">Custom command</option>
                </select>
              </label>
              <label>
                <span>
                  Custom command <span className="muted">· gets the folder as $1</span>
                </span>
                <input className="mono" value={s.editorCmd ?? ''} placeholder='idea "$1"' onChange={e => set({ editorCmd: e.target.value })} />
              </label>
              </Group>
            </>
          )}
          {sec === 'skill' && p.skill && <SkillSection api={p.skill} />}
          {sec === 'widgets' && p.widgets && <WidgetsSection api={p.widgets} dirs={s.widgetDirs ?? []} onDirs={widgetDirs => set({ widgetDirs })} hours={s.widgetHours ?? ''} onHours={widgetHours => set({ widgetHours })} onAgent={widgetAgent => set({ widgetAgent })} onLogs={widgetLogs => set({ widgetLogs })} />}
          {sec === 'remote' && p.remote && (
            <RemoteSection
              api={p.remote}
              opts={{ mail: s.remoteMail ?? '', auth: s.remoteAuth ?? 'email', tries: s.remoteTries ?? REMOTE_TRIES, tsPin: !!s.remoteTsPin, funnel: !!s.remoteFunnel }}
              set={o => set({ ...(o.mail !== undefined && { remoteMail: o.mail }), ...(o.auth !== undefined && { remoteAuth: o.auth }), ...(o.tries !== undefined && { remoteTries: o.tries }), ...(o.tsPin !== undefined && { remoteTsPin: o.tsPin }), ...(o.funnel !== undefined && { remoteFunnel: o.funnel }) })}
            />
          )}
          {sec === 'simulator' && p.simulator && <SimSection sim={p.simulator} on={s.simulator === true} onOn={simulator => set({ simulator })} />}
          {sec === 'keys' && (
            <KeysSection
              over={s.keys}
              others={[
                ...(s.hotkeyOn !== false && s.hotkey !== '' ? ([[s.hotkey ?? HOTKEY, 'the global hotkey']] as [string, string][]) : []),
                ...(s.shotAsk === true && s.shotKey !== '' ? ([[s.shotKey ?? SHOT_KEY, 'Screenshot to Laki AI']] as [string, string][]) : []),
                ...(s.pickerKey !== '' ? ([[s.pickerKey ?? PICKER_KEY, 'Pick an element (development mode)']] as [string, string][]) : []),
              ]}
              onChange={keys => set({ keys })}
              overlay={s.keyOverlay !== false}
              onOverlay={keyOverlay => set({ keyOverlay })}
            />
          )}
          {sec === 'resources' && p.resources && <ResourcesSection api={p.resources} sleepAfter={s.sleepAfter ?? SLEEP_AFTER} onSleepAfter={sleepAfter => set({ sleepAfter })} />}
          {sec === 'achievements' && p.achievements && <AchievementsSection api={p.achievements} />}
          {sec === 'memory' && (
            <>
              <h2>Global memory</h2>
              <p className="muted small">
                Your own rules for every project: Claude and Codex get them at every start, in any project, just before that project's own memory (a project's
                page › Memory). Good for how you like to work: commit messages, tests to run, what never to do. Only you add here: agents' auto-memory stays
                with each project. A profile with <b>Tell it about Laki</b> off gets none.
              </p>
              <MemoryList global memory={s.memory ?? []} save={memory => (set({ memory }), Promise.resolve())} />
              <Group title="Compact agents' memories" hint="Each project's learned memories, sent to Laki AI's model: duplicates merged, overlaps joined, stale ones dropped, a shorter list in their place. Never yours. A project's Memory tab has Compact now and the log">
                <div className="setting-box">
                  <Switch className="switch-row" on={s.memoryCompact?.on === true} onChange={on => set({ memoryCompact: { ...s.memoryCompact, on: on || undefined } })}>
                    <Says title="On its own" hint={aiOn(s) ? `Sends each project's learned memories to Laki AI's model every few days, and as they reach ${MEMORY_MAX}` : 'Laki AI does it: turn it on in Settings › AI'} />
                  </Switch>
                  <label className="row">
                    <Says title="Every" hint="days since the last one (0: only when full)" />
                    <span className="grow" />
                    <input type="number" min={0} max={365} style={{ width: 80 }} value={s.memoryCompact?.days ?? COMPACT_DAYS} onChange={e => e.target.value !== '' && set({ memoryCompact: { ...s.memoryCompact, days: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) } })} />
                  </label>
                </div>
              </Group>
            </>
          )}
          {sec === 'notes' && (
            <>
              <h2>Release notes</h2>
              <p className="muted small">What's new in Laki, newest first. This build: {version}.</p>
              <div className="release-notes">
                <Markdown src={notes.replace(/<!--[\s\S]*?-->/g, '').replace(/^## Next$/m, `## New since ${version}`)} />
              </div>
            </>
          )}
          {sec === 'ai' && p.ai && <AiSection api={p.ai} ai={s.ai ?? {}} glow={s.aiGlow !== false} onGlow={aiGlow => set({ aiGlow })} presets={presets} onChange={ai => set({ ai })} imageDays={s.imageDays} onImageDays={imageDays => set({ imageDays })} />}
          {sec === 'voice' && p.ai && <VoiceSection v={s.voice ?? {}} keyApi={p.ai} onChange={voice => set({ voice })} />}
          {sec === 'webhook' && <WebhookSection w={s.webhook ?? {}} onChange={webhook => set({ webhook })} test={p.webhookTest} />}
          {sec === 'pr' && (
            <>
              <h2>Pull requests</h2>
              <p className="muted small">
                The status bar's <b>fix CI</b>, <b>review</b> and <b>fix conflicts</b> switches, on for a workspace with a PR, send these to its agent
                (when it's idle), and so do the info panel's send buttons. <code>{'{{pr}}'}</code> is the PR's number, <code>{'{{url}}'}</code> its link,{' '}
                <code>{'{{base}}'}</code> its base branch. Laki checks each PR with <code>gh</code> as often as you pick here, and a moment after an agent's turn ends.
              </p>
              <p className="muted small">Merge, merge when green, approve and close are each project's to allow: its section here, under Pull requests (merge when green is off until you turn it on).</p>
              <Group title="Checks">
              <div className="grid2">
                {pick('Check pull requests every', 'prScan', PR_SCAN, [1, 2, 5, 10, 15, 30], n => (n === 1 ? '1 minute' : `${n} minutes`))}
                {pick('Tries in a row', 'prTries', PR_TRIES, [1, 2, 3, 5, 10], n => `${n} · then it's over to you`)}
              </div>
              </Group>
              <Group title="Review bots" hint="The review switch sends people's comments (the repo's owners, members, collaborators) and these bots' only: any app can be a bot. Others are skipped.">
                <ChipsInput value={(s.prBots ?? PR_BOTS).join(',')} onChange={v => set({ prBots: v.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="A bot's login, then Enter" />
              </Group>
              <Group title="What the switches send" hint="Each prompt goes first, then the checks' logs or the review threads">
              {PR_KINDS.map(([k, title, after]) => {
                const v = s.prPrompts?.[k]
                return (
                  <div key={k} className="field">
                    <span>
                      {title}
                      {after && <span className="muted"> · {after}</span>}
                      {v !== undefined && v !== PR_PROMPTS[k] && (
                        <button type="button" className="link" onClick={() => set({ prPrompts: { ...s.prPrompts, [k]: undefined } })}>
                          Reset
                        </button>
                      )}
                    </span>
                    <textarea className="mono" rows={5} spellCheck={false} value={v ?? PR_PROMPTS[k]} placeholder={PR_PROMPTS[k]} onChange={e => set({ prPrompts: { ...s.prPrompts, [k]: e.target.value === PR_PROMPTS[k] ? undefined : e.target.value } })} />
                  </div>
                )
              })}
              </Group>
            </>
          )}
          {sec === 'templates' && (
            <>
              <h2>Prompt templates</h2>
              <Scope tag="Global">
                In every project's new workspaces, whatever the agent. A project's own (Settings › the project › Prompt templates) come first there, and one
                with the same name replaces a global one.
              </Scope>
              <p className="muted small">
                Pick one under a new workspace's prompt and the agent gets it filled in: <code>{'{{prompt}}'}</code> is what you typed, <code>{'{{project}}'}</code> and{' '}
                <code>{'{{base}}'}</code> the project and base branch. A template without <code>{'{{prompt}}'}</code> gets the prompt after it.
              </p>
              <TemplatesField value={s.templates} onChange={templates => set({ templates })} />
            </>
          )}
          {sec === 'actions' && (
            <>
              <h2>Actions</h2>
              <Scope tag="Global">
                In Run ▾ in every project's workspaces, for every preset of the agent it's for (Any agent: all of them). A project's own (Settings › the
                project › Actions) come after them, and one with the same name and kind replaces a global one.
              </Scope>
              <p className="muted small">
                Agent actions: a prompt goes to its agent's tab (the focused one first), queued while the agent works; it's listed only while that agent runs
                there. Shell actions (target Shell): a command you run often, run in the focused shell at its prompt, any other at its prompt, or a new one.
                Resting on one in Run ▾ shows what it sends. The copy button makes the same for another agent.
              </p>
              <ActionsField value={s.actions} taken={p.projects?.flatMap(x => x.config?.actions?.map(a => a.slug) ?? [])} onChange={actions => set({ actions })} />
            </>
          )}
          {sec === 'presets' && (
            <>
              <h2>Agents & profiles</h2>
              <p className="muted small">
                An agent is a CLI Laki starts (Claude Code, Codex…); a profile is how it starts: its model, effort, permission and fast mode, account, flags and env. Each profile
                that's on is in the new-tab menu, the new-workspace page and scheduled tasks; switch off the ones you don't use (their tabs still start). Flags go
                after the command, before the prompt, through the shell (so the variables work); env goes on top of the project's.
              </p>
              {[...new Set<Preset['agent']>([...ACCOUNT_AGENTS, ...presets.map(x => x.agent)])].map(agent => (
                <Group key={agent} title={agent === 'command' ? 'Commands' : AGENT_NAMES[agent]} hint={isAccountAgent(agent) ? 'Accounts: its sign-ins. New sessions start on the default (a profile can pick one); a tab keeps its own, and its menu restarts it on another' : undefined}>
                  {isAccountAgent(agent) && p.accounts && (
                    <AccountsBlock agent={agent} api={p.accounts} views={accts} usage={usage} use={accts.find(v => v.agent === agent && v.default)?.id ?? HOME_ACCOUNT} onUse={id => (set({ accountUse: { ...s.accountUse, [agent]: id } }), setAccts(v => v.map(x => (x.agent === agent ? { ...x, default: x.id === id } : x))))} reload={loadAccts} />
                  )}
                  {presets.map((pr, i) =>
                    pr.agent !== agent ? null : (
                      <div key={keys.current[i]} className={`preset ${pr.off ? 'off' : ''}`}>
                        <div className="row preset-head">
                          <Switch on={!pr.off} onChange={on => setPreset(i, { off: on ? undefined : true })} tip={pr.off ? `${pr.name}: off, not in the pickers` : `${pr.name}: on`} />
                          <input className="mono" value={pr.name} placeholder="name" aria-label="Profile name" onChange={e => setPreset(i, { name: e.target.value.replace(/\s+/g, '-') })} />
                          <select value={pr.agent} aria-label="Agent" onChange={e => setPreset(i, { agent: e.target.value as Preset['agent'], model: undefined, effort: undefined, perm: undefined, fast: undefined, account: undefined })}>
                            {AGENTS.map(a => (
                              <option key={a} value={a}>
                                {AGENT_NAMES[a]}
                              </option>
                            ))}
                            <option value="command">Command</option>
                          </select>
                          <IconButton icon="trash" title="Remove profile" onClick={() => setPresets(presets.filter((_, j) => j !== i), i)} />
                        </div>
                        {pr.agent !== 'command' && (
                          <div className="row profile-picks">
                            <input className="mono" value={pr.model ?? ''} placeholder={`model: ${MODELS[pr.agent]?.join(', ') || "the agent's own"}`} aria-label="Model" list={`models-${pr.agent}`} onChange={e => setPreset(i, { model: e.target.value.trim() || undefined })} />
                            {MODELS[pr.agent] && (
                              <datalist id={`models-${pr.agent}`}>
                                {MODELS[pr.agent]!.map(m => (
                                  <option key={m} value={m} />
                                ))}
                              </datalist>
                            )}
                            {EFFORTS[pr.agent] && (
                              <select value={pr.effort ?? ''} aria-label="Effort" onChange={e => setPreset(i, { effort: e.target.value || undefined })}>
                                <option value="">effort: its own</option>
                                {EFFORTS[pr.agent]!.map(x => (
                                  <option key={x} value={x}>
                                    {x}
                                  </option>
                                ))}
                              </select>
                            )}
                            {PERMS[pr.agent] && (
                              <select value={permInArgs(pr.agent, pr.args) ? '' : (pr.perm ?? '')} aria-label="Permission mode" disabled={permInArgs(pr.agent, pr.args)} data-tip={permInArgs(pr.agent, pr.args) ? 'Its flags set it' : 'How freely it acts (a workspace may pick another)'} onChange={e => setPreset(i, { perm: e.target.value || undefined })}>
                                <option value="">{permInArgs(pr.agent, pr.args) ? 'mode: its flags’' : 'mode: ask first'}</option>
                                {PERMS[pr.agent]!.map(([id, label]) => (
                                  <option key={id} value={id}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            )}
                            {isAccountAgent(pr.agent) && (
                              <select value={pr.account ?? ''} aria-label="Account" onChange={e => setPreset(i, { account: e.target.value || undefined })}>
                                <option value="">account: the default</option>
                                {accts
                                  .filter(v => v.agent === pr.agent)
                                  .map(v => (
                                    <option key={v.id} value={v.id}>
                                      {v.id === HOME_ACCOUNT ? 'Default sign-in' : v.name}
                                      {v.email ? ` · ${v.email}` : ''}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </div>
                        )}
                        {pr.agent === 'command' ? (
                          <input className="mono" value={pr.cmd ?? ''} placeholder="aider --model sonnet" onChange={e => setPreset(i, { cmd: e.target.value })} />
                        ) : (
                          <input className="mono" value={pr.args ?? ''} placeholder={`flags: ${ARGS_EG[pr.agent as Agent]}`} aria-label="Flags" onChange={e => setPreset(i, { args: e.target.value })} />
                        )}
                        <VarChips vars={ENV_VARS} value={(pr.agent === 'command' ? pr.cmd : pr.args) ?? ''} onChange={v => setPreset(i, pr.agent === 'command' ? { cmd: v } : { args: v })} />
                        <EnvField value={pr.env} onChange={env => setPreset(i, { env: Object.keys(env).length ? env : undefined })} placeholder="env: KEY=value, one per line" />
                        {pr.agent !== 'command' && FAST[pr.agent] && (
                          <Switch className="switch-row" on={!!pr.fast} onChange={on => setPreset(i, { fast: on || undefined })}>
                            <Says title="Fast mode" hint="Quicker answers, at a higher price (a workspace may turn it off)" />
                          </Switch>
                        )}
                        {(pr.agent === 'claude' || pr.agent === 'codex') && (
                          <Switch className="switch-row" on={pr.laki !== false} onChange={on => setPreset(i, { laki: on ? undefined : false })}>
                            <Says title="Tell it about Laki" hint="A note at each start: it runs in Laki, can name its workspace, attach a PR, start another workspace, and keep files for you in $LAKI_STORAGE_FOLDER" />
                          </Switch>
                        )}
                      </div>
                    ),
                  )}
                  <div className="row">
                    <button onClick={() => setPresets([...presets, { name: freeProfile(agent === 'command' ? 'command' : agent), agent }])}>
                      <Icon name="plus" /> Add {agent === 'command' ? 'command' : `${AGENT_NAMES[agent]} profile`}
                    </button>
                  </div>
                </Group>
              ))}
              <div className="row">
                <select value="" aria-label="Add a profile for another agent" onChange={e => e.target.value && setPresets([...presets, { name: freeProfile(e.target.value), agent: e.target.value as Preset['agent'] }])}>
                  <option value="">Add a profile for…</option>
                  {[...AGENTS, 'command' as const]
                    .filter(a => !presets.some(x => x.agent === a) && !isAccountAgent(a))
                    .map(a => (
                      <option key={a} value={a}>
                        {a === 'command' ? 'A command' : AGENT_NAMES[a]}
                      </option>
                    ))}
                </select>
                {s.presets && (
                  <button className="link" onClick={() => setPresets(null)}>
                    Reset to the agents installed
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
