# Unused CSS selectors

A list of class selectors in `src/renderer/src/*.css` that nothing in `src/` seems to use, for deleting one area per commit. Made from `d365cdc` by a throwaway script (not in the repo); nothing was changed. **A human checks each one before deleting it.**

How it was decided:

- Every class selector (`.name`) in `styles.css`, `look.css`, `plans.css`, `workflows.css` and `floater.css`, anywhere in a rule's selector (inside `:is()`, `:has()`, `:not()` too).
- **Used**: the name is a whole word (no letter, digit, `_` or `-` right before or after it) in a string of a file under `src/` other than these five stylesheets: string literals and template literals' parts in `.ts`/`.tsx` (parsed, so `className`, `classList`, `class="…"` in `src/shared`'s widget HTML, `querySelector`, `data-*` values, arrays and objects of names, literal types like `'waiting' | 'done'` that become `` `status ${x}` ``), and the HTML pages. Another stylesheet naming it does not count: a class only CSS mentions is unused.
- A name found only in comments, identifiers or JSX text (not a string) would be listed apart; there are none. As a cross-check, nearly every used name is also in a class-shaped place (a `className={…}`, a `classList` or `querySelector` argument, `class="…"`, a string of space-separated names).
- **Kept, built at run time**: a string glued to a value gives a prefix, and a class starting with one is never listed as unused. Ending in `-` or `_` (`` `tag-${x}` ``, `'k-' + kind`): anywhere. Without one (`` `ib${…}` ``, 2+ characters): only inside a `className`, a `classList` call or a string of class names, and not a plural (`` `file${n === 1 ? '' : 's'}` ``). Names built from a suffix (`` `${x}-row` ``) were looked for: none builds a class.
- **Kept, from libraries**: names found in the code or CSS of the libraries the renderer loads (xterm, BlockNote, Tiptap, ProseMirror, Mantine, React Flow, Mermaid, KaTeX, Floating UI, Cytoscape).
- Bytes: a rule whose every selector needs an unused class counts whole; otherwise only its dead selectors. `:not(.x)` never makes a selector dead; `:is()`/`:where()`/`:has()` need one live argument. `L123*`: that rule stays, only its selector (or part of the list) goes.
- `named in test/…` or `docs/…`: not counted as use, but that test or doc changes with it.
- Not classes, but checked the same way: every `[data-look=…]` value (82 looks) and every other `[data-…=value]` in the five sheets is named in `src/`: no look is left over.

| file | rules | class names | unused | to delete |
|---|---:|---:|---:|---:|
| `styles.css` | 3040 | 1444 | 11 | ~1.3 KB |
| `look.css` | 1784 | 114 | 1 | ~167 B |
| `plans.css` | 465 | 300 | 1 | ~120 B |
| `workflows.css` | 241 | 132 | 0 | ~0 B |
| `floater.css` | 21 | 5 | 0 | ~0 B |
| all | 5551 | 1869 distinct | 13 | ~1.5 KB |

## styles.css

11 unused class names in 11 areas, ~1.3 KB. Biggest first; an area is the comment over the rules (its line).

### L517: an experimental page's tag beside its title (Workflows, Specs & Brainstorms, Bird view) (~201 B)

- [x] `.wf-beta` L518

### L329: Places: the pills, and beside them a small Laki window with each place it's in lit … (~197 B)

- [ ] `.prompt-box` L377, L378
- [ ] `.prompt-copy` L379

### L1592: Settings › Extensions' Make one with AI: the description and Laki AI's button on one line (~177 B)

- [ ] `.widget-make` L1593, L1594, L1595

### L725: a menu with lines under its labels, or a filter: roomier, like a picker (~118 B)

- [ ] `.diff-head` L755

### L2739: a link's hover card in a terminal (LinkPeek): a GitHub PR or issue, or a picture (~112 B)

- [ ] `.prompt-peek` L2759, L2760

### L3088: an extension's Logs tab (Extension.tsx Logs) (~108 B)

- [ ] `.log-err` L3098

### L440: Appearance › Interface › Text size (themes.ts' --ui-size): tabs, menus, dropdowns, the … (~99 B)

- [ ] `.grid5` L449

### L1496: GitHub's expand: an arrow at a hunk header's start (the lines above it) and under the … (~99 B)

- [ ] `.span2` L1551
- [ ] `.preview-head` L1554

### L950: a field in a chip is the chip's words: no box of its own, whatever a look or glass gives … (~92 B)

- [ ] `.nw-chip-sep` L952

### L1143: the workspace info panel and the status bar's PR (Info.tsx) (~52 B)

- [ ] `.diff-head` L1145

### L2594: Settings, calmer: more room around and inside the cards, a page's lead text in readable … (~27 B)

- [ ] `.grid5` L2603

## look.css

1 unused class name in 1 area, ~167 B. Biggest first; an area is a look (its `[data-look=…]` rules), else the comment over the rules.

