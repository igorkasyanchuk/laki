// Workflows (off only by Settings › General › Pages; the rail's Workflows, ⌘K): an index like Scheduled tasks (the workflows,
// yours and each project's, and their runs), then one workflow or one run on a page of its own, breadcrumbs back. A
// workflow opens on a canvas (blocks dragged where they go, exits as arrows) with an inspector for the picked block, or
// as its Markdown file; both edit the same text (shared/workflow.ts parse/toFile). A run opens on the same canvas, lit
// where it is and where it went, with what it asks you, its decisions, its variables, and its whole log. Esc doesn't
// close the page: it stays open while runs go. The engine is the daemon's (daemon/workflow.ts). Loaded as the page
// opens (App's lazy import).
import { type ChangeEvent, Fragment, type PointerEvent as PE, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Agent, FAST, findAction, mergeActions, PERMS, WIDGET_EVENTS, type Preset, type Project, type RunAction, type WorkspaceView } from '../../shared/types'
import { ago } from '../../shared/widget'
import { ACTIONS, AGENT_TIMEOUT, DONES, apiQuestions, bypassIn, flowVars, permOf, permWords, VAR_NAME, QTYPE_INFO, renameBlock, routesOf, workflowAsk, BAD_EXITS, BLOCK_NAMES, DECIDE_MODELS, type DecideQ, fromApi, NUM_TESTS, QTYPES, SURE, blockName, branchLabel, branchOf, type Block, type BlockKind, check, EXITS, exitsOf, FLOW_ENDED, type FlowRun, type FlowView, flowView, MAX_BLOCKS, optioned, parse, RESULTS, runOf, SESSIONS, TESTS, toFile, WAITS, WHERES, METHODS, OUT_KINDS, OUT_NAME, OUT_TAKEN, RETRY_KINDS, RETRY_MAX, RUNS_AT_ONCE, inputsOf, inputText, type Shown, type Workflow, type WorkflowItem, type WorkflowSource, whenProblem } from '../../shared/workflow'
import { pageNow } from './api'
import { highlightWorkflow } from './highlight'
import { Markdown } from './MarkdownView'
import { ShownDialog } from './Shown'
import { Modal } from './panels'
import { ask, choose, Icon, IconButton, type MenuItem, Page, Switch, useMenu } from './ui'
import './workflows.css'

export type WorkflowsApi = {
  call: <T = any>(method: string, params?: object) => Promise<T>
  openWs: (id: string) => void
  openTab?: (ws: string, tab: string) => void // a block's session, in its workspace
  toast: (text: string, undo?: () => void) => void // undo: its Undo button
  phone?: boolean // Settings › Phone pushes is set up: a notify can go to the phone too
  settings?: (section: string) => void // Settings at that section
  ai?: (ask?: string) => void // the floating Laki AI chat over the page; with an ask, that sent to it
  globals?: Record<string, string> // Settings' flowVars: {{vars.NAME}} in every workflow
  setGlobals?: (v: Record<string, string>) => Promise<unknown>
}
type Sel = { id: string; source: WorkflowSource; project?: string }
export type FlowStartAt = Sel & { ws?: string } // the page opened on a workflow's Run sheet, in that workspace
const WHERE_TAGS: Record<string, string> = { worktree: 'worktree', main: 'project folder', here: 'a workspace you pick' }
type Ext = { id: string; name: string; on: boolean; every?: number } // what an extension block can fetch
type At = { kind: 'index' } | { kind: 'wf'; sel: Sel } | { kind: 'run'; id: string }
const W = 180
const H = 58
const RUNS_SHOWN = 12
const KIND_COLOR: Record<BlockKind, string> = { start: 'teal', agent: 'purple', llm: 'red', decide: 'yellow', popup: 'teal', webhook: 'brown', run: 'blue', choice: 'yellow', case: 'yellow', ask: 'orange', action: 'green', wait: 'pink', save: 'lime', extension: 'teal', end: 'gray' }
const STATUS_WORDS: Record<string, string> = { queued: 'queued', running: 'running', waiting: 'asks you', paused: 'paused', done: 'done', stopped: 'stopped', failed: 'failed' }
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

export function WorkflowsPage({ view, projects, presets, actions, at: first, api, onClose }: { view: { flows?: FlowView[]; flowFiles?: number; workspaces: WorkspaceView[]; tabs: { id: string }[]; widgets?: Ext[] }; projects: Project[]; presets: Preset[]; actions?: RunAction[]; at?: { run?: string; start?: FlowStartAt }; api: WorkflowsApi; onClose: () => void }) {
  const [list, setList] = useState<WorkflowItem[] | null>(null)
  const [at, setAt] = useState<At>(first?.run ? { kind: 'run', id: first.run } : { kind: 'index' })
  const [starting, setStarting] = useState<WorkflowItem | null>(null)
  const [startWs, setStartWs] = useState(first?.start?.ws) // Run workflow › from a workspace's menu or ⌘K: that one, fixed
  const startIn = (w: WorkflowItem | null, ws?: string) => (setStartWs(ws), setStarting(w))
  const [allRuns, setAllRuns] = useState(false)
  const [menu, openMenu] = useMenu()
  const refresh = () => api.call<WorkflowItem[]>('flowList', {}).then(setList, () => setList([]))
  useEffect(() => void refresh(), [view.flowFiles]) // and as a file changes (Laki AI's, an agent's)
  // opened to start one: its Run sheet once the list is in
  const [asked, setAsked] = useState(first?.start)
  useEffect(() => {
    const w = asked && list?.find(x => same(asked, x))
    if (asked && list) setAsked(undefined), w ? (w.problems.length ? setAt({ kind: 'wf', sel: w }) : startIn(w, asked.ws)) : api.toast('That workflow is gone') // one with problems: its page says them
  }, [list])
  const [want, setWant] = useState('') // With Laki AI's
  const [making, setMaking] = useState(false) // its box, open
  // asked Laki AI for one: the workflows there were then; the first new one opens as it's written
  const [awaiting, setAwaiting] = useState<Set<string> | null>(null)
  useEffect(() => {
    const made = awaiting && at.kind === 'index' && list?.find(w => !awaiting.has(keyOf(w)))
    if (made) setAwaiting(null), setAt({ kind: 'wf', sel: made })
  }, [list])
  const make = () => {
    if (!want.trim() || !api.ai) return
    setAwaiting(new Set((list ?? []).map(keyOf)))
    api.ai(workflowAsk(want))
    setWant('')
    setMaking(false)
  }
  const flows = [...(view.flows ?? [])].sort((a, b) => Number(ended(a)) - Number(ended(b)) || b.started - a.started)
  const pname = (id?: string) => projects.find(p => p.id === id)?.name ?? id ?? ''
  const cur = at.kind === 'wf' ? list?.find(w => same(at.sel, w)) : undefined
  const run = at.kind === 'run' ? flows.find(r => r.id === at.id) : undefined
  const going = flows.filter(r => !ended(r) && r.status !== 'queued')
  const queued = flows.filter(r => r.status === 'queued')
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
    api.call<WorkflowItem>('flowSave', { id, text, ...into }).then(w => (setAwaiting(a => a && new Set([...a, keyOf(w)])), refresh(), setAt({ kind: 'wf', sel: w })), e => api.toast((e as Error).message)) // made here: not the one Laki AI is making
  }
  const intoOf = (w: WorkflowItem) => (w.source === 'project' ? { source: 'project' as const, project: w.project! } : { source: 'yours' as const })
  const newMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { head: 'A new workflow' },
      {
        label: 'From scratch',
        sub: 'A start, an agent and an end, to build on',
        icon: 'plus',
        items: [
          { head: 'Where it lives' },
          { label: 'Yours', sub: 'In Laki, for any project', icon: 'plus', run: () => create({ source: 'yours' }) },
          ...projects.filter(p => !p.host).map((p): MenuItem => ({ label: p.name, sub: 'In its repo: .laki/workflows', icon: 'fork', run: () => create({ source: 'project', project: p.id }) })),
        ],
      },
      ...(api.ai ? [{ label: 'With Laki AI…', sub: 'Say what it should do: it asks a few questions, then writes it', icon: 'ai', run: () => setMaking(true) } as MenuItem] : []),
    ])
  const wfMenu = (e: React.MouseEvent, w: WorkflowItem) =>
    openMenu(e, [
      { label: 'Make a copy', icon: 'copy', run: () => create(intoOf(w), w) },
      null,
      { label: 'Delete', icon: 'trash', danger: true, run: () => void removeWf(w) },
    ])
  // to the trash at once, its toast's Undo puts it back (flowRestore); its runs stay on the list
  const removeWf = (w: WorkflowItem) =>
    api.call<{ trash: string }>('flowRm', { id: w.id, source: w.source, project: w.project }).then(
      x => (refresh(), api.toast(`Deleted ${w.name}`, () => void api.call('flowRestore', { trash: x.trash }).then(refresh, e => api.toast((e as Error).message))), true),
      e => (api.toast((e as Error).message), false),
    )
  // Run again (an ended run's id) or Run from here (and a block): the new run opens
  const again = (id: string, block?: string) => api.call<FlowRun>('flowStart', block ? { from: { run: id, block } } : { again: id }).then(x => setAt({ kind: 'run', id: x.id }), e => api.toast((e as Error).message))
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
                <Icon name="plus" /> New workflow <Icon name="chevron" size={10} />
              </button>
            </span>
          </header>
          {api.ai && making && (
            <form className="wf-make" onSubmit={e => (e.preventDefault(), make())}>
              <Icon name="ai" />
              <input autoFocus value={want} placeholder="What should it do? e.g. every morning, read my unread Slack, and if anything is urgent, start an agent on it" aria-label="What the workflow should do" onChange={e => setWant(e.target.value)} onKeyDown={e => e.key === 'Escape' && (e.preventDefault(), setMaking(false))} />
              <button type="submit" className="btn primary" disabled={!want.trim()} data-tip="Laki AI asks you a few questions, then writes it; it opens here, you read it and save it">
                Make it
              </button>
              <IconButton icon="x" title="Close" onClick={() => setMaking(false)} />
            </form>
          )}
          {awaiting && !making && (
            <div className="wf-make wf-awaiting">
              <span className="ai-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="grow">Laki AI is on it, in its chat: answer its questions there. The workflow opens here once it's written.</span>
              <button className="btn" onClick={() => api.ai!()}>
                Its chat
              </button>
              <IconButton icon="x" title="Don't open it" onClick={() => setAwaiting(null)} />
            </div>
          )}
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
              {queued.length > 0 && (
                <div>
                  <b>{queued.length}</b>
                  <span>queued</span>
                </div>
              )}
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
                          {queued.some(r => runOf(r, w)) && <span className="sched-next">{queued.filter(r => runOf(r, w)).length} queued</span>}
                        </span>
                        <span className="sched-tags">
                          <span className="tag">{w.source === 'project' ? pname(w.project) : 'yours'}</span>
                          <span className="tag">{WHERE_TAGS[w.where]}</span>
                          <span className="tag">{w.blocks.length} blocks</span>
                          {w.byAgent && <span className="tag warn">by an agent</span>}
                          {w.untrusted && !w.byAgent && <span className="tag warn">{w.changed ? 'changed' : 'not allowed'}</span>}
                          {drafts.has(keyOf(w)) && <span className="tag warn">unsaved changes</span>}
                        </span>
                      </button>
                      <span className="sched-acts">
                        <IconButton icon="run" title={w.problems.length ? `Can't run: ${w.problems[0]}` : 'Run it'} onClick={() => (w.problems.length ? setAt({ kind: 'wf', sel: w }) : startIn(w))} />
                        <IconButton icon="more" title="More: copy, delete" onClick={e => wfMenu(e, w)} />
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
                      <IconButton
                        icon="more"
                        title="More: run again, delete"
                        onClick={e =>
                          openMenu(e, [
                            ...(ended(r) ? [{ label: 'Run again', sub: 'Its task and inputs, the workflow as it is now', icon: 'refresh', run: () => void again(r.id) } as MenuItem, null] : []),
                            { label: 'Delete…', icon: 'trash', danger: true, run: () => void removeRun(r) },
                          ])
                        }
                      />
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
            <RunView key={at.id} id={at.id} entry={run} ahead={run ? queued.filter(x => x.started < run.started && runOf(x, { id: run.workflow, source: run.source, project: run.project })).length : 0} api={api} pname={pname} ws={view.workspaces} tabs={view.tabs.map(t => t.id)} onGone={() => setAt({ kind: 'index' })} onDelete={r => removeRun(r).then(y => y && setAt({ kind: 'index' }))} onAgain={again} />
          ) : cur ? (
            <Editor
              key={`${cur.source}/${cur.project}/${cur.id}`}
              item={cur}
              projects={projects}
              presets={presets}
              actions={agentActions(actions, projects, cur)}
              exts={view.widgets ?? []}
              api={api}
              runs={going.filter(r => runOf(r, cur))}
              onSaved={w => (refresh(), setAt({ kind: 'wf', sel: w }))}
              onRemove={() => removeWf(cur).then(y => y && (drafts.delete(keyOf(cur)), setAt({ kind: 'index' })))}
              onRun={() => startIn(cur)}
              onOpenRun={id => setAt({ kind: 'run', id })}
              onCopy={() => create(intoOf(cur), cur)}
            />
          ) : (
            <div className="wf-empty">{list === null ? 'Loading…' : 'That workflow is gone.'}</div>
          )}
        </div>
      )}
      {starting && <StartRun item={starting} projects={projects} presets={presets} workspaces={view.workspaces} fixed={startWs} api={api} onClose={() => startIn(null)} onStarted={id => (startIn(null), setAt({ kind: 'run', id }))} />}
      {menu}
    </Page>
  )
}

