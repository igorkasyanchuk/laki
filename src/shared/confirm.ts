// Settings › General's "Confirm risky actions with Touch ID" (settings.touchId, macOS): the actions it asks for, each with
// the words Touch ID's prompt says ("Laki is trying to …"). The renderer never decides: main prompts and, on success,
// mints a ticket (the daemon's ticketMint: 30 s, single use, bound to one of these) that the call carries; with the
// setting on, the daemon refuses these without one (main.ts' ticketNo), from the app's token too. The ticket rides as a call's touchTicket. touchIdOn: turning
// the setting on asks first too, though the daemon has nothing to hold then
import { neverAsks, type Preset } from './types.ts'

export const CONFIRM = {
  remoteStart: 'start remote access',
  remotePair: 'pair a device with remote access',
  bypass: 'turn on Bypass permissions',
  bypassNew: 'start an agent with Bypass permissions',
  hookSecret: "show a webhook's secret",
  uiReset: 'reset the interface',
  touchIdOff: 'stop asking for Touch ID before risky actions',
  touchIdOn: 'ask for Touch ID before risky actions',
} as const
export type ConfirmWhat = keyof typeof CONFIRM
export const confirmKnown = (w: unknown): w is ConfirmWhat => typeof w === 'string' && Object.hasOwn(CONFIRM, w)
export const TICKET_MS = 30_000

// which of CONFIRM a call is, as the daemon has things now (cur: its settings' touchId and presets): a running tab
// switched to Bypass (tabMode), a profile saved as one that never asks that wasn't one (presetSave, or Settings'
// whole list), Touch ID turned off; undefined: none
type P = Record<string, unknown> | undefined
type Cur = { touchId?: boolean; presets?: Preset[]; agent?: string } // agent: settings.agent, a new workspace's when it names none
const bypassed = (x: Partial<Preset>, was?: Preset) => neverAsks(x.agent, x.perm, x.args) && !(was && neverAsks(was.agent, was.perm, was.args))
// a new tab's agent that never asks: its profile's, or the call's perm over it ('': the agent's own), as core's makeWs and tabSpec read them
const startsBypassed = (preset: string, perm: unknown, cur: Cur) => {
  const pr = cur.presets?.find(x => x.name === preset)
  return neverAsks(pr?.agent ?? preset, perm === undefined ? pr?.perm : String(perm) || undefined, pr?.args)
}
export function confirmOf(method: string, p: P, cur: Cur = {}): ConfirmWhat | undefined {
  if (method === 'remoteStart' || method === 'remotePair' || method === 'hookSecret' || method === 'uiReset') return method
  if (method === 'tabMode') return p?.mode === 'bypassPermissions' ? 'bypass' : undefined
  // a workspace, a tab or a race started with Bypass on (wsNew's preset: the default agent unless a command; tabNew's: none is a shell)
  if (method === 'wsNew' && p) {
    const preset = p.preset ? String(p.preset) : typeof p.cmd === 'string' && p.cmd.trim() ? '' : cur.agent || 'claude' // '': a command of its own
    return preset && startsBypassed(preset, p.perm, cur) ? 'bypassNew' : undefined
  }
  if (method === 'tabNew' && p) {
    if (!p.preset || (p.kind && p.kind !== 'agent')) return // a shell, a script
    // kind 'agent': tabSpec takes preset as the agent itself, no profile, and perm as its mode
    return (p.kind ? neverAsks(String(p.preset), typeof p.perm === 'string' ? p.perm || undefined : undefined) : startsBypassed(String(p.preset), p.perm, cur)) ? 'bypassNew' : undefined
  }
  // a scheduled task on a profile that never asks: each run starts it so (schedule.ts' wsNew and addTab, no ticket then)
  // a new one that names none (the CLI's laki schedule): the default agent, as schedule.ts' scheduleSet picks it
  if (method === 'scheduleSet' && p) {
    const preset = typeof p.preset === 'string' && p.preset ? p.preset : !p.id && !p.workflow && !p.widget ? (cur.agent && cur.presets?.some(x => x.name === cur.agent && x.agent !== 'command') ? cur.agent : 'claude') : ''
    return preset && startsBypassed(preset, undefined, cur) ? 'bypassNew' : undefined
  }
  if (method === 'wsFan' && Array.isArray(p?.presets)) return p.presets.some(x => startsBypassed(String(x), undefined, cur)) ? 'bypassNew' : undefined
  if (method === 'presetSave' && p?.set && typeof p.set === 'object') {
    const was = cur.presets?.find(x => x.name === String(p.name ?? ''))
    return bypassed({ ...was, ...(p.set as Partial<Preset>) }, was) ? 'bypass' : undefined
  }
  if (method === 'settingsSet') {
    if (p?.touchId === false && cur.touchId) return 'touchIdOff'
    if (Array.isArray(p?.presets) && (p.presets as Partial<Preset>[]).some(x => x && typeof x === 'object' && bypassed(x, cur.presets?.find(y => y.name === x.name)))) return 'bypass'
  }
}
