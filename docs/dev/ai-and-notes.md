# Laki AI, Specs & Brainstorms, Notes: how they work

### Laki AI

`daemon/ai.ts` (`settings.ai`, `AiSettings`; on unless `on` is false, `aiOn`): a conversation that works Laki with `shared/tools.ts`'s
`tools(rpc)`, given the daemon's own `call` (no HTTP), less `laki_progress`: nothing archives, deletes, ships or merges;
with `settings.ai.skill` unset or true, Laki's skill: `shared/tools.ts` `skillTools` (`laki_ask`, `laki_remove`: `aiQuestion` names it from state, `whatOf`; `aiAnswer` refuses a question with an ask of yours after it,
`laki_stop` (Q12: an agent tab's turn, Esc through `input`, only while it runs), `laki_archive` (Q12: an `aiQuestion` act
`archive`, a worktree workspace only; its Yes, `archiveAct`: `wsArchive` `ifClean` first, refused when ignored files or a
submodule's work would go (the sidebar's ask names them), else archived with its uncommitted files kept, R2; a gate's
hold said), `laki_delete` (Q13: an `aiQuestion` act `delete`, `wsPeek`'s uncommitted and unpushed counts as its `text`,
Laki's words only; Yes: `wsRm`), `laki_open_in` (`openIn`: editor, finder, terminal, default), Q14's (below), `laki_ui` (`uiDo`),
`laki_find` (`findSessions`, pure: the user's words scored over name 5, branch 3, group, project, tabs and the PR's
title 2, the last answer 1, a word a letter or two off half; no words: the last at work first; `unsure` when the top
two are within a point: the skill has it ask), `laki_run`'s `tabs` (`runMany`: agents get it as a message each, the
shells at their prompt one `run` act with `ids`; `runAct` runs each, one that can't said; `ranShown`: the first tab
shown unless `ai.show` is false, each one's last 14 lines in the chat after `SHOWN_MS`), `laki_actions` without a
project (the global ones and each project's own), `laki_state`'s `created` and `active` per workspace,
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
Q14: several in one question, and more of the Mac.
- `aiQuestion`'s `act.items` (`AiItem`: `id`, `label`, `note` a workspace's PR and state from `prs`, `text` a delete's
  loss, `said`; `MANY`'s kinds, `AI_ITEMS` 50): `laki_archive`, `laki_delete` and `laki_remove` take `ids` (tools.ts
  `several`; a delete's `wsLose` per id, one after another, the state read once; more than `AI_ITEMS`: the first, and
  the note says how many are left; one that can't be asked about, gone, archived, a project's own folder, is left out
  and named in the note). A second ask of the same kind in the same turn (a model that calls once per
  workspace) is added to the open question, which moves last. `askText` keeps the list in the message too (the model's
  history, the CLI); Ai.tsx `Message` draws the text's first paragraph and a box per item (`.ai-items`; All, None past 3),
  the Yes relabelled by the ticked count, and sends `aiAnswer`'s `only`. `answerMany`: the ticked ones one after another
  (`doOne`: a delete looks at `wsLose` again and refuses one with more of any kind to lose than shown, `loseParts`; less
  goes; archive is `archiveAct`), each item's `said` as it comes (`…` meanwhile; a daemon that ended in the middle:
  `thread` says *not done: Laki quit meanwhile* on the rest), then one answer (*Deleted 2: …*, the ones still there with why, *Kept n*).
  The chat is at work (`busy`) until the last one: Stop (`aiStop`) ends it between two (*not deleted: stopped* on the
  rest), no ask or new chat comes in between, and what's sent meanwhile waits and goes after (`drain`, aiAsk's too). A
  merged question past `AI_ITEMS` says how many didn't fit.
- A question with an `act` no longer closes at your next ask (`aiAnswer`'s "a newer ask came since" is for a pick that
  goes back to the model; Ai.tsx `openAsks`, the three chats'): each is checked against what's there at its Yes.
- `laki_find`: `pr` (merged, open, closed, none, any); a filter and no words lists every match (`FIND_MAX` 50), a line
  each past 12 (`agents` in words, no tabs) within its `max` 12000; `more` says what isn't listed exists (and, past
  `FIND_MAX`, that a narrower filter reaches it: no `last` does).
