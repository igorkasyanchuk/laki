// An MCP server an agent uses that needs a sign-in (an expired or missing OAuth login): its tab says so with Sign in,
// instead of the agent quietly working without that tool. Read off its screen (mcpAuthTick, every MCP_AUTH_MS, the live
// claude and codex tabs' last lines): codex's start-up warning names it ("The planetscale MCP server is not logged in.
// Run `codex mcp login planetscale`"); claude's /mcp list and footer say "needs authentication" (claude.ai connectors
// left out: they all say so until first used). One band per server per session (rt.mcpAuth, the view's mcpAuth).
// Sign in: codex's own `codex mcp login <name>` for the tab's account, in a script tab of the "sign in" Terminals
// workspace; once it ends well the tab starts again with its chat (codex reads its servers as it starts). claude's: /mcp
// typed in at its prompt, where you pick the server and sign in; Claude reconnects it itself. Dismiss: gone for this
// session. main.ts imports it; core keeps rt.mcpAuth for the view. ponytail: a screen read, so a server named off
// screen before the first look (a long start) is missed until the agent says it again
import { randomUUID } from 'node:crypto'
import type { Tab } from '../shared/types.ts'
import { accountFor, accountNamed, ENV } from './accounts.ts'
import { changed, presetOf, quickNew, rtOf, save, sessions, spawnTab, state, tracked, typeInto, whenPrompt, wsLog } from './core.ts'
import { agentContext } from './sees.ts'

export type McpAuth = { born: number; names: string[]; gone: string[]; login?: { tab: string; name: string } } // gone: dismissed or signed in, this session

const NAME = '[\\w.@-]{1,64}'
const CODEX = new RegExp(`The (${NAME}) MCP server is not logged in\\. Run \`codex mcp login \\1\``, 'g')
const CLAUDE = new RegExp(`(?:^|[\\s│|❯>*•·-])(${NAME})\\s*(?:[·:|-]|\\s)\\s*[^\\w\\s]{0,2}\\s*needs[ -]auth(?:entication)?\\b`, 'gim')
// the servers a screen says need a sign-in, by name
export function mcpNeeds(agent: string, text: string): string[] {
  const out = new Set<string>()
  if (agent === 'codex') for (const m of text.matchAll(CODEX)) out.add(m[1])
  if (agent === 'claude')
    for (const line of text.split('\n'))
      if (!/claude\.ai/i.test(line)) for (const m of line.matchAll(CLAUDE)) if (!/^(?:server|servers|mcp|\d+)$/i.test(m[1])) out.add(m[1])
  return [...out]
}

// a claude tab's configured MCP servers (sees.ts' agentContext: its user, project and Laki's), read once a session: a
// name on its screen counts only when it's one of them, so the agent's own words ("the API needs authentication") raise
// no band. ponytail: a plugin's servers aren't in those files: missed
const known = new Map<string, { born: number; names: Set<string> }>()
function claudeKnows(tab: Tab, born: number) {
  const k = known.get(tab.id)
  if (k?.born === born) return k.names
  let names = new Set<string>()
  try {
    names = new Set(agentContext({ agent: 'claude', project: state.workspaces.find(w => w.id === tab.workspace)?.project }).servers.map(x => x.name))
  } catch {} // none read: none counts
  known.set(tab.id, { born, names })
  return names
}