// a field whose text goes through the workflow's Markdown and back (parse trims it and joins its lines; a number left
// empty is its default): what's typed stays as typed while it has the focus, or a space before the next word, a new
// line or an emptied number would be gone as it's typed. A value changed elsewhere meanwhile (the File tab) wins
function Typed({ area, value, onText, ...rest }: { area?: boolean; value: string | number; onText: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean; 'aria-label'?: string; type?: string; min?: number; max?: number; className?: string; list?: string }) {
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

// where each block is drawn: its at:, else in rows by its longest way from the start (a loop's way back left out), a
// decision's or a case's ways side by side; what the start never reaches below
function placed(blocks: Block[]): Map<string, [number, number]> {
  const by = new Map(blocks.map(b => [b.id, b]))
  const next = (id: string) => exitsOf(by.get(id)!).flatMap(e => (e.to && by.has(e.to) ? [e.to] : []))
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    seen.add(id)
    for (const n of next(id)) if (!seen.has(n)) visit(n)
    order.push(id)
  }
  const start = blocks.find(b => b.kind === 'start')
  if (start) visit(start.id)
  order.reverse() // each block before the ones it leads to (a way back aside)
  const at = new Map(order.map((id, i) => [id, i]))
  const row = new Map<string, number>(order.map(id => [id, 0]))
  for (const id of order) for (const n of next(id)) if (at.get(n)! > at.get(id)!) row.set(n, Math.max(row.get(n)!, row.get(id)! + 1))
  let last = Math.max(-1, ...row.values())
  for (const b of blocks) if (!row.has(b.id)) row.set(b.id, ++last)
  const cols = new Map<number, number>()
  const m = new Map<string, [number, number]>()
  for (const id of [...order, ...blocks.filter(b => !at.has(b.id)).map(b => b.id)]) {
    const r = row.get(id)!
    const c = cols.get(r) ?? 0
    cols.set(r, c + 1)
    m.set(id, by.get(id)!.at ?? [70 + c * (W + 40), 20 + r * 90])
  }
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

// what a block's prompt or body can use: the run's own, and what each other block gives
function varsHint(wf: Workflow, b: Block) {
  const gives = wf.blocks.filter(x => x.id !== b.id).flatMap(x => [...(x.kind === 'agent' || x.kind === 'llm' ? [`steps.${x.id}.answer`] : x.kind === 'run' || x.kind === 'webhook' ? [`steps.${x.id}.output`] : []), ...(x.out ?? []).map(n => `steps.${x.id}.${n}`), ...(x.qs ?? []).map(q => `steps.${x.id}.${q.name}`)])
  return ['task', 'answer', ...gives.slice(0, 12)].map(v => `{{${v}}}`).join(', ')
}
// an outputs field's words: what the block does to give them, and a bad name
function outHint(b: Block) {
  const bad = (b.out ?? []).filter(n => !OUT_NAME.test(n) || OUT_TAKEN.includes(n))
  if (bad.length) return `${bad.join(', ')}? letters, digits, - _; not ${OUT_TAKEN.join(', ')}`
  const how = b.kind === 'run' ? 'its output is a JSON object with them' : b.kind === 'webhook' ? 'its response is a JSON object with them' : 'it’s told to end its answer with a JSON object of them'
  return `Names the blocks after it use as {{steps.${b.id}.<name>}}: ${how}`
}

function subOf(b: Block, wf: Workflow) {
  switch (b.kind) {
    case 'start': return b.input === 'task' ? 'a task' : ''
    case 'agent': return [b.agent || 'claude', b.use, b.model, b.effort, permWords(permOf(wf, b), b.fast, b.agent || 'claude')].filter(Boolean).join(' · ')
    case 'run': return b.cmd ?? ''
    case 'llm': return [b.model || 'Settings › AI’s model', b.out?.length && `→ ${b.out.join(', ')}`].filter(Boolean).join(' · ')
    case 'webhook': return `${b.method ?? 'POST'} ${(b.url ?? '').replace(/^https?:\/\//, '')}`
    case 'decide': return [DECIDE_MODELS.find(m => m.id === (b.model || DECIDE_MODELS[0].id))?.name.replace(/ \(.*\)$/, '') ?? b.model, (b.qs ?? []).map(q => `${q.name}?`).join(' '), b.route && `routes on ${b.route}`].filter(Boolean).join(' · ')
    case 'popup': return `${b.title || 'a window'}${shows(b, b.modal !== false)}`
    case 'ask': return b.question ?? ''
    case 'choice': return branchLabel({ of: b.of ?? '', test: b.test && b.test !== 'js' ? b.test : 'contains', value: b.value ?? '' })
    case 'case': return [b.of, `${b.options?.length ?? 0} ways`].filter(Boolean).join(' · ')
    case 'action': return (ACTIONS[b.action ?? ''] ?? b.action ?? '') + (b.confirm === false ? '' : ['ship', 'approve', 'merge', 'archive'].includes(b.action ?? '') ? ' · asks first' : '')
    case 'wait': return WAITS[b.for ?? ''] ?? b.for ?? ''
    case 'save': return b.link !== undefined ? `link: ${b.link}` : b.from !== undefined ? `${b.from} → ${b.file ?? ''}` : b.file ?? ''
    case 'end': return `${b.result ?? 'success'}${shows(b, !!b.modal)}`
  }
}

type Lit = { state: Record<string, 'running' | 'waiting' | 'done' | 'failed'>; taken: Set<string>; visits: Record<string, number>; live?: string } // live: the arrow it just took, while it runs

// many (the editor's): the blocks picked together (⇧ or ⌘-click, a box dragged on the canvas), moved and deleted as one;
// onKey: a key while the canvas has the keyboard (Delete, ⌘A, Esc)
function Canvas({ wf, sel, many = [], onPick, onMany, onMove, onMenu, onDrop, onKey, doomed, lit }: { wf: Workflow; sel?: string | null; many?: string[]; onPick?: (id: string | null) => void; onMany?: (ids: string[]) => void; onMove?: (moves: [string, [number, number]][]) => void; onMenu?: (e: React.MouseEvent, id: string) => void; onDrop?: (kind: BlockKind, more: Partial<Block> | undefined, at: [number, number]) => void; onKey?: (e: React.KeyboardEvent) => void; doomed?: string | null; lit?: Lit }) {
  const pos = placed(wf.blocks)
  // from: where each block it moves was (the picked ones, when it's one of them)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean; from: [string, [number, number]][] } | null>(null)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null)
  const shift = (d: NonNullable<typeof drag>) => {
    const [x0, y0] = d.from.find(([id]) => id === d.id)![1]
    return d.from.map(([id, [x, y]]): [string, [number, number]] => [id, [Math.max(0, x + d.x - x0), Math.max(0, y + d.y - y0)]])
  }
  if (drag) for (const [id, at] of shift(drag)) pos.set(id, at)
  const maxX = Math.max(0, ...[...pos.values()].map(p => p[0])) + W + 140
  const maxY = Math.max(0, ...[...pos.values()].map(p => p[1])) + H + 80
  const by = new Map(wf.blocks.map(b => [b.id, b]))
  const down = (e: PE, b: Block) => {
    if (e.button !== 0) return
    if (onMany && (e.shiftKey || e.metaKey)) {
      // in or out of the picked ones
      const now = new Set(many.length ? many : sel ? [sel] : [])
      if (now.has(b.id)) now.delete(b.id)
      else now.add(b.id)
      onMany([...now])
      return void onPick?.(now.has(b.id) ? b.id : null)
    }
    const [x, y] = pos.get(b.id)!
    const group = many.length > 1 && many.includes(b.id) ? many : [b.id]
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: b.id, dx: e.clientX - x, dy: e.clientY - y, x, y, moved: false, from: group.flatMap(id => (pos.has(id) ? [[id, pos.get(id)!] as [string, [number, number]]] : [])) })
    if (group.length === 1) onMany?.([])
    onPick?.(b.id)
  }
  const move = (e: PE) => drag && onMove && setDrag({ ...drag, x: Math.max(0, Math.round((e.clientX - drag.dx) / 10) * 10), y: Math.max(0, Math.round((e.clientY - drag.dy) / 10) * 10), moved: true })
  const up = () => {
    if (drag?.moved) onMove?.(shift(drag))
    else if (drag && drag.from.length > 1) onMany?.([]) // a click on one of the picked ones: just it
    setDrag(null)
  }
  // a box dragged on the empty canvas picks what it touches (⇧: as well); a click there, nothing
  const at = (e: PE) => (r => [e.clientX - r.left, e.clientY - r.top])((e.currentTarget as HTMLElement).getBoundingClientRect())
  const bandDown = (e: PE) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    if (!onMany) return onPick?.(null)
    const [x, y] = at(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setBand({ x0: x, y0: y, x1: x, y1: y, add: e.shiftKey || e.metaKey })
  }
  const bandMove = (e: PE) => band && (([x, y]) => setBand({ ...band, x1: x, y1: y }))(at(e))
  const box = band && { l: Math.min(band.x0, band.x1), t: Math.min(band.y0, band.y1), r: Math.max(band.x0, band.x1), b: Math.max(band.y0, band.y1) }
  const bandUp = () => {
    if (!band || !box) return
    setBand(null)
    if (box.r - box.l < 4 && box.b - box.t < 4) return void (band.add || (onPick?.(null), onMany?.([])))
    const hit = wf.blocks.filter(b => (([x, y]) => x < box.r && x + W > box.l && y < box.b && y + H > box.t)(pos.get(b.id)!)).map(b => b.id)
    const ids = band.add ? [...new Set([...(many.length ? many : sel ? [sel] : []), ...hit])] : hit
    onMany!(ids)
    onPick?.(ids.length === 1 ? ids[0] : null)
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
      if (e.name !== 'next' && (ex.length > 1 || e.max || optioned(a.kind) || !!a.route))
        labels.push(
          <div key={`${a.id}-${e.name}`} className={`wf-el ${cls}`} style={{ left: (x0 + 3 * x1 + 3 * x2 + x3) / 8, top: (y0 + 3 * y1 + 3 * y2 + y3) / 8 }}>
            {(l => (l.length > 28 ? `${l.slice(0, 27)}…` : l))(e.label ?? e.name)}
          </div>,
        )
    })
  }
  return (
    <div
      className="wf-scroll"
      tabIndex={onKey ? 0 : undefined}
      onPointerDownCapture={e => onKey && (e.currentTarget as HTMLElement).focus({ preventScroll: true }) /* the keyboard: Delete, ⌘A */}
      onKeyDown={onKey}
      onPointerDown={e => e.target === e.currentTarget && (onPick?.(null), onMany?.([]))}
      onDragOver={e => onDrop && e.dataTransfer.types.includes(DRAG) && (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'))}
      onDrop={e => {
        const raw = onDrop && e.dataTransfer.getData(DRAG)
        if (!raw) return
        e.preventDefault()
        const { kind, more } = JSON.parse(raw) as { kind: BlockKind; more?: Partial<Block> }
        const r = e.currentTarget.querySelector('.wf-canvas')!.getBoundingClientRect() // scrolled with it: canvas coordinates
        const snap = (v: number) => Math.max(0, Math.round(v / 10) * 10)
        onDrop!(kind, more, [snap(e.clientX - r.left - W / 2), snap(e.clientY - r.top - H / 2)])
      }}
    >
      <div className="wf-canvas" style={{ width: maxX, height: maxY }} onPointerDown={bandDown} onPointerMove={bandMove} onPointerUp={bandUp} onPointerCancel={() => setBand(null)}>
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
        {box && <div className="wf-band" style={{ left: box.l, top: box.t, width: box.r - box.l, height: box.b - box.t }} />}
        {wf.blocks.map(b => {
          const [x, y] = pos.get(b.id)!
          const st = lit?.state[b.id]
          const n = lit?.visits[b.id] ?? 0
          return (
            <div
              key={b.id}
              className={`wf-node ${b.kind === 'start' || b.kind === 'end' ? 'pill' : ''} ${sel === b.id || many.includes(b.id) ? 'sel' : ''} ${drag?.from.some(([id]) => id === b.id) ? 'dragging' : ''} ${doomed === b.id ? 'doomed' : ''}`}
              style={{ left: x, top: y, ['--kc' as string]: `var(--tc-${KIND_COLOR[b.kind]})` }}
              data-kind={b.kind}
              data-state={st}
              onPointerDown={e => down(e, b)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setDrag(null)}
              onContextMenu={onMenu && (e => (many.includes(b.id) || (onPick?.(b.id), onMany?.([])), onMenu(e, b.id)))}
            >
              <div className="k">
                <i />
                {BLOCK_NAMES[b.kind]}
                {b.kind !== 'start' && b.name && b.name !== b.id && <code className="wf-id">{b.id}</code>}
              </div>
              <div className="t">{blockName(b)}</div>
              <div className="s">{subOf(b, wf)}</div>
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

function Editor({ item, projects, presets, actions, exts, api, runs, onSaved, onRemove, onRun, onOpenRun, onCopy }: { item: WorkflowItem; projects: Project[]; presets: Preset[]; actions: RunAction[]; exts: Ext[]; api: WorkflowsApi; runs: FlowView[]; onSaved: (w: WorkflowItem) => void; onRemove: () => void; onRun: () => void; onOpenRun: (id: string) => void; onCopy: () => void }) {
  const [text, setText] = useState(drafts.get(keyOf(item)) ?? item.text)
  const [mode, setMode] = useState<'canvas' | 'file'>('canvas')
  const [pick, setPick] = useState<string | null>(null)
  const [many, setMany] = useState<string[]>([]) // blocks picked together (Canvas)
  const [menu, openMenu] = useMenu()
  const [hist, setHist] = useState(false) // History…
  const parsed = useMemo(() => parse(text, item.id), [text])
  const wf = parsed.workflow
  const problems = [...parsed.problems, ...check(wf)]
  const dirty = text !== item.text
  const [doomed, setDoomed] = useState<string | null>(null) // the block its trash is under the pointer: red on the canvas
  useEffect(() => setDoomed(null), [pick]) // another block's panel: not that one
  // the file changed under it (Laki AI, an agent, the CLI): taken when it wasn't changed here, or when Laki AI wrote it
  // (it was shown this draft as it was asked)
  const seen = useRef(item.text)
  // ⌘Z: the file before each change on the canvas or in the inspector, a Discard or a file taken from disk (the last 50)
  const past = useRef<string[]>([])
  const replace = (next: string) => next !== text && ((past.current = [...past.current.slice(-49), text]), setText(next))
  useEffect(() => {
    if (item.text === seen.current) return
    const was = seen.current
    seen.current = item.text
    if (text === was || item.byAgent) replace(item.text)
  }, [item.text])
  // what Laki AI's chat is told as you ask: this workflow, as the editor has it
  useEffect(() => {
    pageNow.workflow = () =>
      `the workflow "${wf.name}" open in its editor (id ${item.id}, source ${item.source}${item.project ? `, project ${item.project}` : ''}${dirty ? ', with changes not saved yet' : ''}). To change it, write the whole file back with laki_workflow_write, the same id and project. Its file as the editor shows it now:\n<workflow>\n${text.slice(0, 6000)}${text.length > 6000 ? '\n… (cut: laki_workflows with its id has all of it)' : ''}\n</workflow>`
    return () => void (pageNow.workflow = undefined)
  })
  useEffect(() => void (dirty ? drafts.set(keyOf(item), text) : drafts.delete(keyOf(item))), [text, item.text])
  const edit = (f: (w: Workflow) => void) => {
    const w: Workflow = JSON.parse(JSON.stringify(wf))
    f(w)
    replace(toFile(w))
  }
  // blocks out (never the start): the picked one, or the ones picked together
  const remove = (ids: string[]) => {
    const out = ids.filter(id => wf.blocks.some(b => b.id === id && b.kind !== 'start'))
    if (!out.length) return
    edit(w => out.forEach(id => dropBlock(w, id)))
    setPick(null)
    setMany([])
    api.toast(`${out.length === 1 ? 'Deleted a block' : `Deleted ${out.length} blocks`} · ⌘Z brings ${out.length === 1 ? 'it' : 'them'} back`)
  }
  const picked = many.length > 1 ? many : pick ? [pick] : []
  // the canvas's keys: Delete or ⌫ deletes what's picked, ⌘A picks every block, Esc none
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length) e.preventDefault(), remove(picked)
    else if (e.metaKey && e.key === 'a') e.preventDefault(), setMany(wf.blocks.map(b => b.id)), setPick(null)
    else if (e.key === 'Escape' && picked.length) e.preventDefault(), setMany([]), setPick(null)
  }
  const save = () => api.call<WorkflowItem>('flowSave', { id: item.id, source: item.source, project: item.project, text }).then(onSaved, e => api.toast((e as Error).message))
  // a repo's (.laki/workflows) not allowed as it is: the file, then Allow (or Save it here: you've read it)
  const trust = async () => {
    const say = `Events, schedules and agents start it only once you allow it as it is (an edit asks again). Its commands, webhooks and agents run on this Mac.\n\n${item.text}`
    if ((await choose(`Allow ${item.name}?`, say, [{ label: 'Not now' }, { label: 'Allow this workflow', primary: true }])) === 1) api.call<WorkflowItem>('flowTrust', { id: item.id, project: item.project, text: item.text }).then(onSaved, e => api.toast((e as Error).message))
  }
  // ⌘S saves
  const saveRef = useRef(save)
  saveRef.current = save
  // ⌘Z, outside a box being typed in (its own undo): the change before
  const undoRef = useRef(() => {})
  undoRef.current = () => {
    const was = past.current.pop()
    if (was !== undefined) setText(was), setPick(null), setMany([])
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 's') return void (e.preventDefault(), saveRef.current())
      const field = (document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      if (e.metaKey && !e.shiftKey && e.key === 'z' && !field) e.preventDefault(), undoRef.current()
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  // at: where it was dropped on the canvas (none: below the block it comes after, the blocks under it moved down)
  const addBlock = (kind: BlockKind, more: Partial<Block> = {}, after = pick, at?: [number, number]) =>
    edit(w => {
      if (w.blocks.length >= MAX_BLOCKS) return
      const id = freeId(w, kind)
      const from = w.blocks.find(b => b.id === after) ?? w.blocks.at(-1)
      const pos = placed(w.blocks)
      const [fx, fy] = from ? pos.get(from.id)! : [70, 20]
      const b: Block = { id, kind, ...JSON.parse(JSON.stringify(NEW_BLOCK[kind])), ...more, at: at ?? [fx, fy + 90] }
      // {{prev}} in its defaults: what the block before gives (an agent's or AI call's answer, a command's output), else the task
      const give = from?.kind === 'agent' || from?.kind === 'llm' ? 'answer' : from?.kind === 'run' || from?.kind === 'webhook' || from?.kind === 'wait' ? 'output' : ''
      const prev = give ? `{{steps.${from!.id}.${give}}}` : '{{task}}'
      for (const k of ['text', 'title'] as const) if (b[k]) b[k] = b[k]!.split('{{prev}}').join(prev)
      // between the picked block and where its first good exit went (one with options or routes: you link it)
      if (from && !optioned(from.kind) && !routesOf(from) && from.kind !== 'end') {
        const e = EXITS[from.kind].find(x => !BAD_EXITS.includes(x)) ?? EXITS[from.kind][0]
        const was = from.to?.[e]
        from.to = { ...from.to, [e]: id }
        if (was && !optioned(kind) && kind !== 'end') b.to = { [EXITS[kind][0]]: was }
        if (!at) for (const o of w.blocks) if (o !== from && o.at && o.at[1] > fy && Math.abs(o.at[0] - fx) < W) o.at = [o.at[0], o.at[1] + 90] // room below
      }
      w.blocks.push(b)
      setPick(id)
    })
  // a block's right click on the canvas: a block after it, a copy of it, out with it
  const blockActions = (id: string): MenuItem[] => {
    const b = wf.blocks.find(x => x.id === id)
    if (!b) return []
    const full = wf.blocks.length >= MAX_BLOCKS
    return [
      { head: blockName(b) },
      b.kind !== 'end' && !full ? { label: 'Add a block after it', icon: 'plus', items: blockMenu(`After ${blockName(b)}`, actions, presets, (k, more) => addBlock(k, more, id)) } : null,
      b.kind !== 'start' && !full
        ? {
            label: 'Duplicate',
            icon: 'copy',
            run: () =>
              edit(w => {
                const x: Block = JSON.parse(JSON.stringify(w.blocks.find(y => y.id === id)!))
                const pos = placed(w.blocks)
                const [bx, by] = pos.get(id)!
                let ax = bx + W + 40 // beside it, past any block there
                while ([...pos.values()].some(([px, py]) => Math.abs(px - ax) < W && Math.abs(py - by) < H)) ax += W + 40
                w.blocks.push({ ...x, id: freeId(w, id.replace(/\d+$/, '') || x.kind), name: x.name && `${x.name} (copy)`, at: [ax, by] })
                setPick(w.blocks.at(-1)!.id)
              }),
          }
        : null,
      b.kind !== 'start' ? (many.length > 1 && many.includes(id) ? { label: `Delete these ${many.length}`, icon: 'trash', danger: true, run: () => remove(many) } : { label: 'Delete', icon: 'trash', danger: true, run: () => remove([id]) }) : null,
    ]
  }
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
          {item.byAgent && <span className="wf-agent">An agent wrote it: read it, then Save it. Until then only Start here runs it (no schedule, event or agent)</span>}
          {item.untrusted && !item.byAgent && (
            <span className="wf-agent">
              {item.changed ? 'Changed since you allowed it' : 'From this repo'}: {wf.on ? <>starts on <code>{wf.on}</code> {item.changed && 'again '}once you allow it; until then only Start here runs it</> : 'only Start here runs it (no schedule, event or agent) until you allow it'}. <button className="link" onClick={trust}>Allow…</button>
            </span>
          )}
        </div>
        <span className="grow" />
        <div className="seg">
          <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>Blocks</button>
          <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>File</button>
        </div>
        {dirty && (
          <button className="btn" onClick={() => replace(item.text)} data-tip="Back to the saved file (⌘Z: your changes again)">
            Discard
          </button>
        )}
        <button className="btn" disabled={!dirty && !item.byAgent && !item.untrusted} onClick={save} data-tip={item.byAgent ? 'An agent wrote it: saving it here says you read it, and lets schedules, events and agents run it' : item.untrusted ? "From this repo: saving it here says you read it, and lets schedules, events and agents run it" : '⌘S'}>{dirty || item.byAgent || item.untrusted ? 'Save' : 'Saved'}</button>
        {runs.length > 0 && (
          <button className="btn" onClick={() => onOpenRun(runs[0].id)} data-tip={runs.map(r => `${r.task || r.name}: ${STATUS_WORDS[r.status]}`).join('\n')}>
            <span className="wf-dot" /> {runs.length} running
          </button>
        )}
        {api.ai && <IconButton icon="ai" title="Change it with Laki AI: its chat knows this workflow" onClick={() => api.ai!()} />}
        <IconButton
          icon="more"
          title="More: copy, history, delete"
          onClick={e =>
            openMenu(e, [
              { label: 'Make a copy', icon: 'copy', run: onCopy },
              { label: 'History…', sub: 'Earlier versions: each save keeps the one before', icon: 'clock', run: () => setHist(true) },
              null,
              { label: 'Delete this workflow', icon: 'trash', danger: true, run: onRemove },
            ])
          }
        />
        <button className="btn primary" disabled={problems.length > 0 || dirty} onClick={onRun} data-tip={problems[0] ?? (dirty ? 'Save it first' : 'Start a run')}>
          <Icon name="run" size={12} /> Run
        </button>
      </div>
      <div className="wf-bar">
        {where}
        {problems.length > 0 && (
          <span className="wf-problems" data-tip={problems.join('\n')}>
            {problems.length === 1 ? problems[0] : `${problems[0]} · ${problems.length - 1} more`}
          </span>
        )}
      </div>
      {mode === 'canvas' ? (
        <div className="wf-split">
          <Palette wf={wf} actions={actions} presets={presets} full={wf.blocks.length >= MAX_BLOCKS} pick={pick} onAdd={(k, more) => addBlock(k, more)} toast={api.toast} edit={edit} api={api} />
          <Canvas wf={wf} sel={pick} many={many} onPick={setPick} onMany={setMany} onKey={onKey} onMove={moves => edit(w => moves.forEach(([id, at]) => (b => b && (b.at = at))(w.blocks.find(b => b.id === id))))} onMenu={(e, id) => openMenu(e, blockActions(id))} onDrop={(k, more, at) => addBlock(k, more, pick, at)} doomed={doomed} />
          {many.length > 1 ? (
            <div className="wf-insp">
              <div className="wf-insp-head">
                <b>{many.length} blocks picked</b>
              </div>
              <p className="wf-hint">Drag one to move them all. ⇧-click adds or takes out one; a box dragged on the canvas picks what it touches.</p>
              {many.some(id => wf.blocks.some(b => b.id === id && b.kind !== 'start')) && (
                <button className="btn danger" onClick={() => remove(many)}>
                  <Icon name="trash" size={12} /> Delete them <kbd>⌫</kbd>
                </button>
              )}
              <p className="wf-hint">⌘Z brings back what you deleted; Discard goes back to the saved file.</p>
            </div>
          ) : (
            <Inspector wf={wf} id={pick} presets={presets} actions={actions} exts={exts} edit={edit} onPick={setPick} api={api} project={item.project} onDoom={setDoomed} />
          )}
        </div>
      ) : (
        <div className="wf-file">
          <FileEdit text={text} onText={setText} />
          <details className="wf-format">
            <summary>The format</summary>
            <Markdown src={FORMAT_HELP} />
          </details>
        </div>
      )}
      {menu}
      {hist && <HistoryDialog item={item} dirty={dirty} api={api} onClose={() => setHist(false)} onBack={w => (replace(w.text), onSaved(w))} />}
    </div>
  )
}

const KIND_SAYS: Record<BlockKind, string> = {
  start: 'Where it begins',
  agent: 'A prompt to an agent; waits for its turn to end',
  run: 'A shell command: ok or fail by its exit code',
  llm: 'One call to a model on OpenRouter: a prompt in, an answer out',
  webhook: 'An HTTP request to another system: its response back',
  decide: 'Typed questions to a decision model: probabilities, not text',
  popup: 'A window in Laki with a result: HTML or Markdown',
  choice: 'Yes or no, by what a block said (if / else)',
  case: 'Many ways: the first branch that holds (if / elsif / else)',
  ask: 'A question with buttons, for you',
  action: 'Open a PR, approve, merge, dev server, archive',
  wait: 'Until its PR’s checks pass or fail',
  save: 'Text, a file or a link, into the workspace’s Artifacts',
  extension: 'Fetch one of your extensions now: its data as variables',
  end: 'Done, stopped or failed',
}
// an id no block has: the kind's name, else with a number (agent2)
function freeId(w: Workflow, base: string) {
  const ids = new Set(w.blocks.map(b => b.id))
  let id = base
  for (let n = 2; ids.has(id); n++) id = `${base.slice(0, 38)}${n}` // ID's 41 at most
  return id
}
// a block out, and every way to it (exits, options, a max's) with it: they go nowhere now; a session on it: the run's
function dropBlock(w: Workflow, id: string) {
  w.blocks = w.blocks.filter(x => x.id !== id)
  for (const o of w.blocks) {
    for (const [k, v] of Object.entries(o.to ?? {})) if (v === id) delete o.to![k]
    for (const opt of o.options ?? []) if (opt.to === id) delete opt.to
    if (o.max?.to === id) delete o.max.to
    if (o.session === id) delete o.session // its tab: the run's again
  }
}
const NEW_BLOCK: Record<BlockKind, Partial<Block>> = {
  start: { input: 'task' },
  agent: { name: 'Agent', agent: 'claude', text: '{{task}}' },
  run: { name: 'Tests', cmd: 'npm test' },
  llm: { name: 'Sum it up', text: 'Sum up this work in three lines, and give it a title:\n\n{{prev}}', out: ['title', 'summary'] },
  decide: {
    name: 'Triage',
    model: DECIDE_MODELS[0].id,
    text: '{"input": {{prev}}}',
    qs: [{ name: 'urgent', type: 'yes/no', ask: 'Does any of these messages need me today?', opts: [{ label: 'yes', text: 'someone is blocked, a deadline today, an outage' }, { label: 'no', text: 'FYI, chatter, newsletters' }] }],
  },
  popup: { name: 'Show the result', title: 'Done: {{task}}', text: '{{prev}}' },
  webhook: { name: 'Post it', url: 'https://example.com/hook', text: '{"task": "{{task}}", "text": "{{prev}}"}' },
  choice: { name: 'If', of: 'answer', test: 'contains', value: 'yes', options: [{ label: 'Yes' }, { label: 'No' }] },
  case: { name: 'Case', of: 'answer', options: [{ label: 'equals "only_specs"' }, { label: 'contains "fix"' }, { label: 'else' }] },
  ask: { name: 'Ask you', question: 'Go on?', options: [{ label: 'Yes' }, { label: 'Stop' }] },
  action: { name: 'Open a PR', action: 'ship', text: '{{task}}' },
  wait: { name: 'CI checks', for: 'checks' },
  save: { name: 'Save', file: 'notes.md', text: '{{prev}}' },
  extension: { name: 'Extension', extension: '' },
  end: { name: 'Done', result: 'success' },
}
// what a workflow can add, in groups: each kind, an agent action (Run ▾'s) as an agent block, and the three ways to keep
// something (the sidebar's tiles and a block's Add a block after it)
type Pick = { label: string; sub?: string; pill?: string; kind: BlockKind; more?: Partial<Block> }
function picks(actions: RunAction[], presets: Preset[]): { head: string; items: Pick[] }[] {
  const one = (k: BlockKind): Pick => ({ label: BLOCK_NAMES[k], sub: KIND_SAYS[k], kind: k })
  const presetOf = (a: RunAction) => (a.target !== 'any' && presets.some(p => p.name === a.target) ? a.target : undefined)
  return [
    { head: 'Blocks', items: [one('agent'), ...(['run', 'choice', 'case', 'ask', 'popup', 'action', 'wait'] as const).map(one)] },
    { head: 'Agent actions', items: actions.map(a => ({ label: a.name, sub: a.slug, pill: a.target === 'any' ? undefined : a.target, kind: 'agent', more: { name: a.name, use: ref(a), text: undefined, ...(presetOf(a) && { agent: presetOf(a) }) } })) },
    { head: 'Outside Laki', items: [one('llm'), one('decide'), one('webhook'), one('extension')] },
    {
      head: 'Into its Artifacts',
      items: [
        { label: 'Save text', sub: 'An answer, notes: a file in the storage folder', kind: 'save' },
        { label: 'Save a file', sub: 'A file or folder of the workspace, copied there', kind: 'save', more: { name: 'Keep a file', file: 'report.html', from: 'report.html', text: undefined } },
        { label: 'Save a link', sub: 'A URL (its PR, a deploy), listed first', kind: 'save', more: { name: 'Keep the PR', file: 'Pull request', link: '{{pr.url}}', text: undefined } },
      ],
    },
    { head: 'The end', items: [one('end')] },
  ]
}
// a block's Add a block after it: picks as a menu, the agent actions in a submenu
function blockMenu(head: string, actions: RunAction[], presets: Preset[], add: (k: BlockKind, more?: Partial<Block>) => void): MenuItem[] {
  const [main, acts, ...rest] = picks(actions, presets)
  const item = (p: Pick): MenuItem => ({ label: p.label, sub: p.sub, pill: p.pill, run: () => add(p.kind, p.more) })
  return [
    { head },
    item(main.items[0]),
    acts.items.length ? { label: 'Agent action', sub: 'One of Run ▾’s, as an agent block', items: acts.items.map(item) } : { label: 'Agent action', sub: 'None yet: Settings › Actions', run: () => add('agent') },
    ...main.items.slice(1).map(item),
    ...rest.flatMap((g): MenuItem[] => [{ head: g.head }, ...g.items.map(item)]),
  ]
}

// the editor's left sidebar: Blocks (a click adds one after the picked block, a drag drops it where you let go) and
// Variables (a click copies one, a drag drops it into a field)
const DRAG = 'application/x-laki-block'
function Palette({ wf, actions, presets, full, pick, onAdd, toast, edit, api }: { wf: Workflow; actions: RunAction[]; presets: Preset[]; full: boolean; pick: string | null; onAdd: (k: BlockKind, more?: Partial<Block>) => void; toast: (t: string) => void; edit: (f: (w: Workflow) => void) => void; api: WorkflowsApi }) {
  const [tab, setTab] = useState<'blocks' | 'vars'>('blocks')
  const after = wf.blocks.find(b => b.id === pick)
  return (
    <aside className="wf-palette" aria-label="Blocks and variables">
      <div className="seg">
        <button className={tab === 'blocks' ? 'on' : ''} onClick={() => setTab('blocks')}>Blocks</button>
        <button className={tab === 'vars' ? 'on' : ''} onClick={() => setTab('vars')}>{'{{ }}'} Variables</button>
      </div>
      {tab === 'blocks' ? (
        <>
          <p className="wf-hint">{full ? `${MAX_BLOCKS} blocks at most` : `A click adds it ${after ? `after ${blockName(after)}` : 'at the end'}; or drag it onto the canvas`}</p>
          {picks(actions, presets).map(g => (
            <section key={g.head}>
              <h4>{g.head}</h4>
              {!g.items.length && <p className="wf-hint">None yet: Settings › Actions</p>}
              {g.items.map(p => (
                <div
                  key={`${p.kind}:${p.label}`}
                  role="button"
                  tabIndex={0}
                  aria-disabled={full}
                  draggable={!full}
                  className="wf-tile"
                  style={{ ['--kc' as string]: `var(--tc-${KIND_COLOR[p.kind]})` }}
                  data-tip={p.sub}
                  onDragStart={e => (e.dataTransfer.setData(DRAG, JSON.stringify({ kind: p.kind, more: p.more })), (e.dataTransfer.effectAllowed = 'copy'))}
                  onClick={() => !full && onAdd(p.kind, p.more)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !full && onAdd(p.kind, p.more))}
                >
                  <i />
                  <b>{p.label}</b>
                  {p.pill && <span className="wf-tile-pill">{p.pill}</span>}
                </div>
              ))}
            </section>
          ))}
        </>
      ) : (
        <>
          <p className="wf-hint">{'A click copies one; drag it into a field. A block’s are there once it ran'}</p>
          <VarList title="This workflow’s" hint="In its file: saved with it" vars={wf.vars ?? {}} onSet={v => edit(w => void (w.vars = Object.keys(v).length ? v : undefined))} toast={toast} />
          {api.setGlobals && <VarList title="Every workflow’s" hint="Global: kept in Laki’s settings; a workflow’s own of the same name wins" vars={api.globals ?? {}} onSet={v => void api.setGlobals!(v)} toast={toast} />}
          <VarsBody wf={wf} toast={toast} />
        </>
      )}
    </aside>
  )
}

// the editor's History…: the file's earlier versions (each save keeps the one before it, the last 20), one shown, Put
// this one back (a save: the file as it is now goes to the history first)
function HistoryDialog({ item, dirty, api, onClose, onBack }: { item: WorkflowItem; dirty: boolean; api: WorkflowsApi; onClose: () => void; onBack: (w: WorkflowItem) => void }) {
  type V = { at: number; size: number; first: string }
  const ref = { id: item.id, source: item.source, project: item.project }
  const [list, setList] = useState<V[] | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [text, setText] = useState('')
  useEffect(() => void api.call<V[]>('flowHistory', ref).then(l => (setList(l), l[0] && setSel(l[0].at)), e => (api.toast((e as Error).message), setList([]))), [])
  useEffect(() => {
    if (sel === null) return
    let now = true // a slower answer for an earlier pick doesn't show
    setText('')
    api.call<{ text: string }>('flowHistory', { ...ref, at: sel }).then(v => now && setText(v.text), () => now && setText(''))
    return () => void (now = false)
  }, [sel])
  const lines = useMemo(() => highlightWorkflow(text), [text])
  const back = async () => {
    if (sel === null) return
    if (dirty && !(await ask('Put this version back?', { text: 'Your changes that aren’t saved go. The file as it is now stays in History.', ok: 'Put it back', danger: true }))) return
    api.call<WorkflowItem>('flowRevert', { ...ref, at: sel }).then(w => (onBack(w), onClose(), api.toast('Put back: the version before it is in History')), e => api.toast((e as Error).message))
  }
  return (
    <Modal title={`History · ${item.name}`} onClose={onClose} wide>
      {list === null ? (
        <p className="wf-hint">Loading…</p>
      ) : !list.length ? (
        <p className="wf-hint">No earlier versions yet: each save keeps the one before it (the last 20).</p>
      ) : (
        <div className="wf-hist">
          <div className="wf-hist-list">
            {list.map(v => (
              <button key={v.at} className={`wf-hist-row ${v.at === sel ? 'on' : ''}`} onClick={() => setSel(v.at)}>
                <b>{ago(v.at)}</b>
                <span className="wf-hint">{new Date(v.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {v.size < 1024 ? `${v.size} B` : `${Math.round(v.size / 1024)} KB`}</span>
              </button>
            ))}
          </div>
          <pre className="wf-hist-text">
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && '\n'}
                {l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t))}
              </Fragment>
            ))}
          </pre>
        </div>
      )}
      <div className="wf-start-foot">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" disabled={sel === null} onClick={back}>Put this one back</button>
      </div>
    </Modal>
  )
}

