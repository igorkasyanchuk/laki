// writes src/shared/iconPacks.ts and src/shared/icon-licenses.txt: Laki's icon names (icons.ts ICONS) drawn by Tabler
// and Lucide, only those, so no package of theirs ships. Fetches each with npm pack (no install, no scripts run):
// node --experimental-strip-types scripts/icon-packs.ts
// Another pack: its package and a column in MAP; a name a pack lacks (null, or no file) is drawn by Laki's own.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKGS = {
  tabler: { pkg: '@tabler/icons@3.49.0', name: 'Tabler Icons', dir: 'icons/outline' },
  lucide: { pkg: 'lucide-static@1.61.0', name: 'Lucide', dir: 'icons' },
}
// a name whose kebab-case isn't the pack's word for it: [tabler, lucide]; null: none fits, Laki's own
const MAP: Record<string, [string | null, string | null]> = {
  fork: ['git-fork', 'git-fork'], pr: ['git-pull-request', 'git-pull-request'], pick: ['crosshair', 'crosshair'], memory: ['brain', 'brain'],
  terminal: ['terminal-2', 'terminal'], globe: ['world', 'globe'], board: ['layout-kanban', 'kanban'], flow: ['sitemap', 'workflow'],
  spec: ['file-text', 'file-text'], desk: ['layout-dashboard', 'layout-dashboard'], note: ['note', 'sticky-note'], listChecks: ['list-check', 'list-checks'],
  ai: ['sparkles', 'sparkles'], more: ['dots', 'ellipsis'], back: ['arrow-left', 'arrow-left'], forward: ['arrow-right', 'arrow-right'],
  sidebar: ['layout-sidebar', 'panel-left'], help: ['help-circle', 'circle-help'], filter: ['filter', 'list-filter'], chevron: ['chevron-down', 'chevron-down'],
  ciFail: ['circle-x', 'circle-x'], conflict: ['alert-triangle', 'triangle-alert'], checks: ['checks', 'check-check'], unread: ['circle-dot', 'circle-dot'],
  agent: ['robot', 'bot'], splitRight: ['layout-columns', 'columns-2'], splitDown: ['layout-rows', 'rows-2'], maximize: ['arrows-maximize', 'maximize-2'],
  minimize: ['arrows-minimize', 'minimize-2'], run: ['player-play', 'play'], pause: ['player-pause', 'pause'], stop: ['player-stop', 'square'],
  ship: ['upload', 'upload'], diff: ['file-diff', 'diff'], changes: ['git-compare', 'git-compare'], review: ['message-code', 'message-square-code'],
  panel: ['layout-sidebar-right', 'panel-right'], info: ['info-circle', 'info'], trash: ['trash', 'trash-2'], restore: ['restore', 'archive-restore'],
  refresh: ['refresh', 'refresh-cw'], popOut: ['external-link', 'square-arrow-out-up-right'], popIn: ['circle-arrow-down-left', 'square-arrow-down-left'],
  image: ['photo', 'image'], layers: ['stack-2', 'layers'], timer: ['stopwatch', 'timer'], mic: ['microphone', 'mic'],
  devices: ['devices', 'monitor-smartphone'], sort: ['arrows-sort', 'arrow-up-down'], import: ['file-import', 'import'], bulb: ['bulb', 'lightbulb'],
  smile: ['mood-smile', 'smile'], race: ['flag', 'flag'], youtube: ['brand-youtube', null], github: ['brand-github', null], gear: ['settings-2', 'cog'],
  save: ['device-floppy', 'save'], unsplit: ['columns-2', 'square-split-horizontal'], collapse: ['fold', 'fold-vertical'], expand: ['arrows-vertical', 'unfold-vertical'],
  sep: ['line-dashed', 'separator-horizontal'], swap: ['switch-horizontal', 'arrow-right-left'], swapVertical: ['switch-vertical', 'arrow-down-up'],
  caretDown: ['caret-down', null], caretUp: ['caret-up', null], caretLeft: ['caret-left', null], caretRight: ['caret-right', null],
  enter: ['corner-down-left', 'corner-down-left'], undo: ['arrow-back-up', 'undo-2'], redo: ['arrow-forward-up', 'redo-2'], rotateCw: ['rotate-clockwise', 'rotate-cw'],
  rotateCcw: ['rotate', 'rotate-ccw'], shuffle: ['arrows-shuffle', 'shuffle'], move: ['arrows-move', 'move'], logIn: ['login', 'log-in'], logOut: ['logout', 'log-out'],
  fileImage: ['file-type-jpg', 'file-image'], fileZip: ['file-zip', 'file-archive'], bookOpen: ['book', 'book-open'], book: ['book-2', 'book'],
  hardDrive: ['server-2', 'hard-drive'], mailOpen: ['mail-opened', 'mail-open'], message: ['message', 'message-square'], messages: ['messages', 'messages-square'],
  messageDots: ['message-dots', 'message-square-more'], at: ['at', 'at-sign'], megaphone: ['speakerphone', 'megaphone'], shareUp: ['share-2', 'share'],
  reply: ['corner-up-left', 'reply'], idCard: ['id', 'id-card'], thumbsUp: ['thumb-up', 'thumbs-up'], thumbsDown: ['thumb-down', 'thumbs-down'],
  frown: ['mood-sad', 'frown'], meh: ['mood-empty', 'meh'], playCircle: ['circle-play', 'circle-play'], pauseCircle: ['circle-pause', 'circle-pause'],
  stopCircle: ['circle-stop', 'circle-stop'], skipForward: ['player-skip-forward', 'skip-forward'], skipBack: ['player-skip-back', 'skip-back'],
  fastForward: ['player-track-next', 'fast-forward'], rewind: ['player-track-prev', 'rewind'], volume: ['volume', 'volume-2'], volumeLow: ['volume-2', 'volume-1'],
  volumeX: ['volume-3', 'volume-x'], film: ['movie', 'film'], images: ['library-photo', 'images'], micOff: ['microphone-off', 'mic-off'], tv: ['device-tv', 'tv'],
  monitor: ['device-desktop', 'monitor'], laptop: ['device-laptop', 'laptop'], smartphone: ['device-mobile', 'smartphone'], tablet: ['device-tablet', 'tablet'],
  watch: ['device-watch', 'watch'], batteryLow: ['battery-1', 'battery-low'], batteryFull: ['battery-4', 'battery-full'], signal: ['antenna-bars-5', 'signal'],
  gamepad: ['device-gamepad-2', 'gamepad-2'], cloudLightning: ['cloud-storm', 'cloud-lightning'], sprout: ['seedling', 'sprout'], tree: ['tree', 'tree-pine'],
  zap: ['bolt', 'zap'], dollar: ['currency-dollar', 'dollar-sign'], euro: ['currency-euro', 'euro'], cart: ['shopping-cart', 'shopping-cart'],
  bag: ['shopping-bag', 'shopping-bag'], store: ['building-store', 'store'], pieChart: ['chart-pie', 'chart-pie'], barChart: ['chart-bar', 'chart-column'],
  lineChart: ['chart-line', 'chart-line'], percent: ['percentage', 'percent'], banknote: ['cash', 'banknote'], alarm: ['alarm', 'alarm-clock'],
  utensils: ['tools-kitchen-2', 'utensils'], wrench: ['tool', 'wrench'], cube: ['cube', 'box'], flask: ['flask', 'flask-conical'],
  shieldAlert: ['shield-exclamation', 'shield-alert'], unlock: ['lock-open', 'lock-open'], qrCode: ['qrcode', 'qr-code'], robot: ['robot', 'bot'],
  checkCircle: ['circle-check', 'circle-check'], xCircle: ['circle-x', 'circle-x'], plusCircle: ['circle-plus', 'circle-plus'], minusCircle: ['circle-minus', 'circle-minus'],
  checkSquare: ['square-check', 'square-check'], plusSquare: ['square-plus', 'square-plus'], grid: ['layout-grid', 'layout-grid'],
  sliders: ['adjustments-horizontal', 'sliders-horizontal'], toggleOn: ['toggle-right', 'toggle-right'], toggleOff: ['toggle-left', 'toggle-left'],
  type: ['typography', 'type'], pointer: ['pointer', 'mouse-pointer'], grip: ['grip-vertical', 'grip-vertical'], moreVertical: ['dots-vertical', 'ellipsis-vertical'],
}
// what an icon may hold: shapes and their geometry, nothing that runs or loads (it goes into the page as markup)
const TAGS = /^(path|circle|rect|line|polyline|polygon|ellipse)$/
const ATTRS = /^(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|width|height|fill|stroke)$/

