// E9: a look's own rules are looks/<look>.css (once one looks.css of every look's): the window's first load has only
// looks-base.css, a look's file loads as it's set (themes.ts applyTheme: Settings' theme cards preview on hover, so
// they load it then), and at start the one set last (lookStart, main.tsx: before the first render). Every look file
// loaded but the current look's is turned off (sheet.disabled): one left from a preview, later in the page, can't
// reorder the cascade. Out of themes.ts so the first load doesn't take it
let FILES: Record<string, () => Promise<unknown>> = {}
try {
  FILES = import.meta.glob('./looks/*.css') // Vite writes the list as it builds; node (the tests) has none: no look files
} catch {}
const KEY = 'laki.look' // the look set last, in this browser: every window's, the phone page's own
const sheets = new Map<string, CSSStyleSheet[]>()
const loads = new Map<string, Promise<void>>()
let now = ''
let queue = Promise.resolve() // one file at a time: the sheets new after each are its own
const on = () => sheets.forEach((ss, look) => ss.forEach(s => (s.disabled = look !== now)))
function load(look: string): Promise<void> {
  const file = FILES[`./looks/${look}.css`]
  if (!look || !file) return Promise.resolve()
  let p = loads.get(look)
  if (!p) {
    p = queue = queue.then(async () => {
      const had = new Set(Array.from(document.styleSheets))
      await file().catch(() => {}) // Vite adds its stylesheet and waits for it
      sheets.set(look, Array.from(document.styleSheets).filter(s => !had.has(s)))
      on()
    })
    loads.set(look, p)
  }
  return p
}
// applyTheme's: the look <html> has now; its file, the others off
export function lookSet(look = '') {
  if (look !== now) {
    now = look
    on()
    try {
      localStorage.setItem(KEY, look)
    } catch {}
  }
  return load(look)
}
// main.tsx's, with the fonts: the last look's file before the first render
export function lookStart() {
  try {
    now = localStorage.getItem(KEY) ?? ''
  } catch {}
  return load(now)
}
