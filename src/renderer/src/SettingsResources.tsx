// Settings › Resources: Laki and each tab by memory and CPU, with their processes, and when idle agents sleep.
// Settings.tsx re-exports it.
import { type ProcUse, type Resources, SLEEP_AFTER, type TabView } from '../../shared/types'
import { type ReactNode, useEffect, useState } from 'react'
import { Icon } from './ui'
import { Group } from './SettingsKit'

// Resources: what Laki and each tab use now (the daemon's ps, every 3 s while it's open), and idle agents put to sleep
// (settings.sleepAfter). macOS counts every process Laki starts as Laki's
export type ResourcesApi = {
  load: () => Promise<Resources>
  tabs: TabView[]
  wsName: (id: string) => string
  sleep: (tab: string) => Promise<unknown>
  open: (tab: string) => void
  procs?: () => Promise<{ pid: number; name: string; stop?: string }[]> // the app's: what each process holds (main's)
  stop?: (what: string) => void // free one: the video, a widget, the preview, the bubbles, an agent browser
  stopOther?: (key: string) => Promise<unknown> // end one the daemon runs: Laki AI's ask, a tunnel, remote access
  widgetName: (id: string) => string
}

const SLEEP: [number, string][] = [[0, 'Never'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours']]
const KIND: Record<string, string> = { main: 'Laki: the app (windows, menus, notifications)', renderer: 'a window: what it draws and runs', 'gpu-process': 'GPU: drawing every window and the bubbles', network: 'network', audio: 'audio', storage: 'storage', daemon: 'the daemon: sessions, hooks, scans, the API' }
// the last 5 minutes of the totals, a sample every 3 s while the page is open (kept while the app runs): the graph
const HISTORY: { at: number; kb: number; cpu: number }[] = []
const cpuText = (cpu: number) => (cpu >= 1 ? `${Math.round(cpu)}%` : '')
// KB as MB, or GB from 1 GB
const size = (kb: number) => (kb >= 1 << 20 ? `${(kb / (1 << 20)).toFixed(2)} GB` : `${Math.round(kb / 1024)} MB`)
const total = (ps: { rss: number }[]) => ps.reduce((n, p) => n + p.rss, 0)
// a command short: each absolute path as its last part, a flag's name kept (the whole one is its tooltip)
const short = (cmd: string) => cmd.replace(/(^|[\s=])\/(?:[^\s/]+\/)+(?=[^\s/])/g, '$1').slice(0, 90)

function Procs({ ps }: { ps: (ProcUse & { kind?: string })[] }) {
  return (
    <div className="res-procs">
      {[...ps].sort((a, b) => b.rss - a.rss).map(p => (
        <div key={p.pid} data-tip={`${p.pid}: ${p.cmd}`}>
          <span className="mono">{p.kind ? (KIND[p.kind] ?? p.kind) : short(p.cmd)}</span>
          <span className="num muted">{cpuText(p.cpu)}</span>
          <span className="num">{size(p.rss)}</span>
        </div>
      ))}
    </div>
  )
}

// the totals over the last minutes: memory (the accent) and CPU (the running color), each on its own scale
function ResGraph() {
  if (HISTORY.length < 2) return null
  const from = HISTORY[0].at
  const span = Math.max(HISTORY.at(-1)!.at - from, 1)
  const line = (k: 'kb' | 'cpu') => {
    const hi = Math.max(...HISTORY.map(x => x[k]), k === 'cpu' ? 10 : 1)
    return HISTORY.map(x => `${(((x.at - from) / span) * 100).toFixed(1)},${(38 - (x[k] / hi) * 34).toFixed(1)}`).join(' ')
  }
  const peak = Math.max(...HISTORY.map(x => x.cpu))
  return (
    <div className="res-graph" data-tip={`The last ${Math.max(1, Math.round(span / 60000))} min, a sample every 3 seconds while this page is open`}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <polyline className="g-mem" points={line('kb')} />
        <polyline className="g-cpu" points={line('cpu')} />
      </svg>
      <span className="muted small">
        <i className="g-mem" /> memory · <i className="g-cpu" /> CPU, at most {Math.round(peak)}% · the last {Math.max(1, Math.round(span / 60000))} min
      </span>
    </div>
  )
}

export function ResourcesSection({ api, sleepAfter, onSleepAfter }: { api: ResourcesApi; sleepAfter: number; onSleepAfter: (min: number) => void }) {
  const [r, setR] = useState<Resources | null>(null)
  const [named, setNamed] = useState<{ pid: number; name: string; stop?: string }[]>([])
  const [open, setOpen] = useState<string | null>(null) // the row whose processes show
  const [said, setSaid] = useState('') // a Sleep that was refused
  const [by, setBy] = useState<'rss' | 'cpu'>('rss') // the rows' order: memory, or CPU now
  useEffect(() => {
    let on = true
    const load = () => !document.hidden && Promise.all([api.load(), api.procs?.().catch(() => []) ?? []]).then(([x, n]) => on && (setR(x), setNamed(n)), () => {}) // not while the window is hidden
    load()
    const t = setInterval(load, 3000)
    return () => ((on = false), clearInterval(t))
  }, [])
  const tabOf = (id: string) => api.tabs.find(t => t.id === id)
  // the app's processes that hold something of their own (main's names, by pid): a row each, with Stop; JS widgets
  // share one (one site), template widgets and the memes are drawn in the window's
  const word = (n: string) => (n.startsWith('widget:') ? api.widgetName(n.slice(7)) : n.startsWith('browser:') ? `Agent browser · ${api.wsName(n.slice(8))}` : n)
  const held = (r?.app ?? []).flatMap(p => {
    const ns = named.filter(x => x.pid === p.pid && x.name !== 'The window')
    if (!ns.length) return []
    const widgets = [...new Set(ns.filter(x => x.name.startsWith('widget:')).map(x => word(x.name)))] // the grid's and a full view's: one
    const name = [...(widgets.length ? [`${widgets.length > 1 ? 'Extensions' : 'Extension'} · ${widgets.join(', ')}`] : []), ...new Set(ns.filter(x => !x.name.startsWith('widget:')).map(x => word(x.name)))].join(' · ')
    return [{ ...p, name, stops: [...new Set(ns.flatMap(x => (x.stop ? [x.stop] : [])))] }]
  })
  const app = r ? [...r.app.filter(p => !held.some(h => h.pid === p.pid)), { ...r.daemon, kind: 'daemon' }] : []
  const own = total(app)
  const live = (r?.tabs ?? []).filter(x => tabOf(x.tab))
  const rows = live.filter(x => !tabOf(x.tab)!.asleep).sort((a, b) => b[by] - a[by]) // an asleep one still exiting: its own row, below
  const others = r?.others ?? [] // what the daemon runs besides tabs: Laki AI, tunnels, remote access, SSH, widgets
  const all = own + total(held) + total(live) + total(others)
  const cpu = (ps: { cpu: number }[]) => ps.reduce((n, p) => n + p.cpu, 0)
  const allCpu = cpu(app) + cpu(held) + cpu(live) + cpu(others)
  useEffect(() => {
    if (!r) return
    HISTORY.push({ at: Date.now(), kb: all, cpu: allCpu })
    while (HISTORY.length > 100 || (HISTORY.length && Date.now() - HISTORY[0].at > 5 * 60000)) HISTORY.shift()
  }, [r])
  // what the sidebar's Terminals and Browsers hold: shell tabs (anywhere), Browsers pages and their sign-in windows
  const shells = total(live.filter(x => tabOf(x.tab)!.kind === 'shell'))
  const browsers = total(held.filter(p => p.name.includes('Browser: ')))
  const canSleep = (t: TabView) => (t.preset === 'claude' || t.preset === 'codex') && !!t.resumeId && t.status === 'idle'
  const row = (key: string, name: ReactNode, kb: number, cpu: number, acts?: ReactNode) => (
    <div className={`res-row${open === key ? ' open' : ''}`} onClick={() => setOpen(open === key ? null : key)}>
      <Icon name={open === key ? 'chevron' : 'chevronRight'} size={12} />
      <span className="res-name">
        <span>{name}</span>
        <i className="res-bar" style={{ width: `${all ? (kb / all) * 100 : 0}%` }} />
      </span>
      <span className="num muted">{cpuText(cpu)}</span>
      <span className="num">{size(kb)}</span>
      <span className="res-acts" onClick={e => e.stopPropagation()}>
        {acts}
      </span>
    </div>
  )
  return (
    <>
      <h2>Resources</h2>
      <p className="muted small">
        Memory and CPU now, every 3 seconds while this is open. macOS counts every process Laki starts as Laki's: each agent, its MCP servers, the dev
        servers in its tabs, Laki AI's agent, tunnels, remote access, SSH connections and extensions' fetches. An agent grows the longer it runs; sleeping it gives that back. The video, JS extensions, the preview, the floating bubbles,
        an agent browser and the sidebar's browser pages each run in a process of their own: Stop frees one until it's opened again (a browser's: the
        pages you aren't on).
      </p>
      <Group title="Memory">
        {!r ? (
          <p className="muted small">Measuring…</p>
        ) : (
          <>
            <div className="res-total">
              <b>{size(all)}</b>
              <b className="res-cpu" data-tip="CPU now, all of it: 100% is one core busy">{Math.round(allCpu)}% CPU</b>
              <span className="muted">
                Laki itself {size(own + total(held) - browsers)} · agents and tabs {size(total(live) - shells)}
                {shells > 0 && ` · shells ${size(shells)}`}
                {browsers > 0 && ` · browsers ${size(browsers)}`}
                {others.length > 0 && ` · Laki AI and connections ${size(total(others))}`}
              </span>
            </div>
            <ResGraph />
            <div className="res-head muted small">
              <span className="grow">Click a row for its processes</span>
              <span className="seg" role="radiogroup" aria-label="Order">
                <button type="button" className={by === 'rss' ? 'on' : ''} onClick={() => setBy('rss')}>
                  By memory
                </button>
                <button type="button" className={by === 'cpu' ? 'on' : ''} onClick={() => setBy('cpu')}>
                  By CPU
                </button>
              </span>
            </div>
            <div className="res-rows">
              {row('laki', 'Laki itself', own, cpu(app))}
              {open === 'laki' && <Procs ps={app} />}
              {held.map(p => (
                <div key={p.pid}>
                  {row(
                    `pid:${p.pid}`,
                    p.name,
                    p.rss,
                    p.cpu,
                    !!p.stops.length && api.stop && (
                      <button className="small" data-tip="Frees it now; it comes back when it's opened again (the bubbles: when an agent's state changes)" onClick={() => p.stops.forEach(x => api.stop!(x))}>
                        Stop
                      </button>
                    ),
                  )}
                  {open === `pid:${p.pid}` && <Procs ps={[p]} />}
                </div>
              ))}
              {others.map(o => (
                <div key={o.procs[0]?.pid ?? o.name}>
                  {row(
                    `other:${o.procs[0]?.pid}`,
                    o.name,
                    o.rss,
                    o.cpu,
                    o.stop && api.stopOther && (
                      <button className="small" data-tip={o.stop === 'ai' ? 'Stops its answer' : 'Ends it: the link stops working'} onClick={() => api.stopOther!(o.stop!).then(() => setSaid(''), e => setSaid((e as Error).message))}>
                        Stop
                      </button>
                    ),
                  )}
                  {open === `other:${o.procs[0]?.pid}` && <Procs ps={o.procs} />}
                </div>
              ))}
              {rows.map(x => {
                const t = tabOf(x.tab)!
                return (
                  <div key={x.tab}>
                    {row(
                      x.tab,
                      <>
                        {api.wsName(t.workspace)} <span className="muted">· {t.name}</span>
                      </>,
                      x.rss,
                      x.cpu,
                      <>
                        {canSleep(t) && (
                          <button className="small" data-tip="End its process now: a look, a key or a message resumes the chat" onClick={() => api.sleep(t.id).then(() => setSaid(''), e => setSaid((e as Error).message))}>
                            Sleep
                          </button>
                        )}
                        <button className="small" onClick={() => api.open(t.id)}>
                          Open
                        </button>
                      </>,
                    )}
                    {open === x.tab && <Procs ps={x.procs} />}
                  </div>
                )
              })}
              {api.tabs.filter(t => t.asleep).map(t => (
                <div key={t.id} className="res-row still">
                  <span />
                  <span className="res-name">
                    <span>
                      {api.wsName(t.workspace)} <span className="muted">· {t.name} · asleep</span>
                    </span>
                  </span>
                  <span />
                  <span className="num muted">{size(live.find(x => x.tab === t.id)?.rss ?? 0)}</span>
                  <span className="res-acts">
                    <button className="small" onClick={() => api.open(t.id)}>
                      Wake
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {said && <p className="muted small">{said}</p>}
          </>
        )}
      </Group>
      <Group title="Idle agents" hint="An idle claude or codex you aren't looking at is ended to free its memory; its screen stays. Looking at it, a key or a message resumes the chat. Not one with a dev server listening under it, getting PR feedback, or on an SSH host.">
        <label>
          Sleep idle agents after
          <select value={sleepAfter} onChange={e => onSleepAfter(Number(e.target.value))}>
            {(SLEEP.some(([m]) => m === sleepAfter) ? SLEEP : [...SLEEP, [sleepAfter, `${sleepAfter} minutes`] as [number, string]]).map(([m, name]) => (
              <option key={m} value={m}>
                {name}
                {m === SLEEP_AFTER ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
      </Group>
    </>
  )
}
