// The daemon lives for days with its starter's environment: what shared/env.ts STARTER_ENV names (a git hook's GIT_DIR,
// node --test's FORCE_COLOR, npm run's npm_*) is taken out of process.env here, once, before any other module of the
// daemon loads (main.ts imports this first), so its git, gh, extensions' runs and every tab start without them.
// laki doctor names them (names only, never values)
import { STARTER_ENV } from '../shared/env.ts'

export const STARTER_DROPPED = Object.keys(process.env).filter(k => STARTER_ENV.test(k)).sort()
for (const k of STARTER_DROPPED) delete process.env[k]
