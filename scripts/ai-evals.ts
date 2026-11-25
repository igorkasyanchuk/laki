// Laki AI's tool choice against a real model (npm run eval:ai -- --model <id>): each ask in scripts/ai-evals.json is
// sent through the AI page's own method (aiAsk) to a daemon in a demo world of its own (scripts/demo.ts in a temp
// folder: never ~/.laki), and the first tool the model calls is compared with what the ask expects. Not in npm test,
// check, dmg or release: it needs the network and costs money.
//   OPENROUTER_API_KEY=… npm run eval:ai -- --model anthropic/claude-sonnet-5.5 [--only id,id] [--out dir]
// The key never reaches a file or a log: the daemon talks to a proxy here on 127.0.0.1 (LAKI_AI_API) that adds it on
// the way to OpenRouter; the daemon keeps a stand-in key. --api <url>: another upstream on this Mac (tests' fake
// OpenRouter, no key needed). A removal Laki AI asks about (laki_archive's, laki_remove's card) is answered No, so
// nothing is removed. dist/ai-evals/<date>.json gets each ask's result; the table says pass or fail, the total, the
// last run's and the money spent (its call log's costs)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Expect = { id: string; ask: string; tool: string[]; args?: Record<string, unknown>; asks?: boolean }
export type Call = { name: string; args: Record<string, unknown> }
// lookups a model may make first (ids it needs): the call compared is the first after them, unless the ask expects one
export const LOOKUPS = new Set(['laki_state', 'laki_find', 'laki_profiles', 'laki_project', 'laki_help'])
// an expected argument: words found in it (any case), every item of a list in it, an object's keys each so; else equal
const fits = (want: unknown, got: unknown): boolean =>
  typeof want === 'string'
    ? String(typeof got === 'string' ? got : JSON.stringify(got ?? '')).toLowerCase().includes(want.toLowerCase())
    : Array.isArray(want)
      ? Array.isArray(got) && want.every(w => got.some(g => fits(w, g)))
      : want && typeof want === 'object'
        ? !!got && typeof got === 'object' && Object.entries(want).every(([k, v]) => fits(v, (got as Record<string, unknown>)[k]))
        : want === got
export function judge(e: Expect, calls: Call[], asked = false): { pass: boolean; why: string; got?: Call } {
  const got = e.tool.some(t => LOOKUPS.has(t)) ? calls[0] : (calls.find(c => !LOOKUPS.has(c.name)) ?? calls[0])
  if (!got) return { pass: false, why: 'no tool called' }
  if (!e.tool.includes(got.name)) return { pass: false, why: `called ${got.name}, not ${e.tool.join(' or ')}`, got }
  const off = Object.entries(e.args ?? {}).filter(([k, v]) => !fits(v, got.args?.[k]))
  if (off.length) return { pass: false, why: `${got.name} without ${off.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}`, got }
  if (e.asks && !asked) return { pass: false, why: `${got.name} without asking first`, got }
  return { pass: true, why: '', got }
}
// a tool line of the chat (ai.ts runTool's say: "<name> <its args' JSON>")
export const callOf = (text: string): Call => {
  const i = text.indexOf(' ')
  const name = i < 0 ? text : text.slice(0, i)
  try {
    return { name, args: i < 0 ? {} : JSON.parse(text.slice(i + 1)) }
  } catch {
    return { name, args: {} }
  }
}

const root = fileURLToPath(new URL('..', import.meta.url))
const flag = (k: string) => (i => (i >= 0 ? process.argv[i + 1] : undefined))(process.argv.indexOf(`--${k}`))

