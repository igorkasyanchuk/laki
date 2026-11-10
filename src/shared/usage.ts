// the CLI's help; the agent skill (daemon/skill.ts) quotes it too
export const USAGE = `laki: coding agents in parallel git worktrees

  laki help [command]                         this, or one command's details and examples (laki <command> --help too)
  laki version | --version                    this CLI's version; with a daemon running, its version and API too
  laki doctor [--json]                        what Laki needs, checked: git, gh, the agents, hooks; a fix for each (exit 1: one failed)
  laki open                                   open the app
  laki ls [--json]                            projects, workspaces, tabs and their status
  laki limits [--agent claude] [--json]       how much of each agent's plan is used, and when it resets
  laki project add <path|host:path> | ls | rm <id>   host:path: a folder over SSH (a ~/.ssh/config name or user@host)
  laki new <project|.> [--base b] [--preset claude|codex|gemini|grok|opencode|shell|none] [--cmd c] [--prompt text] [--name n] [--local]
            [--model opus|sonnet|…] [--effort low|medium|high|xhigh|max (claude), minimal…xhigh (codex)]
                                    opencode's: provider/model as \`opencode models\` lists it (an unknown one is refused)
            [--perm <mode>] [--fast]  its permission mode (auto, acceptEdits, plan, bypassPermissions: claude, codex) and fast mode
            [--sandbox|--no-sandbox]  the agent's own sandbox on or off over its profile's (claude, codex)
            [--template <name>]     the prompt through one of your prompt templates
            [--action <name>]       an agent action of yours (Run ▾) as its prompt, the prompt after it
            [--group <name>]        under that group of the project in the sidebar (its template and agent too)
            [--issue <url|number>]  a GitHub or GitLab (glab) issue's title and text as the prompt
            [--pr <url|number>]     a GitHub PR's branch (gh pr checkout, forks too), named pr-<n>-<title>
            [--link <url|number>]   the PR it's about (a review), not checked out: its PR, named after it; in a
                                    tab, a PR the prompt names is only related (its own PR is its PR)
            [--race claude,codex]   a race: the same prompt to each, a worktree each (Compare in the app); --fan too
            [--no-setup]            without the project's setup script (.worktreeinclude's files still copied)
            [--tab <agent[:model]|command>]   another tab there, again and again: an agent or profile (no prompt:
                                    laki send gives it one) or a command in a terminal tab (an agent's: asked in the
                                    app first); started now, so not with --at or --after-limit
            [--at <when>]           the workspace now, its agent later: tomorrow 9am, in 2h, 2026-10-20 14:30
            [--after-limit]         its agent once the plan limit resets (claude, codex)
  laki rm <ws> [--force] | archive <ws> [--force] | restore <ws> | fork <ws>
  laki rename <ws|.> <name> [--asked]         name a workspace (in a tab, . is its own); one you named: an agent only with --asked
  laki pr <ws|.> <url|number> | --detach      attach a GitHub PR to a workspace | detach its PR (only related, kept off)
  laki pr <ws|.> --draft | --ready            its PR back to a draft (it went ready too early) | ready for review
  laki memory [<project>|.]                   a project's memory: the user's, and what agents learned
  laki memory add <project>|. <text> [--mine] remember something lasting about it (an agent's; --mine: yours, not in an agent's tab)
  laki memory rm <project>|. <id>             forget one agents learned
  laki plan [<project>|.]                     the user's specs and brainstorms (kind, slug, title, folder)
  laki plan read <project>|. <kind> <slug> [file]   one's README.md and files, or one file's text (kind: spec, brainstorm)
  laki plan new <project>|. <kind> "<title>" [text|-]   write a new one for the user (text: its Markdown; -: stdin)
  laki plan write <project>|. <kind> <slug> <file> [text|-]   a file beside one (ideas.md, a prototype); never README.md
  laki preset [ls]                            the agent profiles (Settings › Agents & profiles), your default marked
  laki preset add|set <name> [--agent claude|codex|…|command] [--args "…"] [--model m] [--effort e] [--perm mode] [--fast] [--sandbox|--no-sandbox]
            [--cmd c] [--env KEY=value…] [--account id] [--name new]   a new profile, or change one ('' drops a field)
  laki preset on|off|rm <name>                show it in the pickers or not | delete it
  laki remind <when> <text> [--ws <id>|.] [--important]  a reminder on the calendar (Calendar): in 2h, tomorrow at 9am, every weekday at 9am; --important: a card on screen until closed
  laki alert <text> [--title t] [--choice A]…  an important card on the user's screen (over every app, until closed); with choices it waits and prints the pick
  laki notice <text> [--title t] [--choice A]… [--to <ws>[/<tab>]|@name]   a card in Laki's window (any page, until closed); Open goes to --to; choices as alert
  laki reminders [rm|done <id>]              the calendar's reminders
  laki tab <ws> [--preset p] [--cmd c] [--prompt text] [--name n] [--model m] [--effort e] [--perm mode] [--fast] [--sandbox|--no-sandbox]
                                              a new tab; with a prompt, its agent starts on it; an agent's --cmd: asked in the app first
  laki send <ws>[/<tab>]|@name [--when-idle] <text>   type text into an agent (now, or when its turn ends)
  laki name <name>                            in an agent's tab: its @name, for other agents' send and ask
  laki agents                                 the named agents, wherever they run
  laki ask <@name|ws[/tab]> <question> [--wait min]   ask another agent; prints its reply (15 minutes at most)
  laki wait <ws>[/<tab>]… [--timeout 20m] [--json]   until none of their agents works, then a line each: idle (its
                                              last answer) or waiting (what it asks); exit 0 all idle, 2 one waits, 3 timed out
  laki progress <0-100> [what you're on]      in an agent's tab: how far along its task is, shown on the tab
  laki update --when-idle [--off]             update Laki once no agent works or asks: the app, then its daemon
  laki secret <what it is>                    in an agent's tab: the user types a token on a masked card; prints only
                                              the path of a 0600 file that holds it (gone after 24 hours)
  laki show <text> [--open <folder|file|url>…] [--title t]   in a tab: a card under it in Laki, a button per --open
                                              (a folder in Finder, a file in its app, a page in the browser)
  laki screen <ws>[/<tab>] [--lines n]        the bottom of a tab's screen
  laki screen shot [app] | windows            a screenshot of the iOS Simulator, or of an app's window (its PNG's path)
  laki screen tap <x> <y> | swipe <x1> <y1> <x2> <y2> | type <text> | describe
                                              the simulator's hands, in points (needs idb); describe: its elements
  laki diff <ws> [--uncommitted] | run <ws> [test|lint|format|deploy|setup] | ship <ws> -m <message> [--title <t>] [--body <b>] [--draft] [--base <branch>] [--files a,b] [--force]
                                              diff: against its base (--uncommitted: only what isn't committed);
                                              run: the run script (a dev server), or that script in a tab of its own
  laki browser [<ws>] open [url|/path] | screenshot | click <css> | fill <css> <text> | text [--expect-url <url|/path>]
                                              a hidden browser on the workspace's localhost (the app must be open);
                                              screenshot prints a PNG's path; in a tab, <ws> is its own;
                                              --expect-url: refused, nothing done, unless it's on that page
  laki schedule [ls] | log                    scheduled tasks and their next runs | the last runs
  laki schedule add <project> --when "weekdays at 9am" [--preset p] [--where new|same|folder|folder-new|<ws>] [--fresh] [--base <branch>] [--no-setup] [--name n] <prompt>
                                              a prompt for an agent at those times; {{DD-MM-YY}} in the name or
                                              prompt is the run's date
  laki schedule on|off|run|archive|restore|rm <id>  turn one on or off, run it now, archive or restore it, delete it
  laki flow [ls]                             workflows and their runs
  laki flow run <workflow> [project] <task> [--ws <ws|.>] [--dry] [--set name=value…] [--budget "30 min, $2"]  start a run (--ws: in a workspace you have, no new worktree; --dry: a PR, approve, merge said, not done; --set: its inputs; --budget: its working time and AI cost, past either it asks)
  laki flow run <workflow> [project] --event [<name>] [--event-json <file|->] [--ws <ws|.>] [--dry]  as if on an event (its on: unless named; the last one heard, else a sample in --ws; --dry: its variables and only when: tests first)
  laki flow again <run> [--from <block>]     an ended run again (its task and inputs); --from: in its workspace, its state kept, from that block
  laki flow show|stop <run> | answer <run> <n> [words]  a run's decisions | stop it | answer what it asks
  laki flow pause|resume <run>               pause after the block it's on (no next block starts) | go on from there
  laki flow on <workflow> [project]           turn on again one paused after 5 failed runs in a row (events and its schedules start it again)
  laki flow trash | restore <trash-id>        the workflows deleted in the last 30 days | put one back
  laki flow check [file.md… | folder]        check workflow files, no daemon (none given: ./.laki/workflows); exit 1 on a problem
  laki widget [ls] | reload                   the sidebar's extensions | read their folders again and fetch (laki ext: the same, every widget command)
  laki widget on|off|run <id> [--ws <ws>]     show or hide one | run its fetch now (--ws: a per-workspace one's); only you turn one on
  laki widget what <id> [--full <file>]       what turning it on runs, and its files' hash; --full: a file it cut, whole
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
  laki widget remix <id> [new-id]            a copy of one (a repo's too) to change: yours, off
  laki widget trash | restore <trash-id>      the extensions deleted in the last 30 days | put one back
  laki ai [--image png] <ask> | new | log     ask Laki's AI (Settings › AI) to work Laki: "what are my agents doing?",
                                              "review the 3 PRs in this screenshot" | a new conversation | its calls
                                              and cost; laki ai alone: the conversation
  laki mcp                                    Laki as an MCP server (stdio): claude mcp add laki -- laki mcp
  laki daemon | stop [--keep]                 run the daemon in the foreground | stop it (--keep: the pty host's terminals go on)
  laki serve --tailscale [--pin | --funnel] | --cloudflare --mail <you@x.com> | --cloudflare --pin | --cloudflare --open --hours <n ≤ 24>  [--hours n]
                                              headless: the daemon and remote access, until stopped (docs/headless.md);
                                              its link opens once, its PIN prints on a terminal only (else laki remote)
  laki remote [stop]                          remote access's link and PIN now | stop it
  --json prints machine-readable output; an option the command doesn't have is refused (did you mean…?);
  after -- every word is text: laki send ws -- --not-an-option`


