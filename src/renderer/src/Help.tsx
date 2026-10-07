// Help (⌘/, the ? at the top of the sidebar, or ⌘K): the keys, the status glyphs, where things are and the
// CLI's main commands, laid out like Settings: a nav (a filter, the sections, the one in view lit) beside the
// page. Each section and named row has a stable id, `help-<id>` (`window`, `widgets`…), for a laki://help#<id>
// later. cli: the app's command.
import { Fragment, isValidElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { openExternal } from './api'
import { Glyph } from './Glyph'
import { REPO } from './panels'
import { Icon, IconButton } from './ui'

// a row: its key or label, what it says, more words the filter knows it by; n: a numbered step
type Item = { id?: string; k?: ReactNode; v: ReactNode; find?: string; note?: true; n?: number }
type Sec = { id: string; title: string; kind?: 'list' | 'pre'; items: Item[] }

const GUIDE = `${REPO}/blob/main/docs/guide.md`

const KEYS: [string, string][] = [
  ['⌘O', 'open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it'],
  ['⌘N', 'new workspace'],
  ['⌘T / ⌘W', 'new shell tab / close the tab (or the file preview)'],
  ['⌘1…⌘9', 'go to a tab'],
  ['⌘↑ / ⌘↓', 'previous / next workspace'],
  ['⌘J', 'the next tab that needs you, in any workspace'],
  ['⌘K', 'the palette: every workspace, tab and action'],
  ['⌘P', 'find a file in the workspace'],
  ['⌘F', 'find in the terminal (here: the filter)'],
  ['⌘S', "save the file you're editing in the preview"],
  ['⌘⏎ / ⇧⏎', "a new line in an agent's prompt"],
  ['⌘← / ⌘→ · ⌥← / ⌥→ · ⌘⌫', "in a terminal: the line's start / end, a word back / on, delete the line"],
  ['⌘D', 'changes against the base branch'],
  ['⌥⌘B', 'side panel: files, changes, review, preview'],
  ['⌘I', 'workspace info: PR, checks, what each agent said last'],
  ['⌘E', 'open the workspace in your editor'],
  ['⌘B', 'hide / show the sidebar'],
  ['⌘,', 'settings'],
  ['⌘+ / ⌘− / ⌘0', 'terminal font bigger / smaller / default'],
  ['⌘/', 'this page'],
  ['Esc', 'close a page, dialog or menu; in an agent, interrupt its turn'],
]

const GLYPHS: [string, string][] = [
  ['waiting', 'needs you: a permission prompt or a question'],
  ['running', 'working'],
  ['done', 'finished while you were looking elsewhere'],
  ['idle', 'idle'],
  ['limit', 'usage limit: it types continue after the reset'],
  ['ok', 'ended fine'],
  ['exited', 'ended with an error: Enter starts it again'],
]

// a key as chips: '⌘T / ⌘W' is two
const kbds = (k: string) =>
  k.split(' / ').map((x, i) => (
    <Fragment key={i}>
      {i > 0 && ' / '}
      <kbd>{x}</kbd>
    </Fragment>
  ))

// the words a row shows, for the filter
const textOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join(' ')
      : isValidElement(n)
        ? textOf((n.props as { children?: ReactNode }).children)
        : ''

const Row = ({ id, k, children }: { id?: string; k: ReactNode; children: ReactNode }) => (
  <div className="help-row" id={id && `help-${id}`}>
    <span className="help-k">{k}</span>
    <span>{children}</span>
  </div>
)

export function HelpPage({ cli, ship, onClose }: { cli: string; ship?: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState<{ sec?: string; row?: string }>({}) // ids in view
  const main = useRef<HTMLDivElement>(null)
  const find = useRef<HTMLInputElement>(null)
  const cmds: [string, string][] = [
    [`${cli} ls`, 'projects, workspaces and tabs, with their status (--json for scripts)'],
    [`${cli} new <project> --prompt "fix the login"`, 'a workspace with an agent (--preset codex|shell, --model, --effort, --base, --name, --local)'],
    [`${cli} new <project> --issue <url>`, 'a workspace on a GitHub issue: its title and text are the prompt'],
    [`${cli} new <project> --pr <url>`, "a workspace on a PR's branch (a fork's too), its base the PR's"],
    [`${cli} new <project> --fan claude,codex --prompt "…"`, 'a race: the same prompt to each agent, a worktree each; Compare them in the app'],
    [`${cli} browser <ws> open /login · screenshot · click "<css>" · fill "<css>" "text" · text`, 'the agent browser: the dev server in a hidden window of the app'],
    [`${cli} send <ws>[/<tab>] "run the tests"`, 'type into an agent now; --when-idle waits for its turn to end'],
    [`${cli} progress 40 "writing tests"`, "in an agent's tab: how far along it is, on the tab (Settings › General › Progress on tabs)"],
    [`${cli} screen <ws>[/<tab>]`, 'the bottom of a tab’s screen'],
    [`${cli} tab <ws> --preset codex`, 'a new tab (a shell by default)'],
    [`${cli} run <ws>`, 'the run script, in a dev tab'],
    ...(ship ? ([[`${cli} ship <ws> -m "message"`, 'commit, push and open a PR']] as [string, string][]) : []),
    [`${cli} archive <ws> · restore <ws> · fork <ws> · rm <ws>`, 'put a workspace away, bring it back, branch off it, delete it'],
    [`${cli} schedule add <project> --when "weekdays at 9am" "…"`, 'a prompt on repeat (--where new|folder|<ws>, --name "Nightly {{DD-MM}}"); schedule, schedule log, on|off|run|rm <id>'],
    [`${cli} widget · widget reload · widget run <id> · widget render <id> --full`, "the sidebar's widgets: list them, read their folders again, fetch one now, the HTML it shows"],
    [`${cli} mcp`, 'an MCP server for Claude Code, Codex…: Settings › Agent skill has the command that adds it'],
    [`${cli} stop`, 'stop the daemon: agents resume when it starts again'],
    [`${cli} help`, 'every command'],
  ]
  // ready to paste: a recipe is a comment line, then its commands
  const recipes: string[][] = [
    ['# three agents on three tasks, at once', 'for t in "fix the login redirect" "add dark mode" "speed up the tests"; do', `  ${cli} new app --prompt "$t"`, 'done'],
    ['# a follow-up, typed in when its turn ends', `${cli} send fix-login --when-idle "now add tests and run them"`],
    ['# Codex, from another branch, with a name', `${cli} new app --preset codex --base develop --name api-v2 --prompt "add the v2 endpoints"`],
    ['# watch an agent from another terminal', `while sleep 5; do clear; ${cli} screen fix-login; done`],
    ['# a nightly agent in a fresh worktree, named by its date', `${cli} schedule add app --when "every day at 2am except weekends" --name "Nightly {{DD-MM}}" "update the deps, run the tests"`],
    ['# a tab that runs the tests on every change', `${cli} tab fix-login --cmd "npm test -- --watch"`],
    ['# done: look, then ship or put it away', `${cli} diff fix-login | less`, ...(ship ? [`${cli} ship fix-login -m "Fix the login redirect"`] : []), `${cli} archive fix-login`],
  ]
  const secs: Sec[] = [
    {
      id: 'start',
      title: 'Start',
      kind: 'list',
      items: [
        'Open a project: ⌘O, the folder icon at the top of the sidebar, or drop a folder on the sidebar. One on another machine: ⌘K › Open a project over SSH… (host:path).',
        'New workspace (⌘N): a git worktree and branch of its own (or the repo itself, with Local), an agent and a first prompt.',
        'Watch the sidebar: each workspace shows its most urgent tab. Click one to step in; ⌘K jumps anywhere.',
        'When it’s done: Ship (the arrow up in the tab bar) commits, pushes and opens a PR.',
      ].map((v, i) => ({ v, n: i + 1 })),
    },
    { id: 'keys', title: 'Keys', items: KEYS.map(([k, v]) => ({ k: kbds(k), v })) },
    {
      id: 'status',
      title: 'Status',
      items: [
        ...GLYPHS.map(([g, v]) => ({ k: <Glyph s={g} />, v, find: g })),
        { note: true, v: "A tab that waits or finishes off screen sends a macOS notification; Settings › General picks which and the sound, a workspace's or tab's menu mutes it." },
      ],
    },
    {
      id: 'window',
      title: 'Around the window',
      items: [
        { id: 'tabs', k: 'Tabs', v: 'Drag a tab along the bar to reorder, onto a pane\'s edge to split it, onto its center to trade places (Esc cancels); a pane\'s header drags too; double click to rename; right click for colors, split, restart, Mark as unread. Drop files on a terminal to type their paths.' },
        { id: 'asks', k: 'Asks', v: "An agent's numbered choices (a permission prompt) show as buttons under its terminal; a permission prompt's notification has Allow and Deny." },
        { id: 'race', k: <><Icon name="race" /> Race</>, v: "A race: the new workspace page's Race adds agents that each get a worktree on the same prompt. Compare (the workspace's menu, ⌘K) puts them side by side; Keep this one archives the rest." },
        { id: 'run', k: '▷ Run', v: 'The project’s run script in a dev tab, with $PORT; ■ stops it.' },
        {
          id: 'status-bar',
          k: 'Status bar',
          v: (
            <>
              The plan-limits ring (the 5-hour limit of Claude Code’s and Codex’s plans; click for each window and when it resets), branch ← base, $PORT (green while something listens on it), the other listening ports (click to open), the PR and its checks, and the fix CI / review / fix conflicts switches (their prompts, how often they check and how many tries: Settings › Pull requests). <i>daemon older than the app · restart</i> shows up after an update: click twice to restart the daemon (agents resume; a turn in progress is cut off).
            </>
          ),
        },
        {
          id: 'expose',
          k: <><Icon name="globe" /> Expose</>,
          v: (
            <>
              Expose to the world: next to a port, a public trycloudflare.com link with a QR code for your phone, optionally only for some email addresses. Needs cloudflared (<code>brew install cloudflared</code>).
            </>
          ),
        },
        { id: 'sidebar', k: 'Sidebar', v: "Click a project to fold its workspaces away; hover a workspace for ⋯, its menu (right click too); drag to reorder. Pin to top (its menu) keeps one under Pinned, above the projects. +12 −3 (Settings › General › Diff size): its lines changed against the base. GitHub's mark: the workspace has a PR (gray: draft; purple: merged; red: closed, or failing checks; a yellow ⚠ beside it: merge conflicts), with its author's picture when it isn't yours. Archiving a clean workspace is at once, with Undo. The funnel at the top filters them (words, needs you, working, with a PR); a group (a project's ⋯ › Add a group) holds the workspaces under it, folds with a click, takes a workspace dropped on its head, and its ⋯ gives it a color and makes a new workspace in it; a workspace's Remind me… notifies you about it later." },
        {
          id: 'templates',
          k: 'Templates',
          v: (
            <>
              Settings › Prompt templates, and each project's own: a prompt with <code>{'{{prompt}}'}</code> in it (and <code>{'{{project}}'}</code>, <code>{'{{base}}'}</code>, <code>{'{{pr}}'}</code>: the PR field, or a PR link in the prompt). Pick one under a new workspace's prompt: the agent gets it filled in. Dates are now's: <code>{'{{DD-MM-YY HH:MM}}'}</code>, any of YYYY YY MMMM MMM MM DD D dddd ddd HH H hh mm ss A in any order (MM after an hour: minutes); in actions too.
            </>
          ),
        },
        { id: 'actions', k: 'Actions', v: "Settings › Actions (and a project's): a prompt for an agent, or a command for a terminal. Run ▾ lists them for the workspace you're in." },
        { id: 'agents', k: 'Agents', v: "The new workspace page picks the agent's model and effort. The Dock icon and the menu bar count tabs that need you or finished unseen; Settings › Phone pushes sends them to your phone. Settings › General › Turn timers: how long each turn has gone." },
        { id: 'widgets', k: 'Widgets', v: 'Live tiles at the bottom of the sidebar (a click opens the full view): each a folder with widget.json and widget.html, fed by a command on a schedule while the app is open. Settings › Widgets turns them on, sizes them (and their full view: small, medium, large), sets them up and opens their folders; the Widget creator skill (Settings › Agent skill) has your agent make new ones, or Make one with AI there gives a prompt for any AI chat.' },
        { id: 'board', k: 'Board', v: 'The columns icon at the bottom of the sidebar: every workspace by where it is (running, needs you, done, PR open, merged); click one to open it. To do holds prompts: ▷, or a drag onto a column, starts a workspace on one.' },
        {
          id: 'scheduled',
          k: 'Scheduled',
          v: "The clock at the bottom of the sidebar (or ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at times you write, like “every day at 2am except weekends”, in a new workspace each run, its folder (a new session each run, or one) or a workspace you pick. {{DD-MM-YY}} and the like in the name or prompt become the run's date. The log lists each run; the clock gets a dot when one failed.",
        },
        { id: 'look', k: 'Look', v: "Settings › Appearance: themes (yours is checked; ✦ ones also change shapes and borders), glass (a see-through window: how much, and a glow), the interface font, how project names look and the sidebar's lines, rows and button labels. Settings › General exports every setting to a file, to import on another Mac." },
        { id: 'files', k: 'Files', v: "The side panel's preview colors code up to 50 KB and shows Markdown rendered or raw; right-click a file to open it in a browser or another app. The status bar's path has a copy button." },
        { id: 'changes', k: 'Changes', v: "Click a line of a diff to comment on it: on the PR (GitHub), or to the agent. With a PR, PR #n shows all of it (gh pr diff); GitHub's mark opens its Files changed." },
        { id: 'preview', k: 'Preview', v: "The toolbar's globe opens the side panel's Preview at localhost:$PORT (type /path, :5173 or any address); the devices button lays the page out at a phone's, a tablet's or a screen's size, or yours; the camera sends a screenshot to the agent; the crosshair puts a clicked element's selector, HTML, CSS and a screenshot of it in its prompt." },
        {
          id: 'links',
          k: 'Links',
          v: (
            <>
              <code>laki://ws/&lt;id&gt;</code> opens a workspace (a tab's menu: Copy link); <code>laki://new?project=…&amp;prompt=…</code> fills in a new one, <code>laki://settings/&lt;section&gt;</code>, <code>laki://schedules</code>, <code>laki://board</code>, <code>laki://help</code>, <code>laki://about</code> open pages.
            </>
          ),
        },
        { id: 'quit', k: 'Quit', v: '⌘Q quits the app: agents keep running in the daemon. Quit … Completely (the app menu) stops the daemon too; agents resume next time.' },
      ],
    },
    {
      id: 'cli',
      title: 'Command line',
      items: [
        {
          note: true,
          v: (
            <>
              Scripts and agents drive the same daemon with <code>{cli}</code> (the README says how to put it on your PATH). Agents learn it from the agent skill (Settings › Agent skill).
            </>
          ),
        },
        ...cmds.map(([c, v]) => ({ k: <code>{c}</code>, v })),
      ],
    },
    { id: 'recipes', title: 'Recipes', kind: 'pre', items: recipes.map(r => ({ v: r.join('\n') })) },
  ]
  // every word typed, in a row's key or text
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (it: Item) => {
    const t = `${textOf(it.k)} ${textOf(it.v)} ${it.find ?? ''}`.toLowerCase()
    return words.every(w => t.includes(w))
  }
  const shown = secs.map(s => ({ ...s, items: s.items.filter(hit) })).filter(s => s.items.length)

  // the section (and row) in view: the last whose top passed the page's, the last one at the bottom
  useEffect(() => {
    const m = main.current
    if (!m) return
    const spy = () => {
      const top = m.getBoundingClientRect().top + 24
      const end = m.scrollTop > 0 && m.scrollTop + m.clientHeight >= m.scrollHeight - 4
      const pick = (els: Element[]) => (end ? els.at(-1) : els.filter(el => el.getBoundingClientRect().top <= top).at(-1)) ?? els[0]
      const sec = pick([...m.querySelectorAll('section')])
      const row = sec && pick([...sec.querySelectorAll('.help-row[id]')])
      setAt({ sec: sec?.id, row: row?.id })
    }
    spy()
    m.addEventListener('scroll', spy, { passive: true })
    return () => m.removeEventListener('scroll', spy)
  }, [q])

  // Esc clears the filter, then closes; ⌘F or / goes to the filter
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (q) setQ('')
        else onClose()
      } else if ((e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        find.current?.focus()
        find.current?.select()
      }
    }
    window.addEventListener('keydown', f, true) // capture: App's ⌘F handler stops it on the way
    return () => window.removeEventListener('keydown', f, true)
  }, [q, onClose])

  const go = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="settings-page" role="dialog" aria-label="Help">
      <div className="settings-head">
        <b>Help</b>
        <span className="grow" />
        <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className="settings-body">
        <nav className="settings-nav help-nav" aria-label="Sections">
          <input
            ref={find}
            type="search"
            className="settings-find"
            value={q}
            placeholder="Filter (⌘F)"
            aria-label="Filter help"
            spellCheck={false}
            autoFocus={!matchMedia('(pointer: coarse)').matches} // not a phone's keyboard over the page
            onChange={e => setQ(e.target.value)}
          />
          {shown.map(s => (
            <Fragment key={s.id}>
              <button className={at.sec === `help-${s.id}` ? 'on' : ''} onClick={() => go(s.id)}>
                {s.title}
              </button>
              {(!!words.length || at.sec === `help-${s.id}`) &&
                s.items
                  .filter(it => it.id)
                  .map(it => (
                    <button key={it.id} className={`sub ${at.row === `help-${it.id}` ? 'on' : ''}`} onClick={() => go(it.id!)}>
                      {textOf(it.k)}
                    </button>
                  ))}
            </Fragment>
          ))}
          <button className="help-guide" onClick={() => openExternal(GUIDE)} data-tip={GUIDE}>
            <Icon name="link" /> The full guide
          </button>
        </nav>
        <div className="settings-main help" ref={main}>
          {shown.map(s => (
            <section key={s.id} id={`help-${s.id}`} className={s.id === 'cli' ? 'help-cmds' : undefined}>
              <h2>{s.title}</h2>
              {s.kind === 'list' ? (
                <ol>
                  {s.items.map(it => (
                    <li key={it.n} value={it.n}>
                      {it.v}
                    </li>
                  ))}
                </ol>
              ) : s.kind === 'pre' ? (
                <pre className="help-pre">{s.items.map(it => it.v).join('\n\n')}</pre>
              ) : (
                s.items.map((it, i) =>
                  it.note ? (
                    <p key={i} className="muted small">
                      {it.v}
                    </p>
                  ) : (
                    <Row key={it.id ?? (textOf(it.k) || i)} id={it.id} k={it.k}>
                      {it.v}
                    </Row>
                  ),
                )
              )}
            </section>
          ))}
          {!shown.length && <p className="muted">Nothing matches “{q.trim()}”.</p>}
        </div>
      </div>
    </div>
  )
}
