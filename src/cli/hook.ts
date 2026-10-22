// `laki hook <state> [json]`: what agents' hooks run (core.ts hookArgv), on its own so a hook loads conn.ts only, not
// the whole CLI (a node start per tool call). It runs as it's loaded: as the entry, or imported by main.ts' `hook`,
// the same argv either way. It never fails or blocks the agent for more than a second.
import { rpc } from '../shared/conn.ts'

const [, , , state, extra] = process.argv
setTimeout(() => process.exit(0), 1000) // never hold the agent up
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
await rpc('hook', { tab, state, payload }, 700).catch(() => {})
process.exit(0)
