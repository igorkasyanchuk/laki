import type { Ask } from './types.ts'

// a waiting agent's numbered menu at the bottom of its screen (claude's, codex's, gemini's permission prompts and
// questions): the last run of "1. …", "2. …" lines, one of them highlighted (❯ › > ● before its number; a menu always
// has one, a numbered list in an answer doesn't); box borders (│) aside
const OPTION = /^\s*([❯›>▶●→])?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/
export function askOf(text: string): Ask | undefined {
  let opts: Ask['options'] = []
  let at = 0
  let best: Ask | undefined
  for (const raw of text.split('\n')) {
    const m = raw.replace(/^[\s│|]+|[\s│|]+$/g, ' ').match(OPTION)
    if (!m) continue
    const n = Number(m[2])
    if (n === 1) (opts = []), (at = 0)
    else if (n !== opts.length + 1) continue // not the next one: some other numbered line
    opts.push({ n, label: m[3].slice(0, 80) })
    if (m[1]) at = n
    if (opts.length >= 2 && at) best = { options: [...opts], at }
  }
  return best
}
