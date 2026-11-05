// the status bar's Background chip: what the workspace's claude tabs left running in the background (Bash
// run_in_background shells, background subagents: meters.ts reads them from each chat), and a card listing them, each
// with Output and Stop as the Reader's chips have, and how many finished. Shown while one runs, and 10 minutes after
// the last one ended
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type BgTaskView, type TabView } from '../../shared/types'
import { Icon, IconButton } from './ui'

type BgOut = { text: string; size: number; cut?: boolean }
export type BgApi = { bgOutput: (tab: string, id: string) => Promise<BgOut>; send: (tab: string, text: string) => Promise<unknown> }
const RECENT = 10 * 60_000

export function BgButton({ tabs, api }: { tabs: TabView[]; api: BgApi }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const live = tabs.filter(t => t.background && t.status !== 'exited')
  const running = live.flatMap(t => t.background!.now.map(task => ({ tab: t, task })))
  const done = live.reduce((n, t) => n + t.background!.done, 0)
  const last = Math.max(0, ...live.map(t => t.background!.at ?? 0))
  if (!running.length && !(done && Date.now() - last < RECENT) && !at) return null
  const tip = running.length ? `Background: ${running.map(r => r.task.name).join(' · ')}` : `Background: ${done} finished`
  return (
    <>
      <button className={`sb-bg ${running.length ? 'on' : ''}`} data-tip={`${tip} · click: the list`} onClick={e => setAt(e.currentTarget.getBoundingClientRect())}>
        <Icon name={running.length ? 'gear' : 'check'} size={11} />
        {running.length ? `${running.length} running` : `${done} finished`}
      </button>
      {at && <BgPop anchor={at} tabs={live} api={api} onClose={() => setAt(null)} />}
    </>
  )
}

function BgPop({ anchor, tabs, api, onClose }: { anchor: DOMRect; tabs: TabView[]; api: BgApi; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [out, setOut] = useState<{ tab: string; id: string; got?: BgOut; err?: string; ended?: boolean }>()
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true) // before the terminal under it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  useLayoutEffect(() => {
    const el = box.current!
    el.style.left = `${Math.max(8, Math.min(anchor.left - 8, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.bottom = `${window.innerHeight - anchor.top + 6}px`
  })
  // a running task's output, read on every 2 s while shown (the Reader's way); ended: its last output stays
  useEffect(() => {
    if (!out || out.ended) return
    let alive = true
    const go = () => api.bgOutput(out.tab, out.id).then(got => alive && setOut(o => (o?.id === out.id ? { ...o, got, err: undefined } : o)), e => alive && setOut(o => o && (o.got ? { ...o, ended: true } : { ...o, err: (e as Error).message })))
    go()
    const t = setInterval(() => document.visibilityState === 'visible' && go(), 2000)
    return () => ((alive = false), clearInterval(t))
  }, [out?.tab, out?.id, out?.ended])
  const many = tabs.length > 1
  // a subagent in this turn (its call's id) stops with the turn (Esc); a background one or a shell: the agent is asked
  const stop = (t: TabView, x: BgTaskView) => void api.send(t.id, `Stop the background ${x.kind === 'agent' ? 'subagent' : 'task'} ${x.id} (${x.name}) now, with TaskStop (or KillShell), then say it's stopped.`).catch(() => {})
  const row = (t: TabView, x: BgTaskView, ended: boolean) => (
    <li key={`${t.id}:${x.id}:${ended}`} className={ended ? 'ended' : ''}>
      <Icon name={x.kind === 'agent' ? 'agent' : 'terminal'} size={13} />
      <span className={`grow bg-name ${x.kind === 'shell' ? 'mono' : ''}`} data-tip={x.name}>
        {x.name}
        {many && <span className="muted small"> · {t.name}</span>}
      </span>
      {ended ? (
        <span className="muted small">Done</span>
      ) : (
        <>
          {x.out && (
            <button type="button" className={`link small ${out?.id === x.id ? 'on' : ''}`} onClick={() => setOut(o => (o?.id === x.id ? undefined : { tab: t.id, id: x.id }))}>
              Output
            </button>
          )}
          {x.id.startsWith('toolu_') ? (
            <span className="muted small" data-tip="In this turn: Esc in its tab stops it with the turn">
              running
            </span>
          ) : (
            <button type="button" className="link small danger" data-tip={`Asks ${t.name} to stop it`} onClick={() => stop(t, x)}>
              Stop
            </button>
          )}
        </>
      )}
    </li>
  )
  const done = tabs.reduce((n, t) => n + t.background!.done, 0)
  const now = tabs.flatMap(t => t.background!.now.map(x => row(t, x, false)))
  const last = tabs.flatMap(t => t.background!.last.map(x => ({ t, x }))).slice(0, 5)
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="tunnel-pop bg-pop" ref={box} role="dialog" aria-label="Background tasks">
        <div className="tunnel-head">
          <b>Background tasks</b>
          <span className="grow" />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        <ul className="bg-list">
          {now}
          {last.map(({ t, x }) => row(t, x, true))}
        </ul>
        {!now.length && !last.length && <p className="muted small">Nothing runs in the background now.</p>}
        {out && (
          <div className="rd-out">
            <div className="rd-out-head">
              <span className="mono small grow">{tabs.flatMap(t => t.background!.now).find(x => x.id === out.id)?.name ?? 'output'}</span>
              {out.ended ? <span className="muted small">ended</span> : out.got?.cut && <span className="muted small">its last 64 KB</span>}
            </div>
            {out.err ? <div className="warn small">{out.err}</div> : <pre className="rd-out-text">{out.got ? out.got.text || '(nothing yet)' : 'Loading…'}</pre>}
          </div>
        )}
        {done > 0 && (
          <div className="bg-foot muted small">
            <Icon name="layers" size={12} />
            {done} finished
          </div>
        )}
      </div>
    </div>
  )
}
