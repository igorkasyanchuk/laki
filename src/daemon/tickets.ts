// Linked tickets: a project's Ticket script (Settings › its section › Scripts › Ticket, or .laki.json's `ticket`,
// trusted as its setup is) prints a workspace's ticket in Linear, Jira or anything with a CLI: JSON { key, title,
// status, url }, else a line "KEY title" (nothing: none). Run in each live workspace on this Mac every
// TICKET_EVERY and as its branch moves, its env the workspace's (LAKI_BRANCH, LAKI_BASE, LAKI_WORKSPACE…); one at a
// time, 20 s each. The view's `ticket`: the row's key and status, the Board's and the hover card's title. ponytail:
// not on an SSH host or a codespace; in memory (a restart runs them again)
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Ticket, Workspace } from '../shared/types.ts'
import { changed, log, plainEnv, projectConfig, state } from './core.ts'

const TICKET_EVERY = Number(process.env.LAKI_TICKET_MS || 300_000)
const seen = new Map<string, { at: number; branch?: string; cmd: string; t?: Ticket }>()
let going = false
export const ticketOf = (ws: string) => seen.get(ws)?.t

const cut = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : undefined)
// what a script printed: its JSON, else its first line (KEY title)
export function ticketFrom(out: string): Ticket | undefined {
  const s = out.trim()
  if (!s) return
  try {
    const j = JSON.parse(s)
    const o = Array.isArray(j) ? j[0] : j
    const key = cut(o?.key ?? o?.identifier ?? o?.id, 40)
    if (!key) return
    const url = cut(o.url, 2000)
    return { key, ...((x => x && { title: x })(cut(o.title, 200))), ...((x => x && { status: x })(cut(typeof o.status === 'object' ? o.status?.name : o.status, 40))), ...(url && /^https?:\/\//.test(url) && { url }) }
  } catch {}
  const m = /^(\S{1,40})\s*(.*)$/.exec(s.split('\n')[0].trim())
  return m ? { key: m[1], ...(m[2] && { title: m[2].slice(0, 200) }) } : undefined
}

function runOne(ws: Workspace, cmd: string): Promise<string> {
  return new Promise(ok => {
    const p = state.projects.find(x => x.id === ws.project)
    const env = { ...plainEnv(), ...state.settings?.env, ...projectConfig(ws).env, LAKI_WORKSPACE: ws.id, LAKI_WORKSPACE_NAME: ws.name ?? ws.id, LAKI_PROJECT: p?.name ?? ws.project, LAKI_BRANCH: ws.branch ?? '', LAKI_BASE: ws.base ?? '', PORT: String(ws.port ?? '') }
    const c = spawn(process.env.SHELL || '/bin/sh', ['-lc', cmd], { cwd: ws.path, env, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const t = setTimeout(() => c.kill(), 20_000)
    c.stdout.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(0, 64_000)))
    c.on('error', () => (clearTimeout(t), ok('')))
    c.on('close', code => (clearTimeout(t), ok(code === 0 ? out : '')))
  })
}

// each due workspace's script (TICKET_EVERY since its last, its branch moved, or the script changed); main.ts' timer
export async function ticketTick(now = Date.now()) {
  if (going) return
  going = true
  try {
    let moved = false
    for (const ws of state.workspaces) {
      const cmd = !ws.archived && !ws.host && !ws.codespace && !state.projects.find(p => p.id === ws.project)?.archived ? projectConfig(ws).ticket?.trim() : undefined
      const had = seen.get(ws.id)
      if (!cmd) {
        if (had) seen.delete(ws.id), (moved = true)
        continue
      }
      if (had && had.cmd === cmd && had.branch === ws.branch && now - had.at < TICKET_EVERY) continue
      if (!existsSync(ws.path)) continue
      const t = ticketFrom(await runOne(ws, cmd))
      if (JSON.stringify(t) !== JSON.stringify(had?.t)) moved = true
      seen.set(ws.id, { at: now, branch: ws.branch, cmd, t })
    }
    if (moved) changed()
  } catch (e) {
    log(`tickets: ${(e as Error).message}`)
  } finally {
    going = false
  }
}
