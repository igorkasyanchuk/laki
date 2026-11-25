// this window's title (shared/title.ts: cleaned, 120 at most): document.title (a browser's tab) and, in the app, the
// bridge's title for main to set on this window alone. hide: Recording mode's private names, each put as "Laki"
import { useEffect } from 'react'
import { titleOf } from '../../shared/title'
import { bridge } from './api'

export function useWinTitle(text: string, hide: string[] = []) {
  const t = titleOf(text, hide)
  useEffect(() => {
    document.title = t
    bridge?.title?.(t, hide)
  }, [t])
}
// the private names Recording mode hides, from a view (its workspaces' and projects')
export const hiddenNames = (v?: { settings?: { recording?: boolean }; workspaces?: { name?: string; private?: boolean }[]; projects?: { name?: string; private?: boolean }[] } | null) =>
  v?.settings?.recording ? [...(v.workspaces ?? []), ...(v.projects ?? [])].filter(x => x.private && x.name).map(x => x.name!) : []
