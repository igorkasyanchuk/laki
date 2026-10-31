// Collision radar: where two diffs against the same base change the same lines, before git says "conflict" at merge.
// Lines are the base's (a -U0 diff's old side); a new file is [0, 0], the whole of it.

export type Span = [number, number]
export type Ranges = Record<string, Span[]>
// one file two diffs both change: mine and theirs, each the span of its hunks that meet the other's
export type Overlap = { file: string; mine: Span; theirs: Span }
// what a workspace's view carries: another live workspace's (ws) or what landed on its base since it branched (base)
export type Collision = Overlap & { ws?: string; base?: string }

// lockfiles and their kin: regenerated, not merged by hand
export const RADAR_SKIP = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|go\.sum|Podfile\.lock|Package\.resolved|flake\.lock)$/

// a `git diff -U0 --no-color --no-prefix` text: each file (its old path; a new one's new path) and its hunks' base lines.
// A change of b lines from a is [a, a+b-1]; an insertion after line a (b 0) is [a, a]: it touches a and a+1
export function rangesOf(diff: string): Ranges {
  const out: Ranges = {}
  let file = ''
  let fresh = false
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) (file = ''), (fresh = false)
    else if (l.startsWith('new file mode')) fresh = true
    else if (l.startsWith('--- ')) file = l === '--- /dev/null' ? '' : l.slice(4)
    else if (l.startsWith('+++ ') && !file) file = l.slice(4)
    else if (l.startsWith('@@ ') && file && !RADAR_SKIP.test(file)) {
      const m = /^@@ -(\d+)(?:,(\d+))? /.exec(l)
      if (!m) continue
      const a = Number(m[1])
      const b = m[2] === undefined ? 1 : Number(m[2])
      ;(out[file] ??= []).push(fresh ? [0, 0] : b ? [a, a + b - 1] : [Math.max(a, 1), Math.max(a, 1)]) // -0,0: before the first line
    }
  }
  return out
}

const whole = (s: Span) => s[0] === 0 && s[1] === 0
// changes that touch or sit side by side conflict, as git's merge says
const meet = (x: Span, y: Span) => whole(x) || whole(y) || (x[0] <= y[1] + 1 && y[0] <= x[1] + 1)
const span = (xs: Span[]): Span => (xs.some(whole) ? [0, 0] : [Math.min(...xs.map(x => x[0])), Math.max(...xs.map(x => x[1]))])

export function overlaps(mine: Ranges, theirs: Ranges): Overlap[] {
  const out: Overlap[] = []
  for (const [file, xs] of Object.entries(mine)) {
    const ys = theirs[file]
    if (!ys) continue
    const a = xs.filter(x => ys.some(y => meet(x, y)))
    if (a.length) out.push({ file, mine: span(a), theirs: span(ys.filter(y => a.some(x => meet(x, y)))) })
  }
  return out
}

// "lines 40–62", "line 7", "a new file"
export const spanText = (s: Span) => (whole(s) ? 'a new file' : s[0] === s[1] ? `line ${s[0]}` : `lines ${s[0]}–${s[1]}`)
