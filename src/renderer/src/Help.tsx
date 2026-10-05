// Help (⌘/, the ? at the top of the sidebar, or ⌘K): the keys, the status glyphs, where things are and the
// CLI's main commands, on a page like Settings. cli: the app's command.
import type { ReactNode } from 'react'
import { Glyph } from './Glyph'
import { Icon, Page } from './ui'

const KEYS: [string, string][] = [
  ['⌘O', 'open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it'],
  ['⌘N', 'new workspace'],
  ['⌘T / ⌘W', 'new shell tab / close the tab (or the file preview)'],
  ['⌘1…⌘9', 'go to a tab'],
  ['⌘↑ / ⌘↓', 'previous / next workspace'],
  ['⌘J', 'the next tab that needs you, in any workspace'],
  ['⌘K', 'the palette: every workspace, tab and action'],
  ['⌘P', 'find a file in the workspace'],
  ['⌘F', 'find in the terminal'],
  ['⌘⏎ / ⇧⏎', "a new line in an agent's prompt"],
  ['⌘D', 'changes against the base branch'],
  ['⌥⌘B', 'side panel: files, changes, review, preview'],
  ['⌘I', 'workspace info: PR, checks, what each agent said last'],
  ['⌘E', 'open the workspace in your editor'],
  ['⌘B', 'hide / show the sidebar'],
  ['⌘,', 'settings'],
  ['⌘+ / ⌘− / ⌘0', 'terminal font bigger / smaller / default'],
  ['⌘/', 'this page'],
  ['Esc', 'close a page, dialog or menu; in an agent, interrupt its turn'],
]

const GLYPHS: [string, string][] = [
  ['waiting', 'needs you: a permission prompt or a question'],
  ['running', 'working'],
  ['done', 'finished while you were looking elsewhere'],
  ['idle', 'idle'],
  ['limit', 'usage limit: it types continue after the reset'],
  ['ok', 'ended fine'],
  ['exited', 'ended with an error: Enter starts it again'],
]

const Row = ({ k, children }: { k: ReactNode; children: ReactNode }) => (
  <div className="help-row">
    <span className="help-k">{k}</span>
    <span>{children}</span>
  </div>
)

