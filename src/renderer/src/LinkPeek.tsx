// A link's hover card in a terminal (Term: 400 ms on a link, gone as the pointer leaves the link and the card): a
// GitHub PR's or issue's (the daemon's ghCard: gh, kept a minute; a click opens it on GitHub), an image's (Term's
// `image`: a file of the workspace or its storage folder, a pasted one; an https one through the daemon's /img; a click on
// it, or its ⤢, opens it larger: Term's modal, which outlives the card), or a Markdown file's, drawn (Term's `text`: a
// file of the workspace or its storage folder; the card scrolls, ⌘-click on the link opens it)
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { type GhCard, GH_LINK } from '../../shared/types'
import { api, openExternal } from './api'
import { ago } from './Info'
import { Icon, IconButton } from './ui'
import { imgVia } from './Widgets'
import { Markdown } from './MarkdownView'

export const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
// what a hovered link shows: a GitHub card, an image, or nothing
export const MD = /\.(md|markdown)$/i
export const peekOf = (uri: string) => (GH_LINK.test(uri) ? 'gh' : IMAGE.test(uri.split(/[?#]/)[0]) ? 'img' : MD.test(uri.split(/[?#]/)[0]) && !/^[a-z]+:/i.test(uri) ? 'md' : undefined) // md: a file's only
export type Peek = { uri: string; x: number; y: number; read?: () => Promise<string | undefined | null> } // read: a local picture's data URL, a Markdown file's text; null: nothing to show (no card)
const MD_SHOWN = 30_000 // a Markdown file's first characters drawn: a card's worth, and quick

export type Big = { src: string; name: string; size: string } // an image opened larger (Term's modal)
export function LinkPeek({ peek, onEnter, onLeave, onOpen }: { peek: Peek; onEnter: () => void; onLeave: () => void; onOpen: (b: Big) => void }) {
  const [card, setCard] = useState<GhCard>()
  const [src, setSrc] = useState<string>() // a picture's data URL, a Markdown file's text
  const [size, setSize] = useState('')
  const [err, setErr] = useState('')
  const [n, setN] = useState(0) // Retry
  const [none, setNone] = useState(false) // image() said null: no card at all
  const kind = peekOf(peek.uri)
  useEffect(() => {
    let live = true
    setErr('')
    setNone(false)
    const fail = (e: unknown) => live && setErr(String((e as Error)?.message ?? e))
    if (kind === 'gh') api.call<GhCard>('ghCard', { url: peek.uri }).then(c => live && setCard(c), fail)
    else if (/^https:/i.test(peek.uri)) (via => (via ? setSrc(via) : fail('Web pictures need the daemon')))(imgVia(peek.uri))
    else
      (peek.read?.() ?? Promise.reject(new Error('Not a file of this workspace'))).then(s => live && (typeof s === 'string' && (s || kind === 'md') ? setSrc(s) : s === null ? setNone(true) : fail(kind === 'md' ? 'Not shown: not text' : 'Not shown: over 10 MB')), fail)
    return () => void (live = false)
  }, [peek.uri, n])
  // below the pointer, or above it in the screen's lower part; never off the window's right edge
  const low = peek.y > innerHeight * 0.55
  const style = { left: Math.max(8, Math.min(peek.x - 12, innerWidth - 376)), ...(low ? { bottom: innerHeight - peek.y + 14 } : { top: peek.y + 18 }) }
  const [, owner, name, what, num] = GH_LINK.exec(peek.uri) ?? []
  const state = card && (card.draft && card.state === 'open' ? 'draft' : card.state)
  const file = decodeURIComponent(peek.uri.split(/[?#]/)[0].split('/').pop() ?? '')
  const open = () => src && onOpen({ src, name: file, size })
  if (none) return null
  return createPortal(
    <div className={`link-peek ${kind}`} style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {kind === 'gh' ? (
        <button type="button" className="lp-gh" onClick={() => openExternal(card?.url ?? peek.uri)} data-tip="Open on GitHub">
          <span className="lp-head">
            <Icon name={what === 'pull' ? 'pr' : 'circle'} size={13} />
            <span className="lp-repo">
              {owner}/{name} #{num}
            </span>
            {state && <span className={`lp-state ${state}`}>{state}</span>}
          </span>
          {card ? (
            <>
              <b className="lp-title">{card.title}</b>
              {!!card.labels?.length && (
                <span className="lp-labels">
                  {card.labels.slice(0, 5).map(l => (
                    <span key={l.name} className="tag-soft" style={l.color ? { borderColor: `#${l.color}` } : undefined}>
                      {l.name}
                    </span>
                  ))}
                </span>
              )}
              <span className="lp-meta muted">{[card.author, card.at && `updated ${ago(card.at)}`, card.review?.toLowerCase().replace(/_/g, ' '), card.comments !== undefined && `${card.comments} comment${card.comments === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
              {card.kind === 'pr' && (
                <span className="lp-meta muted">
                  <span className="add">+{card.add}</span> <span className="del">−{card.del}</span>
                  {!!card.files && ` · ${card.files} file${card.files === 1 ? '' : 's'}`}
                </span>
              )}
            </>
          ) : err ? (
            <span className="lp-err">
              {err}{' '}
              <span role="button" tabIndex={0} className="link" onClick={e => (e.stopPropagation(), setN(n + 1))}>
                Retry
              </span>
            </span>
          ) : (
            <span className="lp-wait muted">Asking GitHub…</span>
          )}
        </button>
      ) : kind === 'md' ? (
        <>
          {src !== undefined && !err ? <div className="lp-md">{src.trim() ? <Markdown src={src.slice(0, MD_SHOWN)} /> : <span className="muted">Empty</span>}</div> : <span className={err ? 'lp-err' : 'lp-wait muted'}>{err || 'Loading…'}</span>}
          <span className="lp-meta muted">
            {file}
            {src && src.length > MD_SHOWN && ' · its start'} · ⌘-click to open
          </span>
        </>
      ) : (
        <>
          {src && !err ? (
            <button type="button" className="lp-img" data-tip="Open larger" onClick={open}>
              <img src={src} alt="" onLoad={e => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} onError={() => setErr("Couldn't load it")} />
            </button>
          ) : (
            <span className={err ? 'lp-err' : 'lp-wait muted'}>{err || 'Loading…'}</span>
          )}
          {src && !err && <IconButton icon="maximize" title="Open larger" className="lp-open" onClick={open} />}
          <span className="lp-meta muted">
            {file}
            {size && ` · ${size}`}
          </span>
        </>
      )}
    </div>,
    document.body,
  )
}
