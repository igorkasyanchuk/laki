import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { View } from '../../shared/types'
import { api, bridge } from './api'
import { Glyph } from './Glyph'

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

export type NewWsParams = { project: string; base?: string; preset: string; cmd?: string; prompt?: string; name?: string; local?: boolean }

export function NewWorkspace({ view, project, onClose, onCreate }: { view: View; project?: string; onClose: () => void; onCreate: (p: NewWsParams) => Promise<void> }) {
  const [p, setP] = useState<NewWsParams>({ project: project ?? view.projects[0]?.id ?? '', preset: 'claude', base: '' })
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const set = (k: Partial<NewWsParams>) => setP(x => ({ ...x, ...k }))
  useEffect(() => {
    if (!p.project) return
    api.call('branches', { project: p.project }).then(
      r => {
        setBranches(r.branches)
        setP(x => ({ ...x, base: r.current }))
      },
      () => setBranches([]),
    )
  }, [p.project])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onCreate({ ...p, preset: p.preset === 'custom' ? 'custom' : p.preset, cmd: p.preset === 'custom' ? p.cmd : undefined })
    } catch {
      setBusy(false)
    }
  }
  if (!view.projects.length)
    return (
      <Modal title="New workspace" onClose={onClose}>
        <p className="muted">Add a project first (a local git repository).</p>
      </Modal>
    )
  return (
    <Modal title="New workspace" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Project
          <select value={p.project} onChange={e => set({ project: e.target.value })}>
            {view.projects.map(x => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={!!p.local} onChange={e => set({ local: e.target.checked })} /> Local: work in the repo itself (no worktree)
        </label>
        {!p.local && (
          <div className="row">
            <label>
              Base branch
              <input list="branches" value={p.base} onChange={e => set({ base: e.target.value })} />
              <datalist id="branches">
                {branches.map(b => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <label>
              <span>
                Name <span className="muted">(optional)</span>
              </span>
              <input value={p.name ?? ''} placeholder="from the prompt" onChange={e => set({ name: e.target.value })} />
            </label>
          </div>
        )}
        <label>
          Agent
          <div className="seg">
            {['claude', 'codex', 'shell', 'custom', 'none'].map(x => (
              <button type="button" key={x} className={p.preset === x ? 'on' : ''} onClick={() => set({ preset: x })}>
                {x}
              </button>
            ))}
          </div>
        </label>
        {p.preset === 'custom' && (
          <label>
            Command
            <input value={p.cmd ?? ''} placeholder="aider --model …" onChange={e => set({ cmd: e.target.value })} autoFocus />
          </label>
        )}
        {(p.preset === 'claude' || p.preset === 'codex') && (
          <label>
            <span>
              Prompt <span className="muted">(optional)</span>
            </span>
            <textarea
              rows={4}
              value={p.prompt ?? ''}
              autoFocus
              placeholder="What should the agent do?"
              onChange={e => set({ prompt: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && submit(e)}
            />
          </label>
        )}
        <div className="buttons">
          <span className="muted">⌘⏎ create · esc cancel</span>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !p.project}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function AddProject({ onClose, onAdd }: { onClose: () => void; onAdd: (path: string) => Promise<void> }) {
  const [path, setPath] = useState('')
  return (
    <Modal title="Add project" onClose={onClose}>
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          onAdd(path.trim()).catch(() => {})
        }}
      >
        <label>
          Git repository
          <div className="row">
            <input value={path} autoFocus placeholder="/Users/you/code/app" onChange={e => setPath(e.target.value)} />
            {bridge && (
              <button type="button" onClick={async () => setPath((await bridge!.pickFolder()) ?? path)}>
                Browse…
              </button>
            )}
          </div>
        </label>
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!path.trim()}>
            Add
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function Prompt({ title, hint, placeholder, onClose, onSubmit }: { title: string; hint?: string; placeholder?: string; onClose: () => void; onSubmit: (v: string) => Promise<void> }) {
  const [v, setV] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          if (v.trim()) onSubmit(v.trim()).catch(() => {})
        }}
      >
        <input value={v} autoFocus placeholder={placeholder} onChange={e => setV(e.target.value)} />
        {hint && <div className="muted small">{hint}</div>}
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!v.trim()}>
            OK
          </button>
        </div>
      </form>
    </Modal>
  )
}

export type PaletteItem = { label: string; hint?: string; glyph?: string; run: () => void }

// fuzzy: the query's characters in order; contiguous runs and word starts score higher
export function fuzzy(q: string, s: string): number {
  q = q.toLowerCase()
  s = s.toLowerCase()
  if (!q) return 1
  let score = 0
  let j = 0
  let prev = -2
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s[i] !== q[j]) continue
    score += 1 + (i === prev + 1 ? 2 : 0) + (i === 0 || /[\s/\-_.]/.test(s[i - 1]) ? 3 : 0)
    prev = i
    j++
  }
  return j === q.length ? score - s.length * 0.01 : 0
}

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useMemo(
    () =>
      items
        .map(x => ({ x, s: fuzzy(q, `${x.label} ${x.hint ?? ''}`) && fuzzy(q, x.label) + 0.5 * fuzzy(q, `${x.label} ${x.hint ?? ''}`) }))
        .filter(r => r.s > 0)
        .sort((a, b) => (q ? b.s - a.s : 0))
        .map(r => r.x),
    [items, q],
  )
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => void ref.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [i])
  const pick = (x?: PaletteItem) => {
    if (!x) return
    onClose()
    x.run()
  }
  return (
    <Modal title="Go to" onClose={onClose} wide>
      <input
        className="palette-input"
        value={q}
        autoFocus
        placeholder="Workspace, tab or action…"
        onChange={e => {
          setQ(e.target.value)
          setI(0)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') setI(n => Math.min(n + 1, list.length - 1))
          else if (e.key === 'ArrowUp') setI(n => Math.max(n - 1, 0))
          else if (e.key === 'Enter') pick(list[i])
          else return
          e.preventDefault()
        }}
      />
      <div className="palette-list" ref={ref}>
        {list.map((x, n) => (
          <div key={x.label + n} className={`palette-item ${n === i ? 'sel' : ''}`} onMouseMove={() => setI(n)} onClick={() => pick(x)}>
            <span className="pg">{x.glyph && <Glyph s={x.glyph} />}</span>
            <span className="pl">{x.label}</span>
            <span className="ph muted">{x.hint}</span>
          </div>
        ))}
        {!list.length && <div className="muted pad">Nothing matches.</div>}
      </div>
    </Modal>
  )
}

