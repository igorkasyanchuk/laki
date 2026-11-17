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
  assert.ok(arm.stdout.includes('  depends_on arch: :arm64\n  depends_on macos: ">= :ventura"\n'))
  assert.match(arm.stdout, /auto_updates true/)
  assert.match(arm.stdout, /uninstall quit: "dev\.laki\.app"/)

  assert.equal(cask(`${b}  Laki-1.2.3-x64.dmg\n`).status, 1)
})

test('the dependency audit (scripts/audit.ts auditOf): a high production advisory fails, allowed passes, an expired allowance fails and is named, moderate ones warn', async () => {
  const { auditOf } = await import('../scripts/audit.ts')
  const adv = (name: string, severity: string, ghsa: string) => ({ name, severity, via: [{ source: 1, name, title: `${name} is bad`, url: `https://github.com/advisories/${ghsa}`, severity }], nodes: [`node_modules/${name}`], fixAvailable: { name, version: '9.9.9' } })
  const npm = { vulnerabilities: { ws: adv('ws', 'high', 'GHSA-aaaa-bbbb-cccc'), qs: adv('qs', 'moderate', 'GHSA-dddd-eeee-ffff'), dep: { name: 'dep', severity: 'high', via: ['ws'] } } }
  const now = Date.parse('2026-11-18')
  const plain = auditOf(npm, [], now)
  assert.deepEqual(plain.fail.map(f => [f.package, f.id, f.severity, f.fixed]), [['ws', 'GHSA-aaaa-bbbb-cccc', 'high', 'ws@9.9.9']], 'a via by name is its dependency’s, listed once')
  assert.deepEqual(plain.warn.map(f => f.package), ['qs'], 'moderate: a warning')
  const allowed = auditOf(npm, [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'ws', reason: 'not reachable', until: '2026-12-31' }], now)
  assert.deepEqual([allowed.fail, allowed.expired], [[], []])
  const old = { id: 'GHSA-aaaa-bbbb-cccc', package: 'ws', reason: 'not reachable', until: '2026-11-01' }
  const expired = auditOf(npm, [old], now)
  assert.deepEqual([expired.fail.map(f => f.package), expired.expired], [['ws'], [old]])
  assert.deepEqual(auditOf(npm, [{ ...old, package: 'qs', until: '2027-01-01' }], now).fail.length, 1, 'an allowance is for its package')
})
