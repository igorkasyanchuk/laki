// Markdown (an agent's words: its last message, an ask, a done summary) as Telegram's HTML (parse_mode HTML): fenced code
// as <pre><code class="language-x">, `code`, **bold**, *italic* and _italic_, ~~struck~~, [links](https://…), headings bold,
// lists as •, > quotes as <blockquote>, a rule as a line; everything else escaped. Telegram refuses a message whose tags
// don't nest (telegram.ts sends it again as plain text then). Pure: test/telegram.test.ts
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s: string) => esc(s).replace(/"/g, '&quot;')

// one line's inline marks: code spans, links and bare addresses first (nothing inside them is a mark), then the rest
// escaped and marked
const marks = (s: string) =>
  esc(s)
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^\w])__(?=\S)([^_\n]+?)(?<=\S)__(?!\w)/g, '$1<b>$2</b>')
    .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '<s>$1</s>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)/g, '$1<i>$2</i>')
function inline(s: string): string {
  return s
    .split(/(`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+)/)
    .map((part, i) => {
      if (!(i % 2)) return marks(part)
      if (part.startsWith('`')) return `<code>${esc(part.slice(1, -1))}</code>`
      if (!part.startsWith('[')) return esc(part) // a bare address: Telegram links it, no mark inside
      const [, t, u] = /^\[([^\]]+)\]\((.+)\)$/.exec(part)!
      return `<a href="${attr(u)}">${marks(t)}</a>`
    })
    .join('')
}

export function mdToTg(md: string): string {
  const out: string[] = []
  let quote: string[] = []
  const flush = () => quote.length && (out.push(`<blockquote>${quote.join('\n')}</blockquote>`), (quote = []))
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i])
      out.push(`<pre>${fence[2] ? `<code class="language-${attr(fence[2])}">` : '<code>'}${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const q = /^\s{0,3}>\s?(.*)$/.exec(line)
    if (q) {
      quote.push(inline(q[1]))
      continue
    }
    flush()
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    const li = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (h) out.push(`<b>${inline(h[1])}</b>`)
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) out.push('──────')
    else if (li) out.push(`${li[1].replace(/\t/g, '  ')}• ${inline(li[2])}`)
    else out.push(inline(line))
  }
  flush()
  return out.join('\n')
}
