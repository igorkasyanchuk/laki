// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki: coding agents in parallel git worktrees

  laki open                                   open the app
  laki ls [--json]                            projects, workspaces, tabs and their status
  laki project add <path> | ls | rm <id>
  laki new <project> [--base b] [--preset claude|codex|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
  laki rm <ws> | archive <ws> | restore <ws> | fork <ws>
  laki tab <ws> [--preset p] [--cmd c]        a new tab
  laki send <ws>[/<tab>] [--when-idle] <text> type text into an agent (now, or when its turn ends)
  laki screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki diff <ws> | run <ws> | ship <ws> -m <message>
  laki daemon | stop                          run the daemon in the foreground | stop it
  --json prints machine-readable output`