- `laki_screenshot` (`aiShot`, only while an ask works, macOS): an app's window or the simulator through device.ts
  `device`, the whole main display (`screenShot`, `screencapture -x -m`) only when the user's last message asks to see
  it (`SHOT_SAID` in `userSaid`: screen, display, desktop, monitor, capture) or Your instructions name it (`of`: screen,
  my screen, desktop…), an app's window only when they name that app or ask to look (`LOOK_SAID`: look, window, show
  me; else the model asks first, `laki_ask`), the simulator any time; never in an
  agent's chat (its "user" is the agent); an agent's own call is its own chat's (main.ts, `FROM`); `REMOTE_NO`, as `device` is (apps' windows; `aiOpenApp` too). Kept in `images/`, said in the chat with the picture (`Message`
  draws an answer's `images`) by the app's name alone (its window's title, a page's own words, is only in the tool's
  result), and `openrouter` adds a user message with it after the round's tool results (`t.shots`); a round refused
  with it (a model that takes no pictures) goes once more with a line saying so in its place (`shot`).
  ponytail: a CLI backend gets the path (claude's Read asks for it outside its folder).
- `laki_open_app` (`aiOpenApp`, only while an ask works, macOS): `open [-a <name>] [<http(s) url>]`, the name a plain
  one, the address only of a site the user named (its host whole among the hosts in `userSaid`: t.co isn't in
  reddit.com) or localhost, no user in it, and opened as node read it (`href`): what Laki AI read in a tab or a
  PR can't send it elsewhere. ponytail: a named site's own path and query are the model's. `laki_script`: `run` (`runDev`: the dev tab, or test, lint, format, setup; never deploy,
  which the app asks about first). `laki_restore`: the archived
  ones, or `wsRestore`.
- `laki_help` (`aiHelp`): shared/help.ts `helpParts` cuts `docs/guide.md` and `docs/features.md` (in the app:
  package.json's `files`) into paragraphs and list items under their headings; `helpFind` ranks them by the question's
  words (two letters and up, a short one like PR or ⌘K matched whole; an item's bold lead most, then how thick), a long one cut to its sentences (`snip`), 7 KB at most. `SKILL`
  opens with how Laki is laid out (projects, workspaces, tabs, the path to a PR) and tells it to look there first.
  Tested in `test/help.test.ts` and `test/ai.test.ts`.
- `openrouter`: `POST <api>/chat/completions` (`LAKI_AI_API`: tests' fake, localhost only) with the tools as functions
  and `usage: { include: true }` (its `cost`), looping over `tool_calls` up to `steps` rounds (`AI_STEPS`, 20). Each
  round streams (A7, `stream: true`; `roundOf`): its SSE lines (keep-alive comments skipped) build the message as it
  comes, the text, the tool calls by `index` (their `arguments` in pieces), `reasoning` and `reasoning_details` (pieces
  of one joined), the model and the usage (the last chunk's); the text so far goes to the page as `ev: 'ai'`
  `{ of, partial }` (10 a second at most; no `chat`: the other `ai` listeners skip it), drawn under the chat until the
  message comes. A JSON reply (an error, one that doesn't stream) is read whole. The 2 minutes are a quiet limit, reset
  by each chunk (`QUIET_MS`, `LAKI_AI_QUIET_MS`: tests'), not a total; `aiStop` aborts the stream; the
  earlier asks and answers go with each ask (`history`, A8: `earlier`'s whole turns, newest first, while they fit
  `HISTORY_CHARS`, 60 KB, the newest always), never the tools' calls or results; the turns left out go as one more
  system message (`leftOut`: each ask's and answer's first 140 characters, 1,500 in all, no model asked); `seenFrom` (in `aiState` and the `ai`
  event, OpenRouter's only) is the first message it still sees, where the page draws *Laki AI sees the chat from here
  on* with New chat. What's stored and shown is the same. A pasted image (only from
  `<data>/images`, `imageOk`: nothing else of the Mac goes to a model) as a data URL. The key: the Keychain or `<data>/ai-key`, 0600
  (`aiKey`; keychain.ts, below), never in state.json, the view or `aiState` (only whether there is one). Model: `models.openrouter`, else
  `AI_MODEL`. Prompt caching (A3): an `anthropic/*` model (`cachesByMark`) caches only up to a `cache_control`
  breakpoint, so its last tool definition and its system prompt (sent as one text part) each carry
  `{ type: 'ephemeral' }`: the tools and instructions are read back from the cache each round and on the next ask
  within 5 minutes. With history, the system prompt's breakpoint rolls to the last message before the ask (a text part
  with it: the tool rounds and the next ask read the whole chat back), two breakpoints at most; Your endpoint gets none.
  Other models cache on their own: their request is unchanged;
- `claude`: `claude -p --output-format stream-json --verbose --mcp-config <laki mcp, LAKI_HOME> --strict-mcp-config
  --tools Read --allowedTools mcp__laki --permission-prompt-tool mcp__laki__laki_permission --append-system-prompt …`
  (a Read outside its folder: `laki mcp`'s `laki_permission`, `LAKI_AI_PERM` only (claude's), waits on `aiPermission`: a chat message
  with `ask.perm`, `AI_PERM`'s buttons, live while it works (`Message`); `aiAnswer` resolves it, *Always in this chat* keeps
  the tool in the thread's `allowed` until `fresh`; none in `PERM_WAIT` or the ask's end: deny), `--resume` its `session_id` the next time; cost:
  the result's `total_cost_usd`; `ai.efforts` (`effortArgs`, `EFFORTS`; `aiOnce` too): claude's `--effort`, codex's
  `-c model_reasoning_effort`;
- `codex`: `codex exec [resume <thread>] --json --skip-git-repo-check --ignore-user-config (its MCP servers) -c sandbox_mode="read-only"
  -c developer_instructions=… -c mcp_servers.laki.{command,args,env,tool_timeout_sec}`, `-i` per image; no cost.
  S13: nothing in argv carries a tab's token (any process of yours reads argv with `ps`): claude's `--mcp-config` (the
  chat's, and `aiOnce`'s `laki_ask`) is the path of a 0600 JSON file, codex's `env` has `LAKI_TAB_TOKEN_FILE`, a 0600
  file `laki mcp` reads as it starts (unreadable: it exits, never your token); both `secretFile`s in `<data>/ai-run`
  (out of `home`, claude's cwd, whose Read takes it unasked), removed as the child ends, the folder emptied at a daemon's first;
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
sessions; `<data>/ai-calls.jsonl` a line per ask (`AiCall`: tokens, `cachedIn` (of them, read from the prompt cache: usage's `prompt_tokens_details.cached_tokens`, the Calls tab's and `laki ai log`'s *cached*), cost, tools, ms, ok, error, `from`: what made it, `AI_FROM`'s (a chat by its thread: the AI page's, a spec's, an agent's
`agent:`, an extension's `widget:`; `aiComplete`'s `from`, workflows' blocks and `aiDecide`; else `aiFromOf` by the ask's
words: `extension `, `Compact …memory`, `next prompt: `, `side chat: `, `check review: `, *Ask me first*, *Explain an ask*), which the
Calls tab shows and `aiUsage` (the Usage page's Laki AI rows, by day, from and model, both logs read off the event
loop) sums; a failed ask keeps what
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
600 ms after a change and as it unmounts). `noteRm` moves a note to the trash, as workflows go: `<data>/trash/notes/<id>-<ms>/`
(its `<id>.json` and its files' `<id>/`); `noteRestore` (`note.restore`; AGENT_NO, ANSWER_NO, as `noteSave`) moves the
newest of it back, refused while a note of that id is there; `noteTrashTidy` removes one past 30 days as a note goes, at
start and hourly with `flowTrashTidy`. The page's Delete gives App's toast with Undo (`NotesApi.undo`, the `note.restore`
cap). Tested in `test/notes.test.ts`.

## Your endpoint

Settings › AI › Runs with: Your endpoint (`ai.backend: 'endpoint'`, `settings.aiEndpoint`: `{ url, model }`). ai.ts
`target()` picks where a chat-completions call goes: OpenRouter (`api()`, the `ai-key` file, its model) or the endpoint
(`types.ts` `endpointOk`: https anywhere, http only for localhost, 127.0.0.1 and [::1], no user or password, no ? or #;
core's settingsSet checks it and drops the trailing /; its key the Keychain's `endpoint` or `<data>/ai-endpoint-key`, 0600, `aiEndpointKey`, none for a
local server: no Authorization header). The same loop (`openrouter()`) and `aiComplete` (workflows' AI call blocks,
memory's compaction, aiOnce) go there; OpenRouter's own parts stay out: no cache_control marks, no `usage.include` (the
standard `stream_options.include_usage` instead), no x-title, no cost (the call log's `cost` unset: not priced). Voice
and the decision blocks stay OpenRouter's. `aiEndpointTest`: one short ask, its answer (Settings' Test). Both methods are
the user's only (gates.ts AGENT_NO, REMOTE_NO; main.ts FROM, ANSWER_NO), as `aiEndpoint` is (AGENT_SETTINGS_NO, REMOTE_KEYS); a
managed policy locks it like any setting. `aiState`'s `endpointKey`: whether a key is kept, never the key.

Ask me first (`promptQuestions`, ai.ts): New workspace's ? (⌥⏎, keys.ts `askFirst`; panels.tsx NewWorkspace). One
`aiOnce` (`ask: 'Ask me first'`, json, logged and costed like any) with the task (8,000 characters) and the project's
memory (both lists, 4,000), each between `<<<` `>>>` as data, the system prompt saying so. `questionsOf` keeps the
first JSON object's `questions`: at most 3 (`ASK_FIRST`), each `q` 140 characters and 2 to 4 distinct choices of 60
(longer ones cut with …), anything else dropped; junk is `[]`. Never automatic. The user's and remote access's (FROM,
ANSWER_NO, REMOTE_OK); agents and trusted clients refused (AGENT_NO; CLIENT_SCOPE has no class for it). The page's picks
go after the prompt as `Answers:` lines as it's made (`submit`); *You decide* adds none.

Improve my prompt (`promptImprove { prompt, tab?, project? }`, ai.ts; Improve.tsx `useImprove`, the ✨ in PromptInput
(the New workspace page passes `improve`) and the Reader's box (ReaderApi's `improve`)): one `aiOnce` (`ask: 'Improve
prompt'`, no tools) with the draft (8,000 characters), the tab's chat since its last New session (the Reader's `chatRead`,
the newest 12,000 characters) and the project's memory (4,000), each between `<<<` `>>>` as data (`shared/improve.ts`
`IMPROVE_SYSTEM`). A new task (no tab: the New workspace page) adds a fourth, *The project's files*: `git ls-files` in
the project (core's `exec`: an SSH host's too; 5 s, none when it fails) as `treeOf`'s outline in 4,000 characters (every
top-level entry, a folder as `src/daemon/ (64 files)`, the rule files and manifests wherever they are, then deeper
folders and files while they fit, shallowest first): file names only. The system prompt names only paths in the chat,
the memory or that block; the answer's paths aren't checked against it (one may not exist yet). `improvedOf` takes fences and quotes off and puts back on a last line any of the draft's @mentions,
links, code spans, `{{variables}}` and #numbers the answer dropped. The box's text is replaced by `execCommand('insertText')`,
so ⌘Z undoes it; editing the box while it runs, a second click or Esc cancels (its answer is dropped). The user's and
remote access's, never an agent's or a client's (as Ask me first).

Walk through (`reviewSteps { ws, uncommitted?, again?, kept? }`, ai.ts, R13): the Review tab's steps by one `aiOnce`
(`ask: 'Walk through'`), the user's and remote access's at the answer level, never an agent's (gates.ts `AGENT_NO`: it
spends the user's Laki AI) nor a trusted client's (no scope has it). The model reads 200 KB of whole hunks
(`walkInput`): the big ones last (a lockfile, a hunk over a quarter of that), one that doesn't fit skipped rather than the end of
the read, so a new `package-lock.json` before `src/` no longer hides the code; the skipped are named by file and line
count in the prompt, left to *Everything else* (`walkFold`'s `unread`) and counted (`Walk.skipped`, the tab's *N
changes Laki AI did not read*). The kept walk's hash starts `walk 2` (1: the input that stopped at the first big hunk,
asked anew). `docs/dev/renderer.md` has the rest.

Explain an ask (`askExplain { tab }`, ai.ts): the ? on a command ask and E on its card (Diff.tsx `useExplain`: the ask
bar's `AskWrap`, the Reader's card, Needs you's; the cards on screen through main's `ask-explain`, a card `explain` when
App's notify says so). Claude's Bash asks only (`perm.tool === 'Bash'`: a codex or agy menu names no tool); an Edit
or Write is refused (its diff shows it). The command is core's `permCmd` (the PermissionRequest's whole command, 2,000
characters, kept beside `perm` and cleared with it, with `permCut` when it was longer; `perm.what` is a 300-character
line), else `what` (cut when it ends with the … `ask.ts`' `cut` adds). Cut: a line after the command says so (*The
command was cut at 2,000 characters; the rest is not shown.*), and the answer comes back with `cut: true` and `undo`
`partly` unless it said `no` (the renderer's and the card's *Not the whole command was read*, in the danger color). One `aiOnce`
(`ask: 'Explain an ask'`, json; `AI_FROM`'s `explain`) with the command between `<<<` `>>>` and the workspace's folder
name and branch; the system prompt says the command is data and asks for no advice. `explainOf` keeps `does` (a
sentence, cut at 160), `outside` only when `true`, `undo` `yes` or `no`, else `partly`; junk is an error. Kept per
sha256 of the workspace's folder name, a NUL and the command (and whether it was cut: `outside` depends on the
folder) for the daemon's life (the promise: a second click meanwhile waits for the same call; a failure
is dropped; 500 at most). Never automatic, never read by auto-answer rules (`allowRuleOf` sees the ask only), the
choices' order and focus untouched. The user's and remote access's at the answer level (FROM, ANSWER, REMOTE_OK);
agents refused (AGENT_NO), trusted clients too (no CLIENT_SCOPE). `ask.explain` cap (API 217); the renderer shows the ?
only with it and Laki AI on. `test/ai.test.ts`.

### Keys in the Keychain (`keychain.ts`)

`keyRead(name, path)` and `keyWrite(name, path, key)` keep Laki AI's two keys (`openrouter`, `endpoint`): in the macOS
Keychain (service *Laki AI*, account the name) when `keychainOn()` (darwin, not a test's, the data folder `~/.laki` or `~/.laki-electron` whatever `LAKI_HOME`
says (Laki's own launcher and tabs set it to that), and `codesign -dv` on
`process.execPath` says *Developer ID Application*, once; a test's daemon: `LAKI_KEYCHAIN=1` and the `security` on its
PATH), else their 0600 files. `/usr/bin/security`, 5 s per call: `find-generic-password -w` (44: none),
`delete-generic-password`, and a write as `security -i` with `add-generic-password -U … -w "<key>"` on its stdin (quotes
and backslashes escaped; a name or key with `\r`, `\n` or a NUL never: `-i` takes a command a line, the rest would run
as another command, so `kcSet` is false and the file keeps it), then read back. A file's write is `writeAtomic`. Also
`widget-secrets` (widgets.ts `readSecrets`/`setSecrets`: every extension's secret settings as one JSON, its file
`<data>/widget-secrets.json`). A file there is the key to keep (not moved yet, or written when the Keychain
failed): moved in when it reads back equal, then removed; else the file is used. Read once, then kept in memory; a
read the Keychain didn't answer is asked again after a minute.
`keysWhere()` is the diagnostics' *Keys and secret values* line: the Keychain, a key *in file* with why, or files, by
name (never a value). aiKey's API and the view are as before (the view only says whether there's a key).
`test/fakes/keychain-security` fakes `security` (`test/ai.test.ts`, `test/env-keys.test.ts` link it as `$HOME/bin/security`).

**Secret values out of state.json** (`envKeys.ts`, STATE_V 2): a secret-looking variable (env.ts `secretLooking`), or a
value that is one whatever its name (env.ts `secretValue`: `URL_CREDS`, a URL with a password like `DATABASE_URL`, or
secrets.ts' `secretsIn` shapes; a null already kept, or one the store has or couldn't give, stays its) in
Settings' env, a profile's, a project's or one of its MCP servers', and the phone push's URL and reply topic, kept the
same way (account `env:<NAME>`, `env:profile:<name>:<NAME>`, `env:project:<id>:<NAME>`,
`env:project:<id>:mcp:<server>:<NAME>`, `push:url`, `push:replyTopic`; without the Keychain a 0600 file each in
`<data>/env-keys`, named by the account's hash). state.json keeps the name with `null`. In memory the state is whole,
so childEnv, scripts, ai.ts and the rest read it as before: `load()` fills each null from the store (`envRestore`; one
the store didn't give: `''` in memory, still null on disk, never removed, until set again or read: `envRetry`, core's
`envAgain` as an app window connects or comes to the front, `LAKI_ENV_AGAIN_MS` apart (a minute), keychain.ts asking
again past `LAKI_KEYCHAIN_RETRY_MS`; the view's `envUnread` counts the ones still missing), `save()` stores what's new
or changed and removes what's gone (`envStash`: a `security` call only on a change), then writes the copy with them
null (`envJson`). A value still in state.json (v1, a restored older backup) moves in as it loads, then state.json and
its dated copies are saved without it at once (`scrubCopies`). `laki backup` writes the same copy; its manifest's
`secrets` names them and says the values stay in this Mac's Keychain (on another Mac: set each again). A diagnostics
bundle and the logs never have a value (`keysWhere`'s names), the view only in your own window (main.ts' `masked`).

**The queue** (ai.ts `Queued`): what you send while an ask works waits on its chat and goes as the answer ends (`drain`, its sender's rpc). The Mac's (`aiHooks.local`, main.ts' `localAi`) are kept in the chat's file as `queued` (text, images, context; never the rpc) and go as it loads again (`thread`'s load; `aiResume` for the AI page's chat as the daemon starts; another chat as it's opened); shutdown's `aiStop({ quit })` leaves them waiting (`drain` sends nothing then; an RPC's `aiStop` never sets `quit`). A phone's or Telegram's aren't kept: their gates end with their socket. `test/ai.test.ts`.
