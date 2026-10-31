// Calendar (settings.calendar, on unless false; the rail's Calendar, ⌘K): a week or a month of what's coming and what was:
// scheduled tasks at their times (shared/when.ts' rules), their runs, and reminders (the daemon's, state.reminders: from
// here, Laki AI, an agent's laki_reminder or `laki remind`). A click on a day adds a reminder then; each one ticks done,
// opens its workspace or goes. App.tsx passes a CalendarApi.
import { type FormEvent, useMemo, useState } from 'react'
import type { Reminder, Schedule, ScheduleRun } from '../../shared/types'
import { describe, parseWhen, type Rule, stamp, whenOf } from '../../shared/when'
import { Modal } from './panels'
import { Icon, IconButton, load, keep, Page } from './ui'

export type CalendarApi = {
  add(r: { at: number; every?: string; text: string; ws?: string }): Promise<unknown>
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
const full = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// <input type="datetime-local">'s value, in the Mac's time zone; with a space, the words parseAt reads (2026-10-20 14:30)
const local = (t: number, sep = 'T') => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}`
}
const WHEN_EXAMPLES = ['in 30m', 'tomorrow at 9am', 'fri at 5pm', 'every weekday at 9:30', 'mondays at 10am']

// a task's times between from and to (ms): each of its rule's, or one line a day for a busy one; once: its next run only
export function occurrences(s: Schedule, from: number, to: number): Item[] {
  if (!s.on) return []
  const name = s.name ? stamp(s.name, s.next ?? from) : s.prompt.trim().split(/\s+/).slice(0, 6).join(' ')
  const tip = `${name} · ${describe(s.rule)}`
  if (s.rule.once) return s.next && s.next >= from && s.next < to ? [{ key: `t:${s.id}`, at: s.next, kind: 'task', text: name, tip }] : []
  const out: Item[] = []
  for (const ats of timesOf(s.rule, from, to)) {
    if (ats.length > MANY) out.push({ key: `t:${s.id}:${dayOf(ats[0])}`, at: ats[0], kind: 'task', text: `${name} ×${ats.length}`, tip })
    else for (const at of ats) out.push({ key: `t:${s.id}:${at}`, at, kind: 'task', text: name, tip })
  }
  return out
}
// a rule's times between from and to, a list per day that has any
const timesOf = (rule: Rule, from: number, to: number) => {
  const out: number[][] = []
  for (let d = dayOf(from); d < to; d = addDays(d, 1)) {
    if (!rule.days.includes(new Date(d).getDay())) continue
    const ats = rule.times.map(m => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate(), Math.floor(m / 60), m % 60).getTime()).filter(t => t >= from && t < to) // as nextRun: a DST day's clock
    if (ats.length) out.push(ats)
  }
  return out
}
// a reminder's times in sight: its next one, and a repeating one's after it (a line each, or one a day for a busy one:
// times, how many; a tick stops them all)
const remindersAt = (r: Reminder, from: number, to: number): { at: number; n: number }[] => {
  const rule = r.every && !r.done ? parseWhen(r.every) : undefined
  if (!rule || 'error' in rule) return r.at >= from && r.at < to ? [{ at: r.at, n: 1 }] : []
  return timesOf(rule, Math.max(from, r.at), to).flatMap(ats => (ats.length > MANY ? [{ at: ats[0], n: ats.length }] : ats.map(at => ({ at, n: 1 }))))
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
      ...reminders.flatMap(r => remindersAt(r, first, end).map(x => ({ r, ...x }))).map(({ r, at, n }) => ({ key: `m:${r.id}:${at}`, at, kind: 'reminder' as const, text: n > 1 ? `${r.text} ×${n}` : r.text, tip: [r.every && `repeats: ${r.every} (a tick stops it)`, r.by && `from ${r.by}`, r.ws && workspaces.find(w => w.id === r.ws)?.name].filter(Boolean).join(' · ') || undefined, r, ws: r.ws })),
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
  const when = form ? whenOf(form.at) : undefined // the words read back as they're typed
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form || !when) return
    if (!form.text.trim()) return setErr('Remind you of what?')
    if ('error' in when) return setErr(when.error)
    api.add({ at: when.at, ...(when.every && { every: when.every }), text: form.text, ...(form.ws && { ws: form.ws }) }).then(() => (setForm(null), setErr('')), e => setErr((e as Error).message))
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
      {i.r?.every && <Icon name="repeat" size={10} />}
      <span className="cal-text" onClick={() => (i.ws && workspaces.some(w => w.id === i.ws) ? api.openWs(i.ws) : i.kind !== 'reminder' && api.openSchedules())}>{i.text}</span>
      {i.kind === 'reminder' && <IconButton icon="x" title="Remove the reminder" className="cal-rm" onClick={() => api.rm(i.r!.id).catch(() => {})} />}
    </div>
  )
  const coming = reminders.filter(r => !r.done && r.at >= Date.now()).length
  const openForm = (d: number) => (setErr(''), setForm({ at: d === today ? 'in 1h' : local(newAt(d), ' '), text: '', ws: '' }))
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
          <Modal title="New reminder" onClose={() => (setForm(null), setErr(''))}>
            <form className="cal-form" onSubmit={submit}>
              <label>
                <span>Remind me to</span>
                <input autoFocus placeholder="Check the deploy" value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} />
              </label>
              <label>
                <span>When</span>
                <span className="cal-when">
                  <input placeholder="tomorrow at 9am, every weekday at 9:30" value={form.at} onChange={e => (setErr(''), setForm({ ...form, at: e.target.value }))} />
                  <input type="datetime-local" aria-label="Pick a date" data-tip="Pick a date" value={(t => (t && !('error' in t) && !t.every ? local(t.at) : ''))(when)} onChange={e => e.target.value && setForm({ ...form, at: e.target.value.replace('T', ' ') })} />
                </span>
              </label>
              <span className={`small cal-read ${when && 'error' in when ? 'bad' : ''}`}>
                {!when || !form.at.trim() ? '' : 'error' in when ? when.error : when.every ? `Repeats: ${when.every} · next ${full(when.at)}` : full(when.at)}
              </span>
              <span className="cal-examples">
                {WHEN_EXAMPLES.map(x => (
                  <button key={x} type="button" className="chip" onClick={() => (setErr(''), setForm({ ...form, at: x }))}>
                    {x}
                  </button>
                ))}
              </span>
              <label>
                <span>About</span>
                <select value={form.ws} onChange={e => setForm({ ...form, ws: e.target.value })} aria-label="About a workspace">
                  <option value="">No workspace</option>
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              {err && <span className="cal-err">{err}</span>}
              <div className="row">
                <button type="button" onClick={() => (setForm(null), setErr(''))}>Cancel</button>
                <button type="submit" className="primary" disabled={!form.text.trim() || !when || 'error' in when}>Add reminder</button>
              </div>
            </form>
          </Modal>
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
