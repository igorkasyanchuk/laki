// The extension studio (Laki AI on: Settings › Extensions › New ▾ › Make with Laki AI, a row's Edit with Laki AI and
// Remix, ⌘K's New extension…, laki://settings/widgets/new and /<id>/studio): its chat (widget:<id>, ai.ts' aboutWidget)
// on the left; on the right its preview on sample data (fixtures/sample.json through widgetMock) over the inspector's
// Data, Runs, Check and Files. Nothing runs by itself: Try it live's sheet says what will, then runs its fetch once
// (widgetRun once); Turn on shows the same, then turns it on. Undo (and a turn's Undo to here) puts a version back.
// App.tsx lazy-loads it and passes Settings' WidgetsApi and the widgets' WidgetApi.
import { useEffect, useRef, useState } from 'react'
import { type AiMsg, placesOf, type WidgetView } from '../../shared/types'
import type { UiProblem } from '../../shared/widgetUi'
import { STARTER_KINDS, STARTERS } from '../../shared/widgetStarters'
import { Message, Tools, turns } from './Ai'
import { api as daemon, bridge } from './api'
import { CELLS, Check, DeskTile, half, Inspector, WHERE } from './Extension'
import { Modal } from './panels'
import { type Img, PromptInput } from './PromptInput'
import { extAgent, type WidgetsApi } from './Settings'
import { escapes, Icon, Page, Switch } from './ui'
import { CellButton, inWs, type WidgetApi, WidgetBody } from './Widgets'

type ChatData = { chat: AiMsg[]; busy: boolean; ended?: number; elsewhere?: boolean }
type Tab = 'preview' | 'data' | 'runs' | 'check' | 'files'
const TABS: [Tab, string][] = [
  ['preview', 'Preview'],
  ['data', 'Data'],
  ['runs', 'Runs'],
  ['check', 'Check'],
  ['files', 'Files'],
]
const EXAMPLES = ['My Vercel deploys', 'Linear issues assigned to me', 'A focus timer on the rail']
const SHOWN: [string, string][] = [
  ['side', 'Sidebar'],
  ['top', 'Top bar'],
  ['status', 'Status bar'],
  ['button', 'Button'],
  ['desk', 'Desk'],
]
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

