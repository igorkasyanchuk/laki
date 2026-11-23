// Improve my prompt (✨ in a prompt box: PromptInput's, the Reader's): the draft to the daemon's promptImprove (Laki AI,
// with the chat's context), its answer put back in the box for you to read, never sent. The box's text is replaced as if
// typed (execCommand), so ⌘Z brings yours back; so does the pill's Restore. A second click or Esc cancels, and so does
// editing the box while it works (its answer would write over what you typed)
import { type RefObject, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { Icon } from './ui'

export type ImproveAt = { tab?: string; project?: string } // whose chat and memory it reads

// the box's text replaced as typing would: one step ⌘Z undoes (none: the caller's onChange)
const typeOver = (el: HTMLTextAreaElement | null, text: string, onChange: (v: string) => void) => {
  if (el) {
    el.focus()
    el.select()
    if (document.execCommand('insertText', false, text)) return
  }
  onChange(text)
}

export function useImprove(box: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (v: string) => void, at?: ImproveAt | false) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [was, setWas] = useState<{ draft: string; got: string } | null>(null)
  const run = useRef(0)
  const asked = useRef('')
  const cancel = () => (run.current++, setBusy(false))
  useEffect(() => {
    if (busy && value !== asked.current) cancel() // you typed meanwhile: yours stays
    if (was && value !== was.got) setWas(null) // changed since: no Restore to offer
  }, [value])
  useEffect(() => {
    const el = box.current
    if (!busy || !el) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), cancel())
    el.addEventListener('keydown', esc, true)
    return () => el.removeEventListener('keydown', esc, true)
  }, [busy])
  if (!at) return { button: null, pill: null }
  const go = async () => {
    if (busy) return cancel()
    const draft = value
    if (!draft.trim()) return setErr('Write a draft first')
    const id = ++run.current
    asked.current = draft
    setErr('')
    setBusy(true)
    try {
      const r = await api.call<{ prompt: string }>('promptImprove', { prompt: draft, ...at })
      if (id !== run.current) return
      typeOver(box.current, r.prompt, onChange)
      setWas({ draft, got: r.prompt })
    } catch (e) {
      if (id === run.current) setErr((e as Error).message)
    } finally {
      if (id === run.current) setBusy(false)
    }
  }
  const button = (
    <button
      type="button"
      className={`ib improve-btn${busy ? ' busy' : ''}`}
      aria-label={busy ? 'Stop improving' : 'Improve my prompt'}
      data-tip={busy ? 'Laki AI is rewriting it: click or Esc to stop' : 'Improve my prompt: Laki AI rewrites the draft into a clear, specific one with what this chat knows. It stays in the box for you to read; ⌘Z brings yours back'}
      onMouseDown={e => e.preventDefault() /* the box keeps the focus */}
      onClick={() => void go()}
    >
      <Icon name="ai" />
    </button>
  )
  const pill = (busy || was || err) && (
    <div className="improve-pill" role="status">
      {busy ? (
        <span className="muted">Improving your prompt… Esc stops</span>
      ) : err ? (
        <>
          <span className="warn">{err}</span>
          <button type="button" className="link small" onClick={() => setErr('')}>
            OK
          </button>
        </>
      ) : (
        <>
          <Icon name="ai" size={11} />
          <span>Prompt improved</span>
          <button type="button" className="link small" onMouseDown={e => e.preventDefault()} onClick={() => (typeOver(box.current, was!.draft, onChange), setWas(null))}>
            Restore
          </button>
        </>
      )}
    </div>
  )
  return { button, pill }
}
