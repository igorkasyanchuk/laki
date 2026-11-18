// Settings › Resources: Laki and each tab by memory and CPU, with their processes, and when idle agents sleep.
// Settings.tsx re-exports it.
import { type DiskTidyWhat, type DiskUsage, type KeptArts, type ProcUse, type Resources, SLEEP_AFTER, type TabView } from '../../shared/types'
import { type ReactNode, useEffect, useState } from 'react'
import { BUDGET_DEFAULT } from '../../shared/browserBudget'
import { Icon, Switch, act, ask } from './ui'
import { Group } from './SettingsKit'

// Resources: what Laki and each tab use now (the daemon's ps, every 3 s while it's open), and idle agents put to sleep
// (settings.sleepAfter). macOS counts every process Laki starts as Laki's
export type ResourcesApi = {
  load: () => Promise<Resources>
  tabs: TabView[]
  wsName: (id: string) => string
  sleep: (tab: string) => Promise<unknown>
  open: (tab: string) => void
  budgetSaid?: () => string // the memory budget: why nothing could be unloaded
  procs?: () => Promise<{ pid: number; name: string; stop?: string }[]> // the app's: what each process holds (main's)
  stop?: (what: string) => void // free one: the video, a widget, the preview, the bubbles, an agent browser
  stopOther?: (key: string) => Promise<unknown> // end one the daemon runs: Laki AI's ask, a tunnel, remote access
  widgetName: (id: string) => string
  disk?: (again?: boolean) => Promise<DiskUsage> // Disk (diskUsage): measured as it opens, kept 10 minutes
  tidy?: (what: DiskTidyWhat, days: number, dry: boolean) => Promise<{ goes: string[] }>
  kept?: KeptApi // C5: Artifacts of deleted workspaces
}
export type KeptApi = { list: () => Promise<KeptArts[]>; rm: (dir?: string) => Promise<unknown>; open: (dir: string, file?: string) => Promise<unknown>; start: (k: KeptArts, file: string) => void }

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

export function ResourcesSection({ api, sleepAfter, onSleepAfter, browserBudget, onBrowserBudget }: { api: ResourcesApi; sleepAfter: number; onSleepAfter: (min: number) => void; browserBudget: number; onBrowserBudget?: (mb: number) => void }) {
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
    <div className={`res-row${open === key ? ' open' : ''}`} {...act(() => setOpen(open === key ? null : key))}>
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
      {onBrowserBudget && (
        <Group title="Hidden browser pages" hint="Over the budget, the oldest Browsers page you aren't on is unloaded; opening it loads its address again (what you typed or scrolled to isn't kept). Never the one you're on, the last ones you used, or a page playing, downloading, being inspected, or with typing or form edits.">
          <Switch className="switch-row" on={browserBudget > 0} onChange={on => onBrowserBudget(on ? BUDGET_DEFAULT : 0)}>
            Unload hidden pages over a memory budget
          </Switch>
          {browserBudget > 0 && (
            <label className="row">
              Budget (MB)
              <span className="grow" />
              <input type="number" style={{ width: 100 }} min={256} step={256} defaultValue={browserBudget} key={browserBudget} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} onBlur={e => { const n = Math.round(Number(e.target.value)); if (!(n >= 256)) e.target.value = String(browserBudget); else if (n !== browserBudget) onBrowserBudget(n) }} />
            </label>
          )}
          {api.budgetSaid?.() && <div className="muted small">{api.budgetSaid()}</div>}
        </Group>
      )}
      {api.disk && api.tidy && <Disk load={api.disk} tidy={api.tidy} />}
      {api.kept && <KeptArtifacts api={api.kept} />}
      <Group title="Idle agents" hint="An idle claude or codex you aren't looking at is ended to free its memory; its screen stays. Looking at it, a key or a message resumes the chat. Not one with a dev server listening under it, getting PR feedback, or on an SSH host. After a restart, one unused this long stays asleep until you open it.">
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

