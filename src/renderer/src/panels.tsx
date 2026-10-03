import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectConfig, View } from '../../shared/types'
import { api, bridge } from './api'
import { Glyph } from './Glyph'
import { type Img, PromptInput, withImages } from './PromptInput'
import { EnvField } from './Settings'
import { Icon, type IconName } from './ui'

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

export function NewWorkspace({ view, project, agent, onClose, onCreate }: { view: View; project?: string; agent?: string; onClose: () => void; onCreate: (p: NewWsParams) => Promise<void> }) {
  const [p, setP] = useState<NewWsParams>({ project: project ?? view.projects[0]?.id ?? '', preset: agent || 'claude', base: '' })
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<Img[]>([])
  const set = (k: Partial<NewWsParams>) => setP(x => ({ ...x, ...k }))
  const plain = view.projects.find(x => x.id === p.project)?.git === false // a folder without git: local only
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
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const prompt = withImages(p.prompt ?? '', images) || undefined
      await onCreate({ ...p, prompt, local: p.local || plain, preset: p.preset === 'custom' ? 'custom' : p.preset, cmd: p.preset === 'custom' ? p.cmd : undefined })
    } catch {
      setBusy(false)
    }
  }
  if (!view.projects.length)
    return (
      <Modal title="New workspace" onClose={onClose}>
        <p className="muted">Open a folder first (⌘O), or drop one on the window.</p>
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
        {plain ? (
          <div className="muted small">A folder without git: the workspace runs in the folder itself.</div>
        ) : (
          <label className="check">
            <input type="checkbox" checked={!!p.local} onChange={e => set({ local: e.target.checked })} /> Local: work in the repo itself (no worktree)
          </label>
        )}
        {!p.local && !plain && (
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
            {[...view.presets.map(x => x.name), 'shell', 'custom', 'none'].map(x => (
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
        {view.presets.some(x => x.name === p.preset && x.agent !== 'command') && (
          <div className="field">
            <span>
              Prompt <span className="muted">(optional)</span>
            </span>
            <PromptInput
              value={p.prompt ?? ''}
              onChange={prompt => set({ prompt })}
              images={images}
              onImages={setImages}
              save={(data, ext) => api.call<string>('imageSave', { data, ext })}
              dictate={bridge?.dictate}
              dictationSettings={bridge?.dictationSettings}
              onSubmit={submit}
            />
          </div>
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
          Folder
          <input value={path} autoFocus placeholder="/Users/you/code/app" onChange={e => setPath(e.target.value)} />
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

// a project's name and commands; empty fields fall back to the repo's .wb.json (shown as placeholders)
export function ProjectSettings({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (p: { name: string; config: ProjectConfig }) => Promise<void> }) {
  const [name, setName] = useState(project.name)
  const [c, setC] = useState<ProjectConfig>(project.config ?? {})
  const [file, setFile] = useState<ProjectConfig>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.call<ProjectConfig>('projectFile', { id: project.id }).then(setFile, () => {}), [project.id])
  const field = (k: 'setup' | 'run' | 'teardown', title: string, hint: string) => (
    <label>
      <span>
        {title} <span className="muted">· {hint}</span>
      </span>
      <input className="mono" value={c[k] ?? ''} placeholder={file[k] ? `${file[k]}   (.wb.json)` : ''} onChange={e => setC(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )
  return (
    <Modal title="Project settings" onClose={onClose}>
      <form
        className="form"
        onSubmit={async e => {
          e.preventDefault()
          setBusy(true)
          await onSave({ name, config: c }).catch(() => setBusy(false))
        }}
      >
        <label>
          Name
          <input value={name} autoFocus onChange={e => setName(e.target.value)} />
        </label>
        <div className="muted small mono">
          {project.path} · {project.git === false ? 'folder (no git)' : 'git'}
        </div>
        {project.git !== false && field('setup', 'Setup', 'runs in each new worktree, e.g. npm install')}
        {field('run', 'Run', 'the dev server, e.g. npm run dev -- --port $PORT')}
        {field('teardown', 'Teardown', 'runs when a workspace is deleted or archived')}
        <label>
          <span>
            Env <span className="muted">· for every tab, setup and teardown{file.env && Object.keys(file.env).length ? ` · .wb.json has ${Object.keys(file.env).join(', ')}` : ''}</span>
          </span>
          <EnvField value={c.env} onChange={env => setC(x => ({ ...x, env }))} />
        </label>
        <div className="buttons">
          <span className="muted small">Empty: the repo's .wb.json</span>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function Prompt({ title, hint, placeholder, initial = '', onClose, onSubmit }: { title: string; hint?: string; placeholder?: string; initial?: string; onClose: () => void; onSubmit: (v: string) => Promise<void> }) {
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          if (v.trim()) onSubmit(v.trim()).catch(() => {})
        }}
      >
        <input value={v} autoFocus placeholder={placeholder} onFocus={e => e.target.select()} onChange={e => setV(e.target.value)} />
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

export type PaletteItem = { label: string; hint?: string; glyph?: string; icon?: IconName; run: () => void }

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
            <span className="pg">{x.icon ? <Icon name={x.icon} /> : x.glyph && <Glyph s={x.glyph} />}</span>
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