// every MCP_AUTH_MS (main.ts' ticks): each live claude and codex tab's screen; a login tab that ended well signs it in,
// once its agent isn't in a turn or waiting on an ask (a restart would end it)
export function mcpAuthTick() {
  for (const id of known.keys()) if (!state.tabs.some(t => t.id === id)) known.delete(id)
  for (const tab of state.tabs.filter(t => tracked(t) && (t.preset === 'claude' || t.preset === 'codex'))) {
    const s = sessions.get(tab.id)
    if (!s || s.exited) continue
    const r = rtOf(tab.id)
    if (r.mcpAuth && r.mcpAuth.born !== s.born) r.mcpAuth = undefined // a new session: told again
    const a = r.mcpAuth
    if (a?.login) {
      const l = sessions.get(a.login.tab)
      if (!state.tabs.some(t => t.id === a.login!.tab)) (a.login = undefined), changed() // its tab closed before it ended
      else if (l?.exited && l.exitCode !== 0) (a.login = undefined), changed() // it didn't take: the band says Sign in again
      else if (l?.exited && r.status !== 'running' && r.status !== 'waiting') { // a turn or an open ask first: a restart would drop it
        const { name } = a.login
        r.mcpAuth = undefined
        changed()
        try {
          spawnTab(tab, { resume: true }) // codex reads its servers as it starts: a new session, told again if another still needs one
          wsLog({ id: tab.workspace }, `${tab.name}: signed in to the ${name} MCP server; restarted to reconnect it`)
        } catch (e) {
          wsLog({ id: tab.workspace }, `${tab.name}: signed in to the ${name} MCP server, not restarted: ${(e as Error).message}`)
        }
        continue
      }
    }
    let found = mcpNeeds(tab.preset!, s.screenText(60)).filter(n => !a?.gone.includes(n) && !a?.names.includes(n))
    if (found.length && tab.preset === 'claude') found = (k => found.filter(n => k.has(n)))(claudeKnows(tab, s.born))
    if (!found.length) continue
    r.mcpAuth = { born: s.born, names: [...(a?.names ?? []), ...found], gone: a?.gone ?? [], ...(a?.login && { login: a.login }) }
    wsLog({ id: tab.workspace }, `${tab.name}: ${found.join(', ')} MCP ${found.length === 1 ? 'server needs' : 'servers need'} a sign-in`)
    changed()
  }
}

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
// the band's buttons: open (Sign in: the agent's own login), dismiss (gone for this session)
export async function mcpSignIn(p: { tab?: unknown; name?: unknown; act?: unknown }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) throw new Error(`no tab ${String(p.tab)}`)
  const r = rtOf(tab.id)
  const name = String(p.name ?? '')
  if (!r.mcpAuth?.names.includes(name)) throw new Error(`${tab.name} has no MCP server ${name} waiting for a sign-in`)
  if (p.act === 'dismiss') {
    r.mcpAuth.names = r.mcpAuth.names.filter(n => n !== name)
    r.mcpAuth.gone.push(name)
    changed()
    return { dismissed: true }
  }
  if (tab.preset === 'claude') return claudeMcp(tab, name)
  if (!new RegExp(`^${NAME}$`).test(name)) throw new Error(`${name}: not a server name Laki runs a login for`)
  const running = r.mcpAuth.login?.name === name && state.tabs.find(t => t.id === r.mcpAuth!.login!.tab)
  if (running && (s => !s?.exited || s.exitCode === 0)(sessions.get(running.id))) return { ws: running.workspace, tab: running.id, again: true } // its login runs, or took and its agent restarts once free: that tab, not a second one
  const acct = accountNamed(accountFor(tab, presetOf(tab)?.account) ?? '')
  const cmd = `${acct ? `${ENV.codex}=${q(acct.dir)} ` : ''}codex mcp login ${q(name)}`
  let ws = state.workspaces.find(w => w.name === 'sign in' && w.term && !w.archived)
  if (!ws) {
    ws = await quickNew({ kind: 'shells' })
    ws.name = 'sign in'
  }
  const t: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name: `sign in ${name}`, kind: 'script', cmd } // its exit says whether it took
  state.tabs.push(t)
  save()
  spawnTab(t, { cmd })
  r.mcpAuth.login = { tab: t.id, name }
  changed()
  return { ws: ws.id, tab: t.id, cmd }
}
// claude's own flow: /mcp at its prompt (a turn running: once it ends), the band gone (Claude reconnects it itself)
function claudeMcp(tab: Tab, name: string) {
  const s = sessions.get(tab.id)
  if (!s || s.exited) throw new Error(`${tab.name} isn't running: start it, then /mcp`)
  whenPrompt(s, () => typeInto(s, '/mcp'))
  const a = rtOf(tab.id).mcpAuth!
  a.names = a.names.filter(n => n !== name)
  a.gone.push(name)
  changed()
  return { typed: '/mcp' }
}
