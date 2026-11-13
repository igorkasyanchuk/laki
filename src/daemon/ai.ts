// Laki's own AI (Settings › AI, the AI page, `laki ai`): optional, and only when asked. A conversation that works
// Laki with the MCP server's tools (shared/tools.ts: none archives, deletes, ships or merges), run by OpenRouter (its key in
// <data>/ai-key, 0600) or by an agent's CLI in the background: claude -p or codex exec, each given `laki mcp`. Every ask
// is logged with its tokens and cost in <data>/ai-calls.jsonl; the conversation is <data>/ai-chat.json. A spec or brainstorm
// has a chat of its own (the Specs page's side panel), kept in its folder (.chat.json), which ends after PLAN_CHAT_IDLE
// unused: the next ask starts a new one, unless aiContinue takes it up again. One ask at a time, in any chat. Its `ai`
// event says which chat as `of` ('' the AI page's): an `id` would make it a reply.
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readJson, rotateLog, writeAtomic } from '../shared/conn.ts'
import { dirname, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { helpFind, helpParts, type HelpPart } from '../shared/help.ts'
import { device, screenShot } from './device.ts'
import { aiRpc, groupRule, type Rpc, skillTools, SKILL, type Tool, tools, wsLose } from '../shared/tools.ts'
import { endpointOk, AGENTS, AI_ACTS, AI_ITEMS, type AiItem, AI_PERM, AI_MODEL, PERMS, aiOn, VOICE_MODEL, type VoiceModel, voiceFillers, voiceFix, voiceOn, voicePrice, AI_CONTEXT_MAX as CONTEXT_MAX, AI_STEPS, type AiAct, type AiBackend, type GateHeld, type AiCall, type AiLook, type AiMsg, type AiPast, aiTotals, type StudioChat, type View, EFFORTS, type Preset, type Agent, SANDBOX, SANDBOX_NO, sandboxOff } from '../shared/types.ts'
import { BRAINSTORM_METHOD, PLAN_CHAT_IDLE } from '../shared/plans.ts'
import { broadcast, cliArgv, modelCheck, presets, prs, sessions, state } from './core.ts'
import { dir } from './dir.ts'
import { execGroup, own } from './resources.ts'
import { accountEnv, accountUsed } from './accounts.ts'
import { planGet, planOfChat } from './plans.ts'
import { widgetChatFile, widgetCheck, widgetFiles, widgetHome, widgetLogs, widgetsView, widgetWhat } from './widgets.ts'
import { widgetFormat } from '../shared/widgetGuide.ts'

const keyPath = join(dir, 'ai-key')
const chatPath = join(dir, 'ai-chat.json')
// S2: an agent's asks (laki ai from its tab) have a chat of their own, per tab: its words never sit in the history of
// an ask of yours, which acts as you. ponytail: its file stays after the tab closes (a few KB; it ends as a spec's does)
export const agentChat = (tab: string) => `agent:${tab}`
const AGENT_CHAT = /^agent:[\w.-]{1,80}$/
const pastDir = join(dir, 'ai-chats') // the AI page's earlier chats: <at>-<hex>.json each, as ai-chat.json
const PAST_MAX = 100 // ponytail: the newest kept; older ones go as a new one is kept
const PAST_ID = /^\d+-[0-9a-f]{6}$/
const callsPath = join(dir, 'ai-calls.jsonl')
const logCall = (call: AiCall) => (rotateLog(callsPath), appendFileSync(callsPath, JSON.stringify(call) + '\n', { mode: 0o600 })) // R7: past 10 MB, the older ones in .1
const home = join(dir, 'ai') // the CLI agents' folder: no repo, no project's CLAUDE.md or AGENTS.md
const KEEP = 200 // the conversation's messages kept
const TOOL_TEXT = 4000 // what a tool's result may give the model; the page shows less
const MAX_IMAGE = 8 << 20

// tests: a fake OpenRouter on this Mac only (a session's env can reach a daemon the CLI starts)
const api = () => {
  const t = process.env.LAKI_AI_API
  return t && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : 'https://openrouter.ai/api/v1'
}
// Settings › AI › Your endpoint (backend 'endpoint', settings.aiEndpoint): any OpenAI-compatible chat-completions server,
// the same tool loop. https anywhere, http only on this Mac; no user or password in its URL; its key a file of its own
// (0600; none for a local server). OpenRouter's own parts (cache marks, usage.include, x-title, its prices) stay out:
// its calls aren't priced
const endpointKeyPath = join(dir, 'ai-endpoint-key')
const readEndpointKey = () => {
  try {
    return readFileSync(endpointKeyPath, 'utf8').trim()
  } catch {
    return ''
  }
}
export function aiEndpointKey(o: { key?: string | null }) {
  const key = o.key?.trim()
  if (!key) return rmSync(endpointKeyPath, { force: true }), { key: false }
  if (!/^[\x21-\x7e]{1,400}$/.test(key)) throw new Error('that does not look like an API key')
  writeFileSync(endpointKeyPath, key + '\n', { mode: 0o600 })
  return { key: true }
}
// where a chat-completions call goes: Your endpoint (backend 'endpoint'), else OpenRouter
type Target = { url: string; key: string; model: string; or: boolean; name: string; redirect: RequestRedirect } // redirect: Your endpoint's never followed (its https-or-this-Mac rule would be gone)
const target = (backend = state.settings?.ai?.backend): Target => {
  if (backend !== 'endpoint') return { url: api(), key: readKey(), model: state.settings?.ai?.models?.openrouter || AI_MODEL, or: true, name: 'OpenRouter', redirect: 'follow' }
  const e = state.settings?.aiEndpoint
  if (!e?.url || !e.model) throw new Error('no endpoint: Settings › AI › Your endpoint (its URL and model)')
  return { url: endpointOk(e.url), key: readEndpointKey(), model: e.model, or: false, name: 'Your endpoint', redirect: 'error' }
}
const headersOf = (t: Target) => ({ ...(t.key && { authorization: `Bearer ${t.key}` }), 'content-type': 'application/json', ...(t.or && { 'x-title': 'Laki' }) })
// Settings › AI's Test: one short ask to Your endpoint, its answer or why not
export async function aiEndpointTest() {
  const t = target('endpoint')
  const res = await fetch(`${t.url}/chat/completions`, { method: 'POST', headers: headersOf(t), redirect: t.redirect, body: JSON.stringify({ model: t.model, messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 16 }), signal: AbortSignal.timeout(20000) })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || j.error) throw new Error(`Your endpoint: ${j.error?.message ?? (typeof j.error === 'string' ? j.error : res.status)}`)
  const text = j.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Your endpoint: no answer (is it OpenAI-compatible?)')
  return { model: j.model || t.model, text: text.slice(0, 200) }
}

