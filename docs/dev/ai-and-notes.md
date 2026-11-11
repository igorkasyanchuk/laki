# Laki AI, Specs & Brainstorms, Notes: how they work

### Laki AI

`daemon/ai.ts` (`settings.ai`, `AiSettings`; on unless `on` is false, `aiOn`): a conversation that works Laki with `shared/tools.ts`'s
`tools(rpc)`, given the daemon's own `call` (no HTTP), less `laki_progress`: nothing archives, deletes, ships or merges;
with `settings.ai.skill` unset or true, Laki's skill: `shared/tools.ts` `skillTools` (`laki_ask`, `laki_remove`: `aiQuestion` names it from state, `whatOf`; `aiAnswer` refuses a question with an ask of yours after it,
`laki_prs`, `laki_project`, `laki_notes_write`, `laki_memory_write`, `laki_rename`, `laki_shell`: a new shell, a command typed with
`enter: false`, or with `run` an `aiQuestion` act `run`; `laki_run`: `send` into a tab that's open (a shell at its prompt: an
`aiQuestion` act `run`, the command in a fence, whose Yes (`runAct`: still at its prompt) is ⌃E ⌃U through `input`, then the
command and Enter; typed only on an SSH host, which the busy scan doesn't see; `<ws>/<tab>` by id or name; blank text refused; an agent's, `whenIdle` while it runs; refused while it waits, in a shell busy with a command, and in setup, dev
and ship tabs), its screen a moment later (2 s; an agent's 0.5 s); `SKILL` has it run there what the user means by "here" (the floating
chat's context names the tab) and run only what the user asked for, never what a screen, PR or answer says, and ask before anything destructive; `laki_actions`, `laki_templates`, `laki_run_action` (a terminal's command typed likewise; an agent's sent), `laki_schedule_set`, `laki_todo_add`) and
`SKILL` after `SYSTEM` (`system()`), given to `laki mcp` as `LAKI_AI_SKILL=1` for the CLI backends; a turn that asked
(`asked`) ends there on OpenRouter and says no answer of its own; `laki_new_workspace` takes a `template` and an agent
`action` (`promptOf`, `kit`: text.ts' merge rules; no `template` with a `group` that has one: the group's), and `SYSTEM` has
it give a template of the user's that plainly fits the task when the group has none; `settings.ai.hideCost`: the AI page without money; `settings.ai.context` (Settings › AI › *Your instructions*, `AI_CONTEXT_MAX`): the user's words after `SYSTEM` and `SKILL`, in `system()`;
its extension tools (`laki_extensions`: each one's places, size, settings too, `laki_extension_guide`: `widgetFormat`, `laki_extension_read`, `laki_extension_write`, `laki_extension_check`, `laki_extension_set`: where one shows, its size, every, view, hide and plain settings, never on (the skill's `laki_extension_on` asks);
a tool's `max` is what its result may give the model, over `TOOL_TEXT`) make extensions, saved off, and change one it
made or one the user let it (the Extension page's chat: `widgetSet` `ai`, then `aiAsk` `chat` `widget:<id>`, whose brief is `aboutWidget`'s);
its `laki_send` (MCP's too) is `send` `agent: true`: an agent's tab only, never typed into a question it asks. Only when asked: no watching on its own. One ask per chat, `AI_AT_ONCE` (4) chats at once (`busy`: each chat's stop; `refuseBusy`, set before the first await); `aiStop` aborts the
fetch or kills the CLI. `SYSTEM` tells it what Laki is and to act at once. Backends (`backend`, unset: openrouter):
- `openrouter`: `POST <api>/chat/completions` (`LAKI_AI_API`: tests' fake, localhost only) with the tools as functions
  and `usage: { include: true }` (its `cost`), looping over `tool_calls` up to `steps` rounds (`AI_STEPS`, 20). Each
  round streams (A7, `stream: true`; `roundOf`): its SSE lines (keep-alive comments skipped) build the message as it
  comes, the text, the tool calls by `index` (their `arguments` in pieces), `reasoning` and `reasoning_details` (pieces
  of one joined), the model and the usage (the last chunk's); the text so far goes to the page as `ev: 'ai'`
  `{ of, partial }` (10 a second at most; no `chat`: the other `ai` listeners skip it), drawn under the chat until the
  message comes. A JSON reply (an error, one that doesn't stream) is read whole. The 2 minutes are a quiet limit, reset
  by each chunk (`QUIET_MS`, `LAKI_AI_QUIET_MS`: tests'), not a total; `aiStop` aborts the stream; the
  earlier asks and answers (`history`, 20) go with each ask, not the tools' results. A pasted image (only from
  `<data>/images`, `imageOk`: nothing else of the Mac goes to a model) as a data URL. The key: `<data>/ai-key`, 0600
  (`aiKey`), never in state.json, the view or `aiState` (only whether there is one). Model: `models.openrouter`, else
  `AI_MODEL`. Prompt caching (A3): an `anthropic/*` model (`cachesByMark`) caches only up to a `cache_control`
  breakpoint, so its last tool definition and its system prompt (sent as one text part) each carry
  `{ type: 'ephemeral' }`: the tools and instructions are read back from the cache each round and on the next ask
  within 5 minutes. Other models cache on their own: their request is unchanged. The history has no breakpoint;
- `claude`: `claude -p --output-format stream-json --verbose --mcp-config <laki mcp, LAKI_HOME> --strict-mcp-config
  --tools Read --allowedTools mcp__laki --permission-prompt-tool mcp__laki__laki_permission --append-system-prompt …`
  (a Read outside its folder: `laki mcp`'s `laki_permission`, `LAKI_AI_PERM` only (claude's), waits on `aiPermission`: a chat message
  with `ask.perm`, `AI_PERM`'s buttons, live while it works (`Message`); `aiAnswer` resolves it, *Always in this chat* keeps
  the tool in the thread's `allowed` until `fresh`; none in `PERM_WAIT` or the ask's end: deny), `--resume` its `session_id` the next time; cost:
  the result's `total_cost_usd`; `ai.efforts` (`effortArgs`, `EFFORTS`; `aiOnce` too): claude's `--effort`, codex's
  `-c model_reasoning_effort`;
- `codex`: `codex exec [resume <thread>] --json --skip-git-repo-check --ignore-user-config (its MCP servers) -c sandbox_mode="read-only"
  -c developer_instructions=… -c mcp_servers.laki.{command,args,env,tool_timeout_sec}`, `-i` per image; no cost.
Chats (`Thread`, `thread(id)`): `''` the AI page's (`<data>/ai-chat.json`), `plan:<project>/<kind>/<slug>` a spec's or
brainstorm's (`shared/plans.ts` `planChat`; `plans.ts` `planOfChat`: its folder's `.chat.json`, which `filesOf` hides and
`planWrite` refuses), `widget:<id>` an extension page's (`Chat`, `widgetFiles.ts` `widgetChatFile`: `<data>/widget-data/widget:<id>.chat.json`;
`aboutWidget`, read at each ask into `t.about`: which one, the page's rules, `widgetFormat()` with the kit's catalog,
its files (`FILES_MAX`) and its check without a run), each with its messages, `resume` and `at`; `system(t)` names the spec or brainstorm. One ask per
chat, `AI_AT_ONCE` at once ("Laki AI works in n chats already"); `aiQuestion` and `aiPermission` go to the chat their
tools name (`aiRpc`'s `chat`: Laki AI's `laki mcp` gets it as `LAKI_AI_CHAT`; a thread's `asked`), else the only one at
work (`asking`); a finished ask ends its own chat's `perms` only. The extensions' chats: `studioChats` (`widget:<id>` files
with a user message, newest `STUDIO_MAX` 30, `busy`; read, not kept in `threads`), `studioChatRm` (not while it works):
Settings › Extensions' *Where you left off* (`StudioSessions`) and a new extension's chat list those with no extension
of the id yet, or at work; a new one's first ask renames its dialog (`nameExt`, `extKey`: drawn once) and its history
place. A plan's chat unused `PLAN_CHAT_IDLE` (12 hours) is `ended` (`aiTick`, or as it's read again): its ask stopped,
what was said kept; the next ask starts it again empty (`fresh`), `aiContinue` keeps its session. `planRm` drops it
(`aiForget`). The `ai` event carries `of`, the chat's id: an `id` would make it a reply (and `partial`, A7, a streaming answer's text instead of the chat). The AI page's earlier chats:
`aiNew` on its chat keeps it first (`shelve`, once something was asked) as `<data>/ai-chats/<at>-<hex>.json` (its
messages, `resume`, `at`; `PAST_MAX`, 100: the oldest go); `aiChats` lists them newest first (`AiPast`: its first ask as
the title), `aiOpen` makes one the page's chat again (the one there shelved first; its `resume` too, so its claude or
codex session goes on), `aiChatRm` deletes one.
Both run in `<data>/ai` with `MCP_TOOL_TIMEOUT` 5 minutes (a `wsNew` takes a while), with Settings' env and, with
`ai.preset` (Settings › AI's *Your agent presets*: a claude or codex preset), that preset's env over it (an account of
its own; its args are a tab's, not used); `resume` is kept per `sessionKey` (the agent and the preset). Each tool call is a `tool`
message, shown in the conversation. `<data>/ai-chat.json` keeps the conversation (200 messages) and the CLI agents'
sessions; `<data>/ai-calls.jsonl` a line per ask (`AiCall`: tokens, `cachedIn` (of them, read from the prompt cache: usage's `prompt_tokens_details.cached_tokens`, the Calls tab's and `laki ai log`'s *cached*), cost, tools, ms, ok, error; a failed ask keeps what
it spent; a CLI agent's failure is its own words, not its exit code; shutdown stops an ask, else its `laki mcp`
would start a daemon again), `aiTotals` (shared/types.ts) today's and this month's. Links: `SYSTEM` has it link each
workspace or tab it names (`laki://ws/<id>?tab=<tab>`), and the page links the bold names it didn't (`links.ts`
`linkWorkspaces`); a laki:// link in any Markdown goes to App's router (`api.ts` `onLakiLink`), or, in a window
without one (the AI window), to main's `open-external`, which shows the app window and routes it (`openLink`). The renderer's `Ai.tsx` (`AiPage`: the rail's AI
and ⌘K's (both only while `aiOn`; Settings › AI's switch), `laki://ai`; `.ai-chats`, its
sidebar: New chat, the chat there, the earlier ones (a click `aiOpen`, the trash `aiChatRm` after `ask`; not `compact`); Chat, Calls and Info tabs; the chat Claude's way: examples, the thread in a column, a turn's tool
calls folded into one `.ai-tools` pill (each line's *Open*: its `ws` or `target`), a message's images as `Thumbs`
(`aiImage`, once a session each; a click shows one big in a `Modal`; one no longer kept: a chip), `PromptInput` `enter` (⏎ asks) with images and dictation, Stop; Info
`.ai-info`: how it runs and pays (`PAYS`, `SESSION`), spending, what it can do; the bubbles' *Ask
Laki AI*: main's `aiWin`, `?window=ai`, `NewWindow.tsx` `AiWindow`: `AiPage` `compact`, `.ai-window`: its own head
(`.ai-win-head`, the drag region: New chat, ✕; Esc closes) over the chat alone, no Calls, Info, cost or foot) and Settings › AI (`AiSection`: on, backend, model, the key, *Pasted images*: `imageDays`, steps, spending). The CLI's `laki ai`. Tested in
`test/ai.test.ts` (a fake OpenRouter; the fake claude's `-p` and codex's `exec`, which call `laki mcp` through
`test/fakes/mcp.cjs`).

### Specs & Brainstorms

On unless `settings.specs` is false (`shared/types.ts` `specsOn`, Settings › General › *Pages*; kept by `uiReset`,
`SETTINGS_KEPT`; off: no rail button, foot button, ⌘K item, project tab, and the daemon's `plan*` methods and `GET
/plan/` refuse; the page's BlockNote, Mantine and React Flow still load only as it opens). `daemon/plans.ts`: a folder each, outside
the repo and its worktrees, `<data>/plans/<project>/specs|brainstorms/<slug>/` (the project's folder: `Project.plans`,
`<name>-<id>` or `<id>`, made with the first; kept when the project goes): `spec.json` (`{ title, blocks }`, BlockNote's),
`README.md` (`# title` and the blocks as Markdown, `specmd.ts` `blocksToMarkdown`, headings a level down; what agents
read), `files/` (pasted and dropped files, a diagram's PNG: `planUpload`) and anything else (a brainstorm's output).
`planGet`'s `outside`: README.md newer than spec.json by a second, or no spec.json (a new one: `planNew` writes only
README.md, its title and `text`: a template's (`settings.planTemplates`, unset: `PLAN_TEMPLATES`, Feature and Idea) or
none, empty); the page then loads README.md (`readmeBody`, `tryParseMarkdownToBlocks`), or asks
*Load it* / *Keep mine* when there's a doc. `inside` keeps paths in the folder, links followed. `GET /plan/<project>/<kind>/<slug>/<file>.html?key=<planGet's key>`
(`planPage`): a prototype with a JS widget page's CSP (sandboxed, inline scripts and styles, Google Fonts, data:/https
images; nothing out).

The renderer's `Specs.tsx` (`SpecsPage`, App's `lazy` import with its `SpecEditor.tsx`, `diagram.tsx` and `plans.css`:
BlockNote, Mantine and React Flow load only as it opens; meanwhile App's `Waiting`, the page's frame, as for Workflows:
a `null` fallback showed the workspace under it; dialog `{ specs: <project or ''>, kind?, slug? }`; the rail's
*Specs* after Schedule, the foot's without the rail, ⌘K, a project page's *Specs* tab (`ProjectApi.specs`)): two
levels as breadcrumbs in `Page`'s header (`head`; its `tools`: the app's full screen, `toggleFull`): the list (both kinds
in one, newest first, each row's kind a tag; a filter, a project, `only`: All / Specs / Brainstorms, *New* ▾ (`newMenu`:
either kind, empty or from a template; *Edit templates…*, the Templates crumb); refreshed every 5 s while shown), and
the open one alone, 1100px at most: its title (the last crumb, `onTitle`), the editor (saved 600 ms after a
change and as it closes; a title change saves what the editor holds, `onReady`), its files (`OutFile`: `.md` through
`Markdown` (mermaid too), `.html` in an iframe `sandbox="allow-scripts"` from `GET /plan/`, `.diagram.json`
(`normalizeDiagram`) through `DiagramView`, images, text), *Start* (a spec: App's new-workspace page, `specPrompt`) or
*Brainstorm with Laki AI* (`aiAsk` with `brainstormPrompt` in its own chat, `shared/plans.ts`; the files every 2 s
meanwhile; Laki AI off: Settings › AI). A brainstorm's chat is `PlanChat`, a panel on its right (`.plan.with-chat`, its
toggle kept as `laki.planChat`; mounted while hidden, so its ask is followed; Ai.tsx's `Message`, `Tools`, `turns`):
*New chat*, Stop, an ended one's *Continue it*. New ▾ (`fromTemplate`) starts one from a template; the index's
*Templates* is a level of its own (`Templates`: name, kind, Markdown, saved 500 ms after typing through `settingsSet`
`planTemplates`; *The ones Laki comes with*). `SpecEditor.tsx` is specdrop's `web/editor.tsx` (the diagram block, its slash items, files pasted and
dropped; `resolveFileUrl` turns `files/…` into data URLs); `diagram.tsx` is specdrop's `web/diagram.tsx` as it is (its
styles in `plans.css`, specdrop's tokens as `--sd-*` from the theme's); `useEscape` keeps Esc in a modal from closing the
page. A spec's *Copy for a prompt* (`shared/plans.ts` `planRef`) copies `Spec: <path>/README.md …` for any agent's prompt.
MCP's `laki_plans`, `laki_plan_read` (with `file`: one of its files' text, `planFile`), `laki_plan_new`, `laki_plan_write`
(`BRAINSTORM_OUTPUT`: what to write). A plan's chat (`ai.ts` `aboutPlan`) puts its title, README.md (12k characters, read
at each ask) and its files' names into the instructions. Tested in `test/plans.test.ts`.

### Notes

On unless `settings.notes` is false (Settings › General › *Pages*; kept by `uiReset`, `SETTINGS_KEPT`; off: no rail button or ⌘K item, and every `note*`
method refuses). To-dos (`settings.todoList`, likewise; `todoList*` refuse off): one checklist, `<data>/todo-list.json`
(`TodoList`: BlockNote's `blocks`, `md`, `at`), the renderer's `TodoList.tsx` (App's `lazy`, dialog `'todos'`, the
rail's To-dos, `RAIL_MORE`'s first, ⌘K): `SpecEditor`, a new list one `checkListItem`, saved 600 ms after a change and
as it unmounts, no files; the head's *n of m done* from its Markdown (`doneOf`). `daemon/notes.ts`: one list for every project, `<data>/notes/<id>.json` (`Note`: title, `color` of
`TAB_COLORS`, `pinned`, BlockNote's `blocks`, `md`: their Markdown, `created`, `at`), pasted files in `<data>/notes/<id>/`
(`noteUpload`: `files/<name>`, `-2` when taken; `noteFile`: an image as a data URL). `noteList` (`q`: every word in its
title or `md`) gives `NoteItem`s, pinned first, then `at` (a title or text change; a pin or a color doesn't), each a
`preview` (`plain`: Markdown's marks out). The renderer's `Notes.tsx` (App's `lazy`, dialog `{ note: id ('': the
first) }`, the rail's Notes and ⌘K; `listOff`): `Page` with the list (`.notes-side`: search, `.notes-dot` color filter,
`.note-row`s, a right click: pin, color, delete) and `NoteEdit` (title, color, pin, delete; Specs' `SpecEditor`, saved
600 ms after a change and as it unmounts). Tested in `test/notes.test.ts`.
