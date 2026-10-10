// The AI page (the rail's AI, ⌘K, laki://ai; the bubbles' Ask Laki AI in a window of its own): Laki's own AI
// (daemon/ai.ts), one conversation that works Laki with its tools. Chat: a thread like Claude's, the tools a turn ran
// folded into one line, the composer at the bottom; Calls: each ask with its tokens, cost and time; Info: how it runs
// and pays, what it spent, what it can do. Off, or OpenRouter without a key: a note.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AI_MODEL, type AiCall, type AiMsg, type AiSettings, type AiTotals } from '../../shared/types'
import { api, bridge, openExternal } from './api'
import { ago } from './Info'
import { linkWorkspaces, wsLink } from './links'
import { Markdown } from './MarkdownView'
import { type Img, PromptInput } from './PromptInput'
import { Icon, Page } from './ui'

type AiData = { chat: AiMsg[]; busy: boolean; key: boolean; calls: AiCall[]; totals: AiTotals }

// what it can do, as you'd say it: a click puts it in the box
const EXAMPLES = [
  'What are my agents doing? Anything waiting for me?',
  'Review each PR in this screenshot in its own workspace with codex',
  'Start a code review of the PR with the login form',
  'Take the PR from workspace ABC and start a new codex session to review it',
]
export const BACKENDS = {
  openrouter: 'OpenRouter',
  claude: 'claude -p',
  codex: 'codex exec',
} as const
// how each one is paid for, the side panel's words
const PAYS = {
  openrouter: 'Billed to your OpenRouter account by the tokens each ask uses. The cost here is the one OpenRouter reports.',
  claude:
    'Runs Claude Code in the background, on your Claude plan (or its API key). The cost is what claude says the tokens would cost; on a plan it counts toward its limits instead.',
  codex: "Runs Codex in the background, on your ChatGPT plan: it counts toward the plan's limits, so no cost is shown.",
} as const
// how its asks share a conversation, the side panel's words
const SESSION = {
  openrouter: 'Each ask sends the conversation so far (the last 20 asks and answers); the model looks things up again.',
  claude: 'One claude session for the whole chat: each ask goes on with it (--resume), so it remembers. New chat starts another.',
  codex: 'One codex thread for the whole chat: each ask goes on with it, so it remembers. New chat starts another.',
} as const
const CAN = ['See your workspaces, agents and PRs', 'Start workspaces and agent tabs', 'Send prompts to your agents', 'Attach PRs, schedule tasks']

