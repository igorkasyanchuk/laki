// An extension's own page, the one place to make and change one (Settings › Extensions' rows and New ▾, a widget's ⚙
// and right click, the Desk's tiles and Build with AI, ⌘K's New extension…, laki://settings/widgets/<id>[/inspect],
// /new and /<id>/studio): how it looks (live, or with its sample: made-up data) in its place and as its full view, its
// settings, the inspector's tabs (Data, Runs, Logs, Env, Files, Check) beside Overview, and Laki AI's chat on the right
// (widget:<id>, ai.ts' aboutWidget) to make or change it. id '': a new one, its Start beside the chat's starters; the
// first ask names it (widgetSlug), and the page shows it as soon as Laki AI saves it. Nothing runs by itself: Try it
// live says what will, then runs it once (widgetRun once); Turn on shows the same, then turns it on. Undo (and a turn's
// Undo to here) puts a version back. start: the Desk's Build with AI, the first ask, sent as it opens. Closing goes
// back where it was opened from. App.tsx passes the Settings' WidgetsApi and the widgets' WidgetApi.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AiMsg, type AiSettings, LOG_LEVELS, placesOf, type WidgetLogLine, type WidgetRuns, type WidgetView } from '../../shared/types'
import { ago } from '../../shared/widget'
import { widgetPrompt } from '../../shared/widgetGuide'
import { STARTER_KINDS, STARTERS } from '../../shared/widgetStarters'
import type { UiProblem } from '../../shared/widgetUi'
import { BACKENDS, Message, Tools, turns } from './Ai'
import { api as daemon, bridge } from './api'
import type { DeskAsk } from './Desk'
import { highlight } from './highlight'
import { Markdown } from './MarkdownView'
import { Modal } from './panels'
import { PromptInput, useDraft } from './PromptInput'
import { extAgent, SourceField, StudioSessions, WidgetCard, type WidgetsApi } from './Settings'
import { ask, escapes, Icon, IconButton, ON, Page, Switch, useMenu } from './ui'
import { CELL_W, CellButton, Glyph, inWs, status, type WidgetApi, WidgetBody } from './Widgets'

const WHERE: Record<string, string> = { side: 'In the sidebar', top: 'In the top bar', status: 'In the status bar', rail: 'On the rail', foot: "In the sidebar's foot", desk: 'On My Desk', panel: 'In the right panel', row: 'On each workspace’s row' }
const half = (d: number) => (d === 0.5 ? '½' : String(d))

export type ExtTab = 'overview' | 'data' | 'runs' | 'logs' | 'env' | 'files' | 'check'
const TABS: [ExtTab, string][] = [
  ['overview', 'Overview'],
  ['data', 'Data'],
  ['runs', 'Runs'],
  ['logs', 'Logs'],
  ['env', 'Env'],
  ['files', 'Files'],
  ['check', 'Check'],
]
type Pick = 'live' | 'sample' | undefined // the preview's data: unset, made-up while it's off or not fetched yet

