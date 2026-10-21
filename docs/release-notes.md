<!-- Laki's release notes, shown in Settings › Release notes. Newest first. Each user-visible addition: a line under
"## Next" (add that heading above the newest version if it isn't there). `npm run dmg` turns "## Next" into the
version it builds, with the date. -->

## Next

- Laki tells an agent by the tab its process runs in, not by its environment: an agent that hides its variables still
  can't turn an extension on, force a held ship, run a scheduled task now or answer a workflow's question. A task an
  agent schedules is saved off, and an agent's send to, or screen read of, another workspace's tab asks you first.
- Remote access's link opens once, in one tab (the page keeps a key of its own), and from the browser it can't start
  remote access again, install the laki command, change phone pushes, presets, env or extension folders, sign in
  accounts, turn an extension on or quit the daemon. Without an email it runs 24 hours at most; laki serve
  --cloudflare --open needs --hours, and laki serve keeps the PIN out of a service's log.
- Answer from the phone signs each ntfy tap, so a made-up tap is ignored, and needs a topic only you can read (your
  own ntfy server, or ntfy.sh with ?auth=). Where it was on with a plain ntfy.sh topic, the upgrade turns it off and
  Settings says why.
- Expose to the world warns when *Only these emails* names a webmail domain (`*@gmail.com`, Outlook, iCloud, Proton…):
  anyone can get an address there. *Anyone with the link* says what a dev server trusts from localhost is open too.
- An artifact's, a spec's prototype's or an extension's page link opens only that workspace's artifacts, that plan or
  that extension: each has its own key now.
- Pull requests: *fix CI* sends failing logs fenced and marked as the PR's own output, and asks before turning on for
  a PR from a fork. *review* sends only the bots in Settings › Pull requests' new *Review bots* (GitHub Actions,
  Copilot's reviewer, CodeRabbit): any other bot's comments are skipped.
- Workflows: a Run command's `{{…}}` (a PR's title, an event's field, an agent's answer) go in as environment
  variables, never as text the shell reads. One inside single quotes is now a problem the editor shows.
- An agent's prompt reaches it through an environment variable, never quoted into a shell line: a prompt can't break
  out under fish. Variables typed into a fish shell tab are quoted fish's way.
- Workflows: a project's workflow that came with the repo (or changed since) starts on an event, a schedule or an
  agent's ask only once you Save it in its editor or *Trust it…*. Your own Start still runs it. A repo workflow you
  used before this version: save it once.
- A repo's `.laki.json` runs nothing until you trust it: the status bar says *.laki.json waits for you*, a click shows
  the file and *Trust this repo's .laki.json*, and an edit to it waits again. Projects you had before this version are
  trusted as their file is now. Env that changes how programs start (`PATH`, `ZDOTDIR`, `NODE_OPTIONS`, `DYLD_*`…)
  never comes from the file.
- A repo's `.laki.json` comes from the project's own folder only, never a workspace's branch: a PR's checkout or a
  fork can't bring its own setup, env or scripts.
- An extension that's off (Laki AI's new ones, in the studio's preview) can't open links, copy or show dialogs from its
  page until you turn it on.
- Extensions: a secret setting's value is masked (••••) in an extension's error and its Runs, not only in its log.
- Settings' Export no longer carries remote access's and tunnels' emails or workflows' variables, and Import keeps this
  Mac's. The worktrees folder Laki makes is yours alone (0700).
- Turning on an extension shows its `widget.json` as it is on disk now, even one changed a moment before.
- A repo's extension: its turn-on sheet lists every file it's trusted as and the scripts it runs; one with a link out
  of its folder, or past 2,000 files, can't be turned on, and a link to a folder inside it is checked like the folder.
- Laki AI shows you a command before it runs in a shell, with *Yes, run it* / *No*: it no longer runs one on its own.
  Typed for you (Enter yours) and messages to agents need no Yes.
- An agent's `laki new` and `laki tab` (and MCP's) can't start a command of its own (`--cmd`, a command preset): only
  an agent or a shell. Yours still can.
- Extensions: an agent's event (`laki widget emit` in its tab, Laki AI's) only makes extensions fetch again; it no
  longer runs their actions.
- Workflows: one an agent wrote runs only from its editor's *Start* until you save it: not on a schedule, an event,
  Run again or the CLI. Deleting it and Undo keep it marked.
- A failing check in Info and Review has **Log**: the end of its failed steps, so you see why CI is red before you
  decide who fixes it. *Send to the agent* sends that check alone, *Copy*, *Open on GitHub*.
- **Laki AI, Voice, My Desk, Bird view and Laki AI's glow are no longer experimental**: on by default. Turn one off in
  Settings › AI (Laki AI, its glow), Settings › Voice, or Settings › General › Pages (My Desk, Bird view).

## 0.23.0 · Oct 21, 2026

- Workflows: an Agent block can say how freely its agent acts (auto, accept edits, plan, bypass) and use fast mode;
  the workflow's head sets one for all its agents. A workflow whose agent never asks is yours to start, not an agent's.
- Workflows run in a workspace you have: its ⋯ › **Run workflow**, ⌘K's *Run workflow: …*, `laki flow run … --ws .`;
  `runs in: here` for one that always does.
- Workflows: **Run again** on an ended run (its task and inputs, the workflow as it is now), and a block's **Run from
  here**: on from that block in the same workspace, the agent work before it kept. `laki flow again <run> [--from]`.
- Workflows: a deleted one goes to the trash (Undo, `laki flow restore`), and each save keeps the one before: ⋯ ›
  **History…** to look at the last 20 and bring one back.
- Workflows after a restart: an agent whose chat came back is told to finish its step, not handed the whole prompt again.
- Workflows clean up: a done run's worktree is archived when nothing is left uncommitted (`when done: keep` keeps it).
- `laki flow check [file.md… | folder]`: a workflow file's problems without Laki running, for a hook or CI; exit 1 on one.
- A *Context* starter (`laki widget new Context --kind context`): actions in ⌘K, a file's right click and the prompt's
  Insert menu, to copy from.
- Extensions can come with a repo (`.laki/extensions/`): off until you look at what they run, off again when the repo
  changes them, and shown only in that project's workspaces.
- Gates: an extension's action can hold a ship, a merge or an archive with its reason (`"gate"` in widget.json); you
  can do it anyway, or send the agent its fix. Merge when green waits on them too.
- More events for extensions: a ship's end, a workflow's end, a usage limit, a new tab, a port starting to listen. Send
  your own with `laki widget emit <name>`; a workflow can start on any of them (`on:` in its head).
- Extensions keep logs, off until you turn them on (Settings › Extensions for all, or one's *Keep a log*): Laki's lines,
  each run and its stderr, secrets masked. Its page's **Logs** tab follows them; `laki widget logs <id> -f` too, and
  `laki widget log` adds a line from a script.
- Extensions: a Yes holds only for the files you were shown. Laki AI's *Turn on*, the studio's and a tool's ask refuse
  when the extension changed while you were asked (Laki AI asks again). `laki widget what <id>` says what it runs.
- Security: an extension's HTML can't add a web view, and every web view runs with web security on.
- Security: Laki's daemon answers only requests addressed to it (127.0.0.1, localhost, or remote access's link), so
  a web page can't reach it by renaming itself (DNS rebinding).
- Settings › General › **Export** leaves out env, presets' env and the phone webhook (secrets); Laki's state file and
  the workspaces' storage folders are yours alone (0600, 0700).
- Security: the installed app ignores development settings in its environment, and a page inside it (an extension, an
  artifact) gets no permission beyond full screen and copying.
