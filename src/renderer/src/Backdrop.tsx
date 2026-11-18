// An empty pane's background (Settings › Appearance › Empty page background): dots, a net or stars on a canvas behind
// Ready, Welcome and "No workspace selected", stirred by the pointer: dots swell and take the accent near it, the net's
// knots move aside and reach for it, stars shift with it (parallax) and brighten. Motion High: they drift and twinkle
// on their own too (30 fps at most); Low: only the pointer moves them, nothing runs while it's still; None: one still
// picture. Colors are the theme's (--fg, --accent), read again as the theme changes; the page's cards are cut out of
// it. No dependency: a 2D canvas
import { useEffect, useRef } from 'react'

export type BackdropKind = 'dots' | 'net' | 'stars' | 'none'
export const BACKDROPS: [BackdropKind, string][] = [['dots', 'Dots (default)'], ['net', 'Net'], ['stars', 'Stars'], ['none', 'None']]

type RGB = [number, number, number]
const col = (c: RGB) => `rgb(${c.join(',')})`
const mix = (a: RGB, b: RGB, f: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`
const smooth = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function Backdrop({ kind = 'dots', motion = 'low' }: { kind?: BackdropKind; motion?: 'high' | 'low' | 'none' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const box = cv?.parentElement
    const ctx = cv?.getContext('2d')
    if (!cv || !box || !ctx || kind === 'none') return
    const ambient = motion === 'high'
    const still = motion === 'none'
    // a CSS color (a var, color-mix, oklch) as rgb numbers: drawn on a pixel, read back
    const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgb = (v: string): RGB => {
      cv.style.color = `var(${v})`
      px.clearRect(0, 0, 1, 1)
      px.fillStyle = getComputedStyle(cv).color
      px.fillRect(0, 0, 1, 1)
      const d = px.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2]]
    }
    let fg: RGB = [200, 200, 200]
    let ac: RGB = [255, 122, 69]
    const colors = () => ((fg = rgb('--fg')), (ac = rgb('--accent')))
    let w = 0
    let h = 0
    // the pointer, and how much it counts (eased in as it comes, out as it leaves)
    const p = { x: 0, y: 0, sx: 0, sy: 0, on: 0, want: 0 }
    type Knot = { hx: number; hy: number; x: number; y: number; vx: number; vy: number }
    type Star = { x: number; y: number; z: number; ph: number; sp: number }
    let knots: Knot[] = []
    let stars: Star[] = []
    const seed = () => {
      const area = w * h
      knots = Array.from({ length: Math.round(clamp(area / 16000, 24, 90)) }, () => {
        const x = Math.random() * w
        const y = Math.random() * h
        const a = Math.random() * Math.PI * 2
        return { hx: x, hy: y, x, y, vx: Math.cos(a) * 0.12, vy: Math.sin(a) * 0.12 }
      })
      stars = Array.from({ length: Math.round(clamp(area / 2600, 80, 420)) }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, ph: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() }))
    }
    const fit = () => {
      const r = box.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      w = r.width
      h = r.height
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }
    // what the page draws (a card, a box with a fill or a border): cut out of the canvas, so a see-through card doesn't
    // show the dots over its words. Looked at as the pane resizes or scrolls and its content changes, not each frame
    const content = box.querySelector<HTMLElement>('.empty')
    let holes: { x: number; y: number; w: number; h: number; r: number }[] = []
    const clear = (c: string) => !c || c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)|\/ 0\)$/.test(c)
    const look = () => {
      holes = []
      if (!content) return
      const o = cv.getBoundingClientRect()
      for (const el of content.querySelectorAll<HTMLElement>('*')) {
        const st = getComputedStyle(el)
        if (clear(st.backgroundColor) && st.backdropFilter === 'none' && (st.borderTopStyle === 'none' || !parseFloat(st.borderTopWidth))) continue
        const r = el.getBoundingClientRect()
        if (r.width < 16 || r.height < 16) continue
        holes.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, r: parseFloat(st.borderTopLeftRadius) || 0 })
      }
    }
    // how near the pointer a point is: 1 on it, 0 at r and past it (times how much the pointer counts now)
    const near = (x: number, y: number, r: number) => p.on * smooth(1 - Math.hypot(x - p.x, y - p.y) / r)

    const dots = (t: number) => {
      const gap = 24
      const base: number[] = []
      for (let y = gap / 2; y < h; y += gap)
        for (let x = gap / 2; x < w; x += gap) {
          const f = still ? 0 : near(x, y, 150)
          const wave = ambient ? 0.06 * Math.sin(t / 1400 + x / 90 + y / 130) : 0
          if (f < 0.01 && !wave) {
            base.push(x, y)
            continue
          }
          const d = Math.hypot(x - p.x, y - p.y) || 1
          ctx.globalAlpha = clamp(0.14 + wave + 0.66 * f, 0, 1)
          ctx.fillStyle = mix(fg, ac, f)
          ctx.beginPath()
          ctx.arc(x + ((x - p.x) / d) * 5 * f, y + ((y - p.y) / d) * 5 * f, 1.1 + 1.7 * f, 0, Math.PI * 2)
          ctx.fill()
        }
      // the rest in one path: most of them, most of the time
      ctx.globalAlpha = 0.14
      ctx.fillStyle = col(fg)
      ctx.beginPath()
      for (let i = 0; i < base.length; i += 2) ctx.rect(base[i] - 1, base[i + 1] - 1, 2, 2)
      ctx.fill()
      return false
    }

    const net = (dt: number) => {
      let moving = false
      for (const k of knots) {
        if (ambient) {
          k.hx += k.vx * dt
          k.hy += k.vy * dt
          if (k.hx < 0 || k.hx > w) k.vx *= -1
          if (k.hy < 0 || k.hy > h) k.vy *= -1
        }
        const f = still ? 0 : near(k.hx, k.hy, 170)
        const d = Math.hypot(k.hx - p.x, k.hy - p.y) || 1
        const tx = k.hx + ((k.hx - p.x) / d) * 36 * f
        const ty = k.hy + ((k.hy - p.y) / d) * 36 * f
        k.x += (tx - k.x) * 0.14
        k.y += (ty - k.y) * 0.14
        if (Math.abs(tx - k.x) + Math.abs(ty - k.y) > 0.3) moving = true
      }
      ctx.lineWidth = 1
      ctx.strokeStyle = col(fg)
      for (let i = 0; i < knots.length; i++)
        for (let j = i + 1; j < knots.length; j++) {
          const a = knots[i]
          const b = knots[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d > 140) continue
          ctx.globalAlpha = (1 - d / 140) * 0.22
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      for (const k of knots) {
        const f = still ? 0 : near(k.x, k.y, 190)
        if (f > 0.01) {
          ctx.globalAlpha = 0.65 * f
          ctx.strokeStyle = col(ac)
          ctx.beginPath()
          ctx.moveTo(k.x, k.y)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.45 + 0.5 * f
        ctx.fillStyle = mix(fg, ac, f)
        ctx.beginPath()
        ctx.arc(k.x, k.y, 1.6 + 1.2 * f, 0, Math.PI * 2)
        ctx.fill()
      }
      return moving
    }

    const sky = (t: number) => {
      // the parallax follows the pointer, eased; it settles back to the middle as the pointer leaves
      const ox = (p.sx - w / 2) * -0.025
      const oy = (p.sy - h / 2) * -0.025
      for (const s of stars) {
        const x = (((s.x * w + ox * s.z) % w) + w) % w
        const y = (((s.y * h + oy * s.z) % h) + h) % h
        const f = still ? 0 : near(x, y, 130)
        const tw = ambient ? 0.7 + 0.3 * Math.sin((t / 900) * s.sp + s.ph) : 1
        ctx.globalAlpha = clamp((0.2 + 0.6 * s.z) * tw + 0.5 * f, 0, 1)
        ctx.fillStyle = mix(fg, ac, f * 0.8)
        const r = 0.4 + s.z * 1.1 + f * 0.9
        ctx.fillRect(x - r / 2, y - r / 2, r, r)
      }
      return Math.abs(p.sx - (p.on ? p.x : w / 2)) + Math.abs(p.sy - (p.on ? p.y : h / 2)) > 0.5
    }

    let raf = 0
    let last = 0
    const frame = (t: number) => {
      raf = 0
      if (ambient && t - last < 33 && last) return void (raf = requestAnimationFrame(frame)) // 30 fps is plenty
      const dt = last ? Math.min(3, (t - last) / 16.7) : 1
      last = t
      p.on += (p.want - p.on) * 0.12
      if (Math.abs(p.want - p.on) < 0.01) p.on = p.want
      p.sx += ((p.on ? p.x : w / 2) - p.sx) * 0.08
      p.sy += ((p.on ? p.y : h / 2) - p.sy) * 0.08
      ctx.clearRect(0, 0, w, h)
      const moving = kind === 'net' ? net(dt) : kind === 'stars' ? sky(t) : dots(t)
      ctx.globalAlpha = 1
      if (holes.length) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.beginPath()
        for (const o of holes) ctx.roundRect(o.x, o.y, o.w, o.h, Math.min(o.r, o.w / 2, o.h / 2))
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
      }
      if (!still && (ambient || moving || p.on !== p.want)) raf = requestAnimationFrame(frame)
      else last = 0
    }
    const kick = () => (raf ||= requestAnimationFrame(frame))
    const move = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      p.x = e.clientX - r.left
      p.y = e.clientY - r.top
      p.want = 1
      kick()
    }
    const leave = () => ((p.want = 0), kick())
    colors()
    fit()
    look()
    p.sx = w / 2
    p.sy = h / 2
    kick()
    const again = () => (look(), kick())
    const ro = new ResizeObserver(() => (fit(), again()))
    ro.observe(box)
    // the page's cards: as they change (another workspace's, Welcome's checks) and after they've grown in (motion)
    const mc = new MutationObserver(again)
    if (content) mc.observe(content, { childList: true, subtree: true })
    content?.addEventListener('scroll', again, { passive: true })
    const settle = window.setTimeout(again, 450)
    // a theme or accent change: <html>'s class, style or data-* attributes
    const mo = new MutationObserver(() => (colors(), kick()))
    mo.observe(document.documentElement, { attributes: true })
    if (!still) box.addEventListener('pointermove', move)
    if (!still) box.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      mc.disconnect()
      clearTimeout(settle)
      content?.removeEventListener('scroll', again)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerleave', leave)
    }
  }, [kind, motion])
  return kind === 'none' ? null : <canvas ref={ref} className="backdrop" aria-hidden="true" />
}
