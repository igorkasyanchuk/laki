// The board (the sidebar's ▥, ⌘K, laki://board): every workspace as a card in a column by where it is (its agents
// at work, waiting for you, done, a PR open, merged), and To do: prompts waiting for a workspace. Start, or a drag
// onto another column, makes one with the default agent; a click on a card opens its workspace.
import { type DragEvent, type FormEvent, useState } from 'react'
import type { TabView, Todo, View, WorkspaceView } from '../../shared/types'
import { Glyph, rollup } from './Glyph'
import { ciText, prState } from './Info'
import { Icon, IconButton, Page, TurnTime } from './ui'

export type BoardApi = { open: (ws: string) => void; start: (t: Todo) => Promise<unknown>; add: (project: string, text: string) => Promise<unknown>; rm: (id: string) => Promise<unknown> }

const COLUMNS = [
  ['running', 'Running'],
  ['waiting', 'Needs you'],
  ['done', 'Done'],
  ['pr', 'PR open'],
  ['merged', 'Merged'],
] as const
type Column = (typeof COLUMNS)[number][0]
const TODO = 'text/x-laki-todo' // a dragged to-do's id

// where a workspace is: what its agents do first (a usage limit resumes by itself: still running; a failed one needs
// you), then its PR
function columnOf(w: WorkspaceView, tabs: TabView[]): Column {
  const s = w.setup ? 'running' : rollup(tabs.filter(t => t.kind === 'agent')) // agents' turns: a shell's dev server isn't one
  if (s === 'waiting' || tabs.some(t => t.kind === 'agent' && t.status === 'exited' && t.code !== 0)) return 'waiting' // a failed agent stays to read
  if (s === 'running' || s === 'limit') return 'running'
  return w.pr?.state === 'MERGED' ? 'merged' : w.pr?.state === 'OPEN' ? 'pr' : 'done'
}

export function BoardPage({ view, timers, api, onClose }: { view: View; timers?: boolean; api: BoardApi; onClose: () => void }) {
  const [pick, setPick] = useState('')
  const project = view.projects.some(p => p.id === pick) ? pick : (view.projects[0]?.id ?? '') // one picked, else the first (projects come and go)
  const [text, setText] = useState('')
  const [starting, setStarting] = useState<string[]>([]) // to-dos whose workspace is on its way
  const [over, setOver] = useState('') // the column a to-do is dragged over
  const name = (id: string) => view.projects.find(p => p.id === id)?.name ?? id
  const cards = view.workspaces
    .filter(w => !w.archived)
    .map(w => {
      const tabs = view.tabs.filter(t => t.workspace === w.id)
      return { w, tabs, col: columnOf(w, tabs) }
    })
  const todos = view.todos ?? []
  const start = (t: Todo) => {
    if (starting.includes(t.id)) return
    setStarting(s => [...s, t.id])
    api.start(t).catch(() => {}).finally(() => setStarting(s => s.filter(x => x !== t.id))) // a failure is the app's toast
  }
  const add = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim() || !project) return
    api.add(project, text).then(() => setText(''), () => {})
  }
  // a to-do dropped on a column of workspaces starts one
  const drop = (col: string) => ({
    onDragOver: (e: DragEvent) => e.dataTransfer.types.includes(TODO) && (e.preventDefault(), setOver(col)),
    onDragLeave: (e: DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(''),
    onDrop: (e: DragEvent) => {
      setOver('')
      const t = todos.find(t => t.id === e.dataTransfer.getData(TODO))
      if (t) e.preventDefault(), start(t)
    },
  })
  return (
    <Page title="Board" onClose={onClose} wide>
      <div className="board">
        <section className="board-col">
          <h3>
            To do <span className="board-count">{todos.length || ''}</span>
          </h3>
          {todos.map(t => (
            <div key={t.id} className={`board-card todo ${starting.includes(t.id) ? 'busy' : ''}`} draggable onDragStart={e => e.dataTransfer.setData(TODO, t.id)}>
              <div className="board-text">{t.text}</div>
              <div className="board-foot">
                <span className="muted small">{name(t.project)}</span>
                <span className="spacer" />
                {starting.includes(t.id) ? (
                  <span className="muted small">Starting…</span>
                ) : (
                  <>
                    <IconButton icon="trash" title="Delete" onClick={() => api.rm(t.id).catch(() => {})} />
                    <IconButton icon="run" title={`Start: a new workspace with ${view.settings.agent || 'claude'} on it`} onClick={() => start(t)} />
                  </>
                )}
              </div>
            </div>
          ))}
          {view.projects.length > 0 && (
            <form className="board-add" onSubmit={add}>
              <textarea value={text} rows={3} placeholder="What should an agent do? (⌘⏎ adds it)" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.metaKey && add()} />
              <div className="board-foot">
                {view.projects.length > 1 && (
                  <select value={project} onChange={e => setPick(e.target.value)} title="Project">
                    {view.projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="spacer" />
                <button type="submit" disabled={!text.trim()}>
                  Add
                </button>
              </div>
            </form>
          )}
        </section>
        {COLUMNS.map(([col, title]) => {
          const ws = cards.filter(c => c.col === col)
          return (
            <section key={col} className={`board-col ${over === col ? 'over' : ''}`} {...drop(col)}>
              <h3>
                {title} <span className="board-count">{ws.length || ''}</span>
              </h3>
              {ws.map(({ w, tabs }) => {
                const last = tabs.find(t => t.kind === 'agent' && t.last)?.last
                return (
                  <button key={w.id} className="board-card" onClick={() => api.open(w.id)}>
                    <div className="board-foot">
                      <Glyph s={w.setup ? 'running' : rollup(tabs)} />
                      <b className="board-name">{w.name || w.id}</b>
                      <span className="spacer" />
                      {timers && <TurnTime tabs={tabs} />}
                    </div>
                    <div className="muted small">
                      {name(w.project)}
                      {w.branch && w.kind === 'worktree' ? ` · ${w.branch}` : ''}
                    </div>
                    {last && <div className="board-last">{last}</div>}
                    {w.pr && (
                      <div className={`ws-pr board-pr ${prState(w.pr)} ${w.pr.checks === 'fail' && w.pr.state === 'OPEN' ? 'fail' : ''}`}>
                        <Icon name="github" size={11} /> #{w.pr.number}
                        {w.pr.checks ? ` · ${ciText(w.pr)}` : ''}
                        {w.pr.conflict && w.pr.state === 'OPEN' ? ' · conflicts' : ''}
                      </div>
                    )}
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </Page>
  )
}
