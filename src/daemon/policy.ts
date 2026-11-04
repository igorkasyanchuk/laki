// A managed policy for teams: what an admin deploys (MDM's managed preferences, or a file) and the user can't change
// in Laki. Read as the daemon starts and every 5 minutes (policyTick), from the first that's there: LAKI_POLICY (a
// file: the test rig's only), /Library/Managed Preferences/dev.laki.app.plist (a configuration profile's; plutil reads it as JSON),
// /Library/Application Support/Laki/policy.json (macOS), /etc/laki/policy.json (Linux). Its keys:
//   settings: { <a Settings key>: value }: locked to that value (null: unset), settingsSet refuses another
//   remote: false        no remote access (remoteStart refused)
//   bypass: false        approvals required: no agent starts in a mode, or with args, that never ask (neverAsks)
//   agents: [ids]        only these agents start (claude, codex, gemini, grok, opencode)
// The view's `managed` says what's locked (Settings' banner). ponytail: what's running isn't stopped, a tab made
// before a lock restarts as it was; checked as tabs are made
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { neverAsks } from '../shared/types.ts'
import { changed, log, save, state } from './core.ts'
import { inRig } from './dir.ts'

export type Policy = { settings?: Record<string, unknown>; remote?: false; bypass?: false; agents?: string[]; from: string }
// LAKI_POLICY in the test rig only (dir.ts' inRig): read first, a file holding {} would cancel what an admin deployed
const SOURCES = () => [inRig() && process.env.LAKI_POLICY, '/Library/Managed Preferences/dev.laki.app.plist', '/Library/Application Support/Laki/policy.json', '/etc/laki/policy.json'].filter((x): x is string => !!x)
let now: Policy | undefined
let said = ''
export const policy = () => now

function read(): Policy | undefined {
  for (const f of SOURCES()) {
    if (!existsSync(f)) continue
    try {
      const j = JSON.parse(f.endsWith('.plist') ? execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', f], { encoding: 'utf8', timeout: 5000 }) : readFileSync(f, 'utf8'))
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object')
      const settings = j.settings && typeof j.settings === 'object' && !Array.isArray(j.settings) ? (j.settings as Record<string, unknown>) : undefined
      const agents = Array.isArray(j.agents) ? j.agents.filter((a: unknown): a is string => typeof a === 'string') : undefined
      return { from: f, ...(settings && { settings }), ...(j.remote === false && { remote: false as const }), ...(j.bypass === false && { bypass: false as const }), ...(agents && { agents }) }
    } catch (e) {
      // a policy that doesn't read locks nothing: said once in daemon.log (an admin's typo shouldn't lock the user out)
      if (said !== `${f}:${(e as Error).message}`) log(`policy ${f} unreadable: ${(said = `${f}:${(e as Error).message}`).slice(f.length + 1)}`)
    }
  }
}

// read it again and put its locked settings in place
export function policyTick() {
  now = read()
  const s = (state.settings ??= {}) as Record<string, unknown>
  let moved = false
  for (const [k, v] of Object.entries(now?.settings ?? {})) {
    if (JSON.stringify(s[k] ?? null) === JSON.stringify(v ?? null)) continue
    if (v === null || v === undefined) delete s[k]
    else s[k] = v
    moved = true
  }
  if (moved) save(), log(`policy ${now!.from}: settings locked`)
  changed()
}

// settingsSet's: a locked one only as the policy has it (sent back unchanged is fine: Settings saves them all)
export function policySettings(o: Record<string, unknown>) {
  for (const [k, v] of Object.entries(now?.settings ?? {})) if (k in o && JSON.stringify(o[k] ?? null) !== JSON.stringify(v ?? null)) throw new Error(`${k} is managed by your organization`)
}
// a new agent tab's (core's tabSpec): an agent the policy allows, and approvals when it says so
export function policyAgent(agent: string, perm?: string, args?: string) {
  if (!now) return
  if (now.agents && !now.agents.includes(agent) && !['shell', 'custom'].includes(agent)) throw new Error(`${agent} is turned off by your organization`)
  if (now.bypass === false && neverAsks(agent, perm, args)) throw new Error(`your organization requires approvals: ${agent} can't start in a mode that never asks`)
}
// remoteStart's
export function policyRemote() {
  if (now?.remote === false) throw new Error('remote access is turned off by your organization')
}
// the view's: what's locked, for Settings' banner
export const managedView = () => now && { from: now.from, keys: Object.keys(now.settings ?? {}), ...(now.remote === false && { remote: false as const }), ...(now.bypass === false && { bypass: false as const }), ...(now.agents && { agents: now.agents }) }
