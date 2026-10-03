// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), and macOS dictation. The same file is in both apps
// (wb-superset, wb-spike); each passes in how its daemon saves an image and how dictation starts.
import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Icon } from './ui'

export type Img = { path: string; url: string } // saved file, and a data: URL for its thumbnail

// the prompt the agent gets
export const withImages = (text: string, imgs: Img[]) => [text.trim(), imgs.map(i => i.path).join('\n')].filter(Boolean).join('\n\n')

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
  onBusy?: (busy: boolean) => void // images still saving: their paths aren't in yet
  placeholder?: string
  rows?: number
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [err, setErr] = useState('')
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
  const images = (l: DataTransferItemList | FileList) =>
    Array.from(l as ArrayLike<DataTransferItem | File>)
      .map(x => (x instanceof File ? x : x.kind === 'file' ? x.getAsFile() : null))
      .filter((f): f is File => !!f && f.type.startsWith('image/'))
  const paste = (e: ClipboardEvent) => {
    const fs = images(e.clipboardData.items)
    if (!fs.length) return // text pastes as usual
    e.preventDefault()
    add(fs)
  }
  // handled here: the default prevented tells the window's own drop (folders become projects) to keep out
  const drop = (e: DragEvent) => {
    const fs = images(e.dataTransfer.files)
    if (!fs.length) return
    e.preventDefault()
    add(fs)
  }
  return (
    <div className="prompt-input" onDragOver={e => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={drop}>
      <textarea
        ref={box}
        rows={p.rows ?? 4}
        value={p.value}
        autoFocus
        placeholder={p.placeholder ?? 'What should the agent do? Paste or drop screenshots here.'}
        onChange={e => p.onChange(e.target.value)}
        onPaste={paste}
        onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && e.metaKey && (e.preventDefault(), p.onSubmit?.())}
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
        {p.dictate && (
          <button
            type="button"
            className="ib"
            data-tip="Dictate (macOS dictation; or press Fn twice)"
            onClick={() => {
              box.current?.focus()
              p.dictate!()
            }}
          >
            <Icon name="mic" />
          </button>
        )}
        {p.dictationSettings && (
          <button type="button" className="link small" data-tip="Microphone and languages, in System Settings → Keyboard → Dictation" onClick={p.dictationSettings}>
            mic & language…
          </button>
        )}
        <label className="ib" data-tip="Attach images">
          <Icon name="image" />
          <input type="file" accept="image/*" multiple hidden onChange={e => (add(images(e.target.files!)), (e.target.value = ''))} />
        </label>
        {err && <span className="warn small">{err}</span>}
      </div>
    </div>
  )
}
