// V15: macOS 26's app icon (electron-builder's afterPack, before signing): build/Laki.icon, Icon Composer's document
// (layers from build/icon/*.svg: the fill, the caret, the sun; a dark fill; the sun a little fainter tinted), compiled
// by Xcode 26's actool into Contents/Resources/Assets.car, Info.plist's CFBundleIconName pointing at it. macOS 26 draws
// that (light, dark, tinted, clear); macOS 15 and earlier keep CFBundleIconFile, build/icon.icns (scripts/icon.swift).
// Not mac.icon = the .icon: electron-builder then makes the .icns from it too and fails without Xcode 26. No Xcode 26
// (or not a Mac build): the .icns alone, said in one line. A custom Dock icon (Settings, dock.ts) still overrides both
const { execFileSync } = require('node:child_process')
const { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// Laki Node (docs/dev/helper.md): what runs as node (the daemon, the CLI, hooks, laki mcp, the pty host, extensions'
// scripts: src/shared/helper.ts) runs on a binary of its own, as the app's binary has the runAsNode fuse off. macOS:
// Contents/Frameworks/Laki Node.app, the app's own stub (it finds its framework beside it: Contents/Frameworks) with a
// copy of Electron's framework, fuse on: only what node needs of it (the binary, ICU's data, V8's snapshot, the
// libraries it links), not Chromium's pages, locales or GPU libraries; its own bundle id (<appId>.node), no privacy usage
// strings, no Dock icon. Linux: <exe>-node beside the app's binary (its resources are beside it too). Before
// electron-builder's fuses and signing: it signs this with the rest; the copy's fuses are the app's but runAsNode
const NODE_APP = 'Laki Node'
async function nodeFuses(ctx, at) {
  const cfg = await ctx.packager.generateFuseConfig({ ...ctx.packager.config.electronFuses, runAsNode: true })
  await require('@electron/fuses').flipFuses(at, cfg)
}
async function nodeHelper(ctx, app) {
  const fw = join(app, 'Contents/Frameworks')
  const exe = ctx.packager.appInfo.productFilename
  const plistFrom = join(fw, `${exe} Helper.app/Contents/Info.plist`)
  const efw = join(fw, 'Electron Framework.framework')
  if (!existsSync(plistFrom) || !existsSync(efw)) return console.log(`  • ${NODE_APP} skipped: no helper app or framework to copy`)
  const to = join(fw, `${NODE_APP}.app`)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(join(to, 'Contents/MacOS'), { recursive: true })
  copyFileSync(join(app, 'Contents/MacOS', exe), join(to, 'Contents/MacOS', NODE_APP))
  const plist = join(to, 'Contents/Info.plist')
  copyFileSync(plistFrom, plist)
  const pb = (cmd, ok = false) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'ignore' })
    } catch (e) {
      if (!ok) throw e
    }
  }
  const set = (k, v, type = 'string') => (pb(`Delete :${k}`, true), pb(`Add :${k} ${type} ${v}`))
  set('CFBundleIdentifier', `${ctx.packager.appInfo.id}.node`)
  set('CFBundleName', NODE_APP)
  set('CFBundleDisplayName', NODE_APP)
  set('CFBundleExecutable', NODE_APP)
  set('LSUIElement', 'true', 'bool')
  const keys = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print', plist], { encoding: 'utf8' }).match(/^\s{4}(NS\w+UsageDescription)\b/gm) ?? []
  for (const k of keys) pb(`Delete :${k.trim()}`, true)
  const from = join(efw, 'Versions/A')
  const fwTo = join(to, 'Contents/Frameworks/Electron Framework.framework')
  const a = join(fwTo, 'Versions/A')
  for (const d of ['Resources', 'Libraries']) mkdirSync(join(a, d), { recursive: true })
  copyFileSync(join(from, 'Electron Framework'), join(a, 'Electron Framework'))
  for (const f of readdirSync(join(from, 'Resources'))) if (f === 'icudtl.dat' || f === 'Info.plist' || /^v8_context_snapshot.*\.bin$/.test(f)) copyFileSync(join(from, 'Resources', f), join(a, 'Resources', f))
  for (const f of readdirSync(join(from, 'Libraries'))) if (f.endsWith('.dylib') && !/swiftshader|EGL|GLES/i.test(f)) copyFileSync(join(from, 'Libraries', f), join(a, 'Libraries', f)) // libffmpeg: linked
  symlinkSync('A', join(fwTo, 'Versions/Current'))
  for (const l of ['Electron Framework', 'Resources', 'Libraries']) symlinkSync(`Versions/Current/${l}`, join(fwTo, l))
  for (const f of readdirSync(fw)) if (f.endsWith('.framework') && f !== 'Electron Framework.framework') cpSync(join(fw, f), join(to, 'Contents/Frameworks', f), { recursive: true, verbatimSymlinks: true }) // Squirrel's: the framework links them
  await nodeFuses(ctx, to)
  console.log(`  • ${NODE_APP}: Contents/Frameworks/${NODE_APP}.app`)
}
async function nodeHelperLinux(ctx) {
  const exe = join(ctx.appOutDir, ctx.packager.executableName)
  if (!existsSync(exe)) return console.log(`  • ${NODE_APP} skipped: no ${exe}`)
  copyFileSync(exe, `${exe}-node`)
  chmodSync(`${exe}-node`, 0o755)
  await nodeFuses(ctx, `${exe}-node`)
  console.log(`  • ${NODE_APP}: ${ctx.packager.executableName}-node`)
}

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName === 'linux') return nodeHelperLinux(ctx)
  if (ctx.electronPlatformName !== 'darwin') return
  await nodeHelper(ctx, join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`))
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
