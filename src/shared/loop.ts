// An agent that keeps failing the same command (core.ts' turn feeds it each finished tool call of a turn; the view's
// tab.loop): the same command, normalized (loopCmd), failing with the same first 200 characters of error 3 times in a
// row or 5 times in one turn is looping. A success of that command forgets its failures; a turn's end, all of them
// (loopNew). Pure: no clock, no I/O
export type ToolEnd = { tool: string; command: string; ok: boolean; error?: string }
export type LoopSeen = { last?: string; streak: number; seen: Record<string, number> } // last: the previous call's key (a failure's), streak: its run in a row, seen: failures this turn by key
export const LOOP_ROW = 3
export const LOOP_TURN = 5
export const loopNew = (): LoopSeen => ({ streak: 0, seen: {} })

// whitespace collapsed, a leading `cd … &&` dropped, the numbers in temp paths masked (mktemp's, a test's own folder)
const TEMP = /(?:\/private)?\/(?:tmp|var\/folders)\/\S*/g
const masked = (s: string) => s.replace(TEMP, p => p.replace(/\d+/g, '#'))
export const loopCmd = (cmd: string) => masked(cmd.replace(/\s+/g, ' ').trim().replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*&&\s*/, ''))
const errOf = (e = '') => masked(e.replace(/\s+/g, ' ').trim()).slice(0, 200)
const keyOf = (e: ToolEnd) => `${e.tool}\0${loopCmd(e.command)}\0${errOf(e.error)}`

// one call's end: how many times it failed so this turn, once that's a loop (a run in a row is never more than that)
export function loopFeed(s: LoopSeen, e: ToolEnd): { cmd: string; n: number } | undefined {
  const cmd = loopCmd(e.command)
  if (e.ok) {
    const own = `${e.tool}\0${cmd}\0`
    for (const k of Object.keys(s.seen)) if (k.startsWith(own)) delete s.seen[k]
    s.last = undefined
    s.streak = 0
    return
  }
  const k = keyOf(e)
  s.streak = s.last === k ? s.streak + 1 : 1
  s.last = k
  const n = (s.seen[k] = (s.seen[k] ?? 0) + 1)
  return s.streak >= LOOP_ROW || n >= LOOP_TURN ? { cmd, n } : undefined
}