- Workflows' webhooks go to https URLs only (plain http to this Mac) and don't follow redirects: a 3xx is the
  answer.
- **Expose to the world** asks for how long: 1, 8 (the default) or 24 hours, or until you stop it. A tunnel left
  open stops on its own.
- Deleting an extension asks first.
- Deleting a workspace says what goes with it: its branch and folder, uncommitted files, commits not pushed, its PR,
  agents at work, servers and artifacts.
- Laki AI keeps what you typed and pasted and didn't send (text and screenshots), per chat (the AI page, the floating
  chat, the extension studio, a brainstorm's chat, My Desk's *Build with AI*), until you send it, after a restart too.
- Back and forward (‹ › on the rail, ⌘[ ⌘]) are on for everyone, out of experimental, and go 25 places back (was 10);
  Settings › Appearance › Rail turns them off.
- The rail is yours to arrange, like Slack's: Settings › Appearance › Rail picks its buttons and their order (drag
  them), the rest go into ⋯ More; a right click on a button moves it there.
- The extension studio goes on when you close it: Settings › Extensions › *In the studio* (and a new studio) lists
  what Laki AI is building or you left unsaved, a click goes back to it. Laki AI works in up to 4 chats at once, so a
  new extension (or a brainstorm) starts while another builds.

## 0.22.0 · Oct 20, 2026

- GitHub labels on a pull request: the PR section (Info, Review) shows its labels, and its tag button lists the
  repository's: a click puts one on or takes it off.
- The sidebar's extensions sit in a grid 4 cells across instead of 3; sizes go up to 4 across, and Links, My PRs
  and the starters take the whole row.

## 0.21.0 · Oct 19, 2026

- Extensions' dialogs: up to 6 buttons styled primary, danger or quiet, a UI kit element inside (a table, a toggle,
  a form), a button that keeps it open while its action runs, and an id an action updates or closes it by.
- My Desk's **Build with AI** is a dialog now: a text area, screenshots (paste, drop, attach, or take one) and text
  files; **Build it** opens the extension studio, where Laki AI builds it.
- The floating **Laki AI** chat resizes from its edges and corners, and keeps its size.
- An extension's AI agent asks in Laki before a tool it may not use (a Slack read, say): **Allow once**, **Always**
  (its page lists them, with Revoke) or **Deny**, as a dialog and a notification.
- Rename an extension from its page: click its name.
- Thin, rounded scrollbars everywhere, Settings included.
- 16 new UI kit elements, after DaisyUI's: hero, mockup (browser, window, terminal, phone), filter (chips that keep
  the rows with their words), rotate (words that take turns), compare (two pictures, a divider to drag), skeleton,
  radial, indicator, avatar (sizes, shapes, a ring), range (a slider), select, input (a box and a button), swap,
  pagination, menu and dropdown.
- The UI kit's elements in 13 groups by kind (Layout, Navigation, Text, Code, Numbers, Charts, Status, Lists, Media,
  People, Developer, Buttons, Inputs): a section each in the gallery, and chips to show one.
- 20 more UI kit elements, for developers (after shadcn/ui's and the dev tools people use): popover, command (a
  palette: ↑ ↓ and Enter), combobox, datepicker, split button, radio cards, textarea (an action, or a prompt for a new
  workspace, the agent or Laki AI), snippet (npm / pnpm / yarn tabs), env (secrets behind dots, copy as .env), uptime,
  deploys, issues (Linear's look), endpoints, changelog (conventional commits), clock (time zones), funnel, swatches,
  CI matrix, marquee and bento.
- The rail with labels puts its least used pages (Calendar, Flows, Specs, Board) in a ⋯ More menu once they don't fit.
- Fixes: ⌘P no longer leaves an empty window.

## 0.20.0 · Oct 19, 2026

- Fixes: **Always in this chat** stays with its chat when you open an earlier one; a note's pin and color follow a
  right click in the list; **Back** skips the extension studio while Laki AI is off.

## 0.19.0 · Oct 19, 2026

- **Notes** (experimental: Settings › General): your own notes, one list for every project, on the rail's Notes:
  written like a Notion page (headings, checklists, tables, code, images, diagrams), each with a color, pinned or not,
  found by search, with the start of its text in the list.
- **Back and forward** (experimental): ‹ › at the rail's top, ⌘[ and ⌘], go back through the pages and workspaces you
  were on, the last 10, as in a browser; a right click lists them.
- **Laki AI asks before a tool it may not use**: with the claude backend, a file outside its folder (say) is a question
  in the chat, *Allow once*, *Always in this chat* or *Deny*, where it used to give up.
- **A new remote access PIN page**: one solid card, a ring that fills as you type the PIN and turns green as it opens,
  and *Unlock* is always a button.
- **Desk is My Desk**, and its tabs no longer show a count; an extension's *Its page* is now *Edit*.
- **More for extensions' UI kit**: a table's column can show a picture with a name and a line under it, a progress bar,
  a badge, a sparkline, a copy button and buttons; a list row can end in a small bar. New elements: `accordion` (panels
  that fold, one open at a time, other elements inside), `breadcrumbs`, `gallery` (pictures in a row that scrolls) and
  `loading` (a spinner, dots or a moving bar).
- My Desk keeps room under the last row, so a bottom tile's corner is clear of the AI button for resizing.
- Extensions scroll with a slim scrollbar, as the sidebar does.
- The new-workspace page keeps its top row on one line: a long project, branch or name gets cut with … instead of the
  template and agent wrapping to a row of their own.

## 0.18.0 · Oct 19, 2026

- **Workflows: tell me your way**: an End or a Show you block shows in a window, a popover in the corner, a macOS
  notification, or any of them together.
- **A new New workspace page**: where it goes in a row over the prompt, and the agent's model, effort,
  permission mode (*Auto mode*, *Accept edits*, *Plan mode*, *Bypass permissions*) and ⚡ fast mode in the prompt's
  toolbar, with a round button that creates it. Kept for its restarts and forks.
- **Browsers: Google sign-in**: Google accounts sign in inside Laki's browser (Gmail, Docs, YouTube); if Google turns
  it down anyway, the sign-in opens in your own browser.
- **Remote access: Tailscale with a PIN, and Funnel**: *Ask for a PIN as well* on the tailnet, or *Funnel* for the
  public internet (always with a PIN; `laki serve --tailscale --funnel`). Laki now says when no other device is on
  your tailnet: a Mac can't open its own Tailscale link.
- **Changes: Revert**: take back the agent's edit in one click: a hunk (its header's *Revert*), a few lines of one
  (⌥-click, ⇧-click a range, then *Revert these*) or a whole file (its right click), with *Undo* in the toast.
- **Workflows: a colored File view**: the file is colored as you type it (headings, keys, prompts, options,
  `{{variables}}`).
- **Get started has 5 more steps**: Experimental, Agents & profiles, remote access, Scheduled tasks and Workflows, each
  ticked as you look at it.
- **A *Pull main* starter**: Settings › Extensions › New ▾ › From a starter: a status bar button per workspace that
  merges the base branch in, through its agent, git (claude -p for conflicts) or claude -p; a template to make yours.
- **Desk tabs with icons**: a tab's right click › *Icon…* puts one of Laki's icons, or an emoji you type or paste,
  before its name.
- Resizing a Desk tile always ends as you let go, even outside the window or over its title bar (Esc too); before,
  it could stay in its resizing look.
- **Workflows: an agent's question stops the run, not just its tab**: a permission prompt in an Agent block shows on
  the run with the agent's choices as buttons; a pick answers it in the tab.
- **Workflows: no more agents that hang forever**: an Agent block's turn has a timeout (an hour unless set: then Esc
  and its error way); one that prints nothing for 10 minutes gets a nudge, then the run asks you (Nudge again, Try
  again, Skip it, Stop the run).
