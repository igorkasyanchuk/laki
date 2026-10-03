// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki-electron: coding agents in parallel git worktrees

  laki-electron open                                   open the app
  laki-electron ls [--json]                            projects, workspaces, tabs and their status
  laki-electron project add <path> | ls | rm <id>
  laki-electron new <project> [--base b] [--preset claude|codex|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
  laki-electron rm <ws> | archive <ws> | restore <ws> | fork <ws>
  laki-electron tab <ws> [--preset p] [--cmd c]        a new tab
  laki-electron send <ws>[/<tab>] [--when-idle] <text> type text into an agent (now, or when its turn ends)
  laki-electron screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki-electron diff <ws> | run <ws> | ship <ws> -m <message>
  laki-electron daemon | stop                          run the daemon in the foreground | stop it
  --json prints machine-readable output`
