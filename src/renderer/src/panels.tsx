import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { View } from '../../shared/types'
import { api, bridge } from './api'
import { Glyph } from './Glyph'
import { type Img, PromptInput, TemplatePick, withImages } from './PromptInput'
import { nameOf, templated } from './text'
import { Icon, type IconName, Page } from './ui'

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

// initial: a laki://new link's prompt, preset and name
export function NewWorkspace({ view, project, agent, initial, onClose, onCreate }: { view: View; project?: string; agent?: string; initial?: Partial<NewWsParams>; onClose: () => void; onCreate: (p: NewWsParams) => Promise<void> }) {
  const [p, setP] = useState<NewWsParams>({ project: project ?? view.projects[0]?.id ?? '', preset: agent || 'claude', base: '', ...initial })
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false) // an image isn't saved yet
  const [tpl, setTpl] = useState('') // a prompt template's index ('' none)
  const set = (k: Partial<NewWsParams>) => setP(x => ({ ...x, ...k }))
  const templates = view.settings.templates ?? []
  const filled = templated(tpl ? templates[Number(tpl)] : undefined, p.prompt ?? '', { project: view.projects.find(x => x.id === p.project)?.name, base: p.base })
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
    if (busy || saving) return
    setBusy(true)
    try {
      const prompt = withImages(filled, images) || undefined
      await onCreate({ ...p, prompt, name: p.name || (tpl ? nameOf(p.prompt ?? '') : undefined), local: p.local || plain, preset: p.preset === 'custom' ? 'custom' : p.preset, cmd: p.preset === 'custom' ? p.cmd : undefined })
    } catch {
      setBusy(false)
    }
  }
  if (!view.projects.length)
    return (
      <Page title="New workspace" onClose={onClose}>
        <p className="muted">Open a folder first (⌘O), or drop one on the window.</p>
      </Page>
    )
  return (
    <Page title="New workspace" onClose={onClose}>
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
              onBusy={setSaving}
              rows={12}
            />
            <TemplatePick templates={templates} value={tpl} onChange={setTpl} preview={filled} />
          </div>
        )}
        <div className="buttons">
          <span className="muted">⌘⏎ create · esc cancel</span>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || saving || !p.project}>
            {busy ? 'Creating…' : saving ? 'Saving image…' : 'Create'}
          </button>
        </div>
      </form>
    </Page>
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
