// Syntax colors for the file preview: one regex per language family finds comments, strings, numbers,
// keywords, calls, types, keys and tags. It never builds HTML: tokens become React text (look.css colors
// the classes). Text over HL_MAX, or of an unknown kind, stays plain.

import { EXITS, WHOLE } from '../../shared/workflow.ts'

export type Tok = [cls: string, text: string] // cls '': plain
export const HL_MAX = 50 * 1024

const words = (s: string) => new Set(s.split(/\s+/))
const C_KW = words(`abstract any as async await bool boolean break byte case catch chan char class const constexpr continue crate
  debugger declare default defer delete do double dyn else enum err error export extends extern false fallthrough final finally float
  float64 fn for func function get go goto if impl implements import in infer init instanceof int int64 interface internal is keyof
  let long loop map match mod module move mut namespace native new nil none null number object of open operator override package
  private protected pub public readonly ref return rune satisfies sealed select self set short signed sizeof static string struct
  super switch symbol template this throw throws trait true try type typedef typename typeof uint undefined union unknown unsafe
  unsigned use using val var virtual void volatile when where while with yield`)
const HASH_KW = words(`alias and as assert async await begin break case class continue def del do done elif else elsif end ensure
  esac except export false fi finally for from function global if import in is lambda local module next nil none nonlocal not
  null or pass raise readonly redo require rescue retry return self source super then true try unless until when while with yield`)
const SQL_KW = words(`add all alter and as asc begin between by case check column commit constraint create cross default delete
  desc distinct drop else end exists foreign from full group having if in index inner insert into is join key left like limit
  not null offset on or order outer primary references returning right rollback select set table then transaction union unique
  update using values view when where with`)
const LUA_KW = words('and break do else elseif end false for function goto if in local nil not or repeat return then true until while')

