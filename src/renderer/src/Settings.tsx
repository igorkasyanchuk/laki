// The app's settings, a page of its own (⌘,): saved as you change them. The same file is in both apps
// (wb-superset, wb-spike); each app's daemon keeps the settings and its CSS styles the page.
import { FitAddon } from '@xterm/addon-fit'
import { type FontWeight, Terminal } from '@xterm/xterm'
import { useEffect, useMemo, useRef, useState } from 'react'
import { applyTheme, preview, termTheme, THEMES, transparent } from './themes'
import { Icon, IconButton, type IconName } from './ui'

// how an agent starts: claude or codex with extra args, or any command; env on top of the project's
export type Preset = { name: string; agent: 'claude' | 'codex' | 'command'; args?: string; cmd?: string; env?: Record<string, string> }

export type AppSettings = {
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
  theme?: string // themes.ts
  env?: Record<string, string> // every session's
  notify?: boolean
  presets?: Preset[]
}

export type AppInfo = { id: string; name: string } // somewhere a folder can open

export const DEFAULT_PRESETS: Preset[] = [
  { name: 'claude', agent: 'claude' },
  { name: 'codex', agent: 'codex' },
]
export const presetsOf = (s: AppSettings) => s.presets ?? DEFAULT_PRESETS

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
export const fontStack = (f?: string) => [f?.trim() && JSON.stringify(f.trim()), '"SF Mono"', 'Menlo', 'Monaco', 'monospace'].filter(Boolean).join(', ')

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
  const opts = () => ({ fontFamily: fontStack(s.fontFamily), fontSize: s.fontSize ?? FONT_SIZE, ...termLook(s), theme: termTheme(), allowTransparency: transparent(s.theme ?? '') })
  useEffect(() => {
    const term = new Terminal({ ...opts(), disableStdin: true, allowProposedApi: true, scrollback: 0 }) // transparency only takes at the start
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(box.current!)
    term.write(SAMPLE)
    setXt({ term, fit })
    return () => term.dispose()
  }, [])
  const look = JSON.stringify([s.fontFamily, s.fontSize, s.theme, termLook(s)])
  useEffect(() => {
    if (!xt) return
    Object.assign(xt.term.options, opts())
    xt.fit.fit()
  }, [xt, look])
  return <div className="term-preview" ref={box} />
}

const SCRIPTS = [
  { k: 'setup', label: 'Setup', hint: 'Runs in each new worktree, in a setup tab; agents and Run wait for it. $WB_PROJECT_PATH is the repo itself.', eg: 'npm install\ncp "$WB_PROJECT_PATH/.env" .env' },
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
          placeholder={file[t.k] ? `${file[t.k]}\n\n(the repo's .wb.json)` : t.eg}
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

export type ProjectConfig = Scripts & { env?: Record<string, string> }
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; config?: ProjectConfig }

// a project's page: name, scripts, env; saved as you type, like the rest
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
          Scripts <span className="muted">· for workspace setup, teardown and the Run button; empty: the repo's .wb.json</span>
        </span>
        <ScriptsField value={c} file={file} git={p.project.git} tab={p.script} onChange={x => setC(y => ({ ...y, ...x }))} />
      </div>
      <label>
        <span>
          Env <span className="muted">· for every tab, setup and teardown{file.env && Object.keys(file.env).length ? ` · .wb.json has ${Object.keys(file.env).join(', ')}` : ''}</span>
        </span>
        <EnvField value={c.env} onChange={env => setC(y => ({ ...y, env }))} />
      </label>
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
]

export function SettingsPage(p: {
  settings: AppSettings
  apps: AppInfo[]
  onSave: (s: AppSettings) => void
  onClose: () => void
  projects?: ProjectInfo[]
  projectFile?: (id: string) => Promise<ProjectConfig> // its .wb.json
  onSaveProject?: (id: string, o: { name?: string; config: ProjectConfig }) => unknown
  renameProjects?: boolean
  section?: string // where it opens: a section's id, or project:<id>
  script?: keyof Scripts // a project's script tab to show
}) {
  const { settings, apps, onSave, onClose } = p
  const [s, setS] = useState<AppSettings>(settings)
  const [sec, setSec] = useState(p.section ?? 'general')
  const set = (k: Partial<AppSettings>) => setS(x => ({ ...x, ...k }))
  // ⌘+ / ⌘− while the page is open change the size behind its back
  useEffect(() => setS(x => (x.fontSize === settings.fontSize ? x : { ...x, fontSize: settings.fontSize })), [settings.fontSize])
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
          {SECTIONS.map(x => (
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
                <input className="mono" value={s.branchPrefix ?? ''} placeholder="wb/" onChange={e => set({ branchPrefix: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={s.notify !== false} onChange={e => set({ notify: e.target.checked })} />
                Notify when an agent off screen waits or finishes
              </label>
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
              <div className="themes">
                {THEMES.map(t => {
                  const [bg, panel, fg, accent, ...ansi] = preview(t)
                  const on = (s.theme || 'default') === t.id
                  return (
                    <button
                      key={t.id}
                      className={`theme ${on ? 'on' : ''}`}
                      style={{ background: bg, color: fg }}
                      onClick={() => {
                        applyTheme(t.id) // now; the app applies it again once saved
                        set({ theme: t.id })
                      }}
                    >
                      <span className="theme-bar" style={{ background: panel }}>
                        <span style={{ background: accent }} />
                      </span>
                      <span className="theme-dots">
                        {ansi.map((c, i) => (
                          <span key={i} style={{ background: c }} />
                        ))}
                      </span>
                      <span className="theme-name">{t.name}</span>
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
                    <option value="">Default (SF Mono)</option>
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
                  <label className="check">
                    <input type="checkbox" checked={s.cursorBlink !== false} onChange={e => set({ cursorBlink: e.target.checked })} />
                    Blinking cursor
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={s.copyOnSelect !== false} onChange={e => set({ copyOnSelect: e.target.checked })} />
                    Copy selected text
                  </label>
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
                <TermPreview s={s} />
              </div>
              <p className="muted small">Ligatures (=&gt; as one glyph) aren't drawn: xterm needs an add-on for them that wb doesn't ship.</p>
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
