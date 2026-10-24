import type { Ask } from './types.ts'

// a waiting agent's numbered menu at the bottom of its screen (claude's, codex's, gemini's permission prompts and
// questions): the last run of "1. …", "2. …" lines, one of them highlighted (❯ › > ● before its number; a menu always
// has one, a numbered list in an answer doesn't); box borders (│) aside
const OPTION = /^\s*([❯›>▶●→])?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/
const RULE = /^[\s─━═╌╍┄┅╭╮╰╯┌┐└┘├┤┬┴┼-]*$/ // a box's top or bottom: no words
export function askOf(text: string): Ask | undefined {
  const lines = text.split('\n').map(raw => raw.replace(/^[\s│|]+|[\s│|]+$/g, ' '))
  let opts: Ask['options'] = []
  let at = 0
  let first = 0 // the line of option 1
  let best: Ask | undefined
  lines.forEach((line, i) => {
    const m = line.match(OPTION)
    if (!m) return
    const n = Number(m[2])
    if (n === 1) (opts = []), (at = 0), (first = i)
    else if (n !== opts.length + 1) return // not the next one: some other numbered line
    opts.push({ n, label: m[3].slice(0, 80) })
    if (m[1]) at = n
    if (opts.length >= 2 && at) best = { options: [...opts], at, ...(q => q && { question: q })(questionAt(lines, first)) }
  })
  return best
}

// what it asks: the nearest line or two above the menu with words in them (blank ones just above skipped), the one just
// above alone when it's a question ("Do you want to proceed?"); 200 characters at most
function questionAt(lines: string[], i: number) {
  const got: string[] = []
  for (let j = i - 1; j >= 0 && got.length < 2; j--) {
    const l = lines[j].trim()
    if (!l || RULE.test(l)) {
      if (got.length) break
      continue
    }
    got.unshift(l)
    if (got.length === 1 && l.endsWith('?')) break
  }
  return got.join(' · ').replace(/\s+/g, ' ').slice(0, 200)
}
