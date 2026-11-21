// The laki CLI, `laki mcp` and the daemon's HTTP and WebSocket edges, past the paths cli.test.ts and api.test.ts walk:
// hooks without a tab or with a bad payload, a second daemon, host projects, the agent browser, widgets, schedules'
// failures, another version's daemon, MCP's protocol errors, request limits, a stalled client, the log's rotation.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fixtureWidgets, fresh, type Rig, until } from './helpers.ts'
import { GROUPS, skillTools, toolGroup, tools } from '../src/shared/tools.ts'
import { BACKUP_KEEP, DATA_SECRETS } from '../src/daemon/dir.ts'

const cliPath = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))

// the CLI run in another folder (rig.cli runs in this checkout's)
function cliAt(rig: Rig, cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise(r => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', cliPath, ...args], { env: { ...rig.env, ...(rig.app && { LAKI_APP_TOKEN: rig.app }) }, cwd }) // S1: as rig.cli
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('exit', code => r({ code: code ?? 1, out, err }))
  })
}

// `laki mcp` fed these lines; its answers by id (a parse error's id is null)
async function mcp(rig: Rig, lines: (string | object)[], ...args: string[]) {
  const r = await rig.cliIn(lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', 'mcp', ...args)
  assert.equal(r.code, 0, r.err)
  const all = r.out.trim().split('\n').map(l => JSON.parse(l))
  for (const m of all) assert.equal(m.jsonrpc, '2.0')
  return { all, by: Object.fromEntries(all.filter(m => m.id !== null).map(m => [m.id, m])) }
}

const tool = (id: number, name: string, args?: object) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, ...(args && { arguments: args }) } })

test('cli: hooks without a tab or with a bad payload, a second daemon, progress without a number', async t => {
  const rig = await fresh(t)
  delete rig.env.LAKI_TAB
  delete rig.env.LAKI_WORKSPACE
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'hooked' })
  const tab = await rig.tab(ws.id, 'shell')

  // no $LAKI_TAB: not a Laki tab, nothing to report, done at once
  let at = Date.now()
  let r = await rig.cli('hook', 'start', '{"session_id":"nobody"}')
  assert.deepEqual([r.code, r.out, r.err], [0, '', ''])
  assert.ok(Date.now() - at < 3000)
  // the payload as an argument, on stdin, or junk (reported without it)
  rig.env.LAKI_TAB = tab.id
  r = await rig.cli('hook', 'start', '{"session_id":"from-arg"}')
  assert.equal(r.code, 0)
  assert.equal((await rig.tab(ws.id, 'shell')).resumeId, 'from-arg')
  r = await rig.cliIn('{"session_id":"from-stdin"}', 'hook', 'start')
  assert.equal(r.code, 0)
  assert.equal((await rig.tab(ws.id, 'shell')).resumeId, 'from-stdin')
  at = Date.now()
  r = await rig.cli('hook', 'start', '{not json')
  assert.deepEqual([r.code, r.err], [0, ''])
  assert.ok(Date.now() - at < 3000, 'never holds the agent up')
  assert.equal((await rig.tab(ws.id, 'shell')).resumeId, 'from-stdin', 'a bad payload changes nothing')
  delete rig.env.LAKI_TAB

  // one daemon per data folder: `laki daemon` finds this one's lock and leaves
  const { pid, port } = rig.info()
  r = await rig.cli('daemon')
  assert.deepEqual([r.code, r.out], [0, 'laki daemon already running\n'])
  assert.deepEqual([rig.info().pid, rig.info().port], [pid, port])
  assert.equal(await rig.rpc('ping'), 'pong')

  r = await rig.cli('progress')
  assert.equal(r.code, 1)
  assert.match(r.err, /^laki: usage: laki progress <0-100>/)
})

test('cli: a project over SSH in ls and project; add with no path is the folder it runs in', async t => {
  const rig = await fresh(t)
  let r = await rig.cli('project', 'add', `devbox:${rig.repo}`)
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, `added devbox:${rig.repo}\n`)
  const there = realpathSync(rig.repo)
  r = await rig.cli('project')
  assert.equal(r.out, `repo-devbox  devbox:${there}\n`)
  r = await rig.cli('ls')
  assert.equal(r.out, `repo-devbox  devbox:${there}\n`)
  // no path: the folder the CLI runs in (its repo's top level)
  mkdirSync(join(rig.repo, 'sub'))
  r = await cliAt(rig, join(rig.repo, 'sub'), 'project', 'add', '--json')
  assert.equal(r.code, 0, r.err)
  const p = JSON.parse(r.out)
  assert.deepEqual([p.id, p.path, p.host, p.config], ['repo', there, undefined, undefined])
  r = await rig.cli('project')
  assert.equal(r.out, `repo-devbox  devbox:${there}\nrepo  ${there}\n`)
  // and in words: the folder added, not the missing argument
  const plain = join(rig.home, 'plain-folder')
  mkdirSync(plain)
  r = await cliAt(rig, plain, 'project', 'add')
  assert.match(r.out, /^added \/.*\/plain-folder\n$/)
})

