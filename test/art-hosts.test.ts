// S18: the artifacts viewer's CSP and what a page loads from where (shared/artHosts.ts). No daemon: test:fast
// (api.test.ts serves a page with it)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artBlocked, artCsp, artHostOk, artLoads, artSay } from '../src/shared/artHosts.ts'

test('artLoads: each https host a page names, by what it loads; artBlocked: what the CSP keeps out', () => {
  const html = `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script><SCRIPT src='https://evil.example/a.js'></SCRIPT>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel=icon href=https://cdn.jsdelivr.net/i.png>
<img src="data:image/png;base64,AA"><img src="pic.png"><img srcset="https://i.imgur.com/a.png 1x, https://i.imgur.com/b.png 2x">
<video src="https://media.example/v.mp4" poster="https://i.imgur.com/p.jpg"></video><img src="http://plain.example/x.png">
<style>@import url("https://css.example/x.css"); h1 { background: url(https://bg.example/b.jpg) } @font-face { src: url('https://fonts.gstatic.com/x.woff2') }</style>`
  assert.deepEqual(Object.fromEntries(artLoads(html)), {
    'cdn.jsdelivr.net': { script: 1, image: 1 },
    'evil.example': { script: 1 },
    'fonts.googleapis.com': { style: 1 },
    'i.imgur.com': { image: 3 },
    'media.example': { media: 1 },
    'css.example': { style: 1 },
    'bg.example': { image: 1 },
    'fonts.gstatic.com': { font: 1 },
  }, 'its own files, data: and plain http (blocked by https: sources anyway) aren\'t hosts')
  const b = artBlocked(html, ['fonts.googleapis.com', 'Fonts.Gstatic.com'])
  assert.deepEqual(b.map(x => x.host), ['cdn.jsdelivr.net', 'evil.example', 'i.imgur.com', 'media.example', 'bg.example', 'css.example'])
  assert.deepEqual(b[0].loads, { image: 1 }, "a CDN's script goes, its picture doesn't")
  assert.equal(artSay(b.slice(1, 3)), 'evil.example (1 script) · i.imgur.com (3 images)')
})

test('artHostOk: a name on the internet with a dot; no IP, localhost, .local, wildcard or CSP words', () => {
  for (const h of ['i.imgur.com', 'cdn.example.co.uk', 'x-y.example:8443']) assert.equal(artHostOk(h), true, h)
  for (const h of ['localhost', 'a.localhost', 'nas.local', '127.0.0.1', '10.0.0.1', '[::1]', '*.example.com', 'example', 'a.example; script-src *', 'https://a.example', 'a.example/x', '', 7]) assert.equal(artHostOk(h), false, String(h))
})

test("artCsp: three CDNs for scripts, styles and fonts; pictures and media from its own folder; allowed hosts added to each", () => {
  const csp = artCsp([])
  assert.equal(csp, "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; img-src 'self' data: blob:; font-src 'self' data: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; media-src 'self' data: blob:")
  const two = artCsp(['i.imgur.com', 'bad host; x'])
  assert.match(two, /img-src 'self' data: blob: https:\/\/i\.imgur\.com;/)
  assert.match(two, /script-src [^;]*https:\/\/unpkg\.com https:\/\/i\.imgur\.com;/)
  assert.doesNotMatch(two, /bad host/, 'a host that is not one: left out')
})
