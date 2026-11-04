// What an agent's turns leave behind: what each changed (below), the next prompt, a chat handed to the other agent.
// The next prompt (settings.nextPrompt, off unless true): as a claude or codex turn ends, Laki AI's model guesses what
// you'd send next from your last message and its answer, one line the Reader's box shows greyed out until a turn starts
// (Tab takes it). main.ts imports it (turnStarts, turnEnds), core doesn't: core keeps what the view shows on the tab's
// runtime (suggest, changes).

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { AGENT_NAMES, aiOn, type Tab, type TurnFile, type Workspace } from '../shared/types.ts'
import { addTab, changed, dir, findWs, presets, rtOf, state, storageOf, tracked, turnEnds, turnStarts, wsLog } from './core.ts'
import { diff, inside } from './files.ts'
import { chatRead } from './meters.ts'
import { aiOnce, hasKey } from './ai.ts'
import { accountEnv, accountFor } from './accounts.ts'
import { execGroup, own } from './resources.ts'

const SUGGEST_SYSTEM = `You guess the next message a developer sends their coding agent (Claude Code or Codex), from their last message and the agent's answer. Answer with that message alone: one short line, at most 15 words, in their voice, an instruction or a question ("run the tests", "now add a test for it"). No quotes, no preamble. When the answer asks them to pick or confirm, the likely pick. When there is no clear next step, answer NONE.`
const ANSWER_MAX = 6000 // the end of a long answer: what it asks is there

