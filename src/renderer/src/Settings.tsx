// The app's settings, a page of its own (⌘,): saved as you change them. The same file is in both apps
// (wb-superset, wb-spike); each app's daemon keeps the settings and its CSS styles the page.
import { useEffect, useRef, useState } from 'react'
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
export const FONTS = ['SF Mono', 'Menlo', 'Monaco', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', 'Hack']
// a font name for xterm, with fallbacks
export const fontStack = (f?: string) => [f?.trim() && JSON.stringify(f.trim()), '"SF Mono"', 'Menlo', 'Monaco', 'monospace'].filter(Boolean).join(', ')

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

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'open', label: 'Open in', icon: 'code' },
  { id: 'presets', label: 'Agent presets', icon: 'agent' },
]

export function SettingsPage({ settings, apps, onSave, onClose }: { settings: AppSettings; apps: AppInfo[]; onSave: (s: AppSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(settings)
  const [sec, setSec] = useState('general')
  const set = (k: Partial<AppSettings>) => setS(x => ({ ...x, ...k }))
  // saved a moment after the last change
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const t = setTimeout(() => onSave(s), 300)
    return () => clearTimeout(t)
  }, [s])
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
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
  return (
    <div className="settings-page">
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
        </nav>
        <div className="settings-main form">
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
            </>
          )}
          {sec === 'terminal' && (
            <>
              <h2>Terminal</h2>
              <label>
                Font
                <input list="settings-fonts" value={s.fontFamily ?? ''} placeholder="SF Mono" onChange={e => set({ fontFamily: e.target.value })} />
                <datalist id="settings-fonts">
                  {FONTS.map(f => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>
                  Font size <span className="muted">· ⌘+ / ⌘− / ⌘0 anywhere</span>
                </span>
                <input type="number" min={8} max={32} value={s.fontSize ?? FONT_SIZE} onChange={e => set({ fontSize: Number(e.target.value) || FONT_SIZE })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={s.copyOnSelect !== false} onChange={e => set({ copyOnSelect: e.target.checked })} />
                Copy selected text to the clipboard
              </label>
              <div className="sample mono" style={{ fontFamily: fontStack(s.fontFamily), fontSize: s.fontSize ?? FONT_SIZE }}>
                ~/projects/app main ❯ npm run dev -- --port $PORT
              </div>
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
