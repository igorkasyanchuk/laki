// Settings' own building blocks: a setting's title and hint, a titled card of settings (Group), a section's scope note.
// Settings.tsx re-exports it.
import { createContext, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useEffect, useId, useRef } from 'react'
import { HELP } from '../../shared/settingsMap'

// a switch row's text: what it is, and under it a line on what it does
// a hint's {{variables}} set apart (code.var), easier to pick out of a sentence
export const withVars = (t: ReactNode) => (typeof t === 'string' && t.includes('{{') ? t.split(/(\{\{[^{}]+\}\})/).map((p, i) => (i % 2 ? <code key={i} className="var">{p}</code> : p)) : t)
// the titles new since the last version (settingsMap's freshOf) in the section open: a "new" chip on each, this visit
export const Fresh = createContext<ReadonlySet<string>>(new Set())
export const Says = ({ title, hint }: { title: ReactNode; hint?: ReactNode }) => (
  <span className="switch-text">
    <span>
      {title}
      {typeof title === 'string' && <HelpQ title={title} />}
      {typeof title === 'string' && <NewChip title={title} />}
    </span>
    {hint && <span className="muted">{withVars(hint)}</span>}
  </span>
)

function NewChip({ title }: { title: string }) {
  return useContext(Fresh).has(title) ? <span className="set-new">new</span> : null
}

// a ? beside a setting that assumes agent know-how (settingsMap's HELP, by its title): a card of what it does, when to
// turn it on and what it costs. A popover (the top layer: no group clips it), placed under the ? (its source). Inside a
// switch's button it's a span: its click and keys kept from the switch; Esc closes the card, not the page
export function HelpQ({ title }: { title: string }) {
  const card = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => {
    const c = card.current
    if (!c) return
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && 'hidePopover' in c && c.matches(':popover-open') && (c.hidePopover(), e.preventDefault(), e.stopImmediatePropagation())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  const h = HELP[title]
  if (!h) return null
  const flip = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(card.current as (HTMLSpanElement & { togglePopover(o?: { source?: HTMLElement }): boolean }) | null)?.togglePopover({ source: e.currentTarget as HTMLElement })
  }
  return (
    <>
      <span role="button" tabIndex={0} className="help-q" aria-label={`What is ${title}?`} aria-controls={id} data-tip="What it does, when to use it, what it costs" onClick={flip} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && flip(e)}>
        ?
      </span>
      <span ref={card} id={id} popover="auto" className="help-card" onClick={e => e.stopPropagation()}>
        <b>{title}</b>
        <span>{h.what}</span>
        <span>
          <span className="help-k">When</span> {h.when}
        </span>
        <span>
          <span className="help-k">Costs</span> {h.cost}
        </span>
      </span>
    </>
  )
}

// U10: Settings' Basic view: which of a section's cards it shows, by title (none: All, every one)
export const Shown = createContext<((title: string) => boolean) | null>(null)
// a block of settings that belong together, set apart from the next: a title, what it's for, then them
export const Group = ({ title, hint, act, children }: { title: string; hint?: ReactNode; act?: ReactNode; children: ReactNode }) =>
  (shown => shown && !shown(title))(useContext(Shown)) ? null : (
  <section className="set-group">
    <div className={`set-head ${act ? 'with-act' : ''}`}>
      <h3>{title}</h3>
      {hint && <p className="muted small">{withVars(hint)}</p>}
      {act && <span className="set-act">{act}</span>}
    </div>
    {children}
  </section>
)

// a list's note (Prompt templates, Actions): Global, everywhere; This project, here only, with the global ones
export const Scope = ({ tag, children }: { tag: string; children: ReactNode }) => (
  <div className="set-scope">
    <span className="tag set-scope-tag">{tag}</span>
    <span>{children}</span>
  </div>
)
