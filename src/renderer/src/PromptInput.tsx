// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), and voice: macOS dictation, or Settings › Voice's cloud (voice.ts). Its
// toolbar, as Claude's: + (images), the mic and its ⌄ (start, the microphone and language, or Voice's settings), then
// tools (the caller's pickers) on the right. App.tsx passes in how the daemon saves an image and how dictation starts.
import { type ReactNode, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { api, openExternal } from './api'
import { Icon, keep, load, useMenu } from './ui'
import { cloudVoice, useVoice, voiceStart, voiceStop } from './voice'

export type Img = { path: string; url: string } // saved file, and a data: URL for its thumbnail

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
      got => on && setH(x => (x.key === key ? { ...x, images: [...got.filter((i): i is Img => !!i), ...x.images], ready: true } : x)),
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
export const withImages = (text: string, imgs: { path: string }[]) => [text.trim(), imgs.map(i => i.path).join('\n')].filter(Boolean).join('\n\n')

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
  inserts?: { label: string; sub?: string; run: () => Promise<string | undefined> }[] // extensions' actions (show prompt): what one prints goes in at the cursor
  files?: (fs: File[]) => void // other files too (attached, pasted, dropped): the caller's (none: images only)
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
    p.onChange(v.slice(0, a) + t + v.slice(b))
    requestAnimationFrame(() => el && (el.focus(), el.setSelectionRange(a + t.length, a + t.length)))
  }
  const saving = useRef(0)
  const add = async (files: File[]) => {
    setErr('')
    p.onBusy?.(++saving.current > 0)
    for (const f of files) {
      const ext = EXT[f.type]
      if (!ext) {
        setErr(`${f.name || 'image'}: PNG, JPEG, GIF or WebP only`)
        continue
      }
      try {
        const url = await read(f)
        const path = await p.save(url.slice(url.indexOf(',') + 1), ext)
        p.onImages(x => [...x, { path, url }])
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
  // images to the daemon, other files to the caller's files (none: left out); false: nothing taken
  const take = (l: DataTransferItemList | FileList) => {
    const fs = filesOf(l)
    const imgs = fs.filter(f => f.type.startsWith('image/'))
    const rest = p.files ? fs.filter(f => !f.type.startsWith('image/')) : []
    if (imgs.length) add(imgs)
    if (rest.length) p.files!(rest)
    return imgs.length + rest.length > 0
  }
  const paste = (e: ClipboardEvent) => take(e.clipboardData.items) && e.preventDefault() // text pastes as usual
  // handled here: the default prevented tells the window's own drop (folders become projects) to keep out
  const drop = (e: DragEvent) => take(e.dataTransfer.files) && e.preventDefault()
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
          {p.images.map(i => (
            <div key={i.path} className="prompt-image" data-tip={i.path}>
              <img src={i.url} alt="" />
              <button type="button" aria-label="Remove" onClick={() => p.onImages(x => x.filter(y => y !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="prompt-tools">
        <label className="ib" data-tip={p.files ? 'Attach images or files (or paste or drop them in)' : 'Attach images (or paste or drop them in)'}>
          <Icon name="plus" />
          <input type="file" accept={p.files ? undefined : 'image/*'} multiple hidden onChange={e => (take(e.target.files!), (e.target.value = ''))} />
        </label>
        {p.lead}
        {!p.lead && mic}
        {!!p.inserts?.length && (
          <button type="button" className="ib" aria-label="Insert from an extension" aria-haspopup="menu" data-tip="Insert from an extension" onMouseDown={e => e.preventDefault()} onClick={e => openMenu(e, [{ head: 'Insert' }, ...p.inserts!.map(x => ({ label: x.label, sub: x.sub, icon: 'panel' as const, run: () => void x.run().then(t => t && insertText(t), er => setErr(String(er?.message ?? er))) }))])}>
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
