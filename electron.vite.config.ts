import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // the Electron main process, the daemon (run as node) and the CLI, side by side in out/main
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), daemon: resolve('src/daemon/main.ts'), cli: resolve('src/cli/main.ts') },
      },
    },
  },
  preload: {
    // sandboxed preloads must be CommonJS
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
      {
        name: 'csp', // only in the build: the dev server injects inline scripts
        apply: 'build',
        transformIndexHtml: html =>
          html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src http://localhost:* http://127.0.0.1:*" />`),
      },
    ],
    server: { port: 5199, strictPort: true, host: '127.0.0.1' },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
