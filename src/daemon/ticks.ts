// The daemon's periodic loops, in one place (H4: one scheduler). register(name, ms, fn, { idle }) runs fn every ms; a
// throw or a rejection is logged under its name and never stops it. idle: what it does while nobody looks (H4.5).
// No core import: out of core's import cycle (test/load-order.test.ts).
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
