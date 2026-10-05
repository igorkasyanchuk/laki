// The renderer's only door to native code.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('laki', {
  conn: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('conn'),
  notify: (title: string, body: string, tab: string, sound?: string, actions?: string[]) => ipcRenderer.send('notify', title, body, tab, sound, actions),
  browse: (r: object): Promise<unknown> => ipcRenderer.invoke('browse', r), // the agent browser's op (main's hidden window)
  onFocusTab: (cb: (tab: string) => void) => ipcRenderer.on('focus-tab', (_e, tab: string) => cb(tab)),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  pathOf: (f: File): string => webUtils.getPathForFile(f), // a dropped file or folder
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  dictate: () => ipcRenderer.send('dictate'), // macOS dictation into the focused field
  dictationSettings: () => ipcRenderer.send('dictation-settings'), // its language and microphone
  glass: (on: boolean) => ipcRenderer.send('glass', on), // the window's blur behind see-through backgrounds
  // the Dock's count (agents that need a look) and the menu bar's item: the same count, those tabs, whether it's shown
  badge: (n: number, items?: { tab: string; label: string }[], tray?: boolean) => ipcRenderer.send('badge', n, items, tray),
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on('deep-link', (_e, url: string) => cb(url))
    ipcRenderer.send('deep-link-ready') // then main sends one that came first
  },
  capture: (webContentsId: number): Promise<string> => ipcRenderer.invoke('capture', webContentsId), // the preview's PNG, base64
})
