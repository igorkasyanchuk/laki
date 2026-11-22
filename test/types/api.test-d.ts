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
  const plans = await rpc('planList', { project: 'p' }) // its result: Plan[]
  return [n, view, plans.length]
}
