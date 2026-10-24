# Third-party licenses

Laki is MIT (`LICENSE`). The app bundles open-source packages, each under its own license, unmodified. As of 0.27:

- **Electron** (MIT, https://github.com/electron/electron/blob/main/LICENSE) and the **Chromium** and Node.js it
  embeds (their notices: Electron's `LICENSES.chromium.html`, in each Electron release's zip).
- **MIT or ISC**: most of the rest (about 170 packages), among them React, xterm.js and its addons, node-pty, ws,
  Mantine, React Flow, mermaid, html-to-image.
- **MPL-2.0**: BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`), the Specs, Notes and To-dos
  editor. Its source: https://github.com/TypeCellOS/BlockNote. Laki uses it as published on npm, unchanged.
- **MPL-2.0 or Apache-2.0**: DOMPurify (through mermaid).
- **EPL-2.0**: elkjs (through mermaid's layouts), unchanged; its source: https://github.com/kieler/elkjs.
- **Apache-2.0**: Chevrotain (through mermaid).
- **BSD-3-Clause**: d3-array, d3-ease, d3-path, d3-shape, d3-sankey, rw (through mermaid).
- **0BSD**, **Unlicense**, **MIT or CC0-1.0**: tslib, robust-predicates, type-fest.
- **Fonts**: SIL Open Font License 1.1, and Hack's MIT and Bitstream Vera licenses: `src/renderer/src/fonts/NOTICE.md`,
  `OFL.txt`, `HACK-LICENSE.md`.

The app carries every bundled package's own license text, and the fonts': `THIRD_PARTY_NOTICES.txt`, which each build
writes (About Laki › *Open-source licenses*).
