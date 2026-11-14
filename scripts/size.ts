// npm run size: the window's first load, a local gate (npm run dmg runs it after the build; no CI): out/renderer's
// index.html, its entry script and stylesheets and the chunks they import statically (an import(): not first load),
// summed and held to package.json's lakiSize { js, css } in KB, 3% allowed. Over it: the total, the budget, the five
// largest first-load chunks with the source files they hold (a sourcemap's sources, else the bundler's // path comments),
// exit 1. --write sets the budget to what it is now, on purpose
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STATIC = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\bfrom\s*)?["']([^"']+)["']/g // never import("…"): a ( after import

// what index.html loads first: { js, css }, paths as files has them (relative to the html's folder). files: a path's text
export function firstLoad(html: string, files: Record<string, string>): { js: string[]; css: string[] } {
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}=["']([^"']+)["']`).exec(tag)?.[1]
  const at = (from: string, p: string) => normalize(join(dirname(from), p)).replace(/^\.\//, '')
  const js: string[] = []
  const css: string[] = []
  const style = (p: string) => void (!css.includes(p) && p in files && css.push(p))
  const take = (p: string) => {
    if (js.includes(p) || !(p in files)) return
    js.push(p)
    for (const m of files[p].matchAll(STATIC)) if (m[1].startsWith('.')) (m[1].endsWith('.css') ? style : take)(at(p, m[1]))
  }
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const src = tag.startsWith('<script') ? attr(tag, 'src') : /\brel=["'](?:modulepreload|stylesheet)["']/.test(tag) ? attr(tag, 'href') : undefined
    if (!src || /^[a-z]+:/i.test(src)) continue
    const p = at('index.html', src)
    ;(p.endsWith('.css') ? style : take)(p)
  }
  return { js, css }
}

// a chunk's source files: its sourcemap's, else the bundler's leading "// src/…" comments
const sourcesOf = (file: string, text: string) => {
  try {
    if (existsSync(`${file}.map`)) return (JSON.parse(readFileSync(`${file}.map`, 'utf8')).sources as string[]).map(s => s.replace(/^(\.\.\/)+/, ''))
  } catch {}
  return [...new Set([...text.matchAll(/^\/\/(?:#region)? ((?:src|node_modules)\/\S+)$/gm)].map(m => m[1]))]
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const out = join(root, 'out/renderer')
  if (!existsSync(join(out, 'index.html'))) throw new Error('no out/renderer/index.html: npm run build first')
  const files: Record<string, string> = {}
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(m?js|css)$/.test(f)) files[relative(out, p)] = readFileSync(p, 'utf8')
    }
  }
  walk(out)
  const load = firstLoad(readFileSync(join(out, 'index.html'), 'utf8'), files)
  const kb = (ps: string[]) => ps.reduce((n, p) => n + statSync(join(out, p)).size, 0) / 1024
  const now = { js: Math.ceil(kb(load.js)), css: Math.ceil(kb(load.css)) }
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (process.argv.includes('--write')) {
    pkg.lakiSize = now
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    return console.log(`first load's budget written: js ${now.js} KB, css ${now.css} KB`)
  }
  const budget = pkg.lakiSize as { js: number; css: number } | undefined
  if (!budget) throw new Error('package.json has no lakiSize: npm run size -- --write sets it')
  const over = (['js', 'css'] as const).filter(k => now[k] > budget[k] * 1.03)
  console.log(`first load: js ${now.js} KB of ${budget.js}, css ${now.css} KB of ${budget.css} (${load.js.length} scripts, ${load.css.length} stylesheets; 3% allowed)`)
  if (!over.length) return
  console.log(`over the budget: ${over.join(', ')}. The largest first-load chunks:`)
  for (const p of [...load.js, ...load.css].sort((a, b) => statSync(join(out, b)).size - statSync(join(out, a)).size).slice(0, 5)) {
    const src = sourcesOf(join(out, p), files[p])
    console.log(`  ${(statSync(join(out, p)).size / 1024).toFixed(0).padStart(6)} KB  ${p}${src.length ? `  (${src.slice(0, 6).join(', ')}${src.length > 6 ? `, +${src.length - 6}` : ''})` : ''}`)
  }
  console.log("Make it smaller (a lazy import(), a page that loads later), or raise the budget on purpose: npm run size -- --write")
  process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
