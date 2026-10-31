// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki: coding agents in parallel git worktrees

  laki help [command]                         this, or one command's details and examples (laki <command> --help too)
  laki open                                   open the app
  laki ls [--json]                            projects, workspaces, tabs and their status
  laki project add <path|host:path> | ls | rm <id>   host:path: a folder over SSH (a ~/.ssh/config name or user@host)
  laki new <project|.> [--base b] [--preset claude|codex|gemini|grok|opencode|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
            [--model opus|sonnet|…] [--effort low|medium|high|xhigh|max (claude), minimal…xhigh (codex)]
            [--perm <mode>] [--fast]  its permission mode (auto, acceptEdits, plan, bypassPermissions: claude, codex) and fast mode
            [--template <name>]     the prompt through one of your prompt templates
            [--action <name>]       an agent action of yours (Run ▾) as its prompt, the prompt after it
            [--group <name>]        under that group of the project in the sidebar (its template and agent too)
            [--issue <url|number>]  a GitHub issue's title and text as the prompt (and the name)
            [--pr <url|number>]     a GitHub PR's branch (gh pr checkout, forks too), named pr-<n>-<title>
            [--link <url|number>]   the PR it's about (a review), not checked out: its PR, named after it; in a
                                    tab, a PR the prompt names is only related (its own PR is its PR)
            [--fan claude,codex]    a race: the same prompt to each, a worktree each (Compare in the app)
            [--no-setup]            without the project's setup script (.worktreeinclude's files still copied)
            [--at <when>]           the workspace now, its agent later: tomorrow 9am, in 2h, 2026-10-20 14:30
            [--after-limit]         its agent once the plan limit resets (claude, codex)
  laki rm <ws> | archive <ws> [--force] | restore <ws> | fork <ws>
  laki rename <ws|.> <name>                   name a workspace (in a tab, . is its own)
  laki pr <ws|.> <url|number> | --detach      attach a GitHub PR to a workspace | detach its PR (only related, kept off)
  laki memory [<project>|.]                   a project's memory: the user's, and what agents learned
  laki memory add <project>|. <text> [--mine] remember something lasting about it (an agent's; --mine: yours, not in an agent's tab)
  laki memory rm <project>|. <id>             forget one agents learned
  laki preset [ls]                            the agent profiles (Settings › Agents & profiles), your default marked
  laki preset add|set <name> [--agent claude|codex|…|command] [--args "…"] [--model m] [--effort e] [--perm mode] [--fast]
            [--cmd c] [--env KEY=value…] [--account id] [--name new]   a new profile, or change one ('' drops a field)
  laki preset on|off|rm <name>                show it in the pickers or not | delete it
  laki remind <when> <text> [--ws <id>|.]    a reminder on the calendar (Calendar): in 2h, tomorrow at 9am
  laki reminders [rm|done <id>]              the calendar's reminders
  laki tab <ws> [--preset p] [--cmd c] [--prompt text] [--name n] [--model m] [--effort e] [--perm mode] [--fast]
                                              a new tab; with a prompt, its agent starts on it
  laki send <ws>[/<tab>]|@name [--when-idle] <text>   type text into an agent (now, or when its turn ends)
  laki name <name>                            in an agent's tab: its @name, for other agents' send and ask
  laki agents                                 the named agents, wherever they run
  laki ask <@name|ws[/tab]> <question> [--wait min]   ask another agent; prints its reply (15 minutes at most)
  laki progress <0-100> [what you're on]      in an agent's tab: how far along its task is, shown on the tab
  laki show <text> [--open <folder|file|url>…] [--title t]   in a tab: a card under it in Laki, a button per --open
                                              (a folder in Finder, a file in its app, a page in the browser)
  laki screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki screen shot [app] | windows            a screenshot of the iOS Simulator, or of an app's window (its PNG's path)
  laki screen tap <x> <y> | swipe <x1> <y1> <x2> <y2> | type <text> | describe
                                              the simulator's hands, in points (needs idb); describe: its elements
  laki diff <ws> [--uncommitted] | run <ws> [test|lint|format|deploy|setup] | ship <ws> -m <message> [--force]
                                              diff: against its base (--uncommitted: only what isn't committed);
                                              run: the run script (a dev server), or that script in a tab of its own
  laki browser [<ws>] open [url|/path] | screenshot | click <css> | fill <css> <text> | text
                                              a hidden browser on the workspace's localhost (the app must be open);
                                              screenshot prints a PNG's path; in a tab, <ws> is its own
  laki schedule [ls] | log                    scheduled tasks and their next runs | the last runs
  laki schedule add <project> --when "weekdays at 9am" [--preset p] [--where new|folder|folder-new|<ws>] [--base <branch>] [--name n] <prompt>
                                              a prompt for an agent at those times; {{DD-MM-YY}} in the name or
                                              prompt is the run's date
  laki schedule on|off|run|rm <id>            turn one on or off, run it now, delete it
  laki flow [ls]                             workflows and their runs
  laki flow run <workflow> [project] <task> [--ws <ws|.>] [--dry] [--set name=value…] [--budget "30 min, $2"]  start a run (--ws: in a workspace you have, no new worktree; --dry: a PR, approve, merge said, not done; --set: its inputs; --budget: its working time and AI cost, past either it asks)
  laki flow run <workflow> [project] --event [<name>] [--event-json <file|->] [--ws <ws|.>] [--dry]  as if on an event (its on: unless named; the last one heard, else a sample in --ws; --dry: its variables and only when: tests first)
  laki flow again <run> [--from <block>]     an ended run again (its task and inputs); --from: in its workspace, its state kept, from that block
  laki flow show|stop <run> | answer <run> <n> [words]  a run's decisions | stop it | answer what it asks
  laki flow on <workflow> [project]           turn on again one paused after 5 failed runs in a row (events and its schedules start it again)
  laki flow trash | restore <trash-id>        the workflows deleted in the last 30 days | put one back
  laki flow check [file.md… | folder]        check workflow files, no daemon (none given: ./.laki/workflows); exit 1 on a problem
  laki widget [ls] | reload                   the sidebar's extensions | read their folders again and fetch
  laki widget on|off|run <id> [--ws <ws>]     show or hide one | run its fetch now (--ws: a per-workspace one's); only you turn one on
  laki widget what <id>                       what turning it on runs, and its files' hash
  laki widget on <id> --seen <hash>           on only while its files are the ones laki widget what showed
  laki widget logs <id> [-n 100] [-f] [--level error] [--ws <ws>] [--json]  its log (when it keeps one): -f follows it
  laki widget log <id> [--level warn] [--ws <ws>] <text…>  a line in its log (a hook, cron): exits 0, nothing written while it's off; options before the text only
  laki widget emit <name> [json | -] [--ws <ws>]  an event of your own, custom.<name>: extensions and workflows on it run
  laki widget events                          the last 50 events, and what each reached (or why not)
  laki widget set <id> [--place desk,side] [--size 2x1] [--every 5] [--view s|m|l] [--hide refresh,at|none] [key=value…]
        where it shows, its size, how often it fetches, its full view, what it hides, its settings
  laki widget render <id> [--full] [--ws <ws>]  the HTML it shows now, filled from its data
  laki widget action <id> <action> [arg] [--ws <ws>]  run one of its widget.json actions: what the app would show (an agent's: you're asked)
  laki widget kit [element|icons] [--json]    the UI kit (widget.json's "ui"): its elements, one's props and a sample, or every icon
  laki widget dev [folder]                    dev mode: link your extension's folder (on, watched), then its runs as they come
  laki widget dev --off <id|folder> | --list  unlink one | the linked folders
  laki widget new <name> [--kind <k>] [--dir <folder>]  a starter (number, list, table, chart, note, launcher, button, form, panel, workspace, stream, tool, pullmain, context, onefile), on
  laki widget push <id> [json | -] [--ws <ws>] [--merge]  its data from a cron job, a git hook, CI: no fetch (stdin with -)
  laki widget tools [--json]                  the extensions' tools for agents: each one's input and when to use it
  laki widget tool <id> <action> [json] [--ws <ws>]  call one: Laki asks you first, unless it says never; its output back
  laki widget check [id|folder] [--no-run] [--ws <ws>]  what's wrong with one: widget.json, its ui against its data, its fetch once
  laki widget remix <id> [new-id]            a copy of one (a built-in too) to change: yours, off
  laki widget trash | restore <trash-id>      the extensions deleted in the last 30 days | put one back
  laki ai [--image png] <ask> | new | log     ask Laki's AI (Settings › AI) to work Laki: "what are my agents doing?",
                                              "review the 3 PRs in this screenshot" | a new conversation | its calls
                                              and cost; laki ai alone: the conversation
  laki mcp                                    Laki as an MCP server (stdio): claude mcp add laki -- laki mcp
  laki daemon | stop                          run the daemon in the foreground | stop it
  laki serve --tailscale [--pin | --funnel] | --cloudflare --mail <you@x.com> | --cloudflare --pin | --cloudflare --open --hours <n ≤ 24>  [--hours n]
                                              headless: the daemon and remote access, until stopped (docs/headless.md);
                                              its link opens once, its PIN prints on a terminal only (else laki remote)
  laki remote [stop]                          remote access's link and PIN now | stop it
  --json prints machine-readable output`


// each command's details and examples, after its lines of USAGE: laki help <command>, laki <command> --help. Written
// for agents (the skill points here): what it prints, what to pass, what to run next
const HELP: Record<string, string> = {
  ls: `Prints every project, its workspaces and their tabs (✓ done, ● unseen, the status). --json is what to read in a
script: projects (id, path), workspaces (id, branch, path, port, pr, tabs: a | b side by side, a / b stacked) and tabs
(id, workspace, kind, status: running, waiting, idle, exited).

  laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\\(.workspace)/\\(.name)"'`,
  new: `Makes a workspace: a git worktree on a new branch (or the folder itself with --local), set up by the project's setup
script, with the agent started on the prompt. Prints the new workspace's id. In a Laki tab, . is this tab's project.
Write the prompt as for a colleague who hasn't seen this conversation: the goal, where to look, how to tell it's done.
From an agent's tab: an agent or a shell, no --cmd and no command preset. A repo's .laki.json (its setup, env, scripts)
waits until the user trusts it in the app: the workspace is made, its setup runs then. --no-setup skips the setup
script (laki run <ws> setup runs it later). --at starts its agent later, --after-limit once the plan limit resets
(the soonest reset of a window at Settings' Plan limit at, else the 5-hour one's); Laki must be running then.

  laki new . --prompt "Add CSV export to the reports page; npm test passes"
  laki new shop --preset codex --name csv-export --prompt "…"
  laki new shop --issue 42                     the issue's title and text as the prompt
  laki new shop --at "tomorrow 9am" --prompt "…"  made now, its agent starts at 9
  laki new shop --pr 118 --prompt "Fix the failing test"
  laki new shop --link 118 --prompt "Review this PR"   about it, its branch not checked out
  laki new shop --fan claude,codex --prompt "…"        a race: one worktree each
  laki new shop --no-setup --perm acceptEdits --fast --prompt "…"   no setup script; edits without asking, fast
  laki new shop --group Reviews --template review --prompt "#118"   under Reviews, through your review template
  laki new shop --action "PR+audit" --prompt "the login page"        your agent action's prompt, then these words`,
  send: `Types text into a tab and presses Enter. <ws> alone is its first agent tab; <ws>/<tab> by the tab's id, name or
number. --when-idle queues it for when the agent's turn ends (it's sent at once if it's idle). While the agent asks
something (status waiting: a permission prompt), the text would answer it: leave those to the user, or --when-idle.
From an agent's tab, a tab in another workspace: the user is asked in the app first.

  laki send a1b2 "Now add tests for it"
  laki send a1b2/codex --when-idle "Rebase on main when you're done"
  laki send @backend "The API is merged: rebase on main"`,
  name: `Gives the agent in this tab (\$LAKI_TAB) a name other agents reach it by, in any workspace: @<name> works wherever a
target goes (laki send, laki ask, laki screen). A word of letters, digits and dashes; one live agent per name (an ended
one's goes to the next). It stays with the tab until the tab closes or its workspace is archived; laki name "" drops it.

  laki name backend
  laki agents                                   who has a name, where, and what it's doing`,
  agents: `Lists the agents with a name (laki name): @name, the agent, its status, its workspace and tab.`,
  ask: `Asks another agent something and waits for its reply: the question goes in as its turn ends (--when-idle), saying
who asks, and the answer its next turn ends with is printed. 15 minutes unless --wait. From an agent's tab, an agent
in another workspace: the user is asked in the app first. For a message that needs no answer, laki send.

  laki ask @backend "Which endpoint returns the user's teams?"
  laki ask a1b2 --wait 30 "Review my last commit on main and say what you'd change"`,
  screen: `Prints the bottom of a tab's screen (30 lines unless --lines): what the agent shows now, its question too.
laki screen shot|windows|tap|swipe|type|describe drive the iOS Simulator and apps' windows instead (shot prints a
PNG's path: read it). From an agent's tab, a tab in another workspace: the user is asked in the app first.

  laki screen a1b2 --lines 80
  laki screen shot                              the booted simulator
  laki screen shot Safari                       Safari's front window`,
  tab: `Opens a tab in a workspace: an agent (--preset), a command (--cmd) or a shell (neither). With a prompt (--prompt,
or the words after <ws>) its agent starts on it, as a new workspace's does; --name, --model, --effort, --perm and
--fast are its own. From an agent's tab: no --cmd and no command preset (the user starts commands).

  laki tab a1b2 --preset codex
  laki tab a1b2 --cmd "npm run storybook"
  laki tab a1b2 --preset codex --name "codex review" --prompt "Review what claude changed here"
  for w in a1b2 c3d4; do laki tab "$w" --preset claude --prompt "$(cat "$w.md")"; done   a brief each, one call`,
  progress: `In an agent's tab: how far along the whole task is (0-100) and what you're on, shown on the tab until the turn
ends. Every 20-30 seconds of work when $LAKI_PROGRESS is 1; never go back down; 100 when it's done.

  laki progress 40 "Parser done, writing tests"`,
  show: `In a Laki tab: a card under it in the app with your words and a button per --open the user clicks: a folder
opens in Finder, a file in its app, an http(s) link in the browser (4 at most; a path: absolute, or from where you
are). Use it instead of asking the user to run open: for evidence, a report, a page to check. A newer card replaces it.

  laki show "Smoke test evidence: 2 screenshots, the report" --open "$LAKI_STORAGE_FOLDER/smoke_tests"
  laki show "The preview deploy" --open https://shop-git-fix.vercel.app --title "Ready to check"`,
  memory: `A project's memory: what every session in it is told (claude and codex get it at their start). . is this tab's
project. Add something general and lasting (an approach that works or doesn't, a gotcha, how to run or test it),
never task notes, progress or secrets. rm takes an id laki memory prints, a learned one only.

  laki memory .
  laki memory add . "Run the e2e tests with npm run e2e -- --headed; they need port 5173 free"
  laki memory rm . m3k9`,
  preset: `Agent profiles (presets): how a tab's agent starts (its agent, args, model, effort, permission mode, fast
mode, env, account). laki new --preset <name> and laki tab --preset start one. From an agent's tab, add, set, on, off
and rm ask the user in the app first (its args and env run in every tab of it), and need the app open.

  laki preset ls
  laki preset add claude-ask --agent claude --perm auto
  laki preset set claude-ask --model opus --effort high
  laki preset set claude-ask --args ''           drop its args
  laki preset off codex                          out of the pickers, its tabs still start`,
  rename: `Names a workspace (the sidebar's row). . is this tab's.

  laki rename . csv-export`,
  pr: `Attaches a GitHub PR to a workspace, so its status and checks show on it: one opened on another branch or in
another repo (a PR of the workspace's own branch shows by itself once pushed). Run it right after gh pr create.

  laki pr . https://github.com/acme/shop/pull/118`,
  browser: `A hidden browser on the workspace's localhost (the app must be open): open loads a path on its $PORT (laki run
starts the dev server) or a localhost URL; screenshot prints a PNG's path; click and fill take a CSS selector; text
prints the page's text. Open, click and fill print what they caused: → <url> when the page moved, blocked: (a popup
or a link off localhost), console error: lines, and the text lines added (+) and gone (-), or (no changes). In a tab,
<ws> is its own.

  laki browser open /settings
  laki browser fill "#email" "a@b.co"
  laki browser click "button[type=submit]"
  laki browser screenshot`,
  diff: `Prints the workspace's changes against its base (what ship would put in a PR).`,
  archive: `Archives the workspace: its worktree goes, its branch stays (laki restore brings it back). An extension's gate may hold it: the reasons are printed and it exits 1; --force does it anyway (the user only: refused in an agent's tab).

  laki archive a1b2`,
  run: `Starts the project's run script (a dev server, on $PORT) in a tab of its own, or test, lint, format or deploy
(the project's scripts) in theirs, or setup (the setup script: a worktree made with --no-setup, or again). A repo's
.laki.json runs nothing until the user trusts it in the app: it says so.

  laki run a1b2
  laki run a1b2 test`,
  ship: `Commits the workspace's changes with the message, pushes the branch and opens a PR (gh). Nothing uncommitted and no commit its base doesn't have: refused, nothing to ship. A fork with no gh repo set-default: the PR opens on origin's repo. An extension's gate may hold it: the reasons are printed and it exits 1; --force does it anyway (the user only: refused in an agent's tab).

  laki ship a1b2 -m "Add CSV export"`,
  schedule: `A prompt for an agent at the times a line of English says, while the Mac is awake (a run more than 30 minutes
late is skipped). --where: new (a worktree each run), folder, folder-new, or a workspace id (its agent gets it).
--base: the branch a new worktree starts off (new only; gone when it runs: that run fails and says so).
{{DD-MM-YY}} in the name or prompt is the run's date. From an agent's tab it's saved off: on and run are the user's.

  laki schedule add shop --when "weekdays at 9am" "Triage the new issues"
  laki schedule add shop --when "fridays at 5pm" --base release/2.0 "Backport this week's fixes"
  laki schedule add shop --when "every 2 hours from 9am to 6pm" --where a1b2 "Check CI"
  laki schedule log`,
  remind: `A reminder for the user on Laki's calendar (Calendar), only when they ask for one. --ws . ties it to
this workspace.

  laki remind "tomorrow at 9am" Check the deploy --ws .`,
  flow: `Workflows: graphs of blocks Laki runs for a task, each run in a workspace of its own, or one you
have (--ws; . is this tab's, the project then its). --dry says what a PR, approve or merge would do instead of doing it.
--set gives one of its Start's inputs (inputs: in the file), again for each; the ones without a default are needed.
check reads workflow files as Laki would and names each problem (a repo's hook or CI: it needs no daemon). One an agent
wrote runs only from its editor in Laki until the user saves it there; a repo's (.laki/workflows) starts for an agent, an
event or a schedule only once the user allows it as it is. answer is the user's (refused in an agent's tab).

  laki flow ls
  laki flow run review-pr shop "Review PR #118" --dry
  laki flow run fix-ci "Fix the failing check" --ws .
  laki flow run fix-ci --event --ws . --dry
  laki flow run fix-issue shop "Fix it" --set issue=1423 --set base=main
  laki flow check .laki/workflows/ship.md`,
  widget: `Extensions (widgets): small live pages in the sidebar, bars and rail. An agent may list, check, render and use
their tools, and change where one shows and its settings (laki widget set; not a secret, its source or network
access); turning one on is the user's. Places: side, top, status, rail, foot, desk, panel, row (per workspace). To make
one, use the laki-widget skill (/laki:extension in Laki's Claude Code tabs).

  laki widget set my-prs --place desk --size 3x2   a tile on the Desk, 3 cells across, 2 down
  laki widget set my-prs --every 10 repo=acme/api   fetch every 10 minutes, its repo setting
  laki widget tools                             what the user's extensions let you do, each tool's input
  laki widget tool <id> <action> '{"query":"…"}'   in a tab, for its workspace; Laki may ask the user first
  laki widget check <id>`,
  ai: `Asks Laki AI (Settings › AI) to work Laki for you, as the user would ask it in the app.

  laki ai "what are my agents doing?"`,
  mcp: `Laki as an MCP server over stdio (JSON-RPC, a message per line): its state, a new workspace, a message to an
agent, a tab's screen, a diff, scheduled tasks and more; none that deletes, archives or ships.

  claude mcp add laki -- laki mcp`,
}

// laki help <command> [sub]: that command's lines of USAGE (with the lines under each) and its HELP; null: no such
// command. A sub narrows them to its own lines (laki help widget new), else all of the command's
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function helpFor(cmd: string, sub?: string): string | null {
  const w = esc(cmd)
  const re = (at: string) => new RegExp(`${at}${w}([ |]|$)`)
  const blocks: string[][] = []
  for (const l of USAGE.split('\n').slice(2)) {
    if (/^  laki /.test(l)) blocks.push([l])
    else if (/^ {6,}\S/.test(l) && blocks.length) blocks.at(-1)!.push(l)
    else blocks.push([l]) // --json: matches nothing
  }
  // its own lines (laki <cmd>), else the ones it's an alternative on (laki rm <ws> | archive <ws>)
  const head = (b: string[]) => b[0].split(/(?<=\S) {2,}/)[0] // the command, not what it does (| stop it)
  const own = blocks.filter(b => re('^  laki ').test(head(b)))
  const mine = own.length ? own : blocks.filter(b => re('\\| ').test(head(b)))
  const more = Object.hasOwn(HELP, cmd) ? HELP[cmd] : '' // not an inherited key (constructor)
  if (!mine.length && !more) return null
  const narrow = sub && mine.filter(b => new RegExp(`^  laki ${w} (\\S*\\|)?${esc(sub)}([ |]|$)`).test(head(b)))
  return [...(narrow && narrow.length ? narrow : mine).flat(), ...(more ? ['', more] : [])].join('\n')
}
