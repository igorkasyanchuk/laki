// Scheduled tasks (the clock at the bottom of the sidebar, or ⌘K): a prompt for an agent at the times a line of English
// says (shared/when.ts), in a new workspace each run, in the project's folder (no worktree) or in one of its workspaces;
// the tasks and the runs' log (all, or one project's), the form. App.tsx passes a SchedulesApi over the daemon.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Schedule, ScheduleRun, View } from '../../shared/types'
import type { WorkflowItem, WorkflowSource } from '../../shared/workflow'
import { ago } from '../../shared/widget'
import { describe, nextRun, parseWhen, stamp, wsTitle } from '../../shared/when'
import { ask, Icon, IconButton, keep, load, type MenuItem, ON, Page, Switch, useMenu } from './ui'

export type SchedulesApi = {
  set(s: Partial<Schedule>): Promise<Schedule>
  rm(id: string): Promise<unknown>
  run(id: string): Promise<ScheduleRun>
  open(ws: string, tab?: string): void
  pick(): Promise<{ id: string } | null> // another folder: the folder picker, then it's a project
  flows?: () => Promise<WorkflowItem[]> // Workflows on: a task may run one instead of a prompt
}

const EXAMPLES = ['every day at 2am except weekends', 'weekdays at 9:00', 'mon, wed and fri at 18:30', 'every 2 hours from 9am to 6pm', 'tomorrow at 7am']
const RUNS = 8 // the log's rows until Show all
// where a run goes: its words, its icon
export const WHERE: [string, string, 'fork' | 'folder'][] = [['new', 'a new workspace each run', 'fork'], ['local-new', 'in its folder, a new session each run', 'folder'], ['local', 'in its folder, one session', 'folder']]
export const at = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// how soon a run is: in 5 min, in 3 h, in 2 days
export const soon = (t: number, now = Date.now()) => {
  const m = Math.max(0, Math.round((t - now) / 60000))
  const h = Math.round(m / 60)
  const d = Math.round(m / 60 / 24)
  return m < 1 ? 'now' : m < 60 ? `in ${m} min` : h < 24 ? `in ${h} h` : d === 1 ? 'in a day' : `in ${d} days`
}
type Form = { id?: string; name: string; project: string; preset: string; ws: string; prompt: string; when: string; workflow?: string; source?: WorkflowSource; widget?: string; action?: string } // workflow: a run of it, prompt its task; widget: an extension fetched, or its action run (prompt: its argument)
// a changed form as the page closed (Esc, ✕, a click elsewhere), and what it was as it opened: back as the page opens
// again, until it's saved or discarded
const DRAFT = 'laki.scheduleDraft'
type Draft = { form: Form; orig: string | null }