- **Workflows: inputs**: Start can ask for more than the task (`inputs: issue:number, base:branch=main`): a field
  each in *Run*, `--set issue=1423` on `laki flow run`, `{{inputs.issue}}` in any block.
- **Workflows: a queue past *Runs at once***: a run started (or scheduled) while the workflow has its runs going
  waits its turn instead of failing, and starts by itself as one ends.
- **Workflows: tries again**: `retry: 2` on an Agent, Run command, AI call, AI decision or Extension block runs it again
  after a failure (10 s, then a minute) before its error way; a command can retry only some exit codes.
- **`laki help <command>`**: a command's options, what it prints and examples (`laki <command> --help` too, and
  `laki --help`); the agent skill tells agents to ask it.
- **Copy a tab's contents**: a tab's right click › *Copy contents* (⌘K too): its whole terminal as text, the
  scrollback too.
- **Skills out of date**: when the skill your agents have differs from this Laki's, a bar says so with *Update*;
  Settings › Agent skill has *Update all*.
- An extension's Settings card in sections (where it shows, updates, its settings), each field saying what it does.
- Specs & Brainstorms, Workflows and the extension studio open without a flash of the workspace under them.
- The floating Laki AI chat moves: drag it by its head; it stays where you leave it (a double-click puts it back).
- **Laki AI arranges your extensions**: ask it to put one on the Desk, resize it, fetch it less often or change a
  setting; to turn one on it asks you, with what it runs, and a Yes turns it on. Agents get `laki widget set` for the same
  (never on, a secret, its source or network access).

- **Secret settings for extensions**: a token or a key is a `secret`: a password box in Settings, kept apart and given
  only to its fetch and actions, never to its page, the app, `laki ls` or MCP. A value saved as text moves over.
- **Undo for deleting an extension**: Delete moves it to a trash, with Undo in the toast; `laki widget trash` and
  `laki widget restore` for 30 days.
- **Agents can't skip your OK**: `laki widget action` from an agent asks you first, `laki widget on` is yours only,
  and `laki widget dev` from an agent leaves the extensions off. *Always* for a tool holds only while its command and
  files stay as they were.
- An extension's fetch that times out, or a stream you stop, ends what it started too.
- The checker takes `refresh` on an event for a file or URL source.
- **Remix without Laki AI**: any extension, a built-in too, copied to change, from its row, its Files (*Remix it…*) or
  `laki widget remix <id> [new-id]`.
- **Settings an extension needs**: `"required": true` on one; My PRs needs its Repo: turned on without it, its page
  opens at that field, and its cell says *Set Repo*.
- **Per-workspace extensions on the Desk** show the workspace you picked last, named on the tile.
- **Extensions where you work**: an extension's actions can show up in ⌘K, a workspace's, tab's or file's right
  click, a shortcut of their own, and the new-workspace prompt's *Insert* menu; they can ask first, confirm, put their
  text in the prompt, or open their full view (a file opener).
- **Two more places for extensions**: a tab of the right panel, and a mark on each workspace's row (a per-workspace
  one's count for that workspace).
- Extensions fixed: an agent's source runs at most every few minutes whatever asks; a burst of events fetches once; a
  fetch that keeps failing waits longer each time; a notice isn't lost while the app is closed; a workspace's archive
  and removal reach its per-workspace extensions; agents' tool asks wait their turn instead of denying each other; the
  extension page's chat is its own; Settings tags every place; *Check* warns at data fields Laki's own names hide;
  MCP's extension tool names stay unique.

- **Extensions in scheduled tasks and workflows**: a task can fetch an extension or run one of its actions at its
  times; a workflow's Extension block fetches one and hands its data to the next blocks.
- **Hide an extension's refresh button and when it was fetched**: two switches on its page, for the sidebar, the
  Desk and its full view alike.
- **Two more dark themes**: Hallownest (Hollow Knight: a cavern's pale motes, carved small-caps headings, a soul's
  glow on what's picked) and Upside Down (Stranger Things: falling ash, a red title-card glow, Christmas lights over the
  status bar).
- **Stop an extension's agent**: an AI extension's run (its data, or a button an agent answers) has a Stop in its
  page and in Settings › Resources; turning it off or deleting it stops it too. Its last data stays.
- **Eleven more UI kit elements**: kbd (shortcuts), secret (a key behind dots, copied whole), rating (stars), calendar
  (a month with its days dotted), people, inbox, chat (bubbles), prs (GitHub style), commits, segmented (pick one,
  runs an action) and stepper (− and +).
- **The UI kit's Typography and Colors**: every text style and color as an extension draws it, with its JSON a click
  away; the tones, the palette and the theme's variables as swatches in this theme.
- **252 more icons** for extensions: arrows, files, messages, people, media, devices, weather, money, time, places,
  tools and shapes, grouped in Settings › Extensions › *Icons* (search finds a group too: *weather*).
- An extension's Examples have *Copy*; its Data's first choice is now called *Own script*.
- **AI as an extension's data**: an extension's Data can be *AI*: an agent (Settings › Extensions › *Agent profile*,
  claude or codex) finds it with your own MCP servers and sums it up, every hour: Slack's new messages, Linear's
  tickets, anything an MCP server reaches. It's told to change nothing; each run shows in Laki AI's Calls.
- **Agents in extensions' buttons, and notifications**: an action can be a prompt an agent answers (*Draft a reply*,
  *Explain this failure*), its answer in a dialog; `notify` posts a notification when an extension's data says
  something new (*3 new mentions*).
- **New extension**: *With Laki AI*, or *From a starter*: every starter shown on its sample data. The UI kit is first
  on Settings › Extensions (*Browse 60 elements*). The studio's preview has the Desk view too.
- **Desk**: resizing a tile at the bottom of a scrolled Desk no longer jumps; dragging near the edge scrolls.
- **Pick an element** (development mode) knows extensions: which one, its view, the UI kit's element, its data and folder.
- **Ten more UI kit elements**: quote, diff, countdown, steps (a pipeline), meter (one bar in parts), board (cards in
  columns), tree (rows that fold), log, json and toggle (a switch that runs an action). An example: a deploy.
- **Icons**: Settings › Extensions › *Icons* shows every icon an extension can use, with a search; a click copies its
  name (`laki widget kit icons` in a terminal).
- **Desk tabs**: keep tiles apart in tabs; drag a tile's head onto a tab, or use its ⋯ › *Move to tab*.
- **Edit an extension in Laki**: its page's Files tab edits its files (⌘S saves; JSON is checked, it reloads at once),
  and *Edit* in its head goes to its settings. The Data tab has where its data comes from, its data and its examples;
  the preview's *Sample* picks one of them. Every starter, and My PRs, comes with three more made-up variants.
- **More for extensions**: pick where one's data comes from on its card: its fetch, a text you type (JSON, or a
  Markdown note), a file or a URL. The UI kit gets headers, footers, toolbars, callouts, icons, gauges, heatmaps,
  status lists, checklists, avatars and cards; charts as stacked or horizontal bars, pie, donut and scatter; colors from
  the theme's palette or a hex; buttons that ask Laki to start a workspace, send a prompt to an agent or Laki AI, run a
  command in a terminal or open a page. The UI kit page has 13 examples and every color, and an extension's Files tab
  shows its files. New starters: a note and a launcher.
- **The UI kit for extensions**: draw one with JSON in its widget.json (`ui`): stats, lists, tables, charts, forms,
  tabs and more, in the app's theme and at any size, no HTML. Settings › Extensions › *UI kit* shows every element with
  its sample and the JSON to copy (`laki widget kit` in a terminal); Laki AI and the Extension creator skill use it.
  My PRs is built with it.
