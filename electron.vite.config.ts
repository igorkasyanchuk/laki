import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// the build's time, in the daemon and the renderer alike: a daemon from an older build (it outlives the app) gets the
// app's Restart Laki's daemon bar, the API number unchanged or not
const BUILT = JSON.stringify(new Date().toISOString())

// THIRD_PARTY_NOTICES.txt in out/renderer (About's *Open-source licenses*): every npm package in a bundle (electron-vite
// builds main, preload, then the renderer in one process, so the renderer's sees them all), the ones shipped in
// node_modules (the daemon's: npm ls --omit=dev) and Electron, each with its own license files (packages with the same
// text share it), then the fonts'. ponytail: Chromium's notices aren't in it (LICENSES.chromium.html, Electron's zip)
const used = new Set([resolve('node_modules/electron')])
const NM = '/node_modules/'
const notices = (last: boolean) => ({
  name: 'notices',
  apply: 'build' as const,
  generateBundle(this: { getModuleIds(): Iterable<string>; emitFile(f: { type: 'asset'; fileName: string; source: string }): void }) {
    for (const id of this.getModuleIds()) {
      const path = id.replace(/^\0/, '').split('?')[0]
      const i = path.lastIndexOf(NM)
      if (i < 0) continue
      const parts = path.slice(i + NM.length).split('/')
      used.add(path.slice(0, i + NM.length) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/'))
    }
    if (!last) return
    let shipped: string
    try {
      shipped = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8' })
    } catch (e) {
      shipped = (e as { stdout?: string }).stdout ?? '' // npm ls exits 1 on an extraneous package (pack:x64's node-pty)
    }
    for (const dir of shipped.split('\n')) if (dir.includes(NM)) used.add(dir)
    const byText = new Map<string, string[]>()
    for (const dir of used) {
      let pkg: { name?: string; version?: string; license?: string | { type?: string } }
      try {
        pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
      } catch {
        continue
      }
      const license = (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type) ?? 'no license named'
      const files = readdirSync(dir).filter(f => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(f)).sort()
      const text = files.map(f => readFileSync(`${dir}/${f}`, 'utf8').trim()).join('\n\n') || `${license} (the package has no license file)`
      byText.set(text, [...(byText.get(text) ?? []), `${pkg.name}@${pkg.version} (${license})`])
    }
    const rule = `\n\n${'='.repeat(78)}\n`
    const groups = [...byText].map(([text, names]) => `${names.sort().join('\n')}\n\n${text}`).sort()
    const fonts = ['NOTICE.md', 'OFL.txt', 'HACK-LICENSE.md'].map(f => readFileSync(resolve('src/renderer/src/fonts', f), 'utf8').trim())
    const head = `Laki bundles the open-source packages and fonts below, each under its own license. Laki itself is MIT.\n${used.size} packages; each license text follows the packages it covers.`
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: [head, ...groups, ...fonts].join(rule) + '\n' })
  },
})

export default defineConfig({
  main: {
    // the Electron main process, the daemon (run as node), the CLI and agents' hook (hook.js), side by side in out/main
    define: { __BUILT__: BUILT },
    plugins: [notices(false)],
    build: {
      rolldownOptions: {
        input: { index: resolve('src/main/index.ts'), daemon: resolve('src/daemon/main.ts'), cli: resolve('src/cli/main.ts'), hook: resolve('src/cli/hook.ts') },
      },
    },
  },
  preload: {
    // sandboxed preloads must be CommonJS
    plugins: [notices(false)],
    build: { rolldownOptions: { input: { index: resolve('src/preload/index.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
      notices(true),
      {
        name: 'csp', // only in the build: the dev server injects inline scripts
        apply: 'build',
        transformIndexHtml: html =>
          html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self' ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com http://127.0.0.1:*; frame-src 'self' http://localhost:* http://127.0.0.1:* https://www.youtube-nocookie.com" />`),
      },
    ],
    define: { __BUILT__: BUILT }, // About's build time (the dev server's: its start), and the stale daemon's check
    server: { port: 5199, strictPort: true, host: '127.0.0.1' },
    build: { rolldownOptions: { input: { index: resolve('src/renderer/index.html'), annotate: resolve('src/renderer/annotate.html'), floater: resolve('src/renderer/floater.html') } } }, // annotate: the menu bar screenshot's editor window; floater: the floating bubbles
  },
})
