// Markdown as React nodes (markdown.ts' tree: nothing in it is HTML), for a file's preview, a PR's description and
// review comments; links open in the browser. A ```mermaid block is a diagram: mermaid's SVG (securityLevel strict:
// its labels are text, no scripts or links), the library loaded the first time one shows
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { openExternal } from './api'
import { highlight } from './highlight'
import { type Block, type Inline, markdown } from '../../shared/markdown'

// a Markdown file as the page it's written to be (markdown.ts' tree, as React nodes: nothing in it is HTML); links
// open in the browser, images show as links (a preview fetches nothing)
// html: GitHub's text or a repo's file, its HTML (<details>, <a>, <ul>…) read as GitHub shows it (markdown.ts)
export function Markdown({ src, html }: { src: string; html?: boolean }) {
  const tree = useMemo(() => markdown(src, html), [src, html])
  return <div className="md">{tree.map(mdBlock)}</div>
}

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
let mermaid: Promise<typeof import('mermaid').default> | undefined
let drawn = 0
function Mermaid({ text }: { text: string }) {
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')
  const dark = getComputedStyle(document.documentElement).colorScheme !== 'light' // the theme's, as it is now
  useEffect(() => {
    let live = true
    ;(mermaid ??= import('mermaid').then(m => m.default))
      .then(m => {
        m.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true /* else its error drawing stays in <body> */, theme: dark ? 'dark' : 'default', fontFamily: 'var(--ui-font)' })
        return m.render(`mermaid-${++drawn}`, text)
      })
      .then(r => live && (setSvg(r.svg), setErr('')), e => live && (setSvg(''), setErr(String(e?.message ?? e).split('\n')[0])))
    return () => void (live = false)
  }, [text, dark])
  if (svg) return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
  return (
    <>
      <pre>
        <code>{text}</code>
      </pre>
      {err && <div className="warn small">Mermaid can't draw it: {err}</div>}
    </>
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
      return (
        <pre key={k}>
          <code>
            {highlight(`x.${b.lang || 'txt'}`, b.text).map((l, i) => (
              <Fragment key={i}>
                {i > 0 && '\n'}
                {l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t))}
              </Fragment>
            ))}
          </code>
        </pre>
      )
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
    case 'code':
      return <code key={k}>{x.text}</code>
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

