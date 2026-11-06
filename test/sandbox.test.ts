import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fresh, until } from './helpers.ts'

// a raw /rpc from a sandboxed agent's tab, with no from or caller said: who calls is the daemon's to find (whoCalls)
test("a sandboxed agent: the refusals hold without from; what it starts is sandboxed; no terminal, Run ▾ action or ! line outside it", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', sandbox: true, name: 'boxed' })
  const tab = await until(() => rig.tab(ws.id))
  const shell = (await rig.rpc('tabNew', { ws: ws.id })).id // yours: a terminal in its workspace
  const other = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id // yours, not sandboxed
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab.id}` })).includes('> '), 'its prompt')
  const script = join(rig.home, 'raw.mjs')
  writeFileSync(script, `import { readFileSync } from 'node:fs'
const { port, token } = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const r = await fetch('http://127.0.0.1:' + port + '/rpc', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ method: process.argv[3], params: JSON.parse(process.argv[4]) }) })
console.log(process.argv[3] + ' ' + process.argv[5] + ': ' + (await r.text()).replace(/\\n/g, ' '))
`)
  const out = join(rig.home, 'out')
  const calls: [string, object, string][] = [
    ['accountRm', { id: 'nope' }, 'rm'],
    ['tabAccount', { tab: tab.id, account: 'nope' }, 'move'],
    ['imageRead', { path: '/nope.png' }, 'pic'],
    ['tabNew', { ws: ws.id, preset: 'claude', sandbox: false }, 'unboxed'],
    ['tabNew', { ws: ws.id, preset: 'claude', name: 'kid' }, 'kid'],
    ['tabNew', { ws: ws.id }, 'shell'],
    ['wsNew', { project: p.id, preset: 'shell', name: 'sh' }, 'wsshell'],
    ['wsNew', { project: p.id, preset: 'gemini', name: 'gm' }, 'gemini'],
    ['run', { ws: ws.id, script: 'dev' }, 'run'],
    ['send', { target: `${ws.id}/${shell}`, text: 'touch /tmp/x' }, 'toshell'],
    ['input', { tab: shell, data: 'touch /tmp/x\r' }, 'keys'],
    ['send', { target: `${ws.id}/${other}`, text: '!touch /tmp/x' }, 'bang'],
    ['send', { target: `${ws.id}/${other}`, text: 'ok\n!touch /tmp/x' }, 'bang2'],
    ['input', { tab: other, data: '\u0015!touch /tmp/x\r' }, 'bang3'],
    ['send', { target: `${ws.id}/${other}`, text: 'hello' }, 'hello'],
  ]
  const line = calls.map(([m, params, tag]) => `${process.execPath} ${script} ${join(rig.data, 'daemon.json')} ${m} '${JSON.stringify(params)}' ${tag} >> ${out} 2>&1`).join('; ')
  await rig.rpc('send', { target: `${ws.id}/${tab.id}`, text: `run ${line}; echo done >> ${out}` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'it ran', 60000)
  const said = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').filter(l => l !== 'done').map(l => [l.split(' ')[1].replace(/:$/, ''), l]))
  assert.match(said.rm, /an agent can't remove one of the user's accounts/)
  assert.match(said.move, /an agent can't move a tab to another of the user's accounts/)
  assert.match(said.pic, /an agent can't read a picture anywhere/)
  assert.match(said.unboxed, /outside its profile's sandbox/)
  for (const k of ['shell', 'wsshell']) assert.match(said[k], /a sandboxed agent can't open a terminal/, k)
  assert.match(said.gemini, /gemini has no sandbox here/)
  assert.match(said.run, /a sandboxed agent can't start a Run ▾ action/)
  assert.match(said.toshell, /a sandboxed agent can't send into/)
  assert.match(said.keys, /a sandboxed agent can't type into/)
  for (const k of ['bang', 'bang2', 'bang3']) assert.match(said[k], /a sandboxed agent can't send a ! line/, k) // its start, a later line's, after a control key
  assert.doesNotMatch(said.hello, /error/i, 'a prompt to another agent still goes')
  const tabs = (await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id)
  assert.equal(tabs.find((x: any) => x.name === 'kid')?.sandbox, true, 'its new tab: sandboxed')
  assert.equal(tabs.length, 4, 'nothing else made')
  assert.ok(!(await rig.rpc('state')).workspaces.some((w: any) => w.name === 'sh' || w.name === 'gm'))
  rmSync(out, { force: true })
})
