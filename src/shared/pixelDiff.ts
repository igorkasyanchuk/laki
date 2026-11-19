// npm run test:sheet's comparison (main's uiSmoke, scripts/ui-sheet.ts): the share of pixels that changed between two
// pictures of one size, 0 to 1: a pixel whose red, green, blue or alpha moved by more than tol. Another size: all of
// it. Pure (raw 4-byte pixels in, either channel order): test/pixel-diff.test.ts
export function pixelDiff(a: Uint8Array, aw: number, ah: number, b: Uint8Array, bw: number, bh: number, tol = 8): number {
  if (aw !== bw || ah !== bh || a.length !== b.length || a.length !== aw * ah * 4) return 1
  if (!a.length) return 0
  let n = 0
  for (let i = 0; i < a.length; i += 4)
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol || Math.abs(a[i + 3] - b[i + 3]) > tol) n++
  return n / (aw * ah)
}
// what the sheet calls changed: more than a hair (a clock's minute, a caret)
export const CHANGED = 0.0005
