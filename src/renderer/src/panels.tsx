import { type ComponentProps, type CSSProperties, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { version } from '../../../package.json'
import { REPO, AGENT_NAMES, type Doctor, type Agent, FAST, HOME_ACCOUNT, EFFORTS, isAgent, PERMS, permInArgs, type LogLine, MODELS, prIn, type View } from '../../shared/types'
import { api, bridge, fileOf, openExternal, openKeptLink } from './api'
import icon from './icon.svg'
import { Glyph } from './Glyph'
import { Markdown } from './MarkdownView'
import { THEMES } from './themes'
import { type Img, type Inserted, type Inserts, PromptInput, withImages } from './PromptInput'
import { clock, laterText, nameOf, parseDuration, parseLater, prRef, templated, templatesFor, withPaths } from './text'
import { escapes, Icon, IconButton, type IconName, keep, load, type MenuItem, ON, Page, ProjectMark, Switch, useMenu } from './ui'

// a click outside closes it, unless something was typed in it: then it nods instead (Esc or its buttons close it);
// loose: closed by a click outside whatever was typed (a search; notes, whose close saves)
export function Modal({ title, onClose, children, wide, loose }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; loose?: boolean }) {
  const typed = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: KeyboardEvent) => escapes(e) && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  // the keyboard comes to it (a terminal that kept it would take Esc to its agent, and the dialog would stay), and goes
  // back where it was as it closes; a field that took it first (autoFocus) keeps it
  const [was] = useState(() => document.activeElement as HTMLElement | null) // before its fields' autoFocus
  useEffect(() => {
    const el = box.current
    if (!el?.contains(document.activeElement)) el?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (was?.isConnected && (!now || now === document.body || el?.contains(now))) was.focus() // not over what took it since
    }
  }, [])
  const outside = () => (typed.current && !loose ? box.current?.animate([{ scale: 1 }, { scale: 1.02 }, { scale: 1 }], { duration: 200, easing: 'ease-out' }) : onClose())
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && outside()}>
      <div ref={box} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onInput={() => (typed.current = true)}>
        <div className="modal-title">
          <span className="grow">{title}</span>
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

// a project's notes (its ⋯ menu's Notes, the project page's Notes): its Markdown rendered, Edit for the text (empty:
// editing from the start); leaving it (closed, another tab) saves an edit
export function NotesView({ notes, onSave, onClose }: { notes: string; onSave: (text: string) => Promise<unknown>; onClose?: () => void }) {
  const [edit, setEdit] = useState<string | null>(notes.trim() ? null : '')
  const save = (then: () => void) => (edit !== null && edit !== notes ? onSave(edit).then(then, () => {}) : then())
  const last = useRef({ edit, notes, onSave })
  last.current = { edit, notes, onSave }
  useEffect(() => () => void (({ edit, notes, onSave }) => edit !== null && edit !== notes && onSave(edit).catch(() => {}))(last.current), [])
  return (
    <>
      {edit === null ? (
        <div className="notes-view">
          <Markdown src={notes} />
        </div>
      ) : (
        <textarea
          className="notes-edit mono"
          autoFocus
          value={edit}
          aria-label="Notes, in Markdown"
          placeholder={'Links, how to run it, who to ask…\n\n# Headings, - lists, [a link](https://…), `code`'}
          onChange={e => setEdit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), save(() => setEdit(null)))}
        />
      )}
      <div className="row">
        <span className="muted small grow">{edit === null ? 'Kept with the project in Laki; agents never see them' : 'Markdown · ⌘⏎ saves · leaving saves too'}</span>
        {edit === null ? (
          <button onClick={() => setEdit(notes)}>
            <Icon name="pencil" /> Edit
          </button>
        ) : (
          notes.trim() && <button onClick={() => setEdit(null)}>Cancel</button>
        )}
        {(edit !== null || onClose) && (
          <button className="primary" onClick={() => (edit === null ? onClose!() : save(() => setEdit(null)))}>
            {edit === null ? 'Close' : 'Save'}
          </button>
        )}
      </div>
    </>
  )
}
export function ProjectNotes({ name, notes, onSave, onClose }: { name: string; notes: string; onSave: (text: string) => Promise<unknown>; onClose: () => void }) {
  return (
    <Modal title={`Notes · ${name}`} onClose={onClose} wide loose /* closing saves */>
      <NotesView notes={notes} onSave={onSave} onClose={onClose} />
    </Modal>
  )
}

const SITE = 'https://laki.igorkasyanchuk.com'

// development mode's event log for a workspace (ws:<id>) or a widget (widget:<id>): the daemon's last 500 lines,
// newest at the bottom, asked again every 2 s while it's open
export function Logs({ title, load, copy, onClose }: { title: string; load: () => Promise<LogLine[]>; copy: (text: string) => void; onClose: () => void }) {
  const [lines, setLines] = useState<LogLine[] | null>(null)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const ld = useRef(load)
  ld.current = load
  useEffect(() => {
    let live = true
    const get = () => ld.current().then(l => live && (setLines(l), setErr('')), e => live && setErr(String(e?.message ?? e)))
    get()
    const t = setInterval(get, 2000)
    return () => void ((live = false), clearInterval(t))
  }, [])
  const stick = useRef(true) // at the bottom (as it opens too): it follows
  useEffect(() => void (box.current && stick.current && (box.current.scrollTop = box.current.scrollHeight)), [lines])
  const text = (l: LogLine) => `${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${l.text}${l.n ? ` (×${l.n})` : ''}`
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="logs" ref={box} onScroll={e => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 60)}>
        {err && <div className="warn small">{err}</div>}
        {lines?.map((l, i) => (
          <div key={i} className="log-line">
            {text(l)}
          </div>
        ))}
        {lines && !lines.length && <div className="muted small">Nothing yet: it logs from when development mode went on (Settings › General).</div>}
      </div>
      <div className="row">
        <span className="muted small grow">Kept in the daemon's memory, the last 500 lines; a restart starts over.</span>
        <button disabled={!lines?.length} onClick={() => copy(lines!.map(text).join('\n'))}>
          <Icon name="copy" /> Copy
        </button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

