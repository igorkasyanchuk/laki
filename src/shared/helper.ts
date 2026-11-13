// Off the app's own binary for what runs as node (AGENTS.md "Fuses", docs/dev/helper.md): hooks, the CLI, `laki mcp`,
// the daemon and what it starts (the pty host, extensions' scripts) run on Laki Hook, a copy of Electron's helper inside
// the bundle with a bundle id of its own and no privacy usage strings (scripts/after-pack.cjs), so what it runs doesn't
// inherit Laki's grants by its binary. Pure: callers ask with existsSync; a bundle without it (an older build, Linux,
// node from source) keeps the binary it runs on
export const HOOK_APP = 'Laki Hook'
// its executable: Electron takes itself for a helper (the framework four folders up) only by a name ending in " Helper";
// any other name looks for the framework beside it and traps as ICU starts
export const HOOK_EXE = `${HOOK_APP} Helper`
// the outermost app bundle a binary is in (the app's own, or the helper's inside it), if any
export const appOf = (execPath: string) => /^(.*?\.app)\/Contents\//.exec(execPath)?.[1]
// the binary to run node on: the bundle's helper when it's there (from the app's binary or the helper's own), else the
// binary given
export function helperBin(execPath: string, has: (path: string) => boolean): string {
  const app = appOf(execPath)
  const helper = app && `${app}/Contents/Frameworks/${HOOK_APP}.app/Contents/MacOS/${HOOK_EXE}`
  return helper && (execPath === helper || has(helper)) ? helper : execPath
}
// S1 (core.ts appPeer): is this binary (a real path) the app's own, whose window may have the app's token? In a bundle:
// the outer app's main executable (its Contents/MacOS), whether the daemon runs on that or on the helper inside; else
// the daemon's own binary
export function appBinOk(peer: string, execPath: string): boolean {
  const app = appOf(execPath)
  if (!app) return peer === execPath
  const at = `${app}/Contents/MacOS/`
  return peer.startsWith(at) && !peer.slice(at.length).includes('/')
}
