// A project's page (a click on its name in the sidebar): its Notes, its Scheduled tasks, Memory (the user's items to
// keep, and what agents learned, auto-memory: MEMORY_MAX each; claude and codex get both at every start), its Specs
// (settings.specs, on unless turned off; the Specs page opens one) and its Settings (Settings' own project section). Notes are
// the user's alone: kept with the project in the daemon. App.tsx passes a ProjectApi.
import { useEffect, useState } from 'react'
import { type CompactLogLine, type Memory, MEMORY_MAX, type Plan, type PlanKind, type Project, type ProjectConfig, type RunAction, type Schedule, type Template } from '../../shared/types'
import { ago } from '../../shared/widget'
import { describe } from '../../shared/when'
import { Markdown } from './MarkdownView'
import { NotesView } from './panels'
import { at, soon, WHERE } from './Schedules'
import { ProjectSection } from './Settings'
import { ask, Icon, IconButton, keep, load, Page, Switch } from './ui'

export const PROJECT_TABS = [
  ['notes', 'Notes'],
  ['tasks', 'Scheduled tasks'],
  ['memory', 'Memory'],
  ['specs', 'Specs & Brainstorms'],
  ['settings', 'Settings'],
] as const
export type ProjectTab = (typeof PROJECT_TABS)[number][0]
export type ProjectApi = {
  save(o: { notes?: string; memory?: Memory[] }): Promise<unknown>
  saveSettings(o: { name?: string; config: ProjectConfig; notes?: string; color?: string; icon?: string }): unknown
  file(id: string): Promise<ProjectConfig>
  global?: { actions?: RunAction[]; templates?: Template[]; simulator?: boolean } // Settings' own, which go with the project's
  onGlobal(sec: 'actions' | 'templates'): void
  schedules(): void // the Scheduled tasks page, at this project: making and changing them is there
  setSchedule(id: string, on: boolean): Promise<unknown>
  specs?: { list(): Promise<Plan[]>; open(at?: { kind: PlanKind; slug?: string }): void } // Specs on (specsOn): the Specs tab
  compact?: CompactApi // Laki AI on: the learned memories' Compact now and its log
}
export type CompactApi = { run(): Promise<unknown>; log(): Promise<CompactLogLine[]> }

const TAB = 'laki.projectTab' // the last tab shown, for the next project opened
// tab: the one shown, App's (the project's ⋯ › Settings sets it, a click here through onTab), else the last one shown
export function ProjectPage({ project: p, schedules, tab: at, onTab, api, onClose }: { project: Project; schedules: Schedule[]; tab?: ProjectTab; onTab: (t: ProjectTab) => void; api: ProjectApi; onClose: () => void }) {
  const tabs = PROJECT_TABS.filter(([k]) => k !== 'specs' || api.specs)
  const tab = (t => (tabs.some(x => x[0] === t) ? t : 'notes'))(at ?? load<ProjectTab>(TAB, 'notes'))
  const pick = (t: ProjectTab) => (onTab(t), keep(TAB, t))
  const count = (t: ProjectTab) => (t === 'tasks' ? schedules.length : t === 'memory' ? (p.memory?.length ?? 0) : 0)
  return (
    <Page title={p.name} onClose={onClose}>
      <div className="project-page">
        <div className="pp-head">
          <span className="muted small mono">{`${p.host ? `${p.host}:` : ''}${p.path}`}</span>
          <div className="seg" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>
                {label}
                {count(k) > 0 && <span className="muted"> {count(k)}</span>}
              </button>
            ))}
          </div>
        </div>
        {tab === 'notes' && <NotesView key={p.id} notes={p.notes ?? ''} onSave={notes => api.save({ notes })} />}
        {tab === 'tasks' && <Tasks schedules={schedules} api={api} />}
        {tab === 'memory' && <MemoryList key={p.id} memory={p.memory ?? []} save={memory => api.save({ memory })} compact={api.compact} last={p.compacted} />}
        {tab === 'specs' && api.specs && <Specs key={p.id} specs={api.specs} />}
        {tab === 'settings' && (
          <div className="settings-main form pp-settings">
            <ProjectSection key={p.id} project={{ ...p, git: p.git !== false }} noNotes rename file={api.file} global={api.global} onGlobal={api.onGlobal} onSave={api.saveSettings} />
          </div>
        )}
      </div>
    </Page>
  )
}

