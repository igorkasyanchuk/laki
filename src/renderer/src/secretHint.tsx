// A secret pasted into a prompt box (shared/secrets.ts secretsIn, in the window: nothing leaves it to look): a line under
// the box names its kind, the value masked, with Send as it is (this exact text, in memory only) and Pass as a secret
// (the daemon's secretKeep: a 0600 file, its path in the prompt instead). Never blocks a send: ⏎ with it showing arms it,
// ⏎ again sends. Settings › Privacy's Secret warning (settings.secretHint) turns it off. PromptInput's and the Reader's box
import { useMemo, useRef, useState } from 'react'
import { maskSecret, secretLine, secretsIn } from '../../shared/secrets'
import { api } from './api'
import { Icon } from './ui'

let on = true
export const setSecretHint = (v: boolean | undefined) => void (on = v !== false) // App's and the other windows', from the view
const okayed = new Set<string>() // Send as it is: these exact texts, in memory only

export function useSecretHint(text: string, setText: (t: string) => void, o: { ws?: string; send?: () => void } = {}) {
  const spans = useMemo(() => (on && text.length < 200_000 ? secretsIn(text) : []), [text, on]) // ponytail: past 200 KB unchecked; on: Settings' switch, set as the view comes
  const [armed, setArmed] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = spans.length > 0 && !okayed.has(text)
  // a send by ⏎: the first with a secret in shows the line as armed, the second sends as it is
  const guard = (send: () => void) => (!shown || armed === text ? send() : setArmed(text))
  const now = useRef(text)
  now.current = text
  // each value into its file, then replaced in the box as it is by then (words typed meanwhile kept); one that failed
  // stays, the ones before it are replaced
  const pass = async () => {
    setBusy(true)
    setErr('')
    const got: [string, string][] = []
    try {
      for (const s of spans) {
        const value = text.slice(s.start, s.end)
        const { path } = await api.call<{ path: string }>('secretKeep', { value, label: s.kind, ws: o.ws })
        got.push([value, secretLine(path, s.kind)])
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (got.length) setText(got.reduce((t, [value, line]) => t.replace(value, () => line), now.current))
    }
  }
  const s = spans[0]
  const kind = s?.kind ?? ''
  const line = shown && (
    <div className={`secret-hint small${armed === text ? ' armed' : ''}`} role="status">
      <Icon name="key" size={13} />
      <span className="secret-hint-what">
        {spans.length > 1 ? `${spans.length} secrets, ` : ''}
        {/^[AEIOU]/i.test(kind) ? 'an' : 'a'} {kind}: <code>{maskSecret(text.slice(s.start, s.end))}</code>
        {armed === text && <span className="muted"> · ⏎ again sends it as it is</span>}
      </span>
      <button type="button" className="link" onMouseDown={e => e.preventDefault()} onClick={() => (okayed.add(text), setArmed(''), o.send?.())}>
        Send as it is
      </button>
      <button type="button" className="link" disabled={busy} data-tip="Into a file only you and the agent can read; its path goes in the prompt" onMouseDown={e => e.preventDefault()} onClick={() => void pass()}>
        Pass as a secret
      </button>
      {err && <span className="warn">{err}</span>}
    </div>
  )
  return { line: line || null, guard }
}
