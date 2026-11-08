// Settings › Resources › Browsers' memory budget: one step of unloading hidden Browsers pages. Pure but for what it's
// given: main measures and guards (App.tsx' timer, main's browser-mem and browser-guard), so nothing here trusts a page.
export const BUDGET_DEFAULT = 2048 // MB, when it's turned on
const KEEP = 2 // the pages last used stay, whichever they are

export type Unload = { kb: number; over: boolean; unload?: string; held: { ws: string; why: string }[] }

// ws: each loaded page's guest, used: when each was last shown (none: oldest). Over budget, the oldest hidden page no
// guard holds is the one to unload, one a step: the next step measures again. current is asked last, after every await:
// you may have moved to it meanwhile
export async function unloadStep(o: { budgetMb: number; guests: Map<string, number>; used: Map<string, number>; current: () => string | null | undefined; mem: (ids: number[]) => Promise<{ kb: number } | null>; guard: (id: number) => Promise<string | undefined> }): Promise<Unload> {
  const m = await o.mem([...o.guests.values()])
  const kb = m?.kb ?? 0
  if (!m || !(o.budgetMb > 0) || kb <= o.budgetMb * 1024) return { kb, over: false, held: [] } // settingsSet keeps any value: not a number is off
  const when = (ws: string) => o.used.get(ws) ?? 0
  const newest = [...o.guests.keys()].sort((a, b) => when(b) - when(a))
  const kept = new Set(newest.slice(0, KEEP))
  const held: Unload['held'] = []
  for (const ws of newest.reverse()) {
    if (ws === o.current() || kept.has(ws) || !o.guests.has(ws)) continue // has: closed during an earlier page's check
    const why = await o.guard(o.guests.get(ws)!).catch(() => 'can’t tell what it’s doing')
    if (why) held.push({ ws, why })
    else if (ws !== o.current() && o.guests.has(ws)) return { kb, over: true, unload: ws, held }
  }
  return { kb, over: true, held }
}
