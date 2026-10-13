// Specs & Brainstorms (experimental: Settings › General; the rail's Specs, a project's Specs tab, ⌘K): a project's
// requirements written like a Notion page (SpecEditor: BlockNote, specdrop's diagrams), and brainstorms Laki AI
// explores into the same folder: ideas.md (mermaid diagrams and mind maps), prototype-*.html (each in a sandboxed
// frame the daemon serves), *.diagram.json. Each is a folder outside the repo (daemon/plans.ts); a spec's Start opens
// the new-workspace page with a prompt naming its README.md; a brainstorm has its own chat with Laki AI in a side panel
// (daemon/ai.ts: it ends after 12 hours unused). New ones start empty or from a template (Templates, settings.planTemplates).
// Loaded as the page opens (App's lazy import).
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { BRAINSTORM_OUTPUT, brainstormPrompt, PLAN_CHAT_IDLE, PLAN_TEMPLATES, planChat } from '../../shared/plans'
import { type AiMsg, PLAN_KINDS, type Plan, type PlanFile, type PlanKind, type PlanTemplate, type Project } from '../../shared/types'
import { ago } from '../../shared/widget'
import { Message, Tools, turns } from './Ai'
import { api as daemon, bridge, daemonBase } from './api'
import { DiagramView } from './diagram'
import { Markdown } from './MarkdownView'
import './plans.css'
import { ReadDiagram, SpecEditor, useEscape } from './SpecEditor'
import { type Img, PromptInput } from './PromptInput'
import { normalizeDiagram } from './specmd'
import { shortPath } from './text'
import { ask, Icon, IconButton, keep, load as stored, type MenuItem, Page, useMenu } from './ui'

export type SpecsApi = {
  call: <T = any>(method: string, params?: object) => Promise<T>
  key?: string // the view's widgetKey: a prototype's page
  aiOn: boolean
  start: (p: Plan) => void // a spec's Start: the new-workspace page, its prompt filled in
  aiSettings: () => void
  templates: PlanTemplate[] // planTemplates(settings)
  saveTemplates: (t: PlanTemplate[]) => void
  copy: (text: string) => void
  reveal: (path: string) => void
  full: boolean // the app's full screen (⌘⇧⏎): only the page, no sidebar or rail
  toggleFull: () => void
  pinned?: (r: Ref) => boolean // on the rail (the rail on: App passes these)
  pin?: (r: Ref & { title: string }, on: boolean) => void
}
type Ref = { project: string; kind: PlanKind; slug: string }
type Got = { plan: Plan; doc: { title?: string; blocks?: unknown[] } | null; markdown: string; outside: boolean; files: PlanFile[] }
const KIND_WORDS: Record<PlanKind, [string, string]> = { spec: ['Specs', 'spec'], brainstorm: ['Brainstorms', 'brainstorm'] }
const KIND_SAYS: Record<PlanKind, string> = {
  spec: 'Requirements for a task, written like a Notion page: text, checklists, images, diagrams. Start a workspace from one, or point any agent at it.',
  brainstorm: 'An idea to explore: Laki AI writes options, diagrams, a mind map and clickable prototypes beside it.',
}
const kindIcon = (k: PlanKind) => (k === 'spec' ? 'spec' : 'bulb')
const ON_INDEX = 6 // each kind's newest on the index; the rest on its own page

