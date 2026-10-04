// The app's settings, a page of its own (⌘,): saved as you change them. The daemon keeps
// the settings.
import { FitAddon } from '@xterm/addon-fit'
import { type FontWeight, Terminal } from '@xterm/xterm'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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

// how an agent starts: claude or codex with extra args, or any command; env on top of the project's
export type Preset = { name: string; agent: 'claude' | 'codex' | 'command'; args?: string; cmd?: string; env?: Record<string, string> }

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
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  presets?: Preset[]
  remoteMail?: string // the one address remote access lets in
}

export type AppInfo = { id: string; name: string } // somewhere a folder can open

export const DEFAULT_PRESETS: Preset[] = [
  { name: 'claude', agent: 'claude' },
  { name: 'codex', agent: 'codex' },
]
export const presetsOf = (s: AppSettings) => s.presets ?? DEFAULT_PRESETS

const EXAMPLE_TEMPLATE: Template = {
  name: 'fix',
  text: 'Fix this in {{project}}: {{prompt}}\n\nFind the cause first. Write a test that fails before the fix and passes after it, run the tests, then sum up what changed.',
}

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
  { k: 'teardown', label: 'Teardown', hint: 'Runs when a workspace is deleted or archived, for a minute at most.', eg: 'docker compose down' },
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

export type ProjectConfig = Scripts & { expose?: string; actions?: RunAction[]; env?: Record<string, string> } // expose: emails, *@domains
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; config?: ProjectConfig }

// a project's page: name, scripts, env; saved as you type, like the rest
const TARGETS: [RunAction['target'], string][] = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
  ['shell', 'Terminal'],
]
const ACTION_EG: Record<RunAction['target'], string> = {
  claude: 'Run a code review twice and fix what it finds',
  codex: 'Run $code-review and fix the findings',
  shell: 'bundle exec rails db:migrate',
}

// actions (Settings › Actions, a project's): a name, who it's for, and the prompt or command
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
    </>
  )
}

const WEIGHTS: Record<string, string> = { 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' }
const CONTRAST: Record<number, string> = { 1: "the theme's colors", 3: 'low (3:1)', 4.5: 'medium (4.5:1)', 7: 'high (7:1)' }

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'open', label: 'Open in', icon: 'code' },
  { id: 'presets', label: 'Agent presets', icon: 'agent' },
  { id: 'templates', label: 'Prompt templates', icon: 'pencil' },
  { id: 'actions', label: 'Actions', icon: 'run' },
  { id: 'skill', label: 'Agent skill', icon: 'import' },
  { id: 'remote', label: 'Remote access', icon: 'globe' },
]

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

export type SkillInfo = { agent: string; name: string; path: string; state: 'missing' | 'installed' | 'outdated' }
// how an app reads and writes its skill; app: its name, for the text
export type SkillApi = { app: string; load: () => Promise<SkillInfo[]>; set: (agent: string, on: boolean) => Promise<SkillInfo[]> }

