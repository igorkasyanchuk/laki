// F1: the turns kept for a tab (turns.ts turnKeep), a dot each under its terminal or Reader: hover says what the turn
// was (its prompt, files, when, how long, the cost), a click offers its changes, a rewind of the files to before it and
// a new workspace from it. A hollow dot is a rewind of yours (rewinding that one undoes it).
import { useEffect, useState } from 'react'
import type { TabView, TurnKept } from '../../shared/types'
import { turnWords } from './text'
import { type MenuItem, useMenu } from './ui'

export type TurnApi = { list: (tab: string) => Promise<TurnKept[]>; show: (t: TurnKept) => void; rewind: (t: TurnKept) => Promise<unknown>; fork: (t: TurnKept) => void }
const SHOWN = 30 // the newest: the strip stays a line

export function TurnStrip({ tab, api }: { tab: TabView; api: TurnApi }) {
  const [turns, setTurns] = useState<TurnKept[]>([])
  const [again, setAgain] = useState(0)
  const [menu, open] = useMenu()
  // as a turn ends (its status, its card), and after a rewind
  useEffect(() => {
    let on = true
    void api.list(tab.id).then(l => on && setTurns(l), () => {})
    return () => void (on = false)
  }, [tab.id, tab.status, tab.changes?.at, again])
  if (!turns.length) return null
  const items = (t: TurnKept): MenuItem[] => [
    { head: turnWords(t) },
    { label: 'Show its changes', sub: 'Changes › This turn', run: () => api.show(t) },
    { label: t.rewind ? 'Undo this rewind…' : 'Rewind files to before it…', sub: 'What is there now is kept as a turn of its own', run: () => void api.rewind(t).then(() => setAgain(n => n + 1), () => {}) },
    ...(t.rewind ? [] : [{ label: 'New workspace from here', sub: "This turn's files, on a branch of their own", run: () => api.fork(t) }]),
  ]
  return (
    <div className="turn-strip" role="group" aria-label={`${tab.name}'s turns`}>
      <span className="muted small">Turns</span>
      {turns.length > SHOWN && <span className="muted small">… {turns.length - SHOWN} earlier</span>}
      {turns.slice(-SHOWN).map(t => (
        <button key={t.n} type="button" className={t.rewind ? 'turn-dot rewind' : 'turn-dot'} aria-label={`Turn ${turnWords(t)}`} data-tip={turnWords(t)} onClick={e => open(e, items(t))} />
      ))}
      {menu}
    </div>
  )
}