test('cli: browser ops through the app’s window, each one’s answer as text', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'web' })
  // the app: a window that can browse, answering each op as main would
  const app = await rig.connect()
  t.after(() => app.close())
  await app.call('view', { tab: null, focused: false, browse: true })
  const asked: any[] = []
  const png = Buffer.from('fake png bytes')
  app.ws.on('message', raw => {
    const e = JSON.parse(String(raw))
    if (e.ev !== 'browse') return
    asked.push(e)
    const result =
      e.op === 'open'
        ? { url: e.url ?? e.home, title: e.url ? 'Sign in' : '' }
        : e.op === 'text'
          ? { text: 'Hello from the page' }
          : e.op === 'screenshot'
            ? { url: e.home, png: png.toString('base64') }
            : e.selector === '#gone'
              ? undefined
              : e.op === 'click' // what main says a click caused
                ? { url: `${e.home}done`, title: 'Done', nav: { url: `${e.home}done`, title: 'Done' }, errors: ['TypeError: x is undefined'], changed: ['+ Thanks', '- Sign in'] }
                : { url: e.home, title: 'Shop', changed: [] }
    app.notify('browseDone', result ? { id: e.req, ok: true, result } : { id: e.req, ok: false, error: 'no element matches #gone' })
  })
  const home = `http://localhost:${ws.port}`
  let r = await rig.cli('browser', 'web', 'open', '/login')
  assert.equal(r.out, `${home}/login  Sign in\n`, r.err)
  r = await rig.cli('browser', 'web', 'open')
  assert.equal(r.out, `${home}/\n`) // no URL: $PORT's page; no title, none shown
  r = await rig.cli('browser', 'web', 'click', 'button', '.primary')
  assert.equal(r.out, `→ ${home}/done  Done\nconsole error: TypeError: x is undefined\n+ Thanks\n- Sign in\n`, r.err)
  r = await rig.cli('browser', 'web', 'fill', 'input[name=q]', 'two', 'words')
  assert.equal(r.out, `${home}/  Shop\n(no changes)\n`, r.err)
  r = await rig.cli('browser', 'web', 'text')
  assert.equal(r.out, 'Hello from the page\n', r.err)
  r = await rig.cli('browser', 'web', 'screenshot')
  const shot = r.out.trim()
  assert.match(shot, new RegExp(`^${join(rig.data, 'images')}/\\d+-\\w+\\.png$`), r.err)
  assert.deepEqual(readFileSync(shot), png)
  r = await rig.cli('browser', 'web', 'click', '#gone')
  assert.deepEqual([r.code, r.err], [1, 'laki: no element matches #gone\n'])
  assert.deepEqual(
    asked.map(e => [e.op, e.ws, e.url, e.selector, e.text]),
    [
      ['open', 'web', `${home}/login`, undefined, undefined],
      ['open', 'web', undefined, undefined, undefined],
      ['click', 'web', undefined, 'button .primary', undefined],
      ['fill', 'web', undefined, 'input[name=q]', 'two words'],
      ['text', 'web', undefined, undefined, undefined],
      ['screenshot', 'web', undefined, undefined, undefined],
      ['click', 'web', undefined, '#gone', undefined],
    ],
  )
  // --json: the op's own answer
  r = await rig.cli('browser', 'web', 'text', '--json')
  assert.deepEqual(JSON.parse(r.out), { text: 'Hello from the page' })
})

test('cli: schedule log before any run, a run that fails, and its ✗', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'target' })
  let r = await rig.cli('schedule', 'log')
  assert.equal(r.out, 'no runs yet\n')
  assert.deepEqual(JSON.parse((await rig.cli('schedule', 'log', '--json')).out), [])
  r = await rig.cli('schedule', 'add', p.id, '--when', 'daily at 9am', '--where', ws.id, '--json', 'check', 'it')
  assert.equal(r.code, 0, r.err)
  const s = JSON.parse(r.out)
  assert.equal(s.ws, ws.id)
  await rig.rpc('wsArchive', { id: ws.id })
  r = await rig.cli('schedule', 'run', s.id)
  assert.deepEqual([r.code, r.out], [0, `✗ ${ws.id} is archived\n`])
  r = await rig.cli('schedule', 'log')
  assert.match(r.out, new RegExp(`^.+ {2}✗ {2}check it {2}${ws.id} is archived\n$`))
})

