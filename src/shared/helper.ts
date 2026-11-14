// Off the app's own binary for what runs as node (AGENTS.md "Fuses", docs/dev/helper.md): the app's binary has the
// runAsNode fuse off, so hooks, the CLI, `laki mcp`, the daemon and what it starts (the pty host, extensions' scripts)
// run on Laki Node, a binary of its own inside the bundle with its own copy of Electron's framework (fuse on), its own
// bundle id and no privacy usage strings (scripts/after-pack.cjs): what it runs doesn't inherit Laki's grants by its
// binary. Pure: callers ask with existsSync; a build without it (an older one, node from source) keeps the binary it
// runs on
export const NODE_APP = 'Laki Node'
// Linux: beside the app's binary, its name and this
export const NODE_SUFFIX = '-node'
// the outermost app bundle a binary is in (the app's own, or the helper's inside it), if any
export const appOf = (execPath: string) => /^(.*?\.app)\/Contents\//.exec(execPath)?.[1]
// the binary to run node on: the build's helper when it's there (from the app's binary or the helper's own), else the
// binary given. linux: the AppImage's (its binary isn't in a bundle)
export function helperBin(execPath: string, has: (path: string) => boolean, linux = process.platform === 'linux'): string {
  const app = appOf(execPath)
  const helper = app ? `${app}/Contents/Frameworks/${NODE_APP}.app/Contents/MacOS/${NODE_APP}` : linux && !execPath.endsWith(NODE_SUFFIX) ? execPath + NODE_SUFFIX : execPath
  return execPath === helper || has(helper) ? helper : execPath
}
// S1 (core.ts appPeer): is this binary (a real path) the app's own, whose window may have the app's token? In a bundle:
// the outer app's main executable (its Contents/MacOS), whether the daemon runs on that or on the helper inside; else
// the daemon's own binary, or the one its Linux helper sits beside
export function appBinOk(peer: string, execPath: string): boolean {
  const app = appOf(execPath)
  if (!app) return peer === (execPath.endsWith(NODE_SUFFIX) ? execPath.slice(0, -NODE_SUFFIX.length) : execPath)
  const at = `${app}/Contents/MacOS/`
  return peer.startsWith(at) && !peer.slice(at.length).includes('/')
}
