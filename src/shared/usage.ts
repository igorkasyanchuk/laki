// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki: coding agents in parallel git worktrees

  laki open                                   open the app
  laki ls [--json]                            projects, workspaces, tabs and their status
  laki project add <path|host:path> | ls | rm <id>   host:path: a folder over SSH (a ~/.ssh/config name or user@host)
  laki new <project|.> [--base b] [--preset claude|codex|gemini|grok|opencode|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
            [--model opus|sonnet|…] [--effort low|medium|high|xhigh|max (claude), minimal…xhigh (codex)]
            [--issue <url|number>]  a GitHub issue's title and text as the prompt (and the name)
            [--pr <url|number>]     a GitHub PR's branch (gh pr checkout, forks too), named pr-<n>-<title>
            [--link <url|number>]   the PR it's about (a review), not checked out: its PR, named after it; in a
                                    tab, a PR the prompt names is only related (its own PR is its PR)
            [--fan claude,codex]    a race: the same prompt to each, a worktree each (Compare in the app)
  laki rm <ws> | archive <ws> | restore <ws> | fork <ws>
  laki rename <ws|.> <name>                   name a workspace (in a tab, . is its own)
  laki pr <ws|.> <url|number>                 attach a GitHub PR to a workspace
  laki memory [<project>|.]                   a project's memory: the user's, and what agents learned
  laki memory add <project>|. <text> [--mine] remember something lasting about it (an agent's; --mine: yours)
  laki memory rm <project>|. <id>             forget one agents learned
  laki remind <when> <text> [--ws <id>|.]    a reminder on the calendar (Calendar, experimental): in 2h, tomorrow at 9am
  laki reminders [rm|done <id>]              the calendar's reminders
  laki tab <ws> [--preset p] [--cmd c]        a new tab
  laki send <ws>[/<tab>] [--when-idle] <text> type text into an agent (now, or when its turn ends)
  laki progress <0-100> [what you're on]      in an agent's tab: how far along its task is, shown on the tab
  laki screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki screen shot [app] | windows            a screenshot of the iOS Simulator, or of an app's window (its PNG's path)
  laki screen tap <x> <y> | swipe <x1> <y1> <x2> <y2> | type <text> | describe
                                              the simulator's hands, in points (needs idb); describe: its elements
  laki diff <ws> | run <ws> [test|lint|format|deploy] | ship <ws> -m <message>
                                              run: the run script (a dev server), or that script in a tab of its own
  laki browser [<ws>] open [url|/path] | screenshot | click <css> | fill <css> <text> | text
                                              a hidden browser on the workspace's localhost (the app must be open);
                                              screenshot prints a PNG's path; in a tab, <ws> is its own
  laki schedule [ls] | log                    scheduled tasks and their next runs | the last runs
  laki schedule add <project> --when "weekdays at 9am" [--preset p] [--where new|folder|folder-new|<ws>] [--name n] <prompt>
                                              a prompt for an agent at those times; {{DD-MM-YY}} in the name or
                                              prompt is the run's date
  laki schedule on|off|run|rm <id>            turn one on or off, run it now, delete it
  laki flow [ls]                             workflows (experimental: Settings › General) and their runs
  laki flow run <workflow> <project> <task> [--dry]  start a run (--dry: a PR, approve, merge said, not done)
  laki flow show|stop <run> | answer <run> <n> [words]  a run's decisions | stop it | answer what it asks
  laki widget [ls] | reload                   the sidebar's extensions | read their folders again and fetch
  laki widget on|off|run <id> [--ws <ws>]     show or hide one | run its fetch now (--ws: a per-workspace one's)
  laki widget render <id> [--full] [--ws <ws>]  the HTML it shows now, filled from its data
  laki widget action <id> <action> [arg] [--ws <ws>]  run one of its widget.json actions: what the app would show
  laki widget kit [element|icons] [--json]    the UI kit (widget.json's "ui"): its elements, one's props and a sample, or every icon
  laki widget dev [folder]                    dev mode: link your extension's folder (on, watched), then its runs as they come
  laki widget dev --off <id|folder> | --list  unlink one | the linked folders
  laki widget new <name> [--kind <k>] [--dir <folder>]  a starter (number, list, table, chart, note, launcher, button, form, panel, workspace, stream, tool, onefile), on
  laki widget push <id> [json | -] [--ws <ws>] [--merge]  its data from a cron job, a git hook, CI: no fetch (stdin with -)
  laki widget tools [--json]                  the extensions' tools for agents: each one's input and when to use it
  laki widget tool <id> <action> [json] [--ws <ws>]  call one: Laki asks you first, unless it says never; its output back
  laki widget check [id|folder] [--no-run] [--ws <ws>]  what's wrong with one: widget.json, its ui against its data, its fetch once
  laki ai [--image png] <ask> | new | log     ask Laki's AI (Settings › AI) to work Laki: "what are my agents doing?",
                                              "review the 3 PRs in this screenshot" | a new conversation | its calls
                                              and cost; laki ai alone: the conversation
  laki mcp                                    Laki as an MCP server (stdio): claude mcp add laki -- laki mcp
  laki daemon | stop                          run the daemon in the foreground | stop it
  laki serve --tailscale [--pin] | --cloudflare --mail <you@x.com> | --cloudflare --pin  [--hours n]
                                              headless: the daemon and remote access, until stopped (docs/headless.md)
  laki remote [stop]                          remote access's link and PIN now | stop it
  --json prints machine-readable output`
