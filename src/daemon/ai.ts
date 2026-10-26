// Laki's own AI (Settings › AI, the AI page, `laki ai`): optional, and only when asked. A conversation that works
// Laki with the MCP server's tools (shared/tools.ts: none archives, deletes, ships or merges), run by OpenRouter (its key in
// <data>/ai-key, 0600) or by an agent's CLI in the background: claude -p or codex exec, each given `laki mcp`. Every ask
// is logged with its tokens and cost in <data>/ai-calls.jsonl; the conversation is <data>/ai-chat.json. A spec or brainstorm
// has a chat of its own (the Specs page's side panel), kept in its folder (.chat.json), which ends after PLAN_CHAT_IDLE
// unused: the next ask starts a new one, unless aiContinue takes it up again. One ask at a time, in any chat. Its `ai`
// event says which chat as `of` ('' the AI page's): an `id` would make it a reply.
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readJson } from '../shared/conn.ts'
import { extname, join, sep } from 'node:path'
import { aiRpc, type Rpc, skillTools, SKILL, type Tool, tools } from '../shared/tools.ts'
import { AGENTS, AI_ACTS, AI_PERM, AI_MODEL, PERMS, aiOn, VOICE_MODEL, voiceOn, AI_CONTEXT_MAX as CONTEXT_MAX, AI_STEPS, type AiAct, type AiBackend, type AiCall, type AiLook, type AiMsg, type AiPast, aiTotals, type StudioChat, type View, EFFORTS, type Preset } from '../shared/types.ts'
import { PLAN_CHAT_IDLE } from '../shared/plans.ts'
import { broadcast, cliArgv, dir, execGroup, modelCheck, own, presets, state } from './core.ts'
import { accountEnv, accountUsed } from './accounts.ts'
import { planGet, planOfChat } from './plans.ts'
import { widgetChatFile, widgetCheck, widgetFiles, widgetHome, widgetLogs, widgetsView, widgetWhat } from './widgets.ts'
import { widgetFormat } from '../shared/widgetGuide.ts'

const keyPath = join(dir, 'ai-key')
const chatPath = join(dir, 'ai-chat.json')
const pastDir = join(dir, 'ai-chats') // the AI page's earlier chats: <at>-<hex>.json each, as ai-chat.json
const PAST_MAX = 100 // ponytail: the newest kept; older ones go as a new one is kept
const PAST_ID = /^\d+-[0-9a-f]{6}$/
const callsPath = join(dir, 'ai-calls.jsonl')
const home = join(dir, 'ai') // the CLI agents' folder: no repo, no project's CLAUDE.md or AGENTS.md
const KEEP = 200 // the conversation's messages kept
const TOOL_TEXT = 4000 // what a tool's result may give the model; the page shows less
const MAX_IMAGE = 8 << 20

// tests: a fake OpenRouter on this Mac only (a session's env can reach a daemon the CLI starts)
const api = () => {
  const t = process.env.LAKI_AI_API
  return t && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : 'https://openrouter.ai/api/v1'
}

const SYSTEM = `You are Laki's assistant. Laki is a Mac app that runs coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in a workspace: a git worktree on its own branch, with tabs (agent sessions, shells).
Do what the user asks with the laki tools, at once, without asking first: look things up with laki_state (workspaces, their PRs with titles, each tab's status and last answer), laki_screen and laki_diff; start work with laki_new_workspace (a PR to review: its pr field and a prompt saying what to do), laki_new_tab (another agent in a workspace that exists), laki_send (a message to a running agent), laki_attach_pr; laki_schedules and laki_schedule_add when asked to schedule work.
A project with groups (laki_state's groups, the sidebar's headings): put each new workspace in the one whose name fits it best (laki_new_workspace's group: a PR review in a group like Reviews); none fits, no group. A group with a prompt template (laki_state's groupTemplates) starts its workspaces with it on its own; otherwise, when one of the user's prompt templates (laki_templates) plainly fits the task, give it as laki_new_workspace's template; none fits, none.
Find workspaces by name, branch, PR number or PR title. You cannot archive or delete workspaces, ship or merge: say so if asked.
The user's extensions may give you tools: laki_extension_tools lists them (with their notes on when to use them), laki_extension_call runs one; Laki may ask the user first, and a denial is final.
Link each workspace or tab you name, so the user opens it with a click: [its name](laki://ws/<workspace id>), or [its name](laki://ws/<workspace id>?tab=<tab id>) for a tab.
A screenshot may hold PR links or other work: act on each item.
Workflows (unless the user turned them off): blocks Laki runs for a task, one after another (agents, commands, questions for the user, a PR, its checks, files for its Artifacts). laki_workflows lists them and their runs, and with an id gives that one's whole file; laki_workflow_write writes one, the whole file in the format its description gives (an agent block's use: names one of the user's agent actions, Run ▾'s, by the slug laki_workflows lists); to change one, take its file from laki_workflows with its id, edit it and write it back with the same id and project (asked on the Workflows page, the ask says which workflow is open and gives its file as the editor has it, unsaved changes too: change that one). Blocks: agent (json: yes: its answer the JSON object or list it ends with), run, ask, choice, case (text, numbers, JS), action, wait, save, llm (an AI call; json: yes for JSON mode), decide (an AI decision: yes/no "how true", choice and score questions; route: <question> gives a line per answer), webhook, popup (Show you: a window with HTML or Markdown), end (notify: yes, phone: yes, its words as > lines). Before writing a new workflow, ask the user at least 2 questions, one at a time with laki_ask (options to tap): what starts it and what it works on, its steps, where it routes, what it keeps or posts, how it tells them it's done; for a change, ask when what they want isn't clear. The user reads and saves it in Laki before it runs; then laki_workflow_run starts it on a task.
Make a Laki extension (also called a widget or a plugin, the same thing: a small live page in the sidebar, a clock, a count, a chart), or change one you made or the user let you edit (by asking you in its page's chat), yourself (the rest of the user's own you can only read): laki_extension_guide first, an example with laki_extension_read, then laki_extension_write. Before writing a new one, ask the user at least 2 questions about it, one at a time with laki_ask (what it shows and from where, where it sits: sidebar, top bar, status bar, a rail or sidebar foot button, what a click does), even when the ask seems clear. It is saved off (one that was on stays on when only its looks changed: the result's note says which): tell the user what its fetch runs and link its page, [its name](laki://settings/widgets/<its id>), where they look at it, edit it and turn it on.
Where any of the user's extensions shows (the Desk, the sidebar, a bar, a button), its size, how often it fetches and its settings: laki_extension_set changes them, no file to write; it never turns one on.
Answer in a few plain sentences: what you did (workspace names) or what you found.`