test('cli: another version’s daemon: a view without schedules, runs or widgets, a status with no glyph', async t => {
  const rig = await fresh(t)
  await rig.stop()
  // a daemon of another version: its own view, nothing else
  const view = {
    projects: [{ id: 'old', path: '/x' }],
    workspaces: [{ id: 'w', project: 'old', branch: 'b', port: 3100, ports: [] }],
    tabs: [{ id: 't1', workspace: 'w', name: 'sleeper', status: 'dozing', done: false }],
  }
  const asked: string[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const { method } = JSON.parse(body)
    asked.push(method)
    const result = method === 'ping' ? 'pong' : method === 'state' ? view : undefined
    res.end(JSON.stringify(result === undefined ? { error: `unknown method ${method}` } : { result }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const info = join(rig.data, 'daemon.json')
  writeFileSync(info, JSON.stringify({ port: (server.address() as any).port, token: 'x', pid: 4194304 })) // no such pid
  try {
    assert.equal((await rig.cli('schedule')).out, 'no scheduled tasks\n')
    assert.equal((await rig.cli('schedule', '--json')).out, '[]\n')
    assert.equal((await rig.cli('schedule', 'log')).out, 'no runs yet\n')
    assert.equal((await rig.cli('schedule', 'log', '--json')).out, '[]\n')
    assert.equal((await rig.cli('widget')).out, 'no widgets\n')
    assert.equal((await rig.cli('ls')).out, 'old  /x\n  w  b  :3100\n       sleeper (t1)\n')
    assert.ok(asked.includes('state') && !asked.some(m => m !== 'ping' && m !== 'state'), asked.join())
  } finally {
    rmSync(info, { force: true })
    server.close()
  }
})

// a widget in Laki's own folder
function widget(rig: Rig, id: string, json: object, html: string) {
  const d = join(rig.data, 'widgets', id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify(json))
  writeFileSync(join(d, 'widget.html'), html)
  return d
}

test('cli: widget ls, reload, run, on/off, render, action, as the app would show them', async t => {
  const rig = await fresh(t)
  await fixtureWidgets(rig)
  const cnt = widget(
    rig,
    'cnt',
    {
      name: 'Count',
      every: 5,
      fetch: `echo '{"n":7}'`,
      actions: {
        say: 'echo "arg=$WIDGET_ARG"',
        toast: `echo '{"toast":"Saved"}'`,
        modal: `echo a log line; echo '{"modal":{"title":"Sure?","text":"It goes."}}'`,
        quiet: 'true',
        fail: 'echo broken >&2; exit 2',
      },
    },
    'n={{data.n}}',
  )
  const bad = widget(rig, 'bad', { fetch: 'echo oops >&2; exit 3' }, 'x')
  const still = widget(rig, 'still', { name: 'Still' }, '<template preview>small</template><template full>big</template>')
  widget(rig, 'wide', {}, '<template full>only big</template>')
  let r = await rig.cli('widget', 'reload')
  assert.deepEqual([r.code, r.out], [0, 'reloaded\n'], r.err)
  const find = async (id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)
  assert.match((await rig.cli('widgets')).out, /^cnt {2}off /m, 'every extension starts off')
  for (const id of ['cnt', 'bad', 'still']) assert.equal((await rig.cli('widget', 'on', id)).out, `${id} on\n`)
  await until(async () => (await find('cnt'))?.at && !(await find('cnt')).running && (await find('bad'))?.error && !(await find('bad')).running, 'both fetched')

  r = await rig.cli('widgets')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`^cnt {2}on {3}\\d+×\\d+ {2}every 5m {2}✓ {2}${cnt}$`, 'm'))
  assert.match(r.out, new RegExp(`^bad {2}on {3}\\d+×\\d+ {2}every \\d+m {2}✗ oops {2}${bad}$`, 'm'))
  assert.match(r.out, new RegExp(`^still {2}on {3}\\d+×\\d+ {2}no fetch {4}${still}$`, 'm'))
  assert.match(r.out, /^my-prs {2}off /m, 'a folder of yours: off')

  assert.deepEqual([(r = await rig.cli('widget', 'run', 'cnt')).code, r.out], [0, 'fetched\n'])
  assert.deepEqual([(r = await rig.cli('widget', 'run', 'bad')).code, r.out], [0, '✗ oops\n'])
  assert.equal((await rig.cli('widget', 'run', 'still')).out, '✗ still has no fetch or script: give it a source (static, file or url)\n')

  assert.equal((await rig.cli('widget', 'off', 'cnt')).out, 'cnt off\n')
  assert.match((await rig.cli('widget')).out, /^cnt {2}off /m)
  assert.equal((await rig.cli('widget', 'on', 'cnt')).out, 'cnt on\n')
  assert.equal((await find('cnt')).on, true)

  assert.equal((await rig.cli('widget', 'render', 'cnt')).out, 'n=7\n')
  assert.equal((await rig.cli('widget', 'render', 'cnt', '--full')).out, 'cnt has no full view\n')
  assert.equal((await rig.cli('widget', 'render', 'still')).out, 'small\n')
  assert.equal((await rig.cli('widget', 'render', 'still', '--full')).out, 'big\n')
  assert.equal((await rig.cli('widget', 'render', 'wide')).out, 'wide has no preview view\n')
  assert.equal((await rig.cli('widget', 'render', 'cnt', '--full', '--json')).out, 'null\n')

  const act = async (...a: string[]) => (await rig.cli('widget', 'action', 'cnt', ...a)).out
  assert.equal(await act('say', 'a', 'b'), 'arg=a b\n')
  assert.equal(await act('toast'), 'Saved\n')
  assert.equal(await act('modal'), 'Sure?\nIt goes.\n')
  assert.equal(await act('quiet'), 'done\n')
  assert.equal(await act('fail'), '✗ broken\n')
  assert.equal(await act('nope'), '✗ Count has no action nope\n')

  r = await rig.cli('widget', 'frob')
  assert.equal(r.code, 1)
  assert.match(r.err, /^laki: unknown widget command frob\.\n  laki widget \[ls\] \| reload/)
  r = await rig.cli('widget', 'on', 'nope')
  assert.equal(r.code, 1)
  assert.match(r.err, /no widget nope/)
})

test('laki mcp: blank lines, bad JSON, ping, an unknown tool, a string answer, the state of an agent, new workspace checks', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const quiet = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'quiet' })
  // an agent that answered once, now asks, with a message queued
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'agent' })
  await until(async () => (await rig.tab(ws.id))?.last === 'answer: hi', 'the first turn')
  await rig.rpc('send', { target: ws.id, text: 'ask me' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting')
  await rig.rpc('send', { target: ws.id, text: 'later', whenIdle: true })

  const { all, by } = await mcp(rig, [
    '',
    '   ',
    'not json',
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: null, method: 'ping' },
    tool(3, 'laki_nope', {}),
    tool(4, 'laki_state'),
    tool(5, 'laki_diff', { ws: quiet.id }),
    tool(6, 'laki_new_workspace', { project: p.id }),
    tool(7, 'laki_new_workspace', { project: p.id, prompt: 'x', presets: ['claude'] }),
    tool(8, 'laki_new_workspace', { project: p.id, prompt: 'plain one', preset: 'none', name: 'plain', presets: [] }),
  ])
  assert.deepEqual(
    all.filter(m => m.id === null),
    [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }],
    'blank lines and a null id get no answer; bad JSON one',
  )
  assert.deepEqual(Object.keys(by).sort(), ['1', '2', '3', '4', '5', '6', '7', '8'])
  assert.equal(by[1].result.protocolVersion, '2025-06-18', 'none asked: the one Laki speaks')
  assert.deepEqual(by[2].result, {})
  assert.deepEqual(by[3].result, { content: [{ type: 'text', text: 'no tool laki_nope' }], isError: true })

  const v = JSON.parse(by[4].result.content[0].text)
  const agent = v.tabs.find((x: any) => x.workspace === ws.id)
  assert.deepEqual([agent.kind, agent.agent, agent.status, agent.queued, agent.last], ['agent', 'claude', 'waiting', 1, 'answer: hi'])
  const none = v.workspaces.find((w: any) => w.id === quiet.id)
  assert.deepEqual([none.kind, v.tabs.some((x: any) => x.workspace === quiet.id)], ['worktree', false])
  if (none.pr) assert.deepEqual(Object.keys(none.pr), ['number', 'state', 'url', 'checks'], "a PR's number, state, link and checks: what it has (title, author, review only when known)")

  assert.deepEqual(by[5].result.content, [{ type: 'text', text: 'no changes' }], 'a string answer as it is')
  assert.deepEqual([by[6].result.isError, by[6].result.content[0].text], [true, 'a prompt, an issue or a PR'])
  assert.deepEqual([by[7].result.isError, by[7].result.content[0].text], [true, 'a race needs two agents or more'])
  assert.ok(!by[8].result.isError, by[8].result.content[0].text)
  assert.equal(JSON.parse(by[8].result.content[0].text).id, 'plain', 'no presets: one workspace')
})

