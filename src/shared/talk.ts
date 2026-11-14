// Q2: the talk key's pill (main's talkWin, floater.ts talkPage): who a recording goes to, pure (test/talk.test.ts)

// a recording's limits, the app's mic and hold Fn's too (voice.ts): it stops by itself after MAX; shorter than SHORT,
// nothing to write down
export const VOICE_MAX_MS = 5 * 60000
export const VOICE_SHORT_MS = 150

// a target: a bubbles' float (an agent tab, its workspace's name, its status, since when it needs you)
export type TalkTo = { tab: string; name: string; status: string; at?: number }

// who it goes to unless you Tab to another: the agent that asked last (waiting, the newest ask), else the one you last
// sent to while it's still there, else a new task ('')
export function talkDefault(list: TalkTo[], last?: string): string {
  const asked = list.filter(f => f.status === 'waiting').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]
  if (asked) return asked.tab
  if (last && list.some(f => f.tab === last)) return last
  return ''
}

// Laki AI as a target (its name said first, the talk key set to Laki AI, Tab to it)
export const AI_TO = '@ai'

// Tab (⇧Tab: back): the next target, the list's agents then a new task, then Laki AI while it's on, round
export function talkNext(list: TalkTo[], cur: string, back = false, ai = false): string {
  const all = [...list.map(f => f.tab), '', ...(ai ? [AI_TO] : [])]
  const i = Math.max(0, all.indexOf(cur))
  return all[(i + (back ? all.length - 1 : 1)) % all.length]
}

// its name on the pill: Laki AI, the workspace's, else a new task
export const talkName = (list: TalkTo[], tab: string) => (tab === AI_TO ? 'Laki AI' : list.find(f => f.tab === tab)?.name ?? 'new task')

// Q10: what's said to Laki AI asks for the screen with it ("take a screenshot", "look at my screen", скріншот, на екрані):
// the screen under the pill goes to Laki AI's model with it, so only when it's asked for in so many words: never
// "fullscreen", "screening", "екранування" (escaping). ponytail: a few languages' words
const SHOT = [
  /\bscreen ?shots?\b|\b(?:my|the|this|on|at) screen\b(?! ?(?:reader|saver|size|time|record|shar|lock))|\bscreen grab\b/i, // never the screen reader, saver, recording…
  /скр[іи]н(?![иі]нг)/iu, // скрін, скріншот, скрин, скриншот; not скрининг, скринінг (screening)
  /(?<!\p{L})[еэ]кран[іиеуа]?(?!\p{L})/iu, // екран, на екрані, экран, на экране
  /\bbildschirm(?:foto)?\b|\bpantalla\b|écran(?!\p{L})|\bzrzut ekranu\b|\bekran(?:ie|u)?\b/iu,
]
export const talkShot = (text: string) => SHOT.some(r => r.test(text))

// the recording's time on the pill: 0:07, 1:02
export const talkTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

