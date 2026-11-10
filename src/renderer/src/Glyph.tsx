import type { TabView } from '../../shared/types'
import { shownStatus } from './text'

const STATUS_RANK = { waiting: 4, running: 3, done: 2, idle: 1, exited: 0 } as const


// a workspace's (or tab's) glyph: ◆ needs you, spinner running, ● finished while you looked away, ◷ limit
export function rollup(tabs: TabView[]) {
  let best: keyof typeof STATUS_RANK = 'exited'
  let limit = false
  for (const t of tabs) {
    limit ||= !!t.limit
    const st = shownStatus(t)
    const s = t.done && st === 'idle' ? 'done' : st
    if (STATUS_RANK[s] > STATUS_RANK[best]) best = s
  }
  return limit && best !== 'waiting' && best !== 'running' ? 'limit' : best
}

// ◆ needs you, spinner running (setup: a setup script), ● finished while you looked away, ◷ usage limit,
// ✖ exited, ○ idle, ✓ ended fine.
// R13: said, not only drawn: a screen reader hears the status (the glyph and its color say it to the eye)
const SAID: Record<string, string> = { waiting: 'needs you', running: 'working', setup: 'setting up', done: 'finished', idle: 'idle', exited: 'ended with an error', ok: 'ended', finished: 'ended', limit: 'at its usage limit' }
export function Glyph({ s }: { s: string }) {
  if (s === 'running' || s === 'setup') return <span className={`glyph spin g-${s}`} role="img" aria-label={SAID[s]} title={s} />
  const ch = { waiting: '◆', done: '●', idle: '○', exited: '✖', ok: '✓', finished: '✓', limit: '◷' }[s] ?? '·'
  return (
    <span className={`glyph g-${s || 'none'}`} role="img" aria-label={SAID[s] ?? 'a terminal'} title={s || 'shell'}>
      {ch}
    </span>
  )
}
