// Reader view: an agent tab's chat as a conversation instead of its terminal (the daemon's chatRead: claude's or
// codex's transcript, asked every 1.5 s while shown). Your messages on the right, its answers as Markdown, a run of
// tool calls folded into one line, what it does now; its menu as buttons, a box that sends (send whenIdle). The
// terminal stays attached under it: Terminal brings it back as it was
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AskDiff } from './Diff'
import { Glyph } from './Glyph'
import { linkify, Markdown } from './MarkdownView'
import { historyKey, usePromptHistory } from './PromptInput'
import { planNow } from '../../shared/todos'
import type { TabView } from '../../shared/types'

type Said = { who: 'you' | 'agent' | 'tool' | 'screen'; text: string }
export type ReaderApi = { read: (tab: string, v?: number) => Promise<{ none?: boolean; v?: number; said?: Said[] }>; send: (tab: string, text: string) => Promise<unknown>; answer: (tab: string, n: number) => void; review: (tab: TabView) => void; undo: (tab: TabView) => void } // review, undo: its last turn's changes (the card)

// the agents whose chats Laki reads (meters.ts' tailOf)
export const readable = (t?: TabView) => !!t && t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex')

export function Reader({ tab, api, active }: { tab: TabView; api: ReaderApi; active: boolean }) {
  const [said, setSaid] = useState<Said[]>()
  const [none, setNone] = useState(false)
  const [text, setText] = useState('')
  const [hid, setHid] = useState<string>() // the guess Esc hid (settings.nextPrompt's tab.suggest)
  const ghost = !text && tab.status === 'idle' && tab.suggest && tab.suggest !== hid ? tab.suggest : undefined
  const v = useRef<number>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [histMenu, history] = usePromptHistory(box, setText) // ↑ in the empty box: your prompts
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
              <You key={i} text={x.text} />
            ) : x.who === 'tool' ? (
              <details key={i} className="rd-tool">
                <summary>
                  {(n => `${n} ${n === 1 ? 'step' : 'steps'}`)(x.text.split('\n').length)} · {x.text.split('\n').at(-1)}
                </summary>
                <pre>{linkify(x.text)}</pre>
              </details>
            ) : (
              <div key={i} className="rd-agent">
                <Markdown src={x.text} chat />
              </div>
            ),
          )}
          {tab.changes && tab.status !== 'running' && <TurnCard tab={tab} api={api} />}
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
          {tab.ask.diff && <AskDiff diff={tab.ask.diff} />}
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
            className={ghost ? 'rd-ghost' : undefined}
            placeholder={ghost ?? (tab.status === 'running' ? `Message ${tab.name}: it reads it when this turn ends` : `Message ${tab.name}`)}
            data-tip={ghost ? 'Laki AI\'s guess at your next message · Tab takes it, Esc hides it' : undefined}
            data-history
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (ghost && e.key === 'Tab' && !e.shiftKey) return void (e.preventDefault(), setText(ghost))
              if (ghost && e.key === 'Escape') return void (e.preventDefault(), e.stopPropagation(), setHid(ghost))
              if (historyKey(e, !text)) return void (e.preventDefault(), history()) // your prompts
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), send())
            }}
          />
          <button type="submit" className="primary" disabled={!text.trim()}>
            Send
          </button>
          {histMenu}
        </form>
      )}
    </div>
  )
}

// your message: a long one (a pasted log) folds to 10 lines under a fade, Show more opens it
// ponytail: long by lines or length, not by measuring the wrapped text; a 1,000-character line folds even if it fits
const longSaid = (s: string) => s.split('\n').length > 12 || s.length > 1000
function You({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = longSaid(text)
  return (
    <div className="rd-you">
      <div className={long && !open ? 'rd-fold' : undefined}>{linkify(text)}</div>
      {long && (
        <button type="button" className="link rd-more" onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

// what its last turn changed (turns.ts): under its last answer, Review (Changes' This turn) and Undo
function TurnCard({ tab, api }: { tab: TabView; api: ReaderApi }) {
  const c = tab.changes!
  const [open, setOpen] = useState(c.n <= 5)
  return (
    <div className="rd-turn">
      <div className="rd-turn-head">
        <span className="muted small">This turn</span>
        <button type="button" className="link" onClick={() => setOpen(o => !o)}>
          Edited {c.n} file{c.n === 1 ? '' : 's'}
        </button>
        <span className="mono small">
          <span className="add">+{c.add}</span> <span className="del">−{c.del}</span>
        </span>
        <span className="grow" />
        <button type="button" onClick={() => api.review(tab)}>
          Review
        </button>
        <button type="button" onClick={() => api.undo(tab)} data-tip="Puts these files back as they were before the turn (only while they're as it left them)">
          Undo
        </button>
      </div>
      {open && (
        <div className="rd-turn-files">
          {c.files.map(f => (
            <div key={f.path} className="rd-turn-file">
              <span className={`st st-${f.status}`}>{f.status}</span>
              <span className="mono small grow">{f.path}</span>
              <span className="mono small">
                {f.add > 0 && <span className="add">+{f.add}</span>} {f.del > 0 && <span className="del">−{f.del}</span>}
              </span>
            </div>
          ))}
          {c.n > c.files.length && <div className="muted small">and {c.n - c.files.length} more</div>}
        </div>
      )}
    </div>
  )
}
