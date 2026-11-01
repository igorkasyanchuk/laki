// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), other files too where the caller says how they're saved (saveFile: chips;
// a folder dropped in is its path, typed in), and voice: macOS dictation, or Settings › Voice's cloud (voice.ts). Its
// toolbar, as Claude's: + (images), the mic and its ⌄ (start, the microphone and language, or Voice's settings), then
// tools (the caller's pickers) on the right. App.tsx passes in how the daemon saves an image and how dictation starts.
import { type ReactNode, type RefObject, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { type ActionFile, FILE_MAX, type Template, templatesFor, type View } from '../../shared/types'
import { bytes } from '../../shared/widget'
import { api, bridge, openExternal } from './api'
import { type AgentCommand, completeInto, completions, pathText, type Ref, type Trigger, triggerAt, withPaths } from './text'
import { Icon, keep, load, useMenu } from './ui'
import { cloudVoice, useVoice, voiceSends, voiceStart, voiceStop } from './voice'

// what an extension's action gives a prompt box: its insert at the cursor, its files attached
export type Inserted = { text: string; files?: ActionFile[] }
export type Inserts = { label: string; sub?: string; run: () => Promise<Inserted | undefined> }[] // a box's Insert menu: extensions' actions (show prompt)
export type Img = { path: string; url?: string; size?: number } // saved file, and a data: URL for an image's thumbnail (none: another file, a chip; size: its bytes)

// a Laki AI composer's unsent text and pasted images, per chat (laki.aiDrafts, by key; images as their paths, shown again
// through aiImage, one no longer kept left out): back as the chat opens again, after a restart too, until sent or emptied
type Draft = { text: string; images?: string[] }
type Held = { key: string; text: string; images: Img[]; ready: boolean } // ready: its images are back (nothing written till then)
const DRAFTS = 'laki.aiDrafts'
const stored = (key: string): Draft => load<Record<string, Draft>>(DRAFTS, {})[key] ?? { text: '' }
const held = (key: string): Held => (d => ({ key, text: d.text ?? '', images: [], ready: !d.images?.length }))(stored(key))
export function useDraft(key: string) {
  const [h, setH] = useState(() => held(key))
  const cur = h.key === key ? h : held(key) // another chat in the same box: its own draft
  useEffect(() => {
    if (h.key !== key) setH(held(key))
    const paths = stored(key).images ?? []
    if (!paths.length) return
    let on = true
    void Promise.all(paths.map(path => api.call<string>('aiImage', { path }).then(url => ({ path, url }), () => null))).then(
      got => on && setH(x => (x.key === key ? { ...x, images: [...got.filter((i): i is NonNullable<typeof i> => !!i), ...x.images], ready: true } : x)),
    )
    return () => void (on = false)
  }, [key])
  useEffect(() => {
    if (h.key !== key || !h.ready) return
    const all = load<Record<string, Draft>>(DRAFTS, {})
    if (h.text.trim() || h.images.length) all[key] = { text: h.text, ...(h.images.length && { images: h.images.map(i => i.path) }) }
    else delete all[key]
    keep(DRAFTS, Object.keys(all).length ? all : undefined)
  }, [h])
  const mine = (x: Held) => (x.key === key ? x : held(key))
  const setText = (text: string) => setH(x => ({ ...mine(x), text }))
  const setImages = (f: Img[] | ((imgs: Img[]) => Img[])) => setH(x => (y => ({ ...y, images: typeof f === 'function' ? f(y.images) : f, ready: true }))(mine(x)))
  return [cur.text, setText, cur.images, setImages] as const
}

// the prompt the agent gets
export const withImages = (text: string, imgs: { path: string }[]) => withPaths(text, imgs.map(i => i.path))

// an attached file (fileSave's: <data>/files/<id>/<its name>): its icon, name and size, and its ✕ where it can go
export const FileChip = ({ path, size, onRemove }: { path: string; size?: number; onRemove?: () => void }) => (
  <span className="prompt-file" data-tip={path}>
    <Icon name="file" size={13} />
    <span className="prompt-file-name">{path.split('/').pop()}</span>
    {size !== undefined && <span className="muted">{bytes(size)}</span>}
    {onRemove && (
      <button type="button" aria-label="Remove" onClick={onRemove}>
        ×
      </button>
    )}
  </span>
)

// what agents read (claude, codex): other images (HEIC, SVG, …) are refused
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

const read = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })

// a pasted or dropped file to the daemon: an image (EXT) through save (imageSave), any other (HEIC, SVG too) through
// saveFile (fileSave), else refused; too big, refused before it's read (past the socket's maxPayload the connection drops)
export async function keepFile(f: File, save: (base64: string, ext: string) => Promise<string>, saveFile?: (base64: string, name: string) => Promise<string>) {
  const ext = EXT[f.type]
  const no = !ext && !saveFile ? 'PNG, JPEG, GIF or WebP only' : f.size > (ext ? 20 << 20 : FILE_MAX) ? `over ${ext ? 20 : 25} MB` : ''
  if (no) throw new Error(no)
  const url = await read(f)
  const data = url.slice(url.indexOf(',') + 1)
  return ext ? { path: await save(data, ext), url } : { path: await saveFile!(data, f.name) }
}

// what a box completes as you type (text.ts triggerAt): @ a file (its path), # an open PR or issue (its URL), / a
// prompt template (its text, the caret at {{prompt}}); each read as its menu first opens, kept a minute. None: no menu
// ponytail: a template's agent variables ({{branch}}…) go in as written, filled only where the box's sender fills them
export type Complete = {
  key?: string // whose they are (a workspace's, a project's): another's are read anew
  files?: () => Promise<{ files: string[]; changed?: string[] }>
  refs?: () => Promise<Ref[]>
  templates?: () => Template[]
  commands?: () => Promise<AgentCommand[]> // the agent's own commands and skills, under the templates
  agent?: string // whose commands: another agent's are read anew (the files and refs stay)
}

