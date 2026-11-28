// npm run usage:check [-- --scan] [-- --limits] [-- --no-check]: Laki's usage ledger (<data>/usage-days.json, LAKI_HOME or this Mac's
// data folder) against a recount of every Claude and Codex chat in it from its transcripts, with share.ts' meterOf and
// the ledger's own owners (an answer counts for the chat that owns it; one nobody owns, for this one). Per chat and in
// all: the kept tokens and ≈ cost and the recount's; fails past 1% in all, or for a chat of 10K tokens or more. Rows from
// before parts (0.68.0's, pre) are listed, not failed; a chat whose transcript is gone is listed as gone. Only the days
// the ledger keeps are recounted. --scan: the machine scan's worker on this Mac's chats, timed (cold, then again with
// its state: what changed only); --limits: Claude Code's get_usage, timed. It only reads: never the data folder, a
// transcript, ~/.claude or ~/.codex (the scan's state stays in memory). Not in check, test or dmg.
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJson, dataDir } from '../src/shared/conn.ts'
import { costOf, type OwnPrice, priceYours } from '../src/shared/types.ts'
import { isOld, meterNew, meterOf, type Row, rowCost, rowTokens } from '../src/daemon/share.ts'
import { type FileState, scan } from '../src/daemon/usageScanWorker.ts'

type Chat = { ws: string; agent: string; days: Record<string, Record<string, Row>>; keys?: Record<string, string>; pre?: Record<string, Record<string, Row>> }
const data = dataDir()
const kept = readJson<{ chats: Record<string, Chat> }>(join(data, 'usage-days.json'))
const settings = readJson<{ settings?: { prices?: Record<string, OwnPrice> } }>(join(data, 'state.json'))?.settings
priceYours.of = () => settings?.prices // yours, as the daemon prices them
const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const scanFiles = readJson<{ files?: Record<string, FileState> }>(join(data, 'usage-scan-v1.json'))?.files ?? {}

// a file's text, a chunk of whole lines at a time (a transcript can pass node's longest string)
function* chunks(f: string) {
  const size = statSync(f).size
  const fd = openSync(f, 'r')
  try {
    for (let pos = 0; pos < size; ) {
      const buf = Buffer.alloc(Math.min(64 << 20, size - pos))
      const n = readSync(fd, buf, 0, buf.length, pos)
      const cut = n === size - pos ? n : buf.subarray(0, n).lastIndexOf(10) + 1
      if (!cut) break
      yield buf.subarray(0, cut).toString('utf8')
      pos += cut
    }
  } finally {
    closeSync(fd)
  }
}
const ls = (d: string) => {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}
// a chat's transcripts: the scan's (its state names each file's chat), else where its agent keeps them (claude: its
// session file and subagents; codex: its rollout and the threads it spawned, by their first lines)
let codexAll: { f: string; id?: string; parent?: string }[] | undefined
function filesOf(id: string, agent: string): string[] {
  const known = Object.entries(scanFiles).filter(([, s]) => s.chat === id).map(([f]) => f).filter(f => existsSync(f))
  if (known.length) return known
  if (agent === 'claude') {
    const out: string[] = []
    for (const d of ls(join(claudeHome, 'projects'))) {
      const f = join(claudeHome, 'projects', d, `${id}.jsonl`)
      if (existsSync(f)) out.push(f)
      for (const s of ls(join(claudeHome, 'projects', d, id, 'subagents'))) if (s.endsWith('.jsonl')) out.push(join(claudeHome, 'projects', d, id, 'subagents', s))
    }
    return out
  }
  codexAll ??= (() => {
    const all: { f: string; id?: string; parent?: string }[] = []
    const walk = (d: string, n: number): void => void ls(d).forEach(x => (n < 3 ? walk(join(d, x), n + 1) : x.startsWith('rollout-') && x.endsWith('.jsonl') && all.push({ f: join(d, x) })))
    walk(join(codexHome, 'sessions'), 0)
    for (const r of all) {
      const head = chunks(r.f).next().value?.split('\n', 1)[0] ?? ''
      r.id = /"id"\s*:\s*"([0-9a-f-]{36})"/i.exec(head)?.[1]
      r.parent = /"parent_thread_id"\s*:\s*"([0-9a-f-]{36})"/i.exec(head)?.[1]
    }
    return all
  })()
  const ids = new Set([id])
  const out: string[] = []
  for (let grew = true; grew; ) {
    grew = false
    for (const r of codexAll) if (!out.includes(r.f) && ((r.id && ids.has(r.id)) || (r.parent && ids.has(r.parent)))) out.push(r.f), r.id && ids.add(r.id), (grew = true)
  }
  return out
}

