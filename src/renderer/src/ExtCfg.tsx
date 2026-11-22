// what Settings › Extensions and the Extension page call (WidgetsApi): each extension's settings, page, folder, logs,
// its repo's sheet; computed inline in App's render (r: App's values this render), as it was in App
import type { UiProblem } from '../../shared/widgetUi'
import type { Settings, StudioChat, View, WidgetLogLine, WidgetRuns, WidgetView } from '../../shared/types'
import type { WidgetsApi } from './Settings'
import { api } from './api'
import { ask, type MenuItem } from './ui'
import { type Dialog, extKey, extOf, type Where } from './appCtx'
import { hasCap } from '../../shared/caps'
import type { Call } from '../../shared/api'
import type { Dispatch, SetStateAction } from 'react'

export type ExtCfgIn = {
  call: Call
  copy: (text: string) => Promise<void>
  dialog: Dialog
  done: (text: string, undo?: () => void) => void
  editLayout: (on: boolean) => void
  openInItems: (where?: Where) => MenuItem[]
  openMenu: (e: React.MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void
  repoSheet: (w: WidgetView) => Promise<string | undefined>
  setDialog: Dispatch<SetStateAction<Dialog>>
  setStudioChats: Dispatch<SetStateAction<StudioChat[]>>
  settings: Settings
  studioChats: StudioChat[]
  studioOn: boolean
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean, ms?: number) => void
  view: View | null
}

export function extCfgOf(r: ExtCfgIn) {
  const { call, copy, dialog, done, editLayout, openInItems, openMenu, repoSheet, setDialog, setStudioChats, settings, studioChats, studioOn, toast, view } = r
  // Settings › Extensions' and the Extension page's: each one's settings, page, folder, logs
  const extCfg: WidgetsApi = {
    editLayout: hasCap(view, 'widget.order') ? () => editLayout(true) : undefined,
    ...(hasCap(view, 'widget.store') && { storeAll: (id: string, ws?: string) => call('widgetStore', { id, op: 'all', ws }) }),
    list: view?.widgets ?? [],
    projects: view?.projects.filter(p => !p.kind).map(p => ({ id: p.id, name: p.name })),
    ungated: view?.tabs.filter(t => t.ungated).length,
    gateRestart: () => call<{ restarted: number; left: number }>('gateRestart', {}).then(r => (r.left && toast(`${r.left} still at work or asking: restart once idle`), r)),
    home: view?.widgetHome,
    // turned on with a setting it needs still empty: its page, at that field; a repo's (.laki/extensions) shows what
    // it runs first (repoSheet), on only for the files shown
    set: async (id, o) => {
      const rw = view?.widgets?.find(x => x.id === id)
      if (o.on && !o.seen && (rw?.project || rw?.agentDev)) {
        const seen = await repoSheet(rw)
        if (!seen) return
        o = { ...o, seen }
      }
      const r = await call<WidgetView>('widgetSet', { id, ...o })
      if (o.on && r?.missing?.length) setDialog((e => (e?.extension === id ? { extension: id, back: e.back, key: extKey(e), edit: r.missing![0] } : { extension: id, back: dialog, edit: r.missing![0] }))(extOf(dialog))) // its page already: kept (key), not drawn again
      return r
    },
    desk: settings.desk !== false,
    nowhere: hasCap(view, 'widget.none'),
    agents: (view?.presets ?? []).filter(p => !p.off && (p.agent === 'claude' || p.agent === 'codex')).map(p => ({ name: p.name, agent: p.agent })),
    agent: settings.widgetAgent,
    run: (id, ws) => call('widgetRun', { id, ws }),
    stop: id => call('resourceStop', { key: `agent:${id}` }),
    // asked first, then the trash: Undo puts it back
    rm: async id => {
      const name = view?.widgets?.find(w => w.id === id)?.name ?? id
      if (!(await ask(`Delete ${name}?`, { text: 'Its folder, settings and data go to the trash, and it stops running. Undo brings it back.', ok: 'Delete', danger: true }))) return
      const r = await call<{ trash: string }>('widgetRm', { id })
      if (r) done(`Deleted ${name}`, () => void call('widgetRestore', { trash: r.trash }))
    },
    // Laki AI's extension chats where you left off: the ones with nothing made yet, and the one at work
    chats: studioOn ? studioChats.filter(c => c.busy || !view?.widgets?.some(w => w.id === c.id)) : [],
    chatRm: async id => {
      if (!(await ask('Delete this session?', { text: 'Its chat with Laki AI goes; nothing was saved of the extension yet.', ok: 'Delete', danger: true }))) return
      await call('studioChatRm', { id })
      setStudioChats(cs => cs.filter(c => c.id !== id))
    },
    reload: () => call('widgetReload'),
    page: id => setDialog({ extension: id, back: dialog }),
    remix: (id: string) => api.call<{ id: string }>('widgetRemix', { id }).then(r => setDialog({ extension: r.id, back: dialog }), e => toast(String(e?.message ?? e), undefined, undefined, false, true)), // a copy to change, on its page
    undo: (id, after) => api.call('widgetUndo', { id, after }),
    tryOnce: (id, ws) => api.call<{ ok: boolean; error?: string }>('widgetRun', { id, once: true, ws }),
    folder: (id, e) => {
      const w = view?.widgets?.find(x => x.id === id)
      openMenu(e, [{ head: 'Open in' }, ...openInItems({ widget: id }), null, { label: 'Copy path', icon: 'copy', key: 'c', run: () => w && copy(w.dir) }])
    },
    allLogs: settings.widgetLogs === true,
    hours: settings.widgetHours,
    logs: id => setDialog({ extension: id, back: extOf(dialog)?.extension === id ? extOf(dialog)!.back : dialog, tab: 'logs' }),
    log: {
      read: (id, o) => api.call<{ on: boolean; lines: WidgetLogLine[]; next: number }>('widgetLogs', { id, ...o }),
      clear: id => api.call('widgetLogClear', { id }),
      reveal: id => void call('openIn', { widget: id, log: true, app: 'finder' }),
    },
    kit: icons => setDialog({ uikit: true, icons, back: dialog }),
    runs: (id, ws) => api.call<WidgetRuns>('widgetRuns', { id, data: true, ws }),
    mock: (id, o) => call('widgetMock', { id, ...o }),
    files: id => api.call<{ files: Record<string, string> }>('widgetFiles', { id }).then(r => r.files),
    save: (id, path, text, was, force) => api.call('widgetFileSave', { id, path, text, was, force }),
    make: kind => api.call<{ id: string }>('widgetNew', { kind, name: kind === 'pullmain' ? 'Pull main' : `My ${kind === 'onefile' ? 'script' : kind}` }).then(r => setDialog({ extension: r.id, back: dialog === 'starters' ? null : dialog }), e => toast(String(e?.message ?? e), undefined, undefined, false, true)), // ⌘K's picker: its page, then nothing behind it
    check: (id, run, ws) => api.call<{ problems: UiProblem[] }>('widgetCheck', { id, run, ws }),
    revoke: (id, action, ws) => api.call('widgetGrantRm', { id, action, ws }),
    wsName: ws => (ws ? (view?.workspaces.find(w => w.id === ws)?.name ?? ws) : 'no workspace'),
  }
  return { extCfg } as const
}
