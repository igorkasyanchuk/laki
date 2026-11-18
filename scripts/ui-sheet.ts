// npm run test:sheet (npm run build first): a contact sheet of the UI. scripts/ui-smoke.ts' walk (one demo world, one
// Electron) with LAKI_SHEET: its pages in every look (settingsBase' DESIGNS) × the default dark and light themes
// (LAKI_SHEET_THEMES=all: every theme id in themes.ts), at 1440×900 and the phone's 390×844; no flows. Then
// dist/ui-sheet/index.html: looks as columns, pages as rows, each with its layout facts (a report, not a gate).
// ponytail: the looks' and themes' ids read from their sources by a pattern (a node script can't import the renderer's)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = (f: string) => readFileSync(join(root, 'src/renderer/src', f), 'utf8')
const looks = [...src('settingsBase.ts').split('export const DESIGNS')[1].split('\n]')[0].matchAll(/^\s*\['([\w-]+)',/gm)].map(m => m[1])
const themes = process.env.LAKI_SHEET_THEMES === 'all' ? [...src('themes.ts').split('export const THEMES')[1].split('\n]')[0].matchAll(/^\s*id: '([\w-]+)'/gm)].map(m => m[1]) : ['laki', 'laki-light']
if (!looks.length || !themes.length) throw new Error('no looks or themes found in their sources')
const at = Date.now()
try {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/ui-smoke.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, LAKI_SHEET: JSON.stringify({ looks, themes }) } })
} catch {} // a step that failed is in result.json: shown on the sheet
const dir = join(root, 'dist/ui-sheet')
if (!existsSync(join(dir, 'result.json'))) throw new Error('no dist/ui-sheet/result.json: the window never finished')
type Step = { name: string; ok: boolean; why?: string; facts?: { clipped: string[]; over: string[] } }
const steps = new Map((JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as Step[]).map(s => [s.name, s]))
// a step's name is <look>-<theme>-<page>: the page is what's left after the look and the theme
const pageOf = (n: string) => {
  const look = looks.find(l => n.startsWith(`${l}-`))
  const theme = look && [...themes].sort((a, b) => b.length - a.length).find(t => n.startsWith(`${look}-${t}-`)) // laki-light before laki
  return look && theme ? n.slice(look.length + theme.length + 2) : undefined
}
const pages = [...new Set([...steps.keys()].map(pageOf).filter((x): x is string => !!x))]
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
const cols = looks.flatMap(l => themes.map(t => `${l}-${t}`))
const cell = (c: string, p: string) => {
  const s = steps.get(`${c}-${p}`)
  if (!s) return '<td></td>'
  const f = s.facts
  const notes = [!s.ok && `<b>failed</b>: ${esc(s.why ?? '')}`, f?.clipped.length && `<span title="${esc(f.clipped.join('\n'))}">${f.clipped.length} clipped</span>`, f?.over.length && `<span title="${esc(f.over.join('\n'))}">${f.over.length} past the edge</span>`].filter(Boolean)
  return `<td><a href="${esc(`${c}-${p}.png`)}"><img loading="lazy" src="${esc(`${c}-${p}.png`)}" alt="${esc(`${c} ${p}`)}"></a>${notes.length ? `<div class="n">${notes.join(' · ')}</div>` : ''}</td>`
}
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Laki contact sheet</title>
<style>
:root { color-scheme: light dark; font: 13px -apple-system, system-ui, sans-serif }
body { margin: 0; padding: 16px }
header { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; position: sticky; left: 16px }
table { border-collapse: collapse }
th, td { padding: 6px; vertical-align: top; text-align: left }
thead th { position: sticky; top: 0; background: Canvas; z-index: 1 }
tbody th { position: sticky; left: 0; background: Canvas; white-space: nowrap }
img { width: 240px; display: block; border: 1px solid GrayText; border-radius: 4px }
td:focus-within img, img.on { outline: 2px solid Highlight }
.n { max-width: 240px; color: GrayText; font-size: 12px; margin-top: 2px }
dialog { padding: 0; border: 0; max-width: 96vw; max-height: 96vh; background: none }
dialog img { width: auto; max-width: 96vw; max-height: 90vh }
dialog p { color: white; margin: 4px 0; text-shadow: 0 1px 2px black }
dialog::backdrop { background: rgb(0 0 0 / 0.8) }
</style>
<header><strong>Laki contact sheet</strong><span>${steps.size} pictures, ${((Date.now() - at) / 60e3).toFixed(1)} min, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</span>
<label>Page <input id="f" placeholder="filter" autocomplete="off"></label><span>Click: full size · ← → ↑ ↓ step · Esc close</span></header>
<table><thead><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
${pages.map(p => `<tr data-page="${esc(p)}"><th>${esc(p)}</th>${cols.map(c => cell(c, p)).join('')}</tr>`).join('\n')}
</tbody></table>
<dialog id="d"><p id="t"></p><img id="big" alt=""></dialog>
<script>
const d = document.getElementById('d'), big = document.getElementById('big'), t = document.getElementById('t')
let at = null // [row, col] of the one shown
const rows = () => [...document.querySelectorAll('tbody tr')].filter(r => !r.hidden)
const show = (r, c) => { const a = rows()[r]?.children[c + 1]?.querySelector('a'); if (!a) return false; at = [r, c]; big.src = a.href; t.textContent = a.querySelector('img').alt; d.open || d.showModal(); return true }
document.addEventListener('click', e => { const a = e.target.closest('td a'); if (!a) return; e.preventDefault(); const tr = a.closest('tr'); show(rows().indexOf(tr), [...tr.children].indexOf(a.parentElement) - 1) })
document.addEventListener('keydown', e => {
  if (!at || !d.open) return
  const [r, c] = at, step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key]
  if (step) e.preventDefault(), show(r + step[0], c + step[1])
})
d.addEventListener('click', () => d.close())
document.getElementById('f').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); for (const r of document.querySelectorAll('tbody tr')) r.hidden = !!q && !r.dataset.page.includes(q) })
</script>
`,
)
const failed = [...steps.values()].filter(s => !s.ok).length
console.log(`${steps.size} pictures in ${((Date.now() - at) / 60e3).toFixed(1)} min${failed ? `, ${failed} failed` : ''}: ${join(dir, 'index.html')}`)
