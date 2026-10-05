import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { version } from '../../../package.json'
import { AGENT_NAMES, type Doctor, EFFORTS, isAgent, MODELS, type View } from '../../shared/types'
import { api, bridge, openExternal } from './api'
import icon from './icon.svg'
import { Glyph } from './Glyph'
import { type Img, PromptInput, TemplatePick, withImages } from './PromptInput'
import { clock, nameOf, templated, templatesFor } from './text'
import { Icon, IconButton, type IconName, Page, useMenu } from './ui'

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

const SITE = 'https://laki.igorkasyanchuk.com'

// the sidebar's video, to watch while you work: a YouTube embed with its own controls (main gives it a Referer: a
// file:// page has none, and YouTube refuses to play without one). Sandboxed: it can't take the window anywhere.
// Minimized: only its bar, the video playing on
export function Video({ src, min, onMin, onChange, onClose }: { src: string; min?: boolean; onMin: (min: boolean) => void; onChange: () => void; onClose: () => void }) {
  return (
    <div className="video">
      <div className="video-head">
        <Icon name="youtube" size={13} />
        <span className="muted small">YouTube</span>
        <span className="spacer" />
        <IconButton icon={min ? 'chevronUp' : 'chevron'} title={min ? 'Show the video' : 'Minimize: it plays on'} onClick={() => onMin(!min)} />
        <IconButton icon="pencil" title="Another video" onClick={onChange} />
        <IconButton icon="x" title="Close the video" onClick={onClose} />
      </div>
      <iframe
        hidden={min}
        src={src}
        title="YouTube video"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
      />
    </div>
  )
}

// a running timer, a bar over the sidebar's foot like the minimized video: the time left, ticking, and what it was set
// for; its menu changes it (more time, a new length, what happens as it ends)
export function TimerBar({ end, label, onMenu, onStop }: { end: number; label: string; onMenu: (e: MouseEvent<HTMLElement>) => void; onStop: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="timer-bar" onContextMenu={onMenu}>
      <Icon name="timer" size={13} />
      <span className="timer-left">{clock(end - Date.now())}</span>
      <span className="muted small timer-what">{label}</span>
      <span className="spacer" />
      <IconButton icon="pencil" title="Change it: more time, a new length, what happens as it ends" onClick={onMenu} />
      <IconButton icon="x" title="Stop it" onClick={onStop} />
    </div>
  )
}

// the header's fun button: a meme from r/memes, r/ProgrammerHumor or r/wholesomememes (the daemon fetches it, fun.ts),
// Next for another, Esc back to work; a right click on it: copy, download, open
export type Meme = { title: string; link: string; image: string; by?: string; sub?: string }
// the video's player told to play or pause (its embed has enablejsapi=1: it takes commands as messages)
export const videoCommand = (func: 'playVideo' | 'pauseVideo') =>
  document.querySelector<HTMLIFrameElement>('.video iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), 'https://www.youtube-nocookie.com')

export function Fun({ load, onClose }: { load: () => Promise<Meme>; onClose: () => void }) {
  const [m, setM] = useState<Meme | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState(false)
  const [menu, openMenu] = useMenu()
  const img = useRef<HTMLImageElement>(null)
  const next = () => {
    setBusy(true)
    setErr('')
    load()
      .then(setM, e => setErr((e as Error).message))
      .finally(() => setBusy(false))
  }
  useEffect(next, [])
  // the clipboard takes PNG only: a JPEG (or a GIF's first frame) drawn again as one
  const copy = () => {
    const i = img.current!
    const c = document.createElement('canvas')
    ;[c.width, c.height] = [i.naturalWidth, i.naturalHeight]
    c.getContext('2d')!.drawImage(i, 0, 0)
    const png = new Promise<Blob>((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error("couldn't copy it"))), 'image/png'))
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1500)),
      e => setErr((e as Error).message),
    )
  }
  // saved where the browser saves (the app asks where), named after its title
  const download = () => {
    if (!m) return
    const a = document.createElement('a')
    a.href = m.image
    a.download = `${m.title.replace(/[^\w ,.'-]+/g, '').trim().slice(0, 60) || 'meme'}.${m.image.slice(11, m.image.indexOf(';')).replace('jpeg', 'jpg')}`
    a.click()
  }
  // → or N: the next one
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (busy || e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'ArrowRight' && e.key.toLowerCase() !== 'n')) return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [busy])
  return (
    <Modal title="A little break" onClose={onClose} wide>
      <div className="fun">
        {m && (
          <>
            <a className="fun-title" href={m.link} onClick={e => (e.preventDefault(), openExternal(m.link))} data-tip="Open it on Reddit">
              {m.title}
            </a>
            <img
              ref={img}
              src={m.image}
              alt={m.title}
              className={busy ? 'dim' : ''}
              onContextMenu={e =>
                openMenu(e, [
                  { label: 'Copy image', icon: 'copy', key: 'c', run: copy },
                  { label: 'Download image', icon: 'import', key: 'd', run: download },
                  { label: 'Open on Reddit', icon: 'link', key: 'o', run: () => openExternal(m.link) },
                  null,
                  { label: 'Next', icon: 'arrowRight', key: 'n', run: next },
                ])
              }
            />
          </>
        )}
        {!m && busy && <div className="muted pad">Finding one…</div>}
        {err && <div className="warn small">{err}</div>}
        <div className="buttons">
          <span className="muted small">{[m?.by && `u/${m.by}`, `r/${m?.sub ?? 'memes'}`].filter(Boolean).join(' · ')}</span>
          <span className="spacer" />
          <button onClick={onClose}>Back to work</button>
          <button onClick={copy} disabled={busy || !m}>
            <Icon name="copy" /> {copied ? 'Copied' : 'Copy image'}
          </button>
          <button className="primary" onClick={next} disabled={busy} autoFocus data-tip="→ or N">
            {busy ? 'Loading…' : 'Next'} <Icon name="arrowRight" />
          </button>
        </div>
      </div>
      {menu}
    </Modal>
  )
}

