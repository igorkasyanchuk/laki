// #3: Comment on parts of an HTML artifact. The daemon adds ART_PICK to the page it serves the app's viewer with
// ?pick=1 (main.ts artifactPage): a hover outline, and a click on an element (its own click held back) numbers it on the
// page and tells the viewer its selector, markup and text by postMessage. The page is sandboxed (an opaque origin): the
// script reads nothing but the page; the viewer takes only those strings from that frame (panels.tsx ArtifactView)
// and makes the message for the agent (artNotes). A note taken back: { laki: 'artUnmark', n } from the viewer; the page
// loaded again (the file changed): { laki: 'artBase', n }, its numbers go on from the viewer's last
export const ART_PICK = `<script>(() => {
  let n = 0, over
  const st = document.createElement('style')
  st.textContent = '.__laki-over{outline:2px solid #4c8dff!important;outline-offset:1px!important;cursor:crosshair!important}.__laki-mark{position:absolute;z-index:2147483647;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#4c8dff;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.35)}'
  ;(document.head || document.documentElement).appendChild(st)
  const one = s => { try { return document.querySelectorAll(s).length === 1 } catch { return false } }
  const sel = el => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement && parts.length < 6; e = e.parentElement) {
      if (e.id && one('#' + CSS.escape(e.id))) { parts.unshift('#' + CSS.escape(e.id)); break }
      let s = e.localName
      const cls = [...e.classList].filter(c => !c.startsWith('__laki')).slice(0, 2)
      if (cls.length) s += '.' + cls.map(c => CSS.escape(c)).join('.')
      const sibs = e.parentElement ? [...e.parentElement.children].filter(x => x.localName === e.localName) : []
      if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(e) + 1) + ')'
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  addEventListener('mouseover', e => { over && over.classList.remove('__laki-over'); over = e.target; over.classList && over.classList.add('__laki-over') }, true)
  addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.target
    if (!el || el.nodeType !== 1) return
    el.classList.remove('__laki-over')
    const r = el.getBoundingClientRect()
    const m = document.createElement('span')
    m.className = '__laki-mark'
    m.textContent = String(++n)
    m.style.left = r.left + scrollX + 'px'
    m.style.top = Math.max(0, r.top + scrollY - 9) + 'px'
    document.documentElement.appendChild(m)
    parent.postMessage({ laki: 'artPick', n, selector: sel(el), html: el.outerHTML.replace(/ class=""/g, '').slice(0, 2000), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) }, '*')
    el.classList.add('__laki-over')
  }, true)
  addEventListener('message', e => {
    if (e.source !== parent || !e.data) return
    if (e.data.laki === 'artUnmark') for (const m of document.querySelectorAll('.__laki-mark')) if (m.textContent === String(e.data.n)) m.remove()
    if (e.data.laki === 'artBase' && Number.isInteger(e.data.n)) n = Math.max(n, e.data.n)
  })
})()</script>`

// main.ts adds it at the page's end (after </html> is fine: the parser takes it into the body), to its bytes as they are
// (a page in another charset than UTF-8 too: the picker is ASCII). Its marks go under <html>, outside the body: placed
// in page coordinates (a positioned body would move them) and never in a picked part's words or markup

export type ArtMark = { n: number; selector: string; html: string; text: string; note: string }
// what goes to the agent: the file, then each note by its number, the element's selector and words, its markup cut short;
// wt: a file of the worktree (View as page), not an artifact
export function artNotes(path: string, marks: ArtMark[], wt = false) {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
  return [
    `Notes on ${wt ? `the page ${path} (in this workspace)` : `the artifact ${path} (in $LAKI_STORAGE_FOLDER)`}, each on one part of the page:`,
    ...marks.map(m => `${m.n}. \`${m.selector}\`${m.text ? ` "${cut(m.text, 80)}"` : ''}: ${m.note.trim()}\n   ${cut(m.html.replace(/\s+/g, ' '), 300)}`),
  ].join('\n')
}
// a message from the picker's frame, as it has to be: anything else is dropped
export function pickOf(d: unknown): Omit<ArtMark, 'note'> | undefined {
  const x = d as Record<string, unknown> | null
  if (!x || x.laki !== 'artPick' || !Number.isInteger(x.n) || typeof x.selector !== 'string' || typeof x.html !== 'string' || typeof x.text !== 'string') return undefined
  return { n: x.n as number, selector: x.selector.slice(0, 500), html: x.html.slice(0, 2000), text: x.text.slice(0, 200) }
}

// #7: notes on a picture or a video artifact: a spot (w and h 0) or a box, its place as fractions of the frame (0 to 1),
// a video's at its time (seconds); said in words for the agent ("at 01:23, a box near the top left"), each frame's
// picture (its marks drawn, imageSave's path) named after them
export type MediaMark = { n: number; x: number; y: number; w: number; h: number; t?: number; note: string }
export const clock = (s: number) => (m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`)(Math.max(0, Math.floor(s)))
export function whereOf(m: Pick<MediaMark, 'x' | 'y' | 'w' | 'h'>) {
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle'
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : ''
  const place = v === 'middle' && !h ? 'the middle' : `the ${v}${h ? ` ${h}` : ''}`
  const pct = (a: number) => `${Math.round(a * 100)}%`
  return m.w > 0.01 || m.h > 0.01 ? `a box near ${place} (x ${pct(m.x)}–${pct(m.x + m.w)}, y ${pct(m.y)}–${pct(m.y + m.h)})` : `a spot near ${place} (x ${pct(m.x)}, y ${pct(m.y)})`
}
export function mediaNotes(path: string, video: boolean, marks: MediaMark[], shots: { path: string; ns: number[] }[]) {
  return [
    `Notes on the ${video ? 'screen recording' : 'picture'} ${path} (in $LAKI_STORAGE_FOLDER), each on ${video ? 'a moment and a place in it' : 'a place in it'}:`,
    ...marks.map(m => `${m.n}. ${video && m.t !== undefined ? `at ${clock(m.t)}, ` : ''}${whereOf(m)}: ${m.note.trim()}`),
    ...(shots.length ? [`${video ? 'The frames' : 'The picture'}, with the numbered marks drawn on: ${shots.map(s => `${s.path} (${s.ns.join(', ')})`).join(', ')}`] : []),
  ].join('\n')
}