test('laki mcp: the core tools and laki_more; a group on ask, with list_changed; any tool by its name; --all and LAKI_MCP_ALL list them all', async t => {
  const rig = await fresh(t)
  const names = (m: any) => m.result.tools.map((x: any) => x.name).filter((n: string) => !n.startsWith('ext_')) as string[]
  const list = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list' })
  const { all, by } = await mcp(rig, [{ jsonrpc: '2.0', id: 1, method: 'initialize' }, list(2), tool(3, 'laki_schedules'), tool(4, 'laki_more', { group: 'prs' }), list(5), tool(6, 'laki_more', { group: 'nope' })])
  assert.deepEqual(by[1].result.capabilities.tools, { listChanged: true })
  const any = (async () => ({})) as never
  const plain = tools(any).map(x => x.name) // laki mcp's (Laki AI's skill tools aside)
  assert.deepEqual(names(by[2]).sort(), [...GROUPS.core.tools.filter(n => plain.includes(n)), 'laki_more'].sort(), 'the core group and laki_more')
  assert.ok(!by[3].result.isError, `an unlisted tool runs: ${by[3].result.content[0].text}`)
  assert.equal(by[4].result.content[0].text, 'prs: laki_attach_pr, laki_pr_draft')
  assert.equal(all.filter(m => m.method === 'notifications/tools/list_changed').length, 1)
  assert.ok(names(by[5]).includes('laki_pr_draft') && !names(by[5]).includes('laki_schedules'), 'the group asked for, no other')
  assert.equal(by[6].result.isError, true)
  const every = (m: any) => assert.ok(names(m).includes('laki_workflow_run') && !names(m).includes('laki_more'))
  every((await mcp(rig, [list(1)], '--all')).by[1])
  rig.env.LAKI_MCP_ALL = '1'
  const e = await mcp(rig, [{ jsonrpc: '2.0', id: 1, method: 'initialize' }, list(2)])
  every(e.by[2])
  assert.deepEqual(e.by[1].result.capabilities.tools, {})
  delete rig.env.LAKI_MCP_ALL
  // every tool has a group
  for (const x of [...tools(any), ...skillTools(any)]) assert.ok(toolGroup(x.name), `${x.name} has no group`)
})

