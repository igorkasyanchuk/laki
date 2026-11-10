// The board (the sidebar's ▥, ⌘K, laki://board): every workspace as a card in a column by what it needs next (nextStep.ts
// boardCol, the row chip's and ⌘G's rules: Working, Answer, Review, Fix, Merge, Done), and Backlog: prompts waiting for a workspace. Start, or a drag
// onto another column, makes one with the default agent; a click on a card opens its workspace, a right click (or ⋯)
// is its menu: open, archive, delete; Done's ⋯ archives the merged ones. A to-do takes screenshots and files pasted or dropped
// in: their paths go after its text as it starts.
import { type DragEvent, type FormEvent, type MouseEvent, useState } from 'react'
import { BOARD, type BoardCol, boardCol } from '../../shared/nextStep'
import type { Todo, View, WorkspaceView } from '../../shared/types'
import { Thumbs } from './Ai'
import { Glyph, rollup } from './Glyph'
import { CiMark, prState } from './Info'
import { completeOf, FileChip, type Img, PromptInput } from './PromptInput'
import { wsShown } from './text'
import { Icon, IconButton, Page, TurnTime } from './ui'

export type BoardApi = {
  open: (ws: string) => void
  start: (t: Todo) => Promise<unknown>
  add: (project: string, text: string, images: string[]) => Promise<unknown>
  saveImage: (base64: string, ext: string) => Promise<string> // imageSave: the saved file's path
  saveFile: (base64: string, name: string) => Promise<string> // fileSave: another file's
  rm: (id: string) => Promise<unknown>
  menu: (e: MouseEvent, w: WorkspaceView) => void // a card's: open, archive, delete
  archiveAll: (e: MouseEvent, ws: WorkspaceView[]) => void // Done's ⋯: the merged ones
  merge: (w: WorkspaceView) => boolean // its project lets the app merge (nextStep's)
}

const TODO = 'text/x-laki-todo' // a dragged to-do's id
const isImage = (p: string) => /\/images\/[^/]+$/.test(p) // imageSave's (<data>/images/…), else fileSave's (<data>/files/<id>/<name>)

const TIPS: Record<BoardCol, string> = { working: 'An agent works, or its setup runs', answer: 'An agent asks you, or stopped', review: 'An agent finished: look at what it changed, then ship', fix: 'A failing check, CI, conflicts or a review asking for changes', merge: 'A PR open: its CI and reviews, then merge', done: 'Nothing left: merged, closed or untouched' }
const merged = (ws: { w: WorkspaceView }[]) => ws.map(c => c.w).filter(w => w.kind === 'worktree' && w.pr?.state === 'MERGED')

