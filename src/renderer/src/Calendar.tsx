// Calendar (settings.calendar, on unless false; the rail's Calendar, ⌘K): a week or a month of what's coming and what was:
// scheduled tasks at their times (shared/when.ts' rules), their runs, and reminders (the daemon's, state.reminders: from
// here, Laki AI, an agent's laki_reminder or `laki remind`). A click on a day adds a reminder then; each one ticks done,
// opens its workspace or goes. App.tsx passes a CalendarApi.
import { type FormEvent, useMemo, useState } from 'react'
import type { Reminder, Schedule, ScheduleRun } from '../../shared/types'
import { describe, stamp } from '../../shared/when'
import { Icon, IconButton, load, keep, Page } from './ui'

export type CalendarApi = {
  add(r: { at: number; text: string; ws?: string }): Promise<unknown>
  set(r: { id: string; done?: boolean; at?: number; text?: string }): Promise<unknown>
  rm(id: string): Promise<unknown>
  openWs(ws: string): void
  openSchedules(): void
}
type Item = { key: string; at: number; kind: 'task' | 'run' | 'reminder'; text: string; tip?: string; ok?: boolean; r?: Reminder; ws?: string }

const DAY = 86400000
const MANY = 4 // a task with more times a day than this is one line for the day (every 30 minutes…)
const dayOf = (t: number) => new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime()
const addDays = (t: number, n: number) => new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + n).getTime()
const monday = (t: number) => addDays(dayOf(t), -((new Date(t).getDay() + 6) % 7)) // weeks start on Monday
const count = (l: Item[], k: Item['kind'], word: string) => (n => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : ''))(l.filter(i => i.kind === k).length)
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// <input type="datetime-local">'s value, in the Mac's time zone
const local = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// a task's times between from and to (ms): each of its rule's, or one line a day for a busy one; once: its next run only
export function occurrences(s: Schedule, from: number, to: number): Item[] {
  if (!s.on) return []
  const name = s.name ? stamp(s.name, s.next ?? from) : s.prompt.trim().split(/\s+/).slice(0, 6).join(' ')
  const tip = `${name} · ${describe(s.rule)}`
  if (s.rule.once) return s.next && s.next >= from && s.next < to ? [{ key: `t:${s.id}`, at: s.next, kind: 'task', text: name, tip }] : []
  const out: Item[] = []
  for (let d = dayOf(from); d < to; d = addDays(d, 1)) {
    if (!s.rule.days.includes(new Date(d).getDay())) continue
    const ats = s.rule.times.map(m => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate(), Math.floor(m / 60), m % 60).getTime()).filter(t => t >= from && t < to) // as nextRun: a DST day's clock
    if (ats.length > MANY) out.push({ key: `t:${s.id}:${d}`, at: ats[0], kind: 'task', text: `${name} ×${ats.length}`, tip })
    else for (const at of ats) out.push({ key: `t:${s.id}:${at}`, at, kind: 'task', text: name, tip })
  }
  return out
}

