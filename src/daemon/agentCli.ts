// A9: the agents' CLIs (Settings › Agents & profiles' Versions): each one installed, its version and the newest, how it
// was installed (npm, bun, pnpm, Homebrew, its own installer) and so how it updates; an update runs in a terminal tab
// you can watch (workspace "update agents"), its end (the tab's exit code) says how it went. The newest come from npm's
// registry (an agent's package there), looked at every 6 hours at most; `outdated` is the view's agentUpdates (a dot on
// Settings). Tests: LAKI_NPM_REGISTRY, a fake registry; none in the rig: no newest (no network)
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { AGENT_NAMES, type AgentCli, type Tab } from '../shared/types.ts'
import { isCopilot, isCursor } from '../shared/install.ts'
import { changed, log, presetOf, quickNew, run, save, sessions, spawnTab, state } from './core.ts'
import { inRig } from './dir.ts'

// each CLI: its command, the npm package that carries it (its newest version; an npm install's update), its own
// updater (installed by its own script: claude update…)
export const CLIS: { id: string; name: string; cmd: string; npm?: string; self?: string; ver?: string[] }[] = [
  { id: 'claude', name: AGENT_NAMES.claude, cmd: 'claude', npm: '@anthropic-ai/claude-code', self: 'claude update' },
  { id: 'codex', name: AGENT_NAMES.codex, cmd: 'codex', npm: '@openai/codex' },
  { id: 'gemini', name: AGENT_NAMES.gemini, cmd: 'agy', self: 'agy update' }, // Antigravity CLI: its install script's binary, not on npm (ponytail: no newest shown; agy update says)
  { id: 'grok', name: AGENT_NAMES.grok, cmd: 'grok' }, // ponytail: several CLIs carry the name: its package only from an npm install
  { id: 'opencode', name: AGENT_NAMES.opencode, cmd: 'opencode', npm: 'opencode-ai', self: 'opencode upgrade' },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor-agent', self: 'cursor-agent update' },
  { id: 'copilot', name: 'Copilot', cmd: 'copilot', npm: '@github/copilot', self: 'copilot update', ver: ['version'] }, // its docs name `copilot version`, not --version
]

