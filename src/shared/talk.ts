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
