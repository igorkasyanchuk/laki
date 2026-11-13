// Laki's own guide for Laki AI (laki_help): the guide cut into its paragraphs and list items (most of it is long lists
// under few headings), each under its path of headings; the ones a question's words are in, best first. A word in an
// item's bold lead (- **Groups**: …) counts most. Pure: test/help.test.ts.
// ponytail: words only (a plural's s off, no synonyms); embeddings if "how do I undo" must find Rewind

const SKIP = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'where', 'does', 'with', 'you', 'your', 'from', 'that', 'this', 'are', 'its', 'not', 'laki', 'when', 'why', 'which', 'use', 'get', 'set', 'there', 'have', 'has', 'any', 'one', 'into', 'about', 'work', 'works', 'back', 'bring', 'make', 'want'])
const wordsOf = (q: string) => [...new Set(q.toLowerCase().match(/[a-z0-9⌘⇧⌥⌃]+/g) ?? [])].map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)).filter(w => w.length > 2 && !SKIP.has(w))

export type HelpPart = { at: string; lead: string; text: string }
// name: what the file is called in a part's path (Guide › Using it)
export function helpParts(md: string, name: string): HelpPart[] {
  const out: HelpPart[] = []
  const path: string[] = []
  let text: string[] = []
  let fence = false
  const flush = () => {
    const t = text.join('\n').trim()
    text = []
    if (!t) return
    const lead = /^(?:[-*] |\d+\. )?\*\*(.+?)\*\*/.exec(t)?.[1] ?? ''
    out.push({ at: [name, ...path.filter(Boolean).slice(1)].join(' › '), lead, text: t })
  }
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,4}) +(.+?)\s*#*$/.exec(line)
    if (h) flush(), path.splice(h[1].length - 1, 9, h[2].replace(/[*_`]/g, ''))
    else if (!fence && (!line.trim() || /^(- |\d+\. )/.test(line))) flush(), line.trim() && text.push(line) // a blank line, or a new item at the margin
    else text.push(line)
  }
  flush()
  return out
}

const PART = 1400 // of one part
// a long part (the guide has paragraphs of several thousand characters): the sentences with the words, each with the one
// before it, in their order
function snip(text: string, words: string[], size: number) {
  if (text.length <= size) return text
  const ss = text.split(/(?<=[.;:])\s+/)
  const has = ss.map(x => words.some(w => x.toLowerCase().includes(w)))
  const out: string[] = []
  let n = 0
  let gap = false
  for (let i = 0; i < ss.length && n < size; i++) {
    if (!(has[i] || has[i + 1] || i === 0)) gap = true
    else out.push(gap ? `… ${ss[i]}` : ss[i]), (n += ss[i].length + 1), (gap = false)
  }
  return `${out.join(' ').slice(0, size)}${gap || n >= size ? ' …' : ''}`
}
export function helpFind(parts: HelpPart[], question: string, max = 7000) {
  const words = wordsOf(question)
  const hits = (s: string, w: string) => s.split(w).length - 1
  const scored = parts
    .map(p => {
      const [lead, head, body] = [p.lead, p.at, p.text].map(s => s.toLowerCase())
      const found = words.filter(w => body.includes(w) || head.includes(w))
      // how many of the words, then where (its lead, its headings) and how thick in it: a long paragraph has every word once
      return { p, n: found.length, score: words.reduce((n, w) => n + (lead.includes(w) ? 6 : 0) + (head.includes(w) ? 2 : 0), 0) + words.reduce((n, w) => n + Math.min(hits(body, w), 3), 0) / (1 + body.length / 1200) }
    })
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || b.score - a.score)
  if (!scored.length) return { found: 0, note: 'nothing in the guide on that: ask with other words, or about one of these', topics: [...new Set(parts.map(p => p.lead || p.at))].filter(t => t.length < 40).slice(0, 80) }
  const out: { at: string; text: string }[] = []
  let room = max
  for (const { p } of scored.slice(0, 8)) {
    const text = snip(p.text, words, Math.min(PART, room))
    out.push({ at: p.at, text })
    if ((room -= text.length) < 300) break
  }
  return { found: scored.length, parts: out }
}
