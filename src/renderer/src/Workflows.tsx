// Workflows (experimental: Settings › General; the rail's Workflows, ⌘K): an index like Scheduled tasks (the workflows,
// yours and each project's, and their runs), then one workflow or one run on a page of its own, breadcrumbs back. A
// workflow opens on a canvas (blocks dragged where they go, exits as arrows) with an inspector for the picked block, or
// as its Markdown file; both edit the same text (shared/workflow.ts parse/toFile). A run opens on the same canvas, lit
// where it is and where it went, with what it asks you, its decisions, its variables, and its whole log. Esc doesn't
// close the page: it stays open while runs go. The engine is the daemon's (daemon/workflow.ts). Loaded as the page
// opens (App's lazy import).
import { type ChangeEvent, type PointerEvent as PE, useEffect, useMemo, useRef, useState } from 'react'
import { findAction, mergeActions, type Preset, type Project, type RunAction, type WorkspaceView } from '../../shared/types'
import { ago } from '../../shared/widget'
import { ACTIONS, BAD_EXITS, BLOCK_NAMES, blockName, branchLabel, branchOf, type Block, type BlockKind, check, EXITS, exitsOf, FLOW_ENDED, type FlowRun, type FlowView, flowView, MAX_BLOCKS, optioned, parse, RESULTS, runOf, SESSIONS, TESTS, toFile, WAITS, WHERES, type Workflow, type WorkflowItem, type WorkflowSource } from '../../shared/workflow'
import { Markdown } from './MarkdownView'
import { ask, Icon, IconButton, type MenuItem, Page, Switch, useMenu } from './ui'
import './workflows.css'

export type WorkflowsApi = {
  call: <T = any>(method: string, params?: object) => Promise<T>
  openWs: (id: string) => void
  openTab?: (ws: string, tab: string) => void // a block's session, in its workspace
  toast: (text: string) => void
}
type Sel = { id: string; source: WorkflowSource; project?: string }
type At = { kind: 'index' } | { kind: 'wf'; sel: Sel } | { kind: 'run'; id: string }
const W = 180
const H = 58
const RUNS_SHOWN = 12
const KIND_COLOR: Record<BlockKind, string> = { start: 'teal', agent: 'purple', run: 'blue', choice: 'yellow', case: 'yellow', ask: 'orange', action: 'green', wait: 'pink', save: 'lime', end: 'gray' }
const STATUS_WORDS: Record<string, string> = { running: 'running', waiting: 'asks you', paused: 'paused', done: 'done', stopped: 'stopped', failed: 'failed' }
const same = (a: Sel | null | undefined, w: { id: string; source: WorkflowSource; project?: string }) => !!a && a.id === w.id && a.source === w.source && (a.project ?? '') === (w.project ?? '')
const ended = (r: { status: FlowRun['status'] }) => FLOW_ENDED.includes(r.status)
// unsaved edits, by workflow: kept while Laki runs, whatever closes the editor (the rail, another page, a notification)
const drafts = new Map<string, string>()
const keyOf = (w: { id: string; source: WorkflowSource; project?: string }) => `${w.source}/${w.project ?? ''}/${w.id}`

// the agent actions a workflow's blocks can use (Run ▾'s: Settings', and the project's or, for yours, every project's)
function agentActions(global: RunAction[] | undefined, projects: Project[], item: { source: WorkflowSource; project?: string }) {
  const own = item.source === 'project' ? projects.filter(p => p.id === item.project) : projects
  const l = own.length === 1 ? mergeActions(global, own[0].config?.actions) : [...mergeActions(global), ...own.flatMap(p => mergeActions([], p.config?.actions))]
  return l.filter((a, i) => a.target !== 'shell' && l.findIndex(b => b.target !== 'shell' && ref(b) === ref(a)) === i)
}
const ref = (a: RunAction) => a.slug ?? a.name // what use: names (an older daemon's actions have no slug)