// @ # / for a text box (PromptInput's, Send later's): the trigger the caret is in (one Esc closed stays closed: shut,
// its start), the row lit, what's been read. The box's own handlers call look (a change, a caret move), blur and key
// (true: the menu took it); menu goes beside the box, in a parent with position: relative
export function useComplete(box: RefObject<HTMLTextAreaElement | null>, complete: Complete | undefined, onChange: (v: string) => void) {
  const [trig, setTrig] = useState<Trigger | null>(null)
  const [shut, setShut] = useState(-1)
  const [lit, setLit] = useState(0)
  const [got, setGot] = useState<{ files?: string[]; changed?: string[]; refs?: Ref[]; commands?: AgentCommand[]; err?: string; loading?: boolean }>({})
  const read = useRef<Record<string, number>>({})
  const whose = complete?.key ?? ''
  const now = useRef(whose)
  now.current = whose
  const agentNow = useRef(complete?.agent) // likewise for the commands: another agent picked meanwhile drops the answer
  agentNow.current = complete?.agent
  useEffect(() => ((read.current = {}), setGot({})), [whose]) // another project or agent picked: not the last one's
  const source = (t: Trigger | null) => t && (t.ch === '@' ? complete?.files : t.ch === '#' ? complete?.refs : complete?.templates ?? complete?.commands)
  const look = () => {
    const el = box.current
    if (!complete || !el) return
    const t = el.selectionStart === el.selectionEnd ? triggerAt(el.value, el.selectionStart) : null
    const next = t && source(t) ? t : null
    if (!next) setShut(-1) // a space, or the caret out of it: the next one opens again
    if (next?.from !== trig?.from || next?.q !== trig?.q) setLit(0)
    setTrig(next)
  }
  useEffect(() => {
    const k = trig?.ch === '@' ? 'files' : trig?.ch === '#' ? 'refs' : trig?.ch === '/' && complete?.commands ? 'commands' : ''
    const rk = k === 'commands' ? `commands:${complete?.agent ?? ''}` : k // per agent
    if (!k || !complete || Date.now() - (read.current[rk] ?? 0) < 60_000) return
    read.current[rk] = Date.now()
    const of = whose
    const ag = complete.agent
    // an answer for the one picked before: dropped (another agent's commands: read again when it's picked again)
    const put = (x: Partial<typeof got>) => now.current === of && (k === 'commands' && agentNow.current !== ag ? ((read.current[rk] = 0), setGot(g => ({ ...g, loading: false }))) : setGot(g => ({ ...g, ...x, loading: false })))
    setGot(g => ({ ...g, err: undefined, loading: true }))
    ;(k === 'files' ? complete.files!().then(r => put({ files: r.files, changed: r.changed })) : k === 'refs' ? complete.refs!().then(refs => put({ refs })) : complete.commands!().then(commands => put({ commands }))).catch(e => ((read.current[rk] = 0), put({ err: String(e?.message ?? e) })))
  }, [trig?.ch, whose, complete?.agent])
  useEffect(() => setGot(g => (g.commands ? { ...g, commands: undefined } : g)), [complete?.agent]) // another agent picked: not the last one's
  const shown = trig && trig.from !== shut ? trig : null
  const rows = shown ? completions(shown, { ...got, templates: shown.ch === '/' ? complete?.templates?.() : undefined, commands: shown.ch === '/' ? got.commands : undefined }) : []
  const pick = (r: (typeof rows)[number]) => {
    const el = box.current
    if (!el || !shown) return
    const c = completeInto(el.value, shown, el.selectionStart, r.value, !!r.template)
    onChange(c.value)
    setTrig(null)
    setTimeout(() => (el.focus(), el.setSelectionRange(c.caret, c.caret))) // once the new value is in
  }
  const key = (e: KeyboardEvent) => {
    if (!shown || e.nativeEvent.isComposing) return false
    if (e.key === 'Escape') return e.preventDefault(), setShut(shown.from), true // the text stays as typed (claude's own /commands)
    if (!rows.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return e.preventDefault(), setLit(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length), true
    if ((e.key === 'Enter' && !e.metaKey && !e.shiftKey && !e.altKey) || (e.key === 'Tab' && !e.shiftKey)) return e.preventDefault(), pick(rows[Math.min(lit, rows.length - 1)]), true
    return false
  }
  const up = !!shown && !!box.current && box.current.getBoundingClientRect().bottom + 260 > innerHeight // no room under the box: over it
  const menu = shown && (rows.length > 0 || got.loading || got.err) && (
    <div className={`pi-complete ${up ? 'up' : ''}`} role="listbox" onMouseDown={e => e.preventDefault() /* the box keeps the focus */}>
      {rows.map((r, i) => (
        <div key={r.value + i} role="option" aria-selected={i === lit} className={`pi-row ${i === lit ? 'on' : ''}`} onMouseEnter={() => setLit(i)} onClick={() => pick(r)}>
          <span className="pi-label">{r.label}</span>
          {r.sub && <span className="pi-sub">{r.sub}</span>}
        </div>
      ))}
      {!rows.length && <div className="pi-row muted">{got.err ?? 'Loading…'}</div>}
      <div className="pi-foot">↑↓ · ⏎ or ⇥ picks · esc {shown.ch === '/' ? `keeps /${shown.q}` : 'closes'}</div>
    </div>
  )
  return { look, key, menu, blur: () => setTrig(null) }
}

// what a box can complete from the view: a workspace's files (else, files: true, the project's own folder's), the
// project's open PRs and issues (a git one), its prompt templates and the global ones. None outside a project
// agent: whose own / commands and skills come after the templates (claude, codex)
export function completeOf(view: View | null, o: { ws?: string; project?: string; files?: boolean; agent?: string }): Complete | undefined {
  const w = o.ws ? view?.workspaces.find(x => x.id === o.ws) : undefined
  const proj = view?.projects.find(x => x.id === (w?.project ?? o.project))
  if (!view || !proj || proj.kind) return undefined
  type Item = { number: number; title: string; url: string }
  return {
    key: w?.id ?? proj.id,
    agent: o.agent,
    files: w || o.files ? () => api.call<{ files: string[]; changed: Record<string, string> }>('files', w ? { ws: w.id } : { project: proj.id }).then(r => ({ files: r.files, changed: Object.keys(r.changed) })) : undefined,
    refs:
      proj.git !== false
        ? () =>
            Promise.all([api.call<Item[]>('prList', { project: proj.id, who: 'all' }), api.call<Item[]>('issueList', { project: proj.id }).catch(() => [] as Item[])]).then(([prs, issues]) =>
              [...prs.map(x => ({ n: x.number, title: x.title, url: x.url, kind: 'PR' as const })), ...issues.map(x => ({ n: x.number, title: x.title, url: x.url, kind: 'issue' as const }))].sort((a, b) => b.n - a.n),
            )
        : undefined,
    templates: () => templatesFor(view.settings?.templates, proj.config?.templates),
    commands: o.agent === 'claude' || o.agent === 'codex' ? () => api.call<AgentCommand[]>('agentCommands', { agent: o.agent, project: proj.id }) : undefined,
  }
}

export function PromptInput(p: {
  value: string
  onChange: (v: string) => void
  images: Img[]
  onImages: (f: (imgs: Img[]) => Img[]) => void
  save: (base64: string, ext: string) => Promise<string> // the saved file's path
  dictate?: () => void
  dictationSettings?: () => void
  onSubmit?: () => void // ⌘⏎
  enter?: boolean // ⏎ submits too (a chat's), ⇧⏎ a new line
  onBusy?: (busy: boolean) => void // images still saving: their paths aren't in yet
  placeholder?: string
  rows?: number
  tools?: ReactNode // the toolbar's right end
  lead?: ReactNode // pickers right after +: then the mic goes to the right end, before send
  send?: ReactNode // the toolbar's last button
  focus?: boolean // false: not focused as it mounts (its page focuses it, without scrolling)
  shot?: { n: number; png: string } // Screenshot to Laki AI's (a PNG, base64): each new one added as a pasted one, and the mic on
  inserts?: Inserts // extensions' actions (show prompt): what one prints goes in at the cursor, its files (#26) with the images
  files?: (fs: File[]) => void // other files too (attached, pasted, dropped): the caller's (none: images only)
  saveFile?: (base64: string, name: string) => Promise<string> // other files kept by the daemon (fileSave): chips, their paths in the prompt like images'
  complete?: Complete
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [err, setErr] = useState('')
  const [menu, openMenu] = useMenu()
  // dictation types into what macOS sees as the text field, which it learns from the web view a moment after focus:
  // started at once, it finds none and stops (the start sound, then nothing)
  const dictate = () => (box.current?.focus(), setTimeout(() => p.dictate!(), 150))
  // Voice's cloud: a click starts recording into this box, the next one writes it down here (as letting go of Fn does)
  const voice = useVoice()
  const cloud = cloudVoice()
  const talk = () => (voice.phase === 'listening' ? voiceStop() : (box.current?.focus(), void voiceStart()))
  // an extension's text at the cursor (over what's selected), the box focused after it
  const insertText = (t: string) => {
    const el = box.current
    const v = el?.value ?? p.value // the box as it is now: typed into while the action ran
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [v.length, v.length]
    if (a > 0 && /\S/.test(v[a - 1]) && /^\S/.test(t)) t = ` ${t}` // right after a word: a space, not one long word
    p.onChange(v.slice(0, a) + t + v.slice(b))
    requestAnimationFrame(() => el && (el.focus(), el.setSelectionRange(a + t.length, a + t.length)))
  }
  // an action's insert, and its files with the box's own: an image (imageSave's copy) with its thumbnail, any other a chip
  // where the box takes them (saveFile), else its path typed (Laki AI's)
  const inserted = (t: Inserted) => {
    const kept = (t.files ?? []).filter(f => f.image || p.saveFile)
    const typed = withPaths(t.text, (t.files ?? []).filter(f => !kept.includes(f)).map(f => f.path))
    if (typed) insertText(typed)
    if (kept.length) void Promise.all(kept.map(f => (f.image ? api.call<string>('aiImage', { path: f.path }).then(url => ({ path: f.path, url }), () => ({ path: f.path, size: f.size })) : { path: f.path, size: f.size }))).then(x => p.onImages(i => [...i, ...x]))
  }
  const cmp = useComplete(box, p.complete, p.onChange)
  const saving = useRef(0)
  const add = async (files: File[]) => {
    setErr('')
    p.onBusy?.(++saving.current > 0)
    for (const f of files) {
      try {
        const k = await keepFile(f, p.save, p.saveFile)
        p.onImages(x => [...x, k.url ? { path: k.path, url: k.url } : { path: k.path, size: f.size }])
      } catch (e) {
        setErr(`${f.name || 'image'}: ${(e as Error).message}`)
      }
    }
    p.onBusy?.(--saving.current > 0)
  }
  // Screenshot to Laki AI's picture, as if pasted; then the mic, once the window has the keyboard (dictation needs it:
  // the AI window comes up as the screenshot ends), not later than that: a click into it a while after would start it
  useEffect(() => {
    if (!p.shot) return
    void add([new File([Uint8Array.from(atob(p.shot.png), c => c.charCodeAt(0))], 'screenshot.png', { type: 'image/png' })])
    if (!(cloud || p.dictate)) return
    const go = () => (cloud ? (box.current?.focus(), void voiceStart()) : dictate())
    if (document.hasFocus()) return void go()
    window.addEventListener('focus', go, { once: true })
    const t = setTimeout(() => window.removeEventListener('focus', go), 5000)
    return () => (clearTimeout(t), window.removeEventListener('focus', go))
  }, [p.shot?.n])
  const filesOf = (l: DataTransferItemList | FileList) => Array.from(l as ArrayLike<DataTransferItem | File>).map(x => (x instanceof File ? x : x.kind === 'file' ? x.getAsFile() : null)).filter((f): f is File => !!f)
  // images to the daemon, other files to the caller's files, else saveFile's (neither: left out); false: nothing taken
  const take = (fs: File[]) => {
    const kept = fs.filter(f => f.type.startsWith('image/') || (p.saveFile && !p.files))
    const rest = p.files ? fs.filter(f => !f.type.startsWith('image/')) : []
    if (kept.length) add(kept)
    if (rest.length) p.files!(rest)
    return kept.length + rest.length > 0
  }
  const paste = (e: ClipboardEvent) => take(filesOf(e.clipboardData.items)) && e.preventDefault() // text pastes as usual
  // handled here: the default prevented tells the window's own drop (folders become projects) to keep out. A folder is
  // its path, typed in at the cursor (quoted), as a terminal's drop: never read
  const drop = (e: DragEvent) => {
    const all = Array.from(e.dataTransfer.items).flatMap(i => (f => (f ? [{ f, dir: !!i.webkitGetAsEntry()?.isDirectory }] : []))(i.kind === 'file' ? i.getAsFile() : null))
    const dirs = all.filter(x => x.dir).map(x => x.f)
    if (dirs.length) bridge?.pathOf ? insertText(`${dirs.map(f => pathText(bridge!.pathOf!(f))).join(' ')} `) : setErr(`${dirs[0].name}: a folder; drop the files in it`)
    if (take(all.filter(x => !x.dir).map(x => x.f)) || dirs.length) e.preventDefault()
  }
  const mic = (cloud || p.dictate) && (
    <span className="mic-split">
      <button
        type="button"
        className={`ib${cloud && voice.phase !== 'idle' ? ` voice-${voice.phase}` : ''}`}
        aria-label={cloud && voice.phase === 'listening' ? 'Stop and insert' : 'Dictate'}
        data-tip={cloud ? (voice.phase === 'listening' ? 'Stop and insert (or let go of Fn); Esc drops it' : 'Dictate: click, talk, click again; or hold Fn') : 'Dictate (macOS dictation; or press Fn twice)'}
        disabled={cloud && voice.phase === 'writing'}
        onMouseDown={e => e.preventDefault() /* the text box keeps the focus */}
        onClick={cloud ? talk : dictate}
      >
        <Icon name="mic" />
      </button>
      {(cloud || p.dictationSettings) && (
        <button
          type="button"
          className="ib caret"
          aria-label="Dictation options"
          aria-haspopup="menu"
          data-tip={cloud ? 'Voice: cloud' : 'Dictation: microphone and language'}
          onMouseDown={e => e.preventDefault()}
          onClick={e =>
            openMenu(
              e,
              cloud
                ? [
                    { head: 'Voice · cloud' },
                    { label: voice.phase === 'listening' ? 'Stop and insert' : 'Start dictating', icon: 'mic', hint: 'hold Fn', run: talk },
                    { label: 'Voice settings…', icon: 'settings', hint: 'Settings › Voice', run: () => openExternal('laki://settings/voice') },
                  ]
                : [
                    { head: 'Dictation · macOS' },
                    { label: 'Start dictating', icon: 'mic', hint: 'Fn Fn', run: dictate },
                    { label: 'Microphone and language…', icon: 'settings', hint: 'System Settings › Keyboard', run: p.dictationSettings! },
                    null,
                    { label: 'Voice settings…', icon: 'mic', hint: 'Settings › Voice', tip: 'macOS dictation or Laki’s cloud speech to text, Hold Fn, sending as you stop', run: () => openExternal('laki://settings/voice') },
                  ],
            )
          }
        >
          <Icon name="chevron" size={11} />
        </button>
      )}
    </span>
  )
  return (
    <div className="prompt-input" onDragOver={e => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={drop}>
      <textarea
        ref={box}
        rows={p.rows ?? 4}
        value={p.value}
        autoFocus={p.focus !== false}
        placeholder={p.placeholder ?? 'What should the agent do? Paste or drop screenshots here.'}
        onChange={e => (p.onChange(e.target.value), cmp.look())}
        onSelect={cmp.look}
        onBlur={cmp.blur}
        onPaste={paste}
        onKeyDown={(e: KeyboardEvent) => !cmp.key(e) && e.key === 'Enter' && (e.metaKey || (p.enter && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing)) && (e.preventDefault(), p.onSubmit?.())}
        data-voice-send={p.onSubmit ? '' : undefined} // Send as you stop talking: voice.ts presses its ⌘⏎
      />
      {cmp.menu}
      {p.images.length > 0 && (
        <div className="prompt-images">
          {p.images.map(i =>
            i.url ? (
              <div key={i.path} className="prompt-image" data-tip={i.path}>
                <img src={i.url} alt="" />
                <button type="button" aria-label="Remove" onClick={() => p.onImages(x => x.filter(y => y !== i))}>
                  ×
                </button>
              </div>
            ) : (
              <FileChip key={i.path} path={i.path} size={i.size} onRemove={() => p.onImages(x => x.filter(y => y !== i))} />
            ),
          )}
        </div>
      )}
      <div className="prompt-tools">
        <label className="ib" data-tip={p.files || p.saveFile ? 'Attach images or files (or paste or drop them in)' : 'Attach images (or paste or drop them in)'}>
          <Icon name="plus" />
          <input type="file" accept={p.files || p.saveFile ? undefined : 'image/*'} multiple hidden onChange={e => (take(filesOf(e.target.files!)), (e.target.value = ''))} />
        </label>
        {p.lead}
        {!p.lead && mic}
        {!!p.inserts?.length && (
          <button type="button" className="ib" aria-label="Insert from an extension" aria-haspopup="menu" data-tip="Insert from an extension" onMouseDown={e => e.preventDefault()} onClick={e => openMenu(e, [{ head: 'Insert' }, ...p.inserts!.map(x => ({ label: x.label, sub: x.sub, icon: 'panel' as const, run: () => void x.run().then(t => t && inserted(t), er => setErr(String(er?.message ?? er))) }))])}>
            <Icon name="panel" />
          </button>
        )}
        {err && <span className="warn small">{err}</span>}
        {(p.tools || p.lead) && (
          <span className="prompt-tools-end">
            {p.tools}
            {p.lead && mic}
            {p.send}
          </span>
        )}
      </div>
      {menu}
    </div>
  )
}

// what Voice's cloud is doing, wherever it started (the mic, hold Fn): listening, writing it down, then a line to say
// (it failed, or the text went to the clipboard). App's and the new-workspace and AI windows'
export function VoiceBar() {
  const v = useVoice()
  if (v.phase === 'idle' && !v.said) return null
  return (
    <div className={`voice-bar ${v.phase}`} role="status">
      {v.phase === 'idle' ? v.said : <><Icon name="mic" /> {v.phase === 'listening' ? `Listening… let go of Fn, or click the mic, to ${voiceSends() ? 'send' : 'insert'}; Esc drops it` : 'Writing it down… Esc drops it'}</>}
    </div>
  )
}
