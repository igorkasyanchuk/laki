// A prompt for an agent: text, screenshots pasted or dropped in (the daemon saves them; their paths go
// after the text, and the agent opens them), and voice: macOS dictation, or Settings › Voice's cloud (voice.ts). Its
// toolbar, as Claude's: + (images), the mic and its ⌄ (start, the microphone and language, or Voice's settings), then
// tools (the caller's pickers) on the right. App.tsx passes in how the daemon saves an image and how dictation starts.
import { type ReactNode, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { openExternal } from './api'
import { Icon, useMenu } from './ui'
import { cloudVoice, useVoice, voiceStart, voiceStop } from './voice'

export type Img = { path: string; url: string } // saved file, and a data: URL for its thumbnail

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
  focus?: boolean // false: not focused as it mounts (its page focuses it, without scrolling)
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
        <label className="ib" data-tip="Attach images (or paste or drop them in)">
          <Icon name="plus" />
          <input type="file" accept="image/*" multiple hidden onChange={e => (add(images(e.target.files!)), (e.target.value = ''))} />
        </label>
        {(cloud || p.dictate) && (
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
        )}
        {err && <span className="warn small">{err}</span>}
        {p.tools && <span className="prompt-tools-end">{p.tools}</span>}
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
