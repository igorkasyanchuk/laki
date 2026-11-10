// A9: Laki's version: the build's (electron.vite.config.ts' define, from package.json), else package.json's beside the
// source (run from src/: tests, bin/laki.js before a build). Never the app binary's: run bare, it opens the window
import { readFileSync } from 'node:fs'

declare const __VERSION__: string | undefined
export const VERSION: string =
  typeof __VERSION__ === 'string'
    ? __VERSION__
    : (() => {
        try {
          return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version)
        } catch {
          return 'unknown'
        }
      })()