export async function suggestNext(tab: Tab, last: string) {
  const r = rtOf(tab.id)
  const asked = r.asked ?? ''
  try {
    const text = await aiOnce({ system: SUGGEST_SYSTEM, prompt: `Their last message:\n${asked || '(not known)'}\n\nThe agent's answer:\n${last.length > ANSWER_MAX ? `…${last.slice(-ANSWER_MAX)}` : last}`, ask: `next prompt: ${tab.name}` })
    const line = (text.trim().split('\n')[0] ?? '').replace(/^["'`“]+|["'`”]+$/g, '').trim().slice(0, 200)
    if (!line || /^none\W*$/i.test(line)) return
    if (r.status !== 'idle' || r.last !== last) return // a turn started meanwhile: it's that one's to guess
    r.suggest = line
    changed()
  } catch (e) {
    wsLog({ id: tab.workspace }, `next prompt: ${(e as Error).message}`)
  }
}

// a turn of yours that ended with an answer: not a workflow's (its next prompt is the workflow's), nothing queued after it
turnEnds.add((tab, o) => {
  const s = state.settings
  if (!s?.nextPrompt || !aiOn(s) || o.failed || o.limit || !o.last || !tracked(tab) || tab.flow || tab.queue?.length) return
  if (tab.preset !== 'claude' && tab.preset !== 'codex') return
  if ((s.ai?.backend ?? 'openrouter') === 'openrouter' && !hasKey()) return // no key: no model to ask
  void suggestNext(tab, o.last)
})

// a chat handed to the other agent (a tab's right click › Continue in Codex / Claude Code: a limit, a stuck agent): a
// new tab of it in the same worktree, told to read a handover first, a Markdown file in the storage folder (the chat as
// the Reader reads it, your messages and its answers, the newest HANDOVER_MAX; the files changed against the base). The
// old tab stays as it is. ponytail: the chat as it was said, not summed up by a model; a host's workspace (no storage
// folder) gets it in the prompt
const HANDOVER_MAX = 40_000
export async function tabHandover(o: { tab?: string; to?: string }) {
  const tab = state.tabs.find(t => t.id === o.tab)
  if (!tab || !tracked(tab) || (tab.preset !== 'claude' && tab.preset !== 'codex')) throw new Error('a Claude Code or Codex tab hands its chat over')
  const to = o.to ?? (tab.preset === 'claude' ? 'codex' : 'claude')
  if (to === tab.preset || (to !== 'claude' && to !== 'codex')) throw new Error(`to ${tab.preset === 'claude' ? 'codex' : 'claude'}: the other one`)
  const ws = findWs(tab.workspace)
  if (ws.archived) throw new Error(`${ws.name ?? ws.id} is archived: restore it first`)
  const from = AGENT_NAMES[tab.preset as 'claude']
  const said = (chatRead({ tab: tab.id }).said ?? []).filter(x => x.who === 'you' || x.who === 'agent')
  const parts: string[] = []
  let n = 0
  for (const x of [...said].reverse()) {
    const part = `### ${x.who === 'you' ? 'The user' : from}\n\n${x.text.trim()}\n`
    if (n + part.length > HANDOVER_MAX && parts.length) break
    parts.unshift(part)
    n += part.length
  }
  const d = state.projects.find(p => p.id === ws.project)?.git === false ? undefined : await diff(ws.id).catch(() => undefined)
  const changes = d?.files.length ? `${d.files.map(f => `- ${f.path} (+${f.add} −${f.del})`).join('\n')}\n\nThe whole diff: \`git diff ${d.from}\` (new files aren't committed: \`git status\`).` : 'Nothing yet.'
  const md = `# Handover from ${from}\n\n${from} worked on this task in this worktree until now; you carry on. Below: its chat with the user (${parts.length < said.length ? `the last ${parts.length} of ${said.length} messages` : 'all of it'}), then what it changed.\n\n## The chat\n\n${parts.join('\n') || '(nothing said yet)'}\n## What changed against ${d?.base ?? ws.base}\n\n${changes}\n`
  const folder = storageOf(ws)
  const file = folder && join(folder, `handover-${tab.preset}-to-${to}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.md`)
  if (file) writeFileSync(file, md, { mode: 0o600 })
  const prompt = `You're taking over this task from ${from}, which worked on it in this worktree until now. ${file ? `Read ${file} first: its chat with the user and what it changed.` : `Its chat with the user and what it changed:\n\n${md}`}\n\nThen carry on from where it stopped: check the code as it is now, don't redo what's done, and finish what the user asked last.`
  const preset = presets().find(p => p.agent === to && !p.off)?.name ?? to
  const t = addTab(ws.id, { preset, prompt, name: `${to}: continued` })
  wsLog(ws, `${tab.name} handed over to ${t.name}${file ? `: ${file}` : ''}`)
  return { tab: t.id, name: t.name, ...(file && { file }) }
}

// ---------- each turn's changes (settings.turnChanges, on unless false): a card under the Reader's last answer
// (Edited 3 files +42 −7, Review, Undo), Changes' This turn. The worktree as a tree, through an index of its own per
// workspace (<data>/turns/<ws>.index: git add -A, write-tree; the worktree's own index never touched), as a turn starts
// (claude's UserPromptSubmit; codex has no start: its last turn's end) and as it ends: what differs is the turn's. Undo
// writes those files back as they were before it, only while they're still as it left them.
// ponytail: the last turn per tab, in memory (a restart forgets it); this Mac's git workspaces (no host); a tree is a
// loose object git may prune after two weeks
export const TURN_FILES = 50
const turnDir = join(dir, 'turns')
const execP = promisify(execFile)
type Turn = { before: string; after: string; files: TurnFile[] }
const cuts = new Map<string, { start?: Promise<string | undefined>; last?: string; turn?: Turn }>() // by tab
const lines = new Map<string, Promise<unknown>>() // by workspace: one git add at a time on its index
const g = (ws: Workspace, args: string[], env?: NodeJS.ProcessEnv) => execP('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', ...args], { cwd: ws.path, env: env ?? process.env, maxBuffer: 64 << 20 }).then(r => r.stdout)
// the worktree as a tree, untracked files too (verify.ts' Done check takes it as well)
export function treeOf(ws: Workspace) {
  const run = async () => {
    mkdirSync(turnDir, { recursive: true, mode: 0o700 })
    const idx = join(turnDir, `${ws.id}.index`)
    const env = { ...process.env, GIT_INDEX_FILE: idx }
    if (!existsSync(idx))
      try {
        copyFileSync(resolve(ws.path, (await g(ws, ['rev-parse', '--git-path', 'index'])).trim()), idx) // its stat data: add -A hashes only what changed
      } catch {
        await g(ws, ['read-tree', 'HEAD'], env).catch(() => {}) // a repo with no commit yet: none
      }
    await g(ws, ['add', '-A'], env)
    return (await g(ws, ['write-tree'], env)).trim()
  }
  const p = (lines.get(ws.id) ?? Promise.resolve()).then(run, run)
  lines.set(ws.id, p.catch(() => {}))
  return p
}
const wsFor = (tab: Tab) => {
  const ws = state.workspaces.find(w => w.id === tab.workspace)
  const ok = ws && !ws.archived && !ws.host && state.settings?.turnChanges !== false && tracked(tab) && (tab.preset === 'claude' || tab.preset === 'codex') && state.projects.find(p => p.id === ws.project)?.git !== false && existsSync(ws.path)
  return ok ? ws : undefined
}
const cutOf = (id: string) => cuts.get(id) ?? (cuts.set(id, {}), cuts.get(id)!)
const said = (ws: Workspace, e: unknown) => (wsLog(ws, `turn's changes: ${(e as Error).message}`), undefined)
turnStarts.add(tab => {
  const ws = wsFor(tab)
  if (!ws) return
  const c = cutOf(tab.id)
  c.start = treeOf(ws).catch(e => said(ws, e))
  c.turn = rtOf(tab.id).changes = undefined // the card is the last turn's: not while the next one works or asks
})
turnEnds.add(tab => {
  const ws = wsFor(tab)
  if (ws) void turnEnded(tab, ws)
})
async function turnEnded(tab: Tab, ws: Workspace) {
  const c = cutOf(tab.id)
  const start = c.start
  c.start = undefined
  try {
    const before = (await start) ?? c.last
    const after = await treeOf(ws)
    c.last = after
    const r = rtOf(tab.id)
    const files = before && before !== after ? await filesOf(ws, before, after) : []
    c.turn = files.length ? { before: before!, after, files } : undefined
    r.changes = files.length ? { at: Date.now(), add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0), n: files.length, files: files.slice(0, TURN_FILES) } : undefined
    changed()
  } catch (e) {
    said(ws, e)
  }
}
// the files that differ between two trees: git's status (no renames: a rename is its delete and its add) and lines
async function filesOf(ws: Workspace, from: string, to: string): Promise<TurnFile[]> {
  const [names, nums] = await Promise.all([g(ws, ['diff', '--no-renames', '-z', '--name-status', from, to]), g(ws, ['diff', '--no-renames', '-z', '--numstat', from, to])])
  const st = names.split('\0')
  const lines = new Map<string, [number, number]>()
  for (const x of nums.split('\0').filter(Boolean)) {
    const [add, del, path] = x.split('\t')
    lines.set(path, [Number(add) || 0, Number(del) || 0]) // a binary file's - -: none
  }
  const out: TurnFile[] = []
  for (let i = 0; i + 1 < st.length; i += 2) if (st[i]) out.push({ path: st[i + 1], status: st[i][0], add: lines.get(st[i + 1])?.[0] ?? 0, del: lines.get(st[i + 1])?.[1] ?? 0 })
  return out
}

