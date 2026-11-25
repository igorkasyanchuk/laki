// Term.tsx' links over a wrapped line: a path the terminal broke over two or more rows is one link on each of them, not
// only its last row's piece. The rows of the line row y is in (isWrapped: a row that goes on from the one above), as one
// string, and where a match in it sits on the screen (xterm's range: 1-based x and y, end inclusive).
// ponytail: one character a cell (a wide CJK one is two cells: the links after it are off by one, as a single row's were);
// at most WRAP_ROWS rows each way (a minified file's one line, thousands of rows, isn't read on every hover)
// Pure: test/layout.test.ts
export const WRAP_ROWS = 20
type Row = { isWrapped: boolean; translateToString: (trimRight?: boolean) => string } | undefined
// y: the row's 0-based index in the buffer; the line's first row's index and its text
export function wrappedLine(row: (i: number) => Row, y: number): { top: number; text: string } {
  let top = y
  while (top > 0 && y - top < WRAP_ROWS && row(top)?.isWrapped) top--
  let end = y
  while (end - y < WRAP_ROWS && row(end + 1)?.isWrapped) end++
  let text = ''
  for (let i = top; i <= end; i++) text += row(i)?.translateToString(i === end) ?? '' // a row the next goes on from: all its cells, its spaces kept
  return { top, text }
}
// a match at index i, n long, in the line that starts on 0-based row top, cols wide
export function cellRange(i: number, n: number, cols: number, top: number) {
  const last = i + n - 1
  return { start: { x: (i % cols) + 1, y: top + 1 + Math.floor(i / cols) }, end: { x: (last % cols) + 1, y: top + 1 + Math.floor(last / cols) } }
}
