// a scheduled task's run in a glyph and words (the Schedules page's log, the Calendar): small, so neither page pulls in
// the other
import type { ScheduleRun } from '../../shared/types'
import type { IconName } from './ui'

// T1: a run's end in a glyph and words: its state (the agent's last line, its PR, cost, diff), else how it started
const STATE_ICON: Record<string, IconName> = { running: 'activity', done: 'check', waiting: 'alertCircle', failed: 'x', stopped: 'stop' }
export const runIcon = (r: ScheduleRun): IconName => (r.skipped ? 'minus' : !r.ok ? 'x' : (STATE_ICON[r.state ?? ''] ?? 'check'))
export const runLine = (r: ScheduleRun) =>
  r.state && r.state !== 'running'
    ? [r.state === 'waiting' ? 'needs you' : r.state, r.said && `“${r.said}”`, r.pr && `PR #${r.pr.number}`, r.diff && r.diff.files > 0 && `+${r.diff.add} −${r.diff.del}`, r.cost !== undefined && `$${r.cost.toFixed(2)}`].filter(Boolean).join(' · ')
    : r.what
