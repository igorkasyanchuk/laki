// More of the daemon's services: plan limits (usage.ts) and memes (fun.ts) in this process against fake servers on
// 127.0.0.1 with a temp HOME and only the fakes' security on PATH; widgets' folders, pages, actions and working hours
// in a rig's daemon.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { meme } from '../src/daemon/fun.ts'
import { claudeWindows, codexWindows, usage } from '../src/daemon/usage.ts'
import { fresh, sleep, until } from './helpers.ts'

const fakes = fileURLToPath(new URL('./fakes', import.meta.url))

async function listen(t: TestContext, srv: Server) {
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => {
    srv.closeAllConnections()
    srv.close()
  })
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

// this process's env for one test, put back after it
function withEnv(t: TestContext, env: Record<string, string | undefined>) {
  const was = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  const set = (e: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(e)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
  set(env)
  t.after(() => set(was))
}

test('usage windows: Opus and Sonnet weeks, a scoped week named twice once, Codex windows without a length or a name', () => {
  assert.deepEqual(
    claudeWindows({
      seven_day_opus: { utilization: 70.4, resets_at: '2026-10-10T00:00:00Z' },
      seven_day_sonnet: { utilization: 0.4, resets_at: 'soon' },
      limits: [{ kind: 'weekly_scoped', percent: 99, scope: { model: { display_name: 'Opus' } } }],
      extra_usage: { is_enabled: false, used_credits: 100, monthly_limit: 500 },
    }),
    [
      { label: 'Weekly · Opus', used: 70, resets: Date.parse('2026-10-10T00:00:00Z'), note: undefined },
      { label: 'Weekly · Sonnet', used: 0, resets: undefined, note: undefined },
    ],
  )
  assert.deepEqual(
    codexWindows(
      {
        rate_limit: { primary_window: { used_percent: -3 }, secondary_window: { used_percent: 'x' } },
        additional_rate_limits: [
          null,
          { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 86400 }, secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 7 } } },
        ],
      },
      0,
    ),
    [
      { label: 'Limit', used: 0, resets: undefined },
      { label: '1-day · other', used: 10, resets: undefined },
      { label: 'Weekly · other', used: 20, resets: 7000 },
    ],
  )
})

