# Links, the preview and the renderer: how they work

### Links

`laki://` (electron-builder's `protocols`, `setAsDefaultProtocolClient` when packaged): main's `open-url` queues a
link until the renderer says `deep-link-ready` (preload's `onDeepLink`; a main-frame navigation resets it), then
sends `deep-link`. `links.ts` `parseLink` (tested in `test/links.test.ts`), App routes it once the view is in: a
workspace or tab, the new-workspace page filled in (`initial`: a prompt and a name, never a preset, L12; `linked`: the
page's *Filled in from a link* while the prompt is the link's), Scheduled tasks, the Board, Settings, Help, About, Get started (`onboard`: the Help menu's *Get Started Again…*), My Desk (`desk`), the UI kit (`uikit`, `/icons`: its icon gallery) and the starter picker (`starters`: App's dialog `'starters'`, UiKit.tsx' `StarterPicker`; a pick is `WidgetsApi.make`, its page with nothing behind). Links select and fill
in; they never create or run anything.

### The app's pages: app://laki (S9)

The built pages (`index.html`, `ask.html`, `floater.html`, `annotate.html`) load from `app://laki/`, not `file://`:
main registers `app` as a privileged standard scheme (`registerSchemesAsPrivileged`: standard, secure, fetch, code
cache, stream) and serves it on the default session only (`serveApp`, `protocol.handle`): guards.ts `appFile` maps a
URL to a file of `out/renderer` (another host, `..`, a NUL or a bad escape: 404), `net.fetch` of its `file:` URL gives
the type. The preview, Browsers and the agent browser have no `app:` scheme. `pageURL(file, query or hash)` is what
each window loads (dev: the dev server's URL instead). Why: on `file://` the CSP's `'self'` is any file on the disk,
so an HTML injection could load a script an agent wrote into its worktree beside the preload's bridge; on
`app://laki` it's out/renderer alone. The CSP (electron.vite.config.ts' `csp`, the build only) also says
`script-src 'self'` and `object-src 'none'`.
- guards.ts: `appPage` (the built origin by its prefix: node's URL gives a custom scheme's origin as `null`),
  `fromApp`, and `tokenPage`/`fromTokenPage`: `conn` (the daemon's port and the app's token) answers index.html's
  pages only (the app window, `?window=` new, ai, tab, sim, quick), never a card's, the bubbles' or the editor's.
- The daemon takes Origin `app://laki` (not `file://`) or none (the CLI). A daemon from before (API < 167, still
  running after an update) would refuse the window, which then can't see it's stale: main's `daemon()` pings it once
  and asks it to `shutdown { keep: true }`, then starts this bundle's.
- localStorage moved with the origin, once (`moveStorage`, userData's `storage-moved` marks it): a hidden window reads
  the `file://` origin's on an empty page, then writes what `app://laki` lacks on `icon-192.png` (no app script runs
  there). `moving` keeps that window's close from quitting on Linux (`window-all-closed`).

### Preview

The side panel's Preview: a `<webview>` (`webviewTag`) made by hand in `SidePanel.tsx` `PreviewTab`. Its address bar
is `text.ts` `previewUrl` (a path on the port, `:5173`, `localhost:…`, a site, a URL) and `previewAddr`; a size
(`SIZES`, `parseSize`, the devices bar) gives `.web-host` that width and height and `transform: scale()` down to
`.web-body`. Main's
`will-attach-webview` drops any preload, forces no node, sandbox and context isolation, and refuses a `src` that
isn't `http://localhost` or `127.0.0.1` (the first page; after it, the address bar and links go to any website: `go`'s
`SITE`, a bare `example.com`, is https), or a partition other than `persist:preview`, whose session grants only
`PREVIEW_OK` permissions (Electron grants all by default). No `allowpopups`: its popups are blocked. `capture` (IPC) takes a webview of the
asking window by its `webContentsId` and returns a PNG (base64); `ShotBox` saves it (`imageSave`) and sends its path to
the agent. The crosshair (F5's design mode: `pick`, the app only, a local page only: `LOCAL`, the button shown and the pick
refused elsewhere; ⌥⌘P, `KEYS`' `previewPick`: keydown.ts with the focus in `.web-tools` or `.web-body`, or main's
`before-input-event` on a `persist:preview` guest, sent as `browser-key`; both fire `laki-preview-pick`) runs
`pickElement`'s source in the page (the webview's `executeJavaScript`, the guest's webContents': no preload, no bridge):
it outlines what's under the mouse and resolves the clicked element (a short unique CSS selector, its opening tag, id,
classes, text up to 200 characters, size, its outerHTML up to 1,500 characters, the computed CSS of `CSS_KEYS` that
isn't a default, its rect and the page's width, the URL), or null on Esc (`window.__lakiPick(null)` cancels it from
outside); the app then captures the webview and `crop`s it to the element (a canvas, scaled by the image's width over
the page's) and opens `PickBox` over `.web-body` by the element (`pickAt`: under it, above when there's no room): the
selector, size, text, the screenshot, `sourceGuess`'s files (daemon files.ts: `git grep -l -F` of `pickWords`, its id,
hand-written classes and text's start, the first in one or two files, 3 s a word), your words; *Send to* the first of
`PanelApi.agents` (`toAgent`, as its turn ends). text.ts `pickPrompt`: your words, then the element in a fence
(shared/fence.ts `fenced`, `untrusted`: the page's own text, data), the saved screenshot's path, `Likely source:`. In a browser on the Mac it's an iframe (the CSP's `frame-src`); elsewhere, a note.