export function WidgetStudio({ id, widgets, cfg, api, back, onClose }: { id: string; widgets: WidgetView[]; cfg: WidgetsApi; api: WidgetApi; back: string; onClose: () => void }) {
  const [cur, setCur] = useState(id)
  const w = (x => x && inWs(x, null))(widgets.find(x => x.id === cur)) // a per-workspace one: no workspace here, its sample's made-up one
  const mine = !!w && !w.builtin && !!cfg.home && w.dir === `${cfg.home}/${w.id}`
  const chat = cur ? `widget:${cur}` : ''
  const [tab, setTab] = useState<Tab>('preview')
  const [live, setLive] = useState(false) // after Try it live: its real data, until Back to sample
  const [noFixture, setNoFixture] = useState(false) // no fixtures/sample.json: widget.json's sample instead
  const [problems, setProblems] = useState<UiProblem[]>([])
  const [sheet, setSheet] = useState<'try' | 'on' | null>(null)
  const [oops, setOops] = useState('')
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Esc closes, unless a menu, a dialog or a box with something typed has it
  useEffect(() => {
    const typed = (el: Element | null) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? !!el.value.trim() : !!(el as HTMLElement | null)?.isContentEditable)
    const f = (e: KeyboardEvent) => escapes(e) && !typed(document.activeElement) && !document.activeElement?.closest('select, .overlay, .menu') && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  // sample data first, again after each write (its rev: a rewrite ends Try it live): the studio never fetches by itself
  const rev = useRef(w?.rev)
  useEffect(() => {
    if (w && rev.current !== w.rev) (rev.current = w.rev), setLive(false)
  }, [w?.rev])
  useEffect(() => {
    if (!w || live || w.scope || w.on) return // one that's on shows its live data: a mock would stay in the sidebar
    cfg.mock?.(w.id, { fixture: 'sample' }).then(
      () => setNoFixture(false),
      () => setNoFixture(true),
    )
  }, [w?.id, w?.rev, live])
  // its check (no run), as its files change: the head's chip, and the chat hears of it on its next ask
  useEffect(() => {
    if (!w) return setProblems([])
    let on = true
    cfg.check?.(w.id, false).then(r => on && setProblems(r.problems), () => {})
    return () => void (on = false)
  }, [w?.id, w?.rev])
  const errors = problems.filter(p => p.level === 'error').length
  // an ask: a new one's id from its first words; one of yours, Laki AI may rewrite (widgetSet ai: its hour's leave)
  const ask = async (text: string, images: string[] = []) => {
    setOops('')
    try {
      let at = cur
      if (!at) {
        at = (await daemon.call<{ id: string }>('widgetSlug', { text })).id
        setCur(at)
      }
      if (mine) await cfg.set(at, { ai: true })
      await daemon.call('aiAsk', { chat: `widget:${at}`, text, images })
      return true
    } catch (e) {
      setOops(String((e as Error)?.message ?? e))
      return false
    }
  }
  const undo = (after?: number) =>
    w &&
    cfg.undo?.(w.id, after).then(
      () => setLive(false),
      e => setOops(String(e?.message ?? e)),
    )
  const name = w?.name ?? (cur || 'New extension')
  return (
    <Page
      title={name}
      wide
      esc={false}
      onClose={onClose}
      head={
        <nav className="crumbs" aria-label="Where you are">
          <button className="crumb" onClick={onClose}>
            <Icon name="chevronLeft" size={12} /> {back}
          </button>
          <span className="muted">›</span>
          <b className="crumb here">{name}</b>
          <span className="studio-chips">
            {w && (live ? <span className="tag">live data</span> : <span className="tag" data-tip="Made-up data: fixtures/sample.json">sample data</span>)}
            {w && !w.on && <span className="tag">off</span>}
            {w?.byAi && <span className="tag" data-tip="Laki AI wrote it: look at what it runs before you turn it on">by Laki AI</span>}
            {errors > 0 && (
              <button className="tag tag-closed" onClick={() => setTab('check')}>
                {errors} {errors === 1 ? 'problem' : 'problems'}
              </button>
            )}
          </span>
        </nav>
      }
      tools={
        w && (
          <span className="studio-acts">
            <button className="sm" disabled={!w.history?.length} data-tip={w.history?.length ? 'Back to the version before the last change' : 'Nothing to undo yet'} onClick={() => void undo()}>
              Undo
            </button>
            {live ? (
              <button className="sm" onClick={() => setLive(false)}>
                Back to sample
              </button>
            ) : (
              <button className="sm" disabled={(w.every === undefined && !w.js) || !!w.scope} data-tip={w.scope ? 'Per workspace: turn it on, then look in a workspace' : 'See what it runs, then run it once: its real data here'} onClick={() => setSheet('try')}>
                Try it live
              </button>
            )}
            {!w.on && (
              <button className="sm primary" onClick={() => setSheet('on')}>
                Turn on
              </button>
            )}
          </span>
        )
      }
    >
      <div className="studio">
        <StudioChat chat={chat} w={w} mine={mine} ask={ask} undo={undo} err={oops} />
        <div className="studio-main">
          {w ? (
            <>
              <div className="ext-tabs">
                <div className="seg" role="tablist" aria-label="The studio">
                  {TABS.map(([t, label]) => (
                    <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {tab === 'preview' ? <StudioPreview w={w} api={api} sample={!live && (noFixture || !!w.scope)} /> : tab === 'check' ? <Check w={w} cfg={cfg} /> : <Inspector w={w} cfg={cfg} tab={tab} />}
            </>
          ) : (
            <div className="studio-empty muted">
              <Icon name="panel" size={28} />
              <p>{cur ? 'Laki AI is writing it: it shows here with made-up data as soon as it is saved.' : 'Say what it should show: it appears here with made-up data, off until you turn it on.'}</p>
            </div>
          )}
        </div>
      </div>
      {sheet && w && (
        <TrySheet
          w={w}
          on={sheet === 'on'}
          cfg={cfg}
          onClose={() => setSheet(null)}
          onRan={() => (setLive(true), setSheet(null), setTab('preview'))}
          onOn={stay => (setSheet(null), stay || onClose())}
        />
      )}
    </Page>
  )
}

// the chat: the thread (a turn's tools folded, with Undo to here once something was written after it), the composer;
// empty: the starters and three examples
function StudioChat({ chat, w, mine, ask, undo, err }: { chat: string; w?: WidgetView; mine: boolean; ask: (text: string, images?: string[]) => Promise<boolean>; undo: (after?: number) => void; err: string }) {
  const [d, setD] = useState<ChatData>()
  const [text, setText] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chat) return setD(undefined)
    const load = () => daemon.call<ChatData>('aiState', { chat }).then(setD, () => {})
    void load()
    return daemon.on(m => {
      if (m.ev === 'open') void load()
      else if (m.ev === 'ai' && m.of === chat) setD({ chat: m.chat, busy: m.busy, ended: m.ended })
    })
  }, [chat])
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [d?.chat.length, d?.busy])
  const busy = asking || !!d?.busy
  const go = (t: string, imgs: string[] = []) => {
    setAsking(true)
    return ask(t, imgs).finally(() => setAsking(false))
  }
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
  return (
    <aside className="studio-chat" aria-label="Laki AI">
      <div className="studio-thread" ref={thread} aria-live="polite">
        {!d?.chat.length ? (
          <div className="studio-hello">
            <Icon name="ai" size={22} />
            <b>{w ? (mine ? `Change ${w.name}` : `Ask about ${w.name}`) : 'What should it show?'}</b>
            <p className="muted small">{w ? 'Say what to change: Laki AI rewrites it, checks it, and the preview shows it with its sample data. Undo puts the last version back.' : 'Describe it, or start from a starter: Laki AI writes it with made-up data to look at. It stays off until you try it and turn it on.'}</p>
            {!w && (
              <div className="studio-starters">
                {STARTER_KINDS.map(k => (
                  <button key={k} className="nw-chip" disabled={busy} data-tip={STARTERS[k].blurb} onClick={() => void go(`Start from the "${STARTERS[k].title}" starter (${STARTERS[k].blurb}), then make it mine: ask me what it should show.`)}>
                    {STARTERS[k].title}
                  </button>
                ))}
              </div>
            )}
            {(w ? ['Show the count in red when it is over 10', 'Add a full view with a table'] : EXAMPLES).map(e => (
              <button key={e} className="studio-example" disabled={busy} onClick={() => void go(e)}>
                {e}
              </button>
            ))}
          </div>
        ) : (
          groups.map((g, i) => {
            if (!Array.isArray(g)) return <Message key={i} m={g} link={same} busy={busy || !!d.ended || (!!g.ask && !open.has(g.ask.id))} onPick={pick} />
            const at = g[g.length - 1].at
            const later = !d.busy && w?.history?.some(h => h > at)
            return (
              <div key={i} className="studio-turn">
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
      <div className="studio-dock">
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
            placeholder={w ? `What should change in ${w.name}?` : 'Describe the extension…'}
            tools={
              <button className="primary ai-send" aria-label="Ask (⏎)" data-tip="Ask (⏎) · ⇧⏎ a new line" disabled={busy || saving || (!text.trim() && !images.length)} onClick={send}>
                <Icon name="arrowRight" size={14} />
              </button>
            }
          />
        </div>
        {err && <div className="ai-err">{err}</div>}
      </div>
    </aside>
  )
}

// the preview: where it shows (a place to look at, its own not changed), its size there, the full view
function StudioPreview({ w, api, sample }: { w: WidgetView; api: WidgetApi; sample: boolean }) {
  const first = placesOf(w)[0] ?? 'side'
  const [where, setWhere] = useState(w.button || first === 'rail' || first === 'foot' ? 'button' : first)
  const [cell, setCell] = useState<[number, number]>(w.size)
  const bar = where === 'top' || where === 'status'
  return (
    <section className="ext-card">
      <div className="ext-card-head">
        <div className="seg" role="tablist" aria-label="Where to look at it">
          {SHOWN.map(([v, n]) => (
            <button key={v} role="tab" aria-selected={where === v} className={where === v ? 'on' : ''} onClick={() => setWhere(v)}>
              {n}
            </button>
          ))}
        </div>
        <span className="grow" />
        {where === 'side' && (
          <select className="sm" value={cell.join('x')} aria-label="Its size" onChange={e => setCell(e.target.value.split('x').map(Number) as [number, number])}>
            {CELLS.map(c => (
              <option key={c.join()} value={c.join('x')}>
                {c[0]}×{half(c[1])}
              </option>
            ))}
          </select>
        )}
        <span className="muted small">its place: {WHERE[first] ?? first}</span>
      </div>
      <div className="ext-stage">
        {where === 'button' ? (
          <div className="ext-button">
            <CellButton w={w} api={api} />
          </div>
        ) : where === 'desk' ? (
          <DeskTile w={w} api={api} sample={sample} />
        ) : (
          <div className={`widget ext-tile ${bar ? 'in-bar' : ''}`} style={bar ? { width: `calc(${w.size[0]} * var(--widget-cell, 92px))` } : { width: cell[0] * 92, height: cell[1] * 64 }}>
            <WidgetBody key={`${sample}${where}`} w={w} full={false} api={api} sample={sample} cells={bar ? [w.size[0], 0.5] : cell} />
          </div>
        )}
      </div>
      {w.full && where !== 'desk' && (
        <>
          <div className="ext-card-head sub">
            <b>Full view</b>
            <span className="muted small">a click away</span>
          </div>
          <div className={`ext-full ${w.view ?? 'm'}`}>
            <WidgetBody key={`${sample}`} w={w} full api={api} sample={sample} />
          </div>
        </>
      )}
    </section>
  )
}

// Try it live and Turn on: exactly what will run (its fetch or script, each action's command, a JS page's network),
// then one fetch while off (widgetRun once), or on
function TrySheet({ w, on, cfg, onClose, onRan, onOn }: { w: WidgetView; on: boolean; cfg: WidgetsApi; onClose: () => void; onRan: () => void; onOn: (stay: boolean) => void }) {
  const [r, setR] = useState<Runs | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [stay, setStay] = useState(false)
  const ai = w.source?.kind === 'ai' ? w.source : undefined // an agent runs, not its fetch
  useEffect(() => {
    daemon.call<{ files: Record<string, string> }>('widgetFiles', { id: w.id }).then(
      x => setR(runsOf(x.files)),
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
  // on: it fetches now (turning on drops the studio's sample data: widgetSet)
  const turnOn = () => void cfg.set(w.id, { on: true }).then(() => onOn(stay), e => setErr(String(e?.message ?? e)))
  return (
    <Modal title={on ? `Turn on ${w.name}?` : `Try ${w.name} live?`} onClose={onClose}>
      <p className="muted small">{on ? 'From now on Laki runs this on its schedule, and its buttons run their commands, as you on this Mac.' : `${ai ? 'Its agent' : 'It'} runs once, now, as you on this Mac: the preview then shows what it really gets. Nothing else runs.`}</p>
      {!r ? (
        <p className="muted small">{err || 'Reading its files…'}</p>
      ) : (
        <div className="studio-runs">
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
      <div className="studio-btns">
        {on && (
          <label className="ask-check small grow">
            <input type="checkbox" checked={stay} onChange={e => setStay(e.target.checked)} /> Stay in the studio
          </label>
        )}
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