// This turn in Changes: the newest turn of the workspace's tabs that changed something, as diff() gives a diff
export async function turnDiff(o: { ws?: string; tab?: string }) {
  const tabs = state.tabs.filter(t => (o.tab ? t.id === o.tab : t.workspace === o.ws))
  const tab = tabs.filter(t => cuts.get(t.id)?.turn).sort((a, b) => (rtOf(b.id).changes?.at ?? 0) - (rtOf(a.id).changes?.at ?? 0))[0]
  const t = tab && cuts.get(tab.id)!.turn!
  if (!tab || !t) throw new Error('no turn changed anything here yet')
  const ws = findWs(tab.workspace)
  const text = await g(ws, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', t.before, t.after])
  const MAX = 4 << 20
  return { base: `${tab.name}'s last turn`, from: t.before, files: t.files, diff: text.replace(/\n$/, '').slice(0, MAX), tab: tab.id }
}

// Undo: the turn's files as they were before it (those it added removed), while each is still as it left them
export async function turnUndo(o: { tab?: string }) {
  const tab = state.tabs.find(x => x.id === o.tab)
  const t = tab && cuts.get(tab.id)?.turn
  if (!tab || !t) throw new Error('nothing to undo: its last turn changed nothing')
  if (rtOf(tab.id).status === 'running') throw new Error(`${tab.name} is working: wait for its turn to end, or stop it`)
  const ws = findWs(tab.workspace)
  const now = await treeOf(ws)
  const paths = t.files.map(f => f.path)
  const moved = (await g(ws, ['diff', '--no-renames', '-z', '--name-only', t.after, now, '--', ...paths])).split('\0').filter(Boolean)
  if (rtOf(tab.id).status === 'running' || cuts.get(tab.id)?.turn !== t) throw new Error(`${tab.name} started another turn meanwhile: nothing undone`)
  if (moved.length) throw new Error(`changed since the turn: ${moved.slice(0, 5).join(', ')}${moved.length > 5 ? ` and ${moved.length - 5} more` : ''}`)
  const back = t.files.filter(f => f.status !== 'A').map(f => f.path)
  if (back.length) await g(ws, ['restore', `--source=${t.before}`, '--worktree', '--', ...back])
  for (const f of t.files)
    if (f.status === 'A')
      try {
        rmSync(inside(ws, f.path), { force: true }) // inside: links followed, never a file outside the worktree
      } catch {}
  const c = cutOf(tab.id)
  c.turn = undefined
  c.last = await treeOf(ws).catch(() => undefined) // codex's next turn starts from here (it has no start of its own)
  rtOf(tab.id).changes = undefined
  wsLog(ws, `${tab.name}'s last turn undone: ${paths.length} file${paths.length === 1 ? '' : 's'}`)
  changed()
  return { files: paths.length }
}

// hourly (main.ts): the indexes of workspaces gone or archived, the turns of tabs closed
export function turnsTidy() {
  const live = new Set(state.workspaces.filter(w => !w.archived).map(w => `${w.id}.index`))
  for (const f of existsSync(turnDir) ? readdirSync(turnDir) : []) if (!live.has(f)) rmSync(join(turnDir, f), { force: true })
  for (const id of cuts.keys()) if (!state.tabs.some(t => t.id === id)) cuts.delete(id)
  for (const id of sides.keys()) if (!state.tabs.some(t => t.id === id)) sides.delete(id) // closed tabs' side chats
}

// Side chat (a tab's menu, the Reader's head: SideChat.tsx): a quick question about what an agent is doing, answered
// beside it while it works, its own chat clean. Claude Code's: its chat forked (claude -p --resume <its chat>
// --fork-session, then that fork's own session), read-only tools, in its workspace's folder on its account; Codex's and
// others': Laki AI's model given its chat so far (chatRead). Send to main chat is the app's (send, whenIdle).
// ponytail: in memory, a chat per tab; one window's ask is the others' only once they ask sideState
export type SideSaid = { who: 'you' | 'agent'; text: string; at: number }
const sides = new Map<string, { session?: string; said: SideSaid[]; busy?: boolean }>()
const SIDE_NOTE = "The user asks a quick question on the side while the main session goes on: answer it from this chat and the files (you can read them, not change them). Change nothing, run nothing; short answers."
const SIDE_CHAT = 30000 // the codex chat's end given to Laki AI's model
// the side chats' own claude sessions (forks in the workspace's folder): Import chats leaves them out
export const sideSessions = () => new Set([...sides.values()].flatMap(s => (s.session ? [s.session] : [])))
const forks = (tab: Tab) => tab.preset === 'claude' && !state.workspaces.find(w => w.id === tab.workspace)?.host // its chat forked, else Laki AI given it
const sideOf = (tab: string) => sides.get(tab) ?? (sides.set(tab, { said: [] }), sides.get(tab)!)
export function sideState(p: { tab: string }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) throw new Error('no such tab')
  const s = sideOf(tab.id)
  return { said: s.said, busy: !!s.busy, forks: forks(tab) }
}
export function sideNew(p: { tab: string }) {
  if (sides.get(p.tab)?.busy) throw new Error('it is answering: wait for it')
  sides.delete(p.tab)
  return { said: [] }
}
export async function sideAsk(p: { tab: string; text: string }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab || tab.kind !== 'agent') throw new Error('a side chat is about an agent tab')
  const q = String(p.text ?? '').trim().slice(0, 8000)
  if (!q) throw new Error('what do you want to ask?')
  const ws = findWs(tab.workspace)
  const s = sideOf(tab.id)
  if (s.busy) throw new Error('it is still answering the last one')
  s.busy = true
  s.said = [...s.said, { who: 'you', text: q, at: Date.now() }]
  changed()
  try {
    let text: string
    if (forks(tab)) {
      const from = s.session ?? tab.resumeId
      if (!from) throw new Error(`${tab.name} has no chat yet: ask once it has started one`)
      const args = ['-p', '--output-format', 'json', '--resume', from, ...(s.session ? [] : ['--fork-session']), '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--append-system-prompt', SIDE_NOTE, '--', q]
      const env = { ...process.env, ...state.settings?.env, ...accountEnv(accountFor(tab, tab.profile)) }
      const out = await new Promise<string>((ok, no) => {
        const c = execGroup('claude', args, { cwd: ws.path, env, maxBuffer: 16 << 20, timeout: 600_000 }, (e, so, se) => (e && !/"is_error"\s*:\s*true/.test(so) ? no(new Error(`claude: ${e.code === 'ENOENT' ? 'not installed (not on PATH)' : e.killed ? 'took too long' : se.trim().split('\n').pop() || e.message}`)) : ok(so))) // aiOnce's words
        own(c, `Side chat · ${tab.name}`)
      })
      const j = JSON.parse(out)
      if (j.is_error) throw new Error(j.result || j.subtype || 'claude failed')
      s.session = j.session_id ?? s.session
      text = String(j.result ?? '').trim()
    } else {
      if (!aiOn(state.settings) || ((state.settings?.ai?.backend ?? 'openrouter') === 'openrouter' && !hasKey())) throw new Error("a side chat about this agent uses Laki AI's model: turn Laki AI on (Settings › AI)")
      const chat = chatRead({ tab: tab.id })
      if (!('said' in chat) || !Array.isArray(chat.said)) throw new Error(`Laki can't read ${tab.name}'s chat: a side chat works with Claude Code and Codex, on this Mac`)
      const said = chat.said.map((x: { who: string; text: string }) => `${x.who === 'you' ? 'User' : x.who === 'agent' ? 'Agent' : 'Tool'}: ${x.text}`).join('\n\n')
      const before = s.said.slice(0, -1).map(x => `${x.who === 'you' ? 'Q' : 'A'}: ${x.text}`).join('\n\n')
      text = (await aiOnce({ system: `${SIDE_NOTE} You only have the chat below, not the files.`, prompt: `The main chat so far (its end):\n${said.length > SIDE_CHAT ? `…${said.slice(-SIDE_CHAT)}` : said || '(nothing yet)'}\n\n${before ? `Earlier side questions:\n${before}\n\n` : ''}The question: ${q}`, ask: `side chat: ${q.slice(0, 80)}` })).trim()
    }
    s.said = [...s.said, { who: 'agent', text: text || '(no answer)', at: Date.now() }]
    return { text }
  } catch (e) {
    s.said = s.said.slice(0, -1) // the question back to the box, not left unanswered
    throw e
  } finally {
    s.busy = false
    changed()
  }
}
