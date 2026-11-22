// U5: the Ship sheet (a workspace's Ship): on the left what goes in the commit (the uncommitted files, each with a box,
// its +/− and its diff a click away), on the right the commit's and the PR's words (shipDraft's to start: no model
// asked) and the PR's switches; a line on top with what to know first (Done check, Collision radar, behind its base)
import type { Call } from '../../shared/api'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { SecretFound, WorkspaceView } from '../../shared/types'
import { DiffRows, diffByFile, type FileDiff, lineClass, NO_DIFF, RiskMark } from './Diff'
import { risksOf } from '../../shared/walk'
import { Modal } from './panels'
import { shipPrimary } from './text'

type Draft = { title: string; message: string; body: string; files: { path: string; status: string; add: number; del: number }[]; ahead: number; base: string; branch: string; secrets?: SecretFound[]; proof?: 'yes' | 'stale'; checked?: string }
export type ShipMode = 'commit' | 'push' | 'pr'
const withProof = (body: string, md: string) => (md && !body.includes(md) ? [body.trimEnd(), md].filter(Boolean).join('\n\n') : body) // the section at the end, once
export type ShipAsk = { message: string; files?: string[]; title?: string; body?: string; draft: boolean; base?: string; reviewers?: string[]; mode: ShipMode; autoLand: boolean; autoFix: boolean; allowSecrets?: string[]; proof?: boolean }

