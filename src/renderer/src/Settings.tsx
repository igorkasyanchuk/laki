// The app's settings, a page of its own (⌘,): saved as you change them. The daemon keeps
// the settings.
import { FitAddon } from '@xterm/addon-fit'
import { type FontWeight, Terminal } from '@xterm/xterm'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_NAMES, AGENTS, type Agent, type FixWhat, type NotifyKind, PR_PROMPTS, PR_SCAN, PR_TRIES, type Preset, type ProjectLook, type SideLook, type Webhook } from '../../shared/types'
import { MAIL_OK, parseMails, type RunAction, type Template } from './text'
import { applyTheme, GLASS, type Paint, paintKey, preview, termTheme, THEMES, transparent, UI_FONTS } from './themes'
import { Icon, IconButton, type IconName, Switch } from './ui'
import { QR } from './Tunnel'
import { USAGE_AGENTS } from './Usage'

// a switch row's text: what it is, and under it a line on what it does
const Says = ({ title, hint }: { title: ReactNode; hint?: ReactNode }) => (
  <span className="switch-text">
    <span>{title}</span>
    {hint && <span className="muted">{hint}</span>}
  </span>
)

export type { Preset }

// the sidebar's project names (ProjectLook): each option over the theme's; App.tsx puts them on the sidebar as data-ph-*
// what an imported field must be where a page would break on anything else (a list it maps, a number it adds to)
const KINDS: Record<string, string> = { presets: 'array null', templates: 'array', actions: 'array', tunnelMails: 'array', env: 'object', prPrompts: 'object', webhook: 'object', prScan: 'number', prTries: 'number', notifyOn: 'object', usage: 'object', projectLook: 'object', sideLook: 'object', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number', minContrast: 'number', glassWindow: 'number', glassSide: 'number', glassTerm: 'number' }

const PROJECT_LOOK: [keyof ProjectLook, string, [string, string][]][] = [
  ['font', 'Font', [['theme', "Theme's"], ['ui', 'Interface'], ['mono', 'Monospace']]],
  ['case', 'Case', [['theme', "Theme's"], ['upper', 'UPPERCASE'], ['none', 'As named']]],
  ['spacing', 'Letter spacing', [['theme', "Theme's"], ['0', 'None'], ['0.4px', 'Tight'], ['1px', 'Normal'], ['2px', 'Wide']]],
  ['size', 'Size', [['theme', "Theme's"], ['10px', '10'], ['11px', '11'], ['12px', '12'], ['13px', '13'], ['14px', '14']]],
  ['weight', 'Weight', [['theme', "Theme's"], ['400', 'Regular'], ['600', 'Semibold'], ['800', 'Bold']]],
]
// the sidebar's lines and rows (SideLook): CSS values, App.tsx puts them on the sidebar as the variables looks set
const SIDE_LOOK: [Exclude<keyof SideLook, 'labels'>, string, [string, string][]][] = [
  ['guide', 'Guide line', [['theme', "Theme's"], ['1px solid var(--line)', 'Thin'], ['1px dashed var(--line)', 'Dashed'], ['2px solid color-mix(in srgb, var(--accent) 60%, transparent)', 'Accent'], ['none', 'None']]],
  ['divider', 'Between projects', [['theme', "Theme's"], ['1px solid var(--line)', 'A line'], ['none', 'Nothing']]],
  ['indent', 'Indent', [['theme', "Theme's"], ['0px', 'None'], ['11px', 'Small'], ['20px', 'Large']]],
  ['rows', 'Row height', [['theme', "Theme's"], ['22px', 'Compact'], ['26px', 'Normal'], ['32px', 'Roomy']]],
]

export type AppSettings = Paint & {
  editor?: string // an app id from the daemon's list, or 'custom' (editorCmd)
  editorCmd?: string
  agent?: string // the preset new workspaces start
  branchPrefix?: string
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  lineHeight?: number
  letterSpacing?: number // px
  fontWeight?: string // 300…700
  minContrast?: number // 1: the theme's colors as they are
  cursorStyle?: 'block' | 'bar' | 'underline'
  cursorBlink?: boolean
  templates?: Template[] // prompt templates: {{prompt}}, {{project}}, {{base}}
  actions?: RunAction[] // Run ▾'s actions, with each project's
  env?: Record<string, string> // every session's
  notify?: boolean
  prIcon?: boolean // the sidebar's GitHub mark on a workspace with a PR (unset: on)
  timers?: boolean // a turn's time on its tab and row (unset: off)
  diffStat?: boolean // each workspace's +/- in the sidebar (unset: off)
  dimPanes?: boolean // a split's other panes faded (unset: off)
  projectLook?: ProjectLook // the sidebar's project names
  sideLook?: SideLook // the sidebar's lines, rows and button labels
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  notifySound?: string // a macOS sound, 'none', or unset: the default
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  presets?: Preset[] | null // null: the daemon's defaults (every agent installed)
  remoteMail?: string // the one address remote access lets in
  prPrompts?: Partial<Record<FixWhat, string>> // what the PR switches tell the agent (unset: PR_PROMPTS)
  prScan?: number // minutes between PR checks
  prTries?: number // fix CI's and fix conflicts' tries in a row
  webhook?: Webhook // pushes to your phone
  archiveMerged?: boolean // a merged PR's clean workspace archived, with Undo
  menuBar?: boolean // the menu bar's item (unset: on)
  fun?: boolean // the tab bar's smiley (unset: on)
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
  return (
    <>
      <h2>Notifications webhook</h2>
      <p className="muted small">
        Pushes to your phone when an agent waits for you or finishes, posted to this URL and nowhere else. ntfy: a topic's URL, which the ntfy app
        subscribes to; Slack: an incoming webhook; Telegram: your bot's whole sendMessage URL, chat_id included; generic JSON gets{' '}
        <code>{'{event, workspace, tab, agent, message, ts}'}</code>. Muted workspaces and tabs don't push.
      </p>
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
      <div className="setting-box">
        <Switch className="switch-row" on={w.waiting !== false} onChange={v => onChange({ ...w, waiting: v })}>
          <Says title="Waiting for you" hint="A permission prompt or a question, with what it asks; once per wait" />
        </Switch>
        <Switch className="switch-row" on={w.done === true} onChange={v => onChange({ ...w, done: v })}>
          <Says title="Finished" hint="The end of a turn, with its last question if it asks one" />
        </Switch>
      </div>
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

const NOTIFY_KINDS: readonly (readonly [NotifyKind, string, string])[] = [
  ['waiting', 'Waiting for you', 'A permission prompt, or CI that keeps failing'],
  ['done', 'Finished', 'The end of a turn, with its last words'],
  ['limit', 'Usage limit', 'An agent hit its plan limit'],
]
const SOUNDS = ['Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink']

export const FONT_SIZE = 13
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

// the terminal's typography and cursor, as xterm options (size and family: Term's props, zoom changes them)
export const termLook = (s: AppSettings) => ({
  lineHeight: s.lineHeight ?? 1.15,
  letterSpacing: s.letterSpacing ?? 0,
  fontWeight: (s.fontWeight || 'normal') as FontWeight,
  fontWeightBold: 'bold' as FontWeight,
  minimumContrastRatio: s.minContrast ?? 1,
  cursorStyle: s.cursorStyle ?? 'block',
  cursorBlink: s.cursorBlink !== false,
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
      rows={Math.max(2, Math.min(8, text.split('\n').length + 1))}
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

export type ProjectConfig = Scripts & { expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string> } // expose: emails, *@domains
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; config?: ProjectConfig }

// a project's page: name, scripts, env; saved as you type, like the rest
const TARGETS: [RunAction['target'], string][] = [...AGENTS.map(a => [a, AGENT_NAMES[a]] as [Agent, string]), ['shell', 'Terminal']]
const ACTION_EG: Record<RunAction['target'], string> = {
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

function ActionsField({ value = [], onChange }: { value?: RunAction[]; onChange: (v: RunAction[]) => void }) {
  const keys = useRef<number[]>([]) // like keys, for the cards
  while (keys.current.length < value.length) keys.current.push(Math.random())
  const setAt = (i: number, a: Partial<RunAction>) => onChange(value.map((x, j) => (j === i ? { ...x, ...a } : x)))
  const drop = (i: number) => (keys.current.splice(i, 1), onChange(value.filter((_, j) => j !== i)))
  return (
    <>
      {value.map((a, i) => (
        <div key={keys.current[i]} className="preset">
          <div className="row">
            <input value={a.name} placeholder="name, as Run ▾ shows it" onChange={e => setAt(i, { name: e.target.value })} />
            <select value={a.target} onChange={e => setAt(i, { target: e.target.value as RunAction['target'] })}>
              {TARGETS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <IconButton icon="trash" title="Remove action" onClick={() => drop(i)} />
          </div>
          <textarea className="mono" rows={2} spellCheck={false} value={a.text} placeholder={ACTION_EG[a.target]} onChange={e => setAt(i, { text: e.target.value })} />
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => onChange([...value, { name: '', target: 'claude', text: '' }])}>
          <Icon name="plus" /> Add action
        </button>
      </div>
    </>
  )
}

function ProjectSection(p: { project: ProjectInfo; file?: (id: string) => Promise<ProjectConfig>; rename?: boolean; script?: keyof Scripts; onSave: (o: { name?: string; config: ProjectConfig }) => unknown }) {
  const [name, setName] = useState(p.project.name)
  const [c, setC] = useState<ProjectConfig>(p.project.config ?? {})
  const [file, setFile] = useState<ProjectConfig>({})
  useEffect(() => void p.file?.(p.project.id).then(setFile, () => {}), [p.project.id])
  const first = useRef(true)
  const unsaved = useRef<(() => unknown) | null>(null)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const save = () => p.onSave({ name: p.rename && name.trim() ? name.trim() : undefined, config: c })
    unsaved.current = save
    const t = setTimeout(() => ((unsaved.current = null), save()), 400)
    return () => clearTimeout(t)
  }, [name, c])
  useEffect(() => () => void unsaved.current?.(), [])
  const badMails = parseMails(c.expose ?? '').filter(m => !MAIL_OK.test(m))
  return (
    <>
      <h2>{p.project.name}</h2>
      <div className="muted small mono">
        {p.project.path} · {p.project.git ? 'git' : 'folder (no git)'}
      </div>
      {p.rename && (
        <label>
          Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
      )}
      <div className="field">
        <span>
          Scripts <span className="muted">· for workspace setup, teardown and the Run button; empty: the repo's .laki.json</span>
        </span>
        <ScriptsField value={c} file={file} git={p.project.git} tab={p.script} onChange={x => setC(y => ({ ...y, ...x }))} />
      </div>
      <label>
        <span>
          Env <span className="muted">· for every tab, setup and teardown{file.env && Object.keys(file.env).length ? ` · .laki.json has ${Object.keys(file.env).join(', ')}` : ''}</span>
        </span>
        <EnvField value={c.env} onChange={env => setC(y => ({ ...y, env }))} />
      </label>
      <label>
        <span>
          Expose to the world <span className="muted">· who can open a tunnel: the popup starts from it every time; emails and *@domains, or empty for anyone with the link</span>
        </span>
        <input value={c.expose ?? ''} placeholder={file.expose ? `${file.expose} (.laki.json)` : 'anyone with the link'} onChange={e => setC(y => ({ ...y, expose: e.target.value }))} />
        {badMails.length > 0 && <span className="field-err">Not an address or *@domain: {badMails.join(', ')}</span>}
      </label>
      <div className="field">
        <span>
          Actions <span className="muted">· in Run ▾ after the global ones (Settings › Actions); one with a global one's name replaces it here</span>
        </span>
        <ActionsField value={c.actions} onChange={actions => setC(y => ({ ...y, actions }))} />
      </div>
      <div className="field">
        <span>
          Prompt templates <span className="muted">· a new workspace here lists them first, then the global ones (Settings › Prompt templates); one with a global one's name replaces it</span>
        </span>
        <TemplatesField value={c.templates} onChange={templates => setC(y => ({ ...y, templates }))} />
      </div>
    </>
  )
}

const WEIGHTS: Record<string, string> = { 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' }
const CONTRAST: Record<number, string> = { 1: "the theme's colors", 3: 'low (3:1)', 4.5: 'medium (4.5:1)', 7: 'high (7:1)' }

// Find a setting (the nav's search box): each setting's title as the page writes it, its section, words it goes by.
// A result opens the section and shows the first label, row or heading starting with the title. Add new settings here.
const FIND: [string, string, string?][] = [
  ['general', 'New workspaces start', 'default agent preset'],
  ['general', 'Branch prefix', 'git worktree'],
  ['general', 'macOS notifications', 'notify waiting done limit mute'],
  ['general', 'Sound', 'notification'],
  ['webhook', 'Notifications webhook', 'phone push ntfy slack telegram json notify waiting done'],
  ['webhook', 'Send test', 'webhook phone push'],
  ['general', 'Menu bar item', 'tray status count waiting needs you'],
  ['general', 'Fun button', 'meme reddit smiley break joke'],
  ['general', 'Pull requests in the sidebar', 'pr github icon'],
  ['general', 'Turn timers', 'elapsed time'],
  ['general', 'Diff size in the sidebar', 'lines added removed changes stat'],
  ['general', 'Claude Code plan limits', 'usage ring 5-hour weekly'],
  ['general', 'Codex plan limits', 'usage ring 5-hour weekly'],
  ['general', 'Environment', 'env variables'],
  ['general', 'Move to another Mac', 'export import backup file'],
  ['appearance', 'Interface font', 'ui type'],
  ['appearance', 'Project names in the sidebar', 'font case letter spacing size weight'],
  ['appearance', 'The sidebar', 'guide line divider indent row height'],
  ['appearance', 'Button labels', 'sidebar scheduled board settings words'],
  ['appearance', 'Glass', 'transparent see-through blur vibrancy'],
  ['appearance', 'Glow', 'glass colors'],
  ['appearance', 'Terminals use', 'theme themes colors palette dark light'],
  ['terminal', 'Font', 'monospace family'],
  ['terminal', 'Font size', 'zoom bigger smaller'],
  ['terminal', 'Line height', ''],
  ['terminal', 'Letter spacing', ''],
  ['terminal', 'Font weight', 'bold light'],
  ['terminal', 'Minimum contrast', 'readable'],
  ['terminal', 'Cursor style', 'block bar underline'],
  ['terminal', 'Blinking cursor', 'blink'],
  ['terminal', 'Copy selected text', 'clipboard selection'],
  ['terminal', 'Dim other panes', 'split focus fade'],
  ['open', 'Default', 'editor cursor vs code zed windsurf antigravity sublime jetbrains xcode open in'],
  ['open', 'Custom command', 'editor'],
  ['presets', 'Agent presets', 'claude codex gemini args env model'],
  ['pr', 'Check pull requests every', 'pr github scan frequency interval minutes how often'],
  ['pr', 'Archive workspace when its PR merges', 'merged auto archive clean cleanup'],
  ['pr', 'Tries in a row', 'pr fix ci conflicts limit attempts how many times'],
  ['pr', 'Fix CI', 'pr prompt failing checks auto'],
  ['pr', 'Review', 'pr prompt comments auto'],
  ['pr', 'Fix conflicts', 'pr prompt merge auto'],
  ['templates', 'Prompt templates', 'prompt'],
  ['actions', 'Actions', 'run menu prompt command'],
  ['skill', 'Agent skill', 'mcp server laki cli'],
  ['remote', 'Remote access', 'phone email cloudflare tunnel qr'],
]

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'open', label: 'Open in', icon: 'code' },
  { id: 'presets', label: 'Agent presets', icon: 'agent' },
  { id: 'webhook', label: 'Phone pushes', icon: 'bell' },
  { id: 'pr', label: 'Pull requests', icon: 'pr' },
  { id: 'templates', label: 'Prompt templates', icon: 'pencil' },
  { id: 'actions', label: 'Actions', icon: 'run' },
  { id: 'skill', label: 'Agent skill', icon: 'import' },
  { id: 'remote', label: 'Remote access', icon: 'globe' },
]
export const isSection = (id: string) => SECTIONS.some(x => x.id === id)

// remote access: this app in a browser elsewhere, through cloudflared, for one email; no link yet: starting
export type Remote = { mail: string; until?: number; url?: string; link?: string }
export type RemoteApi = { state?: Remote; start: (hours: number, mail: string) => Promise<unknown>; stop: () => Promise<unknown>; copy: (text: string) => void; open: (url: string) => void }
const REMOTE_HOURS = [1, 2, 4, 8, 24, 0] // the daemon's too; 0: forever
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/

function RemoteSection({ api, mail, onMail }: { api: RemoteApi; mail: string; onMail: (mail: string) => void }) {
  const [hours, setHours] = useState(1)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const r = api.state
  const ok = ONE_MAIL.test(mail.trim())
  const fail = (e: unknown) => setErr(String((e as Error).message ?? e))
  const start = async () => {
    if (busy || !ok) return
    setBusy(true)
    setErr('')
    await api.start(hours, mail.trim()).catch(fail)
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
        its own. It stops after the time you pick (or never: Forever), when you stop it, or with the daemon, and a stopped link never works again.
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
            <p className="muted small">
              Only <b>{r.mail}</b> gets in. Scan it with a phone, or send the link to yourself. {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
            </p>
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
          <div className="row">
            <button onClick={stop}>Cancel</button>
          </div>
        </>
      ) : (
        <form className="remote-form" onSubmit={e => (e.preventDefault(), start())}>
          <label>
            <span>
              Email <span className="muted">· the only one let in</span>
            </span>
            <input value={mail} inputMode="email" autoComplete="email" spellCheck={false} placeholder="you@example.com" onChange={e => onMail(e.target.value)} />
          </label>
          {mail.trim() && !ok && <span className="field-err">One email address, like you@example.com</span>}
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
            <button type="submit" className="primary" disabled={!ok || busy}>
              {busy ? 'Starting…' : 'Start remote access'}
            </button>
          </div>
        </form>
      )}
      {err && <p className="field-err">{err}</p>}
    </>
  )
}

export type SkillInfo = { agent: string; name: string; path: string; state: 'missing' | 'installed' | 'outdated'; mcp?: string; mcpIn?: string } // mcpIn: a config file the lines go in
// how an app reads and writes its skill; app: its name, for the text
export type SkillApi = { app: string; load: () => Promise<SkillInfo[]>; set: (agent: string, on: boolean) => Promise<SkillInfo[]> }

// the skill that teaches the agents about the app, in each one's folder in the user's home
function SkillSection({ api }: { api: SkillApi }) {
  const [rows, setRows] = useState<SkillInfo[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const fail = (e: any) => setErr(String(e?.message ?? e))
  useEffect(() => void api.load().then(setRows, fail), [])
  const set = (agent: string, on: boolean) => {
    setBusy(true)
    setErr('')
    api.set(agent, on).then(setRows, fail).finally(() => setBusy(false))
  }
  return (
    <>
      <h2>Agent skill</h2>
      <p className="muted">
        Teaches your agents about {api.app}: list projects and workspaces, start a workspace with an agent and a prompt, message agents and read their screens, all
        through the {api.app} command line. It goes in your home folder, so every session has it, in {api.app} or not.
      </p>
      {err && <div className="warn small">{err}</div>}
      {!rows && !err && <div className="muted small">Loading…</div>}
      {rows?.map(r => (
        <div key={r.agent} className="preset">
          <div className="row">
            <b>{r.name}</b>
            <span className={r.state === 'installed' ? 'small' : 'muted small'}>{r.state === 'installed' ? 'installed' : r.state === 'outdated' ? 'out of date' : 'not installed'}</span>
            <span className="grow" />
            {r.state !== 'installed' && (
              <button className="primary" disabled={busy} onClick={() => set(r.agent, true)}>
                {r.state === 'missing' ? 'Install' : 'Update'}
              </button>
            )}
            {r.state !== 'missing' && (
              <button disabled={busy} onClick={() => set(r.agent, false)}>
                Remove
              </button>
            )}
          </div>
          <div className="muted small mono">{r.path}</div>
        </div>
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

export function SettingsPage(p: {
  settings: AppSettings
  apps: AppInfo[]
  onSave: (s: AppSettings) => void
  onClose: () => void
  projects?: ProjectInfo[]
  projectFile?: (id: string) => Promise<ProjectConfig> // its .laki.json
  onSaveProject?: (id: string, o: { name?: string; config: ProjectConfig }) => unknown
  renameProjects?: boolean
  section?: string // where it opens: a section's id, or project:<id>
  script?: keyof Scripts // a project's script tab to show
  skill?: SkillApi
  remote?: RemoteApi
  webhookTest?: (w: Webhook) => Promise<unknown> // Notifications webhook's Send test
  presets: Preset[] // the daemon's: the settings', or its defaults
}) {
  const { settings, apps, onSave, onClose } = p
  const [s, setS] = useState<AppSettings>(settings)
  const [sec, setSec] = useState(p.section ?? 'general')
  const [themeQ, setThemeQ] = useState('') // the themes' name filter
  const [findQ, setFindQ] = useState('') // Find a setting
  const findRef = useRef(findQ)
  findRef.current = findQ
  const [spot, setSpot] = useState<{ title: string; n: number }>() // the setting a result goes to
  const shownThemes = [...THEMES].reverse().filter(t => t.name.toLowerCase().includes(themeQ.trim().toLowerCase())) // the newest first
  // Appearance opens with the current theme in sight (there are many)
  useEffect(() => {
    if (sec === 'appearance') document.querySelector('.themes .theme.on')?.scrollIntoView({ block: 'nearest' })
  }, [sec])
  const set = (k: Partial<AppSettings>) => setS(x => ({ ...x, ...k }))
  // a theme under the mouse is painted, the chosen one again as it leaves the grid or the page closes
  const latest = useRef(s)
  latest.current = s
  useEffect(() => () => applyTheme(latest.current), [])
  // a result's setting, once its section is on: in sight and lit for a moment
  useEffect(() => {
    if (!spot) return
    const t = spot.title.toLowerCase()
    const el = [...document.querySelectorAll<HTMLElement>('.settings-main :is(h2, h3, label, .field, .switch-row, .switch-text, .muted.small)')].find(e => e.textContent?.trim().toLowerCase().startsWith(t))
    el?.scrollIntoView({ block: 'center' })
    el?.classList.add('spot')
    const off = setTimeout(() => el?.classList.remove('spot'), 1600)
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
        // a field of the wrong kind would be saved and break the pages that read it; ponytail: top level only
        const bad = Object.entries(v).filter(([k, x]) => KINDS[k] && x !== undefined && !KINDS[k].split(' ').includes(x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x))
        if (bad.length) throw new Error(`${bad.map(([k]) => k).join(', ')}: not what Laki keeps there`)
        paint(v)
        setMoved(`Imported ${f.name}`)
      })
      .catch(e => setMoved(`Couldn't import ${f.name}: ${e.message}`))
  // ⌘+ / ⌘− while the page is open change the size behind its back
  useEffect(() => setS(x => (x.fontSize === settings.fontSize ? x : { ...x, fontSize: settings.fontSize })), [settings.fontSize])
  useEffect(() => setS(x => (x.notify === settings.notify ? x : { ...x, notify: settings.notify })), [settings.notify]) // ⌘K's switch
  // the page grows with the terminal's font size, from 13px as 100%
  const scale = (s.fontSize ?? FONT_SIZE) / FONT_SIZE
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
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (findRef.current ? (e.stopPropagation(), setFindQ('')) : onClose()) // Esc clears a search first
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
  const sections = SECTIONS.filter(x => (x.id !== 'skill' || p.skill) && (x.id !== 'remote' || p.remote))
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
          {!findQ.trim() && SECTIONS.filter(x => (x.id !== 'skill' || p.skill) && (x.id !== 'remote' || p.remote)).map(x => (
            <button key={x.id} className={sec === x.id ? 'on' : ''} onClick={() => setSec(x.id)}>
              <Icon name={x.icon} /> {x.label}
            </button>
          ))}
          {!findQ.trim() && !!p.projects?.length && <div className="settings-nav-head">Projects</div>}
          {!findQ.trim() && p.projects?.map(x => (
            <button key={x.id} className={sec === `project:${x.id}` ? 'on' : ''} onClick={() => setSec(`project:${x.id}`)} data-tip={x.path}>
              <Icon name={x.git === false ? 'folder' : 'fork'} /> <span>{x.name}</span>
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
              onSave={o => p.onSaveProject?.(project.id, o)}
            />
          )}
          {sec === 'general' && (
            <>
              <h2>General</h2>
              <label>
                New workspaces start
                <select value={s.agent || 'claude'} onChange={e => set({ agent: e.target.value })}>
                  {presets.map(p => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                  <option value="shell">shell</option>
                  <option value="none">nothing</option>
                </select>
              </label>
              <label>
                <span>
                  Branch prefix <span className="muted">· for new worktrees' branches</span>
                </span>
                <input className="mono" value={s.branchPrefix ?? ''} placeholder="laki/" onChange={e => set({ branchPrefix: e.target.value })} />
              </label>
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
                <Switch className="switch-row" on={s.fun !== false} onChange={v => set({ fun: v })}>
                  <Says title="Fun button" hint="The smiley in the tab bar: a random meme from r/memes for a break (→ or N for another)" />
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
                <Switch className="switch-row" on={s.diffStat === true} onChange={v => set({ diffStat: v })}>
                  <Says title="Diff size in the sidebar" hint="Lines each workspace added and removed against its base, new files too; checked every 10 seconds" />
                </Switch>
                {Object.entries(USAGE_AGENTS).map(([a, name]) => (
                  <Switch key={a} className="switch-row" on={s.usage?.[a] !== false} onChange={v => set({ usage: { ...s.usage, [a]: v } })}>
                    <Says title={`${name} plan limits`} hint={`The status bar's ring: the 5-hour and weekly windows, read with ${name}'s own sign-in every 5 minutes`} />
                  </Switch>
                ))}
              </div>
              <label>
                <span>
                  Environment <span className="muted">· every session's (agents, shells, setup); a project's or preset's env wins. New sessions get it.</span>
                </span>
                <EnvField value={s.env} onChange={env => set({ env })} />
              </label>
              <div className="field">
                <span>
                  Move to another Mac <span className="muted">· every setting on these pages in a file (it holds your env: keep it private); projects and their own settings stay here</span>
                </span>
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
              </div>
            </>
          )}
          {sec === 'appearance' && (
            <>
              <h2>Appearance</h2>
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
              </div>
              <div className="field">
                <span>
                  Project names in the sidebar <span className="muted">· over the theme's</span>
                </span>
                {lookGrid('projectLook', PROJECT_LOOK)}
              </div>
              <div className="field">
                <span>
                  The sidebar <span className="muted">· over the theme's</span>
                </span>
                {lookGrid('sideLook', SIDE_LOOK)}
                <Switch className="switch-row" on={s.sideLook?.labels !== false} onChange={v => set({ sideLook: { ...s.sideLook, labels: v } })}>
                  <Says title="Button labels" hint="Words beside the buttons at the bottom of the sidebar: Tasks, Board, Settings" />
                </Switch>
              </div>
              <div className="setting-box">
                <Switch className="switch-row" on={!!s.glass} onChange={v => paint({ glass: v }) /* the window's own blur follows once saved */}>
                  <Says title="Glass" hint="A see-through window: the desktop shows through, blurred" />
                </Switch>
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
              </div>
              <div className="muted small">Terminals use the Terminal section's font. Themes marked ✦ also change shapes, borders and type.</div>
              <input type="search" className="theme-find" value={themeQ} placeholder={`Find a theme by name (${THEMES.length})`} spellCheck={false} onChange={e => setThemeQ(e.target.value)} />
              {!shownThemes.length && <div className="muted small">No theme called “{themeQ.trim()}”.</div>}
              <div className="themes" onMouseLeave={() => applyTheme(s)}>
                {shownThemes.map(t => {
                  const [bg, panel, fg, accent, ...ansi] = preview(t)
                  const on = (s.theme || 'default') === t.id
                  return (
                    <button
                      key={t.id}
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
                  )
                })}
              </div>
            </>
          )}
          {sec === 'terminal' && (
            <>
              <h2>Terminal</h2>
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
                <div className="checks">
                  <Switch className="switch-row" on={s.cursorBlink !== false} onChange={v => set({ cursorBlink: v })}>
                    Blinking cursor
                  </Switch>
                  <Switch className="switch-row" on={s.copyOnSelect !== false} onChange={v => set({ copyOnSelect: v })}>
                    Copy selected text
                  </Switch>
                  <Switch className="switch-row" on={!!s.dimPanes} onChange={v => set({ dimPanes: v })}>
                    Dim other panes
                  </Switch>
                </div>
              </div>
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
            </>
          )}
          {sec === 'open' && (
            <>
              <h2>Open in</h2>
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
            </>
          )}
          {sec === 'skill' && p.skill && <SkillSection api={p.skill} />}
          {sec === 'remote' && p.remote && <RemoteSection api={p.remote} mail={s.remoteMail ?? ''} onMail={remoteMail => set({ remoteMail })} />}
          {sec === 'webhook' && <WebhookSection w={s.webhook ?? {}} onChange={webhook => set({ webhook })} test={p.webhookTest} />}
          {sec === 'pr' && (
            <>
              <h2>Pull requests</h2>
              <p className="muted small">
                The status bar's <b>fix CI</b>, <b>review</b> and <b>fix conflicts</b> switches, on for a workspace with a PR, send these to its agent
                (when it's idle), and so do the info panel's send buttons. <code>{'{{pr}}'}</code> is the PR's number, <code>{'{{url}}'}</code> its link,{' '}
                <code>{'{{base}}'}</code> its base branch. Laki checks each PR with <code>gh</code> as often as you pick here, and a moment after an agent's turn ends.
              </p>
              <div className="grid2">
                {pick('Check pull requests every', 'prScan', PR_SCAN, [1, 2, 5, 10, 15, 30], n => (n === 1 ? '1 minute' : `${n} minutes`))}
                {pick('Tries in a row', 'prTries', PR_TRIES, [1, 2, 3, 5, 10], n => `${n} · then it's over to you`)}
              </div>
              <Switch className="switch-row" on={!!s.archiveMerged} onChange={v => set({ archiveMerged: v })}>
                <Says title="Archive workspace when its PR merges" hint="Only a clean one: nothing uncommitted or unpushed, no agent at work. A toast offers Undo; one left alone says merged in the sidebar." />
              </Switch>
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
            </>
          )}
          {sec === 'templates' && (
            <>
              <h2>Prompt templates</h2>
              <p className="muted small">
                Pick one under a new workspace's prompt and the agent gets it filled in: <code>{'{{prompt}}'}</code> is what you typed, <code>{'{{project}}'}</code> and{' '}
                <code>{'{{base}}'}</code> the project and base branch. A template without <code>{'{{prompt}}'}</code> gets the prompt after it. Each project can
                have its own too (its section below): they come first there.
              </p>
              <TemplatesField value={s.templates} onChange={templates => set({ templates })} />
            </>
          )}
          {sec === 'actions' && (
            <>
              <h2>Actions</h2>
              <p className="muted small">
                Run ▾ lists them for the workspace you're in. A prompt goes to its agent's tab (the focused one first), queued while the agent works; it's
                listed only while that agent runs there. A command goes to a terminal: the focused one, any other, or a new one. Projects add their own
                (Settings › the project), and one with the same name and kind replaces a global one.
              </p>
              <ActionsField value={s.actions} onChange={actions => set({ actions })} />
            </>
          )}
          {sec === 'presets' && (
            <>
              <h2>Agent presets</h2>
              <p className="muted small">
                How agents start. Each preset is in the new-tab menu and the new-workspace dialog. Args go after the command, before the prompt; env
                goes on top of the project's.
              </p>
              {presets.map((p, i) => (
                <div key={keys.current[i]} className="preset">
                  <div className="row">
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
                  <EnvField value={p.env} onChange={env => setPreset(i, { env: Object.keys(env).length ? env : undefined })} placeholder="env: KEY=value, one per line" />
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