- **Dev mode for extensions**: `laki widget dev` in your extension's folder links it: on, reloaded as you save (a file
  that doesn't read keeps the last good version running), each fetch printed as it runs. Its page gets Data (edit it, or
  pick a fixture, to see it with that data), Runs (why each ran, its stderr), Env and Files tabs; a right click on an
  extension › *Inspect* opens them.
- **Extension starters and a checker**: Settings › Extensions › *New ▾* (or `laki widget new`) makes a number, list,
  table, chart, button, form, JS page or one-file extension that runs at once on sample data. `laki widget check` (its
  page's *Check* tab) finds unknown keys with a guess, bad places, missing actions and fields its rows use that the data
  hasn't. Editors complete widget.json from its schema, and one script named `prs.5m.sh` is a whole extension.
- **Extensions per workspace**: `"scope": "workspace"` makes one show the selected workspace's own data (its branch, PR,
  port, path as `$LAKI_BRANCH`, `$PORT`…, and `{{workspace.branch}}` in its look), fetched while it's selected; the
  *This branch* starter is one. `--ws` picks the instance in `laki widget run|render|action|check`.
- **Extensions that answer events, stream and take pushes**: `"on": { "turn.done": "an action" }` runs one as an agent's
  turn ends or asks something, a PR's checks fail or pass, it merges, a workspace is made or archived, a scheduled task
  runs; the action gets the event as JSON and can set the data itself. `"stream": true` keeps its command running, each
  line of JSON shown as it comes. `laki widget push <id> '<json>'` puts data in one from a cron job, a git hook or CI.
- **Extensions give your agents tools**: an action with a `"tool"` (what it does, its input) is one your agents can
  call, through `laki widget tool` or MCP, Laki AI too; Laki shows you the command first (once per workspace, every
  time, or never, as the tool says), and Settings › Extensions lists where you allowed it with *Revoke*. The *A tool for
  agents* starter keeps notes your agents add.
- **The extension studio**: with Laki AI on, *New ▾ › Make with Laki AI* (⌘K *New extension…*) opens a chat beside
  the extension's preview: say what it should show, see it on sample data at once, try it live once (after a look at
  what it runs), undo any change, then turn it on. *Remix* copies any extension, built-in ones too, as yours to change.
- **A tab in its own window**: a tab's right click › *Float in its own window* (or ⌘K): its terminal, live, in a window over
  every app, as big as you like; its ✕ (or *Bring it back* in its pane) puts it back.
