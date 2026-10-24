// The AI page (the rail's AI, ⌘K, laki://ai; the bubbles' Ask Laki AI in a window of its own): Laki's own AI
// (daemon/ai.ts), one conversation that works Laki with its tools. Chat: a thread like Claude's, the tools a turn ran
// folded into one line, the composer at the bottom; Calls: each ask with its tokens, cost and time; Info: how it runs
// and pays, what it spent, what it can do. Off, or OpenRouter without a key: a note.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AI_MODEL, type AiCall, type AiMsg, type AiPast, type AiSettings, type AiTotals } from '../../shared/types'
import { api, bridge, openExternal } from './api'
import { ago } from './Info'
import { linkWorkspaces, wsLink } from './links'
import { Markdown } from './MarkdownView'
import { Modal } from './panels'
import { type Complete, type Img, type Inserts, PromptInput, useDraft } from './PromptInput'
import { ask as confirm, escapes, Icon, IconButton, Page } from './ui'

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
const CAN = ['See your workspaces, agents and PRs', 'Start workspaces and agent tabs', 'Send prompts to your agents', 'Attach PRs, schedule tasks', 'Make extensions (off until you turn them on)']
// what Laki's skill adds (Settings › AI, on unless turned off)
const SKILL_CAN = ["List your open PRs and others' in your repos", "Read and write a project's notes and memory", 'Rename and pin workspaces and tabs, open shells', 'Run your actions, start workspaces from templates', 'Ask you with options when unsure', 'Remove a memory item, task, tab or to-do once you say Yes']

