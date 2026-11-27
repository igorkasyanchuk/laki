// a project's settings (its scripts, env, folders, templates, actions), and the fields Settings' global sections share
// with it. Settings.tsx re-exports it.
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { bridge } from './api'
import { ask, Icon, IconButton, iconItems, iconWords, ProjectMark, Switch, TAB_COLORS, useMenu } from './ui'
import { MAIL_OK, mergeActions, parseMails, type RunAction, type Template, templatesFor } from './text'
import { actionSlug, type Agent, AGENT_NAMES, AGENT_VARS, AGENTS, CHECK_STEPS, COST_WARN, type CostWarn, type DoneCheck, type Memory, type MergeMethod, type PRAllow, prAllows, type SecretKept } from '../../shared/types'
import { Group, Says, Scope } from './SettingsKit'
import { emojiOf, emojiWords } from '../../shared/icons'
import { ALWAYS_ASK_EG, type AllowRule, RULE_TOOLS, rulePattern } from '../../shared/ask'
import { MCP_AGENTS, MCP_NAME, type McpServer } from '../../shared/mcp'
import { ago } from '../../shared/widget'

const EXAMPLE_TEMPLATE: Template = {
  name: 'fix',
  text: 'Fix this in {{project}}: {{prompt}}\n\nFind the cause first. Write a test that fails before the fix and passes after it, run the tests, then sum up what changed.',
}

const SCRIPTS = [
  { k: 'setup', label: 'Setup', hint: 'Runs in each new worktree, in a setup tab; agents and Run wait for it. $LAKI_PROJECT_PATH is the repo itself.', eg: 'npm install\ncp "$LAKI_PROJECT_PATH/.env" .env' },
  { k: 'teardown', label: 'Teardown', hint: 'Runs when a worktree workspace is deleted or archived, for a minute at most (never in the project’s own folder).', eg: 'docker compose down' },
  { k: 'run', label: 'Run', hint: 'The Run button: starts it in a run tab, e.g. a dev server on $PORT.', eg: 'npm run dev -- --port $PORT' },
  { k: 'test', label: 'Test', hint: 'Run ▾ › Test: in a test tab of its own; run again, the last one goes.', eg: 'npm test' },
  { k: 'lint', label: 'Lint', hint: 'Run ▾ › Lint: in a lint tab of its own.', eg: 'npm run lint' },
  { k: 'format', label: 'Format', hint: 'Run ▾ › Format: in a format tab of its own.', eg: 'npx prettier --write .' },
  { k: 'deploy', label: 'Deploy', hint: 'Run ▾ › Deploy: in a deploy tab of its own, after you confirm.', eg: 'npm run deploy' },
  { k: 'ticket', label: 'Ticket', hint: "Prints each workspace's ticket: JSON {key, title, status, url}, or a line KEY title. Run in each workspace every 5 minutes and as its branch changes ($LAKI_BRANCH, $LAKI_WORKSPACE); its key and status show on the workspace's row, its title on the Board and the hover card.", eg: 'linear issue view "$LAKI_BRANCH" --json  # or: jira issue view "${LAKI_BRANCH%%-*}" --plain' },
] as const
export type Scripts = { setup?: string; teardown?: string; run?: string; test?: string; lint?: string; format?: string; deploy?: string; ticket?: string }