export function CalendarPage({ schedules, runs, reminders, workspaces, api, onClose }: { schedules: Schedule[]; runs: ScheduleRun[]; reminders: Reminder[]; workspaces: { id: string; name: string }[]; api: CalendarApi; onClose: () => void }) {
  const [mode, setMode] = useState<'week' | 'month'>(() => load('laki.calendar', 'week'))
  const [anchor, setAnchor] = useState(() => Date.now())
  const [form, setForm] = useState<{ at: string; text: string; ws: string } | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<number | null>(null) // a day shown whole on the right (its start, ms)
  const pick = (m: 'week' | 'month') => (setMode(m), keep('laki.calendar', m))
  // the days shown: a week from Monday, or the month's weeks whole (6 rows at most)
  const first = mode === 'week' ? monday(anchor) : monday(new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth(), 1).getTime())
  const days = mode === 'week' ? 7 : (() => {
    const last = new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth() + 1, 0).getTime()
    return Math.round((dayOf(last) - first) / DAY) + 1 + 6 - ((new Date(last).getDay() + 6) % 7) // to its last week's Sunday (round: a DST day is 23 or 25 hours)
  })()
  const end = addDays(first, days)
  const items = useMemo(() => {
    const all: Item[] = [
      ...schedules.flatMap(s => occurrences(s, Math.max(first, Date.now()), end)), // what's coming; what was is the runs
      ...runs.filter(r => r.at >= first && r.at < end).map(r => ({ key: `r:${r.id}`, at: r.at, kind: 'run' as const, text: r.name, tip: r.what, ok: r.ok, ws: r.ws })),
      ...reminders.filter(r => r.at >= first && r.at < end).map(r => ({ key: `m:${r.id}`, at: r.at, kind: 'reminder' as const, text: r.text, tip: [r.by && `from ${r.by}`, r.ws && workspaces.find(w => w.id === r.ws)?.name].filter(Boolean).join(' · ') || undefined, r, ws: r.ws })),
    ]
    const by = new Map<number, Item[]>()
    for (const i of all.sort((a, b) => a.at - b.at)) by.set(dayOf(i.at), [...(by.get(dayOf(i.at)) ?? []), i])
    return by
  }, [schedules, runs, reminders, workspaces, first, end])
  const move = (n: number) => setAnchor(a => (mode === 'week' ? addDays(a, 7 * n) : new Date(new Date(a).getFullYear(), new Date(a).getMonth() + n, 1).getTime()))
  const today = dayOf(Date.now())
  const title = mode === 'week'
    ? `${new Date(first).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(addDays(end, -1)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    : new Date(anchor).toLocaleDateString([], { month: 'long', year: 'numeric' })
  const newAt = (d: number) => (d === today ? Math.ceil((Date.now() + 1) / 3600000) * 3600000 : new Date(d).setHours(9)) // today: the next hour; another day: 9am (setHours: a DST day's too)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const at = new Date(form.at).getTime()
    if (!form.text.trim() || Number.isNaN(at)) return setErr('What, and when?')
    api.add({ at, text: form.text, ...(form.ws && { ws: form.ws }) }).then(() => (setForm(null), setErr('')), e => setErr((e as Error).message))
  }
  const line = (i: Item) => (
    <div key={i.key} className={`cal-item ${i.kind} ${i.r?.done ? 'done' : ''} ${i.kind === 'run' && !i.ok ? 'bad' : ''}`} data-tip={i.tip}>
      {i.kind === 'reminder' ? (
        <button type="button" className="cal-tick" aria-pressed={!!i.r!.done} aria-label={i.r!.done ? 'Not done' : 'Done'} onClick={() => api.set({ id: i.r!.id, done: !i.r!.done }).catch(() => {})}>
          {i.r!.done && <Icon name="check" size={9} />}
        </button>
      ) : (
        <Icon name={i.kind === 'task' ? 'clock' : i.ok ? 'check' : 'x'} size={11} />
      )}
      <span className="cal-time">{hm(i.at)}</span>
      <span className="cal-text" onClick={() => (i.ws && workspaces.some(w => w.id === i.ws) ? api.openWs(i.ws) : i.kind !== 'reminder' && api.openSchedules())}>{i.text}</span>
      {i.kind === 'reminder' && <IconButton icon="x" title="Remove the reminder" className="cal-rm" onClick={() => api.rm(i.r!.id).catch(() => {})} />}
    </div>
  )
  const coming = reminders.filter(r => !r.done && r.at >= Date.now()).length
  const openForm = (d: number) => (setErr(''), setForm({ at: local(newAt(d)), text: '', ws: '' }))
  const dayList = sel !== null ? (items.get(sel) ?? []) : []
  return (
    <Page title="Calendar" wide esc={false} /* a page to stay on, as the rail's others: Esc never closes it */ onClose={onClose}>
      <div className={`cal ${sel !== null ? 'with-day' : ''}`}>
        <div className="cal-bar">
          <span className="cal-nav">
            <IconButton icon="chevronLeft" title={`The ${mode} before`} onClick={() => move(-1)} />
            <button type="button" className="cal-today" onClick={() => (setAnchor(Date.now()), setSel(today))}>Today</button>
            <IconButton icon="chevronRight" title={`The next ${mode}`} onClick={() => move(1)} />
          </span>
          <h2 className="cal-title">{title}</h2>
          <span className="grow" />
          <span className="seg cal-mode">
            <button type="button" className={mode === 'week' ? 'on' : ''} onClick={() => pick('week')}>Week</button>
            <button type="button" className={mode === 'month' ? 'on' : ''} onClick={() => pick('month')}>Month</button>
          </span>
          <button type="button" className="primary" onClick={() => openForm(sel ?? today)}>
            <Icon name="plus" size={12} /> Reminder
          </button>
        </div>
        <p className="muted small cal-say">
          Scheduled tasks at their times, their runs, and your reminders ({coming} coming). Laki AI and agents add them too
          (<code>laki remind "tomorrow at 9am" …</code>). Click a day to see it whole.
        </p>
        {form && (
          <form className="cal-form" onSubmit={submit}>
            <input autoFocus placeholder="Remind me to…" value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} />
            <input type="datetime-local" value={form.at} onChange={e => setForm({ ...form, at: e.target.value })} />
            <select value={form.ws} onChange={e => setForm({ ...form, ws: e.target.value })} aria-label="About a workspace">
              <option value="">No workspace</option>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button type="submit" className="primary">Add</button>
            <button type="button" onClick={() => (setForm(null), setErr(''))}>Cancel</button>
            {err && <span className="cal-err">{err}</span>}
          </form>
        )}
        <div className="cal-main">
          <div className={`cal-grid ${mode}`}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="cal-dow">{d}</div>)}
            {Array.from({ length: days }, (_, i) => addDays(first, i)).map(d => {
              const list = items.get(d) ?? []
              const shown = mode === 'month' ? list.slice(0, 3) : list
              const out = mode === 'month' && new Date(d).getMonth() !== new Date(anchor).getMonth()
              return (
                <div key={d} className={`cal-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''} ${out ? 'out' : ''} ${d === sel ? 'sel' : ''}`} onClick={e => !(e.target as Element).closest('button, .cal-text') && setSel(d)}>
                  <button type="button" className="cal-date" data-tip="This day, whole" onClick={() => setSel(d)}>
                    {mode === 'week' && new Date(d).toLocaleDateString([], { weekday: 'short' })} {new Date(d).getDate()}
                  </button>
                  {shown.map(line)}
                  {list.length > shown.length && (
                    <button type="button" className="cal-more" onClick={() => setSel(d)}>
                      +{list.length - shown.length} more
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {sel !== null && (
            <aside className="cal-side" aria-label="The day">
              <div className="cal-side-head">
                <div>
                  <b>{new Date(sel).toLocaleDateString([], { weekday: 'long' })}</b>
                  <span className="muted small">{new Date(sel).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                </div>
                <IconButton icon="x" title="Close the day" onClick={() => setSel(null)} />
              </div>
              <div className="cal-side-sum muted small">
                {dayList.length ? [count(dayList, 'reminder', 'reminder'), count(dayList, 'task', 'scheduled run'), count(dayList, 'run', 'run')].filter(Boolean).join(' · ') : 'Nothing on this day'}
              </div>
              <div className="cal-side-list">{dayList.map(line)}</div>
              <button type="button" onClick={() => openForm(sel)}>
                <Icon name="plus" size={12} /> Remind me this day
              </button>
            </aside>
          )}
        </div>
      </div>
    </Page>
  )
}