// Disk: each project's workspaces by what they take (the daemon's du, under nice, two at a time; kept 10 minutes), a
// bar each against the biggest, the free space; three ways to make room, each asked first with what goes
const gb = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : `${Math.max(0, Math.round(b / (1 << 20)))} MB`)
const PART: Record<string, string> = { worktree: 'worktree', turns: 'kept turns', storage: 'storage', saved: 'saved changes' }
const TIDY: [DiskTidyWhat, string, string][] = [
  ['turns', 'Kept turns over 7 days old', 'of workspaces with no turn running'],
  ['storage', 'Storage of merged archives', 'archived workspaces whose PR merged: their storage folders to the trash'],
  ['archives', 'Archives over 30 days old', "deleted as Settings' archive age would; what's their own goes to the trash after a day's notice"],
]
function Disk({ load, tidy }: { load: (again?: boolean) => Promise<DiskUsage>; tidy: (what: DiskTidyWhat, days: number, dry: boolean) => Promise<{ goes: string[] }> }) {
  const [d, setD] = useState<DiskUsage | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const get = (again?: boolean) => (setBusy(true), load(again).then(x => (setD(x), setErr('')), e => setErr(String(e?.message ?? e))).finally(() => setBusy(false)))
  useEffect(() => void get(), [])
  const max = Math.max(1, ...(d?.projects.flatMap(p => p.workspaces.map(w => w.bytes)) ?? []))
  const go = async (what: DiskTidyWhat, label: string) => {
    const days = what === 'turns' ? 7 : what === 'archives' ? 30 : 0
    const goes = await tidy(what, days, true).then(x => x.goes, e => void setErr(String(e?.message ?? e)))
    if (!goes) return
    if (!goes.length) return setErr(`${label}: nothing to tidy`)
    if (!(await ask(`${label}?`, { text: `These go: ${goes.slice(0, 12).join('; ')}${goes.length > 12 ? `; and ${goes.length - 12} more` : ''}.`, ok: 'Tidy', danger: true }))) return
    await tidy(what, days, false).then(() => get(true), e => setErr(String(e?.message ?? e)))
  }
  return (
    <Group title="Disk" hint="What each workspace takes: its worktree (its dependency folders in it), kept turns, storage folder and an archive's saved changes. A folder Laki cloned may be shared on disk: APFS keeps one copy until either side changes.">
      {!d ? (
        <p className="muted small">{err || 'Measuring…'}</p>
      ) : (
        <>
          <p className="muted small">
            {d.free !== undefined && `${gb(d.free)} free on this volume · `}measured {new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{' '}
            <button type="button" className="link" disabled={busy} onClick={() => void get(true)}>
              {busy ? 'Measuring…' : 'Measure again'}
            </button>
          </p>
          {d.backup && (wt => (wt > 0 ? <p className="muted small">{d.backup!.tm ? `${gb(wt)} of worktrees kept out of Time Machine${d.backup!.spotlight ? ' and Spotlight' : ''}` : `Worktrees take ${gb(wt)} of Time Machine's backups: Settings › General › Keep worktrees out of Time Machine`}</p> : null))(d.projects.flatMap(p => p.workspaces.flatMap(w => w.parts.filter(x => x.what === 'worktree'))).reduce((n, x) => n + x.bytes, 0))}
          <div className="disk-list">
            {d.projects.map(p => (
              <div key={p.id}>
                <div className="disk-row disk-project">
                  <b>{p.name}</b>
                  <span className="num">{gb(p.bytes)}</span>
                </div>
                {p.workspaces.map(w => (
                  <div key={w.id} className="disk-row" title={w.parts.map(x => `${x.name ?? PART[x.what]}: ${gb(x.bytes)}${x.shared ? ' (may be shared)' : ''}`).join('\n')}>
                    <span className="res-name">
                      <span>
                        {w.name}
                        {w.archived && <span className="muted"> · archived{w.merged ? ', merged' : ''}</span>}
                        <span className="muted small"> {w.parts.filter(x => x.what === 'deps').map(x => `${x.name} ${gb(x.bytes)}${x.shared ? ' (may be shared)' : ''}`).join(' · ')}</span>
                      </span>
                      <i className="res-bar" style={{ width: `${(w.bytes / max) * 100}%` }} />
                    </span>
                    <span className="num">{gb(w.bytes)}</span>
                  </div>
                ))}
              </div>
            ))}
            {!d.projects.length && <p className="muted small">No workspaces on this Mac yet.</p>}
          </div>
          <div className="disk-tidy">
            {TIDY.map(([what, label, hint]) => (
              <button key={what} type="button" data-tip={hint} onClick={() => void go(what, label)}>
                {label}
              </button>
            ))}
          </div>
          {err && <p className="muted small">{err}</p>}
        </>
      )}
    </Group>
  )
}

const sz = (b: number) => (b < 1 << 20 ? `${Math.max(1, Math.round(b / 1024))} KB` : gb(b))
// C5: Artifacts of deleted workspaces: what deleting a workspace kept (its storage folder's files), newest first, each
// folder with who it was, its size, Show in Finder and Delete; a file opens in its app, or starts a workspace with its
// path in the prompt (its project's, the new-workspace page). Delete all, asked first
function KeptArtifacts({ api }: { api: KeptApi }) {
  const [list, setList] = useState<KeptArts[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const get = () => api.list().then(setList, e => setErr(String(e?.message ?? e)))
  useEffect(() => void get(), [])
  const fail = (e: unknown) => setErr(String((e as Error)?.message ?? e))
  const total = (list ?? []).reduce((n, k) => n + k.bytes, 0)
  const rm = async (k?: KeptArts) => {
    if (!(await ask(k ? `Delete ${k.name}'s artifacts?` : 'Delete every kept artifact?', { text: k ? `${k.n} file${k.n === 1 ? '' : 's'}, ${sz(k.bytes)}: they can't be brought back.` : `${list?.length} deleted workspaces' files, ${sz(total)}: they can't be brought back.`, ok: 'Delete', danger: true }))) return
    await api.rm(k?.dir).then(get, fail)
  }
  return (
    <Group title="Artifacts of deleted workspaces" hint="The screenshots, reports and files agents made, kept when their workspace was deleted (Settings › General › Storage: Keep a deleted workspace's artifacts). They don't age out with the storage folders' files">
      {!list ? (
        <p className="muted small">{err || 'Looking…'}</p>
      ) : !list.length ? (
        <p className="muted small">None kept.</p>
      ) : (
        <>
          {err && <p className="warn small">{err}</p>}
          <p className="muted small">
            {list.length} workspace{list.length === 1 ? '' : 's'} · {sz(total)}{' '}
            <button type="button" className="link" onClick={() => void rm()}>
              Delete all
            </button>
          </p>
          <div className="disk-list kept-list">
            {list.map(k => (
              <div key={k.dir}>
                <div className="disk-row disk-project kept-head" {...act(() => setOpen(o => (o === k.dir ? null : k.dir)))} aria-expanded={open === k.dir}>
                  <span className="res-name">
                    <span>
                      <Icon name={open === k.dir ? 'chevron' : 'chevronRight'} size={12} /> <b>{k.name}</b>
                      <span className="muted small">
                        {' '}
                        · deleted {new Date(k.deleted).toLocaleDateString()} · {k.n} file{k.n === 1 ? '' : 's'}
                        {k.branch ? ` · ${k.branch}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="num">{sz(k.bytes)}</span>
                  <button type="button" className="link small" onClick={e => (e.stopPropagation(), void api.open(k.dir).catch(fail))}>
                    Show in Finder
                  </button>
                  <button type="button" className="link small" onClick={e => (e.stopPropagation(), void rm(k))}>
                    Delete
                  </button>
                </div>
                {open === k.dir &&
                  k.files.map(f => (
                    <div key={f.path} className="disk-row kept-file">
                      <span className="res-name mono small">{f.path}</span>
                      <span className="num">{sz(f.size)}</span>
                      <button type="button" className="link small" onClick={() => void api.open(k.dir, f.path).catch(fail)}>
                        Open
                      </button>
                      <button type="button" className="link small" data-tip="A new workspace with this file's path in its prompt" onClick={() => api.start(k, f.path)}>
                        Start a workspace with this
                      </button>
                    </div>
                  ))}
                {open === k.dir && k.n > k.files.length && <p className="muted small">and {k.n - k.files.length} more: Show in Finder</p>}
              </div>
            ))}
          </div>
        </>
      )}
      {err && list && <p className="muted small">{err}</p>}
    </Group>
  )
}
