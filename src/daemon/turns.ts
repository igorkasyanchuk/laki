// What an agent's turns leave behind: what each changed (below), the next prompt, a chat handed to the other agent.
// The next prompt (settings.nextPrompt, off unless true): as a claude or codex turn ends, Laki AI's model guesses what
// you'd send next from your last message and its answer, one line the Reader's box shows greyed out until a turn starts
// (Tab takes it). main.ts imports it (turnStarts, turnEnds), core doesn't: core keeps what the view shows on the tab's
// runtime (suggest, changes).

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { basename, join, sep } from 'node:path'
import { AGENT_NAMES, aiOn, type Tab, type TurnFile, type TurnKept, type Workspace } from '../shared/types.ts'
import { addTab, broadcast, changed, findWs, input, presets, rtOf, save, sessions, state, storageOf, tabsOf, tracked, turnEnds, turnStarts, wsLog, wsNew } from './core.ts'
import { phoneLong } from './phone.ts'
import { widgetEvent } from './widgets.ts'
import { dir } from './dir.ts'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { diff, g, inside, treeOf, turnDir } from './files.ts'
import { chatRead } from './meters.ts'
import { aiOnce, hasKey } from './ai.ts'
import { accountEnv, accountFor, accountNamed, homeDir } from './accounts.ts'
import { transcriptOf } from './share.ts'
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

