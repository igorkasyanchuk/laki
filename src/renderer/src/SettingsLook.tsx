// Settings › Appearance's type: a font picked from every one this Mac has, the sidebar's look as App puts it on the
// sidebar (data-ph-*, --ph-*, --side-font and SideLook's variables), and live previews of the interface's text and of
// the sidebar. Settings.tsx re-exports it; App.tsx takes the sidebar's attributes from here.
import { type CSSProperties, useState } from 'react'
import type { ProjectLook, SideLook } from '../../shared/types'
import { UI_FONTS } from './themes'
import { Glyph } from './Glyph'
import { Icon } from './ui'

// Settings › Appearance › Project names: what's not the theme's goes on the sidebar, as data-ph-* (styles.css) and
// the values as --ph-* (spacing, size, weight: any CSS value; a font by its name: data-ph-font custom, --ph-font)
const own = (pl: ProjectLook | undefined, k: keyof ProjectLook) => (pl?.[k] && pl[k] !== 'theme' ? pl[k] : undefined)
const named = (f?: string) => !!f && f !== 'ui' && f !== 'mono'
const fontVar = (f: string) => `${JSON.stringify(f)}, var(--ui-font)`
export const phAttrs = (pl?: ProjectLook) => Object.fromEntries((['font', 'case', 'spacing', 'size', 'weight'] as const).flatMap(k => (own(pl, k) ? [[`data-ph-${k}`, k === 'font' ? (named(own(pl, k)) ? 'custom' : own(pl, k)) : k === 'case' ? own(pl, k) : '']] : [])))
export const phVars = (pl?: ProjectLook) => ({ ...Object.fromEntries((['spacing', 'size', 'weight'] as const).flatMap(k => (own(pl, k) ? [[`--ph-${k}`, own(pl, k)]] : []))), ...(named(own(pl, 'font')) && { '--ph-font': fontVar(own(pl, 'font')!) }) }) as CSSProperties
// …and its lines and rows (SideLook): the variables looks set (styles.css .project-ws), nearer than the theme's; its font
const SIDE_VARS = { guide: '--ws-guide', divider: '--proj-divider', indent: '--ws-indent', rows: '--ws-h', text: '--ws-font', icons: '--ws-icon', head: '--ph-h', gap: '--proj-gap', rowGap: '--ws-gap' } as const
export const sideVars = (sl?: SideLook) => ({ ...Object.fromEntries((Object.keys(SIDE_VARS) as (keyof typeof SIDE_VARS)[]).flatMap(k => (sl?.[k] && sl[k] !== 'theme' ? [[SIDE_VARS[k], sl[k]]] : []))), ...(sl?.font && { '--side-font': fontVar(sl.font) }) }) as CSSProperties
export const sideAttrs = (sl?: SideLook, pl?: ProjectLook) => ({ ...phAttrs(pl), ...(sl?.font && { 'data-side-font': '' }) })

