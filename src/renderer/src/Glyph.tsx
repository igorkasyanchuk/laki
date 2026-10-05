import type { TabView } from '../../shared/types'

const STATUS_RANK = { waiting: 4, running: 3, done: 2, idle: 1, exited: 0 } as const

// a workspace's (or tab's) glyph: ◆ needs you, spinner running, ● finished while you looked away, ◷ limit
export function rollup(tabs: TabView[]) {
  let best: keyof typeof STATUS_RANK = 'exited'
  let limit = false
  for (const t of tabs) {
    limit ||= !!t.limit
    const s = t.done && t.status === 'idle' ? 'done' : t.status
    if (STATUS_RANK[s] > STATUS_RANK[best]) best = s
  }
  return limit && best !== 'waiting' && best !== 'running' ? 'limit' : best
}

// ◆ needs you, spinner running (setup: a setup script), ● finished while you looked away, ◷ usage limit,
// ✖ exited, ○ idle, ✓ ended fine.
export function Glyph({ s }: { s: string }) {
  if (s === 'running' || s === 'setup') return <span className={`glyph spin g-${s}`} title={s} />
  const ch = { waiting: '◆', done: '●', idle: '○', exited: '✖', ok: '✓', finished: '✓', limit: '◷' }[s] ?? '·'
  return (
    <span className={`glyph g-${s || 'none'}`} title={s || 'shell'}>
      {ch}
    </span>
  )
}
