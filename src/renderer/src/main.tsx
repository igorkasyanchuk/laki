import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AiWindow, NewWindow, SimWindow, TabWindow } from './NewWindow'
import './styles.css'
import './look.css'

// a phone's keyboard shrinks only the visual viewport (iOS Safari): the narrow layout fits what's left (--vh), in
// the page's pixels (× scale: a pinch-zoom shrinks the visual viewport too)
const vv = window.visualViewport
vv?.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${vv.height * vv.scale}px`))

// the bundled fonts first, every subset (Latin, Latin Extended, Cyrillic): a terminal measures its cells and
// caches its glyphs as it opens
// the other terminal fonts too (small, Latin only): one picked in Settings is drawn at once, measured right
const MORE = ['Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', 'Geist Mono', 'Hack', 'Iosevka', 'Inconsolata', 'Roboto Mono', 'Victor Mono'].flatMap(f => [`13px "${f}"`, `bold 13px "${f}"`])
Promise.all(['13px "JetBrains Mono"', 'bold 13px "JetBrains Mono"', '13px Inter', ...MORE].map(f => document.fonts.load(f, 'aĀЖ')))
  .catch(() => {})
  .finally(() => {
    const w = new URLSearchParams(location.search).get('window') // main's new-workspace, AI and floating tab windows: the page alone
    if (w === 'new' || w === 'ai') document.title = w === 'new' ? 'New workspace — Laki' : 'Laki AI' // the window's title: a screen share's picker, the Window menu
    createRoot(document.getElementById('root')!).render(w === 'new' ? <NewWindow /> : w === 'ai' ? <AiWindow /> : w === 'tab' ? <TabWindow /> : w === 'sim' ? <SimWindow /> : <App />)
  })