// sources, in order: the first that matches at a spot wins
const END = '(?![\\s\\S])' // the text's end ($ is a line's: the m flag)
const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`
const NUM = String.raw`\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`
type Rule = [src: string, cls: string | ((m: string) => string)]
type Lang = { rules: Rule[]; kw?: Set<string>; ci?: boolean }

const ident = (kw: Set<string>, ci = false, types = true): Rule[] => [
  [String.raw`[A-Za-z_$][\w$]*(?=\s*\()`, m => (kw.has(ci ? m.toLowerCase() : m) ? 'hl-k' : 'hl-f')],
  [String.raw`[A-Za-z_$][\w$]*`, m => (kw.has(ci ? m.toLowerCase() : m) ? 'hl-k' : types && /^[A-Z][a-z]/.test(m) ? 'hl-t' : '')],
]
const C: Lang = {
  rules: [[String.raw`/\*[\s\S]*?(?:\*/|${END})`, 'hl-c'], ['//[^\\n]*', 'hl-c'], ['`(?:[^`\\\\]|\\\\[\\s\\S])*`?', 'hl-s'],
    [`(?:${STR})(?=\\s*:)`, 'hl-p'], [STR, 'hl-s'], [NUM, 'hl-n'], ['@[A-Za-z_]\\w*', 'hl-a'], ...ident(C_KW)],
}
const KEYS: Rule[] = [[String.raw`^[\t ]*\[[^\]\n]*\]`, 'hl-k'], [String.raw`^[\t ]*-?[\t ]*[\w.-]+(?=[\t ]*[:=])`, 'hl-p']]
const hash = (keys: boolean): Lang => ({
  rules: [[`"""[\\s\\S]*?(?:"""|${END})`, 'hl-s'], [`'''[\\s\\S]*?(?:'''|${END})`, 'hl-s'], ['(?<![$\\{])#[^\\n]*', 'hl-c'], ...(keys ? KEYS : []), [STR, 'hl-s'],
    [String.raw`\$\{[^}\n]*\}|\$\w+`, 'hl-v'], [NUM, 'hl-n'], ['@[A-Za-z_]\\w*', 'hl-a'], ...ident(HASH_KW, true)],
})
const SQL: Lang = { rules: [['--[^\\n]*', 'hl-c'], [String.raw`/\*[\s\S]*?(?:\*/|${END})`, 'hl-c'], [STR, 'hl-s'], [NUM, 'hl-n'], ...ident(SQL_KW, true, false)] }
const LUA: Lang = { rules: [[String.raw`--\[\[[\s\S]*?(?:\]\]|${END})`, 'hl-c'], ['--[^\\n]*', 'hl-c'], [STR, 'hl-s'], [NUM, 'hl-n'], ...ident(LUA_KW)] }
const HTML: Lang = {
  rules: [[`<!--[\\s\\S]*?(?:-->|${END})`, 'hl-c'], ['</?[A-Za-z][\\w:.-]*', 'hl-p'], [String.raw`[\w:@.-]+(?==)`, 'hl-a'], [STR, 'hl-s'], ['&[#\\w]+;', 'hl-n']],
}
const CSS: Lang = {
  rules: [[String.raw`/\*[\s\S]*?(?:\*/|${END})`, 'hl-c'], ['//[^\\n]*', 'hl-c'], [STR, 'hl-s'], ['@[\\w-]+', 'hl-k'], ['#[\\da-fA-F]{3,8}\\b', 'hl-n'],
    [String.raw`--?[A-Za-z][\w-]*(?=\s*:[^;{}\n]*(?:;|$|\}))`, 'hl-p'], [String.raw`-?\d*\.?\d+(?:px|r?em|%|v[hw]|s|ms|deg|fr|ch)?\b`, 'hl-n'], [String.raw`[\w-]+(?=\()`, 'hl-f']],
}
const MD: Lang = {
  rules: [[`\`\`\`[\\s\\S]*?(?:\`\`\`|${END})`, 'hl-s'], ['^#{1,6} [^\\n]*', 'hl-h'], ['`[^`\\n]+`', 'hl-s'], [String.raw`\*\*[^*\n]+\*\*`, 'hl-k'],
    [String.raw`\[[^\]\n]+\]\([^)\n]+\)`, 'hl-f'], [String.raw`^[\t ]*(?:[-*+]|\d+\.)(?= )`, 'hl-a'], ['^>[^\\n]*', 'hl-c'], [`<!--[\\s\\S]*?(?:-->|${END})`, 'hl-c']],
}

const BY_EXT: Record<string, Lang> = {}
const add = (lang: Lang, exts: string) => exts.split(' ').forEach(e => (BY_EXT[e] = lang))
add(C, 'js jsx ts tsx mjs cjs mts cts java c h cc cpp cxx hpp hh cs go rs swift kt kts scala dart php groovy gradle zig sol json jsonc json5 proto')
add(hash(false), 'py pyi rb rake gemspec sh bash zsh fish r pl pm ex exs cr nim coffee cmake mk makefile dockerfile gemfile rakefile procfile')
add(hash(true), 'yml yaml toml ini cfg conf properties env gitignore dockerignore editorconfig npmrc')
add(SQL, 'sql')
add(LUA, 'lua')
add(HTML, 'html htm xhtml xml svg vue svelte plist xaml erb hbs')
add(CSS, 'css scss sass less')
add(MD, 'md markdown mdx')

// a file's language by its extension, or its name (Makefile, .env.local, Dockerfile)
function langOf(path: string): Lang | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name.startsWith('.env')) return BY_EXT.env
  const dot = name.lastIndexOf('.')
  return BY_EXT[dot > 0 ? name.slice(dot + 1) : name.replace(/^\./, '')]
}

const compiled = new Map<Lang, RegExp>()

const plain = (text: string): Tok[][] => text.split('\n').map(l => (l ? [['', l]] : []))