### L77: the tunnel popup's who-can-open choice and its list; a tunnel's link in the info panel (~167 B)

- [ ] `.info-link` L85, L86

## Kept: built at run time

Each prefix, where it is glued to a value, and the classes it keeps that nothing else names. Prefixes that keep nothing are left out.

- `c-` (src/renderer/src/panels.tsx:2191, src/renderer/src/panels.tsx:2204 +3): `.c-fail` (styles.css), `.c-pass` (styles.css)
- `ch-` (src/renderer/src/SidePanel.tsx:220): `.ch-A` (styles.css), `.ch-D` (styles.css), `.ch-M` (styles.css)
- `ci-` (src/renderer/src/Board.tsx:188, src/renderer/src/Info.tsx:203): `.ci-pass` (styles.css), `.ci-pending` (styles.css)
- `ck-` (src/renderer/src/Info.tsx:292, src/renderer/src/Info.tsx:298): `.ck-fail` (styles.css), `.ck-pass` (styles.css), `.ck-pending` (styles.css), `.ck-skip` (styles.css)
- `g-` (src/renderer/src/Glyph.tsx:23, src/renderer/src/Glyph.tsx:26 +3): `.g-done` (styles.css), `.g-exited` (styles.css), `.g-idle` (styles.css), `.g-limit` (styles.css), `.g-ok` (styles.css), `.g-running` (styles.css), `.g-waiting` (styles.css)
- `lv-` (src/renderer/src/Extension.tsx:858): `.lv-debug` (styles.css), `.lv-error` (styles.css), `.lv-warn` (styles.css)
- `p-` (src/renderer/src/panels.tsx:2335): `.p-done` (styles.css), `.p-now` (styles.css)
- `pm-` (src/renderer/src/SettingsExtensions.tsx:239): `.pm-desk` (styles.css), `.pm-foot` (styles.css), `.pm-panel` (styles.css), `.pm-rail` (styles.css), `.pm-row` (styles.css), `.pm-side` (styles.css), `.pm-status` (styles.css), `.pm-top` (styles.css)
- `pr-` (src/daemon/core.ts:2106, src/daemon/core.ts:2106 +4): `.pr-fail` (styles.css), `.pr-merged` (styles.css), `.pr-pass` (styles.css), `.pr-pending` (styles.css)
- `pr-rv-` (src/renderer/src/Info.tsx:127): `.pr-rv-approved` (styles.css), `.pr-rv-changes` (styles.css)
- `s-` (src/renderer/src/panels.tsx:2179, src/shared/widgetUi.ts:854 +3): `.s-failed` (styles.css), `.s-over` (styles.css), `.s-passed` (styles.css)
- `sd-` (src/renderer/src/diagram.tsx:233, src/renderer/src/diagram.tsx:537): `.sd-accordion` (plans.css), `.sd-action` (plans.css), `.sd-actionsheet` (plans.css), `.sd-actor` (plans.css), `.sd-alert` (plans.css), `.sd-api` (plans.css), `.sd-appbar` (plans.css), `.sd-appwindow` (plans.css), `.sd-audio` (plans.css), `.sd-avatar` (plans.css), `.sd-avatars` (plans.css), `.sd-badge` (plans.css), `.sd-banner` (plans.css), `.sd-bottomsheet` (plans.css), `.sd-box` (plans.css), `.sd-breadcrumbs` (plans.css), `.sd-bucket` (plans.css), `.sd-button` (plans.css), `.sd-buttongroup` (plans.css), `.sd-calendar` (plans.css), `.sd-callout` (plans.css), `.sd-card` (plans.css), `.sd-carousel` (plans.css), `.sd-chart` (plans.css), `.sd-chat` (plans.css), `.sd-checkbox` (plans.css), `.sd-checklist` (plans.css), `.sd-chips` (plans.css), `.sd-coachmark` (plans.css), `.sd-codeblock` (plans.css), `.sd-colorpicker` (plans.css), `.sd-combobox` (plans.css), `.sd-console` (plans.css), `.sd-database` (plans.css), `.sd-date` (plans.css), `.sd-db` (plans.css), `.sd-decision` (plans.css), `.sd-dialog` (plans.css), `.sd-divider` (plans.css), `.sd-drawer` (plans.css), `.sd-emptystate` (plans.css), `.sd-entity` (plans.css), `.sd-event` (plans.css), `.sd-external` (plans.css), `.sd-fab` (plans.css), `.sd-final` (plans.css), `.sd-footer` (plans.css), `.sd-heading` (plans.css), `.sd-hero` (plans.css), `.sd-iconbutton` (plans.css), `.sd-image` (plans.css), `.sd-initial` (plans.css), `.sd-input` (plans.css), `.sd-io` (plans.css), `.sd-job` (plans.css), `.sd-kanban` (plans.css), `.sd-keyboard` (plans.css), `.sd-linechart` (plans.css), `.sd-link` (plans.css), `.sd-list` (plans.css), `.sd-mail` (plans.css), `.sd-map` (plans.css), `.sd-menu` (plans.css), `.sd-menubar` (plans.css), `.sd-mobile` (plans.css), `.sd-navbar` (plans.css), `.sd-note` (plans.css), `.sd-notification` (plans.css), `.sd-numberfield` (plans.css), `.sd-otp` (plans.css), `.sd-pagination` (plans.css), `.sd-panel` (plans.css), `.sd-password` (plans.css), `.sd-phone` (plans.css), `.sd-piechart` (plans.css), `.sd-post` (plans.css), `.sd-pricing` (plans.css), `.sd-product` (plans.css), `.sd-progressbar` (plans.css), `.sd-properties` (plans.css), `.sd-queue` (plans.css), `.sd-radio` (plans.css), `.sd-rating` (plans.css), `.sd-ring` (plans.css), `.sd-rule` (plans.css), `.sd-screen` (plans.css), `.sd-search` (plans.css), `.sd-select` (plans.css), `.sd-server` (plans.css), `.sd-settings` (plans.css), `.sd-sidebar` (plans.css), `.sd-skeleton` (plans.css), `.sd-slider` (plans.css), `.sd-spinner` (plans.css), `.sd-stat` (plans.css), `.sd-state` (plans.css), `.sd-statusbar` (plans.css), `.sd-stepper` (plans.css), `.sd-tabbar` (plans.css), `.sd-table` (plans.css), `.sd-tablet` (plans.css), `.sd-tabs` (plans.css), `.sd-terminal` (plans.css), `.sd-text` (plans.css), `.sd-textarea` (plans.css), `.sd-thirdparty` (plans.css), `.sd-timeline` (plans.css), `.sd-timepicker` (plans.css), `.sd-toast` (plans.css), `.sd-toggle` (plans.css), `.sd-toolstrip` (plans.css), `.sd-tooltip` (plans.css), `.sd-tree` (plans.css), `.sd-upload` (plans.css), `.sd-video` (plans.css), `.sd-window` (plans.css)
- `sizing-` (src/renderer/src/App.tsx:155): `.sizing-b` (styles.css), `.sizing-bl` (styles.css), `.sizing-br` (styles.css), `.sizing-l` (styles.css), `.sizing-r` (styles.css), `.sizing-t` (styles.css), `.sizing-tl` (styles.css), `.sizing-tr` (styles.css)
- `st-` (src/renderer/src/FullReview.tsx:421, src/renderer/src/FullReview.tsx:530 +4): `.st-A` (styles.css), `.st-D` (styles.css), `.st-R` (styles.css)
- `strip-` (src/renderer/src/App.tsx:3289): `.strip-left` (styles.css), `.strip-right` (styles.css)
- `t-` (src/renderer/src/Sidebar.tsx:195, src/renderer/src/Sidebar.tsx:264 +8): `.t-ask` (styles.css), `.t-done` (styles.css), `.t-error` (styles.css), `.t-go` (styles.css), `.t-merged` (styles.css), `.t-running` (styles.css), `.t-waiting` (styles.css)
- `tag-` (src/renderer/src/Info.tsx:402, src/renderer/src/Info.tsx:403): `.tag-approved` (styles.css), `.tag-changes_requested` (styles.css), `.tag-merged` (styles.css), `.tag-review_required` (styles.css)
- `voice-` (src/renderer/src/PromptInput.tsx:327): `.voice-listening` (styles.css), `.voice-writing` (styles.css)
- `w-` (src/renderer/src/Specs.tsx:368, src/shared/widgetUi.ts:854 +1): `.w-full` (plans.css), `.w-wide` (plans.css)

Found 145 prefixes in all (66 ending in `-` or `_`, 79 without). These also start classes, but every class they start is named whole somewhere, so they keep nothing extra: `help-`, `kit-`, `new-`, `pick-`, `project-`, `template-`, `ws-`; without a `-`: `action-slug`, `bird-card`, `desk-tab`, `dl`, `fold`, `has`, `ib`, `kit-icon`, `link`, `res-row`, `start`, `time`, `up`, `view`, `with`. The rest start no class.

## plans.css

1 unused class name in 1 area, ~120 B. Biggest first; an area is the comment over the rules (its line).

### L21: Diagram + sketch blocks (~120 B)

- [ ] `.out-diagram` L26, L34

## workflows.css

Nothing unused.

## floater.css

Nothing unused.

## Kept: from libraries

16 names nothing in `src/` names, found in the libraries' code: `.bn-block`, `.bn-block-content`, `.bn-block-outer`, `.bn-container`, `.bn-default-styles`, `.bn-root`, `.connectingfrom`, `.connectingto`, `.react-flow__attribution`, `.react-flow__controls`, `.react-flow__edge`, `.react-flow__edge-path`, `.react-flow__handle`, `.react-flow__node`, `.react-flow__resize-control`, `.xterm-viewport`
