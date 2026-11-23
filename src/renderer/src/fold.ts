// Fold long projects (the sidebar's shownRows): a project's rows in order, its first cap workspaces in sight and any
// that matters (the open one, working, waiting on you), each in its place, so none moves as one starts or stops
// working; a group head whose rows all fold away goes with them (one empty already stays). more: how many folded.
// Pure: test/layout.test.ts
export function foldRows<R>(rows: R[], isWs: (r: R) => boolean, cap: number, matters: (r: R) => boolean): { rows: R[]; more: number } {
  if (!(cap > 0)) return { rows, more: 0 }
  let n = 0
  let more = 0
  const cut = rows.filter(x => !isWs(x) || n++ < cap || matters(x) || (more++, false))
  if (!more) return { rows, more }
  const under = (list: R[], i: number) => {
    let k = 0
    for (let j = i + 1; j < list.length && isWs(list[j]); j++) k++
    return k
  }
  return { rows: cut.filter((x, i) => isWs(x) || under(cut, i) > 0 || under(rows, rows.indexOf(x)) === 0), more }
}
