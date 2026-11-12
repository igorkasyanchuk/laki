// V15: macOS 26's app icon (electron-builder's afterPack, before signing): build/Laki.icon, Icon Composer's document
// (layers from build/icon/*.svg: the fill, the caret, the sun; a dark fill; the sun a little fainter tinted), compiled
// by Xcode 26's actool into Contents/Resources/Assets.car, Info.plist's CFBundleIconName pointing at it. macOS 26 draws
// that (light, dark, tinted, clear); macOS 15 and earlier keep CFBundleIconFile, build/icon.icns (scripts/icon.swift).
// Not mac.icon = the .icon: electron-builder then makes the .icns from it too and fails without Xcode 26. No Xcode 26
// (or not a Mac build): the .icns alone, said in one line. A custom Dock icon (Settings, dock.ts) still overrides both
const { execFileSync } = require('node:child_process')
const { copyFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
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
