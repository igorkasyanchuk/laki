// The renderer's only door to native code.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('laki', {
  conn: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('conn'),
  notify: (title: string, body: string, tab: string, sound?: string, actions?: { text: string; n?: number; label?: string; pick?: string }[]) => ipcRenderer.send('notify', title, body, tab, sound, actions),
  sound: (name: string) => ipcRenderer.send('sound', name), // a timer's end: a macOS sound
  browse: (r: object): Promise<unknown> => ipcRenderer.invoke('browse', r), // the agent browser's op (main's hidden window)
  onFocusTab: (cb: (tab: string) => void) => ipcRenderer.on('focus-tab', (_e, tab: string) => cb(tab)),
  onEarn: (cb: (id: string) => void) => void ipcRenderer.on('earn', (_e, id: string) => cb(id)), // an achievement main saw: the global hotkey, a bubble's click
  onFront: (cb: (on: boolean) => void) => ipcRenderer.on('front', (_e, on: boolean) => cb(on)), // Laki in front of other apps, or not
  onBrowserTab: (cb: (url: string, front: boolean) => void) => ipcRenderer.on('browser-tab', (_e, url: string, front: boolean) => cb(url, front)), // a Browsers page's link to a new tab
  onBrowserKey: (cb: (key: string) => void) => ipcRenderer.on('browser-key', (_e, key: string) => cb(key)), // a Browsers page's ⌘T or ⌘W (Settings › Keys': a shared/keys.ts id), or a menu bar item's id or key
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  pathOf: (f: File): string => webUtils.getPathForFile(f), // a dropped file or folder
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  openPath: (path: string, root?: string): Promise<{ rel: string } | 'opened' | 'missing'> => ipcRenderer.invoke('open-path', path, root),
  copyFile: (path: string): Promise<'image' | 'file' | 'missing'> => ipcRenderer.invoke('copy-file', path), // an artifact to the clipboard
  openFile: (path: string, root: string): Promise<'opened' | 'missing'> => ipcRenderer.invoke('open-file', path, root), // an HTML artifact as a file:// page in the browser
  dictate: () => ipcRenderer.send('dictate'), // macOS dictation into the focused field
  dictationSettings: () => ipcRenderer.send('dictation-settings'), // its language and microphone
  glass: (on: boolean) => ipcRenderer.send('glass', on), // the window's blur behind see-through backgrounds
  fullScreen: (on: boolean) => ipcRenderer.send('full-screen', on), // ⌘⇧⏎: the window full screen with the tab alone, or back
  dockIcon: (png: string) => ipcRenderer.send('dock-icon', png), // Settings' Dock icon
  hotkey: (label: string): Promise<boolean> => ipcRenderer.invoke('hotkey', label), // the global hotkey ('' none): false when another app has it
  keys: (over: Record<string, string>) => ipcRenderer.send('keys', over), // Settings › Keys' over shared/keys.ts' defaults: the menu shows them
  // Screenshot to Laki AI's ('' none; false: it's off); macOS only: main's screenshot is screencapture
  ...(process.platform === 'darwin' && { shotKey: (label: string | false): Promise<boolean> => ipcRenderer.invoke('shot-hotkey', label) }),
  // updates (main's update.ts): its state, or check, download, install; Settings' auto checks; the state as it changes
  update: (op: 'state' | 'check' | 'download' | 'install'): Promise<object | null> => ipcRenderer.invoke('update', op),
  updateAuto: (on: boolean) => ipcRenderer.send('update-auto', on),
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
  badge: (n: number, items?: { tab: string; label: string }[], tray?: boolean) => ipcRenderer.send('badge', n, items, tray),
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on('deep-link', (_e, url: string) => cb(url))
    ipcRenderer.send('deep-link-ready') // then main sends one that came first
  },
  onNewPrompt: (cb: (prompt: string) => void) => ipcRenderer.on('new-prompt', (_e, p: string) => cb(p)), // the new-workspace window's
  fitNew: (height: number) => ipcRenderer.send('new-fit', height), // its height: what the page needs
  capture: (webContentsId: number): Promise<string> => ipcRenderer.invoke('capture', webContentsId), // the preview's PNG, base64
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
  procStop: (what: string) => ipcRenderer.send('proc-stop', what), // the bubbles, an agent browser
  // the bubbles' own windows (floater.html): the bar (the list in; its height, a hover and a click out) and the card
  floater: {
    onFloats: (cb: (f: { items: object[]; colors: Record<string, string>; style: string; add: boolean; menu: string }) => void) => ipcRenderer.on('floats', (_e, f) => cb(f)),
    onSide: (cb: (side: 'left' | 'right' | 'top' | 'bottom') => void) => ipcRenderer.on('floater-side', (_e, side) => cb(side)),
    drag: (phase: 'start' | 'move' | 'end', dx = 0, dy = 0) => ipcRenderer.send('floater-drag', phase, dx, dy),
    size: (len: number, up?: boolean) => ipcRenderer.send('floater-size', len, up), // its length along the edge; up: the stack opened or closed, the + stays put
    hover: (tab: string, top: number) => ipcRenderer.send('floater-hover', tab, top),
    open: (tab: string) => ipcRenderer.send('floater-open', tab),
    seen: (tab: string) => ipcRenderer.send('floater-seen', tab), // a right click: its ● cleared without opening it
    act: (what: 'new' | 'mic' | 'area' | 'screen' | 'ai') => ipcRenderer.send('floater-act', what), // the +'s actions (the bar's stack or the menu)
    tip: (name: string, hint: string, top: number) => ipcRenderer.send('floater-tip', name, hint, top), // a stacked action's name beside it
    menuAt: (top: number) => ipcRenderer.send('floater-menu-at', top), // the +'s top, then the page opens #menu
    menuClose: () => ipcRenderer.send('floater-menu-close'),
    onMenu: (cb: (open: boolean) => void) => ipcRenderer.on('floater-menu', (_e, open: boolean) => cb(open)),
    onVoiceOpen: (cb: () => void) => ipcRenderer.on('floater-voice', () => cb()), // the menu's Say it: the bar opens the window
    onCard: (cb: (f: object, colors: Record<string, string>) => void) => ipcRenderer.on('card', (_e, f, colors) => cb(f, colors)),
    cardSize: (tab: string, w: number, h: number) => ipcRenderer.send('floater-card', tab, w, h),
    // the voice prompt's window: the agents it can go to, then the text out (no tab: a new session's page)
    onVoice: (cb: (items: object[], colors: Record<string, string>, to: string) => void) => ipcRenderer.on('voice', (_e, items, colors, to) => cb(items, colors, to)),
    voiceSend: (tab: string, text: string): Promise<{ error?: string; queued?: boolean }> => ipcRenderer.invoke('voice-send', tab, text),
    voiceClose: () => ipcRenderer.send('voice-close'),
  },
  // the screenshot's editor window (annotate.html): the picture in, the drawn one and a note out
  annotate: {
    onImage: (cb: (png: string) => void) => ipcRenderer.on('annotate-image', (_e, png: string) => cb(png)),
    done: (png: string, note: string) => ipcRenderer.send('annotate-done', png, note),
    cancel: () => ipcRenderer.send('annotate-cancel'),
  },
})