// a failing check's log (Info's and Review's Log): the end of its failed steps, each step's name over its lines, read
// again each time it opens; Send to the agent is Let the agent fix's message with this check's log only
export function CiLog({ name, url, load, onSend, onOpen, copy, onClose }: { name: string; url?: string; load: () => Promise<string>; onSend: () => Promise<boolean>; onOpen: (url: string) => void; copy: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLPreElement>(null)
  const live = useRef(true) // still open: a send that ends after it closed closes nothing opened since
  useEffect(() => {
    live.current = true
    load().then(t => live.current && setText(t), e => live.current && setErr(String(e?.message ?? e).split('\n')[0]))
    return () => void (live.current = false)
  }, [])
  useEffect(() => void (box.current && (box.current.scrollTop = box.current.scrollHeight)), [text]) // the failure is at the end
  const send = () => (setSending(true), onSend().then(ok => live.current && (ok ? onClose() : setSending(false))))
  // ponytail: a log line of its own that starts with "▸ " is drawn as a step's name too
  return (
    <Modal title={`Log · ${name}`} onClose={onClose} wide>
      <pre className="logs ci-log" ref={box}>
        {err ? <span className="warn">{err}</span> : text === null ? <span className="muted">Reading the log…</span> : !text ? <span className="muted">No failed steps' log for it.</span> : text.split('\n').map((l, i) => (l.startsWith('▸ ') ? <b key={i}>{l}{'\n'}</b> : `${l}\n`))}
      </pre>
      <div className="row">
        <span className="muted small grow">The last 80 lines of its failed steps</span>
        {url && (
          <button onClick={() => onOpen(url)}>
            <Icon name="github" /> Open on GitHub
          </button>
        )}
        <button disabled={!text} onClick={() => copy(text!)}>
          <Icon name="copy" /> Copy
        </button>
        <button className="primary" disabled={sending} onClick={send}>
          <Icon name="agent" /> {sending ? 'Sending…' : 'Send to the agent'}
        </button>
      </div>
    </Modal>
  )
}

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
export function TimerBar({ end, left, label, tip, onMenu, onPause, onStop }: { end: number; left?: number; label: string; tip?: string; onMenu: (e: MouseEvent<HTMLElement>) => void; onPause?: () => void; onStop: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (left !== undefined) return // paused: nothing moves
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [left])
  return (
    <div className={`timer-bar ${left !== undefined ? 'paused' : ''}`} onContextMenu={onMenu} data-tip={tip}>
      <Icon name="timer" size={13} />
      <span className="timer-left">{clock(left ?? end - Date.now())}</span>
      <span className="muted small timer-what">{left !== undefined ? `${label}, paused` : label}</span>
      <span className="spacer" />
      {onPause && <IconButton icon={left !== undefined ? 'run' : 'pause'} title={left !== undefined ? 'Go on' : 'Pause'} onClick={onPause} />}
      <IconButton icon="pencil" title="Change it: more time, a new length, what happens as it ends" onClick={onMenu} />
      <IconButton icon="x" title="Stop it" onClick={onStop} />
    </div>
  )
}

// Get started: the steps a new Laki takes, shown once as it opens (App's laki.onboard). Each is done by itself as it
// happens (App's onboardDone: a project added, Settings' sections seen…) or ticked by hand; Go does it. Skip for now
// closes it and leaves what's left at the sidebar's foot (OnboardBar); Don't show again hides both
export const STEPS: { id: string; title: string; hint: string; go: string }[] = [
  { id: 'project', title: 'Add a project', hint: "A git repository or any folder: + at the sidebar's top, ⌘O, or drop a folder on the window", go: 'Add one' },
  { id: 'workspace', title: 'Start a workspace', hint: 'An agent and a prompt, in a git worktree of its own, so agents never step on each other (⌘N)', go: 'New workspace' },
  { id: 'settings', title: 'Look around Settings', hint: 'Themes, fonts, notifications, your agents and how they start (⌘,)', go: 'Settings' },
  { id: 'widgets', title: 'Turn on an extension', hint: 'Small live pages in the sidebar or on the Desk: your PRs, your links, or one you make', go: 'Extensions' },
  { id: 'actions', title: 'Set up actions', hint: 'Run ▾: the prompts and commands you send often, a click away', go: 'Actions' },
  { id: 'templates', title: 'Write a prompt template', hint: "A new workspace's prompt with your rules around it", go: 'Prompt templates' },
  { id: 'shell', title: 'Open a terminal or a browser', hint: "+ at the sidebar's top: a terminal in your home folder, or any website, without leaving Laki", go: 'New terminal' },
  { id: 'experimental', title: 'Visit Experimental', hint: 'New things to try: Calendar, Notes, To-dos', go: 'Experimental' },
  { id: 'presets', title: 'Set up agents & profiles', hint: 'Each profile its agent, model, effort and account: a second Claude plan, a cheaper model', go: 'Agents & profiles' },
  { id: 'remote', title: 'Try remote access', hint: 'Laki on your phone: signed in by email (Cloudflare), with a PIN, or over Tailscale', go: 'Remote access' },
  { id: 'schedules', title: 'Schedule a prompt', hint: 'An agent on a prompt every weekday at 9am, or once tomorrow', go: 'Scheduled tasks' },
  { id: 'workflows', title: 'Try a workflow', hint: 'Blocks Laki runs for a task: agents, commands, your answers, a PR', go: 'Workflows' },
]

export function Onboarding({ done, onGo, onTick, onSkip, onOff, theme, onTheme }: { done: Set<string>; onGo: (id: string) => void; onTick: (id: string) => void; onSkip: () => void; onOff: () => void; theme: string; onTheme: (id: string) => void }) {
  const n = STEPS.filter(x => done.has(x.id)).length
  const next = STEPS.find(x => !done.has(x.id))?.id // the one step in the accent: the rest wait their turn
  return (
    <Modal title="Get started with Laki" onClose={onSkip} wide>
      <div className="onboard">
        <div className="ob-bar" style={{ '--p': `${(n / STEPS.length) * 100}%` } as CSSProperties} />
        <p className="muted small">{n === STEPS.length ? 'All done. Enjoy Laki!' : `${n} of ${STEPS.length} done. A step ticks itself as you do it; click its circle to tick it yourself.`}</p>
        <label className="ob-step ob-theme">
          <Icon name="palette" />
          <div className="ob-what">
            <b>Pick a theme</b>
            <span className="muted small">Painted as you pick; Settings › Appearance has them all with a preview</span>
          </div>
          <select value={theme} onChange={e => onTheme(e.target.value)} aria-label="Theme">
            {([['Dark', false], ['Light', true]] as const).map(([g, light]) => (
              <optgroup key={g} label={g}>
                {THEMES.filter(t => !!t.light === light).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="ob-steps">
        {STEPS.map(x => (
          <div key={x.id} className={`ob-step ${done.has(x.id) ? 'done' : ''}`}>
            <button className="ob-tick" aria-pressed={done.has(x.id)} disabled={done.has(x.id)} data-tip={done.has(x.id) ? 'Done' : 'Mark it done'} onClick={() => onTick(x.id)}>
              {done.has(x.id) && <Icon name="check" size={12} />}
            </button>
            <div className="ob-what">
              <b>{x.title}</b>
              <span className="muted small">{x.hint}</span>
            </div>
            <button className={x.id === next ? 'primary' : ''} onClick={() => onGo(x.id)}>
              {x.go}
            </button>
          </div>
        ))}
        </div>
        <div className="row">
          <button onClick={onOff}>Don't show again</button>
          <span className="grow" />
          <button className={next ? '' : 'primary'} onClick={onSkip}>
            {n === STEPS.length ? 'Close' : 'Skip for now'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// what's left of Get started, at the sidebar's foot: a click opens it again, × hides it for good
export function OnboardBar({ done, onOpen, onOff }: { done: number; onOpen: () => void; onOff: () => void }) {
  return (
    <div className="timer-bar onboard-bar" onClick={onOpen} data-tip="Get started: the steps left">
      <Icon name="check" size={13} />
      <span className="timer-what">Get started</span>
      <span className="muted small">
        {done} of {STEPS.length}
      </span>
      <span className="ob-mini" style={{ '--p': `${(done / STEPS.length) * 100}%` } as CSSProperties} />
      <IconButton icon="x" title="Hide it (⌘K › Get started brings it back)" onClick={e => (e.stopPropagation(), onOff())} />
    </div>
  )
}

// a stopwatch, a bar like a timer's: the time since it started (ms: what earlier runs added up to; from: running
// since), start or pause, reset, close
export function StopwatchBar({ ms, from, onToggle, onReset, onClose }: { ms: number; from?: number; onToggle: () => void; onReset: () => void; onClose: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!from) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [from])
  return (
    <div className={`timer-bar ${from ? '' : 'paused'}`}>
      <Icon name="clock" size={13} />
      <span className="timer-left">{clock(Math.floor((ms + (from ? Date.now() - from : 0)) / 1000) * 1000)}</span>
      <span className="muted small timer-what">{from ? 'stopwatch' : 'stopwatch, paused'}</span>
      <span className="spacer" />
      <IconButton icon={from ? 'pause' : 'run'} title={from ? 'Pause' : 'Start'} onClick={onToggle} />
      <IconButton icon="refresh" title="Reset to 0:00" onClick={onReset} />
      <IconButton icon="x" title="Close it" onClick={onClose} />
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
          <span className="muted small">{copied ? 'Copied' : [m?.by && `u/${m.by}`, `r/${m?.sub ?? 'memes'}`].filter(Boolean).join(' · ')}</span>
          <span className="spacer" />
          <button onClick={onClose}>Back to work</button>
          <button className="primary" onClick={next} disabled={busy} autoFocus data-tip="→ or N">
            {busy ? 'Loading…' : 'Next'} <Icon name="arrowRight" />
          </button>
        </div>
      </div>
      {menu}
    </Modal>
  )
}

// About (the app menu's, ⌘K): the version, when it was built and the website
declare const __BUILT__: string // electron.vite.config.ts' define
export function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About Laki" onClose={onClose}>
      <div className="about">
        <img src={icon} width={72} height={72} alt="" />
        <b className="about-name">Laki</b>
        <span className="muted small">Version {version}</span>
        {typeof __BUILT__ === 'string' /* dev:web's plain vite has none */ && <span className="muted small">Built {new Date(__BUILT__).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        <p>Coding agents side by side, each task in its own git worktree.</p>
        <a href={SITE} onClick={e => (e.preventDefault(), openExternal(SITE))}>
          {SITE.replace('https://', '')}
        </a>
        <a className="small" href={`${REPO}/blob/main/SECURITY.md`} onClick={e => (e.preventDefault(), openExternal(`${REPO}/blob/main/SECURITY.md`))}>
          Security: reporting a vulnerability
        </a>
      </div>
    </Modal>
  )
}

// fan: a race, the presets that each get a worktree on the same prompt (the preset first)
// pr: a GitHub PR's number or URL: the worktree on its branch (gh pr checkout), named after it
// place: the sidebar's place, 'top' of the project or a sep's id (first under it)
export type NewWsParams = { project: string; base?: string; preset: string; cmd?: string; prompt?: string; name?: string; local?: boolean; model?: string; effort?: string; perm?: string; fast?: boolean; fan?: string[]; pr?: string; place?: string; vars?: boolean; noSetup?: boolean; codespace?: string } // codespace: a cloud workspace (settings.cloud) on that machine type; perm: PERMS' id; noSetup: without the setup script (More's; never kept, not in a draft either); vars: a template's agent variables ({{branch}}…), the daemon's to fill

// the page's last choices, kept per viewer (not the prompt, name, PR or a race: those are one workspace's, and a race
// kept would make several worktrees from a folded More)
type LastNew = Partial<Pick<NewWsParams, 'project' | 'preset' | 'cmd' | 'local' | 'model' | 'effort' | 'perm' | 'fast' | 'place'>> & { tpl?: string; agent?: string } // not the base: the repo's main one each time, unless picked
const LAST_NEW = 'laki.newWs'
// what the page held as it closed without making it (Esc, ✕, a click in the sidebar): back as it opens again, until it's
// made or cleared
const DRAFT = 'laki.newDraft'
type Draft = { p: NewWsParams; images: Img[]; rivals: string[]; tpl: string; prev?: string } // prev: an earlier prompt a link's replaced
// the agent menu's choices after the presets: what each says, its icon
const OTHER_AGENTS: [string, string, IconName, string][] = [
  ['shell', 'Shell', 'terminal', 'A terminal in the workspace’s folder'],
  ['custom', 'Custom command…', 'code', 'Any program: aider, a script…'],
  ['none', 'No agent', 'minus', 'Opens empty, for you to start what you like'],
]
// the model menu's lines (claude's own words for them) and how much each costs next to the others
const MODEL_SAYS: Record<string, [string, string, 'good' | 'warn' | undefined]> = {
  fable: ['For the hardest problems', '$$$$', 'warn'],
  opus: ['For complex work', '$$$', 'warn'],
  sonnet: ['For most tasks', '$$', undefined],
  haiku: ['For quick questions: the fastest', '$', 'good'],
}

// initial: a laki://new link's prompt and name (linked: the page says it came from a link, while it's that prompt); project and initial win over the last choices; images: the menu
// bar's screenshots
const notesOf = (s?: Shot[]) => (s ?? []).flatMap(x => (x.note ? [x.note] : []))
export type Shot = Img & { note?: string } // the menu bar's screenshot, and what to do with it (the editor's note)
export function NewWorkspace({ view, project, agent, initial, images: shots, inserts, onClose, onCreate }: { view: View; project?: string; agent?: string; initial?: Partial<NewWsParams> & { linked?: boolean }; images?: Shot[]; inserts?: (project: string) => Inserts; onClose: () => void; onCreate: (p: NewWsParams) => Promise<void> }) {
  const last = useMemo(() => load<LastNew>(LAST_NEW, {}), [])
  // opened for another project than the draft's (its + or a group's New workspace here, ⌘N on one of its workspaces): the
  // draft goes, prompt and all, and the page starts empty there
  const draft = useMemo(() => {
    const d = load<Draft | null>(DRAFT, null)
    return d?.p && (!project || d.p.project === project) ? d : null // no p: not a draft this page wrote
  }, [])
  const [p, setP] = useState<NewWsParams>(() => {
    const names = [...view.presets.filter(x => !x.off).map(x => x.name), 'shell', 'custom', 'none']
    const d = draft?.p
    // the draft's agent, else the last one, unless Settings › New workspaces start changed since: then that one
    const preset = initial?.preset ?? (d?.preset && names.includes(d.preset) ? d.preset : last.preset && names.includes(last.preset) && last.agent === agent ? last.preset : agent && names.includes(agent) ? agent : (names[0] ?? 'claude')) // a default that's off: the first that's on
    const same = preset === last.preset // the model and effort are that agent's
    const there = d && view.projects.some(x => x.id === d.project) && (!project || project === d.project) // the draft's project: its base and group too
    const proj = project ?? (there ? d.project : view.projects.some(x => x.id === last.project) ? last.project! : (view.projects[0]?.id ?? ''))
    return {
      project: proj,
      place: proj === last.project ? last.place : undefined, // that project's sep, if it's still there (submit checks)
      preset,
      cmd: last.cmd,
      local: last.local,
      model: same ? last.model : undefined,
      effort: same ? last.effort : undefined,
      perm: same ? last.perm : undefined,
      fast: same ? last.fast : undefined,
      base: '',
      ...(d && { ...d, project: proj, preset, noSetup: undefined, ...(preset !== d.preset && { model: undefined, effort: undefined, perm: undefined, fast: undefined }), ...(!there && { place: undefined, base: '' }) }),
      ...(initial && (({ linked: _, ...x }) => x)(initial)),
      ...(notesOf(shots).length && { prompt: [initial?.prompt ?? d?.prompt, ...notesOf(shots)].filter(Boolean).join('\n\n') }),
    }
  })
  const [branches, setBranches] = useState<string[]>([])
  const [current, setCurrent] = useState('') // the repo's own branch: a local workspace's
  const [menu, openMenu] = useMenu()
  const modelBox = useRef<HTMLInputElement>(null) // More's model: Another model… goes there
  const [ownModel, setOwnModel] = useState(false) // Another model… picked: More shows a box to type one in
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<Img[]>(() => [...(draft?.images ?? []), ...(shots ?? [])])
  const had = useRef(new Set((shots ?? []).map(s => s.path))) // screenshots given so far: one taken out stays out
  useEffect(() => {
    const more = (shots ?? []).filter(s => !had.current.has(s.path))
    for (const s of more) had.current.add(s.path)
    if (more.length) setImages(i => [...i, ...more]) // another screenshot, the prompt kept: its note added to it
    if (notesOf(more).length) setP(x => ({ ...x, prompt: [x.prompt, ...notesOf(more)].filter(Boolean).join('\n\n') }))
  }, [shots])
  const [saving, setSaving] = useState(false) // an image isn't saved yet
  // a prompt template's name ('' none): another project's of the same name too. Opened from a group: its own, else
  // none (a draft from that group: its pick), never the last one used elsewhere
  const [tplName, setTplName] = useState(() => {
    const pr = view.projects.find(x => x.id === project)
    const sep = pr?.seps?.find(s => s.id === initial?.place)
    const t = sep?.template
    if (t && templatesFor(view.settings.templates, pr?.config?.templates).some(x => x.name === t)) return t
    return (sep ? (draft?.p.place === sep.id ? draft.tpl : '') : draft ? draft.tpl : last.tpl) || ''
  })
  const [adv, setAdv] = useState(false) // More: shut as it opens, a race and a typed model in it
  const set = (k: Partial<NewWsParams>) => setP(x => ({ ...x, ...k }))
  const proj = view.projects.find(x => x.id === p.project)
  const templates = templatesFor(view.settings.templates, proj?.config?.templates)
  const ti = templates.findIndex(t => t.name === tplName)
  const tpl = ti < 0 ? '' : String(ti)
  const filled = templated(templates[ti], p.prompt ?? '', { project: proj?.name, base: p.base, pr: prRef('', p.prompt) })
  const plain = proj?.git === false // a folder without git: local only
  const inCs = view.settings.cloud === true && !plain && !proj?.host && p.codespace !== undefined // In a codespace (experimental)
  // its repo's machine types (the first picked), or why there are none (gh's words: the codespace scope…)
  const [machines, setMachines] = useState<{ name: string; display: string }[] | string>([])
  useEffect(() => {
    if (!inCs || !p.project) return
    setMachines([])
    api.call<{ machines: { name: string; display: string }[] }>('csMachines', { project: p.project }).then(
      r => (setMachines(r.machines), setP(x => (x.codespace !== undefined && !r.machines.some(m => m.name === x.codespace) ? { ...x, codespace: r.machines[0]?.name ?? '' } : x))),
      e => setMachines((e as Error).message),
    )
  }, [inCs, p.project])
  const prof = view.presets.find(x => x.name === p.preset)
  const starts = prof?.agent // what the preset starts: its model and effort flags
  // its permission mode ('': ask first) and fast mode: picked here, else the profile's (none when its flags set the mode);
  // sent only when it isn't the profile's, so an edit of the profile applies at the next start
  const ownPerm = permInArgs(starts, prof?.args)
  const permPick = ownPerm ? '' : (p.perm ?? prof?.perm ?? '')
  const fastPick = p.fast ?? !!prof?.fast
  const permSent = !ownPerm && permPick !== (prof?.perm ?? '') && (!permPick || PERMS[starts as Agent]?.some(x => x[0] === permPick)) ? permPick : undefined
  const fastSent = FAST[starts as Agent] && fastPick !== !!prof?.fast ? fastPick : undefined
  const [rivals, setRivals] = useState<string[]>(() => draft?.rivals ?? []) // a race: the other presets on the same prompt
  // a draft's prompt a link's replaced (the bubbles' voice prompt to a new session): kept, a click swaps it back
  const [prev, setPrev] = useState<string | undefined>(() => (initial?.prompt?.trim() && draft?.p.prompt?.trim() && draft.p.prompt !== initial.prompt ? draft.p.prompt : draft?.prev))
  const racers = view.presets.filter(x => x.name !== p.preset && x.agent !== 'command' && !x.off).map(x => x.name)
  const racing = !p.local && !plain && !inCs && isAgent(starts) && rivals.some(r => racers.includes(r))
  const fan = racing ? [p.preset, ...rivals.filter(r => racers.includes(r))] : undefined
  // opened for a project the view didn't have yet (the first one, from Welcome: projectAdd answers before the state
  // does): it once the view has it
  useEffect(() => void (project && !proj && set({ project })), [project])
  useEffect(() => {
    if (!p.project) return
    api.call('branches', { project: p.project }).then(
      r => {
        setBranches(r.branches)
        setCurrent(r.current)
        setP(x => ({ ...x, base: x.base && r.branches.includes(x.base) ? x.base : r.main || r.current })) // a draft's or a link's, if the branch is still there; else the repo's main one (an older daemon: its checkout's)
      },
      () => setBranches([]),
    )
  }, [p.project])
  // while it's made: how long so far, for the progress line (a worktree, copied files, an agent: seconds, more in a big repo)
  const [secs, setSecs] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!busy) return
    setSecs(0)
    strip.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) // in sight under an open More
    const t = setInterval(() => setSecs(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [busy])
  const doing = fan
    ? `Making ${fan.length} worktrees, one after another`
    : inCs
      ? `Asking GitHub for a codespace off ${p.base || 'the current branch'}`
      : p.local || plain
        ? `Opening ${proj?.name ?? 'the folder'}`
        : `Making a worktree off ${p.base || 'the current branch'}`
  const then = inCs ? 'then it shows in the sidebar while GitHub makes it (minutes): its tabs wait for it' : p.local || plain ? 'then its tabs start' : secs < 12 ? 'then the files git ignores (.env…) are copied and the agent starts' : 'still going: a big repo takes a while'
  // something typed or picked that a close shouldn't lose
  const dirty = !!(p.prompt?.trim() || p.name?.trim() || (p.preset === 'custom' && p.cmd?.trim()) || images.length || rivals.length || prev)
  useEffect(() => void (busy || keep(DRAFT, dirty ? ({ p, images, rivals, tpl: tplName, prev } satisfies Draft) : undefined)), [p, images, rivals, tplName, prev]) // while it's made: submit dropped it
  const clear = () => (set({ prompt: '', name: '' }), setImages([]), setRivals([]), setPrev(undefined))
  const submit = async () => {
    if (busy || saving) return
    setBusy(true)
    keep(LAST_NEW, { project: p.project, preset: p.preset, cmd: p.cmd, local: p.local, model: p.model, effort: p.effort, perm: permSent === 'bypassPermissions' ? undefined : permSent /* never by itself: picked each time */, fast: fastSent, place: p.place, tpl: tplName, agent } satisfies LastNew)
    const mine = load<Draft | null>(DRAFT, null)
    keep(DRAFT, undefined) // made: the next page starts empty; failed: back below, unless another page has one by then
    try {
      const prompt = withImages(filled, images) || undefined
      const own = isAgent(starts) && !fan // a race's agents keep their own models
      const place = p.place && proj?.seps?.some(s => s.id === p.place) ? p.place : 'top' // under its sep, else first in the project
      await onCreate({ ...p, place, pr: undefined /* a PR's branch: laki new --pr; a prompt naming one links it */, prompt, name: p.name || (tpl && !prIn(p.prompt) ? nameOf(p.prompt ?? '') : undefined) /* a PR's: the daemon's, after its title */, local: p.local || plain, codespace: inCs ? p.codespace : undefined, preset: p.preset === 'custom' ? 'custom' : p.preset, cmd: p.preset === 'custom' ? p.cmd : undefined, model: own ? p.model?.trim() || undefined : undefined, effort: own ? p.effort || undefined : undefined, perm: own ? permSent : undefined, fast: own ? fastSent : undefined, fan, noSetup: canSkip && p.noSetup ? true : undefined, ...(tpl && { vars: true }) })
    } catch {
      setBusy(false)
      if (mine && !localStorage.getItem(DRAFT)) keep(DRAFT, mine)
    }
  }
  if (!view.projects.length)
    return (
      <Page title="New workspace" onClose={onClose}>
        <p className="muted">Open a folder first (⌘O), or drop one on the window.</p>
      </Page>
    )
  const prompting = view.presets.some(x => x.name === p.preset && x.agent !== 'command')
  const sep = proj?.seps?.find(s => s.id === p.place)
  const canName = !p.local && !plain
  const canModel = isAgent(starts) && !racing // a race's agents keep their own
  const canRace = !p.local && !plain && !inCs && isAgent(starts) && racers.length > 0
  const canSkip = !p.local && !plain && !!proj?.hasSetup // a worktree of a project with a setup script
  // the project and its groups in one menu: a group's items under its project
  const placeMenu = (e: MouseEvent) =>
    openMenu(
      e,
      [
        ...(view.projects.length > 6 ? [{ filter: 'Type to filter…' } as MenuItem] : []),
        ...view.projects.flatMap(x => [
        { label: x.name, mark: <ProjectMark p={x} or={x.git === false ? 'folder' : 'fork'} size={14} />, hint: x.id === p.project && !sep ? ON : undefined, run: () => set({ project: x.id, place: undefined, ...(x.id !== p.project && { base: '' }) }) } as MenuItem,
        ...(x.seps ?? []).map(s => ({ label: s.name || 'Unnamed group', icon: 'sep', indent: true, hint: x.id === p.project && sep?.id === s.id ? ON : undefined, run: () => set({ project: x.id, place: s.id, ...(x.id !== p.project && { base: '' }) }) }) as MenuItem),
        ]),
      ],
    )
  // the base: every local branch, a filter on top (a datalist would show only the ones matching what's in the box)
  const baseMenu = (e: MouseEvent) =>
    openMenu(e, [
      ...(branches.length > 6 ? [{ filter: 'Type to filter…' } as MenuItem] : []),
      ...branches.map(b => ({ label: b, icon: 'pr', mono: true, pill: b === current ? 'checked out' : undefined, hint: b === p.base ? ON : undefined, run: () => set({ base: b }) }) as MenuItem),
    ])
  // a preset's line: its command, or the agent and its args; none when it would only say its name again (codex: Codex)
  const presetSays = (x: (typeof view.presets)[number]) => {
    const acct = x.account && (x.account === HOME_ACCOUNT ? 'default sign-in' : view.settings.accounts?.find(a => a.id === x.account)?.name)
    const say = x.agent === 'command' ? x.cmd || 'A command' : [AGENT_NAMES[x.agent], x.model, x.effort, PERMS[x.agent]?.find(m => m[0] === x.perm)?.[1].toLowerCase(), x.fast && FAST[x.agent] && 'fast', acct, x.args].filter(Boolean).join(' · ')
    return say.toLowerCase() === x.name.toLowerCase() ? undefined : say
  }
  const on = view.presets.filter(x => !x.off)
  const def = on.some(x => x.name === view.settings.agent) ? view.settings.agent : on[0]?.name // what new workspaces start (Settings): a pill, and the foot sets it
  const agentMenu = (e: MouseEvent) =>
    openMenu(
      e,
      [
        { filter: 'Type to filter…' },
        { head: 'Agent' },
        ...view.presets
          .filter(x => !x.off || x.name === p.preset)
          .map(x => ({ label: x.name, icon: 'agent', mono: true, sub: presetSays(x), pill: x.name === def ? 'default' : undefined, hint: p.preset === x.name ? ON : undefined, run: () => set({ preset: x.name, model: undefined, effort: undefined, perm: undefined, fast: undefined }) }) as MenuItem), // another agent's names
        null,
        ...OTHER_AGENTS.map(([x, label, icon, sub]) => ({ label, icon, sub, hint: p.preset === x ? ON : undefined, run: () => set({ preset: x, model: undefined, effort: undefined }) }) as MenuItem),
        ...(p.preset !== def && view.presets.some(x => x.name === p.preset) ? [{ label: `Make ${p.preset} the default for new workspaces`, icon: 'pin', foot: true, run: () => void api.call('settingsSet', { agent: p.preset }) } as MenuItem] : []),
      ],
      'right',
    )
  const ag = isAgent(starts) ? starts : undefined // an agent's model and effort flags
  const models = (ag && MODELS[ag]) ?? []
  const efforts = ag && EFFORTS[ag]
  const typed = p.model?.trim()
  const modelRow = canModel && (ownModel || (!!typed && !models.includes(typed))) // the menu has the rest: one picker, not two
  const modelMenu = (e: MouseEvent) =>
    openMenu(
      e,
      [
        { filter: 'Type to filter…' },
        { head: 'Model' },
        { label: 'default', mono: true, sub: `Whatever ${ag ? AGENT_NAMES[ag] : 'the agent'} picks`, hint: !typed ? ON : undefined, run: () => set({ model: undefined }) },
        ...[...models, ...(typed && !models.includes(typed) ? [typed] : [])].map(m => ({ label: m, mono: true, sub: MODEL_SAYS[m]?.[0], pill: MODEL_SAYS[m]?.[1], tone: MODEL_SAYS[m]?.[2], hint: typed === m ? ON : undefined, run: () => set({ model: m }) }) as MenuItem),
        { label: 'Another model by name…', icon: 'pencil', foot: true, run: () => (setOwnModel(true), setAdv(true), setTimeout(() => modelBox.current?.focus())) },
      ],
    )
  const effortMenu = (e: MouseEvent) =>
    openMenu(e, [{ head: 'Effort' }, { label: 'default', mono: true, sub: 'The model’s own', hint: !p.effort ? ON : undefined, run: () => set({ effort: '' }) }, ...(efforts ?? []).map(x => ({ label: x, mono: true, hint: p.effort === x ? ON : undefined, run: () => set({ effort: x }) }) as MenuItem)])
  // how freely it acts: unset, the agent asks as it always does
  const perms = (ag && PERMS[ag]) ?? []
  const perm = perms.find(x => x[0] === permPick)
  const profPill = (id: string) => (prof?.perm && id === prof.perm ? 'profile' : undefined) // the profile's own
  const permMenu = (e: MouseEvent) =>
    openMenu(e, [
      { head: 'Permission mode' },
      { label: 'Ask first', icon: 'shield', sub: `${ag ? AGENT_NAMES[ag] : 'The agent'}’s own: it asks before it acts`, hint: !perm ? ON : undefined, run: () => set({ perm: '' }) },
      ...perms.map(([id, label, sub]) => ({ label, sub, icon: id === 'bypassPermissions' ? 'alertCircle' : id === 'plan' ? 'eye' : 'shieldCheck', danger: id === 'bypassPermissions', pill: profPill(id), hint: perm?.[0] === id ? ON : undefined, run: () => set({ perm: id }) }) as MenuItem),
    ])
  const whereMenu = (e: MouseEvent) =>
    openMenu(e, [
      { label: 'New worktree', icon: 'fork', sub: 'A git worktree of its own, off the base branch', hint: !p.local && !inCs ? ON : undefined, run: () => set({ local: false, codespace: undefined }) },
      { label: 'Local', icon: 'folder', sub: `In the repo itself, on ${current || 'the branch it’s on'}`, hint: p.local ? ON : undefined, run: () => set({ local: true, codespace: undefined }) },
      ...(view.settings.cloud === true && !proj?.host ? [{ label: 'In a codespace', icon: 'cloud', sub: 'A GitHub Codespace of its own, off the base branch (GitHub bills it)', hint: inCs ? ON : undefined, run: () => set({ local: false, codespace: p.codespace ?? '' }) } as MenuItem] : []),
    ])
  const machineMenu = (e: MouseEvent) =>
    openMenu(e, [{ head: 'Machine type' }, ...(typeof machines === 'string' ? [] : machines).map(m => ({ label: m.display, sub: m.name, hint: p.codespace === m.name ? ON : undefined, run: () => set({ codespace: m.name }) }) as MenuItem)])
  const tplMenu = (e: MouseEvent) =>
    openMenu(
      e,
      [
        { head: 'Prompt template' },
        { label: 'None: the prompt as typed', hint: !tpl ? ON : undefined, run: () => setTplName('') },
        ...templates.map((t, i) => ({ label: t.name || '(no name)', icon: 'file', hint: String(i) === tpl ? ON : undefined, run: () => setTplName(t.name) }) as MenuItem),
      ],
      'right',
    )
  const other = OTHER_AGENTS.find(o => o[0] === p.preset)
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1)
  // the row over the prompt, its right end: the template and what starts
  const pickers = (
    <>
      {prompting && templates.length > 0 && (
        <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="A prompt template: your words go into it" onClick={tplMenu}>
          <Icon name="file" />
          <span>{tpl ? templates[ti].name || '(no name)' : 'Template'}</span>
          <Icon name="chevron" size={11} />
        </button>
      )}
      <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="What starts in its first tab" onClick={agentMenu}>
        <Icon name={other?.[2] ?? 'agent'} />
        <span>{other?.[1] ?? p.preset}</span>
        <Icon name="chevron" size={11} />
      </button>
    </>
  )
  // the prompt's toolbar, after +: the agent's model, effort and permission mode
  const lead = canModel && (
    <>
      <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="Its model" onClick={modelMenu}>
        <span>{typed ? (models.includes(typed) ? cap(typed) : typed) : 'Default model'}</span>
        <Icon name="chevron" size={11} />
      </button>
      {efforts && (
        <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="How hard it thinks" onClick={effortMenu}>
          <span>{p.effort ? cap(p.effort) : 'Default effort'}</span>
          <Icon name="chevron" size={11} />
        </button>
      )}
      {perms.length > 0 && !ownPerm && (
        <button type="button" className={`nw-pick ${perm?.[0] === 'bypassPermissions' ? 'warn' : ''}`} aria-haspopup="menu" data-tip={perm ? perm[2] : 'Permission mode: how freely it acts'} onClick={permMenu}>
          <span>{perm?.[1] ?? 'Ask first'}</span>
          <Icon name="chevron" size={11} />
        </button>
      )}
    </>
  )
  const fast = canModel && ag && FAST[ag] && (
    <button type="button" className={`ib nw-fast ${fastPick ? 'on' : ''}`} aria-pressed={fastPick} aria-label="Fast mode" data-tip={fastPick ? 'Fast mode is on: quicker answers, at a higher price' : 'Fast mode: quicker answers, at a higher price'} onMouseDown={e => e.preventDefault()} onClick={() => set({ fast: !fastPick })}>
      <Icon name="zap" />
    </button>
  )
  const label = fan ? `Create ${fan.length} workspaces` : 'Create'
  const send = (
    <button type="button" className="nw-send" aria-label={label} data-tip={`${saving ? 'Saving an image…' : label} (⌘⏎)`} disabled={busy || saving || !p.project} onMouseDown={e => e.preventDefault()} onClick={submit}>
      {busy || saving ? <span className="btn-spin" /> : <Icon name="arrowUp" />}
      {fan && !busy && <span className="nw-send-n">{fan.length}</span>}
    </button>
  )
  const more = [typed && !models.includes(typed) && typed, fan && `race of ${fan.length}`, canSkip && p.noSetup && 'no setup'].filter(Boolean).join(' · ')
  const toggle = () => setAdv(o => !o)
  return (
    <Page title="New workspace" onClose={onClose}>
      {/* Enter in a field never makes it (a branch picked, a name typed): ⌘⏎ or Create does */}
      <form onSubmit={e => e.preventDefault()} onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented && (e.preventDefault(), submit())} className={`form new-ws ${busy ? 'busy' : ''}`} aria-busy={busy}>
        {/* the row over the prompt: where it's made on the left, what starts on the right */}
        <div className="nw-top">
          <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="Its project, and where in the sidebar: first in it, or in one of its groups" onClick={placeMenu}>
            <ProjectMark p={proj} or={plain ? 'folder' : 'fork'} size={14} />
            <span>
              {proj?.name}
              {sep && <span className="muted"> › {sep.name || 'Unnamed group'}</span>}
            </span>
            <Icon name="chevron" size={11} />
          </button>
          {plain ? (
            <span className="nw-pick quiet" data-tip="A folder without git: the workspace runs in the folder itself">
              in the folder itself
            </span>
          ) : (
            <>
              <button type="button" className="nw-pick" aria-haspopup="menu" data-tip={view.settings.cloud === true ? 'A worktree of its own, the repo itself, or a codespace' : 'A worktree of its own, or the repo itself'} onClick={whereMenu}>
                <span>{p.local ? 'Local' : inCs ? 'In a codespace' : 'New worktree'}</span>
                <Icon name="chevron" size={11} />
              </button>
              {p.local ? (
                <span className="nw-pick quiet" data-tip="Local: in the repo itself, on the branch it's on">
                  <Icon name="pr" />
                  <span>{current || 'its branch'}</span>
                </span>
              ) : (
                <span className="nw-pick nw-base">
                  <Icon name="pr" />
                  <input className="nw-chip-input" value={p.base} aria-label="Base branch" data-tip="The base branch: the worktree starts off it (any branch or ref, typed)" spellCheck={false} onChange={e => set({ base: e.target.value })} />
                  {branches.length > 0 && <IconButton icon="chevron" title="Pick the base branch" className="nw-chip-more" onClick={baseMenu} />}
                </span>
              )}
              {inCs &&
                (typeof machines === 'string' ? (
                  <span className="nw-pick quiet warn" data-tip={machines}>
                    <Icon name="alertCircle" />
                    <span>{machines}</span>
                  </span>
                ) : (
                  <button type="button" className="nw-pick" aria-haspopup="menu" data-tip="Its machine type: GitHub bills by it" onClick={machineMenu}>
                    <Icon name="cloud" />
                    <span>{machines.find(m => m.name === p.codespace)?.display ?? (p.codespace || 'Machine type')}</span>
                    <Icon name="chevron" size={11} />
                  </button>
                ))}
            </>
          )}
          {canName && (
            <label className="nw-pick nw-base">
              <Icon name="pencil" />
              <input className="nw-chip-input" value={p.name ?? ''} placeholder={prompting && p.prompt?.trim() ? 'name: from the prompt' : 'name'} aria-label="Name" spellCheck={false} onChange={e => set({ name: e.target.value })} />
            </label>
          )}
          {(modelRow || canRace || canSkip) && (
            <button type="button" className={`nw-pick ${adv ? 'on' : ''}`} aria-expanded={adv} data-tip="Another model by name; a race; the setup script" onClick={toggle}>
              <span>More{more && <span className="muted"> · {more}</span>}</span>
              <Icon name={adv ? 'chevronUp' : 'chevron'} size={11} />
            </button>
          )}
          <span className="nw-top-end">{pickers}</span>
        </div>
        <div className="nw-card nw-composer">
          {prompting ? (
            <PromptInput
              value={p.prompt ?? ''}
              onChange={prompt => set({ prompt })}
              images={images}
              onImages={setImages}
              save={(data, ext) => api.call<string>('imageSave', { data, ext })}
              saveFile={(data, name) => api.call<string>('fileSave', { data, name })}
              dictate={bridge?.dictate}
              dictationSettings={bridge?.dictationSettings}
              onSubmit={submit}
              onBusy={setSaving}
              rows={8}
              placeholder="Message the agent: paste or drop screenshots and files"
              lead={lead || <span />}
              tools={fast}
              send={send}
              inserts={inserts?.(p.project) /* the project picked: its repo's extensions too */}
            />
          ) : (
            <>
              {p.preset === 'custom' ? (
                <input className="nw-cmd" value={p.cmd ?? ''} placeholder="The command to run: aider --model …" aria-label="Command" spellCheck={false} onChange={e => set({ cmd: e.target.value })} autoFocus />
              ) : (
                <div className="nw-quiet">{p.preset === 'shell' ? 'A shell tab, in the workspace’s folder.' : p.preset === 'none' ? 'No tabs: the workspace opens empty, for you to start what you like.' : `${p.preset} runs its own command: no prompt.`}</div>
              )}
              <div className="prompt-tools">
                <span className="prompt-tools-end">{send}</span>
              </div>
            </>
          )}
        </div>
        {tpl && prompting && <div className="template-preview muted small">{filled || ' '}</div>}
        {adv && (modelRow || canRace || canSkip) && (
          <div className="nw-card nw-more">
            {modelRow && (
              <label className="nw-line">
                <span>Model</span>
                <input ref={modelBox} list="models" value={p.model ?? ''} spellCheck={false} placeholder={starts === 'opencode' ? 'provider/model' : "the agent's default"} onChange={e => set({ model: e.target.value })} />
                <datalist id="models">
                  {models.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
            )}
            {canRace && (
              <div className="nw-line">
                <span>Race</span>
                <div className="seg wrap">
                  {racers.map(x => (
                    <button type="button" key={x} className={rivals.includes(x) ? 'on' : ''} disabled={!rivals.includes(x) && rivals.filter(r => racers.includes(r)).length >= 5 /* six agents at most */} onClick={() => setRivals(r => (r.includes(x) ? r.filter(y => y !== x) : [...r, x]))}>
                      + {x}
                    </button>
                  ))}
                </div>
                <span className="muted small">the same prompt to each, a worktree each; Compare keeps the best</span>
              </div>
            )}
            {canSkip && (
              <div className="nw-line">
                <span>Setup</span>
                <Switch on={!!p.noSetup} onChange={noSetup => set({ noSetup })}>
                  Skip the setup script
                </Switch>
                <span className="muted small">the files .worktreeinclude names are still copied; Run ▾ runs it later</span>
              </div>
            )}
          </div>
        )}
        {busy && (
          <div className="nw-making" role="status" ref={strip}>
            <span className="glyph spin" />
            <span className="nw-making-text">
              <b>{doing}…</b>
              <span className="muted small">
                {then} · {secs}s · Esc closes this page, it goes on in the sidebar
              </span>
            </span>
            <span className="nw-bar" />
          </div>
        )}
        {initial?.linked && p.prompt === initial.prompt && !busy && (
          <p className="warn-soft small nw-linked" role="note">
            Filled in from a link: read it before you start. The agent runs it in this project as you.
          </p>
        )}
        <div className="nw-foot">
          <span className="muted">⌘⏎ creates · esc closes{dirty && !busy ? ', the draft stays' : ''}</span>
          {dirty && !busy && (
            <button type="button" className="link" onClick={clear} data-tip="Empty the prompt, name, images and race">
              Clear
            </button>
          )}
          {prev && !busy && (
            <button type="button" className="link" onClick={() => (set({ prompt: prev }), setPrev(p.prompt?.trim() ? p.prompt : undefined))} data-tip={`Swap in the prompt you had before: ${prev.slice(0, 160)}`}>
              Earlier draft
            </button>
          )}
        </div>
      </form>
      {menu}
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

// pick: a select under the field (a group's default template), its value given with the text ('' none)
export function Prompt({ title, hint, placeholder, initial = '', pick, busy, onClose, onSubmit }: { title: string; hint?: string; placeholder?: string; initial?: string; pick?: { label: string; none: string; options: string[]; value?: string }; busy?: string; onClose: () => void; onSubmit: (v: string, picked: string) => Promise<void> }) {
  const [v, setV] = useState(initial)
  const [picked, setPicked] = useState(pick?.value ?? '')
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          if (v.trim() && !busy) onSubmit(v.trim(), picked).catch(() => {})
        }}
      >
        <input value={v} autoFocus placeholder={placeholder} onFocus={e => e.target.select()} onChange={e => setV(e.target.value)} />
        {hint && <div className="muted small">{hint}</div>}
        {pick && (
          <label>
            {pick.label}
            <select value={picked} onChange={e => setPicked(e.target.value)}>
              <option value="">{pick.none}</option>
              {[...new Set([...pick.options, picked])].filter(Boolean).map(o => ( // one gone since stays as it was
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!v.trim() || !!busy}>
            {busy ? (
              <>
                <span className="btn-spin" /> {busy}
              </>
            ) : (
              'OK'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// a new timer: how long, a message (what it's for: Go out; on its bar and as it ends) and, with its switch, a command it
// runs as it ends (in the workspace in front: where, its name)
export function TimerDialog({ where, onClose, onStart }: { where?: string; onClose: () => void; onStart: (ms: number, cmd?: string, note?: string) => void }) {
  const [len, setLen] = useState('')
  const [note, setNote] = useState('')
  const [run, setRun] = useState(false)
  const [cmd, setCmd] = useState('')
  const ms = parseDuration(len)
  const ok = !!ms && (!run || !!cmd.trim())
  return (
    <Modal title="New timer" onClose={onClose}>
      <form className="form" onSubmit={e => (e.preventDefault(), ok && onStart(ms!, run ? cmd.trim() : undefined, note.trim().slice(0, 120) || undefined))}>
        <input value={len} autoFocus placeholder="25 · 1h 30m · 90s" onChange={e => setLen(e.target.value)} />
        <div className="muted small">{len.trim() && !ms ? 'A length like 25, 1h 30m or 90s, up to 24 hours.' : 'Minutes, or with units (h, m, s); up to a day. It starts at once.'}</div>
        <input value={note} maxLength={120} placeholder="A message, if you like: Go out · Stretch · Check the oven" onChange={e => setNote(e.target.value)} />
        {where && (
          <Switch on={run} onChange={setRun} tip="As it ends, a command runs in a tab of its own">
            Then run a command
          </Switch>
        )}
        {run && <input value={cmd} placeholder="say 'time is up' · npm test · open https://…" spellCheck={false} onChange={e => setCmd(e.target.value)} />}
        {run && <div className="muted small">Runs through your login shell in {where}, in a tab of its own (it closes when the command succeeds).</div>}
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            Start
          </button>
        </div>
      </form>
    </Modal>
  )
}

// tomorrow at 9:00, in ms from now
const tomorrow9 = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime() - Date.now()
}

// Remind me (a workspace's menu, as Slack's): a notification about it later; a timer underneath
export function RemindDialog({ name, onClose, onPick }: { name: string; onClose: () => void; onPick: (ms: number) => void }) {
  const [len, setLen] = useState('')
  const ms = parseDuration(len)
  const quick: [string, number][] = [
    ['In 20 minutes', 1200000],
    ['In 1 hour', 3600000],
    ['In 3 hours', 10800000],
    ['Tomorrow at 9:00', tomorrow9()],
  ]
  return (
    <Modal title={`Remind me about ${name}`} onClose={onClose}>
      <form className="form" onSubmit={e => (e.preventDefault(), ms && onPick(ms))}>
        <div className="remind-quick">
          {quick.map(([label, q], i) => (
            <button key={label} type="button" autoFocus={i === 1} onClick={() => onPick(q)}>
              {label}
            </button>
          ))}
        </div>
        <input value={len} placeholder="Or in: 45 · 2h 30m" onChange={e => setLen(e.target.value)} />
        <div className="muted small">{len.trim() && !ms ? 'A length like 45, 2h 30m or 90s, up to 24 hours.' : 'A notification then; Laki must be running (one missed while it was closed comes as it opens).'}</div>
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ms}>
            Remind me
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Send later (the toolbar's ⋯ and clock, a tab's right click, ⌘L, ⌘K, the AI page's clock): a message to one of the
// workspace's agents, or Laki AI (id 'ai'), at a time; a timer in the sidebar until then (edit: its message, agent and
// time again). picks: Run ▾'s agent actions, a click puts one's text in; inserts: extensions' actions for the agent
// picked (its workspace and tab), what one prints goes in at the cursor, its files as paths
export function SendLaterDialog(p: { agents: { id: string; name: string }[]; tab?: string; text?: string; at?: number; picks?: { name: string; text: string }[]; inserts?: (tab: string) => Inserts; onClose: () => void; onPick: (o: { tab: string; text: string; ms: number }) => void }) {
  const [to, setTo] = useState(p.agents.some(a => a.id === p.tab) ? p.tab! : (p.agents[0]?.id ?? ''))
  const [text, setText] = useState(p.text ?? '')
  const [menu, openMenu] = useMenu()
  const box = useRef<HTMLTextAreaElement>(null)
  const ins = p.inserts?.(to) ?? []
  const put = (t: Inserted) => {
    const add = withPaths(t.text, (t.files ?? []).map(f => f.path))
    const el = box.current
    setText(s => (el ? s.slice(0, el.selectionStart) + add + s.slice(el.selectionEnd) : s + add))
  }
  const [when, setWhen] = useState(() => (p.at ? laterText(p.at) : '')) // an edit: its time again
  const ms = parseLater(when)
  const ok = !!(to && text.trim() && ms)
  const time = (ms: number) => new Date(Date.now() + ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <Modal title={p.text ? 'Change the message for later' : 'Send a message later'} onClose={p.onClose}>
      <form className="form" onSubmit={e => (e.preventDefault(), ok && p.onPick({ tab: to, text: text.trim(), ms: ms! }))}>
        <label>
          To
          <select value={to} onChange={e => setTo(e.target.value)}>
            {p.agents.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Message
          <textarea ref={box} rows={4} value={text} autoFocus placeholder="Run the tests again and fix what fails" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.metaKey && (e.preventDefault(), ok && p.onPick({ tab: to, text: text.trim(), ms: ms! }))} />
        </label>
        {ins.length > 0 && (
          <div className="remind-quick">
            <button type="button" aria-haspopup="menu" data-tip="Insert from an extension: what it prints goes in at the cursor" onMouseDown={e => e.preventDefault()} onClick={e => openMenu(e, [{ head: 'Insert' }, ...ins.map(x => ({ label: x.label, sub: x.sub, icon: 'panel' as const, run: () => void x.run().then(t => t && put(t), () => {}) }))])}>
              <Icon name="panel" size={12} /> Insert
            </button>
          </div>
        )}
        {menu}
        {!!p.picks?.length && (
          <div className="remind-quick" aria-label="Your actions">
            {p.picks.map((a, i) => (
              <button key={i} type="button" className={text === a.text ? 'on' : ''} data-tip={a.text} onClick={() => setText(a.text)}>
                {a.name}
              </button>
            ))}
          </div>
        )}
        <label>
          When
          <input value={when} placeholder="in 10m · 2h · 1h 30m · at 15:30 · 3pm" onChange={e => setWhen(e.target.value)} />
        </label>
        <div className="remind-quick">
          {['15m', '30m', '1h', '2h'].map(q => (
            <button key={q} type="button" className={when === q ? 'on' : ''} onClick={() => setWhen(q)}>
              In {q.replace('m', ' min').replace('h', ' h')}
            </button>
          ))}
        </div>
        <div className="muted small">
          {when.trim() && !ms
            ? 'A length (10m, 2h, 1h 30m) or a time (15:30, 3pm), within a day.'
            : `${ms ? `Sends at ${time(ms)}. ` : ''}${to === 'ai' ? 'Asked when Laki AI is free.' : 'Queued if the agent is busy then.'} Laki must be running: one due while it was closed isn't sent.`}
        </div>
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={p.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            {p.text ? 'Save' : 'Send later'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export type PaletteItem = { label: string; hint?: string; glyph?: string; icon?: IconName; mark?: ReactNode; run: () => void } // mark: before the hint (its project's)

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
    <Modal title="Go to" onClose={onClose} wide loose>
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
            <span className="ph muted">
              {x.mark}
              {x.hint}
            </span>
          </div>
        ))}
        {!list.length && <div className="muted pad">Nothing matches.</div>}
      </div>
    </Modal>
  )
}

export { REPO } // shared/types.ts': the schema's address is built from it too

// a nudge to star the repo, at the foot of the empty pages
export const StarLaki = () => (
  <button className="ready-star" onClick={() => openExternal(REPO)}>
    <Icon name="github" size={14} /> Enjoying Laki? <b>Give it a star on GitHub</b> <span aria-hidden>★</span>
  </button>
)

const TIPS: [IconName, string, string, string][] = [
  ['plus', '⌘N', 'A workspace per task', 'Its own branch, worktree and $PORT: agents never trip over each other'],
  ['unread', '⌘J', 'Jump to who needs you', 'The next agent waiting for an answer, or done'],
  ['race', 'Race', 'One prompt, many agents', 'Compare their work side by side and keep the best'],
  ['search', '⌘K', 'Everything by name', 'Workspaces, tabs, actions and settings'],
]
// the splash's: Ready's, then a few more
const MORE_TIPS: typeof TIPS = [
  ['pr', 'Fix CI', 'PRs that fix themselves', 'Turn on fix CI and review: failing checks and comments go to the agent'],
  ['clock', '⌘L', 'Send it later', 'A prompt for the agent in an hour, or at 9am'],
  ['file', '⌘P', 'Any file in a keystroke', 'Find, preview and edit what the agent changed'],
  ['globe', 'Share', 'Your dev server, anywhere', "The globe beside a port gives it a link you can open on a phone"],
]
const SPLASH_TIPS = [...TIPS, ...MORE_TIPS]

// the splash while the daemon wakes and the first view comes: Laki's mark in a turning ring, where it's at (the daemon,
// then your workspaces; the seconds once it's slow) and a tip that changes every few seconds
export function Loading({ connected }: { connected: boolean }) {
  const [s, setS] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setS(x => x + 1), 1000)
    return () => clearInterval(i)
  }, [])
  const n = Math.floor(s / 4)
  const [ic, k, title, text] = SPLASH_TIPS[n % SPLASH_TIPS.length]
  return (
    <div className="loading">
      <div className="loading-mark">
        <span className="loading-ring" />
        <img src={icon} alt="" />
      </div>
      <span className="loading-word">Laki</span>
      <div className="loading-steps" role="status">
        <span className={connected ? 'done' : 'now'}>{connected ? <Icon name="check" size={11} /> : <i />} Daemon</span>
        <span className="loading-line" />
        <span className={connected ? 'now' : ''}>{connected ? <i /> : <b />} Your workspaces</span>
        {s >= 3 && <span className="muted" aria-hidden> · {s}s</span> /* not read out each second */}
      </div>
      <div className="loading-tip" key={n}>
        <span className="loading-tip-icon">
          <Icon name={ic} size={14} />
        </span>
        <span>
          <b>{title}</b> <kbd>{k}</kbd>
          <br />
          <span className="muted">{text}</span>
        </span>
      </div>
    </div>
  )
}

// a workspace without tabs: start something (agents first, as cards), what Laki is good at, and the star
export function Ready({ name, branch, project, actions }: { name: string; branch?: string; project?: string; actions: { label: string; icon?: IconName; hint?: string; sub?: string; run: () => void }[] }) {
  const agents = actions.filter(a => a.icon === 'agent')
  const starts = [...agents, ...actions.filter(a => !agents.includes(a))]
  return (
    <div className="ready">
      <div className="ready-hero">
        <span className="ready-mark">
          <img src={icon} alt="" />
        </span>
        <span className="ready-chip">
          <i /> Ready{project && <span className="muted"> · {project}</span>}
        </span>
        <h1>{name}</h1>
        <p className="muted">
          {branch ? (
            <>
              A worktree of its own on <span className="ready-branch"><Icon name="fork" size={11} /> {branch}</span>
            </>
          ) : (
            'Its own folder'
          )}
          . Start an agent on the task, or a shell to look around.
        </p>
      </div>
      <div className="ready-starts">
        {starts.map((a, i) => (
          <button key={a.label} type="button" className={`ready-start ${i === 0 && agents.length ? 'first' : ''}`} onClick={a.run}>
            <span className="ready-start-icon">
              <Icon name={a.icon ?? 'terminal'} size={16} />
            </span>
            <span className="ready-start-text">
              <b>{a.label}</b>
              <small>{a.sub || (a.icon === 'agent' ? 'Agent' : 'A terminal here')}</small>
            </span>
            {a.hint ? <kbd>{a.hint}</kbd> : i === 0 && agents.length ? <Icon name="arrowRight" size={14} /> : null}
          </button>
        ))}
      </div>
      <div className="ready-tips">
        {TIPS.map(([ic, k, title, text]) => (
          <div key={title} className="ready-tip">
            <span className="ready-tip-icon">
              <Icon name={ic} size={15} />
            </span>
            <span className="ready-tip-text">
              <b>
                {title} <kbd>{k}</kbd>
              </b>
              <span className="muted">{text}</span>
            </span>
          </div>
        ))}
      </div>
      <StarLaki />
    </div>
  )
}

const CLOUDFLARED_WHY =
  "Cloudflare's free tunnel, no account needed. Laki uses it for public links: share a workspace's dev server (the globe next to a port in the status bar), and open Laki itself from your phone (Settings › Remote access)."

// no project yet: a drop target and what's installed (the daemon's doctor; an older one has none: just the target)
export function Welcome({ onOpen, onSsh, check }: { onOpen: () => void; onSsh: () => void; check: () => Promise<Doctor> }) {
  const [d, setD] = useState<Doctor | null>(null)
  useEffect(() => void check().then(setD, () => {}), [])
  const mac = /Mac/.test(navigator.userAgent) // Linux's (and WSL's) hints: apt
  const row = (ok: boolean, name: string, hint: string, why?: string) => (
    <div className="check" key={name}>
      <Glyph s={ok ? 'ok' : why ? 'idle' : 'exited'} />{/* why: optional, so missing it is no failure */}
      <b>{name}</b>
      {why && (
        <span className="check-why" data-tip={why} aria-label={why} tabIndex={0}>
          <Icon name="help" size={13} />
        </span>
      )}
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
          {row(d.git, 'git', d.git ? 'found' : `needed for worktrees: ${mac ? 'xcode-select --install' : 'sudo apt install git'}`)}
          {row(d.gh === 'in', 'gh', d.gh === 'in' ? 'signed in: PRs, checks and Ship work' : d.gh === 'out' ? 'not signed in, for PRs: gh auth login' : `not found, for PRs: ${mac ? 'brew' : 'sudo apt'} install gh`)}
          {d.cloudflared !== undefined &&
            row(d.cloudflared, 'cloudflared', d.cloudflared ? 'found: public links work' : `optional: ${mac ? 'brew ' : ''}install cloudflared`, CLOUDFLARED_WHY)}
          {found.length ? found.map(a => row(true, AGENT_NAMES[a.id], 'on PATH: a preset')) : row(false, 'agents', 'none on PATH: install Claude Code or Codex, then restart Laki')}
          {missing.length > 0 && found.length > 0 && <div className="muted small">Not on PATH: {missing.map(a => AGENT_NAMES[a.id]).join(', ')}</div>}
        </div>
      )}
    </div>
  )
}

// the status bar's Artifacts, in the app: a strip of the storage folder's files over the status bar (newest first, a
// preview each), a click shows it big, ← → (or the keys) go through the others. Its folders come first: a click goes in,
// the head's path (or ←) back out. n: their count, a change reloads them
export type Artifact = { path: string; size: number; at: number }
// reveal: its folder in Finder ('' the whole storage folder); files: the side panel's Files, on the Artifacts
// menu: a file's right click (Open, Finder, Copy…); copy: text to the clipboard (a link's URL)
export type ArtifactsApi = { list: () => Promise<Artifact[]>; read: (path: string) => Promise<{ size: number; text?: string; image?: string }>; reveal?: (path: string) => void; files?: () => void; menu?: (path: string) => MenuItem[]; copy?: (text: string) => void; page?: (path: string) => string | undefined; external?: (path: string) => void } // page: an HTML one's address for the app's viewer (Settings: in Laki); external: in the default browser
const host = (url: string) => (fileOf(url) ? fileOf(url).split('/').pop()! : url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0]) // a file:/// link: its file's name
const sizeOf = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${Math.round(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`)
type Seen = { size: number; text?: string; image?: string } | { error: string }
const HTML = /\.html?$/i
export const VIEWED = /\.(html?|md|markdown)$/i // the app's viewer shows these (Settings › General › Artifacts open)

// an HTML or Markdown artifact in the app (Settings › General › Storage: Open artifacts in Laki): HTML in a sandboxed
// frame (the daemon's /artifact/…: its CSS, scripts and pictures beside it load), Markdown rendered
export function ArtifactView({ path, page, read, onExternal, onReveal, onClose }: { path: string; page?: string; read: () => Promise<{ text?: string }>; onExternal?: () => void; onReveal?: () => void; onClose: () => void }) {
  const [md, setMd] = useState<string | { error: string } | null>(null)
  const html = HTML.test(path)
  useEffect(() => void (!html && read().then(c => setMd(c.text ?? { error: "It isn't text" }), e => setMd({ error: String(e?.message ?? e) }))), [path])
  return (
    <Modal title={path} onClose={onClose} wide loose>
      <div className="art-big">
        {html ? (
          page ? <iframe className="art-frame" title={path} sandbox="allow-scripts" src={page} /> : <span className="muted small">Loading…</span>
        ) : md === null ? (
          <span className="muted small">Loading…</span>
        ) : typeof md === 'string' ? (
          <div className="art-md">
            <Markdown src={md} />
          </div>
        ) : (
          <span className="warn small">{md.error}</span>
        )}
      </div>
      <div className="buttons">
        <span className="muted small grow">{html ? 'Sandboxed: its scripts run; it can’t read Laki or your files' : ''}</span>
        {onReveal && <button onClick={onReveal}>Show in Finder</button>}
        {onExternal && <button onClick={onExternal}>Open in the browser</button>}
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
// links: its .url files (what its agents published): first, a click opens them in the browser
export function ArtifactsBar({ ws, n, links = [], api: a, onClose }: { ws: string; n: number; links?: { path: string; url: string; title: string }[]; api: ArtifactsApi; onClose: () => void }) {
  const linkOf = (path: string) => links.find(l => l.path === path)
  const [menu, openMenu] = useMenu()
  const [files, setFiles] = useState<Artifact[] | null>(null)
  const [err, setErr] = useState('')
  const [big, setBig] = useState<string | null>(null) // the file shown big, by path: a reload (a new one first) keeps it
  const [dir, setDir] = useState('') // the folder shown, '' the storage folder itself
  const [seen, setSeen] = useState<Record<string, Seen>>({}) // each file's content, by path and time: read once
  const asked = useRef(new Set<string>())
  const api = useRef(a)
  api.current = a
  useEffect(() => void api.current.list().then(f => (setFiles(f), setErr('')), e => setErr(String(e?.message ?? e))), [ws, n])
  useEffect(() => setDir(''), [ws])
  // dir's own files (links first, newest first, as listed) and its folders (each with its files' count, the newest first)
  const under = (f: Artifact) => !dir || f.path.startsWith(`${dir}/`)
  const rest = (f: Artifact) => (dir ? f.path.slice(dir.length + 1) : f.path)
  const here = useMemo(() => files?.filter(f => under(f) && !rest(f).includes('/')) ?? null, [files, dir])
  const folders = useMemo(() => {
    const m = new Map<string, { n: number; at: number }>()
    for (const f of files ?? []) {
      const r = rest(f)
      if (!under(f) || !r.includes('/')) continue
      const name = r.slice(0, r.indexOf('/'))
      const x = m.get(name)
      m.set(name, { n: (x?.n ?? 0) + 1, at: Math.max(x?.at ?? 0, f.at) })
    }
    return [...m].sort((a, b) => b[1].at - a[1].at)
  }, [files, dir])
  useEffect(() => void (files && dir && !files.some(under) && setDir(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')), [files, dir]) // emptied: a level up
  const into = (name: string) => (setDir(dir ? `${dir}/${name}` : name), setBig(null))
  const key = (f: Artifact) => `${f.path}@${f.at}`
  const need = (f: Artifact) => {
    if (asked.current.has(key(f))) return
    asked.current.add(key(f))
    api.current.read(f.path).then(c => setSeen(s => ({ ...s, [key(f)]: c })), e => setSeen(s => ({ ...s, [key(f)]: { error: String(e?.message ?? e) } })))
  }
  // ponytail: previews for the newest 60 of 2 MB or less (a picture comes whole); the rest load as they're opened
  useEffect(() => void here?.slice(0, 60).forEach(f => f.size <= 2 << 20 && !linkOf(f.path) && need(f)), [here])
  const i = here && big !== null ? here.findIndex(f => f.path === big) : -1
  const at = here && i >= 0 ? here[i] : null
  const step = (d: number) => here?.length && i >= 0 && setBig(here[(i + d + here.length) % here.length].path)
  useEffect(() => void (at && !linkOf(at.path) && need(at)), [at])
  useEffect(() => {
    if (big === null) return
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      step(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  })
  const go = (url: string) => void openKeptLink(url).catch(e => setErr((e as Error).message)) // a link's: its file gone, said
  // a right click: a link's Open and Copy link, a file's the app's menu
  const rightClick = (e: MouseEvent, f: Artifact) => {
    const l = linkOf(f.path)
    const items: MenuItem[] = l ? [{ label: 'Open in the browser', icon: 'globe', run: () => go(l.url) }, ...(a.copy ? [{ label: 'Copy link', icon: 'copy', key: 'c', run: () => a.copy!(l.url) } as MenuItem] : [])] : (a.menu?.(f.path) ?? [])
    if (!items.length) return
    e.preventDefault()
    openMenu(e, items)
  }
  const look = (f: Artifact, full = false) => {
    const l = linkOf(f.path)
    if (l)
      return (
        <span className="art-link">
          <Icon name="globe" size={full ? 28 : 18} />
          <span className="art-host">{host(l.url)}</span>
          {full && (
            <button className="primary" onClick={() => go(l.url)}>
              Open {l.url.length > 60 ? `${l.url.slice(0, 60)}…` : l.url}
            </button>
          )}
        </span>
      )
    const c = seen[key(f)]
    if (!c) return full || f.size <= 2 << 20 ? <span className="muted small">Loading…</span> : <span className="art-ext">{f.path.includes('.') ? f.path.split('.').pop() : 'file'}</span>
    if ('error' in c) return <span className="warn small">{c.error}</span>
    if (c.image) return <img src={c.image} alt={f.path} />
    if (full && HTML.test(f.path) && a.page?.(f.path)) return <iframe className="art-frame" title={f.path} sandbox="allow-scripts" src={a.page(f.path)} />
    if (c.text !== undefined) return full && /\.(md|markdown)$/i.test(f.path) ? <div className="art-md"><Markdown src={c.text} /></div> : <pre>{full ? c.text : c.text.split('\n').slice(0, 12).join('\n')}</pre>
    return <span className="art-ext">{f.path.includes('.') ? f.path.split('.').pop() : 'file'}</span>
  }
  return (
    <div className="artifacts">
      <div className="art-head">
        <Icon name="folder" size={12} />
        {dir ? (
          <>
            <IconButton icon="back" title="Back: the folder above" onClick={() => setDir(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')} />
            <button className="art-crumb" onClick={() => setDir('')}>
              Artifacts
            </button>
            {dir.split('/').map((name, k, all) => (
              <span key={k} className="art-crumbs">
                <span className="muted">/</span>
                <button className="art-crumb" disabled={k === all.length - 1} onClick={() => setDir(all.slice(0, k + 1).join('/'))}>
                  {name}
                </button>
              </span>
            ))}
          </>
        ) : (
          'Artifacts'
        )}{' '}
        <span className="muted">{files ? files.filter(under).length : ''}</span>
        <span className="grow" />
        {(a.reveal || a.files) && (
          <IconButton
            icon="more"
            title="Open in Finder or Files"
            onClick={e =>
              openMenu(e, [
                ...(a.reveal ? [{ label: 'Show in Finder', icon: 'folder', run: () => a.reveal!(dir && `${dir}/`) } as MenuItem] : []),
                ...(a.files ? [{ label: 'Open in Files', icon: 'panel', sub: "The side panel's Files, on its Artifacts", run: a.files } as MenuItem] : []),
              ], 'right')
            }
          />
        )}
        <IconButton icon="x" title="Close" onClick={onClose} />
      </div>
      <div className="art-strip">
        {err && <span className="warn small">{err}</span>}
        {files && !files.length && <span className="muted small">Nothing kept yet</span>}
        {folders.map(([name, x]) => (
          <button
            key={`dir:${name}`}
            className="art-card dir"
            data-tip={`${dir ? `${dir}/` : ''}${name} · ${x.n} ${x.n === 1 ? 'file' : 'files'} · ${new Date(x.at).toLocaleString()}`}
            onClick={() => into(name)}
            onContextMenu={e => a.reveal && (e.preventDefault(), openMenu(e, [{ label: 'Open', icon: 'folder', run: () => into(name) }, { label: 'Show in Finder', icon: 'folder', run: () => a.reveal!(`${dir ? `${dir}/` : ''}${name}/`) }]))}
          >
            <span className="art-thumb">
              <span className="art-link">
                <Icon name="folder" size={22} />
                <span className="art-host">
                  {x.n} {x.n === 1 ? 'file' : 'files'}
                </span>
              </span>
            </span>
            <span className="art-name">{name}</span>
          </button>
        ))}
        {here?.map(f => (
          <button
            key={f.path}
            className={`art-card ${linkOf(f.path) ? 'link' : ''}`}
            data-tip={linkOf(f.path) ? `${linkOf(f.path)!.url} · open in the browser` : `${f.path} · ${sizeOf(f.size)} · ${new Date(f.at).toLocaleString()}`}
            onClick={() => (linkOf(f.path) ? go(linkOf(f.path)!.url) : setBig(f.path))}
            onContextMenu={e => rightClick(e, f)}
          >
            <span className="art-thumb">{look(f)}</span>
            <span className="art-name">{linkOf(f.path)?.title ?? f.path.split('/').pop()}</span>
          </button>
        ))}
      </div>
      {at && here && (
        <Modal title={`${at.path} · ${i + 1} of ${here.length}`} onClose={() => setBig(null)} wide loose>
          <div className="art-big" onContextMenu={e => rightClick(e, at)}>
            {look(at, true)}
          </div>
          <div className="buttons">
            <span className="muted small grow">{sizeOf(at.size)} · {new Date(at.at).toLocaleString()}</span>
            {a.external && VIEWED.test(at.path) && <button onClick={() => a.external!(at.path)}>Open in the browser</button>}
            {a.reveal && <button onClick={() => a.reveal!(at.path)}>Show in Finder</button>}
            {a.files && <button onClick={() => (setBig(null), a.files!())}>Open in Files</button>}
            <button aria-label="Previous" disabled={here.length < 2} onClick={() => step(-1)}>
              <Icon name="back" />
            </button>
            <button aria-label="Next" disabled={here.length < 2} onClick={() => step(1)}>
              <Icon name="forward" />
            </button>
          </div>
        </Modal>
      )}
      {menu}
    </div>
  )
}
