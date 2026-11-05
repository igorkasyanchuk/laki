// `laki hook <state> [json]` (`ping`: exits 0, doctor's check): what agents' hooks run (core.ts hookArgv), on its own so a hook loads conn.ts only, not
// the whole CLI (a node start per tool call). It runs as it's loaded: as the entry, or imported by main.ts' `hook`,
// the same argv either way. It never fails or blocks the agent for more than a second, but for claude's PreToolUse
// while an extension's tool gate is on (the daemon's tool-gates file, widgetEvents.ts toolGate): up to TOOL_WAIT,
// then what the daemon answered (a deny, a changed input) printed as claude's JSON; no answer: the call goes
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, rpc } from '../shared/conn.ts'

const TOOL_WAIT = 3500 // the daemon's TOOL_GATE_MS and its own time
const [, , , state, extra] = process.argv
if (state === 'ping') process.exit(0) // doctor's: the command runs, nothing sent
let quit = setTimeout(() => process.exit(0), 1000) // never hold the agent up
const tab = process.env.LAKI_TAB
if (!tab) process.exit(0)
let payload: unknown = {}
try {
  if (extra) payload = JSON.parse(extra)
  else if (!process.stdin.isTTY) {
    const text = await new Promise<string>(r => {
      let s = ''
      process.stdin.on('data', d => (s += d)).on('end', () => r(s)).on('error', () => r(s))
      setTimeout(() => r(s), 400)
    })
    if (text.trim()) payload = JSON.parse(text)
  }
} catch {}
const gated = state === 'running' && (payload as { hook_event_name?: unknown })?.hook_event_name === 'PreToolUse' && existsSync(join(dataDir(), 'tool-gates'))
if (gated) clearTimeout(quit), (quit = setTimeout(() => process.exit(0), TOOL_WAIT + 100))
const key = process.env.LAKI_HOOK // this tab's start's (core.ts spawnTab): the daemon takes a tab's state with it only
// at: when this hook started (the process's start), so the daemon can tell one run in the background that comes late
const said = await rpc('hook', { tab, state, payload, at: Math.round(performance.timeOrigin), ...(key && { key }) }, gated ? TOOL_WAIT : 700).catch(() => undefined)
// a pipe's write past its buffer ends later (macOS): exit once it's out, a second at most
if (gated && said && typeof said === 'object' && 'hookSpecificOutput' in said) clearTimeout(quit), (quit = setTimeout(() => process.exit(0), 1000)), process.stdout.write(JSON.stringify(said), () => process.exit(0))
else process.exit(0)
