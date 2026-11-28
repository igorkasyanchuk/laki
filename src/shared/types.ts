// Shapes shared by the daemon, the CLI and the renderer.
import type { McpServer } from './mcp.ts'
import type { Collision } from './overlap.ts'
import type { TabPlan } from './todos.ts'
import type { Layout, SavedLayout } from './layout.ts'
import { type Rule, stamp } from './when.ts'
import type { FlowRun, FlowStats, FlowView } from './workflow.ts'
import PRICE_TABLE from './prices.json' with { type: 'json' }

// the coding agents Laki starts by name (a preset's agent; the command is the id), and what they're called
export const AGENTS = ['claude', 'codex', 'gemini', 'grok', 'opencode', 'pi'] as const
export type Agent = (typeof AGENTS)[number]
export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Antigravity', grok: 'Grok', opencode: 'OpenCode', pi: 'Pi' } // gemini: Antigravity CLI (agy), Gemini CLI's successor; its id stays, so profiles and tabs keep it
export const isAgent = (s?: string): s is Agent => (AGENTS as readonly string[]).includes(s ?? '')
export const agentBin = (a: Agent) => (a === 'gemini' ? 'agy' : a) // its command: the id but for agy's
// how hard an agent thinks, for those that take it (claude and agy --effort, codex model_reasoning_effort, pi --thinking); models: names to
// suggest (any other goes too: a full name, provider/model for opencode)
export const EFFORTS: Partial<Record<Agent, string[]>> = { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['minimal', 'low', 'medium', 'high', 'xhigh'], gemini: ['low', 'medium', 'high', 'xhigh', 'max'], pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] }
// a model an agent says it has (accounts.ts agentModels): its id for --model, its name and words, its efforts
export type AgentModel = { id: string; name: string; sub?: string; efforts?: string[]; def?: boolean }
export const MODELS: Partial<Record<Agent, string[]>> = { claude: ['fable', 'opus', 'sonnet', 'haiku'] }
// how freely an agent acts (unset: its own default, which asks): claude's --permission-mode; codex's sandbox and
// approvals, agy's --mode in the same spirit. Each with what the new-workspace page says of it
export const PERMS: Partial<Record<Agent, [id: string, label: string, sub: string, args: string[]][]>> = {
  claude: [
    ['auto', 'Auto mode', 'Acts on what looks safe, asks about the rest', ['--permission-mode', 'auto']],
    ['acceptEdits', 'Accept edits', 'Edits files without asking; asks before commands', ['--permission-mode', 'acceptEdits']],
    ['plan', 'Plan mode', 'Reads and plans; changes nothing', ['--permission-mode', 'plan']],
    ['bypassPermissions', 'Bypass permissions', 'Never asks: anything goes', ['--permission-mode', 'bypassPermissions']],
  ],
  codex: [
    ['auto', 'Auto mode', 'An automatic review answers its approvals', ['--approve-for-me']],
    ['acceptEdits', 'Accept edits', 'Writes in the workspace, never asks', ['-s', 'workspace-write', '-a', 'never']],
    ['plan', 'Read only', 'Reads; changes nothing', ['-s', 'read-only']],
    ['bypassPermissions', 'Bypass permissions', 'No sandbox, never asks: anything goes', ['--dangerously-bypass-approvals-and-sandbox']],
  ],
  gemini: [
    ['auto', 'Auto mode', 'Acts on what looks safe, asks about the rest', ['--mode', 'auto']],
    ['acceptEdits', 'Accept edits', 'Edits files without asking; asks before commands', ['--mode', 'accept-edits']],
    ['plan', 'Plan mode', 'Reads and plans; changes nothing', ['--mode', 'plan']],
    ['bypassPermissions', 'Bypass permissions', 'Never asks: anything goes', ['--dangerously-skip-permissions']],
  ],
}
// a running claude's permission modes, as the Reader's chip and a tab's menu offer them (tabMode): 'default' asks
export const CLAUDE_MODES: [id: string, label: string, sub: string][] = [
  ['default', 'Ask', 'Asks before edits and commands'],
  ['acceptEdits', 'Accept edits', 'Edits files without asking; asks before commands'],
  ['plan', 'Plan', 'Reads and plans; changes nothing'],
  ['bypassPermissions', 'Bypass', 'Never asks: anything goes'],
]
// the mode claude's footer shows, from its screen's bottom lines; none shown: 'default', but only with its footer there
// (S9): its input box (a rule, its > prompt) or its hint. Neither: a transcript view, a menu or a start not drawn yet
// covers it, the mode isn't known (undefined), and nothing is shown or pressed as if it were Ask
const FOOT_SEEN = /─{8}|^\s*[│┃]?\s*[>❯](\s|$)|\? for shortcuts/m
const MODE_LINE = /^\s*[^\x00-\x7f\s]{1,3}\s*(accept edits|plan mode|auto mode|bypass permissions|don't ask) on\b/gm // its ⏵⏵ or ⏸ first: `> plan mode on` is what you typed
const MODE_IDS: Record<string, string> = { 'accept edits': 'acceptEdits', 'plan mode': 'plan', 'auto mode': 'auto', 'bypass permissions': 'bypassPermissions', "don't ask": 'dontAsk' }
export const claudeMode = (screen: string): string | undefined => (m => (m ? MODE_IDS[m[1]] : FOOT_SEEN.test(screen) ? 'default' : undefined))([...screen.matchAll(MODE_LINE)].at(-1))
export const permArgs = (agent?: string, perm?: string) => (perm && PERMS[agent as Agent]?.find(p => p[0] === perm)?.[3]) || []
// a profile's flags that set how freely it acts already: then no mode of Laki's goes in (agentCmd), and one that never
// asks counts as bypassPermissions
const PERM_FLAGS: Partial<Record<Agent, RegExp>> = { claude: /(^|\s)--(permission-mode|dangerously-skip-permissions)\b/, gemini: /(^|\s)--(mode|dangerously-skip-permissions)\b/, codex: /(^|\s)(-s|--sandbox|-a|--ask-for-approval|--full-auto|--approve-for-me|--dangerously-bypass-approvals-and-sandbox|--yolo)(?=[\s=]|$)|\b(sandbox_mode|approval_policy)=/ }
export const permInArgs = (agent?: string, args?: string) => !!args && !!PERM_FLAGS[agent as Agent]?.test(args)
// the flags your shell's alias for an agent's command (agentBin) adds after it (its `alias` list: zsh's name='value',
// bash's alias name='value', fish's alias name 'value'): alias codex='codex --dangerously-bypass-approvals-and-sandbox'.
// By agent; an alias to another command (npx …), or with no flags, adds none (core.ts aliasOf)
export function aliasFlags(out: string): Record<string, string> {
  const bins = new Map<string, Agent>(AGENTS.map(a => [agentBin(a), a]))
  const got: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const m = /^(?:alias\s+)?([\w.-]+)(?:=|\s+)(.+)$/.exec(line.trim())
    if (!m || !bins.has(m[1])) continue
    let v = m[2].trim()
    if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/'\\''/g, "'")
    else if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    const [cmd, ...rest] = v.split(/\s+/)
    if (cmd?.split('/').pop() === m[1] && rest.length) got[bins.get(m[1])!] = rest.join(' ')
  }
  return got
}
export const bypassArgs = (args?: string) => !!args && /(^|\s)(--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox|--yolo|--permission-mode[\s=]+['"]?bypassPermissions)\b/.test(args)
// codex's approvals off: -a / --ask-for-approval never, -c approval_policy=never
const NO_APPROVALS = /(^|\s)(-a|--ask-for-approval)[\s=]+['"]?never\b|\bapproval_policy\s*=\s*['"]?never\b/
// #3: an agent that never asks before it acts, by its mode (perm: bypass permissions, or codex's with approvals off) or
// its own flags, which win when they set one (agentCmd): what an agent, an agent's event or an extension may never start.
// ponytail: flags only; an env var that changes it isn't read (none is known)
export const neverAsks = (agent?: string, perm?: string, args?: string) => {
  const flags = permInArgs(agent, args) ? args! : permArgs(agent, perm).join(' ')
  return bypassArgs(flags) || (agent === 'codex' && NO_APPROVALS.test(flags)) || (!permInArgs(agent, args) && perm === 'bypassPermissions')
}
// fast mode: claude's fastMode setting, codex's fast service tier (more speed, more usage)
export const FAST: Partial<Record<Agent, true>> = { claude: true, codex: true }
// the agent's own sandbox (a profile's Sandbox switch): its commands write only in the worktree and what git commit writes (core.ts gitWrites).
// claude: its settings file's sandbox (Laki's own laki CLI runs outside it); codex: -s workspace-write, its network on
export const SANDBOX: Partial<Record<Agent, true>> = { claude: true, codex: true }
// what turns the sandbox off: bypass permissions (claude's --dangerously-skip-permissions, codex's
// --dangerously-bypass-approvals-and-sandbox) or codex's danger-full-access
export const SANDBOX_NO = "Bypass permissions turns the agent's sandbox off: pick one of the two"
// a sandboxed profile's network (Settings › Agents & profiles, laki preset set --net): all (the agent's own default:
// claude asks about each new host, codex's is on), list (the hosts netList gives, claude's settings file's
// sandbox.network.allowedDomains; others asked about), off (codex's sandbox_workspace_write.network_access=false). Each
// agent has what its sandbox can do (NET_OK); NET_NO says why not the rest. Unset: all
export type Net = 'all' | 'list' | 'off'
export const NET_OK: Partial<Record<Agent, Net[]>> = { claude: ['all', 'list'], codex: ['all', 'off'] }
export const NET_NO: Partial<Record<Agent, Partial<Record<Net, string>>>> = { claude: { off: 'Claude Code has no switch that turns its network off: it asks about each new host' }, codex: { list: "Codex's sandbox network is on or off: no list of hosts" } }
// a host as a list takes it: a name, *. for its subdomains (claude's wildcard), no scheme, port or path
export const NET_HOST = /^(\*\.)?(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i
// the hosts a list starts with: the package registries the project's files show it uses, GitHub and its API, the
// agent's own model endpoint, this Mac; then the project's own (netAllow: the user's, by the card's Allow)
const REGISTRIES: [string, string[]][] = [
  ['package.json', ['registry.npmjs.org']],
  ['yarn.lock', ['registry.yarnpkg.com']],
  ['Gemfile', ['rubygems.org', 'index.rubygems.org']],
  ['requirements.txt', ['pypi.org', 'files.pythonhosted.org']],
  ['pyproject.toml', ['pypi.org', 'files.pythonhosted.org']],
  ['Pipfile', ['pypi.org', 'files.pythonhosted.org']],
  ['go.mod', ['proxy.golang.org', 'sum.golang.org']],
  ['Cargo.toml', ['crates.io', 'index.crates.io', 'static.crates.io']],
  ['composer.json', ['repo.packagist.org']],
]
const MODEL_HOST: Partial<Record<Agent, string[]>> = { claude: ['api.anthropic.com'], codex: ['api.openai.com', 'chatgpt.com', 'auth.openai.com'], gemini: ['antigravity.google', 'generativelanguage.googleapis.com', 'cloudcode-pa.googleapis.com', 'oauth2.googleapis.com'], grok: ['api.x.ai'] } // a wrapped one's too (netProxy.ts); OpenCode's: the provider you set up, by its card
export function netList(has: (file: string) => boolean, agent: string, own: readonly string[] = []): string[] {
  const reg = REGISTRIES.filter(([f]) => has(f)).flatMap(([, h]) => h)
  return [...new Set([...reg, 'github.com', 'api.github.com', ...(MODEL_HOST[agent as Agent] ?? []), 'localhost', ...own])]
}
// a command the agent's sandbox stopped (the view's boxed: its card offers a restart without it, tabUnbox): claude's
// PostToolUseFailure whose error says so (macOS's "Operation not permitted", Linux's read-only mounts, the network
// proxy's refusal), or its ask to run a command again outside the sandbox (Bash's dangerouslyDisableSandbox).
// ponytail: matched by message, as claude's docs word them (Nov 2026); codex says nothing a hook carries
export const SANDBOX_DENIED = /Operation not permitted|Read-only file system|blocked by (the )?sandbox|Connection to \S+ blocked/i
// the host claude's sandbox names as it refuses a connection ("Connection to <host> blocked…", in the command's result)
const NET_BLOCKED = /Connection to ([^\s:/]+)(?::\d+)? blocked/i
export type Boxed = { cmd: string; why: string; host?: string; wrap?: true } // wrap: the macOS wrapper sandbox refused it (a write outside where it works)
export function sandboxStop(pl: { hook_event_name?: unknown; tool_name?: unknown; tool_input?: { command?: unknown; dangerouslyDisableSandbox?: unknown }; error?: unknown; tool_response?: unknown }): Boxed | undefined {
  if (pl.tool_name !== 'Bash') return
  const cmd = String(pl.tool_input?.command ?? '').trim().split('\n')[0].slice(0, 200)
  if (pl.hook_event_name === 'PermissionRequest' && pl.tool_input?.dangerouslyDisableSandbox === true) return { cmd, why: 'it asks to run it outside the sandbox' }
  // a failure's error, or a command that ended well but printed the proxy's refusal (curl without -f)
  const said = pl.hook_event_name === 'PostToolUseFailure' && typeof pl.error === 'string' ? pl.error : pl.hook_event_name === 'PostToolUse' ? (r => (r && typeof r === 'object' ? `${(r as { stdout?: unknown }).stdout ?? ''}\n${(r as { stderr?: unknown }).stderr ?? ''}` : ''))(pl.tool_response) : ''
  const line = said.split('\n').find(l => (pl.hook_event_name === 'PostToolUse' ? NET_BLOCKED : SANDBOX_DENIED).test(l))
  if (!line) return
  const host = NET_BLOCKED.exec(line)?.[1]?.toLowerCase()
  return { cmd, why: line.trim().slice(0, 200), ...(host && NET_HOST.test(host) && { host }) }
}
export const sandboxOff = (agent?: string, perm?: string, args?: string) => bypassArgs(args) || /\bdanger-full-access\b/.test(args ?? '') || (!permInArgs(agent, args) && perm === 'bypassPermissions')
// API list prices, USD per million tokens, by a transcript's exact model id (claude's message.model, codex's
// turn_context): src/shared/prices.json (scripts/prices.ts, LiteLLM's table; dated), then PRICE_OWN over it, field by
// field. Never a family guess: a model with no row is unpriced (costOf: undefined), its tokens counted, no dollars.
// A row's rates: input, output, cache read, cache writes (5 minutes, 1 hour; none said: 1.25x and 2x input), a long
// prompt's (long: past its above, a request's whole input, cache too, the request's every token at those) and fast mode
// (fast: claude's usage.speed "fast", times every rate). Batch and priority tiers are left out (agents run neither).
export type Rates = { in: number; out: number; rd?: number; w5?: number; w1?: number }
export type Price = Rates & { long?: Partial<Rates> & { above: number }; fast?: number }
export const pricesDate = (): string => PRICE_TABLE.date // read when asked: a top-level read would keep the table in the window's first load
// Laki's own: what LiteLLM lacks (retired ids old chats name, a long prompt's rates it leaves out) or doesn't say
// (fast mode: 2x on the models that have it, per the API's pricing). ponytail: by hand, 2026-11
const SONNET4_LONG = { above: 200e3, in: 6, out: 22.5, w5: 7.5, w1: 12, rd: 0.6 }
const OPUS4 = { in: 15, out: 75, w5: 18.75, w1: 30, rd: 1.5 }
export const PRICE_OWN: Record<string, Partial<Price>> = {
  'claude-opus-4-20250514': OPUS4,
  'claude-opus-4-1-20250805': OPUS4,
  'claude-sonnet-4-20250514': { in: 3, out: 15, w5: 3.75, w1: 6, rd: 0.3, long: SONNET4_LONG },
  'claude-sonnet-4-5': { long: SONNET4_LONG },
  'claude-sonnet-4-5-20250929': { long: SONNET4_LONG },
  'claude-3-7-sonnet-20250219': { in: 3, out: 15, w5: 3.75, w1: 6, rd: 0.3 },
  'claude-3-5-haiku-20241022': { in: 0.8, out: 4, w5: 1, w1: 1.6, rd: 0.08 },
  'claude-opus-5-5': { fast: 2 },
  'claude-opus-5': { fast: 2 },
  'claude-opus-4-8': { fast: 2 },
  'claude-fable-5-2': { fast: 2 },
  'claude-mythos-5-2': { fast: 2 },
}
// settings.prices (Settings › Usage › Model prices, the Usage page's Set price): yours, USD per million, over PRICE_OWN and
// prices.json; { as }: priced as another model is (one with no price of its own: a gateway's alias). The daemon's own
// settings (core.ts sets yours.of); a kept day re-prices at once, its rows keeping parts
export type OwnPrice = Rates | { as: string }
export type QuotaSource = { id: string; name: string; url: string; token?: true } // token: one kept for it (the Keychain's quota-<id>)
export const QUOTA_MAX = 8 // quota sources at most, and accounts a source and windows an account (usage.ts quotaRead)
export const priceYours: { of?: () => Record<string, OwnPrice> | undefined } = {}
// a price as Settings may keep it: rates 0 to 10,000 a million each, in and out given; or { as } another model
export function ownPriceOk(model: string, v: unknown): OwnPrice {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (typeof o.as === 'string') {
    const as = o.as.trim()
    if (!as || as === model || as.length > 200) throw new Error(`${model}: priced as which other model?`)
    return { as }
  }
  const r: Partial<Rates> = {}
  for (const k of ['in', 'out', 'rd', 'w5', 'w1'] as const) {
    if (o[k] === undefined || o[k] === null || o[k] === '') continue
    const n = Number(o[k])
    if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new Error(`${model}: ${k} is USD per million tokens, 0 to 10,000`)
    r[k] = n
  }
  if (r.in === undefined || r.out === undefined) throw new Error(`${model}: its input and output prices, USD per million tokens`)
  return r as Rates
}
export function priceOf(model: string | undefined, hops = 0): Price | undefined {
  if (!model) return
  const y = priceYours.of?.()
  const mine = y && Object.hasOwn(y, model) ? y[model] : undefined
  if (mine && 'as' in mine) return hops < 3 ? priceOf(mine.as, hops + 1) : undefined
  if (mine && typeof mine.in === 'number' && typeof mine.out === 'number') return { ...mine }
  const TABLE = PRICE_TABLE.models as Record<string, Price>
  const row = Object.hasOwn(TABLE, model) ? TABLE[model] : undefined
  const own = Object.hasOwn(PRICE_OWN, model) ? PRICE_OWN[model] : undefined
  const p = { ...row, ...own }
  return typeof p.in === 'number' && typeof p.out === 'number' ? (p as Price) : undefined
}
// a model's tokens by how they're priced (usage-days.json keeps these, costOf prices them now): in (input not from the
// cache), out, w5 and w1 (cache writes: 5 minutes, 1 hour), rd (cache reads); L: past its long line, F: fast mode
export type Parts = Record<string, number>
const PART = /^(in|out|w5|w1|rd)(L?)(F?)$/
const rate = (p: Price, k: string, long: boolean) => {
  const r = long && p.long ? p.long : undefined
  const at = (x: Partial<Rates> | undefined, f: keyof Rates) => x?.[f]
  const v = (f: keyof Rates) => at(r, f) ?? at(p, f)
  return k === 'rd' ? (v('rd') ?? v('in')!) : k === 'w5' ? (v('w5') ?? 1.25 * v('in')!) : k === 'w1' ? (v('w1') ?? 2 * v('in')!) : v(k as keyof Rates)!
}
// one answer's tokens as parts: its prompt's whole size (input and cache; size: the request's own, said apart: codex's
// last_token_usage) past the row's long line prices all of them long; fast mode only where the row has it
export function partsOf(model: string | undefined, n: { in?: number; out?: number; w5?: number; w1?: number; rd?: number }, fast = false, size = (n.in ?? 0) + (n.w5 ?? 0) + (n.w1 ?? 0) + (n.rd ?? 0)): Parts {
  const p = priceOf(model)
  const tag = `${p?.long && size > p.long.above ? 'L' : ''}${fast && p?.fast ? 'F' : ''}`
  const out: Parts = {}
  for (const k of ['in', 'out', 'w5', 'w1', 'rd'] as const) if (n[k]) out[k + tag] = n[k]!
  return out
}
export const partsTokens = (p: Parts) => Object.values(p).reduce((a, b) => a + b, 0)
export function partsAdd(to: Parts, p: Parts, by = 1) {
  for (const [k, v] of Object.entries(p)) (to[k] = (to[k] ?? 0) + by * v), to[k] === 0 && delete to[k]
  return to
}
// what tokens cost at those prices; undefined: a model with no row
export function costOf(model: string | undefined, n: Parts): number | undefined {
  const p = priceOf(model)
  if (!p) return
  let usd = 0
  for (const [k, v] of Object.entries(n)) {
    const m = PART.exec(k)
    if (m && v) usd += v * rate(p, m[1], !!m[2]) * (m[3] ? (p.fast ?? 1) : 1)
  }
  return usd / 1e6
}

// setup runs in a new worktree, teardown when one goes, run is the dev server, env goes to every tab;
// each field overrides .laki.json's (env key by key)
// expose: who Expose to the world lets in by default (emails, *@domains; empty: anyone with the link)
// actions: Run ▾'s for the project's workspaces, after the global ones (one of the same name and target replaces it);
// target any: whichever agent runs (the focused one first)
export type RunAction = { name: string; target: Agent | 'any' | 'shell'; text: string; slug?: string } // slug: unique across Settings' and every project's (actionSlug), what a workflow's use: names
// a prompt template: {{prompt}} (what's typed), {{project}}, {{base}}; settings.templates and a project's own
export type Template = { name: string; text: string; repo?: true } // repo: the repo's .laki/prompts (core.ts repoPrompts), trusted with its .laki.json
// copy: gitignore-style patterns of files git doesn't keep (.env…) a new worktree gets from the main checkout, with .worktreeinclude's
// ports: names for the status bar's ports ({"3000": "web"})
// Done means checked (daemon/verify.ts): a project's check, run as an agent's turn ends having changed files: its
// format, lint and test scripts that are ticked (in that order, the first failure stops it), then, if they pass, a
// read-only review of the diff by another agent. Set in the app (ProjectConfig.check) or a trusted .laki.json's check
export const CHECK_STEPS = ['format', 'lint', 'test'] as const
export type CheckStepName = (typeof CHECK_STEPS)[number]
export type DoneCheck = { steps?: CheckStepName[]; review?: 'claude' | 'codex' }
export const checkOk = (c: unknown): DoneCheck | undefined => {
  if (!c || typeof c !== 'object') return undefined
  const o = c as DoneCheck
  const review = o.review === 'claude' || o.review === 'codex' ? o.review : undefined
  return { steps: CHECK_STEPS.filter(k => Array.isArray(o.steps) && o.steps.includes(k)), ...(review && { review }) } // none ticked: off, over the repo's
}
export type CheckStep = { name: CheckStepName; state: 'wait' | 'run' | 'pass' | 'fail' | 'skip'; ms?: number; out?: string }
// a workspace's last check: the agent tab whose turn it checked, how it went, how many failures in a row went back
// the Proof card (verify.ts): what Laki saw of a checked turn itself, never the agent's words: each script's end (its
// output in the storage folder's file: proof/<turn>/<name>.md), the Preview's pictures, git's facts on what changed
export type ProofCheck = { name: string; ok: boolean; code: number; ms: number; summary: string; file?: string }
export type ProofFacts = { files: number; tests?: true; ci?: true; migrations?: true; lockfiles?: true }
export type Proof = { turn: number; tab: string; checks: ProofCheck[]; shots: { before?: string; after?: string; diff?: number /* the share of pixels that changed between them, a percent (verify.ts: pixelDiff) */ }; facts: ProofFacts; tree?: string } // tree: the worktree's tree it checked (Ship's proofMd: stale when another ships)
export type CheckRun = { tab: string; status: 'checking' | 'passed' | 'failed' | 'over'; steps: CheckStep[]; review?: { agent: string; state: 'wait' | 'run' | 'pass' | 'note' | 'fail'; note?: string }; tries: number; at: number }
export type ProjectConfig = { prompts?: Template[] /* the repo's .laki/prompts/*.md, read with .laki.json (core.ts repoPrompts): trusted with it */; ticket?: string /* prints the workspace's ticket (daemon/tickets.ts) */; setup?: string; teardown?: string; run?: string; test?: string; lint?: string; format?: string; deploy?: string; expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; mcp?: McpServer[] /* shared/mcp.ts: by flags, the user's alone */; copy?: string[]; clone?: string[] /* F7: folders cloned whole into a new worktree */; ports?: Record<string, string>; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod; simulator?: boolean; layout?: string; check?: DoneCheck; workflows?: boolean } // worktrees, pr, mergeMethod, simulator, layout (a saved layout's name, for new workspaces), workflows (Applicable for Workflows: its workspaces' Run workflow ›, off unless true): the app's only (never .laki.json): where new ones go; what the app may do to a PR; the last merge's way; the side panel's Simulator tab over Settings' (unset: Settings')
// what Laki may do to a project's PRs (its settings): approve, close and merge (each after a confirm) unless turned
// off; merge when green only when turned on
export type PRAllow = { approve?: boolean; close?: boolean; merge?: boolean; land?: boolean; revert?: boolean }
export type PRPerm = keyof PRAllow
// a review key ("thread:n thread:n", pr.ts' reviewKey) has something new since sent: a thread it wasn't in, or more comments
// on one than then. Fewer (one hidden on GitHub) is nothing new, and autoPR saves that lower count, so the next reply is.
// ponytail: a hide and a reply between two scans cancel out; ids of comments would tell them apart
const reviewCounts = (key: string) => new Map(key.split(' ').filter(Boolean).map(t => [t.slice(0, t.lastIndexOf(':')), Number(t.slice(t.lastIndexOf(':') + 1))] as const))
export const newReview = (key: string, sent = '') => (was => [...reviewCounts(key)].some(([id, n]) => n > (was.get(id) ?? 0)))(reviewCounts(sent))
export const FOLD_AFTER = 10 // settings.foldAfter's default: a project's rows before Show N more (Sidebar.tsx shownRows)
export const DISK_LOW = 5 // GB: settings.diskLow's default (resources.ts diskLowTick)
export const prAllows = (c: ProjectConfig | undefined, act: PRPerm) => (act === 'land' ? c?.pr?.land === true : c?.pr?.[act] !== false)
export type MergeMethod = 'squash' | 'merge' | 'rebase'
export const MERGE_METHODS: MergeMethod[] = ['squash', 'merge', 'rebase']

// git: false for a plain folder (local workspaces only: no worktrees, branches, diff or PRs)
// host: an SSH host (a ~/.ssh/config name or user@host): the folder is there, and so are git, gh and its tabs' programs
export type Project = {
  id: string
  tidied?: GitTidied // B8: its git's last weekly tidy (daemon/gitTidy.ts)
  name: string
  path: string
  archived?: number // archived (projectArchive): when; out of every list until it's back
  git?: boolean
  host?: string
  config?: ProjectConfig
  seps?: Sep[] // the sidebar's named lines between its workspaces
  rows?: string[] // with seps: its workspaces' and seps' ids in the sidebar's order (others after them)
  notes?: string // Project notes: the user's Markdown (links, how-tos), its ⋯ menu's Notes and Settings; never agents'
  inRepo?: boolean // B6: its notes and memory in its repo (.laki/notes.md, .laki/memory.md: core's notesOf, memoryOf), this Mac's choice; notes and memory here stay as they were meanwhile
  kind?: 'shells' | 'browsers' // the sidebar's Terminals (shells) or Browsers (quickNew): your home folder, a workspace per terminal or page
  sort?: WsSort // its workspaces' order in the sidebar (unset: manual, as dragged); a group's own wins
  cap?: Cap // a new workspace's spend cap here, unless its agent's profile has one (cap.ts)
  costWarn?: CostWarn // #3: its workspaces' cost warning amounts, over Settings' (on: false turns it off here)
  memory?: Memory[] // the project page's Memory, newest last: the user's (MEMORY_MAX) and what agents learned (auto, MEMORY_MAX); claude and codex get both at every start
  compacted?: CompactRun // its learned memories' last compaction (daemon/memory.ts): when, how many before and after, why, or what failed
  plans?: string // its specs' and brainstorms' folder (daemon/plans.ts), made with the first one
  trusted?: string // its .laki.json as you trusted it (projectTrust: sha256 of its JSON); one that isn't that gives its port names only
  cfgWait?: string // the view's: its .laki.json's hash while it has more than port names and you haven't trusted it as it is
  issueMark?: { id: number; etag?: string } // issue.labeled's (inbound.ts): the newest issue event read, its ETag
  github?: boolean // the view's: its origin is on GitHub (core.ts onGitHub): the new-workspace page offers In a codespace
  repoTemplates?: Template[] // the view's: its repo's .laki/prompts, once trusted (core.ts repoPrompts)
  hasSetup?: boolean // the view's: it has a setup script (projectConfig's: the app's, or a trusted .laki.json's): the new-workspace page's New worktree, no setup
  color?: string // TAB_COLORS': an accent (its icon, its workspaces' bar where they have none of their own, rail pins, bubbles)
  allow?: { tool: string; pattern: string; addedAt: number; hits?: number }[] // F14: its auto-answer rules (shared/ask.ts allowRuleOf): the user's only
  alwaysAsk?: string[] // F15: path globs an ask that touches one is never auto-answered for (shared/ask.ts alwaysAskOf): the user's only, never a phone's
  icon?: string // an ICONS name or an emoji (icons.ts emojiOf): before its name in the sidebar, menus, the palette, the window's title
  letters?: string // #5: its badge's two letters, picked (none: text.ts badgeLetters' own, distinct across projects)
  picture?: string | false // #5: false: its badge shows no picture of the repo's (the view's picture: core.ts pictureOf)
  private?: boolean // Recording mode (settings.recording) hides it and its workspaces (veiled)
  muted?: boolean // Mute project: none of its workspaces notifies, sounds, shows a card, pushes or counts in Needs you (wsView's muted, mutedBy), ones made later too; the user's (AGENT_NO)
  netAllow?: string[] // hosts a sandboxed agent's list (net: list) has here beyond netList's own: the user's alone (projectNetAllow, a card's Allow this domain)
  sample?: boolean // U4: Welcome's sample repo (<data>/sample, core.ts sampleNew): a tag on its head, Remove sample in its menu
}
// each mark unset: on; at: where a row shows them (unset: start, by the status circle)
export type PRMarks = { approved?: boolean; mine?: boolean; commented?: boolean; at?: 'start' | 'name' | 'end' }
export type Memory = { id: string; text: string; at: number; edited?: number; auto?: boolean; by?: string } // at: when it was added; auto: an agent's (auto-memory), else the user's; by: who (an agent, its workspace)
export const MEMORY_MAX = 50 // each kind's: the user's (refused past it), agents' (the oldest goes)
export const MEMORY_AUTO_LEN = 600 // an agent's memory: the gist, in a line or two
// a compaction of a project's learned memories (daemon/memory.ts): why (you: Compact now; days: its every N days; full:
// MEMORY_MAX reached), how many before and after; the log (memoryCompactLog) keeps each one's texts too
export type CompactRun = { at: number; why: 'you' | 'days' | 'full'; ok: boolean; before: number; after: number; ms?: number; error?: string }
export type CompactLogLine = CompactRun & { project: string; was?: string[]; now?: string[] }
export const COMPACT_DAYS = 7 // settings.memoryCompact.days unset
// the colors a tab, workspace, group, project, note or Desk tab can have (CSS --tc-<name>; ui.tsx colorVar)
export const TAB_COLORS = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray']
export type Sep = { id: string; name: string; color?: string; template?: string; preset?: string; sort?: WsSort; where?: SepWhere; perm?: string; model?: string; effort?: string; base?: string } // color: TAB_COLORS' name, its label's tint; template: a prompt template's name, the one a new workspace under it starts with; preset: an agent profile's name, likewise (its default agent); sort: its workspaces' (unset: the project's); where, perm (PERMS' id, '' ask first), model, effort, base: a new workspace's from it likewise (Edit group)
export const SEP_WHERE = ['worktree', 'bare', 'local'] as const // a new worktree, one without its setup script, the project's own folder
export type SepWhere = (typeof SEP_WHERE)[number]
// the sidebar's order of a project's workspaces, or a group's: as dragged, newest first, last active first, by name
export const WS_SORTS = ['manual', 'created', 'activity', 'name'] as const
export type WsSort = (typeof WS_SORTS)[number]
// a project's sidebar rows: its workspaces (of ws) with its seps between them, in the order dragged (rows; others
// after, seps first); the app's sidebar and the daemon's placeWs
export const rowsOf = <W extends { id: string; project: string }>(p: Pick<Project, 'id' | 'seps' | 'rows'>, ws: W[]): (W | Sep)[] => {
  const at = new Map((p.rows ?? []).map((id, i) => [id, i]))
  const end = at.size
  return [...(p.seps ?? []), ...ws.filter(w => w.project === p.id)].sort((a, b) => (at.get(a.id) ?? end) - (at.get(b.id) ?? end)) // stable
}
// Move to group › New group…: the rows with a new group (id) holding moved, in the list's order: before the project's first
// group (after the ungrouped rows: a group holds what's under its head, so none is split; at the end with none)
export function newGroupRows(ids: string[], isSep: (id: string) => boolean, moved: string[], id: string): string[] {
  const rest = ids.filter(x => !moved.includes(x))
  const at = (i => (i < 0 ? rest.length : i))(rest.findIndex(isSep))
  return [...rest.slice(0, at), id, ...ids.filter(x => moved.includes(x)), ...rest.slice(at)]
}
// a folder over SSH, as scp writes it: host:path (the host never an option, -…)
export const REMOTE = /^([A-Za-z0-9_][\w.@-]*):(.+)$/

// a workspace whose first agent starts later (wsNew startAt, wsSet pending): at a time, or (limit) as its account's plan
// limit resets (the account its tab would start on now: accounts.ts accountFor), at then that reset as last read (none:
// not known yet); failed: why its start didn't (Start now tries again); the rest is what its agent tab gets
export type Pending = { at?: number; limit?: boolean; failed?: string; preset: string; cmd?: string; prompt?: string; model?: string; effort?: string; perm?: string; fast?: boolean; sandbox?: boolean; vars?: boolean; agent?: string; permFrom?: string }
export type PendingView = { at?: number; limit?: boolean; failed?: string; prompt?: string; agent: string } // the view's: its prompt's first line, the preset
export const LIMIT_AGENTS = ['claude', 'codex', 'grok', 'gemini'] // the agents whose plan limits Laki reads (usage.ts): the ring, laki limits, a start after the limit resets
export const USAGE_AT = 90 // a plan limit's % that notifies (settings.usageAt unset), and that a delayed start's limit waits for
// a plan limit's reset, a delayed start's (schedule.ts pendingTick, the new-workspace page): the soonest among the
// windows at or past at (%), else the 5-hour window's (one with a note, an amount, isn't a limit)
export function resetOf(windows: UsageWindow[], at: number) {
  const real = windows.filter(w => !w.note && w.resets)
  const hit = real.filter(w => w.used >= at).map(w => w.resets!)
  return hit.length ? Math.min(...hit) : real.find(w => w.label === '5-hour')?.resets
}
// New workspace's profile list: a usage row's tightest window (the most used, a note's amount aside), what's left of it
// (0 to 100), its name short ("5 h", "week") and its reset while it's ahead; none: an error, or no window
export function planLeft(row: AgentUsage | undefined, now = Date.now()): { left: number; label: string; reset?: number } | undefined {
  const real = row && !row.error ? row.windows.filter(w => !w.note) : []
  if (!real.length) return
  const w = real.reduce((a, b) => (b.used > a.used ? b : a))
  const h = /^(\d+)-hour/.exec(w.label)
  const label = h ? `${h[1]} h` : /^weekly/i.test(w.label) ? 'week' : /^monthly/i.test(w.label) ? 'month' : w.label.toLowerCase()
  return { left: Math.max(0, Math.min(100, Math.round(100 - w.used))), label, ...(w.resets && w.resets > now && { reset: w.resets }) }
}
// an agent's own numbers (Claude Code's status line, Codex's reports) older than 20 minutes: what it used since, outside
// Laki too, isn't in them (the popup dims them, the profile list says as of when)
export const usageOld = (r: AgentUsage | undefined, now = Date.now()) => !!r && r.source === 'own' && !r.error && r.windows.length > 0 && now - r.at > 20 * 60_000
// the usage row a profile's tab would start on: its account's, else the default one (StartChip, the profile list)
export const usageRow = (rows: AgentUsage[] | undefined, agent?: string, account?: string) => rows?.find(x => x.agent === agent && (account ? x.account === account : x.default))
// a tab you closed (⌘W), kept for ⇧⌘T: what brings it back (core.ts closeTab, tabReopen); cwd: a shell's folder
// Search chats' hit (meters.ts chatSearch): its workspace and tab (none: a closed tab's chat), the tab's name and agent,
// when it was said, who said it, 160 characters around the words, the transcript line's id (claude's uuid, else L<n>)
export type ChatHit = { ws: string; tab?: string; name: string; agent: string; at?: number; who: 'you' | 'agent' | 'tool'; text: string; id: string }
export type ClosedTab = { draft?: string; name: string; kind: 'agent' | 'shell'; preset?: string; profile?: string; resumeId?: string; model?: string; effort?: string; perm?: string; fast?: boolean; sandbox?: boolean; account?: string; cmd?: string; cwd?: string; at: number; spent?: number /* its chat's cost as it closed: taken off the workspace's spentClosed if it's resumed */ }
export type Workspace = {
  id: string
  cap?: Cap // its spend cap (cap.ts): its own, {} none; unset: its agent's profile's, else its project's
  capOver?: number // when it went over its cap: its turns stopped, sends wait in its tabs' queues until you add to it or remove it
  capTold?: boolean // its 80% notice sent (for the cap as it is)
  spentClosed?: number // its closed agent tabs' cost, summed as each closed (core.ts closeTab): still in its cap and cost warning (cap.ts); the daemon's, never a call's
  costTold?: Partial<Record<CostLevel, number>> // #3: the cost warning's amounts it was told at (a higher one tells again)
  project: string
  path: string
  host?: string // its project's SSH host: path is there
  branch: string
  base: string
  kind: 'worktree' | 'local'
  port: number
  created: number
  archived?: boolean
  imported?: boolean // a worktree made outside Laki (worktreeImport): a delete or archive leaves its folder to git worktree remove
  notesAt?: number // its Review tab's comments changed by the daemon (a sent one's turn ended: core.ts reviewNotesTurn): an open Review tab reads them again
  setupWait?: boolean // made while its project's .laki.json wasn't trusted: its copy and setup run as you trust it
  noSetup?: boolean // made without its setup script (wsNew noSetup): Run ▾'s Run the setup script (run's setup) clears it
  archivedAt?: number // when (ms), for settings.archivedDays
  reviewed?: { at: number; tree: string; turn?: number } // R11: Since I reviewed's mark (turns.ts reviewMark): when, the worktree's tree then, the newest kept turn then
  soon?: { at: number; what: string[]; days?: number } // R8: told it goes within a day (archivedTidy): when, and what it keeps that would go to the trash; days: Disk's Tidy's, not archivedDays
  color?: string // its sidebar color's name
  name?: string // shown instead of the id (which names the worktree and branch)
  term?: boolean // made as a terminal (quickNew's shells): its menus close it, no branch or PR items
  untitled?: boolean // made with no name or prompt: its agent's first prompt names it (core's titleFrom); false: renamed, never
  named?: true // you named it (renamed it, or typed its name as it was made): an agent's rename is refused unless you asked (laki rename --asked), a page's title never renames it
  schedule?: string // the scheduled task that made it (its clock in the sidebar)
  muted?: boolean // no notifications from its tabs
  waitingOn?: { text: string; at: number } // Waiting on… (wsSet's waitingOn, laki wait-on): what it waits on, out of Needs you and the counts (nextStep.ts heard) until its agent asks something new or starts a turn
  mutedBy?: 'project' // the view's: muted because its project is (Mute project), not on its own
  important?: boolean // its agents' asks and finishes as cards on screen, until answered or closed (main's addCard)
  private?: boolean // Recording mode (settings.recording) hides it (veiled); its project's private too
  pinned?: boolean // the sidebar shows it above the projects, under Pinned
  railPin?: number // on the rail, after a line, for a quick click (RAIL_PINS at most): when it was pinned, their order
  icon?: string // its rail pin's (an ICONS name or an emoji, kept by wsSet), over its initials or a terminal's mark
  autoFix?: boolean // failing CI goes to the agent
  autoReview?: boolean // new PR review comments go to the agent
  autoMerge?: boolean // merge conflicts with the PR's base go to the agent
  cloned?: string[] // the folders Laki cloned into it (core's cloneDirs: APFS clones), for Disk's "may be shared"
  merged?: true // archived with its PR merged (Disk's Tidy)
  secretOk?: string[] // Ship's secret check: the hashes of what you said is not a secret (findSecrets'), here only; never in the view (wsOut)
  autoLand?: boolean // merge when green: Laki merges the PR (its project's last way) once all checks pass, no conflicts, not a draft, approved if it must be
  fix?: PRFix // what autoFix/autoReview/autoMerge/autoLand did already
  race?: string // one prompt fanned out to several agents: the workspaces of one race share it (Compare)
  issue?: { number: number; url: string; title: string } // the GitHub issue it was started from (laki new --issue)
  prUrl?: string // its primary PR, by URL (a fork's, another repo's): laki new --pr's, a prompt's, one attached or its agent named; else its branch's
  prLinked?: boolean // prUrl isn't its branch's (a prompt's, one attached): no auto switches (fix and push)
  prOff?: string // its branch's own PR, detached (prDetach): the scan leaves it out until it's attached again (a new one on the branch is its PR)
  prSaid?: boolean // prUrl a guess, a PR its prompt or its agent (prFromSaid) named, not one attached or asked for (--link): a worktree's branch's own PR, once pushed, replaces it
  related?: string[] // GitHub PRs and issues it's about, not its primary: its prompt's (a session an agent started), a primary its own PR replaced, one you moved off
  from?: string // the workspace whose agent started it (laki new ., /laki:new, MCP): its prompt's PRs are only related
  fromTab?: string // …and that agent's tab (the one that ran laki new): Created by on the worker, its asks in that tab
  suggests?: Suggestion[] // #5: tasks its agents suggested (laki suggest, daemon/suggest.ts): the open ones' cards, the answered kept to refuse again
  client?: string // T1: the trusted client (an app outside Laki: laki client) that started it, by its name then: Created by
  autoArchived?: number // the merged PR it was archived for (settings.archiveMerged): once, so an Undo stays
  touchedAt?: number // settings.archiveIdle's: the last look it saw, or when it was restored (ms)
  fork?: boolean // a fork's PR (or a fork of one): its .laki.json isn't read, the repo's is
  browser?: string // a Browsers workspace: the page it's on (the app shows it instead of terminals)
  storage?: string // its tabs' $LAKI_STORAGE_FOLDER (storageOf: made at its first tab; kept in <storage>/.kept as it's deleted, unless settings.keepStorage is false: core's rmStorage)
  flow?: string // the workflow run that made it (its mark in the sidebar)
  codespace?: string // a cloud workspace's GitHub Codespace (settings.cloud): its name, '' while gh makes it; host: Laki's ssh name for it, path: the repo there
  csState?: string // its state as gh says it (Available, Shutdown, Starting…), Creating while it's made, Failed when that failed
  csError?: string // why making or starting it failed
  pending?: Pending // its agent starts later
  closed?: ClosedTab[] // the tabs you closed here, newest first, CLOSED_MAX (core.ts) at most: ⇧⌘T, the + menu
}

// for one PR: the commit whose failing CI was sent, how many times in a row, the review threads sent; the commit whose
// merge conflicts were sent, how many times in a row
export type PRFix = { pr: number; ci?: string; tries?: number; review?: string; mine?: string[]; merge?: string; merges?: number; land?: string; held?: string } // mine: the agent's comments (it comments as you); land: the head commit merge when green tried; held: its gates' extensions as they were when they held it (widgetEvents.ts gatesKey): changed, it's tried again
export type FixWhat = 'ci' | 'review' | 'conflict'

// what fix CI, review and fix conflicts (and the info panel's send buttons) tell the agent; settings.prPrompts
// replaces any of them. {{pr}}: the PR's number, {{url}}: its link, {{base}}: its base branch. The failing checks
// (with the end of their logs) or the open review threads go after it.
export const PR_PROMPTS: Record<FixWhat, string> = {
  ci: 'CI fails on PR #{{pr}} ({{url}}). Find the cause and fix it, run what you can locally, then commit and push the fix, then say what you changed.',
  review:
    "Address the open review comments on PR #{{pr}} ({{url}}). Fix what you agree with; then commit and push the fix, then say what you changed, and what you didn't and why. Answer here, not on GitHub.",
  conflict:
    'PR #{{pr}} ({{url}}) has merge conflicts with {{base}}. Merge it in (git fetch origin {{base}}, then git merge origin/{{base}}; no rebase, no force push), resolve the conflicts keeping what both sides meant, run what you can locally, then commit and push the merge, then say what you changed.',
}
// a GitHub Actions check's job id, from its link (…/actions/runs/<run>/job/<id>): what gh run view --job takes; other CI: none
export const jobOf = (url = '') => /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url)?.[1]
// the first GitHub PR a prompt names ("review https://github.com/o/r/pull/12"): the new workspace is named after it
// and linked to it
// a GitHub pull request's or issue's link: owner, repo, pull|issues, number (ghCard's, a terminal's hover card)
export const GH_LINK = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?![\w])/
export const prIn = (text = '') => /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
// every GitHub PR and issue a text names, each once (any case: GitHub's names are), as first written: a workspace's related
export const refsIn = (text = '') => {
  const seen = new Map<string, string>()
  for (const [u] of text.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+/g)) if (!seen.has(u.toLowerCase())) seen.set(u.toLowerCase(), u)
  return [...seen.values()]
}

// {{name}} (spaces inside allowed) as vars say; an unknown one stays as it is (not {{constructor}}): prompt templates', PR_PROMPTS'.
// The template's dates ({{DD-MM-YY HH:MM}}, when.ts' stamp) are now's; what vars bring in (a typed prompt) isn't stamped
export const fillTemplate = (text: string, vars: Record<string, string | undefined>, at = Date.now()) => fillVars(stamp(text, at), vars)
// {{name}} and {{ws.branch}}-style names as vars say, nothing else: no dates (a typed prompt's {{DD}} stays)
export const fillVars = (text: string, vars: Record<string, string | undefined>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? (vars[k] ?? m) : m))
// agent variables (Maestro's {{AGENT_PATH}}…, Laki's lowercase like {{prompt}}): what an action (Run ▾), a prompt
// template, a scheduled prompt and a workflow are filled with as they reach a workspace's agent or terminal (the daemon,
// asked with vars: a message you type is left as it is); one without a value (no PR yet) stays. Settings' chips list them
export const AGENT_VARS: [string, string][] = [
  ['{{workspace}}', "the workspace's name"],
  ['{{branch}}', "the workspace's branch"],
  ['{{path}}', "the workspace's folder (its worktree)"],
  ['{{port}}', "the workspace's $PORT"],
  ['{{pr}}', "the workspace's PR (its link)"],
  ['{{project}}', "the project's name"],
  ['{{base}}', 'the base branch'],
  ['{{storage}}', "the workspace's storage folder ($LAKI_STORAGE_FOLDER)"],
  ['{{tab}}', 'the tab it goes to (its name)'],
  ['{{agent}}', 'the agent there: claude, codex…'],
  ['{{date}}', 'today: YYYY-MM-DD'],
  ['{{time}}', 'now: HH:MM'],
]
export function agentVars(w: { id: string; name?: string; path: string; branch?: string; base?: string; port?: number; storage?: string }, o: { project?: string; pr?: string; tab?: { name: string; preset?: string } } = {}, at = Date.now()): Record<string, string | undefined> {
  return {
    workspace: w.name || w.id,
    branch: w.branch || undefined,
    path: w.path,
    port: w.port ? String(w.port) : undefined,
    pr: o.pr,
    project: o.project,
    base: w.base || undefined,
    storage: w.storage,
    tab: o.tab?.name,
    agent: o.tab?.preset,
    date: stamp('{{YYYY-MM-DD}}', at),
    time: stamp('{{HH:mm}}', at),
  }
}
// a project's templates first (the app's, then its repo's .laki/prompts that none of those replaces), then the global ones
// neither replaces (one of the same name)
export const templatesFor = (global: Template[] = [], project: Template[] = [], repo: Template[] = []) => {
  const mine = [...project, ...repo.filter(r => !project.some(t => t.name.trim() === r.name.trim()))]
  return [...mine, ...global.filter(g => !mine.some(t => t.name.trim() === g.name.trim()))]
}
// a PR as the new-workspace page has it: the PR field (#123 or its URL), else a PR's URL in the prompt, else a prompt
// that is only #123 or 123
export function prRef(field = '', prompt = '') {
  const ref = (s: string) => /^https?:\/\//.test(s) ? s : /^#?\d+$/.test(s) ? `#${s.replace('#', '')}` : undefined
  return ref(field.trim()) ?? prIn(prompt) ?? ref(prompt.trim())
}
// the prompt through a template; one without {{prompt}} gets the typed text after it, unless that text is only the
// PR its {{pr}} took
export function templated(t: Template | undefined, prompt: string, vars: Record<string, string | undefined> = {}) {
  if (!t) return prompt
  const text = fillTemplate(t.text, { ...vars, prompt })
  const uses = (k: string) => new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`).test(t.text)
  const taken = uses('pr') && !!vars.pr && [vars.pr, vars.pr.replace('#', '')].includes(prompt.trim())
  return uses('prompt') || !prompt.trim() || taken ? text : `${text}\n\n${prompt}`
}
// an action's slug: its own (typed) or its name's, lowercase words and dashes, 40 at most; -2, -3… past one taken
export function actionSlug(want: string, taken: Set<string> = new Set()) {
  const base = want.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'action'
  let s = base
  for (let n = 2; taken.has(s); n++) s = `${base.slice(0, 40 - String(n).length - 1)}-${n}`
  taken.add(s)
  return s
}
// the action a workflow's use: names, by its slug, else its name (any case); the merged list first, then the global
// ones a project's replaced
export function findAction(global: RunAction[] = [], project: RunAction[] = [], use?: string) {
  const u = use?.trim()
  if (!u) return undefined
  const all = [...mergeActions(global, project), ...mergeActions(global)] // unfinished ones (no name or text) aren't actions
  return all.find(a => a.slug === u) ?? all.find(a => a.name.trim().toLowerCase() === u.toLowerCase())
}
// the global actions and a project's together: a project's one with a global one's name and target replaces it
export function mergeActions(global: RunAction[] = [], project: RunAction[] = []) {
  const same = (a: RunAction, b: RunAction) => a.target === b.target && (a.name ?? '').trim() === (b.name ?? '').trim() // a hand-edited one may lack a name
  return [...global.filter(g => !project.some(p => same(p, g))), ...project].filter(a => a.name?.trim() && a.text?.trim())
}
// Settings › Telegram (daemon/telegram.ts): your own bot, paired with you in its private chat. No token here (it's in
// the Keychain, else a 0600 file), nor a pairing code (only telegramPair's answer has it). level: what the chat may do
// (notify: pushes; answer, the default: taps, replies, files, /status /screen /diff /quiet; control: /new too); off:
// paired, but quiet; pushOff: Only when I ask, nothing sent on its own (commands answer; the workspace you talk to
// still sends its asks and its turns' ends; a tab's bell rings); threads: P4's topic per workspace (message_thread_id); notice: why it stopped (a 409, a 401, a group
// from the old webhook)
export type TgLevel = 'notify' | 'answer' | 'control'
export type Telegram = { focus?: string /* where plain words go: a workspace's id (a card's 💬 Talk here, /talk) or '@ai', Laki AI (/ai); telegram.ts */; keyed?: boolean /* a token is kept (the key store's: read only to call Telegram) */; bot?: { id: number; username: string; name: string; topics?: boolean }; user?: { id: number; name: string; at: number }; level?: TgLevel; off?: boolean; pushOff?: boolean; waiting?: boolean; done?: boolean; detail?: 'titles'; topics?: boolean; threads?: Record<string, number>; notice?: string }
// the view's (no ids): token: one is kept; pairing: a code waits until then; polling: the long poll runs
export type TelegramView = Omit<Telegram, 'user' | 'threads' | 'bot' | 'keyed'> & { bot?: { username: string; name: string; topics?: boolean }; user?: { name: string; at: number }; token: boolean; pairing?: number; polling?: boolean }
// a webhook's URL as pushes take it (push.ts; Settings says why not as you type)
export function webhookUrl(url?: string) {
  let u: URL
  try {
    u = new URL(String(url ?? '').trim())
  } catch {
    throw new Error('the webhook needs a URL')
  }
  // what's pushed holds the agent's question: plain http only to this Mac (a relay of yours, tests' server)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) throw new Error('the webhook URL must start with https://')
  return u.href
}
// pushes set up: a URL, or Web Push (the paired phones that turned notifications on: no URL)
export const pushOn = (w?: Webhook): w is Webhook => !!w && (w.format === 'webpush' || !!w.url?.trim())
// Answer from the phone over ntfy needs a topic only you read: ntfy.sh's are public (anyone reading one could tap), so an
// access token (?auth=) or a server of your own. Slack and JSON have no taps (Telegram: Settings › Telegram)
export function answerOk(w: Webhook) {
  if ((w.format ?? 'ntfy') !== 'ntfy') return true
  try {
    const u = new URL(webhookUrl(w.url))
    return u.hostname !== 'ntfy.sh' || !!u.searchParams.get('auth')
  } catch {
    return false
  }
}
export const ANSWER_WHY = "ntfy.sh's topics are public: anyone who reads yours could tap. Add an access token (?auth=…) to the URL, or use your own ntfy server"

export const PR_SCAN = 1 // minutes between PR checks (settings.prScan)
export const PR_QUIET = 5 // minutes a quiet PR (open, nothing running) waits between the timer's checks (settings.prQuiet)
export const PR_BOTS = ['github-actions', 'copilot-pull-request-reviewer', 'coderabbitai'] // the review bots whose threads go to the agent (settings.prBots); other bots' are skipped
export const PR_TRIES = 3 // failing CI or conflicts go to the agent this many times in a row (settings.prTries), then over to you

export type TabKind = 'agent' | 'shell' | 'setup' | 'dev' | 'ship' | 'script' // script: Run ▾'s test, lint, format or deploy (its name)
// the project's scripts Run ▾ starts besides run, each in a tab of its own (named as it), set like run (the project's
// settings, .laki.json)
export const RUN_SCRIPTS = ['test', 'lint', 'format', 'deploy'] as const
// laki screen's ops on what isn't a web page (daemon/device.ts): a screenshot of the iOS Simulator or an app's window,
// the windows open, and the simulator's hands through idb
export const DEVICE_OPS = ['shot', 'windows', 'tap', 'swipe', 'type', 'describe'] as const
// the side panel's Simulator (daemon/device.ts' sim): booted iOS Simulators and adb's Android devices, a frame of one, a
// screenshot for an agent (shot: its path, an iOS one in points), input (keys: device.ts' IOS_KEYS, DROID_KEYS), and
// check: what this Mac has of what each needs (Settings › Simulators); devices: every iOS Simulator and Android virtual
// device, running or not, which start and stop boot and shut down (Settings › Simulators' Devices)
export const SIM_OPS = ['list', 'frame', 'shot', 'tap', 'swipe', 'type', 'key', 'check', 'devices', 'start', 'stop'] as const
// one of sim devices': ios:<udid> or avd:<name>; runtime: an iOS one's (iOS 27.0)
export type SimDev = { id: string; name: string; os: 'ios' | 'android'; runtime?: string; on: boolean }
// one thing a simulator needs: ok, else fix (a command to run, or where to click); warn: it works without it, in part
// (idb: no taps), or it's what runs now (none booted)
export type SimCheck = { os: 'ios' | 'android'; id: string; label: string; ok: boolean; says: string; fix?: string; warn?: boolean }
export type RunScript = (typeof RUN_SCRIPTS)[number]
// Enter (or the tab menu's Restart) in its ended tab starts it again: an agent, the run tab, a script; a deploy only
// through Run ▾, which asks (core's input, App's tab menu)
export const againOnEnter = (t: { kind: TabKind; script?: RunScript }) => t.kind === 'agent' || t.kind === 'dev' || (t.kind === 'script' && t.script !== 'deploy')

// A2, C6: a tab whose agent is signed out: out (Sign in), opened (its login runs: Open again, Send again), in (signed in,
// its message sent: then gone); agent: its name; account: its account's name (not the default); waiting: a message goes once it's in
// A1: a tab's /goal (claude's goal_status, codex's thread goal: daemon/share.ts goalIn): its words and where it stands.
// working holds the tab running between its turns (no done, Done check or next step until it stops: core's goalHold)
export type GoalState = 'working' | 'paused' | 'budget' | 'limit' | 'blocked' | 'reached' | 'failed'
export type Goal = { text: string; state: GoalState; at: number; own?: true; check?: string; turns?: number; maxTurns?: number; spent?: number; maxUsd?: number; why?: string } // own (A1b): Laki's, for an agent with no /goal (daemon/verify.ts goals): met when its project's check script passes, its turns so far of maxTurns, what the chat spent since it was set (its meter's, when the agent has one), why it stopped
// A1b: the goal Laki runs for a tab whose agent has no /goal of its own, kept on the tab (state.json): the project's script
// that says it's met (format, lint or test), at most maxTurns turns (unset 12) and maxUsd spent; turns so far, the chat's
// cost as it was set, the last failure's hash and how many turns in a row it came back the same
export type TabGoal = { text: string; check: 'format' | 'lint' | 'test'; maxTurns: number; maxUsd?: number; state: GoalState; at: number; turns: number; cost0?: number; outHash?: string; same?: number; why?: string; skip?: true } // skip: set while its agent was mid-turn, that turn's end isn't the goal's
export const GOAL_SAYS: Record<GoalState, string> = { working: 'working', paused: 'paused', budget: 'out of budget', limit: 'at a usage limit', blocked: 'blocked', reached: 'reached', failed: "can't be met" }
export type SignedOutView = { agent: string; step: 'out' | 'opened' | 'in'; account?: string; waiting?: boolean; at: number }
export type Tab = {
  id: string
  workspace: string
  name: string
  flow?: string // the workflow run that last sent it a block's prompt (the status bar links to it)
  shell?: string // a local shell tab's shell when it isn't the login one (Settings › Terminal › Shell, spawnTab): what varsIn quotes for, kept across a restart
  kind: TabKind
  preset?: string // an Agent or custom: what the agent is (hooks, resume)
  profile?: string // the preset (Settings) it started from: its args and env
  cmd?: string // custom command
  resumeId?: string // the agent's chat: claude session_id, codex thread-id, opencode session, pi's session (its extension says it), agy's conversation (what it printed as it exited), grok's (Laki picks it)
  kept?: string // the chat (a resumeId) Laki kept a copy of as its workspace was archived (core's keepChats): <storage>/chats/<id>.jsonl
  forkOf?: string // claude session to fork on first start
  queue?: string[] // follow-ups for when the agent is idle
  goalRun?: TabGoal // A1b: the goal Laki runs for it (an agent with no /goal of its own)
  queueHeld?: boolean // U8: Stop all agents stopped its turn: its queue waits for Resume queue (queueResume)
  color?: string // a tab color's name (red, blue, …); 'none' turns the agent's default off
  clip?: boolean // OSC 52 in a shell tab (Settings' termClip ask): your answer to its first copy, Allow or Not now, kept for its life (tabSet's; never an agent's)
  muted?: boolean // no notifications from it
  snoozed?: number // Needs you's ✕ and Snooze (tabSnooze): out of Needs you and every count until then (SNOOZE_NEXT: until something new), or sooner as it asks something new or starts a turn
  bell?: boolean // T16: its next ask or turn end told once, then off (core's ring, tabBell)
  model?: string // the agent's --model (unset: its own default), kept for restarts
  effort?: string // and its effort (EFFORTS)
  perm?: string // how freely it acts (PERMS' id; '': the agent's own; unset: its profile's), kept for restarts
  permFrom?: string // #6: perm is its lead's (the agent that started this worker without one): that tab's name or @alias
  fast?: boolean // fast mode (FAST; unset: its profile's), kept for restarts
  sandbox?: boolean // the agent's own sandbox (SANDBOX; unset: its profile's), kept for restarts
  wrap?: false // restarted without its profile's wrapper sandbox (tabUnbox), kept for restarts
  bgTold?: string[] // the background tasks a restart's note named (core's bgGone): their ends never come, so not named again
  stuckTold?: string // #3: the last stuck stretch told to its lead (daemon/stuck.ts' key: its kind and turn), never twice
  account?: string // the account it started on (claude, codex: an Account's id or HOME_ACCOUNT), kept for restarts and resumes
  again?: { cwd?: string; cmd?: string; run?: boolean } // what a shell ran as the daemon stopped (keepShells), back at its next start; a Run tab's: start it again
  titled?: boolean // its name says what it's for (given, renamed, or its first prompt's words): no prompt renames it
  draft?: string // what's typed in its Reader's box and not sent (never in the view: its drafted says there's one; tabDraft reads it)
  usedAt?: number // made, or its agent's last turn or ask (ms): one unused past sleepAfter stays asleep after a restart (restoreAll)
  script?: RunScript // a script tab's (kind script): which RUN_SCRIPTS one, whatever it's named
  alias?: string // its @name (laki name, ALIAS): other agents send and ask to @name, wherever it runs; one live tab each
}

export const ALIAS = /^[a-z][a-z0-9-]{0,23}$/ // an agent's @name: a word, lowercase, dashes

// a name in Latin letters for ids, branches and folders: Cyrillic by Ukraine's national romanization (with Russian's
// own letters too: ы, э, ё, ъ), accents dropped (café: cafe). ponytail: Cyrillic and Latin only; another script stays
// as it is (slug then drops it)
const CYR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', ё: 'yo', ы: 'y', э: 'e', ъ: '' }
export const latin = (s: string) => Array.from(s.toLowerCase().replace(/(?<=\p{Script=Cyrillic})['’ʼ](?=\p{Script=Cyrillic})/gu, ''), c => CYR[c] ?? c).join('').normalize('NFKD').replace(/\p{M}/gu, '')
// words in another script than Latin's (Cyrillic, CJK…): a workspace named by them shows them, its id and branch in Latin
export const nonLatin = (s: string) => /[^\p{Script=Latin}\p{Script=Common}\p{M}]/u.test(s)

// a few words of what a prompt asks, for a tab's name: its first line less links (a GitHub PR's or issue's is #n), flags,
// Markdown, a leading "please" and a trailing "the"; a path is its file's name; "" when nothing's left
export function taskTitle(prompt: string, words = 6) {
  let s = (prompt.split('\n').find(l => l.trim()) ?? '')
    .replace(/https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/(?:pull|issues)\/(\d+)\S*/g, '#$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)(?:[~.]{0,2}\/(?:[^\s/]+\/)+|(?:[^\s/]+\/){2,})([^\s/]*)/g, '$1$2') // a path: two parts at least (a /command, and/or stay)
    .replace(/(^|\s)--?[a-z][\w-]*(=\S*)?/gi, '$1')
    .replace(/[*_`>[\]()"{}]+|#(?!\d)/g, ' ')
    .trim()
  for (let was = ''; was !== s; ) {
    was = s
    s = s.replace(/^(please|pls|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|let's|lets|now|ok|okay|hey|hi|so|then|and)\b[\s,:;!.-]*/i, '')
  }
  const w = s.split(/\s+/).filter(Boolean).slice(0, words)
  while (w.length > 1 && /^(the|a|an|to|of|in|on|for|and|or|with|at|from|that|this|is|by|as)$/i.test(w.at(-1)!.replace(/[,.;:!?-]+$/, ''))) w.pop()
  const t = w.join(' ').replace(/[\s,.;:!?-]+$/, '')
  const c = [...t] // by code point: an emoji stays whole
  return c.length > 36 ? `${c.slice(0, 35).join('').trimEnd()}…` : t
}

// how an agent starts: one of AGENTS with extra args, or any command; env on top of the project's
// off: switched off in Settings: out of the pickers (new tab, new workspace, races, scheduled tasks); its tabs still start
// a profile (Settings › Agents & profiles; the code's word is preset): how an agent starts. laki: false: no note about
// Laki at its starts (unset: told); model, effort, perm (PERMS' id), fast (FAST): its tabs' unless a workspace picks its
// own; account: an Account's id or HOME_ACCOUNT (unset: the agent's default, settings.accountUse)
export type Preset = { name: string; agent: Agent | 'command'; cap?: Cap /* its workspaces' spend cap, unless the workspace has its own (cap.ts) */; args?: string; cmd?: string; env?: Record<string, string>; off?: boolean; laki?: boolean; model?: string; effort?: string; perm?: string; fast?: boolean; sandbox?: boolean; wrap?: 'macos' /* the macOS wrapper sandbox (shared/wrap.ts): its tabs under sandbox-exec, where its own sandbox is off or none */; account?: string; steer?: boolean; acp?: boolean; net?: Net; envAllow?: string[]; mcpOnly?: boolean; system?: string /* its standing instructions, added to what each new tab of it is told at the start (core's agentCmd), the project's memory too */ } // mcpOnly (#6): claude's --strict-mcp-config, only Laki's MCP servers (Settings' and the project's, and Laki's own) // envAllow: names hideSecrets lets through to its agent (src/shared/env.ts), the user's alone; // net: its sandbox's network (NET_OK), unset: all; acp: a command profile that speaks ACP on its stdio (Labs: daemon/acp.ts), its tabs no terminal; steer: claude's and codex's (on unless false), a message sent while it works goes into the running turn, not the queue (core's send)

// another sign-in of claude or codex: a config folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME) that Laki made, its
// settings, skills and chats shared with the agent's own (links), its sign-in not
export type AccountAgent = 'claude' | 'codex'
export const ACCOUNT_AGENTS: AccountAgent[] = ['claude', 'codex']
export const isAccountAgent = (a?: string): a is AccountAgent => a === 'claude' || a === 'codex'
export type Account = { id: string; agent: AccountAgent; name: string; dir: string }
// the agent's own sign-in (~/.claude, ~/.codex): an account with no folder of Laki's
export const HOME_ACCOUNT = 'home'
// who an account signs in as (accounts): its email and plan, read from its folder; signedIn: it has a sign-in
export type AccountView = { id: string; agent: AccountAgent; name: string; dir: string; email?: string; plan?: string; signedIn: boolean; default: boolean }

// what a notification is about: an agent waiting for you, done with its turn, at a usage limit; a plan limit nearly used (the app's own: usage)
export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error' // OSC 7501's (daemon/program.ts)
// what an agent's OSC 7501 root said against its status from hooks: compared once each change of state settles; last: the last that differed
export type NativeSeen = { agree: number; differ: number; last?: { at: number; native: ProgramState; hook: string; app?: string } }
export type NotifyKind = 'waiting' | 'done' | 'limit' | 'usage' | 'loop' // loop: an agent keeps failing the same command (shared/loop.ts)
export type TabLoop = { cmd: string; n: number; since: number } // the command it keeps failing (normalized: loopCmd), how many times this turn, since when
export type TurnFile = { path: string; add: number; del: number; status: string } // status: git's A, M, D (no renames)
// F1: a turn kept on disk (turns.ts): n: its number in its workspace; before, after: the worktree's trees; count: how
// many files (files: the first TURN_FILES); rewind: a rewind to before that turn (You, undone by rewinding this one)
export type TurnKept = { n: number; tab: string; name: string; prompt?: string; started?: number; ended: number; before: string; after: string; add: number; del: number; count: number; files: TurnFile[]; cost?: number; rewind?: number }
export type TurnChanges = { at: number; add: number; del: number; n: number; files: TurnFile[] } // n: how many files; files: the first TURN_FILES
export const WHEN_DONE = ['sleep', 'lock', 'shutdown'] as const
export type WhenDone = (typeof WHEN_DONE)[number] | 'off'
export const SECRET_WAIT = 15 * 60_000 // laki secret's wait for your answer, then no (daemon/secrets.ts)
export const ALERT_WAIT = 30 * 60_000 // laki alert's wait for your pick, then timedOut (daemon/alerts.ts)
// what a dialog, a notification or a card wouldn't show you: controls but tab and newline, direction and zero-width
// characters (Unicode's format ones), line and paragraph separators, spaces but the plain one (no-break, wide,
// ideographic…) and letters that draw as nothing (Hangul fillers, the braille blank). An agent's command asked in the
// app (main.ts' cmdAsk) is refused with one; a Yes on a notification or the island (text.ts' noteWhole) is left out;
// an alert's words lose them (alerts.ts)
export const HIDDEN = /[\p{Cf}\u2028\u2029\u115F\u1160\u3164\uFFA0\u2800]|[^\P{Cc}\t\n]|[^\P{Zs} ]/u
export const WHEN_DONE_WAIT = 60_000 // the countdown before it acts, which Cancel stops

// the app's settings (⌘,): editor is an app id (cursor, zed, …, see APPS) or 'custom' (editorCmd + the path)
// a webhook from outside (inbound.ts): its name (/hook/<name>), how a request proves it's the sender's (GitHub's or
// Linear's signature, else X-Laki-Key), the project its event is for
export type InHook = { name: string; kind: 'github' | 'linear' | 'key'; project?: string }
export const BACKUP_DIR = '~/Documents/Laki backups' // #B2: the weekly backup's folder unless you pick one (made the first time, when ~/Documents is there)
export type Settings = {
  gitTidy?: boolean // B8: each project's git tidied weekly (daemon/gitTidy.ts; unset: on)
  diskLow?: number // GB: a worktree's volume under it says so once (resources.ts diskLowTick; unset: DISK_LOW; 0: never)
  touchId?: boolean // Confirm risky actions with Touch ID (shared/confirm.ts; macOS, unset: off): the daemon holds CONFIRM's calls without a ticket
  editor?: string
  editors?: Record<string, string> // a project's own (by its id): Open in's last pick for its folder, ⌘E's there; none: editor
  customCss?: string // Appearance › Custom CSS, every window's (themes.ts userCss); not over remote access or from an agent (REMOTE_KEYS); Reset the interface clears it
  editorCmd?: string
  agent?: string // the preset new workspaces start
  branchPrefix?: string
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  rowSwipe?: boolean // two fingers across a sidebar row or a Needs you card: Snooze, Archive, Seen (renderer swipe.ts; unset: on on a Mac)
  termClip?: 'ask' | 'all' | 'never' // OSC 52, a program's copy to the clipboard: shells ask once each (unset), shells and agents, or never
  termPictures?: boolean // a terminal's last pictures pasted or dropped, as chips at its top (Term.tsx TermPics; unset: on)
  editKeys?: boolean // the terminal's ⌘← ⌘→ ⌘⌫ ⌥← ⌥→ as macOS editors have them (unset: on)
  fileClick?: 'preview' | 'editor' // a file path ⌘-clicked in a terminal (src/app.ts:42): Laki's preview (unset) or your editor; ⌘⌥: the other
  notify?: boolean
  prIcon?: boolean // the sidebar marks a workspace with a PR (unset: on)
  needsList?: boolean // Settings › Appearance › Sidebar: the Needs you list above Pinned and the projects (on unless false)
  staleAfter?: number // Settings › Needs you: minutes after which a done tab is stale (the renderer's text.ts isStale: Earlier, ⌘J and the bubbles last; unset 30, 0 never)
  keyOverlay?: boolean // Settings › Keys: hold ⌘ for a badge beside everything with a key (on unless false)
  layouts?: SavedLayout[] // the Layout menu's saved ones (shared/layout.ts): a split by role and the side panel
  ownAvatar?: boolean // that mark on your own PR has your GitHub picture (unset: on; off: GitHub's mark alone)
  avatars?: boolean // GitHub's pictures of PR authors, reviewers and commenters (unset: on; off: none loaded, L7)
  prMarks?: PRMarks // the sidebar's ✓ (approved), ✓✓ (by you too) and 👀 (you commented) on an open PR
  groupCount?: boolean // a sidebar group's count of workspaces after its name, on unless false: Layout › Sidebar rows › Group counts, Show ›; .group-count for Custom CSS
  hideWorkers?: boolean // #8: Show › Workers off: workspaces an orchestrator's tab started (fromTab, that tab still here) take no row of their own; their lead's row counts them (on only if true)
  sideView?: 'recent' | 'projects' // #9: the sidebar's Recent view, every workspace by when it last worked (unset, projects: by project)
  hideEmpty?: boolean // the sidebar leaves out a project with no row to show (none, all archived, all pinned): Appearance › Sidebar rows › Empty projects off (unset: shown)
  foldAfter?: number // the sidebar shows a project's first this many rows (unset: FOLD_AFTER; 0: all), plus any working, waiting on you or open, and Show N more
  simpleRow?: boolean // B4: Appearance › Sidebar rows › Simple row (off unless true): a row is its name and one next-step chip, the other marks on hover
  rowMarks?: Partial<Record<'step' | 'author' | 'conflict' | 'ci' | 'radar' | 'plan' | 'ticket', boolean>> // a sidebar row's other marks, each on unless false (step: off unless true; conflict, ci: unset, as prIcon)
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  edgeGlow?: boolean // the window's edge glows while an ask waits in another tab (on only if true: a new install's, core.ts NEW_DEFAULTS; nextStep.ts waitsElsewhere)
  dockBounce?: boolean // U15: the Dock icon bounces once as a workspace starts waiting on you, Laki not in front (unset: on)
  usageAt?: number // a plan limit's % that notifies (notifyOn.usage): 75, 90, 95 (unset: USAGE_AT, 90)
  scheduleMaxMinutes?: number // T8: a scheduled run's time limit, its agent's working time, for a task that sets none (unset: 60; 0: none)
  scheduleAtOnce?: number // T8: scheduled runs going at once; a due one past it waits its turn (unset: 2; 0: no cap)
  notifySound?: string // a macOS sound's name (Glass, Ping…), 'none', or unset: the default
  quietMinutes?: number // U8: Quiet's default length, in minutes (laki quiet, the phone's button): unset 60
  timerAlert?: 'dialog' | 'notification' // what a sidebar timer's end shows (unset: Laki's dialog)
  timerSound?: string // a macOS sound or 'none' as a timer ends (unset: Glass)
  presets?: Preset[] | null // null: the defaults
  hideSecrets?: boolean // Hide secret-looking variables from agents (shared/env.ts envSplit over the daemon's own environment, agent tabs only): a new install's on; one from before off, asked once (hideSecretsAsked). Never an agent's or a phone's
  updateDot?: boolean // A9: a dot on the rail's Settings while a newer agent CLI is out (the view's agentUpdates; unset: off)
  hideSecretsAsked?: boolean // the one-time notice for an install from before was answered
  voiceNote?: string // Q5b: the note "Note: …" said first goes to (the one named Voice, made on first use); main keeps it
  secretHint?: boolean // a prompt box's warning as a secret is pasted in (renderer's secretHint.tsx: shared/secrets.ts secretsIn, in the window), on unless false. Never an agent's
  sandboxNew?: boolean // a new install's: its default profiles (claude, codex) start in their sandbox (core.ts presets); one from before: unset, none. Never an agent's or a phone's (main.ts REMOTE_KEYS)
  accounts?: Account[] // claude's and codex's other sign-ins (the agent's own is HOME_ACCOUNT)
  accountUse?: Partial<Record<AccountAgent, string>> // each agent's default account for new sessions (unset: HOME_ACCOUNT)
  mcpApps?: boolean // MCP Apps in the Reader (mcpApps.ts: Laki asks your MCP servers for an app's page): on unless false
  limitFallback?: Partial<Record<AccountAgent, string[]>> // Auto fallback: each agent's accounts in order; a tab at its plan limit goes on on the next one (core's fallback). Unset or empty: off
  theme?: string
  themeAuto?: boolean // B3: Appearance's Follow the system: themeLight while the system is light, themeDark while dark (themes.ts themeFor)
  themeLight?: string
  themeDark?: string
  glass?: boolean // a see-through, blurred window
  glassWindow?: number // how see-through glass makes the window, the sidebar, the terminals: %
  glassSide?: number
  glassTerm?: number
  glassGlow?: boolean // the theme's colors behind the glass (unset: on)
  hdrGlow?: boolean // Labs: the edge glow and the newest Needs you card's ring brighter than white on an HDR display (renderer text.ts hdrOn; on only if true)
  glassLevel?: 'clear' | 'regular' | 'tinted' // Glass › Strength, as macOS 26's: its floating surfaces at 56, 72 or 88% (unset or anything else: regular); none with Reduce transparency
  refraction?: boolean // menus bend what's under their edges where they blur (on unless false)
  glassGrain?: boolean // with glass, a fine noise over its floating surfaces, the sidebar and the splash (on unless false)
  sideClear?: number // without glass: how see-through the sidebar and the rail are, the rest solid: % (unset or 0: the translucent sidebar's own tint; off macOS: 0)
  translucent?: boolean // V5: macOS: the sidebar and the rail over the window's sidebar material, the main area a card on it (unset: on)
  uiFont?: string // the interface's font
  uiSize?: number // tabs, menus, dropdowns, the status bar, tooltips and the side panel's tabs as one: px (unset: theirs; Appearance › Interface)
  accent?: string // #rrggbb over the theme's accent (unset: the theme's)
  radius?: string // corners, a CSS length over the theme's (unset: the theme's)
  templates?: Template[] // prompt templates ({{prompt}}…), for new workspaces; a project's own come first
  actions?: RunAction[] // Run ▾'s: a prompt for an agent, or a command for a terminal
  env?: Record<string, string> // every session's, under the project's and the preset's
  tunnelMails?: string[] // who the last tunnel let in (Expose to the world)
  tunnel?: NamedTunnel // permanent tunnels: your named tunnel and its domain (Settings › Tunnels)
  quotaSources?: QuotaSource[] // Settings › Usage › Add a quota source (quotaSourceSet, never settingsSet): its token in the Keychain only
  prices?: Record<string, OwnPrice> // Settings › Usage › Model prices: yours, by model id, over Laki's (priceOf); { as }: another model's
  usageAll?: boolean // Settings › Usage › Count every agent chat on this Mac: the machine scan (daemon/usageScan.ts), on unless false; off: Laki's own tabs only
  usage?: Record<string, boolean> // R4: claude, codex: its usage endpoint asked too, with its own sign-in (true only; else claude's and codex's own numbers)
  usageNote?: boolean // R4: the one-time note in Settings › Resources that plan limits moved to the agents' own numbers
  seenVersion?: string // U13: the version whose What's new card was closed (a new install: its own; '': from before U13, the next version's shows)
  labs?: boolean // Settings › General › Pages' Labs switch: LABS' pages and buttons all at once (core.ts load: a new install starts with false and each of them off)
  specs?: boolean // Settings › General › Pages: Specs & Brainstorms, on unless false (specsOn)
  workflows?: boolean // Settings › General › Pages: Workflows, on unless false (flowsOn)
  birdView?: boolean // Settings › General › Pages: the eye beside Help, every live session's screen at once, on unless false
  calendar?: boolean // Settings › General › Pages: the rail's Calendar, scheduled tasks and reminders by week or month, on unless false
  desk?: boolean // Settings › General › Pages: the rail's Desk, extensions placed there as tiles, on unless false
  notes?: boolean // Settings › General › Pages: the rail's Notes, your own notes (daemon/notes.ts), on unless false
  todoList?: boolean // Settings › General › Pages: the rail's To-dos, one checklist of your own (daemon/notes.ts' todoList*), on unless false
  cloud?: boolean // Settings › General › Cloud workspaces: a workspace in a GitHub Codespace (core.ts, daemon/codespace.ts), on unless false
  simulator?: boolean // Settings › Simulators: the side panel's Simulator tab, off unless true
  emuWindow?: boolean // Settings › Simulators: an Android emulator Laki starts gets its own window too (off unless true: -no-window, the side panel its only screen)
  history?: boolean // Settings › Appearance › Rail: back and forward through the pages and workspaces you went through (‹ ›, ⌘[ ⌘]), on unless false
  deskTiles?: DeskTile[] // the Desk's tiles in order, each one's size and tab (an extension placed there without one: last, DESK_TILE, the first tab)
  deskTabs?: DeskTab[] // My Desk's tabs in order (none: one, My Desk)
  aiGlow?: boolean // Settings › AI: a glow over what Laki AI looks at (a tab's pane, else the window), on unless false
  planTemplates?: PlanTemplate[] // the Specs page's Templates (unset: PLAN_TEMPLATES, shared/plans.ts)
  remoteMail?: string // the one email remote access lets in
  remoteIdleOff?: number | 'never' // T10: hours without a device's call before remote access turns itself off (unset: 12; open to anyone: 2 at most; never: one email or Tailscale only; laki serve's never); the user's alone (REMOTE_KEYS' remote.*)
  pushAtMac?: 'hold' | 'push' // #1: while you're at the Mac (phone.ts atMac): turns' pushes held (unset), or pushed anyway
  pushAfter?: number // #1: a held ask still pushed after these seconds if nobody answered it on the Mac (90)
  pushIdle?: number // #1: at the Mac: unlocked and input in the last these seconds (120)
  remoteWhen?: 'manual' | 'locked' // D9: remote access as you start it (unset), or on its own while the Mac is locked (remote.ts screenLock)
  remoteAwake?: 'ac' | 'always' | 'off' // D8: the Mac awake while remote access runs (core's caffeinate, reason remote): on AC power (unset), also on battery, or never
  remoteAuth?: 'email' | 'pin' | 'tailscale' | 'domain' // how remote access lets you in: email (unset too), Cloudflare's code; pin, Laki's own PIN (no email); both at a quick tunnel's address; tailscale, your tailnet (tailscale serve); domain, My domain (D1: settings.tunnel's named tunnel, a PIN always)
  remoteHost?: string // domain: the word under the named tunnel's domain (unset: laki)
  remoteTries?: number // pin: wrong PINs that stop remote access (unset: REMOTE_TRIES)
  remoteTsPin?: boolean // tailscale: a PIN as well
  remoteFunnel?: boolean // tailscale: tailscale funnel, the internet (a PIN always)
  remotePasskey?: boolean // D6: paired devices unlock with a passkey (Face ID, Touch ID) at a stable address (unset: offered)
  remotePinFallback?: boolean // D6: a locked device may unlock with the PIN instead (unset: yes)
  remoteIdle?: number // D6: minutes without a call before a passkey device locks again (unset: 15; 0: only at each page load)
  remoteHandoff?: boolean // Handoff: remote access's lasting address offered to your nearby Apple devices while Laki is in front (main's handoffNow; off unless true)
  remotePush?: boolean // D4: remote access's link (and its start, a new address, a stop on its own, a new device) to the phone webhook; off unless true, never with anyone-with-the-link
  remoteLevel?: 'answer' | 'full' // D7: a remote page's access when it isn't a paired device's (a quick tunnel's tab), and what a new device starts with; unset: full
  remoteWrong?: 'wait' | 'stop' // D5: after the wrong PINs, no PIN taken for a while (wait, unset too) or remote access stops
  remoteDeviceDays?: number // D3: how long a paired device stays in (1-90 days; unset: 30)
  timers?: boolean // how long each turn has been going, on its tab and row (unset: off)
  projectLook?: ProjectLook // the sidebar's project names, over the theme's
  sideLook?: SideLook // the sidebar's lines, rows and button labels, over the theme's
  diffStat?: boolean // each workspace's +/- in the sidebar, scanned every 10 s (unset: off; a race's are always)
  doneCheck?: boolean // Done means checked: projects' checks as agents' turns end (on unless false; each project's steps off until ticked)
  reader?: boolean // Reader view: an agent tab as its chat (chatRead), a Terminal | Reader switch on each (on unless false)
  readerTools?: 'ok' | 'final' // the Reader's tool calls: all (unset), ok: a run whose calls all worked hidden (a failed one's shows), final: only your messages and its last answer of each turn; the run at work shows either way, the hidden ones under "n steps hidden · Show"
  readerScroll?: boolean // the Reader scrolls to the latest as you send (on unless false)
  readerTimes?: boolean // F6: the Reader's small lines of when a message was sent and a turn's end, length and cost (on unless false)
  sendKey?: 'mod' // a chat's box sends with ⌘⏎, ⏎ a new line (unset: ⏎ sends, ⇧⏎ a new line): keys.ts sendIs
  nextStep?: boolean // One next step: first in a workspace's ⋯ menus, ⌘G (on unless false); a row's chip with rowMarks.step
  livePlan?: boolean // the agent's plan, live: its to-do list on its tab and row, a plan it asks you to approve as a card (on unless false)
  radar?: boolean // Collision radar: worktrees whose changes meet another's, or what landed on their base (off unless true; overlapCheck asks for one)
  fullReview?: boolean // the tab bar's Review tab, a workspace's whole diff in three columns (on unless false)
  dimPanes?: boolean // a split's other panes dimmed (unset: on)
  wsTint?: boolean // Extras › Tint with the workspace's color: the open workspace's color in the glass capsules and the selected tab (unset: off; a new install: on)
  aiEndpoint?: { url: string; model: string } // Settings › AI › Your endpoint: an OpenAI-compatible server (ai.ts endpointOk; its key: <data>/ai-endpoint-key); the user's only (AGENT_SETTINGS_NO, REMOTE_KEYS), a policy can lock it
  menuBarClick?: 'menu' | 'inbox' // Settings › General › Menu bar click: the tray's menu, or the Inbox (macOS; unset: menu)
  menus?: 'laki' | 'macos' // Settings › Layout › Menus: a workspace's and a tab's menu drawn by macOS (unset: Laki's)
  termPad?: 'tiny' | 'normal' | 'roomy' // Settings › Terminal › Padding: the space around a terminal's text (unset: normal)
  paneInset?: boolean // Settings › Terminal › Inset panes: each pane a rounded card with a margin (off unless true)
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: off)
  splitNew?: boolean // a new tab opens as a split beside the pane you're on, not a tab of its own (layoutPlace)
  closeNoAsk?: boolean // closing a tab whose process still runs doesn't ask first (unset: it asks)
  pageZoom?: number // Settings and Help's size (0.9–1.5, renderer's PAGE_ZOOMS; unset: 1)
  storageDir?: string // where workspaces' storage folders go (unset: <data>/storage; ~ is home)
  keepStorage?: boolean // C5: a deleted workspace's storage folder kept in <storage>/.kept (unset: kept; false: removed with it)
  storageDays?: number // a file in a workspace's storage folder not changed for this many days goes (unset: STORAGE_DAYS; 0: never)
  tmExclude?: boolean // Settings › General: new and restored worktrees out of Time Machine (tmutil addexclusion; daemon/backup.ts); a new Mac install's on
  spotlightExclude?: boolean // and the folder of Laki's worktrees out of Spotlight (.metadata_never_index, only where the folder is Laki's own)
  worktrees?: string // where new worktrees go: <it>/<project>/<workspace> (unset: <data>/worktrees; a project's own folder wins)
  syncBase?: '' | 'origin' | 'ff' // a new worktree's base fetched from origin first: origin, start off origin's copy (your branch untouched); ff, your branch fast-forwarded to it when it can be, else origin's (unset or '': off, the local branch as it is)
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  density?: 'compact' | 'regular' | 'roomy' // Appearance's Density: space and control heights (renderer's themes.ts, styles.css --density); unset: regular
  pointerHand?: boolean // Appearance's Pointing hand over buttons (--cur-act); unset: on
  finishedRows?: boolean // Needs you: a finished turn as a compact row (Needs.tsx), on unless false
  projectBadges?: boolean // #5: a project with no icon of its own shows its repo's picture or two letters (ui.tsx ProjectMark); false: the plain mark
  toolbar?: string[] | null // the tab bar's buttons shown, in order (renderer's toolbar.ts ids; unset: its default); ⋯ and Run always
  toolbarSeen?: string[] | null // every id there was as it was set: one new since shows at its default place
  iconPack?: string // Appearance's Icons (icons.ts lookOf, ICON_PACKS): tabler (unset), lucide or laki; iconWidth: its stroke as at a 24 grid (ICON_WIDTHS, unset: 2, each pack's own); iconSize: the app's icons (ICON_SIZES, unset: 14)
  iconWidth?: number
  iconSize?: number
  highContrast?: boolean // Appearance's High contrast mode (themes.ts' Paint): hints, labels and lines most of the way to the text, the accent as text at 7:1 (off unless true)
  motion?: 'high' | 'low' | 'none' // Appearance's Animations (themes.ts' Paint, html[data-motion]): more of them, the usual (unset), or none
  backdrop?: 'stars' | 'dust' | 'dots' | 'net' | 'grid' | 'fireflies' | 'none' // Appearance's Empty page background (Backdrop.tsx): behind an empty pane and the New workspace page (unset: stars)
  diffLook?: 'quiet' // Appearance's Diff style (themes.ts' Paint, html[data-diff]): Quiet, the code's own color on a light tint with a bar at the edge (unset: Filled)
  vertText?: 'down' | 'up' // Appearance's Vertical text (themes.ts' Paint, --vt): every sideways label read top to bottom or bottom to top (unset: each its own)
  prPrompts?: Partial<Record<FixWhat, string>> // over PR_PROMPTS (unset or blank: the default)
  prScan?: number // minutes between PR checks (unset: PR_SCAN)
  prQuiet?: number // minutes between a quiet PR's checks: merged yet, a review, a new check (unset: PR_QUIET; never under prScan's)
  bgRefresh?: boolean // PR checks on their own (each prScan minutes, a turn's end); off: only Refresh PR status (unset: on)
  keepAwake?: boolean // the Mac doesn't sleep while an agent works or waits for you (core's keepAwake: caffeinate -i; unset: off)
  turnsKept?: number // F1: how many turns' snapshots a workspace keeps on disk (unset: 50; 0: none; at most 500), 14 days at most
  turnChanges?: boolean // each claude or codex turn's changes, from a snapshot of the worktree as it starts and ends (turns.ts; unset: on)
  nextPrompt?: boolean // as a claude or codex turn ends, Laki AI's model guesses your next message: the Reader's box shows it greyed out, Tab takes it (turns.ts; a request per turn; unset: off)
  whenDone?: WhenDone // once every agent, workflow run and scheduled task that was going is done: the Mac sleeps, locks or shuts down after WHEN_DONE_WAIT (core's whenDone; then off again; unset: off)
  copyIgnored?: boolean // a new worktree gets every file git ignores from the main checkout, not only .worktreeinclude's (unset: off)
  copyUntracked?: boolean // and the untracked ones (unset: off)
  cloneDeps?: boolean // F7: and the dependency folders at the repo's root (core.ts CLONE_DIRS), each cloned whole (unset: off)
  ptyHost?: boolean // R6: terminals live in a pty host and outlive the daemon (a new install's on; one from before off, asked once: ptyHostAsked)
  termShell?: string // Settings › Terminal › Shell: the full path of what shell tabs start (shared/shells.ts; unset: the login shell); the user's alone, refused to agents and remote access
  ptyHostAsked?: boolean // R9: the one notice for an install from before was answered. Never an agent's or a phone's
  spareWorktree?: boolean // F7: a spare worktree per project, ready for the next new workspace (unset: off)
  archivedDays?: number // archived workspaces deleted after this many days, their branch kept (unset or 0: never)
  prTries?: number // fix CI's and fix conflicts' tries in a row (unset: PR_TRIES)
  prBots?: string[] // review bots whose threads the review switch sends (unset: PR_BOTS)
  browserBudget?: number // MB hidden Browsers pages may hold before the oldest is unloaded (unset, 0: never): Settings › Resources
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (unset: SLEEP_AFTER; 0: always)
  webhook?: Webhook // pushes to your phone
  inHooks?: InHook[] // Settings › Webhooks: the hooks a POST from outside starts workflows by (inbound.ts; their secrets in <data>/hooks)
  continueOnError?: boolean // a turn ended on an API error is continued by itself, once, after a minute (unset: off)
  longTurn?: number // minutes: a turn working that long notifies, once (unset, 0: off)
  costWarn?: CostWarn // #3: a workspace's agents past yellow or red dollars: its cost colored, told once each (unset: off)
  backupEvery?: 'off' | 'weekly' // #B2: a backup into backupDir each week (dataBackup.ts backupTick; unset: off, offered once after your first)
  backupDir?: string // its folder (~ is home); BACKUP_DIR when you turn it on without one
  backupOffered?: boolean // the offer after the first backup made (once)
  mcp?: McpServer[] // #6: MCP servers for every project's agents (shared/mcp.ts), a project's own added to them
  archiveMerged?: boolean // a workspace whose PR merged is archived when clean, with Undo (unset: off)
  archiveIdle?: number // days: a worktree nobody touched for so long is archived when it loses nothing, with Undo (unset, 0: off)
  archiveIdleKeepPR?: boolean // archiveIdle leaves one with an open PR alone (unset: on)
  menuBar?: boolean // the menu bar's item: the needs-you count and those tabs (unset: on)
  trayState?: boolean // Q8: its picture shows idle, working, waiting or blocked (unset: on; off: the filled mark always)
  floater?: boolean // the floating bubbles over other apps: agents working or waiting (unset: on)
  floaterStyle?: 'glow' | 'gradient' | 'arc' | 'bricks' | 'comet' | 'wave' | 'still' // how a working agent's bubble looks (unset: gradient)
  floaterRecent?: number // the bubbles' agents used last, idle or done, after the ones at work: 0-5 (unset: 3)
  floaterRecentHours?: number // a recent one drops out after this many hours idle; 0: never (unset: 4)
  floaterVoiceTo?: 'pick' | 'new' // the voice prompt goes to: an agent you pick each time, or always a new session (unset: pick)
  floaterMax?: number // the bubbles at most (unset: 12)
  floaterCards?: boolean // a bubble's card on hover (unset: on)
  hideFloats?: boolean // 10c: the floating windows kept out of screen recording and screenshots (on only if true: a new install's, NEW_DEFAULTS; Recording mode does it too)
  floaterDone?: boolean // a finished agent you haven't seen: a green, pulsing bubble until a click or a look (unset: on)
  islandOn?: 'main' | 'pointer' // the island's screen: the built-in one (unset), the main one, or the one the pointer is on (shared/island.ts islandDisplay)
  floaterAt?: 'edge' | 'notch' // where the bubbles go: the screen's edge (unset), or an island at the top, in the notch or under the menu bar, that opens into a card when an agent asks or finishes
  floaterNew?: boolean // the bubbles' +: New task, Say it, Screenshot area, Whole screen (unset: on)
  floaterMenu?: 'stack' | 'card' // the +'s actions: stacked in the drop over it, or a menu beside it (unset: stack)
  dockIcon?: string // the Dock's icon while Laki runs: laki, dawn, terminal, glacier, bubbles, neon (unset: the app's own, laki)
  fun?: boolean // the sidebar foot's smiley (Meme): a meme for a break (unset: on)
  videoButton?: boolean // the foot's YouTube button (unset: on)
  timerButton?: boolean // the foot's timers button (unset: on)
  statusBar?: boolean // the status bar (unset: on; off: none, its foot buttons at the sidebar's foot)
  widgetDirs?: string[] // folders of widgets (or a widget's own), besides <data>/widgets (daemon/widgets.ts)
  widgetDev?: string[] // laki widget dev's folders: your own code, scanned first and watched
  widgetDevAgent?: string[] // of those, the ones an agent linked (N10): trusted as a repo's extensions; only widgetDev writes it
  railLabels?: boolean // the rail layout's words under its icons; off: icons only, a narrower rail (unset: on)
  railShells?: boolean // the rail's Terminal button; off: Terminals is a project in Projects' list (unset: on)
  railBrowsers?: boolean // the rail's Browser button; off: Browsers is a project in Projects' list (unset: on)
  railOrder?: string[] // the rail's buttons after Projects, in this order (RAIL_ITEMS' keys; one not in it: after them)
  railHide?: string[] // the rail's buttons put into its ⋯ More menu (Settings › Appearance › Rail, Slack's way)
  railColors?: Record<string, string> // a rail button's color (TAB_COLORS), by its key (data-rail; a pinned spec's plan:<project>/<kind>/<slug>): its right click
  imageDays?: number // pasted images and attached files kept this many days (unset: IMAGE_DAYS)
  artifactsIn?: 'app' | 'browser' // an HTML or Markdown artifact opens in the app's viewer or the default browser (unset: app)
  artifactHosts?: string[] // S18: hosts every report's page may load from beyond the CDNs (the viewer's Always allow)
  memory?: Memory[] // Settings › Global memory: the user's own rules (MEMORY_MAX, never auto) for claude and codex in every project, with its memory
  memoryCompact?: { on?: boolean; days?: number } // on (unless false; it sends them to Laki AI's model): agents' learned memories compacted by Laki AI every days (unset: COMPACT_DAYS) and as they reach MEMORY_MAX; else only Compact now
  workHours?: { days: number[]; from: string; to: string } // W9: your working days (0 Sun … 6) and hours (HH:MM), a wait block's hours: work|off (unset: weekdays 09:00–18:00)
  flowVars?: Record<string, string> // workflows' global variables, {{vars.NAME}} in every one (a workflow's own var lines win)
  sideStyle?: SideStyle // the sidebar's rows: a line, the marks, a second line, cards with the agent's last answer (unset: default)
  design?: Design // the window's frame: cards, tiles, sections… (unset: classic)
  progress?: boolean // LAKI_PROGRESS=1 in agents' env: with the laki skill, they report how far along their task is (unset: off)
  progressAt?: 'tab' | 'sidebar' | 'both' // where that percent shows (unset: tab)
  progressLook?: 'pct' | 'bar' | 'both' // in the sidebar: the percent, a filling line, or both (unset: pct)
  railPlans?: PlanPin[] // specs and brainstorms pinned to the rail (RAIL_PINS at most), oldest first
  keys?: Record<string, string> // Settings › Keys: App's own actions' keys over shared/keys.ts' KEYS ({ id: keys } as keyLabel writes them; '': none)
  cmdKeys?: Record<string, string> // Settings › Keys: ⌘K commands' keys, by shared/keys.ts COMMANDS' ids
  pickerKey?: string // development mode's element picker: its hotkey as ui.tsx' keyLabel writes it (unset: PICKER_KEY; '': none)
  hotkeyOn?: boolean // the global hotkey: Laki forward from any app (main's globalShortcut; unset: on)
  hotkey?: string // its keys as keyLabel writes them (unset: ui.tsx HOTKEY; '': none)
  shotAsk?: boolean // Screenshot to Laki AI: a global hotkey and a menu bar item, a part of the screen to the AI window with the mic on (on unless false; needs Laki AI)
  shotKey?: string // its keys (unset: ui.tsx SHOT_KEY; '': none, the menu bar's item only)
  quickOn?: boolean // Q1: the quick bar's global hotkey (unset: off)
  quickKey?: string // its keys (unset: ui.tsx QUICK_KEY)
  allowOn?: boolean // Allow the newest ask from any app (a global hotkey; unset: off)
  allowKey?: string // its keys (unset: keys.ts ANSWER_KEYS.allow.key)
  denyOn?: boolean // Deny the newest ask from any app (unset: off)
  denyKey?: string // its keys (unset: ANSWER_KEYS.deny.key)
  tellOn?: boolean // Q7: show and tell's global hotkey (unset: off)
  tellKey?: string // its keys (unset: ui.tsx TELL_KEY)
  talkOn?: boolean // Q2: the talk key, from any app (unset: off; the cloud engine only)
  talkTo?: 'ai' // Q10: the talk key goes to Laki AI (unset: an agent, Q2's)
  talkKey?: string // its keys (unset: ui.tsx TALK_KEY)
  updateCheck?: boolean // the app asks GitHub for its newest release at launch, then daily (main's update.ts; on unless false)
  tgAi?: TgAi // Settings › AI › From Telegram: Laki AI's backend for the chat (tgBackend); mac: the Mac's own, full access (typed confirm)
  talkCards?: boolean // Settings › Voice › Answer cards: the talk key answers the newest ask card on screen (talk.ts cardPick; on only if true; AGENT_SETTINGS_NO, REMOTE_KEYS)
  recording?: boolean // Recording mode: private workspaces and projects out of every window's view (veiled), the phone's pushes too; they keep running
  background?: { file?: string; dim?: number; blur?: number } // Settings › Appearance › Background image: <data>/background/<file> (core's bgSet), how much the theme covers it (%) and its blur (px)
  modelEfforts?: Record<string, string> // the new-workspace page's effort last picked per model, by `<agent>:<model>` ('' the default model; '' effort: the model's own)
  updateDelay?: number // a release is offered once it's this many days old (shared/update.ts UPDATE_DELAYS; unset or 0: at once)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs, Settings › Widgets), in the daemon's memory (unset: off)
  widgetAgent?: string // Settings › Extensions' agent: the claude or codex preset an AI source runs (unset: the first claude one)
  widgetLogs?: boolean // Settings › Extensions' Keep logs for every extension (widgetLogs.ts; unset: only those with their own Keep a log)
  widgetHours?: string // when widgets fetch on their own, in English (when.ts parseHours: 9am-9pm weekdays; unset: always)
  ai?: AiSettings // Laki's own AI (Settings › AI, the AI page)
  voice?: VoiceSettings // Settings › Voice: how the mic and hold Fn turn speech into text
  achievements?: AchievementsKept // Settings › Achievements, the status bar's trophy (renderer's achievements.ts)
  contextMeter?: boolean | 'line' | 'ring' | 'status' // Settings › Appearance: how full a claude or codex tab's context is, in the status bar and on its tab as a line (unset, true) or a ring, or not there (status); false: none
  costs?: boolean // Settings › Appearance: what each claude and codex tab used, tokens and ≈ API price, and today's in the plan limits' popup (unset: on)
  loginAsked?: boolean // the one notice that offers Start Laki at login (a scheduled task on, the login item off) was answered (App.tsx)
  statusBridge?: boolean // Settings › Appearance: claude's status line JSON kept per tab (meters.ts), its context and plan limits over the guesses; your own status line still runs (unset: on)
}

// what you did (got: an achievement's id, when), the ones you hid, off: none shown, none earned. Settings' page never
// saves it (App strips it): an unlock while it's open would be lost
export type AchievementsKept = { got?: Record<string, number>; hidden?: string[]; off?: boolean }
// Settings › General › Pages: Specs & Brainstorms and Workflows, on unless turned off
export const specsOn = (s?: { specs?: boolean }) => s?.specs !== false
// Labs: what a new install starts without (each a setting of its own, on unless false): the pages beyond Projects, Board,
// Schedule, AI and Settings, the rail's Terminal and Browser, the foot's Video, Meme and Timer
export const LABS = ['desk', 'specs', 'workflows', 'calendar', 'notes', 'todoList', 'railShells', 'railBrowsers', 'videoButton', 'fun', 'timerButton'] as const
export const flowsOn = (s?: { workflows?: boolean }) => s?.workflows !== false

// Settings › Voice: engine device, macOS dictation (the mic starts it; Fn Fn is macOS's own); cloud, Laki records and
// OpenRouter's speech-to-text (daemon/ai.ts voiceText, the AI key) writes it down. model: an OpenRouter speech-to-text
// model's id (unset: VOICE_MODEL). fn: cloud only, hold Fn to talk anywhere in Laki, let go to insert (unset: on)
// on: experimental (Settings › General), off unless true: the mic is macOS dictation, no Voice section, no hold Fn
export type VoiceSettings = { speakOn?: 'always' | 'headphones' /* #H1: Out loud only on headphones (shared/speak.ts personalOutput; unset: always) */; vocab?: boolean /* #V1: the project's own words in the transcript (shared/vocab.ts; unset: on) */; answers?: boolean /* the talk key answers a waiting ask with a spoken yes or no (unset: on) */; speak?: 'off' | 'short' /* Laki AI's answer to a talk-key question read out (shared/speak.ts; unset: off) */; speakAsks?: boolean /* an agent's ask read out (spokenNote; on only if true) */; speakDone?: boolean /* a finished turn read out (on only if true) */; selection?: boolean /* Q11: the talk key carries the selected text (on only if true) */; talkEngine?: 'mac' /* the talk key's: On this Mac (Laki Speech, on device); unset: Cloud */; locale?: string /* its language (unset: en-US) */; on?: boolean; engine?: 'device' | 'cloud'; model?: string; fn?: boolean; send?: boolean; fixes?: string; fillers?: boolean; route?: boolean; routeNote?: boolean /* Q5b: "Note: …" said first goes to the note named Voice (unset: on) */; routeTodo?: boolean /* "To-do: …" to a project's Backlog (unset: on) */; aiWord?: string; lock?: boolean; history?: boolean; silence?: number } // silence: Stop after silence, seconds (talk.ts SILENCES; unset: off). // lock: Q6's Lock by double tap (unset: on); history: Keep the last transcripts (unset: on); route: Q5's Route by first words (the bubbles' Say it, the talk pill; unset: on); aiWord: the word for Laki AI there (unset: Laki); send: Send as you stop talking (cloud, off unless true: voice.ts); fixes: Word fixes, a line each (voiceFix); fillers: Remove filler words (voiceFillers, unset: on)
// Settings › Voice's Word fixes on a cloud transcript: a line each, `heard → meant` (or -> or =; heard may be several
// words, or several forms with commas: `lucky, lakey → Laki`), each heard form as a whole word in any case, the
// longest first. What changed comes back for the bar to say. ponytail: VOICE_FIXES lines at most; no fuzzy matching
export const VOICE_FIXES = 200
export function voiceFix(text: string, fixes?: string): { text: string; fixed: string[] } {
  const rules = String(fixes ?? '')
    .split('\n')
    .slice(0, VOICE_FIXES)
    .flatMap(l => (m => (m ? m[1].split(',').map(h => [h.trim().replace(/\s+/g, ' '), m[2].trim()] as const) : []))(/^(.+?)\s*(?:→|->|=)\s*(.+)$/.exec(l.trim())))
    .filter(([h, m]) => h && m && h.length <= 100 && m.length <= 100)
    .sort((a, b) => b[0].length - a[0].length)
  if (!rules.length) return { text, fixed: [] }
  const fixed = new Set<string>()
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${rules.map(([h]) => `(${esc(h)})`).join('|')})(?![\\p{L}\\p{N}])`, 'giu') // a group per rule: the one that matched says which
  const out = text.replace(re, (w, ...g) => {
    const meant = rules[g.findIndex(x => x !== undefined)][1]
    if (w !== meant) fixed.add(`${w} → ${meant}`)
    return meant
  })
  return { text: out, fixed: [...fixed] }
}
// Settings › Voice's Remove filler words: standalone hesitations go, with the comma or space they leave, the sentence's
// capital moving to the next word. Some are words elsewhere, so: um only among English words (Portuguese's "um carro"),
// er only set off by a comma too (German's "er ist", Dutch's "er is"), ну and 嗯 only followed by punctuation ("ну и что").
// its lead: spaces only from their run's start ((?<!\s)), a comma's only after one: \s*[,]?\s* tried every split of a
// long run from each of its spaces (2,000 spaces: 3 s of the daemon's loop)
const FILLER = /((?<!\s)\s+(?:[,，、]\s*)?|[,，、]\s*|)((?<![\p{L}\p{N}'’-])(?:um+|uh+|er|hm+|ähm*|euh+|э{2,}|ну)(?![\p{L}\p{N}'’-])|えーと|ええと|えっと|嗯)(\s*[,，、]|\s*[.…。！？!?]+(?=\s|$))?(\s*)/giu
const ENGLISH = /\b(the|and|is|are|we|it|this|that|to|of|should|think|can|you|yes|okay|please|just|let|let's)\b/i
export function voiceFillers(text: string): { text: string; n: number } {
  const en = ENGLISH.test(text)
  let out = ''
  let at = 0
  let n = 0
  let up = false // a capital to hand on
  const copy = (end: number) => {
    let chunk = text.slice(at, end)
    if (up && chunk) (chunk = chunk.replace(/^(\s*)(\p{Ll})/u, (_, s, c) => s + c.toUpperCase())), (up = false)
    out += chunk
  }
  for (const m of text.matchAll(FILLER)) {
    const [all, lead, word, trail = ''] = m
    const low = word.toLowerCase()
    const comma = /[,，、]/.test(lead + trail)
    if (word.length > 1 && word === word.toUpperCase() && word !== low) continue // ER, UM: abbreviations
    if ((/^um+$/.test(low) && !en) || (low === 'er' && !(en && comma)) || ((low === 'ну' || low === '嗯') && !trail)) continue
    copy(m.index)
    at = m.index + all.length
    n++
    const before = out.trimEnd()
    const rest = text.slice(at)
    const wide = /[，、]/.test(lead + trail)
    const ended = !before || /[.!?…。！？\n]$/.test(before) || lead.includes('\n')
    if (ended) (out += lead), (up ||= /^\p{Lu}/u.test(word))
    else if (trail && !/[,，、]/.test(trail)) out = before + trail.trim() + m[4]
    else if (!rest) out = before
    else if (wide) out = before + (lead || trail).trim()
    else if (lead.includes(',') && !trail.includes(',')) out = before + lead
    else out = `${before} `
  }
  if (!n) return { text, n: 0 }
  copy(text.length)
  return { text: out.trim(), n }
}
export const VOICE_MODEL = 'microsoft/mai-transcribe-2'
// Q11: a speech-to-text model's price, from OpenRouter's pricing: by the second of audio, said an hour's; by the token
// (GPT-4o Transcribe, Gemini), $ per million in / out. ponytail: OpenRouter gives most per second but Microsoft's MAI
// per hour ($0.10, $0.36): over a cent a second ($36 an hour) is taken as an hour's. Nothing usable: undefined
export function voicePrice(p?: { prompt?: unknown; completion?: unknown }): string | undefined {
  const a = Number(p?.prompt)
  const b = Number(p?.completion ?? 0)
  if (p?.prompt == null || p.prompt === '' || !Number.isFinite(a) || a < 0 || !Number.isFinite(b) || b < 0) return undefined
  const usd = (x: number) => (n => `$${n >= 0.1 ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(Number(n.toPrecision(2)))}`)(Math.round(x * 1e6) / 1e6)
  if (b > 0) return `${usd(a * 1e6)} / ${usd(b * 1e6)} per M tokens`
  return a === 0 ? 'free' : `${usd(a > 0.01 ? a : a * 3600)}/h`
}
export type VoiceModel = { id: string; name: string; price: string }
export const voiceOn = (s?: { voice?: VoiceSettings }) => s?.voice?.on !== false // Settings › Voice: on unless turned off

// Laki's own AI (daemon/ai.ts): on unless turned off, it works Laki through the MCP server's tools, only when asked. backend:
// OpenRouter (its key in <data>/ai-key, never here) or a CLI agent in the background (claude -p, codex exec); models:
// each backend's (unset: AI_MODEL for OpenRouter, the agent's own for the others); steps: tool calls an ask may make
// Settings › AI › Your endpoint's URL, checked (core's settingsSet, ai.ts): https anywhere, http only on this Mac, no user
// or password, no ? or #; without its trailing /
export function endpointOk(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : ''
  if (!URL.canParse(s)) throw new Error('Your endpoint: a URL, as https://host/v1')
  const url = new URL(s)
  if (url.username || url.password) throw new Error('Your endpoint: no user or password in the URL (its key has a field of its own)')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Your endpoint: https, or http on this Mac only (localhost, 127.0.0.1, [::1])')
  if (url.search || url.hash) throw new Error('Your endpoint: no ? or # in the URL')
  return url.href.replace(/\/+$/, '')
}
export type AiBackend = 'openrouter' | 'claude' | 'codex' | 'endpoint' // endpoint: Settings › AI › Your endpoint (settings.aiEndpoint)
// preset: an agent preset of the backend's agent (claude, codex), its env for an account of its own
// skill: Laki's skill for it (unset: on): more tools (PRs, projects' notes and memory, tabs and shells, actions, templates) and
// asking you with options; hideCost: no $ on the AI page
export type AiSettings = { show?: boolean; on?: boolean; backend?: AiBackend; preset?: string; models?: Partial<Record<AiBackend, string>>; efforts?: Partial<Record<'claude' | 'codex', string>>; steps?: number; skill?: boolean; hideCost?: boolean; context?: string; float?: boolean; alerts?: boolean } // alerts: it may send laki_alert on its own (off: only when you ask in the chat or Your instructions name alerts: ai.ts aiMayAlert); efforts: claude -p's --effort, codex's model_reasoning_effort (EFFORTS; unset: theirs); context: the user's own instructions, after the system prompt; float: the chat button in the corner (unset: on)
export const AI_MODEL = 'anthropic/claude-sonnet-5.5'
export const aiOn = (s?: { ai?: AiSettings }) => s?.ai?.on !== false // Settings › AI: on unless turned off
// Settings › AI › From Telegram (settings.tgAi): Laki AI's backend for an ask from the Telegram chat. Unset: the Mac's
// when it's OpenRouter or Your endpoint (their tools go through the chat's gate), none with claude or codex (their Read
// and laki mcp act as you). mac: the Mac's own whatever it is, full access, turned on by a typed confirm (the user's:
// AGENT_SETTINGS_NO, REMOTE_KEYS). Pure: test/units-more.test.ts
export type TgAi = 'openrouter' | 'endpoint' | 'mac'
export function tgBackend(s?: { ai?: AiSettings; tgAi?: TgAi }): AiBackend | undefined {
  const mac = s?.ai?.backend ?? 'openrouter'
  if (s?.tgAi === 'mac') return mac
  if (s?.tgAi === 'openrouter' || s?.tgAi === 'endpoint') return s.tgAi
  return mac === 'claude' || mac === 'codex' ? undefined : mac
}
// an ask's command in plain words (the daemon's askExplain, the ? on an ask's card): what it does, a sentence; outside:
// it reaches past the workspace's folder or the network; undo: whether what it changes can be put back
export type AskExplained = { does: string; outside: boolean; undo: 'yes' | 'no' | 'partly'; cut?: true } // cut: the model read only the command's start (past 2,000 characters), so undo is never yes
export const AI_STEPS = 20
export const AI_CONTEXT_MAX = 8000 // Your instructions' characters
// the AI page's conversation: what you asked (images: their paths), its answers, each tool it ran, a failure
export type AiMsg = { role: 'user' | 'ai' | 'tool' | 'error'; text: string; at: number; images?: string[]; ask?: AiAsk }
// a question Laki AI asked (laki_ask, or before a removal): its options as buttons, picked: the answer given. act: what a
// Yes removes: only the user's click does it (the daemon's aiAnswer), never the AI itself. perm: its agent asks to use a
// tool (claude's permission prompt, ai.ts' aiPermission), answered while it works: AI_PERM's options
export type AiAsk = { id: string; options: string[]; looks?: (AiLook | null)[]; picked?: string; act?: AiAct; perm?: boolean } // looks: each option drawn as it would look (an extension's chat)
// an option's look: a UI kit element over its own data (size: cells across × down; none: as a full view)
export type AiLook = { ui: Record<string, unknown>; data?: unknown; size?: [number, number] }
export const AI_PERM = ['Allow once', 'Always in this chat', 'Deny'] as const
export const AI_ACTS = ['memory', 'schedule', 'tab', 'todo', 'widget', 'run', 'profile', 'archive', 'delete'] as const // widget: turning an extension on; run: a command in a shell (id: its tab; ids: more shells, Q13); profile: agent profiles saved (text: them as JSON); archive, delete: a workspace archived (Q12) or deleted for good (Q13; text: what it would lose, Laki's words), id: its id; the rest a removal
// several in one question (a removal, an archive, a delete of each): a box each on the AI page, the Yes takes the ticked
// ones; note: a workspace's PR and its state; text: what a delete would lose; said: what became of it after the pick
// (done, kept, or why not; … while it's being done)
export type AiItem = { id: string; label: string; note?: string; text?: string; said?: string }
export const AI_ITEMS = 50
export type AiAct = { kind: (typeof AI_ACTS)[number]; id: string; ids?: string[]; items?: AiItem[]; project?: string; label: string; hash?: string; text?: string } // hash: an extension's files as asked about (widgetTrust.ts filesHash): a Yes needs them still; text: run's command, profile's profiles
// one ask's cost, in <data>/ai-calls.jsonl: tokens in and out, USD (OpenRouter's; claude -p's is Claude Code's own
// estimate; codex: none), the tool calls it made (settings' steps: rounds of them)
export type AiCall = { at: number; backend: AiBackend; model: string; in: number; out: number; cachedIn?: number; cost?: number; ms: number; tools: number; ok: boolean; ask: string; error?: string; from?: AiFrom } // cachedIn: of in, the tokens read from the provider's prompt cache (A3); from: what made it
// what made a Laki AI call (the Usage page's Where it went): a chat (the AI page's), a spec's or brainstorm's, an agent's
// laki ai, an extension (its studio's chat, its AI source or action), a workflow's block, memory's compaction, the Done
// check's review, the next prompt guessed, the side chat, Ask me first, an ask explained
export const AI_FROM = { chat: 'Laki AI chats', specs: 'Specs & Brainstorms', agents: "Agents' laki ai", extensions: 'Extensions', workflows: 'Workflows', memory: 'Memory compaction', check: 'Done check reviews', next: 'Next prompt guesses', side: 'Side chats', questions: 'Ask me first', explain: 'Explain an ask' } as const
export type AiFrom = keyof typeof AI_FROM
// a call's from, or by its ask's words (the labels its makers give; a line logged before from). ponytail: an older
// workflow block's call reads as a chat's
export const aiFromOf = (c: Pick<AiCall, 'from' | 'ask'>): AiFrom => c.from ?? (/^extension /.test(c.ask) ? 'extensions' : /^Compact .*memory/.test(c.ask) ? 'memory' : c.ask.startsWith('next prompt: ') ? 'next' : c.ask.startsWith('side chat: ') ? 'side' : c.ask.startsWith('check review: ') ? 'check' : c.ask === 'Ask me first' ? 'questions' : c.ask === 'Explain an ask' ? 'explain' : 'chat')
export type AiTotals = { today: AiSum; month: AiSum }
export type AiSum = { calls: number; in: number; out: number; cost: number }
// today's and this month's calls, on this Mac's clock
export function aiTotals(calls: AiCall[], now = new Date()): AiTotals {
  const sum = (from: number): AiSum =>
    calls.filter(c => c.at >= from).reduce((s, c) => ({ calls: s.calls + 1, in: s.in + (c.in || 0), out: s.out + (c.out || 0), cost: s.cost + (c.cost || 0) }), { calls: 0, in: 0, out: 0, cost: 0 })
  return { today: sum(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()), month: sum(new Date(now.getFullYear(), now.getMonth(), 1).getTime()) }
}

// Settings › Phone pushes: where a waiting (unset: on) or done (unset: off) agent is pushed, in which format
// answer: Answer from the phone (ntfy's and Web Push's buttons; off: the choices as text only); replyTopic: the random
// part of ntfy's reply topic (<topic>-<it>), made as answer turns on
export type Webhook = { url?: string; format?: 'ntfy' | 'slack' | 'json' | 'webpush' /* M4: the paired phones' own notifications, no URL */; waiting?: boolean; done?: boolean; answer?: boolean; replyTopic?: string; answerOff?: boolean; detail?: 'titles' } // detail titles: who needs you only, nothing off the screen (no question, choices or buttons); answerOff: answers turned off as Laki updated (a public ntfy.sh topic), Settings says why

// how the sidebar writes project names (Settings › Appearance); 'theme' (or unset): as the theme does
export type ProjectLook = { font?: 'theme' | 'ui' | 'mono' | (string & {}); /* any other: a font's name */ case?: 'theme' | 'upper' | 'none'; spacing?: string; size?: string; weight?: string; color?: 'auto' | 'theme' | 'accent' | 'own' } // color: the theme's accent as text (unset, auto; accent: an earlier build's), the theme's own ('theme'), or each project's own color; not over a look whose head is a filled band
// the sidebar's lines and rows (Settings › Appearance) as CSS values, 'theme' (or unset): as the theme draws them;
// labels: words beside its bottom buttons (unset: shown)
export type SideStyle = 'compact' | 'default' | 'extended' | 'words' | 'cards' | 'status' // Settings.tsx SIDE_STYLES
export type Design = 'classic' | 'sections' | 'cards' | 'inset' | 'tiles' | 'soft' | 'frosted' // Settings.tsx DESIGNS, styles.css' Design block
// development mode's event log (core.ts devLog): n, how many times a line came again
export type LogLine = { at: number; text: string; n?: number }
export type ScriptRun = { ws: string; name: string; project: string; kind: 'setup' | 'teardown'; cmd: string; at: number; secs: number; code: number | null; text: string } // scriptLogs': a setup's or teardown's run (development mode)
export type SideLook = { font?: string; /* the sidebar's font: a name (unset: the interface's) */ guide?: string; divider?: string; indent?: string; rows?: string; text?: string; icons?: string; head?: string; gap?: string; rowGap?: string; labels?: boolean } // head: a project's row height; gap: between projects; rowGap: between rows

// a task waiting on the board (Board.tsx) for a workspace: a prompt for a project
export type Todo = { id: string; project: string; text: string; at: number; images?: string[] } // images: pasted ones (<data>/images), their paths after the text as it starts
// a follow-up on the calendar (Calendar): a note for a moment, from you, Laki AI or an agent (by), maybe about a
// workspace or a project; it rings once as it's due (fired) while the app is open, done: ticked off
// every: the words of a repeating one (when.ts whenOf: every weekday at 9am); at is then its next time, moved on as it rings
export type Reminder = { id: string; at: number; text: string; made: number; ws?: string; project?: string; by?: string; done?: boolean; fired?: boolean; every?: string; important?: boolean } // important: it rings as a card on screen until closed
export const REMINDERS_MAX = 500 // past it the oldest rung ones go
// a tile on the Desk: an extension's id and its size in the Desk's grid (DESK_COLS across, rows of DESK_ROW px)
// x, y: its cell, columns from the left and rows from the top, 0 first (none: the first spot it fits, deskLayout)
export type DeskTile = { id: string; w: number; h: number; tab?: string; x?: number; y?: number } // tab: a DeskTab's id (none, or one gone: the first tab)
// a tab of the Desk: its tiles apart from the others' (none set: one tab, Desk); icon: one of the app's by name or an emoji, before its name
export type DeskTab = { id: string; name: string; icon?: string; color?: string } // color: TAB_COLORS', its icon in it, else a dot
export const DESK_COLS = 12
export const DESK_ROW = 40
export const DESK_TILE: Omit<DeskTile, 'id'> = { w: 4, h: 6 }
type DeskBox = { x: number; y: number; w: number; h: number }
const overlap = (a: DeskBox, b: DeskBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
// where a tab's tiles go, gaps kept: first, the one being dragged or resized, where it is; then each placed one where it
// is, top to bottom, pushed down past any it overlaps; then the rest (none placed yet: as the grid's flow put them, row
// by row from the last one) in the first spot after it they fit, under the placed ones: a gap you left stays one
export function deskLayout<T extends DeskTile>(tiles: T[], first?: string): (T & DeskBox)[] {
  const done: (T & DeskBox)[] = []
  const free = (b: DeskBox) => !done.some(d => overlap(d, b))
  const placed = (t: T) => t.x !== undefined && t.y !== undefined
  const rest = tiles.filter(t => t.id !== first)
  let [cy, cx] = [0, 0]
  let under = true // the first not placed goes under the placed ones
  for (const t of [...tiles.filter(t => t.id === first), ...rest.filter(placed).sort((a, b) => a.y! - b.y! || a.x! - b.x!), ...rest.filter(t => !placed(t))]) {
    const [w, h] = [Math.min(DESK_COLS, Math.max(1, Math.round(t.w) || 1)), Math.max(1, Math.round(t.h) || 1)]
    let b: DeskBox | undefined
    if (placed(t)) {
      b = { x: Math.min(DESK_COLS - w, Math.max(0, Math.round(t.x!))), y: Math.max(0, Math.round(t.y!)), w, h }
      while (!free(b)) b.y = Math.max(...done.filter(d => overlap(d, b!)).map(d => d.y + d.h))
    } else {
      if (under) (under = false), (cy = Math.max(0, ...done.map(d => d.y + d.h)))
      for (let y = cy; !b; y++) for (let x = y === cy ? cx : 0; !b && x + w <= DESK_COLS; x++) if (free({ x, y, w, h })) b = { x, y, w, h }
      ;[cy, cx] = [b.y, b.x + w]
    }
    done.push({ ...t, ...b })
  }
  return done
}

// remote access (core.ts): who may open it, until when (ms; none: until stopped), and once cloudflared has one, its URL and the link
// with the token
// open: no email (mail ''), anyone with the link; pin: Laki's PIN instead of an email (shown here, typed on the page),
// tries: wrong ones left before it stops
export type RemoteCheck = { ok: boolean; ms: number; at: number; what: string; why?: string } // D8: the self-check's last: what it reached (its public address; through Tailscale, tailscale status) and how long it took
export type Remote = { check?: RemoteCheck; mail: string; level?: 'answer' | 'full'; /* D7: a remote page's own (its view only) */ open?: boolean; pin?: string; tries?: number; used?: boolean; until?: number; url?: string; link?: string; via?: 'tailscale'; funnel?: boolean; peers?: number; host?: string; down?: string; was?: string; locked?: number; wrong?: number; pairUntil?: number; idleOffAt?: number /* T10: when it turns itself off with no device's call meanwhile (settings.remoteIdleOff) */ } // via tailscale: tailscale serve, the tailnet's devices only; funnel: tailscale funnel, the internet (with a PIN); used: the link was opened (it works once); peers: the tailnet's other devices online as it started
// host: My domain's (D1: a hostname of your named tunnel, a PIN always); down: why it's starting again (D2: no url
// meanwhile); was: the address it had before it came back at a new one (a quick tunnel's: a new link)
// state.json's (D2, remote.ts keepRemote): how remote access runs, until when, the page's token's hash once it has one,
// its last address; what remoteBack starts again. Never a token or the PIN
export type SavedRemote = { serve?: boolean /* laki serve's (headless): never turned off for want of a device */; start?: { hours: number; mail?: string; open?: boolean; pin?: boolean; via?: string; funnel?: boolean; host?: string } /* T10: what it was started with: the idle-off notice's Turn on again, after a restart too */; mail: string; open?: boolean; pin?: boolean; via?: 'tailscale'; funnel?: boolean; host?: string; named?: string; until?: number; access?: string; url?: string; e2e?: string } // e2e: S14's link secret (base64), a stable address's only
// locked: no PIN taken until then (D5); wrong: wrong PINs today; pairUntil: Add a device's link ends then (D3)
// a paired device of remote access (D3): the view's (no hash); SavedDevice: state.json's, its token's hash
export type RemoteDevice = { id: string; name: string; addedAt: number; seenAt: number; until: number; notify?: boolean; passkey?: boolean; level?: 'answer' | 'full' } // notify: it takes Web Push notifications (M4); passkey: it unlocks with one (D6); level: D7, answer only or full (unset: full, paired before D7)
export type SavedDevice = Omit<RemoteDevice, 'notify' | 'passkey'> & { hash: string; push?: { endpoint: string; p256dh: string; auth: string }; pk?: { id: string; jwk: Record<string, unknown>; count: number }; regUntil?: number; ek?: string } // push: its Web Push subscription (push.ts WebSub); pk: its passkey (D6: the credential's id, its public key as a JWK, the signature counter); regUntil: a just-paired device may set one up until then
export const REMOTE_TRIES = 2
export const SLEEP_AFTER = 480 // minutes: an idle agent sleeps after 8 hours unless Settings › Resources says otherwise
export const STORAGE_DAYS = 0 // Settings › General › Storage's Delete files after (core.ts storageTidy): never unless you pick a time (0.35 had 90)
export const IMAGE_DAYS = 30 // days a pasted image or an attached file is kept (<data>/images, <data>/files: Laki AI's chats, prompts) unless Settings › AI says otherwise
export const FILE_MAX = 25 << 20 // an attached file's bytes at most (fileSave; PromptInput checks first: past the socket's maxPayload, its connection drops)
// an earlier chat of the AI page's (New chat keeps the one it ends): its file's name, its first ask, its last message, its messages
export type AiPast = { id: string; title: string; at: number; n: number }
// an extension studio's chat (widget:<id>): its first ask, its last message's time, whether Laki AI works on it now
export type StudioChat = { id: string; title: string; at: number; busy: boolean }

// a plan's limit (daemon/usage.ts): used %, when it resets (ms); note: what the % is of, for an amount (extra usage)
export type UsageWindow = { label: string; used: number; resets?: number; note?: string }
// an agent's limits; error: why there are none (signed out…); at: when they were read
// account: whose (an Account's id or HOME_ACCOUNT), name to tell them apart, default: the one new sessions use
export type AgentUsage = { agent: string; plan?: string; windows: UsageWindow[]; error?: string; at: number; next?: number; account?: string; name?: string; default?: boolean; source?: 'own' | 'endpoint' | 'quota' } // agent 'quota', source 'quota': a quota source's account (usage.ts quotaUsage), name its source's and its own // source (R4): the agent's own numbers (its status line, its transcript) or its usage endpoint's // at: when its numbers were read; next: told to wait, asked again then (its numbers the last ones, from at)
// Usage's OpenRouter part (ai.ts aiCredits): the account's credits (total bought, used), the key's spend (today, this
// week, this month, in dollars) and its own limit; low: under $1 or 10% left of either; error: neither was answered
export type AiCredits = { at: number; credits?: { total: number; used: number }; key?: { day: number; week: number; month: number; limit?: number; left?: number }; low?: boolean; error?: string }

// a scheduled task: at the times `when` says (rule: what it said when saved, shared/when.ts), its prompt goes to an
// agent (a preset's name): in a new workspace each time (ws 'new': a worktree), in the project's own folder (ws 'local':
// no worktree, one session; 'local-new': a new session, a sidebar row, each run), 'same' (the worktree its first run
// makes, sameWs: the daemon's, every run after there), or in that workspace (its running agent of the preset, queued
// while it works; else a new tab; fresh: always a new tab, where a workspace is shared). next:
// when it runs (none: off, or a once that ran)
export type Schedule = { id: string; name?: string; project: string; preset: string; ws: string; sameWs?: string; fresh?: boolean; prompt: string; when: string; rule: Rule; on: boolean; next?: number; last?: number; workflow?: string; source?: 'yours' | 'project'; widget?: string; action?: string; base?: string; noSetup?: boolean; group?: string; archived?: number; notify?: TaskNotify; missed?: 'skip' | 'catchup'; catchUntil?: number; catchup?: { due: number; until: number }; onlyIf?: OnlyIf; lastHead?: string; trigger?: TaskTrigger; seen?: string[]; marks?: TaskMarks; keep?: number; emptyGone?: boolean; kept?: number; fails?: number; pausedWhy?: string; pausedField?: string; again?: { at: number; why: string; event?: TaskEventIn }; maxMinutes?: number; queued?: number; after?: TaskAfter; afterRun?: string } /* after (T9): it runs as another task's run ends instead of at times or on an event (when '', no next), afterRun: the run of that task that started it last (once per run; ws 'parent' goes into its workspace); maxMinutes (T8): a run's time limit, its agent's working time (unset: settings.scheduleMaxMinutes, 60; 0: none); queued: the due time of a run waiting for a place (settings.scheduleAtOnce); trigger (T4): on an event instead of times (when '', no next), seen: the last events' ids it heard, marks: what its project's last poll saw (the first only notes it); keep (T5): its run workspaces kept (unset: 5; 0: all), emptyGone: one that did nothing archived as it ends (unset: on), kept: older ones its last tidy left (they have work); fails (T6): failed runs in a row, at 3 it's off (pausedWhy, pausedField: what to fix: base, ws, preset, widget, workflow), again: a run waiting to try again (a transient failure's, 5 minutes on) or to start (a plan limit's reset); notify (T1): Tell me, never | needs (unset: when it needs you or fails) | always; missed, catchUntil (T2): a run the Mac slept through, skipped or run once it wakes (unset: catchup for rules of at most 2 times a day), until then (minutes after midnight; unset: its next time); catchup: the daemon's, one waiting to run; onlyIf (T3): it runs only when that says so; lastHead: the base's head at the last run that started an agent (onlyIf commits) */ // archived: when it was archived (scheduleSet archived): off the list and never run until restored; group: the page's collapsible head it's under (none: no group); workflow: a run of that workflow (Workflows on) instead of a prompt, prompt its task; widget: an extension fetched (action: one of its actions run instead, prompt its argument), on ones only; base: a new workspace's base branch (ws new only; none: the project's checkout, as wsNew's); noSetup: its worktree without the project's setup script (ws new only, wsNew's noSetup)
// one run of a task, for the log: what happened (a new workspace, sent, queued, why it failed or was missed)
export type ScheduleRun = { id: string; schedule: string; project?: string; name: string; at: number; ok: boolean; what: string; ws?: string; tab?: string; flow?: string; skipped?: boolean; asked?: boolean; event?: string; held?: TaskEventIn; retry?: number; state?: RunState; endedAt?: number; said?: string; pr?: { number: number; url: string }; reply?: number; cost?: number; tokens?: number; diff?: { add: number; del: number; files: number }; spent?: number; clock?: number; after?: string } // reply: the issue or PR a comment's run answers on as its turn ends (its task's reply on), cleared once posted; after (T9): the run of the task it waits on that started it; spent, clock (T8): its agent's working time so far (waiting for you not counted), sampled at clock; flow: a workflow's run's id; skipped (T3): its condition said no; asked: Run now's; event (T4): what started it, held: a fork's, waiting for your click (scheduleRelease); retry (T6): when it tries again or starts (a plan limit's reset); state… (T1): how it ended, filled as its tab's turns end (its first day): its agent's last answer's first line, its workspace's PR, the chat's tokens and cost, its diff
export type RunState = 'running' | 'done' | 'waiting' | 'failed' | 'stopped'
// T4: what a task can start on: CI failing on a branch, a PR opened, a PR's review, an issue opened, a push to a branch;
// branch (unset: the repo's main), label (issues), by (whose: others, me, any; unset any); gap: minutes between its runs
// (unset 30), perDay: runs a day at most (unset 10)
// a spend cap (cap.ts): dollars of its priced chats, tokens of its unpriced ones; either, both, or none ({})
export type Cap = { usd?: number; tokens?: number }
// cap: the one that holds (its own, its profile's, its project's); usd, tokens: what its tabs' meters say; measured: none of
// its agents is priced or counts tokens (a command profile): the cap shows not measured
export type CapView = { cap: Cap; usd?: number; tokens?: number; measured: boolean; share?: number; unpriced?: string[] /* models its agents used with no price: their tokens are in neither */ }
// #3: a workspace's cost warning (cap.ts costTick): past yellow its cost turns yellow, past red red, each told once;
// Settings' (on: off unless true) or a project's own amounts. COST_WARN: what Settings fills in
// #5: a task an agent suggested (laki suggest): its title, why, the prompt for a workspace of its own; tab: the agent's;
// answered: yours (started: ws, the workspace it made), kept so the agent can't withdraw or suggest it again
export type Suggestion = { id: string; title: string; why?: string; prompt: string; tab?: string; at: number; answered?: 'started' | 'dismissed'; ws?: string }
export type CostWarn = { on?: boolean; yellow?: number; red?: number }
export const COST_WARN = { yellow: 5, red: 20 }
export type CostLevel = 'yellow' | 'red'
// its cost and the amounts, in words (the status bar's and the sidebar's tooltips)
export const costWords = (c: { usd: number; level?: CostLevel; warn?: CostWarn }) =>
  `Its agents' chats: $${c.usd.toFixed(2)} at API prices${c.level ? `, past your ${c.level} amount` : ''}${c.warn ? ` · yellow at ${c.warn.yellow ? `$${c.warn.yellow}` : 'none'}, red at ${c.warn.red ? `$${c.warn.red}` : 'none'}` : ''}`
const capBig = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const capMoney = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
export const capText = (c: Cap) => [c.usd && capMoney(c.usd), c.tokens && `${capBig(c.tokens)} tokens`].filter(Boolean).join(' or ') || 'none'
// what a workspace spent against its cap, in words: $4.10, 1.2M tokens, not measured
// unpriced: its tokens counted in neither, said so (cap.ts capView)
export const capSpent = (v: CapView) => `${v.measured ? [v.usd !== undefined && capMoney(v.usd), v.tokens !== undefined && `${capBig(v.tokens)} tokens`].filter(Boolean).join(' and ') : 'not measured'}${v.unpriced?.length ? ` (no price for ${v.unpriced.join(', ')})` : ''}`
export type TaskEvent = 'ci.failed' | 'pr.opened' | 'pr.review' | 'issue.opened' | 'push' | 'webhook' | 'comment'
// webhook: hook, one of Settings › Webhooks (inbound.ts) by its name; hookEvent, only that event of it (X-GitHub-Event, a body's type or action)
export type TaskTrigger = { event: TaskEvent; branch?: string; label?: string; by?: 'others' | 'me' | 'any'; gap?: number; perDay?: number; hook?: string; hookEvent?: string; logins?: string[]; word?: string; reply?: boolean } // comment's: logins who may start it besides your gh login, word the one after /laki that picks it (/laki fix), reply: its agent's last answer posted back as a comment as the turn ends
export type TaskMarks = { pr?: number; issue?: number; head?: string; reviews?: Record<string, string>; comment?: string } // comment: the newest /laki comment's created_at it read
// one event a task heard: its id (once per id), words for the log, GitHub's fields (title: outsiders' text, fenced in the
// prompt), fork: a fork's PR (held for your click, T4.3)
export type TaskEventIn = { id: string; kind: TaskEvent; words: string; title?: string; url?: string; number?: number; branch?: string; by?: string; fork?: boolean; pr?: boolean; body?: string /* a webhook's: what its sender posted, a comment's: its text after /laki (and its word); fenced as data. pr: a comment's on a PR */ }
export type TaskNotify = 'never' | 'needs' | 'always'
// T9: after another task's run ends: done (it ended done: not failed, not waiting for you) or any (however it ended);
// perDay: runs a day at most (unset 10)
export type TaskAfter = { task: string; when: 'done' | 'any'; perDay?: number }
// T3: a task's run condition: new commits on its base (since its last run that started an agent), the project's open PRs
// (failing checks, waiting for review, any), new issues (with a label), or a command of yours (exit 0: run; its first
// line is {{check}})
export type OnlyIf = { kind: 'commits' } | { kind: 'prs'; what: 'failing' | 'review' | 'any' } | { kind: 'issues'; label?: string } | { kind: 'cmd'; cmd: string }

// a merge queue (pr.ts): a project's PRs merged one after another in the order given, each when green; one that can't
// go stops it with why
export type QueueStatus = 'waiting' | 'updating' | 'checking' | 'merged' | 'stopped'
export type MergeQueue = { project: string; at: number; items: { ws: string; pr: number; status: QueueStatus; why?: string }[]; stopped?: string; done?: number }
// a secret kept for next time (laki secret's card: Keep for this project or all projects; secrets.ts): its name only, the
// value in the Keychain (else a 0600 file). scope: a project's id, or '*' for every project
// given: who got it, the newest first (GIVEN_MAX), a workspace's id and its name as it was then; count: every time. No value, no path
export type SecretKept = { scope: string; label: string; at: number; given?: { at: number; ws: string; name: string }[]; count?: number }
export type State = { v?: number /* R7: its schema number (core.ts STATE_V) */; turnTimes?: Record<string, number[]> /* a project's and profile's last turns' working seconds (core.ts turnTook), by `project\tprofile` */; mergeQueues?: MergeQueue[]; digest?: Digest; projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; layouts?: Record<string, Layout[]>; widgetGrants?: Record<string, string[]>; settings?: Settings; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[]; reminders?: Reminder[]; flows?: FlowRun[]; flowsByAgent?: string[]; flowTrust?: Record<string, string>; flowStats?: Record<string, FlowStats>; askStreaks?: Record<string, Record<string, number>> /* F15: your Allows in a row, by project and normalized ask (shared/ask.ts streakOf; daemon/askStreak.ts) */; ruleNo?: Record<string, string[]> /* F15: the asks you said Don't suggest again for, by project */; cfgTrust?: boolean; updatesOn?: boolean; dnd?: { since: number; until: number; prs: Record<string, string>; log: { kind: 'done' | 'wait'; tab: string; text: string }[] } /* U8: Do not disturb (core.ts dndSet) */; tunnels?: SavedTunnel[]; remote?: SavedRemote; remoteDevices?: SavedDevice[]; modelNeeds?: Record<string, string>; telegram?: Telegram; secretsKept?: SecretKept[] /* secrets.ts: the names of secrets kept for next time, never their values */; backupLast?: BackupLast /* #B2: the last weekly backup (this Mac's) */ } // modelNeeds: a model the installed claude is too old for, the version it needs (accounts.ts); cfgTrust: projects from before .laki.json's trust were trusted as they were, once; updatesOn: an updateCheck saved off turned back on, once (load, 0.33); flowTrust: a project's workflows as you trusted them (workflow.ts), sha256 by source:project:id

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip' | 'cancelled'; url?: string; took?: number } // took: seconds, a finished one's

// a GitHub label: color as GitHub keeps it, 6 hex digits (none: anything else)
export type PRLabel = { name: string; color?: string; description?: string }
// ghCard's: a GitHub PR or issue for a hover card (state: open, closed, merged; at: updatedAt; add, del, files: a PR's size; review: its reviewDecision; comments: an issue's count)
export type GhCard = { kind: 'pr' | 'issue'; repo: string; url: string; number: number; title: string; state: string; draft?: boolean; author?: string; at?: string; labels?: PRLabel[]; add?: number; del?: number; files?: number; review?: string; comments?: number }
// checks: all of them in one word; list: each one. head: the commit the checks ran on.
export type PR = {
  number: number
  state: string
  url: string
  checks: '' | 'pass' | 'fail' | 'pending' | 'cancelled'
  list?: Check[]
  title?: string
  author?: string
  mine?: boolean // its author is you (gh api user): no Approve
  draft?: boolean
  head?: string
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  approved?: string[] // the logins whose latest review approves it
  changes?: string[] // and whose asks for changes
  approvedByMe?: boolean // your latest review approves it (someone else's PR)
  commentedByMe?: boolean // you commented on it, or reviewed with comments (someone else's PR)
  conflict?: boolean // merge conflicts with its base branch
  cross?: boolean // from a fork (isCrossRepository): its code, so its CI's logs, aren't the repo's people's
  held?: number // a fork's: its workflow runs GitHub holds for a maintainer's approval (pr.ts heldRuns): Approve and run
  ready?: boolean // mergeStateStatus CLEAN (or HAS_HOOKS): GitHub would merge it now; false: blocked, behind, unstable…
  behind?: boolean // mergeStateStatus BEHIND: its base has commits it hasn't, and the repo wants them in before a merge
  base?: string // its base branch
  additions?: number
  deletions?: number
  body?: string
  updated?: string
  labels?: PRLabel[] // its labels (no description: the Labels menu has the repo's)
  forge?: 'gitlab' // a GitLab merge request (gitlab.ts, through glab): MR and !n in words; unset: GitHub's
}

// runAt: when its turn began (the daemon's clock), while it runs or waits
// ask: a waiting agent's numbered menu on its screen (a permission prompt, a question): the choices and the highlighted one
// Created by: the tab whose agent started a workspace (its fromTab: laki new, /laki:orchestrate), as its @name, else
// its name, while it's open; none: undefined (Info and laki ls then name its workspace, from)
export const creatorOf = (w: { fromTab?: string }, tabs: { id: string; name: string; alias?: string }[]) => (t => t && { id: t.id, label: t.alias ? `@${t.alias}` : t.name })(w.fromTab ? tabs.find(t => t.id === w.fromTab) : undefined)
export type Ask = { options: { n: number; label: string }[]; at: number; question?: string; tool?: string; what?: string; rule?: string; diff?: string; steps?: boolean } // steps: one of several questions on one card (claude's ← … → tabs over the menu: ←/→ go between them, answers kept); at: the marked option's n; question: the line or two above the menu; tool, what, rule, diff: claude's PermissionRequest (shared/ask.ts permOf): the tool (an MCP tool's server), what it touches in a line, the "don't ask again" rule its menu offers, an Edit's or Write's change (permDiff: ' ', '-', '+' lines)
// asleep: an idle agent whose process Laki ended to free memory (settings.sleepAfter); a look, a key or a message resumes it
// progress: the agent's estimate of its task (laki progress), until its turn ends
// laki show: what an agent puts under its tab for you, with buttons you click (a folder in Finder, a file in its app, a
// page in the browser); kind: what a target is (url: http(s); folder, file: an absolute path on this Mac)
export type Card = { id: string; title?: string; text: string; open: { label: string; target: string; kind: 'url' | 'folder' | 'file' }[]; at: number }
export type BgTaskView = { id: string; kind: 'agent' | 'shell'; name: string; out?: string; cmd?: string } // share.ts BgTask: out, the file its output goes to; cmd, a shell's command
// claude waiting out an API error (a rate limit, an overloaded server, a lost connection): its try (n of max), when the
// next one goes (until), when it said so (at: a turn that started after has none), why in its own words (share.ts meterOf)
// #3: a worker that can't go on (daemon/stuck.ts): why, the next step for its lead, since when
export type TabStuck = { kind: 'limit' | 'failed' | 'exited' | 'retrying' | 'silent' | 'background'; why: string; next: string; at: number }
export type Retry = { n?: number; max?: number; until: number; at: number; why?: string }
export type TabView = Tab & { held?: string /* F15: the always-ask glob this waiting ask touches: no rule answers it */; mcpAuth?: { names: string[]; login?: string } /* its MCP servers that need a sign-in, the one whose login runs (mcpAuth.ts) */; goal?: Goal /* A1: its /goal (meters.ts) */; signedOut?: SignedOutView /* A2, C6: its agent is signed out (daemon/signin.ts): the band over its box */; skills?: { name: string; path?: string }[] /* B7: the skills its chat loaded, in that order (share.ts skillsIn): the context meter's menu */; boxed?: Boxed /* a command its sandbox stopped this turn (sandboxStop): its card offers tabUnbox */; usual?: number /* a running agent's project's and profile's usual turn, in seconds (nextStep.ts usual) */; allowed?: { at: number; tool: string; what: string; rule: string }[] /* F14: asks a project rule answered Allow, the last 20 */; failed?: string /* its turn ended on an API error: the error, a line (Continue, Dismiss) */; loop?: TabLoop /* it keeps failing the same command this turn (shared/loop.ts): Needs you's Nudge, Stop, Let it work */; drafted?: boolean; ungated?: boolean /* S8: a claude tab started before any tool gate was on: not covered until it restarts */; mode?: string; modeUnknown?: boolean; bypassNo?: string /* mode: a running claude's, read off its screen (modeUnknown: its footer isn't on screen now, mode is the last one seen); bypassNo: why it can't be switched to Bypass */; hookless?: { why: string; detail?: string } /* hooks not heard (core's hookTick): the likely why, what to look at */; changes?: TurnChanges; marks?: TurnMark[] /* P5: its turns' chips from turn place extensions, the last 20 turns */; compacting?: boolean; suggest?: string; secret?: { id: string; label: string; fields?: { name: string; plain?: boolean }[] /* #7: one card, a field each */; saved?: 'project' | 'all'; last?: { at: number; name: string } /* the kept one's newest give: when, to which workspace (your own window's: masked drops it) */; first?: boolean /* none of its gives went to this workspace */ }; card?: Card; plan?: TabPlan; planAsk?: string; status: Status; code?: number; done: boolean; limit?: number; last?: string; runAt?: number; needAt?: number; ask?: Ask; asleep?: boolean; queued?: boolean; progress?: { pct: number; note?: string }; runs?: Agent; share?: { url: string; until?: number }; context?: { used: number; max: number }; usage?: { tokens: number; cost?: number; unpriced?: string[] /* models it used with no price: their tokens have no cost */ }; retry?: Retry; background?: { now: BgTaskView[]; done: number; last: BgTaskView[]; at?: number }; stuck?: TabStuck /* #3: a worker that can't go on: laki wait's stuck line, the workers dock */ } // retry: claude waits out an API error (a rate limit…): its try, when the next goes, when it said so, why (meters.ts' meterOf; a turn started after it: stale); background: its chat's background shells and subagents, running now, how many ended, the newest of those and when the last did (claude's: meters.ts); changes: what its last turn changed in the worktree (turns.ts: Reader's card, Changes' This turn, Undo); compacting: claude sums up its chat (PreCompact) while it runs; suggest: the next prompt Laki AI guessed (settings.nextPrompt) while it's idle; secret: a secret it asks you for (laki secret: the card's masked field); needAt: since when it needs you (waiting, or done and idle: the Needs you list's order); queued: asleep until its turn after a daemon restart (core's restoreAll); runs: an agent typed in a shell tab; share: its read-only page's link (shareStart), until when; context: what its chat's context holds of its window, usage: what the chat used since it began, cost at API prices (unknown model: none) (claude's and codex's transcripts: meters.ts)

// Resources (Settings): memory (RSS, KB) and CPU (%) by process, from one ps. app: Laki's own (main, renderers, GPU…);
// daemon: this one, heap: its JS heap (KB); tabs: each running tab's process tree, the program first
export type ProcUse = { pid: number; rss: number; cpu: number; cmd: string }
// others: what the daemon runs besides tabs (Laki AI's agent, tunnels, remote access, SSH, widgets' fetches); stop: resourceStop's key
export type Resources = { app: (ProcUse & { kind: string })[]; daemon: ProcUse & { heap: number }; tabs: { tab: string; rss: number; cpu: number; procs: ProcUse[] }[]; others?: { name: string; stop?: string; rss: number; cpu: number; procs: ProcUse[] }[] }

// a port exposed at a trycloudflare.com URL (no url yet: starting); mails: who can open it (none: anyone)
export type Tunnel = { port: number; url?: string; mails?: string[]; until?: number; host?: string; down?: string } // until: when it stops (ms; none: when you stop it); host: a permanent one's (settings.tunnel's named tunnel); down: why it's reconnecting (no url meanwhile, a quick one's comes back new)
// a tunnel kept in state.json, so it comes back after a daemon restart (remote.ts tunnelsBack)
export type SavedTunnel = { ws: string; port: number; mails?: string[]; until?: number; host?: string; via?: string; url?: string } // via: the named tunnel a permanent one's DNS record goes to
// permanent tunnels (Settings › Tunnels): your own named tunnel (cloudflared tunnel login, tunnel create) and the domain
// its hostnames go under (the one you picked at login)
export type NamedTunnel = { name?: string; domain?: string }

// run: the project has a dev command; scripts: the RUN_SCRIPTS it has
// stat: its changes against where it started (a worktree: its base; the repo itself: HEAD), lines added and deleted
// (new files' too), files, and paths not committed (dirty), every 10 s (settings.diffStat on, or a race's); made and gone:
// files created (untracked ones too) and deleted, of those files
// T13: a worktree that broke under Laki (files.ts brokenOf): gone, its folder; unlinked, its .git file and the repo's
// record of it don't name each other; moved, its .git names the repo at another place. remote: an SSH host's or a
// codespace's, found only (no repair there)
export type Broken = { kind: 'gone' | 'unlinked' | 'moved'; detail: string; remote?: boolean }
// #C1: a file merging the base in conflicts in: its path, its places (conflict regions), its kind
export type Conflict = { path: string; places: number; kind: 'content' | 'delete/modify' | 'rename' }
export type Stat = { conflicts?: Conflict[]; conflictsMore?: number; add: number; del: number; files: number; dirty: number; made?: number; gone?: number; behind?: number; ahead?: number; clean?: boolean } // F8: commits its base has that it hasn't (behind) and the other way (ahead), as this clone has the base (no fetch); clean: merging the base in would have no conflicts (behind only)
// procs: what listens on each of its ports (the status bar's ✕ stops it); portNames: .laki.json's ports; artifacts:
// the files in its storage folder ($LAKI_STORAGE_FOLDER), the status bar's count
// a workspace's linked ticket (daemon/tickets.ts: its project's Ticket script)
export type Ticket = { key: string; title?: string; status?: string; url?: string }
export type WorkspaceView = Omit<Workspace, 'pending'> & { pending?: PendingView; spend?: CapView /* its spend cap and what its agents spent against it (cap.ts) */; cost?: { usd: number; level?: CostLevel; warn?: CostWarn } /* #3: its agents' chats at API prices, past its warning's amounts (cap.ts costOf) */; broken?: Broken /* T13: its worktree broke (wsRepair) */; ticket?: Ticket; annotAt?: number /* P6: when its extensions' notes on diff lines changed (widgetAnnotations) */; setup: boolean; scripts?: RunScript[]; ports: number[]; procs?: Record<number, Proc>; portNames?: Record<string, string>; tunnels: Tunnel[]; pr?: PR; run: boolean; stat?: Stat; overlaps?: Collision[]; check?: CheckRun; proof?: Proof; artifacts?: number; links?: Link[]; artKey?: string; wtKey?: string } // artKey: its artifacts' pages' key (GET /artifact/<artKey>/<ws>/…); wtKey: its worktree's files' (GET /worktree/…: View as page)
// a link an agent kept in the storage folder (a .url file: what it published), its title the file's name
export type Link = { path: string; url: string; title: string; at: number }
export type Proc = { pid: number; cmd: string; own?: boolean } // own: an agent's own (no shell between: its browser bridge, an MCP server) or a browser: not in ports
// the first-run screen's checks: git, gh (missing, signed out, in), which agents are on PATH
// Settings › Agents & profiles: an agent's last hook (this daemon's), its live tabs, how many aren't heard (hooksSeen)
export type HookSeen = { at?: number; tabs: number; deaf: number; native?: NativeSeen }
// F6: what an agent sees in a project (sees.ts agentContext): its rule files in load order (at: the path with ~; from:
// the file that @imports it), Laki's memory it gets (how many of each, its bytes), its MCP servers (env and headers by
// name only, tokens masked; off: turned off in its config)
export type AgentRule = { path: string; at: string; scope: 'managed' | 'user' | 'project' | 'local'; size: number; from?: string }
export type AgentServer = { name: string; scope: 'user' | 'project' | 'local' | 'laki'; file: string; transport: string; command?: string; args?: string[]; url?: string; env?: string[]; headers?: string[]; off?: boolean; signIn?: true /* a live tab of this agent here says it needs a sign-in (mcpAuth.ts) */ }
// how Laki's note (its own and the project's memory) reaches each agent at start (core.ts agentCmd): a flag of its own
// (claude's --append-system-prompt, codex's developer_instructions, grok's --rules, opencode's config instructions), or,
// with none (agy), in front of a new chat's first message
export const MEMORY_HOW: Record<string, 'by flag' | 'in the first message'> = { claude: 'by flag', codex: 'by flag', grok: 'by flag', opencode: 'by flag', pi: 'by flag', gemini: 'in the first message' }
export type AgentContext = { agent: 'claude' | 'codex' | 'pi'; project?: string; path?: string; profile?: string; envAllow?: string[]; heldWhy?: Record<string, string> /* each held one's reason: its name, or its value's shape */; held?: string[] /* hideSecrets on: the names kept from its profile's agent (shared/env.ts), never values */; rules: AgentRule[]; memory: { global: number; mine: number; learned: number; bytes: number }; servers: AgentServer[]; skills?: AgentSkill[] /* every agent's (sees.ts skillsAudit): what each loads, by size, for drift between them */ }
// an agent's skill (its skills/<name>/SKILL.md in its folder, or a project's .claude/skills, .codex/skills): approxTokens
// its size over 4; frontmatterBytes what every session reads of it (the rest loads when it's used)
export type AgentSkill = { name: string; agent: string; path: string; at: string; scope: 'home' | 'project'; bytes: number; approxTokens: number; frontmatterBytes: number }
// what to look at in a skill: over 8 KB, or only one agent has it while others have skills (drift between them)
export const SKILL_BIG = 8 << 10
export const skillNotes = (all: AgentSkill[]) => {
  const agents = new Set(all.map(s => s.agent))
  return (s: AgentSkill) => [s.bytes > SKILL_BIG && 'large', agents.size > 1 && all.every(x => x.name !== s.name || x.agent === s.agent) && `only ${AGENT_NAMES[s.agent as Agent] ?? s.agent}`].filter((x): x is string => !!x)
}
export type Doctor = { git: boolean; gh: 'missing' | 'out' | 'in'; ghCodespace?: boolean; cloudflared?: boolean; idb?: boolean; agents: { id: Agent; found: boolean; signedIn?: boolean }[]; hooks?: { ok: boolean; why?: string }; hookFiles?: { ok: boolean; why?: string }; secrets?: { on: boolean; held: number }; backup?: { tm: boolean; spotlight: boolean; skipped?: string[] }; loose?: { project: string; loose: number }[]; starterEnv?: string[] } // starterEnv: the names this daemon's start left out of its environment (daemon/starterEnv.ts); loose (B8): projects whose git has over 20,000 loose objects; backup: worktrees out of Time Machine and Spotlight (backup.ts), skipped: why a folder wasn't marked; idb: laki screen's simulator hands; hooks: Laki's hook command runs (hook ping); hookFiles: the files that point agents at it are there and read
// A9: the doctor as lines (laki doctor's, the diagnostics' too): ✓ fine, ● optional or worth a look, ✗ broken, a fix for each not fine
export function doctorRows(d: Doctor, mac = typeof process !== 'undefined' && process.platform === 'darwin'): [string, string, string?][] {
  return [
    d.git ? ['✓', 'git'] : ['✗', 'git not found', 'xcode-select --install (or your package manager)'],
    d.gh === 'in' ? ['✓', 'gh signed in'] : d.gh === 'out' ? ['●', 'gh not signed in: no PRs, checks or issues', 'gh auth login'] : ['●', 'gh not found: no PRs, checks or issues', 'brew install gh'],
    ...(d.gh === 'in' && d.ghCodespace === false ? [['●', 'gh has no codespace scope: no cloud workspaces', 'gh auth refresh -s codespace'] as [string, string, string]] : []),
    d.cloudflared ? ['✓', 'cloudflared'] : ['●', 'cloudflared not found: no remote access or Expose to the world over Cloudflare', 'brew install cloudflared'],
    ...(mac ? [d.idb ? (['✓', 'idb'] as [string, string]) : (['●', "idb not found: laki screen can't tap the simulator", 'brew install idb-companion && pipx install fb-idb'] as [string, string, string])] : []),
    ...d.agents.map((a): [string, string, string?] => (!a.found ? ['●', `${a.id} not found`, `install ${a.id}, then laki doctor again`] : a.signedIn === false ? ['●', `${a.id} found, not signed in`, `run ${a.id} in a terminal and sign in`] : ['✓', `${a.id}${a.signedIn ? ' signed in' : ''}`])),
    ...(d.agents.some(a => a.found) ? [] : [['✗', 'no agent found', 'install claude or codex'] as [string, string, string]]),
    ...(d.hooks ? [d.hooks.ok ? (['✓', "Laki's hooks reach the daemon"] as [string, string]) : (['✗', `Laki's hooks don't reach the daemon: ${d.hooks.why ?? ''}`, "restart Laki's daemon from the app's status bar"] as [string, string, string])] : []),
    ...(d.secrets?.held ? [d.secrets.on ? (['✓', `${d.secrets.held} secret-looking variable${d.secrets.held === 1 ? '' : 's'} kept from agents`] as [string, string]) : (['●', `${d.secrets.held} secret-looking variable${d.secrets.held === 1 ? '' : 's'} reach agents`, 'Settings › Agents & profiles: Hide secret-looking variables from agents'] as [string, string, string])] : []),
    ...(mac && d.backup ? [d.backup.tm ? (['✓', `worktrees kept out of Time Machine${d.backup.spotlight ? ' and Spotlight' : ''}`] as [string, string]) : (['●', 'worktrees are in Time Machine backups', 'Settings › General: Keep worktrees out of Time Machine'] as [string, string, string])] : []),
    ...(d.starterEnv?.length ? [['✓', `left out of Laki's environment, from where it started: ${d.starterEnv.join(', ')}`] as [string, string]] : []),
    ...(d.loose ?? []).map(l => ['●', `${l.project}: ${l.loose.toLocaleString('en-US')} loose git objects`, 'Settings › Resources › Disk: Tidy now'] as [string, string, string]),
    ...(mac && d.backup?.skipped?.length ? d.backup.skipped.map(why => ['●', `Spotlight: ${why}`, "set a worktrees folder of Laki's own (Settings › General › Worktrees)"] as [string, string, string]) : []),
    ...(d.hookFiles ? [d.hookFiles.ok ? (['✓', "agents' hook files"] as [string, string]) : (['✗', `agents' hook files: ${d.hookFiles.why ?? ''}`, "restart Laki's daemon from the app's status bar"] as [string, string, string])] : []),
  ]
}
export const doctorText = (rows: [string, string, string?][]) => rows.map(([m, what, fix]) => `${m} ${what}${fix ? `\n    fix: ${fix}` : ''}`).join('\n')

// a widget (daemon/widgets.ts): a folder with widget.json and widget.html; on: in the sidebar, fetching every `every`
// minutes (none: no fetch command or script); size: cells, 1–4 across the sidebar's grid by 1–4 down; full: it has a
// full view (a dialog); js: its page has scripts, so it runs in a sandboxed frame; config: its settings; at, error:
// the last fetch; rev: changes on each reload
// a widget's setting (widget.json config): its kind (text, number, bool: an on/off, choice: one of choices, list: words
// or names, kept joined by commas; secret: a token, kept in <data>/widget-secrets.json and given only to its fetch and
// actions), what Settings calls it and says under it
export type WidgetOption = { key: string; type: 'text' | 'number' | 'bool' | 'choice' | 'list' | 'secret'; label?: string; hint?: string; choices?: string[]; set?: boolean; required?: boolean } // secret: a token, never in the view (its config ''), set: it has one; required: it needs one (WidgetView.missing)
// view: the full view's dialog, small, medium or large; config: each setting as text (a bool's '1' or '')
// button: it shows as a button (a rail or foot place, or no preview of its own): icon (one of the app's icons, or a
// character or two), label, badge (a count on it) and tip, filled from its data; click: the action a click runs (none:
// its full view, else a fetch)
// a fetch's or an action's run (widgetRuns): reason schedule, open, settings, manual, reload, dev or action:<name>; why:
// what changed (dev mode); stderr: its last 20 lines
export type WidgetRun = { at: number; ms: number; reason: string; why?: string; action?: string; ok: boolean; bytes: number; error?: string; stderr?: string; exit?: number; gh?: number; kind?: FailKind; hint?: string } // gh: the times it ran gh; kind, hint: a failure's (R1: widgets.ts failOf)
// R1: what kind of failure a fetch's or action's was (widgets.ts failOf): a program not on its PATH, no network, not
// signed in, a rate limit, too slow, no JSON printed, any other exit
export const FAIL_KINDS = ['missing-bin', 'offline', 'auth', 'rate-limit', 'timeout', 'bad-json', 'exit'] as const
export type FailKind = (typeof FAIL_KINDS)[number]
// a failed fetch's kind and a line that says what to do; cmd: a terminal command that fixes it (typed, not run: App's
// termType); since: offline, when the data it still shows was fetched (none: unknown)
export type WidgetFail = { kind: FailKind; hint: string; cmd?: string; since?: number }
export const RETRY_KINDS: readonly FailKind[] = ['offline', 'rate-limit', 'timeout'] // its fix: Retry
export type WidgetRuns = { runs: WidgetRun[]; env: Record<string, string>; fixtures: string[]; devError?: string; mock?: string; data?: string; big?: boolean; stream?: WidgetStream } // data: its last data's JSON, when asked (big: over 256 KB, not given)
// a stream's (widget.json's stream): running since, restarts so far, its last line, the next start after an exit
export type WidgetStream = { running: boolean; since?: number; restarts: number; last?: string; next?: number; stopped?: boolean }
// what an extension may answer (widget.json's on: { "<event>": "<action>" | "refresh" }; widgetEvents.ts widgetEvent)
export const WIDGET_EVENTS = ['turn.done', 'turn.failed', 'turn.long', 'turn.waiting', 'pr.opened', 'pr.checks.failed', 'pr.checks.passed', 'pr.review', 'pr.merged', 'pr.closed', 'workspace.new', 'workspace.archived', 'workspace.restored', 'workspace.removed', 'schedule.ran', 'schedule.done', 'app.open', 'ship.done', 'flow.ended', 'limit.hit', 'tab.new', 'port.open', 'gate.held', 'tool.call', 'issue.labeled', 'webhook'] as const
// gates (an action's "gate"): the steps an extension can hold; a hold: who held it and why
export const GATES = ['ship', 'merge', 'archive', 'tool'] as const // tool: each tool call claude makes (widgetEvents.ts toolGate), the others steps of core's gated
export type Gate = (typeof GATES)[number]
export type GateHeld = { widget: string; name: string; gate: Gate; why: string; fix?: string; icon?: string }
// what an agent did through Laki's API (daemon agentLog.ts): when, its tab and workspace, the method, names and ids only
// (what), refused: why it wasn't done
export type AgentDid = { at: number; tab: string; ws: string; method: string; what?: string; refused?: string }
// Settings › Resources › Disk (resources.ts diskScan): each workspace's parts in bytes. worktree: its folder, deps in it
// (CLONE_DIRS; shared: cloned by Laki, APFS's clones counted whole, so maybe on disk once); turns: its kept turns' git
// objects no branch has (none: git can't say); storage: its folder; saved: an archive's uncommitted files in git
export type DiskPart = { what: 'worktree' | 'deps' | 'turns' | 'storage' | 'saved'; name?: string; bytes: number; shared?: true }
export type DiskWs = { id: string; name: string; archived?: true; merged?: true; parts: DiskPart[]; bytes: number }
// B8: a project's git tidy (gitTidy.ts): when it last ran, skipped (why) or failed (why); its facts for the Disk page
export type GitTidied = { at: number; skipped?: string; failed?: string }
export type GitFacts = { bytes?: number; loose: number; packs: number; tidied?: GitTidied }
export type DiskUsage = { at: number; free?: number; backup?: { tm: boolean; spotlight: boolean } /* worktrees out of Time Machine, Spotlight (backup.ts) */; projects: { id: string; name: string; bytes: number; workspaces: DiskWs[]; git?: GitFacts }[] }
export type DiskTidyWhat = 'turns' | 'storage' | 'archives'
// Ship's secret check (core.ts shipSecrets): a token-shaped string in a line it would commit: masked, never itself; hash
// names it for "Not a secret" (ship's allowSecrets, remembered for that workspace)
export type SecretFound = { file: string; line: number; kind: string; masked: string; hash: string }
// events of your own (laki widget emit): custom.<name>; "custom.*" in on: answers every one
export const CUSTOM_EVENT = /^custom\.[a-z0-9][a-z0-9._-]{0,40}$/
export type WidgetEvent = (typeof WIDGET_EVENTS)[number] | `custom.${string}`
// a name on: (widget.json's, a workflow's) may take: a built-in event, a custom one, or custom.*
export const eventOk = (e: string) => (WIDGET_EVENTS as readonly string[]).includes(e) || e === 'custom.*' || CUSTOM_EVENT.test(e)
// the extensions and workflows an event reached (laki widget events: the last 50)
export type EventSent = { at: number; event: string; ws?: string; from?: { widget?: string; tab?: string; agent?: string }; hops?: number; widgets: string[]; flows: string[]; refused?: string[] }
// where an extension's data comes from: its own fetch (or script), a text typed in (JSON, else { text }), a file of this
// Mac's or a URL (read each time it fetches: JSON, else { text }); widget.json's source is the default, the user's pick wins
export const WIDGET_SOURCES = ['fetch', 'static', 'file', 'url', 'ai'] as const
// ai: an agent answers prompt with the user's own tools and MCP servers (claude: tools, the ones it may use unasked), its
// last ```json block the data; profile: a claude or codex preset (unset: settings.widgetAgent, else claude)
export type WidgetSource = { kind: (typeof WIDGET_SOURCES)[number]; text?: string; path?: string; url?: string; prompt?: string; tools?: string; profile?: string }
export const AI_SOURCE_EVERY = 60 // minutes between an AI source's runs unless set; 15 at least: each one costs
// what the user hid of an extension (its switches): its refresh buttons, when it was fetched
// P2: when it shows, by the selected workspace: its project (id or name), branch (a glob), whether it has a PR, its agents
export const WHEN_AGENT = ['running', 'waiting', 'idle'] as const
export type WidgetWhen = { project?: string; branch?: string; pr?: boolean; agent?: (typeof WHEN_AGENT)[number] }
export type WidgetHide = { refresh?: boolean; at?: boolean; tip?: boolean } // tip: no tooltip on hover (widget.json's "tip": false too)
// a line of an extension's log (widgetLogs.ts): src laki (Laki's own), fetch, action:<name>, stream, tool:<name>, push,
// cli (laki widget log), page (a JS page's laki.log); n: its place in the log, the cursor widgetLogs reads from
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export type WidgetLogLine = { n: number; at: number; level: LogLevel; src: string; text: string; ws?: string }
export type WidgetView = { id: string; key?: string; name: string; oneFile?: boolean; allowed?: string[]; source?: WidgetSource; ownFetch?: boolean; fixtures?: string[]; description?: string; dir: string; on: boolean; hidden?: boolean; size: [number, number]; fit?: boolean; every?: number; full: boolean; view: WidgetSize; place?: WidgetPlace; places?: WidgetPlace[]; net?: boolean; hide?: WidgetHide; js?: boolean; actions?: string[]; menus?: WidgetMenu[]; config: Record<string, string>; options: WidgetOption[]; missing?: string[]; when?: WidgetWhen; order?: number; needs?: string[]; missingBins?: string[]; tooNew?: string; at?: number; error?: string; fail?: WidgetFail; running?: boolean; agent?: boolean; byAi?: boolean; sample?: boolean; dev?: boolean; devError?: string; mock?: string; rev: number; icons?: number; button?: boolean; icon?: string; label?: string; badge?: string; tip?: string; tipOff?: boolean; fx?: number; click?: string; clickAsk?: string; hours?: string; stream?: boolean; annotates?: true /* P6: widget.json says it puts notes on diff lines */; facts?: string[]; scope?: 'workspace'; inst?: Record<string, WidgetInst>; here?: string | null; tools?: WidgetTool[]; history?: number[]; log?: boolean; keepLog?: boolean; logErr?: number; gates?: Gate[]; project?: string; repo?: string; agentDev?: boolean; changed?: boolean } // icons: the daemon's icon look changed (icons.ts iconTurns), its kit HTML drawn again; tipOff: widget.json's "tip": false (hide.tip set with it); clickAsk: its click action's confirm, asked before a click runs it; hours: its own working hours over Settings'; facts: the workspace facts it reads (FACTS); hidden: its data says hidden: true, so the app shows it nowhere (its page and Settings still list it); fit: in a bar, as wide as it needs (Auto, not a JS page's); project: a repo's (its .laki/extensions), shown and run only in that project's workspaces, repo its name; agentDev: in a folder an agent linked, trusted the same way; changed: off since its files changed there; gates: the steps its actions can hold; keepLog: its own Keep a log; log: it keeps a log now (its own switch, Settings' for all, or dev-linked); logErr: its last error line's time; oneFile: <id>.<n><s|m|h>.<ext>, renamed in its tag; allowed: claude tools its agent may use unasked, allowed when it asked; history: the studio's Undo, when each kept version was taken (ms), oldest first
// an action an agent may call (its tool): Always granted in these workspaces ('': calls from none, Laki AI's)
export type WidgetTool = { action: string; description: string; ask: 'always' | 'first' | 'never'; grants: string[] }
// an action offered where you work (widget.json's title, show, match, key, ask, confirm, insert, view: widgetSchema.ts actionMenu)
export type WidgetMenu = { action: string; title: string; show: string[]; match?: string[]; key?: string; ask?: string; confirm?: string; insert?: boolean; view?: boolean }
// where an action was picked (widgetAction ctx): a workspace, its tab, a file of it (relative)
export type WidgetCtx = { ws?: string; tab?: string; file?: string; storage?: boolean } // storage: file is one of the workspace's Artifacts (its storage folder's)
// an action's files (#26: its JSON's files, checked): an image as imageSave's copy (image), else the file itself
export type ActionFile = { path: string; image?: boolean; size: number }
// here: the app's (Widgets.tsx inWs), the workspace whose instance a per-workspace one shows; null: none on screen
// a scope workspace extension's instance in a workspace (WidgetView.inst, by its id): its last fetch and its button's words
export type WidgetInst = { at?: number; error?: string; fail?: WidgetFail; running?: boolean; mock?: string; fx?: number; label?: string; badge?: string; tip?: string; tone?: 'good' | 'bad' | 'warn' | 'accent' | 'muted'; hidden?: boolean } // fx: when its workspace's facts last changed (drawn again); tone: its data's own (a row mark's color); hidden: its data's own hidden: true
export type WidgetSize = 's' | 'm' | 'l'
// where an extension shows: the sidebar's grid (the default), the top bar or the status bar (a line high, by the bar's
// right end), the rail (a button among its icons; without the rail, the sidebar's foot), the sidebar's foot (a button
// beside Video, Meme and Timer) or the Desk (experimental: a page of tiles, each resized there). Any of them at once:
// places (place is the first of them, for an older app)
export const WIDGET_PLACES = ['side', 'top', 'status', 'rail', 'foot', 'more', 'desk', 'panel', 'row', 'turn', 'none'] as const // more: an item in the sidebar foot's ⋯ menu; panel: a right-panel tab; row: a mark on each workspace's row; turn: a chip under each agent turn its turn.done handler gave data for (both per workspace only); none: nowhere, it runs in the background (alone: with another place, that one)
// P5: a turn place's chip: what its turn.done handler left for that turn (at: the event's time), its face then; data only in the daemon (widgetRender's turn)
// P6: an extension's note on a line of a workspace's diff (its new side), from an action's JSON or a fetch's data
export type Annotation = { file: string; line: number; level: 'info' | 'warn' | 'error'; text: string; fix?: string }
export type Annotations = { widget: string; name: string; items: Annotation[] }[] // widgetAnnotations: by extension
export type TurnMark = { widget: string; at: number; label?: string; badge?: string; tip?: string; tone?: WidgetInst['tone'] }
// a size typed as cells across x down (2x1, 3×0.5): the CLI's and MCP's; widgetSet clamps it
export const cellsOf = (t: string): [number, number] | undefined => (m => (m ? [Number(m[1]), Number(m[2])] : undefined))(/^\s*(\d)\s*[x×]\s*(\d(?:\.5)?|0?\.5)\s*$/i.exec(t))
export const placesOf = (w: { place?: WidgetPlace; places?: WidgetPlace[] }): WidgetPlace[] => (w.places?.length ? w.places : [w.place ?? 'side'])
export const nowhere = (w: { place?: WidgetPlace; places?: WidgetPlace[] }) => placesOf(w).every(p => p === 'none') // runs in the background, shows nowhere
export const BUTTON_PLACES: readonly WidgetPlace[] = ['rail', 'foot', 'more']
export type WidgetPlace = (typeof WIDGET_PLACES)[number]

// presets: the agents a tab or workspace can start (Settings' presets, or every agent installed); api: the
// daemon's API (none: older than API existed)
// schedules and runs (newest first): scheduled tasks and their log
export type ArchivedProject = { id: string; name: string; path: string; host?: string; archived: number; workspaces: number }
// U8: what happened during Do not disturb, kept until you close its card: tabs that wait (their ask's first line), turns
// that ended (their answer's), PRs that moved
export type DigestRow = { kind: 'wait' | 'done' | 'pr'; ws: string; tab?: string; name: string; text: string }
export type Digest = { since: number; until: number; rows: DigestRow[] }
// A9: an agent's CLI in Settings' Versions (daemon agentCli.ts): where it is (none: not installed), its version, the newest
// (npm's), how it was installed and its update's command; running: its agent tabs live now (they keep their version
// until restarted); update: its last update's tab, running, done (exit 0) or failed
// C5: a deleted workspace's kept artifacts (artifacts.ts keptList): its folder in <storage>/.kept, who it was, its files
// (newest first, 200 at most), how many and their size
export type KeptArts = { dir: string; path: string; id: string; name: string; project?: string; branch?: string; deleted: number; files: { path: string; size: number }[]; n: number; bytes: number }
// B3: Uninstall Laki's rows (daemon uninstall.ts): todo (a look), done, failed (why, and cmd: what does it by hand),
// none (nothing there), kept (another Laki's, or data not picked), later (as the daemon stops: Quit Laki)
export type UninstallRow = { id: 'cli' | 'skills' | 'daemon' | 'worktrees' | 'data' | 'next'; label: string; detail: string; state: 'todo' | 'done' | 'failed' | 'none' | 'kept' | 'later'; why?: string; cmd?: string }
// newestAt: when newest was published; offerAt: newest is too young for Settings' Update delay, offered then (-1: the
// registry gave no date, held back); noDelay: its own updater's (or Homebrew's), the delay doesn't apply
export type AgentCli = { newestAt?: number; offerAt?: number; noDelay?: true; id: string; name: string; path?: string; version?: string; newest?: string; how?: string; cmd?: string; running?: number; update?: { tab: string; ws: string; state: 'running' | 'done' | 'failed'; code?: number } }
export type BackupLast = { at: number; file: string; bytes: number }
export type SafeSuspect = { kind: 'extension' | 'workflow' | 'task'; id: string; name: string; source?: string; project?: string }
export type View = { backupLast?: BackupLast /* #B2: the last weekly backup */; envUnread?: number /* secret env values the Keychain hasn't given yet (envKeys.ts): their tabs miss them until it does */; agentUpdates?: string[] /* A9: the agent CLIs with a newer version out (agentCli.ts): a dot on Settings */; mergeQueues?: MergeQueue[] /* pr.ts: each project's last merge queue */; ptyHostOff?: string /* R9: settings.ptyHost on, yet new terminals run in the daemon: why */; archivedSoon?: { id: string; name: string; what: string[] }[] /* R8: archived workspaces deleted within a day, what of theirs goes to the trash */; digest?: Digest; dnd?: { until: number } /* U8: Do not disturb is on, until then: no notifications but an important workspace's ask */; modelNeeds?: Record<string, string> /* a model the installed Claude Code is too old for: the version it needs (accounts.ts modelRefused) */; claudeHas?: string /* the installed claude's version */; projects: Project[]; diskFull?: { free: number } /* R4: the state couldn't be saved, the disk is full (bytes free): kept in memory, tried again */; secretsKept?: SecretKept[] /* the secrets kept for next time: names only (secrets.ts) */; archivedProjects?: ArchivedProject[]; updateIdle?: { at: number; by?: string } /* Update when idle: asked then (by: the agent that asked) */; managed?: { from: string; keys: string[]; remote?: false; bypass?: false; agents?: string[]; allowRules?: false } /* a managed policy (policy.ts): what's locked */; workspaces: WorkspaceView[]; tabs: TabView[]; layouts?: Record<string, Layout[]>; presets: Preset[]; settings: Settings; remote?: Remote; remoteDevices?: RemoteDevice[] /* D3: remote access's paired devices, kept while it's off too */; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[]; reminders?: Reminder[]; widgets?: WidgetView[]; widgetHome?: string; imgKey?: string; flows?: FlowView[]; flowFiles?: number; flowHeard?: number; api?: number; caps?: string[] /* what it can do by name (caps.ts) */; built?: string; today?: Today; usageScan?: { at: number; running?: true } /* the machine scan (usageScan.ts): when it last ended, one under way: the Usage page reads again */; whenDone?: { act: WhenDone; at: number }; trouble?: { n: number; last: string; at: number } /* R6: the daemon's uncaught errors since it started: how many, the last one's first line */; safe?: { since: number; suspects: SafeSuspect[] } /* safe mode after three young deaths in a row (daemon/safe.ts): what Laki starts on its own is off until you leave it; suspects: what ran before a crash */; newerData?: number /* R7: state.json's v, a newer Laki's: kept aside as state.json.v<N> */; telegram?: TelegramView /* Settings › Telegram: no token, no code */ } // whenDone: its countdown, when it acts (settings.whenDone); built: its build's time (none from source); flowFiles: when a workflow file last changed; flowHeard: when a workflow last heard an event; today: what the agents used today
// S7: the view an agent, MCP or Laki AI gets while Recording mode is on: no private workspace (its own or its project's
// private), its tabs, layout and today's use, nor a private project; the app's window gets them all and veils the rows
export function recorded(v: View): View {
  if (!v?.settings?.recording) return v
  const off = new Set(v.projects.filter(p => p.private).map(p => p.id))
  const gone = new Set(v.workspaces.filter(w => w.private || off.has(w.project)).map(w => w.id))
  if (!gone.size && !off.size) return v
  return viewWithout(v, off, gone)
}
// S7: an event Recording mode keeps from an agent's or a remote page's socket, as recorded() keeps their workspaces
// from its state: one that names a private workspace or one of a private project, by its ws, tab, project (a
// workflow's: wf.project), or the ws or tab a notice is about (to). Pure: test/agent-gates.test.ts
type Seen = { settings?: { recording?: boolean }; projects: { id: string; private?: boolean }[]; workspaces: { id: string; project: string; private?: boolean }[]; tabs: { id: string; workspace: string }[] }
export function isHiddenEvent(msg: unknown, s: Seen): boolean {
  if (!s.settings?.recording || !msg || typeof msg !== 'object') return false
  const m = msg as { ev?: unknown; ws?: unknown; tab?: unknown; project?: unknown; to?: { ws?: unknown; tab?: unknown }; wf?: { project?: unknown } }
  if (m.ev === 'state') return false // recorded()'s
  const off = (id: unknown) => typeof id === 'string' && !!s.projects.find(p => p.id === id)?.private
  const ws = (id: unknown) => typeof id === 'string' && (w => !!w && (!!w.private || off(w.project)))(s.workspaces.find(w => w.id === id))
  const tab = (id: unknown) => typeof id === 'string' && ws(s.tabs.find(t => t.id === id)?.workspace)
  return ws(m.ws) || tab(m.tab) || off(m.project) || (!!m.wf && typeof m.wf === 'object' && off(m.wf.project)) || (!!m.to && typeof m.to === 'object' && (ws(m.to.ws) || tab(m.to.tab)))
}
// a view without some projects and workspaces: their tabs, layouts, today's and the digest's rows too
const viewWithout = (v: View, off: Set<string>, gone: Set<string>): View => ({ ...v, projects: v.projects.filter(p => !off.has(p.id)), workspaces: v.workspaces.filter(w => !gone.has(w.id)), tabs: v.tabs.filter(t => !gone.has(t.workspace)), layouts: v.layouts && Object.fromEntries(Object.entries(v.layouts).filter(([k]) => !gone.has(k))), today: v.today && { ...v.today, ws: v.today.ws.filter(x => !gone.has(x.ws)) }, digest: v.digest && { ...v.digest, rows: v.digest.rows.filter(r => !gone.has(r.ws)) } })
// T1: a trusted client kept to some projects (clients.ts): only those, and their scheduled tasks, runs and archived ones
export function onlyProjects(v: View, ids: readonly string[]): View {
  const off = new Set(v.projects.filter(p => !ids.includes(p.id)).map(p => p.id))
  const w = viewWithout(v, off, new Set(v.workspaces.filter(x => off.has(x.project)).map(x => x.id)))
  return { ...w, schedules: v.schedules?.filter(s => ids.includes(s.project)), runs: v.runs?.filter(r => !r.project || ids.includes(r.project)), archivedProjects: v.archivedProjects?.filter(p => ids.includes(p.id)) }
}
// S3: the view for anyone but your own window: the CLI and MCP (an agent's too: telling them apart costs a process
// lookup per call), Laki AI, an agent's connection, remote access's page. No secrets in it: remote access's link (its
// token; laki remote asks stateOwn) and PIN, the phone webhook's URL and reply topic (a bot's token, an ntfy topic),
// env values (yours, a profile's). Names and hosts stay, so what's set still shows; sent back as they are, a
// settingsSet leaves the real ones (unmasked)
export const MASK = '•••'
const maskUrl = (u: string) => {
  try {
    return `${new URL(u).origin}/${MASK}`
  } catch {
    return MASK
  }
}
const maskEnv = <T extends { env?: Record<string, string> }>(x: T): T => (x.env && Object.keys(x.env).length ? { ...x, env: Object.fromEntries(Object.keys(x.env).map(k => [k, MASK])) } : x)
export function maskSettings(s: Settings): Settings {
  const w = s.webhook
  return { ...maskEnv(s), ...(w && (w.url || w.replyTopic) && { webhook: { ...w, ...(w.url && { url: maskUrl(w.url) }), ...(w.replyTopic && { replyTopic: MASK }) } }), ...(s.presets && { presets: s.presets.map(maskEnv) }), ...(s.mcp && { mcp: s.mcp.map(maskEnv) }) }
}
export function masked(v: View): View {
  const { link: _, ...remote } = v.remote ?? ({} as Remote)
  // a project's env too (its settings'): projectSet keeps a value sent back as the mask
  const { secretsKept: __, ...rest } = v // their names too: your own window's (secrets.ts)
  if (rest.tabs?.some(t => t.secret?.last)) rest.tabs = rest.tabs.map(t => (t.secret?.last ? { ...t, secret: { ...t.secret, last: undefined } } : t)) // who got a kept one: as secretsKept
  return { ...rest, projects: v.projects?.map(p => (p.config?.env || p.config?.mcp ? { ...p, config: { ...maskEnv(p.config), ...(p.config.mcp && { mcp: p.config.mcp.map(maskEnv) }) } } : p)), settings: maskSettings(v.settings ?? {}), presets: v.presets?.map(maskEnv), ...(v.remote && { remote: { ...remote, ...(remote.pin && { pin: MASK }) } }) }
}
// a settingsSet from a masked view (Settings saves every key): the masked ones are the ones it has, left as they are
export function unmasked<T extends Record<string, any>>(p: T, now: Settings): T {
  const m = maskSettings(now) as Record<string, unknown>
  const real = now as Record<string, unknown>
  return Object.fromEntries(Object.entries(p ?? {}).filter(([k, v]) => !(k in m && m[k] !== real[k] && JSON.stringify(v) === JSON.stringify(m[k])))) as T
}
// today's tokens and ≈ cost at API prices (meters.ts, <data>/usage-today.json), the workspaces that used most first
export type Today = { tokens: number; cost: number; ws: { ws: string; name?: string /* its name as kept: a removed one's too */; tokens: number; cost: number }[]; out?: { tokens: number; cost: number } /* the chats no Laki tab ran (the machine scan's), in tokens and cost too */; unpriced?: { model: string; tokens: number }[] /* models with no price: tokens, no cost */ }

// specs and brainstorms (settings.specs, specsOn; daemon/plans.ts): a folder each, outside the repo. files: how
// many beside the editor's own (attachments, a brainstorm's output)
export const PLAN_KINDS = ['spec', 'brainstorm'] as const
export type PlanKind = (typeof PLAN_KINDS)[number]
export type Plan = { project: string; kind: PlanKind; slug: string; title: string; at: number; path: string; files: number }
export type PlanFile = { path: string; size: number; at: number }
// a template for a new one (the Specs page's Templates; settings.planTemplates, unset: PLAN_TEMPLATES): its Markdown is the
// new one's README.md under its title. None picked: empty
export type PlanTemplate = { name: string; kind: PlanKind; text: string }
export type PlanPin = { project: string; kind: PlanKind; slug: string; title: string } // its title as last seen: the rail's tip

// The API this build's daemon speaks and its renderer expects: a running daemon with a lower one (it
// outlives app updates) gets a restart button in the status bar. Bump it when the renderer starts relying
// on a new method or behavior of the daemon.
export const RAIL_PINS = 5 // the rail's quick access: workspaces, terminals or browsers pinned there
// a file's blame (the daemon's blame): its commits, and each line's (lines[n - 1]: line n's index into commits; -1: none)
export type Blame = { commits: { sha: string; author: string; at: number; summary: string }[]; lines: number[] }
export const API = 236
export const REPO = 'https://github.com/igorkasyanchuk/laki' // About's and Help's links, the widget schema's raw URL

// the agent browser's open, click or fill (main's browse): what it caused. nav: the page it moved to; errors: the
// page's console errors meanwhile; blocked: popups and links off localhost refused; changed: click and fill's
// pageChanges ([]: none); scrolled: a scroll's place (its top, and the most it goes, in px)
export type BrowseDid = { url: string; title: string; nav?: { url: string; title: string }; errors?: string[]; blocked?: string[]; changed?: string[]; scrolled?: { top: number; max: number }; viewport?: string }
// #2: the agent browser's sizes (laki browser viewport <name|WxH>; unset: 1280×800), as the Preview's sizes bar has them
export const VIEWPORTS: Record<string, [number, number]> = { desktop: [1440, 900], laptop: [1280, 800], tablet: [768, 1024], phone: [390, 844] }
export function viewportOf(s: string): [number, number] | null {
  const k = s.trim().toLowerCase()
  if (Object.hasOwn(VIEWPORTS, k)) return VIEWPORTS[k]
  const m = /^(\d{3,4})\s*[x×]\s*(\d{3,4})$/.exec(k)
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [0, 0]
  return w >= 200 && h >= 200 && w <= 4000 && h <= 4000 ? [w, h] : null
}
// laki browser press's key (Enter, Escape, Meta+K, Shift+Tab, a letter, F5) as the DevTools protocol's key event:
// its modifiers (Alt 1, Control 2, Meta 4, Shift 8), key, code, Windows key code and the text it types (none with
// Control, Meta or Alt held). Throws on a key it doesn't know
const KEY_NAMES: Record<string, [string, number, string?]> = { Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], Space: ['Space', 32, ' '], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34] }
const KEY_ALIAS: Record<string, string> = { return: 'Enter', esc: 'Escape', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
const KEY_MODS: Record<string, number> = { alt: 1, option: 1, opt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 }
export function keyEvent(s: string): { modifiers: number; key: string; code: string; windowsVirtualKeyCode: number; text?: string } {
  const parts = s.trim().split(/\+(?=.)/)
  const name = parts.pop() ?? ''
  let modifiers = 0
  for (const m of parts) {
    const v = KEY_MODS[m.trim().toLowerCase()]
    if (!v) throw new Error(`press: ${m}? Meta (Cmd), Control, Alt or Shift, then + and the key`)
    modifiers |= v
  }
  const typed = (t: string) => (modifiers & 7 ? undefined : t) // Alt, Control or Meta held: a shortcut, no text
  const named = KEY_ALIAS[name.toLowerCase()] ?? Object.keys(KEY_NAMES).find(k => k.toLowerCase() === name.toLowerCase())
  if (named) {
    const [code, vk, text] = KEY_NAMES[named]
    return { modifiers, key: named === 'Space' ? ' ' : named, code, windowsVirtualKeyCode: vk, ...(text && typed(text) !== undefined && { text }) }
  }
  const f = /^f([1-9]|1[0-2])$/i.exec(name)
  if (f) return { modifiers, key: `F${f[1]}`, code: `F${f[1]}`, windowsVirtualKeyCode: 111 + Number(f[1]) }
  if ([...name].length === 1) {
    const up = name.toUpperCase()
    const key = /[a-z]/i.test(name) ? (modifiers & 8 ? up : name.toLowerCase()) : name
    const code = /[a-z]/i.test(name) ? `Key${up}` : /\d/.test(name) ? `Digit${name}` : ''
    return { modifiers, key, code, windowsVirtualKeyCode: /[a-z\d]/i.test(name) ? up.charCodeAt(0) : 0, ...(typed(key) !== undefined && { text: key }) }
  }
  throw new Error(`press: ${name || s}? a key like Enter, Escape, Tab, ArrowDown, F5 or a letter, with Meta+, Control+, Alt+ or Shift+ before it`)
}
export const CHANGED_MAX = 20
// a page's text lines added (+, in the new page's order) and gone (-), CHANGED_MAX at most, then how many more
// ponytail: counted as a multiset, so a line that only moved is neither (a list reordered says nothing)
export function pageChanges(was: string[], now: string[]) {
  const minus = (a: string[], b: string[]) => {
    const n = new Map<string, number>()
    for (const l of b) n.set(l, (n.get(l) ?? 0) + 1)
    return a.filter(l => {
      const c = n.get(l) ?? 0
      n.set(l, c - 1)
      return c <= 0
    })
  }
  const all = [...minus(now, was).map(l => `+ ${l}`), ...minus(was, now).map(l => `- ${l}`)].map(l => (l.length > 200 ? `${l.slice(0, 199)}…` : l))
  return all.length > CHANGED_MAX ? [...all.slice(0, CHANGED_MAX), `… ${all.length - CHANGED_MAX} more`] : all
}
// the CLI's lines for it: where it is (→ when it moved), what was refused, the errors, what changed
export const browseSays = (r: BrowseDid) =>
  [
    `${r.nav ? '→ ' : ''}${r.url}${r.title ? `  ${r.title}` : ''}`,
    ...(r.blocked ?? []).map(u => `blocked: ${u}`),
    ...(r.errors ?? []).map(e => `console error: ${e}`),
    ...(r.scrolled ? [`scrolled to ${r.scrolled.top} of ${r.scrolled.max}`] : []),
    ...(r.viewport ? [`viewport: ${r.viewport}`] : []),
    ...(r.changed ? (r.changed.length ? r.changed : ['(no changes)']) : []),
  ].join('\n')
// laki browser --expect-url: the page the agent means is the one it's on: the same address, or one under it (a path
// part, a query, a hash past it; not /login for /login-old); localhost and 127.0.0.1 the same
export function urlIs(cur: string, want: string): boolean {
  const n = (u: string) => u.trim().replace(/^(https?:\/\/)127\.0\.0\.1(?=[:/]|$)/, '$1localhost').replace(/^(https?:\/\/[^/?#]+)(?=[?#]|$)/, '$1/')
  const [c, w] = [n(cur), n(want)]
  const root = /^https?:\/\/[^/]+\/$/.test(w) // the home page: itself only (every page is under it)
  return c === w || (c.startsWith(w) && (root ? /^[?#]/.test(c.slice(w.length)) : /[/?#]$/.test(w) || /^[/?#]/.test(c.slice(w.length))))
}

// Recording mode (settings.recording): private workspaces (theirs, or their project's) out of the view a window draws, so
// the sidebar, rail pins, Board, Bird view, bubbles, ⌘K, counts, notifications and pages never show them; they keep running
export function veiled(v: View): View {
  if (!v?.settings?.recording) return v
  const ps = new Set(v.projects.filter(p => p.private).map(p => p.id))
  const ws = new Set(v.workspaces.filter(w => w.private || ps.has(w.project)).map(w => w.id))
  if (!ps.size && !ws.size) return v
  const ok = (o: { ws?: string; project?: string }) => !(o.ws && ws.has(o.ws)) && !(o.project && ps.has(o.project))
  return {
    ...v,
    projects: v.projects.filter(p => !ps.has(p.id)),
    workspaces: v.workspaces.filter(w => !ws.has(w.id)),
    tabs: v.tabs.filter(t => !ws.has(t.workspace)),
    schedules: v.schedules?.filter(ok),
    runs: v.runs?.filter(ok),
    todos: v.todos?.filter(ok),
    reminders: v.reminders?.filter(ok),
    flows: v.flows?.filter(f => ok({ ws: f.ws, project: f.project })),
    today: v.today && { ...v.today, ws: v.today.ws.filter(x => !ws.has(x.ws)) },
    digest: v.digest && { ...v.digest, rows: v.digest.rows.filter(ok) },
  }
}
