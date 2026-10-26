// Markdown to a tree the file preview renders as React nodes (never HTML): headings (# and underlined), paragraphs,
// lists (nested, tasks), fenced code, quotes, tables, rules; inline code, bold, italic, strike, links, images, breaks;
// with html, the HTML GitHub's own bodies use (dependabot's, release notes, READMEs: fromHtml), into the same tree.
// ponytail: GitHub's common subset, not CommonMark's every corner (reference links, footnotes: shown as text; an HTML
// table: its cells as text); add one when a real README needs it
export type Inline = string | { t: 'code'; text: string } | { t: 'b' | 'i' | 's'; kids: Inline[] } | { t: 'a'; href: string; kids: Inline[] } | { t: 'img'; src: string; alt: string } | { t: 'br' }
export type Align = 'left' | 'center' | 'right' | ''
export type Block =
  | { t: 'h'; level: number; inl: Inline[] }
  | { t: 'p'; inl: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: { task?: boolean; blocks: Block[] }[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }
  | { t: 'details'; open: boolean; summary: Inline[]; blocks: Block[] }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*)|$)/
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const indentOf = (l: string) => l.length - l.trimStart().length
const starts = (l: string) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || LIST.test(l) || l[0] === NUL

// html: GitHub's own text (a PR's body and comments, a repo's .md files), its HTML read as GitHub shows it; else (what
// people and agents say) a tag stays text, as typed
export function markdown(src: string, html = false): Block[] {
  const md = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\0/g, '')
  return parse((html ? fromHtml(md) : md).split('\n'))
}

