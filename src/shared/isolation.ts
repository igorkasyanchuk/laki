// F7 (step 1): workspaces kept apart without containers. Each live workspace has a block of BLOCK ports from PORT_BASE
// (core.ts allocPort: the first block no other live one has), so its slot is the block's number. What's derived from it
// goes into every tab's, setup's, run's, Done check's and teardown's environment (core.ts lakiEnv, verify.ts), so two
// worktrees' dev servers, databases and compose stacks don't meet. Pure: the daemon's and the renderer's
export const PORT_BASE = 3100
export const BLOCK = 10
// its slot: 0 for 3100, 1 for 3110…; none for a port that isn't a block's start (archived: 0)
export const slotOf = (port: number) => (Number.isInteger(port) && port >= PORT_BASE && (port - PORT_BASE) % BLOCK === 0 ? (port - PORT_BASE) / BLOCK : undefined)
// a compose project's name: lowercase letters, digits, - and _, starting with a letter or digit
const composeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '') || 'laki'
// LAKI_SLOT, PORT_1…PORT_9 (PORT is the block's first: core's own), LAKI_DB_SUFFIX (_ws<slot>), COMPOSE_PROJECT_NAME
// (<project>-ws<slot>, which docker compose reads by itself)
export function isolationEnv(port: number, project: string): Record<string, string> {
  const slot = slotOf(port)
  if (slot === undefined) return {}
  const env: Record<string, string> = { LAKI_SLOT: String(slot), LAKI_DB_SUFFIX: `_ws${slot}`, COMPOSE_PROJECT_NAME: `${composeName(project)}-ws${slot}` }
  for (let i = 1; i < BLOCK; i++) env[`PORT_${i}`] = String(port + i)
  return env
}
// a workspace's process listening on a port of another's block: both get it (theirs: that port is the other's; else
// the other has one of mine). ports: what its processes listen on (resources.ts)
export type Clash = { port: number; other: string; theirs: boolean }
export function portClashes(ws: { id: string; port: number; ports?: number[]; archived?: boolean }[]): Map<string, Clash[]> {
  const out = new Map<string, Clash[]>()
  const add = (id: string, c: Clash) => out.set(id, [...(out.get(id) ?? []), c])
  const live = ws.filter(w => !w.archived && slotOf(w.port) !== undefined)
  for (const w of live)
    for (const p of new Set(w.ports ?? [])) {
      const owner = live.find(o => o !== w && p >= o.port && p < o.port + BLOCK)
      if (owner) add(w.id, { port: p, other: owner.id, theirs: true }), add(owner.id, { port: p, other: w.id, theirs: false })
    }
  return out
}