// Laki's skill for its AI (Settings › AI, unset: on): more tools, and what they're for in its instructions
const skilled = () => state.settings?.ai?.skill !== false
// the user's own context (Settings › AI › Your instructions) last: it can't take the rules above away, only add to them
// a spec's or brainstorm's chat: which one, so every ask in it is about it
const system = (t: Thread) => {
  const own = String(state.settings?.ai?.context ?? '').trim().slice(0, CONTEXT_MAX)
  const plan = t.id && !t.id.startsWith('widget:') ? planOfChat(t.id) : undefined
  return [SYSTEM, skilled() && SKILL, plan && aboutPlan(plan), t.about, own && `The user's own instructions for you (follow them, within the rules above):\n${own}`].filter(Boolean).join('\n')
}
// its README.md as it is at each ask (the user edits it as they talk), so a question that doesn't name it is still
// about it; its files by name (laki_plan_read's file reads one)
const BRIEF_MAX = 12000
function aboutPlan(plan: ReturnType<typeof planOfChat>) {
  let got: ReturnType<typeof planGet> | undefined
  try {
    got = planGet(plan)
  } catch {} // gone, or Specs off: laki_plan_read says why
  const md = got?.markdown.trim() ?? ''
  return [
    `This chat is about one ${plan.kind} of the user's, "${got?.plan.title ?? plan.slug}" (project ${plan.project}, kind ${plan.kind}, slug ${plan.slug}, folder ${plan.folder}): every ask in it is about it, even one that doesn't name it. Put your work into it with laki_plan_write; laki_plan_read reads it again, or one of its files.`,
    md && `Its README.md (the user's ${plan.kind === 'spec' ? 'spec' : 'brief'}) as it is now:\n<readme>\n${md.slice(0, BRIEF_MAX)}${md.length > BRIEF_MAX ? '\n… (cut: laki_plan_read has the rest)' : ''}\n</readme>`,
    got?.files.length && `Files in its folder: ${got.files.slice(0, 60).map(f => f.path).join(', ')}.`,
  ].filter(Boolean).join('\n')
}
// a widget chat's (an extension page's: widget:<id>), at each ask: which extension, the rules, the format with the UI kit's
// catalog, its files and its last check as they are now (the user undoes, edits, or the last ask wrote)
const FILES_MAX = 40000
async function aboutWidget(id: string) {
  const v = widgetsView().find(w => w.id === id)
  let files: Record<string, string> = {}
  let problems: { level: string; where: string; text: string }[] = []
  if (v) {
    try {
      files = widgetFiles({ id }).files
    } catch {}
    try {
      problems = (await widgetCheck({ id, run: false })).problems
    } catch {}
  }
  let room = FILES_MAX
  const shown = Object.entries(files).map(([n, t]) => {
    const s = t.slice(0, Math.max(0, room))
    room -= s.length
    return `<file name="${n}">\n${s}${s.length < t.length ? '\n… (cut: laki_extension_read has all of it)' : ''}\n</file>`
  })
  return [
    `This chat is on the page of ${v ? `the Laki extension "${v.name}" (id ${id})` : `a new Laki extension: its id is ${id}`}. Beside it the user sees its preview (with its sample data), its settings and its inspector: every ask in it is about it, even one that doesn't name it.${v && v.dir !== `${widgetHome()}/${id}` ? " It isn't in Laki's own folder (it comes with Laki, or it's in a folder of the user's): you can't write it; the page's Remix makes a copy you can." : ''}`,
    `Rules here:
1. Write only ${id}, with laki_extension_write.
2. Prefer ui (the UI kit's elements); widget.html only for a look of its own.
3. Always write fixtures/sample.json (realistic, in the shape its fetch will print; widget.json's sample the same) and fixtures/empty.json.
4. After every write, run laki_extension_check and fix every error before you answer.
5. Never run its fetch or its actions: say in one line what its fetch will run and what it needs (a CLI on PATH, a token setting).
6. Keep answers short.
7. A new one: before you write it, ask what the user's words don't tell, one question at a time with laki_ask (2-4 options, each with a look: a ui element over made-up data, drawn as it would show): where its data comes from, what it shows (a number, a list, a table, a chart), an icon alone or words beside it, plain words or rich text (Markdown). Ask 1 to 3, then write it. A change to one: do it; ask only when it's unclear.
8. No short words beside an icon (a label on a button, a caption by a stat's icon) unless the user asks for them: the icon, a badge or the number, its words in tip.`,
    `How an extension is made:\n${widgetFormat()}`,
    shown.length ? `Its files now:\n${shown.join('\n')}` : 'It has no files yet.',
    v && (problems.length ? `Its last check:\n${problems.map(p => `${p.level} ${p.where}: ${p.text}`).join('\n')}` : 'Its last check: no problems.'),
    v && (l => l.length && `Its log's last warnings and errors (laki_extension_logs has more):\n${l.map(x => `${new Date(x.at).toISOString()} ${x.level} ${x.src}: ${x.text}`).join('\n')}`)(widgetLogs({ id, level: 'warn', limit: 30 }).lines),
  ].filter(Boolean).join('\n\n')
}
// the AI's tools: the MCP server's (laki_schedule_add too: it acts only when asked), but laki_progress and agents' memory (an agent's own; it keeps the user's with laki_memory_write),
// and the skill's
const toolsFor = (to: Rpc, chat: string, rpc = aiRpc(to, chat)) => [...tools(rpc, undefined, 'Laki AI').filter(t => !['laki_progress', 'laki_memory', 'laki_remember'].includes(t.name)), ...(skilled() ? skillTools(rpc) : [])] // its looks said as its own (aiRpc)

// ---------- the key: a file only you can read, never in state.json or the view

export const hasKey = () => !!readKey()
function readKey() {
  try {
    return readFileSync(keyPath, 'utf8').trim()
  } catch {
    return ''
  }
}
export function aiKey(o: { key?: string | null }) {
  const key = o.key?.trim()
  if (!key) return rmSync(keyPath, { force: true }), { key: false }
  if (!/^[\x21-\x7e]{8,400}$/.test(key)) throw new Error('that does not look like an API key')
  writeFileSync(keyPath, key + '\n', { mode: 0o600 })
  return { key: true }
}

// ---------- voice (Settings › Voice, cloud): a recording, WAV in base64, written down by OpenRouter's speech-to-text
// with the same key. Nothing is kept: not the audio, not the text
const MAX_AUDIO = 24 << 20 // OpenRouter's 25 MB: about 9 minutes of the renderer's 16 kHz mono
export async function voiceText(o: { audio?: unknown }) {
  if (!voiceOn(state.settings)) throw new Error('Voice is off: turn it on in Settings › Voice')
  const audio = typeof o.audio === 'string' ? o.audio : ''
  if (!audio) throw new Error('no audio')
  if (audio.length > MAX_AUDIO) throw new Error('a recording up to 9 minutes')
  const key = readKey()
  if (!key) throw new Error('no OpenRouter API key: Settings › Voice')
  const m: unknown = state.settings?.voice?.model
  const model = (typeof m === 'string' && m.trim()) || VOICE_MODEL
  // rate-limited (429) or the provider busy (5xx): tried again after VOICE_AGAIN, then said so with OpenRouter's words
  // ponytail: fixed waits, not Retry-After (OpenRouter's STT sends none)
  for (let n = 0; ; n++) {
    const res = await fetch(`${api()}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      body: JSON.stringify({ model, input_audio: { data: audio, format: 'wav' } }),
      signal: AbortSignal.timeout(90000),
    }).catch((e: Error) => {
      throw new Error(`Can't reach OpenRouter: ${e.name === 'TimeoutError' ? 'no answer in 90 seconds' : e.message}`)
    })
    const j: any = await res.json().catch(() => ({}))
    if (res.ok && !j.error) return { text: String(j.text ?? '').trim() }
    const busy = res.status === 429 || res.status >= 500
    if (busy && n < VOICE_AGAIN.length) {
      await new Promise(r => setTimeout(r, VOICE_AGAIN[n]))
      continue
    }
    const raw = j.error?.metadata?.raw // the provider's own error: words, or its JSON
    const said = (j.error?.message ?? res.statusText) + (raw ? `: ${(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 200)}` : '')
    throw new Error(`OpenRouter ${res.status}: ${said}${busy ? ` (${model} is busy: try again in a moment, or another model in Settings › Voice)` : ''}`)
  }
}
const VOICE_AGAIN = (process.env.LAKI_VOICE_AGAIN ?? '1000,2500').split(',').map(Number) // ms before each try again (tests: shorter)

// ---------- the conversations: '' the AI page's, plan:<project>/<kind>/<slug> a spec's or brainstorm's (plans.ts)