test('usage: which sign-in, plans with no limits, an API key, and each way the server fails', async t => {
  const hits: { url: string; auth?: string; account?: string }[] = []
  let claudeSays: number | 'html' | 'none' = 'none'
  let codexSays: number | 'none' = 'none'
  const srv = createServer((q, r) => {
    hits.push({ url: q.url!, auth: q.headers.authorization, account: q.headers['chatgpt-account-id'] as string | undefined })
    const says = q.url === '/api/oauth/usage' ? claudeSays : codexSays
    if (says === 'html') return r.writeHead(200, { 'content-type': 'text/html' }).end('<html>sign in to the wifi</html>')
    if (typeof says === 'number') return r.writeHead(says).end()
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(q.url === '/api/oauth/usage' ? {} : { plan_type: 7, rate_limit: {} }))
  })
  const api = await listen(t, srv)
  const home = mkdtempSync('/tmp/laki-usage-')
  t.after(() => rmSync(home, { recursive: true, force: true }))
  // the fakes' security (reads $HOME/keychain) and /bin's sh and cat: never the real Keychain, ~/.claude or ~/.codex
  withEnv(t, { HOME: home, PATH: `${fakes}:/bin`, CODEX_HOME: join(home, '.codex'), LAKI_USAGE_API: api, FAKE_LOG: undefined })
  mkdirSync(join(home, '.claude'))
  mkdirSync(join(home, '.codex'))
  const keychain = (o: object | string) => writeFileSync(join(home, 'keychain'), typeof o === 'string' ? o : JSON.stringify({ claudeAiOauth: o }))
  const file = (o: object | string) => writeFileSync(join(home, '.claude', '.credentials.json'), typeof o === 'string' ? o : JSON.stringify({ claudeAiOauth: o }))
  const auth = (o: object) => writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify(o))
  let now = Date.now()
  const own = ['claude', 'codex'].map(agent => ({ agent, account: 'home', name: 'Default', default: true }))
  const claude = async (at = (now += 3_600_000)) => (await usage({ codex: false }, own, at))[0]
  const codex = async (at = (now += 3_600_000)) => (await usage({ claude: false }, own, at))[0]

  // an empty token and a file that isn't JSON: not signed in, nothing asked
  keychain({ accessToken: '' })
  file('{oops')
  assert.equal((await claude()).error, 'Not signed in to a Claude plan: run claude, then /login')
  assert.equal(hits.length, 0)

  // a token with an expiry beats one without; no plan named: none; an answer with no windows says so
  keychain({ accessToken: 'kc' })
  file({ accessToken: 'file', expiresAt: Date.now() + 3_600_000, subscriptionType: '' })
  let u = await claude()
  assert.deepEqual([u.plan, u.windows, u.error], [undefined, [], 'This plan shows no limits (organization and education plans don’t)'])
  assert.equal(hits.at(-1)?.auth, 'Bearer file')

  // told to slow down: not asked again for 5 minutes, not even after one
  rmSync(join(home, '.claude', '.credentials.json'))
  claudeSays = 429
  const slowAt = (now += 3_600_000)
  assert.equal((await claude(slowAt)).error, 'Asked too often: tries again in a few minutes')
  assert.equal(hits.at(-1)?.auth, 'Bearer kc', 'the Keychain item without an expiry, when it is the only one')
  const n = hits.length
  await claude(slowAt + 61_000)
  assert.equal(hits.length, n, 'kept 5 minutes')
  await claude(slowAt + 301_000)
  assert.equal(hits.length, n + 1)

  // a server error: asked again after a minute
  claudeSays = 500
  const errAt = (now += 3_600_000)
  assert.equal((await claude(errAt)).error, 'HTTP 500')
  await claude(errAt + 61_000)
  assert.equal(hits.length, n + 3, 'asked again sooner')

  // a page that isn't JSON (a captive portal), and no server at all
  claudeSays = 'html'
  assert.equal((await claude()).error, 'Unexpected answer from the server')
  const gone = createServer()
  const closed = await new Promise<string>(r => gone.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(gone.address() as AddressInfo).port}`)))
  await new Promise(r => gone.close(r))
  process.env.LAKI_USAGE_API = closed
  assert.equal((await claude()).error, 'Can’t reach the server: offline?')
  process.env.LAKI_USAGE_API = api

  // Codex: an API key has no plan limits (nothing asked); no account id, no header; a plan with no windows; a failure
  const asked = hits.length
  auth({ OPENAI_API_KEY: 'sk-test' })
  assert.equal((await codex()).error, 'Signed in with an API key: billed per token, no plan limits')
  auth({ tokens: { access_token: '' } })
  assert.equal((await codex()).error, 'Not signed in: run codex login')
  assert.equal(hits.length, asked)
  auth({ tokens: { access_token: 'cx' } })
  u = await codex()
  assert.deepEqual([u.agent, u.plan, u.windows, u.error], ['codex', undefined, [], 'This plan shows no limits'])
  assert.deepEqual(hits.at(-1), { url: '/backend-api/wham/usage', auth: 'Bearer cx', account: undefined })
  codexSays = 503
  assert.equal((await codex()).error, 'HTTP 503')
})

test('memes: empty and failing sources, pictures that are skipped, posts without titles, and the last 500 shown', async t => {
  const MAX = 8 << 20
  let mode = 'empty'
  const pics: string[] = [] // every picture asked for, in order: what meme() has shown or tried
  const srv = createServer((q, r) => {
    const url = q.url!
    const json = (b: unknown) => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b))
    const children = (...ps: object[]) => json({ data: { children: ps.map(data => ({ data })) } })
    const hot = url.match(/^\/r\/(\w+)\/hot\.json\?limit=100&raw_json=1$/)?.[1]
    const gimme = url.match(/^\/gimme\/(\w+)\/50$/)?.[1]
    if (hot) {
      if (mode === 'empty') return json(null)
      if (mode === 'down') return r.writeHead(500).end()
      if (mode === 'mirror') return r.writeHead(403).end()
      if (mode === 'untitled') return children({ url: `${base}/ok.png` })
      if (mode === 'bad' && hot === 'memes') return children({ title: 'a', url: `${base}/html-1.png` }, { title: 'b', url: `${base}/bighead.png` }, { title: 'c', url: `${base}/bigbody.png` })
      if (mode === 'bad' && hot === 'ProgrammerHumor') return children({ title: 'd', url: `${base}/dead.png` }, { title: 'e', url: `${base}/missing.png` }, { url: `${base}/html-2.png` })
      if (mode === 'many' && hot === 'memes') return children(...[...Array(501)].map((_, i) => ({ title: `${i}`, url: `${base}/c${i}.png` })))
      return children()
    }
    if (gimme) {
      if (mode === 'empty') return json({})
      if (mode === 'down') return r.writeHead(500).end()
      if (mode === 'mirror') return json({ memes: [{ url: `${base}/ok.gif`, postLink: 'http://redd.it/x', author: 'bob' }] })
      return json({ memes: [] })
    }
    pics.push(url)
    if (url === '/dead.png') return q.socket.destroy()
    if (url === '/missing.png') return r.writeHead(404).end()
    if (url === '/bighead.png') return r.writeHead(200, { 'content-type': 'image/png', 'content-length': String(MAX + 1) }).flushHeaders() // never sent
    if (url === '/bigbody.png') return r.writeHead(200, { 'content-type': 'image/png' }).write(Buffer.alloc(MAX + 1)), r.end() // chunked: no length
    if (url === '/ok.png') return r.writeHead(200, { 'content-type': 'image/png' }).end('pic')
    if (url === '/ok.gif') return r.writeHead(200, { 'content-type': 'image/gif; charset=binary' }).end('gif')
    r.writeHead(200, { 'content-type': 'text/html' }).end('<p>not a picture</p>')
  })
  const base = await listen(t, srv)
  withEnv(t, { LAKI_MEME_API: base })
  const SUBS = ['memes', 'ProgrammerHumor', 'wholesomememes']

  // nothing anywhere (a null list, a mirror without memes): no reason to give
  await assert.rejects(meme(), { message: 'no meme this time: try Next again' })
  // both sources down: why
  mode = 'down'
  await assert.rejects(meme(), { message: `no meme this time (${base.slice(7)} answered 500): try Next again` })

  // each picture tried once and skipped: a page, too big by its length, too big once read, a dropped connection, a 404
  mode = 'bad'
  await assert.rejects(meme(), { message: 'no meme this time (fetch failed): try Next again' })
  assert.deepEqual([...pics].sort(), ['/bigbody.png', '/bighead.png', '/dead.png', '/html-1.png', '/html-2.png', '/missing.png'])

  // a post without a title or permalink: Reddit's front page as its link
  mode = 'untitled'
  let m = await meme()
  assert.ok(SUBS.includes(m.sub!))
  assert.deepEqual(m, { title: '', link: 'https://www.reddit.com', by: undefined, sub: m.sub, image: `data:image/png;base64,${Buffer.from('pic').toString('base64')}` })

  // Reddit says no: the mirror's, whose http link isn't kept (the subreddit's instead); the type without its charset
  mode = 'mirror'
  m = await meme()
  assert.deepEqual(m, { title: '', link: `https://www.reddit.com/r/${m.sub}`, by: 'bob', sub: m.sub, image: `data:image/gif;base64,${Buffer.from('gif').toString('base64')}` })

  // 501 pictures (none of them is one): each tried once, three a click; then the first, no longer among the last 500
  // shown, is the only one not seen
  mode = 'many'
  const many = () => pics.filter(p => /^\/c\d+\.png$/.test(p))
  for (let i = 0; i < 167; i++) await assert.rejects(meme(), { message: 'no meme this time: try Next again' })
  assert.equal(new Set(many()).size, 501)
  assert.equal(many().length, 501)
  await assert.rejects(meme())
  assert.equal(many().length, 502, 'one left to try')
  assert.equal(many()[501], many()[0])
})

