// V7b: a status mark's one-shot effect as its state changes while it's drawn (Glyph.tsx useFx, its data-fx for FX_MS):
// done (finished, ended fine), ask (needs you), err (ended with an error). None as it's first drawn (a row added, or
// remounted in another group), for the same state again, or from one end to another. Pure: test/glyph-fx.test.ts
export type Fx = 'done' | 'ask' | 'err'
export const FX_MS = 400
const ENDS = new Set(['done', 'ok', 'finished'])
export function fxOf(prev: string | undefined, next: string, mounted: boolean): Fx | undefined {
  if (!mounted || prev === undefined || prev === next || (ENDS.has(prev) && ENDS.has(next))) return undefined
  return ENDS.has(next) ? 'done' : next === 'waiting' ? 'ask' : next === 'exited' ? 'err' : undefined
}