- **Headless**: `./Laki.AppImage --headless --tailscale` (or `laki serve`) runs Laki on a server with no screen, used
  in a browser through remote access: [docs/headless.md](https://github.com/igorkasyanchuk/laki/blob/main/docs/headless.md).
  `laki remote` prints the link.
- **Remote access through Tailscale**: Settings › Remote access › *Sign in with* › *Tailscale*: your tailnet's
  devices only, at this Mac's `ts.net` name.
- **Test, Lint, Format and Deploy scripts**: set them beside Run in a project's settings (or `.laki.json`); Run ▾ runs
  each in a tab of its own (Deploy asks first). `laki run <ws> test`.
- **The iOS Simulator and app windows for agents**: `laki screen shot` (the booted simulator, or `laki screen shot
  Safari`: an app's window), and with idb `laki screen tap`, `swipe`, `type`, `describe`; MCP's `laki_device`.
- **Global hotkey**: ⌃⌥⌘L brings Laki forward from any app (Settings › General: off, or record other keys).
- **Worktrees**: copy every ignored file, or the untracked ones, into new worktrees; *Refresh PR status in the
  background* can go off; archived workspaces can delete themselves after a day to a month (Settings › Git & worktrees).
- **Settings › General › Developer**: the command line tool, with links to the CLI reference and the agent skill.

- **Calendar** (experimental: Settings › General › Experimental): a week or a month of scheduled tasks at their times,
  their runs and your reminders. Click a day to add one; Laki AI and agents add them too (`laki remind "tomorrow at
  9am" …`, MCP's `laki_reminder`). A reminder notifies you as it's due.
- **Desk** (experimental): your extensions as tiles on a page of their own, dragged to move and resized by the corner.
  *Build with AI* has Laki AI make one for it in the floating chat: a tile at once, with made-up data, off until you
  turn it on.
- **An extension's own page**: its preview where it sits and its full view, live or with made-up data, its settings,
  and Laki AI's chat beside them to change it until you like it; back goes where you came from (closing an
  extension's view no longer closes Settings). *New extension* in *Yours* makes one with Laki AI there.
- **Every extension previews with made-up data** (`sample` in widget.json) before it ever runs. Team PRs is gone.
- **Calendar**: ‹ *Today* › and Week / Month on the page; a day's click shows its overview on the right. Calendar and
  Desk stay open on Esc.
- **Workflows**: *New workflow* ▾ makes one from scratch or with Laki AI (it opens as it's written); several blocks
  picked (⇧-click, a box on the canvas) move and delete together; Delete or ⌫ deletes, ⌘Z undoes; your own variables,
  a workflow's or global, as `{{vars.NAME}}`; deleting a workflow is in its ⋯ menu.
- **Laki AI's effort** for claude -p and codex exec (Settings › AI).
- **A workspace with no tabs** shows its starts as cards, with tips.
- **Defaults**: *Dim other panes* and *Focus the pane under the mouse* are on; the sidebar's guide line is off;
  *Diff size in the sidebar* moved to Settings › Appearance.
- **Extensions in several places at once**: the sidebar and the Desk, the rail and the top bar… (Settings › Extensions'
  place menu ticks each).
- **Memory compaction**: Laki AI merges each project's learned memories (never yours) into a shorter list every 7 days
  and as they fill up; a project's Memory tab has *Compact now* and a log of what changed. Settings › Global memory sets
  how often.
- **The laki command in any terminal**: Settings › General › Command line installs it (Homebrew's bin, /usr/local/bin or
  ~/.local/bin).
- **Changes**: a file's header stays at the top while you scroll through its diff, as on GitHub; its head stays one
  line in a narrow panel.
- **Board**: a to-do takes screenshots pasted or dropped in; they go to the agent with it.
- **A PR's failing CI has its own mark**: a red ⊗ beside the GitHub mark, which keeps the PR's color (red: closed).
- **Get started** picks a theme from a dropdown. Dialogs have a ✕ and take the keyboard as they open, so Esc closes
  them (About Laki sent Esc to the agent). The AI page stays open on Esc. A group's menu says *Edit…*.
- **Development mode's element picker**: the rail's *Pick* (or the crosshair beside Help) points at anything in Laki's
  window, on any page and over dialogs, and tells what it is (selector, React components, classes, styles, a
  screenshot), to copy into a prompt. ⇧⌘C starts it; Settings › General › Development records another key.
- **Remote access's PIN page** is new: the PIN in six boxes (sent as you type the last), over a moving gradient.
- **Specs**: *Copy for a prompt* on a spec or brainstorm copies a line naming its README.md for any agent's prompt; the
  new-workspace page's *Spec* picker is gone. The list's hint is a line of its own under All / Specs / Brainstorms,
  whole, for each of them.

## 0.17.0 · Oct 16, 2026

- **Laki AI: past chats in a sidebar**: New chat keeps the one it ends; a click on an earlier chat takes it up again
  (its claude or codex session goes on), the trash deletes one.
- **Laki AI: images as thumbnails**: a pasted screenshot shows in the chat, a click shows it big. Settings › AI ›
  *Keep pasted images* (30 days by default).
- **Laki AI in Settings › General › Experimental**: the same switch as Settings › AI; off, its ⌘K entry goes too.
- **Laki AI picks a group's template**: a new workspace in a group with a prompt template starts with it; with none,
  a template that plainly fits the task.
- **Global memory** (Settings › Global memory): your own rules for Claude and Codex in every project, given with each
  project's memory. Settings › a project shows its memory's count and *Manage*. The section head is *Project settings*.
- **Info in the right panel**: the workspace's info is the panel's first tab (⌘I), beside Files, Changes, Review and Preview.
- **Files open as tabs**: the file preview keeps several files open, each with its unsaved edit; drag its left edge to resize it.
- **Artifacts in the app**: an HTML or Markdown artifact opens in a viewer over the app (HTML sandboxed, its own CSS and
  pictures load); Settings › General › Storage can send them to the browser instead.
- **Workflows: a sidebar of blocks and variables**: click a block to add it after the picked one, or drag it onto the
  canvas; Variables copies one on a click, or drag it into a field.
- **Run ▾: what an action sends**: rest on one to see its prompt or command. Terminal actions are now *Shell actions*,
  run in a shell at its prompt (a busy one, vim or a server, is skipped).
- **Shell spinners stop after 5 seconds**: a command that runs on (vim, a server, a REPL) no longer spins forever.
- **Rail: Terminal and Browser switches** (Settings › Appearance › Rail): off, Terminals or Browsers is a project in Projects' list.
- **Extensions: Yours and Built in**, two lists; *Edit with Laki AI* on one of yours; the AI prompt folded away (*Copy the prompt*).
- **Share live view** (was *Share read-only link*), and a new look for its page: chat bubbles, a LIVE badge, *New below*,
  light or dark as the reader's system is.
- **Release notes only in development mode** (Settings › General › Development).
- **Codex and Claude chats come back more often**: a resume drops its chat id only when it fails as it starts, not
  because the chat's own text says "session not found"; development mode logs why an agent ended.

## 0.16.0 · Oct 15, 2026

- **Workflows: a way out per answer**: an AI decision's *Ways out* › *A line per answer of* a question: yes and no, each
  option of a choice or each level of a score goes to its own block (three options, three arrows), plus *error*.
- **Workflows: question kinds as cards**: + *Question* shows Jev's three, *How true* (`noul`), *Choice* and *Score*,
  with what each does and an example.
- **Workflows: block IDs and a variables list**: change a block's *ID* and every arrow and `{{steps.<id>.…}}` follows;
  *{{ }} Variables* lists all a workflow has, the run's and each block's, a click copies one. New blocks use the block
  before's answer (`{{steps.<id>.answer}}`), not a made-up name.
- **Workflows: clearer Notify me**: it says what it sends and when; an End's *What it says* is the notification's words
  (with variables), and *And on my phone* sends it to your phone pushes too.
- **Workflows: JSON mode** on an AI call (its answer one JSON object; on by itself when it names outputs) and on an
  agent block (told to end with one JSON object or list; its answer is that JSON, for a decision's state or a Case's JS).
- **Workflows: a block's right click** on the canvas: *Add a block after it*, *Duplicate*, *Delete*. Deletes are red,
  and the trash in a block's panel outlines that block in red while the pointer is on it.
- **Laki AI on the Workflows page**: ✦ in a workflow (or the chat button) opens its chat with the workflow, your unsaved
  changes too, to change it; *Make it with Laki AI* on the list makes one, after asking you a few questions.
- The workflow canvas lays blocks out by their steps, branches side by side, and its list follows files Laki AI or an
  agent writes.
- A block's limit reads *at most [∞] times, then…* (∞: no limit), no longer “at most ∞ then times”.
- **Reset the interface resets everything it can**: Settings › General › Development › *Reset the interface* puts every
  setting back to its default (the theme, the rail and sidebar, the terminal, notifications, the experimental features),
  turns every extension off and shows Get started again, as well as the window's layout. What you set up stays:
  projects, workspaces, sessions, profiles and accounts, Laki AI, phone pushes, remote access, env, actions, templates.
- Extensions start off, yours too: turn one on in Settings › Extensions.
- **Laki AI's glow** (experimental, Settings › General › *Experimental*, off by default): as Laki AI reads a tab's
  screen or uses the agent browser, a rainbow edge turns once around that tab with a soft light inside, then fades (the
  whole window when the tab isn't shown).
- Settings › Appearance › *Your picture on your PRs* (under *Pull requests in the sidebar*, on by default): off, your own
  PRs show GitHub's mark alone.

## 0.15.0 · Oct 14, 2026

- Your own PRs show your GitHub picture in the sidebar, the hover card and the info panel, as others' show theirs.
- A new workspace (yours, an agent's, a scheduled one) no longer takes the place of the one you're looking at, even
  after the one you had picked was archived.
- The status bar PR's right click: *Copy PR link* and *Copy #n*.
- ⌘K and the sidebar's filter find a workspace by its PR's number.
- **Artifacts in folders**: the Artifacts strip shows the storage folder's folders first; click one to go in, its path
  to go back. Agents are told to group related files in subfolders.
- A `.url` artifact with a `file:///` link (a page an agent made elsewhere on this Mac) opens that page in the browser.
- The status bar leaves out what an agent listens on itself (its browser bridge, an MCP server) and browsers it tests
  in; dev servers it starts still show.
- Agents are told to attach a PR they open on another branch (`laki pr . <url>`) so it shows on the workspace.
- **Remote access with a PIN**: Settings › Remote access › *Sign in with* › *PIN (Laki)*: no Cloudflare email; the
  page asks for a PIN Laki shows next to the QR code, a new one each start. A wrong PIN twice (or as many as you pick)
  stops remote access. Cloudflare's email stays the default.
  ⌘K's *Start remote access* uses the way you picked.
- **Specs & Brainstorms in one list**: newest first, each row says its kind; *All* / *Specs* / *Brainstorms* filter it,
  and one *New* ▾ starts either kind, empty or from a template (*Edit templates…* at its foot).
- **Extensions as buttons, on the rail and in the sidebar's foot**: two more places (*Rail*, *Sidebar foot*), and
  `widget.json`'s `icon`, `label`, `badge`, `tip` and `click`: a button whose label and count its fetch keeps up to date
  in the background, and a click that runs one of its actions (or opens its full view). One without a preview is a
  button wherever it sits. The Extension creator skill knows it all.
- A brainstorm's or spec's chat with Laki AI has its brief in every ask, as it is then (your edits too), and its files
  by name; it reads one (ideas.md, a prototype) when it needs to, on any backend.
- Idle agents now sleep after 8 hours by default (Settings › Resources; *Never* is still there). Asleep, an agent
  frees its memory and resumes its chat as you look at it.
- **Settings › Terminal, redone**: the preview on top (with *Reset to defaults*), then Text, Cursor, Panes and tabs, and
  Keyboard, mouse and clipboard, each setting with what it does; the cursor and padding as buttons.
- **Make an extension with Laki AI**: Settings › Extensions › *Make one with AI* › type what you want › *Make it with
  Laki AI*: its chat opens, asks you at least two questions about it, then writes it (saved off until you turn it on).
  Laki AI asks first for any new extension.
- **Workflows: AI call and Webhook blocks, and outputs**: an *AI call* sends one prompt to a model on OpenRouter (Laki
  AI's key); a *Webhook* sends a request to another system (method, headers with `{{env.NAME}}` secrets that never
  reach the log, a body from your text, a file, or the run's variables). Any agent, AI call, command or webhook can name
  its outputs (`out: title, files`), each a `{{steps.<block>.<name>}}` for the blocks after it.
- A workflow run started after you turned Workflows on no longer starts its step over 8 seconds in.
- **Share a tab**: a tab's right click › *Share read-only link* copies a link to a page anyone can read: an agent's
  chat (Claude Code, Codex: prompts, answers, tool calls) or the terminal's text, kept up to date as you go on, with
  *Copy as Markdown* and *Download .md*. A globe marks a shared tab; its right click copies, opens or stops it. Needs
  cloudflared, like Expose to the world. *Share read-only link…* asks for how long (1, 8 or 24 hours, or until you stop
  it) and shows a QR code with the link; past its hours the link is dead. The page's *Tool calls* switch hides them.
- **Workflows: AI decision block**: asks a decision model on OpenRouter (Jev, GPT-6 Luna Decisions,
  Microsoft-Decision-1, Perplexity Decider, Cloudflare Clef, or any model id) yes/no, choice or score questions about a
  JSON state built from the run's variables. Each answer is a variable (`{{steps.triage.urgent}}`, its `.p`); when the
  model isn't sure enough (*Sure from*, 70% by default) the run asks you. Questions as cards or as the API's JSON.
- **Workflows: Show you block**: a window over Laki with what the run made (HTML or Markdown, scrollable; links open in
  your browser), and a notification if you like. The run keeps what it showed: reopen it from the run.
- **Workflows: Case branches on numbers and JS**: `>=`, `<=`, `>`, `<` (a decision's `.p` ≥ 0.8), or a JS expression
  over the run's variables.
- **Workflows: a Test button** on AI call, AI decision and Webhook blocks: one call with sample values, its outputs and
  log, without a run.
- Workflows: an AI call takes a system prompt and a temperature, and answers in JSON when it names outputs; a webhook
  tries again on 429 and 5xx (twice, after its Retry-After).
- **Scheduled workflows**: a scheduled task can start a workflow (its prompt is the run's task); one still running
  skips the next time.
- Workflows' notifications and asks reach the app again (they were dropped on the way).
- Help (⌘/) has a *Specs & Brainstorms* section, and says what's new above; so do the README and the guide.

## 0.14.0 · Oct 14, 2026

- **Voice in the cloud, hold Fn to talk** (experimental: Settings › General › *Experimental*): Settings › Voice picks
  how the mic turns speech into text: macOS dictation
  as before, or *Cloud*, a speech-to-text model on OpenRouter with Laki AI's key (MAI-Transcribe 2 by default: 60
  languages, mixed in one sentence too; Whisper, Parakeet, GPT-4o Transcribe and more in its list, or any id). In
  the cloud, hold Fn anywhere in Laki, talk, let go: the text is typed where your cursor is, a prompt or a terminal.
  A model that's busy is tried again twice before Laki says so.
- Opening your first project from the welcome screen no longer leaves the window black.
- **Agents & profiles**: Settings' agent presets are profiles now, grouped by agent, each with its model, effort and
  account besides its flags and env; the new-workspace page's agent menu says them.
- **Accounts**: more than one Claude Code or Codex sign-in (*Add account* signs it in, in a terminal). Settings, skills,
  plugins and chats are shared, so a tab's right click › *Restart on another account* resumes its chat there. New
  sessions start on the default (the circle, ⌘K's *Switch …*, the plan limits' *Use*); the ring's popup shows every
  account's limits and marks the one with the most room.
- **Splits kept by Laki**: how a workspace's tabs are split lives in the daemon, so every window, the phone, the CLI
  and Laki AI see the same thing, and Laki AI can arrange them (*put codex beside claude*, *open a shell under it*).
  Settings › Terminal › *New tabs open as a split* puts a new tab beside the pane you're on.
- **Agent variables**: `{{branch}}`, `{{path}}`, `{{port}}`, `{{pr}}`, `{{tab}}`, `{{workspace}}`, `{{date}}` and more
  become the workspace's and the tab's in actions, templates, scheduled prompts and workflows (the chips under an
  action or a template in Settings list them).
- Settings › General › Development › *Reset the interface*: the window's layout back to how Laki starts (widths, open
  panels, folded projects, text sizes); projects, workspaces, sessions and settings stay.
- The right panel and the info panel drag as wide as you like (they stopped at 760px); the terminals keep 280px.
- Workflows: a space (or a new line in a prompt) typed in a name, a description or a block's field stays; it used to
  vanish as you typed it.
- **Text size per tab**: ⌘+ / ⌘− make the text bigger or smaller in the tab with the keyboard only, and it keeps
  its size; ⌘0 puts it back to Settings' size, which is every other tab's. Settings and Help keep their own ⌘± size.
- **Laki AI everywhere**: a chat button at the bottom right of every page but AI, Settings, Help, Specs and Workflows
  opens a small chat that knows where you are (the page, the workspace, the tab, its status and its last 40 lines);
  Settings › AI › *Chat button* turns it off. Laki AI now knows the built-in tools too and can start a timer, a
  stopwatch, a reminder or a Send later for you.
- **Laki AI runs commands where you are**: *fix this and run it here* in the chat button's chat types the command into
  the tab you're on and runs it (a shell), or sends it (an agent), then reads what happened; name another tab, or ask for
  a new shell, to run it there. It asks first before anything that deletes, resets or force-pushes.
- **Laki AI's chat, redone**: the small chat and its window get a lighter head that names how it runs, a glow and
  a circling mark while it works, a spinner on its tools until it answers, workspaces as chips you click, your messages
  in the theme's color and a thin scrollbar.
- **Progress in the sidebar**: Settings › General's *Show progress*: on the tab, in the sidebar, or both; the sidebar's
  as a percentage, a line under the row, or both.
- **Pin specs and brainstorms** to the rail (the pin in a spec's header, or a right click in the list): five pins in
  all, workspaces and specs together. Pinned workspaces on the rail take their color.
- **Changes in two columns**: the side panel's Changes shows a file side by side, old and new, like GitHub; the
  button beside Expand all switches, and Laki remembers it.
- **Artifacts**: a bigger view, and a right click on one to copy the file itself (a picture as a picture), its text or
  its path, open it or show it in Finder.
- **Bird view** lays its cards out in columns of their own heights, each workspace tinted with its color.
- A new workspace made while you're elsewhere no longer takes you there: a toast says it's ready, with *Open*.
- **Scheduled tasks** is a page of its own: Esc no longer closes it.
- **Resources** shows CPU next to memory, a graph of the last minutes, and sorts by memory or CPU.
- Lighter in the background: the window repaints only when something changed, its animations pause while Laki
  isn't in front, and the floating bubbles' glows and spins run on the GPU.
- Codex: a turn with sub-agents keeps its spinner until the chat itself is done.
- Polish: the Board's columns run the page's height (an empty one is still a place to drop a to-do), the status bar
  and Board draw their checks, conflicts and branch marks as icons, menus in Settings get the theme's chevron, the
  new-workspace prompt grows as you type, selected text takes the accent, and Get started lights only the next step.
- Polish on every page: one filled button per view (a skill's Install, the brainstorm chat's start), Bird view's cards
  with the sidebar's marks, Bird view and Specs tagged *experimental*, Laki AI's Calls with drawn marks and an empty
  state, Scheduled tasks without an empty Tasks head over the form and with switched-off tasks dimmed but readable,
  Settings' *Phone pushes*, and close buttons drawn as icons.

## 0.13.0 · Oct 13, 2026

- **Project memory for agents**: Claude and Codex get a project's memory at every start there. It has two lists of 50:
  *yours*, and *learned by agents* (auto-memory), which agents add to as they find things worth keeping (`laki memory
  add`); the oldest learned one goes past 50, and a pin keeps one as yours.
- **Workflows** (experimental: Settings › General): graphs of blocks Laki runs for a task (agents, commands,
  choices, questions for you, a PR, CI checks), drawn on a canvas or written as Markdown. Each run gets its own
  worktree, asks before it opens a PR, approves or merges, keeps its decisions, variables and log, and goes on at its
  block after a restart. None come with it: yours, or a project's in its repo; `laki flow` and MCP's `laki_workflow_*` too.
  Its page lists them and their runs like Scheduled tasks and stays open on Esc; an agent block can use one of Run ▾'s
  agent actions; *Save* keeps text, a file or a link in the workspace's Artifacts; a run's *Log* shows everything it
  sent, got and ran; a run can be deleted; a workflow has 100 blocks at most; Laki AI and the agent skill know how to
  write and change workflows.
- The rail's **AI** sits at its bottom, over Settings.
- **Bird view** (experimental: Settings › General): the eye beside Help shows every live session at once, a card each
  under its workspace with its screen as it is now; *All*, *Working* or *Needs you*; a click opens it.
- With the rail, the sidebar keeps a **width per kind** (Projects, Terminals, Browsers); a pinned rail item isn't lit
  as the open one.
- Workflows: a **Case** block (if / elsif / else: branches in order, each on a variable, else last) beside *If / else*;
  a running run shows its working block's turning gear and the arrow it took flowing; a run and its sessions link both
  ways (the status bar shows the run, the run opens an agent block's tab).
- Each action (Settings › Actions, and a project's) has a **slug**, unique and kept through a rename: a workflow's
  agent block uses the action by it. A workflow now finds a project's own actions (it saw only the global ones).
- *Restart Laki's daemon* shows after any app update whose daemon is from an older build, not only a lower API.
- A link clicked in Codex (or another app that takes the mouse) opens one browser tab, not two; ⌘-click opens it
  in Laki, a plain click is the app's.
- **Pin to the rail**: a workspace's menu puts it (a terminal or a browser too) on the rail below a line, a click away;
  5 at most, with a count when one needs you.
- A workspace's right click has **Run ›**, the toolbar's Run ▾ for it (its script, localhost, your actions), and
  **Move to group ›** is a submenu.
- **Settings › Git & worktrees**: *Sync the base branch* (off by default) fetches it from origin before a new worktree
  starts off it; the branch prefix, the worktrees folder, diff size and archive on merge moved there.
- The new-workspace page starts off the repo's **main branch**, not whatever the repo has checked out; its ⌄ lists every
  branch (the box filtered them by what was in it). Opened for another project than your draft's, it starts empty there.
- A group's head has a **+** on hover, as a project's has: a new workspace in that group. A group without a template
  starts it with none, not the last one used elsewhere.
- A workspace whose prompt names a PR (*review https://github.com/…/pull/12*) shows the PR's status and author at
  once, and keeps it when its agent checks the PR out to review it (the link was lost then).
- **A workspace's PR and related links**: once its own branch is pushed with a PR, that's its PR, and one its prompt
  named moves to *related* in the info panel. A session an agent starts (`/laki:new`) keeps the PRs its prompt names as
  related, so the PR it opens is its own (`laki new --link` for one it's about). The info panel also says which
  workspace started it and which ones it started; *Not this workspace's PR* in the PR's ⋯ moves a wrong one off.
- The status bar's branch is short (no `laki/`, cut): hover for all of it and its base, click to show it whole.
- Specs: ↑ from the start of a check list item goes to the item above (it skipped it, to the heading over the list).
- **Laki AI** puts a new workspace in the project's group that fits it (a review in *Reviews*); the bubbles' AI window
  is the chat alone, with a cleaner head.

## 0.12.0 · Oct 12, 2026

- **Specs & Brainstorms** (experimental, Settings › General): write a project's requirements like a Notion page
  (checklists, images, diagrams: flowcharts, architecture, ER, screen flows, wireframes), then *Start* a workspace
  from one; or write an idea and *Brainstorm with Laki AI*, which writes options, a mind map, diagrams and clickable
  prototypes beside it. Each is a folder outside the repo with a README.md any agent can read; the rail's *Specs*, a
  project's *Specs* tab, the new-workspace page's *Spec* picker and MCP's `laki_plan_*` tools. The page goes from both
  lists to one kind's to the spec alone, with breadcrumbs back, and full screen (⌘⇧⏎) for writing.
- A brainstorm has its **own chat with Laki AI**, in a panel beside it; unused for 12 hours it ends, and what you type
  next starts a new one (*Continue it* takes it up again).
- **Templates** for specs and brainstorms (New ▾, *Templates*): two come with Laki, *Feature* and *Idea*; a new one
  starts empty unless you pick one.

## 0.11.0 · Oct 11, 2026

- **Linux and Windows through WSL (preview)**: `npm run pack:linux` builds an AppImage in Docker and runs the tests and
  a smoke test against it; the window has the system's title bar, and closing it quits (the daemon and its agents keep
  running). The guide says what to install.
- **The menu bar has Laki's commands**: Laki › Settings… (⌘,), File (new workspace, new tab, open a project,
  go to a file, close tab), Edit › Find…, View (sidebar, info, changes, palette, font size) and Go (the next that
  needs you, previous and next workspace, Board, Scheduled tasks).
- Laki follows macOS's *Increase contrast* (stronger hints and lines), *Reduce transparency* (no glass: the window
  stays solid) and *Reduce motion* (no animations).
- The keyboard's focus is a ring in the theme's accent, and the status bar's and tabs' small buttons are easier to
  hit.
- **Open in** is a submenu in a workspace's and a project's ⋯ menu: hover it, or → / ⏎.
- **Three more colors** for workspaces, groups and tabs: lime, brown and gray.
- **PR marks in the sidebar**: ✓ an open PR approved, ✓✓ approved by you too, 👀 you commented; each can be turned off,
  and they go by the status circle, after the name or with GitHub's mark (Settings › Appearance › Pull request marks).
- A workspace's ⋯ closes its hover card.
- Settings › Appearance holds what the window shows (plan limits, PR marks, the menu bar item, the fun button, turn
  timers, diff size), out of General.
- A project's ⋯ › *Settings* opens its page at the Settings tab.
- The agent skills know an extension and a widget are one thing, and an installed skill is brought up to date as Laki
  starts.
- **Laki AI makes extensions**: ask for one (*a clock with the time in New York*) and it writes it in Laki's extensions
  folder, saved off; turn it on in Settings › Extensions after a look (*by Laki AI* on its row).
- **Extensions in the top bar or the status bar**: each one's *Sidebar / Top bar / Status bar* in Settings › Extensions;
  in a bar it's a line high.
- **Network access for an extension**: a switch per JS extension (off by default) lets its page fetch from https sites.
- **Delete an extension** (or plugin: search finds it by either word) from Settings › Extensions: its folder and
  settings, for good, after a confirm.
- **The extensions SDK** in one page: `docs/extensions.md`.
- **Laki's skill for Laki AI** (Settings › AI, on by default): your open PRs and others' in your repos, projects' notes
  and memory, renaming and pinning, shells, your actions and prompt templates (*the review action on each PR in this
  screenshot*), to-dos and scheduled tasks. It asks you with options as buttons when unsure, and removes a memory item,
  task, tab or to-do only when you press Yes.
- **Show costs ($)** (Settings › AI): off hides the money on the AI page.
- **Your instructions** (Settings › AI): your own context for Laki AI, added to its instructions at every ask.
- **Artifacts**: the status bar's *Artifacts* opens the previews at once; their ⋯ has *Show in Finder* and *Open in
  Files* (the side panel's Files has an *Artifacts* tab now).
- **New workspace**: *worktree* is a switch; the template, agent and model pickers are words with a ⌄, not buttons; the
  prompt's top corners no longer poke out of its card (on the AI page too).
- **PR marks** go with GitHub's mark by default.

## 0.10.0 · Oct 10, 2026

- **Send later, to Laki AI too**: ⌘L, the toolbar's clock, a tab's right click or ⌘K pick an agent or Laki AI, a
  message (or one of Run ▾'s actions: *Review the code*) and a time; the AI page's clock asks it later. A timer bar
  in the sidebar until then: *Send now*, *Edit…*, *Cancel it*.
- **Extensions**: widgets are called extensions now; Settings › Extensions lists them a row each with its switch, and a
  click sets one up in a dialog.
- **⌘⇧A** shows or hides the workspace's artifacts over the status bar.
- **A page for each project**: a click on its name (the arrow still folds it) opens its Notes, Scheduled tasks, Memory
  (things to keep about it: add, edit, delete) and Settings.
- **Full screen for a tab**: ⌘⇧⏎ or the tab bar's ⤢ leaves only the tab's content, the window full screen; ⌘⇧⏎ again or the ⤡ in the corner brings the rest back.
- **Laki AI** (optional, Settings › AI): ask in plain words, or paste a screenshot of PR links, and it works Laki for
  you: starts workspaces (PR reviews in their own worktrees), opens agent tabs, sends prompts, attaches PRs, schedules
  tasks and tells you what your agents are doing. It runs on OpenRouter with your API key, or on `claude -p` /
  `codex exec`, and never archives, deletes, ships or merges.
- **AI page**: a chat like Claude's (⏎ asks, the tools it ran folded into a line), the workspaces and tabs it names as
  links that open them, a Calls tab with every ask's tokens, cost and time, and an Info tab with how it runs and is paid
  for and what it spent today and this month. Also `laki ai` in a terminal.
- **Laki AI on your agent presets**: a claude or codex preset (its env: another account) as the AI's backend.
- **Ask Laki AI from the bubbles**: the floating bubbles' + (with Laki AI on) opens the AI chat in a small window over
  any app.
- **Release notes** in Settings: this page.
- **Themes, easier to read**: every theme checked for contrast; links and picked items in a light theme's accent read
  on the page, status marks, the terminal's colors and dim text show in all 86, and a few looks have new fonts (Geist,
  IBM Plex Sans, Roboto, Manrope, Source Sans 3, Fira Sans).
- **More interface fonts**: Geist, IBM Plex Sans, Roboto, Source Sans 3, Fira Sans and Manrope, and the developer
  fonts Geist Mono, IBM Plex Mono, Fira Code, Cascadia Code, Source Code Pro and Roboto Mono (Settings › Appearance).
- **Resources counts everything Laki runs**: Laki AI's agent, tunnels, remote access, SSH connections and widgets'
  fetches each get a row (Stop ends the AI's answer, a tunnel or remote access).
- **Find a theme by game or film**: *winamp*, *halo*, *fallout*, *star wars*… in Settings › Appearance's theme finder.
- **12 new themes after games and films**: Llama Amp (a 1998 music player), Spartan (a power-armour HUD), Vault
  Dweller (a wrist computer's green screen), Overworld (a block world), Rip & Tear (hell's red), Warp Pipe (a plumber's
  sky), Power Pellet (a maze arcade), Hyperspace (a space opera), Spice (a desert planet), Outatime (a time machine),
  Grand Hotel (a pink mountain hotel) and Replicant (orange smog), each with its own look.
- **The rail only**: *One sidebar* is gone from Settings › Appearance; the rail's *Labels* switch stays (a phone still has
  its one drawer).
- **Tabs named by their task**: another agent tab in a workspace is named by its prompt's first words (`claude: fix
  the cart total`), or by the first prompt you type in it; a name you give it stays.
- `laki_send` (MCP's and the AI's) reaches agents only, never a shell or a question an agent asks you; new MCP tools
  `laki_new_tab` and `laki_attach_pr`.
- **PR review**: Viewed boxes in Changes (synced with GitHub), who approved or asked for changes.
- **Artifacts**: links your agents publish are kept with the workspace, first in the gallery and in the info panel.
- **Shells come back** after a restart with what ran in them; an ended agent keeps its tab.
- **New workspace window**: the bubbles' + menu (New task, Say it, screenshots) opens the page over any app.
- Glass that shows the desktop, terminal padding, a wider screenshot editor, a filterable picker look.

## 0.9.0 · Oct 9, 2026

- **Rail layout** by default: Projects, Board, Schedule, Terminals and Browsers on a narrow rail, like Slack.
- **A composer for new workspaces**: the prompt first, agent, model and effort as pickers, the rest as chips.
- A compact **Scheduled tasks** page.
- ⌘W / ⌘T in browser pages; groups from a workspace's menu (*Move to group*).
- A hard-to-miss **Restart Laki's daemon** bar when the daemon is older than the app.

## 0.8.0 · Oct 8, 2026

- **Get started**: the first steps, ticked as you do them.
- **Terminals and Browsers** in the sidebar: plain shells and web pages as workspaces, browser tabs of their own.
- A spinner while a shell runs a command; drag projects to reorder them.
- Bubble cards that work; six Dock icons.
- Remote access without an email (anyone with the link, after a typed confirm).
- Shift+Enter makes a new line in every tab; Claude started in a terminal tab is tracked too.

## 0.7.0 · Oct 8, 2026

- A release build of 0.6.0's work.

## 0.6.0 · Oct 8, 2026

- **Floating bubbles**: recent sessions, + Session and a voice prompt, three new styles.
- A workspace's **hover card**: state, last answer, PR, checks.
- PRs an agent names are linked to its workspace.
- Timer messages, nicer PR buttons, a resizable info panel, drafts that survive closing, ⌘-click file links.

## 0.5.0 · Oct 8, 2026

- **Merge from the app**, and **merge when green**; PR permissions per project.
- **Answers from notifications and the phone**: Allow / Deny, a menu's choices.
- **Send later**; a worktrees folder of your choice; Stop in Resources; corners for every theme.
- Mac editing keys in the terminal; floating bubbles; group templates.

## 0.4.0 · Oct 7, 2026

- **CSV editor** and **Mermaid** diagrams in the preview.
- **Agent progress**: how far along an agent is, on its tab.
- Sidebar styles, a screenshot editor, widget toasts and dialogs, working hours, development logs.

## 0.3.0 · Oct 7, 2026

- **Resources**: memory and CPU by tab, and idle agents put to sleep.
- The Team PRs widget's review command.

## 0.2.0 · Oct 7, 2026

- **Widgets** in the sidebar; **groups** of workspaces; VS Code-style pane drag; a Review tab; Help's contents; dmg builds.
- Actions (duplicate, filter, any agent); PRs named and linked from prompts; Approve / Close PR.
- The new-workspace page; sidebar video, timers, separators, file editing, more looks and fonts.
- **Projects over SSH**; pinned workspaces; phone pushes; archive when a PR merges; start a workspace from a PR;
  `.env` and other ignored files copied into new worktrees; image diffs; the menu bar item; a meme button.

## 0.1.0 · Oct 5, 2026

- **The first Laki**: coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in its own
  git worktree, with tabs, splits, a status bar, a side panel (files, changes, review) and a preview.
- PR auto-fix (CI, reviews, conflicts), races and Compare, the Board, scheduled tasks, remote access from a phone,
  plan limits, an MCP server, `laki://` links, themes, the agent skill and the `laki` CLI.
