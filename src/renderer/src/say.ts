// speech out loud: Laki AI's answer in the talk pill (floater.ts) and, in the app window, an agent's ask or finish
// (Settings › Voice › Speak asks, Speak when done: shared/speak.ts spokenNote, sent back by main's notify): a voice of
// the text's language (langOf: by its script, yours first) else the default. The app window's: two at most wait, the
// older dropped; Esc or the talk key ('' from main) stops it
import { langOf } from '../../shared/speak'

export function utter(text: string) {
  const u = new SpeechSynthesisUtterance(text)
  const l = langOf(text, navigator.languages)
  const v = l && speechSynthesis.getVoices().find(x => x.lang.toLowerCase().split(/[-_]/)[0] === l.toLowerCase().split('-')[0])
  if (l) u.lang = l
  if (v) u.voice = v
  return u
}

// #H1: the default audio output's name (enumerateDevices' audiooutput "default"; '' until a media permission was
// given: never asked for just this), kept as devices change; told: Settings' line
let outLabel = ''
const told = new Set<() => void>()
const readOut = () =>
  navigator.mediaDevices
    ?.enumerateDevices()
    .then(l => ((outLabel = l.find(d => d.kind === 'audiooutput' && d.deviceId === 'default')?.label ?? ''), told.forEach(f => f())))
    .catch(() => {})
export const outputLabel = () => outLabel
// the output read now and as devices change (sayInit's; the talk pill's conversation: on headphones it listens as it speaks)
let watching = false
export function watchOutput() {
  void readOut()
  if (!watching) (watching = true), navigator.mediaDevices?.addEventListener('devicechange', () => void readOut())
}
export const onOutput = (f: () => void) => (told.add(f), () => void told.delete(f))

const waiting: string[] = []
let talking = false
let now: SpeechSynthesisUtterance | undefined
const next = () => {
  const t = waiting.shift()
  if (!(talking = !!t)) return
  const u = (now = utter(t!))
  u.onend = u.onerror = () => now === u && next() // a cancelled one's late end doesn't start the next over a new one
  speechSynthesis.speak(u)
}
export const hush = () => ((waiting.length = 0), (talking = false), (now = undefined), speechSynthesis.cancel())
export function sayQueued(text: string) {
  if (!text) return hush()
  waiting.push(text)
  waiting.splice(0, waiting.length - 2)
  if (!talking) next()
}
export function sayInit(on?: (cb: (text: string) => void) => void) {
  on?.(sayQueued)
  watchOutput()
  addEventListener('keydown', e => e.key === 'Escape' && talking && hush(), true)
  addEventListener('pagehide', hush)
}