// ---------- GitHub's HTML: its tags as Markdown, outside fenced code; <details> and <blockquote> as NUL marker lines
// that parse() reads as blocks (src has no NUL of its own). Comments, scripts and styles go whole; entities are
// decoded (punctuation escaped, so &lt;b&gt; stays text)
const NUL = '\0'
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', copy: '©' }
const decode = (s: string, md = true) =>
  s.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (e, n: string) => {
    const c = n[0] !== '#' ? ENT[n.toLowerCase()] : (x => (x > 0 && x < 0x110000 ? String.fromCodePoint(x) : undefined))(/x/i.test(n[1]) ? parseInt(n.slice(2), 16) : +n.slice(1))
    return c === undefined ? e : md && /[\\`*_~[\]<>]/.test(c) ? `\\${c}` : c // only what inline() would read as a mark: & or " stay as they are (a URL's)
  })
const attr = (attrs: string, name: string) => decode(attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(x => x !== undefined) ?? '', false)
const plain = (html: string) => decode(html.replace(/<[^>]*>/g, ''), false) // a <code>'s or <pre>'s text
const ticks = (t: string) => !t.trim() ? t : (f => `${f}${/^`|`$/.test(t) ? ` ${t} ` : t}${f}`)('`'.repeat(Math.max(0, ...(t.match(/`+/g) ?? []).map(x => x.length)) + 1))
const link = (u: string) => u.trim().replace(/[\s()<>]/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`) // whole inside (…)
function fromHtml(src: string): string {
  if (!/[<&]/.test(src)) return src
  const out: string[] = []
  let chunk: string[] = []
  let fence = ''
  const flush = () => chunk.length && (out.push(htmlMd(chunk.join('\n'))), (chunk = []))
  for (const l of src.split('\n')) {
    const m = l.match(FENCE)
    if (fence) (out.push(l), l.trimStart().startsWith(fence) && (fence = ''))
    else if (m) flush(), (fence = m[1]), out.push(l)
    else chunk.push(l)
  }
  flush()
  return out.join('\n')
}
// tags it knows: as Markdown below, or gone with their text kept; any other stays text as written (Vec<String> in prose)
const DROP = new Set('span sup sub small big u ins mark abbr cite font center picture source section article header footer nav thead tbody tfoot caption figure figcaption dl input label time var samp q g-emoji'.split(' '))
function htmlMd(s: string): string {
  const kept: string[] = [] // code spans, as they are: no tag or entity of theirs is read
  const keep = (t: string) => `\x01${kept.push(t) - 1}\x01`
  s = s
    .replace(/\x01/g, '')
    .replace(/(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\1(?!`)/g, keep) // within a paragraph: a stray ` never takes the HTML after it
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, b: string) => (t => (f => `\n\n${f}\n${t}\n${f}\n\n`)('`'.repeat(Math.max(3, ...(t.match(/`+/g) ?? []).map(x => x.length + 1)))))(plain(b).replace(/^\n|\n$/g, '')))
    .replace(/<(code|kbd|tt)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, _t, b: string) => keep(ticks(plain(b).replace(/\n/g, ' '))))
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi, (_, b: string) => `\n${NUL}summary ${b.replace(/\s*\n\s*/g, ' ').trim()}\n`)
  const lists: { ordered: boolean; n: number }[] = []
  const links: string[] = []
  const TAG = /<(\/?)([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z]+);/gi
  const out = s.replace(TAG, (m, close: string, name?: string, attrs = '') => {
    if (!name) return decode(m)
    const tag = name.toLowerCase()
    const h = tag.match(/^h([1-6])$/)
    if (h) return close ? '\n\n' : `\n\n${'#'.repeat(+h[1])} `
    if (tag === 'a') {
      if (!close) return (u => (links.push(u), u ? '[' : ''))(attr(attrs, 'href'))
      return (u => (u ? `](${link(u)})` : ''))(links.pop())
    }
    if (tag === 'img') return (u => (u ? `![${attr(attrs, 'alt').replace(/[[\]]/g, '')}](${link(u)})` : ''))(attr(attrs, 'src'))
    if (tag === 'b' || tag === 'strong') return '**'
    if (tag === 'i' || tag === 'em') return '*'
    if (tag === 's' || tag === 'del' || tag === 'strike') return '~~'
    if (tag === 'br') return '<br>'
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'ul' || tag === 'ol') return close ? (lists.pop(), lists.length ? '\n' : '\n\n') : (lists.push({ ordered: tag === 'ol', n: 0 }), '\n')
    if (tag === 'li') return close ? '' : (l => `\n${'    '.repeat(Math.max(0, lists.length - 1))}${l?.ordered ? `${++l.n}.` : '-'} `)(lists.at(-1))
    if (['p', 'div', 'tr', 'table', 'dt', 'dd'].includes(tag)) return lists.length ? ' ' : '\n\n' // in a list item: its line goes on
    if (tag === 'td' || tag === 'th') return ' '
    if (tag === 'blockquote') return close ? `\n${NUL}/quote\n\n` : `\n\n${NUL}quote\n`
    if (tag === 'details') return close ? `\n${NUL}/details\n\n` : `\n\n${NUL}details${/\bopen\b/i.test(attrs) ? ' open' : ''}\n`
    return DROP.has(tag) ? '' : m
  })
  return out.replace(/\x01(\d+)\x01/g, (_, n: string) => kept[+n])
}

function parse(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    let m: RegExpMatchArray | null
    if (!l.trim()) {
      i++
    } else if (l[0] === NUL) {
      // fromHtml's <details> or <blockquote> to its close (nested ones counted); a stray close or summary: nothing
      const kind = l.slice(1).split(' ')[0]
      i++
      if (kind !== 'details' && kind !== 'quote') continue
      const body: string[] = []
      let summary = ''
      for (let depth = 1; i < lines.length; i++) {
        const k = lines[i][0] === NUL ? lines[i].slice(1).split(' ')[0] : ''
        if (k === kind) depth++
        else if (k === `/${kind}` && !--depth) break
        if (kind === 'details' && depth === 1 && k === 'summary' && !summary) summary = lines[i].slice(9).trim() || ' '
        else body.push(lines[i])
      }
      i++
      out.push(kind === 'quote' ? { t: 'quote', blocks: parse(body) } : { t: 'details', open: / open$/.test(l), summary: inline(summary.trim() || 'Details'), blocks: parse(body) })
    } else if ((m = l.match(FENCE))) {
      const fence = m[1]
      const pad = indentOf(l)
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence); i++) body.push(lines[i].slice(Math.min(pad, indentOf(lines[i]))))
      i++
      out.push({ t: 'code', lang: m[2].toLowerCase(), text: body.join('\n') })
    } else if ((m = l.match(HEADING))) {
      out.push({ t: 'h', level: m[1].length, inl: inline((m[2] ?? '').replace(/\s+#+$/, '')) })
      i++
    } else if (RULE.test(l)) {
      out.push({ t: 'hr' })
      i++
    } else if (QUOTE.test(l)) {
      const body: string[] = []
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !starts(lines[i]))) body.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      out.push({ t: 'quote', blocks: parse(body) })
    } else if ((m = l.match(LIST))) {
      const [ind, ordered] = [m[1].length, /\d/.test(m[2])]
      const same = (x?: string) => (n => !!n && n[1].length === ind && /\d/.test(n[2]) === ordered)(x?.match(LIST))
      const items: { task?: boolean; blocks: Block[] }[] = []
      while (i < lines.length) {
        if (!lines[i].trim()) {
          // a blank between items keeps the list going
          let j = i
          while (j < lines.length && !lines[j].trim()) j++
          if (!same(lines[j])) break
          i = j
        }
        const n = lines[i].match(LIST)
        if (!n || !same(lines[i])) break
        const pad = ind + n[2].length + 1
        const body = [n[3] ?? '']
        for (i++; i < lines.length; i++) {
          const x = lines[i]
          if (!x.trim()) {
            let j = i
            while (j < lines.length && !lines[j].trim()) j++
            if (j === lines.length || indentOf(lines[j]) <= ind) break
            body.push('')
          } else if (indentOf(x) > ind) body.push(x.slice(Math.min(pad, indentOf(x))))
          else if (starts(x) || !body.at(-1)?.trim()) break
          else body.push(x.trim()) // a paragraph's next line, not indented
        }
        const task = body[0].match(/^\[([ xX])\]\s+(.*)$/)
        if (task) body[0] = task[2]
        items.push({ task: task ? task[1] !== ' ' : undefined, blocks: parse(body) })
      }
      out.push({ t: 'list', ordered, start: ordered ? parseInt(m[2]) : 1, items })
    } else if (l.includes('|') && DELIM.test(lines[i + 1] ?? '') && lines[i + 1].includes('-') && cells(lines[i + 1]).length === cells(l).length) {
      const align = cells(lines[i + 1]).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
      const head = cells(l).map(inline)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(cells(lines[i]).map(inline))
      out.push({ t: 'table', align, head, rows })
    } else {
      const para: string[] = []
      let level = 0
      for (; i < lines.length && lines[i].trim(); i++) {
        if (para.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i])) {
          level = lines[i].trim()[0] === '=' ? 1 : 2 // underlined: a heading
          i++
          break
        }
        if (para.length && starts(lines[i])) break
        para.push(lines[i].trim())
      }
      const inl = inline(para.join('\n'))
      out.push(level ? { t: 'h', level, inl } : { t: 'p', inl })
    }
  }
  return out
}

// a table row's cells: | a | b | (the outer bars optional, \| a bar in a cell)
function cells(row: string) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map(c => c.trim().replace(/\\\|/g, '|'))
}

export function inline(s: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const push = (x: Inline, n: number) => {
    if (text) out.push(text)
    text = ''
    out.push(x)
    i += n
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const rest = s.slice(i)
    const prev = s[i - 1] ?? ''
    let m: RegExpMatchArray | null
    if (c === '\\' && s[i + 1] === '\n') push({ t: 'br' }, 2)
    else if (c === '\\' && /[!-/:-@[-`{-~]/.test(s[i + 1] ?? '')) (text += s[i + 1]), (i += 2)
    else if (c === '`' && (m = rest.match(/^(`+)(?!`)([\s\S]*?[^`])\1(?!`)/))) push({ t: 'code', text: m[2].replace(/\n/g, ' ').replace(/^ ([\s\S]*) $/, '$1') }, m[0].length)
    else if ((c === '[' || (c === '!' && s[i + 1] === '[')) && (m = rest.match(/^!?\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+["'][^"']*["'])?\s*\)/)))
      push(c === '!' ? { t: 'img', src: m[2], alt: m[1] } : { t: 'a', href: m[2], kids: inline(m[1]) }, m[0].length)
    else if (c === '<' && (m = rest.match(/^<(https?:\/\/[^\s>]+|mailto:[^\s>]+)>/))) push({ t: 'a', href: m[1], kids: [m[1].replace(/^mailto:/, '')] }, m[0].length)
    else if (c === '<' && (m = rest.match(/^<br\s*\/?>/i))) push({ t: 'br' }, m[0].length)
    else if (c === 'h' && !/\w/.test(prev) && (m = rest.match(/^https?:\/\/[^\s<]*[^\s<.,:;"')\]*_~]/))) push({ t: 'a', href: m[0], kids: [m[0]] }, m[0].length)
    else if (c === '*' && (m = rest.match(/^\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/))) push({ t: 'b', kids: [{ t: 'i', kids: inline(m[1]) }] }, m[0].length)
    else if ((c === '*' || (c === '_' && !/\w/.test(prev))) && (m = rest.match(c === '*' ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/ : /^__(?=\S)([\s\S]*?\S)__(?!\w)/))) push({ t: 'b', kids: inline(m[1]) }, m[0].length)
    else if ((c === '*' || (c === '_' && !/\w/.test(prev))) && (m = rest.match(c === '*' ? /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/ : /^_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/))) push({ t: 'i', kids: inline(m[1]) }, m[0].length)
    else if (c === '~' && (m = rest.match(/^~~(?=\S)([\s\S]*?\S)~~/))) push({ t: 's', kids: inline(m[1]) }, m[0].length)
    else if (c === '\n') {
      // two spaces before it: a line break; else a space
      if (/ {2}$/.test(text)) (text = text.trimEnd()), push({ t: 'br' }, 1)
      else (text += ' '), i++
    } else (text += c), i++
  }
  if (text) out.push(text)
  return out
}

// ---------- as HTML text (a shared tab's page, the UI kit's markdown element): every string escaped (the tree holds no
// HTML); links http(s) and mailto only
export const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const url = (u: string) => (/^(https?:|mailto:)/i.test(u) ? esc(u) : '')
const TAG = { b: 'strong', i: 'em', s: 's' } as const
function inl(xs: Inline[]): string {
  return xs
    .map(x => {
      if (typeof x === 'string') return esc(x)
      if (x.t === 'code') return `<code>${esc(x.text)}</code>`
      if (x.t === 'br') return '<br>'
      if (x.t === 'img') return url(x.src) ? `<img src="${url(x.src)}" alt="${esc(x.alt)}" loading="lazy" referrerpolicy="no-referrer">` : esc(x.alt)
      if (x.t === 'a') return url(x.href) ? `<a href="${url(x.href)}" target="_blank" rel="noopener noreferrer nofollow">${inl(x.kids)}</a>` : inl(x.kids)
      return `<${TAG[x.t]}>${inl(x.kids)}</${TAG[x.t]}>`
    })
    .join('')
}
const al = (a: string) => (a ? ` class="${a}"` : '') // a class: the page's CSP has no inline styles
function html(bs: Block[]): string {
  return bs
    .map(b => {
      switch (b.t) {
        case 'h':
          return `<h${b.level}>${inl(b.inl)}</h${b.level}>`
        case 'p':
          return `<p>${inl(b.inl)}</p>`
        case 'code':
          return `<pre><code>${esc(b.text)}</code></pre>`
        case 'quote':
          return `<blockquote>${html(b.blocks)}</blockquote>`
        case 'hr':
          return '<hr>'
        case 'details':
          return `<details${b.open ? ' open' : ''}><summary>${inl(b.summary)}</summary>${html(b.blocks)}</details>`
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul'
          const items = b.items.map(i => `<li>${i.task === undefined ? '' : `<input type="checkbox" disabled${i.task ? ' checked' : ''}> `}${html(i.blocks)}</li>`).join('')
          return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}>${items}</${tag}>`
        }
        case 'table':
          return `<div class="tw"><table><thead><tr>${b.head.map((c, k) => `<th${al(b.align[k])}>${inl(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, k) => `<td${al(b.align[k])}>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      }
    })
    .join('')
}

export const markdownHtml = (src: string) => html(markdown(src))