// a widget folder: widget.json (an object, or text as it is) and, unless null, widget.html
function widget(d: string, json: object | string, html: string | null = '{{data}}', files: Record<string, string> = {}) {
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), typeof json === 'string' ? json : JSON.stringify(json))
  if (html !== null) writeFileSync(join(d, 'widget.html'), html)
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
  return d
}

test('widgets: folders from ~/, a widget as a folder, the first of an id, bad ones, kinds of settings, pages, actions', async t => {
  const rig = await fresh(t)
  const own = join(rig.data, 'widgets')
  const more = join(rig.home, 'more')
  widget(join(own, 'dup'), { name: 'Mine' })
  widget(join(more, 'dup'), { name: 'Theirs' })
  widget(join(more, 'bad'), '{not json')
  widget(join(more, 'num'), '42')
  widget(join(more, 'nohtml'), { name: 'No page' }, null)
  mkdirSync(join(more, 'empty'))
  writeFileSync(join(more, 'file.txt'), 'x')
  symlinkSync(widget(join(rig.home, 'elsewhere', 'real'), { name: 'Linked' }, 'linked'), join(more, 'link'))
  widget(join(rig.home, 'solo'), { name: 'Solo' }, 'solo')
  widget(join(own, 'spec'), {
    config: { arr: ['a', 'b'], weird: { type: 'nope', default: 7 }, flag: { type: 'nope', default: true }, list: { default: ['x', 'x', 'y'] }, label: { label: ' Name ', hint: ' ' }, nul: null },
  })
  widget(join(own, 'jsw'), {}, '<template preview><script>1</script></template>')
  widget(join(own, 'outside'), { script: '../outside-x/fetch.mjs' })
  widget(join(own, 'acts'), { actions: { quiet: 'true', plain: `echo '{"x":1}'`, multi: `printf '{\\n  "toast": "multi"\\n}\\n'` } })

  await rig.rpc('settingsSet', { widgetDirs: ['~/more', '~/solo'] })
  const ws = await rig.rpc('widgetReload')
  const by = (id: string) => ws.find((w: any) => w.id === id)
  assert.deepEqual(
    ws.filter((w: any) => !w.builtin).map((w: any) => [w.id, w.name]),
    [
      ['acts', 'acts'],
      ['dup', 'Mine'],
      ['jsw', 'jsw'],
      ['outside', 'outside'],
      ['spec', 'spec'],
      ['link', 'Linked'],
      ['nohtml', 'No page'],
      ['solo', 'Solo'],
    ],
    "Laki's own first and its dup wins; no bad JSON, no number, no folder without widget.json; a link and a widget's own folder count",
  )
  assert.equal(by('dup').dir, join(own, 'dup'))
  assert.equal(by('link').dir, join(more, 'link'))
  assert.equal(by('solo').dir, join(rig.home, 'solo'))
  assert.deepEqual([by('nohtml').full, by('nohtml').js], [false, undefined])
  assert.equal(await rig.rpc('widgetRender', { id: 'link' }), 'linked')
  await assert.rejects(rig.rpc('widgetRender', { id: 'nohtml' }), /ENOENT/)

  // a setting's kind from its default when its type isn't one
  assert.deepEqual(
    by('spec').options.map((o: any) => [o.key, o.type]),
    [
      ['arr', 'list'],
      ['weird', 'number'],
      ['flag', 'bool'],
      ['list', 'list'],
      ['label', 'text'],
      ['nul', 'text'],
    ],
  )
  assert.deepEqual(by('spec').options[4], { key: 'label', type: 'text', label: 'Name' }, 'labels trimmed, an empty hint none')
  assert.deepEqual(by('spec').config, { arr: 'a,b', weird: '7', flag: '1', list: 'x,y', label: '', nul: '' })

  // a JS page: no key, a theme that isn't JSON or an object, a widget that isn't there or has no page
  const { port } = rig.info()
  const { widgetKey } = await rig.rpc('state')
  const page = (q: string) => fetch(`http://127.0.0.1:${port}/widget/${q}`)
  let res = await page('jsw')
  assert.deepEqual([res.status, await res.text()], [401, 'bad key'])
  for (const theme of ['nope', 'null', '5']) {
    res = await page(`jsw?key=${widgetKey}&theme=${theme}`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /<style>:root \{ {2}\} html/, theme)
  }
  res = await page(`nothere?key=${widgetKey}`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /<p style="color:#f7768e;font:12px system-ui">no widget nothere<\/p>/)
  res = await page(`nohtml?key=${widgetKey}`)
  assert.match(await res.text(), /system-ui">ENOENT: no such file or directory, open '[^<]*\/nohtml\/widget\.html'<\/p>$/)

  // a script outside its folder doesn't run (a sibling folder whose name starts the same included)
  widget(join(own, 'outside-x'), {}, null, { 'fetch.mjs': 'export default () => ({ ran: true })' })
  assert.deepEqual(await rig.rpc('widgetRun', { id: 'outside' }), { ok: false, error: "../outside-x/fetch.mjs isn't in the widget's folder" })

  // actions: nothing printed, JSON that says nothing to show, a toast over several lines
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'acts', action: 'quiet' }), { ok: true })
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'acts', action: 'plain' }), { ok: true, out: '{"x":1}' })
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'acts', action: 'multi' }), { ok: true, toast: 'multi' })
})

