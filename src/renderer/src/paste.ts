// #10 (PromptInput's and the Reader's box): a long paste (over PASTE_LINES lines or PASTE_CHARS characters) kept as a file instead of filling the box, where
// the box keeps files: a chip, the agent gets its path. Not one with a secret in it (its line under the box takes it:
// secretHint), nor one right after ⇧⌘V (Edit › Paste and Match Style: as text, the old way)
// Pure: test/layout.test.ts
import { secretsIn } from '../../shared/secrets.ts'
export const PASTE_LINES = 40
export const PASTE_CHARS = 4000
let plainAt = 0
export const plainKey = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; key: string }) => void ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v' && (plainAt = Date.now()))
export const linesOf = (t: string) => t.replace(/\n$/, '').split('\n').length
export const longPaste = (t: string) => Date.now() - plainAt > 1000 && (t.length > PASTE_CHARS || linesOf(t) > PASTE_LINES) && !(t.length < 200_000 && secretsIn(t).length) // past 200 KB unchecked, as secretHint
export const pastedFile = (t: string) => new File([t], 'pasted-text.txt', { type: 'text/plain' })
