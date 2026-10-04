// Scheduled tasks (the clock at the top of the sidebar, or ⌘K): a prompt for an agent at the times a line of English
// says (shared/when.ts), in a new workspace each run, in the project's folder (no worktree) or in one of its workspaces;
// the tasks and the runs' log (all, or one project's), the form. App.tsx passes a SchedulesApi over the daemon.
import { useEffect, useState } from 'react'
import type { Schedule, ScheduleRun, View } from '../../shared/types'
import { describe, nextRun, parseWhen, stamp, wsTitle } from '../../shared/when'
import { Icon, IconButton, Page, Switch } from './ui'

export type SchedulesApi = {
  set(s: Partial<Schedule>): Promise<Schedule>
  rm(id: string): Promise<unknown>
  run(id: string): Promise<ScheduleRun>
  open(ws: string, tab?: string): void
  pick(): Promise<{ id: string } | null> // another folder: the folder picker, then it's a project
}

const EXAMPLES = ['every day at 2am except weekends', 'weekdays at 9:00', 'mon, wed and fri at 18:30', 'every 2 hours from 9am to 6pm', 'tomorrow at 7am']
const at = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
type Form = { id?: string; name: string; project: string; preset: string; ws: string; prompt: string; when: string }

// project: the filter it opens with (a project's ⋯ menu); onSeen: the newest run, once all projects' runs show (the clock's dot)
export function SchedulesPage({ view, api, project: start = '', onSeen, onClose }: { view: View; api: SchedulesApi; project?: string; onSeen?: (run: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(start) // a project's tasks and runs; '': all
  const only = view.projects.length > 1 && view.projects.some(p => p.id === picked) ? picked : '' // a removed project, or the only one: all
  const schedules = (view.schedules ?? []).filter(s => !only || s.project === only)
  const runs = (view.runs ?? []).filter(r => !only || (r.project ?? view.schedules?.find(s => s.id === r.schedule)?.project) === only)
  const agents = view.presets.filter(p => p.agent !== 'command').map(p => p.name)
  const newest = view.runs?.[0]?.id
  useEffect(() => void (!only && newest && onSeen?.(newest)), [only, newest]) // filtered: another project's failure stays unread
  const where0 = (project: string) => (view.projects.find(p => p.id === project)?.git === false ? 'local' : 'new') // a folder without git: no worktrees
  const blank = (): Form => {
    const project = only || view.projects[0]?.id || ''
    const preset = agents.includes(view.settings.agent ?? '') ? view.settings.agent! : (agents[0] ?? 'claude')
    return { name: '', project, preset, ws: where0(project), prompt: '', when: '' }
  }
  const wsOf = (project: string) => view.workspaces.filter(w => w.project === project && !w.archived && w.kind !== 'local') // its folder is 'local'
  const [form, setForm] = useState<Form | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const set = (k: Partial<Form>) => setForm(f => f && { ...f, ...k })
  const project = view.projects.find(p => p.id === form?.project)
  const rule = form?.when.trim() ? parseWhen(form.when) : null
  const fail = (e: unknown) => setErr((e as Error).message)
  const first = rule && !('error' in rule) ? nextRun(rule, Date.now()) : undefined // the next run: what the names preview
  const makes = form?.ws === 'new' || form?.ws === 'local-new' // a row of its own each run, named

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || busy) return
    setBusy('save')
    setErr('')
    await api.set({ ...form, name: form.name.trim() || undefined }).then(() => setForm(null), fail)
    setBusy('')
  }
  const run = async (s: Schedule) => {
    setBusy(s.id)
    setErr('')
    await api.run(s.id).catch(fail)
    setBusy('')
  }
  const edit = (s: Schedule) => {
    // the project's local workspace is its folder; one that's gone: what the Where select shows, not an id it lacks
    const w = view.workspaces.find(x => x.id === s.ws && x.project === s.project && !x.archived)
    const ws = ['new', 'local', 'local-new'].includes(s.ws) ? s.ws : w ? (w.kind === 'local' ? 'local' : w.id) : where0(s.project)
    setErr('')
    setForm({ id: s.id, name: s.name ?? '', project: s.project, preset: s.preset, ws, prompt: s.prompt, when: s.when })
  }
  const rm = (s: Schedule) => confirm(`Delete the scheduled task ${s.name || s.prompt.slice(0, 40)}?`) && api.rm(s.id).catch(fail)
  const where = (s: Schedule) =>
    ({ new: 'a new workspace each run', 'local-new': 'in its folder, a new session each run', local: 'in its folder, one session' })[s.ws] ?? `in ${view.workspaces.find(w => w.id === s.ws)?.name || s.ws}`
  const pickProject = async (id: string) => {
    const p = id === '+' ? await api.pick().catch(e => (fail(e), null)) : { id }
    if (p) set({ project: p.id, ws: where0(p.id) })
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

  return (
    <Page title="Scheduled tasks" onClose={onClose}>
      <div className="schedules">
        <p className="muted small">
          A prompt for an agent at the times you write, like “every day at 2am except weekends”. Laki runs it while it's running (the
          daemon, not the window): a run the Mac slept through is skipped, and the log says so.
        </p>
        {err && <div className="field-err">{err}</div>}

        {form ? (
          <form className="form schedule-form" onSubmit={save}>
            <div className="row">
              <label>
                Project
                <select value={form.project} onChange={e => pickProject(e.target.value)}>
                  {view.projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="+">Another folder…</option>
                </select>
              </label>
              <label>
                Where
                <select value={form.ws} onChange={e => set({ ws: e.target.value })}>
                  {project?.git !== false && <option value="new">A new workspace each run (a worktree)</option>}
                  <option value="local-new">In its folder, a new session each run</option>
                  <option value="local">In its folder, one session</option>
                  {wsOf(form.project).map(w => (
                    <option key={w.id} value={w.id}>
                      In {w.name || w.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {form.ws.startsWith('local') && project && <div className="muted small schedule-path">{project.path}</div>}
            <label>
              Agent
              <div className="seg">
                {agents.map(a => (
                  <button type="button" key={a} className={form.preset === a ? 'on' : ''} onClick={() => set({ preset: a })}>
                    {a}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Prompt
              <textarea rows={4} value={form.prompt} placeholder="Update the dependencies, run the tests, and open a PR if they pass" onChange={e => set({ prompt: e.target.value })} autoFocus />
            </label>
            <label>
              When
              <input value={form.when} placeholder={EXAMPLES[0]} spellCheck={false} onChange={e => set({ when: e.target.value })} />
            </label>
            <div className="schedule-examples">
              {EXAMPLES.map(x => (
                <button type="button" key={x} className="chip" onClick={() => set({ when: x })}>
                  {x}
                </button>
              ))}
            </div>
            {rule &&
              ('error' in rule ? (
                <div className="field-err">{rule.error}</div>
              ) : (
                <div className="schedule-preview">
                  <Icon name="clock" /> {describe(rule)} · next {nextOf(rule).map(at).join(', ')}
                </div>
              ))}
            <label>
              <span>
                Name <span className="muted">(optional; a new workspace is named after it)</span>
              </span>
              <input value={form.name} placeholder={makes ? 'from the prompt, with the date' : 'from the prompt'} spellCheck={false} onChange={e => set({ name: e.target.value })} />
            </label>
            <div className="muted small">
              In the name or the prompt, {'{{DD-MM-YY}}'}, {'{{YYYY-MM-DD}}'}, {'{{HH:mm}}'} or {'{{ddd D MMM}}'} become the run's date and time.
            </div>
            {first !== undefined && form.prompt.trim() && (makes || stamp(form.prompt, first) !== form.prompt) && (
              <div className="schedule-preview">
                <Icon name="clock" />
                {[makes && `Its ${form.ws === 'new' ? 'workspace' : 'session'}: ${wsTitle({ name: form.name.trim(), prompt: form.prompt }, first)}`, stamp(form.prompt, first) !== form.prompt && `${makes ? 'its' : 'Its'} prompt: “${stamp(form.prompt, first).slice(0, 80)}”`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <div className="buttons">
              <button type="submit" className="primary" disabled={!!busy || !form.prompt.trim() || !rule || 'error' in rule || !form.ws}>
                {form.id ? 'Save' : 'Schedule it'}
              </button>
              <button type="button" onClick={() => (setForm(null), setErr(''))}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="buttons">
            <button className="primary" disabled={!view.projects.length} onClick={() => (setErr(''), setForm(blank()))}>
              New scheduled task
            </button>
            {!view.projects.length && <span className="muted small">Open a project first (⌘O).</span>}
            {view.projects.length > 1 && (
              <select className="schedule-only" value={only} aria-label="Project" onChange={e => setPicked(e.target.value)}>
                <option value="">All projects</option>
                {view.projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {schedules.length > 0 && (
          <section>
            <h3>Tasks</h3>
            {schedules.map(s => (
              <div key={s.id} className={`schedule ${s.on ? '' : 'off'}`}>
                <Switch on={s.on} tip={s.on ? 'On: runs at its times' : 'Off'} onChange={on => api.set({ id: s.id, on }).catch(fail)} />
                <div className="schedule-main">
                  <div className="schedule-name">{s.name || s.prompt}</div>
                  <div className="muted small">
                    {describe(s.rule)} · {s.on && s.next ? `next ${at(s.next)}` : s.rule.once && s.last ? 'ran' : 'off'}
                  </div>
                  <div className="muted small">
                    {view.projects.find(p => p.id === s.project)?.name} · {s.preset} · {where(s)}
                  </div>
                </div>
                <button disabled={busy === s.id} onClick={() => run(s)}>
                  {busy === s.id ? 'Starting…' : 'Run now'}
                </button>
                <IconButton icon="pencil" title="Edit" onClick={() => edit(s)} />
                <IconButton icon="trash" title="Delete" onClick={() => rm(s)} />
              </div>
            ))}
          </section>
        )}

        <section>
          <h3>Runs</h3>
          {!runs.length && <p className="muted small">{only && view.runs?.length ? 'None for this project.' : 'None yet.'}</p>}
          {runs.map(r => {
            const live = r.ws && view.workspaces.some(w => w.id === r.ws && !w.archived)
            return (
              <div
                key={r.id}
                className={`schedule-run ${r.ok ? '' : 'failed'} ${live ? 'live' : ''}`}
                {...(live && { role: 'button', tabIndex: 0, 'data-tip': 'Go to it', onClick: () => api.open(r.ws!, r.tab), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && api.open(r.ws!, r.tab) })}
              >
                <span className="schedule-run-at">{at(r.at)}</span>
                <span className="schedule-run-ok">{r.ok ? '✓' : '✗'}</span>
                <b>{r.name}</b>
                <span className="muted">{r.what}</span>
              </div>
            )
          })}
        </section>
      </div>
    </Page>
  )
}
