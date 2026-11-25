// T12: Settings › Security › Trusted clients (daemon/clients.ts, clientLog.ts): each client's name, scopes, when it was
// made, its last call and calls today, with Rotate (it asks on the Allow card, as laki client rotate does) and Revoke
// (asks here first); its log (what it did, a filter for refusals); today's calls with a token Laki doesn't know; Add a
// client… (the command to run in your own terminal: the Allow card follows); Show its workspaces (the sidebar's filter).
// Terminals (S1): the terminals you allowed to act as you (core.ts termList), each with Revoke (its next call asks again);
// the one Laki's daemon was started from shows as started Laki and stays.
import { useEffect, useState } from 'react'
import { api } from './api'
import { Group } from './SettingsKit'
import { ask, IconButton } from './ui'
import { RECIPE_IDS, RECIPES } from '../../shared/clientRecipes'

type Row = { bind?: true; bound?: { name: string; path: string; team?: string }; id: string; label: string; scopes: string[]; projects?: string[]; at: number; lastAt?: number; calls?: number; today?: number; daysLeft?: number; unused?: boolean; file: string }
type Did = { at: number; method: string; target?: string; ok: boolean; why?: string; n?: number }
type Log = { lines: Did[]; unknown: { n: number; last?: number; by?: string } }
type Term = { key: string; tty: string; cmd: string; chain: string[]; at: number; lastAt: number; start?: true }
const when = (at?: number) => (at ? new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never')

export function TrustedClients({ showWorkspaces, copy }: { showWorkspaces: (label: string) => void; copy: (text: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [log, setLog] = useState<Log | null>(null)
  const [name, setName] = useState('')
  const load = () => void api.call<Row[]>('clientList').then(setRows, (e: Error) => setErr(e.message))
  useEffect(load, [])
  // Copy config for…: a recipe's snippet (shared/clientRecipes.ts) with its token's file and the laki launcher's path
  const [bin, setBin] = useState('laki')
  useEffect(() => void api.call<{ path?: string; to: string }>('cliState').then(c => setBin(c.path ?? c.to), () => {}), [])
  const copyFor = (c: Row, id: string) => id && copy(RECIPES[id].make({ tokenFile: c.file, lakiBin: bin, name: c.label }).snippet)
  useEffect(() => {
    setLog(null)
    void api.call<Log>('clientLog', { id: open ?? undefined, refused }).then(setLog, (e: Error) => setErr(e.message))
  }, [open, refused, rows])
  const cmd = `laki client add ${JSON.stringify(name.trim() || 'My app')} --scopes create,send`
  const rotate = (c: Row) => void api.call('clientRotate', { id: c.id }).then(load, (e: Error) => setErr(e.message)) // its Allow card shows in this window
  const revoke = async (c: Row) => {
    if (await ask(`Revoke ${c.label}?`, { text: 'Its token stops working at once and its file goes. Its workspaces stay.', ok: 'Revoke', danger: true })) void api.call('clientRm', { id: c.id }).then(() => (setOpen(null), load()), (e: Error) => setErr(e.message))
  }
  return (
    <Group title="Trusted clients" hint="Apps outside Laki (an MCP server, a script) that drive it with a token of their own, within the scopes you allowed">
      {err && <p className="err small">{err}</p>}
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length ? (
        <table className="clients">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scopes</th>
              <th>Made</th>
              <th>Last call</th>
              <th>Today</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className={open === c.id ? 'on' : ''}>
                <td>
                  <button className="link" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                    {c.label}
                  </button>
                  {c.bound ? <span className="muted small" data-tip={`${c.bound.path}${c.bound.team ? ` · team ${c.bound.team}` : ''}: a call from any other program is refused`}> · Bound to {c.bound.name}</span> : c.bind && <span className="muted small"> · bound to the first program that uses it</span>}
                  {c.unused && <span className="muted small"> · unused 30 days</span>}
                  {c.daysLeft !== undefined && c.daysLeft <= 7 && <span className="muted small"> · ends in {c.daysLeft} days</span>}
                </td>
                <td className="small">{c.scopes.join(', ') || 'reads only'}{c.projects && <span className="muted"> · {c.projects.length} project{c.projects.length === 1 ? '' : 's'}</span>}</td>
                <td className="small">{when(c.at)}</td>
                <td className="small">{when(c.lastAt)}</td>
                <td className="small">{c.today ?? 0}</td>
                <td className="row">
                  <select className="sm" value="" aria-label={`Copy config for ${c.label}`} onChange={e => copyFor(c, e.target.value)}>
                    <option value="">Copy config for…</option>
                    {RECIPE_IDS.map(id => (
                      <option key={id} value={id}>{RECIPES[id].title}</option>
                    ))}
                  </select>
                  <button className="ghost sm" onClick={() => showWorkspaces(c.label)}>Show its workspaces</button>
                  <button className="ghost sm" onClick={() => rotate(c)}>Rotate</button>
                  <button className="ghost sm danger" onClick={() => void revoke(c)}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">None yet.</p>
      )}
      {open && log && (
        <div className="client-log">
          <label className="small">
            <input type="checkbox" checked={refused} onChange={e => setRefused(e.target.checked)} /> Only refusals
          </label>
          {log.lines.length ? (
            <ul className="sees-list">
              {log.lines.map((l, i) => (
                <li key={`${l.at}-${i}`} className="small">
                  <span className="muted">{when(l.at)}</span> <span className="mono">{l.method}</span>
                  {l.target && <span className="mono"> {l.target}</span>}
                  {l.n && l.n > 1 ? <span className="muted"> ×{l.n}</span> : null} {l.ok ? <span className="muted">ok</span> : <span className="err">refused: {l.why}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{refused ? 'Nothing refused.' : 'No calls yet.'}</p>
          )}
        </div>
      )}
      {!!log?.unknown.n && (
        <p className="muted small">
          Today: {log.unknown.n} call{log.unknown.n === 1 ? '' : 's'} with a client token Laki doesn't know (revoked, rotated away or made up), the last {when(log.unknown.last)}
          {log.unknown.by ? ` from ${log.unknown.by}` : ''}.
        </p>
      )}
      <details className="sees-box">
        <summary>Add a client…</summary>
        <p className="muted small">Run this in your own terminal (not in a Laki tab); an Allow card here follows, with what it may do.</p>
        <div className="row">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Its name" aria-label="The client's name" />
          <code className="mono small">{cmd}</code>
          <IconButton icon="copy" title="Copy the command" onClick={() => copy(cmd)} />
        </div>
      </details>
    </Group>
  )
}

export function Terminals() {
  const [rows, setRows] = useState<Term[] | null>(null)
  const [err, setErr] = useState('')
  const load = () => void api.call<Term[]>('termList').then(setRows, (e: Error) => setErr(e.message))
  useEffect(load, [])
  const revoke = (t: Term) => void api.call('termRevoke', { key: t.key }).then(load, (e: Error) => setErr(e.message)) // only takes away: no ask
  if (/unknown method/.test(err)) return null // a daemon before API 212
  return (
    <Group title="Terminals" hint="Terminals outside Laki you allowed to run laki as you. One goes when it closes, or after 12 hours with no call">
      {err && <p className="err small">{err}</p>}
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length ? (
        <table className="clients">
          <thead>
            <tr>
              <th>Terminal</th>
              <th>Started by</th>
              <th>Allowed</th>
              <th>Last call</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.key}>
                <td className="mono small">{t.tty}</td>
                <td className="small" title={t.chain.join(' ‹ ')}>
                  {t.cmd}
                  {t.start && <span className="muted"> · started Laki</span>}
                </td>
                <td className="small">{when(t.at)}</td>
                <td className="small">{when(t.lastAt)}</td>
                <td className="row">{!t.start && <button className="ghost sm danger" onClick={() => revoke(t)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">None allowed.</p>
      )}
    </Group>
  )
}
