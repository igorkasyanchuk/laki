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
export { hiddenNames, veiledWs } from '../../shared/title' // Recording mode's (pure: test/main-guards.test.ts)
