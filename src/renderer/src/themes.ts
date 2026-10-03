// Color themes (Settings → Appearance). A theme sets the CSS variables of both apps (laki-electron, laki-go) on
// <html>; 'default' keeps the app's own (:root in its stylesheet). The terminal's 16 colors are --ansi-0…15
// and termTheme() reads them. The same file is in both apps.

type Colors = {
  bg: string
  side: string
  panel: string
  raised: string // buttons, hovered rows
  line: string
  fg: string
  muted: string
  accent: string
  accentFg: string
  sel: string
  running: string
  waiting: string
  done: string
  error: string
  orange: string
  pink: string
  purple: string // a violet: a theme's magenta can be its pink
}
// grad: a gradient behind the sidebar and the terminals (Warp-style); side is then see-through
export type Theme = { id: string; name: string; light?: boolean; c?: Colors; ansi?: string[]; grad?: [string, string] }

export const THEMES: Theme[] = [
  { id: 'default', name: 'Midnight' },
  {
    id: 'dawn',
    name: 'Dawn',
    light: true,
    c: {
      bg: '#faf4ed', side: '#f2e9e1', panel: '#fffaf3', raised: '#ece2d8', line: '#dfd3c6', fg: '#3b3552', muted: '#857e98',
      accent: '#d7827e', accentFg: '#fffaf3', sel: '#e8d9cc', running: '#286983', waiting: '#c27a14', done: '#3f8a5a', error: '#b4637a',
      orange: '#d7827e', pink: '#c264a8', purple: '#907aa9',
    },
    ansi: ['#ece2d8', '#b4637a', '#3f8a5a', '#b3790f', '#286983', '#907aa9', '#3c8b97', '#575279',
      '#9893a5', '#c2516e', '#2f7a4a', '#c27a14', '#1f5d75', '#7a5fa0', '#2c7a85', '#26233a'],
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    c: {
      bg: '#1a1029', side: '#140b21', panel: '#221536', raised: '#2e1d47', line: '#3a2659', fg: '#f4e9ff', muted: '#a08bc0',
      accent: '#ff4fd8', accentFg: '#1a1029', sel: '#4b2a73', running: '#36f9f6', waiting: '#fede5d', done: '#72f1b8', error: '#fe4450',
      orange: '#ff8b39', pink: '#ff7edb', purple: '#9d8cff',
    },
    ansi: ['#2a1b3d', '#fe4450', '#72f1b8', '#fede5d', '#6d77ff', '#ff7edb', '#36f9f6', '#e8dcf7',
      '#6b5590', '#ff6b74', '#9dffd2', '#fff089', '#9aa0ff', '#ffa3e8', '#7ffffc', '#ffffff'],
  },
  {
    id: 'forest',
    name: 'Forest',
    c: {
      bg: '#1e2420', side: '#191e1b', panel: '#232b26', raised: '#2d3730', line: '#36423a', fg: '#d8d3ba', muted: '#879083',
      accent: '#a7c080', accentFg: '#1e2420', sel: '#3d4b40', running: '#7fbbb3', waiting: '#dbbc7f', done: '#a7c080', error: '#e67e80',
      orange: '#e69875', pink: '#d699b6', purple: '#a99bd9',
    },
    ansi: ['#2d3730', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d8d3ba',
      '#5c6a5f', '#f08e90', '#bcd498', '#e8cc94', '#95cbc4', '#e3acc6', '#9ad1a8', '#f0ecd8'],
  },
  {
    id: 'ember',
    name: 'Ember',
    c: {
      bg: '#1d1a17', side: '#171411', panel: '#252019', raised: '#312a21', line: '#3c3329', fg: '#ebdbb2', muted: '#a08f78',
      accent: '#fe8019', accentFg: '#1d1a17', sel: '#4a3b2a', running: '#83a598', waiting: '#fabd2f', done: '#b8bb26', error: '#fb4934',
      orange: '#fe8019', pink: '#d3869b', purple: '#b4a0e5',
    },
    ansi: ['#32302f', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#d5c4a1',
      '#7c6f64', '#ff6b57', '#d0d23e', '#ffd25a', '#9fc1b4', '#e5a0b3', '#a6d494', '#fbf1c7'],
  },
  {
    id: 'fjord',
    name: 'Fjord',
    c: {
      bg: '#2e3440', side: '#272c36', panel: '#323946', raised: '#3b4252', line: '#434c5e', fg: '#d8dee9', muted: '#8a93a6',
      accent: '#88c0d0', accentFg: '#2e3440', sel: '#4c566a', running: '#81a1c1', waiting: '#ebcb8b', done: '#a3be8c', error: '#bf616a',
      orange: '#d08770', pink: '#e39fc2', purple: '#a093d9',
    },
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#d06f79', '#b1d196', '#f0d399', '#8cafd2', '#c895bf', '#93ccdc', '#eceff4'],
  },
  {
    id: 'graphite',
    name: 'Graphite',
    c: {
      bg: '#1c1c1e', side: '#18181a', panel: '#232325', raised: '#2c2c2e', line: '#3a3a3c', fg: '#e5e5e7', muted: '#8e8e93',
      accent: '#0a84ff', accentFg: '#ffffff', sel: '#3a3a3c', running: '#64d2ff', waiting: '#ffd60a', done: '#30d158', error: '#ff453a',
      orange: '#ff9f0a', pink: '#ff7ab8', purple: '#bf5af2',
    },
    ansi: ['#2c2c2e', '#ff453a', '#30d158', '#ffd60a', '#0a84ff', '#bf5af2', '#64d2ff', '#d1d1d6',
      '#636366', '#ff6961', '#4ae374', '#ffe066', '#409cff', '#da8fff', '#8fe2ff', '#ffffff'],
  },
  {
    id: 'paper',
    name: 'Paper',
    light: true,
    c: {
      bg: '#fbfaf7', side: '#f3f1ec', panel: '#ffffff', raised: '#ebe8e1', line: '#dedad1', fg: '#24292f', muted: '#6e7781',
      accent: '#0969da', accentFg: '#ffffff', sel: '#d6e4f5', running: '#0969da', waiting: '#9a6700', done: '#1a7f37', error: '#cf222e',
      orange: '#bc4c00', pink: '#bf3989', purple: '#8250df',
    },
    ansi: ['#ebe8e1', '#cf222e', '#1a7f37', '#9a6700', '#0969da', '#8250df', '#1b7c83', '#57606a',
      '#8c959f', '#a40e26', '#116329', '#7d4e00', '#0550ae', '#6639ba', '#3192aa', '#24292f'],
  },
  // Warp-style: a gradient behind everything
  {
    id: 'cyberwave',
    name: 'Cyber Wave',
    grad: ['#051937', '#00577a'],
    c: {
      bg: '#04213f', side: '#05193780', panel: '#0a2747', raised: '#123a63', line: '#1d4a75', fg: '#e6f1ff', muted: '#7fa2c8',
      accent: '#00e1ff', accentFg: '#04213f', sel: '#1b4f80', running: '#00e1ff', waiting: '#ffd166', done: '#3ef0a4', error: '#ff5c8a',
      orange: '#ff9f5a', pink: '#ff7ad9', purple: '#c792ff',
    },
    ansi: ['#0a2747', '#ff5c8a', '#3ef0a4', '#ffd166', '#4da3ff', '#c792ff', '#00e1ff', '#cfe3ff',
      '#4c6f96', '#ff85a8', '#7dffc4', '#ffe08f', '#7dbcff', '#dab2ff', '#6ff0ff', '#ffffff'],
  },
  {
    id: 'koi',
    name: 'Koi',
    grad: ['#1f0a0a', '#6a2414'],
    c: {
      bg: '#3a1410', side: '#1f0a0a80', panel: '#2b100d', raised: '#45201a', line: '#5a2c22', fg: '#ffe9dc', muted: '#c49a86',
      accent: '#ff7a45', accentFg: '#1f0a0a', sel: '#6b2f22', running: '#ffb36b', waiting: '#ffd36b', done: '#9fd88a', error: '#ff5a5a',
      orange: '#ff7a45', pink: '#ff8fab', purple: '#b49cff',
    },
    ansi: ['#2b100d', '#ff5a5a', '#9fd88a', '#ffd36b', '#7fb2ff', '#e08aff', '#6fd6c8', '#f2d6c8',
      '#7a5045', '#ff7d7d', '#bdeaa8', '#ffe39a', '#a3c9ff', '#ecaaff', '#95e6da', '#fff4ec'],
  },
  {
    id: 'pinkcity',
    name: 'Pink City',
    grad: ['#2a0b33', '#8a2163'],
    c: {
      bg: '#4a1446', side: '#2a0b3380', panel: '#33103c', raised: '#4c1d52', line: '#6a2a68', fg: '#ffe6f4', muted: '#d29ac0',
      accent: '#ff6ec7', accentFg: '#2a0b33', sel: '#7d2d6f', running: '#7ad7ff', waiting: '#ffd36e', done: '#7cf0b2', error: '#ff5f7e',
      orange: '#ff9a6b', pink: '#ff6ec7', purple: '#a78bfa',
    },
    ansi: ['#33103c', '#ff5f7e', '#7cf0b2', '#ffd36e', '#8ab4ff', '#ff6ec7', '#7ad7ff', '#f5d9ea',
      '#8a5585', '#ff8299', '#a6f7cc', '#ffe197', '#aecbff', '#ff9ad8', '#a6e6ff', '#ffffff'],
  },
  {
    id: 'leafy',
    name: 'Leafy',
    grad: ['#0b2017', '#25553a'],
    c: {
      bg: '#13301f', side: '#0b201780', panel: '#112a1c', raised: '#1d3d2a', line: '#2a5238', fg: '#e8f5e9', muted: '#93b89c',
      accent: '#7ee081', accentFg: '#0b2017', sel: '#2c5a3b', running: '#7cc7ff', waiting: '#f2d16b', done: '#7ee081', error: '#ff7b72',
      orange: '#ffa45c', pink: '#f59ac8', purple: '#b99cff',
    },
    ansi: ['#112a1c', '#ff7b72', '#7ee081', '#f2d16b', '#7cc7ff', '#d2a8ff', '#5fd7c0', '#d9ecdc',
      '#4f7a5c', '#ff9d96', '#a7f0a9', '#f7e095', '#a5d8ff', '#e2c4ff', '#8be6d4', '#ffffff'],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    grad: ['#06202a', '#2b1650'],
    c: {
      bg: '#0f1d33', side: '#0a162880', panel: '#122440', raised: '#1b3152', line: '#25406a', fg: '#e4f6f2', muted: '#8fb3b5',
      accent: '#5ef2c4', accentFg: '#06202a', sel: '#264d6b', running: '#5ec8f2', waiting: '#f2d35e', done: '#5ef2c4', error: '#ff6b8b',
      orange: '#ffa36b', pink: '#ff8bd1', purple: '#b39dff',
    },
    ansi: ['#122440', '#ff6b8b', '#5ef2c4', '#f2d35e', '#6fa8ff', '#c08bff', '#5ec8f2', '#d6ebe8',
      '#4f6d85', '#ff8fa6', '#8ff7d6', '#f7e08f', '#9cc3ff', '#d4adff', '#8fdcf7', '#ffffff'],
  },
  {
    id: 'snowy',
    name: 'Snowy',
    light: true,
    grad: ['#f7fbfe', '#d3e4f2'],
    c: {
      bg: '#ffffff', side: '#ffffff80', panel: '#ffffff', raised: '#e6eef5', line: '#c9d8e5', fg: '#1f2d3d', muted: '#6b7f93',
      accent: '#2b7bd6', accentFg: '#ffffff', sel: '#cfe2f6', running: '#2b7bd6', waiting: '#b7791f', done: '#2f855a', error: '#c53030',
      orange: '#dd6b20', pink: '#b83280', purple: '#805ad5',
    },
    ansi: ['#e6eef5', '#c53030', '#2f855a', '#b7791f', '#2b6cb0', '#805ad5', '#2c7a7b', '#4a5568',
      '#a0aec0', '#e53e3e', '#38a169', '#d69e2e', '#3182ce', '#9f7aea', '#319795', '#1a202c'],
  },
]

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
const PREVIEW = ['--bg', '--panel', '--fg', '--accent', '--ansi-1', '--ansi-2', '--ansi-3', '--ansi-4', '--ansi-5']
// a variable as the stylesheet's :root has it (the default theme), whatever theme paints <html> now
function rootVar(v: string) {
  for (const sheet of Array.from(document.styleSheets))
    try {
      for (const r of Array.from(sheet.cssRules)) if (r instanceof CSSStyleRule && r.selectorText === ':root' && r.style.getPropertyValue(v)) return r.style.getPropertyValue(v).trim()
    } catch {} // another origin's sheet
  return ''
}
const gradient = (g: [string, string]) => `linear-gradient(135deg, ${g[0]}, ${g[1]})`

