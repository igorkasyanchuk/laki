// U5: the Ship sheet (a workspace's Ship): on the left what goes in the commit (the uncommitted files, each with a box,
// its +/− and its diff a click away), on the right the commit's and the PR's words (shipDraft's to start: no model
// asked) and the PR's switches; a line on top with what to know first (Done check, Collision radar, behind its base)
import { useEffect, useState } from 'react'
import type { WorkspaceView } from '../../shared/types'
import { DiffRows, diffByFile, type FileDiff, lineClass, NO_DIFF } from './Diff'
import { Modal } from './panels'

type Draft = { title: string; message: string; body: string; files: { path: string; status: string; add: number; del: number }[]; ahead: number; base: string; branch: string }
export type ShipMode = 'commit' | 'push' | 'pr'
export type ShipAsk = { message: string; files?: string[]; title?: string; body?: string; draft: boolean; base?: string; reviewers?: string[]; mode: ShipMode; autoLand: boolean; autoFix: boolean }

export function ShipSheet({ ws, title, busy, land, call, onClose, onShip }: { ws: WorkspaceView; title: string; busy?: string; land: boolean; call: <T>(m: string, p?: object) => Promise<T>; onClose: () => void; onShip: (a: ShipAsk) => Promise<unknown> }) {
  const [d, setD] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [reviewers, setReviewers] = useState('')
  const [draft, setDraft] = useState(false)
  const [autoLand, setAutoLand] = useState(!!ws.autoLand)
  const [autoFix, setAutoFix] = useState(!!ws.autoFix)
  const [on, setOn] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Map<string, FileDiff> | null>(null)
  const [going, setGoing] = useState<ShipMode | null>(null)
  useEffect(() => {
    call<Draft>('shipDraft', { ws: ws.id }).then(
      x => (setD(x), setMsg(x.message), setPrTitle(x.title), setBody(x.body), setBase(x.base), setOn(new Set(x.files.map(f => f.path)))),
      e => setErr(String(e?.message ?? e)),
    )
  }, [ws.id])
  const peek = (path: string) => {
    setOpen(o => (o === path ? null : path))
    if (!diffs) call<{ diff: string }>('diff', { ws: ws.id, uncommitted: true }).then(r => setDiffs(diffByFile(r.diff)), () => setDiffs(new Map()))
  }
  const all = d?.files ?? []
  const picked = all.filter(f => on.has(f.path))
  const nothing = !picked.length && !d?.ahead
  const go = async (mode: ShipMode) => {
    if (!msg.trim() || going || nothing) return
    setGoing(mode)
    try {
      // the files as ticked, always: one an agent wrote since the sheet opened isn't in it, so it stays out
      await onShip({ message: msg.trim(), files: picked.map(f => f.path), title: prTitle.trim() || undefined, body, draft, base: base.trim() && base.trim() !== d?.base ? base.trim() : undefined, reviewers: reviewers.split(/[\s,]+/).filter(Boolean), mode, autoLand, autoFix })
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setGoing(null)
    }
  }
  // what to know first: the Done check, the radar's overlaps, how far its base went on
  const c = ws.check?.status
  const notes = [
    c && (c === 'passed' ? 'Done check passed' : c === 'checking' ? 'Done check running' : 'Done check failed'),
    ws.overlaps?.length ? `${ws.overlaps.length} overlap${ws.overlaps.length === 1 ? '' : 's'} with other work` : 'no overlaps',
    ws.stat?.behind ? `${ws.stat.behind} commit${ws.stat.behind === 1 ? '' : 's'} behind ${ws.base}` : `up to date with ${ws.base}`,
  ].filter(Boolean)
  const warn = c === 'failed' || c === 'over' || !!ws.overlaps?.length || !!ws.stat?.behind
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="ship" onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void go('pr'))}>
        <div className={`ship-banner small ${warn ? 'warn' : 'muted'}`}>{notes.join(' · ')}</div>
        {err && <div className="warn small">{err}</div>}
        <div className="ship-cols">
          <div className="ship-files">
            {!d && !err && <div className="muted small">Loading…</div>}
            {d && (
              <div className="ship-head small muted">
                <label>
                  <input type="checkbox" checked={picked.length === all.length && !!all.length} onChange={e => setOn(new Set(e.target.checked ? all.map(f => f.path) : []))} /> {all.length ? `${picked.length} of ${all.length} uncommitted` : 'nothing uncommitted'}
                </label>
                {!!d.ahead && <span>{` · ${d.ahead} commit${d.ahead === 1 ? '' : 's'} already on ${d.branch}`}</span>}
              </div>
            )}
            {all.map(f => (
              <div key={f.path}>
                <div className="ship-file">
                  <input type="checkbox" aria-label={`Commit ${f.path}`} checked={on.has(f.path)} onChange={e => setOn(s => (n => (e.target.checked ? n.add(f.path) : n.delete(f.path), n))(new Set(s)))} />
                  <span className={`st st-${f.status}`}>{f.status}</span>
                  <button type="button" className="link ship-name" title={f.path} onClick={() => peek(f.path)}>
                    {f.path}
                  </button>
                  <span className="mono small">
                    <span className="add">+{f.add}</span> <span className="del">−{f.del}</span>
                  </span>
                </div>
                {open === f.path && <div className="sp-diff ship-diff">{diffs ? <DiffRows fd={diffs.get(f.path) ?? NO_DIFF} split={false} cls={l => lineClass(l)} row={() => ({})} head={l => l.text} /> : <div className="muted small">Loading…</div>}</div>}
              </div>
            ))}
          </div>
          <div className="ship-form">
            <label className="small muted">Commit message</label>
            <input autoFocus value={msg} onChange={e => setMsg(e.target.value)} placeholder="Commit message" />
            <label className="small muted">PR title</label>
            <input value={prTitle} onChange={e => setPrTitle(e.target.value)} placeholder="From the commits (gh --fill)" />
            <label className="small muted">PR body</label>
            <textarea rows={6} value={body} onChange={e => setBody(e.target.value)} />
            <div className="ship-pair">
              <label className="small muted">
                Base
                <input value={base} onChange={e => setBase(e.target.value)} />
              </label>
              <label className="small muted">
                Reviewers
                <input value={reviewers} onChange={e => setReviewers(e.target.value)} placeholder="login, org/team" />
              </label>
            </div>
            <label className="small">
              <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} /> Draft
            </label>
            {land && (
              <label className="small">
                <input type="checkbox" checked={autoLand} onChange={e => setAutoLand(e.target.checked)} /> Merge when green
              </label>
            )}
            <label className="small">
              <input type="checkbox" checked={autoFix} onChange={e => setAutoFix(e.target.checked)} /> Send CI failures to the agent
            </label>
          </div>
        </div>
        <div className="buttons">
          <span className="spacer muted small">{busy}</span>
          <button type="button" disabled={!!going || nothing || !picked.length} onClick={() => go('commit')}>
            {going === 'commit' ? 'Committing…' : 'Commit only'}
          </button>
          <button type="button" disabled={!!going || nothing} onClick={() => go('push')}>
            {going === 'push' ? 'Pushing…' : 'Push'}
          </button>
          <button type="button" className="primary" disabled={!!going || nothing || !msg.trim()} onClick={() => go('pr')} title="⌘↵">
            {going === 'pr' ? 'Shipping…' : 'Open PR'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