function check() {
  if (!kept) return console.log(`No ledger in ${data} (usage-days.json): nothing to check`), true
  const owners = new Map<string, string>()
  for (const [id, c] of Object.entries(kept.chats)) for (const s of Object.values(c.keys ?? {})) for (let i = 0; i + 11 <= s.length; i += 11) owners.set(s.slice(i, i + 11), id)
  const from = Date.now() - 90 * 864e5
  const timeOf = (day: string) => (([y, m, d]) => new Date(y, m - 1, d).getTime())(day.split('-').map(Number))
  type Line = { id: string; agent: string; kt: number; kc: number; rt: number; rc: number; old: number; gone?: true }
  const lines: Line[] = []
  for (const [id, c] of Object.entries(kept.chats)) {
    if (c.agent !== 'claude' && c.agent !== 'codex') continue
    let kt = 0
    let kc = 0
    let old = 0
    for (const models of Object.values(c.days)) for (const [m, r] of Object.entries(models)) isOld(r) ? (old += rowTokens(r)) : ((kt += rowTokens(r)), (kc += rowCost(m, r) ?? 0))
    for (const models of Object.values(c.pre ?? {})) for (const r of Object.values(models)) old += rowTokens(r)
    const files = filesOf(id, c.agent)
    if (!files.length) {
      lines.push({ id, agent: c.agent, kt, kc, rt: 0, rc: 0, old, gone: true })
      continue
    }
    const once = new Set<string>() // a key counted in one of its files only (a spawned thread's copy of its parent's turns)
    let rt = 0
    let rc = 0
    for (const f of files) {
      const m = meterNew()
      const owns = (key: string) => (owners.get(key) ?? id) === id && !once.has(key) && !!once.add(key)
      for (const text of chunks(f)) meterOf(c.agent, text, m, Date.now(), owns)
      for (const [day, by] of Object.entries(m.days ?? {})) {
        // the days the ledger keeps (90 back), not one with a row from before parts (listed above, not recounted)
        if (timeOf(day) < from || c.pre?.[day] || Object.values(c.days[day] ?? {}).some(isOld)) continue
        for (const [model, p] of Object.entries(by)) (rt += Object.values(p).reduce((a, b) => a + b, 0)), (rc += costOf(model, p) ?? 0)
      }
    }
    lines.push({ id, agent: c.agent, kt, kc, rt, rc, old })
  }
  const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : a ? 100 : 0)
  const fmt = (n: number) => n.toLocaleString('en-US')
  const bad = (l: Line) => !l.gone && Math.max(l.kt, l.rt) >= 10_000 && Math.abs(pct(l.kt, l.rt)) > 1
  console.log(`${'chat'.padEnd(38)} ${'agent'.padEnd(6)} ${'kept'.padStart(13)} ${'recount'.padStart(13)} ${'Δ%'.padStart(7)} ${'kept $'.padStart(9)} ${'recount $'.padStart(9)}  note`)
  for (const l of lines.sort((a, b) => b.rt - a.rt)) {
    const note = [l.gone && 'transcript gone', l.old && `${fmt(l.old)} tokens kept before parts (listed)`, bad(l) && 'PAST 1%'].filter(Boolean).join('; ')
    console.log(`${l.id.padEnd(38)} ${l.agent.padEnd(6)} ${fmt(l.kt).padStart(13)} ${(l.gone ? '–' : fmt(l.rt)).padStart(13)} ${(l.gone ? '' : `${pct(l.kt, l.rt).toFixed(2)}`).padStart(7)} ${l.kc.toFixed(2).padStart(9)} ${(l.gone ? '' : l.rc.toFixed(2)).padStart(9)}  ${note}`)
  }
  const live = lines.filter(l => !l.gone)
  const sum = (k: 'kt' | 'kc' | 'rt' | 'rc') => live.reduce((n, l) => n + l[k], 0)
  const [kt, kc, rt, rc] = [sum('kt'), sum('kc'), sum('rt'), sum('rc')]
  console.log(`\n${lines.length} chats (${lines.length - live.length} with their transcript gone, ${lines.filter(l => l.old).length} with rows from before parts)`)
  console.log(`In all (transcripts on disk): kept ${fmt(kt)} tokens, $${kc.toFixed(2)}; recount ${fmt(rt)} tokens, $${rc.toFixed(2)}: ${pct(kt, rt).toFixed(3)}% tokens, ${pct(kc, rc).toFixed(3)}% cost`)
  const fails = live.filter(bad)
  const ok = Math.abs(pct(kt, rt)) <= 1 && Math.abs(pct(kc, rc)) <= 1 && !fails.length
  console.log(ok ? 'OK: within 1%' : `FAILED: ${fails.length} chat(s) past 1%${Math.abs(pct(kt, rt)) > 1 || Math.abs(pct(kc, rc)) > 1 ? ', and the total' : ''}`)
  return ok
}