// A4: each command's options, read off its lines of USAGE (a line that names more, \`rm <ws> … | archive <ws>\`, gives
// each its own), --json and --help everywhere: the CLI refuses any other --word before a command's text
export const FLAGS: Record<string, Set<string>> = (() => {
  const m: Record<string, Set<string>> = {}
  let cur: string[] = []
  for (const line of USAGE.split('\n')) {
    const c = /^  laki ([a-z]+)/.exec(line)
    if (c) cur = [c[1], ...[...line.matchAll(/\| ([a-z]+) [<[]/g)].map(x => x[1])]
    else if (!/^\s{6,}/.test(line)) cur = []
    for (const k of cur) {
      m[k] ??= new Set(['--json', '--help'])
      for (const [f] of line.matchAll(/--[a-z][\w-]*/g)) m[k].add(f)
    }
  }
  return m
})()
// the closest of a command's options to a mistyped one (edit distance 3 at most), for the error's hint
export function nearFlag(cmd: string, typed: string) {
  const d = (a: string, b: string) => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const next = [i]
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      row = next
    }
    return row[b.length]
  }
  const best = [...(FLAGS[cmd] ?? [])].map(f => [f, d(typed, f)] as const).sort((x, y) => x[1] - y[1])[0]
  return best && best[1] <= 3 ? best[0] : undefined
}

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
  laki new shop --race claude,codex --prompt "…"       a race: one worktree each
  laki new shop --no-setup --perm acceptEdits --fast --prompt "…"   no setup script; edits without asking, fast
  laki new . --name api --prompt "…" --tab codex --tab "npm run dev"   a worker with a second agent and its dev server
  laki new shop --group Reviews --template review --prompt "#118"   under Reviews, through your review template
  laki new shop --action "PR+audit" --prompt "the login page"        your agent action's prompt, then these words`,
  send: `Types text into a tab and presses Enter. <ws> alone is its first agent tab; <ws>/<tab> by the tab's id, name or
number. --when-idle queues it for when the agent's turn ends (it's sent at once if it's idle). Options go before the
text; a text that starts with -- goes after --: laki send a1b2 -- --flag is the text. While the agent asks
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
  wait: `Waits until none of the named workspaces' agent tabs is working (<ws>/<tab>: that tab), a look every 3 seconds,
