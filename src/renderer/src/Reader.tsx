// Reader view: an agent tab's chat as a conversation instead of its terminal (the daemon's chatRead: claude's or
// codex's transcript, asked every 1.5 s while shown). Your messages on the right, its answers as Markdown, a run of
// tool calls folded into one line, what it does now; its menu as buttons, a box that sends (send whenIdle). Over the
// box, chips for the subagents and background tasks a claude chat still runs; under an MCP call, its app (McpApp); in
// an answer, a laki-ui block drawn with the UI kit (UiBlock). The terminal stays attached under it: Terminal brings
// it back as it was
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AskDiff } from './Diff'
import { Glyph } from './Glyph'
import { ask, Icon, type MenuItem, useMenu } from './ui'
import { linkify, Markdown, UiBlocks } from './MarkdownView'
import { clean } from './Widgets'
import { daemonBase, openExternal } from './api'
import { uiBehave, WIDGET_CSS } from '../../shared/widget'
import { isElement, uiCheck, uiHtml } from '../../shared/widgetUi'
import { historyKey, useComplete, usePromptHistory } from './PromptInput'
import { type Mention, withMentions } from './text'
import { planNow } from '../../shared/todos'
import { HIDDEN, type TabView } from '../../shared/types'

type Said = { who: 'you' | 'agent' | 'tool' | 'screen'; text: string }
// what a claude chat runs in the background (the daemon's share.ts bgOf): subagents and background shells
type BgTask = { id: string; kind: 'agent' | 'shell'; name: string; out?: string }
type BgOut = { text: string; size: number; cut?: boolean }
// an MCP App (the daemon's mcpApps.ts): a tool call's app, under the said line it's in (at); src: its page on the daemon
type App = { id: string; at: number; server: string; tool: string; src: string; input: unknown; result?: unknown; error?: boolean }
export type ReaderApi = { read: (tab: string, v?: number) => Promise<{ none?: boolean; v?: number; said?: Said[]; bg?: BgTask[]; apps?: App[] }>; bgOutput?: (tab: string, id: string) => Promise<BgOut>; appCall?: (tab: string, id: string, name: string, args: unknown) => Promise<unknown>; send: (tab: string, text: string) => Promise<unknown>; answer: (tab: string, n: number) => void; review: (tab: TabView) => void; undo: (tab: TabView) => void; mentions?: (tab: TabView) => Mention[] } // review, undo: its last turn's changes (the card); mentions: @'s workspaces and projects

// the agents whose chats Laki reads (meters.ts' tailOf)
export const readable = (t?: TabView) => !!t && t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex')

