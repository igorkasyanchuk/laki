// #5: an MCP server marked One process for every agent: one process, every agent's config naming its URL on the daemon
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

// a stdio MCP server: initialize, tools/list, tools/call echoing its pid; each start a line in starts.txt
const SERVER = `const fs = require('fs'); fs.appendFileSync(process.argv[2], process.pid + '\\n'); let buf = ''
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l)
  const out = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...r }) + '\\n')
  if (m.method === 'initialize') out({ result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } })
  else if (m.method === 'tools/list') out({ result: { tools: [{ name: 'pid', inputSchema: { type: 'object' } }] } })
  else if (m.method === 'tools/call') out({ result: { content: [{ type: 'text', text: 'pid ' + process.pid + ' ' + JSON.stringify(m.params.arguments) }] } })
  else if (m.id !== undefined) out({ error: { code: -32601, message: 'no ' + m.method } }) } })`

test('#5: a shared MCP server: one process for every agent, over HTTP on the daemon with each tab its key; off, it stops', async t => {
  const rig = await fresh(t)
  const server = join(rig.home, 'echo-mcp.cjs')
  const starts = join(rig.home, 'starts.txt')
  writeFileSync(server, SERVER)
  writeFileSync(starts, '')
  await rig.rpc('settingsSet', { mcp: [{ name: 'echo', command: process.execPath, args: [server, starts], shared: true }] })
  assert.equal((await rig.rpc('state')).settings.mcp[0].shared, true)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const urlOf = async (ws: string) => {
    const run = await until(() => rig.fakeLog().filter(l => l.bin === 'claude' && l.args.includes('--mcp-config')).find(l => l.cwd?.includes(ws) ?? true), 'claude up')
    return JSON.parse(readFileSync(run.args[run.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.echo
  }
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'a' })
  const ea = await urlOf(a.id)
  assert.equal(ea.type, 'http')
  assert.match(ea.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{16}\/[\w-]+$/) // its key never in the URL (codex's would be on argv)
  assert.match(ea.headers.Authorization, /^Bearer [0-9a-f]{40}$/)
  const tabA = (await rig.tab(a.id)).id
  assert.ok(ea.url.endsWith(`/${tabA}`))
  assert.equal(readFileSync(starts, 'utf8'), '', 'started at the first call, not before')
  const keys = new Map<string, string>([[ea.url, ea.headers.Authorization]])
  const call = (url: string, body: object, head: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: keys.get(url) ?? '', ...head }, body: JSON.stringify(body) })
  const init = await call(ea.url, { jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
  assert.equal(init.status, 200)
  assert.deepEqual(await init.json(), { jsonrpc: '2.0', id: 7, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } })
  assert.equal((await call(ea.url, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
  const one = await (await call(ea.url, { jsonrpc: '2.0', id: 'x', method: 'tools/call', params: { name: 'pid', arguments: { n: 1 } } })).json()
  assert.equal(one.id, 'x')
  const pid = /^pid (\d+) /.exec(one.result.content[0].text)![1]
  // a second agent: its own key, the same process
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'b' })
  await until(async () => (await rig.tab(b.id))?.id, 'b up')
  const tabB = (await rig.tab(b.id)).id
  const eb = await until(() => rig.fakeLog().filter(l => l.bin === 'claude' && l.args.includes('--mcp-config')).map(l => JSON.parse(readFileSync(l.args[l.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.echo).find((e: { url: string }) => e.url.endsWith(`/${tabB}`)), "b's claude up")
  const fromB: string = eb.url
  assert.equal(fromB, ea.url.replace(`/${tabA}`, `/${tabB}`))
  assert.notEqual(eb.headers.Authorization, ea.headers.Authorization, 'a key per tab')
  keys.set(fromB, eb.headers.Authorization)
  const two = await (await call(fromB, [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pid', arguments: { n: 2 } } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }])).json()
  assert.equal(two[0].result.content[0].text, `pid ${pid} {"n":2}`)
  assert.equal(two[1].result.tools[0].name, 'pid')
  assert.equal(readFileSync(starts, 'utf8').trim().split('\n').length, 1, 'one process')
  // another tab's key, none, a page's Origin, a GET: refused
  assert.equal((await call(fromB, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: ea.headers.Authorization })).status, 404)
  assert.equal((await call(fromB, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: '' })).status, 404)
  assert.equal((await call(fromB, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://evil.example' })).status, 403)
  assert.equal((await fetch(fromB, { headers: { authorization: keys.get(fromB)! } })).status, 405)
  // not shared any more: its process stops, its URL is gone
  await rig.rpc('settingsSet', { mcp: [{ name: 'echo', command: process.execPath, args: [server, starts] }] })
  await until(() => { try { process.kill(Number(pid), 0); return false } catch { return true } }, 'its process stopped')
  assert.equal((await call(fromB, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 404)
})