// resume: claude's session, codex's thread, by sessionKey: the next ask goes on with it. at: the last message.
// ended: a spec's or brainstorm's chat unused PLAN_CHAT_IDLE: the next ask starts it again, empty
type Thread = { id: string; file: string; chat: AiMsg[]; resume: Record<string, string | undefined>; at: number; ended?: number; about?: string; allowed?: Set<string>; asked?: boolean } // about: a widget chat's brief for this ask (aboutWidget); allowed: the tools Always in this chat let its agent use
const threads = new Map<string, Thread>()
// the chats whose ask is at work, each its stop: one ask per chat, AI_AT_ONCE chats at a time (a new extension starts
// while another builds); laki_ask's aiQuestion and aiPermission find theirs by the chat its tools pass (laki mcp's
// LAKI_AI_CHAT, aiRpc's chat). A thread's asked: its ask's turn asked the user something, the pick comes as the next ask
const AI_AT_ONCE = 4
const busy = new Map<string, () => void>()
// an ask refused before it starts: that chat's still at work, or AI_AT_ONCE others are
function refuseBusy(t: Thread) {
  if (busy.has(t.id)) throw new Error('the AI is still on the last ask')
  if (busy.size >= AI_AT_ONCE) throw new Error(`Laki AI works in ${busy.size} chats already: wait for one, or stop it`)
}
// the chat a tool's question or permission ask belongs to: the one it names, else the only one at work
function asking(chat?: string) {
  const id = chat ?? (busy.size === 1 ? [...busy.keys()][0] : undefined)
  if (id === undefined || !busy.has(id)) throw new Error('only while Laki AI works on an ask')
  return thread(id)
}
function thread(id = ''): Thread {
  const file = !id ? chatPath : id.startsWith('widget:') ? widgetChatFile(id) : planOfChat(id).file // a spec's gone, or off: that says so, each time
  const known = threads.get(id)
  if (known) return known
  const j: any = readJson(file) ?? {}
  const t: Thread = { id, file, chat: Array.isArray(j.chat) ? j.chat : [], resume: j.resume ?? {}, at: Number(j.at) || Date.now(), ended: j.ended }
  for (const m of t.chat) if (m.ask?.perm && m.ask.picked === undefined) m.ask.picked = 'Not answered' // its agent ended with the daemon
  if (id && !t.ended && t.chat.length && Date.now() - t.at > PLAN_CHAT_IDLE) t.ended = t.at + PLAN_CHAT_IDLE // ran out while the daemon wasn't looking
  threads.set(id, t)
  return t
}
function changed(t: Thread) {
  t.chat = t.chat.slice(-KEEP)
  try {
    writeFileSync(t.file, JSON.stringify({ chat: t.chat, resume: t.resume, at: t.at, ended: t.ended }), { mode: 0o600 })
  } catch {}
  broadcast({ ev: 'ai', of: t.id, chat: t.chat, busy: busy.has(t.id), ended: t.ended })
}
const say = (t: Thread, role: AiMsg['role'], text: string, images?: string[]) => (t.chat.push({ role, text, at: (t.at = Date.now()), ...(images?.length && { images }) }), changed(t))
const fresh = (t: Thread) => ((t.chat = []), (t.resume = {}), (t.ended = undefined), (t.at = Date.now()), (t.allowed = undefined))

export function aiNew(p: { chat?: string } = {}) {
  const t = thread(p.chat)
  if (busy.has(t.id)) throw new Error('the AI is at work: stop it first')
  if (!t.id) shelve(t)
  fresh(t)
  changed(t)
}

// ---------- the AI page's earlier chats (its sidebar): New chat keeps the one it ends; a click takes one up again

// the AI page's chat kept among the earlier ones, once something was asked in it
function shelve(t: Thread) {
  if (!t.chat.some(m => m.role === 'user')) return
  mkdirSync(pastDir, { recursive: true })
  writeFileSync(join(pastDir, `${t.at}-${randomBytes(3).toString('hex')}.json`), JSON.stringify({ chat: t.chat, resume: t.resume, at: t.at }), { mode: 0o600 })
  const all = pastFiles().sort((a, b) => parseInt(a) - parseInt(b))
  for (const f of all.slice(0, Math.max(0, all.length - PAST_MAX))) rmSync(join(pastDir, f), { force: true })
}
const pastFiles = () => {
  try {
    return readdirSync(pastDir).filter(f => PAST_ID.test(f.slice(0, -5)) && f.endsWith('.json'))
  } catch {
    return []
  }
}
const readPast = (id: string): { chat: AiMsg[]; resume: Record<string, string | undefined>; at: number } | null => {
  if (!PAST_ID.test(String(id))) return null
  try {
    const j = JSON.parse(readFileSync(join(pastDir, `${id}.json`), 'utf8'))
    return { chat: Array.isArray(j.chat) ? j.chat : [], resume: j.resume && typeof j.resume === 'object' ? j.resume : {}, at: Number(j.at) || 0 }
  } catch {
    return null
  }
}
// the list, newest first: each one's first ask as its title
// ponytail: each file read once (they don't change once kept), its row kept here; a gone one drops out
const pastRows = new Map<string, AiPast>()
export function aiChats(): AiPast[] {
  const files = pastFiles()
  for (const id of pastRows.keys()) if (!files.includes(`${id}.json`)) pastRows.delete(id)
  return files
    .map(f => {
      const id = f.slice(0, -5)
      let row = pastRows.get(id)
      if (!row) {
        const j = readPast(id)
        const first = j?.chat.find(m => m.role === 'user')
        pastRows.set(id, (row = { id, title: first?.text.trim().split('\n')[0].slice(0, 100) || (first?.images?.length ? 'An image' : 'A chat'), at: j?.at || parseInt(id), n: j?.chat.length ?? 0 }))
      }
      return row
    })
    .sort((a, b) => b.at - a.at)
}
// one taken up again: it's the AI page's chat (its sessions go on), the one there kept among the earlier ones
export function aiOpen(p: { id: string }) {
  const t = thread('')
  if (busy.has(t.id)) throw new Error('the AI is at work: stop it first')
  const j = readPast(p.id)
  if (!j) throw new Error('that chat is gone')
  shelve(t)
  rmSync(join(pastDir, `${p.id}.json`), { force: true })
  Object.assign(t, { chat: j.chat, resume: j.resume, at: j.at || Date.now(), ended: undefined, allowed: undefined }) // Always in this chat: that chat's, not this one's
  changed(t)
  return { ok: true }
}
export function aiChatRm(p: { id: string }) {
  if (!PAST_ID.test(String(p.id))) throw new Error('no such chat')
  rmSync(join(pastDir, `${p.id}.json`), { force: true })
  return { ok: true }
}
// the extension pages' chats (widget:<id>), newest first (STUDIO_MAX): the app shows the ones with no extension made
// of them yet, and the one at work, so a page closed mid-build is where you left it
const STUDIO_MAX = 30
const STUDIO_FILE = /^widget:([a-z0-9][a-z0-9-]{0,39})\.chat\.json$/
export function studioChats(): StudioChat[] {
  const d = join(dir, 'widget-data')
  let files: { id: string; at: number }[] = []
  try {
    files = readdirSync(d).flatMap(f => (m => (m ? [{ id: m[1], at: statSync(join(d, f)).mtimeMs }] : []))(STUDIO_FILE.exec(f)))
  } catch {}
  return files
    .sort((a, b) => b.at - a.at)
    .slice(0, STUDIO_MAX)
    .flatMap(({ id, at }) => {
      const chat = `widget:${id}`
      let msgs = threads.get(chat)?.chat // the one in memory, else its file read, not kept (thread() would hold each)
      if (!msgs) msgs = readJson(join(d, `${chat}.chat.json`))?.chat
      const first = Array.isArray(msgs) ? msgs.find(m => m.role === 'user') : undefined
      return first ? [{ id, title: String(first.text ?? '').trim().split('\n')[0].slice(0, 100) || 'An image', at: threads.get(chat)?.at ?? at, busy: busy.has(chat) }] : []
    })
}
// one let go of (its ✕): its chat goes; not while it works
export function studioChatRm(p: { id: string }) {
  const chat = `widget:${p.id}`
  const file = widgetChatFile(chat)
  if (busy.has(chat)) throw new Error('Laki AI works on it: stop it first')
  aiForget(chat)
  rmSync(file, { force: true })
  return { ok: true }
}
// a pasted image of a message, to show (the page's thumbnails): only the daemon's own (imageOk)
export function aiImage(p: { path: string }) {
  if (!imageOk(p.path)) throw new Error("that image isn't kept any more")
  return dataUrl(p.path)
}
// chat: only that chat's ask (none: any, as shutdown and Settings › Resources' Stop)
export function aiStop(p: { chat?: string } = {}) {
  const on = [...busy].filter(([id]) => p.chat === undefined || id === p.chat)
  for (const [, kill] of on) kill()
  return { stopped: on.length > 0 }
}
// an ended chat taken up again: its session goes on (claude's and codex's, while they keep it)
export function aiContinue(p: { chat?: string }) {
  const t = thread(p.chat)
  t.ended = undefined
  t.at = Date.now()
  changed(t)
}
// every 10 minutes (now: tests move the clock): a spec's or brainstorm's chat unused PLAN_CHAT_IDLE ends, its ask stopped
export function aiTick(now = Date.now()) {
  for (const t of threads.values())
    if (t.id && !t.ended && t.chat.length && now - t.at > PLAN_CHAT_IDLE) {
      const working = busy.has(t.id)
      if (working) busy.get(t.id)!()
      t.ended = now
      changed(t)
      if (!working) threads.delete(t.id) // read again from its file when opened: ended there too
    }
}
// a spec or brainstorm deleted: its chat with it
export function aiForget(id: string) {
  busy.get(id)?.()
  threads.delete(id)
}

