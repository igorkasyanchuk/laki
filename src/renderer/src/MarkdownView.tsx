// Markdown as React nodes (markdown.ts' tree: nothing in it is HTML), for a file's preview, a PR's description and
// review comments; links open in the browser. A ```mermaid block is a diagram: mermaid's SVG (securityLevel strict:
// its labels are text, no scripts or links), the library loaded the first time one shows
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { openExternal } from './api'
import { highlight } from './highlight'
import { canRun, proposalOf, runText } from './text'
import { type MenuItem, useNear } from './ui'
import { type Block, type Inline, markdown } from '../../shared/markdown'

// a Markdown file as the page it's written to be (markdown.ts' tree, as React nodes: nothing in it is HTML); links
// open in the browser, images show as links (a preview fetches nothing)
// html: GitHub's text or a repo's file, its HTML (<details>, <a>, <ul>…) read as GitHub shows it (markdown.ts)
// chat: an agent's or Laki AI's answer (Reader, the AI page, Side chat): a ```diff block there is a change it proposes,
// drawn as a diff (Proposal); in a file or a PR's text it stays code
// memo: drawn again only as its text changes, not with the page around it (Laki AI's thread at each key typed in its
// box, the Reader's 400 messages at each read: every code block highlighted again)
export const Markdown = memo(function Markdown({ src, html, chat }: { src: string; html?: boolean; chat?: boolean }) {
  const tree = useMemo(() => markdown(src, html), [src, html])
  const md = <div className="md">{tree.map(mdBlock)}</div>
  return chat ? <InChat.Provider value>{md}</InChat.Provider> : md
})
const InChat = createContext(false)
// a ```laki-ui block (an agent's reply in the Reader: UI kit JSON): drawn by whoever provides it (the Reader), else as code
export const UiBlocks = createContext<((json: string) => React.ReactNode) | undefined>(undefined)
const UiFence = ({ text }: { text: string }) => {
  const draw = useContext(UiBlocks)
  return draw ? draw(text) : <Code text={text} lang="json" />
}

