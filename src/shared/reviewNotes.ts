// The Review tab's comments (R10, FullReview.tsx; kept by the daemon: core.ts reviewNotesSet) and what happens to them
// once sent to an agent: stamped sent (its tab, when), then, as that tab's next turn ends (turns.ts), changed here or
// not changed by whether the turn's diff touches the comment's lines (noteStates). Pure: test/review-notes.test.ts
export type NoteState = 'sent' | 'changed' | 'unchanged'
export type ReviewNote = {
  id: string
  path: string
  line: number
  startLine?: number
  side: 'LEFT' | 'RIGHT'
  body: string
  quote: string // the line as it was
  sentAt?: number // sent to an agent: when, to which tab, and what its next turn did (none: not sent, as before)
  tab?: string
  state?: NoteState
  turn?: number // the kept turn (turns.ts' n) that changed it
  hunk?: [number, number] // the turn's lines there, in the worktree's file as it left it (the review's new side)
  done?: boolean // Accept: under Done
}
// the lines around a comment a change still counts for
export const NOTE_CONTEXT = 3

type Hunk = { old: [number, number]; new: [number, number] } // [start, count]
// git's path as a diff prints it: a/ or b/ off, a C-quoted one ("a/caf\303\251.txt") read back as UTF-8
const pathOf = (s: string) => {
  let p = s.replace(/\t.*$/, '')
  if (p.startsWith('"') && p.endsWith('"')) {
    const bytes: number[] = []
    const q = p.slice(1, -1)
    const esc: Record<string, number> = { n: 10, t: 9, '"': 34, '\\': 92, a: 7, b: 8, f: 12, r: 13, v: 11 }
    for (let i = 0; i < q.length; i++) {
      if (q[i] !== '\\') {
        bytes.push(...new TextEncoder().encode(q[i]))
        continue
      }
      const o = /^[0-7]{3}/.exec(q.slice(i + 1))
      if (o) (bytes.push(parseInt(o[0], 8)), (i += 3))
      else bytes.push(esc[q[++i]] ?? q.charCodeAt(i))
    }
    p = new TextDecoder().decode(new Uint8Array(bytes))
  }
  return p === '/dev/null' ? undefined : p.replace(/^[ab]\//, '')
}
// a unified diff's hunks by file (its path after the change, or before when it's gone); gone: the file deleted
export function hunksOf(diff: string) {
  const files = new Map<string, { gone: boolean; hunks: Hunk[] }>()
  let cur: { gone: boolean; hunks: Hunk[] } | undefined
  let from: string | undefined
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) (cur = undefined), (from = undefined)
    else if (l.startsWith('--- ') && !cur) from = pathOf(l.slice(4))
    else if (l.startsWith('+++ ') && !cur) {
      const to = pathOf(l.slice(4))
      const path = to ?? from
      if (path) files.set(path, (cur = { gone: !to, hunks: [] }))
    } else if (l.startsWith('@@') && cur) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)
      if (m) cur.hunks.push({ old: [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])], new: [Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] })
    }
  }
  return files
}
// each sent comment against its turn's diff: a deleted file changes all of its comments; a line taken out (LEFT, not in
// the worktree any more) changes with any hunk of its file; else a hunk whose old lines meet the comment's, NOTE_CONTEXT
// lines around it, changes it. hunk: the first such hunk's new lines (for What changed)
export function noteStates(notes: Pick<ReviewNote, 'id' | 'path' | 'line' | 'startLine' | 'side'>[], diff: string) {
  const files = hunksOf(diff)
  const out = new Map<string, { state: 'changed' | 'unchanged'; hunk?: [number, number] }>()
  const span = (h: Hunk): [number, number] => [h.new[0], h.new[0] + Math.max(h.new[1], 1) - 1]
  for (const n of notes) {
    const f = files.get(n.path)
    if (f?.gone) {
      out.set(n.id, { state: 'changed' })
      continue
    }
    const lo = Math.min(n.startLine ?? n.line, n.line) - NOTE_CONTEXT
    const hi = Math.max(n.startLine ?? n.line, n.line) + NOTE_CONTEXT
    // a hunk's old lines; none (an insertion after line a): between a and a + 1
    const hit = f?.hunks.find(h => n.side === 'LEFT' || (h.old[1] ? h.old[0] <= hi && h.old[0] + h.old[1] - 1 >= lo : h.old[0] + 1 >= lo && h.old[0] <= hi))
    out.set(n.id, hit ? { state: 'changed', hunk: span(hit) } : { state: 'unchanged' })
  }
  return out
}
