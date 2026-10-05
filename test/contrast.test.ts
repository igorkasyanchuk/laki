// every theme stays readable: text, hints and button labels against what they sit on (WCAG contrast ratios)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { THEMES } from '../src/renderer/src/themes.ts'

// #rgb, #rrggbb (an alpha is dropped: these sit on an opaque window)
const rgb = (hex: string) => {
  const h = hex.replace('#', '')
  const x = h.length === 3 ? [...h].map(c => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) / 255)
}
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// what text sits on, and how much it needs: 4.5 for text, 3 for hints and bold button labels
const PAIRS: [string, string, number][] = [
  ['fg', 'bg', 4.5],
  ['fg', 'side', 4.5],
  ['fg', 'panel', 4.5],
  ['fg', 'sel', 3],
  ['muted', 'bg', 3],
  ['muted', 'side', 3],
  ['accentFg', 'accent', 3],
]

test('contrast: every theme is readable', () => {
  assert.ok(Math.abs(ratio('#000', '#fff') - 21) < 0.01)
  // Midnight (default) is the stylesheet's :root
  const root = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8').match(/:root\s*{([^}]*)}/)![1]
  const v = (k: string) => root.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]+)`))![1]
  const midnight = { bg: v('bg'), side: v('side'), panel: v('panel'), fg: v('fg'), muted: v('muted'), accent: v('accent'), accentFg: v('accent-fg'), sel: v('sel') }
  const bad: string[] = []
  for (const t of THEMES) {
    const c = (t.c ?? midnight) as Record<string, string>
    for (const [a, b, min] of PAIRS) {
      const r = ratio(c[a], c[b])
      if (r < min) bad.push(`${t.name}: ${a} ${c[a]} on ${b} ${c[b]} is ${r.toFixed(2)}, needs ${min}`)
    }
  }
  assert.deepEqual(bad, [])
})
