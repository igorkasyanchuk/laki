// An extension's own page (Settings › Extensions' rows and New extension, a widget's ⚙ and right click, the Desk's
// tiles, laki://settings/widgets/<id>/inspect): how it looks (live, or with widget.json's sample: made-up data), in its
// place and as its full view, its settings, and Laki AI's chat beside them to make or change it; the inspector's tabs
// (Data, Runs, Env, Files, Check) beside Overview; closing goes back where it was opened from. id '': a new one, which the
// page follows once Laki AI writes it. App.tsx passes the Settings' WidgetsApi and the widgets' WidgetApi.
import { useEffect, useMemo, useRef, useState } from 'react'
import { type AiSettings, placesOf, type WidgetRuns, type WidgetView } from '../../shared/types'
import { ago } from '../../shared/widget'
import { widgetHere, widgetPrompt } from '../../shared/widgetGuide'
import type { UiProblem } from '../../shared/widgetUi'
import { AiPage } from './Ai'
import { highlight } from './highlight'
import { Markdown } from './MarkdownView'
import { WidgetCard, type WidgetsApi } from './Settings'
import { escapes, Icon, IconButton, Page } from './ui'
import { CellButton, inWs, status, type WidgetApi, WidgetBody } from './Widgets'

export const WHERE: Record<string, string> = { side: 'In the sidebar', top: 'In the top bar', status: 'In the status bar', rail: 'On the rail', foot: "In the sidebar's foot", desk: 'On the Desk' }
export const half = (d: number) => (d === 0.5 ? '½' : String(d))

export type ExtTab = 'overview' | 'data' | 'runs' | 'env' | 'files' | 'check'
const TABS: [ExtTab, string][] = [
  ['overview', 'Overview'],
  ['data', 'Data'],
  ['runs', 'Runs'],
  ['env', 'Env'],
  ['files', 'Files'],
  ['check', 'Check'],
]