then prints a line each: idle with the first line of its last answer, or waiting with what it asks. Exit 0: all idle;
2: one waits for the user (answer it, or tell the user); 3: --timeout (default 20m: 90s, 20m, 1h) ran out, some still
run (wait again). Instead of a loop over laki ls --json. MCP's laki_wait does the same, 4.5 minutes a call.

  laki send a1b2 "Now add tests for it" && laki wait a1b2
  laki wait a1b2 c3d4 --timeout 1h           both workspaces' agents
  laki wait a1b2/codex --json                 that tab only; JSON: { tabs, waiting, timedOut }`,
  version: `Prints this CLI's version (no daemon started). With a daemon running, its version and API number too, and a
note when it isn't this CLI's (the app's status bar restarts it: tabs resume).

  laki --version`,
  doctor: `Checks what Laki needs and says what to do about each: git, gh (signed in; its codespace scope for cloud
workspaces), cloudflared (remote access, Expose to the world), idb (the simulator's hands), each agent (found, signed
in) and Laki's hooks (they reach the daemon). ✓ fine, ● optional or worth a look, ✗ broken: exit 1.

  laki doctor
  laki doctor --json                          the daemon's doctor as it is`,
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
  limits: `Prints each signed-in account of Claude, Codex and Gemini: its 5-hour, weekly or per-model use and when each resets. Read only, from the numbers Laki keeps for the status bar (no extra requests). An agent whose numbers can't be read says why on its own line; the others still come back. Look before a long task: pick the account or agent with room left, or wait for a reset.\n\nExample:\n  laki limits --agent codex --json`,
  secret: `In an agent's tab: ask the user for a secret (an API key, a token, a password) without it going into the chat.
They type it on a masked card under your tab; you get only the path of a 0600 file in $LAKI_STORAGE_FOLDER that holds
it (deleted after 24 hours). Read it where it's used, never print it: KEY=$(cat "$path"). Waits up to 15 minutes;
exits 1 if they refuse.

  path=$(laki secret "Stripe test key") && STRIPE_KEY=$(cat "$path") npm test`,
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
  plan: `The user's specs (what to build) and brainstorms (ideas to explore): each a folder outside the repo with README.md
(the user's text, never written here) and the files beside it. . is this tab's project. read prints README.md and the
files' names, or one file's text; new writes one for the user to edit in Laki; write puts a file beside one (ideas.md,
prototype-<option>.html, <name>.diagram.json). Text from - (or none, for write) is read from stdin.

  laki plan .
  laki plan read . brainstorm onboarding
  laki plan new . spec "CSV export" - < spec.md
  laki plan write . brainstorm onboarding ideas.md - < ideas.md`,
  preset: `Agent profiles (presets): how a tab's agent starts (its agent, args, model, effort, permission mode, fast
mode, sandbox, env, account). laki new --preset <name> and laki tab --preset start one. From an agent's tab, add, set, on, off
and rm ask the user in the app first (its args and env run in every tab of it), and need the app open.
--sandbox (Claude Code, Codex): the agent's own sandbox, its commands writing only in the worktree and the repo's git
folder; Codex's network stays on, Claude Code runs laki outside it. Not with bypass permissions, which turns it off.

  laki preset ls
  laki preset add claude-ask --agent claude --perm auto
  laki preset set claude-ask --model opus --effort high
  laki preset set claude-ask --args ''           drop its args
  laki preset off codex                          out of the pickers, its tabs still start`,
  rename: `Names a workspace (the sidebar's row). . is this tab's. A name the user gave it (a rename, or typed as it was
  made) stays: an agent's rename is refused, unless the user asked for it (--asked).

  laki rename . csv-export
  laki rename . "login redirect" --asked     the user asked for this name`,
  pr: `Attaches a GitHub PR to a workspace, so its status and checks show on it: one opened on another branch or in
another repo (a PR of the workspace's own branch shows by itself once pushed). Run it right after gh pr create.

  laki pr . https://github.com/acme/shop/pull/118
  laki pr . --draft                       back to a draft: it went ready too early
  laki pr . --ready                       ready for review`,
  browser: `A hidden browser on the workspace's localhost (the app must be open): open loads a path on its $PORT (laki run
starts the dev server) or a localhost URL; screenshot prints a PNG's path; click and fill take a CSS selector; text
prints the page's text. Open, click and fill print what they caused: → <url> when the page moved, blocked: (a popup
or a link off localhost), console error: lines, and the text lines added (+) and gone (-), or (no changes). In a tab,
<ws> is its own. --expect-url <url|/path> on click, fill, text or screenshot: the page it's meant for (that address,
or one under it); on any other page it's refused and nothing is done, so a page that moved meanwhile isn't typed into.

  laki browser open /settings
  laki browser fill "#email" "a@b.co" --expect-url /login
  laki browser click "button[type=submit]"
  laki browser screenshot`,
  diff: `Prints the workspace's changes against its base (what ship would put in a PR).`,
  archive: `Archives the workspace: its worktree goes, its branch stays (laki restore brings it back). With uncommitted work it stops and exits 1: commit first (--force archives anyway, the uncommitted files kept for restore; local projects). An extension's gate may hold it: the reasons are printed and it exits 1; --force does it anyway (the user only: refused in an agent's tab).

  laki archive a1b2`,
  run: `Starts the project's run script (a dev server, on $PORT) in a tab of its own, or test, lint, format or deploy
(the project's scripts) in theirs, or setup (the setup script: a worktree made with --no-setup, or again). A repo's
.laki.json runs nothing until the user trusts it in the app: it says so.

  laki run a1b2
  laki run a1b2 test`,
  ship: `Commits the workspace's changes with the message, pushes the branch and opens a PR (gh). Nothing uncommitted and no commit its base doesn't have: refused, nothing to ship. A fork with no gh repo set-default: the PR opens on origin's repo. An extension's gate may hold it: the reasons are printed and it exits 1; --force does it anyway (the user only: refused in an agent's tab). --title and --body: the PR's (else gh's --fill, from the commits); --draft: a draft PR; --base: the PR's base branch; --files: only those changed files are committed (paths in the worktree, comma-separated), the rest stay uncommitted.

  laki ship a1b2 -m "Add CSV export"
  laki ship a1b2 -m "Add CSV export" --title "CSV export" --body "Adds Export ▾ › CSV" --draft
  laki ship a1b2 -m "Fix the parser" --files src/parse.ts,test/parse.test.ts`,
  schedule: `A prompt for an agent at the times a line of English says, while the Mac is awake (a run more than 30 minutes
late is skipped). --where: new (a worktree each run), same (a worktree its first run makes, every run after
there), folder, folder-new, or a workspace id (its agent gets it). --fresh: a run into a workspace it shares
(same, folder, an id) starts a new agent tab there instead of telling the agent it has.
--base: the branch a new worktree starts off (new, and same's; gone when it runs: that run fails and says so).
--no-setup: each new worktree without the project's setup script (new, and same's).
{{DD-MM-YY}} in the name or prompt is the run's date. From an agent's tab it's saved off: on and run are the user's.

  laki schedule add shop --when "weekdays at 9am" "Triage the new issues"
  laki schedule add shop --when "fridays at 5pm" --base release/2.0 "Backport this week's fixes"
  laki schedule add shop --when "every 2 hours from 9am to 6pm" --where a1b2 "Check CI"
  laki schedule log`,
  alert: `An important card on the user's screen (bottom right, over every app and Space, until they close it), only
when they ask for one ("show me an important alert", "ask me with a Laki alert") or their instructions (CLAUDE.md,
AGENTS.md) say when; never for routine news (a PR reviewed, tests passing, a task done: Laki shows those itself).
Its text is Markdown: links open in the browser. With --choice (up to 6) it waits for
their pick and prints it; closed without one, or no answer in 30 minutes: exit 1 (give your shell tool its longest
timeout, as that's longer than most allow by default; MCP's laki_alert waits the same). Without choices it shows and returns.

  laki alert "Tests pass on fix-login" --title "Ready"
  laki alert "Deploy to production now?" --choice Deploy --choice "Not yet"`,
  notice: `A card for the user inside Laki's window (bottom right, over whatever page is open, until they close it; kept
while the app is closed, it shows when it opens): news they should see in Laki but not worth a card over every app,
such as a message about another session. --to names that session (<workspace>[/<tab>] or @name; default yours): the
card's Open goes there. With --choice (up to 6) it waits for their pick and prints it, as laki alert does (exit 1:
closed or no answer in 30 minutes; MCP's laki_notice waits the same). Without choices it shows and returns.

  laki notice "fix-login is ready for review" --to fix-login
  laki notice "The API changed under fix-login: rebase it?" --to @api --choice Rebase --choice Later`,
  remind: `A reminder for the user on Laki's calendar (Calendar), only when they ask for one. --ws . ties it to
this workspace. Words that repeat (every, daily, weekdays, mondays) make it ring each time. --important, when the user
says it matters: it rings as a card on screen, over every app, until they close it.

  laki remind "tomorrow at 9am" Check the deploy --ws .
  laki remind "every weekday at 9:30" Standup
  laki remind "in 30m" Call the bank --important`,
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

  laki widget set prs --place desk --size 3x2      a tile on My Desk, 3 cells across, 2 down
  laki widget set prs --every 10 repo=acme/api      fetch every 10 minutes, its repo setting
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
