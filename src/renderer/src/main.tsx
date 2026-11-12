import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { FloatNotices } from './Shown'
import { Boundary } from './ui'
import { exits } from './motion'
import { pwaStart } from './pwa'
import './styles.css'
import './fonts.css'
import './components.css'
import './looks.css'

// a phone's keyboard shrinks only the visual viewport (iOS Safari): the narrow layout fits what's left (--vh), in
// the page's pixels (× scale: a pinch-zoom shrinks the visual viewport too)
// E8: when the first sidebar row is painted, as performance's laki-sidebar mark (test:ui prints it)
new MutationObserver((_, o) => document.querySelector('.sidebar .ws') && (o.disconnect(), requestAnimationFrame(() => performance.mark('laki-sidebar')))).observe(document, { childList: true, subtree: true })
exits(document.body) // V7: what floats fades out as it closes
if (!new URLSearchParams(location.search).get('window')) void pwaStart() // M4: remote access's page as an app
// typing: macOS hides the pointer until it moves, but :hover stays where it rests (a resize handle's accent line
// alone, between the sidebar and the terminal): hover lines hide from a key until the mouse moves (styles.css data-typing)
const root = document.documentElement
addEventListener('keydown', () => root.dataset.typing ?? (root.dataset.typing = ''), true)
addEventListener('pointermove', () => root.dataset.typing !== undefined && delete root.dataset.typing, true)
// folds open by a click (a group's head, Earlier, Show more, a ? hint) grow to their height (styles.css html[data-unfold]):
// only then, never as the window first draws
let unfold: ReturnType<typeof setTimeout> | undefined
addEventListener('click', e => (e.target as Element | null)?.closest?.('[aria-expanded], .rd-more, .help-q') && ((root.dataset.unfold = ''), clearTimeout(unfold), (unfold = setTimeout(() => delete root.dataset.unfold, 400))), true)
const vv = window.visualViewport
vv?.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${vv.height * vv.scale}px`))

// the bundled fonts first, every subset (Latin, Latin Extended, Cyrillic): a terminal measures its cells and
// caches its glyphs as it opens
// the other terminal fonts too (small, Latin only): one picked in Settings is drawn at once, measured right
const MORE = ['Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', 'Geist Mono', 'Hack', 'Iosevka', 'Inconsolata', 'Roboto Mono', 'Victor Mono'].flatMap(f => [`13px "${f}"`, `bold 13px "${f}"`])
const w = new URLSearchParams(location.search).get('window') // main's new-workspace, AI and floating tab windows: the page alone
// E8: each window loads only what it draws (the app window App, a floated one NewWindow.tsx), while the fonts load
const page: Promise<ReactNode> = w
  ? import('./NewWindow').then(m => (w === 'new' ? <m.NewWindow /> : w === 'ai' ? <><m.AiWindow /><FloatNotices /></> : w === 'tab' ? <><m.TabWindow /><FloatNotices /></> : w === 'sim' ? <><m.SimWindow /><FloatNotices /></> : w === 'quick' ? <m.QuickWindow /> : null))
  : import('./App').then(m => <m.App />)
Promise.all(['13px "JetBrains Mono"', 'bold 13px "JetBrains Mono"', '13px Inter', ...MORE].map(f => document.fonts.load(f, 'aĀЖ')))
  .catch(() => {})
  .then(() => page)
  .then(el => {
    if (w === 'new' || w === 'ai') document.title = w === 'new' ? 'New workspace — Laki' : 'Laki AI' // the window's title: a screen share's picker, the Window menu
    createRoot(document.getElementById('root')!).render(<Boundary>{el}</Boundary>) // a throw while drawing: a message and Reload, not a black window
  })
