// An extension's own page (Settings › Extensions' rows and New extension, a widget's ⚙, the Desk's tiles): how it
// looks (live, or with widget.json's sample: made-up data), in its place and as its full view, its settings, and Laki
// AI's chat beside them to make or change it; closing goes back where it was opened from. id '': a new one, which the
// page follows once Laki AI writes it. App.tsx passes the Settings' WidgetsApi and the widgets' WidgetApi.
import { useEffect, useRef, useState } from 'react'
import { type AiSettings, placesOf, type WidgetView } from '../../shared/types'
import { widgetHere, widgetPrompt } from '../../shared/widgetGuide'
import { AiPage } from './Ai'
import { WidgetCard, type WidgetsApi } from './Settings'
import { escapes, Icon, IconButton, Page } from './ui'
import { CellButton, status, type WidgetApi, WidgetBody } from './Widgets'

const WHERE: Record<string, string> = { side: 'In the sidebar', top: 'In the top bar', status: 'In the status bar', rail: 'On the rail', foot: "In the sidebar's foot", desk: 'On the Desk' }
const half = (d: number) => (d === 0.5 ? '½' : String(d))

export function ExtensionPage({ id, widgets, cfg, api, ai, workspaces, back, onAiSettings, onClose }: { id: string; widgets: WidgetView[]; cfg: WidgetsApi; api: WidgetApi; ai?: AiSettings; workspaces: { id: string; name: string }[]; back: string; onAiSettings: () => void; onClose: () => void }) {
  const [cur, setCur] = useState(id)
  // New extension: the first one that shows up meanwhile is the one Laki AI made
  const known = useRef(new Set(widgets.map(w => w.id)))
  const made = cur ? undefined : widgets.find(w => !known.current.has(w.id))
  useEffect(() => void (made && setCur(made.id)), [made?.id])
  const w = widgets.find(x => x.id === cur)
  useEffect(() => void (cur && !w && onClose()), [cur, !w]) // deleted meanwhile
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
        <div className="ext-main">{w ? <Preview w={w} api={api} cfg={cfg} /> : <Start ai={!!ai?.on} home={cfg.home} onAiSettings={onAiSettings} />}</div>
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
function Preview({ w, api, cfg }: { w: WidgetView; api: WidgetApi; cfg: WidgetsApi }) {
  const [pick, setPick] = useState<'live' | 'sample'>()
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
          {w.on && w.every !== undefined && !sample && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && void api.run(w.id).catch(() => {})} />}
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
            <div className={`widget ext-tile ${bar ? 'bar' : ''}`} style={bar ? { width: `calc(${w.size[0]} * var(--widget-cell, 92px))` } : desk ? { width: 400, height: 260 } : { width: w.size[0] * 92, height: w.size[1] * 64 }}>
              <WidgetBody key={`${sample}`} w={w} full={desk && !!w.full} api={api} sample={sample} />
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
          <b>Settings</b>
          <span className="muted small">saved as you change them</span>
        </div>
        <WidgetCard w={w} api={cfg} />
      </section>
    </>
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
