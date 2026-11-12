// Settings' agent sections: AI (Laki AI's backend, model, key, spending), Voice, the agent skill, and each agent's
// accounts in Agents & profiles. Settings.tsx re-exports it.
import { type Account, type AccountAgent, type AccountView, type AgentContext, AGENT_NAMES, type AgentUsage, AI_CONTEXT_MAX, AI_MODEL, AI_STEPS, type AiBackend, type AiSettings, type AiTotals, type Doctor, EFFORTS, HOME_ACCOUNT, IMAGE_DAYS, type Preset, VOICE_MODEL, type VoiceModel, type VoiceSettings } from '../../shared/types'
import { useEffect, useState } from 'react'
import { api, bridge } from './api'
import { Group, Says } from './SettingsKit'
import { Icon, IconButton, Switch } from './ui'
import { BACKENDS, money, tokens } from './Ai'
import { mostRoom } from './Usage'
import { shortPath } from './text'

// Settings › AI: Laki's own AI (daemon/ai.ts, the AI page): on, how it runs, the OpenRouter key (a file only you can
// read: sent once, never shown again), each backend's model, the steps an ask may take, and what it cost
export type AiApi = { state: () => Promise<{ key: boolean; totals: AiTotals }>; key: (key: string) => Promise<{ key: boolean }>; open: () => void }
const AI_HOW: [AiBackend, string][] = [
  ['openrouter', 'Any model OpenRouter has, paid per token with your API key'],
  ['claude', 'Claude Code in the background (claude -p), on your Claude plan or its API key'],
  ['codex', 'Codex in the background (codex exec), on your ChatGPT plan'],
]
// the OpenRouter key's field: Laki AI's and Voice's cloud share one key, in a file only you can read (never shown again)
const KEY_HINT = "Kept in a file only you can read, in Laki's data folder: never in its settings, never shown again. Laki AI and Voice share it"
function OpenRouterKey({ has, save }: { has?: boolean; save: (key: string) => Promise<{ key: boolean }> }) {
  const [key, setKey] = useState('')
  const [said, setSaid] = useState('')
  const go = (k: string) => save(k).then(r => (setKey(''), setSaid(r.key ? 'Saved' : 'Removed')), e => setSaid(e.message))
  return (
    <>
      <div className="row-buttons">
        <input
          className="mono grow"
          type="password"
          autoComplete="off"
          value={key}
          placeholder={has ? '•••••••• saved: paste another to replace it' : 'sk-or-v1-…'}
          spellCheck={false}
          aria-label="OpenRouter API key"
          onChange={e => (setKey(e.target.value), setSaid(''))}
          onKeyDown={e => e.key === 'Enter' && key.trim() && go(key)}
        />
        <button type="button" className="primary" disabled={!key.trim()} onClick={() => go(key)}>
          Save
        </button>
        {has && (
          <button type="button" onClick={() => go('')}>
            Remove
          </button>
        )}
      </div>
      {said && <p className="muted small">{said}</p>}
    </>
  )
}

