// Settings › Extensions: the list, each one's card (where it shows, updates, its settings, its tools) and Laki AI's
// extension chats where you left off. Settings.tsx re-exports it.
import { placesOf, type StudioChat, type WidgetHide, type WidgetLogLine, type WidgetOption, type WidgetPlace, type WidgetRuns, type WidgetSize, type WidgetSource, type WidgetView } from '../../shared/types'
import { STARTER_KINDS, type StarterKind } from '../../shared/widgetStarters'
import { ICONS } from '../../shared/icons'
import { UI_TYPES, type UiProblem } from '../../shared/widgetUi'
import { type KeyboardEvent as KeyEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Icon, IconButton, type MenuItem, ON, Switch, useMenu } from './ui'
import { Group, Says } from './SettingsKit'
import { ago } from '../../shared/widget'
import { StarterPicker } from './UiKit'
import { describeHours, parseHours } from '../../shared/when'

// Widgets (daemon/widgets.ts): a prompt to make one with any AI, the folders they're found in, Reload, and each one's
// switch, size, schedule, full view's size and settings
export type WidgetsApi = {
  list: WidgetView[]
  home?: string // Laki's own widgets folder
  set: (id: string, p: { on?: boolean; seen?: string; log?: boolean; size?: [number, number]; fit?: boolean; every?: number; view?: WidgetSize; place?: WidgetPlace | WidgetPlace[]; net?: boolean; hide?: WidgetHide; config?: Record<string, string>; ai?: boolean; source?: WidgetSource | null; name?: string; allow?: string[] }) => Promise<unknown> // seen: the files hash of what the user was shown (on only while it's that); ai: Laki AI may rewrite it (an hour); source: where its data comes from; name: widget.json's; allow: the tools its agent may use unasked
  desk?: boolean // Desk is on: a place too
  agents?: { name: string; agent: string }[] // the claude and codex profiles an AI source may run
  agent?: string // Settings › Extensions' pick of them (settings.widgetAgent)
  run: (id: string, ws?: string) => Promise<unknown> // ws: a per-workspace one's instance (WidgetView.here)
  stop?: (id: string) => Promise<unknown> // its agents' runs (an AI source's, an AI action's) stopped: WidgetView.agent
  rm?: (id: string) => Promise<unknown> // Delete: its folder and settings, to the trash (asked first; Undo brings it back)
  chats?: StudioChat[] // Laki AI's extension chats with nothing made yet, or at work: where you left off (Laki AI on)
  chatRm?: (id: string) => Promise<unknown> // a session let go of (asked first)
  reload: () => Promise<unknown>
  page: (id: string) => void // its own page (Extension.tsx): preview, settings, Laki AI's chat; '': a new one
  folder?: (id: string, e: MouseEvent<HTMLButtonElement>) => void // its folder's Open in menu
  logs?: (id: string) => void // its page's Logs tab
  allLogs?: boolean // settings.widgetLogs: every extension keeps a log
  log?: { read: (id: string, o: { since?: number; limit?: number; level?: string; src?: string; ws?: string }) => Promise<{ on: boolean; lines: WidgetLogLine[]; next: number }>; clear: (id: string) => Promise<unknown>; reveal: (id: string) => void } // its log: read from a cursor, Clear, Show in Finder
  kit?: (icons?: boolean) => void // the UI kit's page: its elements and their samples; icons: its icon gallery
  runs?: (id: string, ws?: string) => Promise<WidgetRuns> // the inspector's: its runs, env, fixtures
  mock?: (id: string, o: { data?: unknown; fixture?: string; off?: boolean; ws?: string }) => Promise<unknown> // sample data by hand, or Live again
  files?: (id: string) => Promise<Record<string, string>> // its folder's files: each one's text
  save?: (id: string, path: string, text: string, was: string, force?: boolean) => Promise<unknown> // one of them edited by hand (the page's Files)
  make?: (kind: StarterKind) => Promise<unknown> // New ▾'s starters (widgetNew): yours, on, its page opened
  check?: (id: string, run: boolean, ws?: string) => Promise<{ problems: UiProblem[] }> // the inspector's Check (run: its fetch once)
  revoke?: (id: string, action: string, ws: string) => Promise<unknown> // a tool's Always in a workspace taken back (widgetGrantRm)
  remix?: (id: string) => Promise<unknown> // a copy of any one, yours, opened on its page
  undo?: (id: string, after?: number) => Promise<unknown> // its page's Undo (after: a chat turn's Undo to here)
  tryOnce?: (id: string, ws?: string) => Promise<{ ok: boolean; error?: string }> // its page's Try it live: its fetch once while off
  wsName?: (ws: string) => string // a grant's workspace, by name ('': no workspace, Laki AI's)
}
const ASK_SAYS = { always: 'asks every time', first: 'asks once per workspace', never: 'runs without asking' }