// a theme's colors for its card in Settings
export const preview = (t: Theme) => {
  const [bg, ...rest] = t.c && t.ansi ? [t.c.bg, t.c.panel, t.c.fg, t.c.accent, ...t.ansi.slice(1, 6)] : PREVIEW.map(rootVar)
  return [t.grad ? gradient(t.grad) : bg, ...rest]
}

// a gradient theme: terminals are see-through (xterm's allowTransparency, which costs some text quality)
export const transparent = (id?: string) => !!THEMES.find(t => t.id === id)?.grad

// paints <html> with a theme; an unknown id is the default
export function applyTheme(id?: string) {
  const t = THEMES.find(x => x.id === id) ?? THEMES[0]
  const st = document.documentElement.style
  for (const k of Array.from(st)) if (k.startsWith('--')) st.removeProperty(k)
  st.colorScheme = ''
  if (!t.c || !t.ansi) return
  const { c, ansi: a } = t
  // each color under both apps' names (Laki Electron's first, then Laki Go's)
  const vars: Record<string, string> = {
    '--bg': c.bg, '--app-bg': t.grad ? gradient(t.grad) : c.bg, '--term-bg': t.grad ? '#00000000' : c.bg, '--tab-sel': t.grad ? c.fg + '1f' : c.bg, '--side': c.side, '--panel': c.panel, '--raised': c.raised, '--hover': c.raised,
    '--line': c.line, '--fg': c.fg, '--muted': c.muted, '--dim': c.muted, '--accent': c.accent, '--accent-fg': c.accentFg, '--sel': c.sel,
    '--running': c.running, '--run': c.running, '--waiting': c.waiting, '--warn': c.waiting, '--done': c.done, '--ok': c.done,
    '--error': c.error, '--err': c.error, '--add': a[2], '--del': a[1], '--add-bg': a[2] + '1f', '--del-bg': a[1] + '1f', '--hunk': a[5],
    '--tc-red': a[1], '--tc-orange': c.orange, '--tc-yellow': a[3], '--tc-green': a[2], '--tc-teal': a[6], '--tc-blue': a[4], '--tc-purple': c.purple, '--tc-pink': c.pink,
  }
  a.forEach((x, i) => (vars[`--ansi-${i}`] = x))
  for (const [k, v] of Object.entries(vars)) st.setProperty(k, v)
  st.colorScheme = t.light ? 'light' : 'dark'
}

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

// xterm's theme from the current CSS variables
export function termTheme() {
  const t: Record<string, string> = {
    background: css('--term-bg'),
    foreground: css('--fg'),
    cursor: css('--accent'),
    cursorAccent: css('--term-bg'),
    selectionBackground: css('--sel'),
  }
  for (let i = 0; i < 16; i++) {
    const n = ANSI[i % 8]
    t[i < 8 ? n : 'bright' + n[0].toUpperCase() + n.slice(1)] = css(`--ansi-${i}`)
  }
  return t
}
