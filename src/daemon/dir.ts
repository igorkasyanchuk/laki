// the daemon's data folder (~/.laki, LAKI_HOME): a module of its own, out of core.ts' import cycle, so the modules in
// it (accounts, notes, plans…) can read it as they load whichever of them is imported first. core.ts re-exports it.
import { dataDir } from '../shared/conn.ts'

export const dir = dataDir()
