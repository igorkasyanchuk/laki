// A spec's editor (experimental, loaded only as a Specs page opens one): BlockNote, as specdrop has it (its
// web/editor.tsx), with specdrop's diagram block (diagram.tsx) and its slash menu items. Pasted and dropped files and a
// diagram's PNG go to the spec's files/ (planUpload): blocks keep that path, shown through resolve (a data URL).
// Every change goes to onChange with its Markdown (specmd.ts), which the Specs page saves as README.md.
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import { en } from '@blocknote/core/locales'
import { createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type Diagram, DiagramEditor, DiagramView, DiagramViewer, KINDS } from './diagram'
import './plans.css'
import { type Block, blocksToMarkdown, readmeBody } from './specmd'
import { ask } from './ui'

export type SpecFiles = { upload: (f: File) => Promise<string>; resolve: (url: string) => Promise<string> }

// Esc in a modal over the Specs page: its own (cancel, close), never the page's (Page closes on one not prevented)
export function useEscape(f: (() => void) | null) {
  const last = useRef(f)
  last.current = f
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && (e.preventDefault(), last.current?.())
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])
}

// blocks just inserted from the slash menu open their editor at once (not on later loads)
const openOnMount = new Set<string>()

const DiagramBlock = createReactBlockSpec(
  { type: 'diagram', propSchema: { kind: { default: 'flowchart' }, data: { default: '' }, png: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => {
      const value = ((): Diagram => {
        try {
          return JSON.parse(block.props.data) as Diagram
        } catch {
          return { kind: block.props.kind, nodes: [], edges: [] }
        }
      })()
      const [open, setOpen] = useState(() => openOnMount.has(block.id))
      const [reading, setReading] = useState(false)
      const close = () => (openOnMount.delete(block.id), setOpen(false))
      const remove = () => void ask('Delete this diagram?', { text: value.nodes?.length ? 'It goes from the spec, with everything drawn on it.' : 'It goes from the spec.', ok: 'Delete', danger: true }).then(y => y && editor.removeBlocks([block]))
      const empty = !value.nodes?.length
      return (
        <div className="sd-block" contentEditable={false}>
          <div className="sd-block-head">
            <span className="eyebrow">{KINDS[value.kind]?.title ?? value.kind} diagram</span>
            <span className="row-actions">
              {!empty && <button onClick={() => setReading(true)}>View</button>}
              <button onClick={() => setOpen(true)}>Edit</button>
              <button onClick={remove}>Delete</button>
            </span>
          </div>
          {empty ? <div className="sd-empty">Empty: click Edit</div> : <DiagramView value={value} />}
          {open &&
            createPortal(
              <Modal onEsc={close}>
                <DiagramEditor
                  value={value}
                  onCancel={close}
                  onSave={async (next, png) => {
                    // ponytail: the old PNG stays in files/; a stale one is never linked again. One that fails to upload: the
                    // drawing is kept without it (README.md then has its text only)
                    const url = png ? await (editor.uploadFile!(new File([png], 'diagram.png', { type: 'image/png' })) as Promise<string>).catch(() => '') : ''
                    editor.updateBlock(block, { props: { data: JSON.stringify(next), png: url } })
                    close()
                  }}
                />
              </Modal>,
              document.body,
            )}
          {reading && <ReadDiagram value={value} onClose={() => setReading(false)} />}
        </div>
      )
    },
  },
)

function Modal({ onEsc, children }: { onEsc: () => void; children: ReactNode }) {
  useEscape(onEsc)
  return <>{children}</>
}
export function ReadDiagram({ value, title, onClose }: { value: Diagram; title?: string; onClose: () => void }) {
  useEscape(onClose)
  return <DiagramViewer value={value} title={title} onClose={onClose} />
}

const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, diagram: DiagramBlock() } })
type Editor = typeof schema.BlockNoteEditor

const diagramItems = (editor: Editor) =>
  Object.entries(KINDS).map(([kind, k]) => ({
    title: `${k.title} diagram`,
    subtext: kind === 'wireframe' ? 'A UI mockup from a catalog of components' : 'Boxes and arrows',
    aliases: ['diagram', 'draw', kind, ...(k.aliases ?? [])],
    group: 'Diagrams',
    icon: <span className="slash-icon">◇</span>,
    onItemClick: () => void openOnMount.add(insertOrUpdateBlockForSlashMenu(editor, { type: 'diagram', props: { kind } } as never).id),
  }))