A Browsers page's camera (`BrowserPane` `shot`, preload's `pageShot`, main's `page-shot`: the app window's own webview
only; what's in sight by `capturePage`, the whole page by `wholePage`, DevTools' protocol `Page.captureScreenshot`
`captureBeyondViewport`, 16384 CSS pixels tall at most, refused with its DevTools open), copied (`ClipboardItem`) or
saved as `~/Downloads/<host>-<date>-<time>.png` (`-2`… when taken), its path back for App's toast (*Open*).
A Browsers workspace's page (`Browser.tsx` `BrowserPane`, over `.term-wrap` in place of the terminals; App's `browsed`:
ones opened since start stay mounted, `visibility: hidden`) is a `<webview>` in `persist:browser`: main's
`will-attach-webview` lets it start on any http(s) page, `did-attach-webview` turns a link to a new tab into a load in
place and gives a `window.open` popup (`disposition` new-window: a sign-in's) a small sandboxed window in the same
session, its opener kept (`allowpopups` plus `setWindowOpenHandler`), a link to a new tab (`disposition` background-tab: a middle click or ⌘-click, or the menu's *Open Link in New Tab*;
foreground-tab: target=_blank, selected) goes to the app as `browser-tab` (preload's `onBrowserTab`), App's `quickNew`
with its `url`: a Browsers workspace of its own, named by its host until its title (⌘T or the tab bar's + there: an
empty one; ⌘W: App's `closePage`, `wsRm` at once, the next one of the project selected, Undo a `quickNew` of its URL;
from inside the page, main's `before-input-event` takes ⌘W and ⌘T from it and sends `browser-key`, preload's
`onBrowserKey`, App's keys as if typed there); a right click is main's `pageMenu` (link, image, selection or field, back, forward, reload, Inspect Element: `inspectElement`; the toolbar's `</>`: the webview's `openDevTools`), its session gets `PREVIEW_OK` permissions only and Chrome's user
agent without Laki's and Electron's names; on accounts.google.com (main's `googleSignIn`, every webContents of the session: the page and a sign-in popup) Firefox's (`FIREFOX`, the request's header too, no `sec-ch-ua*`), which Google lets sign in; its rejected page opens the sign-in in your browser (`shell.openExternal`, its `continue`), a popup closed, and `BrowserPane` says so. `text.ts` `browserUrl` reads the address bar (a URL, a site, else a
DuckDuckGo search).

The agent browser (`browse` above) is main's: a hidden `BrowserWindow` per workspace (1280×800, a partition of
its own, `AGENT_BROWSER`, in memory: S12, never the Preview's cookies; `PREVIEW_OK` permissions; sandboxed, no popups, navigation and redirects kept to local URLs), destroyed after 10 idle minutes;
click and fill run in the page (`pageJs`: the first match, scrolled into view; fill sets the value through the
native setter and fires input and change), then wait 300 ms (`settle`: and a load it started, 5 s at most). Open,
click and fill answer with what they caused (shared/types.ts `BrowseDid`): `nav` (moved), `errors` (`console-message`
errors), `blocked` (popups, and navigations off localhost, refused), 20 of each, this op's only; click and fill also
`changed`, `pageChanges` over the page's innerText lines before and after (+ added, - gone, `CHANGED_MAX` 20, then
how many more); a click that changed nothing on the same page looks once more a second later (a fetch's answer). The CLI prints `browseSays`; MCP's `laki_browser` gives it as JSON. ponytail: main's code, no test
drives it (Electron); `pageChanges` and `browseSays` are tested in `test/units-more.test.ts`.

### The memory budget for hidden Browsers pages

`settings.browserBudget` (MB; unset or 0: off; Settings › Resources, in the app only). Every 15 s App calls `unloadStep` (`shared/browserBudget.ts`, pure): main's `browser-mem` adds up the guests' processes, each once (`app.getAppMetrics`), and over budget the oldest hidden page goes, one a step, the way Resources' Stop does (out of `browsed`; opening it loads `w.browser`). Never the current workspace (asked again after each await) or the two last used (`KEEP`). `browser-guard` holds a page for what main sees itself, per guest (`guests`, `did-attach-webview`): media playing, a download, `debugger` attached or DevTools open, a key typed since it navigated, and the form check in an isolated world; a check that fails or takes over 1.5 s holds it too. `budgetSaid`: why nothing went, shown in Resources. ponytail: a box ticked with the mouse in a cross-origin frame isn't seen; Browsers workspaces only, not the Preview or agent browsers.

### Renderer

`src/renderer/src`:

- **What loads when** (E8): `main.tsx` imports `App` (the app window) or `NewWindow.tsx` (a floated one) as the fonts
  load, so each loads only what it draws. Dialogs.tsx' `PRELOAD` and `lazyPage`: Settings (its sections with it), an
  extension's page, the UI kit, Help, a project's page, the AI page, the board and Scheduled load as they open, in
  their frame meanwhile (`Waiting`), or as the pointer comes over their rail button (App's `railButton`); App's
  FullReview and the floating AI chat as they first show. What the rest reads of Settings is `settingsBase.ts` (fonts,
  the terminal's look, designs, the rail, row marks, `isSection`) and `extMenu.ts` (an extension's menu); a type from a
  page is `import type` (`verbatimModuleSyntax` keeps `import { type X }`'s module in the bundle). Measured with
  `npm run test:ui` (its first load and `first-row`): the window's first load 3,900 KB of JS in 7 files before, 3,021
  KB in 12 after; the first sidebar row painted at 177–219 ms before, 179–210 ms after (the parse saved is within the
  noise). The board's own chunk is 11 KB, but its import of the AI page's `Thumbs` kept that one in the first load.
- **Cost of a redraw** (E7, 2026-11, 60 workspaces, 140 tabs): a state event from the daemon to React's commit, built
  app: 3–5 ms (dev React: 25–35 ms; App and the sidebar's rows, every one, each time; a hover card two of those;
  typing in the Reader box only the box). Under a frame, so no memo work: memo on `Icon` and `Glyph` measured no gain
  and went. To measure again: a world (`npm run demo` with more workspaces), and `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
  defined before React loads (its `onCommitFiberRoot(id, root)`: `root.current.actualDuration` in dev; the fibers with
  flag 1 rendered).
- **`App.tsx`**: the state, effects, toolbar, send bar and status bar. Its parts read it through `appCtx.ts` (`AppCtx`,
  built each render): the sidebar (`Sidebar.tsx`), the tab bar (`TabBar.tsx`), the menus (`menus.ts`), the palette and
  its items (`Palette.tsx`), the keys (`keydown.ts` `onKey`), the pages and dialogs (`Dialogs.tsx`).
  - Ship (U5): `Ship.tsx`' sheet, Dialogs' `ship`: `shipDraft` as it opens, the file's diff from `diff` (uncommitted) on a
    click (`diffByFile`), `gated` around `ship`; after an Open PR, the sheet's Merge when green and Send CI failures as
    `wsSet` (no second ask: the box was it). ⌘↵ is Open PR. In a short window each column scrolls (`.ship-cols`' one
    `minmax(0, 1fr)` row); on a phone the files sit over the words, scrolling as one.
  - ⌘K commands' keys: `shared/keys.ts` `COMMANDS`, `settings.cmdKeys`; `keydown.ts` builds `paletteItems` only when a press matches and runs the item with that `id` (one that doesn't apply now lets the key go on).
  - Keys are handled in a capture-phase `keydown`; xterm never sees ⌘ keys. Settings › Keys' (`shared/keys.ts` `KEYS`:
    17 actions, an id, words and a default each; `settings.keys` over them, `keyMap`: '' none, one `keyOk` refuses (no
    ⌘, ⌥ or ⌃) the default) go first, after the picker's: `kb`, `keyFor` (the layout's character, `keyLabel(e, true)`,
    then the physical key: Dvorak's ⌘K, Cyrillic's, ⌥'s) into `bound` (false: not now, the key goes on: ⌘[ in a
    field); a rebound one's old keys do nothing. `keys.current`'s `force` runs one by id (`browser-key` with an id: the
    menu bar's, a Browsers page's). The rest (`FIXED`: ⌘1…⌘9, ⌘↑ ⌘↓, ⌘O, ⌘E, ⌘D, ⌘⇧N, zoom) are the `act` map's. `kh`
    and `kt` put the keys in use in menus' hints and tooltips; `bridge.keys` sends `settings.keys` to main. ⌘⇧N clicks the tab
    bar's + (`.newtab-btn`): a menu opened by a key's click (`detail` 0) has its first item picked (`Menu` `first`).
    ⌘⇧A is `toggleArtifacts` (the status bar's Artifacts strip, `gallery`); ⌘L is Send later (`canLater`); ⌘⇧⏎ is
    `toggleFull` (the tab bar's ⋯ › Full screen): `.app.full` hides the chrome (styles.css), `.full-exit` brings it back, and main's
    `full-screen` IPC puts the window full screen (`focusFull`: whether it was, restored after, and what `saveWin` keeps).
  - Per-viewer UI state is in `localStorage`:
    - `laki.ws`: the selected workspace;
    - `laki.tabs`: the selected tab per workspace;
    - `laki.groups`: each workspace's tabs, each a split tree of sessions (the daemon's `layouts`, kept here for the first paint);
    - `laki.sideW`: the sidebar's width per `RailKind` (`sideKind`: the rail's kind, projects without the rail; `laki.side`, the
      one width before, seeds each); `laki.sideOpen`: whether it's shown;
    - `laki.rail`: the rail layout's kind (`RailKind`: projects, shells, browsers);
    - `laki.folded`: the projects whose workspaces the sidebar hides (a click on the project's head; `rows.dragged`
      keeps a drag's click from folding it), and the seps whose workspaces up to the next sep it hides (`shownRows`);
    - `laki.panel`, `laki.panelTab` (`info`: ⌘I's), `laki.panelW`: the right panel; `laki.previewW`: the file preview's
      width (null: it shares the room with the terminals; a double-click on its edge goes back to that) (both
      `Panes.tsx` `PanelHandle`: no cap but the terminals' 280px, also `max-width` in styles.css);
    - `laki.theme`: the last `Paint` (theme, glass, font), painted before the daemon's settings arrive.
    - `laki.active`: when each agent tab last worked or waited (ms), for the bubbles' recent ones; closed tabs drop out.
    - `laki.runsSeen`: the newest run the Scheduled tasks page showed (the clock's dot: a failed one after it).
    - `laki.needsEarlier`: `1` while Needs you's Earlier row (stale finishes) is unfolded.
    - `laki.limitsTold`: each plan limit window's reset it was told for (`limitsCrossed`: once per reset).
    - `laki.recent`: the palette's last 30 picks, by label: first in it, and ahead of a close match.
    - `laki.md`: the file preview's Markdown mode, `raw` or `rendered`.
    - `laki.zoom`: each tab's ⌘± text size, in points over `settings.fontSize` (App's `sizeOf`; ⌘0 drops it; closed tabs'
      go); Settings and Help zoom with `pageZoom` instead.
    - `laki.diffSplit`: Changes in two columns (`split`, `text.ts` `splitRows`) or one (`unified`, the default).
    - `laki.changesScope`, `laki.reviewScope`: Changes' and the Review tab's *Branch* or *Uncommitted* (Diff.tsx `useScope`).
    - `since` (R11): Changes' *Since I reviewed · n files*, never kept; only while the workspace has a `reviewed` mark.
    - `laki.video`: the sidebar's video (an embed URL), back after a reload without autoplay.
    - `laki.timers`: the sidebar's timers (`id`, `end`, `ms`, `then`, `left`: paused, its ms left, kept as it is;
      `note`: its message, Go out: on its bar, the end dialog's title, the notification's); ones that ended while the
      app was closed are dropped.
      Send later (⌘L, the toolbar's clock and ⋯, a tab's right click, ⌘K, the AI page's clock (`onLater`, dialog `back`);
      `SendLaterDialog` in panels.tsx, `text.ts` `parseLater`: a length or a time of day; `picks`: Run ▾'s agent actions,
      `mergeActions`) is one with `then: 'send'`, `ws`, `tab`, `text`: `send` `whenIdle` as it rings (Send now, Edit,
      Cancel in its menu, and in its tab's pane foot: panels.tsx `LaterStrip`, beside the `QueueStrip`); `tab: 'ai'` is Laki AI (`askLater`: `aiAsk` with the text stamped, tried every 15 s for an hour
      while it's busy, a notification as it answers); one due while the app was closed is dropped with a toast (`missed`).
    - `laki.watches`: the stopwatches (the timer menu's *Stopwatch*, `StopwatchBar` in panels.tsx): `ms` counted before,
      `from` running since.
      A reminder (a workspace's *Remind me…*, `RemindDialog`) is one with `then: 'remind'` and `ws`: it notifies about
      the workspace (the click: its first tab) and toasts *Open*; one due while the app was closed rings as it opens.
    - `laki.previewSize`: Preview's size (`{ w, h }`, null: the panel's).
    - `laki.aiFloatAt`: where the floating Laki AI chat was dragged (App's `AiFloat`: `right` and `bottom` in px, held
      8px inside the main area as it changes size; a double-click on its head drops it and the size); `laki.aiFloatSize`:
      its size, from its edges and corners (`.ai-grip`s; the window clips, so they reach past the round corners).
    - `laki.aiDock`: the chat button minimized into the status bar (App's `dock`: `fly` down, `DOCK_MS`; `.sb-ai`, sticky at
      the bar's end; its right click, or ⌘K where no status bar shows it, floats it again).
    - `laki.checkOffered`: projects Done check was offered for (its toast, once each).
    - `laki.reader`: each claude or codex tab's Reader view or terminal (`reader`, `term`; unset: Reader on a phone).
    - `laki.radarHide`: Collision radar's overlaps you hid (`radarKey`: both sides' lines; a change shows it again), the newest 200.
    - `laki.branchFull`: the status bar's branch (`.sb-branch`) whole, with its base; else short: no branch prefix, cut at 24ch, all of it in the tip.
    - `laki.aiDrafts`: Laki AI's composers' unsent text and images (paths, shown again through `aiImage`), by chat:
      PromptInput.tsx `useDraft` (the AI page, floating chat and AI window share `ai:<chat>`; an extension page's `widget:<id>`,
      `widget:` a new one; a brainstorm's chat; `desk:build`); kept by Reset the interface (`UI_KEEP`).
    - `laki.newDraft`: the new-workspace page's draft (`Draft`: the form, images, race, template), saved as it changes
      while something's typed, dropped as it's made (back if that fails) or *Clear*ed; `laki.scheduleDraft`: Scheduled
      tasks' open form (Cancel asks when it changed); `laki.settingsSec`: Settings' last section. Their forms don't
      submit on Enter (`onSubmit` prevents it; ⌘⏎ or the button), and `Page`'s and `Modal`'s Esc is `escapes` (not one
      a menu or field took, nor an IME's; a `Modal` takes the keyboard as it opens unless a field of its has it, and gives it
      back as it closes: a terminal that kept it took Esc to its agent; its title has a ✕; the AI page's `Page` has `esc` false); a `Modal` with something typed in it nods at a click outside instead of closing
      (`loose`: the palette closes anyway).
    - Settings › General › Development › *Reset the interface* (`resetUi`): the daemon's `uiReset` (core.ts: every setting
      but `SETTINGS_KEPT`, what the user set up or wrote (`specs` and `workflows` too: on unless false), back to unset, the experimental ones too; `widgetsOff`: every
      extension off), then removes every `laki.*` key but `UI_KEEP` (timers, stopwatches, drafts; Get started shows
      again), then reloads: add a key that holds what the user made there, and a setting that's set up or written to
      `SETTINGS_KEPT`.
    - `laki.onboard`: Get started (`panels.tsx` `Onboarding`, `STEPS`): `done` (ticked, or seen done by App's
      `onboardDone`: a project, a workspace, Settings' sections through `SettingsPage` `onSection`, Shells or Browsers),
      `seen` (it opened once by itself, after the first project: Welcome's checks come first), `off` (Don't show again:
      no `OnboardBar` at the sidebar's foot either). What it ticks that Achievements' Getting started has too (a project,
      a workspace, Settings) is earned there quietly (no toast), so the two agree; the status bar's trophy shows from
      the first unlock.
    - `laki.newWs`: the new-workspace page's last choices (`LastNew`: project, preset, cmd, local, model, effort,
      base, place (that project's), template name, and Settings' default agent then: a new default wins; never the prompt, name, PR or a race); its More starts closed.
  - The Dock's count (`bridge.badge`, main's `app.dock.setBadge`): tabs waiting, or done unseen, outside muted tabs,
    muted and archived workspaces. The same message carries the menu bar's item (`badge(n, items, tray)`: main's
    `Tray`, `trayIcon` drawn in code as a template image (Q8: one per state, `shared/tray.ts` `trayBitmap`: idle the mark's
    outline, working the outline and a dot, waiting filled, blocked filled with a bar; App's `stateOf(view)` with the
    badge, `settings.trayState` (*Show state*, on unless off): blocked (a plan limit not yet reset, a turn ended on an
    error) over waiting (`needsTab`) over working (an agent tab running), muted and archived aside; its title the count
    and ! when blocked, its tooltip in words (`trayTip`); a change swaps the cached image, nothing animates; off: the
    filled mark always; `test/tray.test.ts` draws the four to PNGs); the count as its title, a menu of those tabs, waiting first
    with what they ask from `turn` events, `show(tab)` on a click, then *New Workspace…* (`newWsWin`), the screenshots and *Open Laki* (the global hotkey as its `accelerator`, `registerAccelerator: false`; the `hotkey` IPC builds the menu again); `settings.menuBar === false` destroys it: Settings › General › *Menu bar icon*). `TurnTime` (`ui.tsx`'s `Elapsed`, ticking each second) on a tab and a row, with
    `settings.timers`.
  - The theme is applied during render (`applyTheme`), before the terminals' effects read the CSS. Glass also
    goes to main (`bridge.glass`: `setVibrancy`) when it changes.
  - The toolbar's ⋯ (`wsActions`) has *Copy path* (the full one, `host:` first; `shortPath`'d as its hint); the status
    bar has no path. A Terminals workspace's leaves out `$PORT` (its listening ports as any), a Browsers one's bar has only the foot
    buttons (on a phone none, unless the daemon is stale or the connection is down).
  - Resting on a row (`peek`, 550 ms; 120 ms once one shows) shows `peekCard` beside the sidebar instead of a
    tooltip: state and agents, the last answer or the ask, the PR (avatar, state, title, author, checks, review,
    conflicts, size), `statText`, ports and marks, *Open*, the PR, ⋯; it stays while the mouse is on it (250 ms to get
    there), a wheel, a key or the window's blur hides it; not on a phone or with a pointer other than a mouse, nor for
    a Terminals or Browsers row (`kind`: no port, PR or agent to tell of).
  - A workspace with a PR gets GitHub's mark in the sidebar (`.ws-pr`, its `prState` as colors; an open one's failing
    checks a red mark of their own before it, `.ws-pr.ci`, as conflicts get theirs: a red GitHub mark is a closed PR),
    unless `settings.prIcon === false`. Projects show `fork` (a repo) or `folder` (`git: false`), or their own `icon` in
    their `color` (ui.tsx `ProjectMark`, `.p-mark`: an emoji with a line in it; also the new-workspace page's project
    menu (a menu item's `mark`), the palette's workspaces and tabs (`PaletteItem` `mark`), Settings' nav, a rail pin's
    corner); App's `tint`: a workspace's color, else its project's (the peek card, rail pins, the bubbles).
  - A project's workspaces are in `.project-ws` (indented on a guide line; a line between projects). Rows are inset and
    rounded (hover and selection one item each), the selected one with a short bar (`--ws-bar`: its color, its project's
    (`--proj-c`, set inline: every row's bar, no tint) or the accent; a
    look's `.ws.sel` background replaces it), `.needs` (a tab of `needsYou`) a bold name; a project with none shows
    *New workspace* (`.ws-new`). A row shows
    `stat` (`.ws-stat`, with `settings.diffStat`) and, on hover, `.ws-acts` (its ⋯ menu) growing in after its marks, which slide left. The PR mark is red
    for a closed PR only: a merged one stays purple.
  - The sidebar's filter (`find`, the head's funnel, ⌘K): `shows` (words in a name, branch, PR title, author or
    `#n`, and `ONLY`: needs you, working, with a PR; `find.projects`: the project chips, text.ts `pickProject`, a
    click one, Shift several); matching rows only, flat (no seps), no drag meanwhile.
  - A PR's author's picture (`Avatar`, Info.tsx: `avatars.githubusercontent.com/<login>`, the CSP's one `img-src` host) before
    the row's PR mark and in the PR section, unless it's `mine`; `settings.avatars === false` (Settings › Appearance's
    *GitHub pictures*, `showAvatars`): none loaded.
  - ⌘J (`nextNeed`): the next tab of `needsYou` (the Dock count's rule) in text.ts `needsSorted`'s order, as Needs you
    lists them: waiting ones, the oldest first; then done ones, the newest first, fresh before stale (`isStale`: done
    `settings.staleAfter` minutes ago by its `needAt`; unset `STALE_AFTER` 30, 0 never; waiting never). Needs.tsx folds
    the stale ones under *Earlier · n* (`laki.needsEarlier`: unfolded; *Seen all*: `seen` each, Undo `unread`), dimmed,
    one line; each card's chevron shows or hides its detail (open but for a stale one), the rest of it opens the tab.
    U8: its head's *Allow all (n)* / *Deny all* take shared/ask.ts `bulkOk`'s asks (claude's PermissionRequest: `tool`
    and `what`, the menu's first a yes and last a no or none read; never `risky`, a cut `what`, a secret, `steps`, or a
    file tool's path outside the worktree unless the tab's `sandbox` is on and not bypass), two or more; Sidebar's
    `needsApi.bulk`: Allow's confirm lists `bulkGroups` (one line per tool and text), then `answer` each one after
    another (`n` and `label`, or `pick`), the ones refused named in the toast. ⇧A (`KEYS` `allowAll`): keydown.ts
    clicks it, only with the focus in `.needs-list`.
    App's `minute` tick moves one across while nothing else changes. The Dock's count is all of them.
  - Picked rows (`picked`, ⌘-click and ⇧-click, `pickRow`, `anchor`; `pickable`: a project's live workspaces, not
    terminals' or browsers'; not on a phone): `.ws.ws-picked`, `.pick-bar` over the list (Archive: `wsArchive` `ifClean`
    each, the dirty ones asked once, Undo restores all; Mute; Move to group, `pickedGroups`, when they share a project
    with groups; Delete, asked once), a drag of a picked row moves them all (`moveIds`); Esc or a plain click clears.
  - Back and forward (`settings.history`, on unless false; Settings › Appearance › Rail): `hist` (a ref: `Place`s, `{ d: dialog, ws }`, `HISTORY_MAX`
    back) gets each new place (`isPlace`: a page, `PAGES`/`PAGE_KEYS`, or none; a dialog over them isn't one), what was
    ahead dropped (Workflows' index, a workflow and a run are places too: its dialog's `nav`, `WorkflowsPage` `onNav`); `travel(j)` selects its workspace (gone: the one you're in; a gone one's workspace view skipped) and
    page, `going` so that isn't a new place. `histNav` (‹ ›, a right click: `histMenu`, `placeName`) at the rail's top,
    else after the side head's hide button; ⌘[ ⌘] outside a text field.
    A page's own levels: Workflows' and Specs' (`onNav`: the list, each spec or brainstorm open, its templates; the
    dialog's `of`, `kind`, `slug`, `templates`) are places; Settings' section and an extension page's tab only rewrite
    the place they're at (Dialogs.tsx' `keepHere`, a microtask after the effects), so Back comes to where you left it.
  - The window's title (`winTitle`, `document.title`: Electron's window takes it; a screen share's picker, the Window
    menu, a browser's tab): `placeName` of the last page (`titleAt`: a dialog over it keeps it), else the workspace · tab
    (after `<emoji> <project>` when its project's icon is an emoji),
    then ` — Laki`; the new-workspace, AI and floated tab windows set their own (main.tsx, `TabWindow`).
  - `toast(text, undo?, label?, ok?)`: one message at a time (a newer one restarts the timer; `ok`: done, a check
    and no red); `archive` asks first (`peekWs`, `rmFacts` with `archive`: the storage folder kept, a codespace
    stopped), then `wsArchive` with `ifClean` unless it was dirty when asked (`loses`: uncommitted files, a
    submodule's, ignored files of its own), and offers Undo (`wsRestore`); one dirty since is asked again, with
    `peekFacts` of what the daemon found; `asked`: the caller asked once for several (`pickedArchive`, the Board's `archiveAll`). Deleting a
    workspace and removing a project say so too. `busyWith` puts `going` on the rows meanwhile (a spinner and
    *archiving…* / *deleting…*), Compare's *Keep this one* too.
  - A new workspace stays in sight (`showNew`, from the new-workspace page, a fork, a restore): `reveal` unfolds the
    project and sep holding it, and the one selected before it, once the view has them.
  - The menu bar's screenshot (`bridge.onShot`): `imageSave`, then the new-workspace page with it (`newImages`, a
    `Shot` each: its editor note goes in the prompt as it arrives, the page kept).
  - `making`: workspaces the new-workspace page is making, a row each (`makingRows`, a spinner, *creating…*) where
    `place` puts them; Esc closes the page and they stay until `wsNew`/`wsFan` answers (a dialog opened meanwhile stays).
  - No project: `Welcome` (panels.tsx) with `doctor`'s checks. `settings.dimPanes` (unset: on): `.dim-panes` on `.app`.
  - While a video plays, a closed sidebar is hidden (`hidden`), not unmounted, so it plays on. The video (`Video` in
    panels.tsx, the status bar's play button and ⌘K, the `video` dialog): `text.ts` `youtubeEmbed` turns a link into a `youtube-nocookie.com/embed` URL
    (else refused), an iframe sandboxed without top navigation; the CSP's `frame-src` allows that host, and main sets a
    `Referer` on its requests (`dev.laki.app`): from an `app://` page YouTube's player refuses to play (Error 153).
    `min`: only its bar (the iframe `hidden`, playing on). Its src has `enablejsapi=1`: `videoCommand` (panels.tsx)
    posts `playVideo`/`pauseVideo` to it.
  - Timers (App's `timers`, any number: the foot's button and `startMenu` add one; each a `TimerBar`, panels.tsx, over
    the foot, its time left ticking, its `timerMenu`: more time, start over, what happens as it ends, stop; the `timer`
    dialog, `{ timer: id }` for one's new length, with `text.ts` `parseDuration`): as one ends (`ring`), `TIMER_THEN`'s
    action (pause, play or close the video; with no video, only the notice; `command`: `tabNew` `custom` with the
    timer's `cmd` in its `ws`, the workspace selected when it was picked, not focused; gone or archived, only the
    notice), then `settings.timerSound` (Glass unless set; main's `sound` IPC: `afplay`) and `choose`'s dialog (*Again*:
    the same timer over), or with `settings.timerAlert` `notification`, `notify` with that sound (no tab: it shows the
    window) and a toast. `pause` (the bar's ⏸, its menu): `left` instead of a running `end`; `ring` isn't set for it.
  - Tabs (`tabList`) go in the top bar, or a `.tabstrip` (`data-tabbar`, a drop target too) under or beside the terminals:
    `settings.tabsAt`, top on a phone. `settings.hoverFocus` (unset: on): a pane the mouse enters (no button held, window focused)
    gets the keyboard (`Panes` `onPointerEnter`).
  - `.side-head` (top): hide, open a project, help; App's `footButtons` (Schedule, Board, Video (`settings.videoButton`),
    Meme (`settings.fun`), Timer (`settings.timerButton`; each on unless false, a running video or timer keeps its own),
    Settings): off a phone the full-width status bar's start (`.sb-foot`, `wideBar`), on a phone or with
    `settings.statusBar === false` (`noBar`: no status bar at all but while disconnected, as a phone's; the AI button
    then can't minimize into it) `.side-foot` (pinned at the sidebar's bottom), with words (`IconButton` `label`) unless `settings.sideLook.labels === false`; one row: App's `fit`
    (a `ResizeObserver`, and the theme's font) sets `data-bare`, how many buttons from the right lose their words, until
    it fits.
  - The project and workspace order is the daemon's (`reorder`).
  - The rail (`rail`: always, but on a phone, whose sidebar is a drawer; Settings › Appearance › Rail) puts `railBar`
    (`.rail`, `railW` as `--rail-w` on `.app`, `.rail-on`) left of the sidebar: a `railButton` per `RAIL` kind (a project's
    `kind`, none: projects) with `railSays` (`needsYou`'s count, a dot while a tab `spins`), Board and Schedule (`runFailed`: a
    red dot) right after Projects, and AI (when on) over Settings at its bottom, which leave the list's `.side-foot` (Video, Meme, Timer stay, under App's `footButtons` ⋯ menu; one in use, a video or a timer, its own button too); Schedule's and Board's pages hide the list (`listOff`: the aside `hidden`, `.list-off`); the list is `listed`, that kind's projects, and `inList` its pinned (a filter: all). An
    effect on the selected workspace sets the kind (`lastIn`: each kind's last, where `railTo` goes back); below `.rail-sep`,
    `railPins` (`pinButton`: `initials` in the workspace's color, a terminal's or browser's icon, `needsYou`'s count; never lit, its kind's button is; a
    right click is `wsMenu`); `moveWs`
    keeps to the list; `SideHandle` `at`. Its settings: `railLabels` (off:
    `data-bare`, icons only, `railW` 52), `railShells` and `railBrowsers` (off: `railOf` makes that kind `projects`, no
    button, its project in Projects' list; `rawKind` still gives a pin its icon and leaves out *Run ›*). With words, past
    `RAIL_FIT` buttons above the pins, `RAIL_MORE`'s (todos, calendar, workflows, specs, board: the least used first; the default
    pages: workflows and specs) go into a ⋯ More menu, lit while its page is open. `settings.railOrder` and `railHide` (Settings › Appearance › Rail's
    `RailField`: `RAIL_ITEMS`' boxes, an HTML5 drag; `railSorted`; AI fixed at the foot): the order and the ones put
    into More; a right click on the rail (`railMenu`) colors one (`settings.railColors`, by its `data-rail` key, a pinned spec's `plan:<project>/<kind>/<slug>`; `.rail-icon.tinted` in `--tab-c`) or moves one there, More's foot shows them all again or opens it.
- **Phones** (`App.tsx`, `useMedia`): `narrow` (≤640px, under the window's minWidth) puts `.narrow` on `.app` (styles.css' last block: the
  sidebar as a drawer, one pane per tab, panels and pages over the main area, terminal font at most 11px);
  `touch` (`pointer: coarse`) shows `KeyBar` (Esc, Tab, ⇧Tab, ⌃C, arrows, ⏎ to the focused pane, ⌨ focuses
  xterm's textarea; its buttons never take the focus). Traffic-light paddings are `.electron` only.
- **`Term.tsx`**: one xterm per pane. Reply (`onReply`, given while `replyTo` finds an agent: the tab's own, an agent
  tab or a shell running one; a plain shell has none): a pill (`.term-reply`) where the mouse let go of a selection, gone
  at a key, a press, a scroll or an empty selection; it opens panels.tsx' `ReplyPop` (the quote, your words, a pick of
  agents; ⏎ `send` `enter: false` into the prompt, ⌘⏎ `send` (`whenIdle` for an agent tab); ⌥ held (`alt`, `USES`,
  `onSelection`: App's `selectionTo`): *New workspace* (`newWs` with the text as its prompt), *New tab here* (`tabNew`
  with Settings' agent), *Ask Laki AI* (`aiAsk` with `whereNow`), the pill shown with ⌥ alone when no agent can be
  replied to), text.ts `replyText`: *From
  <tab>:* (*your output* from its own), the quote fenced, the words). A link's hover card (`LinkPeek.tsx`, 400 ms on,
  500 ms to reach it; `peekOf`: a GitHub PR or issue link, `ghCard`; an image, by extension; a Markdown file, `MD`, or
  a plain text one, `TEXT` (JSON, pretty-printed by `textShown` when it parses; logs, CSV, YAML, TOML, XML, a diff; no
  `.env`), a local path only, drawn by MarkdownView's `Markdown` or as text in a `<pre>` (never HTML; its first 30,000
  characters; the card 540 wide, a picture up to 504 × 360; App's `peekText`, `peekFile` as
  `peekImage`'s, but no file outside the workspace and its storage folder, nor one over `PEEK_TEXT`, 50 KB by
  `fileRead`'s `size`: no card), also from the `CODE` provider's
  hover): from the OSC 8 handler, the
  WebLinksAddon and a link provider of its own for a picture's path in plain text (`PIC`, relative to `cwd`, the
  workspace's folder); App's `peekImage`: `fileRead` (the workspace, else its storage folder), else `aiImage` (pasted
  ones only); an https one through `/img` (Widgets.tsx `imgVia`); a click anywhere on an image's, a Markdown's or a text's card (not its own links and buttons), or its ⤢ (`.lp-open`), opens it larger: Term's `big` (`kind`: the picture, the Markdown drawn, the text), panels.tsx' `Modal`, which outlives the card. No native title over a link that peeks.
  Any other file's path (`CODE`: one with a folder, or a bare name with `:line`; not a picture's) is a link too: ⌘-click
  (⌃ unless an app has the mouse; a plain click would open it as you select it) is `onCode`, App's `openCode`: a file of the workspace in the preview at its line,
  or `openIn` `editor` (`settings.fileClick`, ⌥ the other; `codeTo` for the hover's words); any other path `openPath`'s. In any tab (claude started in a terminal tab too; a shell runs the line on ⌃J), ⌘⏎ and ⇧⏎ send ⌃J (`\n`): a new line in claude's,
  codex's and opencode's prompt, where xterm would send ⏎. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder. xterm takes `allowTransparency` only as it opens, so App keys each
  `Term` on `transparent()`: turning glass on or off remounts the terminals. A keypress whose keydown it didn't see is dropped: Enter that closed a
  dialog (and so focused the terminal) would type a stray ⏎. On window focus or a page turning visible it sends
  its size again, so a look is enough to get it back after a phone. Links: a plain URL (WebLinksAddon) opens on a click (with the mouse
  captured, `?1000h`…: only on ⌘-click, and a ⌘-press on a link (`over`, the link providers' hover) is kept from the
  app's mouse report by `.xterm-screen`'s listener: codex opens its links itself, two tabs otherwise; in a browser
  elsewhere, no `bridge`, a tap too); an OSC 8 http(s) one only on ⌘-click (L13: its words aren't its address; a tap
  with no `bridge`); every link's address in the `title` on hover; `file://` (or a
  bare absolute path) on ⌘-click (⌃ too, unless the mouse is captured) (`allowNonHttpProtocols`): App's `openPath`, a file of the
  tab's workspace in the preview, else main's `open-path` (the app window's only: a folder in Finder, a document of
  `DOCS` in its app (not HTML: L11), anything else, bundles (`BUNDLE`: an Xcode project and a playground too) too, revealed). Files dropped on it (`bridge.pathOf`) are
  pasted as their paths, shell-quoted when they need it; its `preventDefault` keeps the window's folder drop out.
- **`shared/layout.ts`** (the daemon's too): tabs, tmux style. A UI tab is a split tree whose leaves are daemon tabs (sessions), so a
  session is in exactly one tab and nothing nests. Pure functions: `groupsOf` (stored tabs minus ended
  sessions, plus one tab per unplaced session), `move` (a pane or a whole tab to a `Spot`: beside a pane,
  onto its center to trade places with it, or into the tab bar at an index, its own tab; no change: `groups` itself), `insert`, `keep`, `resize`, `place`. Tested in `test/layout.test.ts`.
- **`Panes.tsx`**:
  - panes are absolutely placed siblings keyed by tab, so splitting never remounts a terminal;
  - `useTabDrag`, VS Code style, pointer-based (not HTML5 DnD): a drag starts past 4px (less is a click); a pill
    (`.drag-ghost`) follows the pointer; `overAt` finds the target with `elementFromPoint`: a pane's edge band (`ZONE`,
    30%) or its center, shaded (`.drop-zone`), or a tab bar (`[data-tabbar]`, its `.tab` children in groups' order, the
    flex direction for top/bottom or left/right) and the index between tabs, a line there (`.drop-line`); App's `ok`
    (the drop changes the groups) hides the rest. Esc, a release elsewhere, the window's blur end it with nothing;
    `.tab-dragging` on `<html>`: grabbing, no selection. After a drop the pane's terminal gets the keyboard. Off on a
    phone;
  - `SideHandle` resizes the sidebar.
- **`annotate.ts`** (`annotate.html`, electron-vite's second renderer entry): the menu bar screenshot's editor, a
  window main keeps on top (`annotate()` in main, `bridge.annotate`): crop, arrow, text, rectangle, pen, six colors,
  ⌘Z, a note; *Add to prompt* sends the PNG and note to main (only from that window), which sends `shot` (png, note)
  to the app: the new-workspace page with the image and the note as its prompt. Vanilla TS; in a browser (the dev
  server) a stand-in picture.
- **`floater.ts`** (`floater.html`, the third renderer entry): the floating bubbles (Settings › Appearance;
  `settings.floater`, unset: on). App's `floats` (each workspace whose agent tab works or waits, waiting first, then
  `floaterRecent` (0-5, 3 unset) workspaces whose agent worked last, by `laki.active`, as `idle` or `done` (a fresh done first:
  a stale one, `isStale`, is drawn and kept as idle, no fill; idle
  longer than `floaterRecentHours`, 4 unset, 0 never: out, a minute's tick ages them); at most `floaterMax`:
  `tab`, name, project (`projWords`: its emoji first; ponytail: an icon by name isn't drawn there), status, its color
  (`tint`), what it asked or last said, and `floatMore`'s branch, agents, PR and
  lines for the card), the theme's colors and the options (`style`:
  `floaterStyle`, `cards`: `floaterCards`, `add`: `floaterNew`, `menu`: `floaterMenu`, `voiceTo`: `floaterVoiceTo`) go to
  main (`bridge.floats`);
  main's `placeFloater` shows the bar while Laki isn't in front (`front`: one of its own windows has the focus, not the
  drop, its card or the voice window: a press on the drop makes Laki the active app, and the drop would hide under the
  pointer), and with + on even with no circles; `type: 'panel'` windows over every Space and
  full-screen app: `#bar` (labels: `text.ts` `initials`, two letters, unique, `pr`/`issue`/numbers skipped; a drop against the screen's left or right edge, never the top or bottom (`snap`; a row along them is still in the code, unreached: `data-side` from main's `floater-side`; `across`: the page's offsets and length along the row, main's `beside` puts the card, menu and voice windows below or above it):
  `.shape` with its flares, a slow wobble, a round blob while dragged; the circles; `.fl-btns`: the + (×, `.on`, while
  open) and `ACTS`, the menu bar's: New task, Say it, Screenshot area, Whole screen, and Ask Laki AI while
  `aiOn` (`actsFor`, the floats' `ai`; the menu a row taller: `menuH`); `menu` stack: `.fl-acts` over the + in
  the drop (`floater-size` `up`: main moves `home` so the + stays under the mouse; a hover's name and hint go to the card's
  window, `floater-tip`, cards on or not), card: `#menu`, a focusable panel beside the drop (`MENU`, its foot by the +'s,
  `floater-menu-at`; keys 1-5, arrows, ⏎, Esc; closed on blur, the bar told by `floater-menu`: a press on the + while
  open, or just after a blur closed it (`menuShut`), closes it); its picks are `floater-act` (`new`, `ai`: `aiWin`, `area`: `screenshot`,
  `screen`: `screenPick`, with more than one screen a menu of `screenItems` at the pointer, as the menu bar's submenu; `mic` from the menu: `floater-voice`, the bar opens `#voice`, the stack's opens it itself); New task is
  `new` (Q1: main's `quickWin`, the quick bar below; its *More…* is `quick-more`: `newWsWin`, the renderer's `?window=new`, `NewWindow.tsx`, the new-workspace page alone in a `type: 'panel'`
  window, compact (`.new-window` in styles.css; as tall as the page: `new-fit`, a `ResizeObserver` on the form), pinned over every app and Space, focused without bringing Laki's window forward (`own` leaves it out, so the
  bubbles stay); one at a time, a voice prompt to it is `new-prompt`; it closes itself (`window.close()`) once `wsNew`
  answers, or on Esc), Say it opens `#voice`; a click on a circle is `floater-open`: `show(tab)`; a drag from
  anywhere on it past 4px is `floater-drag` start/move/end with the pointer's screen offset, so its cursors (grab,
  pointer) work, which macOS's drag regions take away (macOS shows them only while Laki is the active app: a hovered
  circle grows instead: `.hot`, set by `pointerover`, not `:hover`, which outlives the bar's hiding as a click brings Laki in front); at the end main's `snap` sticks it to the side (left or right) nearest the pointer, animated (another orientation: centered there, its length kept until the page says its own), and
  `floater.json` in userData keeps where (`home`, with its `side`; an older one's: left or right by where it is: a screen gone puts it on the main one, `barAt`, and leaves `home` for
  the screen's return), `#card` (a hover's card, beside the bar toward the screen's middle, click-through: its own
  window so the bar never moves under the mouse; the card window holds the island's `#island` too: a card emptied it,
  as the island's empties `#card`, else one left from the notch showed cut under it; `floater-hover` and `floater-card` show it only while the cursor is
  over the bar and Laki isn't in front: a bar shown again keeps the circle it had under the mouse) and `#voice` (the
  microphone's: a focusable panel, `focus()` makes it key without bringing Laki's window forward; dictation 150 ms
  after the focus; `voiceTo` pick: a "Pick who gets it" row first, nothing sent until one is; new: no list, always a
  new session; `voice-send`: `rpc('send', { whenIdle, agent: true })` to a tab of the list, or `newWsWin(prompt)`). The card
  and voice windows are the bar page's `window.open` (main's `setWindowOpenHandler` allows only `#card` and `#voice`
  of the same page, one each; `did-create-window` pins them, `pin`'s `to`: their own page's load is a navigation too,
  which `will-navigate` would block): one renderer process, one row in Settings › Resources.
  `floater.css`: the circles' styles (`[data-fstyle]`: glow; gradient, the default; arc; bricks, box-shadow pixel bars stepped behind the initials; comet; wave, two turning rounded squares as a tide; still; idle and done dimmer; `[data-done='on']`: a done one filled green with a slow pulse, `floaterDone` unset or true: App keeps an unseen done one a bubble past `floaterRecent` and its hours),
  also Settings › Appearance's live previews.
- **The island** (`settings.floaterAt` `notch`; unset `edge`, the drop above): shared/island.ts (its pure parts:
  `hasNotch` by a built-in screen's menu bar over 24 points, `pillRect` (`NOTCH` 200, ponytail: Electron doesn't say the
  notch's width), `cardRect`, `cardQueue` (asks first, then finished ones, newest first by the float's `at`, its
  `needAt`), `lifeStep` (an ask folds only on Esc; a finished one `DONE_FOLD` 6 s after it showed unless the pointer is
  on it, and as it leaves after being on it), `fullScreen` (ponytail: a screen with no menu bar; main's `menuBarHides`, `_HIHideMenuBar`: never then), `plainLines`,
  `tookText`, `replyOf`); main's `islandAt` puts the bar at the pill (no drag, no snap; `home` and floater.json stay
  the edge's), `islandFloats` opens a card as a float turns waiting, or done within the last minute with `floaterDone` (an ask over a finished
  one; the same card again isn't redrawn, `islSent`: its reply box keeps what's typed), `island(tab, list)` sends it to the #card window (`island` IPC; its height back as `island-size`, then
  clickable and focusable: `island-ev` `focus` as the pointer presses on it (a pass leaves the keyboard where it was), its keys 1-9, ←→, Esc), `islandEv` the
  pointer's `enter`/`leave`/`esc`/`next`/`prev` and the 500 ms tick; a hover on the pill (`pill`) the session list,
  folded once the pointer is on neither. floater.ts' `pillRender` (bars, `.isl-*`) and `islandPage` (`#island`: an
  ask's options through `floater-answer` with n and label, a permission's `permVerb` and command, a finished one's
  `plainLines`, `tookText`, `replyBox` (`voice-send` from the card window), *Review changes*: `floater-open` with
  `changes`, main's `show(tab, panel)`, App's `onFocusTab` → `showPanel('changes')`). A float's `agent`, `at`, `ask`,
  `answer`, `took` (App's `islandOf`; `turnAt`: each tab's last `runAt`). Replies (edge too): a circle's right click
  is main's native menu (`floater-menu-tab`: *Reply…*, *Open tab*, a done one's *Seen*), ⌥-click and *Reply…*
  `floater-reply` → `replyTo`: #voice with `replyFor` (`sendVoice`: no pick row, its last answer, a waiting one's
  options as buttons; text refused while it shows a menu; queued: *Queued*, then it closes); the hover card's *Right-click or ⌥-click to reply*, once
  a session. Tested in `test/island.test.ts`.
- **A pinned card** (Q4, edge): a circle's click is `floater-click`, main's `pinGo` (shared/island.ts `pinStep`): a
  waiting one's card is pinned (`pinned`: the card window takes clicks and the focus, `card` with `pinned` true;
  floater.ts `pinnedCard`: its options as the island's buttons, keys 1-9, else a line for an answer in words,
  `floater-reply-send`: `send` now, as your answer (not `agent: true`: it refuses a tab that asks; a menu's tab is refused, its options are the answer); a permission's `pinWhat`, its first `PIN_LINES` lines, cut: no buttons,
  only *Open tab*); a click on the pinned one again (a double click: two) or one that doesn't wait opens its tab
  (`openTab`), as before. Esc (`floater-pin`), the card's blur (a click elsewhere; `PIN_GRACE`: the bar's press blurs it
  before its click), the answer (`floater-answer`, `floater-reply-send`) or its ask gone (each `floats`: `list`) unpin
  it. While pinned, hovers don't move the card. `npm run test:ui`'s `bubble-answer` answers a waiting demo tab there.
- **A drop on a bubble** (Q9, edge): the bar's `dragover` on a circle or the + lights it (`.hot`) and names where it
  goes in the card window (`floater-tip`); `drop`: each file by its path only (preload's `pathOf`: Laki never reads or
  uploads it), a picture with no file of its own saved first (`floater-image`: `imageSave`), else the text or the
  first link (`text/uri-list`, `text/plain`), then `floater-drop` (main's `dropOk`: absolute paths that exist, 50 at
  most, no control characters). On a circle main pins its card with the drop (`dropFor`; it stays while that bubble
  does: `list`), floater.ts `dropCard`: the names, the text, a line for what to do; ⏎ is `floater-drop-send` with
  text.ts `dropText` (the words, the text, each path on a line, as `withPaths`): `send` `agent: true` (never a shell) and `whenIdle` (after its turn or its ask: never keys into a menu).
  On the +: `quickWin` with it (pictures as their paths; ponytail: a folder there is a path, never a project). Tested
  in `test/island.test.ts`; `npm run test:ui`'s `bubble-drop` drops a synthetic DataTransfer.
- **The talk pill** (Q2, `settings.talkOn` with the cloud engine, `talkKey`, unset `TALK_KEY` ⌃⌥⌘M; App's `talkKey` to
  main's `talk-hotkey`, `bindKey('talk')`): main's `talk()` opens `floater.html#talk` as a focusable panel window of its
  own at the pointer (`TALK` 320 by 78), or, open already, sends `talk-key` (the second press). The page (floater.ts
  `talkPage`) records at once (`getUserMedia`, stopped with the recording: the mic is open only while `#talk.rec`'s dot
  is red), an `AnalyserNode` on the same stream for the level, `talkTime`; who gets it: shared/talk.ts `talkDefault`
  (the newest waiting one, else `talkLast`, else a new task) over `talkList` (the floats' `talk`: App sends the bubbles'
  list there while the talk key is on, the bubbles off too), Tab `talkNext`. The key again or ⏎: `talk-text` (main's
  `rpc('voiceText')`), then `talk-send` (`send` `whenIdle` `agent: true`, only to a tab the pill offered, `talkTo`; '': `newWsWin`);
  queued: `talkUndo`, *Undo* (`talk-undo`: `queueSet` without it, refused once it went). Esc drops it;
  `VOICE_MAX_MS`/`VOICE_SHORT_MS` as voice.ts'. Q10: Settings › Voice › Talk key's *It goes to* (`settings.talkTo`:
  `ai`; App's floats `talkAi` while Laki AI is on) makes Laki AI (`AI_TO`) the pill's first target, and Tab goes on to
  it either way while it's on (`talkNext`'s `ai`); sent to it, main's `aiTalk`: words that ask for the screen
  (`talkShot`: screen, скрін, екран, Bildschirm…) take the screen under the pill (`screenshot` `-R`, the pill hidden
  meanwhile, `imageSave`) as the ask's image; no Screen Recording: asked without it, said on the pill. macOS's own microphone prompt the first time (`mic`
  `not-determined`: the pill says why first). ponytail: press to start and to stop: globalShortcut has no key-up, a
  hold mode needs a native helper. `npm run test:ui`'s `talk-pill` opens it (`smoke`: no microphone). Tested in
  `test/talk.test.ts`.
- **Route by first words** (Q5, `settings.voice.route`, unset on; `aiWord`): shared/talk.ts `routeOf` (pure, tested
  in `test/talk.test.ts`): the words before the first comma, colon, spaced dash or pause (…, a sentence's end), 4 at
  most (a new task's project 4 more), after the word fixes (`voiceFix`: the Say it window's macOS dictation; the
  cloud's voiceText has them in): Laki AI's word (`aiWord`, else Laki; while it's on) → `@ai` (main's `aiAsked`:
  `aiAsk` in the background); `new task [in <project>]` → a new workspace there (`newWsWin(prompt, project)`: the
  new window's `?project=` and `new-prompt`'s); a workspace's name or a tab's `alias`, `norm`ed (marks off, Cyrillic
  in Latin letters, `- _ . / @` as spaces) and compared without spaces, exact first, else `dist` 1 (2 past 5
  letters); two candidates: none. App's floats carry `pid` and `alias`, `floatOpts.route` the projects, `aiWord`
  and `fixes`; main's `routeFor` adds `aiOn`, `last` (`talkProject`) and `lastTab`. The talk pill shows the match
  (`.t-to.moved`) `ROUTE_MS` 1.5 s, `ROUTE_FAR_MS` 3 s into another project than the last; Tab another, ⏎ or the key
  now, Esc not at all. Say it (voicePage): ⏎ routes once (`decided`): the text without its address, the select on
  its target, *sends in a moment* unless Esc, a keystroke or another pick stops it; no match with nothing picked:
  `talkDefault`'s. Only the floats' agent tabs, never a shell; nothing it routes runs a command.
- **A floated tab** (main's `tabWins`, `tab-float` IPC through App's `floatTab`: the tab's menu › *Float in its own window* (`popOut`), ⌘K, and the
  pane's *Show it* / *Bring it back*): `panelWin` `?window=tab&tab=<id>`, `NewWindow.tsx` `TabWindow` (its head the
  title bar; a `Term` of its own at the tab's ⌘± size: one more client of the session, the PTY sizes to whoever typed last;
  its ⌘-clicked files through main's `open-path`, which takes these windows too), closed when the
  tab goes. Main sends `floating` (the ids) as one opens or closes; App's `floated` shows `.floated` in that pane
  instead of a `Term`.
- **The global hotkey** (`settings.hotkeyOn`, unset on; `hotkey`, unset `HOTKEY` ⌃⌥⌘L, keyLabel's text): App sends it
  to main's `hotkey` IPC once settings come (main's `accelOf`: two of ⌃⌥⌘, or one with Space or an F key, else refused; → `globalShortcut`
  through `bindKey`, `keys.open`; it shows the app's window), Settings' `HotkeyField` too, which says when another app (or
  the other hotkey: `grab` never puts both on the same keys, and gives one the keys it asked for once the other lets go,
  `wants`) has it (`register` false); the Keys page shows the same group (`globalKeys`), and Help the keys in use
  (`GlobalKeys`: App's `hotkey` and `shotKey` once main took them, `held`). Screenshot to Laki AI (`settings.shotAsk`, on unless false, only while `aiOn`, a Mac only: preload's `shotKey`;
  `shotKey`, unset `SHOT_KEY` ⌃⌥⌘S): App's `shotKey` to main's `shot-hotkey` (false: off, `shotOn`; `keys.shot`), and the
  menu bar's *Screenshot to Laki AI…* while on: `shotAsk`, `screenshot` `-i` (one at a time: `shooting`), then `aiWin`
  with the PNG (`ai-shot`, or `aiShots` until the page's `ai-shot-ready`, `did-navigate` its reset: preload's `onAiShot`); `AiWindow` hands it through `AiPage` to PromptInput's
  `shot`: added as a pasted image (`add`), then the mic on (cloud's `voiceStart`, else macOS dictation) as the window gets
  the focus (5 s at most).
- **`Find.tsx`**: the ⌘F bar (`@xterm/addon-search`). Matches are `--find` (yellow); while it's open the
  terminal's `minimumContrastRatio` keeps their text readable. In a diff (Changes' `sp-body`, the full review's
  `.full-review`, each `data-find`), Diff.tsx' `DiffFind` instead: App's `findIn` sends `laki-find` to the `[data-find]`
  the pointer went down in last (`lastDown`), or the full review while it's shown; the lines' text found by a
  TreeWalker (not `.dl-n` or `.dl-blame`), marked by the CSS Custom Highlight API (`laki-find`, `laki-find-on`),
  found again as the diff changes (a MutationObserver); a folded file's lines aren't drawn, so aren't found.
- **Errors** (ui.tsx `Boundary`): main.tsx wraps every window's root and App's `Lazy` each lazy page (`Waiting` its
  Suspense fallback): a throw while drawing, or a page's code gone (remote access after an update), says so with
  *Reload* (and *Close* for a page) instead of a blank window. Main's `render-process-gone` reloads the window, at most
  once a minute.
- **`themes.ts`**: `THEMES`, `applyTheme` (sets the CSS variables on `<html>`, some also under the names Laki
  Go used; `default` leaves the stylesheet's; then `gateRules`: a rule whose every selector starts with another look's
  or motion's `[data-look="x"]` gets the selector `#laki-off` until that one's picked, its own text kept: Chrome tried
  all 500 on every element, `[data-look] :is(…)` can't be filed under a class), `termTheme` (xterm colors from `--ansi-0…15`). Gradient themes set `--app-bg` and a
  transparent `--term-bg` (xterm runs with `allowTransparency`). A theme after a game or film has an evocative name
  and its `aka` (the game's or film's words), which Settings' theme finder also matches. `--accent-ink` is the accent as text (every `color:`
  of it; fills and borders keep `--accent`): `readable` darkens it (lightens, on a dark theme) to 4.5:1 on the theme's
  background and panels, so a light theme's bright accent stays bright where it fills; `--on-waiting`/`--on-error` are
  labels on those fills (`onAccent`). `test/contrast.test.ts` holds every theme to WCAG ratios (text 4.5; hints, status
  marks and terminal colors 3, a mark on the selection 2.5 (its shape tells it too), the dim grey 2.5; on the main area,
  the sidebar, the rail, panels and the selection; a gradient theme's on both ends): a new theme or color must pass it. A look that fills a selected tab or row gives its marks the text's
  color (looks.css' last rules).
- **`fonts.css`, `components.css`, `looks.css`** (V2: once one `looks.css`, in that order after `styles.css`, main.tsx): the bundled fonts (Inter, JetBrains Mono, the other terminal fonts and the interface ones, `themes.ts` `UI_FONTS`; `fonts/NOTICE.md`), syntax colors (`.hl-*`), a look's tab bar
  line as `--tab-line` (a gradient across it as `--tab-line-bg` and `--tab-line-w`, one down it as `--tab-line-img`):
  styles.css' real tab draws it beside the selected tab (the bar's `::before`/`::after`, CSS anchor positioning on the
  tab's `--laki-tab`) and as the tab's border, never under it; not on a phone or the pill looks), glass
  (`html.glass`; Design's Frosted: `paintOf` forces glass, `applyTheme` sets `data-look` to it over the theme's, main's `glass` IPC moves the traffic lights into the sidebar's panel and `window.json` keeps that for the next start, looks.css' last block) and the creative themes' looks (`[data-look=…]`, from a theme's `look`; their own fonts only with `uiFont` `theme`, `html.theme-font`:
  else looks.css' last rules give them `--ui-default`, SF Pro, Inter off a Mac), some selectors also name
  Laki Go's classes. `applyTheme` takes a `Paint` (theme, `uiFont`, glass and its sliders `glassWindow`/`glassSide`/
  `glassTerm` and `glassGlow`, and `sideClear`, and `motion`: `html[data-motion]`, Appearance's Motion, styles.css'
  last block: none ends every animation and transition at once, high adds entrances, a stagger and presses; `vertText`:
  Appearance's Vertical text, `--vt` on <html> (`sideways-lr` up, `vertical-rl` down), which every sideways label's
  `writing-mode: var(--vt, <its own>)` takes (`.fr-vert`, the Board's empty columns, plans.css' `.sd-lane .sd-label`); `paintOf` picks them from the settings, `paintKey` is what terminals watch). Glass sets
  see-through `--app-bg` (with the glow's radial gradients), `--side` and `--rail-bg` (`glassSide`) and `--term-bg` (`#rrggbbaa`: xterm reads only
  that); `sideClear` (Settings' *Sidebar see-through*, without glass) only `--side` and `--rail-bg`, with `html.side-clear`
  (a clear body, `.main` alone on `--app-bg`; glass in the app too: the sidebar's slider is over the desktop, not the Window one's background) and the window's blur (`blurred`; the new-workspace window never: `NewWindow`'s paint); what floats is nearly opaque, never `backdrop-filter` (over the see-through window Electron repaints it badly:
  flicker, stale tooltips, rectangles around menus); the window's own blur is native
  (V5) *Translucent sidebar* (`translucent`, on unless false; `themes.ts` `material`: macOS's app, the Classic design, no
  glass, not Reduce transparency): `sideClear` there is its tint (unset or 0: `MATERIAL`, 85% of the sidebar's color, its
  own alpha dropped), main's vibrancy the `sidebar` material (`glass`'s 4th argument, `side`; glass keeps `under-window`),
  `html.material`: the tint once on `.app`, the rail, sidebar and status bar clear over it, `.main` a card (inset, `--r-panel`,
  a hairline, `--lift-2`); `--side-fg`/`--side-muted` (`materialInk`: `readable` over the tint on white and on black, the
  worst a wallpaper can be; `test/contrast.test.ts` checks every theme) for the words there. A Mac with it off: solid.
  (`setVibrancy` over IPC, App's `glassed`; `themes.ts` `LESS_CLEAR`: macOS's Reduce transparency turns glass and `sideClear` off in `applyTheme` and `blurred`, Settings notes it under Glass; `MORE_CONTRAST`, Increase contrast: `--muted` and `--line` halfway to `--fg`; the Paint's `highContrast`, Appearance's *High contrast mode*, off unless true: most of the way, and `--accent-ink` `readable` at 7:1; App repaints as either changes). `main.tsx` loads the fonts
  before the first render: a terminal measures its cells once.
- **`highlight.ts`**: the file preview's syntax colors, a regex per language family, up to `HL_MAX` (50 KB), and a
  workflow file's (`highlightWorkflow`, a line at a time: the Workflows editor's File view);
  tokens become React text, never HTML.
- **Sidebar styles** (`settings.sideStyle`, `SIDE_STYLES` in Settings.tsx): `.sidebar[data-style]`; status: `wsRow`'s
  `data-state` (its rollup) colors the row's bar, `.ws-line` fills to `--p` (its agents' highest `progress`); Sidebar.tsx' `wsRow` adds
  `.ws-sub` (branch, `STATE_WORDS`, progress, PR, diff) for extended and cards, `.ws-last` (the agent's last answer)
  for cards; compact is CSS only. Extended and cards keep the ⋯'s place (`visibility`) and the marks on hover: rows as tall
  as their first line's marks would jump. `sideLook.icons` is `--ws-icon`, every row mark's size (avatar and GitHub's alike).
- **CSV** (`SidePanel.tsx` `CsvTable`, `text.ts` `csvSep`/`parseCsv`/`toCsv`): a `.csv`/`.tsv` preview's Table (or
  Raw, `laki.csv`); editing a cell rewrites the file through `toCsv` (`parseCsv`'s `quoted`, cell by cell: a quoted cell stays quoted, a
  new row's like the row above, a new column's like the cell before; LF only: FilePreview's save puts CRLF back), saved like the
  text edit. ```` ```mermaid ```` blocks: `MarkdownView.tsx` `Mermaid`, the `mermaid` package imported on first use
  (`securityLevel: strict`), each chart an `<img>` of its SVG (inline, a brainstorm's 50 were 18k nodes that every
  next chart laid out again), in `FONT` (an image has no web fonts), drawn once ui.tsx' `useNear` says it nears the
  screen, one at a time with a yield between (`turn`), kept by theme and text (`pics`, 200). `useNear` also holds back
  diagram.tsx' `DiagramView` (a React Flow each) until scrolled to; a prototype's frame is `loading="lazy"`.
- **`shared/markdown.ts`**: `markdown` (blocks) and `inline` (shared: a shared tab's page renders it too): a Markdown file as a tree (GitHub's common subset; `html`: GitHub's text and a repo's files, `fromHtml` reads its tags into the same tree, `<details>` a `details` block, unknown tags and code left as text; never for what people and agents say), which
  `MarkdownView.tsx`'s `Markdown` (and `Folded`: a few lines, Show more) renders as React nodes (code blocks through `highlight`; links open in the browser,
  images show as links: the preview fetches nothing). `FilePreview` switches Rendered / Raw (`laki.md`; a jump to a
  line opens Raw). Tested in `test/markdown.test.ts`.
- **Quick Look** (U14): Space on a focused file row (Changes, the full review's list, Files, Artifacts: ui.tsx `act`'s
  `space`) or a file menu's *Quick Look* (menus.ts `fileMenu`) calls `PanelApi.look`, App's: the workspace's `path` (an
  artifact: `storage`) joined with the row's path, never typed text, then `bridge.quickLook`, main's `quick-look` (`from(e,
  'tab')`; a regular file after `realpath`; macOS only: `BrowserWindow.previewFile`). None for a deleted file (`D`) or a
  workspace with a `host` (SSH, a codespace).
- **Artifacts in Files** (`SidePanel.tsx` `Files` `root`, App's `filesRoot`): with a storage folder, Files has
  *Workspace* / *Artifacts* (`PanelApi.artifacts`: `artifactList` as the tree, the preview's `storage` (read-only,
  `openLabel` Open: App's `openArt`), a right click: Open, Show in Finder, Copy path; no new files). The status bar's
  *Artifacts: n* toggles `ArtifactsBar`; its ⋯ (`ArtifactsApi` `reveal('')`, `files`: `artifactsInFiles`) and the big
  view's buttons go to Finder or there (one shown big: the list again every 2 s, a file written anew read again by its
  time; `ArtifactView` looks at `fileRead`'s `stat` every 1.5 s, a change reads it or loads the page again). An HTML or Markdown one (`VIEWED`) opens in `ArtifactView` (panels.tsx, a
  `Modal`; App's `artView`) unless `settings.artifactsIn` is `browser` (Settings › General › Storage; then main's
  `open-path`, as any other): HTML in an iframe `sandbox="allow-scripts"` from the daemon's `GET
  /artifact/<the workspace's artKey>/<ws>/<path>` (main.ts `artifactPage`: core's `artifactFile`, the storage folder through
  `inside`, never a host's; a CSP `sandbox allow-scripts`, its own files and https: scripts, styles, fonts and pictures,
  `connect-src 'self'`: its JSON beside it, CORS null; 50 MB a file); *Open file* and the right click's *Open the file*
  (App's `asFile`, main's `open-file`: an HTML file inside the storage folder as `file://` in the browser, asked for), so the CSS, scripts and pictures beside it load; Markdown through `fileRead`;
  *Open in the browser* (App's `inBrowser`, the gallery's and the right click's too), *Show in Finder*. The gallery's big view frames HTML the same way (`ArtifactsApi.page`), and
  its right click has *Open* (the viewer) and *Open in the browser*.
- **`text.ts`**: `actionsFor` (Run ▾'s actions as it opens: `settings.actions`, then the project's `config.actions`,
  which replace a global one of the same name and target; an agent's only with a live tab of it (`any`: any
  agent's), the focused one first; a shell's to the focused shell at its prompt (`ActionTab` `busy`: a command in
  front, vim, a server, an agent it runs), any other at its prompt, or none: each app's `runAction` opens one),
  `SHELL_SPIN`, `shownStatus`, `spins` and `spinsUntil` (a shell's or Run tab's command spins its first 5 s only, then
  shows idle; an agent, and one a shell `runs`, its whole turn; App draws again as one crosses it, and `tabGlyph`,
  Glyph's `rollup`, the rail's dots and the filter's *Working* go by it), `parseMails` (a tunnel's who-gets-in: `@team.com` and `team.com` become `*@team.com`) and
  `MAIL_OK` (what the daemons take: kept in step with their `MAIL`/`mailRe`); prompt templates (`templated`, `fillTemplate`, from `shared/types.ts`: the daemon's `prPrompt` uses it too; `{{prompt}}`, `{{project}}`, `{{base}}`;
  `settings.templates` and a project's `config.templates`, merged by `templatesFor`: the project's first, replacing a
  global one of the same name; filled in by the new-workspace page; `nameOf`: a templated workspace's name from the typed
  prompt, the daemons' first-4-words rule) and `shortPath` (the ⋯'s *Copy path* hint).
- **`PromptInput.tsx`**: `useComplete` (@ a file, # a PR or issue, / a template; the box's `complete`, `completeOf(view, …)`:
  each kind read as its menu first opens, a minute; Esc keeps the word, a space or the caret out of it opens the next);
  a prompt with pasted/dropped images (saved by the daemon) and dictation (the mic's ⌄: where
  macOS picks the microphone and languages, `dictationSettings`); `tools`: the page's pickers at the toolbar's end;
  `saveFile` (`fileSave`; the new-workspace page's and the board's, never Laki AI's): any other file (HEIC, SVG too) a
  `FileChip` (icon, name, size, ✕; an `Img` without `url`), refused past `FILE_MAX` before it's read (the socket would
  drop); `files`: the caller's own (Desk's). A folder dropped in is its path typed at the cursor (`pathText`, Term.tsx's
  drop), never read (`webkitGetAsEntry`). `withImages` appends their paths (`text.ts` `withPaths`: a line each, in
  JSON's quotes when one has a space, a quote or a backslash). The mic keeps the text box focused and starts dictation 150 ms later: macOS
  learns the web view's text field a moment after focus, and dictation started before that stops at once.
- **`Info.tsx`**: the right panel's Info tab (`InfoTab`, App's `SidePanel` `info`; ⌘I and ⓘ open the panel on it): the
  workspace's name with a rename pencil (`.info-name`), then `.info-facts`: a card of one-line `Row`s, the whole value in `data-tip`, a
  copy button on hover, a row's `acts` beside it; the path and storage `shortPath`'d, `$PORT` opens `localhost`, each
  public link: `WsInfo.tunnels`, `onCopy`; *from* and *started*, the workspaces `from` ties (`onWs`: it selected), and
  *related* (`refLabel`: PR #n · repo; a PR's *Make it this workspace's PR*, `onPrimary`: `prAttach`; ✕, `onUnrelate`:
  `wsSet` `unrelate`; the PR shown below left out); the PR ⋯'s *Not this workspace's PR* for a linked one, `onDetach`: `prDetach`) and the status bar's PR (`PRStatus`, `AutoToggles`, `ciText`);
  each app maps its workspace to `WsInfo`. `PRSection` (Info's and Review's): title, a muted meta line, one row
  of Merge ▾ (`.split.green` when nothing `blocked` it: conflicts, failing or running checks, changes requested, `ready`
false), Approve, then GitHub and ⋯ (checks, files, *Close pull request…*) square at the end (neither Merge nor Approve:
  *Open on GitHub* and ⋯ first in the row), the
  body as `Folded` Markdown (MarkdownView.tsx's: 6 lines, Show more), `Checks` (failing, running, passing, skipped, each
  with `took`, the daemon's seconds, and its URL; a summary line), *Let the agent fix*: `AutoToggles` with `row`, a
  switch per row and *Send now* (`send`) only when there's something to send (failing checks, `threads` open, an
  older daemon's or Info's unknown, or conflicts).
- **`ui.tsx`**: line icons (`Icon`, `IconButton`), `Switch` (every on/off: the auto toggles, Settings' rows as
  `switch-row`), popup and right-click menus (`useMenu`: the open one is `MenuSlot`'s state, one element for good, so opening or closing
  draws the menu alone, never its caller (App); color swatches;
  each item has a key: its own `key` or a free initial, `menuKeys`; `sub`: a line under the label, `pill`/`tone`: a tag at
  its end, `mono`, `foot`: under a line at the bottom, its icon at the end; `tip`: its tooltip (Run ▾'s actions: their text); `items`: a submenu beside it (a hover, a click, → or ⏎; ← or Esc back), as the ⋯ menus' *Open in*; a picked item (`hint` `ON`) is in the accent
  with a check; `{ filter }`: a box on top, letters go to it, ⏎ runs the first label match (else the picked one), Esc
  clears it first, its `typed` an item for what's typed itself, first; such menus are `.menu.rich`; one flipped above its button is held by its bottom),
  tooltips (`Tips`: any element with `data-tip`; a pressed one shows none until the pointer leaves it, a menu it opens stays clear; `IconButton` `tip={false}`: an `aria-label` only), tab colors (`TAB_COLORS`, shared/types.ts' (the daemon checks a project's), `colorVar`: CSS `--tc-<name>`),
  `iconItems` (*Icon…*: every `ICONS` name by `iconWords`, an emoji typed or pasted, `emojiOf`; *Emoji…*: icons.ts `EMOJIS`,
  a menu item `{ emojis }` drawn as a grid its filter narrows, ⏎ the first; *No icon*: a Desk tab's, a
  project's), `ProjectMark`,
  sidebar rows dragged into a new order (`useRowDrag`, `moveId`; rows carry `data-row="kind:id"`), `Page`
  (a page over the main area, like Settings: the new-workspace form), and `ask` (a yes/no in the app's own dialog,
  `AskHost` in App: never `confirm()`, the OS's sheet; its keys stay in it (`stopImmediatePropagation`: not the page's Esc too), Esc or outside is no; a newer one covers it, `waiting`, and it comes back as that closes; `unchoose(tag, i)` closes one on screen or waiting).
- **`Project.tsx`**: a project's page (a click on its name in the sidebar, its ⋯ › *Open project page*; dialog
  `{ project, tab? }`: its ⋯ › Settings opens that tab, else the last one, `laki.projectTab`): Notes (panels.tsx' `NotesView`, also the ⋯ › Notes dialog's:
  an edit saved as it unmounts), Scheduled tasks (Schedules.tsx' rows, a switch each; changes on that page), Memory
  (`Project.memory`, `{ id, text, at, edited, auto, by }`, the whole list through `projectSet`: *Yours* and *Learned by
  agents*, `MEMORY_MAX` each, a learned one's pin keeps it as yours; never in MCP's state or `ls --json`; `MemoryList`, also Settings' Global memory with `global`: yours only) and Settings (SettingsProject.tsx' `ProjectSection`, `noNotes`). The sidebar's
  arrow folds; Terminals and Browsers have no page.
- **Design tokens** (V2, styles.css `:root`): `--sp-1…6` (2, 4, 6, 8, 12, 16px), `--r-xs…xl` (each `var(--rs, n)`: Settings'
  Corners over all; a look's `[data-look]` root sets its own from its `--radius`) and `--r-pill` (`--r-xl` × 999: a capsule,
  square where every corner is, a square look's or Corners' Square), `--radius` = `--r-m`; a Design's cards' `--d-r` takes the
  look's `--r-xl` when smaller (Llama Amp's Winamp look: square cards, tabs and dialogs alike),
  `--lift-1…3`, `--h-s/m/l` (22, 28, 34), `--z-dialog` 10 < toast < page < ask < pop < drag < tip < `--z-top` (a raw
  z-index only within a part, under 10). Chrome: heads and the tab bar 40px, rows and bars 28. A toast is neutral;
  `err` (App's `fail`, `toast(…, err)`) gives it the red edge. `test/css.test.ts` checks styles.css; looks.css next.
- **Concentric corners and inset selection** (V6): `--r-window` (dialogs, menus, popovers, the peek card), `--r-panel`
  (cards: Needs you's, a settings group), `--r-control` (buttons, fields, rows, tabs), `--r-chip` (counts, status chips); a
  nested one is its parent's minus the gap (`.menu`'s `--mp`). Sidebar rows, palette and menu items sit inset (a margin
  each side) on `--r-control`: hover a neutral fill, selected the accent at 20% (a row's own color bar stays). Classic's
  tabs (no Design traits: `.app:not([data-dz], .narrow)`, not the pill looks) are segments, the open one a soft fill and its
  color a line under it, out of the joined-tab rules' `:not()` lists. css.test: no raw px corner in any sheet but looks.css.
- **Keyboard and screen readers** (U11): the sidebar's `.side-scroll` is a `role="tree"` (Sidebar.tsx `treeKey`, `rove`):
  project heads, Pinned and Needs you's head are treeitems at level 1 (`aria-expanded`), groups and rows at 2
  (`aria-selected`), each `.project-ws` a `group`; every treeitem is `tabIndex={-1}` in JSX and a layout effect keeps one
  at 0 (the selected row, else the first) unless the focus is in the tree. Keys go to the focused treeitem only (a
  button inside keeps its own). A click on anything that isn't a control goes through ui.tsx `act` (role button,
  tabIndex 0, Enter and Space) or carries a role of its own (a backdrop's `presentation`): `test/a11y.test.ts` `mute`.
  Inputs ring on `:focus-visible`; a PR's mark has a shape per state (merged, ×, dashed draft) and an `aria-label`;
  the context meters say their level in words (Usage.tsx `levelWord`).
- **Settings' Basic view** (U10): `view` (`laki.settingsView`; unset: Basic with no projects, else All; a `section`/`spot`
  or Find a setting: All). Basic's nav is settingsMap.ts `BASIC` (four heads, each `[section, card title]`s, `*` all of
  one); `on(id)` renders those sections, SettingsKit's `Shown` context makes `Group` return null for a card not named,
  and `.settings-main[data-basic]` hides the sections' own h2 and notes (anything not a `.set-group`). `isBasic` marks
  Find's hits and `laki_settings_find`'s `basic: true`. Appearance is `appearance` (Theme & type: old links land
  there), `layout` and `extras`.
- **`Settings.tsx`**: the settings page (⌘,; its sections' parts in `SettingsKit.tsx` (`Says`, `Group`, `Scope`), `SettingsAgents.tsx` (AI, Voice, the skill and accounts), `SettingsProject.tsx` (a project's section and the fields the global ones share), `SettingsConnect.tsx` (phone pushes, remote access, simulators), `SettingsResources.tsx` and `SettingsExtensions.tsx`, which it re-exports), autosaved, zoomed by the terminal font size times `settings.pageZoom`
  (`PAGE_ZOOMS`, Appearance's *Settings & Help size*; ⌘± while it or Help is open; Help takes the same zoom; its
  preview cancels that); the nav's sections under a head each (`SECTIONS` `group`: Laki, Agents, Connect); each section's settings in
  `Group`s (a titled card, `.set-group`: a new block of settings goes in one, or a new one); `VarChips` under a
  template (`TEMPLATE_VARS`) and a preset's args or command (`ENV_VARS`) put a variable in at the cursor of the field
  just before them (in a `.preset` card, shown only while it has the focus); presets, `EnvField` (KEY=value lines), fonts,
  `termLook` (line height, weight, cursor… as xterm options; Term takes it as `look`), `termPad` (*Padding*: `.app[data-pad]`, the `.term`'s inset and the preview's padding; tiny on a phone too, roomy not) with a live preview
  (`TermPreview`, keyed on `transparent()` like `Term`), Actions (`ActionsField`, also in each project's section: a duplicate button, a *Show* filter by target), Appearance (themes, the current one outlined and checked, a name filter that stays in sight, a ☆ on each (`favThemes`: Favorites, a group first, each one still in All themes too);
  accent color and corners: `accent`, `radius` in `Paint`, set by `applyTheme` over the theme's and its look's (`radius`
  also as `--rs`, which every fixed px radius in looks.css and styles.css takes first, `var(--rs, 10px)`: keep new ones so;
  pills (999px, or half their height: `.pr`, `.tag`, the switch's track) and circles (50%) stay),
  `--accent-fg` by `onAccent`; `tabsAt`;
  `PROJECT_LOOK`: the sidebar's project names over the theme, `settings.projectLook`, App's `phAttrs`/`phVars` put them
  on `.sidebar` as `data-ph-*` and `--ph-*`, styles.css overrides any look with `!important`; its `color` (`data-ph-color`,
  unset `auto`): `--accent-ink` in every theme but the looks whose head is a band of their own (starship, luna, mission,
  islander), `own` the project's color, `theme` none; `SIDE_LOOK`,
  `settings.sideLook`: the sidebar's lines and rows as CSS values, App's `sideVars` sets `--ws-guide`, `--proj-divider`,
  `--ws-indent`, `--ws-h`, `--ws-font` on `.sidebar`, nearer than the looks' own, set on `[data-look]` at the end of looks.css;
  `sideLook.labels === false` hides the bottom buttons' words; interface font, glass: `paint` applies
  them at once, before the save), Prompt templates (`TemplatesField`: `settings.templates`, and each project's; the global sections, it and Actions, open with a `Scope` note, `.set-scope`: Global, everywhere, and where a project's own go; a project's two say *This project*: only there, with the global ones, counted (`mergeActions`, `templatesFor`), and a link to the global list), Keys (`KeysSection`: a `KeyField` per `KEYS` action, Reset all, `keyClash` against the global hotkeys and the picker as `others`; `settings.keys` only the changed ones), Remote access (`RemoteSection`, shown when App.tsx
  passes `remote`: the email, 1h…72h or Forever, then the QR code and link), and `ScriptsField` (a project's
  setup/teardown/run scripts, Import from a file), Resources (`ResourcesSection`: `resources` every 3 s while open,
  Laki itself and each tab by RSS with its processes, Sleep/Open/Wake, `settings.sleepAfter`; App.tsx passes a
  `ResourcesApi`), Pull requests (`PR_KINDS`: the PR switches' prompts over `PR_PROMPTS`,
  each with Reset; `prScan`, `prTries`), and General's Export/Import (`laki-settings.json`: `{ laki:
  'settings', version: 1, settings }`; text.ts `exportable` leaves `PRIVATE` out (env, webhook, remoteMail, tunnelMails,
  flowVars, presets' env) and `importable` never takes them; an import goes through `paint`, so it's painted and autosaved like typing, after
  `KINDS` refuses a field of the wrong kind: add a new list, object or number setting there). *Find a setting* (`FIND`: section, the title as the page writes it, more
  words; add new settings there) opens a section and lights (`.spot`) the first label, row or heading that starts with
  the title. FIND is also what's *new*: settingsMap's `freshOf` against `laki.settingsKnown` (every entry at a fresh
  install), the nav's `.set-new` by a section, SettingsKit's `Fresh` context a chip on its rows (Says) for that visit. Settings' `spot` (App's dialog `{ settings, spot }`: Run ▾'s *Edit the run script…* → Scripts, *Edit actions…* → Actions)
  opens at that `Group`'s card, lit the same way (a ring, a halo and a tint, 2.6 s). Hovering a theme paints it (`applyTheme`), the chosen one again as the mouse leaves `.themes` or the page closes. A
  setting back at its default is saved as that value: an unset key wouldn't replace the saved one. Projects
  are sections of it, under the nav's *Project settings* head (`ProjectSection`: name, a Memory row (its counts;
  *Manage*: `onMemory`, App's `{ project, tab: 'memory' }`), scripts, env; saved 400 ms after typing and on leaving).
  Global memory (`memory`: `settings.memory` through Project.tsx' `MemoryList` `global`); Release notes only with
  `devMode`; General's Storage has `artifactsIn`, its Pages My Desk, Bird view, Specs & Brainstorms and Workflows (on unless false), Settings › AI the glow's; Appearance's
  Rail `railShells` and `railBrowsers`.
- **`SidePanel.tsx`**: the right panel (⌥⌘B): Info (`PanelTab` `info`, first, any project: App passes `InfoTab` as
  `info`), Files (tree from the daemon's file list, search, new
  file/folder, changed files marked), Changes (the diff by file, each file's row sticky over its diff as it scrolls, Expand all / Collapse all (one button: collapse while any is open), each line with its old and new numbers from the
  hunks; a click opens `CommentBox`: the PR, or the agent; an image, `IMAGE`, is `ImageDiff`: `PanelApi.read` with `base`
  for before, as `<img>`, SVG too, a click for full size), Review (`PRSection` from `Info.tsx` with the open
  threads' count; `ThreadCard`s: file:line, a click previews it there, each comment's author, `ago` of its `at` and its
  body as `Folded` Markdown; resolved ones in a `<details>`; a ```` ```suggestion ```` block (`text.ts` `suggestionOf`: 3+
  backticks or tildes, the first one) as `Suggested`, a small diff of the file's lines now (`linesAt`, `PanelApi.read`
  per file with one) and the suggested ones, with Apply (`editOf`: an open thread, not outdated, `side` RIGHT, `hunk`
  given; what the review saw is `reviewedLines`, the hunk's new-side lines ending at `line`, `startLine..line` long) and
  *Apply all n in <file>* (each open thread's newest, those still as seen): App's `PanelApi.apply`, `fileRead`, then
  `applySuggestions` (bottom-up; refused as "changed since the review" unless each range is what was seen, overlaps
  refused; the replaced lines' endings, the file's last newline as it was), `fileWrite` with `was`, a toast whose Undo
  writes it back the same way; no commit, push or resolve. Tested in `test/suggest.test.ts`), Preview (above; a narrow panel shows the other tabs as icons, a container query); `FilePreview` (a click in Files, or a thread's line; App keeps several, `openFiles`, a tab each over it, `.pv-tabs`,
  by `fileKey`, each with its own `edit`; `shownFile`: each workspace's in front; ⌘W or a middle click closes one, an
  edit asked first; its left edge is a `PanelHandle`, `previewW`), `FileFinder` (⌘P, `findFiles`: a
  basename match first); a right click in Files is menus.ts' `fileMenu` (`PanelApi.menu`: default app, browsers for `WEB` files, Open in, Copy path); `RunButton` and `actionMenu` (Run ▾'s Agent and Shell actions, each item's `tip` its text, cut at `ACTION_TIP`; App's `runMenu(w)`, the toolbar's and a sidebar row's *Run ›*). App.tsx passes a `PanelApi` over the daemon.
- **`Tunnel.tsx`**: Expose to the world: the status bar's globe next to each port (`TunnelButton`) and its
  popup: install instructions when cloudflared is missing, who can open it (anyone with the link, the default,
  or only some emails and `*@domain`s), then a QR code and the link; with emails, chips of who gets in, the bad ones flagged, a webmail domain too (`text.ts` `webmail`: anyone can get an address there, a warning line); *Anyone with the link* says localhost-trusting dev tools are reachable. `portsOf`: listening ports plus tunneled ones. App.tsx passes a `TunnelApi`. `QR`: a code
  as SVG, also Remote access's. `SharePop`: Share a tab's popover (for how long, `SHARE_FOR`; then the QR code, the
  link, `timeLeft`, Stop sharing).
- **`Shown.tsx`**: a workflow's Show you window (`ShownDialog`, App's `shown` queue): HTML in a sandboxed `srcDoc`
  frame with a CSP and the app's colors, else Markdown; Close or Next, the run's button.
- **`Compare.tsx`**: a race's page (`Page` `wide`; dialog `{ compare: <race> }`: a race workspace's menu, ⌘K, and
  right after the new-workspace page's *Race* makes one): a column per live workspace of the race with its status,
  diff size, the agent's last answer and the files `diff` lists (again as `stat` moves); *Keep this one* archives
  the others (`wsArchive`, after a confirm) with *Undo* (`wsRestore`). App.tsx passes a `CompareApi`.
- **Laki AI's glow** (`settings.aiGlow`, on unless false, Settings › AI): Laki AI's looks (`shared/tools.ts`' `aiRpc`: its tools' `screen` and
  `browse` with `by: 'ai'`; the OpenRouter backend's `toolsFor`, the claude/codex one's `laki mcp` with `LAKI_AI=1`; the
  chat's `whereNow` screen too) make core's `screen`/`browse` broadcast `peek` (ws, tab). App's `PeekGlow`: over that
  tab's `[data-pane]` when shown, else the window (`.ai-peek`, a conic `--peek-a` edge turning once and inset shadows,
  2.6 s, its own `animationend` clears it); none while `html.away`.
- **`Calendar.tsx`**: Calendar (`settings.calendar`, on unless false; the rail's Calendar after Flows, ⌘K; dialog
  `'calendar'`): a week (Monday first) or a month (`laki.calendar`), scheduled tasks' times to come (`occurrences`: a rule
  with more than `MANY` a day is one line; a once task its `next`), the runs' log in the past, reminders (a tick: done,
  a click: its workspace, ✕ on hover); a day's click or *Reminder* opens the form (`datetime-local`, a workspace). The
  rail's count: rung reminders not ticked off. `Page` `esc={false}`; `.cal-bar` on the page (‹ *Today* ›, the title,
  Week / Month, *+ Reminder*); a day's click: `sel`, `aside.cal-side` (that day's tasks, runs and reminders, *Remind me
  this day*). App.tsx passes a `CalendarApi`.
- **`Desk.tsx`**: My Desk (the user's word; the code's is Desk: `settings.desk`, on unless false (Settings › General › Pages); the rail's My Desk, ⌘K; dialog `'desk'`): the extensions with `desk`
  among their `places` as tiles in a 12-column grid (`DESK_COLS`, rows `DESK_ROW`), `settings.deskTiles` their order and
  sizes (`SETTINGS_KEPT`; one placed here without one: `DESK_TILE`, last), and tabs: `settings.deskTabs` (`DeskTab`,
  `SETTINGS_KEPT`; none: one, `MAIN`), a tile's `tab` (none, or a tab gone: the first), the one shown `laki.deskTab`;
  the tab bar (`.desk-tabs`, shown once there's a tile or a tab): + (`addTab`, its name typed at once), a double-click
  renames, a right click (`tabMenu`) moves it, removes it (its tiles to the first of the others, under the tiles there, in one `save`) or gives it
  an icon (`DeskTab.icon`, before its name: an `ICONS` name, or an emoji typed or pasted in the filter, `emojiOf`, its
  `typed` item *Use 🚀*; ui.tsx' `iconItems`: *Icon…*, a submenu, `setIcon`; *No icon*) or a color (`DeskTab.color`, `TAB_COLORS`,
  `setColor`: its icon in it, else `.desk-dot`), a
  head dropped on a tab moves the tile there (`moveTo`: no cell, so under the tiles there), a tile's ⋯ › *Move to tab*
  too (or *A new tab*); Add puts one on the tab shown; *Fetch* only that tab's. Cells: a tile's `x`, `y` (`shared/types.ts`
  `deskLayout`: the one dragged or resized first, then the placed ones top to bottom, each pushed down past any it
  overlaps, then the unplaced as CSS grid's sparse flow would, under the placed ones: a gap left stays; Desk's `at` pins
  the tab's tiles where they are before one moves, so a tab never arranged keeps its flow); the head's pointer drag
  (`move`, 4 px, `track`: capture, blur, edge scroll, Esc back where it was; none on a phone's one column, `.narrow`) to the cell under it,
  onto a `[data-desk-tab]`: that tab; every tile of the tab saved in its cell after (`keep`, through `ends`: the tiles
  as they are at the drag's end); rendered in the saved order, placed by `grid-column`/`grid-row`, `order` for a phone's
  one column; the corner resizes it (pointer, snapped to cells; it ends at `lostpointercapture`, which a
  release, a cancel and a release the page never got (outside the window, over its title bar: Chromium drops the
  capture at the next move, no pointerup) all bring, or the window's blur or Esc: the size kept; on a phone, its height only); a tile shows the full view when there is
  one (`WidgetBody` `full`), else the preview; Add: the others, turned on with `desk` added; *Take it off*: its only
  place goes to `side`, off. Laki AI's off ones placed here show too (`byAi`), dashed, with their sample and
  `.desk-off` (*Look*: its page, *Turn on*). *Build with AI* (`DeskBuild`, a `Modal`: `PromptInput` with `files`, text files
  inlined by `deskAsk` (`FILE_MAX`), a screenshot through main's `shoot` IPC (`screenshot` with `then`); `DeskApi.build`:
  App's `{ extension: '', back: 'desk', start }`, the page's `Chat` sends `start` once (`started`), back in the box
  if it fails); `whereNow` names the Desk's tiles by id. `pending`
  (and `pendingTabs`): the tiles and tabs just saved (`DeskApi.save`, one `settingsSet`), shown until the settings
  bring them back.
- **`Picker.tsx`**: development mode's element picker (the rail's *Pick*, `data-rail="picker"`, else the side head's
  crosshair beside Help; `settings.pickerKey`, unset: `PICKER_KEY` ⇧⌘C, '' none, App's capture-phase keys (`keyLabel`)
  before everything, so over dialogs too; Settings' `KeyField` records it; `settings.devMode`): a
  shield over the window (`.picker-shield`: frames, webviews and hovers get no pointer; `elementsFromPoint` under it),
  capture-phase listeners (`html.picking`), a box over the element under the pointer with its component and size;
  a click: `inspect` (`selectorOf`, `componentsOf`: React's fiber on the node, classes, attributes, text, box, styles,
  HTML), main's `capture-rect` (the app window's pixels there, after two frames without the box) saved by `imageSave`;
  the dialog (`.overlay:has(.picked)`: over a page too, the Desk's, Settings') with *Copy the context* (`pickedText`,
  Markdown) and *Copy the screenshot* (`copyFile`); the press's own mouseup and click are swallowed too (`swallow`: they'd
  click what was picked). Esc or a right click stops.
- **`Bird.tsx`**: Bird view (`settings.birdView`, on unless false (Settings › General › Pages); the side head's eye beside Help, ⌘K; dialog `'bird'`):
  every live tab (not exited) of each live workspace, Browsers' left out, by workspace in project order, a card each
  with the daemon's `screen` (40 lines, every 2.5 s while open and the page is visible; a `<pre>` whose newest lines
  show), *All* / *Working* / *Needs you* (App's `needsYou`); a click is `selectTab`. App.tsx passes a `BirdApi`.
- **`Achievements.tsx`** (dialog `'achievements'`: the status bar's trophy at its end, `.sb-trophy`, ⌘K,
  Settings › Achievements' *Open achievements*, `laki://achievements`): `shared/achievements.ts`' 54 (`ACHIEVEMENTS`, in
  `ACH_GROUPS`), each with its `how` and `go` (Dialogs.tsx' `achGo`: a page, Settings' section, the right panel's tab; an
  experimental page that's off: where it's turned on). App's `earn` unlocks one once, only for what's done from now on: a
  call that went well (api.ts `onCall`, `earnedBy`: its `rpc` and `ok`; a `{ held }` or `{ dirty }` answer isn't), a page
  opened (`pageEarns`), a number or value of the view that moved since the last view (`upsOf`/`wentUp`; the first view,
  and the first after a reconnect, only notes them; a value back to unset isn't), or by id (⌘J, timers, the sidebar's
  filter, Changes or the Simulator once it wasn't on screen, a line's comment, a profile: Settings' save with more
  presets than in use, Settings' Resources and Simulators sections, a video played; main's `earn` IPC, preload's `onEarn`:
  the global hotkey, a bubble's click);
  a hidden one never. Kept in `settings.achievements` (`AchievementsKept`: `got`, `hidden`,
  `off`; `SETTINGS_KEPT`), written whole by App (`achSet`; `sent`, shown and built on until the view has it); Settings' own save leaves it out, so an
  unlock while it's open stays. The unlock toast (`.ach-toast`, over pages) groups one action's unlocks. Tested in
  `test/achievements.test.ts`.
- **`Board.tsx`**: the Board page (`Page` `wide`; the rail's Board or the status bar's columns icon, ⌘K, `laki://board`): the
  workspaces (not Terminals' or Browsers') in columns by `columnOf` (`rollup` from `Glyph.tsx`, then the PR's state), cards that open one (a right
  click or `.board-more`: `BoardApi.menu`, App's open, archive, delete; Merged's ⋯: `archiveAll`, one by one), and To
  do (`view.todos`): ▷ or an HTML5 drag onto a column runs `wsNew` with the default agent, then `todoRm`.
- **`Schedules.tsx`**: the Scheduled tasks page (ui.tsx's `Page`; the rail's Schedule or the status bar's clock, ⌘K, a project's ⋯ menu:
  App's `schedulesOf`, the dialog `{ schedules: <project> }`): `.sched-hero` (icon, what it is, filter, New task),
  `.sched-stats` (tasks, on, the next run `soon`, runs ok), a project filter (`only`, starting at `project`, a chip's menu), the form (the
  new-workspace page's `.nw-composer` with the agent's `.nw-pick`, a When field (`.sched-when`; `EXAMPLES` until
  `parseWhen` reads it, then its reading and the next runs), and `.nw-chip`s: project (*Another folder…*: `pick`, the
  folder picker, or a typed path in a browser, then `projectAdd`), where (`WHERE`, or a workspace) and name; the dated
  names), the tasks (`.sched-list`, a row each: its where's icon, name, the rule and a `.sched-next` pill, tags for project,
  agent and where; ▷ and delete on hover; its switch last), the runs' log (`RUNS`, a round mark, `ago`, then
  *Show all*; a click goes to the run's workspace). App.tsx passes a `SchedulesApi`; the clock has a dot (`.ib.dot`) when a run failed after
  `laki.runsSeen` (localStorage: the newest run the page showed). T4: *Or on an event* swaps the When field for
  `.sched-event`'s chips (`EVENT_WORDS`' menu, a branch or a label, by whom; `triggerWords`), such tasks under *On
  events*, a held run's *Run it* (`release`). T5: the *keeps its last* chip (`KEEPS`, emptyGone in its menu), a row's
  kept tag. T6: `.sched-paused` on top for a task off after failing, *Fix* (`fix`: its form, `spot` focusing the
  `data-field` of `pausedField`).
- **`Usage.tsx`**: the status bar's first item, the plan-limits ring (in the theme's `--accent`, then `--waiting` and `--error`; `UsageButton`: each agent's first window, the shortest: 5-hour; the busier agent's, asked
  every minute; hidden while the daemon has none) and its popup: each agent's windows, bars, when they reset, then
  *Today* (the view's `today`: Meters, above).
  `USAGE_AGENTS` names the agents Settings › Appearance has switches for.
- **`Help.tsx`**: the help page (⌘/, the sidebar's ?, ⌘K): keys (`keysOf`: Settings › Keys' in use, App's `kb`), status glyphs, where things are, the main CLI
  commands and recipes (`cli`: the app's command; `ship`: list `ship`), each section a `Sec` of `Item`s. Laid out
  like Settings (`.settings-nav`, `.help-nav`): a filter (focused as it opens, not on a touch screen; ⌘F or / goes to
  it; Esc clears it, then closes the page) keeps the rows with every word typed in their text (`textOf`) or `find`;
  the sections, the one in view lit (a scroll listener: the last whose top passed, the last at the bottom) with its
  named rows under it (chips on a phone); *The full guide* (`GUIDE`, from panels.tsx' `REPO`). Sections and named
  rows have stable ids, `help-<id>`, for a `laki://help#<id>` later. Keep it in step with the guide's keys and CLI
  recipes.
- **`qr.ts`**: a QR encoder (byte mode, level M, versions 1–40, best mask), for the tunnel's link. Its test
  compares a code with macOS CoreImage's (`test/qr.test.ts`).
- **`panels.tsx`**: the new-workspace page (ui.tsx's `Page`: over the main area, like Settings), laid out as paseo's:
  `.nw-top`, a row of `.nw-pick` menus over the prompt: project and `place` in one menu (each sep indented under its
  project: `MenuItem` `indent`), *New worktree* / *Local* (`whereMenu`: `local`), base (`.nw-base`, typed or picked), name,
  and *More* (a race, and a typed model only after the model menu's *Another model…* or while one it doesn't list is set:
  one picker, not two); at its end (`.nw-top-end`) template and agent (`OTHER_AGENTS` after the presets; each preset's
  line `presetSays`, Settings' default agent as a pill, *Make … the default* in the foot: `settingsSet` `agent`). Then
  the prompt's card (`PromptInput` `lead`: model (`MODEL_SAYS`: claude's words and a cost pill), effort and permission
  mode (`PERMS`) menus; `tools`: ⚡ `.nw-fast` (`FAST`); then the mic and `send`, the round `.nw-send` (a race's count
  on it)); `.nw-foot` under it (the keys, *Clear*);
  the last choices, `laki.newWs`; `images`: the menu bar's screenshots; while it's made, `.busy` fades the cards and
  `.nw-making` says what's happening and the seconds so far), the
  prompt and add-project dialogs (the last only for the web dev renderer, which has no folder picker), and About
  (`SITE`, the version from `package.json`, the build's time: `__BUILT__`, electron.vite.config.ts' `define`, none
  under `dev:web`; *Open-source licenses*: the build's notices through main's `open-path`, else the summary on GitHub;
  the app menu's *About Laki* is a `laki://about` link, main's `openLink`);
  `Ready` (a workspace without tabs: its starts, `TIPS`) and `StarLaki` (the repo, `REPO`); `Fun` (the status bar's
  smiley: `meme`, Next; a right click on it: copy (a PNG drawn on a canvas, the clipboard takes no other),
  download through an `<a download>`, open on Reddit). A PR's branch is `laki new --pr` (the CLI): the page has no PR field.
- **`links.ts`**: `parseLink` and `wsLink` (laki:// links, above).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

Laki was built twice while the stack was picked; the Go + Wails build is now its own repository
and nothing here keeps it in step. Many renderer files were
shared with it: some class and variable names in `looks.css` and `themes.ts` are its, and harmless here.

Labs (U1): `settings.labs` and types.ts' `LABS` (desk, specs, workflows, calendar, notes, todoList, railShells,
railBrowsers, videoButton, fun, timerButton). core.ts `load`: no state.json yet, each of them is saved `false` with
`labs: false` and `achievements: { off: true }` (U2); a state from before gets `labs: true` once and nothing else. Every
check stays the page's own *on unless false*; Settings › General › Pages' *Labs* switch writes them all at once. A test's
daemon is left alone unless `LAKI_TEST_LEAN=1` (`test/restart.test.ts`). ⌘K lists *Turn on <page> (Labs)* for the off
ones; Get started's steps are `stepsOf(settings)` (no Workflows step while it's off). Achievements on: one Unlocked toast
per `ACH_QUIET` (10 min), the rest count on the trophy (`+n`) until its page opens; off, `api.onCall` and the view's
`upsOf` do nothing.

The status bar (U3), left to right: the context meter, the branch, the codespace, the workflow run, the PR (number,
checks, conflicts, Info.tsx `AutoChip`: *Auto n/3*, a click opens the switches with a line each), Artifacts; after the
spacer the ports and the plan's limits (`UsageButton`), then Recording, remote access, the update, widgets, the trophy.

The Board's columns (U5): nextStep.ts `boardCol`, from `nextStep` and `needsTab` (the sidebar's Needs you rule, App's
`needsYou` without mute): Working, Answer (an ask, a secret, a failed agent), Review (a finish not looked at, look, ship),
Fix (check, CI, conflicts, changes asked for), Merge (a PR open: waiting or ready), Done. What Needs you counts is always
in Answer, Review or Fix (`test/next-step.test.ts`). An empty column is a 34px strip (`.board-col.empty`), wide under the
pointer or a dragged to-do.

The Review tab's room (U6): FullReview watches its own width (a ResizeObserver on its root). The diff keeps `DIFF_MIN`
(480px): short of it the comments fold to their strip (`autoOff`: not saved, `laki.reviewNotesOff` stays yours), then
`onTight` has App hide the side panel while the Review tab shows (`reviewTight`, back as you leave the tab); under
`HEAD_MIN` (720px) the head's count is `+a −d` without its "n files".

The type scale (B1): `--fs-1`…`--fs-5` (11, 12, 13, 15, 20px: counts and kbd, secondary, body, panel titles, page
titles) in styles.css `:root`; every `font-size` in px is one of them, but under 10px (badges) and over 22px (display
numbers); em, rem, a setting's variable and `calc()` stay (`test/css.test.ts`). Motion (B5, V7): `--t-fast`, `--t-mid`
(200ms), `--t-slow`, `--ease-out` (`--ease` its old name) and `--ease-pop` (a gentle overshoot), used by one block under
`prefers-reduced-motion: no-preference`, each selector in `:where()` so an element's own rule and Motion: high win. Only
`translate`, `scale` and `opacity` move (never a size: a list of many rows would lay out each frame; no `:has()`, so no
restyle of the whole window), nothing in the terminal: hover colors and a press's `scale: 0.985` on rows, tabs and
buttons; the side panel and the sidebar coming in; `.overlay` fading and `.menu`, `.modal` (⌘K is one), `.toast`
scaling in (`v-in`, 6px and 0.97); `.tip` fading; a Needs you card arriving; a row that starts to need you (`b-lit`); a
waiting glyph breathing (opacity, 1.8 s); a glyph turning done ticking once (Glyph.tsx `g-pop`, 400 ms, from the render
where its status changed: not as it's first drawn); a new row or tab growing in (`v-new`: motion.ts `fresh(id)`, an id
not seen since App's first view, `settle`; a drag reorders keyed elements, so nothing replays). Leaving: motion.ts
`exits` watches the body for a removed `.menu-backdrop`, `.menu`, `.overlay`, `.tip` or `.toast` (all `position:
fixed`, so a copy takes no room) and puts an inert copy back with `.leaving` (120 ms out, `!important` over Motion:
high's), removed by a timer. The side panel is in the flow: it only comes in. Motion: Off (`html[data-motion='none']`)
and the system's Reduce motion end it all (`exits` and `fresh` check both).

The system accent and the inactive window (V9): Settings › Appearance › Accent color: System is `accent: 'system'`
(its button only in the Mac app: themes.ts `macApp`). main's `accent` IPC (`from(e, 'new', 'ai', 'tab')`) answers
`systemPreferences.getAccentColor()` as `#rrggbb` (null off a Mac), and its change (macOS's
`AppleColorPreferencesChangedNotification`; Electron's `accent-color-changed` on Windows) goes to the app's own windows
as `accent`. themes.ts asks once as it loads and keeps it (`setSystemAccent`, `systemAccent`), painting the last
`applyTheme` again when that one asked for System; until it's known, the theme's. It's then a picked accent: its
`--accent-fg` and `--accent-ink` as for any. ponytail: terminals' cursor takes a new system accent at their next
repaint (the paint key is the settings'). Behind another app (`html.away`, main's `front`), styles.css' `html.away .app`
sets `--accent`, `--accent-fg` and `--sel` to neutrals of the text's color: fills, the picked row and focus rings go
grey; `--accent-ink` (resolved on `<html>`) and the status colors stay. ui-smoke's `inactive` step sends `front` false.

The floating surface (V8): styles.css' `--surface-a`, `--surface-bg` (the panel at 72%), `--surface-blur` (`blur(24px)
saturate(1.6)`), `--surface-edge` (a 0.5px hairline of the text's color) and `--surface-lift` (`--lift-1` and `--lift-3`),
on one `:is(.menu, .modal, .finder, .tip, .help-card, .toast, .ach-toast, .shown-pop, .tunnel-pop, .ws-peek, .link-peek,
.nw-start-pop, .pi-complete, .key-strip)` rule placed before their own rules (they keep what's theirs: a peek's colored
edge, a tooltip's small corners); a new float joins the list, never a list's row (`backdrop-filter` costs per pixel).
themes.ts `surfaceAlpha` raises `--surface-a` in 4% steps where a theme's text or hints wouldn't reach 4.5:1 over the
window, the sidebar or a blurred busy terminal (`test/contrast.test.ts`); `OPAQUE_LOOKS` sets `html.opaque` (solid),
as do glass (components.css' own near-solid floats: a backdrop-filter over vibrancy flickers) and Reduce transparency.
The dim behind a dialog (`.overlay`) is 28% black.

Capsules (V11, macOS 26's glass): styles.css' `.capsule` (not `.glass`: that's `<html>`'s, the window's glass mode),
`--cap-bg` (the floating surface's fill, `--surface-a`: the same contrast holds), `--cap-blur` (`blur(20px)
saturate(1.7)`), the surface's hairline, `--cap-hi` (a lit top edge), `--r-pill` (square in the Square look). Opaque
in `html.opaque` and under Reduce transparency; in glass nearly opaque without a blur; inside `.term-wrap` never a
blur. On: TabBar's two `.actions` groups, App's `reader-switch`, the Reader's `.rd-box` (its field borderless in it,
its focus ring the capsule's, corners `min(--r-pill, 23px)` as it grows), and the status bar's two `.sb-group`s (left:
the workspace's; right: ports, limits and the rest; `:empty` draws none), the bar itself transparent. The scroll edge:
ui.tsx `ScrollEdge`, a 1px sentinel as the scroller's first child, one `IntersectionObserver` (root: the scroller)
sets `data-scrolled` (not a class: React keeps the scroller's className) once it's out of sight; `:is(.side-scroll,
.reader-scroll, .fr-files, .settings-main)[data-scrolled]` masks the top 20px; `.settings-head` lost its line. Frame
cost, measured 12 Nov 2026 in the dev renderer (Chromium 156, `npm run demo`, a shell printing `date; ls -la` in a loop,
4 s of `requestAnimationFrame` intervals each, capsules as they are against a style forcing them opaque without a blur,
twice each): mean 16.65 / 16.66 ms with the blur, 16.66 / 16.67 ms without, p95 17.5 ms in all four, no frame over 17.7
ms. None is over the terminal's canvas, so its repaints don't redraw a blur.

Continuous corners (V12): styles.css' last block, `@supports (corner-shape: squircle)` (Electron 45's Chromium 156 has
it): `--r-window`, `--r-panel` and `--r-control` × 1.25 (a squircle's corner looks smaller than a circle's of the same
radius), and `corner-shape: squircle` on a list of what takes them (floats, cards, fields, plain and primary buttons, the
picked row, menu and ⌘K items, the frame's tab and main card). A list: a pill (`--r-pill`) or a circle (50%) can't be
told by its value, and those stay round, as does a capsule and what's in it. The Square look's `--rs: 0` makes every
token 0. floater.html (its own sheet): the bubbles' menu, voice window, card and reply box.

View transitions (V13): ui.tsx `morph(fn, grow?)` runs fn in `document.startViewTransition(() => flushSync(fn))`, App's
`setDialog` (a wrapper over the state's setter: every page and dialog goes through it) with `grow` for Ship, New
workspace and a rename: 'open' names the focused button or menu item `morph` before and the newest sheet (`.overlay
.modal`, `.main > .settings-page`) after, so one grows into the other; 'close' the other way, while that button is still
there (`grewFrom`); names cleared once it's `finished`. styles.css: `:root { view-transition-name: none }` (nothing
else is snapshotted: the sidebar and a printing terminal stay live), `.main > .settings-page` named `page` (a page
cross-fades), `--t-mid` and `--ease-out`, `::view-transition` takes no clicks. `rowsMorph` (App's `state` event): a row
whose `pinned` changed gets `row-<n>` before and after, so it slides into Pinned or back (Needs you's are cards, not the
rows). Off (fn at once): no `startViewTransition`, a hidden window or one without the focus (a window that draws no
frames would hold the change until one comes: a daemon view, a page opened from elsewhere), Reduce motion, Motion: Off,
and ui-smoke (main's `uiSmoke` sets `data-smoke` on every load). A transition whose change hasn't run in 400 ms is
skipped (`skipTransition`: its change runs then; measured in a hidden browser page: the sheet at 432 ms).

Springs (V14): styles.css' `--spring` (ζ 0.55, ω 16, 600 ms: an overshoot) and `--spring-soft` (ζ 1, ω 22, 350 ms),
`linear()` points from `scripts/spring.ts` (run once, pasted; times kept where a point on a straight stretch was
dropped), `--t-spring` and `--t-spring-soft` beside them; `linear` under Reduce motion (and the catch-all makes every
duration nil). `--spring`: the toggle's knob (`translate`, not `left` any more), `v-sel` on the picked row and the on
segment, `v-rise` on a Needs you card, the bubbles' stack (floater.html, its own copy). `--spring-soft`: the floats'
scale as they come in, by `@starting-style` (opacity 0, scale 0.96; opacity on a plain ease; `display` and `overlay`
`allow-discrete` for one that's hidden rather than removed), not keyframes; `:not(.leaving)`: motion.ts' exit copies
(React removes a float; CSS can't animate a node that's gone) keep their `v-out`. `v-in` and `b-in` went.

Follow the system (B3): `themeAuto`, `themeLight`, `themeDark` in `Paint`; themes.ts `themeFor(paint, dark)` picks the id
(your two; unset, the picked theme for its own kind, Paper or Midnight for the other), and `applyTheme` asks it with
`prefers-color-scheme`. A listener in themes.ts paints the last `applyTheme` again as the system turns (every window);
App's paint key has the system's side too, so terminals repaint. The bubbles and the cards on screen (main's
windows) are painted with the colors App reads after its own paint (`floatColors`, keyed on that paint key, sent with
`floats`), so they turn with it; the Dock icon is a picked picture (dock.ts), no theme's. A new install (core.ts `load`)
starts with `themeAuto` on the Laki pair (B2). With it on, the `glass` IPC gets no `light`, and main
leaves `nativeTheme.themeSource` at `system` (forced, the page's `prefers-color-scheme` would stop following the Mac).
ponytail: the bubbles, the cards on screen and the Dock icon keep what they had.

The accent is attention (V1): an agent waiting for you (Needs you's head and cards, the waiting mark, the rail's count,
a row's *Answer*) and a view's one `button.primary`. The Laki pair's `waiting` is its accent (Laki Light's a shade
darker, for AA on its raised color) and its `sel` a neutral. What's picked or on is `--neutral-strong` (styles.css'
`:root`, the text toward the background): a tab, a side panel tab, a preview tab and a `.seg` segment all underlined
in it (one idiom; a tab's own color over it), a switch's track, a Settings subgroup's mark; a selected row's fill is
`--sel-fill`. Project heads are sentence case, 12px/600, in the text's color (*Accent* in Settings › Appearance still
picks it; a project's color is its bar). Rows are quiet: done, limit and ended marks muted (Needs you shows what's
done), a step that isn't waiting on you (`t-go`: Merge, Ship) neutral. Status marks (Glyph.tsx `MARKS`) are the icon
pack's shapes, not a font's characters: ◆ the pack's square on its corner and ● filled, ○ ✖ ✓ ◷ as lines; the PR's
*you commented* mark stays the 👀 emoji (asked for back). Other themes take the same rules; their own colors stay theirs.

Long lists (R10): `.sp-change` (a file's diff in Changes and Review), `.rd-agent` (an answer in the Reader) and `.board-card` have `content-visibility: auto` with `contain-intrinsic-block-size: auto <n>px`: off screen they're neither laid out nor painted, and keep the height they had once shown. They contain their paint, so nothing of theirs may hang outside their box; code that measures them asks the block itself, not a child inside one that may be skipped (FullReview's `spy`).

### The quick bar (Q1)

Main's `quickWin` (its global hotkey `quick`: `bindKey`, Settings' `quickOn` and `quickKey`, off until turned on,
`QUICK_KEY` ⌥Space suggested, `quick-hotkey` IPC; the menu bar's *New Task…*; the bubbles' New task; `laki://quick`,
which main opens itself): `panelWin({ window: 'quick' }, …, down 0.16)`, a `type: 'panel'` near the top of the screen
with the mouse, one at a time. `NewWindow.tsx` `QuickWindow`: `targetsOf(view)`: a new workspace in `LAST_NEW`'s project
(else the first), each agent tab that waits or is idle (`send` with `whenIdle`, `agent`), Laki AI when `aiOn`; Tab or ⇧Tab
in the box, or `@word ` at the start, turns the chip; `PromptInput` (⏎ sends: `wsNew` with the last picks when it's
the same project, `send`, `aiAsk`), then `window.close()`, so the app you were in keeps the keyboard; a failure leaves
the text and says why. Its mic (⌘⇧M: cloud voice, else macOS dictation) and screenshot (⌘⇧S: `quick-shot`, main's
`screenshot` with the bar hidden; its PNG into the box as `PromptInput`'s `shot`); *More…*: `quick-more`, the bar closed
and `newWsWin(text)`. Its height follows the page (`quick-height`). Every IPC checks its sender (the quick window's
webContents, `from(e, 'quick')`). ui-smoke's `quick-bar` step: the link, a line typed, Send, one more workspace.

Show and tell (Q7): main's `tellShot` (its global hotkey `tell`: Settings' `tellOn` and `tellKey`, off until turned on,
`TELL_KEY` ⌃⌥⌘T suggested, `tell-hotkey`; the menu bar's *Show and Tell…*; the bubbles' + › *Show and tell*,
`floater-act` `tell`): `screenshot(true)` (the bubbles out of it), its PNG kept (`tellPng`) and `quickWin()`; the page's
`bridge.onTell` says `quick-tell-ready` as it's up (`quickReady`, false again on a new window or a reload) and main sends
`quick-tell` `{ png, mic, dictation }`: Laki's Microphone access (`getMediaAccessStatus`) and macOS dictation on
(`defaults read com.apple.HIToolbox AppleDictationAutoEnable`). `QuickWindow`: the picture replaces any before it, into
`PromptInput` as its `shot` (cloud voice starts with it); macOS dictation once the bar has the keyboard; neither: the box
to type in (its placeholder says which). ⏎ sends both (`tell.ts` `handOff`, the quick bar's own send: the path in the
words as a pasted image's for `send` and `wsNew`, an image for `aiAsk`); E in an empty box, or ⌘E, is `quick-annotate`:
the bar hidden, `annotate(png, 'quick')`, whose Done sends `quick-tell` back (`edited`, its note added to the words) and
whose close shows the bar again; Esc drops both. Screen Recording refused (`screenOff`: denied or restricted before the
shot; not granted after one that brought no picture): `privacySay`, a notification naming it, a click opening its pane
(`x-apple.systempreferences:…Privacy_ScreenCapture`); a cloud-voice Microphone refused: the bar says so with a link
(`privacy-pane`). Never tried again by itself. Tests: `test/tell.test.ts` (`handOff`, and a path and words reaching an
agent tab and a new workspace through the daemon); ui-smoke's `show-and-tell` step skips screencapture (the app's icon as
the picture) and checks the bar has it.


## Word marks in diffs

Diff.tsx `DiffRows` marks what changed inside a line (`wordMarks`): in each hunk, a run of deleted lines and the run of
added lines right after it, paired by index up to the shorter, 200 pairs a file at most; text.ts `wordDiff` splits
each into tokens (words and numbers, one punctuation mark, a run of spaces), takes their longest common run, and gives
each side `[text, changed]` spans, or none when over 60% changed or a line is over 500 characters. A changed span is a
`<mark class="wd wd-add|wd-del">`: the page's `--fg` on 15% of `--add`/`--del` (`test/contrast.test.ts` checks it in
every theme). DiffRows has no syntax highlighting to combine with. Tests: `test/template.test.ts`.


## Display P3

themes.ts `p3Sheet`, at the end of `applyTheme`: a `<style id="laki-p3">` with `@media (color-gamut: p3) { body { … } }`
setting `--accent`, `--running`, `--waiting`, `--done` and `--error` to `oklch()` values of the theme's own (color.ts
`p3Boost`: chroma up to 15%, as far as Display P3 holds it, lightness and hue kept). On `body`, so `css()` (it reads the
root: the terminal's theme, canvases) and `test/contrast.test.ts` keep the sRGB hex. Not for `OPAQUE_LOOKS` (flat and
bitmap looks: the sheet goes), and not the accent when you picked one in Settings (statuses only then). color.ts is pure
(`hexToOklch`, `oklchToHex`, `inP3`), tested in `test/units-more.test.ts`.


## Numbers that slide

ui.tsx `Num`: the old value slides out (up as it grows, down as it shrinks) and the new one in, 250 ms on `--spring`
(styles.css `.num`, one grid cell, `1lh` tall, tabular figures). None as it first draws, past 3 changes a second, with
Motion: None or the system's Reduce motion (CSS). The leaving copy is `aria-hidden`. Used for the rail's counts, Needs
you's count, a row's plan n/m and +/−, and the status bar's context %.


## Folds

styles.css: with motion (not Motion: None, not Reduce motion) the root has `interpolate-size: allow-keywords`. A fold you
open by a click (main.tsx sets `html[data-unfold]` for 400 ms on a click of an `[aria-expanded]`, `.rd-more` or
`.help-q`) grows from 0 to its height (`@starting-style`): a project's rows (`.side-scroll .ws`), Needs you's cards and
Earlier's, a ? card; the Reader's Show more moves `max-height` from 10lh to `max-content`. `.fold-chev` turns -90° when
shut on the same spring. Closing is at once: folded content isn't drawn, so it stays out of the tab order.


## Capsules' depth

styles.css `.capsule` (the class is `capsule`, not `glass`: `html.glass` is the window's glass mode): `--glass-hi`,
`--glass-lo`, `--glass-rim` (from `--fg` and #000 by color-mix) as inset shadows, and `::after`'s radial light at `--mx`,
`--my` (`--glass-light`), shown with `[data-lit]`. ui.tsx: one passive `pointermove` on the window marks the capsule under
the pointer and moves its light once a frame; leaving the window unlights it. All four tokens go transparent in
`html.opaque` (flat looks), `html.away` (the window behind another app) and Reduce transparency; the light also with
Motion: None.


## Concentric corners

styles.css: a container sets `--r-out` (its radius token) and `--pad` (its padding); one rule declares on each
`--r-in: max(var(--r-xs), calc(var(--r-out) - var(--pad)))`, which what sits at its edge inside uses. Containers: `.modal`
(Ship, ⌘K), `.palette-list` (the modal's padding plus the items' margin), `.menu`, the tab bar's and Terminal / Reader
capsules, the status bar's groups, a Needs you card. The --r-* tokens go through `--rs`, so Square stays square.
`test/css.test.ts` checks the inner rules use `var(--r-in)`.


## Collapsing page titles

styles.css: `.settings-page` (ui.tsx `Page` and Settings) is `timeline-scope: --page`; its scroller (`> .page-body`, Settings'
`.settings-body > .settings-main`) is `scroll-timeline: --page block`. Inside `@supports (animation-timeline: scroll())`,
over `animation-range: 0 60px`: `page-head` (see-through to `--surface-bg` and its blur, the line back) and `page-title`
(`--fs-5` to `--fs-3`, a plain `<b>` title only). Motion: None and Reduce motion: the compact glass head always. Settings'
scroll-edge fade (`mask-image`) is off, this replaces it. Only one scroller per page names `--page` (two would make the
timeline inactive: a project's embedded `.settings-main` doesn't).

## Native menus

Settings › Layout › Menus (`settings.menus`: `'macos'`, unset Laki's; shown only in the app on a Mac): App's `wsTabMenu`
opens a workspace's menu (a row's right click and ⋯, the rail's pins, the Terminals and Browsers strip) and a tab's (the
tab bar's right click, a pane's) through macOS. `menuModel.ts` turns Laki's `MenuItem`s into a plain list: a head is a
disabled item, `null` a separator (no doubles, none last), `hint` the sublabel (`ON` a check), `off` disabled, `items` a
submenu, a color grid a Color submenu (the picked one checked); each run gets an id, kept in the renderer. A menu with an
emoji grid or a filter field has no model and stays Laki's. Main's `menu-popup` (from(e): the app window only) checks
the list with guards.ts `menuModelOk` (only id, label, sublabel, enabled, checked, separator, sub; strings 200, ids 40,
depth 4, 300 items: no role, no accelerator, nothing that runs in main), pops it up at the point and answers the picked
id, or nothing once it closes. A browser (remote access, `npm run dev:web`) has no bridge: Laki's menu.

## Start-up snapshot

`snapshot.ts` `snapshotOf(view, ui)`: the window's last layout as `laki.snap` (version `SNAP_VERSION`, 20 KB at most): the
sidebar's width, the side panel's width and whether it's open, the rail's choice, up to 30 rows (name, color, project
name), the open workspace's tab names (Laki's, never a terminal's title) and the picked one, the theme's id. A Private
project or workspace never goes in (and the view's veiled first), nor a prompt or a path. App keeps it on `pagehide` and
every minute, the app's main window only (`bridge`: not remote access or `dev:web`; the small windows are NewWindow.tsx,
not App). As App starts with one of this version (`snapOf`), panels.tsx `SnapSkeleton` draws it with the real classes
(`.app`, `.sidebar`, `.ws`, `.tabbar`, `.tab`: the theme's look), `aria-hidden` and `inert`, dimmed by `.snap-skel`
(`--snap-dim`); the first view fades the real one in (`.from-snap`). No view in 5 s, the daemon's problem, a PIN or a
lock: the splash, as before.

## The menu bar's Inbox

Settings › General › Menu bar click (`settings.menuBarClick`: `'inbox'`, unset the menu; macOS): App sends
`shared/tray.ts` `inboxOf(view, said)` with the badge (the view as drawn: Recording mode's private workspaces already
out): the agents waiting on you, the oldest first, each with its question (else its last waiting turn's words) and its
menu's choices (9 at most), then 3 at work; muted and archived workspaces aside. Main (`barInbox`) then sets no context
menu on the tray: its `click` opens `inboxOpen`, its `right-click` pops the menu (`trayBuilt`). The panel is the cards'
page, `ask.html?window=inbox` (`&solid` with Reduce transparency: a solid window, else the `popover` vibrancy), a
non-activating panel under `tray.getBounds()`, hidden on blur and on Esc (a click on the icon that blurred it doesn't open
it again: `inboxHid`). ask.ts in that mode: no ×, no Close all, "Nothing waits on you", then New task… (`inbox-new`: the
quick bar with the words). Its IPC is ask.html's (`ask-act`, `ask-open`, `ask-size`, `ask-close`), each checked by
`inboxSender` (its window, and `from(e, 'inbox')`: guards.ts `pageIs`); a choice goes through `answer`, as a card's.
