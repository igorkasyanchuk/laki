// #3: a worker that can't go on, told once to its lead: the agent tab that started its workspace (laki new from its tab,
// the workspace's fromTab: Created by). Why it stopped and the next step go into the lead's own chat (queued for its
// turn's end, as Laki's own sends are), on the worker's tab view (stuck: laki wait's line, the workers dock's row), and
// in the workspace's log. Once per stretch: the key (its kind and the turn it hit) is kept on the tab (state.json), so a
// restart doesn't say it again; a Stop you pressed, a clean end or a tab you closed never counts
import type { Tab, TabStuck } from '../shared/types.ts'
import { log, rtOf, save, send, sessions, state, tracked, wsLog } from './core.ts'
import { meterView } from './meters.ts'

export const SILENT_MS = Number(process.env.LAKI_STUCK_SILENT_MS) || 10 * 60_000 // no output, or retrying an API error, this long
export const BG_MS = Number(process.env.LAKI_STUCK_BG_MS) || 20 * 60_000 // its turn ended with a background task still running

const AGENT_WORDS: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Antigravity', grok: 'Grok', opencode: 'OpenCode' }
const hm = (ms: number) => (d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${ms - Date.now() > 20 * 3600e3 ? ` ${d.toDateString().slice(4, 10)}` : ''}`)(new Date(ms)) // 14:20; a day off: its date too

// what it says, by kind: why (a line) and the next step (laki's words for the lead)
export function stuckWords(t: Tab, kind: TabStuck['kind'], o: { reset?: number; failed?: string; code?: number; retry?: string; bg?: string } = {}) {
  const ws = state.workspaces.find(w => w.id === t.workspace)
  const ref = ws?.name || t.workspace
  const other = t.preset === 'codex' ? 'claude' : 'codex'
  const again = `laki send ${ref} "continue"`
  const agent = AGENT_WORDS[t.preset ?? ''] ?? t.preset ?? 'its agent'
  switch (kind) {
    case 'limit':
      return { why: `${agent} plan limit${o.reset ? ` (resets ${hm(o.reset)})` : ''}`, next: `${again} after the reset, or start its task again on another agent: laki new <project> --preset ${other} --prompt "<its task>"` }
    case 'failed':
      return { why: `its turn failed (its error: "${(o.failed ?? 'an API error').replace(/\s+/g, ' ').slice(0, 200)}")`, next: `${again} to try again, or laki screen ${ref} to see it` }
    case 'exited':
      return { why: `its process ended mid-turn${o.code !== undefined ? ` (code ${o.code})` : ''}`, next: `laki screen ${ref} for its last screen; Enter in its tab (the user's) starts it again with its chat, or laki tab ${ref} --preset ${t.preset ?? 'claude'} starts a new one without it` }
    case 'retrying':
      return { why: `it has retried an API error for ${Math.round(SILENT_MS / 60_000)} minutes${o.retry ? ` (${o.retry})` : ''}`, next: `wait for it, or laki send ${ref} --interrupt "stop and say where you are" and start the task again on another agent` }
    case 'silent':
      return { why: `nothing from it for ${Math.round(SILENT_MS / 60_000)} minutes mid-turn`, next: `laki screen ${ref} to see where it is; laki send ${ref} "continue" if it stopped` }
    case 'background':
      return { why: `its turn ended ${Math.round(BG_MS / 60_000)} minutes ago with a background task still running${o.bg ? ` (${o.bg})` : ''}`, next: `wait for it (laki wait ${ref} again), or laki send ${ref} "check on your background task"` }
  }
}

// a worker's stuck stretch: on its view, then told to its lead once (key: the kind and the turn it hit)
export function stuck(t: Tab, kind: TabStuck['kind'], o: Parameters<typeof stuckWords>[2] = {}) {
  const ws = state.workspaces.find(w => w.id === t.workspace)
  if (!ws?.fromTab || !tracked(t)) return // no lead: the user's own workspace, told as before
  const r = rtOf(t.id)
  const key = `${kind}:${r.stretchAt ?? 0}` // the stretch since its turn began (runAt goes as it idles)
  const { why, next } = stuckWords(t, kind, o)
  r.stuck = { kind, why, next, at: Date.now() }
  if (t.stuckTold === key) return
  t.stuckTold = key
  save()
  wsLog(ws, `${t.name} stuck: ${why}`)
  const lead = state.tabs.find(x => x.id === ws.fromTab)
  const s = lead && sessions.get(lead.id)
  if (!lead || !s || s.exited || !tracked(lead)) return // its lead gone: the view and laki wait say it
  try {
    send({ target: lead.id, text: `Laki: your worker ${ws.name || ws.id} (${t.name}) stopped: ${why}.\nNext: ${next}`, whenIdle: true }) // why: Laki's words; an error's own quoted and cut (stuckWords)
  } catch (e) {
    log(`stuck ${t.id}: ${(e as Error).message}`)
  }
}

// a running worker's long silence or retry, and an ended turn's background task (core's sweepRunning, every few seconds)
export function stuckScan(t: Tab, now: number) {
  const ws = state.workspaces.find(w => w.id === t.workspace)
  if (!ws?.fromTab) return
  const r = rtOf(t.id)
  const s = sessions.get(t.id)
  if (!s || s.exited) return
  if (r.status === 'running') {
    const m = meterView(t)
    if (m.retry && m.retry.until > now) r.retryFrom ??= now // retrying since: its first retry seen this stretch
    else r.retryFrom = undefined
    if (r.retryFrom !== undefined && now - r.retryFrom > SILENT_MS) return stuck(t, 'retrying', { retry: m.retry?.why })
    if (now - s.lastOutput > SILENT_MS && !m.background?.now.length) return stuck(t, 'silent')
    if (r.stuck && (r.stuck.kind === 'silent' || r.stuck.kind === 'retrying') && now - s.lastOutput < SILENT_MS) r.stuck = undefined // it spoke again
    return
  }
  if (r.status !== 'idle' || !r.endAt) return
  const bg = meterView(t).background?.now ?? []
  if (r.stuck?.kind === 'background' && !bg.length) r.stuck = undefined // it ended
  else if (!r.stuck && bg.length && now - r.endAt > BG_MS) stuck(t, 'background', { bg: bg[0]?.name })
}
