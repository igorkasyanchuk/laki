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
  ['⌃⌥⌘L', 'from any app: bring Laki forward (Settings › General › Global hotkey)'],
  ['⌘O', 'open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it'],
  ['⌘N', 'new workspace'],
  ['⌘T / ⌘W', 'new shell tab / close the tab (or the file in front in the preview); in a browser: a new page / close it'],
  ['⌘⇧N', "the tab bar's + menu: shell, an agent or a command (↑↓ ⏎, or its letter)"],
  ['⌘1…⌘9', 'go to a tab'],
  ['⌘↑ / ⌘↓', 'previous / next workspace'],
  ['⌘J', 'the next tab that needs you, in any workspace'],
  ['⌘L', 'send a message later: to an agent or Laki AI'],
  ['⌘⇧A', "show or hide the workspace's artifacts (the status bar's Artifacts too; click a folder to go in, ← or its path to go back; their ⋯: Finder, or the side panel's Files; right-click one to copy it)"],
  ['⌘⇧⏎', 'full screen: just the tab, or back (also the tab bar’s ⤢)'],
  ['⌘K', "the palette: every workspace (by its PR's number too: 123 or #123), tab and action"],
  ['⌘P', 'find a file in the workspace'],
  ['⌘F', 'find in the terminal (here: the filter)'],
  ['⌘S', "save the file you're editing in the preview"],
  ['⌘⏎ / ⇧⏎', "a new line in an agent's prompt, also one started in a terminal tab"],
  ['⌘-click', 'a file or folder link in a terminal: a file of the workspace in the preview, a folder in Finder. A web link opens on a click, or on ⌘-click in an app that takes the mouse (Codex)'],
  ['⌘← / ⌘→ · ⌥← / ⌥→ · ⌘⌫', "in a terminal: the line's start / end, a word back / on, delete the line"],
  ['⌘D', 'changes against the base branch'],
  ['⌥⌘B', 'side panel: info, files, changes, review, preview'],
  ['⌘I', 'workspace info, the side panel’s first tab: PR, checks, what each agent said last'],
  ['⌘E', 'open the workspace in your editor'],
  ['⌘B', 'hide / show the sidebar'],
  ['⌘,', 'settings'],
  ['⌘+ / ⌘− / ⌘0', "text in this tab bigger / smaller / back to Settings' size; each tab keeps its own (Settings or Help open: their size)"],
  ['⌘/', 'this page'],
  ['hold Fn', "talk, let go: it's typed where the cursor is (experimental: Settings › Voice's cloud; Esc or another key drops it)"],
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

