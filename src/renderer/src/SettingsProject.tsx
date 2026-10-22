// a project's settings (its scripts, env, folders, templates, actions), and the fields Settings' global sections share
// with it. Settings.tsx re-exports it.
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { bridge } from './api'
import { Icon, IconButton, iconItems, iconWords, ProjectMark, Switch, TAB_COLORS, useMenu } from './ui'
import { MAIL_OK, mergeActions, parseMails, type RunAction, type Template, templatesFor } from './text'
import { actionSlug, type Agent, AGENT_NAMES, AGENT_VARS, AGENTS, type Memory, type MergeMethod, type PRAllow, prAllows } from '../../shared/types'
import { Group, Says, Scope } from './SettingsKit'
import { emojiOf } from '../../shared/icons'

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
] as const
export type Scripts = { setup?: string; teardown?: string; run?: string; test?: string; lint?: string; format?: string; deploy?: string }

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

export type ProjectConfig = Scripts & { expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod; simulator?: boolean } // expose: emails, *@domains; worktrees: where new ones go; pr: what the app may do to its PRs; simulator: the Simulator tab here (unset: Settings')

const PR_PERMS: [keyof PRAllow, string, string][] = [
  ['merge', 'Merge', 'Merge ▾ in the PR panel and the status bar\'s PR menu: squash, merge commit or rebase'],
  ['land', 'Merge when green', 'A switch per workspace: Laki merges the PR once every check passes, it has no conflicts and is approved if it must be. Off unless turned on here'],
  ['approve', 'Approve', 'An approving review, as you'],
  ['close', 'Close', 'Closes a PR without merging'],
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
export type ProjectInfo = { id: string; name: string; path: string; git: boolean; host?: string; config?: ProjectConfig; notes?: string; memory?: Memory[]; color?: string; icon?: string }

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
  gemini: '--approval-mode auto_edit',
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

export function TemplatesField({ value = [], onChange }: { value?: Template[]; onChange: (v: Template[]) => void }) {
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

export function ProjectSection(p: {
  project: ProjectInfo
  noNotes?: boolean // the project page: its own Notes tab has them
  file?: (id: string) => Promise<ProjectConfig>
  rename?: boolean
  script?: keyof Scripts
  global?: { actions?: RunAction[]; templates?: Template[]; simulator?: boolean } // Settings' own, which go with this project's (simulator: its switch, which this project's may override)
  taken?: (string | undefined)[] // the other projects' action slugs (an action's slug is unique everywhere)
  onGlobal?: (sec: 'actions' | 'templates') => void
  onMemory?: () => void // Settings' Memory row: the project page's Memory
  onSave: (o: { name?: string; config: ProjectConfig; notes?: string; color?: string; icon?: string }) => unknown // color, icon: saved as they're picked
}) {
  const [name, setName] = useState(p.project.name)
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
      notes0.current = notes // sent once: a later save of the config leaves the Notes dialog's edits be
      return p.onSave({ name: p.rename && name.trim() ? name.trim() : undefined, config: c, ...(changedHere && { notes }) })
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
        <Group title="Name" hint="As the sidebar shows it">
          <input value={name} aria-label="Name" onChange={e => setName(e.target.value)} />
        </Group>
      )}
      <Group title="Color and icon" hint="Its mark before its name in the sidebar, menus, the palette and the window's title (an emoji there); the color also on its workspaces' bar where they have none of their own, rail pins and the bubbles">
        <div className="button-row">
          <button type="button" aria-haspopup="menu" onClick={lookMenu}>
            <ProjectMark p={p.project} or={p.project.git ? 'fork' : 'folder'} size={14} /> {[p.project.color, p.project.icon && (emojiOf(p.project.icon) ?? iconWords(p.project.icon))].filter(Boolean).join(' · ') || 'None yet'}
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
      <Group title="Env" hint={`For every tab, setup and teardown${file.env && Object.keys(file.env).length ? ` · .laki.json has ${Object.keys(file.env).join(', ')}` : ''}`}>
        <EnvField value={c.env} onChange={env => setC(y => ({ ...y, env }))} />
      </Group>
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
        <TemplatesField value={c.templates} onChange={templates => setC(y => ({ ...y, templates }))} />
      </Group>
    </>
  )
}
