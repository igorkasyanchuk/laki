import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const a = 'a'.repeat(64)
const b = 'b'.repeat(64)
const cask = (sums: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'laki-cask-')), 'SHA256SUMS.txt')
  writeFileSync(f, sums)
  return spawnSync('bash', ['scripts/release.sh', 'cask', 'v1.2.3', f], { cwd: root, encoding: 'utf8' })
}

test("the Homebrew tap's cask: both Macs, Apple silicon only, none without an arm64 dmg", () => {
  const both = cask(`${a}  Laki-1.2.3-arm64.dmg\n${b}  Laki-1.2.3-x64.dmg\n${b}  Laki-1.2.3-arm64.zip\n`)
  assert.equal(both.status, 0, both.stderr)
  assert.match(both.stdout, /^cask "laki" do\n {2}arch arm: "arm64", intel: "x64"\n\n {2}version "1\.2\.3"\n/)
  assert.ok(both.stdout.includes(`sha256 arm:   "${a}",\n         intel: "${b}"\n`))
  assert.ok(both.stdout.includes('/laki-releases/releases/download/v#{version}/Laki-#{version}-#{arch}.dmg"'))
  assert.doesNotMatch(both.stdout, /depends_on arch/)

  const arm = cask(`${a}  Laki-1.2.3-arm64.dmg\n`)
  assert.equal(arm.status, 0, arm.stderr)
  assert.ok(arm.stdout.includes(`  sha256 "${a}"\n`))
  assert.ok(arm.stdout.includes('Laki-#{version}-arm64.dmg"'))
  assert.ok(arm.stdout.includes('  depends_on arch: :arm64\n  depends_on :macos\n'))

  assert.equal(cask(`${b}  Laki-1.2.3-x64.dmg\n`).status, 1)
})