export function HelpPage({ cli, ship, zoom = 1, onClose }: { cli: string; ship?: boolean; zoom?: number; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState<{ sec?: string; row?: string }>({}) // ids in view
  const main = useRef<HTMLDivElement>(null)
  const find = useRef<HTMLInputElement>(null)
  const cmds: [string, string][] = [
    [`${cli} ls`, 'projects, workspaces and tabs, with their status (--json for scripts)'],
    [`${cli} new <project> --prompt "fix the login"`, 'a workspace with an agent (--preset codex|shell, --model, --effort, --base, --name, --local)'],
    [`${cli} new . --preset codex --prompt "…"`, "in a Laki tab: a workspace in that tab's project (what an agent's /laki:new runs)"],
    [`${cli} new <project> --issue <url>`, 'a workspace on a GitHub issue: its title and text are the prompt'],
    [`${cli} new <project> --pr <url>`, "a workspace on a PR's branch (a fork's too), its base the PR's"],
    [`${cli} new <project> --fan claude,codex --prompt "…"`, 'a race: the same prompt to each agent, a worktree each; Compare them in the app'],
    [`${cli} browser <ws> open /login · screenshot · click "<css>" · fill "<css>" "text" · text`, 'the agent browser: the dev server in a hidden window of the app'],
    [`${cli} send <ws>[/<tab>] "run the tests"`, 'type into an agent now; --when-idle waits for its turn to end'],
    [`${cli} progress 40 "writing tests"`, "in an agent's tab: how far along it is, on the tab (Settings › General › Progress on tabs)"],
    [`${cli} memory . · memory add . "tests: npm test" · memory rm . <id>`, "a project's memory (in a Laki tab, . is its project): read it, keep a learned item, drop one; --mine: yours"],
    [`${cli} screen <ws>[/<tab>]`, 'the bottom of a tab’s screen'],
    [`${cli} tab <ws> --preset codex`, 'a new tab (a shell by default)'],
    [`${cli} run <ws>`, 'the run script, in a dev tab'],
    ...(ship ? ([[`${cli} ship <ws> -m "message"`, 'commit, push and open a PR']] as [string, string][]) : []),
    [`${cli} archive <ws> · restore <ws> · fork <ws> · rm <ws>`, 'put a workspace away, bring it back, branch off it, delete it'],
    [`${cli} schedule add <project> --when "weekdays at 9am" "…"`, 'a prompt on repeat (--where new|folder|<ws>, --name "Nightly {{DD-MM}}"); schedule, schedule log, on|off|run|rm <id>'],
    [`${cli} widget · widget reload · widget run <id> · widget render <id> --full`, "the sidebar's extensions (widgets): list them, read their folders again, fetch one now, the HTML it shows"],
    [`${cli} widget kit [element]`, "the UI kit's elements (widget.json's ui): each one's props and a sample; --json for all of it"],
    [`${cli} widget dev [folder]`, 'dev mode: your extension linked, on and watched (a save reloads it), its runs as they come; --off <id>, --list'],
    [`${cli} widget new "Deploys" --kind table`, 'an extension from a starter (number, list, table, chart, button, form, panel, workspace, stream, onefile): on, on sample data'],
    [`${cli} widget push <id> '{"n": 3}'`, "an extension's data from a cron job, a git hook or CI, no fetch (--merge: over what it has)"],
    [`${cli} widget render <id> --ws <workspace>`, "a per-workspace extension's instance (run, action and check take --ws too)"],
    [`${cli} widget check <id|folder>`, "what's wrong with an extension: widget.json, its ui against its sample and fixtures, its fetch once (--no-run)"],
    [`${cli} flow · flow run <workflow> <project> "…" · flow show <run>`, 'workflows (Settings › General › Experimental): list them and their runs, start one on a task, see where it is'],
    [`${cli} ai "what are my agents doing?"`, 'ask Laki AI (Settings › AI); --image <png> with a screenshot; ai log: each call and its cost; ai new: start over'],
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
        'Open a project: ⌘O, + at the top of the sidebar › Project folder…, or drop a folder on the sidebar. One on another machine: ⌘K › Open a project over SSH… (host:path).',
        'New workspace (⌘N): a git worktree and branch of its own (or the repo itself: untick worktree), an agent and a first prompt.',
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
        { id: 'asks', k: 'Asks', v: "An agent's numbered choices (a permission prompt, a question) show as buttons under its terminal and on its notification (macOS: under Options); Settings › Phone pushes › Answer from the phone puts them on a Telegram or ntfy push too." },
        { id: 'later', k: 'Send later', v: "⌘L, the toolbar's clock, a tab's right click or ⌘K › Send a message later…: a message (or one of Run ▾'s agent actions) for one of the workspace's agents or Laki AI (the AI page's clock too), in 10m, 2h, 1h 30m or at 15:30 / 3pm. A timer bar over the sidebar's bottom buttons until then (Send now, Edit, Cancel); queued if the agent is busy; not sent if Laki was closed when it was due." },
        { id: 'prs', k: 'Pull requests', v: "The PR panel (the side panel's Info and Review) and a right click on the status bar's PR: Merge… (squash, a merge commit or rebase; it asks first and can delete the branch on GitHub), Approve, Close. Merge when green merges once every check passes, there are no conflicts, it's approved if the repo asks and its agent isn't working. A project's settings › Pull requests says which of these Laki may do there (merge when green: off until turned on). A workspace's PR: the one its prompt named until its own branch, pushed, has one (one you attached or picked stays); the other moves to related in Info, with its from and started workspaces. A session an agent starts (/laki:new) keeps its prompt's PRs related; the PR's ⋯ › Not this workspace's PR moves a wrong one there." },
        { id: 'timers', k: 'Timers', v: "The timer at the bottom of the sidebar: a countdown, with a message if you like (Go out: on its bar and as it ends; ⏸ pauses it; then a sound and a dialog, or a notification: Settings › General › Timers; and the video paused, played or closed, or a command) or a stopwatch. A workspace's Remind me… and Send later are timers too: right click one to change it." },
        { id: 'race', k: <><Icon name="race" /> Race</>, v: "A race: the new workspace page's Race adds agents that each get a worktree on the same prompt. Compare (the workspace's menu, ⌘K) puts them side by side; Keep this one archives the rest." },
        { id: 'run', k: '▷ Run', v: 'The project’s run script in a dev tab, with $PORT; ■ stops it.' },
        {
          id: 'status-bar',
          k: 'Status bar',
          v: (
            <>
              The plan-limits ring (the 5-hour limit of Claude Code’s and Codex’s plans; click for each window and when it resets), branch ← base, $PORT (green while something listens on it), the other listening ports (click to open; not what an agent listens on itself, like its browser bridge, nor a browser it tests in), the PR and its checks (right click: copy its link or #number), and the fix CI / review / fix conflicts switches (their prompts, how often they check and how many tries: Settings › Pull requests), and merge when green where the project allows it (its settings › Pull requests: merge, merge when green, approve, close). After an update, a yellow bar at the top may say <i>Restart Laki's daemon</i>: click its button twice to restart it (agents resume; a turn in progress is cut off).
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
        {
          id: 'share',
          k: <><Icon name="globe" /> Share a tab</>,
          v: "A tab's right click › Share live view…: for 1, 8 or 24 hours or until you stop it, a live page anyone with the link reads (an agent's chat, else the terminal's text), with a QR code, Copy and Download as Markdown, and a switch for tool calls. The right click stops it; so does closing the tab. Needs cloudflared too.",
        },
        {
          id: 'workflows',
          k: <><Icon name="flow" /> Workflows</>,
          v: 'Settings › General › Experimental. Blocks Laki runs for a task: agents, commands, Case (text, numbers, JS), asks, an AI call, an AI decision (a decision model on OpenRouter answers how true, choice or score questions, a way out per answer if you like; unsure, it asks you), a webhook, Show you (a window with HTML or Markdown), PR actions. Each block has an ID for its {{steps.<id>.…}}. The editor’s sidebar: Blocks (a click adds one after the picked block, a drag drops it on the canvas) and {{ }} Variables (a click copies one, a drag puts it in a field). Notify me (and on my phone) on Show you and End; JSON mode on agents and AI calls. A block’s right click adds one after it, duplicates or deletes it. Test it sends an AI call, decision or webhook once. Laki AI changes the open workflow, or makes one after a few questions. A scheduled task can start one.',
        },
        {
          id: 'remote',
          k: 'Remote access',
          v: (
            <>
              Settings › Remote access: this app in a browser on your phone or another computer, for one email (or, if you confirm it, anyone with the link), through cloudflared (2026.9.3 or newer for an email). Or Sign in with › PIN (Laki): no email; the page asks for a 6-digit PIN shown here, a new one each start, and a wrong one (twice, or what you pick) stops remote access. It won't start, or Cloudflare's sign-in won't let you in? Run <code>cloudflared tunnel login</code> once in a terminal: it signs cloudflared in to your Cloudflare account.
            </>
          ),
        },
        { id: 'shells', k: 'Terminals and browsers', v: "+ at the top of the sidebar › Terminal: a shell in your home folder, under Terminals; › Browser: any website under Browsers, with an address bar (a site, or words to search), its sign-ins kept. A shell running a command spins until its prompt is back, 5 seconds at most (a server or vim runs on); an agent typed in it spins its whole turn." },
        { id: 'start', k: 'Get started', v: "The first steps, shown once: each ticks itself as you do it (or click its circle). What's left stays at the bottom of the sidebar; ⌘K › Get started opens it again." },
        { id: 'sidebar', k: 'Sidebar', v: "Click a project's arrow to fold its workspaces away, its name for its page (notes, scheduled tasks, memory, settings; Settings › Global memory goes to every project); hover a workspace for ⋯, its menu (right click too); drag a workspace or a project to reorder. A project's ⋯ › Notes: your Markdown notes for it. A workspace with no PR found: ⋯ › Attach a PR… (or + PR in the status bar). Pin to top (its menu) keeps one under Pinned, above the projects; Pin to the rail puts it (a terminal or browser too, 5 at most) on the rail, a click away. Run › (its menu): the toolbar's Run ▾ for it. +12 −3 (Settings › Git & worktrees › Diff size): its lines changed against the base. GitHub's mark: the workspace has a PR (gray: draft; purple: merged; red: closed, or failing checks; a yellow ⚠ beside it: merge conflicts), with its author's picture (yours too). ✓ an open PR approved, ✓✓ by you too, 👀 you commented (Settings › Appearance › Pull request marks). Archiving a clean workspace is at once, with Undo. The funnel at the top filters them (words, a PR's number, needs you, working, with a PR); a group (a project's ⋯ › Add a group; a workspace's ⋯ › Move to group) holds the workspaces under it, folds with a click, takes a workspace dropped on its head, its + makes a new workspace in it and its ⋯ gives it a color; a workspace's Remind me… notifies you about it later. The rail puts Projects, Board, Schedule, Terminal and Browser on the left (Slack's), each with what needs you (Board and Schedule: a page over the list), Settings at its bottom, and the list shows the one you pick (Settings › Appearance › Rail › Labels: words under the icons, or icons only; Terminals or Browsers off: that project in Projects' list)." },
        {
          id: 'templates',
          k: 'Templates',
          v: (
            <>
              Settings › Prompt templates, and each project's own: a prompt with <code>{'{{prompt}}'}</code> in it (and <code>{'{{project}}'}</code>, <code>{'{{base}}'}</code>, <code>{'{{pr}}'}</code>: the PR field, or a PR link in the prompt). Pick one under a new workspace's prompt: the agent gets it filled in. Dates are now's: <code>{'{{DD-MM-YY HH:MM}}'}</code>, any of YYYY YY MMMM MMM MM DD D dddd ddd HH H hh mm ss A in any order (MM after an hour: minutes); in actions too.
            </>
          ),
        },
        { id: 'actions', k: 'Actions', v: "Settings › Actions (and a project's): a prompt for an agent, or a command for a shell. Run ▾ lists them for the workspace you're in (rest on one for its text); a shell action runs in a shell at its prompt, else a new one." },
        { id: 'agents', k: 'Agents', v: "The new workspace page picks the agent, its model and effort under the prompt (type in a picker to filter it, ⏎ picks). The Dock icon and the menu bar count tabs that need you or finished unseen; Settings › Phone pushes sends them to your phone. Settings › Appearance › Turn timers: how long each turn has gone. In a Claude Code tab, /laki:new <the task> with codex starts it in a new workspace of the project." },
        { id: 'widgets', k: 'Extensions', v: 'Extensions (also called widgets or plugins): live tiles in the sidebar, the top bar or the status bar (a click opens the full view), or buttons on the rail and in the sidebar’s foot (an icon, a label and a count kept up to date, a click that runs one of its actions): each a folder with widget.json (its ui: the UI kit, Settings › Extensions › UI kit) and, for a look of its own, widget.html, fed by a command on a schedule while the app is open. Settings › Extensions lists them, each with its switch (each starts off); a click on one places it (sidebar, top bar, status bar, rail, sidebar foot), sizes it (and its full view: small, medium, large), sets it up, gives a JS one network access, opens its folder or deletes it; the Extension creator skill (Settings › Agent skill) has your agent make new ones, or Make one with AI there: type what you want, then Make it with Laki AI (its chat asks you a couple of questions, then writes it), or Copy the prompt into any AI chat. Laki AI makes them too, saved off until you turn them on; Edit with Laki AI rewrites one of yours. The list: Yours, then Built in.' },
        { id: 'board', k: 'Board', v: 'The columns icon at the bottom of the sidebar: every workspace by where it is (running, needs you, done, PR open, merged); click one to open it. To do holds prompts: ▷, or a drag onto a column, starts a workspace on one.' },
        { id: 'specs', k: 'Specs & Brainstorms', v: "Experimental (Settings › General turns it on), then Specs on the rail (or the sidebar's foot, or ⌘K): specs (what to build, like a Notion page) and brainstorms (ideas Laki AI explores beside them) in one list, newest first, each with its kind; filter by words, project or kind (All, Specs, Brainstorms). New ▾ starts either, empty or from a template (Edit templates… at its foot). A click opens one the page's whole width; the breadcrumbs go back." },
        { id: 'bird', k: 'Bird view', v: 'Experimental (Settings › General): the eye beside Help shows every live session at once, a card each under its workspace with its screen as it is now; All, Working or Needs you. A click opens it.' },
        { id: 'glow', k: 'Laki AI’s glow', v: 'Experimental (Settings › General): as Laki AI reads a tab or uses the agent browser, a rainbow edge turns once around that tab (else the window), then fades.' },
        { id: 'ai', k: 'AI', v: "Settings › AI (or General › Experimental) turns it on (OpenRouter with your key, or claude -p / codex exec), then AI on the rail, in ⌘K or in the floating bubbles' +: ask in plain words (⏎ asks, ⇧⏎ a new line), or paste a screenshot of PR links (a thumbnail; a click shows it big), and it starts workspaces (with a group's template, or one that fits), opens tabs, sends prompts and attaches PRs. It never archives, deletes, ships or merges. New chat keeps the one it ends in the page's sidebar: a click takes it up again. Calls: each ask with its tokens and cost. Settings › AI › Pasted images: how many days they're kept (30). The chat button at the bottom right (every page but AI, Settings, Help and Specs) opens the same chat over what you're doing, and tells it the page, workspace and tab you're on." },
        {
          id: 'scheduled',
          k: 'Scheduled',
          v: "The clock at the bottom of the sidebar (Rail and list: the rail's Schedule; or ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at times you write, like “every day at 2am except weekends”, in a new workspace each run, its folder (a new session each run, or one) or a workspace you pick. {{DD-MM-YY}} and the like in the name or prompt become the run's date. The log lists each run; the clock gets a dot when one failed.",
        },
        { id: 'look', k: 'Look', v: "Settings › Appearance: themes (yours is checked; ✦ ones also change shapes and borders), glass (a see-through window: how much, and a glow), the interface font, how project names look and the sidebar's lines, rows and button labels. Settings › General exports every setting to a file, to import on another Mac. Accent and corners go over the theme's (every corner it draws); Settings & Help size: ⌘+ / ⌘− while either is open." },
        { id: 'resources', k: 'Resources', v: "Settings › Resources: memory and CPU, Laki's own and each tab's. Sleep an idle agent (it wakes as you look at it; Settings can sleep them after a while); Stop the video, an extension, the preview, an agent browser or the floating bubbles until they're opened again. A graph shows memory and CPU over the last minutes; sort the rows by memory or CPU." },
        { id: 'worktrees', k: 'Worktrees', v: "Settings › Git & worktrees: where new worktrees go, a folder per project (~ is home; a project's settings can pick its own; ones made already stay), their branch prefix, and Sync the base branch (off: git fetch first, then off origin's). A new one starts off the repo's main branch unless you pick another." },
        { id: 'files', k: 'Files', v: "The side panel's preview colors code up to 50 KB and shows Markdown rendered or raw; each file opened is a tab over it, with its own unsaved edit (a middle click or ⌘W closes one; drag its left edge to widen it). Right-click a file to open it in a browser or another app. An HTML or Markdown artifact opens in a viewer over the app (Settings › General › Storage: or in the browser). The toolbar's ⋯ › Copy path copies the workspace's path." },
        { id: 'changes', k: 'Changes', v: "Click a line of a diff to comment on it: on the PR (GitHub), or to the agent. With a PR, PR #n shows all of it (gh pr diff); GitHub's mark opens its Files changed. The button beside Expand all shows two columns, before and after side by side." },
        { id: 'preview', k: 'Preview', v: "The toolbar's globe opens the side panel's Preview at localhost:$PORT (type /path, :5173 or any address); the devices button lays the page out at a phone's, a tablet's or a screen's size, or yours; the camera sends a screenshot to the agent; the crosshair puts a clicked element's selector, HTML, CSS and a screenshot of it in its prompt." },
        {
          id: 'links',
          k: 'Links',
          v: (
            <>
              <code>laki://ws/&lt;id&gt;</code> opens a workspace (a tab's menu: Copy link); <code>laki://new?project=…&amp;prompt=…</code> fills in a new one, <code>laki://settings/&lt;section&gt;</code>, <code>laki://schedules</code>, <code>laki://board</code>, <code>laki://help</code>, <code>laki://about</code>, <code>laki://onboard</code> open pages.
            </>
          ),
        },
        { id: 'quit', k: 'Quit', v: '⌘Q quits the app: agents keep running in the daemon. Quit … Completely (the app menu) stops the daemon too; agents resume next time, and shells come back in their folder with what ran in them (an agent resumed, a command typed for ⏎).' },
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
    <div className="settings-page" role="dialog" aria-label="Help" style={{ zoom }}>
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
