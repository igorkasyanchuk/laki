// Markdown as React nodes (markdown.ts' tree: nothing in it is HTML), for a file's preview, a PR's description and
// review comments; links open in the browser
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { openExternal } from './api'
import { highlight } from './highlight'
import { type Block, type Inline, markdown } from './markdown'

// a Markdown file as the page it's written to be (markdown.ts' tree, as React nodes: nothing in it is HTML); links
// open in the browser, images show as links (a preview fetches nothing)
export function Markdown({ src }: { src: string }) {
  const tree = useMemo(() => markdown(src), [src])
  return <div className="md">{tree.map(mdBlock)}</div>
}

// Markdown in a few lines (a PR's description, a review comment), Show more for the rest
export function Folded({ text, lines }: { text: string; lines: number }) {
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
        <Markdown src={text} />
      </div>
      {(long || whole) && (
        <button className="link fold-more" aria-expanded={whole} onClick={() => setWhole(!whole)}>
          {whole ? 'Show less' : 'Show more'}
        </button>
      )}
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
    case 'code':
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
      const web = /^(https?:|mailto:)/i.test(href) // a relative one is a file of the repo: shown, not followed
      const kids = x.t === 'a' ? x.kids.map(mdInline) : `🖼 ${x.alt || 'image'}`
      return (
        <a key={k} href={web ? href : undefined} data-tip={href} onClick={e => (e.preventDefault(), web && openExternal(href))}>
          {kids}
        </a>
      )
    }
  }
}