// project: the filter it opens with (a project's ⋯ menu); onSeen: the newest run, once all projects' runs show (the clock's dot)
export function SchedulesPage({ view, api, project: start = '', onSeen, onClose }: { view: View; api: SchedulesApi; project?: string; onSeen?: (run: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(start) // a project's tasks and runs; '': all
  const only = view.projects.length > 1 && view.projects.some(p => p.id === picked) ? picked : '' // a removed project, or the only one: all
  const schedules = (view.schedules ?? []).filter(s => !only || s.project === only)
  const runs = (view.runs ?? []).filter(r => !only || (r.project ?? view.schedules?.find(s => s.id === r.schedule)?.project) === only)
  const agents = view.presets.filter(p => p.agent !== 'command' && !p.off).map(p => p.name)
  const newest = view.runs?.[0]?.id
  useEffect(() => void (!only && newest && onSeen?.(newest)), [only, newest]) // filtered: another project's failure stays unread
  const where0 = (project: string) => (view.projects.find(p => p.id === project)?.git === false ? 'local' : 'new') // a folder without git: no worktrees
  const blank = (): Form => {
    const project = only || view.projects[0]?.id || ''
    const preset = agents.includes(view.settings.agent ?? '') ? view.settings.agent! : (agents[0] ?? 'claude')
    return { name: '', project, preset, ws: where0(project), prompt: '', when: '' }
  }
  const wsOf = (project: string) => view.workspaces.filter(w => w.project === project && !w.archived && w.kind !== 'local') // its folder is 'local'
  const draft = useMemo(() => {
    const d = load<Draft | null>(DRAFT, null)
    const f = d?.form
    return f && view.projects.some(p => p.id === f.project) && (!f.id || view.schedules?.some(s => s.id === f.id)) ? d : null // its project or task gone: none
  }, [])
  const [form, setForm] = useState<Form | null>(draft?.form ?? null)
  const [flows, setFlows] = useState<WorkflowItem[]>([])
  useEffect(() => void api.flows?.().then(setFlows, () => {}), [])
  const flowName = (id?: string) => flows.find(w => w.id === id)?.name ?? id
  const extOf = (id?: string) => view.widgets?.find(w => w.id === id)
  const extName = (id?: string, action?: string) => `${extOf(id)?.name ?? id}: ${action || 'fetch'}`
  const scopedExt = !!form?.widget && extOf(form.widget)?.scope === 'workspace' // runs in one of the project's workspaces
  const orig = useRef<string | null>(draft?.orig ?? null) // the form as it opened: Cancel asks, and a close keeps it, only when it changed
  const changed = !!form && JSON.stringify(form) !== orig.current
  useEffect(() => keep(DRAFT, changed ? ({ form, orig: orig.current } satisfies Draft) : undefined), [form])
  // a form changed and not saved goes only once you say so
  const open = async (f: Form | null) => {
    if (changed && !(await ask(form?.id ? 'Discard your changes to this task?' : 'Discard this task?', { ok: 'Discard', danger: true }))) return
    orig.current = f && JSON.stringify(f)
    setErr('')
    setForm(f)
  }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string[]>([]) // tasks whose Run now is starting
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30e3) // "next in 3 min" and "2 minutes ago" move on with no state change
    return () => clearInterval(t)
  }, [])
  const [saving, setSaving] = useState(false)
  const [allRuns, setAllRuns] = useState(false)
  const [menu, openMenu] = useMenu()
  const set = (k: Partial<Form>) => setForm(f => f && { ...f, ...k })
  const project = view.projects.find(p => p.id === form?.project)
  const rule = form?.when.trim() ? parseWhen(form.when) : null
  const fail = (e: unknown) => setErr((e as Error).message)
  const first = rule && !('error' in rule) ? nextRun(rule, Date.now()) : undefined // the next run: what the names preview
  const makes = !form?.workflow && !form?.widget && (form?.ws === 'new' || form?.ws === 'local-new') // a row of its own each run, named (a workflow's runs: as it names them)

  const ready = !!form && !saving && (!!form.prompt.trim() || !!form.widget) && !!rule && !('error' in rule) && !!form.ws && (!scopedExt || !WHERE.some(x => x[0] === form.ws))
  const save = async () => {
    if (!form || !ready) return
    setSaving(true)
    setErr('')
    await api.set({ ...form, name: form.name.trim() || undefined, workflow: form.workflow ?? '', widget: form.widget ?? '', action: form.action ?? '' }).then(() => setForm(null), fail) // '': a prompt again
    setSaving(false)
  }
  const run = async (s: Schedule) => {
    setBusy(b => [...b, s.id])
    setErr('')
    await api.run(s.id).catch(fail)
    setBusy(b => b.filter(x => x !== s.id))
  }
  const edit = (s: Schedule) => {
    // the project's local workspace is its folder; one that's gone: what Where's menu offers, not an id it lacks
    const w = view.workspaces.find(x => x.id === s.ws && x.project === s.project && !x.archived)
    const ws = ['new', 'local', 'local-new'].includes(s.ws) ? s.ws : w ? (w.kind === 'local' ? 'local' : w.id) : where0(s.project)
    if (form?.id !== s.id) open({ id: s.id, name: s.name ?? '', project: s.project, preset: s.preset, ws, prompt: s.prompt, when: s.when, ...(s.workflow && { workflow: s.workflow, source: s.source }), ...(s.widget && { widget: s.widget, action: s.action }) })
  }
  const rm = (s: Schedule) => ask(`Delete the scheduled task ${s.name || (s.widget && !s.prompt ? extName(s.widget, s.action) : s.prompt.slice(0, 40))}?`, { ok: 'Delete', danger: true }).then(y => y && api.rm(s.id).catch(fail))
  const where = (ws: string) => (ws ? (WHERE.find(x => x[0] === ws)?.[1] ?? `in ${view.workspaces.find(w => w.id === ws)?.name || ws}`) : 'pick a workspace: it has none yet')
  const nameOf = (id: string) => view.projects.find(p => p.id === id)?.name ?? id
  const pickProject = async (id: string) => {
    const p = id === '+' ? await api.pick().catch(e => (fail(e), null)) : { id }
    if (p && p.id !== form?.project) set({ project: p.id, ws: scopedExt ? (wsOf(p.id)[0]?.id ?? '') : where0(p.id) }) // the same one keeps its Where; a per-workspace extension's: one of the new project's
  }
  const nextOf = (r: Exclude<typeof rule, null>) => {
    if ('error' in r) return []
    const out: number[] = []
    for (let t = Date.now(); out.length < (r.once ? 1 : 3); ) {
      const n = nextRun(r, t)
      if (!n) break
      out.push((t = n))
    }
    return out
  }

  const filterMenu = (e: React.MouseEvent) =>
    openMenu(e, [{ label: 'All projects', hint: !only ? ON : undefined, run: () => setPicked('') }, null, ...view.projects.map(p => ({ label: p.name, icon: p.git === false ? 'folder' : 'fork', hint: only === p.id ? ON : undefined, run: () => setPicked(p.id) }) as MenuItem)])
  const projectMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      ...view.projects.map(p => ({ label: p.name, icon: p.git === false ? 'folder' : 'fork', hint: form?.project === p.id ? ON : undefined, run: () => pickProject(p.id) }) as MenuItem),
      null,
      { label: 'Another folder…', icon: 'folderPlus', run: () => pickProject('+') },
    ])
  const whereMenu = (e: React.MouseEvent) =>
    form &&
    openMenu(e, [
      ...(scopedExt ? [] : [{ head: 'Each run' } as MenuItem]),
      ...WHERE.filter(([k]) => !scopedExt && (k !== 'new' || project?.git !== false)).map(([k, label, icon]) => ({ label: label[0].toUpperCase() + label.slice(1), icon, hint: form.ws === k ? ON : undefined, run: () => set({ ws: k }) }) as MenuItem),
      ...(wsOf(form.project).length ? [null, { head: 'In one of its workspaces' }, ...wsOf(form.project).map(w => ({ label: w.name || w.id, icon: 'terminal', hint: form.ws === w.id ? ON : undefined, run: () => set({ ws: w.id }) }) as MenuItem)] : []),
    ])
  const runnable = flows.filter(w => !w.problems.length && (w.source === 'yours' || w.project === form?.project)) // a project's: in that project only
  // what a task can do with an extension: fetch it, or run one of its actions (only the ones it has)
  const exts = (view.widgets ?? []).filter(x => (x.on || x.id === form?.widget) && (x.every !== undefined || x.actions?.length))
  const pickExt = (id: string, action?: string) => {
    const sc = extOf(id)?.scope === 'workspace'
    const ws = sc ? (wsOf(form!.project).some(w => w.id === form!.ws) ? form!.ws : (wsOf(form!.project)[0]?.id ?? '')) : form!.ws // per workspace: one of its own
    set({ widget: id, action, workflow: undefined, source: undefined, ws })
  }
  const agentMenu = (e: React.MouseEvent) =>
    form &&
    openMenu(
      e,
      [
        { head: 'Agent' },
        ...(agents.includes(form.preset) ? agents : [...agents, form.preset]).map(a => ({ label: a, icon: 'agent', hint: !form.workflow && !form.widget && form.preset === a ? ON : undefined, run: () => set({ preset: a, workflow: undefined, source: undefined, widget: undefined, action: undefined }) }) as MenuItem), // its own, if switched off since
        ...(runnable.length ? [null, { head: 'Workflow' }, ...runnable.map(w => ({ label: w.name, sub: w.source === 'project' ? 'the project’s' : 'yours', icon: 'flow', hint: form.workflow === w.id ? ON : undefined, run: () => set({ workflow: w.id, source: w.source, widget: undefined, action: undefined }) }) as MenuItem)] : []),
        ...(exts.length ? [null, { head: 'Extension' }, ...exts.map(x => ({ label: x.name, sub: x.on ? undefined : 'off: runs once it’s on', icon: 'panel', hint: form.widget === x.id ? ON : undefined, items: [...(x.every !== undefined ? [{ label: 'Fetch it', sub: 'its data, now', icon: 'refresh', hint: form.widget === x.id && !form.action ? ON : undefined, run: () => pickExt(x.id) } as MenuItem] : []), ...(x.actions ?? []).map(a => ({ label: a, sub: 'one of its actions', icon: 'run', hint: form.widget === x.id && form.action === a ? ON : undefined, run: () => pickExt(x.id, a) }) as MenuItem)] }) as MenuItem)] : []),
      ],
      'right',
    )
  const failed = runs.filter(r => !r.ok).length
  const next = schedules.reduce((m, x) => (x.on && x.next && (!m || x.next < m) ? x.next : m), 0) // the soonest; 0: none on
  const shown = allRuns ? runs : runs.slice(0, RUNS)
  const valid = !!rule && !('error' in rule)

  return (
    <Page title="Scheduled tasks" esc={false} onClose={onClose}>
      <div className="schedules">
        <header className="sched-hero">
          <span className="sched-hero-icon">
            <Icon name="clock" size={20} />
          </span>
          <p className="muted">A prompt for an agent, a workflow, or an extension to fetch, at the times you write. Laki's daemon runs it, window or not; a run the Mac slept through is skipped.</p>
          <span className="sched-hero-acts">
            {view.projects.length > 1 && (
              <button type="button" className="nw-chip" aria-haspopup="menu" data-tip="Whose tasks and runs show" onClick={filterMenu}>
                <Icon name="filter" />
                <span className="nw-chip-text">{only ? nameOf(only) : 'All projects'}</span>
                <Icon name="chevron" size={11} />
              </button>
            )}
            {!form && (
              <button type="button" className="primary" disabled={!view.projects.length} data-tip={view.projects.length ? undefined : 'Open a project first (⌘O)'} onClick={() => open(blank())}>
                <Icon name="plus" /> New task
              </button>
            )}
          </span>
        </header>
        {schedules.length > 0 && (
          <div className="sched-stats">
            <div>
              <b>{schedules.length}</b>
              <span>{schedules.length === 1 ? 'task' : 'tasks'}</span>
            </div>
            <div>
              <b>{schedules.filter(x => x.on).length}</b>
              <span>on</span>
            </div>
            <div data-tip={next ? at(next) : undefined}>
              <b>{next ? soon(next) : '—'}</b>
              <span>next run</span>
            </div>
            <div className={failed ? 'bad' : ''}>
              <b>{runs.length ? `${runs.length - failed}/${runs.length}` : '—'}</b>
              <span>runs ok</span>
            </div>
          </div>
        )}
        {err && <div className="field-err">{err}</div>}

        {form && (
          // Enter in a field never saves it (a time typed, a name): ⌘⏎ or the button does
          <form className="form sched-form" onSubmit={e => e.preventDefault()} onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), save())}>
            <div className="nw-card nw-composer">
              {form.widget && !form.action ? (
                <div className="muted small sched-ext-says">Fetches {extOf(form.widget)?.name ?? form.widget} at its times, on top of its own schedule. Off, it waits until you turn it on.</div>
              ) : (
                <textarea rows={3} value={form.prompt} aria-label={form.workflow ? 'Its task' : form.widget ? 'Its argument' : 'Prompt'} placeholder={form.workflow ? `What ${flowName(form.workflow)} works on: its {{task}}` : form.widget ? `Optional: what ${form.action} gets as $WIDGET_ARG` : 'What the agent should do: update the dependencies, run the tests, open a PR if they pass'} onChange={e => set({ prompt: e.target.value })} autoFocus />
              )}
              <div className="prompt-tools">
                <span className="prompt-tools-end">
                  <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="The agent that gets it, a workflow that runs it, or an extension to fetch" onClick={agentMenu}>
                    <Icon name={form.workflow ? 'flow' : form.widget ? 'panel' : 'agent'} />
                    <span>{form.workflow ? flowName(form.workflow) : form.widget ? extName(form.widget, form.action) : form.preset}</span>
                    <Icon name="chevron" size={11} />
                  </button>
                </span>
              </div>
            </div>
            <label className={`nw-chip sched-when ${rule && !valid ? 'bad' : ''}`}>
              <Icon name="clock" />
              <input className="nw-chip-input" value={form.when} aria-label="When" placeholder={`When: ${EXAMPLES[0]}`} spellCheck={false} onChange={e => set({ when: e.target.value })} />
            </label>
            {rule && 'error' in rule && <div className="field-err">{rule.error}</div>}
            {valid ? (
              <div className="schedule-preview">
                <Icon name="check" /> {describe(rule)} · next {nextOf(rule).map(at).join(', ')}
              </div>
            ) : (
              <div className="schedule-examples">
                {EXAMPLES.map(x => (
                  <button type="button" key={x} className="chip" onClick={() => set({ when: x })}>
                    {x}
                  </button>
                ))}
              </div>
            )}
            <div className="nw-chips">
              <button type="button" className="nw-chip" aria-haspopup="menu" data-tip="Its project" onClick={projectMenu}>
                <Icon name={project?.git === false ? 'folder' : 'fork'} />
                <span className="nw-chip-text">{project?.name}</span>
                <Icon name="chevron" size={11} />
              </button>
              {!form.workflow && (!form.widget || scopedExt) && (
                <button type="button" className="nw-chip" aria-haspopup="menu" data-tip={form.ws.startsWith('local') && project ? `Where each run goes: ${project.path}` : 'Where each run goes'} onClick={whereMenu}>
                  <Icon name={WHERE.find(x => x[0] === form.ws)?.[2] ?? 'terminal'} />
                  <span className="nw-chip-text">{where(form.ws)}</span>
                  <Icon name="chevron" size={11} />
                </button>
              )}
              <label className="nw-chip" data-tip={`Optional; a new workspace or session is named after it. {{DD-MM-YY}}, {{YYYY-MM-DD}}, {{HH:mm}} or {{ddd D MMM}} in the name or the prompt become the run's date and time`}>
                <Icon name="pencil" />
                <input className="nw-chip-input" value={form.name} aria-label="Name" placeholder={makes ? 'name: from the prompt, dated' : form.widget && !form.prompt.trim() ? `name: ${extName(form.widget, form.action)}` : 'name: from the prompt'} spellCheck={false} onChange={e => set({ name: e.target.value })} />
              </label>
            </div>
            {first !== undefined && form.prompt.trim() && (makes || stamp(form.prompt, first) !== form.prompt) && (
              <div className="schedule-preview muted">
                {[makes && `Its ${form.ws === 'new' ? 'workspace' : 'session'}: ${wsTitle({ name: form.name.trim(), prompt: form.prompt }, first)}`, stamp(form.prompt, first) !== form.prompt && `${makes ? 'its' : 'Its'} prompt: “${stamp(form.prompt, first).slice(0, 80)}”`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <div className="buttons">
              <span className="muted small">⌘⏎ {form.id ? 'saves' : 'schedules it'} · Esc closes the page, the form stays</span>
              <span className="spacer" />
              <button type="button" onClick={() => open(null)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={save} disabled={!ready}>
                {saving ? (
                  <>
                    <span className="btn-spin" /> Saving…
                  </>
                ) : form.id ? (
                  'Save'
                ) : (
                  'Schedule it'
                )}
              </button>
            </div>
          </form>
        )}

        {(schedules.length > 0 || !form) && ( // none yet and the form open: no heading over nothing
        <section>
          <div className="sched-head">
            <h3>Tasks</h3>
            {schedules.length > 0 && <span className="muted small">{schedules.length}</span>}
          </div>
          {schedules.length ? (
            <div className="sched-list">
              {schedules.map(s => (
                <div key={s.id} className={`sched-row ${s.on ? '' : 'off'} ${form?.id === s.id ? 'editing' : ''}`}>
                  <span className="sched-icon">
                    <Icon name={s.workflow ? 'flow' : s.widget ? 'panel' : s.ws === 'new' ? 'fork' : s.ws.startsWith('local') ? 'folder' : 'terminal'} />
                  </span>
                  <button type="button" className="sched-main" data-tip="Edit" onClick={() => edit(s)}>
                    <span className="sched-name">{s.name || (s.widget && !s.prompt ? extName(s.widget, s.action) : s.prompt)}</span>
                    <span className="sched-meta">
                      <b>{describe(s.rule)}</b>
                      {s.on && s.next ? (
                        <span className="sched-next" data-tip={at(s.next)}>
                          next {soon(s.next)}
                        </span>
                      ) : (
                        <span>{s.rule.once && s.last ? 'ran' : 'off'}</span>
                      )}
                    </span>
                    <span className="sched-tags">
                      <span className="tag">{nameOf(s.project)}</span>
                      {s.workflow ? (
                        <span className="tag">workflow: {flowName(s.workflow)}</span>
                      ) : s.widget ? (
                        <span className="tag">{s.name ? `extension: ${extName(s.widget, s.action)}` : 'extension'}</span>
                      ) : (
                        <>
                          <span className="tag">{s.preset}</span>
                          <span className="tag">{where(s.ws)}</span>
                        </>
                      )}
                    </span>
                  </button>
                  <span className="sched-acts">
                    {busy.includes(s.id) ? <span className="btn-spin" role="status" aria-label="Starting" /> : <IconButton icon="run" title="Run now" onClick={() => run(s)} />}
                    <IconButton icon="trash" title="Delete" onClick={() => rm(s)} />
                  </span>
                  <Switch on={s.on} tip={s.on ? 'On: runs at its times' : 'Off'} onChange={on => api.set({ id: s.id, on }).catch(fail)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="sched-empty">
              <Icon name="clock" size={18} />
              <span>
                <b>No scheduled tasks{only ? ' in this project' : ''}</b>
                <span className="muted small">Like “weekdays at 9:00: review yesterday's PRs”. New task makes one.</span>
              </span>
            </div>
          )}
        </section>
        )}

        <section>
          <div className="sched-head">
            <h3>Runs</h3>
            {runs.length > 0 && (
              <span className="muted small">
                {runs.length}
                {failed > 0 && <span className="sched-failed"> · {failed} failed</span>}
              </span>
            )}
          </div>
          {!runs.length ? (
            <p className="muted small">{only && view.runs?.length ? 'None for this project.' : 'None yet.'}</p>
          ) : (
            <div className="sched-list">
              {shown.map(r => {
                const live = r.ws && view.workspaces.some(w => w.id === r.ws && !w.archived)
                return (
                  <div
                    key={r.id}
                    className={`sched-run ${r.ok ? '' : 'failed'} ${live ? 'live' : ''}`}
                    {...(live && { role: 'button', tabIndex: 0, 'data-tip': 'Go to it', onClick: () => api.open(r.ws!, r.tab), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && api.open(r.ws!, r.tab) })}
                  >
                    <span className="sched-run-dot">
                      <Icon name={r.ok ? 'check' : 'x'} size={11} />
                    </span>
                    <b>{r.name}</b>
                    <span className="muted">{r.what}</span>
                    <span className="sched-run-at" data-tip={at(r.at)}>
                      {ago(r.at)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {runs.length > RUNS && (
            <button type="button" className="link small sched-more" onClick={() => setAllRuns(a => !a)}>
              {allRuns ? 'Show fewer' : `Show all ${runs.length}`}
            </button>
          )}
        </section>
      </div>
      {menu}
    </Page>
  )
}