export function HelpPage({ cli, ship, onClose }: { cli: string; ship?: boolean; onClose: () => void }) {
  const cmds: [string, string][] = [
    [`${cli} ls`, 'projects, workspaces and tabs, with their status (--json for scripts)'],
    [`${cli} new <project> --prompt "fix the login"`, 'a workspace with an agent (--preset codex|shell, --model, --effort, --base, --name, --local)'],
    [`${cli} new <project> --issue <url>`, 'a workspace on a GitHub issue: its title and text are the prompt'],
    [`${cli} new <project> --fan claude,codex --prompt "…"`, 'a race: the same prompt to each agent, a worktree each; Compare them in the app'],
    [`${cli} browser <ws> open /login · screenshot · click "<css>" · fill "<css>" "text" · text`, 'the agent browser: the dev server in a hidden window of the app'],
    [`${cli} send <ws>[/<tab>] "run the tests"`, 'type into an agent now; --when-idle waits for its turn to end'],
    [`${cli} screen <ws>[/<tab>]`, 'the bottom of a tab’s screen'],
    [`${cli} tab <ws> --preset codex`, 'a new tab (a shell by default)'],
    [`${cli} run <ws>`, 'the run script, in a dev tab'],
    ...(ship ? ([[`${cli} ship <ws> -m "message"`, 'commit, push and open a PR']] as [string, string][]) : []),
    [`${cli} archive <ws> · restore <ws> · fork <ws> · rm <ws>`, 'put a workspace away, bring it back, branch off it, delete it'],
    [`${cli} schedule add <project> --when "weekdays at 9am" "…"`, 'a prompt on repeat (--where new|folder|<ws>, --name "Nightly {{DD-MM}}"); schedule, schedule log, on|off|run|rm <id>'],
    [`${cli} mcp`, 'an MCP server for Claude Code, Codex…: Settings › Agent skill has the command that adds it'],
    [`${cli} stop`, 'stop the daemon: agents resume when it starts again'],
    [`${cli} help`, 'every command'],
  ]
  // ready to paste: a recipe is a comment line, then its commands
  const recipes = [
    '# three agents on three tasks, at once',
    'for t in "fix the login redirect" "add dark mode" "speed up the tests"; do',
    `  ${cli} new app --prompt "$t"`,
    'done',
    '',
    '# a follow-up, typed in when its turn ends',
    `${cli} send fix-login --when-idle "now add tests and run them"`,
    '',
    '# Codex, from another branch, with a name',
    `${cli} new app --preset codex --base develop --name api-v2 --prompt "add the v2 endpoints"`,
    '',
    '# watch an agent from another terminal',
    `while sleep 5; do clear; ${cli} screen fix-login; done`,
    '',
    '# a nightly agent in a fresh worktree, named by its date',
    `${cli} schedule add app --when "every day at 2am except weekends" --name "Nightly {{DD-MM}}" "update the deps, run the tests"`,
    '',
    '# a tab that runs the tests on every change',
    `${cli} tab fix-login --cmd "npm test -- --watch"`,
    '',
    '# done: look, then ship or put it away',
    `${cli} diff fix-login | less`,
    ...(ship ? [`${cli} ship fix-login -m "Fix the login redirect"`] : []),
    `${cli} archive fix-login`,
  ].join('\n')
  return (
    <Page title="Help" onClose={onClose}>
      <div className="help">
        <section>
          <h2>Start</h2>
          <ol>
            <li>Open a project: ⌘O, the folder icon at the top of the sidebar, or drop a folder on the sidebar.</li>
            <li>New workspace (⌘N): a git worktree and branch of its own (or the repo itself, with Local), an agent and a first prompt.</li>
            <li>Watch the sidebar: each workspace shows its most urgent tab. Click one to step in; ⌘K jumps anywhere.</li>
            <li>When it’s done: Ship (the arrow up in the tab bar) commits, pushes and opens a PR.</li>
          </ol>
        </section>
        <section>
          <h2>Keys</h2>
          {KEYS.map(([k, v]) => (
            <Row key={k} k={<kbd>{k}</kbd>}>
              {v}
            </Row>
          ))}
        </section>
        <section>
          <h2>Status</h2>
          {GLYPHS.map(([g, v]) => (
            <Row key={g} k={<Glyph s={g} />}>
              {v}
            </Row>
          ))}
          <p className="muted small">A tab that waits or finishes off screen sends a macOS notification; Settings › General picks which and the sound, a workspace's or tab's menu mutes it.</p>
        </section>
        <section>
          <h2>Around the window</h2>
          <Row k="Tabs">Drag a tab onto a pane to split it; double click to rename; right click for colors, split, restart, Mark as unread. Drop files on a terminal to type their paths.</Row>
          <Row k="Asks">An agent's numbered choices (a permission prompt) show as buttons under its terminal; a permission prompt's notification has Allow and Deny.</Row>
          <Row k={<Icon name="race" />}>A race: the new workspace page's Race adds agents that each get a worktree on the same prompt. Compare (the workspace's menu, ⌘K) puts them side by side; Keep this one archives the rest.</Row>
          <Row k="▷ Run">The project’s run script in a dev tab, with $PORT; ■ stops it.</Row>
          <Row k="Status bar">
            The plan-limits ring (the 5-hour limit of Claude Code’s and Codex’s plans; click for each window and when it resets), branch ← base, $PORT
            (green while something listens on it), the other listening ports (click to open), the PR and its checks, and the fix CI / review / fix conflicts switches (their prompts, how often they check and how many tries: Settings › Pull requests). <i>daemon older than the app · restart</i> shows up after an update: click twice to restart the daemon (agents resume; a turn in
            progress is cut off).
          </Row>
          <Row k={<Icon name="globe" />}>
            Expose to the world: next to a port, a public trycloudflare.com link with a QR code for your phone, optionally only for some email addresses.
            Needs cloudflared (<code>brew install cloudflared</code>).
          </Row>
          <Row k="Sidebar">Click a project to fold its workspaces away; hover a workspace for ⋯, its menu (right click too); drag to reorder. +12 −3 (Settings › General › Diff size): its lines changed against the base. GitHub's mark: the workspace has a PR (gray: draft; purple: merged; red: closed, or failing checks; a yellow ⚠ beside it: merge conflicts). Archiving a clean workspace is at once, with Undo.</Row>
          <Row k="Templates">
            Settings › Prompt templates, and each project's own: a prompt with <code>{'{{prompt}}'}</code> in it (and <code>{'{{project}}'}</code>, <code>{'{{base}}'}</code>). Pick one
            under a new workspace's prompt: the agent gets it filled in.
          </Row>
          <Row k="Actions">
            Settings › Actions (and a project's): a prompt for an agent, or a command for a terminal. Run ▾ lists them for the workspace you're in.
          </Row>
          <Row k="Agents">The new workspace page picks the agent's model and effort. The Dock icon counts tabs that need you or finished unseen. Settings › General › Turn timers: how long each turn has gone.</Row>
          <Row k="Board">The columns icon at the bottom of the sidebar: every workspace by where it is (running, needs you, done, PR open, merged); click one to open it. To do holds prompts: ▷, or a drag onto a column, starts a workspace on one.</Row>
          <Row k="Scheduled">
            The clock at the bottom of the sidebar (or ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at times you write, like “every day at 2am except weekends”, in a
            new workspace each run, its folder (a new session each run, or one) or a workspace you pick. {'{{DD-MM-YY}}'} and the like in the name or prompt become the run's date. The log lists each run; the clock gets a dot when one failed.
          </Row>
          <Row k="Look">Settings › Appearance: themes (yours is checked; ✦ ones also change shapes and borders), glass (a see-through window: how much, and a glow), the interface font, how project names look and the sidebar's lines, rows and button labels. Settings › General exports every setting to a file, to import on another Mac.</Row>
          <Row k="Files">The side panel's preview colors code up to 50 KB and shows Markdown rendered or raw; right-click a file to open it in a browser or another app. The status bar's path has a copy button.</Row>
          <Row k="Changes">Click a line of a diff to comment on it: on the PR (GitHub), or to the agent.</Row>
          <Row k="Preview">The toolbar's globe opens the side panel's Preview at localhost:$PORT (the menu has the other listening ports); the camera sends a screenshot to the agent; the crosshair puts a clicked element's selector, HTML, CSS and a screenshot of it in its prompt.</Row>
          <Row k="Links">
            <code>laki://ws/&lt;id&gt;</code> opens a workspace (a workspace's or tab's menu: Copy link); <code>laki://new?project=…&amp;prompt=…</code> fills in a new one,
            <code>laki://settings/&lt;section&gt;</code>, <code>laki://schedules</code>, <code>laki://board</code>, <code>laki://help</code>, <code>laki://about</code> open pages.
          </Row>
          <Row k="Quit">⌘Q quits the app: agents keep running in the daemon. Quit … Completely (the app menu) stops the daemon too; agents resume next time.</Row>
        </section>
        <section className="help-cmds">
          <h2>Command line</h2>
          <p className="muted small">
            Scripts and agents drive the same daemon with <code>{cli}</code> (the README says how to put it on your PATH). Agents learn it from the agent skill
            (Settings › Agent skill).
          </p>
          {cmds.map(([c, v]) => (
            <Row key={c} k={<code>{c}</code>}>
              {v}
            </Row>
          ))}
          <h3>Recipes</h3>
          <pre className="help-pre">{recipes}</pre>
        </section>
      </div>
    </Page>
  )
}
