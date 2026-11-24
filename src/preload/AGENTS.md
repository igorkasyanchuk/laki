# AGENTS.md: src/preload/

What this folder's files are. Read the root [AGENTS.md](../../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Files

| file | what |
|---|---|
| `src/preload/index.ts` | `bridge`: conn info, notify, glass, badge, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, onBrowserTab, onBrowserKey (⌘W/⌘T from a Browsers page), dictate (`startDictation:` to the first responder), dictationSettings, onDeepLink, onShot (the menu bar's screenshot, drawn on, and its note), annotate (the editor window's), floats and floater (the floating bubbles' list and options; their windows': the bar, the card, the + menu, the voice prompt), onNewPrompt and fitNew (the new-workspace window's), shotKey and onAiShot (Screenshot to Laki AI's keys; the AI window's picture), capture, browse |
