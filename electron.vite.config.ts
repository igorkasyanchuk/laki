import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// the build's time, in the daemon and the renderer alike: a daemon from an older build (it outlives the app) gets the
// app's Restart Laki's daemon bar, the API number unchanged or not
const BUILT = JSON.stringify(new Date().toISOString())

export default defineConfig({
  main: {
    // the Electron main process, the daemon (run as node), the CLI and agents' hook (hook.js), side by side in out/main
    define: { __BUILT__: BUILT },
    build: {
      rolldownOptions: {
        input: { index: resolve('src/main/index.ts'), daemon: resolve('src/daemon/main.ts'), cli: resolve('src/cli/main.ts'), hook: resolve('src/cli/hook.ts') },
      },
    },
  },
  preload: {
    // sandboxed preloads must be CommonJS
    build: { rolldownOptions: { input: { index: resolve('src/preload/index.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
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