type DiffResult = { base: string; from: string; files: { path: string; add: number; del: number; status: string }[]; diff: string }

export function DiffPanel({ ws, onClose }: { ws: string; onClose: () => void }) {
  const [d, setD] = useState<DiffResult | null>(null)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const load = () => api.call<DiffResult>('diff', { ws }).then(setD, e => setErr(e.message))
  useEffect(() => {
    setD(null)
    load()
  }, [ws])
  const lines = useMemo(() => d?.diff.split('\n') ?? [], [d])
  const jump = (path: string) => {
    const el = box.current?.querySelector(`[data-file="${CSS.escape(path)}"]`)
    el?.scrollIntoView({ block: 'start' })
  }
  return (
    <div className="diff">
      <div className="diff-head">
        <b>Changes</b>
        <span className="muted"> vs {d?.base ?? '…'} (merge-base + uncommitted)</span>
        <span className="spacer" />
        <button className="link" onClick={load}>
          refresh
        </button>
        <button className="icon small" onClick={onClose} title="Close (⌘D)">
          ×
        </button>
      </div>
      {err && <div className="warn pad">{err}</div>}
      {d && (
        <div className="diff-files">
          {d.files.map(f => (
            <div key={f.path} className="diff-file" onClick={() => jump(f.path)}>
              <span className={`st st-${f.status}`}>{f.status}</span>
              <span className="fp">{f.path}</span>
              <span className="add">+{f.add}</span>
              <span className="del">−{f.del}</span>
            </div>
          ))}
          {!d.files.length && <div className="muted pad">No changes.</div>}
        </div>
      )}
      <div className="diff-body" ref={box}>
        {lines.map((l, n) => {
          const file = l.startsWith('diff --git') ? (l.match(/ b\/(.*)$/)?.[1] ?? '') : undefined
          const cls = file !== undefined ? 'dl-file' : l.startsWith('@@') ? 'dl-hunk' : l.startsWith('+++') || l.startsWith('---') || /^(index|new file|deleted file|similarity|rename) /.test(l) ? 'dl-meta' : l[0] === '+' ? 'dl-add' : l[0] === '-' ? 'dl-del' : ''
          return (
            <div key={n} className={`dl ${cls}`} data-file={file}>
              {l || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Inbox({ view, onClose, onPick }: { view: View; onClose: () => void; onPick: (tab: string) => void }) {
  const items = view.tabs
    .filter(t => t.status === 'waiting' || (t.done && t.status === 'idle') || t.limit)
    .sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1))
  const [preview, setPreview] = useState<Record<string, string>>({})
  useEffect(() => {
    for (const t of items) if (preview[t.id] === undefined) api.call<string>('screen', { target: t.id, lines: 8 }).then(s => setPreview(p => ({ ...p, [t.id]: s })), () => {})
  }, [items.map(t => t.id).join()])
  return (
    <Modal title="Inbox" onClose={onClose} wide>
      {!items.length && <div className="muted pad">Nothing needs you.</div>}
      <div className="inbox">
        {items.map(t => (
          <div key={t.id} className="inbox-item" onClick={() => onPick(t.id)}>
            <div className="inbox-head">
              <Glyph s={t.limit ? 'limit' : t.status === 'waiting' ? 'waiting' : 'done'} />
              <b>
                {t.workspace} / {t.name}
              </b>
              <span className="muted">{t.status === 'waiting' ? 'needs you' : t.limit ? `limit until ${new Date(t.limit).toLocaleTimeString()}` : 'finished'}</span>
            </div>
            <pre className="preview">{preview[t.id] ?? '…'}</pre>
          </div>
        ))}
      </div>
    </Modal>
  )
}