const SIZES: [number, number][] = [0.5, 1, 2, 3, 4].flatMap(d => [1, 2, 3, 4].map(a => [a, d] as [number, number])) // ½ down: a thin line
// Auto: in the top or status bar, as wide as it needs (a JS page: as its page measures itself)
const fits = (w: WidgetView) => placesOf(w).some(p => p === 'top' || p === 'status')
const PLACES: [WidgetPlace, string, string][] = [
  ['side', 'Sidebar', 'In the sidebar, above its buttons'],
  ['top', 'Top bar', 'In the top bar, left of its buttons: a line high'],
  ['status', 'Status bar', "At the status bar's right end: a line high"],
  ['rail', 'Rail', 'A button on the rail, with its icons (no rail: the sidebar’s foot)'],
  ['foot', 'Sidebar foot', 'A button in the sidebar’s foot, beside Video, Meme and Timer'],
  ['desk', 'My Desk', 'A tile on the My Desk page, sized there'],
  ['panel', 'Right panel', 'A tab of the right panel (⌥⌘B), beside Info and Files'],
  ['row', 'Workspace rows', 'A mark on each workspace’s row in the sidebar: its badge (per workspace only)'],
]
const VIEWS: [WidgetSize, string][] = [
  ['s', 'Small'],
  ['m', 'Medium'],
  ['l', 'Large'],
]
const enter = (e: KeyEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

// a list setting (logins, labels): each item a chip; Enter, a comma or leaving the box adds what's typed, ⌫ in an
// empty box takes the last one back
export function ChipsInput({ value, onChange: save, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  // what was sent, until the daemon's view brings it back: a second chip added meanwhile keeps the first
  const [mine, setMine] = useState(value)
  useEffect(() => setMine(value), [value])
  const items = mine ? mine.split(',') : []
  const onChange = (v: string) => (setMine(v), save(v))
  const [draft, setDraft] = useState('')
  const add = (t: string) => {
    const more = [...new Set(t.split(/[,\n]/).map(x => x.trim()))].filter(x => x && !items.includes(x))
    setDraft('')
    if (more.length) onChange([...items, ...more].join(','))
  }
  return (
    <div className="chips-input" onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {items.map(x => (
        <span key={x} className="chip" data-tip={x.length > 40 ? x : undefined}>
          <span>{x}</span>
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter(y => y !== x).join(','))}>
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        spellCheck={false}
        placeholder={items.length ? '' : placeholder}
        onChange={e => (/[,\n]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault(), add(draft)
          else if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1).join(','))
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={e => {
          const t = e.clipboardData.getData('text') // a one-line box would drop the line breaks between them
          if (/[,\n]/.test(t)) e.preventDefault(), add(draft + t)
        }}
      />
    </div>
  )
}

// one setting of a widget, as its kind takes it, its hint in the empty box (and the name's tooltip); saved as it
// changes (text and numbers as you leave the box)
function WidgetOptionField({ o, value, onSet }: { o: WidgetOption; value: string; onSet: (v: string) => void }) {
  const name = o.label || o.key
  if (o.type === 'bool')
    return (
      <div className="wo wo-bool" data-key={o.key} data-tip={o.hint}>
        <Switch on={value === '1'} onChange={on => onSet(on ? '1' : '')}>
          <span>{name}</span>
        </Switch>
      </div>
    )
  if (o.type === 'secret')
    // a token: never shown nor sent back (the daemon keeps it), typed over to replace it, Clear to remove it
    return (
      <label className="wo" data-key={o.key}>
        <span data-tip={o.hint}>{name}</span>
        <span className="wo-secret">
          <input className="mono" type="password" autoComplete="off" placeholder={o.set ? 'Set: type to replace' : o.hint} spellCheck={false} onKeyDown={enter} onBlur={e => e.target.value && (onSet(e.target.value), (e.target.value = ''))} />
          {o.set && (
            <button type="button" className="small" onClick={() => onSet('')}>
              Clear
            </button>
          )}
        </span>
      </label>
    )
  return (
    <label className="wo" data-key={o.key}>
      <span data-tip={o.hint}>{name}</span>
      {o.type === 'choice' ? (
        <select value={value} onChange={e => onSet(e.target.value)}>
          {(o.choices ?? []).map(c => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : o.type === 'list' ? (
        <ChipsInput value={value} onChange={onSet} placeholder={o.hint ?? 'Type, then Enter'} />
      ) : (
        <input key={value} className={o.type === 'number' ? '' : 'mono'} type={o.type === 'number' ? 'number' : 'text'} defaultValue={value} placeholder={o.hint} spellCheck={false} onKeyDown={enter} onBlur={e => e.target.value !== value && onSet(e.target.value)} />
      )}
    </label>
  )
}

// where an extension's data comes from: its fetch, a text typed in, a file or a URL (each read as it fetches)
const SOURCES: [WidgetSource['kind'], string, string][] = [
  ['fetch', 'Own script', 'What its own command or script (widget.json’s fetch or script) prints'],
  ['static', 'Static', 'Text you type: JSON, or words (a note)'],
  ['file', 'File', 'A file of this Mac, read each time it fetches: JSON, or words'],
  ['url', 'URL', 'An http(s) address, read each time it fetches: JSON, or words'],
  ['ai', 'AI', 'An agent finds it and sums it up, with your MCP servers (Slack, Linear…), on a schedule'],
]
// Settings › Extensions' agent: the claude or codex profile an AI source runs, unless it names one
export const extAgent = (api: WidgetsApi) => api.agent && api.agents?.some(a => a.name === api.agent) ? api.agent : (api.agents?.find(a => a.agent === 'claude')?.name ?? 'claude')
// its page's Data tab shows it
export function SourceField({ w, api }: { w: WidgetView; api: WidgetsApi }) {
  const src = w.source!
  const [pick, setPick] = useState(src.kind)
  useEffect(() => setPick(src.kind), [src.kind])
  const save = (s: WidgetSource) => void api.set(w.id, { source: s })
  const kinds = SOURCES.filter(([k]) => k !== 'fetch' || w.ownFetch)
  const tools = useRef<HTMLInputElement>(null)
  const profile = useRef<HTMLSelectElement>(null)
  const ai = (prompt = src.prompt ?? ''): WidgetSource => ({ kind: 'ai', prompt, tools: tools.current?.value.trim() || undefined, profile: profile.current?.value || undefined })
  const isAi = src.kind === 'ai'
  return (
    <div className="wc-src">
      <div className="row">
        <div className="seg" role="tablist" aria-label="Its data's source">
          {kinds.map(([k, n, tip]) => (
            <button key={k} type="button" role="tab" aria-selected={pick === k} className={pick === k ? 'on' : ''} data-tip={tip} onClick={() => (setPick(k), k === 'fetch' && src.kind !== 'fetch' && save({ kind: 'fetch' }))}>
              {n}
            </button>
          ))}
        </div>
        <span className="muted small">{SOURCES.find(([k]) => k === pick)?.[2]}</span>
      </div>
      {pick === 'static' && <textarea key={`${w.id}:${src.text ?? ''}`} className="mono" rows={8} maxLength={65536} defaultValue={src.text ?? ''} placeholder={'{ "open": 3 }, or a note in Markdown'} spellCheck={false} onBlur={e => (src.kind !== 'static' ? e.target.value.trim() !== '' : e.target.value !== (src.text ?? '')) && save({ kind: 'static', text: e.target.value })} />}
      {pick === 'file' && <input key={`${w.id}:${src.path ?? ''}`} className="mono" defaultValue={src.path ?? ''} placeholder="~/notes/today.md, or {{workspace.path}}/TODO.md" spellCheck={false} onKeyDown={enter} onBlur={e => e.target.value.trim() && e.target.value.trim() !== (src.path ?? '') && save({ kind: 'file', path: e.target.value.trim() })} />}
      {pick === 'ai' && (
        <>
          <textarea key={`${w.id}:${src.prompt ?? ''}`} rows={5} maxLength={16384} defaultValue={isAi ? (src.prompt ?? '') : ''} placeholder="What's new in #eng on Slack since yesterday: decisions, questions for me, links. One line each." onBlur={e => (isAi ? e.target.value !== (src.prompt ?? '') : e.target.value.trim() !== '') && save(ai(e.target.value))} />
          <div className="row wc-ai">
            <label className="small" data-tip="Its model, effort, account and env: Settings › Agents & profiles">
              Agent{' '}
              <select ref={profile} key={`${w.id}:${src.profile ?? ''}`} defaultValue={isAi ? (src.profile ?? '') : ''} onChange={() => isAi && save(ai())}>
                <option value="">{extAgent(api)} (Extensions' agent)</option>
                {(api.agents ?? []).map(a => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <input ref={tools} key={`${w.id}:${src.tools ?? ''}`} className="mono grow" defaultValue={isAi ? (src.tools ?? '') : ''} placeholder="claude's tools it may use unasked: mcp__slack, WebFetch" data-tip="Claude's tools by name, comma-separated; it's refused the others. Codex: its sandbox, read only" spellCheck={false} onKeyDown={enter} onBlur={e => isAi && e.target.value.trim() !== (src.tools ?? '') && save(ai())} />
          </div>
          <span className="muted small">Runs as you, with your own MCP servers{w.every ? `, every ${w.every} min while on` : ''}; it's told to change nothing. Each run costs: Laki AI's Calls lists them.</span>
        </>
      )}
      {pick === 'url' && <input key={`${w.id}:${src.url ?? ''}`} className="mono" type="url" defaultValue={src.url ?? ''} placeholder="https://status.example.com/api/v2/summary.json" spellCheck={false} onKeyDown={enter} onBlur={e => e.target.value.trim() && e.target.value.trim() !== (src.url ?? '') && save({ kind: 'url', url: e.target.value.trim() })} />}
    </div>
  )
}

// an extension's settings in titled blocks (Where it shows, Updates, its own, Tools for agents), a row each: what it is
// and what it does on the left, its control on the right
const WcSec = ({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) => (
  <section className="wc-sec">
    <div className="wc-sec-head">
      <b>{title}</b>
      {hint && <span className="muted small">{hint}</span>}
    </div>
    {children}
  </section>
)
const WcRow = ({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) => (
  <div className="wc-row">
    <Says title={title} hint={hint} />
    <div className="wc-ctl">{children}</div>
  </div>
)
const BARS: WidgetPlace[] = ['side', 'top', 'status']

// every extension's right click (a cell, a rail or foot button, a Desk tile's head; App's widgetApi.menu, Desk's
// tileMenu), after its own items: on or off, its places and size as its card has them, Remix, Delete
export function extMenuItems(w: WidgetView, api: WidgetsApi): MenuItem[] {
  const places = placesOf(w)
  const offered = PLACES.filter(([v]) => (v !== 'desk' || api.desk || places.includes('desk')) && (v !== 'row' || w.scope === 'workspace'))
  const flip = (v: WidgetPlace) => (next => next.length && void api.set(w.id, { place: next }))(places.includes(v) ? places.filter(x => x !== v) : [...places, v])
  const size = w.size.join('x')
  return [
    { label: w.on ? 'Turn off' : 'Turn on', icon: 'power', sub: w.on ? 'nothing of it runs until you turn it on' : undefined, run: () => void api.set(w.id, { on: !w.on }) },
    { label: 'Show in', icon: 'layout', items: offered.map(([v, n, tip]) => ({ label: n, sub: tip, ...(places.includes(v) && { hint: ON }), run: () => flip(v) })) },
    ...(places.some(p => BARS.includes(p)) && (!w.button || fits(w)) ? [{ label: 'Size', icon: 'grid', items: [...(fits(w) ? [{ label: 'Auto: in a bar, as wide as it needs', ...(w.fit && { hint: ON }), run: () => void api.set(w.id, { fit: true }) }] : []), ...SIZES.map(([a, d]) => ({ label: `${a} across × ${d === 0.5 ? '½' : d} down`, ...(!(w.fit && fits(w)) && size === `${a}x${d}` && { hint: ON }), run: () => void api.set(w.id, { size: [a, d], fit: false }) }))] } as MenuItem] : []),
    null,
    ...(api.remix && !w.oneFile ? [{ label: 'Remix', icon: 'copy', sub: 'a copy of it to change, yours', run: () => void api.remix!(w.id) } as MenuItem] : []),
    // a repo's goes with its repo, a dev link's is your folder: neither to the trash from here
    ...(api.rm && !w.builtin && !w.project && !w.dev ? [{ label: 'Delete…', icon: 'trash', danger: true, sub: 'to the trash: Undo brings it back', run: () => void api.rm!(w.id) } as MenuItem] : []),
  ]
}

export function WidgetCard({ w, api }: { w: WidgetView; api: WidgetsApi }) {
  const options = w.options ?? Object.keys(w.config).map(key => ({ key, type: 'text' as const })) // an older daemon's: text only
  const places = placesOf(w)
  const offered = PLACES.filter(([v]) => (v !== 'desk' || api.desk || places.includes('desk')) && (v !== 'row' || w.scope === 'workspace'))
  // a place each click turns on or off; the last one stays
  const flip = (v: WidgetPlace) => (next => next.length && void api.set(w.id, { place: next }))(places.includes(v) ? places.filter(x => x !== v) : [...places, v])
  const fetches = w.every !== undefined
  const status = w.running ? 'Fetching…' : w.error ? `Last fetch failed: ${w.error}` : w.at ? `Fetched ${ago(w.at)}` : 'Not fetched yet'
  return (
    <div className={`widget-card ${w.on ? '' : 'off'}`}>
      <div className="wc-head">
        <Switch on={w.on} onChange={on => void api.set(w.id, { on })} tip={w.on ? 'On: turn it off' : 'Off: turn it on'} />
        <div className="wc-title">
          <span className="wc-name">
            {w.builtin || w.oneFile ? (
              <b data-tip={w.builtin ? 'Comes with Laki: Remix it to rename a copy' : 'One file: its name is its <laki.name> tag'}>{w.name}</b>
            ) : (
              // its name, written in widget.json as you leave the field; empty: its id
              <input
                key={w.name}
                className="wc-name-input"
                aria-label="Its name"
                data-tip="Its name: click to change it"
                defaultValue={w.name}
                maxLength={60}
                size={Math.max(4, w.name.length)}
                spellCheck={false}
                onKeyDown={e => (enter(e), e.key === 'Escape' && e.currentTarget.value !== w.name && ((e.currentTarget.value = w.name), e.currentTarget.blur(), e.preventDefault()))} // Esc: as it was (unchanged: the page's Esc)
                onInput={e => (e.currentTarget.size = Math.max(4, e.currentTarget.value.length))}
                onBlur={e => {
                  const el = e.target
                  const v = el.value.trim()
                  if (v !== w.name && (v || w.name !== w.id)) void api.set(w.id, { name: v }).catch(() => (el.value = w.name)) // refused: as it was (the toast says why)
                  else el.value = w.name
                }}
              />
            )}
            {w.builtin && <span className="tag-soft" data-tip="Comes with Laki">built-in</span>}
            {w.scope === 'workspace' && <span className="tag-soft" data-tip="An instance per workspace, its own data">per workspace</span>}
          </span>
          <span className="muted small">{w.on ? 'On' : 'Off: nothing of it runs until you turn it on'}</span>
        </div>
        <div className="wc-acts">
          {api.remix && <IconButton icon="copy" title="Remix: a copy of it to change, yours" onClick={() => void api.remix!(w.id)} />}
          {api.folder && <IconButton icon="folder" title="Its folder: open in…" onClick={e => api.folder!(w.id, e)} />}
          {api.logs && <IconButton icon="file" title={w.log ? 'Its log: what it did, its runs and stderr' : 'Its log (off: Keep a log turns it on)'} onClick={() => api.logs!(w.id)} />}
          {api.rm && !w.builtin && (
            <>
              <span className="wc-sep" />
              <IconButton icon="trash" title="Delete it: its folder and settings (Undo brings them back)" onClick={() => void api.rm!(w.id)} />
            </>
          )}
        </div>
      </div>
      {w.description && <div className="muted small wc-desc">{w.description}</div>}
      <WcSec title="Where it shows">
        <WcRow title="Places" hint="Pick one or more: each shows the same data">
          <div className="wc-places" role="group" aria-label="Where it shows">
            {offered.map(([v, n, tip]) => (
              <button key={v} type="button" aria-pressed={places.includes(v)} className={places.includes(v) ? 'on' : ''} data-tip={places.includes(v) && places.length === 1 ? `${tip}. Its only place: pick another first` : tip} onClick={() => flip(v)}>
                {places.includes(v) && <Icon name="check" size={11} />}
                {n}
              </button>
            ))}
          </div>
        </WcRow>
        {places.some(p => BARS.includes(p)) && (
          <WcRow title="Size" hint={`${places.includes('side') ? 'Cells across × down in the sidebar. In a bar: its width, a line high' : 'Its width in the bar, in cells; a bar is a line high'}${fits(w) ? '. Auto: a bar gives it what its words need' : ''}`}>
            <select value={w.fit && fits(w) ? 'auto' : w.size.join('x')} onChange={e => void api.set(w.id, e.target.value === 'auto' ? { fit: true } : { size: e.target.value.split('x').map(Number) as [number, number], fit: false })}>
              {fits(w) && <option value="auto">Auto: in a bar, as wide as it needs</option>}
              {SIZES.map(([a, d]) => (
                <option key={`${a}x${d}`} value={`${a}x${d}`}>
                  {a} across × {d === 0.5 ? '½' : d} down
                </option>
              ))}
            </select>
          </WcRow>
        )}
        {w.full && (
          <WcRow title="Full view" hint="The window that opens when you click it">
            <div className="seg" role="radiogroup" aria-label="Full view size">
              {VIEWS.map(([v, n]) => (
                <button key={v} type="button" role="radio" aria-checked={(w.view ?? 'm') === v} className={(w.view ?? 'm') === v ? 'on' : ''} onClick={() => void api.set(w.id, { view: v })}>
                  {n}
                </button>
              ))}
            </div>
          </WcRow>
        )}
        {fetches && (
          <>
            <Switch className="switch-row" on={!w.hide?.refresh} onChange={on => void api.set(w.id, { hide: { refresh: !on } })}>
              <Says title="Show a refresh button" hint="Its ↻ in the sidebar, on the Desk and in its full view. Its right click has Fetch now either way" />
            </Switch>
            <Switch className="switch-row" on={!w.hide?.at} onChange={on => void api.set(w.id, { hide: { at: !on } })}>
              <Says title="Show when it was fetched" hint={'Its "fetched 2 min ago" and "checked …" lines. This page shows it either way'} />
            </Switch>
          </>
        )}
      </WcSec>
      {
        <WcSec title="Updates">
          {fetches && (
            <WcRow title="Fetch every" hint="How often it gets new data, while Laki's window is open">
              <label className="wc-every">
                <input
                  key={w.every}
                  type="number"
                  min={1}
                  max={1440}
                  aria-label="Minutes between fetches"
                  defaultValue={w.every}
                  onKeyDown={enter}
                  onBlur={e => {
                    const n = e.target.value.trim() ? Number(e.target.value) : NaN
                    if (!(n >= 1)) e.target.value = String(w.every) // empty or below 1: as it was, not every minute
                    else if (n !== w.every) void api.set(w.id, { every: n })
                  }}
                />
                <span className="muted small">minutes</span>
              </label>
            </WcRow>
          )}
          {w.js && (
            <Switch className="switch-row" on={!!w.net} onChange={net => void api.set(w.id, { net })}>
              <Says title="Network access" hint="Its page may fetch() from and show images of https sites. Off: it sees only what its data gave it. Its own script always has the network" />
            </Switch>
          )}
          {fetches && (
            <div className={`wc-row wc-status ${w.error && !w.running ? 'bad' : ''}`}>
              <span className="small">{status}</span>
              {w.on && (!w.scope || w.here) && (
                <button type="button" className="sm" disabled={w.running} onClick={() => void api.run(w.id, w.here ?? undefined)}>
                  <Icon name="refresh" size={12} /> {w.running ? 'Fetching…' : 'Fetch now'}
                </button>
              )}
            </div>
          )}
          <Switch className="switch-row" on={!!w.keepLog} onChange={log => void api.set(w.id, { log })}>
            <Says title="Keep a log" hint={api.allLogs ? 'Settings › Extensions keeps one for every extension now' : 'What it did, each run and its stderr, in a file of its own (1 MB, then a second). Its page’s Logs tab shows it'} />
          </Switch>
        </WcSec>
      }
      {options.length > 0 && (
        <WcSec title="Its settings" hint="What its widget.json asks for; each change fetches again">
          <div className="wc-opts">
            {options.map(o => (
              <WidgetOptionField key={o.key} o={o} value={w.config[o.key] ?? ''} onSet={v => void api.set(w.id, { config: { [o.key]: v } })} />
            ))}
          </div>
        </WcSec>
      )}
      {!!w.allowed?.length && (
        <WcSec title="Its agent may use" hint="Tools you allowed with Always when its agent asked; Revoke: it asks again">
          <div className="wc-tools">
            {w.allowed.map(t => (
              <span key={t} className="tag-soft">
                <code>{t}</code>
                <button type="button" className="link" data-tip="It asks you again" onClick={() => void api.set(w.id, { allow: w.allowed!.filter(x => x !== t) })}>
                  Revoke
                </button>
              </span>
            ))}
          </div>
        </WcSec>
      )}
      {!!w.gates?.length && (
        <WcSec title={`Can hold: ${w.gates.join(', ')}`} hint="Its gate runs before Laki does that to a workspace; a no holds it, and you can do it anyway" />
      )}
      {!!w.tools?.length && (
        <WcSec title="Tools for agents" hint="Agents run these through laki widget tool and MCP">
          <div className="wc-tools">
            {w.tools.map(t => (
              <div key={t.action} className="wc-tool small">
                <code>{t.action}</code> <span className="muted">{t.description} · {ASK_SAYS[t.ask]}</span>
                {t.grants.map(g => (
                  <span key={g} className="tag-soft">
                    always in {api.wsName?.(g) ?? (g || 'no workspace')}
                    {api.revoke && <button type="button" className="link" data-tip="Ask again there" onClick={() => void api.revoke!(w.id, t.action, g)}>Revoke</button>}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </WcSec>
      )}
    </div>
  )
}

// Laki AI's extension chats where you left off (nothing made of them yet, or Laki AI at work): a click goes back to
// its page and chat, ✕ lets one go; skip: the one open here
export function StudioSessions({ api, skip }: { api: WidgetsApi; skip?: string }) {
  const chats = (api.chats ?? []).filter(c => c.id !== skip)
  if (!chats.length) return null
  return (
    <div className="sched-list">
      {chats.map(c => (
        <div key={c.id} className="sched-row">
          <span className="sched-icon">
            <Icon name="ai" />
          </span>
          <button type="button" className="sched-main" data-tip="Back to its chat with Laki AI" onClick={() => api.page(c.id)}>
            <span className="sched-name">{api.list.find(w => w.id === c.id)?.name ?? c.title}</span>
            <span className="sched-tags">{c.busy ? <span className="tag tag-open">Laki AI is working…</span> : <span className="tag">{ago(c.at)}</span>}</span>
          </button>
          {api.chatRm && !c.busy && (
            <span className="sched-acts">
              <IconButton icon="trash" title="Delete this session: its chat goes" onClick={() => void api.chatRm!(c.id)} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// what needs a look: its dev copy broke, or one that's on failed its fetch, misses a setting it needs or logged an error in
// the last hour (Settings' rows: first in their group, a red dot)
const failing = (w: WidgetView) => !!w.devError || (w.on && (!!w.error || !!w.missing?.length || (!!w.logErr && Date.now() - w.logErr < 3600e3)))
const failWhy = (w: WidgetView) => w.devError ? `Last good version kept: ${w.devError}` : w.error ? `Its last fetch failed: ${w.error}` : w.missing?.length ? `A setting it needs is empty: ${w.missing.join(', ')}` : 'An error in its log in the last hour'

// the widgets as Scheduled tasks' rows: name, what it is, how it's set, its switch; a click opens its page. A search
// (its name, id, places, project) and the ones failing first
function WidgetList({ api }: { api: WidgetsApi }) {
  const [q, setQ] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = (w: WidgetView) => [w.name, w.id, w.repo, w.project, ...placesOf(w).flatMap(p => [p, PLACES.find(x => x[0] === p)?.[1] ?? ''])].join(' ').toLowerCase()
  const shown = api.list.filter(w => words.every(x => hay(w).includes(x))).sort((a, b) => +failing(b) - +failing(a)) // stable: the rest as they were
  const mine = shown.filter(w => !w.builtin && !w.project)
  const theirs = shown.filter(w => w.builtin)
  const repos = [...new Set(shown.flatMap(w => (w.project ? [w.project] : [])))] // a repo's (.laki/extensions): a group each
  const [menu, openMenu] = useMenu()
  const [starters, setStarters] = useState(false)
  // New ▾: a new one's page (Laki AI's chat, or the prompt for any AI chat), or a starter picked from their previews (one that runs at once on sample data,
  // yours to change: laki widget new)
  const newMenu = (e: MouseEvent) =>
    openMenu(e, [
      { label: 'With Laki AI…', icon: 'ai', sub: 'describe it, see it on sample data; or the prompt for any AI chat', run: () => api.page('') },
      ...(api.make ? [{ label: 'From a starter…', icon: 'panel' as const, sub: `${STARTER_KINDS.length} to pick from, each shown on its sample data`, run: () => setStarters(true) }] : []),
    ])
  return (
    <>
      {menu}
      {starters && api.make && <StarterPicker onClose={() => setStarters(false)} onPick={k => (setStarters(false), void api.make!(k))} />}
      {api.list.length > 3 && <input type="search" className="theme-find" value={q} placeholder={`Find an extension by name, id, place or project (${api.list.length})`} spellCheck={false} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && q && (e.stopPropagation(), setQ(''))} />}
      {words.length > 0 && !shown.length && <p className="muted small">No extension has “{q}” in its name, id, places or project.</p>}
      {!!api.chats?.length && (
        <Group title="Where you left off" hint="What you're making with Laki AI that isn't saved yet, or that it works on now: a click goes back to its page and chat">
          <StudioSessions api={api} />
        </Group>
      )}
      <Group
        title="Yours"
        hint="Ones you or Laki AI made: in Laki's folder or the folders below"
        act={
          <button type="button" className="primary" onClick={newMenu}>
            <Icon name="plus" size={12} /> New ▾
          </button>
        }
      >
        {mine.length ? list(mine) : words.length ? <p className="muted small">None of yours matches.</p> : <p className="muted small">None yet: New starts one from a starter, or describes one to Laki AI (or gives you the prompt for any AI chat).</p>}
      </Group>
      {repos.map(p => (ws => (
        <Group key={p} title={`From ${ws[0].repo ?? p}`} hint="Its repo's .laki/extensions: shown only in its workspaces; turning one on shows what it runs first, and a change there turns it off">
          {list(ws)}
        </Group>
      ))(api.list.filter(w => w.project === p)))}
      {!!theirs.length && <Group title="Built in" hint="Ones that come with Laki: turn on the ones you like">{list(theirs)}</Group>}
    </>
  )
  function list(ws: WidgetView[]) {
    return (
      <div className="sched-list">
        {ws.map(w => (
          <div key={w.id} className={`sched-row ${w.on ? '' : 'off'}`}>
            <span className="sched-icon" data-tip={failing(w) ? failWhy(w) : undefined}>
              <Icon name={w.js ? 'code' : 'panel'} />
              {failing(w) && <span className="widget-dot bad" />}
            </span>
            <button type="button" className="sched-main" data-tip="Open: preview, settings, Laki AI" onClick={() => api.page(w.id)}>
              <span className="sched-name">{w.name}</span>
              {w.description && (
                <span className="sched-meta">
                  <span className="sched-desc">{w.description}</span>
                </span>
              )}
              <span className="sched-tags">
                {w.builtin && <span className="tag">built-in</span>}
                {w.changed && !w.on && <span className="tag tag-closed" data-tip={`Its files changed ${w.repo ? 'in the repo' : 'in the folder an agent linked'}: off until you look`}>changed</span>}
                {w.dev && <span className={`tag ${w.devError ? 'bad' : ''}`} data-tip={w.devError ? `Last good version kept: ${w.devError}` : 'Linked by laki widget dev: your folder, watched'}>dev</span>}
                {w.mock && <span className="tag" data-tip="Its inspector put sample data there: Live fetches again">sample data</span>}
                {(ps => (ps.length > 1 || ps[0] !== 'side') && <span className="tag">{ps.map(p => PLACES.find(x => x[0] === p)?.[1] ?? p).join(' · ')}</span>)(placesOf(w))}
                {w.net && <span className="tag" data-tip="Its page may reach https sites">network</span>}
                {w.on && w.hidden && <span className="tag" data-tip="Its data says hidden: true: it shows nowhere until its data changes">hidden</span>}
                {w.byAi && <span className="tag" data-tip="Laki AI wrote it; it was saved off: look at what it runs (its folder) before turning it on">by Laki AI</span>}
                {w.log && (bad => <span className={`tag ${bad ? 'tag-closed' : ''}`} data-tip={bad ? 'An error in its log in the last hour: its page’s Logs' : 'It keeps a log: its page’s Logs'}>log</span>)(!!w.logErr && Date.now() - w.logErr < 3600e3)}
                <span className="tag">
                  {w.fit && fits(w) ? 'auto · ' : ''}{w.size[0]}×{w.size[1] === 0.5 ? '½' : w.size[1]}
                </span>
                {w.every !== undefined && <span className="tag">every {w.every} min</span>}
                {w.scope ? <span className="tag" data-tip="An instance in each workspace: its data, fetched while it's on screen">per workspace</span> : w.every !== undefined && <span className={`tag ${w.error && !w.running ? 'tag-closed' : ''}`}>{w.running ? 'fetching…' : w.error ? 'last fetch failed' : w.at ? `fetched ${ago(w.at)}` : 'not fetched yet'}</span>}
              </span>
            </button>
            <span className="sched-acts">
              {api.remix && <IconButton icon="copy" title="Remix: a copy of it to change, yours" onClick={() => void api.remix!(w.id)} />}
              {w.on && w.every !== undefined && !w.scope && <IconButton icon="refresh" title={w.running ? 'Fetching…' : 'Fetch now'} className={w.running ? 'spin' : ''} onClick={() => !w.running && void api.run(w.id)} />}
            </span>
            <Switch on={w.on} tip={w.on ? `${w.name}: on` : `${w.name}: off`} onChange={on => void api.set(w.id, { on })} />
          </div>
        ))}
      </div>
    )
  }
}

export function WidgetsSection({ api, dirs, onDirs, hours, onHours, onAgent, onLogs }: { api: WidgetsApi; dirs: string[]; onDirs: (d: string[]) => void; hours: string; onHours: (h: string) => void; onAgent: (name: string) => void; onLogs: (on: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const read = hours.trim() ? parseHours(hours) : null
  return (
    <>
      <h2>Extensions</h2>
      <p className="muted">
        Small live pages (also called widgets or plugins) in the sidebar, above its buttons, in a grid 4 cells across, a line high in the top bar or the status bar, or buttons on the rail and in the sidebar's foot (an icon, a label, a count, a click that runs something): each a folder with widget.json (its name, size, settings and the command that fetches its data, on a
        schedule) and widget.html (what it shows, and its full view, a click away). A click on one opens its page: a preview (with made-up data too), its settings and Laki AI to change it. New extension makes one with Laki AI, or gives you the prompt for any AI chat; an agent with the Extension creator skill (Agent skill) makes them too.
      </p>
      {api.kit && (
        <div className="kit-hero">
          <span className="ico">
            <Icon name="panel" size={20} />
          </span>
          <div>
            <b>The UI kit: browse {UI_TYPES.length} elements</b>
            <span className="muted small">Lists, tables, charts, boards, logs, forms and more (widget.json's ui), each with a sample at a few sizes and its JSON to copy; {Object.keys(ICONS).length} icons, found by name. Laki AI and the Extension creator skill build with it.</span>
          </div>
          <div className="row">
            <button type="button" onClick={() => api.kit?.(true)}>
              <Icon name="bulb" size={12} /> Icons
            </button>
            <button type="button" className="primary" onClick={() => api.kit?.()}>
              Browse {UI_TYPES.length} elements
            </button>
          </div>
        </div>
      )}
      <WidgetList api={api} />
      {api.agents && (
        <Group title="Agent" hint="What an extension's AI source runs: it finds and sums up its data, with your MCP servers">
          <label>
            <span>
              Agent profile <span className="muted">· a claude or codex one: its model, effort, account and env (Agents & profiles); an extension may name another</span>
            </span>
            <select value={extAgent(api)} onChange={e => onAgent(e.target.value)}>
              {(api.agents.length ? api.agents : [{ name: 'claude', agent: 'claude' }]).map(a => (
                <option key={a.name} value={a.name}>
                  {a.name} · {a.agent === 'codex' ? 'Codex' : 'Claude'}
                </option>
              ))}
            </select>
          </label>
        </Group>
      )}
      <Group title="Logs">
        <Switch className="switch-row" on={!!api.allLogs} onChange={onLogs}>
          <Says title="Keep logs for every extension" hint="What each one did, its runs and their stderr, in a file of its own (secrets masked): its page's Logs tab, laki widget logs. Off: only the ones whose own Keep a log is on" />
        </Switch>
      </Group>
      <Group title="Folders">
        <div className="muted small">
          Laki's own: <span className="mono">{api.home}</span>
        </div>
        <label>
          <span>
            More folders <span className="muted">· one per line: an extension's folder, or a folder of them</span>
          </span>
          <textarea className="mono" rows={2} spellCheck={false} value={dirs.join('\n')} placeholder="~/code/my-widgets" onChange={e => onDirs(e.target.value.split('\n'))} />
        </label>
        <div className="row">
          <button disabled={busy} onClick={() => (setBusy(true), api.reload().finally(() => setBusy(false)))}>
            {busy ? 'Reloading…' : 'Reload extensions'}
          </button>
          <span className="muted small">Reads the folders again and fetches each extension that's on: changes show without a restart.</span>
        </div>
      </Group>
      <Group title="Working hours">
        <label>
          <span>
            Fetch only <span className="muted">· in plain English; empty: any time the app is open</span>
          </span>
          <input value={hours} spellCheck={false} placeholder="9am-9pm weekdays" onChange={e => onHours(e.target.value)} />
        </label>
        {read && <div className={`small ${'error' in read ? 'warn' : 'schedule-preview'}`}>{'error' in read ? `${read.error}: fetching any time until then` : `${describeHours(read)} · Fetch now still works outside them`}</div>}
      </Group>
    </>
  )
}