// the File view: the file colored (highlight.ts' highlightWorkflow) in a pre laid under the textarea, whose own text is
// clear: the same box, font and wrapping (workflows.css' .wf-code), the pre following its scroll
function FileEdit({ text, onText }: { text: string; onText: (t: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLPreElement>(null)
  const lines = useMemo(() => highlightWorkflow(text), [text])
  const follow = () => void (pre.current && area.current && (pre.current.scrollTop = area.current.scrollTop))
  useLayoutEffect(follow)
  return (
    <div className="wf-code">
      <pre ref={pre} aria-hidden>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            {l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t))}
          </Fragment>
        ))}
        {' ' /* a last empty line takes its room, as in the textarea */}
      </pre>
      <textarea ref={area} value={text} spellCheck={false} aria-label="The workflow's file" onChange={e => onText(e.target.value)} onScroll={follow} />
    </div>
  )
}

const FORMAT_HELP =`\`# Name\`, a line saying what it does, then \`runs in: worktree|main · session: new|shared · at once: 3 · turns: 30 · perm: acceptEdits · when done: keep · on: pr.merged\` (perm: its agent blocks' permission mode unless one says its own; when done: archive, a worktree run's default, archives the worktree a done run made when it's clean, keep keeps it; on: an event that starts a run by itself, its fields as \`{{event.…}}\`; optional).

A \`## id\` per block. Its first key says its kind: \`input: task\` (start), \`agent: claude · model: opus · effort: high · perm: auto|acceptEdits|plan|bypassPermissions · fast: yes · session: run|new|<block> · json: yes\` (perm: how freely it acts, unset the workflow's, else its profile's, else the agent's own, which asks; fast: unset, its profile's; JSON mode: its answer the JSON it ends with), \`run: npm test\`, \`ask: Build it?\` with \`show:\`, \`choice: steps.review.answer contains "LGTM"\` (if / else: two options), \`case: steps.classify.answer\` with branches \`- equals "only_specs" → id\`, \`- steps.size.output equals "0" → id\`, \`- else → id\` (the first that holds; else last), \`action: ship|approve|merge|dev|archive\` (\`ask first: no\`), \`wait: checks\`, \`save: notes.md\` (its text as \`>\` lines, or \`from: a/file\`, or \`link: {{pr.url}}\`), \`llm: anthropic/claude-sonnet-4.5\` (one OpenRouter call, its prompt as \`>\` lines; empty: Settings › AI's model; \`json: yes\`: its answer one JSON object, the default with \`out:\`), \`webhook: https://…\` with \`method: POST\`, \`header: Authorization: Bearer {{env.TOKEN}}\` lines and its body as \`>\` lines (or \`from: a/file\`; none: the run's variables as JSON), \`decide: typesafe/jev-1.13 · sure: 0.7\` (an AI decision: the state as \`>\` lines, then \`question: urgent · yes/no|choice|score · what it asks\` lines (\`noul\` is yes/no), each with indented \`  yes: …\` / \`  <option>: …\` / \`  - <level>\` lines; each answer is \`{{steps.<id>.<name>}}\` with \`.p\` and \`.confidence\`; \`route: urgent\` then \`- <answer> → id\` lines: a way out per answer, a score's by its level's number), \`popup: Done\`, \`notify: yes\`, \`popover: yes\`, \`modal: no\`, \`phone: yes\` (a window in Laki, its body as \`>\` lines: HTML or Markdown; a corner card; a macOS notification), \`end: success|stopped|failed · notify: yes · popover: yes · modal: yes · phone: yes\` (its \`>\` lines: what they say; \`phone\`: a push too, Settings › Phone pushes). A case's branch may also be \`- steps.triage.urgent.p >= 0.8 → id\` or \`- js: num('steps.triage.urgency') >= 2 → id\` (vars, num(name), json(name)). \`out: title, summary\` on an agent, llm, run or webhook block: what it gives the blocks after it, \`{{steps.<id>.title}}\` (an agent or an llm ends its answer with a JSON object of them; a command's output or a response is one). An agent block's \`use: <slug>\` sends one of Run ▾'s agent actions (its slug: Settings › Actions), the \`>\` lines after it.

\`> lines\` are its prompt (or text). Exits: \`next: id\`, \`ok:\`, \`fail:\`, \`error:\`, \`pass:\`; a choice's and an ask's options: \`- Label → id\`. \`max: 3 → id\` limits a block (every loop needs one, or an ask). \`retry: 2\` on an agent, run, llm, decide or extension block tries it again after a fail or an error (10 s, then 60 s), before it goes that way; a run block's \`retry on: 1, 75\`: only those exit codes. \`at: x,y\`: where it's drawn.

Variables: \`{{task}}\`, \`{{answer}}\` (your last), \`{{steps.<id>.answer}}\` (an agent's), \`{{steps.<id>.output}}\` (a command's last lines, a wait's failed checks, a webhook's response), \`{{steps.<id>.status}}\` (a webhook's HTTP status), \`{{steps.<id>.<name>}}\` (its \`out:\`), \`{{env.NAME}}\` (a webhook's only), \`{{pr.url}}\`, \`{{ws.branch}}\`, \`{{base}}\`, \`{{project}}\`.`

