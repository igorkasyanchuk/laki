import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './look.css'

// a phone's keyboard shrinks only the visual viewport (iOS Safari): the narrow layout fits what's left (--vh), in
// the page's pixels (× scale: a pinch-zoom shrinks the visual viewport too)
const vv = window.visualViewport
vv?.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${vv.height * vv.scale}px`))

// the bundled fonts first, every subset (Latin, Latin Extended, Cyrillic): a terminal measures its cells and
// caches its glyphs as it opens
Promise.all(['13px "JetBrains Mono"', 'bold 13px "JetBrains Mono"', '13px Inter'].map(f => document.fonts.load(f, 'aĀЖ')))
  .catch(() => {})
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
