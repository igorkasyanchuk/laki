// V15: macOS 26's app icon (electron-builder's afterPack, before signing): build/Laki.icon, Icon Composer's document
// (layers from build/icon/*.svg: the fill, the caret, the sun; a dark fill; the sun a little fainter tinted), compiled
// by Xcode 26's actool into Contents/Resources/Assets.car, Info.plist's CFBundleIconName pointing at it. macOS 26 draws
// that (light, dark, tinted, clear); macOS 15 and earlier keep CFBundleIconFile, build/icon.icns (scripts/icon.swift).
// Not mac.icon = the .icon: electron-builder then makes the .icns from it too and fails without Xcode 26. No Xcode 26
// (or not a Mac build): the .icns alone, said in one line. A custom Dock icon (Settings, dock.ts) still overrides both
const { execFileSync } = require('node:child_process')
const { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// Laki Hook (docs/dev/helper.md): a copy of Electron's helper app as Contents/Frameworks/Laki Hook.app, its own bundle
// id (<appId>.hook), no privacy usage strings, no Dock icon: what `laki hook` runs on (src/shared/helper.ts), so a
// hook isn't Laki's binary with Laki's privacy grants. Before signing: electron-builder signs it with the rest
function hookHelper(ctx, app) {
  const fw = join(app, 'Contents/Frameworks')
  const from = join(fw, `${ctx.packager.appInfo.productFilename} Helper.app`)
  if (!existsSync(from)) return console.log('  • Laki Hook skipped: no helper app to copy')
  const to = join(fw, 'Laki Hook.app')
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  const macos = join(to, 'Contents/MacOS')
  renameSync(join(macos, readdirSync(macos)[0]), join(macos, 'Laki Hook'))
  const plist = join(to, 'Contents/Info.plist')
  const pb = (cmd, ok = false) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'ignore' })
    } catch (e) {
      if (!ok) throw e
    }
  }
  const set = (k, v, type = 'string') => (pb(`Delete :${k}`, true), pb(`Add :${k} ${type} ${v}`))
  set('CFBundleIdentifier', `${ctx.packager.appInfo.id}.hook`)
  set('CFBundleName', 'Laki Hook')
  set('CFBundleDisplayName', 'Laki Hook')
  set('CFBundleExecutable', 'Laki Hook')
  set('LSUIElement', 'true', 'bool')
  const keys = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print', plist], { encoding: 'utf8' }).match(/^\s{4}(NS\w+UsageDescription)\b/gm) ?? []
  for (const k of keys) pb(`Delete :${k.trim()}`, true)
  console.log('  • Laki Hook: Contents/Frameworks/Laki Hook.app')
}

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  hookHelper(ctx, join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`))
  let v = ''
  try {
    v = execFileSync('xcrun', ['actool', '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {}
  const major = Number(/short-bundle-version<\/key>\s*<string>(\d+)/.exec(v)?.[1] ?? 0)
  if (major < 26) return console.log('  • macOS 26 icon skipped: no Xcode 26 (actool) here, the .icns alone')
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  const tmp = mkdtempSync(join(tmpdir(), 'laki-icon-'))
  try {
    execFileSync('xcrun', ['actool', join(ctx.packager.projectDir, 'build/Laki.icon'), '--compile', tmp, '--platform', 'macosx', '--minimum-deployment-target', '13.0', '--app-icon', 'Laki', '--include-all-app-icons', '--output-partial-info-plist', join(tmp, 'info.plist'), '--output-format', 'human-readable-text', '--errors'], { stdio: ['ignore', 'ignore', 'inherit'] })
    copyFileSync(join(tmp, 'Assets.car'), join(app, 'Contents/Resources/Assets.car'))
    const plist = join(app, 'Contents/Info.plist')
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIconName Laki', plist], { stdio: 'ignore' })
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleIconName string Laki', plist])
    }
    console.log('  • macOS 26 icon: Assets.car from build/Laki.icon')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