async function main() {
  const local = flag('api')
  if (local && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/.test(local)) throw new Error('--api: an upstream on this Mac only (http://127.0.0.1:…)')
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key && !local) throw new Error('OPENROUTER_API_KEY is needed (read from the environment only, never written anywhere)')
  const model = flag('model') ?? (local ? 'anthropic/claude-sonnet-5.5' : undefined)
  if (!model) throw new Error('--model <id>, as OpenRouter names it (anthropic/claude-sonnet-5.5)')
  const only = flag('only')?.split(',')
  const asks = (JSON.parse(readFileSync(flag('asks') ?? join(root, 'scripts/ai-evals.json'), 'utf8')) as Expect[]).filter(e => !only || only.includes(e.id))
  const out = flag('out') ?? join(root, 'dist/ai-evals')
  const upstream = (local ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  // the proxy: the daemon's requests to upstream, the key added here (in memory only)
  const proxy: Server = createServer(async (q, r) => {
    const chunks: Buffer[] = []
    for await (const c of q) chunks.push(c as Buffer)
    const headers: Record<string, string> = { 'content-type': String(q.headers['content-type'] ?? 'application/json'), 'x-title': 'Laki evals' }
    if (key) headers.authorization = `Bearer ${key}`
    const res = await fetch(`${upstream}${q.url}`, { method: q.method, headers, ...(chunks.length && { body: Buffer.concat(chunks) }) }).catch((e: Error) => e)
    if (res instanceof Error) return void r.writeHead(502).end(JSON.stringify({ error: { message: res.message } }))
    r.writeHead(res.status, { 'content-type': res.headers.get('content-type') ?? 'application/json' })
    if (res.body) for await (const c of res.body) r.write(c)
    r.end()
  })
  await new Promise<void>(ok => proxy.listen(0, '127.0.0.1', ok))
  const home = mkdtempSync(join(tmpdir(), 'laki-evals-'))
  let rpc: (<T = any>(method: string, params?: object) => Promise<T>) | undefined
  try {
    // the demo world, its daemon told where Laki AI's API is (the proxy)
    const demo = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts/demo.ts'), home], { env: { ...process.env, OPENROUTER_API_KEY: '', LAKI_AI_API: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` }, stdio: ['ignore', 'pipe', 'inherit'] })
    let said = ''
    demo.stdout.on('data', d => (said += d))
    await new Promise(ok => demo.on('exit', ok))
    const made = said.split('\n').map(l => (l.startsWith('{') ? JSON.parse(l) : undefined)).find(x => x?.url) as { url: string } | undefined
    if (!made) throw new Error(`the demo world didn't start: ${said.slice(-300)}`)
    const u = new URL(made.url.replace('#', '?'))
    const [port, token] = [u.searchParams.get('port'), u.searchParams.get('token')]
    rpc = async (method, params = {}) => {
      const r = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'http://127.0.0.1:5199' }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(180_000) })
      const j = (await r.json()) as { result?: any; error?: string | { message?: string } }
      if (j.error) throw new Error(typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error)))
      return j.result
    }
    await rpc('aiKey', { key: 'stand-in-the-proxy-adds-the-real-one' })
    const s = (await rpc<{ settings: { ai?: object } }>('stateOwn')).settings
    await rpc('settingsSet', { ai: { ...s.ai, on: true, backend: 'openrouter', models: { openrouter: model } } })
    const rows: { id: string; ask: string; pass: boolean; why: string; got?: Call }[] = []
    for (const e of asks) {
      await rpc('aiNew') // the AI page's New chat: each ask on its own, the one before kept among its earlier chats
      const err = await rpc('aiAsk', { text: e.ask }).then(() => '', (x: Error) => x.message)
      const st = await rpc<{ chat: { role: string; text: string; ask?: { id: string; options: string[]; act?: object; picked?: string } }[] }>('aiState')
      const calls = st.chat.filter(m => m.role === 'tool').map(m => callOf(m.text))
      const cards = st.chat.filter(m => m.ask?.act && m.ask.picked === undefined)
      for (const c of cards) await rpc('aiAnswer', { id: c.ask!.id, n: Math.max(1, c.ask!.options.findIndex(o => /^(no|keep|cancel)/i.test(o))) }).catch(() => {}) // No: nothing removed
      const j = judge(e, calls, cards.length > 0 || st.chat.some(m => !!m.ask))
      rows.push({ id: e.id, ask: e.ask, ...j, ...(err && !j.pass && { why: `${j.why} (${err})` }) })
      console.log(`${j.pass ? 'pass' : 'FAIL'}  ${e.id.padEnd(18)} ${j.pass ? (j.got?.name ?? '') : rows.at(-1)!.why}`)
    }
    // the money: the run's call log (the temp world's)
    const log = join(home, 'data', 'ai-calls.jsonl')
    const spent = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).reduce((a, l) => a + (Number((JSON.parse(l) as { cost?: number }).cost) || 0), 0) : 0
    mkdirSync(out, { recursive: true })
    const before = readdirSync(out).filter(f => /^\d{4}-.*\.json$/.test(f)).sort().at(-1)
    const last = before ? (JSON.parse(readFileSync(join(out, before), 'utf8')) as { passed: number; total: number }) : undefined
    const passed = rows.filter(r => r.pass).length
    const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`)
    writeFileSync(file, JSON.stringify({ model, at: Date.now(), passed, total: rows.length, spent, rows }, null, 2))
    console.log(`\n${passed} of ${rows.length} passed${last ? ` (last run: ${last.passed} of ${last.total})` : ''} · $${spent.toFixed(4)} spent · ${file}`)
    return { passed, total: rows.length, file }
  } finally {
    await rpc?.('shutdown').catch(() => {})
    proxy.close()
    await new Promise(ok => setTimeout(ok, 500))
    rmSync(home, { recursive: true, force: true })
  }
}

if (import.meta.main) main().then(r => process.exit(r.passed === r.total ? 0 : 1), e => (console.error(`eval:ai: ${(e as Error).message}`), process.exit(2)))