// Settings › Voice (voice.ts): the mic and hold Fn, on this Mac (macOS dictation) or in the cloud (Laki records,
// OpenRouter's speech-to-text writes it down). The models: OpenRouter's speech-to-text ones, the first the default, each
// with its price as of PRICED (Q11: OpenRouter's now when its list loads, voiceModels; its other models under them);
// Another model… takes any id
const PRICED = '11 Nov 2026'
const VOICE_MODELS: [string, string, string][] = [
  [VOICE_MODEL, 'MAI-Transcribe 2 · Microsoft: 60 languages, mixed in one sentence too', '$0.10/h'],
  ['openai/whisper-large-v3-turbo', 'Whisper Large v3 Turbo · about 100 languages, fast and cheap', '$0.012/h'],
  ['nvidia/parakeet-tdt-0.6b-v3', 'Parakeet TDT v3 · NVIDIA: 25 European languages', '$0.06/h'],
  ['openai/gpt-4o-transcribe', 'GPT-4o Transcribe · OpenAI', '$2.50 / $10 per M tokens'],
  ['openai/gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe · OpenAI', '$1.25 / $5 per M tokens'],
  ['elevenlabs/scribe-v2', 'Scribe v2 · ElevenLabs', '$0.22/h'],
  ['deepgram/nova-3', 'Nova-3 · Deepgram', '$0.26/h'],
  ['google/gemini-3.5-transcribe', 'Gemini 3.5 Transcribe · Google', '$2 / $12 per M tokens'],
  ['mistralai/voxtral-mini-transcribe', 'Voxtral Mini Transcribe · Mistral', '$0.18/h'],
]
export function VoiceSection({ v, keyApi, onChange }: { v: VoiceSettings; keyApi: AiApi; onChange: (v: VoiceSettings) => void }) {
  const [has, setHas] = useState<boolean>()
  useEffect(() => void keyApi.state().then(st => setHas(st.key), () => {}), [])
  const cloud = v.engine === 'cloud' && v.on !== false // turned off before it was on by default: this Mac's until Cloud is picked again
  const model = v.model || VOICE_MODEL
  const [live, setLive] = useState<{ at: number; models: VoiceModel[] } | { error: string } | null>(null) // OpenRouter's list now
  useEffect(() => void (cloud && !live && api.call<{ at: number; models: VoiceModel[] }>('voiceModels').then(setLive, (e: Error) => setLive({ error: e.message }))), [cloud])
  const now = live && 'models' in live ? live.models : undefined
  const priceOf = (id: string, was: string) => (now ? now.find(m => m.id === id)?.price : was)
  const more = now?.filter(m => !VOICE_MODELS.some(x => x[0] === m.id)) ?? []
  const [other, setOther] = useState(!VOICE_MODELS.some(m => m[0] === model)) // Another model…: a typed id
  const isMore = other && more.some(m => m.id === model)
  return (
    <>
      <h2>Voice</h2>
      <p className="muted small">
        The mic in every prompt box, and in the cloud hold Fn: talk instead of typing. On this Mac it's macOS dictation; in the cloud Laki records you,
        a speech-to-text model on OpenRouter writes it down, and the text goes where your cursor is.
      </p>
      <Group title="Speech to text">
        <div className="grid2">
          <label>
            Engine
            <select value={cloud ? 'cloud' : 'device'} onChange={e => onChange({ ...v, on: undefined, engine: e.target.value === 'cloud' ? 'cloud' : undefined })}>
              <option value="device">On this Mac: macOS dictation</option>
              <option value="cloud">Cloud: OpenRouter</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          {cloud
            ? 'Your recording goes to OpenRouter and the model you pick below, then is gone: Laki keeps neither the audio nor the text. Paid per minute of audio with your OpenRouter key, about $0.10 an hour with MAI-Transcribe 2.'
            : 'Free, and on this Mac where macOS can (System Settings › Keyboard › Dictation: its languages and microphone). Press Fn twice anywhere to start it. Cloud adds a choice of model and hold Fn to talk.'}
        </p>
      </Group>
      {cloud && (
        <>
          <Group title="OpenRouter API key" hint={KEY_HINT}>
            <OpenRouterKey has={has} save={k => keyApi.key(k).then(r => (setHas(r.key), r))} />
          </Group>
          <Group title="Model" hint="A speech-to-text model on OpenRouter (openrouter.ai/models, Speech to text); the language is found by itself">
            <label>
              Model
              <select
                value={isMore ? model : other ? '' : model}
                onChange={e => (e.target.value ? (setOther(!VOICE_MODELS.some(m => m[0] === e.target.value)), onChange({ ...v, model: e.target.value === VOICE_MODEL ? undefined : e.target.value })) : (setOther(true), isMore && onChange({ ...v, model: undefined })))}
              >
                {VOICE_MODELS.map(([id, says, was]) => (
                  <option key={id} value={id}>
                    {says}
                    {id === VOICE_MODEL ? ' (default)' : ''}
                    {(p => (p ? ` · ${p}` : ''))(priceOf(id, was))}
                  </option>
                ))}
                {more.length > 0 && (
                  <optgroup label="More on OpenRouter">
                    {more.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.price}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="">Another model…</option>
              </select>
            </label>
            <p className="muted small">
              {now
                ? `Prices: OpenRouter's now (${new Date((live as { at: number }).at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}); /h is an hour of audio`
                : live
                  ? `Prices as of ${PRICED}: OpenRouter's list didn't load (${(live as { error: string }).error}); /h is an hour of audio`
                  : `Prices as of ${PRICED}, OpenRouter's now in a moment; /h is an hour of audio`}
            </p>
            {other && !isMore ? (
              <label>
                Model id
                <input className="mono" value={v.model ?? ''} placeholder={VOICE_MODEL} spellCheck={false} autoFocus onChange={e => onChange({ ...v, model: e.target.value.trim() || undefined })} />
              </label>
            ) : (
              <p className="muted small mono">{model}</p>
            )}
          </Group>
          {/Mac/.test(navigator.userAgent) /* a Mac's (Linux's Fn seldom reaches an app) */ && (
          <Group title="Hold Fn" hint="Fn is the 🌐 key on newer Macs">
            <div className="setting-box">
              <Switch className="switch-row" on={v.fn !== false} onChange={fn => onChange({ ...v, fn })}>
                <Says title="Hold Fn to talk" hint="Anywhere in Laki: hold Fn, talk, let go, and it's typed where your cursor is: a prompt, a field, a terminal. Another key while you hold it, or Esc, drops it" />
              </Switch>
            </div>
            {v.fn !== false && (
              <div className="setting-box">
                <Switch className="switch-row" on={v.lock !== false} onChange={lock => onChange({ ...v, lock })}>
                  <Says title="Lock by double tap" hint="Tap Fn twice to keep the mic on without holding it: the bar says Locked. Fn again stops it and types what you said; Esc drops it" />
                </Switch>
              </div>
            )}
            <p className="muted small">
              So that macOS doesn't open its emoji picker or dictation as well, set System Settings › Keyboard › Press 🌐 key to: Do Nothing.
            </p>
            {bridge?.dictationSettings && (
              <div className="row-buttons">
                <button type="button" onClick={() => bridge!.dictationSettings!()}>
                  Open Keyboard settings
                </button>
              </div>
            )}
          </Group>
          )}
          <Group title="Word fixes" hint="Names it keeps getting wrong: a line each, what it writes → what you meant. Any case, whole words; the bar says what it changed">
            <textarea className="mono" rows={4} maxLength={20000} spellCheck={false} value={v.fixes ?? ''} placeholder={'lucky, lakey → Laki\nwork tree → worktree\nnotify → ntfy'} aria-label="Word fixes" onChange={e => onChange({ ...v, fixes: e.target.value || undefined })} />
            <p className="muted small">Done here, after the transcript comes back: nothing more goes to OpenRouter.</p>
            <div className="setting-box">
              <Switch className="switch-row" on={v.fillers !== false} onChange={fillers => onChange({ ...v, fillers })}>
                <Says title="Remove filler words" hint="Um, uh, hmm and the like, in the languages it knows; words that mean something (like, so) stay. The bar says how many went" />
              </Switch>
            </div>
          </Group>
          <Group title="When you stop talking">
            <div className="setting-box">
              <Switch className="switch-row" on={v.send === true} onChange={send => onChange({ ...v, send })}>
                <Says title="Send as you stop talking" hint="Letting go of Fn sends what you said to the prompt box or the idle agent" />
              </Switch>
            </div>
            <div className="setting-box">
              <Switch className="switch-row" on={v.history !== false} onChange={history => onChange({ ...v, history })}>
                <Says title="Keep the last transcripts" hint="Your last 10, in memory only: gone when Laki quits or Recording mode is on. ⌥Fn, or Earlier on the bar, lists them to type again, copy or send to another agent" />
              </Switch>
            </div>
          </Group>
        </>
      )}
      <Group title="Route by first words">
        <div className="setting-box">
          <Switch className="switch-row" on={v.route !== false} onChange={route => onChange({ ...v, route })}>
            <Says title="Route by first words" hint="In the bubbles' Say it and the talk key's pill: start with who gets it, then a pause or a comma. “Checkout flow, fix the button” goes to that workspace's agent, “@pay: retry” to that agent, “New task in Shop, add a dark mode” to a new task there, and its name for Laki AI to Laki AI. Shown a moment first: Tab changes it, Esc stops it. Never a terminal" />
          </Switch>
        </div>
        {v.route !== false && (
          <label>
            Laki AI's name, said first
            <input value={v.aiWord ?? ''} placeholder="Laki" maxLength={40} onChange={e => onChange({ ...v, aiWord: e.target.value.trim() || undefined })} />
          </label>
        )}
      </Group>
    </>
  )
}

// presets: Agent presets of claude or codex, each a backend of its own (its env: an account of its own)
export function AiSection({ api, ai, glow, onGlow, next, onNext, presets, onChange, imageDays, onImageDays }: { api: AiApi; ai: AiSettings; glow: boolean; onGlow: (on: boolean) => void; next: boolean; onNext: (on: boolean) => void; presets: Preset[]; onChange: (ai: AiSettings) => void; imageDays?: number; onImageDays: (d: number | undefined) => void }) {
  const [st, setSt] = useState<{ key: boolean; totals: AiTotals }>()
  useEffect(() => void api.state().then(setSt, () => {}), [])
  const backend = ai.backend ?? 'openrouter'
  // the agents' presets, but the plain ones (claude, codex as they are: the options above them)
  const mine = presets.filter(p => (p.agent === 'claude' || p.agent === 'codex') && (p.name !== p.agent || Object.keys(p.env ?? {}).length))
  const preset = backend !== 'openrouter' ? mine.find(p => p.name === ai.preset && p.agent === backend) : undefined
  const pick = (v: string) => {
    const p = v.startsWith('preset:') ? mine.find(x => x.name === v.slice(7)) : undefined
    onChange({ ...ai, backend: (p?.agent ?? v) as AiBackend, preset: p?.name })
  }
  const sum = (k: 'today' | 'month', label: string) => (
    <div>
      <b>{money(st?.totals[k].cost ?? 0)}</b>
      <span>
        {label} · {st?.totals[k].calls ?? 0} asks · {tokens((st?.totals[k].in ?? 0) + (st?.totals[k].out ?? 0))} tokens
      </span>
    </div>
  )
  return (
    <>
      <h2>AI</h2>
      <p className="muted small">
        Laki's own assistant: ask it, in words, to start workspaces, review PRs from a screenshot, send prompts to your agents or tell you what they're
        doing. It works Laki through the same tools as <code>laki mcp</code>, only when you ask, and never archives or deletes workspaces, ships or merges. On unless
        you turn it off below.
      </p>
      <Group title="Laki AI">
        <div className="setting-box">
          <Switch className="switch-row" on={ai.on !== false} onChange={on => onChange({ ...ai, on })}>
            <Says title="Turn on Laki AI" hint="The AI page (the rail's AI, ⌘K) and laki ai in the terminal" />
          </Switch>
          <Switch className="switch-row" on={glow} onChange={onGlow}>
            <Says title="Laki AI's glow" hint="As Laki AI reads a tab's screen or uses the agent browser, a moving glow around that tab (else the window): it was looking" />
          </Switch>
          <Switch className="switch-row" on={ai.skill !== false} onChange={skill => onChange({ ...ai, skill })}>
            <Says
              title="Laki's skill"
              hint="More of Laki for it: your open PRs and others' in your repos, projects' notes and memory, renaming and pinning, shells, your actions and prompt templates, to-dos. It asks you with options when unsure, and removes a memory item, task, tab or to-do only when you press Yes"
            />
          </Switch>
        </div>
      </Group>
      <Group title="Your instructions" hint="Added to Laki AI's instructions at every ask: who you are, how you work, what it should know. It can't lift what Laki AI may not do">
        <textarea rows={5} maxLength={AI_CONTEXT_MAX} value={ai.context ?? ''} placeholder={'I review PRs in the morning. Name new workspaces in kebab case.\nOur staging is on fly.io.'} aria-label="Your instructions for Laki AI" onChange={e => onChange({ ...ai, context: e.target.value || undefined })} />
      </Group>
      <Group title="Runs with">
        <div className="grid2">
          <label>
            Backend
            <select value={preset ? `preset:${preset.name}` : backend} onChange={e => pick(e.target.value)}>
              {AI_HOW.map(([id]) => (
                <option key={id} value={id}>
                  {BACKENDS[id]}
                </option>
              ))}
              {mine.length > 0 && (
                <optgroup label="Your profiles">
                  {mine.map(p => (
                    <option key={p.name} value={`preset:${p.name}`}>
                      {p.name} · {BACKENDS[p.agent as AiBackend]}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        <p className="muted small">
          {preset
            ? `Your profile ${preset.name}: ${BACKENDS[backend]} on its account (none: the default) with its env${Object.keys(preset.env ?? {}).length ? ` (${Object.keys(preset.env!).join(', ')})` : ''}. Its model, effort and flags are a tab's, not used here.`
            : AI_HOW.find(x => x[0] === backend)?.[1]}
          {backend !== 'openrouter' && !preset && ' Another account: a profile on it (Agents & profiles), then pick it here; none: the default account.'}
        </p>
        <label>
          Model
          <input
            className="mono"
            value={ai.models?.[backend] ?? ''}
            placeholder={backend === 'openrouter' ? AI_MODEL : backend === 'claude' ? 'its default: sonnet, opus, haiku…' : 'its default: gpt-5.6-sol…'}
            spellCheck={false}
            onChange={e => onChange({ ...ai, models: { ...ai.models, [backend]: e.target.value.trim() || undefined } })}
          />
        </label>
        {(backend === 'claude' || backend === 'codex') && (
          <label>
            Effort
            <select value={ai.efforts?.[backend] ?? ''} onChange={e => onChange({ ...ai, efforts: { ...ai.efforts, [backend]: e.target.value || undefined } })}>
              <option value="">Its default</option>
              {(EFFORTS[backend] ?? []).map(x => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        )}
        {backend === 'openrouter' && (
          <p className="muted small">
            A model id from openrouter.ai/models, one that can call tools (and read images, for screenshots).
          </p>
        )}
      </Group>
      {backend === 'openrouter' && (
        <Group title="OpenRouter API key" hint={KEY_HINT}>
          <OpenRouterKey has={st?.key} save={k => api.key(k).then(r => (setSt(x => x && { ...x, key: r.key }), r))} />
        </Group>
      )}
      <Group title="Chat button" hint="A button in the window's bottom right corner opens Laki AI over what you're doing, the same conversation as the AI page; with each ask it tells the AI the page, workspace and tab you're on and the tab's screen">
        <div className="setting-box">
          <Switch className="switch-row" on={ai.float !== false} onChange={v => onChange({ ...ai, float: v })}>
            <Says title="Chat button in the corner" hint="Everywhere but the AI page, Settings, Help, and where a chat is on screen already: Specs & Brainstorms, Workflows" />
          </Switch>
          <Switch className="switch-row" on={ai.show !== false} onChange={v => onChange({ ...ai, show: v ? undefined : false })}>
            <Says title="Show its work" hint="Its window opens when you talk to it (the talk key, Say it), so you see what it does and its Yes / No; and a command it runs at your Yes shows its tab, with what it printed in the chat" />
          </Switch>
          <Switch className="switch-row" on={!!ai.alerts} onChange={v => onChange({ ...ai, alerts: v || undefined })}>
            <Says title="Important alerts on its own" hint="Off: Laki AI puts an important alert on your screen only when you ask for one in the chat, or Your instructions say when. On: also when it thinks you should know" />
          </Switch>
          <Switch className="switch-row" on={next} onChange={onNext}>
            <Says title="Guess my next prompt" hint="As a Claude Code or Codex turn ends, Laki AI's model guesses what you'd send next; the Reader's empty box shows it greyed out: Tab takes it, Esc hides it. One more request to the model per turn" />
          </Switch>
        </div>
      </Group>
      <Group title="Pasted images" hint="Screenshots you paste into Laki AI's chats and into new workspaces' prompts, and files you attach to a prompt, kept in Laki's folder: the chat shows them as thumbnails, a click shows one big. Older ones go">
        <label>
          Keep pasted images (days)
          <input type="number" min={1} max={3650} placeholder={String(IMAGE_DAYS)} value={imageDays || ''} onChange={e => onImageDays(e.target.value ? Math.max(1, Math.min(3650, Math.round(Number(e.target.value)) || 1)) : 0)} />
        </label>
      </Group>
      <Group title="Steps" hint="OpenRouter: how many rounds of tool calls one ask may take before it stops, a guard against a model that loops (claude -p and codex exec keep their own)">
        <label>
          Rounds at most
          <input type="number" min={1} max={100} placeholder={String(AI_STEPS)} value={ai.steps ?? ''} onChange={e => onChange({ ...ai, steps: e.target.value ? Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 1)) : undefined })} />
        </label>
      </Group>
      <Group title="Spending" hint="Every ask, its tokens and cost, is on the AI page. OpenRouter's cost is its own; claude -p's is Claude Code's estimate; codex exec's is your plan">
        <div className="setting-box">
          <Switch className="switch-row" on={!ai.hideCost} onChange={v => onChange({ ...ai, hideCost: !v })}>
            <Says title="Show costs ($)" hint="On the AI page: today's spend, each call's cost and the totals. Off: asks and tokens only" />
          </Switch>
        </div>
        <div className="sched-stats ai-totals">
          {sum('today', 'today')}
          {sum('month', 'this month')}
        </div>
        <div className="row-buttons">
          <button type="button" onClick={api.open}>
            Open the AI page
          </button>
        </div>
      </Group>
    </>
  )
}

export type SkillInfo = { agent: string; skill?: string; name: string; path: string; state: 'missing' | 'installed' | 'outdated'; foreign?: boolean; mcp?: string; mcpIn?: string } // mcpIn: a config file the lines go in; skill: laki (none: an older daemon's), laki-widget, laki-orchestrate or laki-specs

// Settings › Agents & profiles' accounts (the daemon's accounts.ts): who each signs in as, and what to do with them
export type AccountsApi = { load: () => Promise<AccountView[]>; usage: () => Promise<AgentUsage[]>; add: (agent: AccountAgent, name: string) => Promise<Account>; rename: (id: string, name: string) => Promise<unknown>; remove: (a: AccountView) => Promise<unknown>; login: (a: AccountView) => Promise<unknown> }

// an agent's accounts: its own sign-in, then the ones added; a click on the circle makes one the default for new
// sessions (running tabs keep theirs), Sign in opens a terminal with the agent's login in its folder
// fallback: Auto fallback's order (settings.limitFallback): a tab at its plan limit goes on on the next of these
export function AccountsBlock({ agent, api, views, usage, use, onUse, reload, fallback = [], onFallback }: { agent: AccountAgent; api: AccountsApi; views: AccountView[]; usage: AgentUsage[]; use: string; onUse: (id: string) => void; reload: () => void; fallback?: string[]; onFallback?: (ids: string[]) => void }) {
  const [names, setNames] = useState<Record<string, string>>({})
  const mine = views.filter(v => v.agent === agent)
  const most = mostRoom(usage, agent)
  return (
    <div className="accounts" role="radiogroup" aria-label={`${AGENT_NAMES[agent]} accounts`}>
      {mine.map(v => (
        <div key={v.id} className={`account-row${v.id === use ? ' on' : ''}`}>
          <button type="button" role="radio" aria-checked={v.id === use} aria-label="The default account for new sessions" className="account-pick" data-tip={v.id === use ? 'New sessions start on it' : 'Make it the default for new sessions (running tabs keep theirs)'} onClick={() => onUse(v.id)} />
          <div className="account-who">
            {v.id === HOME_ACCOUNT ? (
              <b>Default sign-in</b>
            ) : (
              <input value={names[v.id] ?? v.name} aria-label="Account name" onChange={e => setNames(n => ({ ...n, [v.id]: e.target.value }))} onBlur={e => (e.target.value.trim() ? e.target.value !== v.name && api.rename(v.id, e.target.value).then(reload, () => {}) : setNames(({ [v.id]: _, ...n }) => n)) /* blank: its name back */} />
            )}
            <span className="muted small">
              {[v.email ?? (v.signedIn ? 'signed in' : 'not signed in'), v.plan && v.plan[0].toUpperCase() + v.plan.slice(1), v.id === HOME_ACCOUNT ? shortPath(v.dir) : null].filter(Boolean).join(' · ')}
            </span>
          </div>
          {most === v.id && <span className="tag tag-open" data-tip="The most room left in its shortest limit (the status bar's ring)">most room</span>}
          {onFallback && mine.length > 1 && (
            <button
              type="button"
              className={`account-fb${fallback.includes(v.id) ? ' on' : ''}`}
              data-tip={fallback.includes(v.id) ? `Number ${fallback.indexOf(v.id) + 1} in the fallback order: a click takes it out` : 'Add it to the fallback order: a tab at its plan limit goes on on the next account in it'}
              aria-pressed={fallback.includes(v.id)}
              onClick={() => onFallback(fallback.includes(v.id) ? fallback.filter(x => x !== v.id) : [...fallback, v.id])}
            >
              {fallback.includes(v.id) ? fallback.indexOf(v.id) + 1 : '+'}
            </button>
          )}
          {!v.signedIn && <span className="tag tag-conflict">not signed in</span>}
          <button type="button" onClick={() => api.login(v)}>
            {v.signedIn ? 'Sign in again' : 'Sign in'}
          </button>
          {v.id !== HOME_ACCOUNT && <IconButton icon="trash" title="Remove account (its sign-in too)" onClick={() => api.remove(v).then(reload, () => {})} />}
        </div>
      ))}
      {onFallback && mine.length > 1 && (
        <p className="muted small">
          {fallback.filter(id => mine.some(v => v.id === id)).length > 1
            ? `Auto fallback: a ${AGENT_NAMES[agent]} tab at its plan limit restarts on the next numbered account (its chat resumes there) and goes on, instead of waiting for the reset.`
            : `Auto fallback: number two or more accounts (the round buttons) and a ${AGENT_NAMES[agent]} tab at its plan limit goes on on the next one instead of waiting for the reset.`}
        </p>
      )}
      <div className="row">
        <button type="button" onClick={() => api.add(agent, '').then(a => api.login({ ...a, signedIn: false, default: false }), () => {})}>
          <Icon name="plus" /> Add {AGENT_NAMES[agent]} account
        </button>
      </div>
    </div>
  )
}

// how an app reads and writes its skill; app: its name, for the text
export type SkillApi = { app: string; load: () => Promise<SkillInfo[]>; set: (agent: string, on: boolean, skill?: string) => Promise<SkillInfo[]>; doctor?: () => Promise<Doctor> }
// the skills Settings offers, in its order: what each teaches
const SKILL_KINDS: [string, string, string][] = [
  ['laki', 'Laki', 'list projects and workspaces, start a workspace with an agent and a prompt, message agents and read their screens, all through the command line'],
  ['laki-widget', 'Extension creator', "make and change the sidebar's extensions: the files, the template language, JS ones, actions, checking them with laki widget"],
  ['laki-orchestrate', 'Orchestrator', 'split work across several agents at once, a workspace each: plan it, start them, follow them up and bring their results together (in Laki’s Claude tabs also /laki:orchestrate, in its OpenCode tabs /laki-orchestrate)'],
  ['laki-specs', 'Specs & brainstorms', "brainstorm with you one question at a time (approaches, then a design you approve) and write it into Laki as a spec or a brainstorm; read and work from yours (laki plan)"],
]

// the skill that teaches the agents about the app, in each one's folder in the user's home
export function SkillSection({ api }: { api: SkillApi }) {
  const [rows, setRows] = useState<SkillInfo[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [doc, setDoc] = useState<Doctor | null>(null)
  const fail = (e: any) => setErr(String(e?.message ?? e))
  useEffect(() => void api.load().then(setRows, fail), [])
  useEffect(() => void api.doctor?.().then(setDoc, () => {}), [])
  const set = (agent: string, on: boolean, skill?: string) => {
    setBusy(true)
    setErr('')
    api.set(agent, on, skill).then(setRows, fail).finally(() => setBusy(false))
  }
  // out of date for this one (not another's: foreign), every one at once
  const old = rows?.filter(r => r.state === 'outdated' && !r.foreign) ?? []
  const all = () => {
    setBusy(true)
    setErr('')
    old
      .reduce((p, r) => p.then(() => api.set(r.agent, true, r.skill)), Promise.resolve<SkillInfo[]>([]))
      .then(setRows, e => (fail(e), api.load().then(setRows, () => {}))) // the ones written before it: their rows again
      .finally(() => setBusy(false))
  }
  return (
    <>
      <h2>Agent skill</h2>
      <p className="muted">
        Teaches your agents about {api.app}, each skill installed on its own. It goes in your home folder, so every session has it, in {api.app} or not.
      </p>
      {err && <div className="warn small">{err}</div>}
      {old.length > 0 && (
        <div className="row skill-old">
          <Says title={`${old.length} out of date`} hint={`Installed from an older ${api.app}, or changed since: their agents read older commands and paths`} />
          <button className="primary" disabled={busy} onClick={all}>
            Update {old.length === 1 ? 'it' : 'all'}
          </button>
        </div>
      )}
      {!rows && !err && <div className="muted small">Loading…</div>}
      {SKILL_KINDS.filter(([k]) => rows?.some(r => (r.skill ?? 'laki') === k)).map(([k, title, what]) => (
        <Group key={k} title={title} hint={`Teaches them to ${what}.`}>
          {rows!.filter(r => (r.skill ?? 'laki') === k).map(r => (
            <div key={r.agent} className="preset">
              <div className="row">
                <b>{r.name}</b>
                <span className={r.state === 'installed' ? 'small' : 'muted small'} data-tip={r.foreign ? `Its laki runs another ${api.app}'s daemon (another data folder): Use this one points it here` : undefined}>
                  {r.state === 'installed' ? 'installed' : r.foreign ? `another ${api.app}'s` : r.state === 'outdated' ? 'out of date' : 'not installed'}
                </span>
                <span className="grow" />
                {r.state !== 'installed' && (
                  <button className={r.state === 'outdated' && !r.foreign ? 'primary' : ''} disabled={busy} onClick={() => set(r.agent, true, r.skill)}>
                    {r.state === 'missing' ? 'Install' : r.foreign ? 'Use this one' : 'Update'}
                  </button>
                )}
                {r.state !== 'missing' && (
                  <button disabled={busy} onClick={() => set(r.agent, false, r.skill)}>
                    Remove
                  </button>
                )}
              </div>
              <div className="muted small mono">{r.path}</div>
            </div>
          ))}
        </Group>
      ))}
      <p className="muted small">It holds where {api.app} is installed: after moving the app, update it here.</p>
      {doc && (
        <Group title="The iOS Simulator and apps' windows" hint="laki screen (MCP's laki_device): agents take a screenshot of the booted simulator or of any app's window, to see what they built">
          <div className="row">
            <Says title={doc.idb ? 'idb found: agents can also tap, swipe and type in the simulator' : "idb isn't installed: agents take screenshots, but can't tap, swipe or type in the simulator"} hint={doc.idb ? 'laki screen tap, swipe, type and describe' : 'brew install facebook/fb/idb-companion, then pipx install fb-idb; open Settings again'} />
          </div>
          <p className="muted small">An app's window needs Screen Recording for {api.app}: System Settings › Privacy &amp; Security › Screen &amp; System Audio Recording.</p>
        </Group>
      )}
      {rows?.some(r => r.mcp) && (
        <>
          <h2>MCP server</h2>
          <p className="muted">
            Or give agents {api.app}'s tools over MCP: its state, a new workspace, a message to an agent, a tab's screen, a diff, scheduled tasks. Nothing that deletes, archives or ships.
            Run the command once in a terminal (or paste the lines into the file named); it goes in the agent's own settings.
          </p>
          {rows.map(
            r =>
              r.mcp && (
                <div key={r.agent} className="preset">
                  <div className="row">
                    <b>{r.name}</b>
                    {r.mcpIn && <span className="muted small">in {r.mcpIn}, merged with what's there</span>}
                    <span className="grow" />
                    <button onClick={() => navigator.clipboard.writeText(r.mcp!).then(() => (setCopied(r.agent), setTimeout(() => setCopied(''), 2000)), fail)}>{copied === r.agent ? 'Copied' : 'Copy'}</button>
                  </div>
                  <div className="muted small mono" style={{ wordBreak: 'break-all', userSelect: 'text', whiteSpace: 'pre-wrap' }}>{r.mcp}</div>
                </div>
              ),
          )}
        </>
      )}
    </>
  )
}

// F6: what an agent sees in a project (the daemon's agentContext): the rule files it loads in order, Laki's memory it
// gets, the MCP servers its own config gives it (env values and tokens masked). Read only: Open file (your editor), and
// Add a server…, Remove… and Check health: the agent's own CLI command typed in a terminal for you to run
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
export function WhatItSees({ agent, projects, project: first, onType }: { agent: 'claude' | 'codex'; projects: { id: string; name: string }[]; project?: string; onType: (cmd: string, project?: string) => void }) {
  const [project, setProject] = useState(first ?? projects[0]?.id ?? '')
  const [c, setC] = useState<AgentContext | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true // another project picked meanwhile: this answer is that one's no more
    setC(null)
    setErr('')
    void api.call<AgentContext>('agentContext', { agent, project: project || undefined }).then(
      x => live && setC(x),
      (e: Error) => live && setErr(e.message),
    )
    return () => void (live = false)
  }, [agent, project])
  const at = project || undefined
  return (
    <div className="sees">
      <div className="row">
        <label className="small">
          In{' '}
          <select value={project} aria-label="Project" onChange={e => setProject(e.target.value)}>
            <option value="">no project (your own only)</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err && <p className="err small">{err}</p>}
      {!c && !err && <p className="muted small">Reading…</p>}
      {c && (
        <>
          <h4>Rules, in the order it reads them</h4>
          {c.rules.length ? (
            <ul className="sees-list">
              {c.rules.map(r => (
                <li key={r.path}>
                  <span className="mono" title={r.path}>
                    {r.at}
                  </span>
                  <span className="muted small">
                    {' '}
                    · {r.scope} · {kb(r.size)}
                    {r.from && ` · imported by ${r.from}`}
                  </span>
                  <button className="ghost sm" onClick={() => void api.call('agentContextOpen', { agent, project: at, path: r.path }).catch((e: Error) => setErr(e.message))}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No {agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'} files.</p>
          )}
          <p className="muted small">
            Laki's memory, added to its instructions: {c.memory.global} global, {c.memory.mine} of this project's from you, {c.memory.learned} learned ({kb(c.memory.bytes)}).
          </p>
          <h4>MCP servers</h4>
          {c.servers.length ? (
            <ul className="sees-list">
              {c.servers.map(s => (
                <li key={`${s.scope}:${s.name}`}>
                  <b>{s.name}</b>
                  <span className="muted small">
                    {' '}
                    · {s.transport} · {s.scope}
                    {s.off && ' · off'}
                  </span>
                  <span className="mono small sees-cmd" title={s.file}>
                    {s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ')}
                    {s.env && ` · env ${s.env.join(', ')}`}
                    {s.headers && ` · headers ${s.headers.join(', ')}`}
                  </span>
                  {agent === 'claude' || s.scope === 'user' ? (
                    <button className="ghost sm" onClick={() => onType(agent === 'claude' ? `claude mcp remove ${sh(s.name)} -s ${s.scope}` : `codex mcp remove ${sh(s.name)}`, at)}>
                      Remove…
                    </button>
                  ) : (
                    <span className="muted small" title={s.file}> · in the project's {s.file.split('/').slice(-2).join('/')}: codex mcp remove only edits yours</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None in its config.</p>
          )}
          <div className="row">
            <button className="sm" data-tip={`${agent} mcp add, typed in a terminal for you to finish and run`} onClick={() => onType(`${agent} mcp add `, at)}>
              Add a server…
            </button>
            <button className="ghost sm" data-tip={`${agent} mcp list: it starts each server to check it`} onClick={() => onType(`${agent} mcp list`, at)}>
              Check health…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
