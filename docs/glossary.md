# Glossary

One word per thing, in the app, Help, the CLI and the docs. Code names (RPC methods, settings keys, section ids,
file names) stay as they are; only the words people read follow this page. `test/terms.test.ts` keeps the retired ones
out of Help and Settings.

| Say | For | Not |
|---|---|---|
| **Changes** | a workspace's local diff (the side panel's tab, ⌘D, Needs you's button) | Review (for this) |
| **Review** | the one full-page Review tab over the panes | the review |
| **PR comments** | the side panel's tab of a PR's threads | Review (for this) |
| **Second opinion** | the Done check's reviewer agent | review agent |
| **Backlog** | the Board's first column: prompts waiting for a workspace | To do |
| **To-dos** | the personal checklist page | todo list |
| **Plan** | the agent's own to-do list, live | todos |
| **Extension** | a live page or button made of `widget.json` and its files; `laki ext` (= `laki widget`) | widget, plugin |
| **Workflow** | a run of blocks (the Workflows page; `laki flow` is the CLI's short form) | Flow, Flows |
| **Race** | one prompt to several agents, a worktree each (Compare); `--race` (= `--fan`) | fan, fan-out |
| **Agent** | Claude Code, Codex, Gemini, Grok, OpenCode | preset |
| **Profile** | an agent with its args, env and model (Settings › Agents & profiles) | preset |
| **Side panel** | the panel right of the panes (⌥⌘B): Info, Files, Changes, PR comments… | right panel, info panel |
| **My Desk** | the page of extension tiles | the Desk |
| **Collision radar** | where two worktrees (or the base) change the same lines; *Check overlaps* opens it | Overlaps (as a title) |
