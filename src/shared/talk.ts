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

// Tab (⇧Tab: back): the next target, the list's agents then a new task, round
export function talkNext(list: TalkTo[], cur: string, back = false): string {
  const all = [...list.map(f => f.tab), '']
  const i = Math.max(0, all.indexOf(cur))
  return all[(i + (back ? all.length - 1 : 1)) % all.length]
}

// its name on the pill: the workspace's, else a new task
export const talkName = (list: TalkTo[], tab: string) => list.find(f => f.tab === tab)?.name ?? 'new task'

// the recording's time on the pill: 0:07, 1:02
export const talkTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

// Q5: a dictation routed by its first words (Settings › Voice › Route by first words, on unless false): the words
// before the first comma, colon, dash or pause (… or a sentence's end), 4 at most, may name who gets it: "Laki" (or the
// word set for it) → Laki AI; "new task [in <project>]" → a new workspace there; a workspace's name or an agent's
// @name, fuzzy (normalized, an edit distance of 1, 2 past 5 letters) → that agent's tab. First match wins; no
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
// the same name, as said: spaces left out (check out flow = checkout-flow), a letter or two off
const near = (heard: string, name: string) => {
  const [h, n] = [heard.replace(/ /g, ''), name.replace(/ /g, '')]
  return !!n && (h === n || dist(h, n) <= (n.length > 5 ? 2 : 1))
}
const exact = (heard: string, name: string) => heard.replace(/ /g, '') === name.replace(/ /g, '')
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
  if (o.aiOn && near(head, norm(o.aiWord || 'Laki'))) return { target: { kind: 'ai' }, rest, how: 'Laki AI' }
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
