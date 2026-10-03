// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `wbs: coding agents in parallel git worktrees

  wbs open                                   open the app
  wbs ls [--json]                            projects, workspaces, tabs and their status
  wbs project add <path> | ls | rm <id>
  wbs new <project> [--base b] [--preset claude|codex|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
  wbs rm <ws> | archive <ws> | restore <ws> | fork <ws>
  wbs tab <ws> [--preset p] [--cmd c]        a new tab
  wbs send <ws>[/<tab>] [--when-idle] <text> type text into an agent (now, or when its turn ends)
  wbs screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  wbs diff <ws> | run <ws> | ship <ws> -m <message>
  wbs daemon | stop                          run the daemon in the foreground | stop it
  --json prints machine-readable output`