export function Reader({ tab, api, active }: { tab: TabView; api: ReaderApi; active: boolean }) {
  const [said, setSaid] = useState<Said[]>()
  const [bg, setBg] = useState<BgTask[]>([])
  const [apps, setApps] = useState<App[]>([])
  const [none, setNone] = useState(false)
  const [text, setText] = useState('')
  const [hid, setHid] = useState<string>() // the guess Esc hid (settings.nextPrompt's tab.suggest)
  const ghost = !text && tab.status === 'idle' && tab.suggest && tab.suggest !== hid ? tab.suggest : undefined
  const v = useRef<number>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [histMenu, history] = usePromptHistory(box, setText) // ↑ in the empty box: your prompts
  const at = useComplete(box, api.mentions && { key: tab.id, mentions: () => api.mentions!(tab) }, setText) // @ a workspace or project
  const pinned = useRef(true) // at the bottom: it stays there as the chat grows
  useEffect(() => {
    let alive = true
    v.current = undefined
    const go = () =>
      api.read(tab.id, v.current).then(
        r => alive && (setNone(!!r.none), r.said && ((v.current = r.v), setSaid(r.said), setBg(r.bg ?? []), setApps(r.apps ?? []))),
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
    void api.send(tab.id, withMentions(t, api.mentions?.(tab) ?? [])).catch(() => setText(t)) // a line for each @ it names
  }
  const now = tab.plan && !tab.plan.stale ? planNow(tab.plan) : undefined
  // the chips over the box: Subagents · n, Background · n; a click lists them, each with Show output and Stop
  const [menu, openMenu] = useMenu()
  const [out, setOut] = useState<{ task: BgTask; got?: BgOut; err?: string; ended?: boolean }>()
  useEffect(() => {
    if (!out || !api.bgOutput || out.ended) return // ended: nothing more to read
    let alive = true
    const go = () => api.bgOutput!(tab.id, out.task.id).then(got => alive && setOut(o => (o?.task.id === out.task.id ? { ...o, got, err: undefined } : o)), e => alive && setOut(o => o && (o.got ? { ...o, ended: true } : { ...o, err: (e as Error).message }))) // ended: its last output stays
    go()
    const t = setInterval(() => document.visibilityState === 'visible' && go(), 2000)
    return () => ((alive = false), clearInterval(t))
  }, [out?.task.id, out?.ended, tab.id])
  const live = tab.status !== 'exited' ? bg : []
  // a subagent in this turn (its call's id) stops with the turn (Esc); a background one or a shell: the agent is asked
  const stop = (t: BgTask) => void api.send(tab.id, `Stop the background ${t.kind === 'agent' ? 'subagent' : 'task'} ${t.id} (${t.name}) now, with TaskStop (or KillShell), then say it's stopped.`).catch(() => {})
  const chipMenu = (e: React.MouseEvent, list: BgTask[]) =>
    openMenu(
      e,
      list.map(t => {
        const inTurn = t.id.startsWith('toolu_')
        return {
          label: t.name,
          icon: t.kind === 'agent' ? 'agent' : 'terminal',
          mono: t.kind === 'shell',
          sub: inTurn ? 'in this turn: Esc stops it with the turn' : t.id,
          items: [
            ...(t.out && api.bgOutput ? [{ label: 'Show output', icon: 'file', run: () => setOut({ task: t }) } as MenuItem] : []),
            ...(inTurn ? [] : [{ label: 'Stop', icon: 'stop', danger: true, tip: `Asks ${tab.name} to stop it`, run: () => stop(t) } as MenuItem]),
          ],
        } as MenuItem
      }),
    )
  const chips = live.length > 0 && (
    <div className="rd-chips">
      {(['agent', 'shell'] as const).map(k =>
        (list =>
          list.length > 0 && (
            <button key={k} type="button" className="rd-chip" data-tip={k === 'agent' ? 'Subagents it started that still work' : 'Commands it left running in the background'} onClick={e => chipMenu(e, list)}>
              <Icon name={k === 'agent' ? 'agent' : 'terminal'} size={12} />
              {k === 'agent' ? 'Subagents' : 'Background'} · {list.length}
            </button>
          ))(live.filter(t => t.kind === k)),
      )}
    </div>
  )
  const outBox = out && (
    <div className="rd-out">
      <div className="rd-out-head">
        <span className="mono small grow">{out.task.name}</span>
        {out.ended ? <span className="muted small">ended</span> : out.got?.cut && <span className="muted small">its last 64 KB</span>}
        <button type="button" className="link small" aria-label="Close" onClick={() => setOut(undefined)}>
          ×
        </button>
      </div>
      {out.err ? <div className="warn small">{out.err}</div> : <pre className="rd-out-text">{out.got ? out.got.text || '(nothing yet)' : 'Loading…'}</pre>}
    </div>
  )
  const uiDraw = useMemo(() => (json: string) => <UiBlock json={json} onSend={text => void api.send(tab.id, text).catch(() => {})} />, [tab.id])
  return (
    <UiBlocks.Provider value={uiDraw}>
    <div className="reader">
      <div className="reader-scroll" ref={scroll} onScroll={e => (pinned.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
        <div className="reader-col">
          {none && !said?.length && <div className="reader-empty muted">{tab.name}'s chat shows here once it has said something.</div>}
          {said?.map((x, i) => [
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
            ...apps.filter(a => a.at === i).map(a => <McpApp key={a.id} app={a} tab={tab} api={api} />),
          ])}
          {tab.changes && tab.status !== 'running' && <TurnCard tab={tab} api={api} />}
          {tab.status === 'running' && (
            <div className="rd-working muted">
              <Glyph s="running" /> {now ?? 'Working'}…
            </div>
          )}
        </div>
      </div>
      {outBox}
      {chips}
      {menu}
      {tab.planAsk && tab.ask ? (
        <div className="rd-ask muted">It asks you to approve its plan: below, where you can change it too.</div>
      ) : tab.ask ? (
        <div className="rd-ask">
          <span className="muted">{tab.ask.question || `${tab.name} asks:`}</span>
          {tab.ask.diff && <AskDiff key={tab.ask.what} diff={tab.ask.diff} />}
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
            onChange={e => (setText(e.target.value), at.look())}
            onSelect={at.look}
            onBlur={at.blur}
            onKeyDown={e => {
              if (at.key(e)) return // @'s menu took it
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
          {at.menu}
        </form>
      )}
    </div>
    </UiBlocks.Provider>
  )
}

// A ```laki-ui block in an agent's answer: UI kit JSON (an element, or { "ui": element, "data": {…} }) drawn with the
// kit's own controls, as an extension's are (a shadow root, the sanitizer, uiBehave): a table, choices, stats… A
// button's do send puts its prompt to this agent (your pick); copy copies; a link opens in the browser; the rest
// (new, terminal, ai, browse, an action) does nothing here. JSON that isn't, or an element the kit hasn't: the code
function UiBlock({ json, onSend }: { json: string; onSend: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const spec = useMemo(() => {
    try {
      const j = JSON.parse(json)
      const ui = isElement(j) ? j : j && typeof j === 'object' && isElement(j.ui) ? j.ui : undefined
      return ui && !uiCheck(ui).some(x => x.level === 'error') ? { ui, data: isElement(j) ? {} : (j.data ?? {}) } : undefined
    } catch {
      return undefined
    }
  }, [json])
  const send = useRef(onSend)
  send.current = onSend
  useEffect(() => {
    if (!spec || !host.current) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    root.replaceChildren(Object.assign(document.createElement('style'), { textContent: WIDGET_CSS }), clean(uiHtml(spec.ui, { data: spec.data, config: {} }, { full: true, hide: { refresh: true, at: true } })))
    return uiBehave(root, m => {
      const cmd = m.cmd as { do?: string; prompt?: string } | undefined
      if (m.laki === 'do' && cmd?.do === 'send' && typeof cmd.prompt === 'string' && cmd.prompt.trim()) return (send.current(cmd.prompt.trim()), true)
      // a copy of words the block shows: at once; else (a button whose label isn't what it copies, a hidden character)
      // you see what it would copy first, on a card: an agent's answer can't put a command you didn't read in your clipboard
      if (m.laki === 'copy' && typeof m.text === 'string') {
        const text = m.text
        const seen = !HIDDEN.test(text) && !!text.trim() && (root.textContent ?? '').includes(text.trim())
        if (!seen && (text.length > 2000 || HIDDEN.test(text))) return
        void (seen ? Promise.resolve(true) : ask("Copy this?", { text, ok: "Copy" })).then(ok => (ok ? navigator.clipboard.writeText(text) : undefined)).catch(() => {})
      }
      if (m.laki === 'open' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) openExternal(m.url)
    })
  }, [spec])
  if (!spec)
    return (
      <pre>
        <code>{json}</code>
      </pre>
    )
  return <div ref={host} className="widget-body rd-ui" />
}

// An MCP App: the tool's own page (the server's ui:// resource, served by the daemon with its CSP) in a sandboxed frame
// that talks to Laki by postMessage (JSON-RPC, the MCP Apps extension): it's told the call's input and result; it may
// open a link (http(s), in the browser), ask its server to run a tool or send a message to the agent, each only once
// you say yes on a card; it says how tall it is
// what an app's card asks you to approve: all of it on the card (it scrolls), as it is: nothing HIDDEN (U+202E and the
// like would make it read as something else), else refused, as an agent's asks are (text.ts noteWhole)
const whole = (s: string) => s.length <= 2000 && !HIDDEN.test(s)
const UNSHOWN = 'too long to show you whole, or with characters you would not see'
function McpApp({ app, tab, api }: { app: App; tab: TabView; api: ReaderApi }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState<string>()
  const [h, setH] = useState(180)
  useEffect(() => void daemonBase().then(b => setSrc(b + app.src)), [app.src])
  const now = useRef({ app, tab })
  now.current = { app, tab }
  useEffect(() => {
    const post = (m: object) => frame.current?.contentWindow?.postMessage({ jsonrpc: '2.0', ...m }, '*')
    const told = () => {
      const a = now.current.app
      post({ method: 'ui/notifications/tool-input', params: { arguments: a.input } })
      if (a.result) post({ method: 'ui/notifications/tool-result', params: { ...(a.result as object), ...(a.error && { isError: true }) } })
    }
    const on = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object' || e.data.jsonrpc !== '2.0') return
      const { id, method, params } = e.data as { id?: number | string; method?: string; params?: any }
      const reply = (r: { result?: unknown; error?: { code: number; message: string } }) => id !== undefined && post({ id, ...r })
      const no = (message: string, code = -32000) => reply({ error: { code, message } })
      const { app: a, tab: t } = now.current
      try {
        if (method === 'ui/initialize') {
          const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark')
          return reply({ result: { protocolVersion: '2025-06-18', hostInfo: { name: 'Laki', version: '1' }, hostCapabilities: { openLinks: {}, serverTools: {} }, hostContext: { theme: dark ? 'dark' : 'light', displayMode: 'inline', availableDisplayModes: ['inline'] } } })
        }
        if (method === 'ui/notifications/initialized') return told()
        if (method === 'ui/notifications/size-changed') return void (typeof params?.height === 'number' && setH(Math.max(60, Math.min(900, Math.ceil(params.height)))))
        if (method === 'ui/open-link') {
          const url = String(params?.url ?? '')
          if (!/^https?:\/\//i.test(url)) return no('only http(s) links')
          if (!whole(url)) return no(`a link ${UNSHOWN}`)
          if (!(await ask(`The ${a.server} app wants to open a link`, { text: url, ok: 'Open' }))) return no('you said no')
          openExternal(url)
          return reply({ result: {} })
        }
        if (method === 'tools/call') {
          const name = String(params?.name ?? '')
          const args = JSON.stringify(params?.arguments ?? {}, null, 1)
          if (!whole(name) || !whole(args)) return no(`a call ${UNSHOWN}`)
          if (!api.appCall || !(await ask(`The ${a.server} app wants to run ${name}`, { text: args, ok: 'Run it' }))) return no('you said no')
          return reply({ result: await api.appCall(t.id, a.id, name, params?.arguments ?? {}) })
        }
        if (method === 'ui/message') {
          const text = (Array.isArray(params?.content) ? params.content : []).map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : '')).join('\n').trim()
          if (text && !whole(text)) return no(`a message ${UNSHOWN}`)
          if (!text || !(await ask(`The ${a.server} app wants to send ${t.name} a message`, { text, ok: 'Send' }))) return no('you said no')
          await api.send(t.id, text)
          return reply({ result: {} })
        }
        if (method && id !== undefined) no(`${method}: not here`, -32601)
      } catch (err) {
        no((err as Error).message)
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])
  return (
    <div className="rd-app">
      <div className="rd-app-head muted small">
        {app.server} · {app.tool}
      </div>
      {src && <iframe ref={frame} className="rd-app-frame" title={`${app.server} ${app.tool}`} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ height: h }} />}
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
