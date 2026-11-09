// The daemon's periodic loops, in one place (H4: one scheduler). register(name, ms, fn, { idle }) runs fn every ms; a
// throw or a rejection is logged under its name and never stops it. idle (H4.5): what it does while nobody looks
// (main.ts' setIdle: no client connected, or no window shown and no agent running): 'pause' skips it, 'slow' runs every
// SLOW-th tick, 'keep' (a deadline, or cheap and rare) runs as ever. Back at full speed on the next tick once someone looks.
// No core import: out of core's import cycle (test/load-order.test.ts).
//
// The loops (main.ts unless said; period; idle; what it does):
//   shellTick      2 s    pause  what each shell tab runs in front (ps)
//   sweepRunning   2 s    slow   tabs stuck as running with no output
//   testParent     2 s    keep   a test's daemon goes with its test process (the rig only)
//   scanPorts      5 s    slow   listening ports by workspace (lsof), branches followed (syncBranches)
//   flowTick       5 s    keep   workflow runs' waits (workflow.ts)
//   phoneTick      5 s    keep   phone taps, only while an ask waits for one (phone.ts)
//   scanStats      10 s   slow   each workspace's diff size (git)
//   factsTick      10 s   pause  extensions' workspace facts
//   meterTick      10 s   slow   agents' transcripts: context and usage (meters.ts)
//   scanOverlaps   15 s   slow   Collision radar (git diff -U0)
//   remoteTick     15 s   keep   remote access's end
//   shareTick      15 s   keep   shared tabs' ends
//   tunnelTick     15 s   keep   tunnels' ends
//   hookTick       30 s   slow   agents' hooks not heard
//   ticketTick     30 s   slow   linked tickets' scripts, each when due
//   watchLimits    30 s   keep   plan limits' resets
//   scheduleTick   30 s   keep   scheduled tasks due
//   pendingTick    30 s   keep   workspaces' later starts due
//   reminderTick   30 s   keep   reminders due
//   diskTick       30 s   keep   the state saved again after a full disk (core.ts save), only while it's full
//   widgetTick     30 s   slow   extensions' fetches, each when due
//   issueTick      60 s   slow   issue.labeled: GitHub's issue events, while something listens (inbound.ts)
//   prTick         60 s   slow   PR scans (gh), each workspace every settings.prScan minutes
//   sleepTick      60 s   slow   idle tabs put to sleep
//   longTurnTick   60 s   keep   turns running too long say so (turns.ts, settings.longTurn)
//   mcpAppSweep    60 s   keep   idle MCP App connections closed (mcpApps.ts)
//   refusedWs      60 s   keep   refused WebSockets counted, only while there are some
//   policyTick     5 min  keep   the managed policy read again
//   aiTick         10 min keep   Laki AI's unused spec chats ended
//   memoryTick     30 min keep   memory's compaction, when due
//   archiveIdleTick 30 min keep  worktrees nobody touched archived (pr.ts, settings.archiveIdle)
//   ghHour         1 h    keep   Laki's own gh calls in its log
//   logTick        1 h    keep   daemon.log past 10 MB moved to daemon.log.1 (conn.ts rotateLog)
//   tidy           1 h    keep   old pasted images, storage files, archived workspaces, trash
// Not here: one-shot waits (core.ts whenPrompt, workflow.ts esc), each a few seconds.
export type Idle = 'pause' | 'slow' | 'keep'
type Loop = { name: string; ms: number; idle: Idle; timer: NodeJS.Timeout; n: number }
export const loops: Loop[] = []
export const SLOW = 5
let idleNow = () => false
export const setIdle = (f: () => boolean) => void (idleNow = f)
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

// unref: it doesn't keep the process alive (a module's own sweep). Returns its stop
export function register(name: string, ms: number, fn: () => unknown, o: { idle?: Idle; unref?: boolean } = {}) {
  const run = () => {
    if (l.idle !== 'keep' && idleNow()) {
      if (l.idle === 'pause' || l.n++ % SLOW) return
    } else l.n = 0
    try {
      Promise.resolve(fn()).catch(e => log(name, e))
    } catch (e) {
      log(name, e)
    }
  }
  const l: Loop = { name, ms, idle: o.idle ?? 'keep', timer: setInterval(run, ms), n: 0 }
  if (o.unref) l.timer.unref()
  loops.push(l)
  return () => {
    clearInterval(l.timer)
    const i = loops.indexOf(l)
    if (i >= 0) loops.splice(i, 1)
  }
}

export const stopAll = () => {
  for (const l of loops.splice(0)) clearInterval(l.timer)
}