// the skill that teaches Claude Code and Codex about the app, in the user's ~/.claude and ~/.codex
function SkillSection({ api }: { api: SkillApi }) {
  const [rows, setRows] = useState<SkillInfo[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
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
        Teaches Claude Code and Codex about {api.app}: list projects and workspaces, start a workspace with an agent and a prompt, message agents and read their screens, all
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
}) {
  const { settings, apps, onSave, onClose } = p
  const [s, setS] = useState<AppSettings>(settings)
  const [sec, setSec] = useState(p.section ?? 'general')
  const set = (k: Partial<AppSettings>) => setS(x => ({ ...x, ...k }))
  // theme, glass, interface font: painted now (the app paints again once saved)
  const paint = (k: Partial<AppSettings>) => (applyTheme({ ...s, ...k }), set(k))
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
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f, true) // before the preview terminal takes it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])

  const presets = presetsOf(s)
  const setPreset = (i: number, p: Partial<Preset>) => set({ presets: presets.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  // a key per preset card that survives removing one above it (names change as you type)
  const keys = useRef<number[]>([])
  while (keys.current.length < presets.length) keys.current.push(Math.random())
  const setPresets = (next: Preset[], drop?: number) => {
    if (drop !== undefined) keys.current.splice(drop, 1)
    if (next === DEFAULT_PRESETS) keys.current = []
    set({ presets: next })
  }
  const templates = s.templates ?? []
  const tkeys = useRef<number[]>([]) // like keys, for template cards
  while (tkeys.current.length < templates.length) tkeys.current.push(Math.random())
  const setTemplate = (i: number, t: Partial<Template>) => set({ templates: templates.map((x, j) => (j === i ? { ...x, ...t } : x)) })
  const setTemplates = (next: Template[], drop?: number) => {
    if (drop !== undefined) tkeys.current.splice(drop, 1)
    set({ templates: next })
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
  return (
    <div className="settings-page" style={{ zoom: scale }}>
      <div className="settings-head">
        <b>Settings</b>
        <span className="grow" />
        <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.filter(x => (x.id !== 'skill' || p.skill) && (x.id !== 'remote' || p.remote)).map(x => (
            <button key={x.id} className={sec === x.id ? 'on' : ''} onClick={() => setSec(x.id)}>
              <Icon name={x.icon} /> {x.label}
            </button>
          ))}
          {!!p.projects?.length && <div className="settings-nav-head">Projects</div>}
          {p.projects?.map(x => (
            <button key={x.id} className={sec === `project:${x.id}` ? 'on' : ''} onClick={() => setSec(`project:${x.id}`)} data-tip={x.path}>
              <Icon name="folder" /> {x.name}
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
                  <Says title="macOS notifications" hint="When an agent off screen waits or finishes, or CI keeps failing" />
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
              <div className="themes">
                {[...THEMES].reverse().map(t => { /* the newest first */
                  const [bg, panel, fg, accent, ...ansi] = preview(t)
                  const on = (s.theme || 'default') === t.id
                  return (
                    <button
                      key={t.id}
                      className={`theme ${on ? 'on' : ''}`}
                      style={{ background: bg, color: fg }}
                      onClick={() => paint({ theme: t.id })}
                    >
                      <span className="theme-bar" style={{ background: panel }}>
                        <span style={{ background: accent }} />
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
                    .filter(a => a.id !== 'custom')
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
          {sec === 'templates' && (
            <>
              <h2>Prompt templates</h2>
              <p className="muted small">
                Pick one under a new workspace's prompt and the agent gets it filled in: <code>{'{{prompt}}'}</code> is what you typed, <code>{'{{project}}'}</code> and{' '}
                <code>{'{{base}}'}</code> the project and base branch. A template without <code>{'{{prompt}}'}</code> gets the prompt after it.
              </p>
              {templates.map((t, i) => (
                <div key={tkeys.current[i]} className="preset">
                  <div className="row">
                    <input value={t.name} placeholder="name" onChange={e => setTemplate(i, { name: e.target.value })} />
                    <IconButton icon="trash" title="Remove template" onClick={() => setTemplates(templates.filter((_, j) => j !== i), i)} />
                  </div>
                  <textarea className="mono" rows={5} spellCheck={false} value={t.text} placeholder="Fix this: {{prompt}}" onChange={e => setTemplate(i, { text: e.target.value })} />
                </div>
              ))}
              <div className="row">
                <button onClick={() => setTemplates([...templates, templates.length ? { name: `template-${templates.length + 1}`, text: '{{prompt}}' } : EXAMPLE_TEMPLATE])}>
                  <Icon name="plus" /> Add template
                </button>
              </div>
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
                      <option value="claude">Claude Code</option>
                      <option value="codex">Codex</option>
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
                      placeholder={p.agent === 'claude' ? '--model opus --permission-mode acceptEdits' : '--model gpt-5 --full-auto'}
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
                {JSON.stringify(presets) !== JSON.stringify(DEFAULT_PRESETS) && (
                  <button className="link" onClick={() => setPresets(DEFAULT_PRESETS)}>
                    Reset to claude and codex
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