export const money = (n?: number) => (n === undefined ? '—' : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

// workspaces: the ones its answers may name in bold, made links to them (a click opens one)
export function AiPage({
  settings,
  workspaces = [],
  onClose,
  onSettings,
  onLater,
}: {
  settings: AiSettings
  workspaces?: { id: string; name: string }[]
  onClose: () => void
  onSettings?: () => void
  onLater?: (text: string) => void // Send later's dialog for Laki AI, with what's typed (the app's; not the AI window's)
}) {
  const [d, setD] = useState<AiData>()
  const [tab, setTab] = useState<'chat' | 'calls' | 'info'>('chat')
  const [text, setText] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  // the answers' links: made again only as the workspaces' names change (the app's view comes every few ms meanwhile)
  const names = workspaces.map(w => `${w.id}\n${w.name}`).join('\n')
  const link = useMemo(() => linkWorkspaces(workspaces), [names])
  const load = () => api.call<AiData>('aiState').then(setD, e => setErr(e.message))
  useEffect(() => {
    load()
    return api.on(m => {
      if (m.ev === 'open') return void load() // a daemon started again: its conversation, not the busy one we had
      if (m.ev !== 'ai') return
      setD(x => x && { ...x, chat: m.chat, busy: m.busy })
      if (!m.busy) load() // the call just logged
    })
  }, [])
  useEffect(() => void end.current?.scrollIntoView({ block: 'end' }), [d?.chat.length, d?.busy, tab]) // void: Chromium's returns a promise
  const backend = settings.backend ?? 'openrouter'
  const ready = !!settings.on && (backend !== 'openrouter' || !!d?.key)
  const can = ready && !d?.busy && !saving && (!!text.trim() || !!images.length)
  const ask = () => {
    if (!can) return
    setErr('')
    const sent = { text, images }
    setText('')
    setImages([])
    // refused before it asked: said here, and back in the box; an ask that failed says so in the conversation
    api
      .call('aiAsk', {
        text: sent.text,
        images: sent.images.map(i => i.path),
      })
      .catch(e => {
        if (!/^(Laki AI is off|ask something|the AI is still|no OpenRouter API key|not connected)/.test(e.message)) return
        setErr(e.message)
        setText(sent.text)
        setImages(sent.images)
      })
  }
  const model = settings.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : 'its default model')
  const runs = `${BACKENDS[backend]}${backend !== 'openrouter' && settings.preset ? ` (${settings.preset})` : ''}`
  const t = d?.totals
  const settingsLink = (label: string) =>
    onSettings ? (
      <button className="link" onClick={onSettings}>
        {label}
      </button>
    ) : (
      <span>{label} in Laki › Settings › AI.</span>
    )
  const note = !settings.on ? (
    <>
      <b>Laki AI is off.</b> Turn it on and pick how it runs: OpenRouter with your API key, or claude -p / codex exec on your plan. {settingsLink('Set it up')}
    </>
  ) : backend === 'openrouter' && d && !d.key ? (
    <>
      <b>No OpenRouter API key yet.</b> Add one, or run it with claude -p or codex exec instead. {settingsLink('Add a key')}
    </>
  ) : null

  return (
    <Page title="Laki AI" onClose={onClose} wide>
      <div className="ai-page">
        <div className="ai-bar">
          <div className="seg" role="tablist">
            {(['chat', 'calls', 'info'] as const).map(k => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {k === 'chat' ? 'Chat' : k === 'calls' ? 'Calls' : 'Info'}
                {k === 'calls' && !!d?.calls.length && <span className="muted"> {d.calls.length}</span>}
              </button>
            ))}
          </div>
          <span className="grow" />
          {t && backend !== 'codex' && (
            <span className="muted small ai-today" data-tip={`This month: ${money(t.month.cost)}, ${t.month.calls} asks`}>
              today {money(t.today.cost)}
            </span>
          )}
          <button className="ai-new" disabled={!d?.chat.length || d.busy} onClick={() => api.call('aiNew').then(load, e => setErr(e.message))}>
            <Icon name="plus" size={12} /> New chat
          </button>
        </div>

        {tab === 'chat' ? (
          <>
            <div className="ai-thread" aria-live="polite">
              <div className="ai-col">
                {note && <div className="ai-note">{note}</div>}
                {!d?.chat.length ? (
                  <div className="ai-hello">
                    <span className="ai-mark">
                      <Icon name="ai" size={22} />
                    </span>
                    <h2>What should Laki do?</h2>
                    <p className="muted">It looks at your workspaces and agents, starts new ones, sends them prompts and attaches PRs.</p>
                    <div className="ai-examples">
                      {EXAMPLES.map(x => (
                        <button key={x} onClick={() => (setText(x), document.querySelector<HTMLTextAreaElement>('.ai-composer textarea')?.focus())}>
                          {x}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  turns(d.chat).map((g, i) => (Array.isArray(g) ? <Tools key={i} list={g} /> : <Message key={i} m={g} link={link} />))
                )}
                {d?.busy && (
                  <div className="ai-working">
                    <span className="ai-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    Working…
                    <button onClick={() => api.call('aiStop')}>Stop</button>
                  </div>
                )}
                <div ref={end} />
              </div>
            </div>

            <div className="ai-dock">
              <div className={`nw-card nw-composer ai-composer ${ready ? '' : 'off'}`}>
                <PromptInput
                  value={text}
                  onChange={setText}
                  images={images}
                  onImages={setImages}
                  save={(data, ext) => api.call<string>('imageSave', { data, ext })}
                  dictate={bridge?.dictate}
                  dictationSettings={bridge?.dictationSettings}
                  onSubmit={ask}
                  enter
                  onBusy={setSaving}
                  rows={2}
                  placeholder="Ask Laki… or paste a screenshot of PR links"
                  tools={
                    <>
                      {onLater && (
                        <button type="button" className="ib" aria-label="Ask later" data-tip={images.length ? 'Ask later takes words only: remove the images' : 'Ask later: in 10 min, at 3pm…'} disabled={!ready || !text.trim() || !!images.length} onClick={() => onLater(text)}>
                          <Icon name="timer" />
                        </button>
                      )}
                      <button className="primary ai-send" aria-label="Ask (⏎)" data-tip="Ask (⏎) · ⇧⏎ a new line" disabled={!can} onClick={ask}>
                        <Icon name="arrowRight" size={14} />
                      </button>
                    </>
                  }
                />
              </div>
              {err ? (
                <div className="ai-err">{err}</div>
              ) : (
                <div className="ai-foot">
                  {runs} · {model} · it never archives, deletes, ships or merges
                </div>
              )}
            </div>
          </>
        ) : tab === 'calls' ? (
          <div className="ai-thread">
            <div className="ai-col wide">
              {d?.calls.length ? (
                <div className="sched-list ai-calls">
                  {d.calls.map(c => (
                    <div key={c.at} className="ai-call" data-tip={c.error ? `Failed: ${c.error}` : c.ask}>
                      <span className={`ai-ok ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? '✓' : '✗'}</span>
                      <span className="ai-ask">{c.ask || '(an image)'}</span>
                      <span className="mono">{c.backend === 'codex' ? 'plan' : money(c.cost)}</span>
                      <span className="ai-meta">
                        {BACKENDS[c.backend]} · <span className="mono">{c.model}</span> · {tokens(c.in)} → {tokens(c.out)} tokens · {(c.ms / 1000).toFixed(1)}s
                        · {ago(c.at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted ai-none">None yet. Each ask is logged here: tokens, cost, how long it took.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="ai-thread">
            <div className="ai-col ai-info">
              <section>
                <h4>How it runs</h4>
                <div className="ai-run">
                  <b>{runs}</b>
                  <span className="mono muted">{model}</span>
                </div>
                <p>{PAYS[backend]}</p>
                <p className="muted">{SESSION[backend]}</p>
                {onSettings && (
                  <button className="link" onClick={onSettings}>
                    <Icon name="settings" size={12} /> Change in Settings
                  </button>
                )}
              </section>
              <section>
                <h4>Spent</h4>
                <div className="ai-spent">
                  <div>
                    <b>{money(t?.today.cost ?? 0)}</b>
                    <span>
                      today · {t?.today.calls ?? 0} asks · {tokens((t?.today.in ?? 0) + (t?.today.out ?? 0))} tokens
                    </span>
                  </div>
                  <div>
                    <b>{money(t?.month.cost ?? 0)}</b>
                    <span>this month · {t?.month.calls ?? 0} asks</span>
                  </div>
                </div>
                <button className="link" onClick={() => setTab('calls')}>
                  Every call →
                </button>
              </section>
              <section>
                <h4>What it can do</h4>
                <ul>
                  {CAN.map(x => (
                    <li key={x}>
                      <Icon name="check" size={11} /> {x}
                    </li>
                  ))}
                </ul>
                <p className="muted">It never archives, deletes, ships or merges: those stay yours.</p>
              </section>
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}

// the conversation with each run of tool calls as one group
const turns = (chat: AiMsg[]) =>
  chat.reduce<(AiMsg | AiMsg[])[]>((out, m) => {
    const last = out[out.length - 1]
    if (m.role !== 'tool') out.push(m)
    else if (Array.isArray(last)) last.push(m)
    else out.push([m])
    return out
  }, [])

const toolName = (m: AiMsg) =>
  m.text
    .split(' ')[0]
    .replace(/^laki_/, '')
    .replace(/_/g, ' ')

// a turn's tools, folded: their names in a line; open, each with what it was given
function Tools({ list }: { list: AiMsg[] }) {
  const names = [...new Set(list.map(toolName))]
  return (
    <details className="ai-tools">
      <summary>
        <Icon name="run" size={10} /> {list.length === 1 ? 'Used' : `Used ${list.length} tools:`} {names.slice(0, 4).join(', ')}
        {names.length > 4 ? '…' : ''}
      </summary>
      {list.map((m, i) => {
        const a = m.text.slice(m.text.indexOf(' ') + 1)
        const to = target(a)
        return (
          <div key={i} className="ai-tool" data-tip={a.length > 100 ? a : undefined}>
            <b>{toolName(m)}</b> <span className="mono">{a === '{}' || a === m.text ? '' : a.slice(0, 100)}</span>
            {to && (
              <button className="link" onClick={() => openExternal(wsLink(...to))}>
                Open
              </button>
            )}
          </div>
        )
      })}
    </details>
  )
}

// the workspace (and tab) a tool call was about: its ws, or send's target (<ws> or <ws>/<tab>)
function target(args: string): [string, string?] | undefined {
  try {
    const a = JSON.parse(args)
    if (typeof a.ws === 'string') return [a.ws]
    if (typeof a.target === 'string') return a.target.split('/') as [string, string?]
  } catch {}
}

function Message({ m, link }: { m: AiMsg; link: (text: string) => string }) {
  const src = useMemo(() => link(m.text), [m.text, link])
  if (m.role === 'error') return <div className="ai-msg ai-error">{m.text}</div>
  if (m.role === 'user')
    return (
      <div className="ai-msg ai-user">
        {m.text}
        {!!m.images?.length && (
          <span className="tag">
            <Icon name="image" size={11} /> {m.images.length} image
            {m.images.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
    )
  return (
    <div className="ai-msg ai-answer">
      <span className="ai-mark small">
        <Icon name="ai" size={13} />
      </span>
      <Markdown src={src} />
    </div>
  )
}