// F6: a chat's shell block run in a terminal of the workspace: whoever provides it (the Reader) types it there, no Enter
// (same: ⌥-click, into a shell tab that's there instead of a new one)
export const RunCode = createContext<((text: string, same?: boolean) => void) | undefined>(undefined)
function Code({ text, lang }: { text: string; lang?: string }) {
  const chat = useContext(InChat)
  const run = useContext(RunCode)
  const [copied, setCopied] = useState(false)
  const pre = (
    <pre>
      <code>
        {highlight(`x.${lang || 'txt'}`, text).map((l, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            {l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t))}
          </Fragment>
        ))}
      </code>
    </pre>
  )
  if (!chat) return pre
  return (
    <div className="md-code">
      {pre}
      <div className="md-code-acts">
        <button type="button" className="link small" onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)), () => {})}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {run && canRun(lang, text) && (
          <button type="button" className="link small" data-tip="A new shell tab with it typed: press ⏎ there to run it. ⌥-click: into the last shell tab" onClick={e => run(runText(text), e.altKey)}>
            ▷ Run
          </button>
        )}
      </div>
    </div>
  )
}
// a ```diff block in a chat: red and green lines, each file's name, the numbers its @@ heads give (text.ts' proposalOf);
// nothing is applied: it's what the agent proposes. Elsewhere, or not a diff, plain code
function DiffBlock({ text, lang }: { text: string; lang: string }) {
  const chat = useContext(InChat)
  const lines = useMemo(() => (chat ? proposalOf(text) : null), [chat, text])
  if (!lines) return <Code text={text} lang={lang} />
  const w = `${String(lines.reduce((m, l) => Math.max(m, l.old ?? 0, l.new ?? 0), 0)).length}ch`
  const nums = lines.some(l => l.old !== undefined || l.new !== undefined)
  const files = lines.filter(l => l.kind === 'file')
  return (
    <div className="md-diff">
      <div className="md-diff-head">
        <span className="md-diff-tag">Proposal</span>
        {files.length === 1 && <span className="md-diff-file">{files[0].text}</span>}
        <span className="md-diff-says">not applied</span>
      </div>
      <div className="sp-diff">
        {lines.map((l, i) =>
          l.kind === 'file' ? (
            files.length > 1 && (
              <div key={i} className="dl md-diff-name">
                {l.text}
              </div>
            )
          ) : (
            <div key={i} className={`dl${l.kind === 'add' ? ' dl-add' : l.kind === 'del' ? ' dl-del' : l.kind === 'hunk' ? ' dl-hunk' : ''}`}>
              {nums && l.kind !== 'hunk' && (
                <>
                  <span className="dl-n" style={{ width: w }}>{l.old ?? ''}</span>
                  <span className="dl-n" style={{ width: w }}>{l.new ?? ''}</span>
                </>
              )}
              {l.kind === 'hunk' ? l.text : `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

// Outline (Go to heading…): a rendered Markdown page's headings as a menu's items, under the menu's filter box. Read
// from the page, not the source (a raw <h2> counts, and the scroll lands on the one picked), each indented by its level
export function outlineItems(root: Element | null | undefined): MenuItem[] {
  const hs = [...(root?.querySelectorAll('.md :is(h1, h2, h3, h4, h5, h6)') ?? [])].filter(h => h.textContent?.trim())
  if (!hs.length) return [{ head: 'No headings' }]
  const top = Math.min(...hs.map(h => Number(h.tagName[1])))
  return [{ filter: 'Go to heading…' }, ...hs.map(h => ({ label: '\u00a0\u00a0\u00a0'.repeat(Number(h.tagName[1]) - top) + h.textContent!.trim(), run: () => h.scrollIntoView({ block: 'start' }) }))]
}

// plain text with its web addresses as links that open in the browser (Reader's messages and steps); an address ends
// before the punctuation after it, as markdown.ts' bare ones do
const URL_IN = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,:;!?)\]}*_~]/g
export function linkify(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let at = 0
  for (const m of s.matchAll(URL_IN)) {
    out.push(s.slice(at, m.index), webLink(m[0], m.index, m[0]))
    at = m.index + m[0].length
  }
  out.push(s.slice(at))
  return out
}
const webLink = (href: string, k: number, kids: React.ReactNode) => (
  <a key={k} href={href} data-tip={href} onClick={e => (e.preventDefault(), openExternal(href))}>
    {kids}
  </a>
)

// Markdown in a few lines (a PR's description, a review comment), Show more for the rest
export function Folded({ text, lines, html }: { text: string; lines: number; html?: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const [whole, setWhole] = useState(false)
  const [long, setLong] = useState(false) // taller than the fold
  useLayoutEffect(() => {
    const d = el.current
    if (!d || whole) return
    const fit = () => setLong(d.scrollHeight > d.clientHeight + 2)
    fit()
    const ro = new ResizeObserver(fit) // the panel's width
    ro.observe(d)
    return () => ro.disconnect()
  }, [text, whole])
  return (
    <div className="folded">
      <div ref={el} className={whole ? 'fold-body' : `fold-body fold${long ? ' cut' : ''}`} style={{ '--lines': lines } as React.CSSProperties}>
        <Markdown src={text} html={html} />
      </div>
      {(long || whole) && (
        <button className="link fold-more" aria-expanded={whole} onClick={() => setWhole(!whole)}>
          {whole ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
// A chart is an <img> of mermaid's SVG, not the SVG in the page: a brainstorm's 50 charts inline were 18,000 elements,
// laid out again as each next chart measured its text (a mind map: 0.45 s on an empty page, 1.6 s with them; the app
// stuck for a minute). Drawn as it nears the screen, one at a time with the app's keys and clicks between (a page left
// meanwhile: its turn skipped), kept by its text and theme (the files' poll, the page opened again: no drawing)
let mermaid: Promise<typeof import('mermaid').default> | undefined
let drawn = 0
let theme = ''
let turn: Promise<unknown> = Promise.resolve()
type Pic = { k: string; src: string; w?: number }
const pics = new Map<string, Pic>() // ponytail: the newest 200, a few MB at most
const GONE = new Error('gone')
// an <img> has no web fonts or CSS variables: mermaid measures its labels in the font the picture then draws them in
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
function draw(k: string, text: string, dark: boolean, live: () => boolean): Promise<Pic> {
  const next = turn
    .then(() => new Promise(r => setTimeout(r)))
    .then(async () => {
      const had = pics.get(k)
      if (had) return had
      if (!live()) throw GONE
      const m = await (mermaid ??= import('mermaid').then(m => m.default))
      if (theme !== k[0]) m.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true /* else its error drawing stays in <body> */, theme: dark ? 'dark' : 'default', fontFamily: FONT }), (theme = k[0])
      const { svg } = await m.render(`mermaid-${++drawn}`, text)
      // its width: max-width (it scales down to fit, never up), else its viewBox's
      const w = Number(svg.match(/max-width:\s*([\d.]+)px/)?.[1] ?? svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)?.[1]) || undefined
      const pic = { k, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, w }
      pics.set(k, pic)
      if (pics.size > 200) pics.delete(pics.keys().next().value!)
      return pic
    })
  turn = next.catch(() => {})
  return next
}
function Mermaid({ text }: { text: string }) {
  const dark = document.documentElement.style.colorScheme !== 'light' // the theme's (applyTheme sets it; styles.css' :root is dark), not getComputedStyle: a whole-window restyle at each chart's draw
  const k = `${dark ? 'd' : 'l'}${text}`
  const [pic, setPic] = useState<Pic>()
  const [err, setErr] = useState('')
  const [at, near] = useNear()
  const shown = pics.get(k) ?? (pic?.k === k ? pic : undefined)
  useEffect(() => {
    if (shown || !near) return
    let live = true
    draw(k, text, dark, () => live).then(p => live && (setPic(p), setErr('')), e => live && e !== GONE && setErr(String(e?.message ?? e).split('\n')[0]))
    return () => void (live = false)
  }, [k, near])
  if (shown) return (
    <div className="mermaid">
      <img src={shown.src} width={shown.w} alt={`A ${text.trim().split(/\s/)[0]} diagram`} />
    </div>
  )
  return (
    <div ref={at}>
      <pre>
        <code>{text}</code>
      </pre>
      {err && <div className="warn small">Mermaid can't draw it: {err}</div>}
    </div>
  )
}

function mdBlock(b: Block, k: number): React.ReactNode {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level}` as 'h1'
      return <H key={k}>{b.inl.map(mdInline)}</H>
    }
    case 'p':
      return <p key={k}>{b.inl.map(mdInline)}</p>
    case 'hr':
      return <hr key={k} />
    case 'quote':
      return <blockquote key={k}>{b.blocks.map(mdBlock)}</blockquote>
    case 'details':
      return (
        <details key={k} open={b.open || undefined}>
          <summary>{b.summary.map(mdInline)}</summary>
          {b.blocks.map(mdBlock)}
        </details>
      )
    case 'code':
      if (b.lang === 'mermaid') return <Mermaid key={k} text={b.text} />
      if (b.lang === 'laki-ui') return <UiFence key={k} text={b.text} />
      if (b.lang === 'diff' || b.lang === 'patch') return <DiffBlock key={k} text={b.text} lang={b.lang} />
      return <Code key={k} text={b.text} lang={b.lang} />
    case 'list': {
      const items = b.items.map((it, i) => {
        const box = it.task !== undefined && <input key="box" type="checkbox" checked={it.task} readOnly />
        const [first, ...more] = it.blocks
        return (
          <li key={i} className={it.task !== undefined ? 'task' : undefined}>
            {/* one paragraph: a tight list's line, no paragraph's margins; a task's box goes in its first line */}
            {first?.t !== 'p' ? (
              [box, ...it.blocks.map(mdBlock)]
            ) : more.length ? (
              <>
                <p>
                  {box}
                  {first.inl.map(mdInline)}
                </p>
                {more.map(mdBlock)}
              </>
            ) : (
              [box, ...first.inl.map(mdInline)]
            )}
          </li>
        )
      })
      return b.ordered ? (
        <ol key={k} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={k}>{items}</ul>
      )
    }
    case 'table':
      return (
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={{ textAlign: b.align[i] || undefined }}>
                    {c.map(mdInline)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {b.head.map((_, j) => (
                    <td key={j} style={{ textAlign: b.align[j] || undefined }}>
                      {(r[j] ?? []).map(mdInline)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
function mdInline(x: Inline, k: number): React.ReactNode {
  if (typeof x === 'string') return x
  switch (x.t) {
    case 'code': // a web address in backticks: a link still
      return /^https?:\/\/\S+$/.test(x.text) ? webLink(x.text, k, <code>{x.text}</code>) : <code key={k}>{x.text}</code>
    case 'b':
      return <strong key={k}>{x.kids.map(mdInline)}</strong>
    case 'i':
      return <em key={k}>{x.kids.map(mdInline)}</em>
    case 's':
      return <del key={k}>{x.kids.map(mdInline)}</del>
    case 'br':
      return <br key={k} />
    case 'a':
    case 'img': {
      const href = x.t === 'a' ? x.href : x.src
      const web = /^(https?:|mailto:|laki:)/i.test(href) // a relative one is a file of the repo: shown, not followed; laki://: in the app
      const kids = x.t === 'a' ? x.kids.map(mdInline) : `🖼 ${x.alt || 'image'}`
      return (
        <a key={k} href={web ? href : undefined} data-tip={href} onClick={e => (e.preventDefault(), web && openExternal(href))}>
          {kids}
        </a>
      )
    }
  }
}

