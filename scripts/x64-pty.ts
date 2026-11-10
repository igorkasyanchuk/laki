// npm run pack:x64 from an Apple silicon Mac: node-pty's Intel binary (@lydell/node-pty-darwin-x64), which npm skips
// here (another CPU's optional package). S12: the tarball package-lock.json pins, checked against its integrity, then
// unpacked into node_modules: never whatever the registry serves today
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const name = '@lydell/node-pty-darwin-x64'
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const at = lock.packages?.[`node_modules/${name}`] as { version: string; resolved: string; integrity: string } | undefined
if (!at?.resolved || !at.integrity?.startsWith('sha512-')) throw new Error(`${name} isn't pinned in package-lock.json`)
const r = await fetch(at.resolved)
if (!r.ok) throw new Error(`${at.resolved}: ${r.status}`)
const tgz = Buffer.from(await r.arrayBuffer())
const got = `sha512-${createHash('sha512').update(tgz).digest('base64')}`
if (got !== at.integrity) throw new Error(`${name} ${at.version}: integrity ${got}, package-lock.json says ${at.integrity}`)
const tmp = mkdtempSync(join(tmpdir(), 'laki-x64-'))
const to = join('node_modules', name)
try {
  writeFileSync(join(tmp, 'p.tgz'), tgz)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  execFileSync('tar', ['-xzf', join(tmp, 'p.tgz'), '-C', to, '--strip-components=1'])
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`${name} ${at.version}: checked, in ${to}`)