// every font family this Mac has (the Local Font Access API: main allows the app's own pages), read as a list first
// opens and kept; none (an older Chromium, a browser elsewhere): the bundled and common ones
let local: string[] | undefined
async function localFonts() {
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (q) local = [...new Set((await q()).map(f => f.family))].sort((a, b) => a.localeCompare(b))
  } catch {
    // not allowed: the short list
  }
  return local ?? []
}
const SHORT = [...new Set([...UI_FONTS.filter(f => f !== 'system'), 'SF Pro', 'SF Mono', 'Menlo', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'])].sort((a, b) => a.localeCompare(b))
const LAKI = ['Inter', 'Geist', 'IBM Plex Sans', 'Roboto', 'Source Sans 3', 'Fira Sans', 'Manrope'] // look.css's own, bundled
const opt = (f: string) => (
  <option key={f} value={f}>
    {f}
  </option>
)
// a select of fonts by name, in groups: first (unset's word, the theme's…), Laki's own, dev (the terminal's monospace
// ones this Mac draws, Settings' installedFonts), then the rest this Mac has; value '' or one of them
export function FontPick({ value, first, onChange, label, dev = [] }: { value: string; first: [string, string][]; onChange: (v: string) => void; label?: string; dev?: string[] }) {
  const [all, setAll] = useState(local ?? [])
  const load = () => void (!local && localFonts().then(f => f.length && setAll(f)))
  const mac = (all.length ? all : SHORT).filter(f => !LAKI.includes(f) && !dev.includes(f))
  const known = [...first.map(f => f[0]), ...LAKI, ...dev, ...mac]
  return (
    <select value={value} aria-label={label} onPointerDown={load} onFocus={load} onChange={e => onChange(e.target.value)}>
      {first.map(([v, name]) => (
        <option key={v} value={v}>
          {name}
        </option>
      ))}
      {value && !known.includes(value) && opt(value)}
      <optgroup label="Laki's own">{LAKI.map(opt)}</optgroup>
      {dev.length > 0 && <optgroup label="For developers (monospace)">{dev.map(opt)}</optgroup>}
      <optgroup label="On this Mac">{mac.map(opt)}</optgroup>
    </select>
  )
}

// the interface's text as it is now: two tabs, a menu, the status bar, a tooltip (the app's own classes, so its
// Text size and font apply as they do in the window)
export function InterfacePreview() {
  return (
    <div className="ui-preview" aria-hidden>
      <div className="tabbar">
        <div className="tab sel">
          <Icon name="agent" size={12} /> claude: csv export
        </div>
        <div className="tab">
          <Icon name="terminal" size={12} /> shell
        </div>
      </div>
      <div className="ui-preview-mid">
        <div className="menu rich">
          <div className="menu-head">Open in</div>
          <div className="menu-item sel">
            <span className="menu-icon">
              <Icon name="code" size={14} />
            </span>
            <span className="menu-text">
              <span className="menu-label">
                <span>Cursor</span>
              </span>
              <span className="menu-sub">The folder in your editor</span>
            </span>
            <span className="menu-key">E</span>
          </div>
          <div className="menu-item">
            <span className="menu-icon">
              <Icon name="folder" size={14} />
            </span>
            <span className="menu-text">
              <span className="menu-label">
                <span>Finder</span>
              </span>
            </span>
          </div>
        </div>
        <div className="tip">A tooltip says what a button does</div>
      </div>
      <div className="status">
        <span>
          <Icon name="fork" size={11} /> laki/csv-export
        </span>
        <span>$PORT 3440</span>
        <span>Artifacts: 2</span>
      </div>
    </div>
  )
}

// a design in small (Appearance › Design): the rail, the sidebar with a project, the tabs, two panes and the side panel,
// drawn by styles.css' .dz in this theme's colors
export function DesignMini({ traits }: { traits: string }) {
  return (
    <div className="dz" data-dz={traits || undefined} aria-hidden>
      <i className="dz-rail" />
      <div className="dz-side">
        <i className="dz-proj" />
        <i className="dz-proj" />
      </div>
      <div className="dz-main">
        <div className="dz-tabs">
          <i className="on" />
          <i />
        </div>
        <div className="dz-body">
          <div className="dz-wrap">
            <i className="dz-term" />
            <i className="dz-term" />
          </div>
          <i className="dz-panel" />
        </div>
        <i className="dz-status" />
      </div>
    </div>
  )
}

// the sidebar with these settings: a project's head and three rows (the app's own classes and attributes)
export function SidePreview({ sl, pl, style }: { sl?: SideLook; pl?: ProjectLook; style?: string }) {
  const rows: [string, string, boolean][] = [
    ['csv-export', 'running', true],
    ['fix-login-redirect', 'waiting', false],
    ['docs-typos', 'idle', false],
  ]
  return (
    <div className="side-preview sidebar" data-style={style ?? 'default'} style={{ ...phVars(pl), ...sideVars(sl) }} {...sideAttrs(sl, pl)} aria-hidden>
      <div className="project">
        <div className="project-head">
          <span className="project-chev">
            <Icon name="chevron" size={12} />
          </span>
          <span className="project-icon">
            <Icon name="fork" size={12} />
          </span>
          <span className="project-name">shop</span>
          <span className="project-count">3</span>
        </div>
        <div className="project-ws">
          {rows.map(([name, state, sel]) => (
            <div key={name} className={`ws ${sel ? 'sel' : ''}`} data-state={state}>
              <Glyph s={state} />
              <span className="ws-name">{name}</span>
              <span className="spacer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Appearance › Custom CSS's guide: the variables most worth changing (each as this theme has it, a click copies
// var(--name)), where things are, and examples a click adds to your CSS
const VARS: [string, string][] = [
  ['--accent', 'The accent: buttons, links, the picked row'],
  ['--bg', "The main area's background"],
  ['--side', "The sidebar's and the bars' background"],
  ['--panel', 'Menus, dialogs, cards'],
  ['--fg', 'Text'],
  ['--muted', 'Secondary text, hints'],
  ['--line', 'Borders and dividers'],
  ['--sel', 'A selected row'],
  ['--hover', 'A row under the mouse'],
  ['--running', 'An agent working'],
  ['--waiting', 'An agent waiting for you'],
  ['--done', 'An agent done'],
  ['--error', 'Errors, a failed check'],
  ['--add', "Changes' added lines"],
  ['--del', "Changes' removed lines"],
  ['--radius', 'Corners (also Appearance › Corners)'],
  ['--ui-font', 'The interface font (also Interface › Font)'],
  ['--mono', 'Code, paths, the diff'],
  ['--term-bg', "The terminals' background"],
]
const WHERE: [string, string][] = [
  ['.sidebar', 'the sidebar'],
  ['.project-name', "a project's name"],
  ['.ws', "a workspace's row (.ws.sel: the selected one)"],
  ['.tabbar, .tab', 'the tab bar, a tab (.tab.sel)'],
  ['.status', 'the status bar'],
  ['.side-panel', 'the right panel'],
  ['.menu, .menu-item', 'menus'],
  ['.tip', 'tooltips'],
  ['.rail', 'the rail on the left'],
]
const EXAMPLES: [string, string][] = [
  ['Another accent', ':root { --accent: #ff7a59; }'],
  ['Project names in the accent', '.project-name { color: var(--accent); }'],
  ['Bigger workspace names', '.sidebar .ws { font-size: 14px; }'],
  ['A bolder selected row', '.ws.sel { background: color-mix(in srgb, var(--accent) 22%, transparent); }'],
  ['Softer lines', ':root { --line: color-mix(in srgb, var(--fg) 8%, transparent); }'],
  ['Taller tabs', '.tab { height: 34px; }'],
  ['A roomier status bar', '.status { height: 26px; font-size: 12px; }'],
  ['Square corners', ':root { --radius: 0px; --rs: 0px; }'],
]
export function CssGuide({ onAdd, open }: { onAdd: (css: string) => void; open: boolean }) {
  const now = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
  const [copied, setCopied] = useState('')
  const [first] = useState(open) // as the page opens: CSS added or typed then doesn't fold it under you
  const copy = (v: string) => void navigator.clipboard?.writeText(`var(${v})`).then(() => (setCopied(v), setTimeout(() => setCopied(c => (c === v ? '' : c)), 1200)))
  return (
    <details className="css-guide" open={first}>
      <summary>How it works: variables, where things are, examples</summary>
      <p className="muted small">
        Rules here go over the app's, in every window, as you type. Change a variable in <code>:root</code> and everything that uses it follows (the theme sets them; yours win). Aim at a part by its class. Development mode's
        picker (Settings › General) shows any element's classes.
      </p>
      <h4 className="set-sub">Variables</h4>
      <div className="css-vars">
        {VARS.map(([v, what]) => (
          <button key={v} type="button" className="css-var" data-tip={`${what} · now ${now(v) || 'unset'} · click to copy var(${v})`} onClick={() => copy(v)}>
            <span className="css-swatch" style={{ background: /color|font|radius|mono/.test(v) ? undefined : `var(${v})` }} />
            <code>{copied === v ? 'copied' : v}</code>
            <span className="muted">{what}</span>
          </button>
        ))}
      </div>
      <h4 className="set-sub">Where things are</h4>
      <div className="css-where">
        {WHERE.map(([sel, what]) => (
          <span key={sel}>
            <code>{sel}</code> <span className="muted">{what}</span>
          </span>
        ))}
      </div>
      <h4 className="set-sub">Examples</h4>
      <div className="css-examples">
        {EXAMPLES.map(([name, css]) => (
          <div key={name} className="css-example">
            <span>{name}</span>
            <code>{css}</code>
            <button type="button" onClick={() => onAdd(css)}>
              Add
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}