test('daemon HTTP and WebSocket: only POST /rpc, a body over 16 MB, a bad body, a page file of an unknown type, a client that stops reading', async t => {
  const rig = await fresh(t)
  const { port, token } = rig.info()
  const at = `http://127.0.0.1:${port}`
  const auth = { authorization: `Bearer ${token}` }
  for (const [method, path] of [
    ['PUT', '/rpc'],
    ['DELETE', '/rpc'],
    ['POST', '/'],
    ['POST', '/rpc/'],
    ['POST', '/rpc?x=1'],
  ]) {
    const res = await fetch(at + path, { method, headers: auth, body: JSON.stringify({ method: 'ping' }) })
    assert.deepEqual([res.status, await res.json()], [404, { error: 'not found' }], `${method} ${path}`)
  }
  // too big: refused before it's read whole (node:http on a connection of its own: fetch's pool hangs on the one
  // the daemon drops mid-upload)
  const big = await new Promise<[number, string]>((ok, no) => {
    const req = request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', agent: false, headers: auth }, res => {
      let s = ''
      res.on('data', d => (s += d)).on('end', () => ok([res.statusCode!, s]))
    })
    // the daemon answers at 16 MB and closes: the rest of our write may hit EPIPE first; its 413 is on its way
    req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? setTimeout(() => no(e), 2000) : no(e)))
    req.end(JSON.stringify({ method: 'ping', params: { x: 'x'.repeat(17 << 20) } }))
  })
  assert.deepEqual(big, [413, '{"error":"too big"}'])
  // not JSON: an error reply, the daemon fine
  const junk = await fetch(`${at}/rpc`, { method: 'POST', headers: auth, body: '{nope' })
  assert.equal(junk.status, 200)
  assert.match((await junk.json()).error, /JSON/)
  assert.equal(await rig.rpc('ping'), 'pong')

  // the page's files: a type it doesn't know is bytes, revalidated
  mkdirSync(rig.env.LAKI_PAGE, { recursive: true })
  writeFileSync(join(rig.env.LAKI_PAGE, 'blob.bin'), 'bytes')
  const res = await fetch(`${at}/blob.bin`)
  assert.deepEqual(
    [res.status, res.headers.get('content-type'), res.headers.get('cache-control'), res.headers.get('x-content-type-options'), await res.text()],
    [200, 'application/octet-stream', 'no-cache', 'nosniff', 'bytes'],
  )
  const gone = await fetch(`${at}/nope.html`)
  assert.deepEqual([gone.status, await gone.text()], [404, 'not found'])

  // a client that stops reading (asleep, hung) is dropped past 32 MB waiting for it, not buffered without bound:
  // its terminal's queries go back to the other one
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'stall' })
  const tab = await rig.tab(ws.id, 'shell')
  writeFileSync(join(ws.path, 'big.png'), Buffer.alloc(10 << 20, 1)) // the largest image fileRead sends: ~14 MB as base64
  const ok = await rig.connect()
  const stuck = await rig.connect()
  t.after(() => (ok.close(), stuck.close()))
  await ok.call('attach', { tab: tab.id })
  await stuck.call('attach', { tab: tab.id })
  await until(() => ok.events.some(e => e.ev === 'responder' && !e.on), 'the newer client answers')
  const sock = (stuck.ws as any)._socket
  sock.pause()
  for (let i = 0; i < 5; i++) stuck.ws.send(JSON.stringify({ id: 100 + i, method: 'fileRead', params: { ws: ws.id, path: 'big.png' } }))
  await until(() => ok.events.filter(e => e.ev === 'responder' && e.on).length === 2, 'the stalled one dropped')
  const closed = new Promise(r => stuck.ws.once('close', r))
  sock.resume()
  assert.equal(await closed, 1006, 'cut off, no close frame')
  assert.equal(await ok.call('ping'), 'pong')
})