// three levels, as breadcrumbs in the page's header: the index (both kinds: filter, project, New), a kind's whole list,
// and one spec or brainstorm alone, the page's whole width (and the window's, with the app's full screen)
export function SpecsPage({ projects, at, api, onClose }: { projects: Project[]; at?: { project?: string; kind?: PlanKind; slug?: string }; api: SpecsApi; onClose: () => void }) {
  const [list, setList] = useState<Plan[] | null>(null)
  const [level, setLevel] = useState<PlanKind | 'templates' | null>(at?.kind ?? null) // null: the index
  const kind = level === 'templates' ? null : level
  const [menu, openMenu] = useMenu()
  const [project, setProject] = useState(at?.project && projects.some(p => p.id === at.project) ? at.project : '')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Ref | null>(at?.project && at.kind && at.slug ? { project: at.project, kind: at.kind, slug: at.slug } : null)
  const [selTitle, setSelTitle] = useState('')
  const refresh = () => api.call<Plan[]>('planList', {}).then(setList, () => setList([]))
  useEffect(() => void (sel && selTitle && api.pinned?.(sel) && api.pin!({ ...sel, title: selTitle }, true)), [selTitle]) // a pin's tip follows a rename
  const pinItem = (p: Ref & { title: string }): MenuItem[] => (api.pin ? [api.pinned!(p) ? { label: 'Unpin from the rail', icon: 'pin', run: () => api.pin!(p, false) } : { label: 'Pin to the rail', icon: 'pin', sub: 'A click away, whatever page is open', run: () => api.pin!(p, true) }] : [])
  useEffect(() => {
    if (sel) return // one open: the list isn't on screen
    void refresh()
    const t = setInterval(refresh, 5000) // what Laki AI or an agent makes shows up
    return () => clearInterval(t)
  }, [!!sel])
  const name = (id: string) => projects.find(p => p.id === id)?.name ?? id
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (k: PlanKind) => (list ?? []).filter(p => p.kind === k && (!project || p.project === project) && words.every(w => `${p.title} ${name(p.project)}`.toLowerCase().includes(w)))
  const open = (p: Ref & { title?: string }) => (setSelTitle(p.title ?? ''), setLevel(p.kind), setSel({ project: p.project, kind: p.kind, slug: p.slug }))
  const up = (l: PlanKind | 'templates' | null) => (setSel(null), setLevel(l))
  // empty, or a template's text under its title
  const create = (k: PlanKind, t?: PlanTemplate) => {
    const into = project || projects[0]?.id
    if (!into) return
    api.call<Plan>('planNew', { project: into, kind: k, text: t?.text }).then(open, () => {})
  }
  const fromTemplate = (e: MouseEvent, k: PlanKind) => {
    const tpls = api.templates.filter(t => t.kind === k)
    openMenu(e, [
      { head: tpls.length ? `A new ${KIND_WORDS[k][1]} from a template` : `No ${KIND_WORDS[k][1]} templates yet` },
      ...tpls.map((t): MenuItem => ({ label: t.name.trim() || 'Untitled template', icon: 'file', sub: t.text.match(/^#+\s+(.+)$/gm)?.slice(0, 3).map(h => h.replace(/^#+\s+/, '')).join(' · '), run: () => create(k, t) })),
      { label: 'Edit templates…', icon: 'settings', foot: true, run: () => up('templates') },
    ], 'right')
  }
  const newTip = (k: PlanKind) => (project ? `A new ${KIND_WORDS[k][1]} in ${name(project)}` : `A new ${KIND_WORDS[k][1]} in ${projects[0] ? name(projects[0].id) : 'a project'} (pick a project to choose)`)
  // New: an empty one; its ▾, from a template
  const newButton = (k: PlanKind, primary: boolean) => (
    <span key={k} className={`split plans-new ${primary ? 'primary' : ''}`}>
      <button className={primary ? 'primary' : ''} disabled={!projects.length} data-tip={`${newTip(k)}, empty`} onClick={() => create(k)}>
        <Icon name="plus" /> New {KIND_WORDS[k][1]}
      </button>
      <button className={`caret ${primary ? 'primary' : ''}`} disabled={!projects.length} aria-label={`A new ${KIND_WORDS[k][1]} from a template`} data-tip="From a template" onClick={e => fromTemplate(e, k)}>
        <Icon name="chevron" size={11} />
      </button>
    </span>
  )
  const crumbs = (
    <nav className="crumbs" aria-label="Where you are">
      {level || sel ? (
        <button className="crumb" onClick={() => up(null)}>
          Specs & Brainstorms
        </button>
      ) : (
        <b className="crumb here">Specs & Brainstorms</b>
      )}
      {kind && <span className="crumb-sep">›</span>}
      {kind &&
        (sel ? (
          <button className="crumb" onClick={() => up(kind)}>
            {KIND_WORDS[kind][0]}
          </button>
        ) : (
          <b className="crumb here">{KIND_WORDS[kind][0]}</b>
        ))}
      {level === 'templates' && <span className="crumb-sep">›</span>}
      {level === 'templates' && <b className="crumb here">Templates</b>}
      {sel && <span className="crumb-sep">›</span>}
      {sel && <b className="crumb here">{selTitle || 'Untitled'}</b>}
      <span className="wf-beta">experimental</span>
    </nav>
  )
  const row = (p: Plan) => (
    <button key={`${p.project}/${p.kind}/${p.slug}`} className="plans-row" onClick={() => open(p)} onContextMenu={e => api.pin && (e.preventDefault(), openMenu(e, pinItem(p)))}>
      <Icon name={kindIcon(p.kind)} />
      <span className="plans-title">{p.title}</span>
      <span className="plans-meta muted small">
        {!project && `${name(p.project)} · `}
        {ago(p.at)}
        {p.files > 0 && ` · ${p.files} file${p.files === 1 ? '' : 's'}`}
      </span>
    </button>
  )
  const block = (k: PlanKind) => {
    const all = shown(k)
    const some = kind || words.length ? all : all.slice(0, ON_INDEX)
    return (
      <section key={k} className="plans-block">
        {!kind && (
          <div className="plans-block-head">
            <button className="link" onClick={() => up(k)}>
              <Icon name={kindIcon(k)} /> <b>{KIND_WORDS[k][0]}</b>
            </button>
            {all.length > 0 && <span className="muted small">{all.length}</span>}
            <span className="grow" />
            {all.length > some.length && (
              <button className="link small" onClick={() => up(k)}>
                All {all.length} ›
              </button>
            )}
          </div>
        )}
        {list === null ? <p className="muted small">Loading…</p> : some.length ? <div className="plans-rows">{some.map(row)}</div> : <div className="plans-empty muted small">{words.length || project ? `No ${KIND_WORDS[k][0].toLowerCase()} here.` : KIND_SAYS[k]}</div>}
      </section>
    )
  }
  return (
    <Page
      title="Specs & Brainstorms"
      head={crumbs}
      tools={
        <>
          {sel && api.pin && (on => <IconButton icon="pin" on={on} title={on ? 'Unpin from the rail' : 'Pin to the rail: a click away, whatever page is open'} onClick={() => api.pin!({ ...sel, title: selTitle || 'Untitled' }, !on)} />)(api.pinned!(sel))}
          <IconButton icon={api.full ? 'minimize' : 'maximize'} title={api.full ? 'Exit full screen (⌘⇧⏎)' : 'Full screen: just this page (⌘⇧⏎)'} onClick={api.toggleFull} />
        </>
      }
      wide
      onClose={onClose}
    >
      {menu}
      {level === 'templates' && !sel ? (
        <Templates templates={api.templates} save={api.saveTemplates} />
      ) : sel ? (
        <PlanView key={`${sel.project}/${sel.kind}/${sel.slug}`} at={sel} api={api} projectName={name(sel.project)} onTitle={setSelTitle} onSaved={refresh} onGone={() => up(sel.kind)} />
      ) : (
        <div className="plans-index">
          {kind && <p className="muted small plans-says">{KIND_SAYS[kind]} Each is a folder outside your repo with a README.md agents can read; nothing goes in a worktree.</p>}
          <div className="plans-bar">
            <input className="grow" type="search" value={q} placeholder="Filter by title or project" aria-label="Filter" onChange={e => setQ(e.target.value)} />
            <select value={project} aria-label="Project" onChange={e => setProject(e.target.value)}>
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {kind ? newButton(kind, true) : PLAN_KINDS.map((k, i) => newButton(k, i === 0))}
            {!kind && (
              <button data-tip="What a new spec or brainstorm can start from: its headings, the steps you want" onClick={() => up('templates')}>
                <Icon name="file" /> Templates
              </button>
            )}
          </div>
          {(kind ? [kind] : PLAN_KINDS).map(block)}
        </div>
      )}
    </Page>
  )
}

// one spec or brainstorm: its title, the editor (saved 600 ms after a change, and as it closes), its files
// the templates a new one can start from (New ▾): a name, a kind and its Markdown; saved as they're typed
function Templates({ templates, save }: { templates: PlanTemplate[]; save: (t: PlanTemplate[]) => void }) {
  const [list, setList] = useState(templates)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const next = useRef<PlanTemplate[] | null>(null)
  const flush = () => {
    clearTimeout(timer.current)
    if (next.current) save(next.current)
    next.current = null
  }
  useEffect(() => flush, [])
  const put = (l: PlanTemplate[]) => {
    setList(l)
    next.current = l
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 500)
  }
  const set = (i: number, t: Partial<PlanTemplate>) => put(list.map((x, j) => (j === i ? { ...x, ...t } : x)))
  return (
    <div className="plans-index">
      <p className="muted small plans-says">A new spec or brainstorm starts empty, or from one of these (New ▾): its Markdown goes under the title: headings, a checklist of the steps you want, questions to answer.</p>
      {list.map((t, i) => (
        <div key={i} className="plans-tpl">
          <div className="plans-bar">
            <input className="grow" value={t.name} aria-label="Name" placeholder="Name" onChange={e => set(i, { name: e.target.value })} />
            <select value={t.kind} aria-label="For" onChange={e => set(i, { kind: e.target.value as PlanKind })}>
              {PLAN_KINDS.map(k => (
                <option key={k} value={k}>
                  {KIND_WORDS[k][1]}
                </option>
              ))}
            </select>
            <IconButton icon="trash" title="Delete this template" onClick={() => void ask(`Delete the template ${t.name || 'without a name'}?`, { ok: 'Delete', danger: true }).then(y => y && put(list.filter((_, j) => j !== i)))} />
          </div>
          <textarea className="mono" rows={Math.min(14, Math.max(5, t.text.split('\n').length + 1))} value={t.text} aria-label="Its Markdown" placeholder={'## Goal\n\n## Steps\n- [ ] '} onChange={e => set(i, { text: e.target.value })} />
        </div>
      ))}
      <div className="plans-bar">
        <button onClick={() => put([...list, { name: 'New template', kind: 'spec', text: '## Goal\n\n## Steps\n\n- [ ] \n' }])}>
          <Icon name="plus" /> New template
        </button>
        <span className="grow" />
        <button className="link small" onClick={() => void ask('Back to the templates Laki comes with?', { text: 'Yours here are replaced by Feature (a spec) and Idea (a brainstorm).', ok: 'Replace' }).then(y => y && put(PLAN_TEMPLATES))}>
          The ones Laki comes with
        </button>
      </div>
    </div>
  )
}

// a refusal before it asked (off, busy, no key): said by the panel; a failure while it worked is in the chat
const REFUSED = /^(Laki AI is|ask something|the AI is still|no OpenRouter|not connected|Specs & Brainstorms are off)/

function PlanView({ at, api, projectName, onTitle, onSaved, onGone }: { at: Ref; api: SpecsApi; projectName: string; onTitle: (t: string) => void; onSaved: () => void; onGone: () => void }) {
  const [got, setGot] = useState<Got | null>(null)
  const [err, setErr] = useState('')
  const [title, setTitle] = useState('')
  const [load, setLoad] = useState<'doc' | 'readme' | null>(null) // a README.md newer than the doc: which the editor shows
  const [asking, setAsking] = useState(false) // its chat's ask is at work: the files every 2 s
  const [chatOn, setChatOn] = useState(() => stored('laki.planChat', true)) // a brainstorm's side panel
  const [chatErr, setChatErr] = useState('')
  const chat = planChat(at)
  const pending = useRef<{ blocks: unknown[]; markdown: string } | null>(null)
  const latest = useRef<{ blocks: unknown[]; markdown: string } | null>(null) // what the editor holds: a title change saves it too
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleRef = useRef('')
  titleRef.current = title
  useEffect(() => onTitle(title), [title]) // the breadcrumbs' last
  const get = () =>
    api.call<Got>('planGet', at).then(
      g => setGot(g),
      e => setErr((e as Error).message),
    )
  useEffect(() => {
    api.call<Got>('planGet', at).then(
      g => (setGot(g), setTitle(g.plan.title), setLoad(g.doc && g.outside ? null : g.doc ? 'doc' : 'readme')),
      e => setErr((e as Error).message),
    )
  }, [])
  const flush = () => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    if (p) return api.call('planSave', { ...at, title: titleRef.current, ...p }).then(onSaved, () => {})
  }
  useEffect(() => () => void flush(), []) // leaving it saves
  const later = (p: { blocks: unknown[]; markdown: string }) => {
    latest.current = p
    pending.current = p
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }
  // the files beside it: a brainstorm's output (attachments in files/ are the editor's)
  useEffect(() => {
    const t = setInterval(get, asking ? 2000 : 5000) // what Laki AI or an agent writes shows up as it goes
    return () => clearInterval(t)
  }, [asking])
  if (err) return <p className="warn small">{err}</p>
  if (!got) return <p className="muted small">Loading…</p>
  const p = got.plan
  const output = got.files.filter(f => !f.path.startsWith('files/'))
  const remove = () =>
    void ask(`Delete this ${p.kind}?`, { text: `${p.title}: its folder and everything in it (${got.files.length} file${got.files.length === 1 ? '' : 's'} besides the spec).`, ok: 'Delete', danger: true }).then(
      y => {
        if (!y) return
        clearTimeout(timer.current)
        pending.current = null
        latest.current = null
        api.call('planRm', at).then(() => (api.pinned?.(at) && api.pin!({ ...at, title: '' }, false), onGone()), () => {})
      },
    )
  const showChat = (on: boolean) => (setChatOn(on), keep('laki.planChat', on))
  // an ask in its chat (the panel shows it as it goes): false when refused before it started
  const askAi = (text: string, images: string[] = []) => {
    if (!api.aiOn) return api.aiSettings(), Promise.resolve(false)
    void flush() // the brief as it is now
    setChatErr('')
    showChat(true)
    return api.call('aiAsk', { chat, text, images }).then(
      () => (get(), true),
      e => (REFUSED.test(e.message) ? (setChatErr(e.message), false) : (get(), true)),
    )
  }
  const brainstorm = p.kind === 'brainstorm'
  return (
    <div className={`plan ${brainstorm && chatOn ? 'with-chat' : ''}`}>
      <div className="plan-main">
      <div className="plan-head">
        <input
          className="plan-title"
          value={title}
          aria-label="Title"
          placeholder="Untitled"
          disabled={load === null}
          onChange={e => {
            setTitle(e.target.value)
            if (latest.current) later(latest.current)
          }}
          onBlur={() => void flush()}
        />
        <div className="row plan-actions">
          {p.kind === 'spec' ? (
            <button className="primary" data-tip="The new-workspace page, its prompt naming this spec's README.md: pick the agent, start" onClick={() => (void flush(), api.start(p))}>
              <Icon name="run" /> Start
            </button>
          ) : (
            <button className="primary" disabled={asking} data-tip={api.aiOn ? 'Laki AI reads the brief and writes ideas, diagrams, a mind map and prototypes here; its chat is on the right' : 'Turn Laki AI on in Settings › AI first'} onClick={() => void askAi(brainstormPrompt({ ...p, title: title.trim() || p.title }))}>
              <Icon name="ai" /> {asking ? 'Brainstorming…' : 'Brainstorm with Laki AI'}
            </button>
          )}
          {brainstorm && <IconButton icon="ai" title={chatOn ? 'Hide the chat' : 'Chat with Laki AI about it'} on={chatOn} onClick={() => showChat(!chatOn)} />}
          <IconButton icon="copy" title={`Copy the path of its README.md, for a prompt: ${shortPath(p.path)}/README.md`} onClick={() => api.copy(`${p.path}/README.md`)} />
          <IconButton icon="folder" title="Show in Finder" onClick={() => api.reveal(p.path)} />
          <IconButton icon="trash" title={`Delete this ${p.kind}`} onClick={remove} />
        </div>
      </div>
      <div className="muted small plan-meta">
        {projectName} · {p.kind} · <span className="mono">{shortPath(p.path)}</span>
      </div>
      {asking && !chatOn && (
        <div className="plan-bar">
          <span className="glyph spin" /> Laki AI is brainstorming: its files show up below as it writes them.
          <button className="link" onClick={() => showChat(true)}>
            Show the chat
          </button>
        </div>
      )}
      {load === null ? (
        <div className="plan-bar">
          <Icon name="conflict" /> README.md changed outside Laki (an agent?).
          <button onClick={() => setLoad('readme')}>Load it</button>
          <button onClick={() => setLoad('doc')}>Keep mine</button>
          <span className="muted small">Loading it brings diagrams back as text.</span>
        </div>
      ) : (
        <SpecEditor
          key={load}
          initial={load === 'doc' && got.doc ? { blocks: got.doc.blocks } : { markdown: got.markdown }}
          files={{
            upload: f => fileData(f).then(data => api.call<{ path: string }>('planUpload', { ...at, name: f.name, data }).then(r => r.path)),
            resolve: path => api.call<{ image?: string }>('planFile', { ...at, path }).then(r => r.image ?? path),
          }}
          onReady={d => (latest.current = d)}
          onChange={(blocks, markdown) => later({ blocks, markdown })}
        />
      )}
      {(output.length > 0 || p.kind === 'brainstorm') && (
        <div className="plan-out">
          <div className="row">
            <b className="grow">{p.kind === 'brainstorm' ? 'Ideas and prototypes' : 'Files'}</b>
            <IconButton icon="refresh" title="Look again" onClick={get} />
          </div>
          {!output.length && <p className="muted small" data-tip={BRAINSTORM_OUTPUT}>Nothing yet. Write the idea above, then Brainstorm with Laki AI; or have any agent write files into the folder.</p>}
          {output.map(f => (
            <OutFile key={f.path} at={at} dir={p.path} f={f} api={api} />
          ))}
        </div>
      )}
      </div>
      {brainstorm && <PlanChat hidden={!chatOn} chat={chat} plan={p} api={api} err={chatErr} ask={askAi} onBusy={setAsking} onClose={() => showChat(false)} />}
    </div>
  )
}

type ChatData = { chat: AiMsg[]; busy: boolean; elsewhere: boolean; ended?: number }
// a brainstorm's own chat with Laki AI, beside it: the thread, the composer; kept mounted while hidden, so its ask is followed
function PlanChat({ hidden, chat, plan, api, err, ask, onBusy, onClose }: { hidden: boolean; chat: string; plan: Plan; api: SpecsApi; err: string; ask: (text: string, images?: string[]) => Promise<boolean>; onBusy: (b: boolean) => void; onClose: () => void }) {
  const [d, setD] = useState<ChatData>()
  const [text, setText] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [saving, setSaving] = useState(false)
  const [oops, setOops] = useState('')
  const thread = useRef<HTMLDivElement>(null)
  const busyOf = useRef<string | null>(null) // the other chat whose ask is at work, once an event names it
  const load = () => api.call<ChatData>('aiState', { chat }).then(setD, e => setOops(e.message))
  useEffect(() => {
    void load()
    return daemon.on(m => {
      if (m.ev === 'open') return void load()
      if (m.ev !== 'ai') return
      if (m.of === chat) setD({ chat: m.chat, busy: m.busy, ended: m.ended, elsewhere: false }) // one ask at a time: none elsewhere
      else {
        // another chat's ask: this one waits for it, until that chat says it's done
        if (m.busy) busyOf.current = m.of
        else if (busyOf.current !== null && busyOf.current !== m.of) return
        else busyOf.current = null
        setD(x => x && { ...x, elsewhere: m.busy })
      }
    })
  }, [])
  useEffect(() => onBusy(!!d?.busy), [d?.busy])
  // its own thread to the end, not the page under it (scrollIntoView would move that too)
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [d?.chat.length, d?.busy, hidden])
  const send = () => {
    if (saving || d?.busy || (!text.trim() && !images.length)) return
    const sent = { text, images }
    setText('')
    setImages([])
    void ask(sent.text, sent.images.map(i => i.path)).then(ok => ok || (setText(sent.text), setImages(sent.images)))
  }
  const pick = (id: string, n: number) => api.call('aiAnswer', { id, n, chat }).catch(e => setOops(e.message))
  const lastAsk = d ? d.chat.map(m => m.role).lastIndexOf('user') : -1
  const open = new Set(d?.chat.flatMap((m, i) => (m.ask && i > lastAsk ? [m.ask.id] : [])))
  const say = err || oops
  return (
    <aside className="plan-chat" hidden={hidden} aria-label="Laki AI on this brainstorm">
      <div className="plan-chat-head">
        <Icon name="ai" />
        <b className="grow">Laki AI</b>
        <button className="ai-new" disabled={!d?.chat.length || d.busy} data-tip="Start over: a new chat about this brainstorm" onClick={() => api.call('aiNew', { chat }).then(load, e => setOops(e.message))}>
          <Icon name="plus" size={12} /> New chat
        </button>
        <IconButton icon="x" title="Hide the chat" onClick={onClose} />
      </div>
      <div className="plan-chat-thread" ref={thread} aria-live="polite">
        {!d?.chat.length ? (
          <div className="plan-chat-hello muted small">
            <p>Talk the idea through: Laki AI reads the brief and the project's code, and writes its options, diagrams, a mind map and prototypes into this brainstorm.</p>
            <button disabled={!api.aiOn || !!d?.elsewhere} onClick={() => void ask(brainstormPrompt(plan))}>
              <Icon name="ai" /> Brainstorm with Laki AI
            </button>
            {!api.aiOn && (
              <button className="link" onClick={api.aiSettings}>
                Turn Laki AI on in Settings › AI
              </button>
            )}
          </div>
        ) : (
          turns(d.chat).map((g, i, all) => (Array.isArray(g) ? <Tools key={i} list={g} live={d.busy && i === all.length - 1} /> : <Message key={i} m={g} link={same} busy={d.busy || !api.aiOn || !!d.ended || (!!g.ask && !open.has(g.ask.id))} onPick={pick} />))
        )}
        {d?.ended && (
          <div className="plan-bar small">
            <span className="grow">This chat ended {ago(d.ended)}, after {PLAN_CHAT_IDLE / 3600_000} hours unused: what you type starts a new one.</span>
            <button onClick={() => api.call('aiContinue', { chat }).then(load, e => setOops(e.message))}>Continue it</button>
          </div>
        )}
        {d?.busy && (
          <div className="ai-working">
            <span className="ai-dots">
              <i />
              <i />
              <i />
            </span>
            Working…
            <button onClick={() => api.call('aiStop', { chat })}>Stop</button>
          </div>
        )}
        {d?.elsewhere && !d.busy && <p className="muted small">Laki AI is busy in another chat; this one waits.</p>}
      </div>
      <div className="plan-chat-dock">
        <div className={`nw-card nw-composer ai-composer ${api.aiOn ? '' : 'off'}`}>
          <PromptInput
            value={text}
            onChange={setText}
            images={images}
            onImages={setImages}
            save={(data, ext) => api.call<string>('imageSave', { data, ext })}
            dictate={bridge?.dictate}
            dictationSettings={bridge?.dictationSettings}
            onSubmit={send}
            enter
            onBusy={setSaving}
            rows={2}
            placeholder={d?.chat.length ? 'Ask for more: another option, a darker prototype…' : 'Or say what to explore…'}
            tools={
              <button className="primary ai-send" aria-label="Ask (⏎)" data-tip="Ask (⏎) · ⇧⏎ a new line" disabled={!api.aiOn || !!d?.busy || saving || (!text.trim() && !images.length)} onClick={send}>
                <Icon name="arrowRight" size={14} />
              </button>
            }
          />
        </div>
        {say && <div className="ai-err">{say}</div>}
      </div>
    </aside>
  )
}
const same = (t: string) => t

const fileData = (f: File) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader()
    r.onload = () => done(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => fail(r.error)
    r.readAsDataURL(f)
  })

