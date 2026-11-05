// the daemon's data folder (~/.laki, LAKI_HOME): a module of its own, out of core.ts' import cycle, so the modules in
// it (accounts, notes, plans…) can read it as they load whichever of them is imported first. Each imports it from here.
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { dataDir } from '../shared/conn.ts'

export const dir = dataDir()

// a path with its links resolved (the folder as it is on disk); one not there yet, as it is
export const realOf = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
// the test rig's daemon: its LAKI_TEST_PARENT and a data folder under /tmp (the rig's /tmp/laki-…), on plain node (the
// rig's; the app's daemon runs on Electron's, which never is one). Never an env var alone: one could reach a real ~/.laki
// (nor TMPDIR: an env var too). What only tests may do asks it: the RPC's `now` (main.ts' TEST_CLOCK) and LAKI_POLICY
// (policy.ts). After the folder is made: realpath needs it there
export const inRig = () => {
  const tmp = realOf('/tmp')
  const d = realOf(dir)
  return !!process.env.LAKI_TEST_PARENT && !process.versions.electron && d !== tmp && d.startsWith(tmp + sep)
}