// the page's: the conversation, whether it works, the key's there, the last calls and totals
export function aiState(p: { chat?: string } = {}) {
  const t = thread(p.chat)
  const calls = readCalls()
  return { chat: t.chat, busy: busy.has(t.id), ended: t.ended, key: hasKey(), calls: calls.slice(-100).reverse(), totals: aiTotals(calls) }
}

// ---------- asking

type Run = { text: string; model: string; calls: number; in: number; out: number; cost?: number }
// r: what the ask spent so far, kept when it fails too
type Opts = { t: Thread; ask: string; images: string[]; rpc: Rpc; signal: AbortSignal; spawned: (c: ChildProcess) => void; r: Run }

// chat: a spec's or brainstorm's (planChat), else the AI page's; one that ended starts again, empty
// context: where the user is as they ask (the floating chat's: the page, workspace and tab), for the model only: the
// conversation keeps their words alone
export async function aiAsk(p: { text?: string; images?: string[]; chat?: string; context?: string }, rpc: Rpc) {
  const s = state.settings?.ai ?? {}
  if (!aiOn(state.settings)) throw new Error('Laki AI is off: Settings › AI')
  const ask = (p.text ?? '').trim()
  const images = (p.images ?? []).filter(imageOk)
  if (!ask && !images.length) throw new Error('ask something')
  const t = thread(p.chat)
  refuseBusy(t)
  const backend: AiBackend = s.backend ?? 'openrouter'
  if (backend === 'openrouter' && !hasKey()) throw new Error('no OpenRouter API key: Settings › AI')
  if (t.ended) fresh(t)
  const ctl = new AbortController()
  let child: ChildProcess | undefined
  busy.set(t.id, () => (ctl.abort(), child?.kill('SIGTERM'))) // before any await: aiAnswer sees it at once, and no second ask slips in
  try {
    t.about = t.id.startsWith('widget:') ? await aboutWidget(t.id.slice(7)) : undefined
    if (ctl.signal.aborted) throw new Error('stopped')
  } catch (e) {
    busy.delete(t.id)
    throw e
  }
  say(t, 'user', ask, images)
  t.asked = false
  const t0 = Date.now()
  const r: Run = { text: '', model: s.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : backend), calls: 0, in: 0, out: 0 }
  const where = typeof p.context === 'string' ? p.context.trim().slice(0, CONTEXT_MAX) : ''
  const o: Opts = { t, ask: where ? `${ask || 'See the image.'}\n\n[Where the user is in Laki as they ask this: ${where}]` : ask, images, rpc, signal: ctl.signal, spawned: c => (child = c), r }
  const call: AiCall = { at: t0, backend, model: r.model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: ask.slice(0, 120) }
  try {
    await (backend === 'claude' ? claude(o) : backend === 'codex' ? codex(o) : openrouter(o))
    call.ok = true
    if (r.text.trim() || !t.asked) say(t, 'ai', r.text || '(no answer)') // a question it asked is the answer
    return { text: r.text }
  } catch (e) {
    const msg = ctl.signal.aborted ? 'stopped' : (e as Error).message
    call.error = msg
    say(t, 'error', msg)
    throw new Error(msg)
  } finally {
    Object.assign(call, { model: r.model, in: r.in, out: r.out, cost: r.cost, tools: r.calls, ms: Date.now() - t0 })
    busy.delete(t.id)
    for (const p of perms.values()) if (p.chat === t.id) p.done(-1) // its agent is gone: nothing waits on them
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
    changed(t)
  }
}

// a pasted image is the daemon's own (imageSave: <data>/images): nothing else of the Mac goes to a model
function imageOk(path: unknown) {
  if (typeof path !== 'string') return false
  try {
    return realpathSync(path).startsWith(realpathSync(join(dir, 'images')) + sep)
  } catch {
    return false
  }
}

// a tool the model asked for, shown in the conversation; its result (or failure) goes back to the model
async function runTool(t: Thread, list: Tool[], name: string, args: unknown) {
  const tool = list.find(x => x.name === name)
  say(t, 'tool', `${name} ${JSON.stringify(args ?? {})}`)
  try {
    if (!tool) throw new Error(`no tool ${name}`)
    const r = await tool.run(args ?? {})
    return (typeof r === 'string' ? r : JSON.stringify(r)).slice(0, tool.max ?? TOOL_TEXT)
  } catch (e) {
    return `failed: ${(e as Error).message}`
  }
}

// the earlier asks and answers, for a model that keeps no session of its own (OpenRouter)
// ponytail: the last 20, without the tools' results (it looks again); a summary of older ones if it forgets too much
const history = (t: Thread) =>
  t.chat
    .slice(0, -1)
    .filter(m => m.role === 'user' || m.role === 'ai')
    .slice(-20)
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text || '(an image)' }))

async function openrouter(o: Opts) {
  const key = readKey()
  const s = state.settings?.ai ?? {}
  const model = s.models?.openrouter || AI_MODEL
  const list = toolsFor(o.rpc, o.t.id)
  const fns = list.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  const pics = o.images.map(p => ({ type: 'image_url', image_url: { url: dataUrl(p) } }))
  const messages: object[] = [{ role: 'system', content: system(o.t) }, ...history(o.t), { role: 'user', content: pics.length ? [{ type: 'text', text: o.ask || 'See the image.' }, ...pics] : o.ask }]
  const r = o.r
  r.cost = 0
  for (let i = 0; ; i++) {
    const res = await fetch(`${api()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      body: JSON.stringify({ model, messages, tools: fns, usage: { include: true } }),
      signal: AbortSignal.any([o.signal, AbortSignal.timeout(120000)]),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`OpenRouter: ${j.error?.message ?? (typeof j.error === 'string' ? j.error : res.status)}`)
    r.model = j.model || model
    r.in += j.usage?.prompt_tokens ?? 0
    r.out += j.usage?.completion_tokens ?? 0
    r.cost! += j.usage?.cost ?? 0
    const m = j.choices?.[0]?.message
    if (!m) throw new Error('OpenRouter: no answer')
    if (!m.tool_calls?.length) return void (r.text = m.content ?? '')
    if (i >= (s.steps || AI_STEPS)) throw new Error(`stopped after ${i} rounds of tools (Settings › AI › Steps)`)
    messages.push(m) // as it came: a reasoning model's next request needs its reasoning_details
    if (m.content) say(o.t, 'ai', m.content)
    // ponytail: Stop takes effect between tools: one under way (a wsNew) finishes first
    for (const c of m.tool_calls) {
      let args: unknown = {}
      try {
        args = JSON.parse(c.function?.arguments || '{}')
      } catch {}
      r.calls++
      messages.push({ role: 'tool', tool_call_id: c.id, content: await runTool(o.t, list, c.function?.name, args) })
    }
    if (o.t.asked) return void (r.text = '') // it asked the user: their pick goes on from here, as the next ask
  }
}
// one OpenRouter call with Settings › AI's key, no tools and no chat (a workflow's AI call block): its answer, logged
// with its cost among Laki AI's calls (ask: what made it)
// one OpenRouter call (aiComplete, aiDecide: workflows' blocks, memory's compaction) waits 5 minutes at most, its
// caller's stop too (LAKI_AI_WAIT_MS: tests' shorter)
const waitOf = (signal?: AbortSignal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Number(process.env.LAKI_AI_WAIT_MS) || 5 * 60_000)])
export async function aiComplete(o: { model?: string; prompt: string; system?: string; temperature?: number; json?: boolean; signal?: AbortSignal; ask: string }) {
  const key = readKey()
  if (!key) throw new Error('no OpenRouter API key: Settings › AI')
  const model = o.model?.trim() || state.settings?.ai?.models?.openrouter || AI_MODEL
  const call: AiCall = { at: Date.now(), backend: 'openrouter', model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: o.ask.slice(0, 120) }
  try {
    const res = await fetch(`${api()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      // json: an answer that is a JSON object (out:'s), where the model can
      body: JSON.stringify({ model, messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: o.prompt }], usage: { include: true }, ...(o.temperature !== undefined && { temperature: o.temperature }), ...(o.json && { response_format: { type: 'json_object' } }) }),
      signal: waitOf(o.signal),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`OpenRouter: ${j.error?.message ?? res.status}`)
    Object.assign(call, { model: j.model || model, in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0, cost: j.usage?.cost })
    const text = j.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error('OpenRouter: no answer')
    call.ok = true
    return { text, model: call.model, cost: call.cost }
  } catch (e) {
    call.error = (e as Error).message
    throw e
  } finally {
    call.ms = Date.now() - call.at
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
  }
}