// Q5: a dictation routed by its first words (Settings › Voice › Route by first words, on unless false): the words
// before the first comma, colon, dash or pause (… or a sentence's end), 4 at most, may name who gets it: "Laki" (or the
// word set for it) → Laki AI; "new task [in <project>]" → a new workspace there; a workspace's name or an agent's
// @name, fuzzy (normalized, an edit distance of 1, 2 past 5 letters; under 4 letters exact) → that agent's tab. First match wins; no
// boundary, more words, or no match: the default (talkDefault's). `rest`: what's sent, without the address. Only the
// agent tabs given (never a shell); nothing here runs a command. The word fixes (Settings › Voice) go first: the
// cloud's voiceText has them in already, a dictation typed by macOS doesn't
export type RouteTab = TalkTo & { project?: string; alias?: string }
export type RouteTo = { kind: 'tab'; tab: string } | { kind: 'ai' } | { kind: 'new'; project?: string } | { kind: 'default' }
export type Route = { target: RouteTo; rest: string; how: string }
const LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ё: 'e', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia' }
// lower case, marks off, Cyrillic in Latin letters (cheap: a table), - _ . / @ as spaces
export const norm = (s: string) =>
  [...s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')]
    .map(c => LAT[c] ?? c)
    .join('')
    .replace(/[-_./@]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
export function dist(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = [...Array(b.length + 1).keys()]
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
// the same name, as said: spaces left out (check out flow = checkout-flow), a letter or two off; one under 4 letters
// only as it is ("Hi, …" isn't ui, "So, …" isn't go)
const near = (heard: string, name: string) => {
  const [h, n] = [heard.replace(/ /g, ''), name.replace(/ /g, '')]
  return !!n && (h === n || (n.length >= 4 && dist(h, n) <= (n.length > 5 ? 2 : 1)))
}
const exact = (heard: string, name: string) => heard.replace(/ /g, '') === name.replace(/ /g, '')
// Laki AI's name as heard: its word, with or without "AI" after it ("Laki AI"), and Laki as speech-to-text often writes
// it (Lucky, Lackey, Lakey; Лакі is laki already)
const LAKI_HEARD = /^(?:lucky|lucki|lacky|lackey|lakey|lakki|lakie)$/
const aiSaid = (head: string, word?: string) => (h => near(h, norm(word || 'Laki')) || (!word && LAKI_HEARD.test(h.replace(/ /g, ''))))(head.replace(/ (?:a i|ai|ei ai|eiai|ai i)$/, ''))
const NEW = /^(?:a |the )?new (?:task|session|workspace)(?: (?:in|for|on) (.+))?$/
export function routeOf(text: string, o: { tabs: RouteTab[]; projects: { id: string; name: string }[]; aiOn?: boolean; aiWord?: string; fixes?: string; fix?: (t: string, fixes?: string) => { text: string } }): Route {
  const said = (o.fix ? o.fix(text, o.fixes).text : text).trim()
  const none: Route = { target: { kind: 'default' }, rest: said, how: '' }
  const m = /^(.{1,80}?)\s*(?:[,:;]|\s[-–—]\s|…|\.{3}|[.!?](?=\s|$))\s*([\s\S]*)$/u.exec(said)
  if (!m) return none
  const head = norm(m[1].replace(/^(?:hey|ok|okay)\s+/i, ''))
  const rest = m[2].trim()
  const n = NEW.exec(head) // its project's name 4 words at most too
  if (!head || head.split(' ').length > (n?.[1] ? 7 : 4)) return none
  if (o.aiOn && aiSaid(head, o.aiWord)) return { target: { kind: 'ai' }, rest, how: 'Laki AI' }
  if (n) {
    if (!n[1]) return { target: { kind: 'new' }, rest, how: 'a new task' }
    const p = o.projects.find(p => exact(n[1], norm(p.name))) ?? o.projects.find(p => near(n[1], norm(p.name)))
    return p ? { target: { kind: 'new', project: p.id }, rest, how: `a new task in ${p.name}` } : none
  }
  const bare = head.replace(/^at /, '') // an @name said aloud
  const hits = o.tabs.filter(t => exact(head, norm(t.name)) || (t.alias && exact(bare, norm(t.alias))))
  const all = hits.length ? hits : o.tabs.filter(t => near(head, norm(t.name)) || (t.alias && near(bare, norm(t.alias))))
  if (all.length !== 1) return none // none, or two it could be: not a guess
  return { target: { kind: 'tab', tab: all[0].tab }, rest, how: all[0].name }
}

// Q6: Fn's keys (voice.ts), pure with the clock passed in (test/talk.test.ts). Held HOLD_MS, the mic opens and the
// release inserts; tapped twice (each press shorter than HOLD_MS, the second pressed within TAP2_MS of the first's
// release) it locks on, and the next press stops it and inserts. down: Fn pressed with no other key held; held:
// HOLD_MS after a down, Fn still down; key: another key (Fn ← is Home, never the mic; a locked mic keeps on);
// blur: the window lost the keyboard; end: the recording ended some other way (Esc, the mic button, the cap).
// other: a recording Fn didn't open is on (the mic button, a screenshot's): Fn stops it and inserts, as a locked one
export const HOLD_MS = 200
export const TAP2_MS = 350
export type FnState = { held: boolean; at: number; tap: number; open: boolean; locked: boolean; skip?: boolean } // skip: this press's release does nothing
export const FN0: FnState = { held: false, at: 0, tap: -Infinity, open: false, locked: false }
export type FnDo = '' | 'open' | 'insert' | 'drop' | 'lock'
export function fnStep(s: FnState, ev: 'down' | 'held' | 'up' | 'key' | 'blur' | 'end', t: number, lock = true, other = false): [FnState, FnDo] {
  if (ev === 'down') return s.locked || (other && !s.held) ? [{ ...FN0, held: true, at: t, skip: true }, 'insert'] : s.held ? [s, ''] : [{ ...s, held: true, at: t, open: false, skip: false }, '']
  if (ev === 'held') return s.held && !s.open && !s.skip ? [{ ...s, open: true }, 'open'] : [s, '']
  if (ev === 'up') {
    if (!s.held) return [s, '']
    if (s.open) return [FN0, 'insert']
    if (s.skip || t - s.at >= HOLD_MS) return [FN0, '']
    return lock && s.at - s.tap <= TAP2_MS ? [{ ...FN0, locked: true }, 'lock'] : [{ ...FN0, tap: t }, '']
  }
  if (ev === 'key') return s.locked ? [s, ''] : [FN0, s.open ? 'drop' : '']
  if (ev === 'blur') return s.locked ? [s, ''] : [FN0, s.open ? 'insert' : '']
  return [s.held ? { ...FN0, held: true, at: s.at, skip: true } : FN0, ''] // end
}

// Q6: a level meter's 0…1 from an AnalyserNode's time-domain bytes (128 is silence); under FLAT for QUIET_MS while
// listening: "I can't hear you" (a muted or wrong input reads 0, a quiet room a little over)
export const QUIET_MS = 3000
export const FLAT = 0.01
export function levelOf(buf: ArrayLike<number>) {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += (buf[i] - 128) ** 2
  return Math.min(1, (Math.sqrt(sum / (buf.length || 1)) * 3) / 100)
}
// Stop after silence (settings.voice.silence: seconds, one of SILENCES; unset: off): a recording with nothing heard that
// long ends by itself: what was said before typed (never sent: nobody let go of a key), or dropped when it heard nothing
export const SILENCES: [number, string][] = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes']]
export const silenceEnd = (quietMs: number, after: number | undefined, heard: boolean): 'type' | 'drop' | undefined => (after && SILENCES.some(s => s[0] === after) && quietMs >= after * 1000 ? (heard ? 'type' : 'drop') : undefined)
export const quietSay = (device?: string) => `I can't hear you: check the input${device ? ` (${device})` : ''}`

// The talk key answering a waiting ask: the whole transcript one of a few words for yes or no (fillers and punctuation
// aside), in English, Ukrainian or a language the filler list knows (German, French, Russian, Japanese, Chinese); never
// a longer sentence ("yes but use pnpm" is a message). lang: a locale or language ('uk-UA', 'en'); none: every one
const SPOKEN: Record<string, { yes: string[]; no: string[] }> = {
  en: { yes: ['yes', 'yeah', 'yep', 'allow', 'approve', 'ok', 'okay', 'allow it', 'approve it'], no: ['no', 'nope', 'deny', "don't", 'do not', 'deny it'] },
  uk: { yes: ['так', 'дозволяю', 'дозволити', 'гаразд', 'ок', 'окей'], no: ['ні', 'не треба', 'заборонити', 'відхилити', 'не дозволяю'] },
  ru: { yes: ['да', 'разрешаю', 'разрешить', 'хорошо', 'ок', 'окей'], no: ['нет', 'не надо', 'запретить', 'отклонить', 'не разрешаю'] },
  de: { yes: ['ja', 'erlauben', 'okay', 'ok'], no: ['nein', 'ablehnen', 'nicht'] },
  fr: { yes: ['oui', 'autoriser', "d'accord", 'ok'], no: ['non', 'refuser'] },
  ja: { yes: ['はい', 'いいよ', '許可'], no: ['いいえ', 'だめ', '拒否'] },
  zh: { yes: ['是', '好', '可以', '允许'], no: ['不', '不要', '拒绝'] },
}
const FILLER_WORDS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'hm', 'hmm', 'äh', 'ähm', 'euh', 'э', 'ээ', 'эээ', 'ну', 'えーと', 'ええと', 'えっと', '嗯'])
export function spokenAnswer(text: string, lang?: string): 'yes' | 'no' | undefined {
  const words = text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ').split(/\s+/).filter(w => w && !FILLER_WORDS.has(w))
  const said = words.join(' ')
  if (!said || words.length > 3) return
  const l = lang?.toLowerCase().split(/[-_]/)[0]
  for (const [k, w] of Object.entries(SPOKEN)) {
    if (l && l !== k && Object.hasOwn(SPOKEN, l)) continue
    if (w.yes.includes(said)) return 'yes'
    if (w.no.includes(said)) return 'no'
  }
}
