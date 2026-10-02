// The renderer's only door to native code.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('wbs', {
  conn: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('conn'),
  notify: (title: string, body: string, tab: string) => ipcRenderer.send('notify', title, body, tab),
  onFocusTab: (cb: (tab: string) => void) => ipcRenderer.on('focus-tab', (_e, tab: string) => cb(tab)),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
})
