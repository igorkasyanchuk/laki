// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), and macOS dictation. Its toolbar, as Claude's: + (images), the mic and
// its ⌄ (dictation: start, microphone and language), then tools (the caller's pickers) on the right. App.tsx passes
// in how the daemon saves an image and how dictation starts.
import { type ReactNode, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Icon, useMenu } from './ui'

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
  tools?: ReactNode // the toolbar's right end
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [err, setErr] = useState('')
  const [menu, openMenu] = useMenu()
  // dictation types into what macOS sees as the text field, which it learns from the web view a moment after focus:
  // started at once, it finds none and stops (the start sound, then nothing)
  const dictate = () => (box.current?.focus(), setTimeout(() => p.dictate!(), 150))
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
        <label className="ib" data-tip="Attach images (or paste or drop them in)">
          <Icon name="plus" />
          <input type="file" accept="image/*" multiple hidden onChange={e => (add(images(e.target.files!)), (e.target.value = ''))} />
        </label>
        {p.dictate && (
          <span className="mic-split">
            <button type="button" className="ib" aria-label="Dictate" data-tip="Dictate (macOS dictation; or press Fn twice)" onMouseDown={e => e.preventDefault() /* the text box keeps the focus */} onClick={dictate}>
              <Icon name="mic" />
            </button>
            {p.dictationSettings && (
              <button
                type="button"
                className="ib caret"
                aria-label="Dictation options"
                aria-haspopup="menu"
                data-tip="Dictation: microphone and language"
                onMouseDown={e => e.preventDefault()}
                onClick={e =>
                  openMenu(e, [
                    { head: 'Dictation · macOS' },
                    { label: 'Start dictating', icon: 'mic', hint: 'Fn Fn', run: dictate },
                    { label: 'Microphone and language…', icon: 'settings', hint: 'System Settings › Keyboard', run: p.dictationSettings! },
                  ])
                }
              >
                <Icon name="chevron" size={11} />
              </button>
            )}
          </span>
        )}
        {err && <span className="warn small">{err}</span>}
        {p.tools && <span className="prompt-tools-end">{p.tools}</span>}
      </div>
      {menu}
    </div>
  )
}