// the text's tokens, by line
export function highlight(path: string, text: string): Tok[][] {
  const lang = text.length <= HL_MAX ? langOf(path) : undefined
  if (!lang) return plain(text)
  let re = compiled.get(lang)
  if (!re) compiled.set(lang, (re = new RegExp(lang.rules.map(([src]) => `(${src})`).join('|'), 'gm')))
  const lines: Tok[][] = [[]]
  const push = (cls: string, s: string) => {
    s.split('\n').forEach((part, i) => {
      if (i) lines.push([])
      if (part) lines[lines.length - 1].push([cls, part])
    })
  }
  let at = 0
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0]) {
      re.lastIndex++ // ponytail: a rule matched nothing (an anchor at a line end); step over
      continue
    }
    if (m.index > at) push('', text.slice(at, m.index))
    let i = 1
    while (m[i] === undefined) i++ // the rule that matched: its group
    const cls = lang.rules[i - 1][1]
    push(typeof cls === 'string' ? cls : cls(m[0]), m[0])
    at = re.lastIndex
  }
  if (at < text.length) push('', text.slice(at))
  return lines
}

// a workflow's file, as shared/workflow.ts parse reads it: # and ## headings, the key before a value (· between pairs;
// a WHOLE key's value is the rest of its line), > prompt lines, - label → id options, {{vars}}, "text", numbers,
// yes/no, and the block an exit (next:, ok:…) or an arrow goes to. Over HL_MAX: plain.
const EXIT_KEYS = new Set(Object.values(EXITS).flat())
const WF_VAL = /(\{\{[^}\n]*\}\})|("(?:[^"\\]|\\.)*")|(→|->)(\s*)([^\s·]*)|(?<![\w.-])(-?\d+(?:\.\d+)?)(?![\w.-])|(·)/g
const WF_KEY = /^(\s*)([a-z][\w ]*?)(:\s?)(.*)$/i

export function highlightWorkflow(text: string): Tok[][] {
  return text.length > HL_MAX ? plain(text) : text.split('\n').map(wfLine)
}

function wfLine(line: string): Tok[] {
  const out: Tok[] = []
  const put = (cls: string, s = '') => void (s && out.push([cls, s]))
  const value = (s: string) => {
    let at = 0
    for (const m of s.matchAll(WF_VAL)) {
      put('', s.slice(at, m.index))
      if (m[3]) put('hl-k', m[3]), put('', m[4]), put('hl-f', m[5])
      else put(m[1] ? 'hl-v' : m[2] ? 'hl-s' : m[6] ? 'hl-n' : 'hl-c', m[0])
      at = m.index + m[0].length
    }
    put('', s.slice(at))
  }
  if (/^#+\s/.test(line)) return put('hl-h', line), out
  if (line.startsWith('>')) {
    put('hl-c', '>')
    line.slice(1).split(/(\{\{[^}\n]*\}\})/).forEach((s, i) => put(i % 2 ? 'hl-v' : 'hl-s', s))
    return out
  }
  const opt = /^(\s*)(-)(\s.*)$/.exec(line) // - label → id, or a score's level under its question
  if (opt) return put('', opt[1]), put('hl-a', opt[2]), value(opt[3]), out
  const v = /^(var)(\s+)([\w-]+)(.*)$/.exec(line) // var NAME: value
  if (v) return put('hl-k', v[1]), put('', v[2]), put('hl-v', v[3]), value(v[4]), out
  const first = WF_KEY.exec(line)
  const parts = first && WHOLE.has(first[2].toLowerCase()) ? [line] : line.split(/(\s+·\s+)/)
  parts.forEach((p, i) => {
    const m = i % 2 ? null : WF_KEY.exec(p)
    if (!m) return value(p)
    put('', m[1]), put('hl-p', m[2]), put('', m[3])
    if (/^(yes|no|true|false|on|off)$/i.test(m[4].trim())) put('hl-k', m[4])
    else if (EXIT_KEYS.has(m[2].toLowerCase()) && m[4].trim() !== '?') put('hl-f', m[4])
    else value(m[4])
  })
  return out
}