// one question, one answer, outside any chat and with no tools (memory's compaction): Settings › AI's backend, OpenRouter
// through aiComplete, or claude -p / codex exec with nothing but the prompt (their preset's account and env, as the
// chat's); logged among Laki AI's calls. agent: an extension's AI source, that agent with the user's own config (its
// MCP servers; claude's tools: the ones it may use unasked, its other asks refused; codex's sandbox read-only), 10 minutes
export async function aiOnce(o: { prompt: string; system: string; ask: string; json?: boolean; preset?: Preset & { agent: 'claude' | 'codex' }; tools?: string; perm?: string; name?: string; stop?: string; signal?: AbortSignal; onCall?: (c: AiCall, answer: string) => void }): Promise<string> {
  const s = state.settings?.ai ?? {}
  const agent = !!o.preset // an extension's: the preset's model, effort, env and account; the user's own config
  // perm: that extension's id: claude asks you for a tool it may not use unasked in the app, not in a hook's (laki mcp's
  // laki_permission beside the user's own servers: widgetTools.ts widgetPermission)
  const backend: AiBackend = o.preset?.agent ?? s.backend ?? 'openrouter'
  if (backend === 'openrouter') return (await aiComplete({ prompt: o.prompt, system: o.system, json: o.json, ask: o.ask })).text // ponytail: no onCall (an extension's agent is claude or codex)
  const pre = o.preset ?? presetOf(backend)
  const model = agent ? o.preset!.model : s.models?.[backend]
  const effort = effortArgs(backend, agent ? (o.preset!.effort ?? '') : undefined)
  const call: AiCall = { at: Date.now(), backend, model: model || backend, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: o.ask.slice(0, 120) }
  const args =
    backend === 'claude'
      ? ['-p', '--output-format', 'json', ...(agent ? (o.tools ? ['--allowedTools', o.tools] : []) : ['--tools', '']), ...(agent && o.perm ? ['--mcp-config', JSON.stringify({ mcpServers: { laki_ask: mcpWith({ LAKI_PERM_EXT: o.perm }) } }), '--permission-prompt-tool', 'mcp__laki_ask__laki_permission'] : []), '--append-system-prompt', o.system, ...(model ? ['--model', model] : []), ...effort, '--', o.prompt]
      : ['exec', '--json', '--skip-git-repo-check', ...(agent ? [] : ['--ignore-user-config']), '-c', 'sandbox_mode="read-only"', '-c', `developer_instructions=${JSON.stringify(o.system)}`, ...(model ? ['-m', model] : []), ...effort, '--', o.prompt]
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, ...state.settings?.env, ...pre?.env, ...accountEnv(pre?.account ?? accountUsed(backend)) }
  let answer = ''
  try {
    const out = await new Promise<string>((ok, no) => {
      // a group of its own: a stop or a timeout ends its MCP servers and tools too
      const c = execGroup(backend, args, { cwd: home, env, maxBuffer: 16 << 20, timeout: agent ? 600_000 : 300_000, signal: o.signal }, (e, so, se) => (e && !/"is_error"\s*:\s*true/.test(so) ? no(new Error(`${backend}: ${e.code === 'ENOENT' ? 'not installed (not on PATH)' : o.signal?.aborted ? 'stopped' : e.message === 'maxBuffer exceeded' ? 'printed more than 16 MB' : e.killed ? 'took too long' : se.trim().split('\n').pop() || e.message}`)) : ok(so)))
      own(c, o.name ?? `Laki AI · ${backend}`, agent ? o.stop : 'ai') // an extension's: agent:<id>, its runs (widgets.ts stopAgents)
    })
    let text = ''
    for (const l of backend === 'claude' ? [out] : out.split('\n')) { // claude: one JSON document; codex: a line each
      let j: any
      try {
        j = JSON.parse(l)
      } catch {
        continue
      }
      if (backend === 'claude' && j.type === 'result') {
        if (j.is_error) throw new Error(j.result || j.subtype)
        text = j.result ?? ''
        call.cost = j.total_cost_usd
        call.in = (j.usage?.input_tokens ?? 0) + (j.usage?.cache_read_input_tokens ?? 0) + (j.usage?.cache_creation_input_tokens ?? 0)
        call.out = j.usage?.output_tokens ?? 0
      }
      if (j.type === 'item.completed' && j.item?.type === 'agent_message') text = j.item.text ?? ''
      if (j.type === 'turn.completed') (call.in += j.usage?.input_tokens ?? 0), (call.out += j.usage?.output_tokens ?? 0)
    }
    if (!text) throw new Error(`${backend}: no answer`)
    call.ok = true
    return (answer = text)
  } catch (e) {
    call.error = (e as Error).message
    throw e
  } finally {
    call.ms = Date.now() - call.at
    o.onCall?.(call, answer) // an extension's log: its seconds, cost and answer
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
  }
}

