import { useRef } from 'react'
import type { TabView } from '../../shared/types'
import { Icon, type IconName } from './ui'
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
// ✖ exited, ○ idle, ✓ ended fine. V1: each the icon pack's shape (one weight, Settings › Appearance › Icons), not a
// font's character; ◆ and ● filled (styles.css .glyph), sized to read as the characters did
// R13: said, not only drawn: a screen reader hears the status (the glyph and its color say it to the eye)
const SAID: Record<string, string> = { waiting: 'needs you', running: 'working', setup: 'setting up', done: 'finished', idle: 'idle', exited: 'ended with an error', ok: 'ended', finished: 'ended', limit: 'at its usage limit' }
// V7: one that turns to done (or ended fine) ticks once, 400 ms (g-pop), as it changes: not as it's first drawn
const ENDS = new Set(['done', 'ok', 'finished'])
const MARKS: Record<string, [IconName, number]> = { waiting: ['square', 9], done: ['circle', 8], idle: ['circle', 9], exited: ['x', 10], ok: ['check', 11], finished: ['check', 11], limit: ['clock', 11] }
export function Glyph({ s }: { s: string }) {
  const was = useRef(s)
  const at = useRef(0)
  if (was.current !== s) {
    if (ENDS.has(s)) at.current = performance.now()
    was.current = s
  }
  if (s === 'running' || s === 'setup') return <span className={`glyph spin g-${s}`} role="img" aria-label={SAID[s]} title={s} />
  const [icon, size] = MARKS[s] ?? ['minus', 8]
  return (
    <span className={`glyph g-${s || 'none'}${performance.now() - at.current < 400 ? ' g-pop' : ''}`} role="img" aria-label={SAID[s] ?? 'a terminal'} title={s || 'shell'}>
      <Icon name={icon} size={size} />
    </span>
  )
}
