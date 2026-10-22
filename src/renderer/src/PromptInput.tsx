// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), other files too where the caller says how they're saved (saveFile: chips;
// a folder dropped in is its path, typed in), and voice: macOS dictation, or Settings › Voice's cloud (voice.ts). Its
// toolbar, as Claude's: + (images), the mic and its ⌄ (start, the microphone and language, or Voice's settings), then
// tools (the caller's pickers) on the right. App.tsx passes in how the daemon saves an image and how dictation starts.
import { type ReactNode, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { type ActionFile, FILE_MAX } from '../../shared/types'
import { bytes } from '../../shared/widget'
import { api, bridge, openExternal } from './api'
import { pathText, withPaths } from './text'
import { Icon, keep, load, useMenu } from './ui'
import { cloudVoice, useVoice, voiceStart, voiceStop } from './voice'

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
  const saving = useRef(0)
  const add = async (files: File[]) => {
    setErr('')
    p.onBusy?.(++saving.current > 0)
    for (const f of files) {
      const ext = EXT[f.type] // else a file (HEIC, SVG too): saveFile's, or refused
      // too big: refused before it's read (past the socket's maxPayload the connection drops)
      const no = !ext && !p.saveFile ? 'PNG, JPEG, GIF or WebP only' : f.size > (ext ? 20 << 20 : FILE_MAX) ? `over ${ext ? 20 : 25} MB` : ''
      if (no) {
        setErr(`${f.name || 'image'}: ${no}`)
        continue
      }
      try {
        const url = await read(f)
        const data = url.slice(url.indexOf(',') + 1)
        const path = ext ? await p.save(data, ext) : await p.saveFile!(data, f.name)
        p.onImages(x => [...x, ext ? { path, url } : { path, size: f.size }])
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
        onChange={e => p.onChange(e.target.value)}
        onPaste={paste}
        onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || (p.enter && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing)) && (e.preventDefault(), p.onSubmit?.())}
      />
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
      {v.phase === 'idle' ? v.said : <><Icon name="mic" /> {v.phase === 'listening' ? 'Listening… let go of Fn, or click the mic, to insert; Esc drops it' : 'Writing it down… Esc drops it'}</>}
    </div>
  )
}
