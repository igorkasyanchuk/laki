// The app's settings, a page of its own (⌘,): saved as you change them. The daemon keeps
// the settings.
import { FitAddon } from '@xterm/addon-fit'
import { type FontWeight, Terminal } from '@xterm/xterm'
import { type CSSProperties, Fragment, type KeyboardEvent as KeyEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { actionSlug, AGENT_NAMES, AGENTS, type Agent, AI_CONTEXT_MAX, AI_MODEL, AI_STEPS, type AiBackend, type AiSettings, type AiTotals, type FixWhat, type NotifyKind, PR_PROMPTS, PR_SCAN, PR_TRIES, type Preset, type MergeMethod, type PRAllow, type PRMarks, prAllows, type ProcUse, type ProjectLook, type Resources, type SideLook, type SideStyle, type TabView, type Webhook, type WidgetOption, type WidgetPlace, type WidgetSize, type WidgetView, webhookUrl } from '../../shared/types'
import { ago } from '../../shared/widget'
import { widgetPrompt } from '../../shared/widgetGuide'
import { importable, MAIL_OK, mergeActions, parseMails, type RunAction, type Template, templatesFor } from './text'
import { describeHours, parseHours } from '../../shared/when'
import { bridge } from './api'
import { DOCK_ICONS } from './dock'
import { applyTheme, GLASS, type Paint, paintKey, preview, termTheme, THEMES, transparent, UI_FONTS } from './themes'
import './floater.css'
import { ask, Icon, IconButton, type IconName, keep, load, Switch } from './ui'
import { QR } from './Tunnel'
import { USAGE_AGENTS } from './Usage'
import { BACKENDS, money, tokens } from './Ai'
import { Markdown } from './MarkdownView'
import { Modal } from './panels'
import notes from '../../../docs/release-notes.md?raw'
import { version } from '../../../package.json'

// a switch row's text: what it is, and under it a line on what it does
const Says = ({ title, hint }: { title: ReactNode; hint?: ReactNode }) => (
  <span className="switch-text">
    <span>{title}</span>
    {hint && <span className="muted">{hint}</span>}
  </span>
)

// a block of settings that belong together, set apart from the next: a title, what it's for, then them
const Group = ({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) => (
  <section className="set-group">
    <div className="set-head">
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
    </div>
    {children}
  </section>
)

// a list's note (Prompt templates, Actions): Global, everywhere; This project, here only, with the global ones
const Scope = ({ tag, children }: { tag: string; children: ReactNode }) => (
  <div className="set-scope">
    <span className="tag set-scope-tag">{tag}</span>
    <span>{children}</span>
  </div>
)

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
  ['cards', 'Cards', 'a card each, with the agent’s last answer'],
  ['status', 'Status', 'an edge in the color of what its agent is doing, and a line under it that fills as the agent reports progress'],
]
// Appearance's corners (--radius) and where the tabs go
const CORNERS: [string, string][] = [['', "Theme's"], ['0px', 'Square'], ['3px', 'Slight'], ['6px', 'Rounded'], ['10px', 'Round'], ['14px', 'Very round']]
// where a workspace row's PR marks go: by the status circle, after the name, or with the GitHub mark
const MARKS_AT: [NonNullable<PRMarks['at']>, string][] = [['end', "With GitHub's mark"], ['start', 'By the status circle'], ['name', 'After the name']]
const TABS_AT: [NonNullable<AppSettings['tabsAt']>, string][] = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]

export type AppSettings = Paint & {
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
  prMarks?: PRMarks // the sidebar's ✓, ✓✓ and 👀 on an open PR
  timers?: boolean // a turn's time on its tab and row (unset: off)
  diffStat?: boolean // each workspace's +/- in the sidebar (unset: off)
  dimPanes?: boolean // a split's other panes faded (unset: off)
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: off)
  closeNoAsk?: boolean // closing a tab whose process still runs doesn't ask first (unset: it asks)
  pageZoom?: number // Settings and Help's size, one of PAGE_ZOOMS (unset: 1)
  worktrees?: string // where new worktrees go, a folder per project inside (unset: <data>/worktrees)
  storageDir?: string // workspaces' storage folders, one per workspace inside (unset: <data>/storage)
  keepStorage?: boolean // a deleted workspace's storage folder stays
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  projectLook?: ProjectLook // the sidebar's project names
  sideLook?: SideLook // the sidebar's lines, rows and button labels
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  notifySound?: string // a macOS sound, 'none', or unset: the default
  timerAlert?: 'dialog' | 'notification' // what a timer's end shows (unset: the dialog)
  timerSound?: string // a macOS sound or 'none' as a timer ends (unset: Glass)
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  presets?: Preset[] | null // null: the daemon's defaults (every agent installed)
  remoteMail?: string // the one address remote access lets in
  prPrompts?: Partial<Record<FixWhat, string>> // what the PR switches tell the agent (unset: PR_PROMPTS)
  prScan?: number // minutes between PR checks
  prTries?: number // fix CI's and fix conflicts' tries in a row
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (0: always)
  webhook?: Webhook // pushes to your phone
  ai?: AiSettings // Laki AI (Settings › AI)
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
  widgetHours?: string // when they fetch on their own: 9am-9pm weekdays (unset: always)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs)
  specs?: boolean // experimental: Specs & Brainstorms (Specs.tsx), off unless true
  workflows?: boolean // experimental: Workflows (Workflows.tsx), off unless true
  birdView?: boolean // experimental: Bird view (Bird.tsx), every live session's screen at once, off unless true
  progress?: boolean // LAKI_PROGRESS=1 for agents: their laki progress on the tab
  railLabels?: boolean // the rail's words under its icons (unset: on)
  sideStyle?: SideStyle // the sidebar's rows
}

export type AppInfo = { id: string; name: string; browser?: boolean } // somewhere a folder can open; a browser: only a file


const EXAMPLE_TEMPLATE: Template = {
  name: 'fix',
  text: 'Fix this in {{project}}: {{prompt}}\n\nFind the cause first. Write a test that fails before the fix and passes after it, run the tests, then sum up what changed.',
}

// the PR switches' prompts (Settings › Pull requests): the status bar's names
const PR_KINDS: [FixWhat, string, string][] = [
  ['ci', 'Fix CI', 'the failing checks and the end of their logs go after it'],
  ['review', 'Review', 'the open review threads go after it'],
  ['conflict', 'Fix conflicts', ''],
]

// the webhook's formats (Settings › Notifications webhook): id, name, an example URL
const FORMATS: [NonNullable<Webhook['format']>, string, string][] = [
  ['ntfy', 'ntfy', 'https://ntfy.sh/a-topic-only-you-know'],
  ['slack', 'Slack', 'https://hooks.slack.com/services/…'],
  ['telegram', 'Telegram', 'https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>'],
  ['json', 'Generic JSON', 'https://example.com/hook'],
]