function Inspector({ wf, id, presets, actions, exts, edit, onPick, api, project, onDoom }: { wf: Workflow; id: string | null; presets: Preset[]; actions: RunAction[]; exts: Ext[]; edit: (f: (w: Workflow) => void) => void; onPick: (id: string | null) => void; api: WorkflowsApi; project?: string; onDoom?: (id: string | null) => void }) {
  const b = wf.blocks.find(x => x.id === id)
  const used = b?.use ? findAction(actions, [], b.use) : undefined
  if (!b)
    return (
      <div className="wf-insp">
        <p className="wf-hint">Pick a block to change it. Drag blocks to move them; ⇧-click or a box dragged on the canvas picks several; Delete or ⌫ deletes what's picked (⌘Z brings it back). The sidebar's blocks go after the picked one (a click) or where you drop them.</p>
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
        <div className="wf-field">
          <label>Starts on</label>
          <Typed list="wf-events" placeholder="only when you start it (or an event: pr.merged, custom.deploy…)" value={wf.on ?? ''} onText={v => edit(w => void (w.on = v.trim() || undefined))} />
          <datalist id="wf-events">{[...WIDGET_EVENTS, 'custom.*'].map(e => <option key={e} value={e} />)}</datalist>
        </div>
        {wf.on && (
          <div className="wf-field">
            <label>Only when</label>
            {(wf.when ?? []).map((t, i) => (
              <div key={i} className="wf-when">
                <div className="wf-when-row">
                  <Typed value={t} aria-label={`Test ${i + 1}`} placeholder='event.pr.draft equals "false"' className={whenProblem(t) ? 'bad' : ''} onText={v => edit(w => void (w.when![i] = v))} />
                  <IconButton icon="x" title="Remove this test" onClick={() => edit(w => void (w.when = (l => (l.length ? l : undefined))(w.when!.filter((_, j) => j !== i))))} />
                </div>
                {whenProblem(t) && <span className="wf-hint wf-bad">{whenProblem(t)}</span>}
              </div>
            ))}
            <button className="link wf-when-add" onClick={() => edit(w => void (w.when = [...(w.when ?? []), '']))}>Add a test</button>
            <span className="wf-hint">The Case block’s tests on the event’s fields, e.g. <code>event.pr.draft equals "false"</code>. Every one must hold.</span>
          </div>
        )}
        <div className="wf-field">
          <label>How freely its agents act</label>
          <select value={wf.perm ?? ''} onChange={e => edit(w => void (w.perm = e.target.value || undefined))}>
            <option value="">Their own: they ask first</option>
            {PERMS.claude!.map(([id, label, sub]) => (
              <option key={id} value={id}>{label}: {sub}</option>
            ))}
            {wf.perm && !PERMS.claude!.some(p => p[0] === wf.perm) && <option value={wf.perm}>{wf.perm}?</option>}
          </select>
          <span className="wf-hint">{wf.perm === 'bypassPermissions' ? 'Never asks: only you can start it, not an agent' : 'Every agent block’s (claude, codex) unless it says its own. Unattended, one that asks waits for you.'}</span>
        </div>
        <div className="wf-field">
          <label>When a run is done</label>
          <select value={wf.done ?? ''} onChange={e => edit(w => void (w.done = e.target.value || undefined))}>
            <option value="">{wf.where === 'worktree' ? 'As usual: archive its worktree' : 'As usual: keep the workspace'}</option>
            {Object.entries(DONES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
            {wf.done && !(wf.done in DONES) && <option value={wf.done}>{wf.done}?</option>}
          </select>
          <span className="wf-hint">Only a worktree the run made, once nothing is left uncommitted (Restore brings it back). A failed or stopped run’s stays.</span>
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
  // an agent block's: its preset's agent, its permission modes, the workflow's as it applies to it
  const prof = presets.find(p => p.name === (b.agent ?? 'claude'))
  const ag = (prof?.agent ?? b.agent ?? 'claude') as Agent
  const perms = PERMS[ag] ?? []
  const wfPerm = perms.length ? permWords(wf.perm, false, ag) : ''
  const profPerm = perms.length ? permWords(prof?.perm, false, ag) : '' // the profile's, when the block and the workflow say none
  return (
    <div className="wf-insp">
      <div className="wf-insp-head" style={{ ['--kc' as string]: `var(--tc-${KIND_COLOR[b.kind]})` }}>
        <span className="k">{BLOCK_NAMES[b.kind]}</span>
        <code>{b.id}</code>
        <span className="grow" />
        {b.kind !== 'start' && (
          <span className="wf-doom" onPointerEnter={() => onDoom?.(b.id)} onPointerLeave={() => onDoom?.(null)}>
            <IconButton icon="trash" title="Remove this block" className="danger" onClick={() => (onDoom?.(null), edit(w => dropBlock(w, b.id)), onPick(null))} />
          </span>
        )}
      </div>
      {b.kind === 'start' && field('Inputs', text(b.inputs?.map(inputText).join(', '), (x, v) => (x.inputs = v.trim() ? inputsOf(v) : undefined), false, 'issue:number, base:branch=main, size:choice(s|m|l)=m'), 'Besides the task, what Run asks for: name, ? when optional, :number, :branch or :choice(a|b), =its default. Each is {{inputs.<name>}}; a scheduled run takes the defaults.')}
      {b.kind !== 'start' && field('Name', text(b.name, (x, v) => (x.name = v || undefined), false, b.id))}
      {b.kind !== 'start' && <IdField key={b.id} id={b.id} rename={to => (edit(w => void renameBlock(w, b.id, to)), onPick(to))} check={to => renameBlock(JSON.parse(JSON.stringify(wf)), b.id, to)} />}
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
          {(perms.length > 0 || b.perm) &&
            field(
              'How freely it acts',
              <select value={b.perm ?? ''} onChange={e => set(x => void (x.perm = e.target.value || undefined))}>
                <option value="">{wfPerm ? `The workflow’s: ${wfPerm}` : profPerm ? `Its profile’s: ${profPerm}` : 'The agent’s own: it asks first'}</option>
                {perms.map(([id, label, sub]) => (
                  <option key={id} value={id}>{label}: {sub}</option>
                ))}
                {b.perm && !perms.some(p => p[0] === b.perm) && <option value={b.perm}>{b.perm}? ({ag} hasn’t it)</option>}
              </select>,
              (permOf(wf, b, ag) ?? prof?.perm) === 'bypassPermissions' ? 'Never asks: an agent can’t start this workflow, only you' : 'Unattended, an agent that asks waits for you. Blocks sharing its tab need the same.',
            )}
          {(FAST[ag] || b.fast) && (
            <Switch className="switch-row" on={!!b.fast} onChange={v => set(x => void (x.fast = v || undefined))}>
              Fast mode: more speed, more usage{!b.fast && prof?.fast ? ' (on in its profile)' : ''}
            </Switch>
          )}
          {field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? AGENT_TIMEOUT} onText={v => set(x => void (x.timeout = Number(v) && Number(v) !== AGENT_TIMEOUT ? Number(v) : undefined))} />, 'No answer by then: Esc, and its error way. Time it waits for you doesn’t count; silent 10 min, Laki checks in once, then asks you')}
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
          <Switch className="switch-row" on={!!b.json} onChange={v => set(x => void (x.json = v || undefined))}>
            JSON mode
          </Switch>
          <span className="wf-hint">{b.json ? `It’s told to end with one JSON object or list (a \`\`\`json block); {{steps.${b.id}.answer}} is that JSON: bare in an AI decision’s state, json('steps.${b.id}.answer') in a Case’s JS. No JSON in it: its words, said in the log.` : 'Its answer is its last message. On: one JSON object or list, for the blocks after it to read.'}</span>
        </>
      )}
      {b.kind === 'run' && (
        <>
          {field('Command', text(b.cmd, (x, v) => (x.cmd = v), false, 'npm test'), 'In the run’s folder; its exit code picks ok or fail. Variables are quoted.')}
          {field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? 10} onText={v => set(x => void (x.timeout = Number(v) || undefined))} />)}
        </>
      )}
      {b.kind === 'llm' && (
        <>
          {field('Model', text(b.model, (x, v) => (x.model = v.trim() || undefined), false, 'Settings › AI’s'), 'An OpenRouter model, e.g. anthropic/claude-sonnet-4.5. Its key: Settings › AI')}
          {field('Prompt', text(b.text, (x, v) => (x.text = v || undefined), true), `One call, no tools: ${varsHint(wf, b)}`)}
          {field('System prompt', <Typed area rows={2} value={b.system ?? ''} placeholder="Optional: who it is, how it answers" onText={v => set(x => void (x.system = v.trim() ? v.replace(/\s*\n\s*/g, ' ') : undefined))} />)}
          <Switch className="switch-row" on={b.json ?? !!b.out?.length} onChange={v => set(x => void (x.json = v === !!x.out?.length ? undefined : v))}>
            JSON mode
          </Switch>
          <span className="wf-hint">{b.json ?? !!b.out?.length ? `Its answer is one JSON object (OpenRouter’s response_format). Outputs below take its keys; a Case’s JS reads it with json('steps.${b.id}.answer').` : 'Its answer is text. On: one JSON object (on by itself with Outputs).'}</span>
          <div className="wf-row2">
            {field('Temperature', <Typed type="number" min={0} max={2} value={b.temperature ?? ''} placeholder="its default" onText={v => set(x => void (x.temperature = v === '' || Number.isNaN(Number(v)) ? undefined : Math.min(2, Math.max(0, Number(v)))))} />)}
            {field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? 2} onText={v => set(x => void (x.timeout = Number(v) || undefined))} />)}
          </div>
        </>
      )}
      {b.kind === 'decide' && <DecideFields key={`q:${b.id}`} wf={wf} b={b} set={set} />}
      {b.kind === 'popup' && (
        <>
          {field('Title', text(b.title, (x, v) => (x.title = v.trim() || undefined), false, 'Done: {{task}}'))}
          {field('Shows', text(b.text, (x, v) => (x.text = v || undefined), true), `HTML when it starts with <, else Markdown; scrollable, with Close. ${varsHint(wf, b)}`)}
          <NotifyFields b={b} set={set} api={api} what="as it shows the window" />
        </>
      )}
      {b.kind === 'webhook' && (
        <>
          <div className="wf-row2">
            {field(
              'Method',
              <select value={b.method ?? 'POST'} onChange={e => set(x => void (x.method = e.target.value === 'POST' ? undefined : (e.target.value as Block['method'])))}>
                {METHODS.map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>,
            )}
            {field('Timeout (minutes)', <Typed type="number" min={1} value={b.timeout ?? 2} onText={v => set(x => void (x.timeout = Number(v) || undefined))} />)}
          </div>
          {field('URL', text(b.url, (x, v) => (x.url = v.trim()), false, 'https://example.com/hook'), '{{vars}} too; ok on a 2xx answer')}
          {field('Headers', <Typed area rows={2} value={(b.headers ?? []).join('\n')} placeholder="Authorization: Bearer {{env.API_TOKEN}}" onText={v => set(x => void (x.headers = (l => (l.length ? l : undefined))(v.split('\n').map(h => h.trim()).filter(Boolean))))} />, 'One per line. {{env.NAME}}: Settings’ or the project’s env, for a secret (never in the log)')}
          {(b.method ?? 'POST') !== 'GET' && (
            <>
              {field(
                'Body',
                <select value={b.from !== undefined ? 'file' : b.text !== undefined ? 'text' : 'vars'} onChange={e => set(x => void ((x.from = e.target.value === 'file' ? x.from || 'report.html' : undefined), (x.text = e.target.value === 'text' ? x.text || '{"text": "{{steps.work.answer}}"}' : undefined)))}>
                  <option value="vars">The run’s variables, as JSON</option>
                  <option value="text">Text or JSON</option>
                  <option value="file">A file of the workspace</option>
                </select>,
              )}
              {b.text !== undefined && field('Text', text(b.text, (x, v) => (x.text = v), true), `JSON when it starts with { or [: values go in escaped. ${varsHint(wf, b)}`)}
              {b.from !== undefined && field('File', text(b.from, (x, v) => (x.from = v), false, 'report.pdf'), 'A path in the workspace ({{steps.<id>.<name>}} too), sent as it is')}
            </>
          )}
        </>
      )}
      {(b.kind === 'llm' || b.kind === 'decide' || b.kind === 'webhook') && <TestBlock key={`t:${b.id}`} b={b} api={api} project={project} own={wf.vars} />}
      {RETRY_KINDS.includes(b.kind) && (
        <div className="wf-row2">
          {field(
            'Tries again',
            <Typed type="number" min={0} max={RETRY_MAX} value={b.retry ?? 0} onText={v => set(x => {
              const n = Math.round(Number(v))
              x.retry = n > 0 ? Math.min(RETRY_MAX, n) : undefined
              if (!x.retry) x.retryOn = undefined
            })} />,
            b.retry ? `On ${b.kind === 'run' ? 'fail' : 'error'}: again after 10 s, then 60 s; then that way` : `0: ${b.kind === 'run' ? 'fail' : 'error'} goes its way at once`,
          )}
          {b.kind === 'run' && !!b.retry && field('Only on exit codes', <Typed value={(b.retryOn ?? []).join(', ')} placeholder="any but 0" onText={v => set(x => void (x.retryOn = (c => (c.length ? c : undefined))(v.split(/[\s,]+/).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 255))))} />, 'e.g. 1, 75')}
        </div>
      )}
      {OUT_KINDS.includes(b.kind) && field('Outputs', <Typed value={(b.out ?? []).join(', ')} placeholder="title, summary, files" onText={v => set(x => void (x.out = (n => (n.length ? n : undefined))(v.split(/[\s,]+/).filter(Boolean))))} />, outHint(b))}
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
                {TESTS.filter(t => t !== 'js').map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>,
            )}
            {field('Value', text(b.value, (x, v) => (x.value = v)))}
          </div>
        </>
      )}
      {b.kind === 'case' && field('Of', text(b.of, (x, v) => (x.of = v.trim() || undefined), false, 'steps.classify.answer'), 'What its branches test (a branch may name its own); the first that holds wins, else the last. Numbers: >= 0.8 (a decision’s .p); JS: anything')}
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
      {b.kind === 'extension' &&
        field(
          'Extension',
          <select value={b.extension ?? ''} onChange={e => set(x => void (x.extension = e.target.value))}>
            <option value="">Pick one…</option>
            {[...exts.filter(x => x.every !== undefined || x.id === b.extension), ...(b.extension && !exts.some(x => x.id === b.extension) ? [{ id: b.extension, name: `${b.extension} (not here)`, on: false }] : [])].map(x => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.on ? '' : ' (off: turn it on to run)'}
              </option>
            ))}
          </select>,
          `Fetched now, then {{steps.${b.id}.data}} and each field of it, {{steps.${b.id}.<field>}}. Only one that's turned on runs`,
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
          <NotifyFields b={b} set={set} api={api} what="as the run ends here" />
          {(b.notify || b.popover || b.modal) && field('What it says', text(b.text, (x, v) => (x.text = v || undefined), false, blockName(b)), `{{vars}} too, e.g. {{pr.url}}; empty: “${blockName(b)}”. ${varsHint(wf, b)}`)}
        </>
      )}
      {b.kind !== 'end' && <div className="wf-sub">Where it goes</div>}
      {b.kind === 'decide' &&
        field(
          'Ways out',
          <select value={b.route ?? ''} onChange={e => set(x => void ((x.route = e.target.value || undefined), x.route || (x.options = undefined)))}>
            <option value="">One: ok (then a Case routes)</option>
            {(b.qs ?? []).map(q => (
              <option key={q.name} value={q.name}>{`A line per answer of ${q.name}`}</option>
            ))}
          </select>,
          b.route ? `Its answer to ${b.route} picks the line; not sure, it asks you first, then goes your way.` : 'Or a line for each answer of one question.',
        )}
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
                  {cur.test === 'js' ? <span className="wf-hint grow">a JS expression: vars, num(name), json(name)</span> : <Typed value={cur.of ?? ''} placeholder={b.of || 'a variable'} aria-label="Its variable" onText={v => put({ of: v.trim() || undefined })} />}
                  {(b.options?.length ?? 0) > 2 && <IconButton icon="x" title="Remove this branch" onClick={() => set(x => void x.options!.splice(i, 1))} />}
                </div>
                <div className="wf-exit">
                  <select className="wf-test" value={cur.test} aria-label="Its test" onChange={e => put({ test: e.target.value as typeof cur.test, ...(e.target.value === 'js' && { of: undefined, value: cur.test === 'js' ? cur.value : `vars['${cur.of || b.of || 'answer'}'] === 'yes'` }), ...(NUM_TESTS.includes(e.target.value) && !NUM_TESTS.includes(cur.test) && { value: '0.5' }) })}>
                    {TESTS.map(t => (
                      <option key={t} value={t}>{t === 'js' ? 'JS' : t}</option>
                    ))}
                  </select>
                  <Typed value={cur.value} placeholder={cur.test === 'js' ? "num('steps.triage.urgent.p') > 0.8" : NUM_TESTS.includes(cur.test) ? '0.8' : 'text'} aria-label="Its text" className={cur.test === 'js' ? 'wf-mono' : undefined} onText={v => put({ value: v })} />
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
        exitsOf(b)
          .filter(e => !e.max)
          .map(e => {
            const routed = !!routesOf(b) && e.name !== 'error' // a routed decision's answer: kept as an option
            return (
              <div key={e.name} className={`wf-exit ${e.bad ? 'bad' : ''}`}>
                <span className="wf-exit-name" data-tip={e.label !== e.name ? e.label : undefined}>{e.label ?? e.name}</span>
                <span>→</span>
                {target(e.to, v =>
                  set(x => {
                    if (!routed) return void (v ? (x.to = { ...x.to, [e.name]: v }) : delete x.to?.[e.name])
                    const l = (x.options ??= []).filter(o => o.label !== e.name)
                    x.options = v ? [...l, { label: e.name, to: v }] : l
                  }),
                )}
              </div>
            )
          })
      )}
      {b.kind !== 'start' && b.kind !== 'end' && (
        <div className="wf-exit">
          <span className="wf-exit-name">at most</span>
          <Typed type="number" min={0} className="wf-num" value={b.max?.n ?? ''} placeholder="∞" onText={v => set(x => void (x.max = Number(v) > 0 ? { n: Number(v), to: x.max?.to } : undefined))} />
          <span>times</span>
          {b.max ? (
            <>
              <span>, then</span>
              {target(b.max.to, v => set(x => void (x.max = { n: x.max!.n, to: v })))}
            </>
          ) : (
            <span className="wf-hint">(∞: no limit)</span>
          )}
        </div>
      )}
    </div>
  )
}

