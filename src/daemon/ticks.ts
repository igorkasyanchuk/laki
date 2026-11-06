// The daemon's periodic loops, in one place (H4: one scheduler). register(name, ms, fn, { idle }) runs fn every ms; a
// throw or a rejection is logged under its name and never stops it. idle: what it does while nobody looks (H4.5).
// No core import: out of core's import cycle (test/load-order.test.ts).
//
// The loops (main.ts unless said; period; what it does):
//   shellTick      2 s    what each shell tab runs in front (ps)
//   sweepRunning   2 s    tabs stuck as running with no output
//   testParent     2 s    a test's daemon goes with its test process (the rig only)
//   scanPorts      5 s    listening ports by workspace (lsof), branches followed (syncBranches)
//   flowTick       5 s    workflow runs' waits (workflow.ts)
//   phoneTick      5 s    phone taps, only while an ask waits for one (phone.ts)
//   scanStats      10 s   each workspace's diff size (git)
//   factsTick      10 s   extensions' workspace facts
//   meterTick      10 s   agents' transcripts: context and usage (meters.ts)
//   scanOverlaps   15 s   Collision radar (git diff -U0)
//   remoteTick     15 s   remote access's end
//   shareTick      15 s   shared tabs' ends
//   tunnelTick     15 s   tunnels' ends
//   hookTick       30 s   agents' hooks not heard
//   ticketTick     30 s   linked tickets' scripts, each when due
//   watchLimits    30 s   plan limits' resets
//   scheduleTick   30 s   scheduled tasks due
//   pendingTick    30 s   workspaces' later starts due
//   reminderTick   30 s   reminders due
//   widgetTick     30 s   extensions' fetches, each when due
//   prTick         60 s   PR scans (gh), each workspace every settings.prScan minutes
//   sleepTick      60 s   idle tabs put to sleep
//   mcpAppSweep    60 s   idle MCP App connections closed (mcpApps.ts)
//   refusedWs      60 s   refused WebSockets counted, only while there are some
//   policyTick     5 min  the managed policy read again
//   aiTick         10 min Laki AI's unused spec chats ended
//   memoryTick     30 min memory's compaction, when due
//   ghHour         1 h    Laki's own gh calls in its log
//   tidy           1 h    old pasted images, storage files, archived workspaces, trash
// Not here: one-shot waits (core.ts whenPrompt, workflow.ts esc), each a few seconds.
export type Idle = 'pause' | 'slow' | 'keep'
type Loop = { name: string; ms: number; idle: Idle; timer: NodeJS.Timeout }
export const loops: Loop[] = []
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

// unref: it doesn't keep the process alive (a module's own sweep). Returns its stop
export function register(name: string, ms: number, fn: () => unknown, o: { idle?: Idle; unref?: boolean } = {}) {
  const run = () => {
    try {
      Promise.resolve(fn()).catch(e => log(name, e))
    } catch (e) {
      log(name, e)
    }
  }
  const l: Loop = { name, ms, idle: o.idle ?? 'keep', timer: setInterval(run, ms) }
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
