// Spoken answers (Settings › Voice › Speak Laki AI's answers, voice.speak 'short'): what the talk pill reads out of Laki
// AI's answer to a question you asked by the talk key: its first two sentences of plain prose, no code, Markdown, paths,
// URLs or anything secrets.ts' shapes flag, 240 characters at most (cut at a sentence's or a word's end). langOf: the
// answer's language by its script, for a voice that speaks it (the user's languages first). Pure: test/speak.test.ts
import { SECRETS } from './secrets.ts'

export const SPEAK_MAX = 240
export function speakable(text: string, max = SPEAK_MAX): string {
  let t = text.replace(/(```|~~~)[\s\S]*?(\1|$)/g, ' ') // code blocks, an unclosed one to the end
  for (const [re] of SECRETS) t = t.replace(re, ' ') // never read out, not even as a mask
  t = t
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // pictures
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // a link: its words
    .replace(/<?\b(?:https?|ftp|file):\/\/[^\s>)\]]+>?/gi, ' ') // URLs
    .replace(/(^|[\s(])(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]*)*/g, '$1 ') // absolute and ~ paths
    .replace(/(^|[\s(])[\w.-]+(?:\/[\w.-]+)+\.\w+/g, '$1 ') // relative paths with a file's name (src/app.ts)
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '') // heads, quotes, list marks
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ') // rules
    .replace(/(\*\*|~~|\*)(?=\S)([^\n]*?\S)\1/g, '$2') // emphasis: its words
    .replace(/(?<!\w)(__|_)(?=\S)([^\n]*?\S)\1(?!\w)/g, '$2') // _ only at a word's edge: snake_case stays a word (its _ a space below)
    .replace(/[|#*_~<>]/g, ' ') // what's left of tables and marks
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
  const sentences = t.match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]*|$)/g) ?? []
  let out = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim()
  if (out.length > max) {
    const cut = out.slice(0, max)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    out = end >= 40 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).trim()}…`
  }
  return out
}

// a script's languages, the most spoken first; Latin script: the user's own language (prefer's first)
const SCRIPTS: [RegExp, string[]][] = [
  [/[぀-ヿ]/g, ['ja']],
  [/[가-힯]/g, ['ko']],
  [/[一-鿿]/g, ['zh']],
  [/[Ѐ-ӿ]/g, ['ru', 'uk', 'bg', 'sr', 'be', 'kk']],
  [/[؀-ۿ]/g, ['ar', 'fa', 'ur']],
  [/[֐-׿]/g, ['he']],
  [/[Ͱ-Ͽ]/g, ['el']],
  [/[ऀ-ॿ]/g, ['hi', 'mr']],
  [/[฀-๿]/g, ['th']],
]
export function langOf(text: string, prefer: readonly string[] = []): string | undefined {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  const mine = (l: string) => prefer.some(p => p.toLowerCase().split('-')[0] === l)
  for (const [re, langs] of SCRIPTS) if (letters && (text.match(re)?.length ?? 0) > letters * 0.3) return langs.find(mine) ?? langs[0]
  return prefer[0]
}