// spots, here: the workspaces a per-workspace one has an instance in (live, no terminal, browser or SSH host), the one on
// screen (the picker's first)
export function ExtensionPage({ id, tab: first, widgets, cfg, api, ai, workspaces, spots, here, back, onAiSettings, onClose }: { id: string; tab?: ExtTab; widgets: WidgetView[]; cfg: WidgetsApi; api: WidgetApi; ai?: AiSettings; workspaces: { id: string; name: string }[]; spots: { id: string; name: string }[]; here: string | null; back: string; onAiSettings: () => void; onClose: () => void }) {
  const [cur, setCur] = useState(id)
  const [tab, setTab] = useState<ExtTab>(first ?? 'overview')
  // New extension: the first one that shows up meanwhile is the one Laki AI made
  const known = useRef(new Set(widgets.map(w => w.id)))
  const made = cur ? undefined : widgets.find(w => !known.current.has(w.id))
  useEffect(() => void (made && setCur(made.id)), [made?.id])
  const [at, setAt] = useState(here ?? spots[0]?.id ?? null) // a per-workspace one: whose instance
  const w = (x => x && inWs(x, spots.some(s => s.id === at) ? at : null))(widgets.find(x => x.id === cur))
  const seen = useRef(false) // one just made (New ▾) comes with the next view
  if (w) seen.current = true
  useEffect(() => void (cur && !w && seen.current && onClose()), [cur, !w]) // deleted meanwhile
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Esc goes back, unless a menu or a dialog has it or the focused box has something typed (it stays)
  useEffect(() => {
    const typed = (el: Element | null) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? !!el.value.trim() : !!(el as HTMLElement | null)?.isContentEditable)
    const f = (e: KeyboardEvent) => escapes(e) && !typed(document.activeElement) && !document.activeElement?.closest('select, .overlay, .menu') && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const mine = !!w && !w.builtin && !!cfg.home && w.dir === `${cfg.home}/${w.id}`
  // each ask says which extension this is; one of yours, Laki AI may rewrite (widgetSet ai: an hour's leave)
  const context = async () => {
    if (w && mine) await cfg.set(w.id, { ai: true }).catch(() => {})
    return widgetHere(w && { id: w.id, name: w.name, mine })
  }
  const name = w?.name ?? (cur ? cur : 'New extension')
  return (
    <Page
      title={name}
      wide
      esc={false} /* Esc: ours, above (a field keeps it) */
      onClose={onClose}
      head={
        <nav className="crumbs" aria-label="Where you are">
          <button className="crumb" onClick={onClose}>
            <Icon name="chevronLeft" size={12} /> {back}
          </button>
          <span className="muted">›</span>
          <b className="crumb here">{name}</b>
        </nav>
      }
    >
      <div className="ext">
        <div className="ext-main">
          {w ? (
            <>
              <InspectHead w={w} cfg={cfg} tab={tab} setTab={setTab} spots={spots} setAt={setAt} />
              {tab === 'overview' ? <Preview w={w} api={api} cfg={cfg} /> : tab === 'check' ? <Check w={w} cfg={cfg} /> : <Inspector w={w} cfg={cfg} tab={tab} />}
            </>
          ) : cur ? (
            <p className="muted small">Reading…</p>
          ) : (
            <Start ai={!!ai?.on} home={cfg.home} onAiSettings={onAiSettings} />
          )}
        </div>
        <aside className="ext-chat" aria-label="Laki AI">
          {ai?.on ? (
            <AiPage
              compact
              embed
              settings={ai}
              workspaces={workspaces}
              onClose={onClose}
              context={context}
              hello={
                w
                  ? {
                      title: mine ? `Change ${w.name}` : `Ask about ${w.name}`,
                      text: mine ? 'Say what to change: Laki AI rewrites it, and the preview shows it with its sample data. It stays off until you turn it on.' : "It comes with Laki or lives in a folder of yours: Laki AI makes a copy of it to change.",
                      examples: mine ? ['Show the count in red when it is over 10', 'Add a refresh button to the full view', 'Make the full view a table with sorting'] : ['Make me a copy of it I can change'],
                      placeholder: `What should change in ${w.name}?`,
                    }
                  : {
                      title: 'What should it show?',
                      text: 'Describe it: Laki AI asks a few questions, then writes it. It shows here with made-up data, off until you turn it on.',
                      examples: ['My open Sentry issues, by count', 'Open PRs waiting for my review', "Today's calendar events", 'A world clock for my team'],
                      placeholder: 'Describe the extension…',
                    }
              }
            />
          ) : (
            <div className="ext-ai-off">
              <Icon name="ai" size={22} />
              <b>Laki AI makes and changes extensions here</b>
              <p className="muted small">Turn it on to describe one and iterate on it beside its preview.</p>
              <button className="primary" onClick={onAiSettings}>
                Turn on Laki AI
              </button>
            </div>
          )}
        </aside>
      </div>
    </Page>
  )
}

// how it looks: in its first place (a cell of the sidebar's grid, a line of a bar, a button) and its full view, with
// its data or its sample; then its settings
export const CELLS: [number, number][] = [
  [1, 0.5],
  [1, 1],
  [2, 1],
  [3, 1],
  [3, 2],
  [3, 4],
]
function Preview({ w, api, cfg }: { w: WidgetView; api: WidgetApi; cfg: WidgetsApi }) {
  const [pick, setPick] = useState<'live' | 'sample'>()
  const [cell, setCell] = useState<[number, number]>(w.size) // Everywhere's sidebar cell: any size, its own not changed
  const sample = (pick ?? (w.sample && (!w.on || (w.every !== undefined && !w.at)) ? 'sample' : 'live')) === 'sample' && !!w.sample
  const place = placesOf(w)[0] ?? 'side'
  const bar = place === 'top' || place === 'status'
  const desk = place === 'desk' // a tile there: its full view when it has one, sized on the Desk
  const button = w.button || place === 'rail' || place === 'foot'
  return (
    <>
      {w.byAi && !w.on && (
        <div className="ext-note">
          <Icon name="ai" />
          <span className="grow">Laki AI wrote it, so it's off: its fetch is a command a model wrote. Look at its folder, then turn it on.</span>
          {cfg.folder && <button onClick={e => cfg.folder!(w.id, e)}>Its folder</button>}
          <button className="primary" onClick={() => void cfg.set(w.id, { on: true })}>
            Turn it on
          </button>
        </div>
      )}
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Preview</b>
          <span className={`small ${w.error && !w.running && !sample ? 'warn' : 'muted'}`}>{sample ? 'made-up data' : status(w) || (w.on ? 'live' : 'off')}</span>
          <span className="grow" />
          {w.on && w.every !== undefined && !sample && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && w.here !== null && void api.run(w.id, w.here ?? undefined).catch(() => {})} />}
          <div className="seg" role="tablist" aria-label="Its data">
            <button role="tab" aria-selected={!sample} className={!sample ? 'on' : ''} onClick={() => setPick('live')}>
              Live
            </button>
            <button role="tab" aria-selected={sample} className={sample ? 'on' : ''} disabled={!w.sample} data-tip={w.sample ? 'With the made-up data in widget.json' : 'It has no sample in widget.json'} onClick={() => setPick('sample')}>
              Sample
            </button>
          </div>
        </div>
        <div className="ext-stage">
          <span className="ext-where muted small">
            {WHERE[place] ?? place}
            {!button && !desk && ` · ${w.size[0]}×${half(w.size[1])}`}
          </span>
          {button ? (
            <div className="ext-button">
              <CellButton w={w} api={api} />
            </div>
          ) : (
            <div className={`widget ext-tile ${bar ? 'in-bar' : ''}`} style={bar ? { width: `calc(${w.size[0]} * var(--widget-cell, 92px))` } : desk ? { width: 400, height: 260 } : { width: w.size[0] * 92, height: w.size[1] * 64 }}>
              <WidgetBody key={`${sample}`} w={w} full={desk && !!w.full} api={api} sample={sample} cells={bar ? [w.size[0], 0.5] : desk ? [3, 4] : w.size} />
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
              <WidgetBody key={`${sample}`} w={w} full api={api} sample={sample} />
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
            <div className="widget ext-tile" style={{ width: cell[0] * 92, height: cell[1] * 64 }}>
              {w.button ? <CellButton w={w} api={api} /> : <WidgetBody key={`${sample}`} w={w} full={false} api={api} sample={sample} cells={cell} />}
            </div>
          </div>
          {(['Top bar', 'Status bar'] as const).map(where => (
            <div key={where}>
              <span className="muted small">{where}</span>
              <div className="widget ext-tile in-bar" style={{ width: `calc(${w.size[0]} * var(--widget-cell, 92px))` }}>
                {w.button ? <CellButton w={w} api={api} /> : <WidgetBody key={`${sample}`} w={w} full={false} api={api} sample={sample} cells={[w.size[0], 0.5]} />}
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
        </div>
      </section>
      <section className="ext-card">
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
// read now (the last good version runs on)
function InspectHead({ w, cfg, tab, setTab, spots, setAt }: { w: WidgetView; cfg: WidgetsApi; tab: ExtTab; setTab: (t: ExtTab) => void; spots: { id: string; name: string }[]; setAt: (ws: string) => void }) {
  return (
    <>
      <div className="ext-tabs">
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
          <button className="sm" disabled={!w.on || w.running || w.here === null} data-tip={w.here === null ? 'Per workspace: pick one' : w.on ? 'Fetch now' : 'Turn it on first'} onClick={() => void cfg.run(w.id, w.here ?? undefined).catch(() => {})}>
            <Icon name="refresh" size={12} /> {w.running ? 'Fetching…' : 'Run now'}
          </button>
        )}
        <button className="sm" data-tip="Read every extension's folder again" onClick={() => void cfg.reload().catch(() => {})}>
          Reload
        </button>
      </div>
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

const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const bytes = (b: number) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1 << 20)).toFixed(1)} MB`)

// the inspector's tabs: Data (its JSON, editable: Apply keeps it as sample data; a fixture; Live), Runs (newest first,
// a click shows its stderr), Env (what a fetch is given, secrets masked), Files (and its folder). Read again as its
// data or files change, and every 2 s while Runs shows
export function Inspector({ w, cfg, tab }: { w: WidgetView; cfg: WidgetsApi; tab: Exclude<ExtTab, 'overview' | 'check'> }) {
  const [x, setX] = useState<WidgetRuns | null>(null)
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [sel, setSel] = useState('')
  const [text, setText] = useState<string | null>(null) // Data's box as typed; null: as fetched
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
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
    if (tab !== 'files') return
    let live = true
    cfg.files?.(w.id).then(f => live && setFiles(f), () => live && setFiles({}))
    return () => void (live = false)
  }, [w.id, w.rev, tab])
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
      <section className="ext-card">
        <div className="ext-card-head">
          <b>Data</b>
          <span className="muted small">{w.mock ? `sample data (${w.mock}): not fetched until Live` : w.at ? `as fetched ${ago(w.at)}` : 'not fetched yet'}</span>
          <span className="grow" />
          {!!x.fixtures.length && (
            <select className="sm" value="" aria-label="A fixture" onChange={e => e.target.value && void cfg.mock?.(w.id, { fixture: e.target.value, ws: w.here ?? undefined }).then(() => setText(null), er => setErr(String(er?.message ?? er)))}>
              <option value="">Sample ▾</option>
              {x.fixtures.map(f => (
                <option key={f} value={f}>
                  fixtures/{f}.json
                </option>
              ))}
            </select>
          )}
          <button className="sm" disabled={!w.mock} data-tip="Back to its fetch's data: fetched now" onClick={() => void cfg.mock?.(w.id, { off: true, ws: w.here ?? undefined }).then(() => setText(null))}>
            Live
          </button>
          <button className="sm primary" disabled={text === null} data-tip="Show it with this data (sample data, not fetched meanwhile)" onClick={apply}>
            Apply
          </button>
        </div>
        {x.big ? <p className="muted small">Over 256 KB: not shown here.</p> : <textarea className="ext-json mono" spellCheck={false} value={text ?? x.data ?? 'null'} onChange={e => setText(e.target.value)} />}
        {err && <p className="warn small">{err}</p>}
      </section>
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
          <span className="muted small">what its fetch and actions are given; a setting named like a token, key or password masked</span>
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
        <FileView files={files} sel={sel && Object.hasOwn(files, sel) ? sel : (Object.keys(files).find(f => f === 'widget.json') ?? Object.keys(files)[0] ?? '')} onSel={setSel} />
      )}
      {!!x.fixtures.length && <p className="muted small">fixtures/: {x.fixtures.map(f => `${f}.json`).join(', ')}</p>}
    </section>
  )
}

// its files: the list, and the picked one's text (colored; Markdown rendered), read-only: an editor or the studio changes them
function FileView({ files, sel, onSel }: { files: Record<string, string>; sel: string; onSel: (f: string) => void }) {
  const text = files[sel] ?? ''
  const md = /\.md$/i.test(sel)
  const lines = useMemo(() => (md ? [] : highlight(sel, text)), [sel, text, md])
  if (!Object.keys(files).length) return <p className="muted small">No files to show</p>
  return (
    <div className="ext-fv">
      <ul className="ext-files mono" role="listbox" aria-label="Its files">
        {Object.keys(files).map(f => (
          <li key={f} role="option" aria-selected={f === sel} className={f === sel ? 'on' : ''} onClick={() => onSel(f)}>
            {f}
          </li>
        ))}
      </ul>
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
    </div>
  )
}

// Check (laki widget check): widget.json, its templates, its ui against its sample and fixtures, read again as its files
// change; Check with a fetch runs it once (never one Laki AI wrote while it's off)
const MARK = { ok: '✓', warn: '!', error: '✗' }
export function Check({ w, cfg }: { w: WidgetView; cfg: WidgetsApi }) {
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
        <span className="muted small grow">{r ? `${n('error')} errors, ${n('warn')} hints${r.run ? ', its fetch run' : ''}` : 'Checking…'}</span>
        <button className="sm" disabled={busy} onClick={() => go(false)}>
          Check again
        </button>
        {w.every !== undefined && (
          <button className="sm" disabled={busy || aiOff} data-tip={aiOff ? 'Laki AI wrote it: turn it on first' : 'Run its fetch once and check its ui against what it prints'} onClick={() => go(true)}>
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
        In a terminal: <span className="mono">laki widget check {w.id}</span> (<span className="mono">--no-run</span>: without its fetch)
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
    ['Answer a few questions', 'Where it sits, what a click does, how often it refreshes.'],
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
        <p className="muted">A small live page in Laki: in the sidebar, a bar, on the rail or the Desk, fed by a command or a script on a schedule.</p>
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