const SYSTEM = `You are Laki's assistant. Laki is a Mac app that runs coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in a workspace: a git worktree on its own branch, with tabs (agent sessions, shells).
Do what the user asks with the laki tools, at once, without asking first: look things up with laki_state (workspaces, their PRs with titles, each tab's status and last answer), laki_screen and laki_diff; start work with laki_new_workspace (a PR to review: its pr field and a prompt saying what to do), laki_new_tab (another agent in a workspace that exists), laki_send (a message to a running agent), laki_attach_pr; laki_schedules and laki_schedule_add when asked to schedule work.
${groupRule("laki_state's groups; laki_new_workspace's group")} Look at the project's groups before laki_new_workspace. A group with a prompt template (laki_state's groupTemplates) starts its workspaces with it on its own; otherwise, when one of the user's prompt templates (laki_templates) plainly fits the task, give it as laki_new_workspace's template; none fits, none.
Find workspaces by name, branch, PR number or PR title. You never archive or delete a workspace yourself (with Laki's skill you ask the user, and Laki does it at their Yes), and never ship or merge: say so if asked.
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
  const plan = t.id && !t.id.startsWith('widget:') && !AGENT_CHAT.test(t.id) ? planOfChat(t.id) : undefined
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
    plan.kind === 'brainstorm' && `How to brainstorm with the user (the laki-specs skill's method; a decision that's theirs goes to laki_ask):\n${BRAINSTORM_METHOD}`,
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
    `This chat is on the page of ${v ? `the Laki extension "${v.name}" (id ${id})` : `a new Laki extension: its id is ${id}`}. Beside it the user sees its preview (with its sample data), its settings and its inspector: every ask in it is about it, even one that doesn't name it.${v && v.dir !== `${widgetHome()}/${id}` ? " It isn't in Laki's own folder (it's in a folder of the user's, or a repo's): you can't write it; the page's Remix makes a copy you can." : ''}`,
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
const toolsFor = (to: Rpc, chat: string, rpc = aiRpc(to, chat)) => [...tools(rpc, undefined, 'Laki AI').filter(t => !['laki_progress', 'laki_memory', 'laki_remember', 'laki_name', 'laki_secret'].includes(t.name)), ...(skilled() ? skillTools(rpc) : [])] // its looks said as its own (aiRpc)

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
    if (res.ok && !j.error) {
      const said = String(j.text ?? '').trim()
      const c = state.settings?.voice?.fillers === false ? { text: said, n: 0 } : voiceFillers(said)
      const f = voiceFix(c.text, state.settings?.voice?.fixes)
      return { text: f.text, ...(f.fixed.length && { fixed: f.fixed }), ...(c.n && { fillers: c.n }) }
    } // Word fixes: what changed, for the bar
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

