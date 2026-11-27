# What Laki does

Every feature, a line or a few each. [The guide](guide.md) says how each one works; [the README](../README.md) is the
short version.

- **Workspaces**: a worktree, branch and `$PORT` per task, with setup and teardown scripts (a repo's `.laki.json` once you trust it) and your `.env` copied in;
  worktrees in a folder you pick, for all projects or one. Start one from a prompt, a GitHub issue or a PR (a fork's: from origin's or upstream's), with the
  agent's model, effort, permission mode (auto, accept edits, plan, bypass), fast mode and sandbox picked under the prompt (a model the installed Claude Code is too old for leaves the menus, with a warning on one you typed). Plain folders work too; worktrees made outside Laki come in from a project's ⋯ › *Import worktrees…*. On a Mac, worktrees stay out of Time Machine and Spotlight.
- **Status**: running, needs you, done (and how far along, by the agent's own estimate), on every tab and row; notifications with a button per choice an agent asks you to make (for Claude's permission asks, the command or file it wants to touch, and *Allow always* with the rule it grants named whole: a broad one, a wildcard, a folder or a whole tool, amber and in words, never picked by Allow all; an edit's or write's change in red and green on Reader's, Needs you's and the notch's cards; a command's ? (or E) has Laki AI say in a sentence what it will do, whether it can't be undone or reaches outside the workspace, only on your click; a workspace, timer or reminder marked important comes as a card at the bottom right over every app instead, until you answer or close it), A turn running longer than you set (off by default) tells you once, with *Stop*.
  a Dock and menu bar count (a click on the menu bar icon can open an Inbox: what waits on you with its choices, what's at work, New task…), floating bubbles over other apps (agents working or waiting, recent ones too; click one to jump there, say a prompt to one, or right-click to reply to it), or an island in the notch that opens into a card when an agent asks or finishes, pushes to your phone (ntfy, Slack, Telegram; answer from them with Telegram's or ntfy's buttons; in Telegram, /menu's buttons open any workspace, its 💬 Talk here takes typed or spoken tasks, 🤖 Laki AI answers there too, and agents' Markdown reads as bold, code and links), a follow-up queue and
  messages sent later (in 2h, at 3pm; to Laki AI too; shown under the tab they go to, to send now, edit or cancel). *Needs you* at the top of the sidebar answers a waiting agent
  from its card (a finished turn is one line, a click opens its card), the newest finishes first (older ones fold under *Earlier*); what's queued for an agent shows under its terminal, to edit, reorder or send now. Agents resume after
  a restart or a usage limit, and a new workspace's agent can start later: at a time, or once your plan limit resets. A project with many
  workspaces folds after its first 10 (any working, waiting on you or open stays), *Show N more* for the rest. *Recent*
  (a button at the sidebar's head) lists every workspace across projects by when it last worked: Running, Today,
  Yesterday, Last 7 days, Last 30 days, Older. *Show › Workers* off keeps an orchestrator's workers out of the sidebar,
  counted on their lead's row.
- **Looping**: a Claude Code agent failing the same command with the same error (3 times in a row, or 5 in a turn)
  shows *looping ×n* on its row, in Needs you and on the Board, with *Nudge*, *Stop* and *Let it work*, and a phone push
  (Settings › Notifications › *An agent loops*).
- **Projects**: a page each (a click on its name): notes, scheduled tasks, memory (yours and what agents learned, 50 each, given to Claude and Codex at every start) and its
  settings. Each has a badge in the sidebar, ⌘K, the rail and pickers: its repo's logo or favicon, else two letters of its own on its color (a click changes the letters, icon, picture or color; Settings › Layout › *Project badges* turns them off). *New project…* (Welcome, ⌘K) makes a folder with git and a first commit and adds it.
- **Specs & Brainstorms**: write what to build like a Notion page (checklists, images, diagrams), from
  your own templates, then start a workspace from it; or brainstorm an idea with Laki AI in a chat beside it, which writes
  options, a mind map, diagrams and clickable prototypes. Both in one list, filtered by kind, and *New* ▾ for either.
  Folders outside the repo that any agent can read.
- **Workflows**: blocks Laki runs for a task, drawn on a canvas or written as Markdown (say, a plan you
  approve, the build, tests until they pass, a PR, CI until green). Blocks can call a model on OpenRouter or a webhook,
  ask a decision model yes/no, choice or score questions (a way out per answer, or asking you when it isn't sure),
show you what a run made (a window, a popover in the corner, a macOS notification), and name outputs (`{{steps.sum.title}}`) the next blocks use; your own
variables (`{{vars.REPO}}`), a workflow's or global. A schedule can start one, and Laki AI makes or changes one with
you. Each run keeps its decisions and log: run it again, or again from any block; pause it after the block it's on
and resume later; a run in a workspace you have, its
worktree archived when it's done, each agent block's permission mode, a deleted one in the trash for 30 days,
`laki flow check` for a repo's CI, and each workflow's runs at a glance (one failing by itself 5 times pauses;
`laki flow on` turns it on again). Seven templates to start from (fix CI, review a PR, feature to PR, an issue labelled…); events from outside too: a GitHub issue labelled, or a webhook (Settings › Tunnels › *Webhooks*, signatures checked), and a try as if
on an event, the last one or a sample (`laki flow run --event`), questions answered from the phone, and a budget of
time and AI money per run (`budget: 60 min, $5`).
- **Agents & profiles, accounts**: each agent's profiles (model, effort, account, flags, env, a system prompt of its own), and more than one Claude
  Code or Codex sign-in: a default for new sessions, each account's plan limits (`laki limits` for agents too), a tab restarted on another account
  with its chat, and *Auto fallback*: accounts in an order, a tab at its plan limit going on on the next one by itself. A `/goal` (Claude Code, Codex): a band with its state and *Pause*, *Resume*, *Clear*, the tab running until the goal stops and one *Goal reached* then. An MCP server that needs a sign-in: a band with *Sign in* too (Codex's `codex mcp login`, Claude Code's `/mcp`). Signed out mid-turn: a band with *Sign in* (the agent's own login, for that tab's account), and the message goes once you're in, wherever you signed in. Cursor as a ready-made profile (`cursor-agent acp`): its models and effort in the new-workspace menus, its chats resumed after a restart. *Versions*: each agent CLI's version and the newest, *Update* (or several at once) in a terminal tab you can watch, a dot on Settings when one is out. *What agents call*: their calls to Laki over the last 7 days, per method, the failing ones first, with the tools none called. On a Mac, a wrapper sandbox (`sandbox-exec`) for an agent with none of its own on: it writes only in its worktree and can't read your keys. Actions, templates and scheduled prompts take `{{branch}}`, `{{path}}`, `{{pr}}` and more.
- **Antigravity** (Google's `agy`, Gemini CLI's successor) as the gemini agent: its model, effort and permission modes (`--mode`), its status from what it tells the terminal (OSC 7501), its chat resumed by the id it prints as it exits.
- **Notes and memory in the repo**: a project's switch keeps its notes and memory in `.laki/notes.md` and `.laki/memory.md`, shared through git; a worktree's agent reads its own branch's.
- **Uninstall Laki**: Settings › General › Developer or `laki uninstall` removes the `laki` command, the agent skills and the daemon in one go (the worktrees and your data only when ticked), each a row; then the app to the Trash.
- **Skills loaded**: a click on the status bar's context meter lists the skills a Claude Code or Codex chat loaded, in order; one opens its SKILL.md.
- **Reader view**: a Claude Code or Codex tab as its chat (your messages, its answers, its steps folded), with a box to
  write in (`@` names another workspace or project for the agent; a long message of yours folds to 10 lines, *Show more*); a switch per tab, phones open in it. Under a turn that changed files, a card: what it changed, *Review*
  (only that turn's diff) and *Undo*. Optionally a guess at your next message, greyed out in the box (Tab takes it).
  Tool calls: show all, hide the ones that worked, or the final answer only; `/clear` keeps the earlier chat above a
  *New session* line; a prompt stopped before an answer: *Edit and resend*; Claude Code waiting out a rate limit says so;
  ←/→ between the questions of one ask; ⏎ or ⌘⏎ sends (Settings › Keys). Any ⌘K command can get its own key there.
  *Continue in Codex* (or Claude Code) hands the chat and its changes to the other agent; *Compacting…* shows while
  Claude Code compacts. An agent asks for a token with `laki secret` (a whole sign-in, email and password, on one card with `--field`): you type it on a masked card (kept for the project or all projects if you
  like, one click next time), it gets a file's path; a token or key you paste into a prompt box is flagged, masked, and *Pass as a secret* puts it in such a file instead. Asked to, it puts an important question on your screen with `laki alert … --choice …`: a card over every app, your pick goes back to it. `laki notice … --to <session>` is the same card inside Laki's window, on any page, its *Open* going to that session.
  *Side chat*: a quick question about what it's doing, answered beside it (a copy of its chat) while it works.
  *Subagents · n* and *Background · n* over its box list what a Claude Code chat still runs (*Show output*, *Stop*),
  and the status bar's *n running* lists the workspace's, finished ones too;
  an MCP tool's app (MCP Apps) shows under its call, and a `laki-ui` block in an answer is drawn with Laki's own
  controls (a table, stats, choices you click to answer). A file path in an answer (in backticks, a link, or bare: `src/app.ts:42`) that is in the workspace opens there at its line (⌘-click: your editor); a whole HTML page in a code block has *Preview*, drawn right there with no scripts and nothing loaded.
- **Claude's own numbers**: Claude Code tabs pass Laki their status line, so the context meter knows the chat's real
  window and the plan limits come from Claude itself; your own status line still shows. Codex's plan limits come from
  Codex's own app server; each window shows its newest reading across an account's tabs. Costs count a chat's
  subagents and spawned threads, 1-hour cache writes, long prompts and fast mode, and a copied answer once; a model with
  no price says so. OpenCode tabs count too, at OpenCode's own price. Numbers older than 20 minutes
  are dimmed and say how old, with *Ask api.anthropic.com* beside them for the current ones.
- **Usage**: tokens and ≈ cost a day by agent and model (7, 30 or 90 days) from Laki's Claude Code and Codex tabs,
  beside each plan's limits and Laki AI's OpenRouter credits and spend (*running low* when low). *Where it went*: a workspace's tokens by file read, command output and the carried chat, with hints (`laki spend`).
- **Prompt templates**: yours, a project's, and a repo's own in `.laki/prompts/` (Markdown files, reviewed in PRs, trusted
  with its `.laki.json`, tagged *repo*); `/` in a prompt box lists them.
- **Improve my prompt**: ✨ in a prompt box has Laki AI rewrite your draft with what the chat knows; it stays in the box
  for you to read, and Restore or ⌘Z brings yours back.
- **Prompt history**: ↑ in an empty prompt box (or ⌥↑) searches every prompt you've sent; a pick fills the box.
- **Long pastes as files**: a big log or stack trace pasted into a prompt box becomes a chip (*pasted-text.txt · 312
  lines*) the agent gets as a file; a click reads or edits it, ⇧⌘V pastes it as text.
- **Notifications** (Settings › Notifications, after General): Quiet, macOS notifications and their sound, then a table
  of what tells you where: a row per event (an agent waits, a turn finished, CI failing, a plan limit, a long turn, a
  workspace's cost past your amounts, a timer), a column per place (macOS, a card on screen, the phone, the sound), the edge glow and the Dock's bounce. Phone pushes wait while you're at the Mac (unlocked, used in the last 2 minutes): a finished turn shows here only, an ask reaches the phone if nobody answers it here in 90 s (Settings › Phone pushes).
- **Quiet**: no notifications, sounds, cards or phone pushes for 30 minutes, an hour or until 9:00 (the menu bar's
  menu, ⌘K, `laki quiet 1h`, Settings › Notifications); asks still show in Needs you and `laki alert` still comes. As it
  ends, one notification and card sum up what waits, finished and failed.
- **Recording mode**: mark workspaces or projects *Private*; Recording mode (⌘K, the menu bar) hides them everywhere,
  notifications and phone pushes too, while they keep running.
- **Import chats**: Claude Code and Codex chats you ran in a project from a plain terminal open as tabs that resume them.
- **One next step**: first in a workspace's ⋯ menus (⌘G does it) and, if you like, a chip on each row: what it needs
  from you now: answer, fix CI, resolve conflicts, merge, review its changes, ship, archive.
- **The agent's plan, live**: an agent's own to-do list under its tab, ticking off as it goes, and *2/5* on its row; a
  plan it asks you to approve is a card you can edit, your version sent back.
- **Done check**: as an agent's turn ends having changed files, the project's lint, test and format scripts you tick run
  in its worktree, then a second agent (Claude Code or Codex) reviews the diff; a failure goes back to the agent (3
  times, then over to you), and you're told *done and checked*.
- **Hook health**: when an agent's hooks don't reach Laki, its tab says so (asks and finishes then come from its screen
  only) with the likely cause, such as `"disableAllHooks": true` in a settings file; Settings › Agents & profiles shows
  each agent's last hook.
- **Reader's box**: text you haven't sent stays, tab by tab, through ⇧⌘T, a restart or an archive; a chip changes a running Claude Code tab's permission mode, mid-turn too; a turn that ended on an API error offers *Continue* (or does it once by itself).
- **Tidy on its own**: worktrees nobody touched for 3 to 30 days archived with Undo (off by default), never one with unsaved work or anything running.
- **Race**: one prompt to several agents, a worktree each; compare them side by side and keep the best.
- **Suggested tasks**: an agent that notices work outside its task (a flaky test, a bug next door) suggests it
  (`laki suggest`) instead of starting it: a card under its tab with the why and the prompt, *Start*, *Edit first* or
  *Dismiss*, and a bulb on its row. Nothing starts without you.
- **Orchestrate**: a workspace an agent started says *Created by @lead* (a click goes to that tab), and the tab that started it has a workers dock: each worker's state, progress and question (answered there), failed ones until cleared, what they spent, and Allow N safe, Archive N done and Stop all, each asking first. The orchestrator skill (`/laki:orchestrate` in Claude Code, `/laki-orchestrate` in OpenCode) has one agent split work across several,
  a workspace each, follow them up and bring their reports together. Agents also talk by name: `laki name backend`
  makes one `@backend` for the rest, `laki ask @backend "…"` asks it and prints its reply. A worker started without `--perm` starts in its lead's mode (never one that never asks). A worker that can't go on (its plan limit, a failed turn, its process gone mid-turn, silent or retrying for 10 minutes, a background task 20 minutes past its turn) tells its lead once, in the lead's chat, with the next step; `laki wait` says *stuck* and the workers dock shows why.
- **Terminals**: tabs and tmux-style splits, kept alive by a daemon; ⇧⌘T reopens a tab you closed, its chat resumed (the + menu lists the last 10); their dev servers' ports in the status bar (not
  what an agent listens on itself, like its browser bridge or a browser it tests in); a spinner while a shell runs a command (an agent
  started there shows its own status); an agent you quit keeps its tab, ⏎ resumes it. After a daemon restart or an
  update, shells come back in their folder with what ran there: an agent resumes its chat, a dev server is typed back for ⏎. Shell tabs start your
  login shell or one you pick (Settings › Terminal › *Shell*: fish, bash, nushell…); agents and project scripts keep the login one. Terminals in
  your home folder and a browser (any website, sign-ins kept, Google's too; a screenshot of what's in sight or the whole page, copied or saved) live in the sidebar too, from + at its top. A tab floats
  out in a window of its own, over every app (its right click › *Float in its own window*). Select text in an agent's terminal and *Reply*: it
  goes to the agent, quoted, with your words; hold ⌥ for a new workspace, a new agent tab or Laki AI with it. A GitHub PR
  or issue link shows its card on hover, the last pictures you dropped or pasted as chips at its top right, a picture's path the picture (a file's only, not a web link; a click opens it larger), a Markdown file's
  (the workspace's or its storage folder's) the page it's written to be; a file's path
  (`src/app.ts:42`) opens on ⌘-click in the preview at its line, or your editor. *Keep the Mac awake while agents work* (Settings › Git & worktrees), or let it sleep, lock or shut down once everything is done (a minute's countdown first, once). *Check overlaps…* (a worktree's ⋯ › Workspace) finds where two worktrees change the same lines (or a base that changed them since), while both agents can still adjust; Collision radar does it on its own. Run ▾ runs the project's
  test, lint, format and deploy scripts, each in a tab.
  A copy inside vim, tmux or an ssh session (OSC 52) reaches your Mac's clipboard: a tab asks once (Settings › Terminal ›
  *Programs may copy to the clipboard*: ask, all, never; agents only with all).
- **SSH hosts**: a project on another machine (`devbox:~/code/app`): its worktrees, git, gh and agents run there over
  ssh, with nothing to install; its `$PORT` comes back to localhost for the preview.
- **Cloud workspaces**: a GitHub project's workspace in a GitHub Codespace of its own (*In a codespace* on the
  new-workspace page), its machine type picked with what it costs an hour, your `.worktreeinclude` files copied in;
  archive stops it, restore starts it again.
- **PRs**: CI and reviews in the status bar (who approved, who asked for changes) and at a glance in the sidebar
  (<img src="icons/pr-open.svg" width="13" alt="GitHub's mark"> its state,
  <img src="icons/approved.svg" width="13" alt="✓"> approved, <img src="icons/approved-you.svg" width="13" alt="✓✓"> by you
  too, 👀 you commented), sent to the agent if you like; a failing check's log a click away; ship (commit, push, PR) in one step; merge
  (squash, merge or rebase), approve, close or turn back into a draft from the app, or merge when green, and revert a merged one with a new PR, each allowed per project; a fork's CI that GitHub holds for approval shows as
  waiting, with *Approve and run*; archived once merged, if you like. Each shows its author's picture (yours too); ⌘K and the sidebar's filter find a workspace by its PR's
  number, and a right click on the PR in the status bar copies its link or `#number`. GitLab too, through `glab`: a
  merge request's state, its pipeline as checks, Ship, merge, approve, close, draft and issues (not yet review threads
  or the PR switches).
- **Side panel**: files (Markdown rendered, Mermaid diagrams too, with an outline of its headings; a changed HTML file as a page; CSV as a table you can edit, an Excel workbook's sheets as tables, a SQLite database's tables, rows, schema and a read-only query), the diff (the branch's or only what isn't committed; against another base branch, picked there; one column or two side by side; files as a list or a tree by folder; comment on a line; images before and after; In a window of its own too (its head's window button, ⌘K): it follows Laki's workspace, its comments go to that agent, and closing it puts it back.
  a Viewed box per file, the same as GitHub's; revert a hunk, picked lines or a whole file, with Undo), the branch's commits (pushed or not, each one's diff), review threads (*Reply…*, *Resolve*, *Fixed in <commit>* and *Unresolve*, as you on GitHub), and a preview of the dev
  server that sends screenshots to the agent, and a design mode: pick an element (⌥⌘P), say what to change, and its
  selector, text, styles, a screenshot and its likely source file go to the agent. Drag a file's row (Changes, Files,
  Artifacts, a turn's files) straight to Finder or any app. Agents can drive a browser of their own on it (`laki browser`: click, fill, hover, keys, scroll, select, check, drag, back, tabs). The Simulator (Settings › Simulators turns it on and checks what
  this Mac has, and starts and stops its iPhones, iPads and Android emulators): one live in the panel, a click to tap,
  a drag to swipe, your keyboard to type, a screenshot into the agent's prompt; a device per workspace, or floated over
  every app; an emulator it starts has no window but Laki's. A *Review* tab puts every changed file's diff in one page, with comments gathered and
  posted as one PR review; its *Walk through* (Laki AI) puts the changes in 3 to 7 steps to read in order, marking
  what to read with care. Diffs come *Filled* or *Quiet* (the code's own colors on a light tint; Settings › Appearance). One-click layouts put the agent beside the preview, the diff or a shell. Files' *Show ignored files* (the eye, ⌘K) lists what git ignores, dimmed; a folder like `node_modules` lists its files as you open it.
- **Expose to the world**: a dev server's port as a public link (Cloudflare), for anyone or only some emails; it
  comes back if cloudflared drops, and with your own Cloudflare domain keeps an address like `shop.example.com`.
- **Artifacts**: a folder per workspace, outside the repo, for what its agents make for you (screenshots, reports; in
  folders of their own, which you open and back out of) and links to what they publish (Claude artifacts, sites, gists:
  kept on their own as an agent publishes them; a page an agent made elsewhere on this Mac too, as a `file:///` link): counted in the status bar, a gallery of previews (links first,
  opened in the browser) a click away, each big in a click, copied with a right click (the file itself, a picture as a picture), in Finder or the side panel's Files too, the links in the side panel's Info. Deleting a workspace keeps them (Settings › Resources › *Artifacts of deleted workspaces*: open, start a workspace with one, delete) unless you tick *Also delete its artifacts*. An HTML one has *Comment*: click parts of the page, write a note on each, and *Send to the agent* puts them all in its prompt with where each one is. A picture or a screen recording has it too: a click marks a spot, a drag a box (a video pauses, each note keeps its time, a dot on the seek bar), and each frame goes with the notes, the marks drawn on.
- **Board, schedules, calendar**: every workspace by where it is, to-dos, prompts that run at times written in English (a new workspace each run, the same one each run, or one you pick; *Continue* or *Start fresh*; in groups, like workflows: drag, fold, turn several on or off at once; *Archive* and restore, *Duplicate*; or on a GitHub event: CI failing, a PR, an issue, a push; old run workspaces tidied, a failing task retried, then turned off with *Fix*),
  and reminders, once or again and again (*every weekday at 9:30*), on a calendar of all of it.
- **Share a tab**: right click › *Share live view*: an agent's chat (or a terminal's text) as a live page anyone
  with the link reads, for some hours or until you stop it, with a QR code, and Copy and Download as Markdown.
- **Remote access**: the whole app from your phone, through a Cloudflare tunnel for your email only; or with Laki's own
  PIN instead (shown on your Mac, a new one each time; a wrong one, twice unless you pick otherwise, stops it); or for
  anyone with the link, if you type *confirm* (a red warning says what that risks; 24 hours at most); or through Tailscale, for your
  tailnet's devices only (a PIN too if you like), or with Funnel and a PIN for the internet. Its link opens once, in one tab;
  copy the link and the PIN apart, or *Copy all* for both in one message. End to end: what the phone and the Mac say is
  sealed between them, so the tunnel's provider can't read or log it.
- **Headless**: on a server with no screen, `./Laki.AppImage --headless --tailscale`, and Laki in your browser
  ([headless.md](headless.md)).
- **Resources**: memory and CPU for Laki and each agent, a graph of the last minutes; put an idle agent to sleep (now, or after a while) and it wakes as you
  look; the video, extensions, the preview or the floating bubbles stop with a click. A notice before the disk fills up
  (a worktree's disk under 5 GB free, or what you set), *Make room…* opening what each workspace takes, biggest first.
- **Safe mode**: after the daemon stops three times in a row in its first minute, Laki starts nothing on its own
  (extensions, scheduled tasks, workflows, the PR and port scans) until you pick on its banner: *Turn on without* what
  ran before the crash, or *Turn everything on*. Terminals and agents work meanwhile.
- **Hidden browser pages**: an optional memory budget unloads the oldest Browsers page you aren't on; it never touches one playing,
  downloading, being inspected, or with typing or form edits.
- **Get started**: the first steps in a window that ticks them as you go, what's left at the sidebar's bottom.
- **Rail**: like Slack's (Projects, Board, Schedule, Terminal, Browser, with what needs you on each) beside a list of
  the one you pick, and up to 5 pins: workspaces in their color, specs and brainstorms.
- **Swipe on rows**: two fingers across a workspace's row or a Needs you card: left snoozes it an hour (further left
  archives, with Undo), right marks it seen (Settings › Layout › *Swipe on rows*, on on a Mac).
- **Looks**: icons from Tabler (the default), Lucide or Laki's own, at your line width and size; six Dock icons to pick from; 104 themes, 82 of which change shapes and type too (some after films' and games' screens); glass; your
  accent, corners (every theme's), sidebar lines, rows, spacing and text sizes (compact to cards), Density (Compact, Regular, Roomy), the pointing hand over buttons (or macOS's arrow) and scroll bars
  that show as you scroll, stars (or stardust, dots, a net, a grid, fireflies) behind an empty page and New workspace that stir as the pointer passes, and your own CSS for the rest; the tab bar's buttons in groups you pick and order
  (*Customize toolbar…*), tabs past its room behind *+n*; tabs on top, bottom, left or right; each project's own editor for ⌘E (Xcode for the iOS repo).
- **Extensions** (`laki ext`, or `laki widget`: the same thing): live tiles in the sidebar, the top bar, the status bar or on My Desk, laid out as you drag them (your
  PRs counted and grouped, links you open often: any you make from a starter, with Laki AI on the extension's own page, an agent's
  laki-widget skill, or any AI chat: Settings has the prompt; each previewed with made-up data before it runs), or buttons on the rail and at the start of the status bar, or items in its ⋯ menu beside Video, Meme and Timer (an icon, a label,
  a count, a click that runs something), each fed by a command on a schedule (within working hours, if
  you like), with a full view a click away; their buttons answer with toasts and dialogs; a JS one reaches the web only if you allow it.
  Drawn with the UI kit (60 JSON elements: stats, lists, tables, charts, boards, calendars, chats, PRs, logs, diffs, pipelines, switches, forms; Settings › Extensions › *UI kit*, with its typography, colors and 330+ icons); edit an extension's files right in Laki; its data from a fetch, a file, a URL or an agent with your MCP servers (*sum up Slack since yesterday*, every hour); `laki widget new` starts one from a starter, `laki widget dev` reloads yours as you save, `laki widget check` says what's wrong; one can be per workspace (its branch, its server, its PR), answer events (a turn done, a PR's checks failing), run in the background with no look (a notification, a dialog or a card on your screen when it has something; the UI kit's *What it can do* tries each), stream, take `laki widget push`, or give your agents tools (asked first). With Laki AI, its page makes one from a sentence, on sample data beside its settings, with Undo and *Try it live*. The SDK: [extensions.md](extensions.md).
- **On a phone**: a bottom bar (Projects, your pages, More), the workspaces as a drawer you swipe in, and Needs you with
  asks first and finished turns as rows a swipe marks seen.
- **Drop on the menu bar icon**: text, files or pictures dropped on Laki's mark open the quick bar with them, quoted,
  as paths or as pictures; nothing goes until ⏎.
- **Screenshots to agents**: from the menu bar, drawn on (crop, arrows, text, boxes) with a note, straight to a new
  workspace's prompt. Agents take their own of the iOS Simulator or any app's window (`laki screen shot`), and with
  idb tap, swipe and type in the simulator to check what they built.
- **A video while you work**: a YouTube link plays at the bottom of the sidebar.
- **Laki AI** (optional): ask in plain words, or paste a screenshot of PR links, and it starts workspaces, reviews
  PRs, sends prompts, tells you what your agents are doing and makes extensions (saved off until you turn them on); with Laki's skill it also
  lists your PRs and others', runs your actions and templates, keeps a project's notes and memory, and asks you with options when unsure (it
  removes something only when you press Yes); it stops an agent's turn or archives a workspace when you ask (archiving at your Yes); a chat button on every page that knows what you're looking at; timers, reminders and messages for later on request;
  the talk key can go to it from any app, your screen with it when you say so; it moves the window (a session, a page, full screen, a panel),
  opens a workspace in your editor, finds sessions by name or the last few and runs one command in several at one Yes;
  it tells you where a setting is, with a link that opens it;
  on OpenRouter, claude -p / codex exec or your own OpenAI-compatible endpoint (a local server too), every ask's cost logged (shown or hidden).
- **Keyboard and CLI**: ⌃⌥⌘L brings Laki forward from any app, ⌘K for everything (a preview of the highlighted item beside the list), ⌘⇧⏎ a tab full screen, ⌘+ / ⌘− one tab's text size, ⌘L send later; `laki` (also an MCP server: its core tools, more a group at a time; a workspace's diff and plan and a project's memory as resources, your templates as prompts) drives it all, agents included, with tab completion (`laki completion zsh|bash|fish`). Menus can be macOS's own (Settings › Layout).
- **MCP servers**: one list for every project's agents (Settings › Agents & profiles), a project's own on top; *Import*
  copies what Claude Code, Codex, Antigravity and OpenCode already have, never changing their configs. Claude Code,
  Codex and OpenCode get them as they start. *One process for every agent* on a server: Laki starts it once and every
  agent talks to it, instead of ten agents starting ten copies (a browser, a database connection).
- **Trusted clients**: an app outside Laki (a desktop app's MCP server, a script) drives it with a token of its own (`laki client add "Grok Bot"`, allowed in Laki's window): a name on what it starts, scopes (new workspaces and messages to agents unless you add more), revoked at once. Ready-made setups (`--for mcp`, `raycast`, `launchd`, `shortcuts`, `script`): the narrowest scopes and the config to paste, naming the token's file.