const pathOf = (cmd: string) => (process.env.PATH ?? '').split(':').map(d => d && join(d, cmd)).find(p => p && realOk(p))
const realOk = (p: string) => {
  try {
    return !!realpathSync(p)
  } catch {
    return false
  }
}
// how it was installed, from where its command really is: a global node_modules (npm's, bun's, pnpm's: its package),
// Homebrew's Cellar (a formula) or Caskroom (a cask); else its own installer
export function howOf(real: string, self?: string): { how: string; pkg?: string; cmd?: string } {
  const nm = real.lastIndexOf(`${sep}node_modules${sep}`)
  if (nm >= 0) {
    const [a, b] = real.slice(nm + 14).split(sep)
    const pkg = a.startsWith('@') && b ? `${a}/${b}` : a
    const how = /[/\\]\.bun[/\\]/.test(real) ? 'bun' : /[/\\]pnpm[/\\]/.test(real) ? 'pnpm' : 'npm'
    return { how, pkg, cmd: how === 'bun' ? `bun add -g ${pkg}@latest` : how === 'pnpm' ? `pnpm add -g ${pkg}@latest` : `npm install -g ${pkg}@latest` }
  }
  const brew = /[/\\](Cellar|Caskroom)[/\\]([^/\\]+)[/\\]/.exec(real)
  if (brew) return { how: 'Homebrew', cmd: `brew upgrade ${brew[1] === 'Caskroom' ? '--cask ' : ''}${brew[2]}` }
  return { how: 'its installer', cmd: self }
}
// x.y.z (a pre-release's tail ignored): a < b
export const older = (a: string, b: string) => {
  const n = (v: string) => v.split(/[.+-]/).slice(0, 3).map(x => Number(x) || 0)
  const [x, y] = [n(a), n(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

const NEWEST_KEPT = 6 * 3600e3
let newest: { at: number; v: Record<string, string | undefined> } = { at: 0, v: {} }
async function latest(pkg: string) {
  const registry = process.env.LAKI_NPM_REGISTRY || (inRig() ? '' : 'https://registry.npmjs.org')
  if (!registry) return undefined
  const r = await fetch(`${registry}/${pkg.replace('/', '%2f')}/latest`, { signal: AbortSignal.timeout(8000), redirect: 'error' }).catch(() => null)
  const v = r?.ok ? ((await r.json().catch(() => ({}))) as { version?: unknown }).version : undefined
  return typeof v === 'string' && /^\d+\.\d+\.\d+[\w.+-]*$/.test(v) && v.length < 40 ? v : undefined
}
// updates: the last update tab of each CLI (its own until the next)
const updates = new Map<string, { tab: string; ws: string }>()
export let outdated: string[] = [] // the view's agentUpdates: the names of the CLIs with a newer version out

export async function agentVersions(p: { fresh?: boolean } = {}): Promise<AgentCli[]> {
  type Found = { c: (typeof CLIS)[number]; path?: string; version?: string; how?: string; pkg?: string; cmd?: string }
  const found = await Promise.all(
    CLIS.map(async (c): Promise<Found> => {
      const path = pathOf(c.cmd)
      if (!path) return { c }
      const real = realpathSync(path)
      const version = await run(c.cmd, c.ver ?? ['--version'], { timeout: 8000, env: { ...process.env, ...state.settings?.env } }).then(r => /\d+\.\d+\.\d+[\w.+-]*/.exec(`${r.stdout}`)?.[0], () => undefined)
      return { c, path, version, ...howOf(real, c.self) }
    }),
  )
  if (p.fresh || Date.now() - newest.at > NEWEST_KEPT) {
    const v: Record<string, string | undefined> = {}
    await Promise.all(found.map(async f => (f.path && (f.pkg ?? f.c.npm) ? (v[f.c.id] = await latest((f.pkg ?? f.c.npm)!).catch(() => undefined)) : undefined))) // none on npm (Cursor's): no newest
    newest = { at: Date.now(), v: (f => (Object.values(f).some(Boolean) ? f : newest.v))(v) } // offline: the last ones kept
  }
  const out = found.map(f => {
    const u = updates.get(f.c.id)
    const t = u && state.tabs.find(x => x.id === u.tab)
    const s = t && sessions.get(t.id)
    const update = u && t ? { tab: t.id, ws: u.ws, state: !s || !s.exited ? 'running' : s.exitCode === 0 ? 'done' : 'failed', ...(s?.exited && { code: s.exitCode ?? undefined }) } as AgentCli['update'] : undefined
    const running = state.tabs.filter(x => x.kind === 'agent' && (f.c.id === 'cursor' || f.c.id === 'copilot' ? x.preset === 'acp' && (f.c.id === 'cursor' ? isCursor : isCopilot)(presetOf(x) ?? { cmd: x.cmd, acp: true }) : x.preset === f.c.id) && sessions.get(x.id) && !sessions.get(x.id)!.exited).length
    const nv = newest.v[f.c.id]
    return { id: f.c.id, name: f.c.name, ...(f.path && { path: f.path, version: f.version, how: f.how, cmd: f.cmd }), ...(nv && { newest: nv }), ...(running && { running }), ...(update && { update }) } as AgentCli
  })
  const was = outdated.join()
  outdated = out.filter(a => a.version && a.newest && older(a.version, a.newest) && a.update?.state !== 'running').map(a => a.name)
  if (outdated.join() !== was) changed()
  return out
}
// the 6-hourly look (main.ts' ticks), for the dot on Settings; none in the rig without a fake registry
export const agentVersionsTick = () => (!inRig() || process.env.LAKI_NPM_REGISTRY ? agentVersions().catch(e => (log(`agent versions: ${(e as Error).message}`), [])) : Promise.resolve([]))

// Update (Settings' Versions, the new-workspace page's warning on a model too new for claude): its command in a tab of
// the "update agents" terminal workspace (made once, kept until you close it); one at a time per CLI
export async function agentUpdate(p: { agent: string }) {
  const c = CLIS.find(x => x.id === p.agent)
  if (!c) throw new Error(`no agent CLI ${p.agent}: ${CLIS.map(x => x.id).join(', ')}`)
  const path = pathOf(c.cmd)
  if (!path) throw new Error(`${c.name} isn't installed (${c.cmd} isn't on PATH)`)
  const { cmd } = howOf(realpathSync(path), c.self)
  if (!cmd) throw new Error(`${c.name}: Laki doesn't know how it was installed: update it the way you installed it`)
  const was = updates.get(c.id)
  const s = was && sessions.get(was.tab)
  if (s && !s.exited) throw new Error(`${c.name} is updating already`)
  let ws = state.workspaces.find(w => w.id === was?.ws && !w.archived) ?? state.workspaces.find(w => w.name === 'update agents' && w.term && !w.archived)
  if (!ws) {
    ws = await quickNew({ kind: 'shells' })
    ws.name = 'update agents'
  }
  // a script tab: it stays when its command ends, with its output and its exit code (a shell's would close)
  const t: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name: `update ${c.name}`, kind: 'script', cmd }
  state.tabs.push(t)
  save()
  spawnTab(t, { cmd })
  updates.set(c.id, { tab: t.id, ws: ws.id })
  outdated = outdated.filter(n => n !== c.name)
  changed()
  return { ws: ws.id, tab: t.id, cmd }
}