test('daemon start from the CLI: a big log is rotated first, a lock it cannot read taken over; its own scan paces and page folder', async t => {
  const rig = await fresh(t)
  await rig.stop()
  const lock = join(rig.data, 'daemon.lock')
  writeFileSync(lock, '1', { mode: 0 }) // there, but unreadable: stale
  for (const k of ['LAKI_PORT_SCAN_MS', 'LAKI_PR_SCAN_MS', 'LAKI_STAT_SCAN_MS', 'LAKI_PAGE']) delete rig.env[k]
  const log = join(rig.data, 'daemon.log')
  writeFileSync(log, Buffer.alloc(10e6 + 1, 'x'))
  const r = await rig.cli('ls', '--json')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).projects, [])
  assert.equal(statSync(`${log}.1`).size, 10e6 + 1, 'the old log, kept once')
  const { pid, port } = rig.info()
  assert.match(readFileSync(log, 'utf8'), new RegExp(`^\\S+ laki daemon on 127\\.0\\.0\\.1:${port} \\(pid ${pid}`))
  assert.ok(statSync(log).size < 10e3)
  assert.equal(readFileSync(lock, 'utf8'), String(pid), 'the new daemon’s')
  // no LAKI_PAGE: the built renderer's folder, or none in a checkout never built; a missing file is 404 either way
  const res = await fetch(`http://127.0.0.1:${port}/no-such-file-${pid}.txt`)
  assert.equal(res.status, 404)
  assert.match(await res.text(), /^(not found|no app page here: build it \(npm run build\))$/)
  // a lock that is a link to nothing: removed, not followed, and the daemon starts
  process.kill(rig.info().pid, 'SIGTERM') // the one the CLI started (S1: it gave no app token; a terminal's laki stop: cli.test.ts)
  await until(() => !existsSync(join(rig.data, 'daemon.json')), 'the daemon gone')
  rmSync(lock, { force: true })
  symlinkSync(join(rig.data, 'gone'), lock)
  const again = await rig.cli('ls', '--json')
  assert.equal(again.code, 0, again.err)
  assert.equal(readFileSync(lock, 'utf8'), String(rig.info().pid))
})

test('#34.5: laki widget log: -n, -f and the other options only before the message; its own words are its own', async t => {
  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'y')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Y', fetch: 'echo {}' }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'y', on: true, log: true })
  for (const words of [['tail', '-n', '5', 'and', '-f', 'done'], ['the', '--level', 'is', 'high', '--', 'ok']]) {
    const c = await rig.cli('widget', 'log', 'y', ...words)
    assert.equal(c.code, 0, c.err)
  }
  const c = await rig.cli('widget', 'log', 'y', '--level', 'warn', 'disk', 'full')
  assert.equal(c.code, 0, c.err)
  const lines = (await rig.rpc('widgetLogs', { id: 'y', src: 'cli' })).lines.map((l: any) => `${l.level} ${l.text}`)
  assert.deepEqual(lines, ['info tail -n 5 and -f done', 'info the --level is high -- ok', 'warn disk full'])
})