export function ShipSheet({ ws, title, busy, land, merge, call, onClose, onShip, onMerge, onLand, onUpdate, onOverlaps }: { ws: WorkspaceView; title: string; busy?: string; land: boolean; merge: boolean; call: Call; onClose: () => void; onShip: (a: ShipAsk) => Promise<unknown>; onMerge: () => void; onLand: () => void; onUpdate?: () => Promise<unknown>; onOverlaps?: () => void }) {
  const [d, setD] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [reviewers, setReviewers] = useState('')
  const [draft, setDraft] = useState(false)
  const [proofOn, setProofOn] = useState(false) // Add what Laki checked: the last Done check's section at the body's end, there to edit (on as it opens when it's current)
  const [autoLand, setAutoLand] = useState(!!ws.autoLand)
  const [autoFix, setAutoFix] = useState(!!ws.autoFix)
  const [on, setOn] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Map<string, FileDiff> | null>(null)
  const [risks, setRisks] = useState<Map<string, string[]>>(new Map()) // riskOf's words per file (walk.ts): a mark, nothing more
  const [going, setGoing] = useState<ShipMode | null>(null)
  // the secret check's finds (the draft's, then a ship's that stopped), the ones you said aren't (their hashes), the last try
  const [found, setFound] = useState<SecretFound[]>([])
  const [ok, setOk] = useState<Set<string>>(new Set())
  const [tried, setTried] = useState<ShipMode | null>(null)
  const [updating, setUpdating] = useState(false) // Update from <base> at work: the sheet's buttons wait
  // the files and their diff (the uncommitted one at once: a file's peek shows it, and its Read with care marks); again
  // after an update: the files and the finds anew, what you typed and ticked kept (a file new since: ticked)
  const load = (again = false) => {
    call<Draft>('shipDraft', { ws: ws.id }).then(
      x =>
        again
          ? (setOn(o => new Set(x.files.map(f => f.path).filter(p => o.has(p) || !d?.files.some(f => f.path === p)))), setD(x), setFound(x.secrets ?? []))
          : (setD(x), setMsg(x.message), setPrTitle(x.title), setBody(x.proof === 'yes' && x.checked ? withProof(x.body, x.checked) : x.body), setProofOn(x.proof === 'yes'), setBase(x.base), setOn(new Set(x.files.map(f => f.path))), setFound(x.secrets ?? [])),
      e => setErr(String(e?.message ?? e)),
    )
    call<{ diff: string }>('diff', { ws: ws.id, uncommitted: true }).then(r => (setDiffs(diffByFile(r.diff)), setRisks(risksOf(r.diff))), () => setDiffs(new Map()))
  }
  useEffect(() => load(), [ws.id])
  const update = () => {
    if (!onUpdate || updating || going) return
    setUpdating(true)
    setErr('')
    onUpdate()
      .then(() => load(true), e => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setUpdating(false))
  }
  const peek = (path: string) => setOpen(o => (o === path ? null : path))
  const all = d?.files ?? []
  const picked = all.filter(f => on.has(f.path))
  const nothing = !picked.length && !d?.ahead
  const shown = found.filter(f => on.has(f.file) && !ok.has(f.hash)) // an unticked file's aren't committed
  // the primary (and ⌘↵): Open PR, Push to PR, Merge (App's prAct: its confirm, Touch ID, an extension's gate) or Merge
  // when green (its switch, asked as it's turned on), by the PR as the view has it
  const first = shipPrimary(ws.pr, !!picked.length || !!d?.ahead, { merge, land }, !!ws.autoLand)
  const primary = () => (first.act === 'merge' ? (onClose(), onMerge()) : first.act === 'land' ? (onClose(), onLand()) : void go(first.act))
  const primaryOff = !!going || updating || (first.act === 'pr' || first.act === 'push' ? nothing || !msg.trim() : false)
  const go = async (mode: ShipMode, allow = ok) => {
    if (!msg.trim() || going || updating || nothing) return
    setGoing(mode)
    setTried(mode)
    try {
      // the files as ticked, always: one an agent wrote since the sheet opened isn't in it, so it stays out
      const r = await onShip({ message: msg.trim(), files: picked.map(f => f.path), title: prTitle.trim() || undefined, body, draft, base: base.trim() && base.trim() !== d?.base ? base.trim() : undefined, reviewers: reviewers.split(/[\s,]+/).filter(Boolean), mode, autoLand, autoFix, ...(allow.size && { allowSecrets: [...allow] }), proof: false /* the section is in the body, as you left it */ })
      const again = (r as { secrets?: SecretFound[] } | undefined)?.secrets
      if (again) setFound(again)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setGoing(null)
    }
  }
  // Not a secret: remembered as it ships; the last one of a stopped ship's ships it again at once
  const notSecret = (f: SecretFound) => {
    const allow = new Set(ok).add(f.hash)
    setOk(allow)
    if (tried && !shown.some(x => !allow.has(x.hash))) void go(tried, allow)
  }
  // what to know first: the Done check, the radar's overlaps (a click: Check overlaps over the sheet), how far its base
  // went on (Update from <base>: the status bar's ↓n merge, or its agent told when it conflicts)
  const c = ws.check?.status
  const lapped = ws.overlaps?.length ? `${ws.overlaps.length} overlap${ws.overlaps.length === 1 ? '' : 's'} with other work` : ''
  const behind = ws.stat?.behind ?? 0
  const notes: ReactNode[] = [
    c && (c === 'passed' ? 'Done check passed' : c === 'checking' ? 'Done check running' : 'Done check failed'),
    lapped && onOverlaps ? (
      <button type="button" className="link" onClick={onOverlaps}>
        {lapped}
      </button>
    ) : (
      lapped || 'no overlaps'
    ),
    behind ? (
      <>
        {`${behind} commit${behind === 1 ? '' : 's'} behind ${ws.base}`}
        {onUpdate && (
          <button type="button" className="ship-update" disabled={updating || !!going} onClick={update} data-tip={ws.stat?.clean === false ? `Merging ${ws.base} in conflicts: its agent is asked to merge it and resolve them` : `Merge ${ws.base} into this branch`}>
            {updating && <span className="btn-spin" aria-hidden />}
            Update from {ws.base}
          </button>
        )}
      </>
    ) : (
      `up to date with ${ws.base}`
    ),
  ].filter(Boolean)
  const warn = c === 'failed' || c === 'over' || !!ws.overlaps?.length || !!ws.stat?.behind
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="ship" onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), !primaryOff && primary())}>
        <div className={`ship-banner small ${warn ? 'warn' : 'muted'}`}>
          {notes.map((n, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {n}
            </Fragment>
          ))}
        </div>
        {err && <div className="warn small">{err}</div>}
        {!!shown.length && (
          <div className="ship-secrets" role="alert">
            <div className="warn small">{tried ? 'Not shipped: ' : ''}{shown.length === 1 ? 'this looks like a secret' : `${shown.length} of these look like secrets`}. Leave the file out, or say it isn't one.</div>
            {shown.map(f => (
              <div key={`${f.file}:${f.line}:${f.hash}`} className="ship-secret small">
                <span className="ship-name mono" title={`${f.file}:${f.line}`}>
                  {f.file}:{f.line}
                </span>
                <span className="muted">{f.kind}</span>
                <span className="mono">{f.masked}</span>
                <button type="button" className="link" onClick={() => setOn(s => (n => (n.delete(f.file), n))(new Set(s)))}>
                  Untick
                </button>
                <button type="button" className="link" disabled={!!going} onClick={() => notSecret(f)}>
                  Not a secret
                </button>
              </div>
            ))}
          </div>
        )}
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
                  {risks.has(f.path) && <RiskMark risk={risks.get(f.path)!} cls="ship-risk" />}
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
            {d?.proof && (
              <label className="small" data-tip={d.proof === 'stale' ? 'The branch changed since the last Done check: the PR would say only that' : "The last Done check's scripts, pass or fail, at the description's end"}>
                <input type="checkbox" checked={proofOn} onChange={e => (setProofOn(e.target.checked), setBody(b => (e.target.checked ? withProof(b, d.checked ?? '') : b.replace(d.checked ?? '', '').trimEnd())))} /> Add what Laki checked{d.proof === 'stale' ? ' (changed since)' : ''}
              </label>
            )}
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
          <button type="button" disabled={!!going || updating || nothing || !picked.length} onClick={() => go('commit')}>
            {going === 'commit' ? 'Committing…' : 'Commit only'}
          </button>
          <button type="button" disabled={!!going || updating || nothing} onClick={() => go('push')}>
            {going === 'push' ? 'Pushing…' : 'Push'}
          </button>
          <button type="button" className="primary" disabled={primaryOff} onClick={primary} title="⌘↵">
            {going === first.act ? (first.act === 'push' ? 'Pushing…' : 'Shipping…') : first.label}
          </button>
        </div>
      </div>
    </Modal>
  )
}
