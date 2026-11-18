// An empty page's background (Settings › Appearance › Empty page background): on a canvas behind Ready, Welcome, "No
// workspace selected" and the New workspace page (ui.tsx Page's backdrop), stirred by the pointer. Stars (the default)
// shift with it (parallax) and brighten; Stardust is many tiny ones, joined into constellations near it; dots swell and
// take the accent; the net's knots move aside and reach for it; a grid bends toward it, lit around it; fireflies
// gather to it and glow. Motion High: they drift and twinkle on their own too (30 fps at most); Low: only the pointer
// moves them, nothing runs while it's still; None (or the system's Reduce motion): one still picture. Colors are the
// theme's (--fg, --accent), read again as the theme changes; the page's see-through cards are cut out of it. No
// dependency: a 2D canvas
import { useEffect, useRef } from 'react'

export type BackdropKind = 'stars' | 'dust' | 'dots' | 'net' | 'grid' | 'fireflies' | 'none'
export const BACKDROP: BackdropKind = 'stars' // unset
export const BACKDROPS: [BackdropKind, string][] = [['stars', 'Stars'], ['dust', 'Stardust'], ['dots', 'Dots'], ['net', 'Net'], ['grid', 'Grid'], ['fireflies', 'Fireflies'], ['none', 'None']]