// spots, here: the workspaces a per-workspace one has an instance in (live, no terminal, browser or SSH host), the one on
// screen (the picker's first); onNamed: a new one's first ask named it, so Back and a reopen come back to it
export function ExtensionPage({ id, tab: first, edit, start, widgets, cfg, api, ai, spots, here, back, onNamed, onAiSettings, onClose }: { id: string; tab?: ExtTab; edit?: string; start?: DeskAsk; widgets: WidgetView[]; cfg: WidgetsApi; api: WidgetApi; ai?: AiSettings; spots: { id: string; name: string }[]; here: string | null; back: string; onNamed?: (id: string) => void; onAiSettings: () => void; onClose: () => void }) {
  const [cur, setCur] = useState(id)
  const [tab, setTab] = useState<ExtTab>(first ?? 'overview')
  const [draft, setDraft] = useState<Draft | null>(null) // a file being edited in Files: kept across its tabs
  const [spot, setSpot] = useState(0) // Edit: the settings' card scrolled to and lit, once per click
  // edit: a setting it needs (turned on with it empty, its cell's Set …): Overview, that field
  useEffect(() => void (edit && (setTab('overview'), setSpot(s => s + 1))), [edit])
  const [at, setAt] = useState(here ?? spots[0]?.id ?? null) // a per-workspace one: whose instance
  const w = (x => x && inWs(x, spots.some(s => s.id === at) ? at : null))(widgets.find(x => x.id === cur))
  const seen = useRef(false) // one just made (New ▾, Laki AI) comes with the next view
  if (w) seen.current = true
  useEffect(() => void (cur && !w && seen.current && onClose()), [cur, !w]) // deleted meanwhile
  // closing with a file's changes not saved asks first
  const close = async () => (!draft || draft.text === draft.was || (await ask('Discard your changes?', { text: `${draft.path} has changes you haven't saved.`, ok: 'Discard', danger: true }))) && onClose()
  const closeRef = useRef(close)
  closeRef.current = close
  // Esc goes back, unless a menu or a dialog has it or the focused box has something typed (it stays)
  useEffect(() => {
    const typed = (el: Element | null) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? !!el.value.trim() : !!(el as HTMLElement | null)?.isContentEditable)
    const f = (e: KeyboardEvent) => escapes(e) && !typed(document.activeElement) && !document.activeElement?.closest('select, .overlay, .menu') && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const mine = !!w && !w.builtin && !!cfg.home && w.dir === `${cfg.home}/${w.id}`
  const guarded = !!(w?.project || w?.agentDev) // a repo's or an agent-linked folder's: turned on through App's repoSheet (every file it runs), never run once while off
  const aiOn = ai?.on !== false
  const [pick, setPick] = useState<Pick>()
  // a rewrite: its sample again (Try it live's data was the version before)
  const rev = useRef(w?.rev)
  useEffect(() => void (w && rev.current !== w.rev && ((rev.current = w.rev), setPick(undefined))), [w?.rev])
  // its check (no run) as its files change: the head's chip
  const [problems, setProblems] = useState<UiProblem[]>([])
  useEffect(() => {
    if (!w) return setProblems([])
    let on = true
    cfg.check?.(w.id, false).then(r => on && setProblems(r.problems), () => {})
    return () => void (on = false)
  }, [w?.id, w?.rev])
  const errors = problems.filter(p => p.level === 'error').length
  const [sheet, setSheet] = useState<'try' | 'on' | null>(null)
  const [oops, setOops] = useState('')
  // an ask: a new one's id from its first words (named: from those); one of yours, Laki AI may rewrite (widgetSet ai: an hour's leave)
  const askAi = async (text: string, images: string[] = [], named = text) => {
    setOops('')
    try {
      let to = cur
      if (!to) {
        to = (await daemon.call<{ id: string }>('widgetSlug', { text: named })).id
        setCur(to)
        onNamed?.(to)
      }
      if (mine) await cfg.set(to, { ai: true })
      await daemon.call('aiAsk', { chat: `widget:${to}`, text, images })
      return true
    } catch (e) {
      setOops(String((e as Error)?.message ?? e))
      return false
    }
  }
  const undo = (after?: number) =>
    void (
      w &&
      cfg.undo?.(w.id, after).then(
        () => setPick(undefined),
        e => setOops(String(e?.message ?? e)),
      )
    )
  const name = w?.name ?? (cur || 'New extension')
  return (
    <Page
      title={name}
      wide
      esc={false} /* Esc: ours, above (a field keeps it) */
      onClose={close}
      head={
        <>
          <nav className="crumbs" aria-label="Where you are">
            <button className="crumb" onClick={close}>
              <Icon name="chevronLeft" size={12} /> {back}
            </button>
            <span className="muted">›</span>
            <b className="crumb here">{name}</b>
          </nav>
          {w?.repo && (
            <span className="tag" data-tip="It comes with the repo: its files are the repo's, its settings yours">
              From {w.repo}'s .laki/extensions
            </span>
          )}
          {w && !w.on && <span className="tag">off</span>}
          {w?.byAi && <span className="tag" data-tip="Laki AI wrote it: look at what it runs before you turn it on">by Laki AI</span>}
          {errors > 0 && (
            <button className="tag tag-closed ext-problems" onClick={() => setTab('check')}>
              {errors} {errors === 1 ? 'problem' : 'problems'}
            </button>
          )}
          {w && (
            <button className="sm ext-edit" data-tip="Its settings: where it shows, its size, its data, its options" onClick={() => (setTab('overview'), setSpot(n => n + 1))}>
              <Icon name="pencil" size={12} /> Edit
            </button>
          )}
        </>
      }
      tools={
        w && (
          <span className="ext-acts">
            {mine && (
              <button className="sm" disabled={!w.history?.length} data-tip={w.history?.length ? 'Back to the version before the last change' : 'Nothing to undo yet'} onClick={() => undo()}>
                Undo
              </button>
            )}
            {!w.on && (
              <button className="sm" disabled={(w.every === undefined && !w.js) || !!w.scope || guarded} data-tip={guarded ? 'Not before you turn it on: Turn on shows every file it runs' : w.scope ? 'Per workspace: turn it on, then look in a workspace' : 'See what it runs, then run it once: its real data here'} onClick={() => setSheet('try')}>
                Try it live
              </button>
            )}
            {!w.on && (
              <button className="sm primary" onClick={() => (guarded ? void cfg.set(w.id, { on: true }).catch(e => setOops(String(e?.message ?? e))) : setSheet('on'))}>
                Turn on
              </button>
            )}
          </span>
        )
      }
    >
      <div className={`ext ${w ? '' : 'new'}`}>
        <div className="ext-main">
          {w ? (
            <>
              <InspectHead w={w} cfg={cfg} tab={tab} setTab={setTab} spots={spots} setAt={setAt} />
              {tab === 'overview' ? <Preview w={w} api={api} cfg={cfg} pick={pick} setPick={setPick} spot={spot} field={edit} /> : tab === 'check' ? <Check w={w} cfg={cfg} /> : tab === 'logs' ? <Logs w={w} cfg={cfg} spots={spots} copy={api.copy} /> : <Inspector w={w} cfg={cfg} tab={tab} draft={draft} setDraft={setDraft} />}
            </>
          ) : cur ? (
            <div className="ext-wait muted">
              <Icon name="panel" size={28} />
              <p>Not saved yet: it shows here with made-up data as soon as it is, its settings with it.</p>
            </div>
          ) : (
            <Start ai={aiOn} home={cfg.home} onAiSettings={onAiSettings} />
          )}
        </div>
        <aside className="ext-chat" aria-label="Laki AI">
          {aiOn ? (
            <Chat chat={cur ? `widget:${cur}` : ''} w={w} mine={mine} ai={ai ?? {}} onAsk={askAi} undo={undo} err={oops} start={cur === id ? start : undefined} cfg={cfg} />
          ) : (
            <div className="ext-ai-off">
              <Icon name="ai" size={22} />
              <b>Laki AI makes and changes extensions here</b>
              <p className="muted small">Turn it on to describe one and iterate on it beside its preview.</p>
              <button className="primary" onClick={onAiSettings}>
                Turn on Laki AI
              </button>
              {oops && <div className="ai-err">{oops}</div> /* the head's Turn on and Undo say why they failed here too */}
            </div>
          )}
        </aside>
      </div>
      {sheet && w && (
        <TrySheet
          w={w}
          on={sheet === 'on'}
          cfg={cfg}
          onClose={() => setSheet(null)}
          onRan={() => (setPick('live'), setSheet(null), setTab('overview'))}
          onOn={() => (setPick(undefined), setSheet(null))}
        />
      )}
    </Page>
  )
}

type ChatData = { chat: AiMsg[]; busy: boolean; ended?: number }
const EXAMPLES = ['My Vercel deploys', 'Linear issues assigned to me', 'A focus timer on the rail']
const started = new WeakSet<object>() // a first ask sent: never again as its page comes back (Back, a remount)

// Laki AI's chat about it (widget:<id>; '': a new one's, until its first ask names it): the thread (a turn's tools
// folded, with Undo to here once something was written after it) and the box; empty: the starters, examples and where
// you left off (a new one), or what to ask (one of yours; one that isn't: a copy of it to change)
function Chat({ chat, w, mine, ai, onAsk, undo, err, start, cfg }: { chat: string; w?: WidgetView; mine: boolean; ai: AiSettings; onAsk: (text: string, images?: string[], named?: string) => Promise<boolean>; undo: (after?: number) => void; err: string; start?: DeskAsk; cfg: WidgetsApi }) {
  const [d, setD] = useState<ChatData>()
  const [text, setText, images, setImages] = useDraft(chat || 'widget:') // widget: a new one's, before its first ask names it
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const load = () => (chat ? daemon.call<ChatData>('aiState', { chat }).then(setD, () => {}) : (setD(undefined), Promise.resolve()))
  useEffect(() => {
    void load()
    if (!chat) return
    return daemon.on(m => {
      if (m.ev === 'open') void load()
      else if (m.ev === 'ai' && m.of === chat) setD({ chat: m.chat, busy: m.busy, ended: m.ended })
    })
  }, [chat])
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [d?.chat.length, d?.busy])
  // in a page: its box takes the keyboard, without scrolling the page to it
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => void (matchMedia('(pointer: coarse)').matches || box.current?.querySelector('textarea')?.focus({ preventScroll: true })), []) // not on a touch screen: its keyboard would cover the page
  const busy = asking || !!d?.busy
  const go = (t: string, imgs: string[] = [], named?: string) => {
    setAsking(true)
    return onAsk(t, imgs, named).finally(() => setAsking(false))
  }
  // the Desk's ask, once: back in the box when it fails (no key, Laki AI at work in too many chats), to send again
  useEffect(() => {
    if (!start || started.has(start)) return
    started.add(start)
    void go(start.text, start.images.map(i => i.path), start.want).then(ok => ok || (setText(start.text), setImages(start.images)))
  }, [])
  const send = () => {
    if (saving || busy || (!text.trim() && !images.length)) return
    const sent = { text, images }
    setText('')
    setImages([])
    void go(sent.text, sent.images.map(i => i.path)).then(ok => ok || (setText(sent.text), setImages(sent.images)))
  }
  const pick = (id: string, n: number) => daemon.call('aiAnswer', { id, n, chat }).catch(() => {})
  const lastAsk = d ? d.chat.map(m => m.role).lastIndexOf('user') : -1
  const open = new Set(d?.chat.flatMap((m, i) => (m.ask && i > lastAsk ? [m.ask.id] : [])))
  const groups = d ? turns(d.chat) : []
  const backend = ai.backend ?? 'openrouter'
  const hello = !w
    ? { title: 'What should it show?', text: 'Describe it, or start from a starter: Laki AI writes it with made-up data to look at. It stays off until you try it and turn it on.', examples: EXAMPLES }
    : mine
      ? { title: `Change ${w.name}`, text: 'Say what to change: Laki AI rewrites it, checks it, and the preview shows it with its sample data. Undo puts the last version back.', examples: ['Show the count in red when it is over 10', 'Add a refresh button to the full view', 'Make the full view a table with sorting'] }
      : { title: `Ask about ${w.name}`, text: `It ${w.builtin ? 'comes with Laki' : w.project ? `comes with ${w.repo ?? 'its repo'}` : 'lives in a folder of yours'}, so Laki AI can't change it here: Remix makes a copy that's yours, with a chat of its own.`, examples: ['What does it run, and how often?', 'Where does its data come from?'] }
  return (
    <div className={`ext-ai ${d?.busy ? 'busy' : ''}`} ref={box}>
      <div className="ai-win-head">
        <span className="ai-mark">
          <Icon name="ai" size={14} />
        </span>
        <span className="ai-title">
          <b>Laki AI</b>
          <span className="ai-sub">{d?.busy ? 'Working…' : `${BACKENDS[backend]}${backend !== 'openrouter' && ai.preset ? ` (${ai.preset})` : ''}`}</span>
        </span>
        <span className="grow" />
        {chat && (
          <button className="ai-new" disabled={!d?.chat.length || d.busy} data-tip="Start this chat over: what was said goes, the extension stays" onClick={() => void daemon.call('aiNew', { chat }).then(load, () => {})}>
            <Icon name="plus" size={12} /> New chat
          </button>
        )}
      </div>
      <div className="ext-ai-thread" ref={thread} aria-live="polite">
        {!d?.chat.length ? (
          <div className="ext-ai-hello">
            <Icon name="ai" size={22} />
            <b>{hello.title}</b>
            <p className="muted small">{hello.text}</p>
            {!w && (
              <div className="ext-ai-starters">
                {STARTER_KINDS.map(k => (
                  <button key={k} className="nw-chip" disabled={busy} data-tip={STARTERS[k].blurb} onClick={() => void go(`Start from the "${STARTERS[k].title}" starter (${STARTERS[k].blurb}), then make it mine: ask me what it should show.`)}>
                    {STARTERS[k].title}
                  </button>
                ))}
              </div>
            )}
            {hello.examples.map(e => (
              <button key={e} className="ext-ai-example" disabled={busy} onClick={() => void go(e)}>
                {e}
              </button>
            ))}
            {w && !mine && cfg.remix && !w.oneFile && (
              <button className="sm" onClick={() => void cfg.remix!(w.id)}>
                <Icon name="copy" size={12} /> Remix it
              </button>
            )}
            {!chat && !!cfg.chats?.length && (
              <div className="ext-ai-left">
                <b className="small">Where you left off</b>
                <StudioSessions api={cfg} />
              </div>
            )}
          </div>
        ) : (
          groups.map((g, i) => {
            if (!Array.isArray(g)) return <Message key={i} m={g} link={same} busy={busy || !!d.ended || (!!g.ask && !open.has(g.ask.id))} onPick={pick} />
            const at = g[g.length - 1].at
            const later = !d.busy && w?.history?.some(h => h > at)
            return (
              <div key={i} className="ext-ai-turn">
                <Tools list={g} live={d.busy && i === groups.length - 1} />
                {later && (
                  <button className="link small" data-tip="Its files as they were after this" onClick={() => undo(at)}>
                    Undo to here
                  </button>
                )}
              </div>
            )
          })
        )}
        {d?.busy && (
          <div className="ai-working">
            <span className="ai-dots">
              <i />
              <i />
              <i />
            </span>
            Working…
            <button onClick={() => daemon.call('aiStop', { chat })}>Stop</button>
          </div>
        )}
        {d?.ended && <p className="muted small">This chat ended after hours unused: what you type starts a new one.</p>}
      </div>
      <div className="ext-ai-dock">
        <div className="nw-card nw-composer ai-composer">
          <PromptInput
            value={text}
            onChange={setText}
            images={images}
            onImages={setImages}
            save={(data, ext) => daemon.call<string>('imageSave', { data, ext })}
            dictate={bridge?.dictate}
            dictationSettings={bridge?.dictationSettings}
            onSubmit={send}
            enter
            onBusy={setSaving}
            rows={2}
            placeholder={!w ? 'Describe the extension…' : mine ? `What should change in ${w.name}?` : `Ask about ${w.name}…`}
            tools={
              <button className="primary ai-send" aria-label="Ask (⏎)" data-tip="Ask (⏎) · ⇧⏎ a new line" disabled={busy || saving || (!text.trim() && !images.length)} onClick={send}>
                <Icon name="arrowRight" size={14} />
              </button>
            }
          />
        </div>
        {err && <div className="ai-err">{err}</div>}
      </div>
    </div>
  )
}
const same = (t: string) => t