// a project's lifecycle scripts: one at a time, any number of lines; Import fills one from a file
export function ScriptsField({ value, file = {}, git = true, tab, onChange }: { value: Scripts; file?: Scripts; git?: boolean; tab?: keyof Scripts; onChange: (s: Scripts) => void }) {
  const tabs = SCRIPTS.filter(t => git || t.k !== 'setup')
  const [k, setK] = useState<keyof Scripts>(tab ?? tabs[0].k)
  const t = tabs.find(x => x.k === k) ?? tabs[0]
  return (
    <div className="scripts">
      <div className="scripts-tabs">
        {tabs.map(x => (
          <button key={x.k} type="button" className={x.k === t.k ? 'on' : ''} onClick={() => setK(x.k)}>
            {x.label}
            {(value[x.k] || file[x.k]) && <span className="scripts-dot" />}
          </button>
        ))}
      </div>
      <div className="scripts-box">
        <textarea
          className="mono"
          rows={7}
          spellCheck={false}
          value={value[t.k] ?? ''}
          placeholder={file[t.k] ? `${file[t.k]}\n\n(the repo's .laki.json)` : t.eg}
          onChange={e => onChange({ ...value, [t.k]: e.target.value })}
        />
        <label className="scripts-import" data-tip="Fill it from a script file">
          <Icon name="import" /> Import
          <input
            type="file"
            hidden
            onChange={async e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onChange({ ...value, [t.k]: (await f.text()).replace(/^#!.*\n/, '').trim() })
            }}
          />
        </label>
      </div>
      <div className="muted small">{t.hint}</div>
    </div>
  )
}

// an env object as KEY=value lines, and back (lines without = and # comments are skipped)
export const envText = (e?: Record<string, string>) =>
  Object.entries(e ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
export const parseEnv = (t: string): Record<string, string> =>
  Object.fromEntries(
    t
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )

// a textarea of KEY=value lines; keeps what you type (a line without = yet) while the value is parsed
export function EnvField({ value, onChange, placeholder = 'KEY=value, one per line' }: { value?: Record<string, string>; onChange: (e: Record<string, string>) => void; placeholder?: string }) {
  const [text, setText] = useState(() => envText(value))
  return (
    <textarea
      className="mono env-field"
      rows={text ? Math.min(8, text.split('\n').length + 1) : 1 /* empty: one line, it grows as you type */}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={e => {
        setText(e.target.value)
        onChange(parseEnv(e.target.value))
      }}
    />
  )
}

export type ProjectConfig = Scripts & { expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; mcp?: McpServer[]; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod; simulator?: boolean; check?: DoneCheck; workflows?: boolean } // workflows: Applicable for Workflows (its menus' Run workflow ›, off unless true); check: Done means checked; expose: emails, *@domains; worktrees: where new ones go; pr: what the app may do to its PRs; simulator: the Simulator tab here (unset: Settings')

const PR_PERMS: [keyof PRAllow, string, string][] = [
  ['merge', 'Merge', 'Merge ▾ in the PR panel and the status bar\'s PR menu: squash, merge commit or rebase'],
  ['land', 'Merge when green', 'A switch per workspace: Laki merges the PR once every check passes, it has no conflicts and is approved if it must be. Off unless turned on here'],
  ['approve', 'Approve', 'An approving review, as you'],
  ['close', 'Close', 'Closes a PR without merging'],
  ['revert', 'Revert', 'A merged PR undone: a new PR that reverts it, opened as you'],
]

// a folder typed (~ is home) or picked (the app's folder picker; a browser has none)
export function FolderField({ value, placeholder, label, onChange }: { value?: string; placeholder: string; label: string; onChange: (v: string) => void }) {
  return (
    <span className="row-buttons">
      <input className="grow mono" value={value ?? ''} placeholder={placeholder} aria-label={label} spellCheck={false} onChange={e => onChange(e.target.value)} />
      {bridge && (
        <button type="button" onClick={() => void bridge!.pickFolder().then(f => f && onChange(f))}>
          Choose…
        </button>
      )}
    </span>
  )
}
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; host?: string; config?: ProjectConfig; repoTemplates?: Template[]; notes?: string; memory?: Memory[]; color?: string; icon?: string; allow?: AllowRule[]; alwaysAsk?: string[]; costWarn?: CostWarn }

// a project's MCP servers (shared/mcp.ts): each a name, a command (its args one per line) or a URL, its env, and the
// profiles it's on for (all when none is picked); Claude Code and Codex take them by flags as a tab starts, the others
// not yet. A name that isn't one yet (typing) is kept here and saved once it is: projectSet refuses the list otherwise
// #6: Settings' own (every project's): its title and hint, and Import, which lists the agents' own servers to copy in
export type McpFound = { agent: string; name: string; file: string; what: string; env: string[]; has: boolean }
export function McpServers({ list = [], profiles, onChange, title = 'MCP servers', hint, onImport }: { list?: McpServer[]; profiles: { name: string; agent: string }[]; onChange: (l: McpServer[]) => void; title?: string; hint?: string; onImport?: { find: () => Promise<McpFound[]>; copy: (pick: string[]) => Promise<string[]> } }) {
  const [found, setFound] = useState<McpFound[] | null>(null) // Import's list, once read
  const [pick, setPick] = useState<string[]>([])
  const [said, setSaid] = useState('')
  const synced = useRef(false) // Import copied some: the list as the daemon has it now, once it comes (typing never resets it)
  useEffect(() => void (synced.current && ((synced.current = false), setRows(list))), [JSON.stringify(list)])
  const [rows, setRows] = useState<McpServer[]>(list)
  // a key per card that survives removing one above it (EnvField keeps its own text: an index would hand it the next one)
  const keys = useRef<number[]>([])
  while (keys.current.length < rows.length) keys.current.push(Math.random())
  const put =(l: McpServer[]) => (setRows(l), l.every(s => MCP_NAME.test(s.name) && (s.command?.trim() || s.url?.trim())) && new Set(l.map(s => s.name)).size === l.length && onChange(l.map(s => (s.args ? { ...s, args: s.args.map(a => a.trim()).filter(Boolean) } : s)))) // args' empty lines: kept while typing, never saved
  const set = (i: number, x: Partial<McpServer>) => put(rows.map((s, n) => (n === i ? { ...s, ...x } : s)))
  const not = [...new Set(profiles.filter(x => !MCP_AGENTS.includes(x.agent) && x.agent !== 'command').map(x => AGENT_NAMES[x.agent as Agent] ?? x.agent))]
  return (
    <Group title={title} hint={`${hint ?? "Tools for this project's agents, given as they start; never written into their own config"}${not.length ? ` · not supported by ${not.join(', ')} yet` : ''}`}>
      {rows.map((s, i) => (
        <div key={keys.current[i]} className="setting-box mcp-server">
          <div className="row">
            <input value={s.name} aria-label="Name" placeholder="name" spellCheck={false} className={MCP_NAME.test(s.name) ? '' : 'bad'} onChange={e => set(i, { name: e.target.value.trim() })} />
            <input className="mono grow" value={s.url ?? s.command ?? ''} aria-label="Command or URL" placeholder="npx -y @acme/mcp, or https://…" spellCheck={false} onChange={e => (v => set(i, /^https?:\/\//i.test(v) ? { url: v, command: undefined, args: undefined } : { command: v, url: undefined }))(e.target.value)} />
            <IconButton icon="trash" title="Remove" onClick={() => (keys.current.splice(i, 1), put(rows.filter((_, n) => n !== i)))} />
          </div>
          {!s.url && (
            <>
              <textarea className="mono" rows={2} value={(s.args ?? []).join('\n')} aria-label="Arguments" placeholder="Arguments, one per line" spellCheck={false} onChange={e => set(i, { args: e.target.value.split('\n') })} />
              <EnvField value={s.env} placeholder="Its env: KEY=value, one per line (shown as •••• once saved)" onChange={env => set(i, { env })} />
              {/* #5: one process for every agent (daemon/mcpShare.ts), over HTTP on the daemon */}
              <Switch className="switch-row" on={!!s.shared} onChange={on => set(i, { shared: on || undefined })}>
                <Says title="One process for every agent" hint="Laki starts it once and every agent talks to it, instead of each agent starting its own copy: less memory and CPU with many agents. Off by default: a server that keeps state per session (a browser with its tabs, a login) may not suit sharing" />
              </Switch>
            </>
          )}
          {profiles.some(x => MCP_AGENTS.includes(x.agent)) && (
            <div className="row wrap">
              {profiles.filter(x => MCP_AGENTS.includes(x.agent)).map(x => (
                // the last one on stays on: an empty list is every profile's (remove the server instead)
                <Switch key={x.name} on={!s.presets?.length || s.presets.includes(x.name)} disabled={(s.presets?.length || profiles.filter(y => MCP_AGENTS.includes(y.agent)).length) === 1 && (!s.presets?.length || s.presets.includes(x.name))} onChange={on => set(i, { presets: (all => (all.length === profiles.filter(y => MCP_AGENTS.includes(y.agent)).length ? undefined : all))(profiles.filter(y => MCP_AGENTS.includes(y.agent) && (y.name === x.name ? on : !s.presets?.length || s.presets.includes(y.name))).map(y => y.name)) })}>
                  {x.name}
                </Switch>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => setRows(l => [...l, { name: `server${l.length + 1}`, command: '' }])}>
          <Icon name="plus" size={12} /> Add a server
        </button>
        {onImport && (
          <button type="button" data-tip="Lists the servers Claude Code, Codex, Antigravity and OpenCode have in their own configs: the ones you pick are copied here, their configs left as they are" onClick={() => void onImport.find().then(f => (setFound(f), setPick([]), setSaid(f.length ? '' : 'None of your agents has a server of its own')), e => setSaid(String(e?.message ?? e)))}>
            <Icon name="download" size={12} /> Import from your agents…
          </button>
        )}
        {said && <span className="muted small">{said}</span>}
      </div>
      {found && found.length > 0 && (
        <div className="setting-box mcp-import">
          {found.map(f => {
            const k = `${f.agent}:${f.name}`
            return (
              <label key={k} className="switch-row">
                <input type="checkbox" disabled={f.has} checked={f.has || pick.includes(k)} onChange={e => setPick(l => (e.target.checked ? [...l, k] : l.filter(x => x !== k)))} />
                <span className="grow">
                  <b>{f.name}</b> <span className="muted small">{AGENT_NAMES[f.agent as Agent] ?? f.agent} · {f.has ? 'here already' : f.file}</span>
                  <div className="mono small muted">{f.what}{f.env.length ? ` · env ${f.env.join(', ')}` : ''}</div>
                </span>
              </label>
            )
          })}
          <div className="row">
            <button type="button" className="primary" disabled={!pick.length} onClick={() => void onImport!.copy(pick).then(added => ((synced.current = added.length > 0), setFound(null), setSaid(added.length ? `Copied ${added.join(', ')}` : 'Nothing new to copy')), e => setSaid(String(e?.message ?? e)))}>
              Copy {pick.length || ''} here
            </button>
            <button type="button" className="link" onClick={() => setFound(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Group>
  )
}

// a project's page: name, scripts, env; saved as you type, like the rest
const TARGETS: [RunAction['target'], string][] = [['any', 'Any agent'], ...AGENTS.map(a => [a, AGENT_NAMES[a]] as [Agent, string]), ['shell', 'Shell (a command)']]
const ACTION_EG: Record<RunAction['target'], string> = {
  any: 'Review the changes and fix what you find',
  claude: 'Run a code review twice and fix what it finds',
  codex: 'Run $code-review and fix the findings',
  gemini: 'Review the changes and fix what you find',
  grok: 'Review the changes and fix what you find',
  opencode: 'Review the changes and fix what you find',
  shell: 'bundle exec rails db:migrate',
}
// a preset's args, for example
export const ARGS_EG: Record<Agent, string> = {
  claude: '--add-dir ../shared', // a permission mode: its own picker
  codex: '--search',
  gemini: '--settings agy-work.json',
  grok: '--permission-mode acceptEdits',
  opencode: '--agent build',
}

// actions (Settings › Actions, a project's): a name, who it's for, and the prompt or command
// prompt templates (Settings › Prompt templates, and a project's own): a name and a text with {{prompt}}
// what a template and a preset's command line can use, shown as chips under the field
const DATE_VAR: [string, string] = ['{{DD-MM-YY HH:MM}}', "now: any of YYYY YY MMMM MMM MM DD D dddd ddd HH H hh mm ss A, in any order (MM after an hour is minutes)"]
const TEMPLATE_VARS: [string, string][] = [
  ['{{prompt}}', 'what you type on the new-workspace page (without it, the typed text goes after the template)'],
  ['{{project}}', "the project's name"],
  ['{{base}}', 'the base branch'],
  ['{{pr}}', 'the PR: a PR link in the prompt, or a prompt of only #123'],
  DATE_VAR,
  ...AGENT_VARS.filter(([v]) => !['{{project}}', '{{base}}', '{{pr}}'].includes(v)), // the workspace's, once it's made
]
// an action's: the agent variables, a date of any shape
const ACTION_VARS: [string, string][] = [...AGENT_VARS, DATE_VAR]
export const ENV_VARS: [string, string][] = [
  ['$PORT', "the workspace's port, for a dev server"],
  ['$LAKI_WORKSPACE', "the workspace's id"],
  ['$LAKI_TAB', "the tab's id"],
  ['$LAKI_PROJECT_PATH', 'the repo itself, not the worktree'],
  ['$LAKI_STORAGE_FOLDER', "the workspace's storage folder: files kept for you"],
]

// a click puts the variable in the field just before the chips, at its cursor
export function VarChips({ vars, value, onChange }: { vars: [string, string][]; value: string; onChange: (v: string) => void }) {
  const put = (el: Element | null | undefined, v: string) => {
    const f = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
    const a = f?.selectionStart ?? value.length
    const b = f?.selectionEnd ?? a
    const text = /[^\s("'=/:]$/.test(value.slice(0, a)) ? ` ${v}` : v // a word apart from the one before it
    onChange(value.slice(0, a) + text + value.slice(b))
    requestAnimationFrame(() => f && (f.focus(), f.setSelectionRange(a + text.length, a + text.length)))
  }
  return (
    <div className="vars">
      <span className="muted small">Variables</span>
      {vars.map(([v, tip]) => (
        <button type="button" key={v} className="var mono" data-tip={tip} onMouseDown={e => e.preventDefault()} onClick={e => put(e.currentTarget.parentElement?.previousElementSibling, v)}>
          {v}
        </button>
      ))}
    </div>
  )
}

// repo: the repo's .laki/prompts names: one here of the same name says it overrides that one
export function TemplatesField({ value = [], onChange, repo }: { value?: Template[]; onChange: (v: Template[]) => void; repo?: Template[] }) {
  const keys = useRef<number[]>([]) // like ActionsField's
  while (keys.current.length < value.length) keys.current.push(Math.random())
  const setAt = (i: number, t: Partial<Template>) => onChange(value.map((x, j) => (j === i ? { ...x, ...t } : x)))
  const drop = (i: number) => (keys.current.splice(i, 1), onChange(value.filter((_, j) => j !== i)))
  return (
    <>
      {value.map((t, i) => (
        <div key={keys.current[i]} className="preset">
          <div className="row">
            <input value={t.name} placeholder="name" onChange={e => setAt(i, { name: e.target.value })} />
            {repo?.some(r => r.name.trim() === t.name.trim()) && <span className="tag" data-tip="The repo's .laki/prompts has one of this name: this one is used here instead">Overrides the repo&apos;s</span>}
            <IconButton icon="trash" title="Remove template" onClick={() => drop(i)} />
          </div>
          <textarea className="mono" rows={5} spellCheck={false} value={t.text} placeholder="Fix this: {{prompt}}" onChange={e => setAt(i, { text: e.target.value })} />
          <VarChips vars={TEMPLATE_VARS} value={t.text} onChange={text => setAt(i, { text })} />
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => onChange([...value, value.length ? { name: `template-${value.length + 1}`, text: '{{prompt}}' } : EXAMPLE_TEMPLATE])}>
          <Icon name="plus" /> Add template
        </button>
      </div>
    </>
  )
}

// taken: the other lists' slugs (the daemon keeps them unique everywhere: one taken elsewhere gets a -2 there)
export function ActionsField({ value = [], onChange, taken = [] }: { value?: RunAction[]; onChange: (v: RunAction[]) => void; taken?: (string | undefined)[] }) {
  const keys = useRef<number[]>([]) // like keys, for the cards
  while (keys.current.length < value.length) keys.current.push(Math.random())
  const fresh = useRef(new Set<number>()) // cards made here: the slug follows the name until it's typed
  const [only, setOnly] = useState<RunAction['target'] | ''>('') // the filter: one target's, or all
  const setAt = (i: number, a: Partial<RunAction>) => onChange(value.map((x, j) => (j === i ? { ...x, ...a } : x)))
  const others = (i: number) => new Set([...taken, ...value.filter((_, j) => j !== i).map(a => a.slug)].filter((x): x is string => !!x))
  const named = (i: number, name: string) => setAt(i, fresh.current.has(keys.current[i]) ? { name, slug: name.trim() ? actionSlug(name, others(i)) : undefined } : { name })
  const drop = (i: number) => (keys.current.splice(i, 1), onChange(value.filter((_, j) => j !== i)))
  // a copy right under it, for another agent: the filter would hide it, so it goes
  const clone = (i: number) => {
    const k = Math.random()
    keys.current.splice(i + 1, 0, k)
    fresh.current.add(k)
    setOnly('')
    onChange([...value.slice(0, i + 1), { ...value[i], slug: actionSlug(value[i].slug || value[i].name, new Set([...taken, ...value.map(a => a.slug)].filter((x): x is string => !!x))) }, ...value.slice(i + 1)])
  }
  const used = TARGETS.filter(([v]) => value.some(a => a.target === v))
  const show = used.length > 1 && used.some(([v]) => v === only) ? only : '' // the last of a target gone: all again
  return (
    <>
      {used.length > 1 && (
        <div className="actions-only">
          <span className="muted small">Show</span>
          <select value={show} aria-label="Show actions for" onChange={e => setOnly(e.target.value as RunAction['target'] | '')}>
            <option value="">All</option>
            {used.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.map((a, i) =>
        show && a.target !== show ? null : (
          <div key={keys.current[i]} className="preset">
            <div className="row">
              <input value={a.name} placeholder="name, as Run ▾ shows it" onChange={e => named(i, e.target.value)} />
              <select value={a.target} onChange={e => setAt(i, { target: e.target.value as RunAction['target'] })}>
                {TARGETS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <IconButton icon="copy" title="Duplicate (for another agent)" onClick={() => clone(i)} />
              <IconButton icon="trash" title="Remove action" onClick={() => drop(i)} />
            </div>
            <textarea className="mono" rows={2} spellCheck={false} value={a.text} placeholder={ACTION_EG[a.target]} onChange={e => setAt(i, { text: e.target.value })} />
            <VarChips vars={ACTION_VARS} value={a.text} onChange={text => setAt(i, { text })} />
            {a.target !== 'shell' && (
              <label className="action-slug-row muted small">
                Slug
                <input
                  className={`mono action-slug${a.slug && others(i).has(a.slug) ? ' bad' : ''}`}
                  value={a.slug ?? ''}
                  placeholder={actionSlug(a.name, others(i))}
                  aria-label="Slug"
                  spellCheck={false}
                  data-tip={a.slug && others(i).has(a.slug) ? 'Another action has it: this one gets a -2' : 'Its slug, unique: a workflow’s agent block uses it (use: …). Set from the name; type your own'}
                  onChange={e => (fresh.current.delete(keys.current[i]), setAt(i, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || undefined }))}
                />
                <span>a workflow's agent block uses it</span>
              </label>
            )}
          </div>
        ),
      )}
      <div className="row">
        <button type="button" onClick={() => (keys.current.push(Math.random()), fresh.current.add(keys.current[value.length]), onChange([...value, { name: '', target: show || 'claude', text: '' }]))}>
          <Icon name="plus" /> Add action
        </button>
      </div>
    </>
  )
}

// #3: a project's cost warning: Settings' (none of its own), its own amounts, or off here
function CostWarnField({ value, onSave }: { value?: CostWarn; onSave: (v: CostWarn | null) => unknown }) {
  const mode = value?.on === false ? 'off' : value?.yellow || value?.red ? 'own' : 'all'
  const own = { yellow: value?.yellow ?? COST_WARN.yellow, red: value?.red ?? COST_WARN.red }
  return (
    <Group title="Cost warning" hint="Its workspaces' cost turns yellow, then red, past these dollars (its agents' chats at API prices), and Laki tells you once at each">
      <div className="setting-box">
        <label className="switch-row">
          <span className="nt-when">
            <select aria-label="Cost warning" value={mode} onChange={e => onSave(e.target.value === 'off' ? { on: false } : e.target.value === 'own' ? own : null)}>
              <option value="all">As in Settings › Notifications</option>
              <option value="own">Its own amounts</option>
              <option value="off">Off here</option>
            </select>
            {mode === 'own' &&
              (['yellow', 'red'] as const).map(k => (
                <span key={k} className="nt-when">
                  {k} $
                  <input type="number" min={0.01} step={1} style={{ width: 64 }} aria-label={`Cost warning: ${k}`} defaultValue={own[k]} onChange={e => Number(e.target.value) > 0 && onSave({ ...own, [k]: Number(e.target.value) })} />
                </span>
              ))}
          </span>
        </label>
      </div>
    </Group>
  )
}

// F14: a project's auto-answer rules: each one's tool, pattern and how often it answered; Remove; a new one checked
// as the daemon checks it (rulePattern), which says why when it refuses one
function AllowRules({ rules, onSave }: { rules: AllowRule[]; onSave: (allow: AllowRule[]) => Promise<unknown> }) {
  const [tool, setTool] = useState('Bash')
  const [pattern, setPattern] = useState('')
  const [err, setErr] = useState('')
  const save = (l: AllowRule[]) => onSave(l).then(() => (setErr(''), true), (e: Error) => (setErr(e.message), false))
  const add = () => rulePattern(tool, pattern) && void save([...rules, { tool, pattern: pattern.trim(), addedAt: Date.now() }]).then(ok => ok && setPattern(''))
  return (
    <Group title="Auto-answer rules" hint="Permission asks Laki answers Allow for every agent in this project, as your click would: a command that starts with a Bash rule (or matches its *), a path inside the worktree that matches a file rule (* and ** as in a glob). Never a risky command (rm -rf, sudo, a force push…), one chained with ; && |, a path outside the worktree, a question, a plan or a secret. Only you add them; each answer is in daemon.log">
      <div className="setting-box">
        {rules.map((r, i) => (
          <div key={`${r.tool}:${r.pattern}`} className="switch-row allow-rule">
            <span className="tag">{r.tool}</span>
            <code className="grow">{r.pattern}</code>
            <span className="muted small">{r.hits ? `${r.hits} answered` : 'not used yet'}</span>
            <IconButton icon="x" title="Remove this rule" onClick={() => void save(rules.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div className="switch-row allow-rule">
          <select value={tool} aria-label="Tool" onChange={e => setTool(e.target.value)}>
            {RULE_TOOLS.map(t => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input className="mono grow" value={pattern} aria-label="Pattern" placeholder={tool === 'Bash' ? 'npm test' : 'src/**/*.ts'} onChange={e => (setPattern(e.target.value), setErr(''))} onKeyDown={e => e.key === 'Enter' && add()} />
          <button type="button" disabled={!rulePattern(tool, pattern)} data-tip={pattern.trim() && !rulePattern(tool, pattern) ? 'Not one Laki takes: a risky or chained command, a bare *, or a path outside the worktree' : undefined} onClick={add}>
            Add
          </button>
        </div>
      </div>
      {err && <div className="warn small">{err}</div>}
    </Group>
  )
}

// F15: Always ask for: path globs no rule answers for (an Edit, Write or MultiEdit of a matching path, a command naming
// one); the suggestions are only offered, none saved until you add it
function AlwaysAsk({ globs, onSave }: { globs: string[]; onSave: (globs: string[]) => Promise<unknown> }) {
  const [glob, setGlob] = useState('')
  const [err, setErr] = useState('')
  const save = (l: string[]) => onSave(l).then(() => (setErr(''), true), (e: Error) => (setErr(e.message), false))
  const add = (g = glob.trim()) => g && !globs.includes(g) && void save([...globs, g]).then(ok => ok && setGlob(''))
  const eg = ALWAYS_ASK_EG.filter(g => !globs.includes(g))
  return (
    <Group title="Always ask for" hint="Paths no auto-answer rule answers for: an edit of a matching file, or a command that names one, is always asked, and its card says which glob held it (* and ** as in a glob; one without / matches that name in any folder). Only you change them">
      <div className="setting-box">
        {globs.map(g => (
          <div key={g} className="switch-row allow-rule">
            <code className="grow">{g}</code>
            <IconButton icon="x" title="Remove" onClick={() => void save(globs.filter(x => x !== g))} />
          </div>
        ))}
        <div className="switch-row allow-rule">
          <input className="mono grow" value={glob} aria-label="Path glob" placeholder="**/migrations/**" onChange={e => (setGlob(e.target.value), setErr(''))} onKeyDown={e => e.key === 'Enter' && add()} />
          <button type="button" disabled={!glob.trim()} onClick={() => add()}>
            Add
          </button>
        </div>
        {eg.length > 0 && (
          <div className="row-buttons">
            <span className="muted small">Suggested:</span>
            {eg.map(g => (
              <button key={g} type="button" className="link small mono" onClick={() => add(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
      </div>
      {err && <div className="warn small">{err}</div>}
    </Group>
  )
}

// F7: what keeps two workspaces of the project apart (shared/isolation.ts): the variables every tab, setup, run, Done
// check and teardown gets, and examples to copy for common stacks; Teardown (Scripts) takes them down on archive
const ISO_VARS: [string, string][] = [
  ['LAKI_SLOT', "the workspace's number: 0, 1, 2…"],
  ['PORT', 'its first port (3100 + 10 × the slot)'],
  ['PORT_1 … PORT_9', 'the nine after it: a database, a worker, a second server'],
  ['LAKI_DB_SUFFIX', '_ws<slot>: a database name of its own'],
  ['COMPOSE_PROJECT_NAME', '<project>-ws<slot>: docker compose reads it, so each workspace has its own containers and volumes'],
]
const ISO_EGS = (project: string): [string, string][] => [
  ['docker-compose.yml', `services:\n  db:\n    image: postgres:16\n    ports: ["\${PORT_1}:5432"]\n  web:\n    build: .\n    ports: ["\${PORT}:3000"]\n# its name: $COMPOSE_PROJECT_NAME (${project}-ws<slot>), set already`],
  ['.env (DATABASE_URL)', 'DATABASE_URL=postgres://localhost:${PORT_1}/app${LAKI_DB_SUFFIX}'],
  ['Setup', 'docker compose up -d && createdb -p $PORT_1 app$LAKI_DB_SUFFIX'],
  ['Teardown', 'docker compose down -v; dropdb --if-exists app$LAKI_DB_SUFFIX'],
]
function Isolation({ project }: { project: string }) {
  const [copied, setCopied] = useState('')
  const copy = (k: string, v: string) => void navigator.clipboard.writeText(v).then(() => (setCopied(k), setTimeout(() => setCopied(''), 1500)))
  return (
    <Group title="Isolation" hint="Every workspace has ten ports of its own and a number: a dev server, a database or a compose stack that uses these never meets another workspace's. A server on another workspace's port shows ⚠ on both rows. Teardown (Scripts) runs on archive, with the same trust as setup">
      <div className="setting-box iso">
        {ISO_VARS.map(([k, v]) => (
          <div key={k} className="iso-var">
            <code>${k}</code>
            <span className="muted small">{v}</span>
          </div>
        ))}
        {ISO_EGS(project).map(([k, v]) => (
          <div key={k} className="iso-eg">
            <div className="iso-eg-head">
              <span className="small">{k}</span>
              <IconButton icon="copy" title={copied === k ? 'Copied' : `Copy the ${k} example`} onClick={() => copy(k, v)} />
            </div>
            <pre className="mono small">{v}</pre>
          </div>
        ))}
      </div>
    </Group>
  )
}

export function ProjectSection(p: {
  project: ProjectInfo
  noNotes?: boolean // the project page: its own Notes tab has them
  file?: (id: string) => Promise<ProjectConfig>
  rename?: boolean
  script?: keyof Scripts
  global?: { actions?: RunAction[]; templates?: Template[]; simulator?: boolean; flows?: boolean; profiles?: { name: string; agent: string }[] } // Settings' own, which go with this project's (profiles: for MCP servers' switches) (simulator: its switch, which this project's may override; flows: Workflows on)
  taken?: (string | undefined)[] // the other projects' action slugs (an action's slug is unique everywhere)
  onGlobal?: (sec: 'actions' | 'templates') => void
  onMemory?: () => void // Settings' Memory row: the project page's Memory
  onAllow?: (allow: AllowRule[]) => Promise<unknown> // F14: its auto-answer rules, the whole list (refused: the daemon says why)
  onAlwaysAsk?: (globs: string[]) => Promise<unknown> // F15: its Always ask for, the whole list
  onSave: (o: { name?: string; config: ProjectConfig; notes?: string; color?: string; icon?: string; costWarn?: CostWarn | null }) => unknown // color, icon, costWarn: saved as they're picked
  kept?: { list: SecretKept[]; forget: (k: SecretKept) => Promise<unknown> } // the secrets kept for this project (laki secret's Keep)
}) {
  const [name, setName] = useState(p.project.name)
  const name0 = useRef(name) // sent only once changed here: the sidebar's Rename may have saved since
  const [notes, setNotes] = useState(p.project.notes ?? '')
  const notes0 = useRef(notes) // sent only once changed here: the Notes dialog or another client may have saved since
  const [c, setC] = useState<ProjectConfig>(p.project.config ?? {})
  const [file, setFile] = useState<ProjectConfig>({})
  // the lists' note: how many the global ones and these make together (fewer: one here replaces a global one)
  const count = (global: number, own: number, all: number) => `${global} global + ${own} here, ${all} in all`
  const named = (l?: Template[]) => (l ?? []).filter(t => t.name.trim())
  const globalLink = (sec: 'actions' | 'templates', label: string) =>
    p.onGlobal ? (
      <button type="button" className="link" onClick={() => p.onGlobal?.(sec)}>
        {label}
      </button>
    ) : (
      label
    )
  useEffect(() => void p.file?.(p.project.id).then(setFile, () => {}), [p.project.id])
  const first = useRef(true)
  const unsaved = useRef<(() => unknown) | null>(null)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const save = () => {
      const changedHere = notes !== notes0.current
      const renamed = p.rename && name !== name0.current
      notes0.current = notes // sent once: a later save of the config leaves the Notes dialog's edits be
      name0.current = name
      return p.onSave({ ...(renamed && { name: name.trim() }), config: c, ...(changedHere && { notes }) }) // '': its folder's name
    }
    unsaved.current = save
    const t = setTimeout(() => ((unsaved.current = null), save()), 400)
    return () => clearTimeout(t)
  }, [name, c, notes])
  useEffect(() => () => void unsaved.current?.(), [])
  const badMails = parseMails(c.expose ?? '').filter(m => !MAIL_OK.test(m))
  const [menu, openMenu] = useMenu()
  // the project ⋯'s Color and Icon…, as they are now (the view's)
  const lookMenu = (e: MouseEvent) => openMenu(e, [{ colors: TAB_COLORS, value: p.project.color, pick: color => p.onSave({ config: c, color }) }, null, ...iconItems(p.project.icon, icon => p.onSave({ config: c, icon: icon ?? '' }))])
  return (
    <>
      {menu}
      <div className="set-title">
        <h2>{p.project.name}</h2>
        <div className="muted small mono">
          {p.project.path} · {p.project.git ? 'git' : 'folder (no git)'}
        </div>
      </div>
      {p.rename && (
        <Group title="Name" hint="As the sidebar shows it; optional: empty, its folder's name">
          <input value={name} aria-label="Name" placeholder={p.project.path.split('/').filter(Boolean).pop()} onChange={e => setName(e.target.value)} />
        </Group>
      )}
      <Group title="Color and icon" hint="Its mark before its name in the sidebar, menus, the palette and the window's title (an emoji there); the color also on its workspaces' bar where they have none of their own, rail pins and the bubbles">
        <div className="button-row">
          <button type="button" className="pick-btn" aria-haspopup="menu" onClick={lookMenu}>
            <ProjectMark p={p.project} or={p.project.git ? 'fork' : 'folder'} size={14} /> {[p.project.color, p.project.icon && (emojiOf(p.project.icon) ? emojiWords(p.project.icon) : iconWords(p.project.icon))].filter(Boolean).join(' · ') || 'None yet'}
            <Icon name="chevron" size={11} />
          </button>
        </div>
      </Group>
      {p.onMemory && (
        <Group title="Memory" hint="What Claude and Codex get at every start in this project: yours, and what agents learned. Settings › Global memory goes with it">
          <div className="button-row">
            <span className="grow">
              {(m => `${m.filter(x => !x.auto).length} yours · ${m.filter(x => x.auto).length} learned by agents`)(p.project.memory ?? [])}
            </span>
            <button type="button" onClick={p.onMemory}>
              <Icon name="bulb" /> Manage
            </button>
          </div>
        </Group>
      )}
      <CostWarnField value={p.project.costWarn} onSave={costWarn => p.onSave({ config: c, costWarn })} />
      {p.onAllow && <AllowRules rules={p.project.allow ?? []} onSave={p.onAllow} />}
      {p.onAlwaysAsk && <AlwaysAsk globs={p.project.alwaysAsk ?? []} onSave={p.onAlwaysAsk} />}
      {!p.noNotes && (
        <Group title="Notes" hint="Markdown, yours: links, how to run it, who to ask. The project's ⋯ › Notes shows them; agents never see them">
          <textarea className="mono notes-field" rows={Math.min(16, Math.max(4, notes.split('\n').length + 1))} value={notes} aria-label="Notes" placeholder="# Links&#10;- Staging: https://…" onChange={e => setNotes(e.target.value)} />
        </Group>
      )}
      {p.project.git && !p.project.host && (
        <Group title="Worktrees" hint="Where this project's new worktrees go (a path relative to the repo, ~, or a full one); empty: Settings › General's folder. Ones made already stay">
          <FolderField value={c.worktrees} label="This project's worktrees" placeholder={`<the worktrees folder>/${p.project.id}`} onChange={v => setC(y => ({ ...y, worktrees: v }))} />
        </Group>
      )}
      {p.project.git && (
        <Group title="Pull requests" hint="What Laki may do to this project's PRs, as you on GitHub. Each asks first; merge when green asks as it's turned on for a workspace">
          <div className="setting-box">
            {PR_PERMS.map(([k, title, hint]) => (
              <Switch key={k} className="switch-row" on={prAllows(c, k)} onChange={v => setC(y => ({ ...y, pr: { ...y.pr, [k]: v } }))}>
                <Says title={title} hint={hint} />
              </Switch>
            ))}
          </div>
        </Group>
      )}
      <Group title="Scripts" hint="For workspace setup, teardown, the Run button and Run ▾'s Test, Lint, Format and Deploy; empty: the repo's .laki.json">
        <ScriptsField value={c} file={file} git={p.project.git} tab={p.script} onChange={x => setC(y => ({ ...y, ...x }))} />
      </Group>
      {p.project.git && !p.project.host && (checkNow => (
        <Group title="Done check" hint="As an agent's turn ends having changed files, these run in its worktree before you're told it's done. They run as you, on whatever the agent changed: an agent that may only edit files can make them run anything. A failing script goes back to the agent with its output, 3 times in a row, then it's over to you. None ticked: off (a repo's .laki.json can bring its own check)">
          <div className="setting-box">
            {CHECK_STEPS.map(k => (
              (has => (
                <Switch key={k} className="switch-row" disabled={!has} on={!!checkNow.steps?.includes(k)} onChange={v => setC(y => ({ ...y, check: { ...checkNow, steps: CHECK_STEPS.filter(x => (x === k ? v : checkNow.steps?.includes(x))) } }))}>
                  <Says title={`Run ${k}`} hint={has ? `${c[k]?.trim() || file[k]}${k === 'format' ? ' (it may change files)' : ''}` : `Set the ${k} script under Scripts first`} />
                </Switch>
              ))(!!(c[k]?.trim() || file[k]?.trim()))
            ))}
            <label className="switch-row">
              <select value={checkNow.review ?? ''} aria-label="Second opinion" onChange={e => setC(y => ({ ...y, check: { ...checkNow, review: (e.target.value || undefined) as DoneCheck['review'] } }))}>
                <option value="">None</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
              <Says title="Second opinion" hint="A second agent reads the diff once the scripts pass and lists real problems" />
            </label>
          </div>
        </Group>
      ))(c.check ?? file.check ?? {})}
      <Group title="Env" hint={`For every tab, setup and teardown${file.env && Object.keys(file.env).length ? ` · .laki.json has ${Object.keys(file.env).join(', ')}` : ''}`}>
        <EnvField value={c.env} onChange={env => setC(y => ({ ...y, env }))} />
      </Group>
      <McpServers list={c.mcp} profiles={p.global?.profiles ?? []} onChange={mcp => setC(y => ({ ...y, mcp: mcp.length ? mcp : undefined }))} />
      <Isolation project={p.project.id} />
      {p.global?.flows !== false && (
        <Group title="Workflows">
          <div className="setting-box">
            <Switch className="switch-row" on={c.workflows === true} onChange={v => setC(y => ({ ...y, workflows: v || undefined }))}>
              <Says title="Applicable for Workflows" hint="Run workflow › in this project's workspace menus. Off: the menus leave it out; the Workflows page and ⌘K still run them" />
            </Switch>
          </div>
        </Group>
      )}
      <Group title="Simulator" hint="The side panel's Simulator tab in this project's workspaces: as Settings › Simulators says, or on or off here alone">
        <select value={c.simulator === undefined ? '' : c.simulator ? 'on' : 'off'} aria-label="Simulator tab" onChange={e => setC(y => ({ ...y, simulator: e.target.value ? e.target.value === 'on' : undefined }))}>
          <option value="">As in Settings ({p.global?.simulator ? 'on' : 'off'})</option>
          <option value="on">On in this project</option>
          <option value="off">Off in this project</option>
        </select>
      </Group>
      <Group title="Expose to the world" hint="Who can open a tunnel: the popup starts from it every time; emails and *@domains, or empty for anyone with the link">
        <input value={c.expose ?? ''} aria-label="Expose to the world" placeholder={file.expose ? `${file.expose} (.laki.json)` : 'anyone with the link'} onChange={e => setC(y => ({ ...y, expose: e.target.value }))} />
        {badMails.length > 0 && <span className="field-err">Not an address or *@domain: {badMails.join(', ')}</span>}
      </Group>
      <Group title="Actions">
        <Scope tag="This project">
          Only for this project. Run ▾ in its workspaces shows the global actions ({globalLink('actions', 'Settings › Actions')}) and these together:{' '}
          {count(mergeActions(p.global?.actions).length, mergeActions([], c.actions).length, mergeActions(p.global?.actions, c.actions).length)}. One here with
          a global one's name and kind replaces it.
        </Scope>
        <ActionsField value={c.actions} taken={[...(p.global?.actions?.map(a => a.slug) ?? []), ...(p.taken ?? [])]} onChange={actions => setC(y => ({ ...y, actions }))} />
      </Group>
      <Group title="Prompt templates">
        <Scope tag="This project">
          Only for this project. Its new workspaces show these first, then the global templates ({globalLink('templates', 'Settings › Prompt templates')}):{' '}
          {count(named(p.global?.templates).length, named(c.templates).length, named(templatesFor(p.global?.templates, c.templates)).length)}. One here with a
          global one's name replaces it.
        </Scope>
        <TemplatesField value={c.templates} repo={p.project.repoTemplates} onChange={templates => setC(y => ({ ...y, templates }))} />
        {!!p.project.repoTemplates?.length && (
          <div className="repo-tpls">
            <p className="muted small">From the repo&apos;s .laki/prompts, for everyone on it: change them there, in a pull request.</p>
            {p.project.repoTemplates.map(t => (
              <div key={t.name} className="row small" data-tip={t.text.slice(0, 300)}>
                <span className="tag">repo</span>
                <span className="grow">{t.name}</span>
                {named(c.templates).some(x => x.name.trim() === t.name.trim()) && <span className="muted">overridden here</span>}
              </div>
            ))}
          </div>
        )}
      </Group>
      {p.kept && (
        <Group title="Kept secrets">
          <Scope tag="This project">Secrets an agent here asked for that you kept for this project; ones kept for all projects are in Settings › General.</Scope>
          <KeptSecrets list={p.kept.list} onForget={p.kept.forget} />
        </Group>
      )}
    </>
  )
}

// the secrets kept for next time (laki secret's card: Keep for this project, or all projects): names only, never their
// values (the Keychain has them); Remove forgets one. In Settings › General (every one) and a project's settings (its own)
export function KeptSecrets({ list, projects, onForget }: { list: SecretKept[]; projects?: { id: string; name: string }[]; onForget: (k: SecretKept) => Promise<unknown> }) {
  if (!list.length) return <p className="muted small">None yet. When an agent asks for a secret (laki secret), its card can keep it for the project or for all projects.</p>
  return (
    <div className="kept-secrets">
      {list.map(k => (
        <div key={`${k.scope}:${k.label}`} className="row small">
          <Icon name="lock" size={12} />
          <span className="grow">{k.label}</span>
          <span className="muted">
            {k.scope === '*' ? 'all projects' : (projects?.find(p => p.id === k.scope)?.name ?? 'a removed project')} · kept {new Date(k.at).toLocaleDateString()} ·{' '}
            {k.given?.length ? `given ${k.count ?? k.given.length} time${(k.count ?? k.given.length) === 1 ? '' : 's'}, last ${ago(k.given[0].at)} to ${k.given[0].name}` : 'not given yet'}
          </span>
          <button type="button" className="link small danger" onClick={() => void ask(`Remove ${k.label}?`, { text: "Its value goes from the Keychain: next time an agent asks for it, you type it again.", ok: 'Remove', danger: true }).then(ok => ok && onForget(k)).catch(() => {})}>
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}