test('laki mcp: resources (a diff, a plan, memory) and prompts (the templates); an agent reads as its tools do', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'mine' })
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'theirs' })
  writeFileSync(join(ws.path, 'hello.txt'), 'hello from mine\n')
  writeFileSync(join(other.path, 'other.txt'), 'theirs only\n')
  await rig.rpc('memoryAdd', { project: p.id, text: 'run npm test before a commit' })
  await rig.rpc('settingsSet', { templates: [{ name: 'Fix it', text: 'Fix {{prompt}} on {{branch}} by {{YYYY-MM-DD}}' }] })
  const tab = (await until(() => rig.tab(ws.id))).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const said = join(rig.home, 'tab-token')
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run printenv LAKI_TAB_TOKEN > ${said}` })
  const token = (await until(() => existsSync(said) && readFileSync(said, 'utf8').trim(), 'its token', 60000)) as string // its agent's own: laki mcp with it is that agent
  delete rig.env.LAKI_TAB
  delete rig.env.LAKI_WORKSPACE
  const req = (id: number, method: string, params?: object) => ({ jsonrpc: '2.0', id, method, ...(params && { params }) })
  // yours (no tab): every live workspace's, the templates as prompts
  const { by } = await mcp(rig, [
    req(1, 'initialize'),
    req(2, 'resources/list'),
    req(3, 'resources/read', { uri: `laki://ws/${ws.id}/diff` }),
    req(4, 'resources/read', { uri: `laki://project/${p.id}/memory` }),
    req(5, 'resources/read', { uri: `laki://ws/${ws.id}/plan` }),
    req(6, 'resources/templates/list'),
    req(7, 'prompts/list'),
    req(8, 'prompts/get', { name: 'Fix it', arguments: { prompt: 'the flaky test', branch: 'main' } }),
    req(9, 'resources/read', { uri: 'laki://ws/../etc/diff' }),
  ])
  assert.deepEqual(Object.keys(by[1].result.capabilities).sort(), ['prompts', 'resources', 'tools'])
  const uris = by[2].result.resources.map((r: any) => r.uri)
  for (const u of [`laki://ws/${ws.id}/diff`, `laki://ws/${ws.id}/plan`, `laki://ws/${other.id}/diff`, `laki://project/${p.id}/memory`]) assert.ok(uris.includes(u), u)
  assert.ok(by[2].result.resources.every((r: any) => r.name && r.description && r.mimeType))
  assert.match(by[3].result.contents[0].text, /\+hello from mine/)
  assert.equal(by[3].result.contents[0].mimeType, 'text/x-diff')
  assert.match(by[4].result.contents[0].text, /- run npm test before a commit/)
  assert.match(by[5].result.contents[0].text, /No plan yet/)
  assert.deepEqual(by[6].result.resourceTemplates.map((x: any) => x.uriTemplate), ['laki://ws/{id}/diff', 'laki://ws/{id}/plan', 'laki://project/{id}/memory'])
  const fix = by[7].result.prompts.find((x: any) => x.name === 'Fix it')
  assert.deepEqual(fix.arguments.map((a: any) => a.name), ['prompt', 'branch']) // a date is stamped, not asked
  const d = new Date() // the local date, as when.ts' stamp writes it (the UTC one is another day near midnight)
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  assert.deepEqual(by[8].result.messages, [{ role: 'user', content: { type: 'text', text: `Fix the flaky test on main by ${today}` } }])
  assert.match(by[9].error.message, /no resource/)
  // an agent's tab: its own workspace listed; Recording mode keeps a private one's diff from it, the tool's way
  await rig.rpc('wsSet', { id: other.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  rig.env.LAKI_WORKSPACE = ws.id
  rig.env.LAKI_TAB = tab
  rig.env.LAKI_TAB_TOKEN = token
  const a = await mcp(rig, [req(1, 'resources/list'), req(2, 'resources/read', { uri: `laki://ws/${other.id}/diff` }), tool(3, 'laki_diff', { ws: other.id }), req(4, 'resources/read', { uri: `laki://ws/${ws.id}/diff` }), req(5, 'prompts/list')])
  assert.deepEqual(a.by[1].result.resources.map((r: any) => r.uri).sort(), [`laki://project/${p.id}/memory`, `laki://ws/${ws.id}/diff`, `laki://ws/${ws.id}/plan`])
  assert.match(a.by[2].error.message, new RegExp(`no workspace ${other.id}`))
  assert.deepEqual([a.by[3].result.isError, a.by[3].result.content[0].text], [true, a.by[2].error.message]) // refused as the tool is
  assert.match(a.by[4].result.contents[0].text, /\+hello from mine/)
  assert.ok(a.by[5].result.prompts.some((x: any) => x.name === 'Fix it'), 'the templates: read-only, an agent sees them too')
})

