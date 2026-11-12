// Colors in OKLCH (Björn Ottosson's OKLab), pure: themes.ts' Display P3 accent and status colors (applyTheme's p3Sheet)
// raise a theme's chroma where the screen has the wider gamut, lightness and hue kept. test/units-more.test.ts

export type Oklch = { l: number; c: number; h: number } // l 0-1, c 0-0.4ish, h degrees
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

// linear sRGB ↔ OKLab
function toLab([r, g, b]: number[]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromLab([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}
const labOf = ({ l, c, h }: Oklch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]

export function hexToOklch(hex: string): Oklch {
  const [l, a, b] = toLab(rgbOf(hex).map(lin))
  const c = Math.hypot(a, b)
  return { l, c, h: c < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}
export function oklchToHex(o: Oklch) {
  return '#' + fromLab(labOf(o)).map(v => Math.round(Math.min(1, Math.max(0, gam(v))) * 255).toString(16).padStart(2, '0')).join('')
}
// inside Display P3: linear sRGB to linear P3 (both D65), every channel in 0-1
export function inP3(o: Oklch, eps = 1e-4) {
  const [r, g, b] = fromLab(labOf(o))
  const p = [0.8224621 * r + 0.177538 * g, 0.0331941 * r + 0.9668058 * g, 0.0170827 * r + 0.0723974 * g + 0.9105199 * b]
  return p.every(v => v >= -eps && v <= 1 + eps)
}
// a color's chroma raised by up to `more` (15%), as far as Display P3 holds it, lightness and hue as they were; a grey
// stays grey. css: oklch() for the stylesheet
export function p3Boost(hex: string, more = 0.15): Oklch & { css: string } {
  const o = hexToOklch(hex)
  let c = o.c
  if (o.c > 1e-4) {
    let [lo, hi] = [o.c, o.c * (1 + more)]
    if (inP3({ ...o, c: hi })) lo = hi
    else
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2
        if (inP3({ ...o, c: mid })) lo = mid
        else hi = mid
      }
    c = lo
  }
  return { l: o.l, c, h: o.h, css: `oklch(${(o.l * 100).toFixed(2)}% ${c.toFixed(4)} ${o.h.toFixed(2)})` }
}