type RGB = [number, number, number]
const col = (c: RGB) => `rgb(${c.join(',')})`
const rgba = (c: RGB, a: number) => `rgba(${c.join(',')},${a})`
const mix = (a: RGB, b: RGB, f: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`
const smooth = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function Backdrop({ kind: asked, motion = 'low' }: { kind?: BackdropKind; motion?: 'high' | 'low' | 'none' }) {
  const kind = BACKDROPS.some(([v]) => v === asked) ? asked! : BACKDROP // unset, or one from a newer Laki: the default
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const box = cv?.parentElement
    const ctx = cv?.getContext('2d')
    if (!cv || !box || !ctx || kind === 'none') return
    const still = motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches
    const ambient = motion === 'high' && !still
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
    // a firefly's glow, drawn once per color: the accent, bright in the middle, gone at the edge
    const glow = document.createElement('canvas')
    glow.width = glow.height = 64
    const colors = () => {
      fg = rgb('--fg')
      ac = rgb('--accent')
      const g = glow.getContext('2d')!
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      ;[[0, 1], [0.16, 0.85], [0.42, 0.22], [1, 0]].forEach(([at, a]) => r.addColorStop(at, rgba(ac, a)))
      g.clearRect(0, 0, 64, 64)
      g.fillStyle = r
      g.fillRect(0, 0, 64, 64)
    }
    let w = 0
    let h = 0
    // the pointer, and how much it counts (eased in as it comes, out as it leaves)
    const p = { x: 0, y: 0, sx: 0, sy: 0, on: 0, want: 0 }
    type Knot = { hx: number; hy: number; x: number; y: number; vx: number; vy: number }
    type Star = { x: number; y: number; z: number; ph: number; sp: number }
    type Fly = { hx: number; hy: number; x: number; y: number; a: number; ph: number; sp: number }
    const knots: Knot[] = []
    const stars: Star[] = []
    const flies: Fly[] = []
    const n = (per: number, lo: number, hi: number) => Math.round(clamp((w * h) / per, lo, hi)) // by the area: a small tile (Settings') gets a few
    // as many as the area takes: the ones there kept (moved with the size; stars are in fractions of it), so a resize (a
    // sidebar dragged) never reshuffles them, a few added or dropped
    const fill = <T,>(a: T[], want: number, make: () => T) => {
      a.length = Math.min(a.length, want)
      while (a.length < want) a.push(make())
    }
    const seed = (sx: number, sy: number) => {
      const r = Math.random
      for (const k of [...knots, ...flies]) ((k.hx *= sx), (k.hy *= sy), (k.x *= sx), (k.y *= sy))
      if (kind === 'net')
        fill(knots, n(16000, 8, 90), () => {
          const x = r() * w
          const y = r() * h
          const a = r() * Math.PI * 2
          return { hx: x, hy: y, x, y, vx: Math.cos(a) * 0.12, vy: Math.sin(a) * 0.12 }
        })
      if (kind === 'stars' || kind === 'dust') fill(stars, kind === 'dust' ? n(650, 40, 1800) : n(2600, 16, 420), () => ({ x: r(), y: r(), z: 0.2 + r() * 0.8, ph: r() * Math.PI * 2, sp: 0.5 + r() }))
      if (kind === 'fireflies')
        fill(flies, n(24000, 5, 48), () => {
          const x = r() * w
          const y = r() * h
          return { hx: x, hy: y, x, y, a: r() * Math.PI * 2, ph: r() * Math.PI * 2, sp: 0.6 + r() * 0.8 }
        })
    }
    const fit = () => {
      const r = box.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      if (!r.width || !r.height || (Math.round(r.width) === Math.round(w) && Math.round(r.height) === Math.round(h) && cv.width === Math.round(w * dpr))) return false // hidden: kept as it was
      const [ow, oh] = [w, h]
      w = r.width
      h = r.height
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed(ow ? w / ow : 1, oh ? h / oh : 1)
      return true
    }
    // what the page draws see-through (a card with a fill, a blur or a border): cut out of the canvas, so the stars
    // don't show over its words. Looked at as the box resizes or scrolls and its content changes (once a frame at
    // most), not each frame. One that covers the box (the page itself) isn't a card
    let holes: { x: number; y: number; w: number; h: number; r: number }[] = []
    const clear = (c: string) => !c || c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)|\/ 0\)$/.test(c)
    const look = () => {
      holes = []
      const o = cv.getBoundingClientRect()
      for (const el of box.querySelectorAll<HTMLElement>('*')) {
        if (el === cv) continue
        const r = el.getBoundingClientRect()
        if (r.width < 16 || r.height < 16 || r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom || r.width * r.height > o.width * o.height * 0.9) continue
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue // its own or a parent's: a menu fading out
        const st = getComputedStyle(el)
        if (clear(st.backgroundColor) && st.backdropFilter === 'none' && (st.borderTopStyle === 'none' || !parseFloat(st.borderTopWidth))) continue
        holes.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, r: parseFloat(st.borderTopLeftRadius) || 0 })
      }
    }
    // how near the pointer a point is: 1 on it, 0 at r and past it (times how much the pointer counts now)
    const near = (x: number, y: number, r: number) => (still ? 0 : p.on * smooth(1 - Math.hypot(x - p.x, y - p.y) / r))

    const dots = (t: number) => {
      const gap = 24
      const base: number[] = []
      for (let y = gap / 2; y < h; y += gap)
        for (let x = gap / 2; x < w; x += gap) {
          const f = near(x, y, 150)
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
        if (drift) {
          k.hx += k.vx * dt
          k.hy += k.vy * dt
          if (k.hx < 0 || k.hx > w) k.vx *= -1
          if (k.hy < 0 || k.hy > h) k.vy *= -1
        }
        const f = near(k.hx, k.hy, 170)
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
        const f = near(k.x, k.y, 190)
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

    // stars and stardust: the same sky, stardust's many times as many and smaller, its near ones joined up
    const sky = (t: number) => {
      const dust = kind === 'dust'
      const R = dust ? 120 : 130
      // the parallax follows the pointer, eased; it settles back to the middle as the pointer leaves
      const ox = (p.sx - w / 2) * -0.025
      const oy = (p.sy - h / 2) * -0.025
      const lit: [number, number, number][] = []
      const base = col(fg)
      ctx.fillStyle = base
      for (const s of stars) {
        const x = (((s.x * w + ox * s.z) % w) + w) % w
        const y = (((s.y * h + oy * s.z) % h) + h) % h
        const f = near(x, y, R)
        const tw = ambient ? 0.7 + 0.3 * Math.sin((t / 900) * s.sp + s.ph) : 1
        ctx.globalAlpha = clamp((dust ? 0.14 + 0.5 * s.z : 0.2 + 0.6 * s.z) * tw + 0.5 * f, 0, 1)
        const r = dust ? 0.3 + s.z * 0.75 + f * 0.9 : 0.4 + s.z * 1.1 + f * 0.9
        if (f > 0.01) ctx.fillStyle = mix(fg, ac, f * 0.8)
        ctx.fillRect(x - r / 2, y - r / 2, r, r)
        if (f > 0.01) ctx.fillStyle = base
        if (dust && f > 0.2 && lit.length < 90) lit.push([x, y, f])
      }
      // constellations: the near ones, a short line between each two close enough, brighter nearer the pointer
      if (lit.length > 1) {
        ctx.lineWidth = 0.75
        ctx.strokeStyle = col(ac)
        for (let i = 0; i < lit.length; i++)
          for (let j = i + 1; j < lit.length; j++) {
            const [ax, ay, af] = lit[i]
            const [bx, by, bf] = lit[j]
            const d = Math.hypot(ax - bx, ay - by)
            if (d > 44) continue
            ctx.globalAlpha = 0.55 * Math.min(af, bf) * (1 - d / 44)
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.lineTo(bx, by)
            ctx.stroke()
          }
      }
      return Math.abs(p.sx - (p.on ? p.x : w / 2)) + Math.abs(p.sy - (p.on ? p.y : h / 2)) > 0.5
    }

    // a grid of lines, bent toward the pointer (a well), lit in the accent around it
    const grid = (t: number) => {
      const gap = 34
      const step = 12
      const R = 200
      const path = new Path2D()
      const at = (x: number, y: number): [number, number] => {
        let dx = ambient ? 1.5 * Math.sin(t / 2200 + y / 160) : 0
        let dy = ambient ? 1.5 * Math.cos(t / 2600 + x / 180) : 0
        const f = near(x, y, R)
        if (f > 0) {
          const d = Math.hypot(p.x - x, p.y - y) || 1
          const pull = Math.min(d, 26 * f)
          dx += ((p.x - x) / d) * pull
          dy += ((p.y - y) / d) * pull
        }
        return [x + dx, y + dy]
      }
      for (let y = gap / 2; y < h; y += gap)
        for (let x = 0; ; x += step) {
          const [a, b] = at(Math.min(x, w), y)
          if (x) path.lineTo(a, b)
          else path.moveTo(a, b)
          if (x >= w) break
        }
      for (let x = gap / 2; x < w; x += gap)
        for (let y = 0; ; y += step) {
          const [a, b] = at(x, Math.min(y, h))
          if (y) path.lineTo(a, b)
          else path.moveTo(a, b)
          if (y >= h) break
        }
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.09
      ctx.strokeStyle = col(fg)
      ctx.stroke(path)
      if (p.on > 0.01 && !still) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R)
        g.addColorStop(0, rgba(ac, 0.75 * p.on))
        g.addColorStop(1, rgba(ac, 0))
        ctx.globalAlpha = 1
        ctx.strokeStyle = g
        ctx.stroke(path)
      }
      return false
    }

    // fireflies: they wander (Motion High), come to the pointer (not onto it) and glow brighter near it
    const fireflies = (t: number, dt: number) => {
      let moving = false
      for (const f of flies) {
        if (drift) {
          f.a += (Math.random() - 0.5) * 0.3 * dt
          f.hx += Math.cos(f.a) * 0.35 * dt
          f.hy += Math.sin(f.a) * 0.35 * dt
          // off an edge: in again at the other, where it's drawn too (not flown across the page to it)
          const wrap = (v: number, max: number) => (v < -20 ? max + 20 : v > max + 20 ? -20 : v)
          const [hx, hy] = [wrap(f.hx, w), wrap(f.hy, h)]
          ;((f.x += hx - f.hx), (f.y += hy - f.hy), (f.hx = hx), (f.hy = hy))
        }
        const k = near(f.hx, f.hy, 260)
        const tx = f.hx + (p.x - f.hx) * 0.45 * k
        const ty = f.hy + (p.y - f.hy) * 0.45 * k
        f.x += (tx - f.x) * Math.min(1, 0.06 * dt)
        f.y += (ty - f.y) * Math.min(1, 0.06 * dt)
        if (Math.abs(tx - f.x) + Math.abs(ty - f.y) > 0.3) moving = true
        const pulse = ambient ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((t / 650) * f.sp + f.ph)) : 0.75
        ctx.globalAlpha = clamp(pulse * 0.6 + 0.4 * k, 0, 1)
        const r = 9 + 6 * k
        ctx.drawImage(glow, f.x - r, f.y - r, r * 2, r * 2)
      }
      return moving
    }

    const draws: Partial<Record<BackdropKind, (t: number, dt: number) => boolean>> = { stars: sky, dust: sky, dots, net: (_t, dt) => net(dt), grid, fireflies }
    const draw = draws[kind] ?? sky
    let raf = 0
    let seen = false // the cards to cut out: looked at again on the next frame
    let last = 0
    // drifting on its own: Motion High, and not while the window is away (html.away: its CSS animations pause too)
    const drifts = () => ambient && !document.documentElement.classList.contains('away')
    let drift = ambient // this frame's: the net's knots and the fireflies wander only while it holds
    const paint = (t: number, dt: number) => {
      drift = drifts()
      p.on += (p.want - p.on) * 0.12
      if (Math.abs(p.want - p.on) < 0.01) p.on = p.want
      p.sx += ((p.on ? p.x : w / 2) - p.sx) * 0.08
      p.sy += ((p.on ? p.y : h / 2) - p.sy) * 0.08
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, w, h)
      const moving = draw(t, dt)
      ctx.globalAlpha = 1
      if (holes.length) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.beginPath()
        for (const o of holes) ctx.roundRect(o.x, o.y, o.w, o.h, Math.max(0, Math.min(o.r, o.w / 2, o.h / 2)))
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
      }
      return moving
    }
    const frame = (t: number) => {
      raf = 0
      if (ambient && t - last < 33 && last) return void (raf = requestAnimationFrame(frame)) // 30 fps is plenty
      const dt = last ? Math.min(3, (t - last) / 16.7) : 1
      last = t
      if (seen) ((seen = false), look())
      const moving = paint(t, dt)
      if (!still && (moving || drift || p.on !== p.want)) raf = requestAnimationFrame(frame)
      else last = 0
    }
    const kick = () => (raf ||= requestAnimationFrame(frame))
    const again = () => ((seen = true), kick())
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
    // a new size clears the canvas: drawn again at once, before this frame shows (a frame's wait blinks as a sidebar drags)
    const ro = new ResizeObserver(() => {
      if (fit()) ((seen = false), look(), paint(performance.now(), 0), kick())
      else again()
    })
    ro.observe(box)
    // the page's cards: as they change (another workspace's, Welcome's checks, the form's fields: once typing pauses, not
    // a look over the whole page per key) and after they've grown in (motion); a scroll anywhere in it (capture: scroll
    // doesn't bubble)
    let typed = 0
    const mc = new MutationObserver(() => (clearTimeout(typed), (typed = window.setTimeout(again, 120))))
    mc.observe(box, { childList: true, subtree: true })
    box.addEventListener('scroll', again, { capture: true, passive: true })
    const settle = window.setTimeout(again, 450)
    // a theme or accent change: <html>'s class, style or data-* attributes
    const mo = new MutationObserver(() => (colors(), again()))
    mo.observe(document.documentElement, { attributes: true })
    if (!still) box.addEventListener('pointermove', move)
    if (!still) box.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      mc.disconnect()
      clearTimeout(settle)
      clearTimeout(typed)
      box.removeEventListener('scroll', again, { capture: true })
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerleave', leave)
    }
  }, [kind, motion])
  return kind === 'none' ? null : <canvas ref={ref} className="backdrop" aria-hidden="true" />
}