export function BoardPage({ view, timers, going = {}, api, onClose }: { view: View; timers?: boolean; going?: Record<string, string>; api: BoardApi; onClose: () => void }) {
  const [pick, setPick] = useState('')
  const projects = view.projects.filter(p => !p.kind) // Terminals and Browsers: no tasks
  const project = projects.some(p => p.id === pick) ? pick : (projects[0]?.id ?? '') // one picked, else the first (projects come and go)
  const [text, setText] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false) // images still on their way
  const [starting, setStarting] = useState<string[]>([]) // to-dos whose workspace is on its way
  const [over, setOver] = useState('') // the column a to-do is dragged over
  const name = (id: string) => view.projects.find(p => p.id === id)?.name ?? id
  const cards = view.workspaces
    .filter(w => !w.archived && !w.term && projects.some(p => p.id === w.project)) // a project's terminal: not a task
    .map(w => {
      const tabs = view.tabs.filter(t => t.workspace === w.id)
      return { w, tabs, col: boardCol(w, view.tabs, { merge: api.merge(w), git: view.projects.find(p => p.id === w.project)?.git !== false }) }
    })
  const todos = view.todos ?? []
  const start = (t: Todo) => {
    if (starting.includes(t.id)) return
    setStarting(s => [...s, t.id])
    api.start(t).catch(() => {}).finally(() => setStarting(s => s.filter(x => x !== t.id))) // a failure is the app's toast
  }
  const add = (e?: FormEvent) => {
    e?.preventDefault()
    if ((!text.trim() && !images.length) || !project || saving) return
    api.add(project, text, images.map(i => i.path)).then(() => (setText(''), setImages([])), () => {})
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
    <Page title="Board" esc={false} /* a page to stay on, as the rail's others */ onClose={onClose} wide>
      <div className="board">
        <section className="board-col">
          <h3>
            Backlog <span className="board-count">{todos.length || ''}</span>
          </h3>
          {todos.map(t => (
            <div key={t.id} className={`board-card todo ${starting.includes(t.id) ? 'busy' : ''}`} draggable onDragStart={e => e.dataTransfer.setData(TODO, t.id)}>
              {t.text && <div className="board-text">{t.text}</div>}
              {!!t.images?.some(isImage) && <Thumbs paths={t.images.filter(isImage)} />}
              {t.images?.filter(p => !isImage(p)).map(p => <FileChip key={p} path={p} />)}
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
          {projects.length > 0 && (
            <form className="board-add nw-card nw-composer" onSubmit={add}>{/* one box, as the new-workspace page's: the text, then attach, the project and Add in its row */}
              <PromptInput
                value={text}
                onChange={setText}
                images={images}
                onImages={setImages}
                save={api.saveImage}
                saveFile={api.saveFile}
                onSubmit={add}
                onBusy={setSaving}
                rows={3}
                focus={false}
                placeholder="What should an agent do? Paste or drop screenshots and files. (⌘⏎ adds it)"
                complete={completeOf(view, { project, files: true })}
                tools={
                  <>
                    {projects.length > 1 && (
                      <select value={project} onChange={e => setPick(e.target.value)} title="Project">
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="submit" className="primary" disabled={(!text.trim() && !images.length) || saving}>
                      Add
                    </button>
                  </>
                }
              />
            </form>
          )}
        </section>
        {BOARD.map(([col, title]) => {
          const ws = cards.filter(c => c.col === col)
          return (
            // U5: none in it: a narrow strip, its name down it and 0; wide again under the pointer or a dragged to-do
            <section key={col} className={`board-col ${over === col ? 'over' : ''} ${ws.length ? '' : 'empty'}`} data-tip={ws.length ? undefined : TIPS[col]} {...drop(col)}>
              <h3>
                {title} <span className="board-count">{ws.length || 0}</span>
                {col === 'done' && merged(ws).length > 0 && (
                  <>
                    <span className="spacer" />
                    <IconButton icon="more" title="Archive the merged ones" onClick={e => api.archiveAll(e, merged(ws))} />
                  </>
                )}
              </h3>
              {ws.map(({ w, tabs }) => {
                const last = tabs.find(t => t.kind === 'agent' && t.last)?.last
                return (
                  // a click anywhere opens it; from the keyboard its name does (a button), its ⋯ is one of its own
                  <div key={w.id} className={`board-card opens ${going[w.id] ? 'busy' : ''}`} onClick={() => api.open(w.id)} onContextMenu={e => api.menu(e, w)}>
                    <div className="board-foot">
                      <Glyph s={w.setup ? 'running' : rollup(tabs)} />
                      <button type="button" className="board-name" onClick={e => (e.stopPropagation(), api.open(w.id))}>
                        {wsShown(w)}
                      </button>
                      <span className="spacer" />
                      {going[w.id] ? <span className="muted small">{going[w.id]}…</span> : timers && <TurnTime tabs={tabs} />}
                      <button className="board-more" aria-label="More" data-tip="Open, archive, delete" onClick={e => (e.stopPropagation(), api.menu(e, w))}>
                        <Icon name="more" size={14} />
                      </button>
                    </div>
                    <div className="muted small">
                      {name(w.project)}
                      {w.branch && w.kind === 'worktree' ? ` · ${w.branch}` : ''}
                    </div>
                    {w.ticket && (
                      <div className="board-ticket small" data-tip={w.ticket.status}>
                        <b>{w.ticket.key}</b> {w.ticket.title ?? ''}{w.ticket.status ? ` · ${w.ticket.status}` : ''}
                      </div>
                    )}
                    {last && <div className="board-last">{last}</div>}
                    {w.pr && (
                      <div className="board-pr">
                        <span className={`ws-pr ${prState(w.pr)}`}>
                          <Icon name="github" size={11} /> #{w.pr.number}
                        </span>
                        {w.pr.checks ? <> · <span className={`ci-${w.pr.checks}`}><CiMark pr={w.pr} /></span></> : ''}
                        {w.pr.conflict && w.pr.state === 'OPEN' ? <> · <span className="ci-fail">conflicts</span></> : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </Page>
  )
}