test('widgets: fetched on schedule only within the working hours; a line that does not read, or none, is always', async t => {
  const rig = await fresh(t)
  widget(join(rig.data, 'widgets', 'hrs'), { every: 1, fetch: `echo '{"n":1}'` })
  await rig.rpc('settingsSet', { devMode: true, widgetHours: '9am-10am' })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'hrs', on: true }) // turned on, it fetches whatever the hours
  const at = () => rig.rpc('state').then(v => v.widgets.find((w: any) => w.id === 'hrs'))
  let last = (await until(() => at().then(w => !w.running && w.at && w), 'the first fetch')).at
  const app = await rig.connect()
  t.after(() => app.close())
  const day = new Date(Date.now() + 2 * 86_400_000)
  const when = (h: number, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()

  await rig.rpc('widgetTick', { now: when(3, 0) })
  const log = await rig.rpc('logs', { key: 'widget:hrs' })
  assert.equal(log.at(-1).text, 'not fetched: outside the working hours (Every day, 09:00–10:00)')
  await sleep(300)
  assert.equal((await at()).at, last, 'not fetched')

  const fetchedAt = async (now: number, what: string) => {
    await rig.rpc('widgetTick', { now })
    last = (await until(() => at().then(w => !w.running && w.at > last && w), what)).at
  }
  await fetchedAt(when(9, 30), 'fetched within the hours')
  await rig.rpc('settingsSet', { widgetHours: 'whenever' })
  await fetchedAt(when(3, 0), 'a line that does not read: always')
  await rig.rpc('settingsSet', { widgetHours: '   ' })
  await fetchedAt(when(3, 0), 'blank: always')
})
