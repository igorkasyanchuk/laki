// Hold ⌘ alone for HOLD ms (settings.keyOverlay, on unless false): a light veil and a badge beside everything with a
// key: an element marked data-key="<KEYS id>" (Settings › Keys' keys, shared/keys.ts overlayKeys) or data-keys="⌘2"
// (a fixed one: a tab, the rows ⌘↑ ⌘↓ go to), and a strip at the bottom for the keys with nothing on screen. Any other
// key, a press or a wheel, the window's blur or ⌘'s release hides it, so a ⌘ shortcut or a ⌘-click never flashes it;
// the key goes on to App's keys as ever.
import { useEffect, useState } from 'react'
import { overlayKeys } from '../../shared/keys'

const HOLD = 600
type Badge = { x: number; y: number; text: string }

export function KeyOverlay({ on, keys }: { on: boolean; keys: unknown }) {
  const [shown, setShown] = useState<{ badges: Badge[]; strip: [string, string][] } | null>(null)
  useEffect(() => {
    if (!on) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let up = false
    const place = () => {
      const els = [...document.querySelectorAll<HTMLElement>('[data-key], [data-keys]')].filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      const { badges, strip } = overlayKeys(keys, new Set(els.flatMap(el => el.dataset.key ?? [])))
      const out: Badge[] = []
      for (const el of els) {
        const text = el.dataset.keys ?? (el.dataset.key && badges[el.dataset.key as keyof typeof badges])
        const r = el.getBoundingClientRect()
        if (text && r.width && r.bottom > 0 && r.top < innerHeight) out.push({ x: Math.min(r.right, innerWidth - 4), y: Math.max(r.top, 4), text })
      }
      setShown({ badges: out, strip })
    }
    const hide = () => (clearTimeout(timer), (timer = undefined), up && ((up = false), setShown(null)))
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Meta' && e.repeat) return
      hide()
      if (e.key !== 'Meta' || e.shiftKey || e.altKey || e.ctrlKey) return
      // a dialog, a page or a menu over the window: their own keys
      if (!document.hasFocus() || document.querySelector('.overlay, .settings-page, .menu, .ask-overlay')) return
      timer = setTimeout(() => ((up = true), place()), HOLD)
    }
    const release = (e: KeyboardEvent) => e.key === 'Meta' && hide()
    const opts = { capture: true, passive: true }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', release, true)
    for (const ev of ['pointerdown', 'wheel', 'blur'] as const) window.addEventListener(ev, hide, opts)
    const resize = () => up && place()
    window.addEventListener('resize', resize)
    return () => {
      hide()
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', release, true)
      for (const ev of ['pointerdown', 'wheel', 'blur'] as const) window.removeEventListener(ev, hide, opts)
      window.removeEventListener('resize', resize)
    }
  }, [on, JSON.stringify(keys ?? null)]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null
  return (
    <div className="key-overlay" aria-hidden>
      {shown.badges.map((b, i) => (
        <span key={i} className="key-badge" style={{ left: b.x, top: b.y }}>
          {b.text}
        </span>
      ))}
      {shown.strip.length > 0 && (
        <div className="key-strip">
          {shown.strip.map(([k, label]) => (
            <span key={k + label}>
              <kbd>{k}</kbd> {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