// every variable a workflow has (flowVars): the run's, then each block's; a click copies it as {{name}}
// what {{…}} fills in prompts, commands, URLs, bodies and titles (a Case or If tests them), the run's then each block's.
// A webhook also has {{env.NAME}}: Settings' or the project's env, never logged
// your own variables, {{vars.NAME}}: a workflow's (var lines in its file) or every workflow's (Settings' flowVars); a
// name copies it, its value is saved as it's typed
function VarList({ title, hint, vars, onSet, toast }: { title: string; hint: string; vars: Record<string, string>; onSet: (v: Record<string, string>) => void; toast: (t: string) => void }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const bad = !!name && !VAR_NAME.test(name)
  const add = () => name && !bad && (onSet({ ...vars, [name]: value }), setName(''), setValue(''))
  const copy = (n: string) => void navigator.clipboard.writeText(`{{vars.${n}}}`).then(() => toast(`Copied {{vars.${n}}}`), () => {})
  return (
    <section className="wf-own">
      <h4 data-tip={hint}>{title}</h4>
      {Object.entries(vars).map(([k, v]) => (
        <div key={k} className="wf-own-row">
          <button className="wf-own-name" draggable onDragStart={e => e.dataTransfer.setData('text/plain', `{{vars.${k}}}`)} onClick={() => copy(k)} data-tip={`{{vars.${k}}}: a click copies it, or drag it into a field`}>
            {k}
          </button>
          <Typed value={v} aria-label={`${k}'s value`} onText={t => onSet({ ...vars, [k]: t })} />
          <IconButton icon="x" title={`Remove ${k}`} onClick={() => onSet(Object.fromEntries(Object.entries(vars).filter(([x]) => x !== k)))} />
        </div>
      ))}
      <form className="wf-own-row add" onSubmit={e => (e.preventDefault(), add())}>
        <input value={name} placeholder="NAME" aria-label="A new variable's name" className={bad ? 'bad' : ''} data-tip={bad ? 'Letters, digits, _ and -, a letter or _ first' : undefined} onChange={e => setName(e.target.value.trim())} />
        <input value={value} placeholder="value" aria-label="Its value" onChange={e => setValue(e.target.value)} />
        <button type="submit" className="ib" aria-label="Add it" data-tip="Add it" disabled={!name || bad}>
          <Icon name="plus" />
        </button>
      </form>
    </section>
  )
}

