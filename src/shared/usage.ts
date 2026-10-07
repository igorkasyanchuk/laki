// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki: coding agents in parallel git worktrees

  laki open                                   open the app
  laki ls [--json]                            projects, workspaces, tabs and their status
  laki project add <path|host:path> | ls | rm <id>   host:path: a folder over SSH (a ~/.ssh/config name or user@host)
  laki new <project> [--base b] [--preset claude|codex|gemini|grok|opencode|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
            [--model opus|sonnet|…] [--effort low|medium|high|xhigh|max (claude), minimal…xhigh (codex)]
            [--issue <url|number>]  a GitHub issue's title and text as the prompt (and the name)
            [--pr <url|number>]     a GitHub PR's branch (gh pr checkout, forks too), named pr-<n>-<title>
            [--fan claude,codex]    a race: the same prompt to each, a worktree each (Compare in the app)
  laki rm <ws> | archive <ws> | restore <ws> | fork <ws>
  laki tab <ws> [--preset p] [--cmd c]        a new tab
  laki send <ws>[/<tab>] [--when-idle] <text> type text into an agent (now, or when its turn ends)
  laki screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki diff <ws> | run <ws> | ship <ws> -m <message>
  laki browser [<ws>] open [url|/path] | screenshot | click <css> | fill <css> <text> | text
                                              a hidden browser on the workspace's localhost (the app must be open);
                                              screenshot prints a PNG's path; in a tab, <ws> is its own
  laki schedule [ls] | log                    scheduled tasks and their next runs | the last runs
  laki schedule add <project> --when "weekdays at 9am" [--preset p] [--where new|folder|folder-new|<ws>] [--name n] <prompt>
                                              a prompt for an agent at those times; {{DD-MM-YY}} in the name or
                                              prompt is the run's date
  laki schedule on|off|run|rm <id>            turn one on or off, run it now, delete it
  laki widget [ls] | reload                   the sidebar's widgets | read their folders again and fetch
  laki widget on|off|run <id>                 show or hide one | run its fetch now
  laki widget render <id> [--full]            the HTML it shows now, filled from its data
  laki widget action <id> <action> [arg]      run one of its widget.json actions
  laki mcp                                    Laki as an MCP server (stdio): claude mcp add laki -- laki mcp
  laki daemon | stop                          run the daemon in the foreground | stop it
  --json prints machine-readable output`