function inner(svg: string, file: string) {
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg.replace(/<!--[\s\S]*?-->/g, ''))?.[1] ?? ''
  const shapes = [...body.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g)]
  if (body.replace(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g, '').trim()) throw new Error(`${file}: more than shapes`)
  return shapes
    .filter(([, , a]) => !/stroke="none"/.test(a)) // Tabler's blank 24×24 box
    .map(([, tag, a]) => {
      if (!TAGS.test(tag)) throw new Error(`${file}: <${tag}>`)
      const attrs = [...a.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => {
        if (!ATTRS.test(k) || /[<>'&]/.test(v)) throw new Error(`${file}: ${k}="${v}"`)
        return ` ${k}="${v.replace(/\s+/g, ' ').trim()}"`
      })
      return `<${tag}${attrs.join('')}/>`
    })
    .join('')
}

// the names from icons.ts' text, not an import: icons.ts imports the file this writes, which may be missing or broken
const src = readFileSync(fileURLToPath(new URL('../src/shared/icons.ts', import.meta.url)), 'utf8')
const NAMES = [...src.slice(src.indexOf('export const ICONS = {'), src.indexOf('\n}\n', src.indexOf('export const ICONS = {'))).matchAll(/^  (\w+):/gm)].map(m => m[1])
if (NAMES.length < 300) throw new Error(`icons.ts: ${NAMES.length} names read, its ICONS block moved?`)
const tmp = mkdtempSync(join(tmpdir(), 'laki-icons-'))
try {
  const kebab = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const out: string[] = []
  const licenses: string[] = []
  for (const [i, [pack, { pkg, name, dir }]] of Object.entries(PKGS).entries()) {
    const tgz = execFileSync('npm', ['pack', pkg, '--silent', '--ignore-scripts', '--pack-destination', tmp], { encoding: 'utf8' }).trim().split('\n').at(-1)!
    const at = join(tmp, pack)
    mkdirSync(at)
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', at])
    const root = join(at, 'package')
    licenses.push(`${name} (${pkg}): ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).license}\n\n${readFileSync(join(root, 'LICENSE'), 'utf8').trim()}`)
    const lines: string[] = []
    const lacks: string[] = []
    for (const n of NAMES) {
      const word = n in MAP ? MAP[n][i] : kebab(n)
      const file = word && join(root, dir, `${word}.svg`)
      if (!file || !existsSync(file)) {
        lacks.push(word ? `${n} (${word})` : n)
        continue
      }
      lines.push(`    ${n}: '${inner(readFileSync(file, 'utf8'), file)}',`)
    }
    out.push(`  ${pack}: {\n${lines.join('\n')}\n  },`)
    console.log(`${name}: ${lines.length} of ${NAMES.length}; Laki's own for ${lacks.join(', ') || 'none'}`)
  }
  const at = (f: string) => fileURLToPath(new URL(`../src/shared/${f}`, import.meta.url))
  writeFileSync(
    at('iconPacks.ts'),
    `// generated by scripts/icon-packs.ts from ${Object.values(PKGS)
      .map(p => p.pkg)
      .join(' and ')} (their licenses: icon-licenses.txt): don't edit.\n// Laki's icon names, each a 24×24 icon's shapes (stroke currentColor); a name missing: icons.ts draws Laki's own\nexport const PACKS: Record<${Object.keys(PKGS)
      .map(p => `'${p}'`)
      .join(' | ')}, Record<string, string>> = {\n${out.join('\n')}\n}\n`,
  )
  writeFileSync(at('icon-licenses.txt'), `${licenses.join('\n\n---\n\n')}\n`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
