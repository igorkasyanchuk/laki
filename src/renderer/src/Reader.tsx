// Reader view: an agent tab's chat as a conversation instead of its terminal (the daemon's chatRead: claude's or
// codex's transcript, asked every 1.5 s while shown). Your messages on the right, its answers as Markdown, a run of
// tool calls folded into one line, what it does now; its menu as buttons, a box that sends (send whenIdle). The
// terminal stays attached under it: Terminal brings it back as it was
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Glyph } from './Glyph'
import { linkify, Markdown } from './MarkdownView'
import { planNow } from '../../shared/todos'
import type { TabView } from '../../shared/types'

type Said = { who: 'you' | 'agent' | 'tool' | 'screen'; text: string }
export type ReaderApi = { read: (tab: string, v?: number) => Promise<{ none?: boolean; v?: number; said?: Said[] }>; send: (tab: string, text: string) => Promise<unknown>; answer: (tab: string, n: number) => void }

// the agents whose chats Laki reads (meters.ts' tailOf)
export const readable = (t?: TabView) => !!t && t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex')

export function Reader({ tab, api, active }: { tab: TabView; api: ReaderApi; active: boolean }) {
  const [said, setSaid] = useState<Said[]>()
  const [none, setNone] = useState(false)
  const [text, setText] = useState('')
  const v = useRef<number>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true) // at the bottom: it stays there as the chat grows
  useEffect(() => {
    let alive = true
    v.current = undefined
    const go = () =>
      api.read(tab.id, v.current).then(
        r => alive && (setNone(!!r.none), r.said && ((v.current = r.v), setSaid(r.said))),
        () => {},
      )
    go()
    const t = setInterval(() => document.visibilityState === 'visible' && go(), 1500)
    return () => ((alive = false), clearInterval(t))
  }, [tab.id])
  useLayoutEffect(() => {
    const s = scroll.current
    if (s && pinned.current) s.scrollTop = s.scrollHeight
  }, [said, tab.status])
  useEffect(() => {
    if (active && !tab.ask) box.current?.focus({ preventScroll: true })
  }, [active, !!tab.ask])
  const send = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    pinned.current = true
    void api.send(tab.id, t).catch(() => setText(t))
  }
  const now = tab.plan && !tab.plan.stale ? planNow(tab.plan) : undefined
  return (
    <div className="reader">
      <div className="reader-scroll" ref={scroll} onScroll={e => (pinned.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
        <div className="reader-col">
          {none && !said?.length && <div className="reader-empty muted">{tab.name}'s chat shows here once it has said something.</div>}
          {said?.map((x, i) =>
            x.who === 'you' ? (
              <div key={i} className="rd-you">
                {linkify(x.text)}
              </div>
            ) : x.who === 'tool' ? (
              <details key={i} className="rd-tool">
                <summary>
                  {(n => `${n} ${n === 1 ? 'step' : 'steps'}`)(x.text.split('\n').length)} · {x.text.split('\n').at(-1)}
                </summary>
                <pre>{linkify(x.text)}</pre>
              </details>
            ) : (
              <div key={i} className="rd-agent">
                <Markdown src={x.text} />
              </div>
            ),
          )}
          {tab.status === 'running' && (
            <div className="rd-working muted">
              <Glyph s="running" /> {now ?? 'Working'}…
            </div>
          )}
        </div>
      </div>
      {tab.planAsk && tab.ask ? (
        <div className="rd-ask muted">It asks you to approve its plan: below, where you can change it too.</div>
      ) : tab.ask ? (
        <div className="rd-ask">
          <span className="muted">{tab.ask.question || `${tab.name} asks:`}</span>
          <div className="rd-opts">
            {tab.ask.options.map(o => (
              <button key={o.n} className={o.n === tab.ask!.options[0].n ? 'primary' : ''} onClick={() => api.answer(tab.id, o.n)}>
                {o.n}. {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form className="rd-box" onSubmit={e => (e.preventDefault(), send())}>
          <textarea
            ref={box}
            value={text}
            rows={Math.min(6, text.split('\n').length)}
            placeholder={tab.status === 'running' ? `Message ${tab.name}: it reads it when this turn ends` : `Message ${tab.name}`}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), send())}
          />
          <button type="submit" className="primary" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  )
}