// About (the app menu's, ⌘K): the version and the website
export function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About Laki" onClose={onClose}>
      <div className="about">
        <img src={icon} width={72} height={72} alt="" />
        <b className="about-name">Laki</b>
        <span className="muted small">Version {version}</span>
        <p>Coding agents side by side, each task in its own git worktree.</p>
        <a href={SITE} onClick={e => (e.preventDefault(), openExternal(SITE))}>
          {SITE.replace('https://', '')}
        </a>
      </div>
    </Modal>
  )
}

// fan: a race, the presets that each get a worktree on the same prompt (the preset first)
// pr: a GitHub PR's number or URL: the worktree on its branch (gh pr checkout), named after it
export type NewWsParams = { project: string; base?: string; preset: string; cmd?: string; prompt?: string; name?: string; local?: boolean; model?: string; effort?: string; fan?: string[]; pr?: string }

// initial: a laki://new link's prompt, preset and name
export function NewWorkspace({ view, project, agent, initial, onClose, onCreate }: { view: View; project?: string; agent?: string; initial?: Partial<NewWsParams>; onClose: () => void; onCreate: (p: NewWsParams) => Promise<void> }) {
  const [p, setP] = useState<NewWsParams>({ project: project ?? view.projects[0]?.id ?? '', preset: agent || 'claude', base: '', ...initial })
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false) // an image isn't saved yet
  const [tpl, setTpl] = useState('') // a prompt template's index ('' none)
  const set = (k: Partial<NewWsParams>) => setP(x => ({ ...x, ...k }))
  const templates = templatesFor(view.settings.templates, view.projects.find(x => x.id === p.project)?.config?.templates)
  const filled = templated(tpl ? templates[Number(tpl)] : undefined, p.prompt ?? '', { project: view.projects.find(x => x.id === p.project)?.name, base: p.base })
  const plain = view.projects.find(x => x.id === p.project)?.git === false // a folder without git: local only
  const starts = view.presets.find(x => x.name === p.preset)?.agent // what the preset starts: its model and effort flags
  const [rivals, setRivals] = useState<string[]>([]) // a race: the other presets on the same prompt
  const racers = view.presets.filter(x => x.name !== p.preset && x.agent !== 'command').map(x => x.name)
  const racing = !p.local && !plain && !p.pr?.trim() && isAgent(starts) && rivals.some(r => racers.includes(r)) // a PR's branch is checked out once
  const fan = racing ? [p.preset, ...rivals.filter(r => racers.includes(r))] : undefined
  useEffect(() => {
    setTpl('') // another project, other templates
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
      const own = isAgent(starts) && !fan // a race's agents keep their own models
      await onCreate({ ...p, pr: p.local || plain ? undefined : p.pr?.trim() || undefined, prompt, name: p.name || (tpl ? nameOf(p.prompt ?? '') : undefined), local: p.local || plain, preset: p.preset === 'custom' ? 'custom' : p.preset, cmd: p.preset === 'custom' ? p.cmd : undefined, model: own ? p.model?.trim() || undefined : undefined, effort: own ? p.effort || undefined : undefined, fan })
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
              <span>
                Pull request <span className="muted">(optional)</span>
              </span>
              <input value={p.pr ?? ''} placeholder="#123 or its URL" spellCheck={false} onChange={e => set({ pr: e.target.value.replace(/^#/, '') })} />
            </label>
            <label>
              Base branch
              <input list="branches" value={p.pr?.trim() ? "the PR's" : p.base} disabled={!!p.pr?.trim()} onChange={e => set({ base: e.target.value })} />
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
              <input value={p.name ?? ''} placeholder={p.pr?.trim() ? 'pr-<number>-<title>' : 'from the prompt'} onChange={e => set({ name: e.target.value })} />
            </label>
          </div>
        )}
        <label>
          Agent
          <div className="seg">
            {[...view.presets.map(x => x.name), 'shell', 'custom', 'none'].map(x => (
              <button type="button" key={x} className={p.preset === x ? 'on' : ''} onClick={() => set({ preset: x, model: undefined, effort: undefined }) /* another agent's names */}>
                {x}
              </button>
            ))}
          </div>
        </label>
        {!p.local && !plain && !p.pr?.trim() && isAgent(starts) && racers.length > 0 && (
          <div className="field">
            <span>
              Race <span className="muted">· the same prompt to more agents, each in a worktree of its own; Compare keeps the best</span>
            </span>
            <div className="seg">
              {racers.map(x => (
                <button type="button" key={x} className={rivals.includes(x) ? 'on' : ''} disabled={!rivals.includes(x) && rivals.filter(r => racers.includes(r)).length >= 5 /* six agents at most */} onClick={() => setRivals(r => (r.includes(x) ? r.filter(y => y !== x) : [...r, x]))}>
                  + {x}
                </button>
              ))}
            </div>
          </div>
        )}
        {isAgent(starts) && !racing && (
          <div className="row">
            <label>
              <span>
                Model <span className="muted">(optional)</span>
              </span>
              <input list="models" value={p.model ?? ''} spellCheck={false} placeholder={starts === 'opencode' ? 'provider/model' : "the agent's default"} onChange={e => set({ model: e.target.value })} />
              <datalist id="models">
                {(MODELS[starts] ?? []).map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {EFFORTS[starts] && (
              <label>
                Effort
                <select value={p.effort ?? ''} onChange={e => set({ effort: e.target.value })}>
                  <option value="">the agent's default</option>
                  {EFFORTS[starts]!.map(x => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
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
            {busy ? 'Creating…' : saving ? 'Saving image…' : fan ? `Create ${fan.length} workspaces` : 'Create'}
          </button>
        </div>
      </form>
    </Page>
  )
}

// a folder's path here, or host:path over SSH (a ~/.ssh/config name or user@host)
export function AddProject({ onClose, onAdd }: { onClose: () => void; onAdd: (path: string) => Promise<void> }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add project" onClose={onClose}>
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          setBusy(true)
          onAdd(path.trim())
            .catch(() => {})
            .finally(() => setBusy(false))
        }}
      >
        <label>
          Folder
          <input value={path} autoFocus placeholder="/Users/you/code/app or devbox:~/code/app" onChange={e => setPath(e.target.value)} />
        </label>
        <div className="muted small">
          Over SSH: <code>host:path</code>, a host from ~/.ssh/config or user@host. Laki signs in with your SSH keys or agent; git, gh and the agents run there.
        </div>
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!path.trim() || busy}>
            {busy ? 'Connecting…' : 'Add'}
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

// what the palette ran last (labels, newest first; localStorage laki.recent): first in it, and ahead when they match
const RECENT = 30
const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('laki.recent') ?? '[]')
  } catch {
    return []
  }
}

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ran = useMemo(recent, [])
  const list = useMemo(() => {
    const rank = (x: PaletteItem) => (r => (r < 0 ? 0 : RECENT - r))(ran.indexOf(x.label)) // 30 for the last one, 0: never
    return items
      .map(x => ({ x, r: rank(x), s: fuzzy(q, `${x.label} ${x.hint ?? ''}`) && fuzzy(q, x.label) + 0.5 * fuzzy(q, `${x.label} ${x.hint ?? ''}`) }))
      .filter(r => r.s > 0)
      .map(r => ({ ...r, s: r.s + r.r * 0.1 })) // a recent one wins a close call, not a much better match
      .sort((a, b) => (q ? b.s - a.s : b.r - a.r))
      .map(r => r.x)
  }, [items, q, ran])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => void ref.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [i])
  const pick = (x?: PaletteItem) => {
    if (!x) return
    try {
      localStorage.setItem('laki.recent', JSON.stringify([x.label, ...recent().filter(l => l !== x.label)].slice(0, RECENT)))
    } catch {}
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

const REPO = 'https://github.com/igorkasyanchuk/laki'

// a nudge to star the repo, at the foot of the empty pages
export const StarLaki = () => (
  <button className="ready-star" onClick={() => openExternal(REPO)}>
    <Icon name="github" size={14} /> Enjoying Laki? <b>Give it a star on GitHub</b> <span aria-hidden>★</span>
  </button>
)

const TIPS: [string, string, string][] = [
  ['⌘N', 'A workspace per task', 'Its own branch, worktree and $PORT: agents never trip over each other'],
  ['⌘J', 'Jump to who needs you', 'The next agent waiting for an answer, or done'],
  ['Race', 'One prompt, many agents', 'Compare their work side by side and keep the best'],
  ['⌘K', 'Everything by name', 'Workspaces, tabs, actions and settings'],
]

// a workspace without tabs: start something (agents first), what Laki is good at, and the star
export function Ready({ name, branch, actions }: { name: string; branch?: string; actions: { label: string; icon?: IconName; hint?: string; run: () => void }[] }) {
  const agents = actions.filter(a => a.icon === 'agent')
  return (
    <div className="ready">
      <img src={icon} alt="" />
      <h1>{name} is ready</h1>
      <p className="muted">{branch ? <>A worktree of its own on <code>{branch}</code>. Start an agent on the task, or a shell to look around.</> : 'Start an agent on the task, or a shell to look around.'}</p>
      <div className="ready-starts">
        {[...agents, ...actions.filter(a => !agents.includes(a))].map((a, i) => (
          <button key={a.label} className={i === 0 && agents.length ? 'primary' : ''} onClick={a.run}>
            <Icon name={a.icon ?? 'terminal'} size={14} /> {a.label}
            {a.hint && <kbd>{a.hint}</kbd>}
          </button>
        ))}
      </div>
      <div className="ready-tips">
        {TIPS.map(([k, title, text]) => (
          <div key={title} className="ready-tip">
            <kbd>{k}</kbd>
            <b>{title}</b>
            <span className="muted">{text}</span>
          </div>
        ))}
      </div>
      <StarLaki />
    </div>
  )
}

// no project yet: a drop target and what's installed (the daemon's doctor; an older one has none: just the target)
export function Welcome({ onOpen, onSsh, check }: { onOpen: () => void; onSsh: () => void; check: () => Promise<Doctor> }) {
  const [d, setD] = useState<Doctor | null>(null)
  useEffect(() => void check().then(setD, () => {}), [])
  const row = (ok: boolean, name: string, hint: string) => (
    <div className="check" key={name}>
      <Glyph s={ok ? 'ok' : 'exited'} />
      <b>{name}</b>
      <span className="muted">{hint}</span>
    </div>
  )
  const found = d?.agents.filter(a => a.found) ?? []
  const missing = d?.agents.filter(a => !a.found) ?? []
  return (
    <div className="welcome">
      <img src={icon} alt="" />
      <h1>Welcome to Laki</h1>
      <p className="muted">Agents side by side, each task in its own git worktree.</p>
      <button className="welcome-drop" onClick={onOpen}>
        <Icon name="folderPlus" size={22} />
        <b>Open a project folder</b>
        <span className="muted">or drop one on the window · ⌘O</span>
      </button>
      <button className="welcome-ssh" onClick={onSsh}>
        <Icon name="server" /> Open a folder over SSH…
      </button>
      {d && (
        <div className="welcome-checks">
          {row(d.git, 'git', d.git ? 'found' : 'needed for worktrees: xcode-select --install')}
          {row(d.gh === 'in', 'gh', d.gh === 'in' ? 'signed in: PRs, checks and Ship work' : d.gh === 'out' ? 'not signed in, for PRs: gh auth login' : 'not found, for PRs: brew install gh')}
          {found.length ? found.map(a => row(true, AGENT_NAMES[a.id], 'on PATH: a preset')) : row(false, 'agents', 'none on PATH: install Claude Code or Codex, then restart Laki')}
          {missing.length > 0 && found.length > 0 && <div className="muted small">Not on PATH: {missing.map(a => AGENT_NAMES[a.id]).join(', ')}</div>}
        </div>
      )}
    </div>
  )
}