// files on the clipboard or in a drop become blocks of their own; rich text carrying a picture (Excel, Docs) pastes as text
function droppedFiles(dt: DataTransfer | null): File[] {
  const files = [...(dt?.files ?? [])]
  const html = dt?.getData('text/html')
  const rich = html && new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()
  return rich ? [] : files
}
const blockType = (mime: string) => (['image', 'video', 'audio'].find(t => mime.startsWith(`${t}/`)) ?? 'file') as 'image' | 'video' | 'audio' | 'file'
async function insertFiles(editor: Editor, files: File[], at: { id: string }, placement: 'before' | 'after' = 'after') {
  let ref: { id: string; content?: unknown } = editor.getBlock(at.id)!
  for (const file of files) {
    const partial = { type: blockType(file.type), props: { name: file.name } } as never
    const empty = Array.isArray(ref.content) && !ref.content.length
    const block = empty ? editor.updateBlock(ref as never, partial) : editor.insertBlocks([partial], ref as never, placement)[0]
    ref = block
    placement = 'after'
    try {
      editor.updateBlock(block, { props: { url: String(await editor.uploadFile!(file, block.id)) } } as never)
    } catch (e) {
      editor.updateBlock(block, { type: 'paragraph', content: `⚠ couldn't save ${file.name}: ${(e as Error).message}` } as never)
    }
  }
}

// light or dark, as the theme is now: BlockNote's menus follow it, plans.css paints the rest with the theme's colors
const scheme = () => (getComputedStyle(document.documentElement).colorScheme.includes('light') ? 'light' : 'dark')

// initial: spec.json's blocks, or README.md's text (an agent's, or a new one's headings) parsed
// onReady: what it holds as it opens (a title change saves it before any edit)
export function SpecEditor({ initial, files, onReady, onChange, placeholders }: { initial: { blocks?: unknown[]; markdown?: string }; files: SpecFiles; onReady?: (d: { blocks: unknown[]; markdown: string }) => void; onChange: (blocks: unknown[], markdown: string) => void; placeholders?: Record<string, string> }) {
  const editor = useCreateBlockNote({
    schema,
    ...(placeholders && { dictionary: { ...en, placeholders: { ...en.placeholders, ...placeholders } } }), // an empty block's words (To-dos': not BlockNote's "List")
    initialContent: initial.blocks?.length ? (initial.blocks as never) : undefined,
    uploadFile: f => files.upload(f),
    // ponytail: only images show (planFile's data URL); a video, audio or other file block keeps its files/ path, opened
    // from the folder (Show in Finder), not here
    resolveFileUrl: url => (url.startsWith('files/') ? files.resolve(url) : Promise.resolve(url)),
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const dropped = droppedFiles(event.clipboardData)
      if (!dropped.length) return defaultPasteHandler()
      void insertFiles(editor as Editor, dropped, editor.getTextCursorPosition().block)
      return true
    },
  })
  // README.md in: parsed once, as the editor's first content (not a change of the user's: no save)
  const last = useRef<string>(undefined)
  const loading = useRef(false) // its own replaceBlocks fires onChange: not an edit
  useEffect(() => {
    if (!initial.blocks?.length && initial.markdown !== undefined) {
      const parsed = editor.tryParseMarkdownToBlocks(readmeBody(initial.markdown))
      // a heading with nothing under it (a new one's): an empty line there to write in
      const blocks = parsed.flatMap((b, i) => (b.type === 'heading' && (!parsed[i + 1] || parsed[i + 1].type === 'heading') ? [b, { type: 'paragraph' } as never] : [b]))
      loading.current = true
      if (blocks.length) editor.replaceBlocks(editor.document, blocks)
      loading.current = false
      last.current = JSON.stringify(editor.document)
    }
    onReady?.({ blocks: editor.document, markdown: blocksToMarkdown(editor.document as Block[]) })
  }, [editor])
  // BlockNote fires onChange on a remount too: only a real edit saves
  last.current ??= JSON.stringify(editor.document)
  const changed = () => {
    if (loading.current) return
    const doc = JSON.stringify(editor.document)
    if (doc === last.current) return
    last.current = doc
    onChange(editor.document, blocksToMarkdown(editor.document as Block[]))
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const dropped = droppedFiles(e.dataTransfer)
    const target = (e.target as Element).closest?.('[data-id]')
    const at = target && editor.getBlock(target.getAttribute('data-id')!)
    if (!dropped.length || !at) return
    e.preventDefault()
    e.stopPropagation()
    const r = target.getBoundingClientRect()
    void insertFiles(editor, dropped, at, e.clientY < (r.top + r.bottom) / 2 ? 'before' : 'after')
  }
  return (
    <div className="editor-wrap" onDropCapture={onDrop}>
      <BlockNoteView editor={editor} theme={scheme()} slashMenu={false} onChange={changed}>
        <SuggestionMenuController triggerCharacter="/" getItems={async q => filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...diagramItems(editor)], q)} />
      </BlockNoteView>
    </div>
  )
}
export default SpecEditor