export function WorkflowsPage({ view, projects, presets, actions, at: first, api, onClose }: { view: { flows?: FlowView[]; workspaces: WorkspaceView[]; tabs: { id: string }[] }; projects: Project[]; presets: Preset[]; actions?: RunAction[]; at?: { run?: string }; api: WorkflowsApi; onClose: () => void }) {
  const [list, setList] = useState<WorkflowItem[] | null>(null)
  const [at, setAt] = useState<At>(first?.run ? { kind: 'run', id: first.run } : { kind: 'index' })
  const [starting, setStarting] = useState<WorkflowItem | null>(null)
  const [allRuns, setAllRuns] = useState(false)
  const [menu, openMenu] = useMenu()
  const refresh = () => api.call<WorkflowItem[]>('flowList', {}).then(setList, () => setList([]))
  useEffect(() => void refresh(), [])
  const flows = [...(view.flows ?? [])].sort((a, b) => Number(ended(a)) - Number(ended(b)) || b.started - a.started)
  const pname = (id?: string) => projects.find(p => p.id === id)?.name ?? id ?? ''
  const cur = at.kind === 'wf' ? list?.find(w => same(at.sel, w)) : undefined
  const run = at.kind === 'run' ? flows.find(r => r.id === at.id) : undefined
  const going = flows.filter(r => !ended(r))
  const asks = flows.filter(r => r.status === 'waiting').length
  const done = flows.filter(ended)
  const ok = done.filter(r => r.status === 'done').length
  const failed = done.filter(r => r.status === 'failed').length

  // a new one: yours, or a project's (.laki/workflows in its repo); a copy of one, or a start, an agent and an end
  const create = (into: { source: 'yours' } | { source: 'project'; project: string }, from?: WorkflowItem) => {
    const taken = new Set(list?.filter(w => w.source === into.source && (w.project ?? '') === ('project' in into ? into.project : '')).map(w => w.id))
    const base = from ? `${from.id.slice(0, 30)}-copy` : 'workflow' // an id is 41 characters at most
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    const text = from ? toFile({ ...from, name: `${from.name} (copy)` }) : BLANK
    api.call<WorkflowItem>('flowSave', { id, text, ...into }).then(w => (refresh(), setAt({ kind: 'wf', sel: w })), e => api.toast((e as Error).message))
  }
  const intoOf = (w: WorkflowItem) => (w.source === 'project' ? { source: 'project' as const, project: w.project! } : { source: 'yours' as const })
  const newMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { head: 'A new workflow' },
      { label: 'Yours', sub: 'In Laki, for any project', icon: 'plus', run: () => create({ source: 'yours' }) },
      ...projects.filter(p => !p.host).map((p): MenuItem => ({ label: p.name, sub: 'In its repo: .laki/workflows', icon: 'fork', run: () => create({ source: 'project', project: p.id }) })),
    ])
  const removeWf = async (w: WorkflowItem) => {
    if (!(await ask(`Delete ${w.name}?`, { text: `${w.path ?? ''}\nIts runs stay on the list.`, ok: 'Delete', danger: true }))) return false
    return api.call('flowRm', { id: w.id, source: w.source, project: w.project }).then(
      () => (refresh(), true),
      e => (api.toast((e as Error).message), false),
    )
  }
  const removeRun = async (r: FlowView) => {
    const live = !ended(r)
    if (!(await ask('Delete this run?', { text: `${r.task || r.name}\n${live ? 'It stops first. ' : ''}Its workspace and its agents' tabs stay.`, ok: 'Delete', danger: true }))) return false
    return api.call('flowForget', { id: r.id }).then(
      () => true,
      e => (api.toast((e as Error).message), false),
    )
  }

  const crumbs = (
    <nav className="crumbs" aria-label="Where you are">
      {at.kind === 'index' ? (
        <b className="crumb here">Workflows</b>
      ) : (
        <button className="crumb" onClick={() => (setAt({ kind: 'index' }), refresh())}>
          Workflows
        </button>
      )}
      {at.kind !== 'index' && <span className="crumb-sep">›</span>}
      {at.kind === 'wf' && <b className="crumb here">{cur?.name ?? at.sel.id}</b>}
      {at.kind === 'run' && <b className="crumb here">{run ? `${run.name} · ${run.task || 'a run'}` : 'A run'}</b>}
      <span className="wf-beta">experimental</span>
    </nav>
  )

  return (
    <Page title="Workflows" head={crumbs} wide={at.kind !== 'index'} esc={false} onClose={onClose}>
      {at.kind === 'index' ? (
        <div className="schedules wf-index">
          <header className="sched-hero">
            <span className="sched-hero-icon">
              <Icon name="flow" size={20} />
            </span>
            <p className="muted">Blocks Laki runs for a task, one after another: agents, commands, questions for you, a PR, its checks, files for its Artifacts. Each run gets a workspace of its own and keeps what it decided.</p>
            <span className="sched-hero-acts">
              <button type="button" className="primary" disabled={list === null} onClick={newMenu}>
                <Icon name="plus" /> New workflow
              </button>
            </span>
          </header>
          {(list?.length || flows.length) > 0 && (
            <div className="sched-stats">
              <div>
                <b>{list?.length ?? '—'}</b>
                <span>{list?.length === 1 ? 'workflow' : 'workflows'}</span>
              </div>
              <div>
                <b>{going.length}</b>
                <span>running</span>
              </div>
              <div className={asks ? 'warn' : ''}>
                <b>{asks}</b>
                <span>ask you</span>
              </div>
              <div className={failed ? 'bad' : ''}>
                <b>{done.length ? `${ok}/${done.length}` : '—'}</b>
                <span>runs done</span>
              </div>
            </div>
          )}

          <section>
            <div className="sched-head">
              <h3>Workflows</h3>
              {!!list?.length && <span className="muted small">{list.length}</span>}
            </div>
            {list === null ? (
              <p className="muted small">Loading…</p>
            ) : list.length ? (
              <div className="sched-list">
                {list.map(w => {
                  const n = going.filter(r => runOf(r, w)).length
                  return (
                    <div key={`${w.source}/${w.project}/${w.id}`} className="sched-row">
                      <span className="sched-icon">
                        <Icon name="flow" />
                      </span>
                      <button type="button" className="sched-main" data-tip="Open" onClick={() => setAt({ kind: 'wf', sel: w })}>
                        <span className="sched-name">{w.name}</span>
                        <span className="sched-meta">
                          {w.problems.length ? <b className="wf-bad">{w.problems[0]}</b> : <span>{w.desc || `${w.blocks.length} blocks`}</span>}
                          {n > 0 && <span className="sched-next">{n} running</span>}
                        </span>
                        <span className="sched-tags">
                          <span className="tag">{w.source === 'project' ? pname(w.project) : 'yours'}</span>
                          <span className="tag">{w.where === 'main' ? 'project folder' : 'worktree'}</span>
                          <span className="tag">{w.blocks.length} blocks</span>
                          {w.byAgent && <span className="tag warn">by an agent</span>}
                          {drafts.has(keyOf(w)) && <span className="tag warn">unsaved changes</span>}
                        </span>
                      </button>
                      <span className="sched-acts">
                        <IconButton icon="run" title={w.problems.length ? `Can't run: ${w.problems[0]}` : 'Run it'} onClick={() => (w.problems.length ? setAt({ kind: 'wf', sel: w }) : setStarting(w))} />
                        <IconButton icon="copy" title="Make a copy" onClick={() => create(intoOf(w), w)} />
                        <IconButton icon="trash" title="Delete" onClick={() => void removeWf(w)} />
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="sched-empty">
                <Icon name="flow" size={18} />
                <span>
                  <b>No workflows yet</b>
                  <span className="muted small">Like “plan, ask me, build, test, review, open a PR”. New workflow makes one; Laki AI and your agents can write one too.</span>
                </span>
              </div>
            )}
          </section>

          <section>
            <div className="sched-head">
              <h3>Runs</h3>
              {flows.length > 0 && (
                <span className="muted small">
                  {flows.length}
                  {failed > 0 && <span className="sched-failed"> · {failed} failed</span>}
                </span>
              )}
            </div>
            {!flows.length ? (
              <p className="muted small">None yet: open a workflow and Run it.</p>
            ) : (
              <div className="sched-list">
                {(allRuns ? flows : flows.slice(0, RUNS_SHOWN)).map(r => (
                  <div key={r.id} className="sched-run live wf-run-row" data-status={r.status} role="button" tabIndex={0} onClick={() => setAt({ kind: 'run', id: r.id })} onKeyDown={e => e.target === e.currentTarget && e.key === 'Enter' && setAt({ kind: 'run', id: r.id })}>
                    <span className="wf-status-dot" />
                    <b>{r.task || r.name}</b>
                    <span className="muted">
                      {r.name} · {STATUS_WORDS[r.status]}
                      {!ended(r) && r.block ? ` · ${r.block}` : ''}
                    </span>
                    <span className="sched-run-at">{ago(r.ended ?? r.started)}</span>
                    <span className="sched-acts" onClick={e => e.stopPropagation()}>
                      <IconButton icon="trash" title="Delete this run" onClick={() => void removeRun(r)} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {flows.length > RUNS_SHOWN && (
              <button type="button" className="link small sched-more" onClick={() => setAllRuns(a => !a)}>
                {allRuns ? 'Show fewer' : `Show all ${flows.length}`}
              </button>
            )}
          </section>
        </div>
      ) : (
        <div className="wf-page">
          {at.kind === 'run' ? (
            <RunView key={at.id} id={at.id} entry={run} api={api} pname={pname} ws={view.workspaces} tabs={view.tabs.map(t => t.id)} onGone={() => setAt({ kind: 'index' })} onDelete={r => removeRun(r).then(y => y && setAt({ kind: 'index' }))} />
          ) : cur ? (
            <Editor
              key={`${cur.source}/${cur.project}/${cur.id}`}
              item={cur}
              projects={projects}
              presets={presets}
              actions={agentActions(actions, projects, cur)}
              api={api}
              runs={going.filter(r => runOf(r, cur))}
              onSaved={w => (refresh(), setAt({ kind: 'wf', sel: w }))}
              onRemove={() => removeWf(cur).then(y => y && (drafts.delete(keyOf(cur)), setAt({ kind: 'index' })))}
              onRun={() => setStarting(cur)}
              onOpenRun={id => setAt({ kind: 'run', id })}
              onCopy={() => create(intoOf(cur), cur)}
            />
          ) : (
            <div className="wf-empty">{list === null ? 'Loading…' : 'That workflow is gone.'}</div>
          )}
        </div>
      )}
      {starting && <StartRun item={starting} projects={projects} api={api} onClose={() => setStarting(null)} onStarted={id => (setStarting(null), setAt({ kind: 'run', id }))} />}
      {menu}
    </Page>
  )
}

// a field whose text goes through the workflow's Markdown and back (parse trims it and joins its lines; a number left
// empty is its default): what's typed stays as typed while it has the focus, or a space before the next word, a new
// line or an emptied number would be gone as it's typed. A value changed elsewhere meanwhile (the File tab) wins
function Typed({ area, value, onText, ...rest }: { area?: boolean; value: string | number; onText: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean; 'aria-label'?: string; type?: string; min?: number; max?: number; className?: string }) {
  const [typed, setTyped] = useState<string | null>(null)
  const was = useRef<string | null>(null) // the value as the last keystroke left it
  const now = String(value)
  if (typed === null) was.current = null
  else if (was.current === null) was.current = now
  const p = { ...rest, value: typed !== null && was.current === now ? typed : now, onChange: (e: ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => ((was.current = null), setTyped(e.target.value), onText(e.target.value)), onBlur: () => setTyped(null) }
  return area ? <textarea {...p} /> : <input {...p} />
}

const BLANK = toFile({ id: 'workflow', name: 'New workflow', desc: 'What it does, in a line.', where: 'worktree', session: 'new', blocks: [
  { id: 'start', kind: 'start', input: 'task', to: { next: 'work' }, at: [70, 20] },
  { id: 'work', kind: 'agent', name: 'Work on it', agent: 'claude', text: '{{task}}', to: { next: 'done' }, at: [70, 110] },
  { id: 'done', kind: 'end', name: 'Done', result: 'success', notify: true, at: [70, 200] },
] })

// ---------- the canvas: blocks where they are (at), else a column in their order

function placed(blocks: Block[]): Map<string, [number, number]> {
  const m = new Map<string, [number, number]>()
  blocks.forEach((b, i) => m.set(b.id, b.at ?? [70, 20 + i * 90]))
  return m
}

// an arrow from a to b: down when b is below, sideways when beside, around the side when it goes back up
function geo(a: [number, number], b: [number, number], i: number, k: number) {
  const [ax, ay] = a
  const [bx, by] = b
  if (by >= ay + H + 14) {
    const sx = ax + (W * (i + 1)) / (k + 1), sy = ay + H, tx = bx + W / 2, ty = by, dy = Math.max(26, (ty - sy) / 2)
    return [sx, sy, sx, sy + dy, tx, ty - dy, tx, ty]
  }
  if (bx >= ax + W) {
    const sx = ax + W, sy = ay + H / 2, tx = bx, ty = by + H / 2, dx = Math.max(30, (tx - sx) / 2)
    return [sx, sy, sx + dx, sy, tx - dx, ty, tx, ty]
  }
  if (bx + W <= ax) {
    const sx = ax, sy = ay + H / 2, tx = bx + W, ty = by + H / 2, dx = Math.max(30, (sx - tx) / 2)
    return [sx, sy, sx - dx, sy, tx + dx, ty, tx, ty]
  }
  const left = ax < 300, side = left ? -1 : 1
  const sx = left ? ax : ax + W, tx = left ? bx : bx + W, sy = ay + H / 2, ty = by + H / 2, d = 40 + Math.min(40, Math.abs(sy - ty) / 6)
  return [sx, sy, sx + side * d, sy, tx + side * d, ty, tx, ty]
}

function subOf(b: Block) {
  switch (b.kind) {
    case 'start': return b.input === 'task' ? 'a task' : ''
    case 'agent': return [b.agent || 'claude', b.use, b.model, b.effort].filter(Boolean).join(' · ')
    case 'run': return b.cmd ?? ''
    case 'ask': return b.question ?? ''
    case 'choice': return `${b.of ?? ''} ${b.test ?? 'contains'} "${b.value ?? ''}"`
    case 'case': return [b.of, `${b.options?.length ?? 0} ways`].filter(Boolean).join(' · ')
    case 'action': return (ACTIONS[b.action ?? ''] ?? b.action ?? '') + (b.confirm === false ? '' : ['ship', 'approve', 'merge', 'archive'].includes(b.action ?? '') ? ' · asks first' : '')
    case 'wait': return WAITS[b.for ?? ''] ?? b.for ?? ''
    case 'save': return b.link !== undefined ? `link: ${b.link}` : b.from !== undefined ? `${b.from} → ${b.file ?? ''}` : b.file ?? ''
    case 'end': return `${b.result ?? 'success'}${b.notify ? ' · notify' : ''}`
  }
}

type Lit = { state: Record<string, 'running' | 'waiting' | 'done' | 'failed'>; taken: Set<string>; visits: Record<string, number>; live?: string } // live: the arrow it just took, while it runs

function Canvas({ wf, sel, onPick, onMove, lit }: { wf: Workflow; sel?: string | null; onPick?: (id: string | null) => void; onMove?: (id: string, at: [number, number]) => void; lit?: Lit }) {
  const pos = placed(wf.blocks)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)
  if (drag) pos.set(drag.id, [drag.x, drag.y])
  const maxX = Math.max(0, ...[...pos.values()].map(p => p[0])) + W + 140
  const maxY = Math.max(0, ...[...pos.values()].map(p => p[1])) + H + 80
  const by = new Map(wf.blocks.map(b => [b.id, b]))
  const down = (e: PE, b: Block) => {
    if (e.button !== 0) return
    const [x, y] = pos.get(b.id)!
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: b.id, dx: e.clientX - x, dy: e.clientY - y, x, y, moved: false })
    onPick?.(b.id)
  }
  const move = (e: PE) => drag && onMove && setDrag({ ...drag, x: Math.max(0, Math.round((e.clientX - drag.dx) / 10) * 10), y: Math.max(0, Math.round((e.clientY - drag.dy) / 10) * 10), moved: true })
  const up = () => {
    if (drag?.moved) onMove?.(drag.id, [drag.x, drag.y])
    setDrag(null)
  }
  const paths: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  for (const a of wf.blocks) {
    const ex = exitsOf(a).filter(e => e.to && by.has(e.to) && e.to !== a.id)
    ex.forEach((e, i) => {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = geo(pos.get(a.id)!, pos.get(e.to!)!, i, ex.length)
      const key = `${a.id}>${e.to}`
      const cls = lit?.live === key ? 'live' : lit?.taken.has(key) ? 'taken' : e.bad ? 'bad' : ''
      const d = `M${x0},${y0} C${x1},${y1} ${x2},${y2} ${x3},${y3}`
      paths.push(<path key={`${a.id}-${e.name}`} className={`wf-e ${cls}`} d={d} markerEnd={`url(#wf-ah${cls ? `-${cls}` : ''})`} />)
      // the way it just went, while the next block works: a dot running along it
      if (cls === 'live')
        paths.push(
          <circle key={`${a.id}-${e.name}-dot`} className="wf-run-dot" r="3.5">
            <animateMotion dur="1.3s" repeatCount="indefinite" path={d} />
          </circle>,
        )
      if (e.name !== 'next' && (ex.length > 1 || e.max || optioned(a.kind)))
        labels.push(
          <div key={`${a.id}-${e.name}`} className={`wf-el ${cls}`} style={{ left: (x0 + 3 * x1 + 3 * x2 + x3) / 8, top: (y0 + 3 * y1 + 3 * y2 + y3) / 8 }}>
            {e.name.length > 28 ? `${e.name.slice(0, 27)}…` : e.name}
          </div>,
        )
    })
  }
  return (
    <div className="wf-scroll" onPointerDown={e => e.target === e.currentTarget && onPick?.(null)}>
      <div className="wf-canvas" style={{ width: maxX, height: maxY }} onPointerDown={e => e.target === e.currentTarget && onPick?.(null)}>
        <svg width={maxX} height={maxY}>
          <defs>
            {['', '-bad', '-taken', '-live'].map(s => (
              <marker key={s} id={`wf-ah${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path className={`wf-ah ${s.slice(1)}`} d="M0,1 L10,5 L0,9 z" />
              </marker>
            ))}
          </defs>
          {paths}
        </svg>
        {labels}
        {wf.blocks.map(b => {
          const [x, y] = pos.get(b.id)!
          const st = lit?.state[b.id]
          const n = lit?.visits[b.id] ?? 0
          return (
            <div
              key={b.id}
              className={`wf-node ${b.kind === 'start' || b.kind === 'end' ? 'pill' : ''} ${sel === b.id ? 'sel' : ''} ${drag?.id === b.id ? 'dragging' : ''}`}
              style={{ left: x, top: y, ['--kc' as string]: `var(--tc-${KIND_COLOR[b.kind]})` }}
              data-kind={b.kind}
              data-state={st}
              onPointerDown={e => down(e, b)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setDrag(null)}
            >
              <div className="k">
                <i />
                {BLOCK_NAMES[b.kind]}
              </div>
              <div className="t">{blockName(b)}</div>
              <div className="s">{subOf(b)}</div>
              {(b.max || n > 1) && <span className="tries">{b.max ? `${n}/${b.max.n}` : `×${n}`}</span>}
              {st && <span className="badge">{st === 'running' ? <span className="wf-gear"><Icon name="gear" size={16} /></span> : { waiting: '?', done: '✓', failed: '✕' }[st]}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- the editor: canvas and inspector, or the file

function Editor({ item, projects, presets, actions, api, runs, onSaved, onRemove, onRun, onOpenRun, onCopy }: { item: WorkflowItem; projects: Project[]; presets: Preset[]; actions: RunAction[]; api: WorkflowsApi; runs: FlowView[]; onSaved: (w: WorkflowItem) => void; onRemove: () => void; onRun: () => void; onOpenRun: (id: string) => void; onCopy: () => void }) {
  const [text, setText] = useState(drafts.get(keyOf(item)) ?? item.text)
  const [mode, setMode] = useState<'canvas' | 'file'>('canvas')
  const [pick, setPick] = useState<string | null>(null)
  const [menu, openMenu] = useMenu()
  const parsed = useMemo(() => parse(text, item.id), [text])
  const wf = parsed.workflow
  const problems = [...parsed.problems, ...check(wf)]
  const dirty = text !== item.text
  useEffect(() => void (dirty ? drafts.set(keyOf(item), text) : drafts.delete(keyOf(item))), [text, item.text])
  const edit = (f: (w: Workflow) => void) => {
    const w: Workflow = JSON.parse(JSON.stringify(wf))
    f(w)
    setText(toFile(w))
  }
  const save = () => api.call<WorkflowItem>('flowSave', { id: item.id, source: item.source, project: item.project, text }).then(onSaved, e => api.toast((e as Error).message))
  // ⌘S saves
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.metaKey && e.key === 's' && (e.preventDefault(), saveRef.current())
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const addBlock = (kind: BlockKind, more: Partial<Block> = {}) =>
    edit(w => {
      const ids = new Set(w.blocks.map(b => b.id))
      let id: string = kind
      for (let n = 2; ids.has(id); n++) id = `${kind}${n}`
      const from = w.blocks.find(b => b.id === pick) ?? w.blocks.at(-1)
      const pos = placed(w.blocks)
      const [fx, fy] = from ? pos.get(from.id)! : [70, 20]
      const b: Block = { id, kind, ...NEW_BLOCK[kind], ...more, at: [fx, fy + 90] }
      // between the picked block and where its first good exit went
      if (from && !optioned(from.kind) && from.kind !== 'end') {
        const e = EXITS[from.kind].find(x => !BAD_EXITS.includes(x)) ?? EXITS[from.kind][0]
        const was = from.to?.[e]
        from.to = { ...from.to, [e]: id }
        if (was && !optioned(kind) && kind !== 'end') b.to = { [EXITS[kind][0]]: was }
        for (const o of w.blocks) if (o !== from && o.at && o.at[1] > fy && Math.abs(o.at[0] - fx) < W) o.at = [o.at[0], o.at[1] + 90] // room below
      }
      w.blocks.push(b)
      setPick(id)
    })
  const where = (
    <span className="wf-facts">
      <select value={wf.where} onChange={e => edit(w => void (w.where = e.target.value as Workflow['where']))} data-tip="Where each run works">
        {Object.entries(WHERES).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <select value={wf.session} onChange={e => edit(w => void (w.session = e.target.value as Workflow['session']))} data-tip="Its agents' sessions">
        {Object.entries(SESSIONS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </span>
  )
  return (
    <div className="wf-editor">
      <div className="wf-head">
        <div className="wf-title">
          <b>{wf.name}</b>
          <span className="wf-src">{item.source === 'yours' ? 'yours' : `${projects.find(p => p.id === item.project)?.name ?? item.project} · .laki/workflows/${item.id}.md`}</span>
          {wf.desc && <span className="wf-desc">{wf.desc}</span>}
          {item.byAgent && <span className="wf-agent">An agent wrote it: read it, then Save it, before agents may run it</span>}
        </div>
        <span className="grow" />
        <div className="seg">
          <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>Blocks</button>
          <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>File</button>
        </div>
        {dirty && (
          <button className="btn" onClick={() => setText(item.text)} data-tip="Back to the saved file">
            Discard
          </button>
        )}
        <button className="btn" disabled={!dirty && !item.byAgent} onClick={save} data-tip={item.byAgent ? 'An agent wrote it: saving it here says you read it, and lets agents run it' : '⌘S'}>{dirty || item.byAgent ? 'Save' : 'Saved'}</button>
        {runs.length > 0 && (
          <button className="btn" onClick={() => onOpenRun(runs[0].id)} data-tip={runs.map(r => `${r.task || r.name}: ${STATUS_WORDS[r.status]}`).join('\n')}>
            <span className="wf-dot" /> {runs.length} running
          </button>
        )}
        <IconButton icon="copy" title="Make a copy" onClick={onCopy} />
        <IconButton icon="trash" title="Delete this workflow" onClick={onRemove} />
        <button className="btn primary" disabled={problems.length > 0 || dirty} onClick={onRun} data-tip={problems[0] ?? (dirty ? 'Save it first' : 'Start a run')}>
          <Icon name="run" size={12} /> Run
        </button>
      </div>
      <div className="wf-bar">
        {where}
        {mode === 'canvas' && (
          <button className="btn small" disabled={wf.blocks.length >= MAX_BLOCKS} data-tip={wf.blocks.length >= MAX_BLOCKS ? `${MAX_BLOCKS} blocks at most` : undefined} onClick={e => openMenu(e, blockMenu(pick ? `After ${blockName(wf.blocks.find(b => b.id === pick) ?? { id: pick, kind: 'agent' })}` : 'A new block', actions, presets, addBlock))}>
            <Icon name="plus" size={12} /> Block
          </button>
        )}
        {problems.length > 0 && (
          <span className="wf-problems" data-tip={problems.join('\n')}>
            {problems.length === 1 ? problems[0] : `${problems[0]} · ${problems.length - 1} more`}
          </span>
        )}
      </div>
      {mode === 'canvas' ? (
        <div className="wf-split">
          <Canvas wf={wf} sel={pick} onPick={setPick} onMove={(id, at) => edit(w => void (w.blocks.find(b => b.id === id)!.at = at))} />
          <Inspector wf={wf} id={pick} presets={presets} actions={actions} edit={edit} onPick={setPick} />
        </div>
      ) : (
        <div className="wf-file">
          <textarea value={text} spellCheck={false} onChange={e => setText(e.target.value)} />
          <details className="wf-format">
            <summary>The format</summary>
            <Markdown src={FORMAT_HELP} />
          </details>
        </div>
      )}
      {menu}
    </div>
  )
}

const KIND_SAYS: Record<BlockKind, string> = {
  start: 'Where it begins',
  agent: 'A prompt to an agent; waits for its turn to end',
  run: 'A shell command: ok or fail by its exit code',
  choice: 'Yes or no, by what a block said (if / else)',
  case: 'Many ways: the first branch that holds (if / elsif / else)',
  ask: 'A question with buttons, for you',
  action: 'Open a PR, approve, merge, dev server, archive',
  wait: 'Until its PR’s checks pass or fail',
  save: 'Text, a file or a link, into the workspace’s Artifacts',
  end: 'Done, stopped or failed',
}
const NEW_BLOCK: Record<BlockKind, Partial<Block>> = {
  start: { input: 'task' },
  agent: { name: 'Agent', agent: 'claude', text: '{{task}}' },
  run: { name: 'Tests', cmd: 'npm test' },
  choice: { name: 'If', of: 'answer', test: 'contains', value: 'yes', options: [{ label: 'Yes' }, { label: 'No' }] },
  case: { name: 'Case', of: 'answer', options: [{ label: 'equals "only_specs"' }, { label: 'contains "fix"' }, { label: 'else' }] },
  ask: { name: 'Ask you', question: 'Go on?', options: [{ label: 'Yes' }, { label: 'Stop' }] },
  action: { name: 'Open a PR', action: 'ship', text: '{{task}}' },
  wait: { name: 'CI checks', for: 'checks' },
  save: { name: 'Save', file: 'notes.md', text: '{{steps.work.answer}}' },
  end: { name: 'Done', result: 'success' },
}
// + Block's menu: each kind, an agent action (Run ▾'s) as an agent block, and the three ways to keep something
function blockMenu(head: string, actions: RunAction[], presets: Preset[], add: (k: BlockKind, more?: Partial<Block>) => void): MenuItem[] {
  const one = (k: BlockKind): MenuItem => ({ label: BLOCK_NAMES[k], sub: KIND_SAYS[k], run: () => add(k) })
  const presetOf = (a: RunAction) => (a.target !== 'any' && presets.some(p => p.name === a.target) ? a.target : undefined)
  return [
    { head },
    one('agent'),
    actions.length
      ? { label: 'Agent action', sub: 'One of Run ▾’s, as an agent block', items: actions.map((a): MenuItem => ({ label: a.name, sub: a.slug, pill: a.target === 'any' ? undefined : a.target, run: () => add('agent', { name: a.name, use: ref(a), text: undefined, ...(presetOf(a) && { agent: presetOf(a) }) }) })) }
      : { label: 'Agent action', sub: 'None yet: Settings › Actions', run: () => add('agent') },
    ...(['run', 'choice', 'case', 'ask', 'action', 'wait'] as const).map(one),
    { head: 'Into its Artifacts' },
    { label: 'Save text', sub: 'An answer, notes: a file in the storage folder', run: () => add('save') },
    { label: 'Save a file', sub: 'A file or folder of the workspace, copied there', run: () => add('save', { name: 'Keep a file', file: 'report.html', from: 'report.html', text: undefined }) },
    { label: 'Save a link', sub: 'A URL (its PR, a deploy), listed first', run: () => add('save', { name: 'Keep the PR', file: 'Pull request', link: '{{pr.url}}', text: undefined }) },
    { head: 'The end' },
    one('end'),
  ]
}
const FORMAT_HELP = `\`# Name\`, a line saying what it does, then \`runs in: worktree|main · session: new|shared · at once: 3 · turns: 30\`.

A \`## id\` per block. Its first key says its kind: \`input: task\` (start), \`agent: claude · model: opus · effort: high · session: run|new|<block>\`, \`run: npm test\`, \`ask: Build it?\` with \`show:\`, \`choice: steps.review.answer contains "LGTM"\` (if / else: two options), \`case: steps.classify.answer\` with branches \`- equals "only_specs" → id\`, \`- steps.size.output equals "0" → id\`, \`- else → id\` (the first that holds; else last), \`action: ship|approve|merge|dev|archive\` (\`ask first: no\`), \`wait: checks\`, \`save: notes.md\` (its text as \`>\` lines, or \`from: a/file\`, or \`link: {{pr.url}}\`), \`end: success|stopped|failed · notify: yes\`. An agent block's \`use: <slug>\` sends one of Run ▾'s agent actions (its slug: Settings › Actions), the \`>\` lines after it.

\`> lines\` are its prompt (or text). Exits: \`next: id\`, \`ok:\`, \`fail:\`, \`error:\`, \`pass:\`; a choice's and an ask's options: \`- Label → id\`. \`max: 3 → id\` limits a block (every loop needs one, or an ask). \`at: x,y\`: where it's drawn.

Variables: \`{{task}}\`, \`{{answer}}\` (your last), \`{{steps.<id>.answer}}\` (an agent's), \`{{steps.<id>.output}}\` (a command's last lines, a wait's failed checks), \`{{pr.url}}\`, \`{{ws.branch}}\`, \`{{base}}\`, \`{{project}}\`.`

function Inspector({ wf, id, presets, actions, edit, onPick }: { wf: Workflow; id: string | null; presets: Preset[]; actions: RunAction[]; edit: (f: (w: Workflow) => void) => void; onPick: (id: string | null) => void }) {
  const b = wf.blocks.find(x => x.id === id)
  const used = b?.use ? findAction(actions, [], b.use) : undefined
  if (!b)
    return (
      <div className="wf-insp">
        <p className="wf-hint">Pick a block to change it. Drag blocks to move them; + Block adds one after the picked block.</p>
        <div className="wf-field">
          <label>Name</label>
          <Typed value={wf.name} onText={v => edit(w => void (w.name = v))} />
        </div>
        <div className="wf-field">
          <label>What it does</label>
          <Typed value={wf.desc ?? ''} onText={v => edit(w => void (w.desc = v || undefined))} />
        </div>
        <div className="wf-row2">
          <div className="wf-field">
            <label>Runs at once</label>
            <Typed type="number" min={1} max={99} value={wf.runs ?? 3} onText={v => edit(w => void (w.runs = Number(v) || undefined))} />
          </div>
          <div className="wf-field">
            <label>Agent turns per run</label>
            <Typed type="number" min={1} max={99} value={wf.turns ?? 30} onText={v => edit(w => void (w.turns = Number(v) || undefined))} />
          </div>
        </div>
      </div>
    )
  const set = (f: (x: Block) => void) => edit(w => f(w.blocks.find(x => x.id === b.id)!))
  const others = wf.blocks.filter(x => x.id !== b.id && x.kind !== 'start')
  const target = (value: string | undefined, onChange: (v: string | undefined) => void) => (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}>
      <option value="">nowhere</option>
      {others.map(o => (
        <option key={o.id} value={o.id}>{blockName(o)}</option>
      ))}
    </select>
  )
  const field = (label: string, el: React.ReactNode, hint?: string) => (
    <div className="wf-field">
      <label>{label}</label>
      {el}
      {hint && <span className="wf-hint">{hint}</span>}
    </div>
  )
  const text = (v: string | undefined, f: (x: Block, v: string) => void, area = false, ph = '') =>
    <Typed area={area} rows={area ? 5 : undefined} value={v ?? ''} placeholder={ph} onText={t => set(x => f(x, t))} />
  const agents = wf.blocks.filter(x => x.kind === 'agent' && x.id !== b.id)
  return (
    <div className="wf-insp">
      <div className="wf-insp-head" style={{ ['--kc' as string]: `var(--tc-${KIND_COLOR[b.kind]})` }}>
        <span className="k">{BLOCK_NAMES[b.kind]}</span>
        <code>{b.id}</code>
        <span className="grow" />
        {b.kind !== 'start' && (
          <IconButton
            icon="trash"
            title="Remove this block"
            onClick={() => {
              edit(w => {
                w.blocks = w.blocks.filter(x => x.id !== b.id)
                for (const o of w.blocks) {
                  for (const [k, v] of Object.entries(o.to ?? {})) if (v === b.id) delete o.to![k]
                  for (const opt of o.options ?? []) if (opt.to === b.id) delete opt.to
                  if (o.max?.to === b.id) delete o.max.to
                }
              })
              onPick(null)
            }}
          />
        )}
      </div>
      {b.kind !== 'start' && field('Name', text(b.name, (x, v) => (x.name = v || undefined), false, b.id))}
      {b.kind === 'agent' && (
        <>
          <div className="wf-row2">
            {field(
              'Agent',
              <select value={b.agent ?? 'claude'} onChange={e => set(x => void (x.agent = e.target.value))}>
                {[...new Set([...presets.filter(p => p.agent !== 'command').map(p => p.name), b.agent ?? 'claude'])].map(n => (
                  <option key={n}>{n}</option>
                ))}
              </select>,
            )}
            {field(
              'Session',
              <select value={b.session ?? 'run'} onChange={e => set(x => void (x.session = e.target.value === 'run' ? undefined : e.target.value))}>
                <option value="run">The run’s tab</option>
                <option value="new">A tab of its own</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{blockName(a)}’s tab</option>
                ))}
              </select>,
            )}
          </div>
          <div className="wf-row2">
            {field('Model', text(b.model, (x, v) => (x.model = v.trim() || undefined), false, 'its default'))}
            {field('Effort', text(b.effort, (x, v) => (x.effort = v.trim() || undefined), false, 'its default'))}
          </div>
          {field(
            'Agent action',
            <select
              value={used ? ref(used) : (b.use ?? '')}
              onChange={e => {
                const a = actions.find(x => ref(x) === e.target.value)
                set(x => {
                  x.use = a && ref(a)
                  if (a && a.target !== 'any' && presets.some(p => p.name === a.target)) x.agent = a.target
                })
              }}
            >
              <option value="">None: the prompt below</option>
              {actions.map(a => (
                <option key={ref(a)} value={ref(a)}>{a.slug && a.slug !== a.name ? `${a.name} · ${a.slug}` : a.name}</option>
              ))}
              {b.use && !used && <option value={b.use}>{b.use} (not found)</option>}
            </select>,
            b.use ? (used?.text.split('\n')[0].slice(0, 140) ?? 'No such action here: Settings › Actions, or the project’s') : actions.length ? 'One of Run ▾’s, by its slug: its prompt goes first' : 'Run ▾’s agent actions show here: Settings › Actions',
          )}
          {field(b.use ? 'More for it (after the action’s prompt)' : 'Prompt', text(b.text, (x, v) => (x.text = v || undefined), true), '{{task}}, {{answer}}, {{steps.<id>.answer}}, {{steps.<id>.output}}, {{pr.url}}')}
        </>
      )}
      {b.kind === 'run' && (
        <>
          {field('Command', text(b.cmd, (x, v) => (x.cmd = v), false, 'npm test'), 'In the run’s folder; its exit code picks ok or fail. Variables are quoted.')}
          {field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? 10} onText={v => set(x => void (x.timeout = Number(v) || undefined))} />)}
        </>
      )}
      {b.kind === 'ask' && (
        <>
          {field('Question', text(b.question, (x, v) => (x.question = v)))}
          {field('Show with it', text(b.show, (x, v) => (x.show = v || undefined), false, '{{steps.plan.answer}}'), 'What you typed with your pick is {{answer}}.')}
        </>
      )}
      {b.kind === 'choice' && (
        <>
          {field('Of', text(b.of, (x, v) => (x.of = v.trim())), 'A variable (steps.review.answer) or a block’s id')}
          <div className="wf-row2">
            {field(
              'Test',
              <select value={b.test ?? 'contains'} onChange={e => set(x => void (x.test = e.target.value as Block['test']))}>
                {TESTS.map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>,
            )}
            {field('Value', text(b.value, (x, v) => (x.value = v)))}
          </div>
        </>
      )}
      {b.kind === 'case' && field('Of', text(b.of, (x, v) => (x.of = v.trim() || undefined), false, 'steps.classify.answer'), 'What its branches test (a branch may name its own); the first that holds wins, else the last')}
      {b.kind === 'action' && (
        <>
          {field(
            'Action',
            <select value={b.action ?? 'ship'} onChange={e => set(x => void (x.action = e.target.value))}>
              {Object.entries(ACTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>,
          )}
          {b.action === 'ship' && field('Commit message', text(b.text, (x, v) => (x.text = v), false, '{{task}}'))}
          {['ship', 'approve', 'merge', 'archive'].includes(b.action ?? 'ship') && (
            <Switch className="switch-row" on={b.confirm !== false} onChange={v => set(x => void (x.confirm = v ? undefined : false))}>
              Ask me first
            </Switch>
          )}
        </>
      )}
      {b.kind === 'wait' && field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? 60} onText={v => set(x => void (x.timeout = Number(v) || undefined))} />, 'Until its PR’s checks pass or fail')}
      {b.kind === 'save' && (
        <>
          {field(
            'Saves',
            <select
              value={b.link !== undefined ? 'link' : b.from !== undefined ? 'from' : 'text'}
              onChange={e =>
                set(x => {
                  const m = e.target.value
                  x.from = m === 'from' ? x.from || 'report.html' : undefined
                  x.link = m === 'link' ? x.link || '{{pr.url}}' : undefined
                  if (m !== 'text') x.text = undefined
                  if (x.from) x.file = x.from.split('/').filter(Boolean).pop() // named as it is: its extension kept
                  else if (x.link) x.file = 'Pull request'
                })
              }
            >
              <option value="text">Text</option>
              <option value="from">A file or folder of the workspace</option>
              <option value="link">A link</option>
            </select>,
          )}
          {field(b.link !== undefined ? 'Its name' : 'As', text(b.file, (x, v) => (x.file = v), false, b.link !== undefined ? 'Pull request' : 'notes.md'), b.link !== undefined ? 'Kept as <name>.url: the Artifacts list links first' : 'In the workspace’s storage folder (its Artifacts)')}
          {b.from !== undefined && field('From', text(b.from, (x, v) => (x.from = v), false, 'report.html'), 'A path in the workspace, {{vars}} too')}
          {b.link !== undefined && field('Link', text(b.link, (x, v) => (x.link = v), false, '{{pr.url}}'), 'An http(s) URL, {{vars}} too')}
          {b.from === undefined && b.link === undefined && field('Text', text(b.text, (x, v) => (x.text = v), true), '{{steps.<id>.answer}}: an agent’s answer')}
        </>
      )}
      {b.kind === 'end' && (
        <>
          {field(
            'Result',
            <select value={b.result ?? 'success'} onChange={e => set(x => void (x.result = e.target.value as Block['result']))}>
              {RESULTS.map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>,
          )}
          <Switch className="switch-row" on={!!b.notify} onChange={v => set(x => void (x.notify = v || undefined))}>
            Notify me
          </Switch>
        </>
      )}
      {b.kind !== 'end' && <div className="wf-sub">Where it goes</div>}
      {b.kind === 'case' ? (
        <>
          {(b.options ?? []).map((o, i) => {
            const go = target(o.to, v => set(x => void (x.options![i].to = v)))
            const br = branchOf(o.label)
            if (br === 'else')
              return (
                <div key={i} className="wf-exit">
                  <span className="wf-exit-name">else</span>
                  <span>→</span>
                  {go}
                </div>
              )
            const cur = br ?? { test: 'contains' as const, value: '' }
            const put = (c: Partial<typeof cur>) => set(x => void (x.options![i].label = branchLabel({ ...cur, ...c })))
            return (
              <div key={i} className="wf-branch">
                <div className="wf-exit">
                  <span className="wf-exit-name">{i ? 'elsif' : 'if'}</span>
                  <Typed value={cur.of ?? ''} placeholder={b.of || 'a variable'} aria-label="Its variable" onText={v => put({ of: v.trim() || undefined })} />
                  {(b.options?.length ?? 0) > 2 && <IconButton icon="x" title="Remove this branch" onClick={() => set(x => void x.options!.splice(i, 1))} />}
                </div>
                <div className="wf-exit">
                  <select className="wf-test" value={cur.test} aria-label="Its test" onChange={e => put({ test: e.target.value as typeof cur.test })}>
                    {TESTS.map(t => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <Typed value={cur.value} placeholder="text" aria-label="Its text" onText={v => put({ value: v })} />
                </div>
                <div className="wf-exit">
                  <span>→</span>
                  {go}
                </div>
              </div>
            )
          })}
          <div className="wf-exit">
            <button
              className="btn small"
              onClick={() =>
                set(x => {
                  const l = (x.options ??= [])
                  const at = l.length && branchOf(l.at(-1)!.label) === 'else' ? l.length - 1 : l.length
                  l.splice(at, 0, { label: branchLabel({ test: 'contains', value: `branch ${at + 1}` }) })
                })
              }
            >
              <Icon name="plus" size={11} /> Branch
            </button>
            {!(b.options ?? []).some(o => branchOf(o.label) === 'else') && (
              <button className="btn small" onClick={() => set(x => void (x.options ??= []).push({ label: 'else' }))}>
                <Icon name="plus" size={11} /> Else
              </button>
            )}
          </div>
        </>
      ) : optioned(b.kind) ? (
        <>
          {(b.options ?? []).map((o, i) => (
            <div key={i} className="wf-exit">
              <Typed value={o.label} disabled={b.kind === 'choice'} onText={v => set(x => void (x.options![i].label = v))} />
              <span>→</span>
              {target(o.to, v => set(x => void (x.options![i].to = v)))}
              {b.kind === 'ask' && (b.options?.length ?? 0) > 2 && <IconButton icon="x" title="Remove this option" onClick={() => set(x => void x.options!.splice(i, 1))} />}
            </div>
          ))}
          {b.kind === 'ask' && (
            <button className="btn small" onClick={() => set(x => void (x.options ??= []).push({ label: `Option ${(x.options?.length ?? 0) + 1}` }))}>
              <Icon name="plus" size={11} /> Option
            </button>
          )}
          {b.kind === 'choice' && <span className="wf-hint">The first when it holds, the second when not.</span>}
        </>
      ) : (
        EXITS[b.kind].map(e => (
          <div key={e} className={`wf-exit ${BAD_EXITS.includes(e) ? 'bad' : ''}`}>
            <span className="wf-exit-name">{e}</span>
            <span>→</span>
            {target(b.to?.[e], v => set(x => (v ? (x.to = { ...x.to, [e]: v }) : delete x.to?.[e])))}
          </div>
        ))
      )}
      {b.kind !== 'start' && b.kind !== 'end' && (
        <div className="wf-exit">
          <span className="wf-exit-name">at most</span>
          <Typed type="number" min={0} className="wf-num" value={b.max?.n ?? ''} placeholder="∞" onText={v => set(x => void (x.max = Number(v) > 0 ? { n: Number(v), to: x.max?.to } : undefined))} />
          <span>then</span>
          {b.max ? target(b.max.to, v => set(x => void (x.max = { n: x.max!.n, to: v }))) : <span className="wf-hint">times</span>}
        </div>
      )}
    </div>
  )
}

function StartRun({ item, projects, api, onClose, onStarted }: { item: WorkflowItem; projects: Project[]; api: WorkflowsApi; onClose: () => void; onStarted: (id: string) => void }) {
  const ok = projects.filter(p => !p.host && (item.source !== 'project' || p.id === item.project) && (item.where === 'main' || p.git !== false))
  const [project, setProject] = useState(item.project ?? ok[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [dry, setDry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = () => {
    setBusy(true)
    setErr('')
    api.call<FlowRun>('flowStart', { workflow: item.id, source: item.source, project, task, dry }).then(
      r => onStarted(r.id),
      e => (setBusy(false), setErr((e as Error).message)),
    )
  }
  return (
    <div className="overlay" onPointerDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal wf-start" onSubmit={e => (e.preventDefault(), go())} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
        <b>Run {item.name}</b>
        <span className="wf-hint">{WHERES[item.where]} · {SESSIONS[item.session]}</span>
        <label className="wf-field">
          <span>Project</span>
          <select value={project} onChange={e => setProject(e.target.value)} disabled={item.source === 'project'}>
            {ok.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="wf-field">
          <span>Task</span>
          <textarea autoFocus rows={4} value={task} placeholder="What should it work on?" onChange={e => setTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.metaKey && (e.preventDefault(), go())} />
        </label>
        <Switch className="switch-row" on={dry} onChange={setDry}>
          Dry run: opening a PR, approving, merging and archiving are said, not done
        </Switch>
        {err && <span className="wf-err">{err}</span>}
        <div className="wf-start-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !project || !task.trim()}>{busy ? 'Starting…' : 'Run ⌘⏎'}</button>
        </div>
      </form>
    </div>
  )
}

// ---------- a run: where it is, what it asks, its decisions, variables and log

function RunView({ id, entry, api, pname, ws, tabs, onGone, onDelete }: { id: string; entry?: FlowView; api: WorkflowsApi; pname: (id?: string) => string; ws: WorkspaceView[]; tabs: string[]; onGone: () => void; onDelete: (r: FlowView) => void }) {
  const [r, setR] = useState<FlowRun | null>(null)
  const [tab, setTab] = useState<'decisions' | 'state'>('decisions')
  const [mode, setMode] = useState<'blocks' | 'log'>('blocks')
  const [typed, setTyped] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  // again as the view says it moved (status, block, a decision)
  useEffect(() => void api.call<FlowRun>('flowGet', { id }).then(setR, onGone), [id, entry?.status, entry?.cur, entry?.decisions, entry?.at, entry?.wait?.kind, entry?.turns])
  // the log while it goes: every few seconds (an agent's turn adds lines without moving the view)
  useEffect(() => {
    if (mode !== 'log' || !entry || ended(entry)) return
    const t = setInterval(() => api.call<FlowRun>('flowGet', { id }).then(setR, () => {}), 3000)
    return () => clearInterval(t)
  }, [mode, id, entry?.status])
  if (!r) return <div className="wf-empty">Loading…</div>
  const over = ended(r)
  const w = ws.find(x => x.id === r.ws)
  const lit: Lit = { state: {}, taken: new Set(), visits: r.visits }
  r.decisions.forEach((d, i) => {
    const next = r.decisions[i + 1]?.block ?? r.cur
    if (next && next !== d.block) lit.taken.add(`${d.block}>${next}`)
    lit.state[d.block] = d.bad ? 'failed' : 'done'
  })
  if (r.cur) lit.state[r.cur] = r.status === 'waiting' ? 'waiting' : r.status === 'running' || r.status === 'paused' ? 'running' : r.status === 'failed' ? 'failed' : 'done'
  const last = r.decisions.at(-1)
  if (r.status === 'running' && r.cur && last && last.block !== r.cur) lit.live = `${last.block}>${r.cur}`
  const tabOfBlock = (id?: string) => (id && r.ws && tabs.includes(r.tabs[id]) ? r.tabs[id] : undefined) // an agent block's session, while it's open
  const openTab = (id?: string) => {
    const t = tabOfBlock(id)
    if (t && r.ws && api.openTab) api.openTab(r.ws, t)
  }
  const answer = (n: number) => api.call('flowAnswer', { id, n, text: typed }).then(x => (setTyped(''), setR(x)), e => api.toast((e as Error).message))
  const stop = async () => (await ask('Stop this run?', { text: 'Its agents stay as they are, in their tabs.', ok: 'Stop', danger: true })) && api.call('flowStop', { id }).then(setR, e => api.toast((e as Error).message))
  const picked = pick ? r.flow.blocks.find(b => b.id === pick) : undefined
  const vars = Object.entries(r.vars).filter(([k]) => !pick || k === 'task' || k === 'answer' || k.startsWith(`steps.${pick}.`))
  const decisions = [...r.decisions].reverse().filter(d => !pick || d.block === pick)
  return (
    <div className="wf-runview">
      <div className="wf-head">
        <div className="wf-title">
          <b>{r.task || r.flow.name}</b>
          <span className="wf-src">
            {r.flow.name}
            {r.dry ? ' · dry run' : ''} · {pname(r.project)} · started {ago(r.started)}
            {r.ended ? ` · took ${dur(r.ended - r.started)}` : ''}
          </span>
        </div>
        <span className="grow" />
        <span className="wf-pill" data-status={r.status}>{r.status === 'running' && <span className="wf-gear"><Icon name="gear" size={11} /></span>}{STATUS_WORDS[r.status]}{!over && r.cur ? ` · ${blockName(r.flow.blocks.find(b => b.id === r.cur) ?? { id: r.cur, kind: 'agent' })}` : ''}</span>
        {w && !w.archived && (
          <button className="btn" onClick={() => api.openWs(w.id)}>
            <Icon name={w.kind === 'worktree' ? 'fork' : 'folder'} size={12} /> {w.name ?? w.id}
          </button>
        )}
        <div className="seg">
          <button className={mode === 'blocks' ? 'on' : ''} onClick={() => setMode('blocks')}>Blocks</button>
          <button className={mode === 'log' ? 'on' : ''} onClick={() => setMode('log')}>Log {r.log.length}</button>
        </div>
        {!over && <button className="btn" onClick={stop}><Icon name="stop" size={11} /> Stop</button>}
        <IconButton icon="trash" title="Delete this run" onClick={() => onDelete(entry ?? flowView(r))} />
      </div>
      {r.status === 'waiting' && r.wait && 'options' in r.wait && (
        <div className="wf-ask">
          <div className="wf-ask-q">
            <Icon name="help" size={14} />
            <b>{r.wait.question}</b>
            <span className="wf-hint">{r.wait.kind === 'confirm' ? 'before it does something others see' : r.wait.kind === 'stuck' ? 'it can’t go on by itself' : ''}</span>
          </div>
          {r.wait.show && (
            <div className="wf-ask-show">
              <Markdown src={r.wait.show} />
            </div>
          )}
          {r.wait.kind === 'ask' && <input className="wf-ask-text" value={typed} placeholder="Add words, if any: they're {{answer}}" onChange={e => setTyped(e.target.value)} />}
          <div className="wf-ask-btns">
            {r.wait.options.map((o, n) => (
              <button key={n} className={`btn ${n === 0 ? 'primary' : ''}`} onClick={() => answer(n)}>{o}</button>
            ))}
          </div>
        </div>
      )}
      {r.status === 'paused' && r.wait?.kind === 'limit' && <div className="wf-note">Paused at a usage limit: it goes on when the limit resets{r.wait.until ? `, at ${new Date(r.wait.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.</div>}
      {mode === 'log' ? (
        <RunLog log={r.log} />
      ) : (
      <div className="wf-split">
        <Canvas wf={r.flow} sel={pick} onPick={setPick} lit={lit} />
        <div className="wf-insp wf-runside">
          <div className="seg">
            {(['decisions', 'state'] as const).map(t => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'decisions' ? `Decisions ${r.decisions.length}` : 'State'}
              </button>
            ))}
          </div>
          {picked && (
            <div className="wf-hint">
              Only {blockName(picked)}’s · <button className="link" onClick={() => setPick(null)}>show all</button>
              {tabOfBlock(picked.id) && w && !w.archived && api.openTab && (
                <>
                  {' · '}
                  <button className="link" onClick={() => openTab(picked.id)}>open its session</button>
                </>
              )}
            </div>
          )}
          {tab === 'decisions' &&
            (decisions.length ? (
              decisions.map((d, i) => {
                const b = r.flow.blocks.find(x => x.id === d.block)
                return (
                  <div key={i} className={`wf-dec ${d.bad ? 'bad' : ''} ${d.you ? 'you' : ''}`}>
                    <div className="wf-dec-head">
                      <b>{b ? blockName(b) : d.block}</b>
                      <span className="wf-exit-name">{d.exit}</span>
                      <span className="grow" />
                      <span className="wf-hint">{new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}{d.ms && d.ms > 1500 ? ` · ${dur(d.ms)}` : ''}</span>
                    </div>
                    <div className="wf-dec-why">{d.why}</div>
                    {b?.kind === 'agent' && tabOfBlock(b.id) && w && !w.archived && api.openTab && (
                      <button className="link wf-dec-open" onClick={() => openTab(b.id)}>
                        Open its session
                      </button>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="wf-hint">No decisions yet.</p>
            ))}
          {tab === 'state' && (
            <div className="wf-state">
              <div className="wf-sub">Where</div>
              <div className="wf-kv"><span>block</span><code>{r.cur ?? '—'}</code></div>
              <div className="wf-kv"><span>agent turns</span><code>{r.turns}/{r.flow.turns ?? 30}</code></div>
              {Object.entries(r.visits).map(([k, n]) => (
                <div key={k} className="wf-kv"><span>{k}</span><code>×{n}</code></div>
              ))}
              <div className="wf-sub">Variables</div>
              {vars.map(([k, v]) => (
                <details key={k} className="wf-var">
                  <summary>
                    <code>{`{{${k}}}`}</code> <span className="wf-hint">{v.split('\n')[0].slice(0, 60)}</span>
                  </summary>
                  <pre>{v}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

// the whole log, newest last: each entry's time and line, and what went with it (a prompt, an answer, a command's
// output) folded under it; a filter keeps the entries with every word typed
function RunLog({ log }: { log: string[] }) {
  const [find, setFind] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // at the bottom: new entries keep it there; scrolled up to read, it stays put
  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = log.map((l, i) => [l, i] as const).filter(([l]) => words.every(w => l.toLowerCase().includes(w)))
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [log])
  return (
    <div className="wf-logview">
      <div className="wf-bar">
        <input className="wf-log-find" value={find} placeholder="Filter the log" onChange={e => setFind(e.target.value)} />
        <span className="wf-hint">{words.length ? `${shown.length} of ${log.length}` : `${log.length} entries`}</span>
        <span className="grow" />
        <button className="btn small" onClick={() => setOpen(o => !o)}>{open ? 'Fold all' : 'Unfold all'}</button>
        <button className="btn small" onClick={() => navigator.clipboard.writeText(log.join('\n\n')).catch(() => {})}>
          <Icon name="copy" size={11} /> Copy
        </button>
      </div>
      <div className="wf-log" ref={box} onScroll={e => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
        {shown.map(([l, i]) => {
          const nl = l.indexOf('\n')
          const head = nl < 0 ? l : l.slice(0, nl)
          const t = /^\d\d:\d\d:\d\d /.test(head) ? head.slice(0, 8) : ''
          const line = t ? head.slice(9) : head
          return (
            <div key={`${i}-${open}`} className={`wf-log-row ${/→ (fail|error)\b|failed|stuck|asks you/.test(line) ? 'note' : ''}`}>
              <span className="wf-log-t">{t}</span>
              {nl < 0 ? (
                <span className="wf-log-line">{line}</span>
              ) : (
                <details open={open || undefined}>
                  <summary className="wf-log-line">{line}</summary>
                  <pre>{l.slice(nl + 1)}</pre>
                </details>
              )}
            </div>
          )
        })}
        {!shown.length && <p className="wf-hint">{log.length ? 'Nothing matches.' : 'Nothing yet.'}</p>}
      </div>
    </div>
  )
}

const dur = (ms: number) => (ms < 60e3 ? `${Math.round(ms / 1000)}s` : ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`)