test("laki backup and restore: a note and a workflow come back in another world; no secret, log, temp file or trash goes in; never an agent's", async t => {
  const a = await fresh(t)
  const note = await a.rpc('noteNew', { title: 'Carry me' })
  await a.rpc('flowSave', { id: 'carry', text: '# Carry\n\n## start\nnext: e\n\n## e\nend: success\n' })
  for (const f of ['tap-key', 'ai-key', 'accounts/claude-work/.credentials.json', 'daemon.log', 'trash/notes/old.json', 'widget-secrets.json', `notes/${note.id}.json.1-ab.tmp`]) {
    mkdirSync(dirname(join(a.data, f)), { recursive: true })
    writeFileSync(join(a.data, f), 'fake-secret')
  }
  const p = await a.rpc('projectAdd', { path: a.repo })
  const ws = await a.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const from = { ws: ws.id, tab: (await until(() => a.tab(ws.id))).id }
  const file = join(a.home, 'laki.tgz')
  await assert.rejects(a.rpc('dataBackup', { file, from }), /an agent can't back up the user's data/)
  await assert.rejects(a.rpc('dataRestore', { file, from }), /an agent can't restore the user's data/)
  let r = await a.cli('backup', file)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /1 notes, 0 specs, 1 workflows/)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal((await a.cli('backup', file)).code, 1, 'never over a file already there')
  const names = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean).map(n => n.replace(/^\.\//, '').replace(/\/$/, ''))
  assert.equal(names[0], 'manifest.json')
  const out = DATA_SECRETS.filter(n => !BACKUP_KEEP.includes(n))
  const glob = (g: string) => new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`)
  for (const n of names) {
    assert.ok(['manifest.json', ...BACKUP_KEEP].includes(n.split('/')[0]), n)
    assert.ok(!out.some(g => glob(g).test(n.split('/')[0])), n)
    assert.ok(!n.endsWith('.tmp'), n)
  }
  assert.ok(names.includes(`notes/${note.id}.json`) && names.includes('workflows/carry.md'), names.join(' '))

  // another world: --dry-run says what changes and changes nothing; then it's restored, the daemon restarts on it
  const b = await fresh(t)
  r = await b.cli('restore', file, '--dry-run')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /notes\s+0 → 1 \*/)
  assert.match(r.out, /Nothing changed/)
  assert.deepEqual(await b.rpc('noteList'), [])
  r = await b.cli('restore', file)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /Restored: Laki restarts now/)
  await until(() => !existsSync(join(b.data, 'daemon.lock')), 'the restore moved in and the daemon gone')
  await b.stop()
  await b.start()
  assert.deepEqual((await b.rpc('noteList')).map((n: any) => n.title), ['Carry me'])
  assert.ok((await b.rpc('flowList', {})).some((w: any) => w.id === 'carry'))
  assert.equal((await b.rpc('state')).projects[0]?.path, p.path)
  assert.ok(readdirSync(b.data).some(n => n.startsWith('backup-before-restore-')), 'what was there, set aside')
  assert.ok(!existsSync(join(b.data, 'tap-key')), "the other world's keys never came")

  // what isn't laki backup's: a file outside its names, a newer state's
  const make = (name: string, files: Record<string, string>) => {
    const d = join(b.home, name)
    mkdirSync(d, { recursive: true })
    for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text)
    execFileSync('tar', ['-czf', `${d}.tgz`, '-C', d, ...Object.keys(files)])
    return `${d}.tgz`
  }
  const manifest = (stateV: number) => JSON.stringify({ laki: '99.0.0', stateV, made: Date.now(), counts: {} })
  r = await b.cli('restore', make('extra', { 'manifest.json': manifest(1), 'state.json': '{}', 'daemon.json': '{}' }), '--dry-run')
  assert.match(r.err, /not a Laki backup: it has daemon.json/)
  r = await b.cli('restore', make('newer', { 'manifest.json': manifest(99), 'state.json': '{}' }), '--dry-run')
  assert.match(r.err, /from a newer Laki \(99.0.0, state v99/)
})
