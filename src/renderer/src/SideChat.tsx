// Side chat (the right panel's tab): a quick question about what an agent is doing, answered beside it while it works,
// its own chat left clean (the daemon's sideAsk: Claude Code's chat forked, else Laki AI given its chat). An answer's
// Send to main chat is a send that waits for its turn's end (by: side, so not one of your prompts).
import { useEffect, useRef, useState } from 'react'
import type { TabView } from '../../shared/types'
import { api } from './api'
import { Markdown } from './MarkdownView'
import { IconButton } from './ui'

type Said = { who: 'you' | 'agent'; text: string; at: number }
export function SideChat({ tab, onSent }: { tab: TabView; onSent: (text: string) => void }) {
  const [s, setS] = useState<{ said: Said[]; busy: boolean; forks: boolean } | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const load = () => api.call<{ said: Said[]; busy: boolean; forks: boolean }>('sideState', { tab: tab.id }).then(setS, () => {})
  useEffect(() => void load(), [tab.id])
  useEffect(() => {
    if (!s?.busy) return // another window's ask: looked at until it's answered
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [s?.busy])
  useEffect(() => void end.current?.scrollIntoView({ block: 'end' }), [s?.said.length, s?.busy]) // void: scrollIntoView answers with a promise now
  const ask = () => {
    const q = text.trim()
    if (!q || s?.busy) return
    setErr('')
    setText('')
    setS(x => x && { ...x, busy: true, said: [...x.said, { who: 'you', text: q, at: Date.now() }] })
    api.call('sideAsk', { tab: tab.id, text: q }).then(load, (e: Error) => (setErr(e.message), setText(q), load()))
  }
  const toMain = (i: number) => {
    const a = s!.said[i]
    const q = s!.said[i - 1]?.who === 'you' ? s!.said[i - 1].text : ''
    const msg = `${q ? `From a side question ("${q.length > 200 ? `${q.slice(0, 199)}…` : q}"):` : 'From a side question:'}\n\n${a.text}`
    api.call('send', { target: tab.id, text: msg, whenIdle: true, by: 'side' }).then(() => onSent(tab.status === 'running' ? `${tab.name} reads it when this turn ends` : `Sent to ${tab.name}`), (e: Error) => setErr(e.message))
  }
  return (
    <div className="side-chat">
      <div className="sc-head">
        <span className="muted small">
          About <b>{tab.name}</b>
          {s?.forks ? ': a copy of its chat answers, the main one stays as it is' : ": Laki AI answers from its chat so far"}
        </span>
        <span className="grow" />
        <IconButton icon="plus" title="New side chat" onClick={() => void api.call('sideNew', { tab: tab.id }).then(load, (e: Error) => setErr(e.message))} />
      </div>
      <div className="sc-thread">
        {!s?.said.length && <div className="muted small sc-empty">Ask about what it's doing (why a new hook? what's left?) while it keeps working. Nothing here goes into its chat unless you send it.</div>}
        {s?.said.map((m, i) =>
          m.who === 'you' ? (
            <div key={i} className="sc-you">
              {m.text}
            </div>
          ) : (
            <div key={i} className="sc-agent">
              <Markdown src={m.text} chat />
              <button type="button" className="ghost small" onClick={() => toMain(i)}>
                Send to main chat
              </button>
            </div>
          ),
        )}
        {s?.busy && <div className="muted small">Thinking…</div>}
        <div ref={end} />
      </div>
      {err && <p className="field-err">{err}</p>}
      <form className="sc-box" onSubmit={e => (e.preventDefault(), ask())}>
        <textarea value={text} rows={2} placeholder={`Ask about ${tab.name}…`} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), ask())} />
        <button type="submit" className="primary" disabled={!text.trim() || !!s?.busy}>
          Ask
        </button>
      </form>
    </div>
  )
}
