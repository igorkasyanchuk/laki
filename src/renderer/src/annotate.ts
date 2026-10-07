// The menu bar's screenshot, drawn on before it goes to an agent (annotate.html, a small window main keeps over the
// others): crop, arrow, text, rectangle, pen, in one of six colors; ⌘Z undoes; the note goes in the prompt with it.
// Add to prompt (⌘⏎) hands the PNG and the note to main, which opens the new-workspace page with them; Esc cancels.
// Shapes are kept in the picture's own pixels and drawn again whole on each change.
type Pt = { x: number; y: number }
type Shape = { kind: 'arrow' | 'rect' | 'pen'; color: string; pts: Pt[] } | { kind: 'text'; color: string; pts: Pt[]; text: string }
type Tool = 'crop' | 'arrow' | 'text' | 'rect' | 'pen'
type Bridge = { annotate?: { onImage: (cb: (png: string) => void) => void; done: (png: string, note: string) => void; cancel: () => void } }

const TOOLS: [Tool, string, string][] = [
  ['crop', 'Crop', 'c'],
  ['arrow', 'Arrow', 'a'],
  ['text', 'Text', 't'],
  ['rect', 'Rectangle', 'r'],
  ['pen', 'Pen', 'p'],
]
const COLORS = ['#f7404b', '#ff9e3d', '#ffd23f', '#3ccf6e', '#4c8dff', '#ffffff']
const bridge = (window as unknown as { laki?: Bridge }).laki?.annotate

const canvas = document.getElementById('c') as HTMLCanvasElement
const g = canvas.getContext('2d')!
const note = document.getElementById('note') as HTMLTextAreaElement
const bar = document.getElementById('bar')!
const img = new Image()
let tool: Tool = 'arrow'
let color = COLORS[0]
let shapes: Shape[] = []
let crop: { a: Pt; b: Pt } | null = null
let drag: Shape | { kind: 'crop'; pts: Pt[] } | null = null
let typing: HTMLInputElement | null = null

const lw = () => Math.max(3, Math.round(img.naturalWidth / 400)) // a line as thick on a Retina capture as on a small one
const font = () => `700 ${lw() * 7}px -apple-system, system-ui, sans-serif`

function button(label: string, on: () => void, key?: string) {
  const b = document.createElement('button')
  b.textContent = label
  if (key) b.append(Object.assign(document.createElement('kbd'), { textContent: key.toUpperCase() }))
  b.onclick = on
  bar.append(b)
  return b
}
const toolButtons = TOOLS.map(([t, label, key]) => [t, button(label, () => pick(t), key)] as const)
bar.append(Object.assign(document.createElement('span'), { className: 'sep' }))
const swatches = COLORS.map((c, i) => {
  const b = button('', () => paint(c))
  b.className = 'color'
  b.style.background = c
  b.title = `Color ${i + 1}`
  b.setAttribute('aria-label', b.title)
  return [c, b] as const
})
bar.append(Object.assign(document.createElement('span'), { className: 'sep' }))
button('Undo', undo).title = '⌘Z'
bar.append(Object.assign(document.createElement('span'), { className: 'grow' }))
button('Cancel', cancel).title = 'Esc'
const add = button('Add to prompt', finish)
add.className = 'primary'
add.title = '⌘⏎'

function pick(t: Tool) {
  commitText()
  tool = t
  toolButtons.forEach(([k, b]) => b.classList.toggle('on', k === t))
}
function paint(c: string) {
  color = c
  swatches.forEach(([k, b]) => b.classList.toggle('on', k === c))
  if (typing) (typing.style.color = typing.dataset.color = c)
}
pick(tool)
paint(color)

const at = (e: PointerEvent): Pt => {
  const r = canvas.getBoundingClientRect()
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max) // a drag past the edge stops at it
  return { x: clamp(((e.clientX - r.left) * canvas.width) / r.width, canvas.width), y: clamp(((e.clientY - r.top) * canvas.height) / r.height, canvas.height) }
}

function arrow(a: Pt, b: Pt) {
  const head = lw() * 5
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  g.beginPath()
  g.moveTo(a.x, a.y)
  g.lineTo(b.x, b.y)
  g.stroke()
  g.beginPath()
  g.moveTo(b.x, b.y)
  g.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
  g.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
  g.closePath()
  g.fill()
}
function drawShape(s: Shape) {
  g.strokeStyle = g.fillStyle = s.color
  g.lineWidth = lw()
  g.lineCap = g.lineJoin = 'round'
  const [a, b] = [s.pts[0], s.pts.at(-1)!]
  if (s.kind === 'arrow') arrow(a, b)
  else if (s.kind === 'rect') g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  else if (s.kind === 'pen') {
    g.beginPath()
    s.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.stroke()
  } else if (s.kind === 'text') {
    g.font = font()
    g.textBaseline = 'top'
    g.lineWidth = lw() * 0.8
    g.strokeStyle = 'rgba(0,0,0,0.45)'
    g.strokeText(s.text, a.x, a.y)
    g.fillText(s.text, a.x, a.y)
  }
}
const box = (c: { a: Pt; b: Pt }) => ({ x: Math.min(c.a.x, c.b.x), y: Math.min(c.a.y, c.b.y), w: Math.abs(c.b.x - c.a.x), h: Math.abs(c.b.y - c.a.y) })
// everything, again; edit: the crop shown as a frame with the rest dimmed (the export cuts it instead)
function draw(edit = true) {
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.drawImage(img, 0, 0)
  for (const s of shapes) drawShape(s)
  if (drag && drag.kind !== 'crop') drawShape(drag)
  const c = drag?.kind === 'crop' ? { a: drag.pts[0], b: drag.pts.at(-1)! } : crop
  if (edit && c) {
    const r = box(c)
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.beginPath()
    g.rect(0, 0, canvas.width, canvas.height)
    g.rect(r.x, r.y, r.w, r.h)
    g.fill('evenodd')
    g.setLineDash([lw() * 3, lw() * 2])
    g.strokeStyle = '#fff'
    g.lineWidth = lw() / 1.5
    g.strokeRect(r.x, r.y, r.w, r.h)
    g.setLineDash([])
  }
}

