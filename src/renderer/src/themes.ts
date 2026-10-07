// Color themes (Settings → Appearance). A theme sets the app's CSS variables on
// <html>; 'default' keeps the app's own (:root in its stylesheet). The terminal's 16 colors are --ansi-0…15
// and termTheme() reads them. A theme with a look also changes shapes, borders, shadows and type (look.css,
// <html data-look>). Glass makes the window see-through, as much as its sliders say.

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
// grad: a gradient behind the sidebar and the terminals (Warp-style); side is then see-through.
// look: look.css's [data-look] rules for it
export type Theme = { id: string; name: string; light?: boolean; c?: Colors; ansi?: string[]; grad?: [string, string]; look?: string }

export const THEMES: Theme[] = [
  { id: 'default', name: 'Midnight' },
  {
    id: 'dawn',
    name: 'Dawn',
    light: true,
    c: {
      bg: '#faf4ed', side: '#f2e9e1', panel: '#fffaf3', raised: '#ece2d8', line: '#dfd3c6', fg: '#3b3552', muted: '#857e98',
      accent: '#d7827e', accentFg: '#26233a', sel: '#e8d9cc', running: '#286983', waiting: '#c27a14', done: '#3f8a5a', error: '#b4637a',
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
    id: 'velvet',
    name: 'Velvet',
    c: {
      bg: '#1e1e2e', side: '#181825', panel: '#24243a', raised: '#313244', line: '#3b3d52', fg: '#cdd6f4', muted: '#9095b3',
      accent: '#cba6f7', accentFg: '#1e1e2e', sel: '#45475a', running: '#89b4fa', waiting: '#f9e2af', done: '#a6e3a1', error: '#f38ba8',
      orange: '#fab387', pink: '#f5c2e7', purple: '#b4befe',
    },
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f5a3ba', '#bcebb8', '#fbebc4', '#a3c5fb', '#f9d3ee', '#ade9df', '#e2e8fa'],
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    c: {
      bg: '#1a1b26', side: '#16161e', panel: '#1f2132', raised: '#292e42', line: '#2f3549', fg: '#c0caf5', muted: '#7a82ab',
      accent: '#7aa2f7', accentFg: '#1a1b26', sel: '#364a82', running: '#7dcfff', waiting: '#e0af68', done: '#9ece6a', error: '#f7768e',
      orange: '#ff9e64', pink: '#f39bd1', purple: '#bb9af7',
    },
    ansi: ['#292e42', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#545c7e', '#ff8ea3', '#b3e07f', '#ecc184', '#94b6ff', '#cbb0ff', '#9dddff', '#c0caf5'],
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
  {
    id: 'mist',
    name: 'Mist',
    light: true,
    c: {
      bg: '#eff1f5', side: '#e6e9ef', panel: '#f7f8fa', raised: '#dce0e8', line: '#ccd0da', fg: '#4c4f69', muted: '#767990',
      accent: '#8839ef', accentFg: '#ffffff', sel: '#dcd4f7', running: '#1e66f5', waiting: '#b8730c', done: '#40a02b', error: '#d20f39',
      orange: '#fe640b', pink: '#d55ab5', purple: '#8839ef',
    },
    ansi: ['#dce0e8', '#d20f39', '#40a02b', '#b8730c', '#1e66f5', '#8839ef', '#179299', '#5c5f77',
      '#9ca0b0', '#e64553', '#2f8a1f', '#9c6108', '#1550c7', '#7028d6', '#0f7a80', '#3a3d55'],
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
    id: 'sunset',
    name: 'Sunset',
    grad: ['#1c1240', '#8c3b2b'],
    c: {
      bg: '#3a1d3c', side: '#1c124080', panel: '#2a1838', raised: '#43264a', line: '#5a3358', fg: '#fff0e8', muted: '#c9a3a8',
      accent: '#ffab5e', accentFg: '#1c1240', sel: '#6e3550', running: '#7fc8ff', waiting: '#ffd36b', done: '#8fe0a0', error: '#ff6b6b',
      orange: '#ffab5e', pink: '#ff8fb8', purple: '#b9a0ff',
    },
    ansi: ['#2a1838', '#ff6b6b', '#8fe0a0', '#ffd36b', '#7fa8ff', '#e09cff', '#6fd8d0', '#f2dcd6',
      '#7a5470', '#ff8f8f', '#b2efbf', '#ffe39a', '#a6c3ff', '#ecbcff', '#97e8e1', '#ffffff'],
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
  // looks: more than colors (look.css)
  {
    id: 'phosphor',
    name: 'Phosphor',
    look: 'retro',
    c: {
      bg: '#050a06', side: '#07100a', panel: '#0a160d', raised: '#0f2214', line: '#1d4a28', fg: '#7dff9a', muted: '#46b864',
      accent: '#ffb000', accentFg: '#050a06', sel: '#123a1c', running: '#7dff9a', waiting: '#ffb000', done: '#b6ff6a', error: '#ff5f56',
      orange: '#ff9f1c', pink: '#ff7edb', purple: '#b39cff',
    },
    ansi: ['#0f2214', '#ff5f56', '#7dff9a', '#ffb000', '#5fd7ff', '#d787ff', '#5fffd7', '#b8ffc8',
      '#2f6b3d', '#ff8a80', '#a8ffbc', '#ffd166', '#8ae0ff', '#e3a8ff', '#8affe3', '#e8ffee'],
  },
  {
    id: 'neon',
    name: 'Neon Arcade',
    look: 'neon',
    c: {
      bg: '#0d0221', side: '#0a011a', panel: '#150535', raised: '#1f0a4a', line: '#2e1065', fg: '#f0e6ff', muted: '#9b86c9',
      accent: '#ff2a6d', accentFg: '#0d0221', sel: '#3b0f6e', running: '#05d9e8', waiting: '#ffd319', done: '#00ff9f', error: '#ff2a6d',
      orange: '#ff8c42', pink: '#ff2a6d', purple: '#b967ff',
    },
    ansi: ['#1f0a4a', '#ff2a6d', '#00ff9f', '#ffd319', '#05d9e8', '#b967ff', '#01ffc3', '#e0d4ff',
      '#5a3e99', '#ff5c8f', '#5cffbf', '#ffe066', '#4de9f2', '#d199ff', '#5cffd8', '#ffffff'],
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    light: true,
    look: 'brutal',
    c: {
      bg: '#fffdf2', side: '#fff6c7', panel: '#ffffff', raised: '#f2ecd0', line: '#111111', fg: '#111111', muted: '#5c564a',
      accent: '#ffd400', accentFg: '#111111', sel: '#ffe866', running: '#0047ff', waiting: '#a85c00', done: '#007a3d', error: '#d40000',
      orange: '#ff6a00', pink: '#e0007a', purple: '#6a00ff',
    },
    ansi: ['#f2ecd0', '#d00000', '#007a3d', '#a86400', '#0047ff', '#6a00ff', '#007c8a', '#333333',
      '#8a8576', '#ff2a2a', '#00a352', '#c27a00', '#3366ff', '#8a33ff', '#00a0b0', '#000000'],
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    light: true,
    look: 'bubble',
    c: {
      bg: '#fff5fa', side: '#ffe9f4', panel: '#ffffff', raised: '#ffe0ef', line: '#f6c9df', fg: '#4a2b45', muted: '#9a7090',
      accent: '#ff5fa2', accentFg: '#3a0a28', sel: '#ffd3e8', running: '#4f7fe0', waiting: '#c27800', done: '#23946c', error: '#e5484d',
      orange: '#ff8a3d', pink: '#ff5fa2', purple: '#9b6bff',
    },
    ansi: ['#ffe0ef', '#e5484d', '#23946c', '#c27800', '#4f7fe0', '#9b6bff', '#1f9fb0', '#6d4a66',
      '#c4a3b8', '#ff6b70', '#2fb383', '#e09a1a', '#7aa5ff', '#b48cff', '#36bccd', '#3a2236'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    look: 'blueprint',
    c: {
      bg: '#123c73', side: '#0f3466', panel: '#164682', raised: '#1d5296', line: '#3d6fae', fg: '#e8f1ff', muted: '#a4c0e8',
      accent: '#ffffff', accentFg: '#123c73', sel: '#2a64ad', running: '#9fd8ff', waiting: '#ffe08a', done: '#a8f0c6', error: '#ffa8a8',
      orange: '#ffc48a', pink: '#ffb8e0', purple: '#d0bcff',
    },
    ansi: ['#164682', '#ff9a9a', '#a8f0c6', '#ffe08a', '#9fd8ff', '#d0bcff', '#8ef0f0', '#e8f1ff',
      '#5a86c2', '#ffb8b8', '#c4f7d9', '#fff0b3', '#c2e6ff', '#e2d4ff', '#b3f7f7', '#ffffff'],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    look: 'cyber',
    c: {
      bg: '#0a0a0f', side: '#0d0d14', panel: '#12121c', raised: '#1c1c2b', line: '#2c2c42', fg: '#e8f6ff', muted: '#8391a8',
      accent: '#fcee0a', accentFg: '#0a0a0f', sel: '#2e2b0c', running: '#00f0ff', waiting: '#fcee0a', done: '#39ff88', error: '#ff003c',
      orange: '#ff7a00', pink: '#ff2e97', purple: '#a855f7',
    },
    ansi: ['#1c1c2b', '#ff003c', '#39ff88', '#fcee0a', '#2d7bff', '#ff2e97', '#00f0ff', '#d6e4f0',
      '#4b4b6b', '#ff4d6d', '#7dffb0', '#fff35c', '#6aa0ff', '#ff6eb5', '#6ff7ff', '#ffffff'],
  },
  {
    id: 'deco',
    name: 'Art Deco',
    look: 'deco',
    c: {
      bg: '#0f1517', side: '#0b1012', panel: '#151c1f', raised: '#1e272a', line: '#4a4128', fg: '#f1e8d2', muted: '#a59c84',
      accent: '#d4af37', accentFg: '#0f1517', sel: '#2b2a1b', running: '#6fc3c9', waiting: '#e0b04a', done: '#93c48e', error: '#e0705f',
      orange: '#dc8b4a', pink: '#d68fab', purple: '#a993cf',
    },
    ansi: ['#1e272a', '#e0705f', '#93c48e', '#e0b04a', '#6f9fd8', '#a993cf', '#6fc3c9', '#e4dcc6',
      '#5c5848', '#f08f7f', '#b2dcae', '#f2cd72', '#93bdf0', '#c6b3e8', '#93dde2', '#fffaf0'],
  },
  {
    id: 'classic',
    name: 'Classic',
    light: true,
    look: 'classic',
    c: {
      bg: '#ffffff', side: '#c0c0c0', panel: '#c0c0c0', raised: '#d4d0c8', line: '#808080', fg: '#000000', muted: '#3c3c3c',
      accent: '#000080', accentFg: '#ffffff', sel: '#b4cdf0', running: '#000080', waiting: '#806000', done: '#007000', error: '#c00000',
      orange: '#c05800', pink: '#b0008a', purple: '#5a00b4',
    },
    ansi: ['#c0c0c0', '#aa0000', '#007000', '#806000', '#0000aa', '#aa00aa', '#007878', '#404040',
      '#808080', '#e00000', '#00a000', '#a08000', '#0000ff', '#c000c0', '#00a0a0', '#000000'],
  },
  {
    id: 'notebook',
    name: 'Notebook',
    light: true,
    look: 'notebook',
    c: {
      bg: '#fbf8f1', side: '#f4eee0', panel: '#fffdf8', raised: '#efe7d6', line: '#d8cdb4', fg: '#2a2933', muted: '#7a7466',
      accent: '#2f5fd0', accentFg: '#ffffff', sel: '#fff1a0', running: '#2f5fd0', waiting: '#b7791f', done: '#2f855a', error: '#d64545',
      orange: '#dd6b20', pink: '#c2417a', purple: '#6b46c1',
    },
    ansi: ['#efe7d6', '#d64545', '#2f855a', '#a8700f', '#2f5fd0', '#6b46c1', '#2c7a7b', '#4a4752',
      '#a39d8c', '#e05555', '#38a169', '#c98a1a', '#4a7be0', '#805ad5', '#319795', '#1d1c24'],
  },
  {
    id: 'aqua',
    name: 'Aqua',
    light: true,
    look: 'aqua',
    c: {
      bg: '#ffffff', side: '#eceef2', panel: '#f7f7f8', raised: '#e6e7ea', line: '#bcbfc6', fg: '#1b1b1f', muted: '#6a6d75',
      accent: '#2f7de1', accentFg: '#ffffff', sel: '#c9ddf9', running: '#1f6fd6', waiting: '#b06d00', done: '#2b8a3e', error: '#d0342c',
      orange: '#e07b00', pink: '#d6337f', purple: '#7b4fd6',
    },
    ansi: ['#e6e7ea', '#c4302b', '#2b8a3e', '#a86a00', '#1f6fd6', '#8a3fd1', '#13879a', '#3b3d44',
      '#9a9da6', '#e0443e', '#38a852', '#c98400', '#3d8bf0', '#a260e8', '#1ba4ba', '#0d0d10'],
  },
  {
    id: 'clay',
    name: 'Clay',
    light: true,
    look: 'clay',
    c: {
      bg: '#e4e8ee', side: '#e4e8ee', panel: '#e8ecf2', raised: '#dce1e9', line: '#cdd3dd', fg: '#2f3b55', muted: '#7a849a',
      accent: '#6c63ff', accentFg: '#ffffff', sel: '#d7dcf6', running: '#3a7cc2', waiting: '#b7791f', done: '#2a9468', error: '#dc4c5a',
      orange: '#e8833a', pink: '#dc5c9a', purple: '#8a6cf0',
    },
    ansi: ['#d3d9e3', '#d6455a', '#2a9468', '#b07a10', '#3a7cc2', '#7a5ce0', '#2b8f9c', '#45506a',
      '#a3abbd', '#e8607a', '#36ad7e', '#cc9020', '#5a96d8', '#957bf0', '#3aa8b6', '#1f2638'],
  },
  {
    id: 'pocket',
    name: 'Pocket',
    light: true,
    look: 'pocket',
    c: {
      bg: '#c4cf9a', side: '#b3c189', panel: '#ced8a6', raised: '#a8b87c', line: '#3f5a30', fg: '#0f2a12', muted: '#4a6838',
      accent: '#306230', accentFg: '#d6dfae', sel: '#9db26b', running: '#1d5d5a', waiting: '#6f5200', done: '#1e5f1e', error: '#8c1d2c',
      orange: '#8a5200', pink: '#8b2252', purple: '#4b3a7a',
    },
    ansi: ['#a8b87c', '#8c1d2c', '#1e5f1e', '#6f5200', '#1d4f6e', '#5a2d6e', '#1d5d5a', '#24401c',
      '#6f8a52', '#a8283a', '#2d7a2d', '#8a6a00', '#2a6a8f', '#7a3d94', '#287a76', '#081a0a'],
  },
  {
    id: 'starship',
    name: 'Starship',
    look: 'starship',
    c: {
      bg: '#000000', side: '#000000', panel: '#0c0b14', raised: '#1b1a2b', line: '#2f2c48', fg: '#f6e7c9', muted: '#a097bb',
      accent: '#ff9c00', accentFg: '#000000', sel: '#2a1d05', running: '#99ccff', waiting: '#ffcc66', done: '#99dd99', error: '#ff5a5a',
      orange: '#ff9966', pink: '#cc6699', purple: '#cc99cc',
    },
    ansi: ['#1b1a2b', '#ff5a5a', '#99dd99', '#ffcc66', '#9999ff', '#cc99cc', '#66ccff', '#e8dcc4',
      '#5a5478', '#ff8080', '#b8f0b8', '#ffdd88', '#b8b8ff', '#e0b8e0', '#99ddff', '#ffffff'],
  },
  {
    id: 'gazette',
    name: 'Gazette',
    light: true,
    look: 'gazette',
    c: {
      bg: '#f6f1e6', side: '#efe8d8', panel: '#fbf8f0', raised: '#e8e0cc', line: '#2a2723', fg: '#1c1a17', muted: '#6b6457',
      accent: '#b3261e', accentFg: '#fbf8f0', sel: '#e6dcc4', running: '#1f4e8c', waiting: '#8a5a00', done: '#2f6b3a', error: '#b3261e',
      orange: '#b5651d', pink: '#a8326e', purple: '#5b3f8c',
    },
    ansi: ['#e8e0cc', '#b3261e', '#2f6b3a', '#8a5a00', '#1f4e8c', '#6b3f8c', '#1f6b6b', '#3a3631',
      '#8f8676', '#d0362c', '#3d8a4b', '#a87000', '#2f65b0', '#8550b0', '#2a8a8a', '#0d0c0a'],
  },
  {
    id: 'holo',
    name: 'Holo',
    look: 'holo',
    c: {
      bg: '#0b0d17', side: '#090b14', panel: '#11142a', raised: '#1a1e3a', line: '#2a2f55', fg: '#eef0ff', muted: '#9aa0c8',
      accent: '#8b7bff', accentFg: '#0b0d17', sel: '#232a55', running: '#5ee7ff', waiting: '#ffd36b', done: '#7cf2b0', error: '#ff6b9a',
      orange: '#ffa36b', pink: '#ff7bd5', purple: '#a98bff',
    },
    ansi: ['#1a1e3a', '#ff6b9a', '#7cf2b0', '#ffd36b', '#6b9bff', '#c18bff', '#5ee7ff', '#d8dcf5',
      '#4a5080', '#ff8fb3', '#a3f7cc', '#ffe299', '#94b8ff', '#d6b0ff', '#8ff0ff', '#ffffff'],
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    light: true,
    look: 'bauhaus',
    c: {
      bg: '#f5f1e8', side: '#ece6d6', panel: '#fbf9f3', raised: '#e3dccb', line: '#1d1d1b', fg: '#1d1d1b', muted: '#5e5a52',
      accent: '#d7261e', accentFg: '#ffffff', sel: '#f3d34a', running: '#1f4fa3', waiting: '#a86e00', done: '#2a7a3b', error: '#d7261e',
      orange: '#e8742c', pink: '#c73b7a', purple: '#4b3b8f',
    },
    ansi: ['#e3dccb', '#d7261e', '#2a7a3b', '#a86e00', '#1f4fa3', '#7a3b8f', '#1f7a7a', '#3a3834',
      '#8f897c', '#ec3a30', '#38964d', '#c98800', '#2f66c4', '#9550b0', '#2a9a9a', '#0d0d0c'],
  },
  {
    id: 'chalkboard',
    name: 'Chalkboard',
    look: 'chalk',
    c: {
      bg: '#1f3a2e', side: '#1a3227', panel: '#24433a', raised: '#2c4f43', line: '#4f7366', fg: '#f2f0e6', muted: '#a9bdb2',
      accent: '#ffe27a', accentFg: '#1f3a2e', sel: '#2f5a4a', running: '#9fd3ff', waiting: '#ffe27a', done: '#b9f0a8', error: '#ff9a8a',
      orange: '#ffb87a', pink: '#ffa8d0', purple: '#c9b3ff',
    },
    ansi: ['#2c4f43', '#ff9a8a', '#b9f0a8', '#ffe27a', '#9fd3ff', '#d9b8ff', '#8fe8d8', '#e8e6dc',
      '#5f8577', '#ffb8ab', '#d2f7c6', '#fff0a8', '#c2e4ff', '#e8d2ff', '#b5f2e6', '#ffffff'],
  },
  {
    id: 'brass',
    name: 'Brass',
    look: 'brass',
    c: {
      bg: '#1b140e', side: '#17110b', panel: '#241a12', raised: '#2f2217', line: '#5a4126', fg: '#f0dfc0', muted: '#b39b78',
      accent: '#d4a24c', accentFg: '#1b140e', sel: '#3a2a18', running: '#7fb8b0', waiting: '#e0b04a', done: '#9bc47a', error: '#d9694a',
      orange: '#d98a4a', pink: '#c9788f', purple: '#a58ac2',
    },
    ansi: ['#2f2217', '#d9694a', '#9bc47a', '#e0b04a', '#7f9fc4', '#b58ac2', '#7fb8b0', '#e6d4b4',
      '#6b5238', '#ee8a6a', '#b8dc98', '#f2cb72', '#a0bde0', '#cfa8da', '#a0d4cc', '#fff4dc'],
  },
  {
    id: 'circuit',
    name: 'Circuit',
    look: 'circuit',
    c: {
      bg: '#06261c', side: '#052017', panel: '#0a3326', raised: '#0f4231', line: '#1c5c45', fg: '#e8f5ec', muted: '#8fb8a3',
      accent: '#e0b04a', accentFg: '#06261c', sel: '#14503b', running: '#6fd3ff', waiting: '#f0c060', done: '#7ee08a', error: '#ff6b5a',
      orange: '#e8955a', pink: '#f08ac0', purple: '#b49cff',
    },
    ansi: ['#0f4231', '#ff6b5a', '#7ee08a', '#f0c060', '#6fa8ff', '#c79cff', '#6fd3ff', '#d8eadf',
      '#3f7a63', '#ff8f80', '#a6f0ae', '#ffd98a', '#99c2ff', '#dcbcff', '#9ee4ff', '#ffffff'],
  },
  {
    id: 'riso',
    name: 'Riso',
    light: true,
    look: 'riso',
    c: {
      bg: '#f4efe4', side: '#ece5d6', panel: '#faf6ee', raised: '#e6dfcf', line: '#cfc5b2', fg: '#23305e', muted: '#6d6a7d',
      accent: '#ff48b0', accentFg: '#ffffff', sel: '#ffd9ee', running: '#0078bf', waiting: '#c98a00', done: '#00a95c', error: '#e8384f',
      orange: '#ff6c2f', pink: '#ff48b0', purple: '#765ba7',
    },
    ansi: ['#e6dfcf', '#e8384f', '#00a95c', '#c98a00', '#0078bf', '#c2369a', '#00838a', '#3a3f5c',
      '#8d8778', '#ff4f6a', '#16bf70', '#e0a200', '#2a8fd6', '#ff48b0', '#1aa3a8', '#14182e'],
  },
  {
    id: 'denim',
    name: 'Denim',
    look: 'denim',
    c: {
      bg: '#15233a', side: '#122036', panel: '#1a2b47', raised: '#223659', line: '#2f4a75', fg: '#e9eef7', muted: '#9db0cf',
      accent: '#e8a33d', accentFg: '#15233a', sel: '#2a4470', running: '#7fb6ff', waiting: '#e8a33d', done: '#9bd47e', error: '#ff7a6b',
      orange: '#e8a33d', pink: '#f08ab0', purple: '#b9a3ff',
    },
    ansi: ['#223659', '#ff7a6b', '#9bd47e', '#e8c070', '#7fb6ff', '#c9a3ff', '#7fd6e0', '#dfe6f2',
      '#4d6690', '#ff9a8e', '#b8e8a0', '#f5d590', '#a6cbff', '#dcc4ff', '#a6e8ef', '#ffffff'],
  },
  {
    id: 'kraft',
    name: 'Kraft',
    light: true,
    look: 'kraft',
    c: {
      bg: '#dcc39a', side: '#d2b78a', panel: '#e6d2ad', raised: '#cbb083', line: '#a88a5c', fg: '#2b2117', muted: '#6b5638',
      accent: '#c0392b', accentFg: '#fff7ea', sel: '#ccae7c', running: '#1f5c99', waiting: '#8f5a00', done: '#2f6b2a', error: '#b02a1f',
      orange: '#b8561c', pink: '#a83a63', purple: '#5a3f8a',
    },
    ansi: ['#cbb083', '#b02a1f', '#2f6b2a', '#8f5a00', '#1f5c99', '#7a3a8a', '#1f6b6b', '#3b2f22',
      '#8a7350', '#cf3b2c', '#3c8a36', '#ad6e00', '#2a72bd', '#9450ab', '#2a8585', '#120d08'],
  },
  {
    id: 'outrun',
    name: 'Outrun',
    look: 'outrun',
    c: { bg: '#0d0221', side: '#0a0119', panel: '#190538', raised: '#261447', line: '#3b1d6e', fg: '#f5e9ff', muted: '#a58fd1', accent: '#ff2a6d', accentFg: '#0d0221', sel: '#2d0f57', running: '#05d9e8', waiting: '#ffd319', done: '#4dffb4', error: '#ff2a6d', orange: '#ff8c42', pink: '#ff6ec7', purple: '#b967ff' },
    ansi: ['#261447', '#ff2a6d', '#4dffb4', '#ffd319', '#05d9e8', '#b967ff', '#01cdfe', '#e6dcff',
      '#5a3d8a', '#ff5c8d', '#80ffcb', '#ffe066', '#5ce8f2', '#d29bff', '#5ee6ff', '#ffffff'],
  },
  {
    id: 'cathedral',
    name: 'Cathedral',
    look: 'cathedral',
    c: { bg: '#0b0a10', side: '#100e17', panel: '#16131f', raised: '#221d30', line: '#2a2438', fg: '#f3ead8', muted: '#a99f8c', accent: '#e0a526', accentFg: '#0b0a10', sel: '#3a1630', running: '#4f8fe0', waiting: '#e0a526', done: '#3fae6a', error: '#d6334a', orange: '#e07a26', pink: '#d65a8f', purple: '#8a5ad6' },
    ansi: ['#221d30', '#d6334a', '#3fae6a', '#e0a526', '#4f8fe0', '#9a5ad6', '#3fb8b0', '#e8dfcc',
      '#4a4258', '#ef5a6e', '#5fd08a', '#f2c04a', '#78aaf0', '#b880f0', '#62d4cc', '#fffaf0'],
  },
  {
    id: 'washi',
    name: 'Washi',
    light: true,
    look: 'washi',
    c: { bg: '#f7f3ea', side: '#f1ebdf', panel: '#fbf8f2', raised: '#ebe4d6', line: '#ddd3c2', fg: '#1f1c18', muted: '#7b7366', accent: '#c8102e', accentFg: '#fbf8f2', sel: '#efe2d4', running: '#2f5d8a', waiting: '#b07d1e', done: '#4d7a3a', error: '#c8102e', orange: '#c96a2b', pink: '#c2577a', purple: '#6b4f8a' },
    ansi: ['#ebe4d6', '#c8102e', '#4d7a3a', '#b07d1e', '#2f5d8a', '#7a4f8a', '#2f7a7a', '#3a352e',
      '#9b9283', '#e0303e', '#5f9448', '#cc9530', '#3f74a8', '#9566a8', '#3f9494', '#0d0b09'],
  },
  {
    id: 'comic',
    name: 'Comic',
    light: true,
    look: 'comic',
    c: { bg: '#fffdf5', side: '#fff6d6', panel: '#ffffff', raised: '#fff0b3', line: '#111111', fg: '#111111', muted: '#555555', accent: '#ff2d2d', accentFg: '#ffffff', sel: '#fff07a', running: '#1e6bff', waiting: '#c48a00', done: '#11a84a', error: '#ff2d2d', orange: '#ff7a1a', pink: '#ff4fa3', purple: '#7a3cff' },
    ansi: ['#fff0b3', '#e51c1c', '#119a44', '#c48a00', '#1e5bdf', '#8a2be2', '#0a9aa8', '#333333',
      '#888888', '#ff3b3b', '#1fbf5a', '#e0a000', '#3d7bff', '#a35cff', '#16b8c8', '#000000'],
  },
  {
    id: 'groovy',
    name: 'Groovy',
    light: true,
    look: 'groovy',
    c: { bg: '#fbefd9', side: '#f6e2c0', panel: '#fff7e8', raised: '#f0d6a8', line: '#d9b47c', fg: '#3b2414', muted: '#8a6a4a', accent: '#e2531f', accentFg: '#fff7e8', sel: '#f6cf8a', running: '#2f7f88', waiting: '#b8800e', done: '#6f8f2f', error: '#c23b22', orange: '#e2531f', pink: '#d0607a', purple: '#7a4a7e' },
    ansi: ['#f0d6a8', '#c23b22', '#5f7f22', '#b8800e', '#2f6f88', '#8a4a7e', '#2f7f78', '#4a3020',
      '#a08060', '#e2531f', '#7f9f3a', '#d99a1e', '#3f8fa8', '#a8609a', '#3f9f98', '#1e120a'],
  },
  {
    id: 'sonar',
    name: 'Sonar',
    look: 'sonar',
    c: { bg: '#03141a', side: '#021014', panel: '#062027', raised: '#0a2e37', line: '#124450', fg: '#d6fbf2', muted: '#6fa8a0', accent: '#38f2b6', accentFg: '#03141a', sel: '#0c3a40', running: '#38c9f2', waiting: '#f2d338', done: '#38f2b6', error: '#ff5f56', orange: '#ff9a4d', pink: '#ff7ac0', purple: '#9a8cff' },
    ansi: ['#0a2e37', '#ff5f56', '#38f2b6', '#f2d338', '#38a8f2', '#b48cff', '#38e0f2', '#c8eee6',
      '#2f6b6f', '#ff8a80', '#7affd0', '#ffe680', '#6cc4ff', '#cdb4ff', '#7af0ff', '#ffffff'],
  },
  {
    id: 'luna',
    name: 'Luna',
    light: true,
    look: 'luna',
    c: { bg: '#ffffff', side: '#d6e4f8', panel: '#ece9d8', raised: '#e3e0cf', line: '#a8b5c8', fg: '#000000', muted: '#555555', accent: '#316ac5', accentFg: '#ffffff', sel: '#c1d2ee', running: '#0a58ca', waiting: '#c98a00', done: '#2b8a2b', error: '#d4362c', orange: '#e8742c', pink: '#c7358a', purple: '#6b3fa0' },
    ansi: ['#e3e0cf', '#c0201a', '#1f7a1f', '#9a7000', '#0a3fa8', '#7a1fa0', '#0a7a8a', '#333333',
      '#808080', '#e03a30', '#2b9a2b', '#c08a00', '#2f6ad8', '#9a3fc0', '#1a9aaa', '#000000'],
  },
  {
    id: 'quest',
    name: 'Quest',
    look: 'quest',
    c: { bg: '#000814', side: '#00102a', panel: '#0a1f5c', raised: '#13307a', line: '#3a5bb0', fg: '#ffffff', muted: '#a9b8e8', accent: '#ffd84a', accentFg: '#000814', sel: '#1d3d99', running: '#7fd0ff', waiting: '#ffd84a', done: '#7fff8a', error: '#ff6b6b', orange: '#ffa94a', pink: '#ff8ad8', purple: '#c49aff' },
    ansi: ['#13307a', '#ff6b6b', '#7fff8a', '#ffd84a', '#7fb0ff', '#d09aff', '#7fe8ff', '#e6ecff',
      '#4a64b0', '#ff9a9a', '#b0ffb8', '#ffe88a', '#a8c8ff', '#e2c2ff', '#b0f4ff', '#ffffff'],
  },
  {
    id: 'terrarium',
    name: 'Terrarium',
    look: 'terrarium',
    c: { bg: '#0f1a12', side: '#0c160f', panel: '#142218', raised: '#1c2e21', line: '#2b4532', fg: '#e4f2e0', muted: '#93b08f', accent: '#9be37a', accentFg: '#0f1a12', sel: '#22402a', running: '#7ac9e3', waiting: '#e3c97a', done: '#9be37a', error: '#e3887a', orange: '#e3a77a', pink: '#e39ac0', purple: '#b9a3e3' },
    ansi: ['#1c2e21', '#e3887a', '#9be37a', '#e3c97a', '#7ab0e3', '#c4a3e3', '#7ae3c9', '#d4e8cf',
      '#45634b', '#f0a89c', '#bff0a3', '#f0dca3', '#a3caf0', '#d8c4f0', '#a3f0dc', '#ffffff'],
  },
  {
    id: 'bricks',
    name: 'Bricks',
    light: true,
    look: 'bricks',
    c: { bg: '#fafaf7', side: '#e4e4de', panel: '#ffffff', raised: '#ecece6', line: '#cfcfc6', fg: '#1b1b1b', muted: '#6a6a64', accent: '#e3000b', accentFg: '#ffffff', sel: '#ffe24a', running: '#0055bf', waiting: '#b07800', done: '#00852b', error: '#e3000b', orange: '#fe8a18', pink: '#e4428f', purple: '#6a3fa0' },
    ansi: ['#ecece6', '#c9000a', '#00852b', '#b07800', '#0055bf', '#8a2f9a', '#008a8a', '#333333',
      '#8a8a84', '#e3000b', '#19a33d', '#d99500', '#1f6fd6', '#a84fbb', '#12a3a3', '#000000'],
  },
  {
    id: 'zeroday',
    name: 'Zero Day',
    look: 'zeroday',
    c: { bg: '#020604', side: '#010402', panel: '#04100a', raised: '#08180f', line: '#0f3a1f', fg: '#b8ffcc', muted: '#4f9a66', accent: '#00ff66', accentFg: '#000000', sel: '#0a2a16', running: '#00e5ff', waiting: '#e5ff00', done: '#00ff66', error: '#ff3355', orange: '#ff9933', pink: '#ff55aa', purple: '#aa77ff' },
    ansi: ['#08180f', '#ff3355', '#00ff66', '#e5ff00', '#2a9dff', '#b066ff', '#00e5ff', '#a8e8b8',
      '#2f6a44', '#ff6680', '#66ff99', '#f0ff66', '#66b8ff', '#cc99ff', '#66f0ff', '#eaffef'],
  },
  {
    id: 'glitch',
    name: 'Glitch',
    look: 'glitch',
    c: { bg: '#07060b', side: '#0b0912', panel: '#110e1a', raised: '#191426', line: '#2c2342', fg: '#f0f4ff', muted: '#8a86a8', accent: '#00f0ff', accentFg: '#07060b', sel: '#1e1838', running: '#00f0ff', waiting: '#ffe600', done: '#39ff88', error: '#ff2a6d', orange: '#ff8a2a', pink: '#ff2ad4', purple: '#9b5cff' },
    ansi: ['#191426', '#ff2a6d', '#39ff88', '#ffe600', '#2a7bff', '#ff2ad4', '#00f0ff', '#d8dcf0',
      '#4a4468', '#ff6b98', '#7affb0', '#fff27a', '#6aa4ff', '#ff7ae6', '#7af8ff', '#ffffff'],
  },
  {
    id: 'greenbar',
    name: 'Greenbar',
    light: true,
    look: 'greenbar',
    c: { bg: '#fbfdf8', side: '#eef3e6', panel: '#ffffff', raised: '#e6eedb', line: '#b9cba3', fg: '#1f2a1c', muted: '#6b7a60', accent: '#2f7d32', accentFg: '#ffffff', sel: '#d3e8c4', running: '#1f5fa8', waiting: '#a87a00', done: '#2f7d32', error: '#c0392b', orange: '#d9731a', pink: '#c2458a', purple: '#6b4aa0' },
    ansi: ['#e6eedb', '#b52a1e', '#2a7a2a', '#946c00', '#1f5fa8', '#7a3a96', '#16807a', '#3a4636',
      '#8a9a80', '#d0402e', '#3a963a', '#b88a00', '#2f78c8', '#9a52b8', '#1f9a92', '#0e140c'],
  },
  {
    id: 'noir',
    name: 'Noir',
    look: 'noir',
    c: { bg: '#0d0d0d', side: '#080808', panel: '#141414', raised: '#1c1c1c', line: '#2e2e2e', fg: '#e8e6e1', muted: '#8a8884', accent: '#f2f0ea', accentFg: '#0d0d0d', sel: '#262626', running: '#9fb4c8', waiting: '#d9b45a', done: '#ffffff', error: '#d0312d', orange: '#b8a890', pink: '#c0a8b0', purple: '#a09cb0' },
    ansi: ['#1c1c1c', '#d0312d', '#8fa88a', '#c8b07a', '#8a9db0', '#a8939f', '#8fa8a8', '#c8c6c0',
      '#4a4a4a', '#e8524d', '#aac4a4', '#e0ca94', '#a8bccf', '#c4afbb', '#aac4c4', '#ffffff'],
  },
  {
    id: 'circus',
    name: 'Big Top',
    light: true,
    look: 'circus',
    c: { bg: '#fdf6e3', side: '#f7e9c8', panel: '#fffaf0', raised: '#f3e1b8', line: '#e0c48e', fg: '#2b1a12', muted: '#8a6a4f', accent: '#d62828', accentFg: '#fffaf0', sel: '#fbd38d', running: '#1d6fb8', waiting: '#e09a00', done: '#2e8b57', error: '#b31b1b', orange: '#f77f00', pink: '#e0569a', purple: '#7b3fa0' },
    ansi: ['#f3e1b8', '#c41e1e', '#2e7d4f', '#b07a00', '#1d5fa8', '#8a2f8a', '#127a7a', '#3a2a1e',
      '#a08a6a', '#e03a2a', '#3a9a62', '#d99a00', '#2f7fd0', '#a848a8', '#1a9a9a', '#1a0f08'],
  },
  {
    id: 'darkroom',
    name: 'Darkroom',
    look: 'darkroom',
    c: { bg: '#120606', side: '#0d0404', panel: '#1a0808', raised: '#240b0b', line: '#3d1414', fg: '#ffd0c4', muted: '#a8625a', accent: '#ff4433', accentFg: '#120606', sel: '#3a0e0e', running: '#ff9466', waiting: '#ffd36a', done: '#f5e6dc', error: '#ff3030', orange: '#ff8a3a', pink: '#ff6b9a', purple: '#d06bc4' },
    ansi: ['#240b0b', '#ff4a3a', '#c9c27a', '#ffb04a', '#c47a8a', '#e0709a', '#e0a08a', '#f0cfc4',
      '#5a2a24', '#ff7a6a', '#e0da9a', '#ffd07a', '#e09aa8', '#f09ac0', '#f0c0a8', '#fff0ea'],
  },
  {
    id: 'transit',
    name: 'Transit',
    light: true,
    look: 'transit',
    c: { bg: '#ffffff', side: '#f2f2ef', panel: '#ffffff', raised: '#e9e9e4', line: '#cfcfc8', fg: '#111111', muted: '#6b6b66', accent: '#0039a6', accentFg: '#ffffff', sel: '#fccc0a', running: '#0039a6', waiting: '#ff6319', done: '#00933c', error: '#ee352e', orange: '#ff6319', pink: '#b933ad', purple: '#b933ad' },
    ansi: ['#e9e9e4', '#d42a20', '#00873a', '#a67a00', '#0039a6', '#b933ad', '#007a8a', '#333333',
      '#8a8a84', '#ee352e', '#00933c', '#c99a00', '#2a5fd6', '#c94ac0', '#1a9aaa', '#000000'],
  },
  {
    id: 'modular',
    name: 'Modular',
    look: 'modular',
    c: { bg: '#141517', side: '#232528', panel: '#1d1f22', raised: '#2c2f33', line: '#3a3d42', fg: '#e9ebee', muted: '#8d939b', accent: '#ff4d2e', accentFg: '#141517', sel: '#33373c', running: '#3fb6ff', waiting: '#ffcc33', done: '#5fe08a', error: '#ff4d2e', orange: '#ff9a2e', pink: '#ff5fb0', purple: '#a98bff' },
    ansi: ['#2c2f33', '#ff4d2e', '#5fe08a', '#ffcc33', '#3fb6ff', '#c48bff', '#3fe0d0', '#d5d9de',
      '#5b6168', '#ff7a60', '#8af0aa', '#ffe07a', '#7ccdff', '#d8b4ff', '#7af0e4', '#ffffff'],
  },
  {
    id: 'topo',
    name: 'Topo',
    light: true,
    look: 'topo',
    c: { bg: '#f4efe2', side: '#ebe4d1', panel: '#faf6ec', raised: '#e4dcc6', line: '#cdbf9d', fg: '#2e2a1f', muted: '#7d735c', accent: '#b5452a', accentFg: '#faf6ec', sel: '#e8d9a8', running: '#2f6f9f', waiting: '#c98a12', done: '#4f7f3a', error: '#b5452a', orange: '#d0702a', pink: '#b85a7a', purple: '#6f5a96' },
    ansi: ['#e4dcc6', '#a83a22', '#3f6f2a', '#8f6a0a', '#2f5f8f', '#7a4a86', '#2f7a72', '#3a352a',
      '#9a8f74', '#c4502e', '#5a8f42', '#b8860b', '#3f7fb8', '#9a62a8', '#3f9a90', '#14110a'],
  },
  {
    id: 'abyss',
    name: 'Abyss',
    look: 'abyss',
    c: { bg: '#020b18', side: '#010812', panel: '#06142a', raised: '#0a1d38', line: '#12304f', fg: '#d6f6ff', muted: '#6f9bb8', accent: '#3ff0ff', accentFg: '#020b18', sel: '#0c2a48', running: '#3ff0ff', waiting: '#ffd36b', done: '#7dffb2', error: '#ff5a8a', orange: '#ffa36b', pink: '#ff4fd8', purple: '#a68bff' },
    ansi: ['#0a1d38', '#ff5a8a', '#7dffb2', '#ffd36b', '#4f9dff', '#ff4fd8', '#3ff0ff', '#c4e6f2',
      '#2f557a', '#ff8aae', '#a8ffcf', '#ffe39a', '#86bcff', '#ff86e6', '#8af6ff', '#ffffff'],
  },
  {
    id: 'manuscript',
    name: 'Manuscript',
    light: true,
    look: 'manuscript',
    c: { bg: '#f3e7cc', side: '#ecdcb8', panel: '#f8eed8', raised: '#e6d4ab', line: '#c9b07a', fg: '#2b1d10', muted: '#7a6142', accent: '#a8201a', accentFg: '#f8eed8', sel: '#e9cf8a', running: '#1f4f8a', waiting: '#b8860b', done: '#3f6f2a', error: '#a8201a', orange: '#c0601a', pink: '#a83a6a', purple: '#5a3a86' },
    ansi: ['#e6d4ab', '#9a1c16', '#3a6426', '#8a6408', '#1f4f8a', '#6e2f7a', '#24706a', '#3a2a18',
      '#9a8160', '#b8302a', '#4f8034', '#b08410', '#2f66aa', '#8a4598', '#2f8a82', '#120a04'],
  },
  {
    id: 'cassette',
    name: 'Mixtape',
    look: 'cassette',
    c: { bg: '#1b1a1e', side: '#141317', panel: '#232227', raised: '#2e2c33', line: '#3e3b44', fg: '#efe9e0', muted: '#9a948a', accent: '#ff6b35', accentFg: '#1b1a1e', sel: '#3a3540', running: '#4fc3d9', waiting: '#ffcf4a', done: '#9be36b', error: '#ff4f5e', orange: '#ff6b35', pink: '#ff7ab6', purple: '#b08cff' },
    ansi: ['#2e2c33', '#ff4f5e', '#9be36b', '#ffcf4a', '#5f9bff', '#c08cff', '#4fc3d9', '#ddd6cc',
      '#5e5a64', '#ff7f8a', '#bcf094', '#ffe07f', '#8cb8ff', '#d4b0ff', '#86dceb', '#ffffff'],
  },
  {
    id: 'workshop',
    name: 'Workshop',
    look: 'workshop',
    c: { bg: '#1a1410', side: '#2a1d14', panel: '#231a13', raised: '#33261b', line: '#4a3726', fg: '#f1e4d0', muted: '#a8917a', accent: '#ff7a1a', accentFg: '#1a1410', sel: '#3d2c1f', running: '#5fb3e0', waiting: '#ffd23f', done: '#8fd16a', error: '#ff5544', orange: '#ff7a1a', pink: '#e88aa8', purple: '#b49adf' },
    ansi: ['#33261b', '#ff5544', '#8fd16a', '#ffd23f', '#5fa0e0', '#c79adf', '#5fd0c0', '#e4d4bc',
      '#6a5440', '#ff8070', '#b0e890', '#ffe27a', '#8cc0f0', '#dab8ec', '#8ae6da', '#ffffff'],
  },
  {
    id: 'receipt',
    name: 'Receipt',
    light: true,
    look: 'receipt',
    c: { bg: '#fbfbf7', side: '#f3f3ee', panel: '#ffffff', raised: '#ecece6', line: '#d2d2ca', fg: '#1e1e1e', muted: '#77776f', accent: '#1e1e1e', accentFg: '#fbfbf7', sel: '#e3e3dc', running: '#2f5fa8', waiting: '#a87c00', done: '#2f7a3a', error: '#c0302a', orange: '#c86a1a', pink: '#b8457a', purple: '#6a4a9a' },
    ansi: ['#ecece6', '#b52a22', '#2a7a32', '#8f6c00', '#2a5aa0', '#7a3a8f', '#1f7a7a', '#333333',
      '#8a8a82', '#d03a30', '#3a9444', '#b08a00', '#3a72c4', '#9a50b0', '#2a9696', '#000000'],
  },
  {
    id: 'aquarelle',
    name: 'Aquarelle',
    light: true,
    look: 'aquarelle',
    c: { bg: '#fbf8f3', side: '#f3eee6', panel: '#fffdf9', raised: '#efe8dc', line: '#dcd2c2', fg: '#3a3340', muted: '#8a8090', accent: '#4f7fc4', accentFg: '#ffffff', sel: '#dbe6f6', running: '#4f7fc4', waiting: '#d99a3a', done: '#5aa37a', error: '#d0566a', orange: '#e08a4a', pink: '#d2709a', purple: '#8a6ac0' },
    ansi: ['#efe8dc', '#c04a5e', '#3f8a5f', '#a87a20', '#3f6fb4', '#8a5ab0', '#2f8a96', '#4a4250',
      '#9a90a0', '#d8607a', '#5aa37a', '#c8962a', '#5a8ad0', '#a476c8', '#4aa4ae', '#1e1a24'],
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    look: 'cosmos',
    c: { bg: '#05060f', side: '#04050c', panel: '#0b0d1c', raised: '#121530', line: '#22264a', fg: '#e8e8ff', muted: '#8a8cb8', accent: '#ffd27a', accentFg: '#05060f', sel: '#1a1e44', running: '#7ab8ff', waiting: '#ffd27a', done: '#8affc4', error: '#ff6a7a', orange: '#ffa86a', pink: '#ff8ad8', purple: '#b48aff' },
    ansi: ['#121530', '#ff6a7a', '#8affc4', '#ffd27a', '#7ab8ff', '#c08aff', '#7ae8ff', '#d4d6f4',
      '#3e4278', '#ff96a2', '#b4ffda', '#ffe2a4', '#a6d0ff', '#d6b4ff', '#a6f0ff', '#ffffff'],
  },
  {
    id: 'sakura',
    name: 'Sakura',
    light: true,
    look: 'sakura',
    c: { bg: '#fff7f9', side: '#fdeef2', panel: '#ffffff', raised: '#fbe3ea', line: '#f1c9d5', fg: '#3d2a33', muted: '#9a7a86', accent: '#e0577f', accentFg: '#ffffff', sel: '#fcd8e3', running: '#3f7fc8', waiting: '#c98410', done: '#4f8f54', error: '#d0384a', orange: '#e8853a', pink: '#e0577f', purple: '#9a6ac0' },
    ansi: ['#fbe3ea', '#c8344c', '#4f8a52', '#a8780e', '#3f74b8', '#a64f8f', '#2f8a8a', '#5a4650',
      '#b89aa6', '#e0577f', '#5e9e62', '#c08a1a', '#5a8fd6', '#c06aa8', '#3f9e9e', '#2a1a22'],
  },
  {
    id: 'magma',
    name: 'Magma',
    look: 'magma',
    c: { bg: '#0e0807', side: '#0a0605', panel: '#160c0a', raised: '#22120e', line: '#3a1d15', fg: '#f3e2d6', muted: '#a8806e', accent: '#ff6a1f', accentFg: '#140806', sel: '#2e1510', running: '#ffb347', waiting: '#ffd25a', done: '#f7d9a8', error: '#ff3b2f', orange: '#ff8c3a', pink: '#ff5f7a', purple: '#c46aa0' },
    ansi: ['#22120e', '#ff3b2f', '#b8c46a', '#ffb347', '#d9824a', '#ff5f7a', '#ffa070', '#e8cfc0',
      '#5a3328', '#ff6a55', '#d6e08a', '#ffd27a', '#ffa36a', '#ff8aa0', '#ffc29a', '#fff4ec'],
  },
  {
    id: 'azulejo',
    name: 'Azulejo',
    light: true,
    look: 'azulejo',
    c: { bg: '#f6f8fc', side: '#eaf0f8', panel: '#ffffff', raised: '#e1e9f5', line: '#bccbe3', fg: '#14305e', muted: '#5f7396', accent: '#1f4fa8', accentFg: '#ffffff', sel: '#d3e0f4', running: '#1f6fd6', waiting: '#b87a0a', done: '#2f8a5a', error: '#c0392b', orange: '#d9731a', pink: '#b8457a', purple: '#5a4aa8' },
    ansi: ['#e1e9f5', '#b8302a', '#2a7a4a', '#946a00', '#1f4fa8', '#6a3f9a', '#1a7a8a', '#2a3f66',
      '#8a9ab8', '#d0453a', '#3a9a62', '#b8860b', '#3a6fd0', '#8a5ab8', '#2a96a8', '#0a1838'],
  },
  {
    id: 'fieldops',
    name: 'Field Ops',
    look: 'fieldops',
    c: { bg: '#141611', side: '#10120d', panel: '#1b1e17', raised: '#252a1f', line: '#3a4130', fg: '#d8dcc8', muted: '#8f957d', accent: '#c8b45a', accentFg: '#141611', sel: '#2c3324', running: '#8fb0c8', waiting: '#e0a030', done: '#8fbf5a', error: '#d9573a', orange: '#d98a3a', pink: '#c47a8a', purple: '#9a8ab0' },
    ansi: ['#252a1f', '#d9573a', '#8fbf5a', '#d6b84a', '#7a9ab0', '#a88aa0', '#7ab0a0', '#c8ccb8',
      '#4a5240', '#f07a5a', '#aad67a', '#ecd47a', '#a0bcd0', '#c4a8bc', '#9ccabc', '#f2f4e8'],
  },
  {
    id: 'diner',
    name: 'Diner',
    light: true,
    look: 'diner',
    c: { bg: '#fffaf2', side: '#eef9f5', panel: '#ffffff', raised: '#e2f4ee', line: '#c3e2d7', fg: '#2a1e1e', muted: '#7a6a66', accent: '#d7263d', accentFg: '#ffffff', sel: '#c8ede2', running: '#2a7ab8', waiting: '#c98a10', done: '#2f9a6a', error: '#c0182d', orange: '#e8742a', pink: '#e05a8a', purple: '#7a4aa0' },
    ansi: ['#e2f4ee', '#c0182d', '#1f8a5a', '#a87400', '#2a6ab0', '#a03a8a', '#1a8a8a', '#3a2e2e',
      '#a8a09a', '#e0364d', '#2fa872', '#c99410', '#3a8ad0', '#c05aa8', '#2aa6a4', '#1a0e0e'],
  },
  {
    id: 'eink',
    name: 'E-Ink',
    light: true,
    look: 'eink',
    c: { bg: '#f4f2ec', side: '#eceae3', panel: '#f8f7f2', raised: '#e4e2da', line: '#c8c5bb', fg: '#1a1a1a', muted: '#66645e', accent: '#1a1a1a', accentFg: '#f4f2ec', sel: '#dcd9d0', running: '#3a5a7a', waiting: '#7a6420', done: '#3f6a3a', error: '#8a3a30', orange: '#7a5a3a', pink: '#6a4a6a', purple: '#5a4a6a' },
    ansi: ['#e4e2da', '#8a3a30', '#3f6a3a', '#7a6420', '#3a5a7a', '#6a4a6a', '#3a6a6a', '#3a3a38',
      '#9a978e', '#a04a3e', '#4f7f48', '#8f7a30', '#4a6f94', '#806080', '#4a8080', '#111111'],
  },
  {
    id: 'vapor',
    name: 'Vapor',
    light: true,
    look: 'vapor',
    c: { bg: '#fdf0fb', side: '#eafbff', panel: '#ffffff', raised: '#f6e3fa', line: '#e3c4ef', fg: '#3a2a5a', muted: '#8a78a8', accent: '#ff4fc8', accentFg: '#2a0a26', sel: '#c9f3ff', running: '#12a8c0', waiting: '#e08a20', done: '#1aa67a', error: '#ff4d6d', orange: '#ff9a5a', pink: '#ff6ad5', purple: '#8c6cff' },
    ansi: ['#f6e3fa', '#e8366a', '#1aa67a', '#c2860a', '#5a6cff', '#c24ad8', '#12a8c0', '#4a3a6a',
      '#b8a8d0', '#ff4d6d', '#2fbf86', '#e0a020', '#8c9cff', '#ff6ad5', '#26c6da', '#24163e'],
  },
  {
    id: 'shibuya',
    name: 'Shibuya',
    look: 'shibuya',
    c: { bg: '#0a0b12', side: '#07080e', panel: '#10121c', raised: '#181b2a', line: '#262a40', fg: '#e6e8f5', muted: '#8088a8', accent: '#ff3d8b', accentFg: '#0a0b12', sel: '#1e2236', running: '#3dd6ff', waiting: '#ffd23d', done: '#5dffb0', error: '#ff4d4d', orange: '#ff9a3d', pink: '#ff3d8b', purple: '#a96bff' },
    ansi: ['#181b2a', '#ff4d6a', '#5dffb0', '#ffd23d', '#3d8bff', '#ff3d8b', '#3dd6ff', '#cfd3e8',
      '#454a68', '#ff7a90', '#8dffc8', '#ffe27a', '#7aaeff', '#ff7ab0', '#7ae4ff', '#ffffff'],
  },
  {
    id: 'origami',
    name: 'Origami',
    light: true,
    look: 'origami',
    c: { bg: '#f7f5f0', side: '#efece4', panel: '#fbfaf6', raised: '#e8e4d9', line: '#d6d0c2', fg: '#2b2b33', muted: '#77737f', accent: '#e2563a', accentFg: '#ffffff', sel: '#f3dccf', running: '#3a78c8', waiting: '#c98410', done: '#3f9a6a', error: '#c8382a', orange: '#e2763a', pink: '#d0568a', purple: '#6a5ab0' },
    ansi: ['#e8e4d9', '#c03a2a', '#2f7a52', '#9a700a', '#2f62a8', '#8a4a9a', '#2a7a86', '#3a3a44',
      '#a8a296', '#e2563a', '#3f9a6a', '#c0920a', '#3a78c8', '#a868b8', '#3a9aa6', '#14141a'],
  },
  {
    id: 'tiki',
    name: 'Tiki',
    look: 'tiki',
    c: { bg: '#1a120c', side: '#140e09', panel: '#22170f', raised: '#2e2015', line: '#4a331f', fg: '#f6e6cc', muted: '#b0906a', accent: '#ffb03a', accentFg: '#1a120c', sel: '#3a2818', running: '#3ac8c0', waiting: '#ffd23a', done: '#8fd46a', error: '#ff5a3a', orange: '#ff8a3a', pink: '#ff6a8a', purple: '#c07ab0' },
    ansi: ['#2e2015', '#ff5a3a', '#8fd46a', '#ffb03a', '#3a9ac8', '#e06a9a', '#3ac8c0', '#e8d4b4',
      '#6a4a30', '#ff7a5a', '#aee68a', '#ffcc6a', '#6ab8e0', '#f08ab4', '#6ae0d8', '#fff4e0'],
  },
  // screens from films and games: a light-cycle grid, a heist crew's menus, a test lab, a ship's computer's eye, a
  // severed office, a racing HUD, a 1969 control room, a dungeon's inventory, a starship's cockpit, an island phone
  {
    id: 'lightcycle',
    name: 'Lightcycle',
    look: 'lightcycle',
    c: { bg: '#02060a', side: '#010407', panel: '#050c12', raised: '#0a1620', line: '#0f3a4a', fg: '#d8fbff', muted: '#5f9aa8', accent: '#36f3ff', accentFg: '#001014', sel: '#072630', running: '#36f3ff', waiting: '#ff9d2e', done: '#7dffcf', error: '#ff4b3a', orange: '#ff9d2e', pink: '#ff5ad1', purple: '#8a7dff' },
    ansi: ['#0a1620', '#ff4b3a', '#5dffb0', '#ff9d2e', '#2e9bff', '#c46bff', '#36f3ff', '#bfeef5',
      '#2d5866', '#ff7a6a', '#8dffcf', '#ffc06a', '#6ab8ff', '#d89bff', '#8cf8ff', '#ffffff'],
  },
  {
    id: 'phantom',
    name: 'Phantom',
    look: 'phantom',
    c: { bg: '#0d0d0d', side: '#080808', panel: '#141414', raised: '#1e1e1e', line: '#3a0a0e', fg: '#f5f5f5', muted: '#a09a9a', accent: '#ff1a2d', accentFg: '#ffffff', sel: '#2a0508', running: '#ffd400', waiting: '#ff8a00', done: '#2be38b', error: '#ff1a2d', orange: '#ff8a00', pink: '#ff4f8a', purple: '#9a6bff' },
    ansi: ['#1e1e1e', '#ff1a2d', '#2be38b', '#ffd400', '#3a7bff', '#ff4f8a', '#28d7ff', '#e6e6e6',
      '#555555', '#ff5a66', '#6ff0b0', '#ffe45a', '#6a9cff', '#ff86ad', '#6ae4ff', '#ffffff'],
  },
  {
    id: 'chamber',
    name: 'Test Chamber',
    light: true,
    look: 'chamber',
    c: { bg: '#f4f6f7', side: '#e9edef', panel: '#ffffff', raised: '#e3e8eb', line: '#cfd6da', fg: '#2a3136', muted: '#7b878e', accent: '#ff8a1f', accentFg: '#1d2430', sel: '#dff0fb', running: '#1f9bff', waiting: '#e0a000', done: '#3aa86a', error: '#d8342a', orange: '#ff8a1f', pink: '#e05a9a', purple: '#7a5ad8' },
    ansi: ['#e3e8eb', '#d8342a', '#2f8f5a', '#b07a00', '#1f7fd8', '#9a4ac0', '#1a9aa8', '#2a3136',
      '#9aa6ad', '#ff5a4a', '#3aa86a', '#e0a000', '#1f9bff', '#c06ad8', '#2ab8c8', '#0e1214'],
  },
  {
    id: 'monolith',
    name: 'Monolith',
    look: 'monolith',
    c: { bg: '#000000', side: '#050505', panel: '#0a0a0a', raised: '#141414', line: '#262626', fg: '#f2f2f2', muted: '#8a8a8a', accent: '#ff2a1a', accentFg: '#ffffff', sel: '#1a0705', running: '#4aa8ff', waiting: '#ffc23a', done: '#8fe08f', error: '#ff2a1a', orange: '#ff7a3a', pink: '#ff6a8a', purple: '#9a8aff' },
    ansi: ['#141414', '#ff2a1a', '#8fe08f', '#ffc23a', '#4aa8ff', '#c08aff', '#5ad8e8', '#d8d8d8',
      '#4a4a4a', '#ff5a4a', '#b0f0b0', '#ffd86a', '#7ac0ff', '#d8b0ff', '#8ae8f0', '#ffffff'],
  },
  {
    id: 'macrodata',
    name: 'Macrodata',
    look: 'macrodata',
    c: { bg: '#071722', side: '#05121b', panel: '#0a1e2b', raised: '#0f2a3a', line: '#1c3c50', fg: '#c8f1ff', muted: '#6a97ab', accent: '#7fe0ff', accentFg: '#04121a', sel: '#10324a', running: '#7fe0ff', waiting: '#ffd27a', done: '#9af0c0', error: '#ff7a7a', orange: '#ffae7a', pink: '#ff9ad0', purple: '#b0a0ff' },
    ansi: ['#0f2a3a', '#ff7a7a', '#9af0c0', '#ffd27a', '#5ab0ff', '#c8a0ff', '#7fe0ff', '#b0d8e8',
      '#33566a', '#ffa0a0', '#bff8d8', '#ffe2a0', '#8ac8ff', '#dcc0ff', '#b0f0ff', '#ffffff'],
  },
  {
    id: 'redline',
    name: 'Redline',
    look: 'redline',
    c: { bg: '#0c0c0e', side: '#08080a', panel: '#131316', raised: '#1c1c21', line: '#2c2c33', fg: '#f2f2f4', muted: '#8c8c96', accent: '#ff2b2b', accentFg: '#ffffff', sel: '#2a1214', running: '#2bd4ff', waiting: '#ffcc00', done: '#4cff7a', error: '#ff2b2b', orange: '#ff8a1a', pink: '#ff4f9a', purple: '#9a7aff' },
    ansi: ['#1c1c21', '#ff2b2b', '#4cff7a', '#ffcc00', '#2b8bff', '#d05aff', '#2bd4ff', '#d4d4d8',
      '#4c4c56', '#ff5a5a', '#80ff9e', '#ffdc4a', '#5aa8ff', '#e08aff', '#6ae2ff', '#ffffff'],
  },
  {
    id: 'mission',
    name: 'Mission Control',
    look: 'mission',
    c: { bg: '#161a17', side: '#232823', panel: '#20251f', raised: '#2b312a', line: '#3d453b', fg: '#e8eadf', muted: '#9aa290', accent: '#ffb000', accentFg: '#1b1f1c', sel: '#353d33', running: '#6ad0ff', waiting: '#ffb000', done: '#7aff8a', error: '#ff4a3a', orange: '#ff8a3a', pink: '#ff7aa8', purple: '#b09aff' },
    ansi: ['#2b312a', '#ff4a3a', '#7aff8a', '#ffb000', '#6aa0ff', '#d08aff', '#6ad0ff', '#d8dccc',
      '#59614f', '#ff7a6a', '#a8ffb0', '#ffcc4a', '#9ac0ff', '#e0b0ff', '#9ae0ff', '#ffffff'],
  },
  {
    id: 'grimoire',
    name: 'Grimoire',
    look: 'grimoire',
    c: { bg: '#140f0b', side: '#0f0b08', panel: '#1c1510', raised: '#271d15', line: '#4a3824', fg: '#eadcc2', muted: '#a08a6a', accent: '#d4a64a', accentFg: '#140f0b', sel: '#2e2216', running: '#6ab8ff', waiting: '#ffcf4a', done: '#7ad46a', error: '#e0412e', orange: '#e8803a', pink: '#d86a9a', purple: '#a07ad8' },
    ansi: ['#271d15', '#e0412e', '#7ad46a', '#d4a64a', '#4a8ad8', '#a07ad8', '#4ab8b0', '#d8c8a8',
      '#5a4630', '#ff6a4a', '#9ae88a', '#f0c86a', '#6aa8ff', '#c09aff', '#6ad8d0', '#fff4dc'],
  },
  {
    id: 'cockpit',
    name: 'Cockpit',
    look: 'cockpit',
    c: { bg: '#05070a', side: '#040508', panel: '#080b10', raised: '#0e131a', line: '#2e2010', fg: '#ffd9a8', muted: '#b07a3a', accent: '#ff8c1a', accentFg: '#05070a', sel: '#2a1806', running: '#4ac8ff', waiting: '#ffd23a', done: '#7aff9a', error: '#ff4a3a', orange: '#ff8c1a', pink: '#ff6aa8', purple: '#a88aff' },
    ansi: ['#0e131a', '#ff4a3a', '#7aff9a', '#ffd23a', '#3a9aff', '#c08aff', '#4ac8ff', '#ffd9a8',
      '#5a4026', '#ff7a6a', '#a8ffbe', '#ffe27a', '#7ab8ff', '#d8b0ff', '#8ae0ff', '#fff2e0'],
  },
  {
    id: 'islander',
    name: 'Islander',
    light: true,
    look: 'islander',
    c: { bg: '#fbf5e3', side: '#f3ead0', panel: '#fffaf0', raised: '#efe4c4', line: '#e2d3a8', fg: '#5a4632', muted: '#86724f', accent: '#3cb88a', accentFg: '#0f3d2c', sel: '#dff3e2', running: '#3aa8d8', waiting: '#f0a020', done: '#3cb88a', error: '#e8594a', orange: '#f08a3a', pink: '#f08ab0', purple: '#9a7ad8' },
    ansi: ['#efe4c4', '#d8473a', '#2f9a6a', '#b8860a', '#2f86b8', '#b05aa8', '#2a9a9a', '#5a4632',
      '#b0a080', '#e8594a', '#3cb88a', '#d8a020', '#3aa8d8', '#d07ac8', '#3ab8b8', '#2a2016'],
  },
]

export const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
const PREVIEW = ['--bg', '--panel', '--fg', '--accent', '--ansi-1', '--ansi-2', '--ansi-3', '--ansi-4', '--ansi-5']
// a variable as the stylesheet's :root has it (the default theme), whatever theme paints <html> now; found once
const roots = new Map<string, string>()
function rootVar(v: string) {
  if (roots.has(v)) return roots.get(v)!
  for (const sheet of Array.from(document.styleSheets))
    try {
      for (const r of Array.from(sheet.cssRules))
        if (r instanceof CSSStyleRule && r.selectorText === ':root' && r.style.getPropertyValue(v)) {
          roots.set(v, r.style.getPropertyValue(v).trim())
          return roots.get(v)!
        }
    } catch {} // another origin's sheet
  return '' // not loaded yet, maybe: not remembered
}
const gradient = (g: [string, string]) => `linear-gradient(135deg, ${g[0]}, ${g[1]})`

// a theme's colors for its card in Settings
export const preview = (t: Theme) => {
  const [bg, ...rest] = t.c && t.ansi ? [t.c.bg, t.c.panel, t.c.fg, t.c.accent, ...t.ansi.slice(1, 6)] : PREVIEW.map(rootVar)
  return [t.grad ? gradient(t.grad) : bg, ...rest]
}

// what paints the window (Settings → Appearance): the theme, the interface's font ('system': the Mac's), glass
// and how see-through it makes the window, the sidebar and the terminals (%), and its color glow
export type Paint = { theme?: string; uiFont?: string; accent?: string; radius?: string; glass?: boolean; glassWindow?: number; glassSide?: number; glassTerm?: number; glassGlow?: boolean }
const PAINT = ['theme', 'uiFont', 'accent', 'radius', 'glass', 'glassWindow', 'glassSide', 'glassTerm', 'glassGlow'] as const
export const paintOf = (s?: Paint): Paint => Object.fromEntries(PAINT.map(k => [k, s?.[k]]))
export const paintKey = (p: Paint) => JSON.stringify(PAINT.map(k => p[k] ?? null))
export const GLASS = { glassWindow: 45, glassSide: 60, glassTerm: 100 } // the sliders' defaults
// a color at pct% strength (of its own alpha, if it has one): #rrggbbaa from a hex (xterm reads only that), else color-mix
function alpha(c: string, pct: number) {
  const m = /^(#[\da-f]{6})([\da-f]{2})?$/i.exec(c)
  if (!m) return `color-mix(in srgb, ${c} ${pct}%, transparent)`
  const a = m[2] ? parseInt(m[2], 16) : 255
  return m[1] + Math.round((pct / 100) * a).toString(16).padStart(2, '0')
}
// text on an accent: black or white, whichever reads better (WCAG's relative luminance)
export function onAccent(hex: string) {
  const l = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
  return (y + 0.05) / 0.05 >= 1.05 / (y + 0.05) ? '#000000' : '#ffffff'
}
export const UI_FALLBACK = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
export const UI_FONTS = ['Inter', 'system', 'JetBrains Mono', 'Avenir Next', 'Helvetica Neue', 'Futura', 'Gill Sans', 'Optima', 'Menlo']

let seeThrough = false
// terminals are see-through with a gradient theme, or glass that lets something through them (xterm's
// allowTransparency, which costs some text quality)
export const transparent = () => seeThrough

// paints <html> with a theme (an unknown id is the default), or a whole Paint
export function applyTheme(p: string | Paint = '') {
  const o: Paint = typeof p === 'string' ? { theme: p } : p
  const t = THEMES.find(x => x.id === o.theme) ?? THEMES[0]
  const root = document.documentElement
  const st = root.style
  for (const k of Array.from(st)) if (k.startsWith('--')) st.removeProperty(k)
  st.colorScheme = ''
  root.dataset.look = t.look ?? ''
  root.classList.toggle('glass', !!o.glass)
  seeThrough = o.glass ? (o.glassTerm ?? GLASS.glassTerm) > 0 : !!t.grad
  const font = o.uiFont?.trim()
  if (font) st.setProperty('--ui-font', font === 'system' ? UI_FALLBACK : `${JSON.stringify(font)}, ${UI_FALLBACK}`)
  // Settings › Appearance's accent and corners, over the theme's (and its look's --radius). --rs: the corners picked,
  // which every fixed radius in the stylesheets takes over its own (var(--rs, 10px)); pills and circles stay
  if (o.accent && /^#[\da-f]{6}$/i.test(o.accent)) st.setProperty('--accent', o.accent), st.setProperty('--accent-fg', onAccent(o.accent))
  if (o.radius) st.setProperty('--radius', o.radius), st.setProperty('--rs', o.radius)
  if (o.glass) {
    // the window's blur shows through: backgrounds at part strength (the default theme's from the stylesheet)
    const v = (k: keyof Colors, css: string) => t.c?.[k] ?? rootVar(css)
    const solid = (k: keyof typeof GLASS) => 100 - Math.min(100, Math.max(0, o[k] ?? GLASS[k])) // the slider says how see-through
    const w = solid('glassWindow')
    const base = t.grad ? `linear-gradient(135deg, ${alpha(t.grad[0], w)}, ${alpha(t.grad[1], w)})` : `linear-gradient(${alpha(v('bg', '--bg'), w)} 0 0)`
    // the glow: the theme's accent and violet, lit from two corners behind everything
    const glow = (at: string, c: string) => `radial-gradient(70% 60% at ${at}, color-mix(in srgb, var(${c}) 26%, transparent), transparent 70%)`
    st.setProperty('--app-bg', o.glassGlow === false ? base : `${glow('0% 0%', '--accent')}, ${glow('100% 100%', '--tc-purple')}, ${base}`)
    st.setProperty('--term-bg', alpha(v('bg', '--bg'), solid('glassTerm')))
    st.setProperty('--side', alpha(v('side', '--side'), solid('glassSide')))
    // the selected tab as the terminal, joined to it; a see-through terminal: a lift instead, the bar's tint is under it
    // ponytail: the bar's tint stays under the tab, so it matches the terminal only when that's mostly solid
    st.setProperty('--tab-sel', solid('glassTerm') >= 50 ? alpha(v('bg', '--bg'), solid('glassTerm')) : alpha(v('fg', '--fg'), 10))
  }
  if (!t.c || !t.ansi) return
  const { c, ansi: a } = t
  const vars: Record<string, string> = {
    '--bg': c.bg, '--app-bg': t.grad ? gradient(t.grad) : c.bg, '--term-bg': t.grad ? '#00000000' : c.bg, '--tab-sel': t.grad ? c.fg + '1f' : c.bg, '--side': c.side, '--panel': c.panel, '--hover': c.raised,
    '--line': c.line, '--fg': c.fg, '--muted': c.muted, '--accent': c.accent, '--accent-fg': c.accentFg, '--sel': c.sel,
    '--running': c.running, '--waiting': c.waiting, '--done': c.done, '--error': c.error, '--add': a[2], '--del': a[1], '--add-bg': a[2] + '1f', '--del-bg': a[1] + '1f', '--hunk': a[5],
    '--tc-red': a[1], '--tc-orange': c.orange, '--tc-yellow': a[3], '--tc-green': a[2], '--tc-teal': a[6], '--tc-blue': a[4], '--tc-purple': c.purple, '--tc-pink': c.pink,
  }
  a.forEach((x, i) => (vars[`--ansi-${i}`] = x))
  for (const [k, v] of Object.entries(vars)) if (!st.getPropertyValue(k)) st.setProperty(k, v) // not what glass or the accent set above
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