function VarsBody({ wf, toast }: { wf: Workflow; toast: (t: string) => void }) {
  const all = flowVars(wf)
  const groups = [{ id: '', title: 'The run’s', vars: all.filter(v => !v.from) }, ...wf.blocks.flatMap(b => (x => (x.length ? [{ id: b.id, title: blockName(b), vars: x }] : []))(all.filter(v => v.from === b.id)))]
  const copy = (n: string) => void navigator.clipboard.writeText(`{{${n}}}`).then(() => toast(`Copied {{${n}}}`), () => {})
  return (
    <div className="wf-vars">
      {groups.map(g => (
        <section key={g.id || 'run'}>
          <h4>{g.title}{g.id && <code className="wf-id">{g.id}</code>}</h4>
          {g.vars.map(v => (
            <button key={v.name} className="wf-var" draggable onDragStart={e => e.dataTransfer.setData('text/plain', `{{${v.name}}}`)} onClick={() => copy(v.name)} data-tip={v.what}>
              <code>{`{{${v.name}}}`}</code>
              <span>{v.what}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// a block's id: what {{steps.<id>.…}} names; a new one renames every way to it (exits, sessions, variables in text)
function IdField({ id, rename, check }: { id: string; rename: (to: string) => void; check: (to: string) => void }) {
  const [v, setV] = useState(id)
  const [err, setErr] = useState('')
  const go = () => {
    const to = v.trim()
    if (to === id) return setErr('')
    try {
      check(to)
      setErr('')
      rename(to)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="wf-field">
      <label>ID</label>
      <input className="wf-mono" value={v} spellCheck={false} aria-label="Its ID" onChange={e => setV(e.target.value)} onBlur={go} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), go())} />
      {err ? <span className="wf-err">{err}</span> : <span className="wf-hint">{`Its variables: {{steps.${id}.…}}. A new ID changes every arrow and {{steps.${id}.…}} to it (⏎).`}</span>}
    </div>
  )
}

// where a Show you or an end shows itself, in a block's line: window, card, notify (+ phone)
const shows = (b: Block, win: boolean) => [win && b.kind === 'end' && 'window', b.popover && 'card', b.notify && `notify${b.phone ? ' + phone' : ''}`].filter(Boolean).map(x => ` · ${x}`).join('')

// a Show you's or an end's notification: what it is, where it goes (the Mac; the phone with phone pushes set up)
function NotifyFields({ b, set, api, what }: { b: Block; set: (f: (x: Block) => void) => void; api: WorkflowsApi; what: string }) {
  return (
    <>
      <Switch className="switch-row" on={b.kind === 'popup' ? b.modal !== false : !!b.modal} onChange={v => set(x => void (x.modal = b.kind === 'popup' ? (v ? undefined : false) : v || undefined))}>
        A window
      </Switch>
      <span className="wf-hint">{b.kind === 'popup' ? 'Over the app, read and closed (Esc).' : 'Over the app, with how the run ended and what it says (below).'}</span>
      <Switch className="switch-row" on={!!b.popover} onChange={v => set(x => void (x.popover = v || undefined))}>
        A popover in the corner
      </Switch>
      <span className="wf-hint">A card at the window’s bottom right, until you close it: Show, Open the run.</span>
      <Switch className="switch-row" on={!!b.notify} onChange={v => set(x => void ((x.notify = v || undefined), v || (x.phone = undefined)))}>
        A macOS notification {what}
      </Switch>
      <span className="wf-hint">
        {b.kind === 'end' ? 'A notification on this Mac with the workflow’s name, how the run ended and what it says (below); a click opens the run. A failed run always notifies. ' : 'A notification on this Mac with its title; a click opens the run. '}
        Settings › General › macOS notifications turns them all off.
      </span>
      {b.notify && (
        <>
          <Switch className="switch-row" on={!!b.phone} disabled={!api.phone && !b.phone} onChange={v => set(x => void (x.phone = v || undefined))}>
            And on my phone
          </Switch>
          <span className="wf-hint">
            {api.phone ? 'A push to your phone too, the way Settings › Phone pushes sends an agent’s.' : 'Needs phone pushes (ntfy, Telegram, Slack, a webhook): '}
            {!api.phone && api.settings && (
              <button className="link" onClick={() => api.settings!('webhook')}>
                Settings › Phone pushes
              </button>
            )}
          </span>
        </>
      )}
    </>
  )
}

// an AI decision's inspector: its model (the list's, or any id), how sure, the state it judges, and its questions as
// cards or as the Decisions API's JSON (the same questions: either edits them)
const QTYPE_NAMES = Object.fromEntries(QTYPES.map(t => [t, `${QTYPE_INFO[t].name} (${QTYPE_INFO[t].api})`])) as Record<DecideQ['type'], string>
// a new question's start: yes/no's meanings, a choice's two options, a score's three levels
const newQ = (type: DecideQ['type'], n: number): DecideQ => ({ name: `q${n}`, type, ask: '', opts: type === 'yes/no' ? [] : type === 'choice' ? [{ label: 'a', text: '' }, { label: 'b', text: '' }] : ['low', 'medium', 'high'].map((t, k) => ({ label: String(k), text: t })) })
function DecideFields({ wf, b, set }: { wf: Workflow; b: Block; set: (f: (x: Block) => void) => void }) {
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [json, setJson] = useState<string | null>(null) // the JSON as typed, until it reads
  const [err, setErr] = useState('')
  const [picked, setOther] = useState(false) // Another model… picked, its id still to type
  const [adding, setAdding] = useState(false) // + Question's kinds, as cards
  const other = picked || (!!b.model && !DECIDE_MODELS.some(m => m.id === b.model))
  const qs = b.qs ?? []
  const q = (i: number, f: (q: DecideQ) => void) => set(x => f(x.qs![i]))
  // the routed question's answers moved (renamed, removed, renumbered): its ways out follow; undefined drops one
  const reroute = (y: Block, i: number, f: (label: string) => string | undefined) =>
    void (y.route === y.qs![i].name && y.options && (y.options = y.options.flatMap(o => (l => (l === undefined ? [] : [{ ...o, label: l }]))(f(o.label)))))
  const field = (label: string, el: React.ReactNode, hint?: string) => (
    <div className="wf-field">
      <label>{label}</label>
      {el}
      {hint && <span className="wf-hint">{hint}</span>}
    </div>
  )
  return (
    <>
      {field(
        'Decision model',
        <select value={other ? '' : b.model || DECIDE_MODELS[0].id} onChange={e => (setOther(!e.target.value), set(x => void (x.model = e.target.value && e.target.value !== DECIDE_MODELS[0].id ? e.target.value : undefined)))}>
          {DECIDE_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          <option value="">Another model…</option>
        </select>,
        'OpenRouter’s Decisions API: probabilities, not text. Its key: Settings › AI',
      )}
      {other && field('Model id', <Typed value={b.model ?? ''} placeholder="nace-ai/drex-v2.0" onText={v => set(x => void (x.model = v.trim() || undefined))} />, 'Any model of openrouter.ai/models?output_modalities=decisions')}
      {field('State', <Typed area rows={4} value={b.text ?? ''} placeholder={'{"messages": {{steps.<step>.answer}}}'} onText={v => set(x => void (x.text = v || undefined))} />, `What it judges: JSON ({{var}} bare: as JSON when it is; in quotes: escaped) or words. Empty: the block before’s answer or output. ${varsHint(wf, b)}`)}
      {field(
        'Sure from',
        <Typed type="number" min={0.5} max={0.99} value={b.sure ?? SURE} onText={v => set(x => void (x.sure = Number(v) >= 0.5 && Number(v) < 1 && Number(v) !== SURE ? Number(v) : undefined))} />,
        `Yes at ${Math.round((b.sure ?? SURE) * 100)}% or more, no at ${Math.round((1 - (b.sure ?? SURE)) * 100)}% or less; a choice or a score that sure. In between it asks you.`,
      )}
      <div className="wf-sub wf-qhead">
        Questions
        <span className="grow" />
        <div className="seg small">
          <button className={tab === 'form' ? 'on' : ''} onClick={() => (setTab('form'), setJson(null), setErr(''))}>Cards</button>
          <button className={tab === 'json' ? 'on' : ''} onClick={() => setTab('json')}>JSON</button>
        </div>
      </div>
      {tab === 'json' ? (
        <>
          <Typed
            area
            rows={14}
            className="wf-mono"
            value={json ?? JSON.stringify(apiQuestions(qs), null, 2)}
            onText={v => {
              setJson(v)
              try {
                const got = fromApi(JSON.parse(v))
                setErr('')
                set(x => void (x.qs = got))
              } catch (e) {
                setErr((e as Error).message)
              }
            }}
          />
          {err ? <span className="wf-err">{err}</span> : <span className="wf-hint">The Decisions API’s questions: noul (yes/no), choice and score, each with instructions and criteria.</span>}
        </>
      ) : (
        <>
          {qs.map((x, i) => (
            <div key={i} className="wf-branch">
              <div className="wf-exit">
                <Typed value={x.name} aria-label="Its name" placeholder="urgent" onText={v => set(y => void ((y.route === y.qs![i].name && (y.route = v.trim())), (y.qs![i].name = v.trim())))} />
                <select className="wf-test" value={x.type} aria-label="Its kind" data-tip={QTYPE_INFO[x.type].says} onChange={e => set(y => void (reroute(y, i, () => undefined), (y.qs![i].type = e.target.value as DecideQ['type']), (y.qs![i].opts = newQ(y.qs![i].type, 0).opts)))}>
                  {QTYPES.map(t => (
                    <option key={t} value={t}>{QTYPE_NAMES[t]}</option>
                  ))}
                </select>
                <IconButton icon="x" title="Remove this question" onClick={() => set(y => void ((y.route === y.qs![i].name && ((y.route = undefined), (y.options = undefined))), y.qs!.splice(i, 1)))} />
              </div>
              <Typed area rows={2} value={x.ask} placeholder="What it asks" aria-label="What it asks" onText={v => q(i, y => void (y.ask = v.replace(/\s*\n\s*/g, ' ')))} />
              {x.type === 'yes/no'
                ? (['yes', 'no'] as const).map(l => (
                    <div key={l} className="wf-exit">
                      <span className="wf-exit-name">{l}</span>
                      <Typed value={x.opts.find(o => o.label === l)?.text ?? ''} placeholder={`what ${l} means (optional)`} onText={v => q(i, y => void (y.opts = (['yes', 'no'] as const).map(k => ({ label: k, text: k === l ? v : (y.opts.find(o => o.label === k)?.text ?? '') })).filter(o => o.text.trim())))} />
                    </div>
                  ))
                : x.opts.map((o, n) => (
                    <div key={n} className="wf-exit">
                      {x.type === 'choice' ? <Typed className="wf-num wf-opt" value={o.label} aria-label="Option" onText={v => set(y => void ((w => (reroute(y, i, l => (l === y.qs![i].opts[n].label ? w : l)), (y.qs![i].opts[n].label = w)))(v.replace(/:/g, '').trim())))} /> : <span className="wf-exit-name">{n}</span>}
                      <Typed value={o.text} placeholder={x.type === 'choice' ? 'what it means' : 'this level'} onText={v => q(i, y => void (y.opts[n].text = v))} />
                      {x.opts.length > 2 && <IconButton icon="x" title="Remove" onClick={() => set(y => void (reroute(y, i, l => (y.qs![i].type === 'score' ? (Number(l) === n ? undefined : Number(l) > n ? String(Number(l) - 1) : l) : l === y.qs![i].opts[n].label ? undefined : l)), y.qs![i].opts.splice(n, 1), y.qs![i].type === 'score' && y.qs![i].opts.forEach((z, k) => (z.label = String(k)))))} />}
                    </div>
                  ))}
              {x.type !== 'yes/no' && (
                <button className="btn small" onClick={() => q(i, y => void y.opts.push({ label: y.type === 'score' ? String(y.opts.length) : `option${y.opts.length + 1}`, text: '' }))}>
                  <Icon name="plus" size={11} /> {x.type === 'score' ? 'Level' : 'Option'}
                </button>
              )}
              <span className="wf-hint">
                {`{{steps.${b.id}.${x.name || '<name>'}}}`}: {x.type === 'yes/no' ? 'yes or no' : x.type === 'choice' ? 'the option' : 'the level’s number'}; .p, .confidence{x.type === 'score' ? ', .score, .level' : ''}
              </span>
            </div>
          ))}
          {adding ? (
            <div className="wf-qkinds" role="group" aria-label="What kind of question">
              <span className="wf-hint">What kind of question?</span>
              {QTYPES.map(t => (
                <button
                  key={t}
                  className="wf-qkind"
                  onClick={() => {
                    setAdding(false)
                    set(y => {
                      const taken = new Set((y.qs ?? []).map(z => z.name))
                      let n = (y.qs?.length ?? 0) + 1
                      while (taken.has(`q${n}`)) n++
                      ;(y.qs ??= []).push(newQ(t, n))
                    })
                  }}
                >
                  <code>{QTYPE_INFO[t].api}</code>
                  <b>{QTYPE_INFO[t].says}</b>
                  <i>{QTYPE_INFO[t].e}</i>
                </button>
              ))}
              <button className="btn small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn small" onClick={() => setAdding(true)}>
              <Icon name="plus" size={11} /> Question
            </button>
          )}
          <span className="wf-hint">Its ways out: Where it goes below can give each answer of a question its own line; or one line (ok) and a Case after it (equals "yes", a number’s {'>='} 0.8, JS).</span>
        </>
      )}
    </>
  )
}

// the variables a block uses ({{…}}: env.* aside), for its Test's fields
function varsIn(b: Block) {
  const t = [b.text, b.url, b.system, b.from, ...(b.headers ?? [])].join('\n')
  return [...new Set([...t.matchAll(/\{\{\s*([\w.?-]+)\s*\}\}/g)].map(m => m[1]).filter(n => !n.startsWith('env.') && !n.startsWith('vars.')))] // those two filled by Laki
}
type Tested = { exit: string; why: string; vars: Record<string, string>; missing: string[]; unsure: string[]; log: string[]; ms: number }
// an AI call, a decision or a webhook sent once with values you type: what it says and gives (a webhook's really sent)
function TestBlock({ b, api, project, own }: { b: Block; api: WorkflowsApi; project?: string; own?: Record<string, string> }) {
  const names = varsIn(b)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [res, setRes] = useState<Tested | null>(null)
  const [busy, setBusy] = useState(false)
  const send = () => {
    setBusy(true)
    setRes(null)
    api
      .call<Tested>('flowTest', { block: b, vars: vals, project, own })
      .then(setRes, e => setRes({ exit: 'error', why: (e as Error).message, vars: {}, missing: [], unsure: [], log: [], ms: 0 }))
      .finally(() => setBusy(false))
  }
  return (
    <details className="wf-testbox">
      <summary>Test it</summary>
      {names.map(n => (
        <div key={n} className="wf-field">
          <label>{`{{${n}}}`}</label>
          <Typed area={n.endsWith('answer') || n.endsWith('output')} rows={2} value={vals[n] ?? ''} placeholder={n === 'task' ? 'a test task' : 'a sample value'} onText={v => setVals(x => ({ ...x, [n]: v }))} />
        </div>
      ))}
      <div className="wf-exit">
        <button className="btn small primary" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : b.kind === 'webhook' ? 'Send it' : 'Ask it once'}
        </button>
        <span className="wf-hint">{b.kind === 'webhook' ? 'Really sends it, with the project’s env' : 'One call on your OpenRouter key'}</span>
      </div>
      {res && (
        <div className={`wf-dec ${res.exit === 'ok' ? '' : 'bad'}`}>
          <div className="wf-dec-head">
            <span className="wf-exit-name">{res.exit}</span>
            <span className="grow" />
            {res.ms > 0 && <span className="wf-hint">{dur(res.ms)}</span>}
          </div>
          <div className="wf-dec-why">{res.why}</div>
          {Object.entries(res.vars)
            .filter(([k]) => !k.endsWith('.answers'))
            .map(([k, v]) => (
              <div key={k} className="wf-kv">
                <span>{k.replace(`steps.${b.id}.`, '')}</span>
                <b>{v.length > 80 ? `${v.slice(0, 79)}…` : v || '(empty)'}</b>
              </div>
            ))}
          {res.unsure.length > 0 && <span className="wf-hint">Not sure of {res.unsure.join(', ')}: a run would ask you.</span>}
          {res.missing.length > 0 && <span className="wf-hint">No {res.missing.join(', ')} in what it gave.</span>}
          {res.log.length > 0 && (
            <details>
              <summary className="wf-hint">What it sent and got</summary>
              <pre className="wf-testlog">{res.log.join('\n\n')}</pre>
            </details>
          )}
        </div>
      )}
    </details>
  )
}

// fixed: the workspace it runs in (its ⋯ › Run workflow, ⌘K); runs in: here without one picks it here
function StartRun({ item, projects, presets, workspaces, fixed, api, onClose, onStarted }: { item: WorkflowItem; projects: Project[]; presets: Preset[]; workspaces: WorkspaceView[]; fixed?: string; api: WorkflowsApi; onClose: () => void; onStarted: (id: string) => void }) {
  const fix = workspaces.find(w => w.id === fixed)
  const ok = projects.filter(p => !p.host && (item.source !== 'project' || p.id === item.project) && (item.where !== 'worktree' || p.git !== false || p.id === fix?.project))
  const [project, setProject] = useState(fix?.project ?? item.project ?? ok[0]?.id ?? '')
  const [ws, setWs] = useState('') // runs in: here, none fixed: one of the project's
  const choices = workspaces.filter(w => w.project === project && !w.archived && !w.host)
  const needsTask = item.blocks.find(b => b.kind === 'start')?.input === 'task'
  const [task, setTask] = useState('')
  const [dry, setDry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // its Start's inputs: a field each, its default first; a branch picks from the project's
  const inputs = item.blocks.find(b => b.kind === 'start')?.inputs ?? []
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map(i => [i.name, i.default ?? ''])))
  const [branches, setBranches] = useState<string[]>([])
  useEffect(() => {
    if (!project || !inputs.some(i => i.kind === 'branch')) return
    api.call<{ branches: string[] }>('branches', { project }).then(r => setBranches(r.branches), () => setBranches([]))
  }, [project])
  const missing = inputs.some(i => !i.optional && !vals[i.name]?.trim())
  const never = bypassIn(item, b => presets.find(p => p.name === (b.agent || 'claude'))).map(blockName) // its profile's mode counts too
  const go = () => {
    setBusy(true)
    setErr('')
    api.call<FlowRun>('flowStart', { workflow: item.id, source: item.source, project, editor: true, ...((fixed || ws) && { ws: fixed || ws }), task, dry, ...(inputs.length && { inputs: vals }) }).then(
      r => onStarted(r.id),
      e => (setBusy(false), setErr((e as Error).message)),
    )
  }
  return (
    <div className="overlay" onPointerDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal wf-start" onSubmit={e => (e.preventDefault(), go())} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
        <b>Run {item.name}</b>
        <span className="wf-hint">{fix ? `Runs in ${fix.name ?? fix.id}, the workspace you picked` : WHERES[item.where]} · {SESSIONS[item.session]}</span>
        {item.untrusted && <span className="wf-agent">From this repo, {item.changed ? 'changed since you allowed it' : 'not allowed yet'}: read it before you run it.</span>}
        <label className="wf-field">
          <span>Project</span>
          <select value={project} onChange={e => (setProject(e.target.value), setWs(''))} disabled={item.source === 'project' || !!fix}>
            {ok.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {item.where === 'here' && !fix && (
          <label className="wf-field">
            <span>Workspace</span>
            <select value={ws} onChange={e => setWs(e.target.value)}>
              <option value="">pick one</option>
              {choices.map(w => (
                <option key={w.id} value={w.id}>{w.name ?? w.id}</option>
              ))}
            </select>
          </label>
        )}
        <label className="wf-field">
          <span>Task</span>
          <textarea autoFocus rows={4} value={task} placeholder={needsTask ? 'What should it work on?' : 'What should it work on? (optional)'} onChange={e => setTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.metaKey && (e.preventDefault(), go())} />
        </label>
        {inputs.map(i => {
          const v = vals[i.name] ?? ''
          const put = (x: string) => setVals(o => ({ ...o, [i.name]: x }))
          return (
            <label key={i.name} className="wf-field">
              <span>
                {i.name}
                {!i.optional && <b className="wf-need" data-tip="Needed"> *</b>}
              </span>
              {i.kind === 'choice' ? (
                <select value={v} onChange={e => put(e.target.value)}>
                  {(i.optional || !i.choices?.includes(v)) && <option value="">{i.optional ? 'none' : 'pick one'}</option>}
                  {(i.choices ?? []).map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ) : i.kind === 'branch' ? (
                <select value={v} onChange={e => put(e.target.value)}>
                  {(i.optional || !v) && <option value="">{i.optional ? 'none' : 'pick one'}</option>}
                  {[...new Set([...(v ? [v] : []), ...branches])].map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <input type={i.kind === 'number' ? 'number' : 'text'} value={v} placeholder={i.optional ? 'optional' : ''} onChange={e => put(e.target.value)} />
              )}
            </label>
          )
        })}
        <Switch className="switch-row" on={dry} onChange={setDry}>
          Dry run: opening a PR, approving, merging and archiving are said, not done
        </Switch>
        {never.length > 0 && <span className="wf-err">Never asks: {never.join(', ')} {never.length === 1 ? 'runs' : 'run'} with bypass permissions, anything goes.</span>}
        {err && <span className="wf-err">{err}</span>}
        <div className="wf-start-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !project || (needsTask && !task.trim()) || missing || (item.where === 'here' && !fixed && !ws)}>{busy ? 'Starting…' : 'Run ⌘⏎'}</button>
        </div>
      </form>
    </div>
  )
}

// ---------- a run: where it is, what it asks, its decisions, variables and log

function RunView({ id, entry, ahead, api, pname, ws, tabs, onGone, onDelete, onAgain }: { id: string; entry?: FlowView; ahead: number; api: WorkflowsApi; pname: (id?: string) => string; ws: WorkspaceView[]; tabs: string[]; onGone: () => void; onDelete: (r: FlowView) => void; onAgain: (id: string, block?: string) => void }) {
  const [r, setR] = useState<FlowRun | null>(null)
  const [menu, openMenu] = useMenu()
  const [tab, setTab] = useState<'decisions' | 'state'>('decisions')
  const [mode, setMode] = useState<'blocks' | 'log'>('blocks')
  const [typed, setTyped] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [win, setWin] = useState<Shown | null>(null) // what a Show you showed, again
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
  const asking = r.status === 'waiting' && r.wait && 'options' in r.wait ? r.wait : undefined // what it asks you
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
        {over && (
          <button className="btn" onClick={() => onAgain(r.id)} data-tip="A new run: its task and inputs, the workflow as it is now. A block’s right click: Run from here">
            <Icon name="refresh" size={11} /> Run again
          </button>
        )}
        <IconButton icon="trash" title="Delete this run" className="danger" onClick={() => onDelete(entry ?? flowView(r))} />
      </div>
      {asking && (
        <div className={`wf-ask ${asking.kind === 'agent-ask' ? 'agent' : ''}`}>
          <div className="wf-ask-q">
            <Icon name="help" size={14} />
            <b>{asking.kind === 'agent-ask' ? `${blockName(r.flow.blocks.find(b => b.id === r.cur) ?? { id: r.cur ?? '', kind: 'agent' })} asks: ${asking.question}` : asking.question}</b>
            <span className="wf-hint">{asking.kind === 'confirm' ? 'before it does something others see' : asking.kind === 'stuck' ? 'it can’t go on by itself' : asking.kind === 'decide' ? 'the model isn’t sure' : asking.kind === 'agent-ask' ? (asking.ns.length ? 'its agent waits: a pick here answers in its tab' : 'its agent waits: answer it in its tab') : ''}</span>
          </div>
          {'show' in asking && asking.show && (
            <div className="wf-ask-show">
              <Markdown src={asking.show} />
            </div>
          )}
          {asking.kind === 'ask' && <input className="wf-ask-text" value={typed} placeholder="Add words, if any: they're {{answer}}" onChange={e => setTyped(e.target.value)} />}
          {asking.kind === 'agent-ask' ? (
            <div className="wf-ask-btns">
              {asking.ns.map((k, n) => (
                <button key={n} className={`btn ${n === 0 ? 'primary' : ''}`} onClick={() => answer(n)}>{`${k}. ${asking.options[n]}`}</button>
              ))}
              {tabs.includes(asking.tab) && r.ws && api.openTab && (
                <button className="btn" onClick={() => api.openTab!(r.ws!, asking.tab)}>
                  Open its tab
                </button>
              )}
              <button className="btn danger" onClick={() => answer(asking.options.length - 1)}>Stop the run</button>
            </div>
          ) : (
            <div className="wf-ask-btns">
              {asking.options.map((o, n) => (
                <button key={n} className={`btn ${n === 0 ? 'primary' : ''}`} onClick={() => answer(n)}>{o}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {(r.shown?.length ?? 0) > 0 && (
        <div className="wf-shown">
          <span className="wf-hint">It showed you</span>
          {[...r.shown!].reverse().map((x, i) => (
            <button key={i} className="btn small" onClick={() => setWin(x)}>
              {x.title}
            </button>
          ))}
        </div>
      )}
      {win && <ShownDialog s={{ run: r.id, name: r.flow.name, title: win.title, body: win.body }} onClose={() => setWin(null)} />}
      {menu}
      {r.status === 'queued' && <div className="wf-note">Queued: {ahead ? `${ahead} ${ahead === 1 ? 'run' : 'runs'} of ${r.flow.name} ahead of it` : 'next in line'}. It starts {r.pick ? 'in the workspace you picked' : r.where === 'main' ? 'in the project’s folder' : 'in a worktree of its own'} once a run of it ends (at once: {r.flow.runs ?? RUNS_AT_ONCE}).</div>}
      {r.status === 'paused' && r.wait?.kind === 'limit' && <div className="wf-note">Paused at a usage limit: it goes on when the limit resets{r.wait.until ? `, at ${new Date(r.wait.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.</div>}
      {mode === 'log' ? (
        <RunLog log={r.log} />
      ) : (
      <div className="wf-split">
        <Canvas wf={r.flow} sel={pick} onPick={setPick} lit={lit} onMenu={over ? (e, b) => openMenu(e, [{ label: 'Run from here', sub: 'A new run in its workspace, its state kept: the blocks before it don’t run again', icon: 'run', run: () => onAgain(r.id, b) }]) : undefined} />
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