export const money = (n?: number) => (n === undefined ? '—' : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

// workspaces: the ones its answers may name in bold, made links to them (a click opens one)
export function AiPage({
  settings,
  workspaces = [],
  onClose,
  onSettings,
  onLater,
  compact,
  context,
  embed,
  hello,
  chat,
  shot,
  inserts,
  complete,
}: {
  settings: AiSettings
  workspaces?: { id: string; name: string }[]
  onClose: () => void
  onSettings?: () => void
  onLater?: (text: string) => void // Send later's dialog for Laki AI, with what's typed (the app's; not the AI window's)
  compact?: boolean // the bubbles' AI window: the chat alone under a head of its own (no Calls, Info or cost)
  context?: () => Promise<string> // where the user is as they ask (the floating chat's): for the model, not the conversation
  embed?: boolean // compact, in a page of its own (the Extension page's): no close, Esc is the page's
  hello?: { title: string; text: string; examples: string[]; placeholder: string } // what an empty chat says, its examples and the box's hint
  chat?: string // a chat of its own (the Extension page's widget:<id>, the studio's too); none: the AI page's
  shot?: { n: number; png: string } // the AI window's Screenshot to Laki AI: each new one into the box, the mic on (PromptInput's)
  inserts?: Inserts // the box's Insert menu: extensions' actions, for the workspace selected
  complete?: Complete // # and / for the project in the context (no files)
}) {
  const c = chat ? { chat } : {}
  const [d, setD] = useState<AiData>()
  const [tab, setTab] = useState<'chat' | 'calls' | 'info'>('chat')
  const [text, setText, images, setImages] = useDraft(`ai:${chat ?? ''}`) // the AI page's, the floating chat's and the AI window's are one
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null) // compact: the panel
  const closeRef = useRef(onClose) // the app's is a new function each render: the Esc listener stays put
  closeRef.current = onClose
  // the answers' links: made again only as the workspaces' names change (the app's view comes every few ms meanwhile)
  const names = workspaces.map(w => `${w.id}\n${w.name}`).join('\n')
  const link = useMemo(() => linkWorkspaces(workspaces), [names])
  const load = () => api.call<AiData>('aiState', c).then(setD, e => setErr(e.message))
  // the earlier chats (the page's sidebar; an older daemon: none)
  const [past, setPast] = useState<AiPast[]>([])
  const loadPast = () => !compact && !chat && void api.call<AiPast[]>('aiChats').then(setPast, () => {})
  useEffect(() => {
    load()
    loadPast()
    return api.on(m => {
      if (m.ev === 'open') return void (load(), loadPast()) // a daemon started again: its conversation, not the busy one we had
      if (m.ev !== 'ai' || (m.of ?? '') !== (chat ?? '')) return // another chat's (a spec's, an extension's, the AI page's)
      setD(x => x && { ...x, chat: m.chat, busy: m.busy })
      if (!m.chat.length) loadPast() // New chat (here, the AI window, laki ai new): the one it ended is in the list
      if (!m.busy) load() // the call just logged
    })
  }, [])
  // its thread to the end, not the page around it (scrollIntoView would move that too: the Extension page's)
  useEffect(() => {
    const el = end.current?.closest('.ai-thread')
    if (el) el.scrollTop = el.scrollHeight
  }, [d?.chat.length, d?.busy, tab])
  const backend = settings.backend ?? 'openrouter'
  const ready = settings.on !== false && (backend !== 'openrouter' || !!d?.key)
  const can = ready && !d?.busy && !saving && (!!text.trim() || !!images.length)
  const ask = () => {
    if (!can) return
    setErr('')
    const sent = { text, images }
    setText('')
    setImages([])
    // refused before it asked: said here, and back in the box; an ask that failed says so in the conversation
    ;(context ? context().catch(() => '') : Promise.resolve(''))
      .then(where =>
        api.call('aiAsk', {
          ...c,
          text: sent.text,
          images: sent.images.map(i => i.path),
          ...(where && { context: where }),
        }),
      )
      .catch(e => {
        if (!/^(Laki AI is off|Laki AI is busy|Laki AI works in|ask something|the AI is still|no OpenRouter API key|not connected)/.test(e.message)) return
        setErr(e.message)
        setText(sent.text)
        setImages(sent.images)
      })
  }
  const model = settings.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : 'its default model')
  const runs = `${BACKENDS[backend]}${backend !== 'openrouter' && settings.preset ? ` (${settings.preset})` : ''}`
  const cost = !settings.hideCost // Settings › AI's Show costs
  const skill = settings.skill !== false
  // a question's button: its pick goes on as the next ask (a removal: done on Yes, by Laki)
  const pick = (id: string, n: number) => (setErr(''), api.call('aiAnswer', { ...c, id, n }).catch(e => setErr(e.message)))
  // the questions still open: none of yours after them (an older one's moment has passed)
  const lastAsk = d ? d.chat.map(m => m.role).lastIndexOf('user') : -1
  const open = new Set(d?.chat.flatMap((m, i) => (m.ask && i > lastAsk ? [m.ask.id] : [])))
  const t = d?.totals
  const settingsLink = (label: string) =>
    onSettings ? (
      <button className="link" onClick={onSettings}>
        {label}
      </button>
    ) : (
      <span>{label} in Laki › Settings › AI.</span>
    )
  const note = settings.on === false ? (
    <>
      <b>Laki AI is off.</b> Turn it on and pick how it runs: OpenRouter with your API key, or claude -p / codex exec on your plan. {settingsLink('Set it up')}
    </>
  ) : backend === 'openrouter' && d && !d.key ? (
    <>
      <b>No OpenRouter API key yet.</b> Add one, or run it with claude -p or codex exec instead. {settingsLink('Add a key')}
    </>
  ) : null

  const newChat = () => api.call('aiNew', c).then(() => (load(), loadPast()), e => setErr(e.message))
  // an earlier chat taken up again: the one here goes in the list
  const openPast = (id: string) => (setErr(''), setTab('chat'), api.call('aiOpen', { id }).then(() => (load(), loadPast()), e => setErr(e.message)))
  const rmPast = (c: AiPast) => void confirm('Delete this chat?', { text: c.title, ok: 'Delete', danger: true }).then(y => y && api.call('aiChatRm', { id: c.id }).then(loadPast, e => setErr(e.message)))
  const firstAsk = d?.chat.find(m => m.role === 'user')
  const groups = d ? turns(d.chat) : []
  const thread = (
          <>
            <div className="ai-thread" aria-live="polite">
              <div className="ai-col">
                {note && <div className="ai-note">{note}</div>}
                {!groups.length ? (
                  <div className="ai-hello">
                    <span className="ai-mark">
                      <Icon name="ai" size={22} />
                    </span>
                    <h2>{hello?.title ?? 'What should Laki do?'}</h2>
                    <p className="muted">{hello?.text ?? 'It looks at your workspaces and agents, starts new ones, sends them prompts and attaches PRs.'}</p>
                    <div className="ai-examples">
                      {(hello?.examples ?? EXAMPLES).map(x => (
                        <button key={x} onClick={() => (setText(x), document.querySelector<HTMLTextAreaElement>('.ai-composer textarea')?.focus())}>
                          {x}
                          <Icon name="arrowRight" size={12} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  groups.map((g, i) => (Array.isArray(g) ? <Tools key={i} list={g} live={!!d?.busy && i === groups.length - 1} /> : <Message key={i} m={g} link={link} busy={!!d?.busy || !ready || (!!g.ask && !open.has(g.ask.id))} onPick={pick} />))
                )}
                {d?.busy && (
                  <div className="ai-working">
                    <span className="ai-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="ai-shimmer">Working…</span>
                    <button className="ai-stop" onClick={() => api.call('aiStop', { chat: chat ?? '' }).catch(e => setErr(e.message))}>
                      <Icon name="stop" size={10} /> Stop
                    </button>
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
                  focus={!embed}
                  shot={shot}
                  inserts={inserts}
                  complete={complete}
                  enter
                  onBusy={setSaving}
                  rows={2}
                  placeholder={hello?.placeholder ?? 'Ask Laki… or paste a screenshot of PR links'}
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
                !compact && <div className="ai-foot">
                  {runs} · {model} · {skill ? 'it removes only what you confirm; never archives, ships or merges' : 'it never archives, deletes, ships or merges'}
                </div>
              )}
            </div>
          </>
  )
  // in a page: its box takes the keyboard without scrolling the page to it
  useEffect(() => void (embed && box.current?.querySelector('textarea')?.focus({ preventScroll: true })), [])
  useEffect(() => {
    if (!compact || embed) return
    // Esc in it, or with nothing focused and no page or dialog to close: the main window's floating chat stays while
    // Esc goes to a terminal, a page or a dialog
    const f = (e: KeyboardEvent) => escapes(e) && (!box.current || box.current.contains(document.activeElement) || (document.activeElement === document.body && !document.querySelector('.settings-page, .overlay'))) && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [compact])
  if (compact)
    return (
      <div className={`ai-window ${embed ? 'ai-embed' : ''} ${d?.busy ? 'busy' : ''}`} role={embed ? 'region' : 'dialog'} aria-label="Laki AI" ref={box}>
        <div className="ai-win-head drag">
          <span className="ai-mark">
            <Icon name="ai" size={14} />
          </span>
          <span className="ai-title">
            <b>Laki AI</b>
            <span className="ai-sub">{d?.busy ? 'Working…' : ready ? runs : 'not set up'}</span>
          </span>
          <span className="grow" />
          <button className="ai-new nodrag" disabled={!d?.chat.length || d.busy} data-tip="Start a new conversation" onClick={newChat}>
            <Icon name="plus" size={12} /> New chat
          </button>
          {!embed && <IconButton icon="x" title="Close (Esc)" className="nodrag" onClick={onClose} />}
        </div>
        <div className="ai-page">{thread}</div>
      </div>
    )
  return (
    <Page title="Laki AI" onClose={onClose} wide esc={false} /* a page to stay on: Esc is the prompt's, never a close */>
      <div className="ai-page ai-split">
        <aside className="ai-chats" aria-label="Chats">
          <button className="ai-new primary" disabled={!d?.chat.length || d.busy} data-tip={d?.busy ? 'It works on this one: stop it first' : 'Start a new conversation: this one stays below'} onClick={newChat}>
            <Icon name="plus" size={12} /> New chat
          </button>
          <div className="ai-chats-head">Chats</div>
          <button className="ai-chat on" aria-current="true" onClick={() => setTab('chat')}>
            <span className="ai-chat-title">{firstAsk ? firstAsk.text.trim().split('\n')[0] || 'An image' : 'New chat'}</span>
            <span className="ai-chat-at">{d?.busy ? 'working…' : 'now'}</span>
          </button>
          {past.map(c => (
            <div key={c.id} className="ai-chat-row">
              <button className="ai-chat" disabled={d?.busy} data-tip={d?.busy ? 'It works on this chat: stop it first' : c.title} onClick={() => openPast(c.id)}>
                <span className="ai-chat-title">{c.title}</span>
                <span className="ai-chat-at">{ago(c.at)}</span>
              </button>
              <IconButton icon="trash" title="Delete this chat" className="ai-chat-rm" onClick={() => rmPast(c)} />
            </div>
          ))}
          {!past.length && <p className="muted small ai-chats-none">Chats you end with New chat stay here: a click takes one up again.</p>}
        </aside>
        <div className="ai-main">
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
          {t && cost && backend !== 'codex' && (
            <span className="muted small ai-today" data-tip={`This month: ${money(t.month.cost)}, ${t.month.calls} asks`}>
              today {money(t.today.cost)}
            </span>
          )}
        </div>

        {tab === 'chat' ? (
          thread
        ) : tab === 'calls' ? (
          <div className="ai-thread">
            <div className="ai-col wide">
              {d?.calls.length ? (
                <div className="sched-list ai-calls">
                  {d.calls.map(c => (
                    <div key={c.at} className="ai-call" data-tip={c.error ? `Failed: ${c.error}` : c.ask}>
                      <span className={`ai-ok ${c.ok ? 'ok' : 'bad'}`} role="img" aria-label={c.ok ? 'ok' : 'failed'}><Icon name={c.ok ? 'check' : 'x'} size={12} /></span>
                      <span className="ai-ask">{c.ask || '(an image)'}</span>
                      {cost && <span className="mono">{c.backend === 'codex' ? 'plan' : money(c.cost)}</span>}
                      <span className="ai-meta">
                        {BACKENDS[c.backend]} · <span className="mono">{c.model}</span> · {tokens(c.in)} → {tokens(c.out)} tokens · {(c.ms / 1000).toFixed(1)}s
                        · {ago(c.at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sched-empty ai-none">
                  <Icon name="ai" size={18} />
                  <span>
                    <b>No asks yet</b>
                    <span className="muted small">Each ask is logged here: tokens, cost, how long it took.</span>
                  </span>
                </div>
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
                    <b>{cost ? money(t?.today.cost ?? 0) : `${t?.today.calls ?? 0} asks`}</b>
                    <span>
                      today{cost ? ` · ${t?.today.calls ?? 0} asks` : ''} · {tokens((t?.today.in ?? 0) + (t?.today.out ?? 0))} tokens
                    </span>
                  </div>
                  <div>
                    <b>{cost ? money(t?.month.cost ?? 0) : `${t?.month.calls ?? 0} asks`}</b>
                    <span>this month{cost ? ` · ${t?.month.calls ?? 0} asks` : ''}</span>
                  </div>
                </div>
                <button className="link" onClick={() => setTab('calls')}>
                  Every call →
                </button>
              </section>
              <section>
                <h4>What it can do</h4>
                <ul>
                  {[...CAN, ...(skill ? SKILL_CAN : [])].map(x => (
                    <li key={x}>
                      <Icon name="check" size={11} /> {x}
                    </li>
                  ))}
                </ul>
                <p className="muted">{skill ? "Laki's skill is on (Settings › AI). " : ''}It never archives or deletes workspaces, ships or merges: those stay yours.</p>
              </section>
            </div>
          </div>
        )}
        </div>
      </div>
    </Page>
  )
}

// the conversation with each run of tool calls as one group (the Specs page's chats too)
export const turns = (chat: AiMsg[]) =>
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

// a turn's tools, folded: their names in a line; open, each with what it was given. live: the turn is still at
// work (a spinner: only calls are kept, so which one runs, if any, isn't known)
export function Tools({ list, live }: { list: AiMsg[]; live?: boolean }) {
  const names = [...new Set(list.map(toolName))]
  const made = [...new Set(list.flatMap(m => (/^laki_extension_(write|set|on) /.test(m.text) ? (/"id":"([a-z0-9-]+)"/.exec(m.text)?.slice(1) ?? []) : [])))] // the extensions it made or changed: each one's page, a click away (a write's args hold its files: no parse; a quote in them is escaped, so only a key matches)
  return (
    <>
    <details className={`ai-tools ${live ? 'live' : ''}`}>
      <summary>
        {live ? <span className="btn-spin" /> : <Icon name="gear" size={11} />}
        <span>
          {list.length === 1 ? `Used ${names[0]}` : `Used ${list.length} tools: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}`}
        </span>
        <Icon name="chevronRight" size={10} />
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
    {made.length > 0 && !live && (
      <div className="ai-made">
        {made.map(id => (
          <button key={id} className="sm" onClick={() => openExternal(`laki://settings/widgets/${encodeURIComponent(id)}`)}>
            <Icon name="panel" size={11} /> {id}: its page
          </button>
        ))}
      </div>
    )}
    </>
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

// a message's pasted images: thumbnails, a click shows one big; one no longer kept (Settings › AI › Keep pasted images): a
// chip. ponytail: the SHOWN_MAX last read kept as data URLs in memory (the oldest goes); a failed read is asked again
const shown = new Map<string, Promise<string>>()
const SHOWN_MAX = 40
const imageOf = (path: string) => {
  let p = shown.get(path)
  if (p) shown.delete(path) // to the newest end
  else p = api.call<string>('aiImage', { path })
  shown.set(path, p)
  p.catch(() => shown.get(path) === p && shown.delete(path))
  for (const k of shown.keys()) if (shown.size > SHOWN_MAX) shown.delete(k)
  return p
}
export function Thumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([])
  const [big, setBig] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    void Promise.all(paths.map(p => imageOf(p).catch(() => null))).then(u => on && setUrls(u))
    return () => void (on = false)
  }, [paths.join('\n')])
  const gone = urls.filter(u => u === null).length
  return (
    <span className="ai-thumbs">
      {urls.map((u, i) =>
        u ? (
          <button key={i} type="button" className="ai-thumb" data-tip="Show it big" onClick={() => setBig(u)}>
            <img src={u} alt={`Image ${i + 1}`} />
          </button>
        ) : null,
      )}
      {(!urls.length || gone > 0) && (
        <span className="tag" data-tip={urls.length ? 'Not kept any more: Settings › AI › Keep pasted images' : undefined}>
          <Icon name="image" size={11} /> {urls.length ? gone : paths.length} image{(urls.length ? gone : paths.length) > 1 ? 's' : ''}
        </span>
      )}
      {big && (
        <Modal title="Image" onClose={() => setBig(null)} wide loose>
          <div className="art-big">
            <img src={big} alt="" />
          </div>
          <div className="buttons">
            <button className="primary" onClick={() => setBig(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}

export function Message({ m, link, busy, onPick }: { m: AiMsg; link: (text: string) => string; busy: boolean; onPick: (id: string, n: number) => void }) {
  const src = useMemo(() => link(m.text), [m.text, link])
  if (m.role === 'error') return <div className="ai-msg ai-error">{m.text}</div>
  if (m.role === 'user')
    return (
      <div className="ai-msg ai-user">
        {m.text}
        {!!m.images?.length && <Thumbs paths={m.images} />}
      </div>
    )
  return (
    <div className="ai-msg ai-answer">
      <span className="ai-mark small">
        <Icon name="ai" size={13} />
      </span>
      <div className="ai-body">
        <Markdown src={src} />
        {m.ask && (
          // its options: one pick, then they stay as they were picked
          <div className="ai-options" role="group" aria-label="Answer">
            {m.ask.options.map((o, n) => (
              <button
                key={o}
                className={m.ask!.picked === o ? 'picked' : m.ask!.act && m.ask!.act.kind !== 'widget' && m.ask!.act.kind !== 'run' && n === 0 ? 'danger' : m.ask!.perm && n === 0 && m.ask!.picked === undefined ? 'primary' : ''}
                disabled={(busy && !m.ask!.perm) || m.ask!.picked !== undefined} /* a tool its agent asks for: while it works */
                aria-pressed={m.ask!.picked === o}
                onClick={() => onPick(m.ask!.id, n)}
              >
                {m.ask!.picked === o && <Icon name="check" size={11} />} {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