// one decision (a workflow's AI decision block): the state and typed questions to OpenRouter's Decisions API, the
// answers back (probabilities, no text); logged with its cost among Laki AI's calls
export async function aiDecide(o: { model: string; state: unknown; questions: object; signal?: AbortSignal; ask: string }) {
  const key = readKey()
  if (!key) throw new Error('no OpenRouter API key: Settings › AI')
  const call: AiCall = { at: Date.now(), backend: 'openrouter', model: o.model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: o.ask.slice(0, 120) }
  try {
    const res = await fetch(`${api().replace(/\/v1$/, '')}/alpha/decisions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Laki' },
      body: JSON.stringify({ model: o.model, state: o.state, questions: o.questions }),
      signal: waitOf(o.signal),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`OpenRouter: ${j.error?.message ?? res.status}`)
    if (!j.answers || typeof j.answers !== 'object') throw new Error('OpenRouter: no answers')
    Object.assign(call, { model: j.model || o.model, in: j.usage?.input_tokens ?? 0, out: j.usage?.output_tokens ?? 0, cost: j.usage?.cost })
    call.ok = true
    return { answers: j.answers as Record<string, any>, model: call.model, cost: call.cost as number | undefined }
  } catch (e) {
    call.error = (e as Error).message
    throw e
  } finally {
    call.ms = Date.now() - call.at
    try {
      appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })
    } catch {}
  }
}

function dataUrl(path: string) {
  const buf = readFileSync(path)
  if (buf.length > MAX_IMAGE) throw new Error('an image up to 8 MB')
  const ext = extname(path).slice(1).toLowerCase()
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
}

// `laki mcp` as an MCP server for a CLI agent: this daemon's (LAKI_HOME), through node or Electron as node
// perm: claude's, whose --permission-prompt-tool is laki mcp's laki_permission (codex has none); mcpWith: any env of laki mcp's
const mcpWith = (env: Record<string, string>) => ({ command: cliArgv[0], args: [...cliArgv.slice(1), 'mcp'], env: { LAKI_HOME: dir, ...env, ...(process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) } })
const mcpServer = (chat: string, perm = false) => mcpWith({ LAKI_AI: '1', LAKI_AI_CHAT: chat, ...(skilled() && { LAKI_AI_SKILL: '1' }), ...(perm && { LAKI_AI_PERM: '1' }) })

// Settings › AI's preset of the agent (an account of its own: CLAUDE_CONFIG_DIR, CODEX_HOME…): its env, over Settings'
// env as a tab of it gets; its args are a tab's, not used here
const presetOf = (agent: AiBackend) => {
  const name = state.settings?.ai?.preset
  return name ? presets().find(p => p.name === name && p.agent === agent) : undefined
}
// its session goes with the preset: another one's account doesn't know it
const sessionKey = (agent: AiBackend) => `${agent}:${presetOf(agent)?.name ?? ''}`

// an agent's CLI, its JSON lines to `line`; it fails with the last of what it printed to stderr
function cli(o: Opts, cmd: AiBackend, args: string[], line: (j: any) => void) {
  mkdirSync(home, { recursive: true })
  return new Promise<void>((resolve, reject) => {
    const env = { ...process.env, ...state.settings?.env, ...presetOf(cmd)?.env, ...(cmd !== 'openrouter' && accountEnv(presetOf(cmd)?.account ?? accountUsed(cmd))), MCP_TOOL_TIMEOUT: '300000' } // its account: the preset's, else the default
    const c = spawn(cmd, args, { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
    o.spawned(c)
    own(c, `Laki AI · ${cmd}`, 'ai')
    let out = ''
    let err = ''
    c.stdout.on('data', d => {
      out += d
      const lines = out.split('\n')
      out = lines.pop()!
      for (const l of lines) {
        try {
          if (l.trim()) line(JSON.parse(l))
        } catch {}
      }
    })
    c.stdout.on('end', () => {
      try {
        if (out.trim()) line(JSON.parse(out)) // a last line without its newline
      } catch {}
    })
    c.stderr.on('data', d => (err = (err + d).slice(-2000)))
    c.on('error', e => reject(new Error(`${cmd}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed (not on PATH)' : e.message}`)))
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ended with ${code}: ${err.trim().split('\n').pop() || 'no output'}`))))
  })
}

// Settings › AI's effort for claude -p or codex exec, as a tab's (agentCmd): one of EFFORTS, else theirs
const effortArgs = (backend: 'claude' | 'codex', own?: string) => {
  const e = own ?? state.settings?.ai?.efforts?.[backend] // own: an extension's preset's ('': none)
  if (!e || !EFFORTS[backend]?.includes(e)) return []
  return backend === 'claude' ? ['--effort', e] : ['-c', `model_reasoning_effort="${e}"`]
}

// claude -p: only Read (a screenshot: its folder added when there is one, it runs elsewhere) and the laki tools; stream-json shows each tool call as it happens
async function claude(o: Opts) {
  const model = state.settings?.ai?.models?.claude
  const sk = sessionKey('claude')
  const resume = o.t.resume
  const prompt = o.images.length ? `${o.ask}\n\nImages (read them): ${o.images.join(' ')}` : o.ask
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', JSON.stringify({ mcpServers: { laki: mcpServer(o.t.id, true) } }), '--strict-mcp-config', '--tools', 'Read', ...(o.images.length ? ['--add-dir', join(dir, 'images')] : []), '--allowedTools', 'mcp__laki', '--permission-prompt-tool', 'mcp__laki__laki_permission', '--append-system-prompt', system(o.t), ...(model ? ['--model', model] : []), ...effortArgs('claude'), ...(resume[sk] ? ['--resume', resume[sk]] : []), '--', prompt]
  const r = o.r
  let failed = ''
  await cli(o, 'claude', args, j => {
    if (j.session_id) resume[sk] = j.session_id
    if (j.type === 'system' && j.model) r.model = j.model
    if (j.type === 'assistant')
      for (const b of j.message?.content ?? []) {
        if (b.type === 'tool_use') (r.calls++, say(o.t, 'tool', `${String(b.name).replace(/^mcp__laki__/, '')} ${JSON.stringify(b.input ?? {})}`))
      }
    if (j.type === 'result') {
      r.text = j.result ?? ''
      r.cost = j.total_cost_usd
      const u = j.usage ?? {}
      r.in = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      r.out = u.output_tokens ?? 0
      if (j.is_error) failed = j.result || j.subtype
    }
  }).catch(e => {
    if (resume[sk] && /session|conversation/i.test(e.message)) resume[sk] = undefined // gone: the next ask starts afresh
    throw failed ? new Error(failed) : e // its own words over the exit code
  })
  if (failed) throw new Error(failed)
}

// codex exec, read-only, only the laki tools (a long wsNew: 5 minutes); resume goes on with its thread
async function codex(o: Opts) {
  const model = state.settings?.ai?.models?.codex
  const sk = sessionKey('codex')
  const resume = o.t.resume
  const m = mcpServer(o.t.id)
  const toml = (v: unknown) => JSON.stringify(v) // a TOML basic string or array of them reads as JSON does
  const env = `{${Object.entries(m.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`
  const args = [
    'exec',
    ...(resume[sk] ? ['resume', resume[sk]!] : []),
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config', // the user's config.toml: its MCP servers would be tools past Laki's (claude: --strict-mcp-config)
    '-c', 'sandbox_mode="read-only"',
    '-c', `developer_instructions=${toml(system(o.t))}`,
    '-c', `mcp_servers.laki.command=${toml(m.command)}`,
    '-c', `mcp_servers.laki.args=${toml(m.args)}`,
    '-c', `mcp_servers.laki.env=${env}`,
    '-c', 'mcp_servers.laki.tool_timeout_sec=300',
    ...(model ? ['-m', model] : []),
    ...effortArgs('codex'),
    ...o.images.flatMap(i => ['-i', i]),
    '--',
    o.ask || 'See the image.',
  ]
  const r = o.r
  let failed = ''
  await cli(o, 'codex', args, j => {
    if (j.type === 'thread.started' && j.thread_id) resume[sk] = j.thread_id
    const it = j.item
    if (j.type === 'item.started' && it?.type === 'mcp_tool_call') (r.calls++, say(o.t, 'tool', `${it.tool} ${JSON.stringify(it.arguments ?? {})}`))
    if (j.type === 'item.completed' && it?.type === 'agent_message') r.text = it.text ?? ''
    if (j.type === 'turn.completed') (r.in += j.usage?.input_tokens ?? 0), (r.out += j.usage?.output_tokens ?? 0)
    if (j.type === 'turn.failed' || j.type === 'error') failed = j.error?.message ?? j.message ?? 'failed'
  }).catch(e => {
    if (resume[sk] && /thread|session|conversation|not found/i.test(e.message + failed)) resume[sk] = undefined // gone: the next ask starts afresh
    throw failed ? new Error(failed) : e // its own words over the exit code
  })
  if (failed) throw new Error(failed)
}

// ---------- asking the user (the skill's laki_ask, laki_remove and laki_extension_on)

// a question in the conversation, its options as buttons on the AI page; only while an ask is at work (its tools'). act:
// a removal the AI asked about, or an extension to turn on, done here when the user picks Yes (the AI itself never does)
// an option's look as laki_ask gave it: a UI kit element (an object with a type) over its data, 16 KB of JSON at most
const LOOK_MAX = 16 << 10
function lookOf(v: unknown): AiLook | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const l = v as Record<string, unknown>
  const ui = l.ui && typeof l.ui === 'object' && !Array.isArray(l.ui) && typeof (l.ui as { type?: unknown }).type === 'string' ? (l.ui as Record<string, unknown>) : null
  if (!ui) return null
  const size = Array.isArray(l.size) && l.size.length === 2 && [1, 2, 3, 4].includes(Number(l.size[0])) && [0.5, 1, 2, 3, 4].includes(Number(l.size[1])) ? ([Number(l.size[0]), Number(l.size[1])] as [number, number]) : undefined
  const look: AiLook = { ui, ...(l.data !== undefined && { data: l.data }), ...(size && { size }) }
  return JSON.stringify(look).length <= LOOK_MAX ? look : null
}
export function aiQuestion(p: { text?: string; options?: unknown[]; looks?: unknown[]; act?: AiAct; chat?: string }) {
  const t = asking(p.chat) // the chat whose ask is at work
  const act: AiAct | undefined = p.act && AI_ACTS.includes(p.act.kind) && typeof p.act.id === 'string' && p.act.id ? { kind: p.act.kind, id: p.act.id, project: typeof p.act.project === 'string' ? p.act.project : undefined, label: '', ...(p.act.kind === 'run' && { text: String(p.act.text ?? '').slice(0, RUN_MAX) }), ...(p.act.kind === 'profile' && { text: JSON.stringify(profilesOf(p.act.text)) }) } : undefined
  if (act?.kind === 'run' && !act.text?.trim()) throw new Error('what to run? the command is empty')
  if (act) act.label = whatOf(act) ?? '' // the thing itself, never the model's words: a Yes removes what it says
  if (act && !act.label) throw new Error(`no ${act.kind === 'widget' ? 'extension' : act.kind} ${act.id}${act.kind === 'memory' ? ' in that project' : ''}`)
  const on = act?.kind === 'widget' ? widgetWhat(act.id) : undefined // what it runs, in Laki's words, before the user picks
  if (on?.on) throw new Error(`${on.name} is on already`)
  if (act && on) act.hash = on.hash // its files as asked about: a Yes needs them still
  const text = act ? (on ? turnOn(act, on.text) : act.kind === 'run' ? runIn(act) : act.kind === 'profile' ? profilesAsk(act) : `Remove ${act.label}?`) : String(p.text ?? '').trim().slice(0, 2000)
  if (!text) throw new Error('a question')
  // each option with its look (an extension's chat: how it would show), the same option once
  const given = (Array.isArray(p.options) ? p.options : []).map((o, i) => [String(o).trim().slice(0, 200), lookOf(Array.isArray(p.looks) ? p.looks[i] : undefined)] as const).filter(([o], i, all) => o && all.findIndex(x => x[0] === o) === i).slice(0, 6)
  const options = act ? (on ? ['Yes, turn it on', 'No, leave it off'] : act.kind === 'run' ? ['Yes, run it', "No, don't"] : act.kind === 'profile' ? ['Yes, save them', "No, don't"] : [`Yes, remove ${act.label}`, 'No, keep it']) : given.map(([o]) => o)
  if (options.length < 2) throw new Error('2 to 6 options')
  const looks = act || !given.some(([, l]) => l) ? undefined : given.map(([, l]) => l)
  const id = randomBytes(6).toString('hex')
  t.chat.push({ role: 'ai', text, at: (t.at = Date.now()), ask: { id, options, act, ...(looks && { looks }) } })
  t.asked = true
  changed(t)
  return { asked: id, note: act ? `The user sees Yes / No buttons; a Yes ${on ? 'turns it on' : act.kind === 'run' ? 'runs it, Laki does' : act.kind === 'profile' ? 'saves them, Laki does' : 'removes it'} (you do not). End your turn now, without more words.` : 'The user sees the options as buttons. End your turn now, without more words: their pick comes as the next message.' }
}

// the user's pick (the AI page's buttons): a removal is done here on Yes; any other pick goes on as the next ask
export async function aiAnswer(p: { id: string; n: number; chat?: string }, rpc: Rpc) {
  const t = thread(p.chat)
  const chat = t.chat
  const m = chat.find(m => m.ask?.id === p.id)
  if (!m?.ask) throw new Error('no such question: a new chat started since')
  if (m.ask.picked !== undefined) throw new Error('answered already')
  if (m.ask.perm) {
    const done = perms.get(m.ask.id)?.done
    if (!done || AI_PERM[Number(p.n)] === undefined) throw new Error(done ? 'no such option' : 'it waits no more: ask again')
    done(Number(p.n))
    return { allowed: Number(p.n) < 2 }
  }
  if (t.ended) throw new Error('this chat ended: Continue it, or ask again') // a pick would start a new chat without the question
  if (chat.slice(chat.indexOf(m) + 1).some(x => x.role === 'user')) throw new Error('a newer ask came since: ask again') // its context is gone
  refuseBusy(t)
  const pick = m.ask.options[Number(p.n)]
  if (pick === undefined) throw new Error('no such option')
  const act = m.ask.act
  if (!act) {
    const r = aiAsk({ text: pick, chat: p.chat }, rpc) // its checks (on, a key) are before its first await: busy once they pass
    if (busy.has(t.id)) (m.ask.picked = pick), changed(t) // refused: the buttons stay, for another try
    return r
  }
  m.ask.picked = pick
  say(t, 'user', pick)
  const on = act.kind === 'widget'
  if (Number(p.n) !== 0) return say(t, 'ai', on ? `Left ${act.label} off.` : act.kind === 'run' ? 'Not run.' : act.kind === 'profile' ? 'Not saved.' : `Kept ${act.label}.`), { kept: true }
  // only what they were shown: its files may have changed since (an agent's write, a save, a source set). Then the
  // question again, as it reads now
  const now = on ? widgetWhat(act.id) : undefined
  if (now && (turnOn(act, now.text) !== m.text || now.hash !== act.hash)) {
    const why = 'it changed since you were asked: ask again'
    say(t, 'error', `${act.label}: ${why}`)
    if (!now.on) t.chat.push({ role: 'ai', text: turnOn(act, now.text), at: (t.at = Date.now()), ask: { id: randomBytes(6).toString('hex'), options: m.ask.options, act: { ...act, hash: now.hash } } }), changed(t)
    throw new Error(why)
  }
  try {
    if (now) {
      await rpc('widgetSet', { id: act.id, on: true, seen: now.hash }) // the user's pick: no agent's
      say(t, 'ai', `Turned on ${act.label}.`)
      return { on: true }
    }
    if (act.kind === 'run') {
      await runAct(act, rpc)
      say(t, 'ai', `Ran it in ${act.label}.`)
      return { ran: true }
    }
    if (act.kind === 'profile') {
      await saveProfiles(act, rpc)
      say(t, 'ai', `Saved ${act.label}: Settings › Agents & profiles has them, and every agent menu.`)
      return { saved: true }
    }
    await remove(act, rpc)
    say(t, 'ai', `Removed ${act.label}.`)
    return { removed: true }
  } catch (e) {
    say(t, 'error', `${act.label}: ${(e as Error).message}`)
    throw e
  }
}
const turnOn = (a: AiAct, what: string) => `Turn on ${a.label}? ${what}`
// a command in a shell (laki_run, laki_shell's run): shown as it will run, in a fence longer than any it has
const RUN_MAX = 4000
function runIn(a: AiAct) {
  const fence = '`'.repeat(Math.max(3, ...[...(a.text ?? '').matchAll(/`+/g)].map(m => m[0].length + 1)))
  const ws = state.workspaces.find(w => w.id === state.tabs.find(x => x.id === a.id)?.workspace)
  return `Run this in ${a.label}${ws ? ` (${ws.name ?? ws.id})` : ''}?\n\n${fence}sh\n${a.text}\n${fence}`
}
// the user's Yes: the shell checked again (still at its prompt), the line cleared (⌃E ⌃U), the command and Enter
async function runAct(a: AiAct, rpc: Rpc) {
  const t = (await rpc<View>('state')).tabs.find(x => x.id === a.id)
  if (!t || t.kind !== 'shell' || t.status === 'exited') throw new Error('that shell is gone')
  if (t.status === 'running' || t.runs) throw new Error(`${t.name} is running something now: not run`)
  await rpc('input', { tab: t.id, data: '\x05\x15' })
  await rpc('send', { target: t.id, text: a.text })
}
// laki_profiles: agent profiles Laki AI would add or change by name (the user's Yes saves them): an agent with its
// model, effort, permission mode and fast mode; never a command, args or env of its own (what runs is the agent)
const PROFILES_MAX = 10
function profilesOf(text?: string): Preset[] {
  let list: unknown
  try {
    list = JSON.parse(String(text ?? ''))
  } catch {
    throw new Error('the profiles: a JSON list')
  }
  if (!Array.isArray(list) || !list.length || list.length > PROFILES_MAX) throw new Error(`1 to ${PROFILES_MAX} profiles`)
  const out: Preset[] = []
  for (const x of list as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') throw new Error('each profile: { "name", "agent", … }')
    const name = String(x?.name ?? '').trim().slice(0, 40)
    const agent = String(x?.agent ?? '').trim()
    if (!name || ['shell', 'custom', 'none'].includes(name)) throw new Error(`a profile's name: ${name || 'none given'}`)
    if (!(AGENTS as readonly string[]).includes(agent)) throw new Error(`${name}: agent ${agent || '?'}: one of ${AGENTS.join(', ')}`)
    const [model, effort, perm] = [x.model, x.effort, x.perm].map(v => (typeof v === 'string' && v.trim()) || undefined)
    const fast = x.fast === true || undefined
    modelCheck(agent, model, effort, perm, fast)
    if (out.some(p => p.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ name, agent: agent as Preset['agent'], ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }), ...(fast && { fast }) })
  }
  return out
}
// the question: each profile as it would start, and which of the user's it replaces
function profilesAsk(a: AiAct) {
  const have = presets()
  const lines = profilesOf(a.text).map(p => {
    const mode = p.perm && PERMS[p.agent as keyof typeof PERMS]?.find(m => m[0] === p.perm)
    const says = [p.agent, p.model && `model ${p.model}`, p.effort && `${p.effort} effort`, mode && `${mode[1].toLowerCase()} (${mode[2].toLowerCase()})`, p.fast && 'fast mode'].filter(Boolean).join(', ')
    return `- **${p.name}**: ${says}${have.some(h => h.name.toLowerCase() === p.name.toLowerCase()) ? ' · replaces yours' : ''}`
  })
  return `Save ${lines.length === 1 ? 'this agent profile' : 'these agent profiles'}? They show in every agent menu (Settings › Agents & profiles).\n\n${lines.join('\n')}`
}
// the user's Yes: added, or one of the same name changed (its env and account kept; its args and command only while
// it stays the same agent: another's flags would break its start; one turned off, on again)
async function saveProfiles(a: AiAct, rpc: Rpc) {
  const add = profilesOf(a.text)
  const same = (x: Preset, y: Preset) => x.name.toLowerCase() === y.name.toLowerCase()
  const have = presets()
  const changed = (h: Preset, n: Preset): Preset => ({ ...h, ...(h.agent !== n.agent && { args: undefined, cmd: undefined }), agent: n.agent, model: n.model, effort: n.effort, perm: n.perm, fast: n.fast, off: undefined })
  const next = [...have.map(h => (n => (n ? changed(h, n) : h))(add.find(n => same(n, h)))), ...add.filter(n => !have.some(h => same(n, h)))]
  await rpc('settingsSet', { presets: next })
}

// what a removal would take, in words, from Laki's own state
function whatOf(a: AiAct) {
  const cut = (t: string) => `“${t.length > 80 ? `${t.slice(0, 79)}…` : t}”`
  if (a.kind === 'profile') return (ps => `the profile${ps.length === 1 ? '' : 's'} ${ps.map(p => p.name).join(', ')}`)(profilesOf(a.text))
  if (a.kind === 'schedule') {
    const x = state.schedules?.find(x => x.id === a.id)
    return x && `the scheduled task ${cut(x.name || x.prompt)}`
  }
  if (a.kind === 'tab' || a.kind === 'run') {
    const x = state.tabs.find(x => x.id === a.id && (a.kind === 'tab' || x.kind === 'shell'))
    return x && `the tab ${cut(x.name)}`
  }
  if (a.kind === 'todo') {
    const x = state.todos?.find(x => x.id === a.id)
    return x && `the to-do ${cut(x.text)}`
  }
  if (a.kind === 'widget') {
    const x = widgetsView().find(x => x.id === a.id)
    return x && `the extension ${cut(x.name)}`
  }
  const x = state.projects.find(x => x.id === a.project)?.memory?.find(m => m.id === a.id)
  return x && `the memory ${cut(x.text)}`
}

async function remove(a: AiAct, rpc: Rpc) {
  if (a.kind === 'schedule') return rpc('scheduleRm', { id: a.id })
  if (a.kind === 'tab') return rpc('tabClose', { id: a.id })
  if (a.kind === 'todo') return rpc('todoRm', { id: a.id })
  const p = (await rpc<View>('state')).projects.find(x => x.id === a.project)
  if (!p?.memory?.some(m => m.id === a.id)) throw new Error('not in that project’s memory any more')
  return rpc('projectSet', { id: p.id, memory: p.memory.filter(m => m.id !== a.id) })
}

// ---------- its agent asking to use a tool (claude -p's --permission-prompt-tool: laki mcp's laki_permission)

// claude's Read outside its folder, say: a question in the chat while the ask works, AI_PERM's buttons, its tool call
// waiting on the pick (Always in this chat: that tool unasked until a new chat); no pick in PERM_WAIT, or the ask ends: no
const PERM_WAIT = 280000 // under the MCP call's 5 minutes (MCP_TOOL_TIMEOUT)
const perms = new Map<string, { chat: string; done: (n: number) => void }>() // a waiting ask's id: its chat, its pick (-1: none)
export function aiPermission(p: { tool?: unknown; input?: unknown; chat?: string }): Promise<{ allow: boolean; message?: string }> | { allow: boolean } {
  const t = asking(p.chat)
  const tool = String(p.tool ?? '').replace(/^mcp__/, '').slice(0, 100)
  if (!tool) throw new Error('a tool')
  if (t.allowed?.has(tool)) return { allow: true }
  const i = (p.input && typeof p.input === 'object' ? p.input : {}) as Record<string, unknown>
  const what = String(i.file_path ?? i.path ?? i.command ?? i.url ?? i.pattern ?? (Object.keys(i).length ? JSON.stringify(i) : '')).slice(0, 300)
  const id = randomBytes(6).toString('hex')
  const m: AiMsg = { role: 'ai', text: `May I use **${tool}**${what ? ` on \`${what.replace(/`/g, "'")}\`` : ''}? ${PERM_WHY}`, at: (t.at = Date.now()), ask: { id, options: [...AI_PERM], perm: true } }
  t.chat.push(m)
  changed(t)
  return new Promise(resolve => {
    const done = (n: number) => {
      clearTimeout(timer)
      perms.delete(id)
      m.ask!.picked = AI_PERM[n] ?? 'Not answered'
      if (n === 1) (t.allowed ??= new Set()).add(tool)
      changed(t)
      resolve(n === 0 || n === 1 ? { allow: true } : { allow: false, message: n === 2 ? 'The user said no: do without it, or ask them another way.' : 'The user did not answer: do without it.' })
    }
    const timer = setTimeout(() => done(-1), PERM_WAIT)
    perms.set(id, { chat: t.id, done })
  })
}
const PERM_WHY = 'It needs your OK: Laki AI may use only its laki tools unasked.'

// ---------- the call log

// ponytail: the whole log is read for the page and the totals; keep only this month's lines if it ever gets slow
function readCalls(): AiCall[] {
  try {
    return readFileSync(callsPath, 'utf8')
      .split('\n')
      .flatMap(l => {
        try {
          return l ? [JSON.parse(l)] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
