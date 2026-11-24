// T14: type-level only, checked by npm run typecheck (tsconfig's include has test/), never run: a misspelled method and
// a wrong param fail; a right call types its result from the daemon's handler
import { rpc } from '../../src/shared/conn.ts'
import type { Note } from '../../src/daemon/notes.ts'

export async function typed() {
  // @ts-expect-error: no such method
  await rpc('noteGett', { id: 'x' })
  // @ts-expect-error: noteGet takes an id, not an idd
  await rpc('noteGet', { idd: 'x' })
  // @ts-expect-error: and a string id
  await rpc('note.get', { id: 1 })
  const n: Note = await rpc('noteGet', { id: 'x' }) // its result: the handler's
  const view: { tabs: unknown[] } = await rpc<{ tabs: unknown[] }>('state') // a result type given: the name only
  // the schedule*, flow*, plan*, client* and pr* handlers typed too
  // @ts-expect-error: prFix takes a workspace, not a number
  await rpc('prFix', { ws: 1, what: 'ci' })
  // @ts-expect-error: flowStop needs its run's id
  await rpc('flowStop', {})
  // @ts-expect-error: prThreads' all is a boolean
  await rpc('prThreads', { ws: 'x', all: 'yes' })
  // @ts-expect-error: scheduleRun needs a task's id, a string
  await rpc('scheduleRun', { id: 7 })
  // @ts-expect-error: prDraft's draft is a boolean
  await rpc('prDraft', { ws: 'x', draft: 'yes' })
  // @ts-expect-error: flowRevert needs the version's at
  await rpc('flowRevert', { id: 'w' })
  // @ts-expect-error: clientLog's refused is a boolean
  await rpc('clientLog', { id: 'c', refused: 'yes' })
  // @ts-expect-error: planRm needs its kind and slug
  await rpc('planRm', { project: 'p' })
  await rpc('flowStart', { again: 'run-1' }) // a run again: no workflow needed
  const plans = await rpc('planList', { project: 'p' }) // its result: Plan[]
  return [n, view, plans.length]
}
