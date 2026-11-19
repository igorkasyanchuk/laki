// V18: rows that change place glide there (FLIP). flipMoves: each row's top now against the last order's, by its id;
// the ones that moved, by how much (from where it was), none new; null when more than max moved (a re-sort: a jump reads
// better). Pure: test/layout.test.ts
export function flipMoves(was: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>, max = 40): [string, number][] | null {
  const moves: [string, number][] = []
  for (const [id, y] of now) {
    const y0 = was.get(id)
    if (y0 !== undefined && Math.abs(y0 - y) >= 1) moves.push([id, y0 - y])
  }
  return moves.length > max ? null : moves
}
