// The first step off the app's own binary for what runs as node (AGENTS.md "Fuses", docs/dev/helper.md): the hook
// (`laki hook`, a start per tool call) runs on Laki Hook, a copy of Electron's helper inside the bundle with a bundle id
// of its own and no privacy usage strings (scripts/after-pack.cjs), so what it runs doesn't inherit Laki's grants by
// its binary. Pure: core.ts asks with existsSync; a bundle without it (an older build, Linux, node from source) keeps
// the binary that runs the daemon
export const HOOK_APP = 'Laki Hook'
// its executable: Electron takes itself for a helper (the framework four folders up) only by a name ending in " Helper";
// any other name looks for the framework beside it and traps as ICU starts
export const HOOK_EXE = `${HOOK_APP} Helper`
export function hookRunner(execPath: string, has: (path: string) => boolean): string {
  const app = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1]
  const helper = app && `${app}/Contents/Frameworks/${HOOK_APP}.app/Contents/MacOS/${HOOK_EXE}`
  return helper && has(helper) ? helper : execPath
}
