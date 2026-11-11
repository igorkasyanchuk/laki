// F1: the turns kept for a tab (turns.ts turnKeep). The focused agent tab's are a button in the status bar (TurnButton):
// hover says how many and the last, a click lists them, newest first, each with its changes, a rewind of the files to
// before it and a new workspace from it. With the status bar off, a dot each under its terminal or Reader (TurnStrip).
// A rewind of yours is a turn too (hollow, or "rewind"): rewinding that one undoes it.
import { type MouseEvent, useEffect, useState } from 'react'
import type { TabView, TurnKept } from '../../shared/types'
import { turnFacts, turnWords } from './text'
import { Icon, type MenuItem, useMenu } from './ui'

export type TurnApi = { list: (tab: string) => Promise<TurnKept[]>; show: (t: TurnKept) => void; rewind: (t: TurnKept) => Promise<unknown>; fork: (t: TurnKept) => void }
const SHOWN = 30 // the newest: the strip stays a line, the list a screen
const SAID = 60 // a prompt in the list: its start (turns.ts keeps 160), the menu stays narrow

// as a turn ends (its status, its card), and after a rewind (again)
function useTurns(tab: TabView, api: TurnApi) {
  const [turns, setTurns] = useState<TurnKept[]>([])
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let on = true
    void api.list(tab.id).then(l => on && setTurns(l), () => {})
    return () => void (on = false)
  }, [tab.id, tab.status, tab.changes?.at, again])
  const acts = (t: TurnKept): MenuItem[] => [
    { label: 'Show its changes', sub: 'Changes › This turn', run: () => api.show(t) },
    { label: t.rewind ? 'Undo this rewind…' : 'Rewind files to before it…', sub: 'What is there now is kept as a turn of its own', run: () => void api.rewind(t).then(() => setAgain(n => n + 1), () => {}) },
    ...(t.rewind ? [] : [{ label: 'New workspace from here', sub: "This turn's files, on a branch of their own", run: () => api.fork(t) }]),
  ]
  return { turns, acts }
}

// onMenu: App's menu (over everything, as the status bar's other menus); keyed by its tab in App, so a tab's list never
// shows another's while it loads
export function TurnButton({ tab, api, onMenu }: { tab: TabView; api: TurnApi; onMenu: (e: MouseEvent, items: MenuItem[]) => void }) {
  const { turns, acts } = useTurns(tab, api)
  if (!turns.length) return null
  const said = (s?: string) => (c => (c.length > SAID ? `${c.slice(0, SAID - 1).join('')}…` : s))([...(s ?? '')]) // by code point: no emoji cut in half
  const items: MenuItem[] = [
    { head: `${tab.name}'s turns` },
    ...turns
      .slice(-SHOWN)
      .reverse()
      .map((t): MenuItem => ({ label: [`#${t.n}`, t.rewind && 'rewind', said(t.prompt)].filter(Boolean).join(' · '), sub: turnFacts(t), icon: t.rewind ? 'history' : undefined, items: acts(t) })),
    ...(turns.length > SHOWN ? [{ head: `… ${turns.length - SHOWN} earlier` }] : []),
  ]
  return (
    <button type="button" className="sb-flow sb-turns" aria-label={`${tab.name}'s turns: ${turns.length}`} data-tip={`${tab.name}'s turns, ${turns.length} kept · the last: ${turnWords(turns.at(-1)!)} · click: its changes, a rewind, a workspace from one`} onClick={e => onMenu(e, items)}>
      <Icon name="history" size={12} />
      {turns.length}
    </button>
  )
}

export function TurnStrip({ tab, api }: { tab: TabView; api: TurnApi }) {
  const { turns, acts } = useTurns(tab, api)
  const [menu, open] = useMenu()
  if (!turns.length) return null
  return (
    <div className="turn-strip" role="group" aria-label={`${tab.name}'s turns`}>
      <span className="muted small">Turns</span>
      {turns.length > SHOWN && <span className="muted small">… {turns.length - SHOWN} earlier</span>}
      {turns.slice(-SHOWN).map(t => (
        <button key={t.n} type="button" className={t.rewind ? 'turn-dot rewind' : 'turn-dot'} aria-label={`Turn ${turnWords(t)}`} data-tip={turnWords(t)} onClick={e => open(e, [{ head: turnWords(t) }, ...acts(t)])} />
      ))}
      {menu}
    </div>
  )
}