// settings.longTurn (minutes): a turn at work that long says so, once. Only working time counts, tick by tick: not an ask
// or a plan limit it waits on, and a gap between ticks (the Mac asleep) counts as LONG_GAP at most
const LONG_GAP = 300_000
const longs = new Map<string, { worked: number; at?: number; said?: boolean }>()
turnEnds.add(tab => void longs.delete(tab.id))
turnStarts.add(tab => void longs.delete(tab.id)) // an Esc ends a turn with no hook: the next one starts over
const spell = (ms: number) => (m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`))(Math.round(ms / 60000))
export function longTurnTick(now = Date.now()) {
  const min = Number(state.settings?.longTurn)
  if (!(min > 0)) return longs.clear(), []
  const told: string[] = []
  for (const tab of state.tabs.filter(tracked)) {
    const r = rtOf(tab.id)
    const s = sessions.get(tab.id)
    if (r.status === 'idle' || !s || s.exited) { // sweepRunning's end has no hook
      longs.delete(tab.id)
      continue
    }
    const l = longs.get(tab.id) ?? { worked: 0 }
    longs.set(tab.id, l)
    if (r.status !== 'running' || r.limit) {
      l.at = undefined
      continue
    }
    if (l.at) l.worked += Math.max(0, Math.min(now - l.at, LONG_GAP))
    l.at = now
    if (l.said || l.worked < min * 60000) continue
    l.said = true
    told.push(tab.id)
    const ws = state.workspaces.find(w => w.id === tab.workspace)
    const name = ws?.name || tab.workspace
    const text = `${name} has been working for ${spell(l.worked)}`
    broadcast({ ev: 'long', tab: tab.id, ws: tab.workspace, name, text })
    phoneLong(tab, text)
    widgetEvent('turn.long', { minutes: Math.round(l.worked / 60000) }, tab.workspace, tab)
  }
  return told
}
// the notification's Stop: that turn's Esc. A notification outlives its turn: under a later turn, or an ask (Esc would answer it), nothing
export function longStop(p: { tab?: unknown }) {
  const id = String(p.tab ?? '')
  const stopped = !!longs.get(id)?.said && rtOf(id).status === 'running'
  if (stopped) input(id, '\x1b')
  return { stopped }
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
// the chat the agent has now: the Reader's lines after its last New session (a /clear), not the earlier ones it shows above
const sinceNew = <T extends { who: string }>(said: T[]) => said.slice(said.findLastIndex(x => x.who === 'new') + 1)
export async function tabHandover(o: { tab?: string; to?: string }) {
  const tab = state.tabs.find(t => t.id === o.tab)
  if (!tab || !tracked(tab) || (tab.preset !== 'claude' && tab.preset !== 'codex')) throw new Error('a Claude Code or Codex tab hands its chat over')
  const to = o.to ?? (tab.preset === 'claude' ? 'codex' : 'claude')
  if (to === tab.preset || (to !== 'claude' && to !== 'codex')) throw new Error(`to ${tab.preset === 'claude' ? 'codex' : 'claude'}: the other one`)
  const ws = findWs(tab.workspace)
  if (ws.archived) throw new Error(`${ws.name ?? ws.id} is archived: restore it first`)
  const from = AGENT_NAMES[tab.preset as 'claude']
  const said = sinceNew(chatRead({ tab: tab.id }).said ?? []).filter(x => x.who === 'you' || x.who === 'agent')
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
  const folder = storageOf(ws)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const chat = parts.join('\n')
  const pics = folder ? await handoverPics(tab, ws, chat, join(folder, `handover-${stamp}`)) : { text: chat, list: [] } // ponytail: a host's workspace (no storage folder) carries none
  const picsMd = pics.list.length ? `## Pictures and files\n\nFrom the chat, copied here: open each first (Claude Code: Read; Codex: view_image).\n\n${pics.list.map(x => `- ${x}`).join('\n')}\n\n` : ''
  const md = `# Handover from ${from}\n\n${from} worked on this task in this worktree until now; you carry on. Below: its chat with the user (${parts.length < said.length ? `the last ${parts.length} of ${said.length} messages` : 'all of it'}), then what it changed.\n\n## The chat\n\n${pics.text || '(nothing said yet)'}\n${picsMd}## What changed against ${d?.base ?? ws.base}\n\n${changes}\n`
  const file = folder && join(folder, `handover-${tab.preset}-to-${to}-${stamp}.md`)
  if (file) writeFileSync(file, md, { mode: 0o600 })
  const prompt = `You're taking over this task from ${from}, which worked on it in this worktree until now. ${file ? `Read ${file} first: its chat with the user and what it changed${pics.list.length ? `, then each picture and file it lists (Claude Code: Read; Codex: view_image)` : ''}.` : `Its chat with the user and what it changed:\n\n${md}`}\n\nThen carry on from where it stopped: check the code as it is now, don't redo what's done, and finish what the user asked last.`
  const preset = presets().find(p => p.agent === to && !p.off)?.name ?? to
  const t = addTab(ws.id, { preset, prompt, name: `${to}: continued` })
  wsLog(ws, `${tab.name} handed over to ${t.name}${file ? `: ${file}` : ''}`)
  return { tab: t.id, name: t.name, ...(file && { file }) }
}

