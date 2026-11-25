// #P1: remote access's page pinned (docs/dev/remote.md, SECURITY.md). The daemon hashes the page's files (SHA-256,
// base64, by the path the page asks for: / for index.html) and gives the list to a paired device inside its sealed
// socket only (main.ts pinsNow, at a stable address: a quick tunnel's page has no service worker). The page hands it
// to its service worker (main.ts swJs), which from then on answers those paths from its own cache, and a file it
// hasn't cached yet only once the network's copy matches. A new list (an update): the files it had, and /, fetched again
// (unchanged ones from its cache) and hashed with WebCrypto; swapped in only if every one matches, else the old cache
// stays and the page is told (a blocking warning, reported to the Mac). pinDecide is that choice: pure, and put into
// the worker as it is (its source), so it uses nothing from outside itself
export type Pins = { v: string; files: Record<string, string> } // v: the list's own hash
// bad: came and differ (reported); missing: didn't come (a network blip, a sign-in's redirect: kept, not reported)
export function pinDecide(want: Record<string, string>, got: Record<string, string | undefined>): { swap: boolean; bad: string[]; missing: string[] } {
  const bad = Object.keys(want).filter(p => got[p] !== undefined && got[p] !== want[p])
  const missing = Object.keys(want).filter(p => got[p] === undefined)
  return { swap: bad.length === 0 && missing.length === 0, bad, missing }
}
