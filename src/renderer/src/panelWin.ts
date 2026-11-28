// The side panel in a window of its own (its head's Move to its own window, ⌘K; main's panelOpen, ?window=panel:
// NewWindow.tsx' PanelWindow). It and the app window talk over a BroadcastChannel (one origin, no main in between):
// the app window says which workspace it shows with its facts (App's infoOf, the panel's switches) as they change, and
// the tab to show (showPanel); the panel window asks it for what only App does: a PR's merge, close or approve and
// their confirms, Fix, a check's log, the PR switches' asks, rename, attach a PR, going to a workspace or a tab (the app
// window comes forward for those); its extensions' panel tabs (their full views, pages, Laki commands and laki:// links
// asked of the app window too). Closed: the panel is back in the app window as it was
import { useEffect, useRef, useState } from 'react'
import type { MergeMethod } from '../../shared/types'
import type { AutoKey, Check, FixWhat, PRAct, WsInfo } from './Info'
import type { PanelTab } from './SidePanel'
import type { UiDo } from '../../shared/widgetUi'
import { bridge } from './api'

export const PANEL_WIN = new URLSearchParams(location.search).get('window') === 'panel'
export type PanelSays = { ws: string | null; info?: WsInfo; git?: boolean; sim?: boolean; turn?: boolean; agents?: { id: string; name: string }[]; active?: string } // active: the app window's agent tab on screen (a pick's and a screenshot's go there)
export type PanelDo =
  | { op: 'act'; ws: string; act: PRAct; method?: MergeMethod }
  | { op: 'fix'; ws: string; what: FixWhat }
  | { op: 'log'; ws: string; check: Check }
  | { op: 'auto'; ws: string; k: AutoKey; v: boolean }
  | { op: 'rename' | 'attach'; ws: string }
  | { op: 'go'; ws: string; tab?: string }
  | { op: 'sees'; agent: 'claude' | 'codex' | 'pi'; project: string }
  | { op: 'ext'; id: string; ws?: string; page?: boolean; key?: string } // an extension panel tab's full view, or its page (page: Settings' Extension page, key: at that setting)
  | { op: 'extDo'; id: string; cmd: UiDo; label?: string } // its button's Laki command (asked and done in the app window)
  | { op: 'link'; url: string } // a laki:// link an extension opens
type Msg = { hello?: true; say?: PanelSays; tab?: PanelTab; do?: PanelDo }
const chan = () => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('laki.panel'))

// the app window's side: whether the panel is out (main says; opened again if it was at quit), what it shows there
// (says: JSON, posted as it changes), its asks (onDo) and showPanel's tab (tabTo)
export function usePanelHost(says: () => PanelSays, onDo: (d: PanelDo) => void, back: () => void) {
  const [out, setOut] = useState(false)
  const c = useRef<BroadcastChannel | null>(null)
  const now = useRef({ says, onDo, back })
  now.current = { says, onDo, back }
  useEffect(() => {
    void bridge?.panelFloating?.().then(setOut, () => {})
    bridge?.onPanelFloating?.(on => (setOut(on), on || now.current.back()))
  }, [])
  useEffect(() => {
    if (!out) return
    const ch = (c.current = chan())
    if (ch)
      ch.onmessage = (e: MessageEvent<Msg>) => {
        if (e.data?.hello) (said.current = ''), ch.postMessage({ say: now.current.says() } satisfies Msg)
        if (e.data?.do) now.current.onDo(e.data.do)
      }
    return () => {
      ch?.close()
      c.current = null
    }
  }, [out])
  // after each render (says reads what App declares below this hook): posted when it changed
  const said = useRef('')
  useEffect(() => {
    if (!out || !c.current) return void (said.current = '')
    let j = ''
    try {
      j = JSON.stringify(now.current.says())
    } catch {
      return // a render that ended early (no view yet)
    }
    if (j !== said.current) c.current.postMessage({ say: JSON.parse((said.current = j)) } satisfies Msg)
  })
  return {
    out,
    float: (on = true) => bridge?.floatPanel?.(on),
    tabTo: (tab: PanelTab) => (bridge?.floatPanel?.(true), c.current?.postMessage({ tab } satisfies Msg)), // shown there, that window forward
  }
}

// the panel window's side: what the app window shows (null until it says), the tab it asks for, and its asks
export function usePanelGuest(onTab: (t: PanelTab) => void) {
  const [says, setSays] = useState<PanelSays | null>(null)
  const c = useRef<BroadcastChannel | null>(null)
  const tabNow = useRef(onTab)
  tabNow.current = onTab
  useEffect(() => {
    const ch = (c.current = chan())
    if (!ch) return
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data?.say) setSays(e.data.say)
      if (e.data?.tab) tabNow.current(e.data.tab)
    }
    ch.postMessage({ hello: true } satisfies Msg)
    return () => ch.close()
  }, [])
  return { says, ask: (d: PanelDo) => c.current?.postMessage({ do: d } satisfies Msg) }
}