// the machine scan's worker on this Mac's chats, in this process (its state in memory, nothing written): cold, then again
async function timedScan() {
  const accounts = (readJson<{ settings?: { accounts?: { agent: string; dir: string }[] } }>(join(data, 'state.json'))?.settings?.accounts ?? []).filter(a => existsSync(a.dir))
  const input = { claude: [claudeHome, ...accounts.filter(a => a.agent === 'claude').map(a => a.dir)], codex: [codexHome, ...accounts.filter(a => a.agent === 'codex').map(a => a.dir)], grok: join(homedir(), '.grok', 'sessions'), agy: join(homedir(), '.gemini', 'antigravity-cli', 'conversations'), files: {} as Record<string, FileState>, since: Date.now() - 90 * 864e5 }
  for (const what of ['first scan (cold)', 'a later scan (what changed)']) {
    const t0 = performance.now()
    const c0 = process.cpuUsage()
    let recs = 0
    let files = 0
    await scan(input, o => {
      recs += o.recs.length
      for (const [f, s] of Object.entries(o.files)) s ? ((input.files[f] = s), files++) : delete input.files[f]
    })
    const cpu = process.cpuUsage(c0)
    console.log(`${what}: ${((performance.now() - t0) / 1000).toFixed(2)} s, CPU ${((cpu.user + cpu.system) / 1e6).toFixed(2)} s, ${files} files read, ${recs} records; peak memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`)
  }
}

// Claude Code's get_usage, as usage.ts asks it: its wall time to the answer and its CPU (ps, before it's ended)
async function timedLimits() {
  const t0 = performance.now()
  const c = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--settings', '{"disableAllHooks":true}'], { stdio: ['pipe', 'pipe', 'ignore'], cwd: homedir() })
  c.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'i', request: { subtype: 'initialize' } })}\n${JSON.stringify({ type: 'control_request', request_id: 'u', request: { subtype: 'get_usage', skip_behaviors: true } })}\n`)
  const got = await new Promise<string>(ok => {
    let buf = ''
    c.stdout.setEncoding('utf8').on('data', d => {
      buf += d
      const m = buf.split('\n').map(l => { try { return JSON.parse(l) } catch { return undefined } }).find(x => x?.response?.request_id === 'u')
      if (m) ok(m.response.subtype === 'success' ? `${Object.keys(m.response.response?.rate_limits ?? {}).length} rate_limits fields` : String(m.response.error))
    })
    setTimeout(() => ok('no answer in 20 s'), 20_000)
  })
  const wall = (performance.now() - t0) / 1000
  const cpu = (() => {
    try {
      return execFileSync('ps', ['-o', 'cputime=', '-p', String(c.pid)], { encoding: 'utf8' }).trim()
    } catch {
      return '?'
    }
  })()
  c.kill()
  console.log(`get_usage: ${wall.toFixed(2)} s to its answer (${got}), its CPU ${cpu}`)
}

const ok = process.argv.includes('--no-check') || check() // --no-check: the timings alone (the scan's memory its own)
if (process.argv.includes('--scan')) await timedScan()
if (process.argv.includes('--limits')) await timedLimits()
process.exitCode = ok ? 0 : 1