function WebhookSection({ w, onChange, test }: { w: Webhook; onChange: (w: Webhook) => void; test?: (w: Webhook) => Promise<unknown> }) {
  const [said, setSaid] = useState('') // the last Send test's outcome
  const format = w.format ?? 'ntfy'
  let bad = '' // the daemon's own check, as you type
  try {
    if (w.url?.trim()) webhookUrl(w.url)
  } catch (e) {
    bad = (e as Error).message
  }
  return (
    <>
      <h2>Notifications webhook</h2>
      <p className="muted small">
        Pushes to your phone when an agent waits for you or finishes, posted to this URL and nowhere else. ntfy: a topic's URL, which the ntfy app
        subscribes to; Slack: an incoming webhook; Telegram: your bot's whole sendMessage URL, chat_id included; generic JSON gets{' '}
        <code>{'{event, workspace, tab, agent, message, ts}'}</code>. Muted workspaces and tabs don't push.
      </p>
      <Group title="Where to">
      <div className="grid2">
        <label>
          Format
          <select value={format} onChange={e => onChange({ ...w, format: e.target.value as Webhook['format'] })}>
            {FORMATS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        URL
        <input className="mono" value={w.url ?? ''} placeholder={FORMATS.find(f => f[0] === format)?.[2]} spellCheck={false} onChange={e => onChange({ ...w, url: e.target.value })} />
      </label>
      {bad && <p className="muted small">{bad}</p>}
      </Group>
      <Group title="When">
      <div className="setting-box">
        <Switch className="switch-row" on={w.waiting !== false} onChange={v => onChange({ ...w, waiting: v })}>
          <Says title="Waiting for you" hint="A permission prompt or a question, with what it asks; once per wait" />
        </Switch>
        <Switch className="switch-row" on={w.done === true} onChange={v => onChange({ ...w, done: v })}>
          <Says title="Finished" hint="The end of a turn, with its last question if it asks one" />
        </Switch>
      </div>
      </Group>
      <Group title="Answers" hint="A waiting agent's choices always go as text. With this on, Telegram and ntfy get a button per choice (ntfy: the first 3)">
      <div className="setting-box">
        <Switch
          className="switch-row"
          on={!!w.answer}
          onChange={v => onChange({ ...w, answer: v, replyTopic: w.replyTopic || (v ? [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14) : undefined) })}
        >
          <Says
            title="Answer from the phone"
            hint={`A tap picks that choice in the agent's menu, as a key press here would: it can allow a command or an edit. Laki listens only while a pushed question waits (every 5 s, a day at most) and only while the same menu is on screen. ${format === 'telegram' ? "Telegram: taps from your bot's chat only." : format === 'ntfy' ? 'ntfy: taps come back on a reply topic; anyone who knows your topic could tap, so keep it hard to guess.' : 'Slack and JSON: the choices as text only.'}`}
          />
        </Switch>
        {w.answer && format === 'ntfy' && w.replyTopic && URL.canParse(w.url?.trim() ?? '') && (
          <p className="muted small">
            Reply topic: <code>{(u => `${u.origin}${u.pathname.replace(/\/+$/, '')}-${w.replyTopic}`)(new URL(w.url!.trim()))}</code>
          </p>
        )}
      </div>
      </Group>
      {test && (
        <div className="row-buttons">
          <button type="button" disabled={!w.url?.trim()} onClick={() => (setSaid('Sending…'), test(w).then(() => setSaid('Sent: check your phone'), e => setSaid(`Didn't go: ${e.message}`)))}>
            Send test
          </button>
          {said && <span className="muted small">{said}</span>}
        </div>
      )}
    </>
  )
}

// Settings › AI: Laki's own AI (daemon/ai.ts, the AI page): on, how it runs, the OpenRouter key (a file only you can
// read: sent once, never shown again), each backend's model, the steps an ask may take, and what it cost
export type AiApi = { state: () => Promise<{ key: boolean; totals: AiTotals }>; key: (key: string) => Promise<{ key: boolean }>; open: () => void }
const AI_HOW: [AiBackend, string][] = [
  ['openrouter', 'Any model OpenRouter has, paid per token with your API key'],
  ['claude', 'Claude Code in the background (claude -p), on your Claude plan or its API key'],
  ['codex', 'Codex in the background (codex exec), on your ChatGPT plan'],
]
// presets: Agent presets of claude or codex, each a backend of its own (its env: an account of its own)
function AiSection({ api, ai, presets, onChange }: { api: AiApi; ai: AiSettings; presets: Preset[]; onChange: (ai: AiSettings) => void }) {
  const [st, setSt] = useState<{ key: boolean; totals: AiTotals }>()
  const [key, setKey] = useState('')
  const [said, setSaid] = useState('')
  useEffect(() => void api.state().then(setSt, () => {}), [])
  const backend = ai.backend ?? 'openrouter'
  // the agents' presets, but the plain ones (claude, codex as they are: the options above them)
  const mine = presets.filter(p => (p.agent === 'claude' || p.agent === 'codex') && (p.name !== p.agent || Object.keys(p.env ?? {}).length))
  const preset = backend !== 'openrouter' ? mine.find(p => p.name === ai.preset && p.agent === backend) : undefined
  const pick = (v: string) => {
    const p = v.startsWith('preset:') ? mine.find(x => x.name === v.slice(7)) : undefined
    onChange({ ...ai, backend: (p?.agent ?? v) as AiBackend, preset: p?.name })
  }
  const saveKey = (k: string) => api.key(k).then(r => (setSt(x => x && { ...x, key: r.key }), setKey(''), setSaid(r.key ? 'Saved' : 'Removed')), e => setSaid(e.message))
  const sum = (k: 'today' | 'month', label: string) => (
    <div>
      <b>{money(st?.totals[k].cost ?? 0)}</b>
      <span>
        {label} · {st?.totals[k].calls ?? 0} asks · {tokens((st?.totals[k].in ?? 0) + (st?.totals[k].out ?? 0))} tokens
      </span>
    </div>
  )
  return (
    <>
      <h2>AI</h2>
      <p className="muted small">
        Laki's own assistant: ask it, in words, to start workspaces, review PRs from a screenshot, send prompts to your agents or tell you what they're
        doing. It works Laki through the same tools as <code>laki mcp</code>, only when you ask, and never archives or deletes workspaces, ships or merges. Optional:
        off until you turn it on.
      </p>
      <Group title="Laki AI">
        <div className="setting-box">
          <Switch className="switch-row" on={!!ai.on} onChange={on => onChange({ ...ai, on })}>
            <Says title="Turn on Laki AI" hint="The AI page (the rail's AI, ⌘K) and laki ai in the terminal" />
          </Switch>
          <Switch className="switch-row" on={ai.skill !== false} onChange={skill => onChange({ ...ai, skill })}>
            <Says
              title="Laki's skill"
              hint="More of Laki for it: your open PRs and others' in your repos, projects' notes and memory, renaming and pinning, shells, your actions and prompt templates, to-dos. It asks you with options when unsure, and removes a memory item, task, tab or to-do only when you press Yes"
            />
          </Switch>
        </div>
      </Group>
      <Group title="Your instructions" hint="Added to Laki AI's instructions at every ask: who you are, how you work, what it should know. It can't lift what Laki AI may not do">
        <textarea rows={5} maxLength={AI_CONTEXT_MAX} value={ai.context ?? ''} placeholder={'I review PRs in the morning. Name new workspaces in kebab case.\nOur staging is on fly.io.'} aria-label="Your instructions for Laki AI" onChange={e => onChange({ ...ai, context: e.target.value || undefined })} />
      </Group>
      <Group title="Runs with">
        <div className="grid2">
          <label>
            Backend
            <select value={preset ? `preset:${preset.name}` : backend} onChange={e => pick(e.target.value)}>
              {AI_HOW.map(([id]) => (
                <option key={id} value={id}>
                  {BACKENDS[id]}
                </option>
              ))}
              {mine.length > 0 && (
                <optgroup label="Your agent presets">
                  {mine.map(p => (
                    <option key={p.name} value={`preset:${p.name}`}>
                      {p.name} · {BACKENDS[p.agent as AiBackend]}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        <p className="muted small">
          {preset
            ? `Your preset ${preset.name}: ${BACKENDS[backend]} with its env${Object.keys(preset.env ?? {}).length ? ` (${Object.keys(preset.env!).join(', ')})` : ''}, for an account of its own. Its args are for a tab, not used here.`
            : AI_HOW.find(x => x[0] === backend)?.[1]}
          {backend !== 'openrouter' && !preset && ' Another account (CLAUDE_CONFIG_DIR, CODEX_HOME): make an agent preset with that env, then pick it here.'}
        </p>
        <label>
          Model
          <input
            className="mono"
            value={ai.models?.[backend] ?? ''}
            placeholder={backend === 'openrouter' ? AI_MODEL : backend === 'claude' ? 'its default: sonnet, opus, haiku…' : 'its default: gpt-5.6-sol…'}
            spellCheck={false}
            onChange={e => onChange({ ...ai, models: { ...ai.models, [backend]: e.target.value.trim() || undefined } })}
          />
        </label>
        {backend === 'openrouter' && (
          <p className="muted small">
            A model id from openrouter.ai/models, one that can call tools (and read images, for screenshots).
          </p>
        )}
      </Group>
      {backend === 'openrouter' && (
        <Group title="OpenRouter API key" hint="Kept in a file only you can read, in Laki's data folder: never in its settings, never shown again">
          <div className="row-buttons">
            <input
              className="mono grow"
              type="password"
              autoComplete="off"
              value={key}
              placeholder={st?.key ? '•••••••• saved: paste another to replace it' : 'sk-or-v1-…'}
              spellCheck={false}
              onChange={e => (setKey(e.target.value), setSaid(''))}
              onKeyDown={e => e.key === 'Enter' && key.trim() && saveKey(key)}
            />
            <button type="button" className="primary" disabled={!key.trim()} onClick={() => saveKey(key)}>
              Save
            </button>
            {st?.key && (
              <button type="button" onClick={() => saveKey('')}>
                Remove
              </button>
            )}
          </div>
          {said && <p className="muted small">{said}</p>}
        </Group>
      )}
      <Group title="Steps" hint="OpenRouter: how many rounds of tool calls one ask may take before it stops, a guard against a model that loops (claude -p and codex exec keep their own)">
        <label>
          Rounds at most
          <input type="number" min={1} max={100} placeholder={String(AI_STEPS)} value={ai.steps ?? ''} onChange={e => onChange({ ...ai, steps: e.target.value ? Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 1)) : undefined })} />
        </label>
      </Group>
      <Group title="Spending" hint="Every ask, its tokens and cost, is on the AI page. OpenRouter's cost is its own; claude -p's is Claude Code's estimate; codex exec's is your plan">
        <div className="setting-box">
          <Switch className="switch-row" on={!ai.hideCost} onChange={v => onChange({ ...ai, hideCost: !v })}>
            <Says title="Show costs ($)" hint="On the AI page: today's spend, each call's cost and the totals. Off: asks and tokens only" />
          </Switch>
        </div>
        <div className="sched-stats ai-totals">
          {sum('today', 'today')}
          {sum('month', 'this month')}
        </div>
        <div className="row-buttons">
          <button type="button" onClick={api.open}>
            Open the AI page
          </button>
        </div>
      </Group>
    </>
  )
}

const NOTIFY_KINDS: readonly (readonly [NotifyKind, string, string])[] = [
  ['waiting', 'Waiting for you', 'A permission prompt, or CI that keeps failing'],
  ['done', 'Finished', 'The end of a turn, with its last words'],
  ['limit', 'Usage limit', 'An agent hit its plan limit'],
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

const SCRIPTS = [
  { k: 'setup', label: 'Setup', hint: 'Runs in each new worktree, in a setup tab; agents and Run wait for it. $LAKI_PROJECT_PATH is the repo itself.', eg: 'npm install\ncp "$LAKI_PROJECT_PATH/.env" .env' },
  { k: 'teardown', label: 'Teardown', hint: 'Runs when a worktree workspace is deleted or archived, for a minute at most (never in the project’s own folder).', eg: 'docker compose down' },
  { k: 'run', label: 'Run', hint: 'The Run button: starts it in a run tab, e.g. a dev server on $PORT.', eg: 'npm run dev -- --port $PORT' },
] as const
export type Scripts = { setup?: string; teardown?: string; run?: string }

// a project's lifecycle scripts: one at a time, any number of lines; Import fills one from a file
export function ScriptsField({ value, file = {}, git = true, tab, onChange }: { value: Scripts; file?: Scripts; git?: boolean; tab?: keyof Scripts; onChange: (s: Scripts) => void }) {
  const tabs = SCRIPTS.filter(t => git || t.k !== 'setup')
  const [k, setK] = useState<keyof Scripts>(tab ?? tabs[0].k)
  const t = tabs.find(x => x.k === k) ?? tabs[0]
  return (
    <div className="scripts">
      <div className="scripts-tabs">
        {tabs.map(x => (
          <button key={x.k} type="button" className={x.k === t.k ? 'on' : ''} onClick={() => setK(x.k)}>
            {x.label}
            {(value[x.k] || file[x.k]) && <span className="scripts-dot" />}
          </button>
        ))}
      </div>
      <div className="scripts-box">
        <textarea
          className="mono"
          rows={7}
          spellCheck={false}
          value={value[t.k] ?? ''}
          placeholder={file[t.k] ? `${file[t.k]}\n\n(the repo's .laki.json)` : t.eg}
          onChange={e => onChange({ ...value, [t.k]: e.target.value })}
        />
        <label className="scripts-import" data-tip="Fill it from a script file">
          <Icon name="import" /> Import
          <input
            type="file"
            hidden
            onChange={async e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onChange({ ...value, [t.k]: (await f.text()).replace(/^#!.*\n/, '').trim() })
            }}
          />
        </label>
      </div>
      <div className="muted small">{t.hint}</div>
    </div>
  )
}

// an env object as KEY=value lines, and back (lines without = and # comments are skipped)
export const envText = (e?: Record<string, string>) =>
  Object.entries(e ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
export const parseEnv = (t: string): Record<string, string> =>
  Object.fromEntries(
    t
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )

// a textarea of KEY=value lines; keeps what you type (a line without = yet) while the value is parsed
export function EnvField({ value, onChange, placeholder = 'KEY=value, one per line' }: { value?: Record<string, string>; onChange: (e: Record<string, string>) => void; placeholder?: string }) {
  const [text, setText] = useState(() => envText(value))
  return (
    <textarea
      className="mono"
      rows={text ? Math.min(8, text.split('\n').length + 1) : 1 /* empty: one line, it grows as you type */}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={e => {
        setText(e.target.value)
        onChange(parseEnv(e.target.value))
      }}
    />
  )
}

export type ProjectConfig = Scripts & { expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod } // expose: emails, *@domains; worktrees: where new ones go; pr: what the app may do to its PRs

const PR_PERMS: [keyof PRAllow, string, string][] = [
  ['merge', 'Merge', 'Merge ▾ in the PR panel and the status bar\'s PR menu: squash, merge commit or rebase'],
  ['land', 'Merge when green', 'A switch per workspace: Laki merges the PR once every check passes, it has no conflicts and is approved if it must be. Off unless turned on here'],
  ['approve', 'Approve', 'An approving review, as you'],
  ['close', 'Close', 'Closes a PR without merging'],
]

// a folder typed (~ is home) or picked (the app's folder picker; a browser has none)
function FolderField({ value, placeholder, label, onChange }: { value?: string; placeholder: string; label: string; onChange: (v: string) => void }) {
  return (
    <span className="row-buttons">
      <input className="grow mono" value={value ?? ''} placeholder={placeholder} aria-label={label} spellCheck={false} onChange={e => onChange(e.target.value)} />
      {bridge && (
        <button type="button" onClick={() => void bridge!.pickFolder().then(f => f && onChange(f))}>
          Choose…
        </button>
      )}
    </span>
  )
}
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; host?: string; config?: ProjectConfig; notes?: string }

// a project's page: name, scripts, env; saved as you type, like the rest
const TARGETS: [RunAction['target'], string][] = [['any', 'Any agent'], ...AGENTS.map(a => [a, AGENT_NAMES[a]] as [Agent, string]), ['shell', 'Terminal']]
const ACTION_EG: Record<RunAction['target'], string> = {
  any: 'Review the changes and fix what you find',
  claude: 'Run a code review twice and fix what it finds',
  codex: 'Run $code-review and fix the findings',
  gemini: 'Review the changes and fix what you find',
  grok: 'Review the changes and fix what you find',
  opencode: 'Review the changes and fix what you find',
  shell: 'bundle exec rails db:migrate',
}
// a preset's args, for example
const ARGS_EG: Record<Agent, string> = {
  claude: '--model opus --permission-mode acceptEdits',
  codex: '--model gpt-5 --full-auto',
  gemini: '--model gemini-2.5-pro --approval-mode auto_edit',
  grok: '--model grok-4.5 --permission-mode acceptEdits',
  opencode: '--model anthropic/claude-sonnet-4-5 --agent build',
}

// actions (Settings › Actions, a project's): a name, who it's for, and the prompt or command
// prompt templates (Settings › Prompt templates, and a project's own): a name and a text with {{prompt}}
// what a template and a preset's command line can use, shown as chips under the field
const TEMPLATE_VARS: [string, string][] = [
  ['{{prompt}}', 'what you type on the new-workspace page (without it, the typed text goes after the template)'],
  ['{{project}}', "the project's name"],
  ['{{base}}', 'the base branch'],
  ['{{pr}}', 'the PR: a PR link in the prompt, or a prompt of only #123'],
  ['{{DD-MM-YY HH:MM}}', "now: any of YYYY YY MMMM MMM MM DD D dddd ddd HH H hh mm ss A, in any order (MM after an hour is minutes)"],
]
const ENV_VARS: [string, string][] = [
  ['$PORT', "the workspace's port, for a dev server"],
  ['$LAKI_WORKSPACE', "the workspace's id"],
  ['$LAKI_TAB', "the tab's id"],
  ['$LAKI_PROJECT_PATH', 'the repo itself, not the worktree'],
  ['$LAKI_STORAGE_FOLDER', "the workspace's storage folder: files kept for you"],
]

// a click puts the variable in the field just before the chips, at its cursor
function VarChips({ vars, value, onChange }: { vars: [string, string][]; value: string; onChange: (v: string) => void }) {
  const put = (el: Element | null | undefined, v: string) => {
    const f = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
    const a = f?.selectionStart ?? value.length
    const b = f?.selectionEnd ?? a
    const text = /[^\s("'=/:]$/.test(value.slice(0, a)) ? ` ${v}` : v // a word apart from the one before it
    onChange(value.slice(0, a) + text + value.slice(b))
    requestAnimationFrame(() => f && (f.focus(), f.setSelectionRange(a + text.length, a + text.length)))
  }
  return (
    <div className="vars">
      <span className="muted small">Variables</span>
      {vars.map(([v, tip]) => (
        <button type="button" key={v} className="var mono" data-tip={tip} onMouseDown={e => e.preventDefault()} onClick={e => put(e.currentTarget.parentElement?.previousElementSibling, v)}>
          {v}
        </button>
      ))}
    </div>
  )
}

function TemplatesField({ value = [], onChange }: { value?: Template[]; onChange: (v: Template[]) => void }) {
  const keys = useRef<number[]>([]) // like ActionsField's
  while (keys.current.length < value.length) keys.current.push(Math.random())
  const setAt = (i: number, t: Partial<Template>) => onChange(value.map((x, j) => (j === i ? { ...x, ...t } : x)))
  const drop = (i: number) => (keys.current.splice(i, 1), onChange(value.filter((_, j) => j !== i)))
  return (
    <>
      {value.map((t, i) => (
        <div key={keys.current[i]} className="preset">
          <div className="row">
            <input value={t.name} placeholder="name" onChange={e => setAt(i, { name: e.target.value })} />
            <IconButton icon="trash" title="Remove template" onClick={() => drop(i)} />
          </div>
          <textarea className="mono" rows={5} spellCheck={false} value={t.text} placeholder="Fix this: {{prompt}}" onChange={e => setAt(i, { text: e.target.value })} />
          <VarChips vars={TEMPLATE_VARS} value={t.text} onChange={text => setAt(i, { text })} />
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => onChange([...value, value.length ? { name: `template-${value.length + 1}`, text: '{{prompt}}' } : EXAMPLE_TEMPLATE])}>
          <Icon name="plus" /> Add template
        </button>
      </div>
    </>
  )
}

// taken: the other lists' slugs (the daemon keeps them unique everywhere: one taken elsewhere gets a -2 there)
function ActionsField({ value = [], onChange, taken = [] }: { value?: RunAction[]; onChange: (v: RunAction[]) => void; taken?: (string | undefined)[] }) {
  const keys = useRef<number[]>([]) // like keys, for the cards
  while (keys.current.length < value.length) keys.current.push(Math.random())
  const fresh = useRef(new Set<number>()) // cards made here: the slug follows the name until it's typed
  const [only, setOnly] = useState<RunAction['target'] | ''>('') // the filter: one target's, or all
  const setAt = (i: number, a: Partial<RunAction>) => onChange(value.map((x, j) => (j === i ? { ...x, ...a } : x)))
  const others = (i: number) => new Set([...taken, ...value.filter((_, j) => j !== i).map(a => a.slug)].filter((x): x is string => !!x))
  const named = (i: number, name: string) => setAt(i, fresh.current.has(keys.current[i]) ? { name, slug: name.trim() ? actionSlug(name, others(i)) : undefined } : { name })
  const drop = (i: number) => (keys.current.splice(i, 1), onChange(value.filter((_, j) => j !== i)))
  // a copy right under it, for another agent: the filter would hide it, so it goes
  const clone = (i: number) => {
    const k = Math.random()
    keys.current.splice(i + 1, 0, k)
    fresh.current.add(k)
    setOnly('')
    onChange([...value.slice(0, i + 1), { ...value[i], slug: actionSlug(value[i].slug || value[i].name, new Set([...taken, ...value.map(a => a.slug)].filter((x): x is string => !!x))) }, ...value.slice(i + 1)])
  }
  const used = TARGETS.filter(([v]) => value.some(a => a.target === v))
  const show = used.length > 1 && used.some(([v]) => v === only) ? only : '' // the last of a target gone: all again
  return (
    <>
      {used.length > 1 && (
        <div className="actions-only">
          <span className="muted small">Show</span>
          <select value={show} aria-label="Show actions for" onChange={e => setOnly(e.target.value as RunAction['target'] | '')}>
            <option value="">All</option>
            {used.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.map((a, i) =>
        show && a.target !== show ? null : (
          <div key={keys.current[i]} className="preset">
            <div className="row">
              <input value={a.name} placeholder="name, as Run ▾ shows it" onChange={e => named(i, e.target.value)} />
              <select value={a.target} onChange={e => setAt(i, { target: e.target.value as RunAction['target'] })}>
                {TARGETS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <IconButton icon="copy" title="Duplicate (for another agent)" onClick={() => clone(i)} />
              <IconButton icon="trash" title="Remove action" onClick={() => drop(i)} />
            </div>
            <textarea className="mono" rows={2} spellCheck={false} value={a.text} placeholder={ACTION_EG[a.target]} onChange={e => setAt(i, { text: e.target.value })} />
            {a.target !== 'shell' && (
              <label className="action-slug-row muted small">
                Slug
                <input
                  className={`mono action-slug${a.slug && others(i).has(a.slug) ? ' bad' : ''}`}
                  value={a.slug ?? ''}
                  placeholder={actionSlug(a.name, others(i))}
                  aria-label="Slug"
                  spellCheck={false}
                  data-tip={a.slug && others(i).has(a.slug) ? 'Another action has it: this one gets a -2' : 'Its slug, unique: a workflow’s agent block uses it (use: …). Set from the name; type your own'}
                  onChange={e => (fresh.current.delete(keys.current[i]), setAt(i, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || undefined }))}
                />
                <span>a workflow's agent block uses it</span>
              </label>
            )}
          </div>
        ),
      )}
      <div className="row">
        <button type="button" onClick={() => (keys.current.push(Math.random()), fresh.current.add(keys.current[value.length]), onChange([...value, { name: '', target: show || 'claude', text: '' }]))}>
          <Icon name="plus" /> Add action
        </button>
      </div>
    </>
  )
}

export function ProjectSection(p: {
  project: ProjectInfo
  noNotes?: boolean // the project page: its own Notes tab has them
  file?: (id: string) => Promise<ProjectConfig>
  rename?: boolean
  script?: keyof Scripts
  global?: { actions?: RunAction[]; templates?: Template[] } // Settings' own, which go with this project's
  taken?: (string | undefined)[] // the other projects' action slugs (an action's slug is unique everywhere)
  onGlobal?: (sec: 'actions' | 'templates') => void
  onSave: (o: { name?: string; config: ProjectConfig; notes?: string }) => unknown
}) {
  const [name, setName] = useState(p.project.name)
  const [notes, setNotes] = useState(p.project.notes ?? '')
  const notes0 = useRef(notes) // sent only once changed here: the Notes dialog or another client may have saved since
  const [c, setC] = useState<ProjectConfig>(p.project.config ?? {})
  const [file, setFile] = useState<ProjectConfig>({})
  // the lists' note: how many the global ones and these make together (fewer: one here replaces a global one)
  const count = (global: number, own: number, all: number) => `${global} global + ${own} here, ${all} in all`
  const named = (l?: Template[]) => (l ?? []).filter(t => t.name.trim())
  const globalLink = (sec: 'actions' | 'templates', label: string) =>
    p.onGlobal ? (
      <button type="button" className="link" onClick={() => p.onGlobal?.(sec)}>
        {label}
      </button>
    ) : (
      label
    )
  useEffect(() => void p.file?.(p.project.id).then(setFile, () => {}), [p.project.id])
  const first = useRef(true)
  const unsaved = useRef<(() => unknown) | null>(null)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const save = () => {
      const changedHere = notes !== notes0.current
      notes0.current = notes // sent once: a later save of the config leaves the Notes dialog's edits be
      return p.onSave({ name: p.rename && name.trim() ? name.trim() : undefined, config: c, ...(changedHere && { notes }) })
    }
    unsaved.current = save
    const t = setTimeout(() => ((unsaved.current = null), save()), 400)
    return () => clearTimeout(t)
  }, [name, c, notes])
  useEffect(() => () => void unsaved.current?.(), [])
  const badMails = parseMails(c.expose ?? '').filter(m => !MAIL_OK.test(m))
  return (
    <>
      <div className="set-title">
        <h2>{p.project.name}</h2>
        <div className="muted small mono">
          {p.project.path} · {p.project.git ? 'git' : 'folder (no git)'}
        </div>
      </div>
      {p.rename && (
        <Group title="Name" hint="As the sidebar shows it">
          <input value={name} aria-label="Name" onChange={e => setName(e.target.value)} />
        </Group>
      )}
      {!p.noNotes && (
        <Group title="Notes" hint="Markdown, yours: links, how to run it, who to ask. The project's ⋯ › Notes shows them; agents never see them">
          <textarea className="mono notes-field" rows={Math.min(16, Math.max(4, notes.split('\n').length + 1))} value={notes} aria-label="Notes" placeholder="# Links&#10;- Staging: https://…" onChange={e => setNotes(e.target.value)} />
        </Group>
      )}
      {p.project.git && !p.project.host && (
        <Group title="Worktrees" hint="Where this project's new worktrees go (a path relative to the repo, ~, or a full one); empty: Settings › General's folder. Ones made already stay">
          <FolderField value={c.worktrees} label="This project's worktrees" placeholder={`<the worktrees folder>/${p.project.id}`} onChange={v => setC(y => ({ ...y, worktrees: v }))} />
        </Group>
      )}
      {p.project.git && (
        <Group title="Pull requests" hint="What Laki may do to this project's PRs, as you on GitHub. Each asks first; merge when green asks as it's turned on for a workspace">
          <div className="setting-box">
            {PR_PERMS.map(([k, title, hint]) => (
              <Switch key={k} className="switch-row" on={prAllows(c, k)} onChange={v => setC(y => ({ ...y, pr: { ...y.pr, [k]: v } }))}>
                <Says title={title} hint={hint} />
              </Switch>
            ))}
          </div>
        </Group>
      )}
      <Group title="Scripts" hint="For workspace setup, teardown and the Run button; empty: the repo's .laki.json">
        <ScriptsField value={c} file={file} git={p.project.git} tab={p.script} onChange={x => setC(y => ({ ...y, ...x }))} />
      </Group>
      <Group title="Env" hint={`For every tab, setup and teardown${file.env && Object.keys(file.env).length ? ` · .laki.json has ${Object.keys(file.env).join(', ')}` : ''}`}>
        <EnvField value={c.env} onChange={env => setC(y => ({ ...y, env }))} />
      </Group>
      <Group title="Expose to the world" hint="Who can open a tunnel: the popup starts from it every time; emails and *@domains, or empty for anyone with the link">
        <input value={c.expose ?? ''} aria-label="Expose to the world" placeholder={file.expose ? `${file.expose} (.laki.json)` : 'anyone with the link'} onChange={e => setC(y => ({ ...y, expose: e.target.value }))} />
        {badMails.length > 0 && <span className="field-err">Not an address or *@domain: {badMails.join(', ')}</span>}
      </Group>
      <Group title="Actions">
        <Scope tag="This project">
          Only for this project. Run ▾ in its workspaces shows the global actions ({globalLink('actions', 'Settings › Actions')}) and these together:{' '}
          {count(mergeActions(p.global?.actions).length, mergeActions([], c.actions).length, mergeActions(p.global?.actions, c.actions).length)}. One here with
          a global one's name and kind replaces it.
        </Scope>
        <ActionsField value={c.actions} taken={[...(p.global?.actions?.map(a => a.slug) ?? []), ...(p.taken ?? [])]} onChange={actions => setC(y => ({ ...y, actions }))} />
      </Group>
      <Group title="Prompt templates">
        <Scope tag="This project">
          Only for this project. Its new workspaces show these first, then the global templates ({globalLink('templates', 'Settings › Prompt templates')}):{' '}
          {count(named(p.global?.templates).length, named(c.templates).length, named(templatesFor(p.global?.templates, c.templates)).length)}. One here with a
          global one's name replaces it.
        </Scope>
        <TemplatesField value={c.templates} onChange={templates => setC(y => ({ ...y, templates }))} />
      </Group>
    </>
  )
}

const WEIGHTS: Record<string, string> = { 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' }
const CONTRAST: Record<number, string> = { 1: "the theme's colors", 3: 'low (3:1)', 4.5: 'medium (4.5:1)', 7: 'high (7:1)' }

// Find a setting (the nav's search box): each setting's title as the page writes it, its section, words it goes by.
// A result opens the section and shows the first label, row or heading starting with the title. Add new settings here.
const FIND: [string, string, string?][] = [
  ['general', 'New workspaces start', 'default agent preset'],
  ['git', 'Branch prefix', 'git worktree'],
  ['git', 'Sync the base branch', 'fetch pull origin main master up to date latest fast-forward worktree'],
  ['general', 'macOS notifications', 'notify waiting done limit mute'],
  ['general', 'Sound', 'notification'],
  ['webhook', 'Notifications webhook', 'phone push ntfy slack telegram json notify waiting done'],
  ['notes', 'Release notes', "what's new changelog version changes added recently"],
  ['ai', 'Turn on Laki AI', 'assistant orchestrate llm chat openrouter'],
  ['ai', 'Runs with', 'backend openrouter claude -p codex exec model'],
  ['ai', 'OpenRouter API key', 'token secret ai'],
  ['ai', 'Spending', 'cost usage tokens ai today month'],
  ['ai', "Laki's skill", 'tools prs notes memory shells actions templates ask options remove'],
  ['ai', 'Show costs ($)', 'hide cost money dollars price spend'],
  ['ai', 'Your instructions', 'custom context system prompt my own rules'],
  ['webhook', 'Send test', 'webhook phone push'],
  ['webhook', 'Answer from the phone', 'buttons reply tap telegram ntfy choices menu permission allow'],
  ['appearance', 'Menu bar item', 'tray status count waiting needs you'],
  ['appearance', 'Fun button', 'meme reddit smiley break joke'],
  ['appearance', 'Pull requests in the sidebar', 'pr github icon'],
  ['appearance', 'Pull request marks', 'approved approval check double eyes commented review me sidebar'],
  ['appearance', 'Turn timers', 'elapsed time'],
  ['git', 'Diff size in the sidebar', 'lines added removed changes stat'],
  ['appearance', 'Claude Code plan limits', 'usage ring 5-hour weekly'],
  ['appearance', 'Codex plan limits', 'usage ring 5-hour weekly'],
  ['general', 'Environment', 'env variables'],
  ['general', 'Move to another Mac', 'export import backup file'],
  ['appearance', 'Interface font', 'ui type'],
  ['appearance', 'Accent color', 'colour highlight'],
  ['appearance', 'Corners', 'radius rounded square'],
  ['appearance', 'Settings & Help size', 'zoom text font size small bigger larger readable page'],
  ['appearance', 'Tabs', 'tab bar position location top bottom left right vertical'],
  ['appearance', 'Project names', 'sidebar font case letter spacing size weight'],
  ['appearance', 'Rail', 'layout rail list slack kinds projects board schedule terminals browsers settings icons labels icons only'],
  ['appearance', 'Sidebar', 'status guide line divider indent row height dotted dashed text size icon size avatar github style compact extended cards'],
  ['appearance', 'Button labels', 'sidebar schedule scheduled board settings video timer words'],
  ['appearance', 'Glass', 'transparent see-through blur vibrancy'],
  ['appearance', 'Sidebar see-through', 'transparent translucent sidebar rail blur vibrancy desktop'],
  ['appearance', 'Glow', 'glass colors'],
  ['appearance', 'Terminals use', 'theme themes colors palette dark light'],
  ['appearance', 'Favorites', 'theme star starred favorite'],
  ['general', 'Storage', 'storage folder files artifacts LAKI_STORAGE_FOLDER keep deleted'],
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
  ['open', 'Default', 'editor cursor vs code zed windsurf antigravity sublime jetbrains xcode open in'],
  ['open', 'Custom command', 'editor'],
  ['presets', 'Agent presets', 'claude codex gemini args env model'],
  ['pr', 'Check pull requests every', 'pr github scan frequency interval minutes how often'],
  ['git', 'Archive workspace when its PR merges', 'merged auto archive clean cleanup'],
  ['pr', 'Tries in a row', 'pr fix ci conflicts limit attempts how many times'],
  ['pr', 'Fix CI', 'pr prompt failing checks auto'],
  ['pr', 'Review', 'pr prompt comments auto'],
  ['pr', 'Fix conflicts', 'pr prompt merge auto'],
  ['templates', 'Prompt templates', 'prompt'],
  ['actions', 'Actions', 'run menu prompt command'],
  ['skill', 'Agent skill', 'mcp server laki cli'],
  ['skill', 'Extension creator', 'agent skill widgets laki-widget make extension ai'],
  ['widgets', 'Extensions', 'sidebar widgets plugins folder reload fetch schedule delete remove uninstall top bar status bar where place network internet https'],
  ['widgets', 'More folders', 'extensions widgets'],
  ['general', 'Progress on tabs', 'percent estimate completion laki progress LAKI_PROGRESS'],
  ['general', 'Timers', 'timer countdown ends alarm sound dialog modal notification'],
  ['git', 'Folder for worktrees', 'folder directory location path where worktree workspaces disk'],
  ['general', 'Close tabs without asking', 'confirm confirmation dialog close tab running process stop ask'],
  ['general', 'Development mode', 'debug logs log events troubleshoot pr checks auto fix'],
  ['general', 'Specs & Brainstorms', 'experimental spec specs brainstorm requirements notion ideas prototypes diagrams mind map'],
  ['general', 'Workflows', 'experimental workflow flow flows blocks graph automation pipeline runs decisions'],
  ['general', 'Bird view', 'experimental overview all sessions screens preview eye running'],
  ['appearance', 'Dock icon', 'app icon dock logo picture dawn terminal glacier bubbles neon'],
  ['appearance', 'Floating bubbles', 'floater drop bubble overlay glow gradient arc still style while working recent sessions idle how many icons card hover new session plus menu stack actions microphone voice say it dictation record screenshot area screen'],
  ['general', 'Creation log', 'new workspace create logs what ran command development'],
  ['widgets', 'Fetch only', 'working hours night weekends sync schedule when'],
  ['remote', 'Remote access', 'phone email cloudflare tunnel qr'],
  ['resources', 'Memory', 'ram cpu usage processes monitor activity heavy slow'],
  ['resources', 'Sleep idle agents after', 'memory ram free idle suspend hibernate'],
]

// the nav's sections, under a head each (group): the app, its agents, what it connects to
const SECTIONS: { id: string; label: string; icon: IconName; group: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', group: 'Laki' },
  { id: 'git', label: 'Git & worktrees', icon: 'fork', group: 'Laki' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Laki' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', group: 'Laki' },
  { id: 'resources', label: 'Resources', icon: 'memory', group: 'Laki' },
  { id: 'notes', label: 'Release notes', icon: 'file', group: 'Laki' },
  { id: 'presets', label: 'Agent presets', icon: 'agent', group: 'Agents' },
  { id: 'templates', label: 'Prompt templates', icon: 'pencil', group: 'Agents' },
  { id: 'actions', label: 'Actions', icon: 'run', group: 'Agents' },
  { id: 'pr', label: 'Pull requests', icon: 'pr', group: 'Agents' },
  { id: 'skill', label: 'Agent skill', icon: 'import', group: 'Agents' },
  { id: 'ai', label: 'AI', icon: 'ai', group: 'Agents' },
  { id: 'open', label: 'Open in', icon: 'code', group: 'Connect' },
  { id: 'webhook', label: 'Phone pushes', icon: 'bell', group: 'Connect' },
  { id: 'widgets', label: 'Extensions', icon: 'panel', group: 'Connect' },
  { id: 'remote', label: 'Remote access', icon: 'globe', group: 'Connect' },
]
export const isSection = (id: string) => SECTIONS.some(x => x.id === id)

// Resources: what Laki and each tab use now (the daemon's ps, every 3 s while it's open), and idle agents put to sleep
// (settings.sleepAfter). macOS counts every process Laki starts as Laki's
export type ResourcesApi = {
  load: () => Promise<Resources>
  tabs: TabView[]
  wsName: (id: string) => string
  sleep: (tab: string) => Promise<unknown>
  open: (tab: string) => void
  procs?: () => Promise<{ pid: number; name: string; stop?: string }[]> // the app's: what each process holds (main's)
  stop?: (what: string) => void // free one: the video, a widget, the preview, the bubbles, an agent browser
  stopOther?: (key: string) => Promise<unknown> // end one the daemon runs: Laki AI's ask, a tunnel, remote access
  widgetName: (id: string) => string
}
const SLEEP: [number, string][] = [[0, 'Never'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours']]
const KIND: Record<string, string> = { main: 'Laki', renderer: 'window', 'gpu-process': 'GPU', network: 'network', daemon: 'daemon' }
// KB as MB, or GB from 1 GB
const size = (kb: number) => (kb >= 1 << 20 ? `${(kb / (1 << 20)).toFixed(2)} GB` : `${Math.round(kb / 1024)} MB`)
const total = (ps: { rss: number }[]) => ps.reduce((n, p) => n + p.rss, 0)
// a command short: each absolute path as its last part, a flag's name kept (the whole one is its tooltip)
const short = (cmd: string) => cmd.replace(/(^|[\s=])\/(?:[^\s/]+\/)+(?=[^\s/])/g, '$1').slice(0, 90)

function Procs({ ps }: { ps: (ProcUse & { kind?: string })[] }) {
  return (
    <div className="res-procs">
      {[...ps].sort((a, b) => b.rss - a.rss).map(p => (
        <div key={p.pid} data-tip={`${p.pid}: ${p.cmd}`}>
          <span className="mono">{p.kind ? (KIND[p.kind] ?? p.kind) : short(p.cmd)}</span>
          <span className="num">{size(p.rss)}</span>
        </div>
      ))}
    </div>
  )
}

function ResourcesSection({ api, sleepAfter, onSleepAfter }: { api: ResourcesApi; sleepAfter: number; onSleepAfter: (min: number) => void }) {
  const [r, setR] = useState<Resources | null>(null)
  const [named, setNamed] = useState<{ pid: number; name: string; stop?: string }[]>([])
  const [open, setOpen] = useState<string | null>(null) // the row whose processes show
  const [said, setSaid] = useState('') // a Sleep that was refused
  useEffect(() => {
    let on = true
    const load = () => !document.hidden && Promise.all([api.load(), api.procs?.().catch(() => []) ?? []]).then(([x, n]) => on && (setR(x), setNamed(n)), () => {}) // not while the window is hidden
    load()
    const t = setInterval(load, 3000)
    return () => ((on = false), clearInterval(t))
  }, [])
  const tabOf = (id: string) => api.tabs.find(t => t.id === id)
  // the app's processes that hold something of their own (main's names, by pid): a row each, with Stop; JS widgets
  // share one (one site), template widgets and the memes are drawn in the window's
  const word = (n: string) => (n.startsWith('widget:') ? api.widgetName(n.slice(7)) : n.startsWith('browser:') ? `Agent browser · ${api.wsName(n.slice(8))}` : n)
  const held = (r?.app ?? []).flatMap(p => {
    const ns = named.filter(x => x.pid === p.pid && x.name !== 'The window')
    if (!ns.length) return []
    const widgets = [...new Set(ns.filter(x => x.name.startsWith('widget:')).map(x => word(x.name)))] // the grid's and a full view's: one
    const name = [...(widgets.length ? [`${widgets.length > 1 ? 'Extensions' : 'Extension'} · ${widgets.join(', ')}`] : []), ...new Set(ns.filter(x => !x.name.startsWith('widget:')).map(x => word(x.name)))].join(' · ')
    return [{ ...p, name, stops: [...new Set(ns.flatMap(x => (x.stop ? [x.stop] : [])))] }]
  })
  const app = r ? [...r.app.filter(p => !held.some(h => h.pid === p.pid)), { ...r.daemon, kind: 'daemon' }] : []
  const own = total(app)
  const live = (r?.tabs ?? []).filter(x => tabOf(x.tab))
  const rows = live.filter(x => !tabOf(x.tab)!.asleep).sort((a, b) => b.rss - a.rss) // an asleep one still exiting: its own row, below
  const others = r?.others ?? [] // what the daemon runs besides tabs: Laki AI, tunnels, remote access, SSH, widgets
  const all = own + total(held) + total(live) + total(others)
  // what the sidebar's Terminals and Browsers hold: shell tabs (anywhere), Browsers pages and their sign-in windows
  const shells = total(live.filter(x => tabOf(x.tab)!.kind === 'shell'))
  const browsers = total(held.filter(p => p.name.includes('Browser: ')))
  const canSleep = (t: TabView) => (t.preset === 'claude' || t.preset === 'codex') && !!t.resumeId && t.status === 'idle'
  const row = (key: string, name: ReactNode, kb: number, cpu: number, acts?: ReactNode) => (
    <div className={`res-row${open === key ? ' open' : ''}`} onClick={() => setOpen(open === key ? null : key)}>
      <Icon name={open === key ? 'chevron' : 'chevronRight'} size={12} />
      <span className="res-name">
        <span>{name}</span>
        <i className="res-bar" style={{ width: `${all ? (kb / all) * 100 : 0}%` }} />
      </span>
      <span className="num muted">{cpu >= 1 ? `${Math.round(cpu)}%` : ''}</span>
      <span className="num">{size(kb)}</span>
      <span className="res-acts" onClick={e => e.stopPropagation()}>
        {acts}
      </span>
    </div>
  )
  return (
    <>
      <h2>Resources</h2>
      <p className="muted small">
        Memory and CPU now, every 3 seconds while this is open. macOS counts every process Laki starts as Laki's: each agent, its MCP servers, the dev
        servers in its tabs, Laki AI's agent, tunnels, remote access, SSH connections and extensions' fetches. An agent grows the longer it runs; sleeping it gives that back. The video, JS extensions, the preview, the floating bubbles,
        an agent browser and the sidebar's browser pages each run in a process of their own: Stop frees one until it's opened again (a browser's: the
        pages you aren't on).
      </p>
      <Group title="Memory">
        {!r ? (
          <p className="muted small">Measuring…</p>
        ) : (
          <>
            <div className="res-total">
              <b>{size(all)}</b>
              <span className="muted">
                Laki itself {size(own + total(held) - browsers)} · agents and tabs {size(total(live) - shells)}
                {shells > 0 && ` · shells ${size(shells)}`}
                {browsers > 0 && ` · browsers ${size(browsers)}`}
                {others.length > 0 && ` · Laki AI and connections ${size(total(others))}`}
              </span>
            </div>
            <div className="res-rows">
              {row('laki', 'Laki itself', own, app.reduce((n, p) => n + p.cpu, 0))}
              {open === 'laki' && <Procs ps={app} />}
              {held.map(p => (
                <div key={p.pid}>
                  {row(
                    `pid:${p.pid}`,
                    p.name,
                    p.rss,
                    p.cpu,
                    !!p.stops.length && api.stop && (
                      <button className="small" data-tip="Frees it now; it comes back when it's opened again (the bubbles: when an agent's state changes)" onClick={() => p.stops.forEach(x => api.stop!(x))}>
                        Stop
                      </button>
                    ),
                  )}
                  {open === `pid:${p.pid}` && <Procs ps={[p]} />}
                </div>
              ))}
              {others.map(o => (
                <div key={o.procs[0]?.pid ?? o.name}>
                  {row(
                    `other:${o.procs[0]?.pid}`,
                    o.name,
                    o.rss,
                    o.cpu,
                    o.stop && api.stopOther && (
                      <button className="small" data-tip={o.stop === 'ai' ? 'Stops its answer' : 'Ends it: the link stops working'} onClick={() => api.stopOther!(o.stop!).then(() => setSaid(''), e => setSaid((e as Error).message))}>
                        Stop
                      </button>
                    ),
                  )}
                  {open === `other:${o.procs[0]?.pid}` && <Procs ps={o.procs} />}
                </div>
              ))}
              {rows.map(x => {
                const t = tabOf(x.tab)!
                return (
                  <div key={x.tab}>
                    {row(
                      x.tab,
                      <>
                        {api.wsName(t.workspace)} <span className="muted">· {t.name}</span>
                      </>,
                      x.rss,
                      x.cpu,
                      <>
                        {canSleep(t) && (
                          <button className="small" data-tip="End its process now: a look, a key or a message resumes the chat" onClick={() => api.sleep(t.id).then(() => setSaid(''), e => setSaid((e as Error).message))}>
                            Sleep
                          </button>
                        )}
                        <button className="small" onClick={() => api.open(t.id)}>
                          Open
                        </button>
                      </>,
                    )}
                    {open === x.tab && <Procs ps={x.procs} />}
                  </div>
                )
              })}
              {api.tabs.filter(t => t.asleep).map(t => (
                <div key={t.id} className="res-row still">
                  <span />
                  <span className="res-name">
                    <span>
                      {api.wsName(t.workspace)} <span className="muted">· {t.name} · asleep</span>
                    </span>
                  </span>
                  <span />
                  <span className="num muted">{size(live.find(x => x.tab === t.id)?.rss ?? 0)}</span>
                  <span className="res-acts">
                    <button className="small" onClick={() => api.open(t.id)}>
                      Wake
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {said && <p className="muted small">{said}</p>}
          </>
        )}
      </Group>
      <Group title="Idle agents" hint="An idle claude or codex you aren't looking at is ended to free its memory; its screen stays. Looking at it, a key or a message resumes the chat. Not one with a dev server listening under it, getting PR feedback, or on an SSH host.">
        <label>
          Sleep idle agents after
          <select value={sleepAfter} onChange={e => onSleepAfter(Number(e.target.value))}>
            {(SLEEP.some(([m]) => m === sleepAfter) ? SLEEP : [...SLEEP, [sleepAfter, `${sleepAfter} minutes`] as [number, string]]).map(([m, name]) => (
              <option key={m} value={m}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </Group>
    </>
  )
}

// remote access: this app in a browser elsewhere, through cloudflared, for one email (open: none, anyone with the
// link, after a typed confirm); no link yet: starting
export type Remote = { mail: string; open?: boolean; until?: number; url?: string; link?: string }
export type RemoteApi = { state?: Remote; start: (hours: number, mail: string, open: boolean) => Promise<unknown>; stop: () => Promise<unknown>; copy: (text: string) => void; open: (url: string) => void }
const REMOTE_HOURS = [1, 2, 4, 8, 12, 24, 48, 72, 0] // the daemon's too; 0: forever
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/

function RemoteSection({ api, mail, onMail }: { api: RemoteApi; mail: string; onMail: (mail: string) => void }) {
  const [hours, setHours] = useState(1)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState('') // no email: confirm, typed
  const r = api.state
  const open = !mail.trim()
  const ok = open ? sure.trim().toLowerCase() === 'confirm' : ONE_MAIL.test(mail.trim())
  const fail = (e: unknown) => setErr(String((e as Error).message ?? e))
  const start = async () => {
    if (busy || !ok) return
    setBusy(true)
    setErr('')
    await api.start(hours, mail.trim(), open).then(() => setSure(''), fail) // the next start without an email asks again
    setBusy(false)
  }
  const stop = () => (setErr(''), api.stop().catch(fail))
  const ends = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <>
      <h2>Remote access</h2>
      <p className="muted small">
        This app in a browser on another computer or a phone: its terminals and agents, as if you sat here. cloudflared publishes Laki's daemon at a
        random trycloudflare.com address; Cloudflare lets in only the email below, with a one-time code it sends there, and the link carries a key of
        its own (without an email, that key is the only lock). It stops after the time you pick (or never: Forever), when you stop it, or with the daemon, and a stopped link never works again.
      </p>
      <p className="warn-soft small">Whoever gets in has a shell on this Mac as you: use an address only you read.</p>
      {r?.link ? (
        <div className="remote-on">
          <QR text={r.link} label="the remote access link" />
          <div className="remote-side">
            <div className="tunnel-code">
              <code>{r.link}</code>
              <IconButton icon="copy" title="Copy the link" onClick={() => api.copy(r.link!)} />
              <IconButton icon="link" title="Open" onClick={() => api.open(r.link!)} />
            </div>
            {r.open ? (
              <div className="remote-risk" role="alert">
                <b>Anyone with this link gets in.</b>
                <span className="small">
                  No email check: a shell on this Mac as you. Don't paste it where others read; stop it as soon as you're done.{' '}
                  {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
                </span>
              </div>
            ) : (
              <p className="muted small">
                Only <b>{r.mail}</b> gets in. Scan it with a phone, or send the link to yourself. {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
              </p>
            )}
            <div className="row">
              <button className="danger" onClick={stop}>
                Stop remote access
              </button>
            </div>
          </div>
        </div>
      ) : r ? (
        <>
          <p className="muted">Starting cloudflared… it takes a few seconds.</p>
          {r.open && <p className="field-err">Without an email: anyone with the link will get in.</p>}
          <div className="row">
            <button onClick={stop}>Cancel</button>
          </div>
        </>
      ) : (
        <form className="remote-form" onSubmit={e => (e.preventDefault(), start())}>
          <label>
            <span>
              Email <span className="muted">· the only one let in (optional, but leave it out only if you must)</span>
            </span>
            <input value={mail} inputMode="email" autoComplete="email" spellCheck={false} placeholder="you@example.com" onChange={e => onMail(e.target.value)} />
          </label>
          {!open && !ok && <span className="field-err">One email address, like you@example.com</span>}
          {open && (
            <div className="remote-risk" role="alert">
              <b>No email: anyone who gets the link gets in.</b>
              <span className="small">
                There's no Cloudflare sign-in then: the link alone opens a shell on this Mac as you, with your files, keys, and agents. A link in a chat,
                a screenshot or a browser's history is enough. Prefer an email; if you go on, pick a short time and stop it when you're done.
              </span>
              <label>
                <span className="small">
                  Type <b>confirm</b> to start without an email
                </span>
                <input value={sure} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="confirm" onChange={e => setSure(e.target.value)} />
              </label>
            </div>
          )}
          <div className="field">
            <span>For</span>
            <div className="seg" role="radiogroup" aria-label="For how long">
              {REMOTE_HOURS.map(h => (
                <button key={h} type="button" role="radio" aria-checked={h === hours} className={h === hours ? 'on' : ''} onClick={() => setHours(h)}>
                  {h ? `${h}h` : 'Forever'}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <button type="submit" className={open ? 'danger' : 'primary'} disabled={!ok || busy}>
              {busy ? 'Starting…' : open ? 'Start without an email' : 'Start remote access'}
            </button>
          </div>
        </form>
      )}
      {err && <p className="field-err">{err}</p>}
      <div className="remote-tip">
        <p className="muted small">
          Won't start, or Cloudflare's sign-in won't let you in? Run this once in a terminal: it signs cloudflared in to your Cloudflare account (a browser
          page opens to pick one), which can fix it.
        </p>
        <div className="tunnel-code">
          <code>cloudflared tunnel login</code>
          <IconButton icon="copy" title="Copy the command" onClick={() => api.copy('cloudflared tunnel login')} />
        </div>
      </div>
    </>
  )
}

export type SkillInfo = { agent: string; skill?: string; name: string; path: string; state: 'missing' | 'installed' | 'outdated'; mcp?: string; mcpIn?: string } // mcpIn: a config file the lines go in; skill: laki (none: an older daemon's) or laki-widget
// how an app reads and writes its skill; app: its name, for the text
export type SkillApi = { app: string; load: () => Promise<SkillInfo[]>; set: (agent: string, on: boolean, skill?: string) => Promise<SkillInfo[]> }
// the skills Settings offers, in its order: what each teaches
const SKILL_KINDS: [string, string, string][] = [
  ['laki', 'Laki', 'list projects and workspaces, start a workspace with an agent and a prompt, message agents and read their screens, all through the command line'],
  ['laki-widget', 'Extension creator', "make and change the sidebar's extensions: the files, the template language, JS ones, actions, checking them with laki widget"],
]

// the skill that teaches the agents about the app, in each one's folder in the user's home
function SkillSection({ api }: { api: SkillApi }) {
  const [rows, setRows] = useState<SkillInfo[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const fail = (e: any) => setErr(String(e?.message ?? e))
  useEffect(() => void api.load().then(setRows, fail), [])
  const set = (agent: string, on: boolean, skill?: string) => {
    setBusy(true)
    setErr('')
    api.set(agent, on, skill).then(setRows, fail).finally(() => setBusy(false))
  }
  return (
    <>
      <h2>Agent skill</h2>
      <p className="muted">
        Teaches your agents about {api.app}, each skill installed on its own. It goes in your home folder, so every session has it, in {api.app} or not.
      </p>
      {err && <div className="warn small">{err}</div>}
      {!rows && !err && <div className="muted small">Loading…</div>}
      {SKILL_KINDS.filter(([k]) => rows?.some(r => (r.skill ?? 'laki') === k)).map(([k, title, what]) => (
        <Group key={k} title={title} hint={`Teaches them to ${what}.`}>
          {rows!.filter(r => (r.skill ?? 'laki') === k).map(r => (
            <div key={r.agent} className="preset">
              <div className="row">
                <b>{r.name}</b>
                <span className={r.state === 'installed' ? 'small' : 'muted small'}>{r.state === 'installed' ? 'installed' : r.state === 'outdated' ? 'out of date' : 'not installed'}</span>
                <span className="grow" />
                {r.state !== 'installed' && (
                  <button className="primary" disabled={busy} onClick={() => set(r.agent, true, r.skill)}>
                    {r.state === 'missing' ? 'Install' : 'Update'}
                  </button>
                )}
                {r.state !== 'missing' && (
                  <button disabled={busy} onClick={() => set(r.agent, false, r.skill)}>
                    Remove
                  </button>
                )}
              </div>
              <div className="muted small mono">{r.path}</div>
            </div>
          ))}
        </Group>
      ))}
      <p className="muted small">It holds where {api.app} is installed: after moving the app, update it here.</p>
      {rows?.some(r => r.mcp) && (
        <>
          <h2>MCP server</h2>
          <p className="muted">
            Or give agents {api.app}'s tools over MCP: its state, a new workspace, a message to an agent, a tab's screen, a diff, scheduled tasks. Nothing that deletes, archives or ships.
            Run the command once in a terminal (or paste the lines into the file named); it goes in the agent's own settings.
          </p>
          {rows.map(
            r =>
              r.mcp && (
                <div key={r.agent} className="preset">
                  <div className="row">
                    <b>{r.name}</b>
                    {r.mcpIn && <span className="muted small">in {r.mcpIn}, merged with what's there</span>}
                    <span className="grow" />
                    <button onClick={() => navigator.clipboard.writeText(r.mcp!).then(() => (setCopied(r.agent), setTimeout(() => setCopied(''), 2000)), fail)}>{copied === r.agent ? 'Copied' : 'Copy'}</button>
                  </div>
                  <div className="muted small mono" style={{ wordBreak: 'break-all', userSelect: 'text', whiteSpace: 'pre-wrap' }}>{r.mcp}</div>
                </div>
              ),
          )}
        </>
      )}
    </>
  )
}

// Widgets (daemon/widgets.ts): a prompt to make one with any AI, the folders they're found in, Reload, and each one's
// switch, size, schedule, full view's size and settings
export type WidgetsApi = {
  list: WidgetView[]
  home?: string // Laki's own widgets folder
  set: (id: string, p: { on?: boolean; size?: [number, number]; every?: number; view?: WidgetSize; place?: WidgetPlace; net?: boolean; config?: Record<string, string> }) => Promise<unknown>
  run: (id: string) => Promise<unknown>
  rm?: (id: string) => Promise<unknown> // Delete: its folder and settings, for good (asked first here)
  reload: () => Promise<unknown>
  open: (id: string) => void // its full view
  folder?: (id: string, e: MouseEvent<HTMLButtonElement>) => void // its folder's Open in menu
  logs?: (id: string) => void // development mode's: its fetches and actions
}

const SIZES: [number, number][] = [0.5, 1, 2, 3, 4].flatMap(d => [1, 2, 3].map(a => [a, d] as [number, number])) // ½ down: a thin line
const PLACES: [WidgetPlace, string, string][] = [
  ['side', 'Sidebar', 'In the sidebar, above its buttons'],
  ['top', 'Top bar', 'In the top bar, left of its buttons: a line high'],
  ['status', 'Status bar', "At the status bar's right end: a line high"],
]
const VIEWS: [WidgetSize, string][] = [
  ['s', 'Small'],
  ['m', 'Medium'],
  ['l', 'Large'],
]
const enter = (e: KeyEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

// a list setting (logins, labels): each item a chip; Enter, a comma or leaving the box adds what's typed, ⌫ in an
// empty box takes the last one back
function ChipsInput({ value, onChange: save, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  // what was sent, until the daemon's view brings it back: a second chip added meanwhile keeps the first
  const [mine, setMine] = useState(value)
  useEffect(() => setMine(value), [value])
  const items = mine ? mine.split(',') : []
  const onChange = (v: string) => (setMine(v), save(v))
  const [draft, setDraft] = useState('')
  const add = (t: string) => {
    const more = [...new Set(t.split(/[,\n]/).map(x => x.trim()))].filter(x => x && !items.includes(x))
    setDraft('')
    if (more.length) onChange([...items, ...more].join(','))
  }
  return (
    <div className="chips-input" onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {items.map(x => (
        <span key={x} className="chip" data-tip={x.length > 40 ? x : undefined}>
          <span>{x}</span>
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter(y => y !== x).join(','))}>
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        spellCheck={false}
        placeholder={items.length ? '' : placeholder}
        onChange={e => (/[,\n]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault(), add(draft)
          else if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1).join(','))
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={e => {
          const t = e.clipboardData.getData('text') // a one-line box would drop the line breaks between them
          if (/[,\n]/.test(t)) e.preventDefault(), add(draft + t)
        }}
      />
    </div>
  )
}

// one setting of a widget, as its kind takes it, its hint in the empty box (and the name's tooltip); saved as it
// changes (text and numbers as you leave the box)
function WidgetOptionField({ o, value, onSet }: { o: WidgetOption; value: string; onSet: (v: string) => void }) {
  const name = o.label || o.key
  if (o.type === 'bool')
    return (
      <div className="wo wo-bool" data-tip={o.hint}>
        <Switch on={value === '1'} onChange={on => onSet(on ? '1' : '')}>
          <span>{name}</span>
        </Switch>
      </div>
    )
  return (
    <label className="wo">
      <span data-tip={o.hint}>{name}</span>
      {o.type === 'choice' ? (
        <select value={value} onChange={e => onSet(e.target.value)}>
          {(o.choices ?? []).map(c => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : o.type === 'list' ? (
        <ChipsInput value={value} onChange={onSet} placeholder={o.hint ?? 'Type, then Enter'} />
      ) : (
        <input key={value} className={o.type === 'number' ? '' : 'mono'} type={o.type === 'number' ? 'number' : 'text'} defaultValue={value} placeholder={o.hint} spellCheck={false} onKeyDown={enter} onBlur={e => e.target.value !== value && onSet(e.target.value)} />
      )}
    </label>
  )
}

function WidgetCard({ w, api }: { w: WidgetView; api: WidgetsApi }) {
  const options = w.options ?? Object.keys(w.config).map(key => ({ key, type: 'text' as const })) // an older daemon's: text only
  return (
    <div className={`preset widget-card ${w.on ? '' : 'off'}`}>
      <div className="row wc-head">
        <Switch on={w.on} onChange={on => void api.set(w.id, { on })} tip={w.on ? `${w.name}: on` : `${w.name}: off`} />
        <b>{w.name}</b>
        {w.builtin && <span className="tag-soft" data-tip="Comes with Laki">built-in</span>}
        <span className="grow" />
        <select className="wc-place" value={w.place ?? 'side'} data-tip={PLACES.find(x => x[0] === (w.place ?? 'side'))?.[2]} aria-label="Where it shows" onChange={e => void api.set(w.id, { place: e.target.value as WidgetPlace })}>
          {PLACES.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <select className="wc-size" value={w.size.join('x')} data-tip={(w.place ?? 'side') === 'side' ? 'Size in the sidebar: cells across × down' : 'Its width: cells across (a bar is a line high)'} onChange={e => void api.set(w.id, { size: e.target.value.split('x').map(Number) as [number, number] })}>
          {SIZES.map(([a, d]) => (
            <option key={`${a}x${d}`} value={`${a}x${d}`}>
              {a}×{d === 0.5 ? '½' : d}
            </option>
          ))}
        </select>
        {w.every !== undefined && (
          <label className="wc-every" data-tip="Fetches every this many minutes, while the app is open">
            <input
              key={w.every}
              type="number"
              min={1}
              max={1440}
              defaultValue={w.every}
              onKeyDown={enter}
              onBlur={e => {
                const n = e.target.value.trim() ? Number(e.target.value) : NaN
                if (!(n >= 1)) e.target.value = String(w.every) // empty or below 1: as it was, not every minute
                else if (n !== w.every) void api.set(w.id, { every: n })
              }}
            />
            <span className="muted small">min</span>
          </label>
        )}
        {w.full && (
          <select className="wc-view" value={w.view ?? 'm'} data-tip="The full view's size" onChange={e => void api.set(w.id, { view: e.target.value as WidgetSize })}>
            {VIEWS.map(([v, n]) => (
              <option key={v} value={v}>
                {n} view
              </option>
            ))}
          </select>
        )}
        {w.every !== undefined && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && void api.run(w.id)} />}
        {w.full && <button onClick={() => api.open(w.id)}>Open</button>}
        {api.folder && <IconButton icon="folder" title="Its folder: open in…" onClick={e => api.folder!(w.id, e)} />}
        {api.logs && <IconButton icon="file" title="Logs: its fetches and actions (development mode)" onClick={() => api.logs!(w.id)} />}
        {api.rm && !w.builtin && (
          <IconButton
            icon="trash"
            title="Delete it: its folder and settings"
            onClick={() =>
              void ask(`Delete ${w.name}?`, { text: `Its folder (${w.dir}) and its settings go for good.`, ok: 'Delete', danger: true }).then(yes => yes && api.rm!(w.id))
            }
          />
        )}
      </div>
      {w.description && <div className="muted small">{w.description}</div>}
      {w.js && (
        <Switch className="switch-row" on={!!w.net} onChange={net => void api.set(w.id, { net })}>
          <Says title="Network access" hint="Its page may fetch() from and show images of https sites. Off: it sees only what its fetch gave it. Its fetch command always has the network" />
        </Switch>
      )}
      {options.length > 0 && (
        <div className="wc-opts">
          {options.map(o => (
            <WidgetOptionField key={o.key} o={o} value={w.config[o.key] ?? ''} onSet={v => void api.set(w.id, { config: { [o.key]: v } })} />
          ))}
        </div>
      )}
      {w.every !== undefined && <div className={`small ${w.error && !w.running ? 'warn' : 'muted'}`}>{w.running ? 'Fetching…' : w.error ? `Last fetch failed: ${w.error}` : w.at ? `Fetched ${ago(w.at)}` : 'Not fetched yet'}</div>}
    </div>
  )
}

// the widgets as Scheduled tasks' rows: name, what it is, how it's set, its switch; a click opens its card in a dialog.
// Closing blurs the field first: a number or text saves as it's left
function WidgetList({ api }: { api: WidgetsApi }) {
  const [open, setOpen] = useState<string | null>(null)
  const w = api.list.find(x => x.id === open)
  const close = () => ((document.activeElement as HTMLElement | null)?.blur(), setOpen(null))
  if (!api.list.length) return null
  return (
    <>
      <div className="sched-list">
        {api.list.map(w => (
          <div key={w.id} className={`sched-row ${w.on ? '' : 'off'}`}>
            <span className="sched-icon">
              <Icon name={w.js ? 'code' : 'panel'} />
            </span>
            <button type="button" className="sched-main" data-tip="Configure" onClick={() => setOpen(w.id)}>
              <span className="sched-name">{w.name}</span>
              {w.description && (
                <span className="sched-meta">
                  <span className="sched-desc">{w.description}</span>
                </span>
              )}
              <span className="sched-tags">
                {w.builtin && <span className="tag">built-in</span>}
                {(w.place ?? 'side') !== 'side' && <span className="tag">{PLACES.find(x => x[0] === w.place)?.[1]}</span>}
                {w.net && <span className="tag" data-tip="Its page may reach https sites">network</span>}
                {w.byAi && <span className="tag" data-tip="Laki AI wrote it; it was saved off: look at what it runs (its folder) before turning it on">by Laki AI</span>}
                <span className="tag">
                  {w.size[0]}×{w.size[1] === 0.5 ? '½' : w.size[1]}
                </span>
                {w.every !== undefined && <span className="tag">every {w.every} min</span>}
                {w.every !== undefined && <span className={`tag ${w.error && !w.running ? 'tag-closed' : ''}`}>{w.running ? 'fetching…' : w.error ? 'last fetch failed' : w.at ? `fetched ${ago(w.at)}` : 'not fetched yet'}</span>}
              </span>
            </button>
            <span className="sched-acts">
              {w.every !== undefined && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && void api.run(w.id)} />}
            </span>
            <Switch on={w.on} tip={w.on ? `${w.name}: on` : `${w.name}: off`} onChange={on => void api.set(w.id, { on })} />
          </div>
        ))}
      </div>
      {w && (
        <Modal title={w.name} onClose={close} wide loose>
          <WidgetCard w={w} api={api} />
          <div className="buttons">
            <span className="muted small grow">Saved as you change it</span>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

// the prompt that makes a widget in any AI chat: what's wanted, then the whole format
function WidgetPrompt({ home }: { home: string }) {
  const [want, setWant] = useState('')
  const [copied, setCopied] = useState(false)
  const text = widgetPrompt(want, home.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')) // ~, not your account's name, to a chat elsewhere
  const copy = () => navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))
  return (
    <Group title="Make one with AI" hint="Describe it, copy the prompt, paste it into any AI chat, then save the files it gives you in Laki's folder and press Reload.">
      <label>
        What should it show?
        <input value={want} onChange={e => setWant(e.target.value)} placeholder="e.g. open Sentry issues of my project, by count; a table in the full view" />
      </label>
      <div className="prompt-box">
        <textarea className="mono" readOnly rows={6} value={text} onFocus={e => e.currentTarget.select()} />
        <IconButton icon={copied ? 'check' : 'copy'} title={copied ? 'Copied' : 'Copy the prompt'} className="prompt-copy" onClick={() => void copy()} />
      </div>
    </Group>
  )
}

function WidgetsSection({ api, dirs, onDirs, hours, onHours }: { api: WidgetsApi; dirs: string[]; onDirs: (d: string[]) => void; hours: string; onHours: (h: string) => void }) {
  const [busy, setBusy] = useState(false)
  const read = hours.trim() ? parseHours(hours) : null
  return (
    <>
      <h2>Extensions</h2>
      <p className="muted">
        Small live pages (also called widgets or plugins) in the sidebar, above its buttons, in a grid 3 cells across, or a line high in the top bar or the status bar: each a folder with widget.json (its name, size, settings and the command that fetches its data, on a
        schedule) and widget.html (what it shows, and its full view, a click away). A click on one below sets it up. Ask an agent with the Extension creator skill (Agent skill) to make one, or any AI with the prompt below.
      </p>
      <WidgetList api={api} />
      {!api.list.length && <p className="muted">No extensions in these folders yet.</p>}
      {api.home && <WidgetPrompt home={api.home} />}
      <Group title="Folders">
        <div className="muted small">
          Laki's own: <span className="mono">{api.home}</span>
        </div>
        <label>
          <span>
            More folders <span className="muted">· one per line: an extension's folder, or a folder of them</span>
          </span>
          <textarea className="mono" rows={2} spellCheck={false} value={dirs.join('\n')} placeholder="~/code/my-widgets" onChange={e => onDirs(e.target.value.split('\n'))} />
        </label>
        <div className="row">
          <button disabled={busy} onClick={() => (setBusy(true), api.reload().finally(() => setBusy(false)))}>
            {busy ? 'Reloading…' : 'Reload extensions'}
          </button>
          <span className="muted small">Reads the folders again and fetches each extension that's on: changes show without a restart.</span>
        </div>
      </Group>
      <Group title="Working hours">
        <label>
          <span>
            Fetch only <span className="muted">· in plain English; empty: any time the app is open</span>
          </span>
          <input value={hours} spellCheck={false} placeholder="9am-9pm weekdays" onChange={e => onHours(e.target.value)} />
        </label>
        {read && <div className={`small ${'error' in read ? 'warn' : 'schedule-preview'}`}>{'error' in read ? `${read.error}: fetching any time until then` : `${describeHours(read)} · Fetch now still works outside them`}</div>}
      </Group>
    </>
  )
}

export function SettingsPage(p: {
  settings: AppSettings
  apps: AppInfo[]
  onSave: (s: AppSettings) => void
  onClose: () => void
  projects?: ProjectInfo[]
  projectFile?: (id: string) => Promise<ProjectConfig> // its .laki.json
  onSaveProject?: (id: string, o: { name?: string; config: ProjectConfig; notes?: string }) => unknown
  renameProjects?: boolean
  section?: string // where it opens: a section's id, or project:<id>
  script?: keyof Scripts // a project's script tab to show
  spot?: string // a group's title to open at, lit (Run ▾'s Edit the run script…, Edit actions…)
  skill?: SkillApi
  ai?: AiApi
  remote?: RemoteApi
  widgets?: WidgetsApi
  resources?: ResourcesApi
  webhookTest?: (w: Webhook) => Promise<unknown> // Notifications webhook's Send test
  logs?: (key: string, title: string) => void // development mode's: new: what making a workspace ran
  presets: Preset[] // the daemon's: the settings', or its defaults
  onSection?: (id: string) => void // each section it shows (Get started's steps)
}) {
  const { settings, apps, onSave, onClose } = p
  const [s, setS] = useState<AppSettings>(settings)
  // the section it was on last (closing it, a click in the sidebar, doesn't lose your place), unless it's gone
  const sections = SECTIONS.filter(x => (x.id !== 'skill' || p.skill) && (x.id !== 'ai' || p.ai) && (x.id !== 'remote' || p.remote) && (x.id !== 'widgets' || p.widgets) && (x.id !== 'resources' || p.resources))
  const [sec, setSec] = useState(() => p.section ?? (x => (sections.some(y => y.id === x) || p.projects?.some(y => `project:${y.id}` === x) ? x : 'general'))(load('laki.settingsSec', 'general')))
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
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ laki: 'settings', version: 1, settings: s }, null, 2)], { type: 'application/json' }))
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
        const { ok, bad } = importable(v)
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
          {!findQ.trim() && !!p.projects?.length && <div className="settings-nav-head">Projects</div>}
          {!findQ.trim() && p.projects?.map(x => (
            <button key={x.id} className={sec === `project:${x.id}` ? 'on' : ''} onClick={() => openSec(`project:${x.id}`)} data-tip={x.path}>
              <Icon name={x.host ? 'server' : x.git === false ? 'folder' : 'fork'} /> <span>{x.name}</span>
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
              global={{ actions: s.actions, templates: s.templates }}
              taken={p.projects?.filter(x => x.id !== project.id).flatMap(x => x.config?.actions?.map(a => a.slug) ?? [])}
              onGlobal={openSec}
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
              <Group title="In the sidebar">
              <div className="setting-box">
                <Switch className="switch-row" on={s.diffStat === true} onChange={v => set({ diffStat: v })}>
                  <Says title="Diff size in the sidebar" hint="Lines each workspace added and removed against its base, new files too; checked every 10 seconds" />
                </Switch>
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
              </div>
              </Group>
              <Group title="Development">
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.devMode} onChange={v => set({ devMode: v })}>
                  <Says title="Development mode" hint="Keeps what happens to each workspace (PR checks, what the PR switches sent and why not, its agents' turns and commands) and extension (fetches, actions): ⋯ › Logs, and Logs on an extension in Settings › Extensions" />
                </Switch>
                {s.devMode && p.logs && (
                  <div className="row">
                    <span className="muted small grow">Creation log: what making a workspace ran (what was asked, git, the setup, the agent) or why it failed</span>
                    <button onClick={() => p.logs!('new', 'Logs · new workspaces')}>
                      <Icon name="file" /> Open
                    </button>
                  </div>
                )}
              </div>
              </Group>
              <Group title="Experimental" hint="New things to try: they may change, or go">
              <div className="setting-box">
                <Switch className="switch-row" on={s.specs === true} onChange={v => set({ specs: v })}>
                  <Says title="Specs & Brainstorms" hint="Write a project's requirements like a Notion page (checklists, images, diagrams) and brainstorm ideas with Laki AI (options, a mind map, diagrams, clickable prototypes). Each is a folder outside the repo with a README.md any agent can read. Shows the rail's Specs and a project's Specs tab" />
                </Switch>
                <Switch className="switch-row" on={s.workflows === true} onChange={v => set({ workflows: v })}>
                  <Says title="Workflows" hint="Blocks Laki runs for a task: agents, commands, choices, questions for you, a PR, CI. Each run keeps its decisions and log, and resumes after a restart. Shows the rail's Flows" />
                </Switch>
                <Switch className="switch-row" on={s.birdView === true} onChange={v => set({ birdView: v })}>
                  <Says title="Bird view" hint="Every live session at once, each with its screen as it is now: the eye beside Help. A click opens one" />
                </Switch>
              </div>
              </Group>
              <Group title="Environment" hint="Every session's (agents, shells, setup); a project's or preset's env wins. New sessions get it.">
                <EnvField value={s.env} onChange={env => set({ env })} />
              </Group>
              <Group title="Move to another Mac" hint="Every setting on these pages in a file (it holds your env: keep it private); projects and their own settings stay here">
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
              </div>
              </Group>
              <Group title="Rail" hint="Projects, Board, Schedule, Terminal and Browser on the left, with what needs you on each; the list beside it shows the one you pick">
                <Switch className="switch-row" on={s.railLabels !== false} onChange={v => set({ railLabels: v })}>
                  <Says title="Labels" hint="Words under the rail's icons: Projects, Board, Schedule, Terminal, Browser, Settings; off: icons only, and a narrower rail" />
                </Switch>
              </Group>
              <Group title="Sidebar" hint="How a workspace's row looks; each choice is over the theme's">
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
                <Switch className="switch-row" on={s.menuBar !== false} onChange={v => set({ menuBar: v })}>
                  <Says title="Menu bar item" hint="Laki's mark with the count of agents that need you (as the Dock's badge); its menu lists them, a click opens one" />
                </Switch>
                <Switch className="switch-row" on={s.prIcon !== false} onChange={v => set({ prIcon: v })}>
                  <Says title="Pull requests in the sidebar" hint="GitHub's mark on a workspace with a PR: green open, purple merged, red failing checks, gray draft or closed" />
                </Switch>
                <Switch className="switch-row" on={!!s.timers} onChange={v => set({ timers: v })}>
                  <Says title="Turn timers" hint="How long each agent has been at its turn, on its tab and in the sidebar" />
                </Switch>
                {Object.entries(USAGE_AGENTS).map(([a, name]) => (
                  <Switch key={a} className="switch-row" on={s.usage?.[a] !== false} onChange={v => set({ usage: { ...s.usage, [a]: v } })}>
                    <Says title={`${name} plan limits`} hint={`The status bar's ring: the 5-hour and weekly windows, read with ${name}'s own sign-in every 5 minutes`} />
                  </Switch>
                ))}
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
                                    ✓
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
              <Group title="Font and cursor">
              <div className="grid2">
                <label>
                  Font
                  <select
                    value={otherFont ? 'other' : font}
                    onChange={e => {
                      setOtherFont(e.target.value === 'other')
                      if (e.target.value !== 'other') set({ fontFamily: e.target.value }) // '': the default (undefined wouldn't be saved)
                    }}
                  >
                    <option value="">Default (JetBrains Mono)</option>
                    {font && !otherFont && !fonts.includes(font) && <option value={font}>{font} (not found)</option>}
                    {fonts.map(f => (
                      <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>
                        {f}
                      </option>
                    ))}
                    <option value="other">Other…</option>
                  </select>
                </label>
                <label>
                  <span>
                    Font size <span className="muted">· ⌘+ / ⌘− / ⌘0</span>
                  </span>
                  <select value={s.fontSize ?? FONT_SIZE} onChange={e => set({ fontSize: Number(e.target.value) })}>
                    {[...new Set([...FONT_SIZES, s.fontSize ?? FONT_SIZE])]
                      .sort((a, b) => a - b)
                      .map(n => (
                        <option key={n} value={n}>
                          {n}px{n === FONT_SIZE ? ' (default)' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                {otherFont && <input className="span2" value={s.fontFamily ?? ''} placeholder="a font's name, as in Font Book" onChange={e => set({ fontFamily: e.target.value })} autoFocus />}
                {pick('Line height', 'lineHeight', 1.15, [1, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.8])}
                {pick('Letter spacing', 'letterSpacing', 0, [-1, -0.5, 0, 0.5, 1, 1.5, 2, 3], n => `${n}px`)}
                {pick('Font weight', 'fontWeight', '400', ['300', '400', '500', '600', '700'], w => `${w} · ${WEIGHTS[w]}`)}
                {pick('Minimum contrast', 'minContrast', 1, [1, 3, 4.5, 7], n => CONTRAST[n])}
                {pick('Cursor style', 'cursorStyle', 'block', ['block', 'bar', 'underline'], c => c[0].toUpperCase() + c.slice(1))}
                {pick('Padding', 'termPad', 'normal', ['tiny', 'normal', 'roomy'], p => p[0].toUpperCase() + p.slice(1))}
                {pick('Scroll speed', 'scrollSpeed', SCROLL, [1, 2, 3, 4, 5, 8], n => `${n}×${n === 1 ? ' · xterm’s' : ''} · ⌥ ${n * 3}×`)}
                <div className="checks">
                  <Switch className="switch-row" on={s.cursorBlink !== false} onChange={v => set({ cursorBlink: v })}>
                    Blinking cursor
                  </Switch>
                  <Switch className="switch-row" on={s.copyOnSelect !== false} onChange={v => set({ copyOnSelect: v })}>
                    Copy selected text
                  </Switch>
                  <Switch className="switch-row" on={s.editKeys !== false} onChange={v => set({ editKeys: v })}>
                    Mac editing keys: ⌘← ⌘→ ⌥← ⌥→ ⌘⌫
                  </Switch>
                  <Switch className="switch-row" on={!!s.dimPanes} onChange={v => set({ dimPanes: v })}>
                    Dim other panes
                  </Switch>
                  <Switch className="switch-row" on={!!s.hoverFocus} onChange={v => set({ hoverFocus: v })}>
                    Focus the pane under the mouse
                  </Switch>
                </div>
              </div>
              </Group>
              <Group title="Live preview">
              <div className="preview-head muted small">
                <span>Live preview · click it for the cursor</span>
                <span className="grow" />
                <span>
                  {s.fontSize ?? FONT_SIZE}px · {s.lineHeight ?? 1.15} line height · {s.fontWeight || '400'}
                </span>
              </div>
              <div style={{ zoom: 1 / scale }}>
                <TermPreview key={String(transparent())} s={s} />
              </div>
              <p className="muted small">Ligatures (=&gt; as one glyph) aren't drawn: xterm needs an add-on for them that Laki doesn't ship.</p>
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
          {sec === 'widgets' && p.widgets && <WidgetsSection api={p.widgets} dirs={s.widgetDirs ?? []} onDirs={widgetDirs => set({ widgetDirs })} hours={s.widgetHours ?? ''} onHours={widgetHours => set({ widgetHours })} />}
          {sec === 'remote' && p.remote && <RemoteSection api={p.remote} mail={s.remoteMail ?? ''} onMail={remoteMail => set({ remoteMail })} />}
          {sec === 'resources' && p.resources && <ResourcesSection api={p.resources} sleepAfter={s.sleepAfter ?? 0} onSleepAfter={sleepAfter => set({ sleepAfter })} />}
          {sec === 'notes' && (
            <>
              <h2>Release notes</h2>
              <p className="muted small">What's new in Laki, newest first. This build: {version}.</p>
              <div className="release-notes">
                <Markdown src={notes.replace(/<!--[\s\S]*?-->/g, '').replace(/^## Next$/m, `## New since ${version}`)} />
              </div>
            </>
          )}
          {sec === 'ai' && p.ai && <AiSection api={p.ai} ai={s.ai ?? {}} presets={presets} onChange={ai => set({ ai })} />}
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
                A prompt goes to its agent's tab (the focused one first), queued while the agent works; it's listed only while that agent runs there. A
                command goes to a terminal: the focused one, any other, or a new one. The copy button makes the same for another agent.
              </p>
              <ActionsField value={s.actions} taken={p.projects?.flatMap(x => x.config?.actions?.map(a => a.slug) ?? [])} onChange={actions => set({ actions })} />
            </>
          )}
          {sec === 'presets' && (
            <>
              <h2>Agent presets</h2>
              <p className="muted small">
                How agents start. Each preset that's on is in the new-tab menu, the new-workspace page and scheduled tasks; switch off the ones you don't use
                (their tabs still start). Args go after the command, before the prompt, through the shell (so the variables work); env goes on top of the
                project's.
              </p>
              {presets.map((p, i) => (
                <div key={keys.current[i]} className={`preset ${p.off ? 'off' : ''}`}>
                  <div className="row preset-head">
                    <Switch on={!p.off} onChange={on => setPreset(i, { off: on ? undefined : true })} tip={p.off ? `${p.name}: off, not in the pickers` : `${p.name}: on`} />
                    <input className="mono" value={p.name} placeholder="name" onChange={e => setPreset(i, { name: e.target.value.replace(/\s+/g, '-') })} />
                    <select value={p.agent} onChange={e => setPreset(i, { agent: e.target.value as Preset['agent'] })}>
                      {AGENTS.map(a => (
                        <option key={a} value={a}>
                          {AGENT_NAMES[a]}
                        </option>
                      ))}
                      <option value="command">Command</option>
                    </select>
                    <IconButton icon="trash" title="Remove preset" onClick={() => setPresets(presets.filter((_, j) => j !== i), i)} />
                  </div>
                  {p.agent === 'command' ? (
                    <input className="mono" value={p.cmd ?? ''} placeholder="aider --model sonnet" onChange={e => setPreset(i, { cmd: e.target.value })} />
                  ) : (
                    <input
                      className="mono"
                      value={p.args ?? ''}
                      placeholder={ARGS_EG[p.agent as Agent]}
                      onChange={e => setPreset(i, { args: e.target.value })}
                    />
                  )}
                  <VarChips
                    vars={ENV_VARS}
                    value={(p.agent === 'command' ? p.cmd : p.args) ?? ''}
                    onChange={v => setPreset(i, p.agent === 'command' ? { cmd: v } : { args: v })}
                  />
                  <EnvField value={p.env} onChange={env => setPreset(i, { env: Object.keys(env).length ? env : undefined })} placeholder="env: KEY=value, one per line" />
                  {(p.agent === 'claude' || p.agent === 'codex') && (
                    <Switch className="switch-row" on={p.laki !== false} onChange={on => setPreset(i, { laki: on ? undefined : false })}>
                      <Says title="Tell it about Laki" hint="A note at each start: it runs in Laki, can name its workspace, attach a PR, start another workspace, and keep files for you in $LAKI_STORAGE_FOLDER" />
                    </Switch>
                  )}
                </div>
              ))}
              <div className="row">
                <button onClick={() => setPresets([...presets, { name: `claude-${presets.length + 1}`, agent: 'claude' }])}>
                  <Icon name="plus" /> Add preset
                </button>
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