// a file of a brainstorm's: Markdown as a page (its mermaid diagrams drawn), a prototype in a sandboxed frame, a diagram
// drawn, an image; anything else by name
function OutFile({ at, dir, f, api }: { at: Ref; dir: string; f: PlanFile; api: SpecsApi }) {
  const ext = f.path.toLowerCase().match(/\.diagram\.json$|\.[^.]+$/)?.[0] ?? ''
  const [body, setBody] = useState<{ text?: string; image?: string } | null>(null)
  const [big, setBig] = useState(false)
  const [src, setSrc] = useState('')
  const page = ext === '.html' || ext === '.htm'
  useEffect(() => {
    if (page) daemonBase().then(b => setSrc(`${b}/plan/${encodeURIComponent(at.project)}/${at.kind}/${at.slug}/${f.path.split('/').map(encodeURIComponent).join('/')}?key=${api.key ?? ''}&at=${f.at}`))
    else if (['.md', '.diagram.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.txt', '.mmd'].includes(ext)) api.call('planFile', { ...at, path: f.path }).then(setBody, () => setBody({}))
  }, [f.at])
  const diagram = useMemo(() => {
    if (ext !== '.diagram.json' || !body?.text) return null
    try {
      return normalizeDiagram(JSON.parse(body.text))
    } catch {
      return null
    }
  }, [body])
  const head = (
    <div className="out-head">
      <Icon name={page ? 'globe' : ext === '.md' ? 'file' : diagram ? 'board' : 'image'} />
      <b className="grow mono small">{f.path}</b>
      <span className="muted small">{ago(f.at)}</span>
      {(page || diagram) && <IconButton icon="maximize" title="Open it big" onClick={() => setBig(true)} />}
      <IconButton icon="folder" title="Show in Finder" onClick={() => api.reveal(`${dir}/${f.path}`.replace(/\/[^/]*$/, ''))} />
    </div>
  )
  return (
    <div className="out-file">
      {head}
      {page && src && <iframe className="out-page" title={f.path} src={src} sandbox="allow-scripts" />}
      {page && big && src && <BigPage title={f.path} src={src} onClose={() => setBig(false)} />}
      {ext === '.md' && body?.text !== undefined && (
        <div className="out-md">
          <Markdown src={body.text} />
        </div>
      )}
      {(ext === '.txt' || ext === '.mmd') && body?.text !== undefined && <pre className="out-text">{body.text}</pre>}
      {body?.image && <img className="out-img" src={body.image} alt={f.path} />}
      {diagram && <DiagramView value={diagram} />}
      {diagram && big && <ReadDiagram value={diagram} title={f.path} onClose={() => setBig(false)} />}
      {ext === '.diagram.json' && body && !diagram && <p className="warn small">Not a diagram Laki can draw.</p>}
    </div>
  )
}

function BigPage({ title, src, onClose }: { title: string; src: string; onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className="sd-modal">
      <div className="sd-toolbar">
        <span className="eyebrow">{title}</span>
        <span className="hint">a prototype: no requests out · Esc closes</span>
        <span className="grow" />
        <button onClick={onClose}>Close</button>
      </div>
      <iframe className="out-page big" title={title} src={src} sandbox="allow-scripts" />
    </div>
  )
}

export default SpecsPage
