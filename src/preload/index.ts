// The renderer's only door to native code.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('laki', {
  conn: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('conn'),
  notify: (title: string, body: string, tab: string, sound?: string, actions?: { text: string; n?: number; label?: string; pick?: string }[], card?: { diff?: string; ask?: boolean; alert?: string; tone?: string; origin?: string }) => ipcRenderer.send('notify', title, body, tab, sound, actions, card),
  cardGone: (key: string) => ipcRenderer.send('card-gone', key), // a laki alert over: its card goes
  asking: (tabs: string[]) => ipcRenderer.send('asking', tabs), // the tabs that wait: cards on screen for the others' asks go
  sound: (name: string) => ipcRenderer.send('sound', name), // a timer's end: a macOS sound
  browse: (r: object): Promise<unknown> => ipcRenderer.invoke('browse', r), // the agent browser's op (main's hidden window)
  onFocusTab: (cb: (tab: string, panel?: string) => void) => ipcRenderer.on('focus-tab', (_e, tab: string, panel?: string) => cb(tab, panel)), // panel: changes (the island's Review)
  onEarn: (cb: (id: string) => void) => void ipcRenderer.on('earn', (_e, id: string) => cb(id)), // an achievement main saw: the global hotkey, a bubble's click
  onFront: (cb: (on: boolean) => void) => ipcRenderer.on('front', (_e, on: boolean) => cb(on)), // Laki in front of other apps, or not
  onBrowserTab: (cb: (url: string, front: boolean) => void) => ipcRenderer.on('browser-tab', (_e, url: string, front: boolean) => cb(url, front)), // a Browsers page's link to a new tab
  onBrowserKey: (cb: (key: string) => void) => ipcRenderer.on('browser-key', (_e, key: string) => cb(key)), // a Browsers page's ⌘T or ⌘W (Settings › Keys': a shared/keys.ts id), or a menu bar item's id or key
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  menuPopup: (model: unknown, x: number, y: number): Promise<string | undefined> => ipcRenderer.invoke('menu-popup', model, x, y), // Menus: macOS
  pathOf: (f: File): string => webUtils.getPathForFile(f), // a dropped file or folder
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  openPath: (path: string, root?: string): Promise<{ rel: string } | 'opened' | 'missing'> => ipcRenderer.invoke('open-path', path, root),
  ...(process.platform === 'darwin' && { quickLook: (path: string) => ipcRenderer.send('quick-look', path), share: (url: string) => ipcRenderer.send('share-menu', url), bounce: () => ipcRenderer.send('dock-bounce') }), // U14: Space on a file row; U15: Share…, the Dock's bounce
  copyFile: (path: string): Promise<'image' | 'file' | 'missing'> => ipcRenderer.invoke('copy-file', path), // an artifact to the clipboard
  openFile: (path: string, root: string): Promise<'opened' | 'missing' | 'viewer'> => ipcRenderer.invoke('open-file', path, root), // an HTML artifact as a file:// page in the browser
  dictate: () => ipcRenderer.send('dictate'), // macOS dictation into the focused field
  dictationSettings: () => ipcRenderer.send('dictation-settings'), // its language and microphone
  restartDaemon: (): Promise<boolean> => ipcRenderer.invoke('daemon-restart'), // the stale bar's Restart when the daemon refuses this app (another Laki's)
  accent: (): Promise<string | null> => ipcRenderer.invoke('accent'), // V9: macOS's accent color, #rrggbb (null off a Mac)
  onAccent: (cb: (c: string | null) => void) => void ipcRenderer.on('accent', (_e, c: string | null) => cb(c)), // as it changes
  glass: (on: boolean, light?: boolean, float?: boolean, side?: boolean) => ipcRenderer.send('glass', on, light, float, side), // the window's blur behind see-through backgrounds
  fullScreen: (on: boolean) => ipcRenderer.send('full-screen', on), // ⌘⇧⏎: the window full screen with the tab alone, or back
  dockIcon: (png: string) => ipcRenderer.send('dock-icon', png), // Settings' Dock icon
  hotkey: (label: string): Promise<boolean> => ipcRenderer.invoke('hotkey', label), // the global hotkey ('' none): false when another app has it
  keys: (over: Record<string, string>) => ipcRenderer.send('keys', over), // Settings › Keys' over shared/keys.ts' defaults: the menu shows them
  // Screenshot to Laki AI's ('' none; false: it's off); macOS only: main's screenshot is screencapture
  ...(process.platform === 'darwin' && { shotKey: (label: string | false): Promise<boolean> => ipcRenderer.invoke('shot-hotkey', label) }),
  quickKey: (label: string): Promise<boolean> => ipcRenderer.invoke('quick-hotkey', label), // Q1: the quick bar's global keys ('' none)
  quickMore: (text: string) => ipcRenderer.send('quick-more', text), // the quick bar's More: the whole new-workspace page with its text
  quickShot: (): Promise<string> => ipcRenderer.invoke('quick-shot'), // its screenshot: a part of the screen, a PNG in base64 ('' cancelled)
  tellKey: (label: string): Promise<boolean> => ipcRenderer.invoke('tell-hotkey', label), // Q7: show and tell's global keys ('' none)
  talkKey: (label: string): Promise<boolean> => ipcRenderer.invoke('talk-hotkey', label), // Q2: the talk key ('' none)
  // hold Fn (voice.ts): main watches Fn while this page asks (Chromium never gives a page Fn's own key events on macOS)
  fnWatch: (on: boolean) => ipcRenderer.send('fn-watch', on),
  onFn: (cb: (down: boolean) => void) => ipcRenderer.on('fn', (_e, down: boolean) => cb(down === true)),
  // the quick bar's: show and tell's picture (Laki's Microphone access, macOS dictation on), or the editor's drawing on it
  onTell: (cb: (t: object) => void) => {
    ipcRenderer.on('quick-tell', (_e, t: object) => cb(t))
    ipcRenderer.send('quick-tell-ready') // then main sends one taken before the page was up
  },
  quickAnnotate: (png: string) => ipcRenderer.send('quick-annotate', png),
  privacyPane: (which: string) => ipcRenderer.send('privacy-pane', which),
  quickHeight: (h: number) => ipcRenderer.send('quick-height', h), // as tall as its page
  // updates (main's update.ts): its state, or check, download, install; Settings' auto checks; the state as it changes
  update: (op: 'state' | 'check' | 'download' | 'install' | 'skip' | 'pass' | 'unpass'): Promise<object | null> => ipcRenderer.invoke('update', op),
  updateAuto: (on: boolean, days?: number) => ipcRenderer.send('update-auto', on, days),
  onUpdate: (cb: (s: object) => void) => {
    const f = (_e: unknown, s: object) => cb(s)
    ipcRenderer.on('update', f)
    return () => void ipcRenderer.removeListener('update', f)
  },
  // the AI window's: Screenshot to Laki AI's picture (a PNG, base64), for its box
  onAiShot: (cb: (png: string) => void) => {
    ipcRenderer.on('ai-shot', (_e, png: string) => cb(png))
    ipcRenderer.send('ai-shot-ready') // then main sends one taken before
  },
  floatTab: (tab: string, on = true) => ipcRenderer.send('tab-float', tab, on), // a tab in a window of its own over every app, or back
  floating: (): Promise<string[]> => ipcRenderer.invoke('floating'), // the tabs in windows of their own
  floatSim: (device: string, ws?: string, on = true) => ipcRenderer.send('sim-float', device, ws ?? '', on), // a simulator in a window of its own, or back
  simFloating: (): Promise<string[]> => ipcRenderer.invoke('sim-floating'),
  onSimFloating: (cb: (devices: string[]) => void) => ipcRenderer.on('sim-floating', (_e, d: string[]) => cb(d)),
  onFloating: (cb: (tabs: string[]) => void) => ipcRenderer.on('floating', (_e, tabs: string[]) => cb(tabs)),
  // the Dock's count (agents that need a look) and the menu bar's item: the same count, those tabs, whether it's shown
  badge: (n: number, items?: { tab: string; label: string }[], tray?: boolean, recording?: boolean, state?: object, progress?: number, inbox?: object[]) => ipcRenderer.send('badge', n, items, tray, recording, state, progress, inbox), // inbox: the menu bar's Inbox (tray.ts inboxOf), with Menu bar click: Inbox // state: Q8's (shared/tray.ts stateOf)
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on('deep-link', (_e, url: string) => cb(url))
    ipcRenderer.send('deep-link-ready') // then main sends one that came first
  },
  onFolders: (cb: (paths: string[]) => void) => {
    const f = (_e: unknown, paths: string[]) => cb(paths) // dropped on the Dock icon
    ipcRenderer.on('open-folders', f)
    ipcRenderer.send('folders-ready') // then main sends the ones that came first
    return () => void ipcRenderer.removeListener('open-folders', f)
  },
  onNewPrompt: (cb: (prompt: string, project?: string) => void) => ipcRenderer.on('new-prompt', (_e, p: string, project?: string) => cb(p, project)), // the new-workspace window's (project: Q5's new task in it)
  fitNew: (height: number) => ipcRenderer.send('new-fit', height), // its height: what the page needs
  capture: (webContentsId: number): Promise<string> => ipcRenderer.invoke('capture', webContentsId), // the preview's PNG, base64
  pageShot: (webContentsId: number, whole: boolean, save: boolean): Promise<string> => ipcRenderer.invoke('page-shot', webContentsId, whole, save), // a Browsers page's: copied, or saved (its path)
  shoot: (): Promise<string | null> => ipcRenderer.invoke('shoot'), // a part of the screen, a PNG in base64 (null: cancelled)
  captureRect: (r: { x: number; y: number; width: number; height: number }): Promise<string> => ipcRenderer.invoke('capture-rect', r), // the app window's own, a PNG in base64: the element picker's
  // the menu bar's screenshot (a PNG, base64, drawn on) and its note: to a new workspace's prompt
  onShot: (cb: (png: string, note?: string) => void) => {
    ipcRenderer.on('shot', (_e, png: string, note?: string) => cb(png, note))
    ipcRenderer.send('shot-ready') // then main sends one taken before
  },
  // the floating bubbles: the workspaces whose agent works or waits, and recent ones (none, no buttons: no bar), in the
  // theme's colors; opts: the working circles' style, cards on hover, the + and how its actions show
  floats: (items: object[], colors: Record<string, string>, opts?: object) => ipcRenderer.send('floats', items, colors, opts),
  procs: (): Promise<{ pid: number; name: string; stop?: string }[]> => ipcRenderer.invoke('procs'), // Settings › Resources: what each process holds
  browserMem: (ids: number[]): Promise<{ kb: number } | null> => ipcRenderer.invoke('browser-mem', ids), // the memory budget: what these pages hold
  browserGuard: (id: number): Promise<string | undefined> => ipcRenderer.invoke('browser-guard', id), // why this page can't be unloaded, if so
  procStop: (what: string) => ipcRenderer.send('proc-stop', what), // the bubbles, an agent browser
  // the bubbles' own windows (floater.html): the bar (the list in; its height, a hover and a click out) and the card
  floater: {
    onFloats: (cb: (f: { items: object[]; colors: Record<string, string>; style: string; add: boolean; menu: string }) => void) => ipcRenderer.on('floats', (_e, f) => cb(f)),
    onSide: (cb: (side: 'left' | 'right' | 'top' | 'bottom') => void) => ipcRenderer.on('floater-side', (_e, side) => cb(side)),
    drag: (phase: 'start' | 'move' | 'end', dx = 0, dy = 0) => ipcRenderer.send('floater-drag', phase, dx, dy),
    size: (len: number, up?: boolean) => ipcRenderer.send('floater-size', len, up), // its length along the edge; up: the stack opened or closed, the + stays put
    hover: (tab: string, top: number) => ipcRenderer.send('floater-hover', tab, top),
    open: (tab: string, panel?: 'changes') => ipcRenderer.send('floater-open', tab, panel),
    seen: (tab: string) => ipcRenderer.send('floater-seen', tab), // a right click: its ● cleared without opening it
    act: (what: 'new' | 'mic' | 'area' | 'screen' | 'ai') => ipcRenderer.send('floater-act', what), // the +'s actions (the bar's stack or the menu)
    tip: (name: string, hint: string, top: number) => ipcRenderer.send('floater-tip', name, hint, top), // a stacked action's name beside it
    menuAt: (top: number) => ipcRenderer.send('floater-menu-at', top), // the +'s top, then the page opens #menu
    menuClose: () => ipcRenderer.send('floater-menu-close'),
    onMenu: (cb: (open: boolean) => void) => ipcRenderer.on('floater-menu', (_e, open: boolean) => cb(open)),
    onVoiceOpen: (cb: () => void) => ipcRenderer.on('floater-voice', () => cb()), // the menu's Say it: the bar opens the window
    onCard: (cb: (f: object, colors: Record<string, string>, pinned?: boolean, drop?: object) => void) => ipcRenderer.on('card', (_e, f, colors, pinned, drop) => cb(f, colors, pinned, drop)), // Q4: pinned, to answer from; Q9: with what was dropped on it
    drop: (to: string, d: { text?: string; paths: string[] }) => ipcRenderer.send('floater-drop', to, d), // Q9: a drop on a circle (its tab) or the + ('+')
    dropImage: (data: string, ext: string): Promise<{ path?: string; error?: string }> => ipcRenderer.invoke('floater-image', data, ext),
    dropSend: (tab: string, text: string): Promise<{ error?: string }> => ipcRenderer.invoke('floater-drop-send', tab, text),
    click: (tab: string) => ipcRenderer.send('floater-click', tab), // Q4: an edge circle's click: main pins a waiting one's card, else opens it
    pin: (ev: 'esc') => ipcRenderer.send('floater-pin', ev),
    replySend: (tab: string, text: string): Promise<{ error?: string }> => ipcRenderer.invoke('floater-reply-send', tab, text), // the pinned card's one-line answer
    cardSize: (tab: string, w: number, h: number) => ipcRenderer.send('floater-card', tab, w, h),
    // the voice prompt's window: the agents it can go to, then the text out (no tab: a new session's page)
    onVoice: (cb: (items: object[], colors: Record<string, string>, to: string, reply?: object, route?: object) => void) => ipcRenderer.on('voice', (_e, items, colors, to, reply, route) => cb(items, colors, to, reply, route)), // route: Q5's names // reply: the one agent it answers (a circle's Reply…)
    voiceSend: (tab: string, text: string, project?: string): Promise<{ error?: string; queued?: boolean; ai?: boolean }> => ipcRenderer.invoke('voice-send', tab, text, project),
    voiceClose: () => ipcRenderer.send('voice-close'),
    // a circle's right click (Reply…, Open tab, Seen) and ⌥-click (Reply…): main's menu and the reply window
    menuTab: (tab: string) => ipcRenderer.send('floater-menu-tab', tab),
    reply: (tab: string) => ipcRenderer.send('floater-reply', tab),
    answer: (tab: string, n: number, label: string): Promise<{ error?: string }> => ipcRenderer.invoke('floater-answer', tab, n, label),
    // the island (floaterAt notch): a card or the session list in, its height out; the pointer and keys (enter, leave,
    // esc, next, prev; focus: its keys; pill: a hover on the pill)
    onIsland: (cb: (c: object, colors: Record<string, string>) => void) => ipcRenderer.on('island', (_e, c, colors) => cb(c, colors)),
    islandSize: (h: number) => ipcRenderer.send('island-size', h),
    islandEv: (ev: string) => ipcRenderer.send('island-ev', ev),
    // Q2: the talk pill (#talk): who it may go to and the mic's state in, the key's second press, the recording written
    // down, sent (no tab: a new task), taken back from a queue, closed
    onTalk: (cb: (c: object) => void) => ipcRenderer.on('talk', (_e, c) => cb(c)),
    onTalkKey: (cb: () => void) => ipcRenderer.on('talk-key', () => cb()),
    talkText: (audio: string): Promise<{ text?: string; error?: string }> => ipcRenderer.invoke('talk-text', audio),
    talkSend: (tab: string, text: string, project?: string): Promise<{ error?: string; queued?: boolean; new?: boolean; ai?: boolean; shot?: boolean; noShot?: string }> => ipcRenderer.invoke('talk-send', tab, text, project), // Q10: shot: the screen went with it to Laki AI
    talkUndo: (): Promise<{ error?: string }> => ipcRenderer.invoke('talk-undo'),
    talkClose: () => ipcRenderer.send('talk-close'),
  },
  // cards on screen (ask.html): the cards in, the page's height, a choice, ×, Close all and Open out (by each card's key)
  ask: {
    onCards: (cb: (cards: object[], colors: Record<string, string>) => void) => ipcRenderer.on('ask-cards', (_e, cards, colors) => cb(cards, colors)),
    size: (h: number) => ipcRenderer.send('ask-size', h),
    act: (key: string, i: number): Promise<void> => ipcRenderer.invoke('ask-act', key, i),
    close: (key: string) => ipcRenderer.send('ask-close', key),
    closeAll: () => ipcRenderer.send('ask-close-all'),
    open: (key: string) => ipcRenderer.send('ask-open', key),
    newTask: (text: string) => ipcRenderer.send('inbox-new', text), // the menu bar's Inbox: New task…, the quick bar with it
  },
  // the screenshot's editor window (annotate.html): the picture in, the drawn one and a note out
  annotate: {
    onImage: (cb: (png: string) => void) => ipcRenderer.on('annotate-image', (_e, png: string) => cb(png)),
    done: (png: string, note: string) => ipcRenderer.send('annotate-done', png, note),
    cancel: () => ipcRenderer.send('annotate-cancel'),
  },
})