// what will run, from its files: the fetch (or its script's text, or the one file), each action's command
type Runs = { fetch?: string; script?: [string, string]; actions: [string, string][]; stream?: boolean }
function runsOf(files: Record<string, string>): Runs {
  let m: any = {}
  try {
    m = JSON.parse(files['widget.json'] ?? '{}')
  } catch {}
  const one = !files['widget.json'] ? Object.entries(files)[0] : undefined // a one-file extension: the file is it
  const acts = Object.entries(m.actions && typeof m.actions === 'object' ? m.actions : {}).map(([k, v]: [string, any]) => [k, typeof v === 'string' ? v : typeof v?.ai === 'string' && v.run === undefined ? `an agent answers: ${v.ai}${v.tools ? ` (may use unasked: ${v.tools})` : ''}` : String(v?.run ?? '')] as [string, string])
  return { fetch: typeof m.fetch === 'string' ? m.fetch : undefined, script: m.script ? [m.script, files[m.script] ?? '(not found)'] : one, actions: acts, stream: m.stream === true }
}

// Try it live and Turn on: exactly what will run (its fetch or script, each action's command, a JS page's network),
// then one fetch while off (widgetRun once), or on
function TrySheet({ w, on, cfg, onClose, onRan, onOn }: { w: WidgetView; on: boolean; cfg: WidgetsApi; onClose: () => void; onRan: () => void; onOn: () => void }) {
  const [r, setR] = useState<Runs | null>(null)
  const [hash, setHash] = useState<string>() // its files as shown: Turn on holds only for them (widgetSet seen)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ai = w.source?.kind === 'ai' ? w.source : undefined // an agent runs, not its fetch
  useEffect(() => {
    daemon.call<{ files: Record<string, string>; hash?: string }>('widgetFiles', { id: w.id }).then(
      x => (setR(runsOf(x.files)), setHash(x.hash)),
      e => setErr(String(e?.message ?? e)),
    )
  }, [w.id, w.rev])
  const run = () => {
    setBusy(true)
    setErr('')
    cfg.tryOnce?.(w.id, w.here ?? undefined).then(
      x => (x.ok ? onRan() : setErr(x.error ?? 'it failed'), setBusy(false)),
      e => (setErr(String(e?.message ?? e)), setBusy(false)),
    )
  }
  const turnOn = () => void cfg.set(w.id, { on: true, seen: hash }).then(onOn, e => setErr(String(e?.message ?? e)))
  return (
    <Modal title={on ? `Turn on ${w.name}?` : `Try ${w.name} live?`} onClose={onClose}>
      <p className="muted small">{on ? 'From now on Laki runs this on its schedule, and its buttons run their commands, as you on this Mac.' : `${ai ? 'Its agent' : 'It'} runs once, now, as you on this Mac: the preview then shows what it really gets. Nothing else runs.`}</p>
      {!r ? (
        <p className="muted small">{err || 'Reading its files…'}</p>
      ) : (
        <div className="ext-ai-runs">
          {ai && (
            <>
              <b className="small">An agent, {ai.profile || extAgent(cfg)}, with your MCP servers{ai.tools ? `; it may use unasked: ${ai.tools}` : ''}</b>
              <pre className="mono">{ai.prompt}</pre>
            </>
          )}
          {r.fetch && !ai && (
            <>
              <b className="small">Its own script{r.stream ? ' (a stream: runs all along once on)' : ''}</b>
              <pre className="mono">{r.fetch}</pre>
            </>
          )}
          {r.script && (
            <>
              <b className="small">{r.script[0]}</b>
              <pre className="mono">{r.script[1].slice(0, 4000)}</pre>
            </>
          )}
          {!!r.actions.length && (
            <>
              <b className="small">Its actions (run when you click them{w.tools?.length ? ', or an agent calls one' : ''})</b>
              {r.actions.map(([k, c]) => (
                <pre key={k} className="mono">
                  {k}: {c}
                </pre>
              ))}
            </>
          )}
          {!r.fetch && !r.script && !ai && !r.actions.length && <p className="muted small">It runs nothing: what it shows is its own page.</p>}
          {w.js && (
            <Switch className="switch-row" on={!!w.net} onChange={net => void cfg.set(w.id, { net })}>
              <span>Network access: its page may fetch() from https sites</span>
            </Switch>
          )}
        </div>
      )}
      {err && r && <div className="ai-err">{err}</div>}
      <div className="ext-ai-btns">
        <button onClick={onClose}>Cancel</button>
        {on ? (
          <button className="primary" disabled={!r} onClick={turnOn}>
            Turn it on
          </button>
        ) : (
          <>
            {busy && w.agent && cfg.stop && (
              <button data-tip="Its agent's run ends now" onClick={() => void cfg.stop!(w.id).catch(() => {})}>
                Stop
              </button>
            )}
            <button className="primary" disabled={!r || busy || r.stream || w.every === undefined} data-tip={r?.stream ? 'A stream runs only once it is on' : undefined} onClick={run}>
              {busy ? 'Running…' : 'Run it once'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

// how it looks: in its first place (a cell of the sidebar's grid, a line of a bar, a button) and its full view, with
// its data or its sample; then its settings
const CELLS: [number, number][] = [
  [1, 0.5],
  [1, 1],
  [2, 1],
  [4, 1],
  [4, 2],
  [4, 4],
]
// as a Desk tile shows it: its full view when it has one (room for a long table or list), else its preview (sample: a fixture by name too)
function DeskTile({ w, api, sample, note }: { w: WidgetView; api: WidgetApi; sample: boolean | string; note?: string }) {
  return (
    <div className="desk-tile ext-desk">
      <div className="desk-head">
        <b>{w.name}</b>
        <span className="muted small">{note ?? (sample ? 'made-up data' : status(w, true) || (w.on ? 'live' : 'off'))}</span>
      </div>
      <div className="desk-body">{w.button && !w.full ? <CellButton w={w} api={api} /> : <WidgetBody key={`${sample}desk`} w={w} full={!!w.full} api={api} sample={sample} />}</div>
    </div>
  )
}

function Preview({ w, api, cfg, pick, setPick, spot = 0, field }: { w: WidgetView; api: WidgetApi; cfg: WidgetsApi; pick: Pick; setPick: (p: Pick) => void; spot?: number; field?: string }) {
  // Edit: its settings scrolled to, lit (Settings' spot) and its first field focused
  const form = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = form.current
    if (!spot || !el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.remove('spot')
    void el.offsetWidth // the animation again on a second click
    el.classList.add('spot')
    const at = field ? el.querySelector(`[data-key="${CSS.escape(field)}"]`) : null
    ;(at ?? el).querySelector<HTMLElement>('input, select, textarea, button[role="tab"], button[role="switch"]')?.focus({ preventScroll: true })
    const t = setTimeout(() => el.classList.remove('spot'), 2700)
    return () => clearTimeout(t)
  }, [spot])
  const [cell, setCell] = useState<[number, number]>(w.size) // Everywhere's sidebar cell: any size, its own not changed
  // made-up data: widget.json's sample, or one of its fixtures (busy, empty…) by name
  const variants = w.fixtures ?? []
  const has = !!w.sample || !!variants.length
  const [variant, setVariant] = useState('')
  const v = variant && variants.includes(variant) ? variant : w.sample ? '' : (variants[0] ?? '')
  const sample = (pick ?? (has && (!w.on || (w.every !== undefined && !w.at)) ? 'sample' : 'live')) === 'sample' && has
  const made: boolean | string = sample && (v || true)
  const place = placesOf(w)[0] ?? 'side'
  const bar = place === 'top' || place === 'status'
  const desk = place === 'desk' || place === 'panel' // a tile there (a right panel's tab: as wide): its full view when it has one
  const row = place === 'row' // its mark on a row: its instance's badge
  const button = w.button || place === 'rail' || place === 'foot'
  return (
    <>
      {w.byAi && !w.on && (
        <div className="ext-note">
          <Icon name="ai" />
          <span className="grow">Laki AI wrote it, so it's off: its own script is a command a model wrote. Turn on (at the top) shows what it runs first.</span>
          {cfg.folder && <button onClick={e => cfg.folder!(w.id, e)}>Its folder</button>}
        </div>
      )}
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Preview</b>
          <span className={`small ${w.error && !w.running && !sample ? 'warn' : 'muted'}`}>{sample ? 'made-up data' : status(w, true) || (w.on ? 'live' : 'off')}</span>
          <span className="grow" />
          {w.on && w.every !== undefined && !sample && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && w.here !== null && void api.run(w.id, w.here ?? undefined).catch(() => {})} />}
          <div className="seg" role="tablist" aria-label="Its data">
            <button role="tab" aria-selected={!sample} className={!sample ? 'on' : ''} onClick={() => setPick('live')}>
              Live
            </button>
            <button role="tab" aria-selected={sample} className={sample ? 'on' : ''} disabled={!has} data-tip={has ? 'With made-up data: widget.json’s sample, or a fixture' : 'It has no sample in widget.json, nor fixtures'} onClick={() => setPick('sample')}>
              Sample
            </button>
          </div>
          {sample && variants.length > 0 && (
            <select className="sm" value={v} aria-label="Which made-up data" data-tip="Which made-up data: widget.json’s sample, or fixtures/<name>.json" onChange={e => setVariant(e.target.value)}>
              {w.sample && <option value="">widget.json’s sample</option>}
              {variants.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="ext-stage">
          <span className="ext-where muted small">
            {WHERE[place] ?? place}
            {!button && !desk && !row && ` · ${w.size[0]}×${half(w.size[1])}`}
          </span>
          {row ? (
            <div className="ext-row">
              <span className="ws-ext">
                <Glyph w={w} size={10} />
                {(i => i?.badge ?? i?.label ?? w.badge ?? w.label ?? '—')(w.here ? w.inst?.[w.here] : undefined)}
              </span>
              <span className="muted small">{w.badge || w.label ? 'its badge, filled from each workspace’s data' : 'no badge or label in widget.json: nothing shows'}</span>
            </div>
          ) : button ? (
            <div className="ext-button">
              <CellButton w={w} api={api} />
            </div>
          ) : (
            <div className={`widget ext-tile ${bar ? 'in-bar' : ''}`} style={bar ? { width: `calc(${w.size[0]} * var(--widget-cell, 92px))` } : place === 'panel' ? { width: 320, height: 300 } : desk ? { width: 400, height: 260 } : { width: w.size[0] * CELL_W, height: w.size[1] * 64 }}>
              <WidgetBody key={`${made}`} w={w} full={desk && !!w.full} api={api} sample={made} cells={bar ? [w.size[0], 0.5] : desk ? [3, 4] : w.size} />
            </div>
          )}
        </div>
        {w.full && (
          <>
            <div className="ext-card-head sub">
              <b>Full view</b>
              <span className="muted small">a click away · {w.view === 's' ? 'small' : w.view === 'l' ? 'large' : 'medium'}</span>
            </div>
            <div className={`ext-full ${w.view ?? 'm'}`}>
              <WidgetBody key={`${made}`} w={w} full api={api} sample={made} />
            </div>
          </>
        )}
      </section>
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Everywhere</b>
          <span className="muted small grow">how it looks in each place{sample ? ', with made-up data' : ''}</span>
          <div className="seg" role="tablist" aria-label="Its size in the sidebar">
            {CELLS.map(c => (
              <button key={c.join()} role="tab" aria-selected={cell.join() === c.join()} className={cell.join() === c.join() ? 'on' : ''} onClick={() => setCell(c)}>
                {c[0]}×{half(c[1])}
              </button>
            ))}
          </div>
        </div>
        <div className="ext-stage ext-places">
          <div>
            <span className="muted small">Sidebar · {cell[0]}×{half(cell[1])}</span>
            <div className="widget ext-tile" style={{ width: cell[0] * CELL_W, height: cell[1] * 64 }}>
              {w.button ? <CellButton w={w} api={api} /> : <WidgetBody key={`${made}`} w={w} full={false} api={api} sample={made} cells={cell} />}
            </div>
          </div>
          {(['Top bar', 'Status bar'] as const).map(where => (
            <div key={where}>
              <span className="muted small">{where}</span>
              <div className="widget ext-tile in-bar" style={{ width: `calc(${w.size[0]} * var(--widget-cell, 92px))` }}>
                {w.button ? <CellButton w={w} api={api} /> : <WidgetBody key={`${made}`} w={w} full={false} api={api} sample={made} cells={[w.size[0], 0.5]} />}
              </div>
            </div>
          ))}
          <div>
            <span className="muted small">Rail or foot button</span>
            <div className="ext-button">
              <CellButton w={w} api={api} />
            </div>
            <span className="muted small">tip: {w.tip ?? w.name}</span>
          </div>
          <div className="ext-desk-spot">
            <span className="muted small">My Desk tile · {w.full ? 'its full view' : 'its preview'}, room for a long table or list</span>
            <DeskTile w={w} api={api} sample={made} note={sample ? 'made-up data' : undefined} />
          </div>
        </div>
      </section>
      <section className="ext-card" ref={form}>
        <div className="ext-card-head">
          <b>Settings</b>
          <span className="muted small">saved as you change them</span>
        </div>
        <WidgetCard w={w} api={cfg} />
      </section>
    </>
  )
}

// the inspector's head: its tabs, Run now and Reload, a dot while laki widget dev watches it, and why its files don't
// read now (the last good version runs on); on a phone the tabs and buttons are one ⋯ menu (.ext-more)
function InspectHead({ w, cfg, tab, setTab, spots, setAt }: { w: WidgetView; cfg: WidgetsApi; tab: ExtTab; setTab: (t: ExtTab) => void; spots: { id: string; name: string }[]; setAt: (ws: string) => void }) {
  const [menu, openMenu] = useMenu()
  const runNow = () => void cfg.run(w.id, w.here ?? undefined).catch(() => {})
  const more = () => [
    ...TABS.map(([t, label]) => ({ label, hint: tab === t ? ON : undefined, run: () => setTab(t) })),
    null,
    ...(w.every !== undefined && w.on && !w.running && w.here !== null ? [{ label: 'Run now', icon: 'refresh' as const, run: runNow }] : []),
    ...(w.agent && cfg.stop ? [{ label: 'Stop its agent', icon: 'stop' as const, run: () => void cfg.stop!(w.id).catch(() => {}) }] : []),
    { label: 'Reload', run: () => void cfg.reload().catch(() => {}) },
  ]
  return (
    <>
      {menu}
      <div className="ext-tabs">
        <button className="sm ext-more" aria-label="Its page: tabs and actions" onClick={e => openMenu(e, more())}>
          {TABS.find(([t]) => t === tab)?.[1]} <Icon name="more" size={12} />
        </button>
        <div className="seg" role="tablist" aria-label="Its page">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        {w.scope && (
          <select className="sm ext-ws" value={w.here ?? ''} aria-label="Whose instance" data-tip="Per workspace: whose instance this page shows, fetches and checks" onChange={e => setAt(e.target.value)}>
            {!w.here && <option value="">No workspace</option>}
            {spots.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {w.dev && (
          <span className="ext-watch small muted" data-tip="laki widget dev links its folder: a save reloads it">
            <i className="ext-watch-dot" /> watching
          </span>
        )}
        {w.mock && <span className="tag" data-tip="Data put there by hand: Live in Data fetches again">sample data: {w.mock}</span>}
        {w.every !== undefined && (
          <button className="sm ext-btn" disabled={!w.on || w.running || w.here === null} data-tip={w.here === null ? 'Per workspace: pick one' : w.on ? 'Fetch now' : 'Turn it on first'} onClick={runNow}>
            <Icon name="refresh" size={12} /> {w.running ? 'Fetching…' : 'Run now'}
          </button>
        )}
        {w.agent && cfg.stop && (
          <button className="sm ext-btn" data-tip="Its agent's run ends now: its last data stays" onClick={() => void cfg.stop!(w.id).catch(() => {})}>
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
        <button className="sm ext-btn" data-tip="Read every extension's folder again" onClick={() => void cfg.reload().catch(() => {})}>
          Reload
        </button>
      </div>
      {w.changed && !w.on && (
        <div className="ext-note bad">
          <Icon name="conflict" />
          <span className="grow">
            <b>Its files changed {w.repo ? `in ${w.repo}'s repo` : 'in the folder an agent linked'}:</b> off until you look at what it runs now
          </span>
          <button className="sm" onClick={() => void cfg.set(w.id, { on: true }).catch(() => {})}>
            Look…
          </button>
        </div>
      )}
      {w.devError && (
        <div className="ext-note bad">
          <Icon name="conflict" />
          <span className="grow">
            <b>Last good version kept:</b> <span className="mono">{w.devError}</span>
          </span>
        </div>
      )}
    </>
  )
}

// Logs: its log, the newest line at the bottom, following as lines come (read from its cursor every 2 s); filtered by
// level (at least), where it came from, words, and whose (a per-workspace one); Copy, Clear, Show in Finder. Off: what
// it kept before, dimmed, and the switch
function Logs({ w, cfg, spots, copy }: { w: WidgetView; cfg: WidgetsApi; spots: { id: string; name: string }[]; copy: (t: string) => void }) {
  const [lines, setLines] = useState<WidgetLogLine[]>([])
  const [on, setOn] = useState(true)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState('')
  const [src, setSrc] = useState('')
  const [q, setQ] = useState('')
  const [ws, setWs] = useState('')
  const next = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // at the bottom: it stays there as lines come
  const [read, setRead] = useState(0)
  useEffect(() => {
    let live = true
    let reading = false // one read at a time: two from the same cursor would show its lines twice
    next.current = 0
    setLines([])
    const get = () =>
      !reading &&
      (reading = true) &&
      cfg.log?.read(w.id, { since: next.current, limit: 2000 }).finally(() => (reading = false)).then(
        r => {
          if (!live) return
          setOn(r.on)
          setErr('')
          if (r.next < next.current) return void ((next.current = 0), setLines([])) // cleared: from the top next time
          next.current = r.next
          if (r.lines.length) setLines(l => [...l, ...r.lines].slice(-5000))
        },
        e => live && setErr(String(e?.message ?? e)),
      )
    void get()
    const t = setInterval(get, 2000)
    return () => ((live = false), clearInterval(t))
  }, [w.id, read])
  useLayoutEffect(() => void (box.current && stick.current && (box.current.scrollTop = box.current.scrollHeight)), [lines, level, src, q, ws])
  const min = (LOG_LEVELS as readonly string[]).indexOf(level)
  const words = q.trim().toLowerCase()
  const shown = lines.filter(l => (min < 0 || LOG_LEVELS.indexOf(l.level) >= min) && (!src || l.src === src || l.src.startsWith(`${src}:`)) && (!ws || l.ws === ws) && (!words || `${l.src} ${l.text}`.toLowerCase().includes(words)))
  const srcs = [...new Set(lines.map(l => l.src.split(':')[0]))].sort()
  const asText = (l: WidgetLogLine) => `${new Date(l.at).toISOString()} ${l.level} ${l.src}${l.ws ? ` (${l.ws})` : ''} ${l.text}`
  const name = (id?: string) => (id ? (spots.find(s => s.id === id)?.name ?? id) : '')
  const clear = async () => (await ask(`Clear ${w.name}'s log?`, { text: 'Every line it kept goes.', ok: 'Clear', danger: true })) && cfg.log?.clear(w.id).then(() => setRead(n => n + 1))
  return (
    <section className="ext-card">
      <div className="ext-card-head">
        <b>Logs</b>
        <span className="muted small">{on ? 'what it did, each run and its stderr, newest at the bottom' : 'off: nothing is kept'}</span>
        <span className="grow" />
        <button className="sm" disabled={!shown.length} onClick={() => copy(shown.map(asText).join('\n'))}>
          <Icon name="copy" size={12} /> Copy
        </button>
        <button className="sm" disabled={!lines.length} onClick={() => void clear()}>
          Clear
        </button>
        <button className="sm" data-tip="Its log file, in Finder" onClick={() => cfg.log?.reveal(w.id)}>
          <Icon name="folder" size={12} /> Show in Finder
        </button>
      </div>
      {!on && (
        <div className="ext-note">
          <span className="grow">
            <b>Logging is off.</b> {lines.length ? 'The lines below are from before.' : ''}
          </span>
          <Switch on={!!w.keepLog} onChange={log => void cfg.set(w.id, { log })}>
            Keep a log
          </Switch>
        </div>
      )}
      <div className="ext-log-bar">
        <select className="sm" value={level} aria-label="Level" onChange={e => setLevel(e.target.value)}>
          <option value="">Every level</option>
          {LOG_LEVELS.slice(1).map(l => (
            <option key={l} value={l}>
              {l} and up
            </option>
          ))}
        </select>
        <select className="sm" value={src} aria-label="From" onChange={e => setSrc(e.target.value)}>
          <option value="">From anything</option>
          {srcs.map(x => (
            <option key={x} value={x}>
              {x === 'laki' ? 'Laki' : x}
            </option>
          ))}
        </select>
        {w.scope && (
          <select className="sm" value={ws} aria-label="Whose" onChange={e => setWs(e.target.value)}>
            <option value="">Every workspace</option>
            {spots.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <input className="sm grow" type="search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <p className="warn small">{err}</p>}
      <div ref={box} className={`ext-log mono ${on ? '' : 'off'}`} onScroll={e => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 24)}>
        {!shown.length && <p className="muted small">{lines.length ? 'No line matches.' : on ? 'Nothing logged yet.' : 'No log kept.'}</p>}
        {shown.map(l => (
          <div key={l.n} className={`ext-log-line lv-${l.level}`}>
            <span className="muted">{hm(l.at)}</span> <b>{l.level}</b> <span className="muted">{l.src}{l.ws ? ` · ${name(l.ws)}` : ''}</span> {l.text}
          </div>
        ))}
      </div>
    </section>
  )
}

const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const bytes = (b: number) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1 << 20)).toFixed(1)} MB`)

// the inspector's tabs: Data (its JSON, editable: Apply keeps it as sample data; a fixture; Live), Runs (newest first,
// a click shows its stderr), Env (what a fetch is given, secrets masked), Files (and its folder). Read again as its
// data or files change, and every 2 s while Runs shows
function Inspector({ w, cfg, tab, draft, setDraft }: { w: WidgetView; cfg: WidgetsApi; tab: Exclude<ExtTab, 'overview' | 'check' | 'logs'>; draft: Draft | null; setDraft: (d: Draft | null) => void }) {
  const [x, setX] = useState<WidgetRuns | null>(null)
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [sel, setSel] = useState('')
  const [text, setText] = useState<string | null>(null) // Data's box as typed; null: as fetched
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [read, setRead] = useState(0) // its files again: a save
  useEffect(() => {
    if (tab !== 'runs') return
    const t = setInterval(() => setTick(n => n + 1), 2000)
    return () => clearInterval(t)
  }, [tab])
  useEffect(() => {
    let live = true
    if (w.here === null) return setX(null) // per workspace, none picked
    cfg.runs?.(w.id, w.here).then(r => live && setX(r), e => live && setErr(String(e?.message ?? e)))
    return () => void (live = false)
  }, [w.id, w.at, w.rev, w.mock, w.running, w.here, tab, tick])
  useEffect(() => {
    if (tab !== 'files' && tab !== 'data') return // Data's examples are its fixtures
    let live = true
    cfg.files?.(w.id).then(f => live && setFiles(f), () => live && setFiles({}))
    return () => void (live = false)
  }, [w.id, w.rev, tab, read])
  const apply = () => {
    let data: unknown
    try {
      data = JSON.parse(text ?? x?.data ?? 'null')
    } catch (e) {
      return setErr(`Not JSON: ${(e as Error).message}`)
    }
    setErr('')
    void cfg.mock?.(w.id, { data, ws: w.here ?? undefined }).then(() => setText(null), e => setErr(String(e?.message ?? e)))
  }
  if (!x) return <section className="ext-card muted small">{err || 'Reading…'}</section>
  if (tab === 'data')
    return (
      <>
        {w.source && (
          <section className="ext-card">
            <div className="ext-card-head">
              <b>Source</b>
              <span className="muted small">where its data comes from</span>
            </div>
            <SourceField w={w} api={cfg} />
          </section>
        )}
        <section className="ext-card">
          <div className="ext-card-head">
            <b>Data</b>
            <span className="muted small">{w.mock ? `made-up data (${w.mock}): not fetched until Live` : w.at ? `as fetched ${ago(w.at)}` : 'not fetched yet'}</span>
            <span className="grow" />
            <button className="sm" disabled={!w.mock} data-tip="Back to its source's data: read now" onClick={() => void cfg.mock?.(w.id, { off: true, ws: w.here ?? undefined }).then(() => setText(null))}>
              Live
            </button>
            <button className="sm primary" disabled={text === null} data-tip="Show it with this data (made-up, not fetched meanwhile)" onClick={apply}>
              Apply
            </button>
          </div>
          {x.big ? <p className="muted small">Over 256 KB: not shown here.</p> : <textarea className="ext-json mono" spellCheck={false} value={text ?? x.data ?? 'null'} onChange={e => setText(e.target.value)} />}
          {err && <p className="warn small">{err}</p>}
        </section>
        <Examples w={w} cfg={cfg} files={files} onShown={() => setText(null)} />
      </>
    )
  if (tab === 'runs')
    return (
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Runs</b>
          <span className="muted small">its last {x.runs.length} fetches and actions, newest first</span>
        </div>
        {x.stream && (
          <p className={`small ${x.stream.running ? '' : 'warn'}`}>
            {x.stream.stopped ? 'Stream stopped in Resources: Run now starts it again' : x.stream.running ? `Streaming since ${hm(x.stream.since ?? Date.now())}` : x.stream.next ? `Stream ended: again at ${hm(x.stream.next)}` : 'Stream not running: it runs while the window is open'}
            {x.stream.restarts ? ` · ${x.stream.restarts} restart${x.stream.restarts > 1 ? 's' : ''}` : ''}
            {x.stream.last && <span className="mono muted"> · last: {x.stream.last.slice(0, 120)}</span>}
          </p>
        )}
        {!x.runs.length && <p className="muted small">None yet{w.on ? '' : ': it is off'}.</p>}
        <ul className="ext-runs">
          {x.runs.map(r => (
            <li key={r.at + r.reason + (r.action ?? '')} className={r.ok ? '' : 'bad'}>
              <button className="ext-run" onClick={() => setOpen(o => (o === r.at ? null : r.at))} aria-expanded={open === r.at}>
                <span className="mono">{hm(r.at)}</span>
                <b>{r.action ? `action ${r.action}` : r.reason === 'stream' ? 'stream' : r.reason === 'push' ? 'push' : 'fetch'}</b>
                <span className={r.ok ? 'good' : 'warn'}>{r.ok ? 'ok' : `failed${r.exit ? ` (${r.exit})` : ''}`}</span>
                <span className="muted">{r.ms} ms</span>
                {r.ok && <span className="muted">{bytes(r.bytes)}</span>}
                <span className="muted grow">
                  {r.reason}
                  {r.why ? `: ${r.why}` : ''}
                </span>
              </button>
              {open === r.at && (
                <div className="ext-run-more">
                  {r.error && <p className="warn small">{r.error}</p>}
                  <pre className="mono">{r.stderr || '(nothing on stderr)'}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  if (tab === 'env')
    return (
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Env</b>
          <span className="muted small">what its own script and actions are given; a setting named like a token, key or password masked</span>
        </div>
        <dl className="ext-env mono">
          {Object.entries(x.env).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  return (
    <section className="ext-card">
      <div className="ext-card-head">
        <b>Files</b>
        <span className="muted small grow">{w.dir}</span>
        {cfg.folder && (
          <button className="sm" onClick={e => cfg.folder!(w.id, e)}>
            <Icon name="folder" size={12} /> Open folder
          </button>
        )}
      </div>
      {files === null ? (
        <p className="muted small">Reading…</p>
      ) : (
        <FileView w={w} cfg={cfg} files={files} sel={draft && Object.hasOwn(files, draft.path) ? draft.path : sel && Object.hasOwn(files, sel) ? sel : (Object.keys(files).find(f => f === 'widget.json') ?? Object.keys(files)[0] ?? '')} onSel={setSel} draft={draft} setDraft={setDraft} onSaved={() => setRead(n => n + 1)} />
      )}
      {!!x.fixtures.length && <p className="muted small">fixtures/: {x.fixtures.map(f => `${f}.json`).join(', ')}</p>}
    </section>
  )
}

// Data's examples: widget.json's sample and each fixtures/<name>.json, the made-up data it can be shown with: one's
// JSON, Show it with this (as made-up data until Live), Use as its source (a Static text)
function Examples({ w, cfg, files, onShown }: { w: WidgetView; cfg: WidgetsApi; files: Record<string, string> | null; onShown: () => void }) {
  const [pick, setPick] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('') // the example's key
  const all = useMemo(() => {
    const out: { key: string; label: string; text: string }[] = []
    try {
      const m = JSON.parse(files?.['widget.json'] ?? '{}')
      if (m.sample !== undefined) out.push({ key: '', label: 'widget.json’s sample', text: JSON.stringify(m.sample, null, 2) })
    } catch {}
    for (const [n, t] of Object.entries(files ?? {})) if (n.startsWith('fixtures/')) out.push({ key: n.slice(9, -5), label: n, text: t.trim() })
    return out
  }, [files])
  const one = all.find(e => e.key === pick) ?? all[0]
  const lines = useMemo(() => highlight('x.json', one?.text ?? ''), [one?.text])
  const show = () => {
    if (!one) return
    setErr('')
    let data: unknown
    if (one.key === '')
      try {
        data = JSON.parse(one.text)
      } catch {}
    void cfg.mock?.(w.id, { ...(one.key ? { fixture: one.key } : { data }), ws: w.here ?? undefined }).then(onShown, e => setErr(String(e?.message ?? e)))
  }
  return (
    <section className="ext-card">
      <div className="ext-card-head">
        <b>Examples</b>
        <span className="muted small">made-up data it can be shown with: its sample and fixtures/</span>
        <span className="grow" />
        {one && (
          <>
            <button className="sm" data-tip="Copy this JSON" onClick={() => void navigator.clipboard.writeText(one.text).then(() => (setCopied(one.key), setTimeout(() => setCopied(''), 1500)))}>
              <Icon name={copied === one.key ? 'check' : 'copy'} size={12} /> {copied === one.key ? 'Copied' : 'Copy'}
            </button>
            <button className="sm" disabled={!cfg.mock} data-tip="Show it with this (made-up data, not fetched until Live)" onClick={show}>
              Show it with this
            </button>
            <button className="sm" disabled={UNSHOWN.test(one.text)} data-tip="Its source becomes a Static text: this JSON" onClick={() => void cfg.set(w.id, { source: { kind: 'static', text: one.text } }).catch(e => setErr(String(e?.message ?? e)))}>
              Use as its data
            </button>
          </>
        )}
      </div>
      {files === null ? (
        <p className="muted small">Reading…</p>
      ) : !all.length ? (
        <p className="muted small">None: widget.json’s sample and files in fixtures/ (busy.json, empty.json…) show here. Edit them in Files.</p>
      ) : (
        <div className="ext-fv">
          <ul className="ext-files mono" role="listbox" aria-label="Its examples">
            {all.map(e => (
              <li key={e.key} role="option" aria-selected={e === one} className={e === one ? 'on' : ''} onClick={() => setPick(e.key)}>
                {e.key || 'widget.json sample'}
                {w.mock === (e.key || 'edited') && e.key && <span className="muted"> · shown</span>}
              </li>
            ))}
          </ul>
          <div className="ext-fv-body">
            <pre className="mono">
              {lines.map((l, i) => (
                <div key={i} className="pv-line">
                  <span className="pv-n">{i + 1}</span>
                  {l.length ? l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t)) : ' '}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
      {err && <p className="warn small">{err}</p>}
    </section>
  )
}

// its files: the list, and the picked one's text (colored; Markdown rendered). Edit: the text in a box (⌘S saves, Esc
// stops), saved as it is (widgetFileSave: refused when the file changed meanwhile, Save anyway; a .json one must parse);
// one that comes with Laki, or too big to show, is read-only
type Draft = { path: string; text: string; was: string }
const UNSHOWN = /^\((over 64 KB|binary): not shown\)$/ // widgetFiles' words for one it doesn't give
function FileView({ w, cfg, files, sel, onSel, draft, setDraft, onSaved }: { w: WidgetView; cfg: WidgetsApi; files: Record<string, string>; sel: string; onSel: (f: string) => void; draft: Draft | null; setDraft: (d: Draft | null) => void; onSaved: () => void }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const text = files[sel] ?? ''
  const md = /\.md$/i.test(sel)
  const lines = useMemo(() => (md ? [] : highlight(sel, text)), [sel, text, md])
  const edit = draft?.path === sel ? draft : null
  const dirty = !!edit && edit.text !== edit.was
  const why = w.builtin ? 'It comes with Laki: Remix it to change a copy' : w.repo ? `It's ${w.repo}'s (.laki/extensions): change it there, or Remix it` : UNSHOWN.test(text) ? 'Too big or not text: open its folder to edit it' : !cfg.save ? 'Not here' : ''
  const leave = async () => !dirty || (await ask('Discard your changes?', { text: `${sel} has changes you haven't saved.`, ok: 'Discard', danger: true }))
  const pick = async (f: string) => f !== sel && (await leave()) && (setDraft(null), setErr(''), onSel(f))
  const stop = async () => (await leave()) && (setDraft(null), setErr(''))
  const save = (force?: boolean) => {
    if (!edit || !cfg.save || busy) return
    setBusy(true)
    cfg.save(w.id, edit.path, edit.text, edit.was, force).then(
      () => (setDraft(null), setErr(''), onSaved()),
      e => setErr(String(e?.message ?? e)),
    ).finally(() => setBusy(false))
  }
  if (!Object.keys(files).length) return <p className="muted small">No files to show</p>
  return (
    <div className="ext-fv">
      <ul className="ext-files mono" role="listbox" aria-label="Its files">
        {Object.keys(files).map(f => (
          <li key={f} role="option" aria-selected={f === sel} className={f === sel ? 'on' : ''} onClick={() => void pick(f)}>
            {f}
            {draft?.path === f && draft.text !== draft.was && <span className="ext-fv-dot" aria-label="not saved"> ●</span>}
          </li>
        ))}
      </ul>
      <div className="ext-fv-main">
        <div className="ext-fv-bar">
          <span className="mono small grow">{sel}</span>
          {edit ? (
            <>
              <span className="muted small">{dirty ? 'not saved · ⌘S saves' : 'editing · Esc stops'}</span>
              <button className="sm" onClick={() => void stop()}>
                Cancel
              </button>
              <button className="sm primary" disabled={!dirty || busy} onClick={() => save()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (w.builtin || w.repo) && cfg.remix ? (
            <button className="sm" data-tip={`It comes with ${w.repo ? `${w.repo}'s repo` : 'Laki'}: a copy of it to change, yours`} onClick={() => void cfg.remix!(w.id).catch(e => setErr(String(e?.message ?? e)))}>
              <Icon name="copy" size={12} /> Remix it…
            </button>
          ) : (
            <button className="sm" disabled={!!why} data-tip={why || 'Edit it here: ⌘S saves'} onClick={() => (setDraft({ path: sel, text, was: text }), setErr(''))}>
              <Icon name="pencil" size={12} /> Edit
            </button>
          )}
        </div>
        {err && (
          <p className="warn small ext-fv-err">
            {err}
            {/changed since you opened it/.test(err) && (
              <button className="sm" onClick={() => save(true)}>
                Save anyway
              </button>
            )}
          </p>
        )}
        {edit ? (
          <textarea
            className="pv-edit ext-fv-edit"
            value={edit.text}
            wrap="off"
            spellCheck={false}
            autoFocus
            aria-label={`Edit ${sel}`}
            onChange={e => setDraft({ ...edit, text: e.target.value })}
            onKeyDown={e => {
              if (e.key === 's' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save())
              else if (e.key === 'Escape') (e.preventDefault(), void stop())
              else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                // a tab is two spaces here, as widget.json's are
                e.preventDefault()
                document.execCommand('insertText', false, '  ')
              }
            }}
          />
        ) : (
          <div className="ext-fv-body">
            {md ? (
              <Markdown src={text} />
            ) : (
              <pre className="mono">
                {lines.map((l, i) => (
                  <div key={i} className="pv-line">
                    <span className="pv-n">{i + 1}</span>
                    {l.length ? l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t)) : ' '}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Check (laki widget check): widget.json, its templates, its ui against its sample and fixtures, read again as its files
// change; Check with a fetch runs it once (never one Laki AI wrote while it's off)
const MARK = { ok: '✓', warn: '!', error: '✗' }
function Check({ w, cfg }: { w: WidgetView; cfg: WidgetsApi }) {
  const [r, setR] = useState<{ problems: UiProblem[]; run: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = (run: boolean) => {
    setBusy(true)
    cfg.check?.(w.id, run, w.here ?? undefined).then(
      x => (setR({ ...x, run }), setErr('')),
      e => setErr(String(e?.message ?? e)),
    ).finally(() => setBusy(false))
  }
  useEffect(() => go(false), [w.id, w.rev, w.here])
  const n = (l: UiProblem['level']) => r?.problems.filter(p => p.level === l).length ?? 0
  const aiOff = w.byAi && !w.on
  return (
    <section className="ext-card">
      <div className="ext-card-head">
        <b>Check</b>
        <span className="muted small grow">{r ? `${n('error')} errors, ${n('warn')} hints${r.run ? ', run once' : ''}` : 'Checking…'}</span>
        <button className="sm" disabled={busy} onClick={() => go(false)}>
          Check again
        </button>
        {w.every !== undefined && (
          <button className="sm" disabled={busy || aiOff} data-tip={aiOff ? 'Laki AI wrote it: turn it on first' : 'Get its data once and check its ui against it'} onClick={() => go(true)}>
            <Icon name="refresh" size={12} /> Check with a fetch
          </button>
        )}
      </div>
      {err && <p className="warn small">{err}</p>}
      <ul className="ext-check">
        {r?.problems.map((p, i) => (
          <li key={i} data-level={p.level}>
            <span className="ext-mark">{MARK[p.level]}</span>
            <span className="mono">{p.where}</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        In a terminal: <span className="mono">laki widget check {w.id}</span> (<span className="mono">--no-run</span>: without running it)
      </p>
    </section>
  )
}

// New extension: what happens, and the prompt for any other AI chat
function Start({ ai, home, onAiSettings }: { ai: boolean; home?: string; onAiSettings: () => void }) {
  const [want, setWant] = useState('')
  const [copied, setCopied] = useState(false)
  const text = widgetPrompt(want, (home ?? '').replace(/^\/Users\/[^/]+(?=\/|$)/, '~')) // ~, not your account's name, to a chat elsewhere
  const copy = () => navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))
  const steps: [string, string][] = [
    ['Describe it', ai ? 'In the chat: what it shows and where its data comes from.' : 'Turn Laki AI on, then describe it in the chat here.'],
    ['Answer what it asks', "Only what it can't tell from what you said: where its data comes from, what it shows."],
    ['Look at it', 'It shows on this page with made-up data, its settings below it.'],
    ['Turn it on, or ask for changes', "It's saved off: you look first. Ask again until you like it."],
  ]
  return (
    <>
      <section className="ext-card ext-start">
        <span className="ext-start-mark">
          <Icon name="panel" size={22} />
        </span>
        <h2>New extension</h2>
        <p className="muted">A small live page in Laki: in the sidebar, a bar, on the rail or My Desk, fed by a command or a script on a schedule.</p>
        <ol className="ext-steps">
          {steps.map(([t, s], i) => (
            <li key={t}>
              <span className="ext-step-n">{i + 1}</span>
              <span>
                <b>{t}</b>
                <span className="muted small">{s}</span>
              </span>
            </li>
          ))}
        </ol>
        {!ai && (
          <button className="primary" onClick={onAiSettings}>
            <Icon name="ai" /> Turn on Laki AI
          </button>
        )}
      </section>
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Or with any AI chat</b>
          <span className="muted small">the prompt: what you want, then how an extension is made</span>
        </div>
        <input value={want} onChange={e => setWant(e.target.value)} placeholder="What should it show? e.g. open Sentry issues of my project, by count" />
        <div className="row">
          <button type="button" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy the prompt'}
          </button>
          <span className="muted small grow">Then save the files it gives you in Laki's folder (Settings › Extensions › Folders) and press Reload there.</span>
        </div>
      </section>
    </>
  )
}