// Q11: OpenRouter's speech-to-text models with their prices, as it lists them now (its public model list: no key, nothing
// of yours sent), kept an hour; Settings › Voice shows them. Offline: an error, and the page shows the prices Laki came with
let sttList: { at: number; models: VoiceModel[] } | undefined
const STT_KEEP = 3600e3
export async function voiceModels(): Promise<{ at: number; models: VoiceModel[] }> {
  if (sttList && Date.now() - sttList.at < STT_KEEP) return sttList
  const res = await fetch(`${api()}/models?output_modalities=transcription`, { headers: { 'x-title': 'Laki' }, signal: AbortSignal.timeout(15000) }).catch((e: Error) => {
    throw new Error(`Can't reach OpenRouter: ${e.name === 'TimeoutError' ? 'no answer in 15 seconds' : e.message}`)
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: its model list`)
  const j: any = await res.json().catch(() => ({}))
  const models: VoiceModel[] = (Array.isArray(j?.data) ? j.data : []).slice(0, 300).flatMap((m: any) => {
    const price = voicePrice(m?.pricing)
    return typeof m?.id === 'string' && /^[\w.-]+\/[\w.:-]+$/.test(m.id) && price ? [{ id: m.id.slice(0, 120), name: String(m.name ?? m.id).slice(0, 120), price }] : []
  })
  return (sttList = { at: Date.now(), models })
}

// laki_alert from Laki AI (alerts.ts): only when you asked for one in that chat's last message, Your instructions name
// alerts, or Settings › AI's Important alerts on its own is on: never a card over every app for news it picked itself
const ALERT_SAID = /\balert/i
export function aiMayAlert(chat?: string) {
  const s = state.settings?.ai
  if (s?.alerts || ALERT_SAID.test(s?.context ?? '')) return true
  const t = threads.get(chat ?? (busy.size === 1 ? [...busy.keys()][0] : '\0'))
  return !!t && ALERT_SAID.test(t.chat.findLast(m => m.role === 'user')?.text ?? '')
}

// ---------- the conversations: '' the AI page's, plan:<project>/<kind>/<slug> a spec's or brainstorm's (plans.ts)

// resume: claude's session, codex's thread, by sessionKey: the next ask goes on with it. at: the last message.
// ended: a spec's or brainstorm's chat unused PLAN_CHAT_IDLE: the next ask starts it again, empty
type Thread = { id: string; file: string; chat: AiMsg[]; resume: Record<string, string | undefined>; at: number; ended?: number; about?: string; allowed?: Set<string>; asked?: boolean; shots?: string[]; queue?: Queued[] } // about: a widget chat's brief for this ask (aboutWidget); allowed: the tools Always in this chat let its agent use
const threads = new Map<string, Thread>()
// what you send while it answers (aiAsk queue): kept in memory, all of it the next ask as the answer ends (any end, Stop
// too); aiUnqueue drops one first. ponytail: a restart forgets them
type Queued = { text: string; images: string[]; context?: string }
const QUEUE_MAX = 10
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
  const file = !id ? chatPath : id.startsWith('widget:') ? widgetChatFile(id) : AGENT_CHAT.test(id) ? join(dir, `ai-agent-${id.slice(6)}.json`) : planOfChat(id).file // a spec's gone, or off: that says so, each time
  const known = threads.get(id)
  if (known) return known
  const j: any = readJson(file) ?? {}
  const t: Thread = { id, file, chat: Array.isArray(j.chat) ? j.chat : [], resume: j.resume ?? {}, at: Number(j.at) || Date.now(), ended: j.ended }
  for (const m of t.chat) if (m.ask?.perm && m.ask.picked === undefined) m.ask.picked = 'Not answered' // its agent ended with the daemon
  // a Yes to several the daemon ended in the middle of: the one under way, and the ones it never got to, say so
  for (const m of t.chat) if (m.ask?.picked !== undefined) for (const i of m.ask.act?.items ?? []) if (!i.said || i.said === '…') i.said = i.said ? 'not known: Laki quit meanwhile' : 'not done: Laki quit meanwhile'
  if (id && !t.ended && t.chat.length && Date.now() - t.at > PLAN_CHAT_IDLE) t.ended = t.at + PLAN_CHAT_IDLE // ran out while the daemon wasn't looking
  threads.set(id, t)
  return t
}
function changed(t: Thread) {
  t.chat = t.chat.slice(-KEEP)
  try {
    writeAtomic(t.file, JSON.stringify({ chat: t.chat, resume: t.resume, at: t.at, ended: t.ended }), 0o600) // R7: whole or not at all
  } catch {}
  broadcast({ ev: 'ai', of: t.id, chat: t.chat, busy: busy.has(t.id), ended: t.ended, queue: queueOf(t), seenFrom: seenFrom(t) })
}
const queueOf = (t: Thread) => t.queue?.map(q => q.text || `(${q.images.length} image${q.images.length === 1 ? '' : 's'})`) ?? []
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
  writeAtomic(join(pastDir, `${t.at}-${randomBytes(3).toString('hex')}.json`), JSON.stringify({ chat: t.chat, resume: t.resume, at: t.at }), 0o600)
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
  return { chat: t.chat, busy: busy.has(t.id), ended: t.ended, queue: queueOf(t), seenFrom: seenFrom(t), key: hasKey(), endpointKey: !!readEndpointKey(), calls: calls.slice(-100).reverse(), totals: aiTotals(calls) }
}

// ---------- asking

type Run = { text: string; model: string; calls: number; in: number; out: number; cached?: number; cost?: number }
// r: what the ask spent so far, kept when it fails too
type Opts = { t: Thread; ask: string; images: string[]; rpc: Rpc; signal: AbortSignal; spawned: (c: ChildProcess) => void; r: Run }

// chat: a spec's or brainstorm's (planChat), else the AI page's; one that ended starts again, empty
// context: where the user is as they ask (the floating chat's: the page, workspace and tab), for the model only: the
// conversation keeps their words alone
export async function aiAsk(p: { text?: string; images?: string[]; chat?: string; context?: string; queue?: boolean }, rpc: Rpc): Promise<{ text?: string; queued?: number }> {
  const s = state.settings?.ai ?? {}
  if (!aiOn(state.settings)) throw new Error('Laki AI is off: Settings › AI')
  const ask = (p.text ?? '').trim()
  const images = (p.images ?? []).filter(imageOk)
  if (!ask && !images.length) throw new Error('ask something')
  const t = thread(p.chat)
  if (p.queue && busy.has(t.id)) {
    if ((t.queue ??= []).length >= QUEUE_MAX) throw new Error(`${QUEUE_MAX} messages wait already: let it answer first`)
    t.queue.push({ text: ask, images, context: typeof p.context === 'string' ? p.context : undefined })
    changed(t)
    return { queued: t.queue.length }
  }
  refuseBusy(t)
  const backend: AiBackend = s.backend ?? 'openrouter'
  if (backend === 'openrouter' && !hasKey()) throw new Error('no OpenRouter API key: Settings › AI')
  if (backend === 'endpoint') target(backend) // its URL and model set, before anything is said
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
  t.shots = undefined
  const t0 = Date.now()
  const r: Run = { text: '', model: backend === 'endpoint' ? state.settings?.aiEndpoint?.model || backend : s.models?.[backend] || (backend === 'openrouter' ? AI_MODEL : backend), calls: 0, in: 0, out: 0 }
  const where = typeof p.context === 'string' ? p.context.trim().slice(0, CONTEXT_MAX) : ''
  const o: Opts = { t, ask: where ? `${ask || 'See the image.'}\n\n[Where the user is in Laki as they ask this: ${where}]` : ask, images, rpc, signal: ctl.signal, spawned: c => (child = c), r }
  const call: AiCall = { at: t0, backend, model: r.model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: ask.slice(0, 120) }
  try {
    await (backend === 'claude' ? claude(o) : backend === 'codex' ? codex(o) : openrouter(o)) // openrouter: Your endpoint's too
    call.ok = true
    if (r.text.trim() || !t.asked) say(t, 'ai', r.text || '(no answer)') // a question it asked is the answer
    return { text: r.text }
  } catch (e) {
    const msg = ctl.signal.aborted ? 'stopped' : (e as Error).message
    call.error = msg
    say(t, 'error', msg)
    throw new Error(msg)
  } finally {
    Object.assign(call, { model: r.model, in: r.in, out: r.out, ...(r.cached && { cachedIn: r.cached }), cost: r.cost, tools: r.calls, ms: Date.now() - t0 })
    busy.delete(t.id)
    for (const p of perms.values()) if (p.chat === t.id) p.done(-1) // its agent is gone: nothing waits on them
    try {
      logCall(call)
    } catch {}
    const next = t.queue?.splice(0) ?? []
    changed(t)
    if (next.length) {
      // what was sent meanwhile, all of it as one ask; refused before it asked (Laki AI off, too many chats at work): said, not lost
      const text = next.map(q => q.text).filter(Boolean).join('\n\n')
      setImmediate(() => aiAsk({ chat: p.chat, text, images: next.flatMap(q => q.images), context: next.findLast(q => q.context)?.context }, rpc).catch(e => t.chat.findLast(m => m.role === 'user')?.text === text || say(t, 'error', `Not sent (${(e as Error).message}): ${text}`)))
    }
  }
}
// a message waiting for the answer to end, taken back (the composer's ✕)
export function aiUnqueue(p: { chat?: string; i: number; text?: string }) {
  const t = thread(p.chat)
  if (!t.queue?.[p.i] || (p.text !== undefined && queueOf(t)[p.i] !== p.text)) throw new Error('that one went already, or the list changed: look again') // text: the one you saw there
  t.queue.splice(p.i, 1)
  changed(t)
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

// A8: the earlier asks and answers, for a model that keeps no session of its own (OpenRouter): whole turns (an ask and
// what answered it), newest first while they fit HISTORY_CHARS, the newest always; older ones left out. The tools'
// calls and results never go (the chat keeps no results; it looks again). Nothing stored or shown changes.
// ponytail: a summary of the turns left out if it forgets too much
const HISTORY_CHARS = 60_000
function earlier(chat: AiMsg[]) {
  const msgs = chat.filter(m => m.role === 'user' || m.role === 'ai')
  let from = msgs.length
  for (let i = msgs.length - 1, used = 0; i >= 0; ) {
    let j = i
    while (j > 0 && msgs[j].role !== 'user') j-- // back to the ask that began it
    const size = msgs.slice(j, i + 1).reduce((n, m) => n + (m.text?.length || 12), 0)
    if (from < msgs.length && used + size > HISTORY_CHARS) break
    used += size
    from = j
    i = j - 1
  }
  return msgs.slice(from)
}
const history = (t: Thread) => earlier(t.chat.slice(0, -1)).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text || '(an image)' }))
// the first message the model sees with the next ask (its at), when older ones are left out: the page marks it.
// OpenRouter's only: claude and codex keep their own session
const seenFrom = (t: Thread) => {
  if (['claude', 'codex'].includes(state.settings?.ai?.backend ?? 'openrouter')) return undefined
  const kept = earlier(t.chat)
  return kept.length < t.chat.filter(m => m.role === 'user' || m.role === 'ai').length ? kept[0]?.at : undefined
}

// A3: Anthropic's models on OpenRouter cache a prompt only up to a cache_control breakpoint (others cache on their own):
// one after the tools (tools come first in its prefix: cached even when the system prompt changes) and one after the
// system prompt, so each round and the next ask read them back at a tenth of the price. ponytail: none on the history,
// which grows each round (a moving breakpoint on the last message would save the tool rounds' too)
const EPHEMERAL = { type: 'ephemeral' }
export const cachesByMark = (model: string) => model.startsWith('anthropic/')
// the cached tokens of a reply's usage (OpenRouter's prompt_tokens_details)
const cachedOf = (u: any) => Number(u?.prompt_tokens_details?.cached_tokens) || 0

// A7: one round's answer as it streams (SSE, stream: true): its text and tool calls as they come (a call's arguments
// in pieces, by index), reasoning kept for the next request, the model and usage from the chunks (usage: the last).
// onText: the text so far; alive: a chunk came. A JSON answer (an error, a reply that doesn't stream) is read whole
type Round = { model?: string; usage?: any; message?: any }
async function roundOf(res: Response, onText: (text: string) => void, alive: () => void, name = 'OpenRouter'): Promise<Round> {
  if (!res.ok || !/text\/event-stream/.test(res.headers.get('content-type') ?? '')) {
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`${name}: ${j.error?.message ?? (typeof j.error === 'string' ? j.error : res.status)}`)
    return { model: j.model, usage: j.usage, message: j.choices?.[0]?.message }
  }
  const m: any = { role: 'assistant', content: '' }
  const calls: any[] = []
  const details: any[] = []
  const r: Round = { message: m }
  const dec = new TextDecoder()
  let buf = ''
  const line = (l: string) => {
    if (!l.startsWith('data:')) return // its keep-alive comments (: OPENROUTER PROCESSING), blank lines
    const data = l.slice(5).trim()
    if (!data || data === '[DONE]') return
    let j: any
    try {
      j = JSON.parse(data)
    } catch {
      return
    }
    if (j.error) throw new Error(`${name}: ${j.error.message ?? j.error}`)
    r.model = j.model || r.model
    r.usage = j.usage ?? r.usage
    const d = j.choices?.[0]?.delta
    if (!d) return
    if (d.content) onText((m.content += d.content))
    if (d.reasoning) m.reasoning = (m.reasoning ?? '') + d.reasoning
    // a reasoning detail in pieces: one by its index, its text (summary, data) joined
    for (const x of Array.isArray(d.reasoning_details) ? d.reasoning_details : []) {
      const at = x.index !== undefined ? details.find(y => y.index === x.index && y.type === x.type) : undefined
      if (!at) details.push({ ...x })
      else for (const k of Object.keys(x)) at[k] = typeof x[k] === 'string' && typeof at[k] === 'string' && ['text', 'summary', 'data'].includes(k) ? at[k] + x[k] : x[k]
    }
    for (const c of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const at = (calls[c.index ?? calls.length] ??= { id: '', type: 'function', function: { name: '', arguments: '' } })
      if (c.id) at.id = c.id
      if (c.function?.name) at.function.name += c.function.name
      if (c.function?.arguments) at.function.arguments += c.function.arguments
    }
  }
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    alive()
    buf += dec.decode(chunk, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    lines.forEach(l => line(l.trim()))
  }
  line(buf.trim())
  if (calls.length) m.tool_calls = calls.filter(Boolean)
  if (details.length) m.reasoning_details = details
  return r
}
// A7: no chunk for this long ends a round (a stream that goes on isn't cut off however long it takes)
const QUIET_MS = Number(process.env.LAKI_AI_QUIET_MS) || 120_000

async function openrouter(o: Opts) {
  const s = state.settings?.ai ?? {}
  const at = target() // OpenRouter, or Your endpoint
  const model = at.model
  const mark = at.or && cachesByMark(model)
  const list = toolsFor(o.rpc, o.t.id)
  const fns = list.map((t, i) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema }, ...(mark && i === list.length - 1 && { cache_control: EPHEMERAL }) }))
  const pics = o.images.map(p => ({ type: 'image_url', image_url: { url: dataUrl(p) } }))
  const sys = system(o.t)
  const messages: object[] = [{ role: 'system', content: mark ? [{ type: 'text', text: sys, cache_control: EPHEMERAL }] : sys }, ...history(o.t), { role: 'user', content: pics.length ? [{ type: 'text', text: o.ask || 'See the image.' }, ...pics] : o.ask }]
  const r = o.r
  r.cost = at.or ? 0 : undefined // Your endpoint's: not priced
  // the text so far to the page (its partial, under the chat until the message comes), 10 a second at most. ponytail:
  // the whole text each time (a 40 KB answer: ~8 MB to each window); deltas with a sequence if long answers drag
  let shown = 0
  const partial = (text: string) => Date.now() - shown >= 100 && ((shown = Date.now()), broadcast({ ev: 'ai', of: o.t.id, partial: text }))
  for (let i = 0; ; i++) {
    const quiet = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const alive = () => (clearTimeout(timer), (timer = setTimeout(() => quiet.abort(new Error(`${at.name} sent nothing for ${Math.round(QUIET_MS / 1000)} s`)), QUIET_MS)))
    alive()
    let j: Round
    try {
      const res = await fetch(`${at.url}/chat/completions`, {
        method: 'POST',
        headers: headersOf(at),
        redirect: at.redirect,
        body: JSON.stringify({ model, messages, tools: fns, stream: true, ...(at.or ? { usage: { include: true } } : { stream_options: { include_usage: true } }) }),
        signal: AbortSignal.any([o.signal, quiet.signal]),
      })
      j = await roundOf(res, partial, alive, at.name)
    } finally {
      clearTimeout(timer)
    }
    r.model = j.model || model
    r.in += j.usage?.prompt_tokens ?? 0
    r.out += j.usage?.completion_tokens ?? 0
    r.cached = (r.cached ?? 0) + cachedOf(j.usage)
    if (at.or) r.cost! += j.usage?.cost ?? 0
    const m = j.message
    if (!m) throw new Error(`${at.name}: no answer`)
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
    // laki_screenshot's pictures: a tool's result is text, so they follow as a message the model sees
    const pics = (o.t.shots?.splice(0) ?? []).flatMap(p => {
      try {
        return [{ type: 'image_url', image_url: { url: dataUrl(p) } }]
      } catch {
        return [] // gone, or over MAX_IMAGE: the chat has it, the model its path
      }
    })
    if (pics.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'The screenshot you took (the user sees it in the chat too):' }, ...pics] })
  }
}
// one OpenRouter call with Settings › AI's key, no tools and no chat (a workflow's AI call block): its answer, logged
// with its cost among Laki AI's calls (ask: what made it)
// one OpenRouter call (aiComplete, aiDecide: workflows' blocks, memory's compaction) waits 5 minutes at most, its
// caller's stop too (LAKI_AI_WAIT_MS: tests' shorter)
const waitOf = (signal?: AbortSignal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Number(process.env.LAKI_AI_WAIT_MS) || 5 * 60_000)])
export async function aiComplete(o: { model?: string; prompt: string; system?: string; temperature?: number; json?: boolean; signal?: AbortSignal; ask: string }) {
  const at = target(state.settings?.ai?.backend === 'endpoint' ? 'endpoint' : 'openrouter') // Your endpoint when it's Laki AI's; else OpenRouter (claude and codex: aiOnce)
  if (at.or && !at.key) throw new Error('no OpenRouter API key: Settings › AI')
  const model = (at.or && o.model?.trim()) || at.model // a block's or compaction's model is an OpenRouter id: Your endpoint has its own
  const call: AiCall = { at: Date.now(), backend: at.or ? 'openrouter' : 'endpoint', model, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: o.ask.slice(0, 120) }
  try {
    const res = await fetch(`${at.url}/chat/completions`, {
      method: 'POST',
      headers: headersOf(at),
      redirect: at.redirect,
      // json: an answer that is a JSON object (out:'s), where the model can
      body: JSON.stringify({ model, messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: o.prompt }], ...(at.or && { usage: { include: true } }), ...(o.temperature !== undefined && { temperature: o.temperature }), ...(o.json && { response_format: { type: 'json_object' } }) }),
      signal: waitOf(o.signal),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(`${at.name}: ${j.error?.message ?? res.status}`)
    Object.assign(call, { model: j.model || model, in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0, ...(cachedOf(j.usage) && { cachedIn: cachedOf(j.usage) }), cost: at.or ? j.usage?.cost : undefined })
    const text = j.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error(`${at.name}: no answer`)
    call.ok = true
    return { text, model: call.model, cost: call.cost }
  } catch (e) {
    call.error = (e as Error).message
    throw e
  } finally {
    call.ms = Date.now() - call.at
    try {
      logCall(call)
    } catch {}
  }
}

// Codex's own tools, on without any config.toml (--ignore-user-config): a shell (its read-only sandbox reads any file),
// ChatGPT's apps, a browser, the screen. -c, not --disable: an older codex takes it and says nothing of a name it lacks
const CODEX_TOOLS = ['shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use']

// one question, one answer, outside any chat and with no tools (memory's compaction, Done check's review): Settings ›
// AI's backend, OpenRouter through aiComplete, or claude -p / codex exec with nothing but the prompt: no tools, no MCP
// server, not the user's config (their preset's account and env, as the chat's); logged among Laki AI's calls. preset:
// that agent's model, effort, env and account, 10 minutes. perm (an extension's AI source or action, its id): the user's
// own config too (its MCP servers; claude's tools: the ones it may use unasked, its other asks refused; codex's sandbox
// read-only)
export async function aiOnce(o: { prompt: string; system: string; ask: string; json?: boolean; preset?: Preset & { agent: 'claude' | 'codex' }; tools?: string; perm?: string; name?: string; stop?: string; signal?: AbortSignal; onCall?: (c: AiCall, answer: string) => void }): Promise<string> {
  const s = state.settings?.ai ?? {}
  const agent = !!o.preset // the preset's model, effort, env and account
  // perm: an extension's id, the user's own config: claude asks you for a tool it may not use unasked in the app, not in
  // a hook's (laki mcp's laki_permission beside the user's own servers: widgetTools.ts widgetPermission). Without it
  // nothing of the user's: what it reads (a diff an agent wrote) can't steer a tool
  const userCfg = !!o.perm
  const backend: AiBackend = o.preset?.agent ?? s.backend ?? 'openrouter'
  if (backend === 'openrouter' || backend === 'endpoint') return (await aiComplete({ prompt: o.prompt, system: o.system, json: o.json, ask: o.ask })).text // ponytail: no onCall (an extension's agent is claude or codex)
  const pre = o.preset ?? presetOf(backend)
  const model = agent ? o.preset!.model : s.models?.[backend]
  const effort = effortArgs(backend, agent ? (o.preset!.effort ?? '') : undefined)
  const call: AiCall = { at: Date.now(), backend, model: model || backend, in: 0, out: 0, ms: 0, tools: 0, ok: false, ask: o.ask.slice(0, 120) }
  const cfg = userCfg && backend === 'claude' ? secretFile(JSON.stringify({ mcpServers: { laki_ask: mcpWith({ LAKI_PERM_EXT: o.perm! }) } }), 'json') : undefined
  const args =
    backend === 'claude'
      ? ['-p', '--output-format', 'json', ...(userCfg ? (o.tools ? ['--allowedTools', o.tools] : []) : ['--tools', '', '--strict-mcp-config']), ...(cfg ? ['--mcp-config', cfg, '--permission-prompt-tool', 'mcp__laki_ask__laki_permission'] : []), '--append-system-prompt', o.system, ...(model ? ['--model', model] : []), ...effort, '--', o.prompt]
      : ['exec', '--json', '--skip-git-repo-check', ...(userCfg ? [] : ['--ignore-user-config', ...CODEX_TOOLS.flatMap(f => ['-c', `features.${f}=false`])]), '-c', 'sandbox_mode="read-only"', '-c', `developer_instructions=${JSON.stringify(o.system)}`, ...(model ? ['-m', model] : []), ...effort, '--', o.prompt]
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, ...state.settings?.env, ...pre?.env, ...accountEnv(pre?.account ?? accountUsed(backend)), ...(!userCfg && backend === 'claude' && { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }) } // claude.ai's connectors: --strict-mcp-config keeps them out too, this for an older claude
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
    if (cfg) rmSync(cfg, { force: true })
    call.ms = Date.now() - call.at
    o.onCall?.(call, answer) // an extension's log: its seconds, cost and answer
    try {
      logCall(call)
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
      logCall(call)
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
// S2: an agent's chat: its claude -p or codex exec calls Laki with that tab's token, so each tool call is that agent's
// (S12, main.ts: its asks, its refusals), not yours; its tab gone, no token: refused
const asTab = (chat: string): Record<string, string> => {
  if (!AGENT_CHAT.test(chat)) return {}
  const token = sessions.get(chat.slice(6))?.tabToken
  if (!token) throw new Error("the agent's tab is gone")
  return { LAKI_TAB_TOKEN: token }
}
const mcpServer = (chat: string, perm = false) => mcpWith({ ...asTab(chat), LAKI_AI: '1', LAKI_AI_CHAT: chat, ...(skilled() && { LAKI_AI_SKILL: '1' }), ...(perm && { LAKI_AI_PERM: '1' }) })
// S13: what holds a tab's token (claude's --mcp-config, codex's token) goes in a 0600 file, its path in argv: any process
// of yours reads argv with ps. Out of `home` (claude's cwd: its Read takes that unasked); gone as the child ends, and a
// crash's left over goes at this daemon's first
const runDir = join(dir, 'ai-run')
let swept = false
function secretFile(data: string, ext: string) {
  if (!swept) (swept = true), rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  const p = join(runDir, `${randomBytes(8).toString('hex')}.${ext}`)
  writeAtomic(p, data, 0o600)
  return p
}

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
    const env = { ...process.env, ...state.settings?.env, ...presetOf(cmd)?.env, ...((cmd === 'claude' || cmd === 'codex') && accountEnv(presetOf(cmd)?.account ?? accountUsed(cmd))), MCP_TOOL_TIMEOUT: '300000' } // its account: the preset's, else the default
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
  const cfg = secretFile(JSON.stringify({ mcpServers: { laki: mcpServer(o.t.id, true) } }), 'json')
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', cfg, '--strict-mcp-config', '--tools', 'Read', ...(o.images.length ? ['--add-dir', join(dir, 'images')] : []), '--allowedTools', 'mcp__laki', '--permission-prompt-tool', 'mcp__laki__laki_permission', '--append-system-prompt', system(o.t), ...(model ? ['--model', model] : []), ...effortArgs('claude'), ...(resume[sk] ? ['--resume', resume[sk]] : []), '--', prompt]
  const r = o.r
  let failed = ''
  try {
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
  } finally {
    rmSync(cfg, { force: true })
  }
  if (failed) throw new Error(failed)
}

// codex exec, read-only, only the laki tools (a long wsNew: 5 minutes); resume goes on with its thread
async function codex(o: Opts) {
  const model = state.settings?.ai?.models?.codex
  const sk = sessionKey('codex')
  const resume = o.t.resume
  const m = mcpServer(o.t.id)
  const toml = (v: unknown) => JSON.stringify(v) // a TOML basic string or array of them reads as JSON does
  const { LAKI_TAB_TOKEN: token, ...rest } = m.env as Record<string, string> // S13: a file's path in its -c flags, not the token
  const tokenFile = token ? secretFile(token, 'token') : undefined
  const env = `{${Object.entries({ ...rest, ...(tokenFile && { LAKI_TAB_TOKEN_FILE: tokenFile }) }).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`
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
  try {
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
  } finally {
    if (tokenFile) rmSync(tokenFile, { force: true })
  }
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
  const ids = p.act?.kind === 'run' && Array.isArray(p.act.ids) ? [...new Set(p.act.ids.filter((x): x is string => typeof x === 'string' && !!x))].slice(0, 12) : [] // Q13: one command in several shells
  const act: AiAct | undefined = p.act && AI_ACTS.includes(p.act.kind) && typeof p.act.id === 'string' && p.act.id ? { kind: p.act.kind, id: p.act.id, project: typeof p.act.project === 'string' ? p.act.project : undefined, label: '', ...(ids.length > 1 && { ids }), ...(p.act.kind === 'run' && { text: String(p.act.text ?? '').slice(0, RUN_MAX) }), ...(p.act.kind === 'profile' && { text: JSON.stringify(profilesOf(p.act.text)) }), ...(p.act.kind === 'delete' && { text: loseText(p.act.text) }) } : undefined
  if (act?.kind === 'run' && !act.text?.trim()) throw new Error('what to run? the command is empty')
  const none = (a: { kind: AiAct['kind']; id: string }) => new Error(`no ${a.kind === 'widget' ? 'extension' : a.kind === 'archive' ? 'workspace (not archived)' : a.kind === 'delete' ? 'workspace' : a.kind} ${a.id}${a.kind === 'memory' ? ' in that project' : ''}`)
  // several of one kind in one question (Q14): each named from Laki's own state, the same one once
  const out: string[] = []
  const left = () => (out.length ? ` Left out, tell the user: ${out.join('; ')}.` : '')
  if (act && MANY.includes(act.kind)) {
    const given = (Array.isArray(p.act!.items) ? (p.act!.items as unknown[]) : []).filter((x): x is { id: string; text?: unknown } => !!x && typeof (x as { id?: unknown }).id === 'string' && !!(x as { id: string }).id)
    // one that can't be (gone, archived already, a project's own folder) is left out and said, not the whole question
    const items = given.filter((x, i) => given.findIndex(y => y.id === x.id) === i).slice(0, AI_ITEMS).flatMap(x => {
      try {
        const i = itemOf(act, x.id, x.text)
        if (i) return [i]
        out.push(none({ kind: act.kind, id: x.id }).message)
      } catch (e) {
        out.push((e as Error).message)
      }
      return []
    })
    if (given.length && !items.length) throw new Error(out.join('; '))
    if (items.length) act.id = items[0].id
    if (items.length > 1) (act.items = items), delete act.text
    else if (items.length && items[0].text !== undefined) act.text = items[0].text
  }
  if (act) act.label = whatOf(act) ?? '' // the thing itself, never the model's words: a Yes removes what it says
  if (act && !act.label) throw none(act)
  const on = act?.kind === 'widget' ? widgetWhat(act.id) : undefined // what it runs, in Laki's words, before the user picks
  if (on?.on) throw new Error(`${on.name} is on already`)
  if (act && on) act.hash = on.hash // its files as asked about: a Yes needs them still
  // a second ask of the same kind in this turn (a model that calls once per workspace): one question, its list longer
  const at = t.chat.map(m => m.role).lastIndexOf('user')
  const open = act && MANY.includes(act.kind) ? t.chat.find((m, i) => i > at && m.ask?.picked === undefined && m.ask?.act?.kind === act.kind && m.ask.act.project === act.project) : undefined
  if (open?.ask?.act) {
    const was = open.ask.act
    const have = was.items ?? [{ id: was.id, label: itemOf(was, was.id)?.label ?? was.label, ...(was.text !== undefined && { text: was.text }) }]
    const more = (act!.items ?? [itemOf(act!, act!.id, act!.text)!]).filter(x => !have.some(h => h.id === x.id))
    const items = [...have, ...more].slice(0, AI_ITEMS)
    if (items.length > 1) (was.items = items), delete was.text
    open.text = askText(was)
    open.ask.options = askOptions(was)
    t.chat.splice(t.chat.indexOf(open), 1) // last again, under the tool calls that came since
    t.chat.push(open)
    open.at = t.at = Date.now()
    t.asked = true
    changed(t)
    return { asked: open.ask.id, note: `Added to the question the user already has: one list of ${items.length}, a box each, one Yes. Next time give them all at once (ids).${left()} End your turn now, without more words.` }
  }
  const text = act ? (on ? turnOn(act, on.text) : askText(act)) : String(p.text ?? '').trim().slice(0, 2000)
  if (!text) throw new Error('a question')
  // each option with its look (an extension's chat: how it would show), the same option once
  const given = (Array.isArray(p.options) ? p.options : []).map((o, i) => [String(o).trim().slice(0, 200), lookOf(Array.isArray(p.looks) ? p.looks[i] : undefined)] as const).filter(([o], i, all) => o && all.findIndex(x => x[0] === o) === i).slice(0, 6)
  const options = act ? (on ? ['Yes, turn it on', 'No, leave it off'] : askOptions(act)) : given.map(([o]) => o)
  if (options.length < 2) throw new Error('2 to 6 options')
  const looks = act || !given.some(([, l]) => l) ? undefined : given.map(([, l]) => l)
  const id = randomBytes(6).toString('hex')
  t.chat.push({ role: 'ai', text, at: (t.at = Date.now()), ask: { id, options, act, ...(looks && { looks }) } })
  t.asked = true
  changed(t)
  return { asked: id, note: act ? `The user sees ${act.items ? `the ${act.items.length} listed, a box each, and ` : ''}Yes / No buttons; a Yes ${on ? 'turns it on' : act.kind === 'run' ? 'runs it, Laki does' : act.kind === 'profile' ? 'saves them, Laki does' : act.kind === 'archive' ? `archives ${act.items ? 'the ticked ones' : 'it'}, Laki does` : act.kind === 'delete' ? `deletes ${act.items ? 'the ticked ones' : 'it'}, Laki does` : `removes ${act.items ? 'the ticked ones' : 'it'}`} (you do not).${left()} End your turn now, without more words.` : 'The user sees the options as buttons. End your turn now, without more words: their pick comes as the next message.' }
}
// Q14: the kinds a question may list several of, a box each on the AI page (act.items)
const MANY: AiAct['kind'][] = ['memory', 'schedule', 'tab', 'todo', 'archive', 'delete']
// what a delete would lose, as the question says it: Laki's words only (digits, letters, commas)
const loseText = (s: unknown) => String(s ?? '').replace(/[^\w ,]/g, '').slice(0, 120)
// one of several: its name alone (whatOf's, out of its quotes), what a delete of it would lose
function itemOf(a: AiAct, id: string, text?: unknown): AiItem | undefined {
  const label = whatOf({ kind: a.kind, id, project: a.project, label: '' })
  const pr = a.kind === 'archive' || a.kind === 'delete' ? prs.get(id) : undefined
  return label ? { id, label: /“(.*)”$/s.exec(label)?.[1] ?? label, ...(pr && { note: `${pr.forge === 'gitlab' ? `MR !${pr.number}` : `PR #${pr.number}`} ${pr.state.toLowerCase()}` }), ...(a.kind === 'delete' && { text: loseText(text) }) } : undefined
}
const NOUN: Partial<Record<AiAct['kind'], string>> = { archive: 'workspaces', delete: 'workspaces', tab: 'tabs', todo: 'to-dos', schedule: 'scheduled tasks', memory: 'memories' }
const VERB = (a: AiAct) => (a.kind === 'archive' ? 'archive' : a.kind === 'delete' ? 'delete' : 'remove')
const DONE = (a: AiAct) => (a.kind === 'archive' ? 'archived' : a.kind === 'delete' ? 'deleted' : 'removed')
// a removal's question and its buttons, for one or for several (the list in the text too: the model's history and the
// CLI read it there; the AI page draws the boxes from act.items and shows the text's first paragraph)
function askText(a: AiAct) {
  if (a.kind === 'run') return runIn(a)
  if (a.kind === 'profile') return profilesAsk(a)
  if (!a.items) return a.kind === 'archive' ? `Archive ${a.label}? Its agents and shells stop and its worktree goes; its branch and uncommitted changes are kept, and Archived in the sidebar brings it back.` : a.kind === 'delete' ? `Delete ${a.label} for good? Its agents and shells stop, and its worktree and branch are deleted${a.text ? `, with ${a.text}` : ''}: nothing brings it back. Archive keeps it instead.` : `Remove ${a.label}?`
  const n = `these ${a.items.length} ${NOUN[a.kind]}`
  const head = a.kind === 'archive' ? `Archive ${n}? Their agents and shells stop and their worktrees go; their branches and uncommitted changes are kept, and Archived in the sidebar brings them back.` : a.kind === 'delete' ? `Delete ${n} for good? Their agents and shells stop, and their worktrees and branches are deleted: nothing brings them back. Archive keeps them instead.` : `Remove ${n}?`
  return `${head}\n\n${a.items.map(i => `- ${i.label.replace(/\s+/g, ' ')}${i.note ? ` (${i.note})` : ''}${i.text ? `: loses ${i.text}` : ''}`).join('\n')}`
}
const askOptions = (a: AiAct) => (a.kind === 'run' ? ['Yes, run it', "No, don't"] : a.kind === 'profile' ? ['Yes, save them', "No, don't"] : a.items ? [`Yes, ${VERB(a)} ${a.items.length}`, 'No, keep them'] : a.kind === 'archive' ? ['Yes, archive it', 'No, keep it'] : a.kind === 'delete' ? ['Yes, delete it', 'No, keep it'] : [`Yes, remove ${a.label}`, 'No, keep it'])
// what a delete would lose, by its kind: "2 uncommitted files, 1 commit not pushed" as uncommitted file 2, commit not pushed 1
const loseParts = (s: string) => new Map(s.split(', ').filter(Boolean).map(x => [x.replace(/^\d+ /, '').replace(/s\b/, ''), Number(/^\d+/.exec(x)?.[0] ?? 1)] as const))
// one of them done at the user's Yes. A delete: what it would lose looked at again, and one with more to lose now than
// the question said stays (an agent wrote since); less (it pushed, it committed) goes. v: the state, read once for several
async function doOne(a: AiAct, id: string, shown: string | undefined, rpc: Rpc, v?: View) {
  if (a.kind === 'delete') {
    const now = loseText(await wsLose(rpc, id, v))
    const was = loseParts(shown ?? '')
    if ([...loseParts(now)].some(([k, n]) => n > (was.get(k) ?? 0))) throw new Error(`it has ${now} now, more than you were shown: ask again`)
    return rpc('wsRm', { id })
  }
  if (a.kind === 'archive') return archiveAct({ ...a, id }, rpc)
  return remove({ ...a, id }, rpc)
}
// the Yes to several: the ticked ones (only: their ids; none given: all), one after another, each one's outcome on its
// line as it comes, then one answer saying what became of them
async function answerMany(t: Thread, m: AiMsg, n: number, only: unknown, rpc: Rpc) {
  const act = m.ask!.act!
  const items = act.items!
  const ticked = n !== 0 ? [] : Array.isArray(only) ? items.filter(i => only.includes(i.id)) : items
  if (n === 0 && !ticked.length) throw new Error('none ticked: tick the ones you mean, or pick No')
  if (n === 0) m.ask!.options[0] = `Yes, ${VERB(act)} ${ticked.length}` // as picked: the ticked ones
  m.ask!.picked = m.ask!.options[n]
  for (const i of items) if (!ticked.includes(i)) i.said = 'kept'
  say(t, 'user', n === 0 && ticked.length < items.length ? `Yes, ${VERB(act)} ${ticked.length} of ${items.length}` : m.ask!.options[n])
  if (n !== 0) return say(t, 'ai', `Kept all ${items.length}.`), { kept: true }
  const done = DONE(act)
  const v = act.kind === 'delete' ? await rpc<View>('state').catch(() => undefined) : undefined
  for (const i of ticked) {
    i.said = '…'
    changed(t)
    i.said = await doOne(act, i.id, i.text, rpc, v).then(() => done, e => `not ${done}: ${(e as Error).message}`)
  }
  const ok = ticked.filter(i => i.said === done)
  const no = ticked.filter(i => i.said !== done)
  const kept = items.length - ticked.length
  const Done = done[0].toUpperCase() + done.slice(1)
  say(t, 'ai', [ok.length && `${Done} ${ok.length}: ${ok.map(i => i.label).join(', ')}.${act.kind === 'archive' ? ' Archived in the sidebar brings them back.' : ''}`, no.length && `${no.length} ${no.length === 1 ? 'is' : 'are'} still there:\n${no.map(i => `- ${i.label}: ${i.said}`).join('\n')}`, kept && `Kept ${kept}.`].filter(Boolean).join('\n\n'))
  return { done: ok.length, failed: no.length, kept }
}

// the user's pick (the AI page's buttons): a removal is done here on Yes; any other pick goes on as the next ask
export async function aiAnswer(p: { id: string; n: number; chat?: string; only?: string[] }, rpc: Rpc) {
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
  // a question whose pick goes back to the model: its context is gone once you asked something else. One Laki acts on
  // itself (a removal, a run, an extension turned on) stays open: several of them are answered in any order, each
  // checked against what's there now
  if (!m.ask.act && chat.slice(chat.indexOf(m) + 1).some(x => x.role === 'user')) throw new Error('a newer ask came since: ask again')
  refuseBusy(t)
  const pick = m.ask.options[Number(p.n)]
  if (pick === undefined) throw new Error('no such option')
  const act = m.ask.act
  if (!act) {
    const r = aiAsk({ text: pick, chat: p.chat }, rpc) // its checks (on, a key) are before its first await: busy once they pass
    if (busy.has(t.id)) (m.ask.picked = pick), changed(t) // refused: the buttons stay, for another try
    return r
  }
  if (act.items) return answerMany(t, m, Number(p.n), p.only, rpc)
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
      const fails = await runAct(act, rpc)
      say(t, 'ai', `Ran it in ${act.label}${fails.length ? ` (not in ${fails.join('; ')})` : ''}.${await ranShown(act, rpc)}`)
      return { ran: true }
    }
    if (act.kind === 'delete') {
      await doOne(act, act.id, act.text, rpc)
      say(t, 'ai', `Deleted ${act.label}.`)
      return { deleted: true }
    }
    if (act.kind === 'archive') {
      await archiveAct(act, rpc)
      say(t, 'ai', `Archived ${act.label}: Archived in the sidebar brings it back.`)
      return { archived: true }
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
  const ws = a.ids ? undefined : state.workspaces.find(w => w.id === state.tabs.find(x => x.id === a.id)?.workspace)
  return `Run this in ${a.label}${ws ? ` (${ws.name ?? ws.id})` : ''}?\n\n${fence}sh\n${a.text}\n${fence}`
}
// the user's Yes: the shell checked again (still at its prompt), the line cleared (⌃E ⌃U), the command and Enter
// several (Q13): each as one, those that can't said (all can't: the first's why)
async function runAct(a: AiAct, rpc: Rpc): Promise<string[]> {
  const v = await rpc<View>('state')
  const fails: string[] = []
  for (const id of a.ids ?? [a.id]) {
    const t = v.tabs.find(x => x.id === id)
    const why = !t || t.kind !== 'shell' || t.status === 'exited' ? 'that shell is gone' : t.status === 'running' || t.runs ? `${t.name} is running something now: not run` : ''
    if (why) {
      if (!a.ids) throw new Error(why)
      fails.push(why)
      continue
    }
    await rpc('input', { tab: id, data: '\x05\x15' })
    await rpc('send', { target: id, text: a.text })
  }
  if (a.ids && fails.length === a.ids.length) throw new Error(fails[0])
  return fails
}
// Q13: what a command printed, in the chat a moment later (the screen's last lines), and its tab shown in the app
// (Settings › AI › Show its work, on unless off)
const SHOWN_MS = Number(process.env.LAKI_RUN_SHOWN_MS ?? 1500)
async function ranShown(a: AiAct, rpc: Rpc) {
  const ids = a.ids ?? [a.id]
  if (state.settings?.ai?.show !== false) void rpc('tabFocus', { tab: ids[0] }).catch(() => {})
  await new Promise(r => setTimeout(r, SHOWN_MS))
  const outs = await Promise.all(ids.slice(0, 4).map(id => rpc<string>('screen', { target: id, lines: 14 }).then(s => s.replace(/\s+$/, '').slice(-1200), () => '')))
  const name = (id: string) => state.tabs.find(x => x.id === id)?.name ?? id
  return outs.map((o, i) => (o ? `\n\n${ids.length > 1 ? `${name(ids[i])}:\n` : ''}\`\`\`\n${o.replace(/```/g, "'''")}\n\`\`\`` : '')).join('')
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
  // its Sandbox stays (Laki AI doesn't set it): refused with a mode that turns it off
  const changed = (h: Preset, n: Preset): Preset => {
    const same = h.agent === n.agent
    const sandbox = h.sandbox && SANDBOX[n.agent as Agent] ? true : undefined
    if (sandbox && sandboxOff(n.agent, n.perm, same ? h.args : undefined)) throw new Error(`${n.name}: ${SANDBOX_NO}`)
    return { ...h, ...(!same && { args: undefined, cmd: undefined }), agent: n.agent, model: n.model, effort: n.effort, perm: n.perm, fast: n.fast, sandbox, off: undefined }
  }
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
  if (a.kind === 'run' && a.ids) {
    const xs = a.ids.map(id => state.tabs.find(x => x.id === id && x.kind === 'shell'))
    if (xs.some(x => !x)) return undefined
    return `${xs.length} shells: ${xs.map(x => `${cut(x!.name)} (${(w => w?.name || w?.id)(state.workspaces.find(w => w.id === x!.workspace))})`).join(', ')}`
  }
  if (a.kind === 'tab' || a.kind === 'run') {
    const x = state.tabs.find(x => x.id === a.id && (a.kind === 'tab' || x.kind === 'shell'))
    return x && `the tab ${cut(x.name)}`
  }
  if (a.kind === 'delete') {
    const x = state.workspaces.find(x => x.id === a.id)
    if (x && x.kind !== 'worktree') throw new Error(`${x.name || x.id} is a project's own folder: Laki doesn't delete it`)
    return x && `the workspace ${cut(x.name || x.id)}`
  }
  if (a.kind === 'archive') {
    const x = state.workspaces.find(x => x.id === a.id && !x.archived)
    if (x && x.kind !== 'worktree') throw new Error(`${x.name || x.id} is a project's own folder: only a worktree workspace can be archived`)
    return x && `the workspace ${cut(x.name || x.id)}`
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

// Q12: the user's Yes to laki_archive: as the sidebar's Archive, but what archiving would lose (ignored files, a
// submodule's work: unsaved's) is never lost on a model's ask: those go back to the sidebar's own ask, which names them
async function archiveAct(a: AiAct, rpc: Rpc) {
  const held = (r?: { held?: GateHeld[] }) => r?.held?.length && new Error(`held: ${r.held.map(h => `${h.name}: ${h.why}`).join('; ')}`)
  const first = await rpc<{ dirty?: number; subs?: string[]; ignored?: string[]; held?: GateHeld[] } | undefined>('wsArchive', { id: a.id, ifClean: true })
  const no = held(first)
  if (no) throw no
  if (first?.subs?.length || first?.ignored?.length) throw new Error(`it has ${[first.subs?.length && 'submodule changes', first.ignored?.length && `${first.ignored.length} ignored file${first.ignored.length > 1 ? 's' : ''}`].filter(Boolean).join(' and ')} that archiving would lose: archive it from its menu in the sidebar, which asks about them`)
  if (first?.dirty) {
    const again = held(await rpc<{ held?: GateHeld[] } | undefined>('wsArchive', { id: a.id })) // its uncommitted changes kept for Restore (R2)
    if (again) throw again
  }
}

async function remove(a: AiAct, rpc: Rpc) {
  if (a.kind === 'schedule') return rpc('scheduleRm', { id: a.id })
  if (a.kind === 'tab') return rpc('tabClose', { id: a.id })
  if (a.kind === 'todo') return rpc('todoRm', { id: a.id })
  const p = (await rpc<View>('state')).projects.find(x => x.id === a.project)
  if (!p?.memory?.some(m => m.id === a.id)) throw new Error('not in that project’s memory any more')
  return rpc('projectSet', { id: p.id, memory: p.memory.filter(m => m.id !== a.id) })
}

// ---------- its eyes and hands on the Mac, and Laki's own guide (the skill's laki_screenshot, laki_open_app, laki_help)

// a screenshot Laki AI takes while it works on an ask: the screen, an app's frontmost window by the app's name, or the
// iOS Simulator; kept in images/, shown in the chat, and (OpenRouter, your endpoint) given to the model as a picture; a
// CLI backend reads its path. The whole screen only when the user's last message asks to see it (or Your instructions
// name the screen): never for something a tab's screen or a PR told it, never in an agent's chat
const SHOT_SAID = /screen|display|desktop|monitor|capture/
// what the user asked for, in their own words: their last message in this chat and Your instructions. An agent's chat
// has none (its "user" is that agent)
const userSaid = (t: Thread) => (AGENT_CHAT.test(t.id) ? '' : `${t.chat.findLast(m => m.role === 'user')?.text ?? ''}\n${state.settings?.ai?.context ?? ''}`.toLowerCase())
export async function aiShot(p: { of?: string; chat?: string }) {
  const t = asking(p.chat)
  const of = String(p.of ?? '').trim().slice(0, 80) || 'screen'
  const whole = of.toLowerCase() === 'screen'
  if (whole && !SHOT_SAID.test(userSaid(t))) throw new Error("not taken: Laki AI looks at the whole screen only when the user asks it to; an app's window by its name, or the simulator, any time")
  if (process.platform !== 'darwin') throw new Error('a screenshot: macOS only')
  const r = whole ? { ...(await screenShot()), what: 'the screen' } : await device({ op: 'shot', ...(of.toLowerCase() !== 'simulator' && { app: of }) }).then(d => ({ path: (d as { path: string }).path, what: 'app' in (d as object) ? `${(d as { app: string }).app}${(d as { title?: string }).title ? `: ${(d as { title: string }).title}` : ''}` : `the simulator (${(d as { simulator?: string }).simulator ?? 'iOS'})` }))
  ;(t.shots ??= []).push(r.path)
  say(t, 'ai', `Screenshot of ${r.what}.`, [r.path])
  return { path: r.path, of: r.what, note: 'The user sees it in the chat. You get it as a picture after this result (a CLI agent: Read the path).' }
}
// an app on the Mac opened by its name, a web address in the browser (or in that app): only while Laki AI works on an
// ask, as the user's own `open` would
export async function aiOpenApp(p: { app?: string; url?: string; chat?: string }) {
  const t = asking(p.chat)
  const app = String(p.app ?? '').trim()
  const url = String(p.url ?? '').trim()
  if (!app && !url) throw new Error('an app, a url, or both')
  if (app && !/^[\w][\w .&+'-]{0,59}$/.test(app)) throw new Error('an app by its name, as Applications has it (Safari, Xcode, Simulator)')
  if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) throw new Error('a web address: http or https')
  // only a site the user named (or this Mac's own): text Laki AI read in a tab or a PR can't send it anywhere else
  const host = url ? (URL.parse(url)?.hostname ?? '').toLowerCase().replace(/^www\./, '') : ''
  if (url && !host) throw new Error('a web address: http or https')
  if (host && !/^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(host) && !userSaid(t).includes(host)) throw new Error(`not opened: the user didn't name ${host}. Give them the link to click, or ask them first (laki_ask)`)
  if (process.platform !== 'darwin') throw new Error('opening an app: macOS only')
  await new Promise<void>((ok, no) => execFile('open', [...(app ? ['-a', app] : []), ...(url ? [url] : [])], { timeout: 15000 }, (e, _out, err) => (e ? no(new Error(`couldn't open ${app || url}: ${String(err || e.message).trim().split('\n').at(-1)}`)) : ok())))
  return { opened: app || url, ...(app && url && { with: url }) }
}
// Laki's own guide (docs/guide.md and features.md, in the app), the parts a question is about: how Laki works and where
// things are, in its own words
let guide: HelpPart[] | undefined
export function aiHelp(p: { question?: string }) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')
  try {
    guide ??= [...helpParts(readFileSync(join(root, 'guide.md'), 'utf8'), 'Guide'), ...helpParts(readFileSync(join(root, 'features.md'), 'utf8'), 'Features')]
  } catch {
    throw new Error("this build has no guide in it: it's at https://github.com/igorkasyanchuk/laki/blob/main/docs/guide.md")
  }
  return helpFind(guide, String(p.question ?? '').slice(0, 400))
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
