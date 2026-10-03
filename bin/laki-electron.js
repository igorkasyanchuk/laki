#!/usr/bin/env node
// the built CLI (npm run build); falls back to the TypeScript source with node's type stripping
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const built = new URL('../out/main/cli.js', import.meta.url)
if (existsSync(fileURLToPath(built))) await import(built.href)
else {
  const src = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', src, ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
