import { useEffect, useRef, useState } from 'react'
import type { TabView } from '../../shared/types'
import { Icon, type IconName } from './ui'
import { shownStatus } from './text'
import { type Fx, FX_MS, fxOf } from './glyphFx'

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
// V7b: as its state changes while it's drawn, data-fx (glyphFx.ts) for 400 ms: done ticks, ask nods, err shakes, once
// (styles.css: Motion low only done; none under Motion: Off or Reduce motion). The sidebar's row and a tab's mark alike
const MARKS: Record<string, [IconName, number]> = { waiting: ['square', 9], done: ['circle', 8], idle: ['circle', 9], exited: ['x', 10], ok: ['check', 11], finished: ['check', 11], limit: ['clock', 11] }
function useFx(s: string) {
  const was = useRef<string | undefined>(undefined) // none as it's first drawn
  const [fx, setFx] = useState<Fx>()
  useEffect(() => {
    const f = fxOf(was.current, s, was.current !== undefined)
    was.current = s
    if (!f) return
    setFx(f)
    const t = setTimeout(() => setFx(undefined), FX_MS)
    return () => (clearTimeout(t), setFx(undefined))
  }, [s])
  return fx
}
export function Glyph({ s }: { s: string }) {
  const fx = useFx(s)
  if (s === 'running' || s === 'setup') return <span className={`glyph spin g-${s}`} role="img" aria-label={SAID[s]} />
  const [icon, size] = MARKS[s] ?? ['minus', 8]
  return (
    <span className={`glyph g-${s || 'none'}`} data-fx={fx} role="img" aria-label={SAID[s] ?? 'a terminal'}>
      <Icon name={icon} size={size} />
    </span>
  )
}