// a handover's pictures and files: Claude's pasted pictures (base64 image blocks in its transcript), Codex's (data:
// URLs, local_images' paths), and paths the chat names in Laki's pasted images or files, the workspace's storage folder
// or the temp folder: copied to <storage>/handover-<stamp>/ (0700, files 0600), each path in the text rewritten to its
// copy. Not one inside the worktree (the next agent reads it there), a secret's name, over 10 MB, nor past the newest 20;
// a picture once (Codex's transcript has each twice: its response_item's and its event_msg's). The transcript is read a
// line at a time, so a long one doesn't hold the daemon up
const PIC_MAX = 10 << 20
const PICS = 20
const SECRET_NAME = /^\.env|\.(pem|key|p12)$|^id_[a-z0-9]+|(^|[-_.])(api[-_]?key|secret|token|credentials?)([-_.]|$)/i
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {}
}
export async function handoverPics(tab: Tab, ws: Workspace, text: string, to: string): Promise<{ text: string; list: string[] }> {
  const found: ({ data: Buffer; ext: string } | { path: string })[] = []
  const agent = tab.preset === 'claude' || tab.preset === 'codex' ? tab.preset : undefined
  const file = agent && tab.resumeId ? transcriptOf(agent, accountNamed(tab.account ?? '')?.dir ?? homeDir(agent), tab.resumeId) : undefined
  const walk = (v: any, key = ''): void => {
    if (typeof v === 'string') {
      const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/s.exec(v)
      if (m) found.push({ data: Buffer.from(m[2], 'base64'), ext: m[1].replace('jpeg', 'jpg') })
      else if (key === 'local_images' && v.startsWith('/')) found.push({ path: v })
    } else if (Array.isArray(v)) v.forEach(x => walk(x, key))
    else if (v && typeof v === 'object') {
      if (v.type === 'image' && v.source?.type === 'base64' && typeof v.source.data === 'string') found.push({ data: Buffer.from(v.source.data, 'base64'), ext: /(png|jpe?g|gif|webp)/.exec(String(v.source.media_type))?.[1]?.replace('jpeg', 'jpg') ?? 'png' })
      else for (const [k, x] of Object.entries(v)) walk(x, k === 'local_images' ? k : key)
    }
  }
  try {
    if (file && statSync(file).size < 256 << 20)
      for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
        if (!line.includes('image')) continue // a picture's line says so (image, input_image, local_images, data:image)
        try {
          const j = JSON.parse(line)
          if (j.type === 'user' || j.type === 'response_item' || j.type === 'event_msg') walk(j)
        } catch {}
      }
  } catch {}
  const roots = [join(dir, 'images'), join(dir, 'files'), storageOf(ws), tmpdir(), '/tmp'].flatMap(r => (r && real(r) ? [real(r)! + sep] : []))
  const said = [...new Set([...text.matchAll(/(?<![\w.~-])\/[^\s'"`<>()[\]{}]+/g)].map(m => m[0].replace(/[.,:;!?]+$/, '')))]
  for (const p of said) found.push({ path: p })
  const tree = real(ws.path)
  const keep = found.filter(f => {
    if ('data' in f) return f.data.length > 0 && f.data.length <= PIC_MAX
    const r = real(f.path)
    const st = r ? statSync(r, { throwIfNoEntry: false }) : undefined
    return !!r && !!st?.isFile() && st.size <= PIC_MAX && !SECRET_NAME.test(basename(r)) && !(tree && (r + sep).startsWith(tree + sep)) && roots.some(x => r.startsWith(x)) && !r.startsWith(to + sep)
  })
  const seen = new Set<string>()
  const list: string[] = []
  let out = text
  let n = 0
  const once = (f: (typeof keep)[number]) => {
    const r = 'data' in f ? createHash('sha1').update(f.data).digest('hex') : real(f.path)!
    if (seen.has(r)) return false
    seen.add(r)
    return true
  }
  for (const f of keep.filter(once).slice(-PICS)) {
    mkdirSync(to, { recursive: true, mode: 0o700 })
    const copy = join(to, 'data' in f ? `picture-${++n}.${f.ext}` : `${++n}-${basename(f.path)}`)
    if ('data' in f) writeFileSync(copy, f.data, { mode: 0o600 })
    else (copyFileSync(f.path, copy), chmodSync(copy, 0o600), (out = out.replace(new RegExp(`${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[.,:;!?]*(?:[\\s'"\`<>()[\\]{}]|$))`, 'g'), () => copy))) // the whole path only: not /tmp/a inside /tmp/a.png
    list.push('data' in f ? `${copy} (a picture pasted in the chat)` : `${copy} (was ${f.path})`)
  }
  return { text: out, list }
}

// ---------- each turn's changes (settings.turnChanges, on unless false): a card under the Reader's last answer
// (Edited 3 files +42 −7, Review, Undo), Changes' This turn. The worktree as a tree, through an index of its own per
// workspace (<data>/turns/<ws>.index: git add -A, write-tree; the worktree's own index never touched), as a turn starts
// (claude's UserPromptSubmit; codex has no start: its last turn's end) and as it ends: what differs is the turn's. Undo
// writes those files back as they were before it, only while they're still as it left them.
// The card is the last turn per tab, in memory; every turn that changed something is also kept on disk (F1, below).
// ponytail: this Mac's git workspaces (no host)
export const TURN_FILES = 50
type Turn = { before: string; after: string; files: TurnFile[] }
const cuts = new Map<string, { start?: Promise<string | undefined>; at?: number; last?: string; turn?: Turn }>() // by tab; at: when its turn started
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
  c.at = Date.now()
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
    if (files.length) void turnKeep(ws, { tab: tab.id, name: tab.name, prompt: firstLine(r.asked), started: c.at, before: before!, after, files, cost: costOf(tab) }).catch(e => said(ws, e))
    c.at = undefined
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

// ---------- every turn kept (F1): each turn that changed files, per workspace, in <data>/turns/<ws>.json (its tab, the
// prompt's first line, when, the trees before and after, the files, the cost when the transcript says), the newest
// settings.turnsKept (50 unset; 0: none) of the last KEEP_DAYS. The trees stay alive through refs of Laki's own,
// refs/laki/turns/<ws>/<n>/before and /after, each a commit of the tree on the HEAD of then (never under refs/heads or
// refs/tags, so no push takes them: Ship and every push name their refs); a turn let go loses its refs, a workspace
// removed all of them (turnsTidy, after wsRm). turnList reads them; turnDiff one's diff; turnRewind puts the worktree's
// files back as they were before turn n, keeping what was there as a turn of its own (a rewind of that one undoes it);
// turnFork starts a workspace on turn n's commit. Rewind and fork are yours, not an agent's (main.ts' AGENT_NO).
// ponytail: files only (not installs, migrations or pushes), nothing git ignores, no SSH hosts; a turn that changed
// nothing isn't kept; a rewind names every path on one git command line
const KEEP_DAYS = 14
const ME = { GIT_AUTHOR_NAME: 'Laki', GIT_AUTHOR_EMAIL: 'laki@localhost', GIT_COMMITTER_NAME: 'Laki', GIT_COMMITTER_EMAIL: 'laki@localhost' }
type Kept = { repo: string; next: number; turns: TurnKept[] }
const keptFile = (ws: string) => join(turnDir, `${ws}.json`)
const refOf = (ws: string, n: number, side: 'before' | 'after') => `refs/laki/turns/${ws}/${n}/${side}`
const keepN = () => (n => (Number.isFinite(n) && n >= 0 ? Math.min(500, Math.floor(n)) : 50))(Number(state.settings?.turnsKept ?? 50))
const firstLine = (s?: string) => (s ?? '').trim().split('\n')[0].slice(0, 160) || undefined
const readKept = (ws: Workspace): Kept => readJson<Kept>(keptFile(ws.id)) ?? { repo: state.projects.find(p => p.id === ws.project)?.path ?? ws.path, next: 1, turns: [] }
// the turn's cost so far, as the Reader has it (claude's usage at API prices: share.ts chatOf)
const costOf = (tab: Tab) => {
  try {
    return tab.preset === 'claude' ? chatRead({ tab: tab.id }).said?.findLast(x => x.who === 'you')?.cost : undefined
  } catch {}
}
const waits = new Map<string, Promise<unknown>>() // by workspace: one change of its list at a time
const inLine = <T>(ws: string, f: () => Promise<T>): Promise<T> => {
  const p = (waits.get(ws) ?? Promise.resolve()).then(f, f)
  waits.set(ws, p.catch(() => {}))
  return p
}
async function pin(ws: Workspace, ref: string, tree: string, head: string, msg: string) {
  const c = (await g(ws, ['commit-tree', '--no-gpg-sign', tree, ...(head ? ['-p', head] : []), '-m', msg], { ...process.env, ...ME })).trim()
  await g(ws, ['update-ref', ref, c])
}
const unpin = (ws: Workspace, n: number) => Promise.all((['before', 'after'] as const).map(s => g(ws, ['update-ref', '-d', refOf(ws.id, n, s)]).catch(() => {})))
async function turnKeep(ws: Workspace, o: Omit<TurnKept, 'n' | 'ended' | 'add' | 'del' | 'count'>) {
  const max = keepN()
  if (!max) return
  return inLine(ws.id, async () => {
    const k = readKept(ws)
    const n = k.next++
    const head = await g(ws, ['rev-parse', '-q', '--verify', 'HEAD']).then(s => s.trim(), () => '')
    await pin(ws, refOf(ws.id, n, 'before'), o.before, head, `Laki: ${ws.id} before turn ${n}`)
    await pin(ws, refOf(ws.id, n, 'after'), o.after, head, `Laki: ${ws.id}, turn ${n}${o.prompt ? `: ${o.prompt}` : ''}`)
    const t: TurnKept = { ...o, n, ended: Date.now(), add: o.files.reduce((s, f) => s + f.add, 0), del: o.files.reduce((s, f) => s + f.del, 0), count: o.files.length, files: o.files.slice(0, TURN_FILES) }
    k.turns.push(JSON.parse(JSON.stringify(t)))
    const old = Date.now() - KEEP_DAYS * 86400_000
    const gone = k.turns.filter((x, i) => x.ended < old || i < k.turns.length - max)
    k.turns = k.turns.filter(x => !gone.includes(x))
    for (const x of gone) await unpin(ws, x.n)
    mkdirSync(turnDir, { recursive: true, mode: 0o700 })
    writeAtomic(keptFile(ws.id), JSON.stringify(k), 0o600)
    return t
  })
}
const wsOf = (o: { ws?: string; tab?: string }) => findWs(o.ws ?? state.tabs.find(t => t.id === o.tab)?.workspace ?? '')
const keptTurn = (ws: Workspace, n: unknown) => {
  const t = readKept(ws).turns.find(x => x.n === Number(n))
  if (!t) throw new Error(`turn ${n} isn't kept any more`)
  return t
}
// a workspace's kept turns, oldest first; tab: only that tab's
export function turnList(o: { ws?: string; tab?: string }): TurnKept[] {
  const ws = wsOf(o)
  return readKept(ws).turns.filter(t => !o.tab || t.tab === o.tab)
}

// This turn in Changes: the newest turn of the workspace's tabs that changed something, as diff() gives a diff; n: a
// kept one's; none in memory (a restart since): the newest kept
export async function turnDiff(o: { ws?: string; tab?: string; n?: number }) {
  const tabs = state.tabs.filter(t => (o.tab ? t.id === o.tab : t.workspace === o.ws))
  const tab = o.n === undefined ? tabs.filter(t => cuts.get(t.id)?.turn).sort((a, b) => (rtOf(b.id).changes?.at ?? 0) - (rtOf(a.id).changes?.at ?? 0))[0] : undefined
  const kept = tab ? undefined : o.n !== undefined ? keptTurn(wsOf(o), o.n) : (o.ws || o.tab ? turnList(o).at(-1) : undefined)
  const t = tab ? cuts.get(tab.id)!.turn! : kept
  if (!t) throw new Error('no turn changed anything here yet')
  const ws = tab ? findWs(tab.workspace) : wsOf(o)
  const text = await g(ws, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', t.before, t.after])
  const MAX = 4 << 20
  return { base: tab ? `${tab.name}'s last turn` : kept!.rewind ? kept!.prompt! : `${kept!.name}'s turn ${kept!.n}`, from: t.before, files: t.files, diff: text.replace(/\n$/, '').slice(0, MAX), tab: tab?.id ?? kept!.tab, ...(kept && { n: kept.n }) }
}

// the worktree's files as they were before turn n. What's there now is kept first, as a turn of its own (its n comes
// back): a rewind of that one puts everything back, your own edits since too
export async function turnRewind(o: { ws?: string; tab?: string; n?: number }) {
  const ws = wsOf(o)
  const busy = tabsOf(ws.id).find(t => rtOf(t.id).status === 'running')
  if (busy) throw new Error(`${busy.name} is working: wait for its turn to end, or stop it`)
  const t = keptTurn(ws, o.n)
  const now = await treeOf(ws)
  const files = await filesOf(ws, now, t.before) // what the rewind does: A a file that comes back, D one that goes
  if (!files.length) return { files: 0 }
  if (tabsOf(ws.id).some(x => rtOf(x.id).status === 'running')) throw new Error('a turn started meanwhile: nothing rewound')
  const kept = await turnKeep(ws, { tab: t.tab, name: 'You', prompt: `Rewound to before turn ${t.n}`, rewind: t.n, before: now, after: t.before, files })
  const back = files.filter(f => f.status !== 'D').map(f => f.path)
  if (back.length) await g(ws, ['restore', `--source=${t.before}`, '--worktree', '--', ...back])
  for (const f of files)
    if (f.status === 'D')
      try {
        rmSync(inside(ws, f.path), { force: true }) // inside: links followed, never a file outside the worktree
      } catch {}
  // the cards are of turns the files no longer show; codex's next turn starts from here
  const last = await treeOf(ws).catch(() => undefined)
  for (const x of tabsOf(ws.id)) {
    const c = cuts.get(x.id)
    if (c) (c.turn = undefined), (c.last = last)
    rtOf(x.id).changes = undefined
  }
  wsLog(ws, `rewound to before turn ${t.n}: ${files.length} file${files.length === 1 ? '' : 's'}`)
  changed()
  return { files: files.length, n: kept?.n }
}

// a new workspace on turn n's files: its commit (the tree then, on the HEAD of then) is the branch's start, the
// source's base the one it compares with
export async function turnFork(o: { ws?: string; tab?: string; n?: number }) {
  const src = wsOf(o)
  const t = keptTurn(src, o.n)
  const at = (await g(src, ['rev-parse', '-q', '--verify', `${refOf(src.id, t.n, 'after')}^{commit}`])).trim()
  const tab = state.tabs.find(x => x.id === t.tab)
  const made = await wsNew({ project: src.project, base: at, name: `${src.id}-turn-${t.n}`, preset: tab?.profile ?? tab?.preset ?? undefined })
  if (src.base) (made.base = src.base), save()
  changed()
  return made
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
  const here = new Set(state.workspaces.map(w => `${w.id}.json`)) // F1: kept turns stay while the workspace does, archived too
  for (const f of existsSync(turnDir) ? readdirSync(turnDir) : []) {
    if (f.endsWith('.json')) {
      if (!here.has(f)) turnsGone(f.slice(0, -5))
    } else if (!live.has(f)) rmSync(join(turnDir, f), { force: true })
  }
  for (const id of cuts.keys()) if (!state.tabs.some(t => t.id === id)) cuts.delete(id)
  for (const id of sides.keys()) if (!state.tabs.some(t => t.id === id)) sides.delete(id) // closed tabs' side chats
}

// a workspace that's gone: its kept turns' refs out of its repo, then its list
function turnsGone(ws: string) {
  const file = keptFile(ws)
  const repo = readJson<Kept>(file)?.repo
  rmSync(file, { force: true })
  if (!repo || !existsSync(repo) || !/^[\w.-]+$/.test(ws)) return
  execFile('git', ['-C', repo, 'for-each-ref', '--format=%(refname)', `refs/laki/turns/${ws}/`], (e, out) => {
    for (const ref of e ? [] : String(out).split('\n').filter(Boolean)) execFile('git', ['-C', repo, 'update-ref', '-d', ref], () => {})
  })
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
      const said = sinceNew(chat.said).map((x: { who: string; text: string }) => `${x.who === 'you' ? 'User' : x.who === 'agent' ? 'Agent' : 'Tool'}: ${x.text}`).join('\n\n')
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
