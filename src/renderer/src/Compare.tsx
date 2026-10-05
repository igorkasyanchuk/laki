// Compare (a race's page: the sidebar's ⚑ on a racing workspace, its menu, ⌘K): the workspaces one prompt went to,
// side by side: status, diff size, what the agent said last, the files it changed; Keep this one archives the others
import { useEffect, useState } from 'react'
import type { TabView, View, WorkspaceView } from '../../shared/types'
import { Glyph, rollup } from './Glyph'
import type { Changes } from './SidePanel'
import { Page, TurnTime } from './ui'

export type CompareApi = { open: (ws: string) => void; changes: (ws: string) => Promise<Changes>; keep: (winner: WorkspaceView, losers: WorkspaceView[]) => void }

export function ComparePage({ view, race, timers, api, onClose }: { view: View; race: string; timers?: boolean; api: CompareApi; onClose: () => void }) {
  const ws = view.workspaces.filter(w => w.race === race && !w.archived)
  return (
    <Page title={`Compare · ${ws.length} ${ws.length === 1 ? 'workspace' : 'workspaces'} on one prompt`} onClose={onClose} wide>
      {ws.length < 2 && <p className="muted">{ws.length ? 'The others are archived: this one is the race’s.' : 'Nothing left of this race.'}</p>}
      <div className="compare">
        {ws.map(w => (
          <Racer key={w.id} w={w} tabs={view.tabs.filter(t => t.workspace === w.id)} timers={timers} api={api} rest={ws.filter(x => x !== w)} />
        ))}
      </div>
    </Page>
  )
}

function Racer({ w, tabs, timers, api, rest }: { w: WorkspaceView; tabs: TabView[]; timers?: boolean; api: CompareApi; rest: WorkspaceView[] }) {
  const agent = tabs.find(t => t.kind === 'agent')
  const [files, setFiles] = useState<Changes['files'] | null>(null)
  const stat = JSON.stringify(w.stat ?? null)
  // the file list again whenever its diff size moves (the daemon's 10 s scan)
  useEffect(() => void api.changes(w.id).then(c => setFiles(c.files), () => setFiles([])), [w.id, stat])
  return (
    <section className="compare-col">
      <div className="compare-head">
        <Glyph s={w.setup ? 'running' : rollup(tabs)} />
        <b>{agent?.profile || agent?.preset || w.name || w.id}</b>
        <span className="spacer" />
        {timers && <TurnTime tabs={tabs} />}
      </div>
      <div className="muted small">
        {w.name || w.id} · {w.branch}
      </div>
      {w.stat && (w.stat.files > 0 || w.stat.dirty > 0) && (
        <div className="ws-stat compare-stat">
          <span className="add">+{w.stat.add}</span>
          <span className="del">−{w.stat.del}</span>
          <span className="muted">
            {' '}
            in {w.stat.files} {w.stat.files === 1 ? 'file' : 'files'}
            {w.stat.dirty ? `, ${w.stat.dirty} not committed` : ''}
          </span>
        </div>
      )}
      <div className="compare-last">{agent?.last || <span className="muted">Nothing said yet.</span>}</div>
      <div className="compare-files">
        {files === null && <span className="muted small">Reading its changes…</span>}
        {files?.length === 0 && <span className="muted small">No changes yet.</span>}
        {files?.map(f => (
          <div key={f.path} className="compare-file">
            <span className="mono">{f.path}</span>
            <span className="spacer" />
            <span className="add">+{f.add ?? 0}</span>
            <span className="del">−{f.del ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="row">
        <button onClick={() => api.open(w.id)}>Open</button>
        <span className="spacer" />
        {rest.length > 0 && (
          <button className="primary" onClick={() => api.keep(w, rest)}>
            Keep this one
          </button>
        )}
      </div>
    </section>
  )
}