// the project's scheduled tasks, as Scheduled tasks lists them: a click goes there to make or change them
function Tasks({ schedules, api }: { schedules: Schedule[]; api: ProjectApi }) {
  return (
    <>
      <div className="row">
        <span className="muted small grow">Prompts for an agent at the times you set. Making and changing them is on the Scheduled tasks page.</span>
        <button onClick={api.schedules}>
          <Icon name="clock" /> Open Scheduled tasks
        </button>
      </div>
      {schedules.length ? (
        <div className="sched-list">
          {schedules.map(s => (
            <div key={s.id} className={`sched-row ${s.on ? '' : 'off'}`}>
              <span className="sched-icon">
                <Icon name={WHERE.find(x => x[0] === s.ws)?.[2] ?? 'terminal'} />
              </span>
              <button type="button" className="sched-main" data-tip="Open it on the Scheduled tasks page" onClick={api.schedules}>
                <span className="sched-name">{s.name || s.prompt}</span>
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
                  <span className="tag">{s.preset}</span>
                  <span className="tag">{WHERE.find(x => x[0] === s.ws)?.[1] ?? 'in a workspace'}</span>
                </span>
              </button>
              <Switch on={s.on} tip={s.on ? 'On: runs at its times' : 'Off'} onChange={on => void api.setSchedule(s.id, on).catch(() => {})} />
            </div>
          ))}
        </div>
      ) : (
        <div className="sched-empty">
          <Icon name="clock" size={18} />
          <span>
            <b>No scheduled tasks in this project</b>
            <span className="muted small">Like “weekdays at 9:00: review yesterday's PRs”. Make one on the Scheduled tasks page.</span>
          </span>
        </div>
      )}
    </>
  )
}