canvas.addEventListener('pointerdown', e => {
  if (!img.naturalWidth) return
  commitText()
  const p = at(e)
  if (tool === 'text') return startText(p, e)
  canvas.setPointerCapture(e.pointerId)
  drag = tool === 'crop' ? { kind: 'crop', pts: [p] } : { kind: tool, color, pts: [p] }
})
canvas.addEventListener('pointermove', e => {
  if (!drag) return
  const p = at(e)
  if (drag.kind === 'pen') drag.pts.push(p)
  else drag.pts[1] = p
  draw()
})
canvas.addEventListener('pointercancel', () => ((drag = null), draw())) // the system took the pointer: nothing drawn
canvas.addEventListener('pointerup', () => {
  const d = drag
  drag = null
  if (!d || d.pts.length < 2) return draw()
  const [a, b] = [d.pts[0], d.pts.at(-1)!]
  const tiny = Math.hypot(b.x - a.x, b.y - a.y) < lw() * 2 // a click, not a drag
  if (d.kind === 'crop') crop = tiny ? null : { a, b }
  else if (!tiny || d.kind === 'pen') shapes.push(d)
  draw()
})

// text: a box where the click was, Enter (or a click elsewhere) puts it on the picture
function startText(p: Pt, e: PointerEvent) {
  const stage = canvas.parentElement!
  const r = canvas.getBoundingClientRect()
  const s = stage.getBoundingClientRect()
  const scale = r.width / canvas.width
  const input = document.createElement('input')
  input.className = 'text-in'
  input.style.left = `${e.clientX - s.left}px`
  input.style.top = `${e.clientY - s.top}px`
  input.style.color = input.dataset.color = color
  input.style.fontSize = `${lw() * 7 * scale}px`
  input.dataset.x = String(p.x)
  input.dataset.y = String(p.y)
  input.onkeydown = k => {
    k.stopPropagation()
    if (k.key === 'Enter') commitText()
    else if (k.key === 'Escape') (input.remove(), (typing = null))
  }
  stage.append(input)
  typing = input
  e.preventDefault() // no mousedown: it would move the focus back off the box
  input.focus()
}
function commitText() {
  const t = typing
  if (!t) return
  typing = null
  t.remove()
  if (t.value.trim()) shapes.push({ kind: 'text', color: t.dataset.color ?? color, pts: [{ x: Number(t.dataset.x), y: Number(t.dataset.y) }], text: t.value.trim() })
  draw()
}

function undo() {
  if (typing) return void (typing.remove(), (typing = null))
  if (shapes.length) shapes.pop()
  else crop = null
  draw()
}
function cancel() {
  bridge ? bridge.cancel() : window.close()
}
// the picture as drawn, cut to the crop, at its own size
function finish() {
  commitText()
  draw(false)
  let out = canvas
  if (crop && box(crop).w > 2 && box(crop).h > 2) {
    const r = box(crop)
    out = document.createElement('canvas')
    out.width = Math.round(r.w)
    out.height = Math.round(r.h)
    out.getContext('2d')!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height)
  }
  const png = out.toDataURL('image/png').split(',')[1]
  draw()
  if (bridge) bridge.done(png, note.value.trim())
  else Object.assign(window, { annotated: { png, note: note.value.trim(), w: out.width, h: out.height } }) // the dev server, in a browser: for a look
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') return void (typing ? undefined : cancel())
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return void (e.preventDefault(), finish())
  if (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.target !== note) return void (e.preventDefault(), undo()) // in the note: its own undo
  if (e.target === note || e.metaKey || e.ctrlKey || e.altKey) return
  const t = TOOLS.find(([, , k]) => k === e.key.toLowerCase())
  if (t) pick(t[0])
  else if (/^[1-6]$/.test(e.key)) paint(COLORS[Number(e.key) - 1])
})

img.onload = () => {
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  draw()
}
// main sends the screenshot once the page is in; in a browser (the dev server) a stand-in to draw on
if (bridge) bridge.onImage(png => (img.src = `data:image/png;base64,${png}`))
else {
  const c = Object.assign(document.createElement('canvas'), { width: 1200, height: 700 })
  const x = c.getContext('2d')!
  x.fillStyle = '#f4f6fb'
  x.fillRect(0, 0, 1200, 700)
  x.fillStyle = '#c9b8f5'
  x.fillRect(120, 140, 520, 340)
  x.fillStyle = '#a8e3c4'
  x.fillRect(460, 240, 560, 360)
  img.src = c.toDataURL()
}