// the project's specs and brainstorms, newest first: a click opens it on the Specs page, where they're made and edited
function Specs({ specs }: { specs: NonNullable<ProjectApi['specs']> }) {
  const [list, setList] = useState<Plan[] | null>(null)
  useEffect(() => void specs.list().then(setList, () => setList([])), [])
  return (
    <>
      <div className="row">
        <span className="muted small grow">Requirements to implement, and ideas to explore with Laki AI: each a folder outside the repo, with a README.md any agent can read.</span>
        <button onClick={() => specs.open({ kind: 'spec' })}>
          <Icon name="spec" /> Specs
        </button>
        <button onClick={() => specs.open({ kind: 'brainstorm' })}>
          <Icon name="bulb" /> Brainstorms
        </button>
      </div>
      {list === null ? (
        <p className="muted small">Loading…</p>
      ) : list.length ? (
        <div className="sched-list">
          {list.map(x => (
            <div key={`${x.kind}/${x.slug}`} className="sched-row">
              <span className="sched-icon">
                <Icon name={x.kind === 'spec' ? 'spec' : 'bulb'} />
              </span>
              <button type="button" className="sched-main" data-tip="Open it on the Specs page" onClick={() => specs.open({ kind: x.kind, slug: x.slug })}>
                <span className="sched-name">{x.title}</span>
                <span className="sched-meta">
                  <b>{x.kind}</b>
                  <span>edited {ago(x.at)}</span>
                  {x.files > 0 && <span>{x.files === 1 ? '1 file' : `${x.files} files`}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="sched-empty">
          <Icon name="spec" size={18} />
          <span>
            <b>No specs or brainstorms in this project</b>
            <span className="muted small">Write one like a Notion page, with checklists, images and diagrams; Start a workspace from it, or have Laki AI brainstorm it.</span>
          </span>
        </div>
      )}
    </>
  )
}

// Memory: what to keep about the project, one item each (Markdown), newest first: yours, then what agents learned
// (auto-memory: laki memory add, MCP's laki_remember); the whole list is saved each time. global: Settings › Global
// memory, the user's rules for every project (no learned ones)
const newId = () => `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export function MemoryList({ memory, save, global, compact, last }: { memory: Memory[]; save: (m: Memory[]) => Promise<unknown>; global?: boolean; compact?: CompactApi; last?: Project['compacted'] }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<CompactLogLine[] | null>(null)
  const [err, setErr] = useState('')
  const compactNow = () => {
    setBusy(true)
    setErr('')
    compact!.run().then(() => log && compact!.log().then(setLog), e => setErr((e as Error).message)).finally(() => setBusy(false))
  }
  const toggleLog = () => (log ? setLog(null) : void compact!.log().then(setLog, e => setErr((e as Error).message)))
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const mine = memory.filter(m => !m.auto)
  const learned = memory.filter(m => m.auto)
  const full = mine.length >= MEMORY_MAX
  const add = () => draft.trim() && !full && save([...memory, { id: newId(), text: draft.trim(), at: Date.now() }]).then(() => setDraft(''), () => {})
  // a learned one kept as yours: the agents' rolling list no longer drops it
  const keep = (m: Memory) => !full && save([...memory.filter(x => x.id !== m.id), { ...m, auto: undefined, by: undefined, edited: Date.now() }]).catch(() => {})
  const update = () => editing?.text.trim() && save(memory.map(m => (m.id === editing.id ? { ...m, text: editing.text.trim(), edited: Date.now() } : m))).then(() => setEditing(null), () => {})
  const remove = (m: Memory) => void ask('Delete this memory?', { text: m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text, ok: 'Delete', danger: true }).then(y => y && save(memory.filter(x => x.id !== m.id)).catch(() => {}))
  // ⌘⏎ does it; Esc leaves the box (the page's Esc would close it, the text with it)
  const keys = (f: () => unknown) => (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
    e.key === 'Enter' && (e.metaKey || e.ctrlKey) ? (e.preventDefault(), f()) : e.key === 'Escape' && !e.nativeEvent.isComposing && e.currentTarget.value.trim() && (e.preventDefault(), e.currentTarget.blur())
  return (
    <>
      <div className="mem-new">
        <textarea
          rows={3}
          value={draft}
          aria-label="A new memory"
          placeholder={global ? 'A rule for every project: how you like commits, tests to run, words to avoid… (Markdown)' : 'Something to keep about this project: a decision, a gotcha, who to ask… (Markdown)'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={keys(add)}
        />
        <div className="row">
          <span className="muted small grow">{full ? `${MEMORY_MAX} of yours at most: delete one to add another` : `Claude and Codex get these at every start${global ? ', in every project' : ' in this project'} · ⌘⏎ adds it`}</span>
          <button className="primary" disabled={!draft.trim() || full} onClick={add}>
            Add
          </button>
        </div>
      </div>
      <div className="mem-head">
        <b>Yours</b>
        <span className="muted small">
          {mine.length}/{MEMORY_MAX}
        </span>
      </div>
      {!mine.length && <p className="muted small">Nothing yet.</p>}
      {[...mine].reverse().map(m => item(m))}
      {!global && (
        <>
      <div className="mem-head">
        <b>Learned by agents</b>
        <span className="muted small" data-tip={`Agents add what they learn about the project (laki memory add); past ${MEMORY_MAX}, the oldest goes`}>
          {learned.length}/{MEMORY_MAX} · auto-memory
        </span>
        {compact && (
          <span className="mem-compact">
            <button type="button" disabled={busy || learned.length < 2} data-tip="Laki AI merges duplicates, joins what overlaps and drops what's stale: a shorter list replaces these (never yours)" onClick={compactNow}>
              <Icon name={busy ? 'refresh' : 'collapse'} size={12} /> {busy ? 'Compacting…' : 'Compact now'}
            </button>
            <button type="button" className={log ? 'on' : ''} onClick={toggleLog}>
              Log
            </button>
          </span>
        )}
      </div>
      {compact && (last || err) && (
        <p className={`small ${err || (last && !last.ok) ? 'field-err' : 'muted'}`}>
          {err || (last!.ok ? `Compacted ${ago(last!.at)}: ${last!.before} → ${last!.after}${last!.why === 'you' ? '' : last!.why === 'full' ? ' (it was full)' : ' (every few days)'}` : `Compacting failed ${ago(last!.at)}: ${last!.error}`)}
        </p>
      )}
      {log && (
        <div className="mem-log">
          {!log.length && <p className="muted small">No compaction yet.</p>}
          {log.map(l => (
            <details key={l.at}>
              <summary>
                <span className={l.ok ? '' : 'field-err'}>{new Date(l.at).toLocaleString()}</span> · {l.ok ? `${l.before} → ${l.after}` : `failed: ${l.error}`} · {l.why === 'you' ? 'by you' : l.why === 'full' ? 'it was full' : 'every few days'}
              </summary>
              <div className="mem-log-cols">
                <div>
                  <b className="small">Before</b>
                  <ul>{(l.was ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
                {l.now && (
                  <div>
                    <b className="small">After</b>
                    <ul>{l.now.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
      {!learned.length && <p className="muted small">Nothing yet: agents add what they learn as they work here.</p>}
      {[...learned].reverse().map(m => item(m))}
        </>
      )}
    </>
  )
  function item(m: Memory) {
    return (
        editing?.id === m.id ? (
          <div key={m.id} className="mem editing">
            <textarea autoFocus rows={Math.min(14, Math.max(3, editing.text.split('\n').length + 1))} value={editing.text} aria-label="The memory" onChange={e => setEditing({ id: m.id, text: e.target.value })} onKeyDown={keys(update)} />
            <div className="row">
              <span className="muted small grow">⌘⏎ saves</span>
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" disabled={!editing.text.trim()} onClick={update}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div key={m.id} className="mem">
            <div className="mem-text">
              <Markdown src={m.text} />
            </div>
            <div className="mem-foot">
              <span className="muted small grow" data-tip={new Date(m.edited ?? m.at).toLocaleString()}>
                {m.edited ? `edited ${ago(m.edited)}` : `added ${ago(m.at)}`}
                {m.by ? ` · ${m.by}` : ''}
              </span>
              {m.auto && <IconButton icon="pin" title={full ? `${MEMORY_MAX} of yours at most` : 'Keep it as yours'} onClick={() => void keep(m)} />}
              <IconButton icon="pencil" title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })} />
              <IconButton icon="trash" title="Delete" onClick={() => remove(m)} />
            </div>
          </div>
        )
    )
  }
}
