// Voice (Settings › Voice). Device: macOS dictation, as the mic always did (main's startDictation:). Cloud: Laki
// records here, the daemon's voiceText has OpenRouter's speech-to-text write it down, and the text goes in where the
// cursor was when it started, as if typed (insertText: a prompt box, any field, a terminal's xterm). Hold Fn anywhere
// in Laki to talk, let go to insert; the mic button starts and stops it the same way.
// ponytail: the bubbles' Say it (floater.ts, its own window without this module) keeps macOS dictation in the cloud too
import { useSyncExternalStore } from 'react'
import type { TabView, VoiceSettings } from '../../shared/types'
import { api } from './api'
import { wavOf } from './text'

let settings: VoiceSettings = {}
let tabs: TabView[] = [] // which terminal's agent shows a menu (its ask): no typing into it
api.on(m => void (m.ev === 'state' && ((settings = m.view?.settings?.voice ?? {}), (tabs = m.view?.tabs ?? []))))
export const cloudVoice = () => settings.on === true && settings.engine === 'cloud' // experimental: off, the mic is macOS dictation

const RATE = 16000 // what speech models take; a minute is about 2 MB of WAV
const MAX_MS = 5 * 60000 // a recording stops by itself after this
const SHORT_MS = 150 // shorter: nothing to write down (Fn's taps never open the mic: HOLD_MS)

// what the bar and the mic show: listening, writing it down, and a line to say (a failure, or where the text went)
export type VoicePhase = { phase: 'idle' | 'listening' | 'writing'; said?: string }
let now: VoicePhase = { phase: 'idle' }
const subs = new Set<() => void>()
const set = (v: VoicePhase) => ((now = v), subs.forEach(f => f()))
export const useVoice = () => useSyncExternalStore(f => (subs.add(f), () => void subs.delete(f)), () => now)

let rec: { stop: (send: boolean) => void } | null = null
let saidT: ReturnType<typeof setTimeout> | undefined

export async function voiceStart() {
  if (now.phase !== 'idle') return
  const target = document.activeElement as HTMLElement | null
  set({ phase: 'listening' })
  // a stop before the mic opens (a permission prompt, a device that never answers): nothing heard, so idle at once, and
  // the stream, if it comes, closed; a start meanwhile is a recording of its own
  let dropped = false
  rec = { stop: () => ((dropped = true), (rec = null), set({ phase: 'idle' })) }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    if (dropped) return
    rec = null
    return say(`Microphone: ${(e as Error).message}`)
  }
  const off = () => stream.getTracks().forEach(t => t.stop())
  if (dropped) return off()
  try {
    const r = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const at = Date.now()
    let send = false
    const stop = (s: boolean) => ((send = s), r.state !== 'inactive' && r.stop())
    const limit = setTimeout(() => stop(true), MAX_MS)
    r.ondataavailable = e => chunks.push(e.data)
    r.onstop = () => {
      clearTimeout(limit)
      off()
      rec = null
      if (!send) return set({ phase: 'idle' })
      if (Date.now() - at < SHORT_MS) return say('Too short: hold Fn, or the mic, while you talk')
      set({ phase: 'writing' })
      void write(new Blob(chunks, { type: r.mimeType }), target)
    }
    rec = { stop }
    r.start()
  } catch (e) {
    off()
    rec = null
    say(`Microphone: ${(e as Error).message}`)
  }
}
// send: write it down and insert it; else drop it (Esc)
export const voiceStop = (send = true) => rec?.stop(send)

// the write under way; Esc while it works makes it another's, so its text goes nowhere
let writing = 0
async function write(audio: Blob, target: HTMLElement | null) {
  const mine = ++writing
  try {
    // decoding resamples to the context's rate: 16 kHz, its first channel
    const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await audio.arrayBuffer())
    const { text } = await api.call<{ text: string }>('voiceText', { audio: base64(wavOf(buf.getChannelData(0), RATE)) })
    if (mine !== writing) return
    set({ phase: 'idle' })
    if (text) await insert(text, target)
  } catch (e) {
    if (mine === writing) say((e as Error).message)
  }
}

function say(said: string) {
  set({ phase: 'idle', said })
  clearTimeout(saidT)
  saidT = setTimeout(() => now.said === said && set({ phase: 'idle' }), 6000)
}

const base64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

// as typed where the cursor was: a field gets a space before it after a word; a terminal or a one-line field gets one
// line (a newline there is Enter: it would run or send what's half said), and no field anything but newlines and tabs
// of the control characters. No field (the focus went nowhere), or a terminal whose agent shows a menu (its keys pick
// an option, as `send` refuses then too): the clipboard, else the text on the bar to type
async function insert(text: string, el: HTMLElement | null) {
  const term = !!el?.classList.contains('xterm-helper-textarea')
  const menu = term && tabs.find(t => t.id === el!.closest<HTMLElement>('[data-pane]')?.dataset.pane)?.ask
  if (menu || !el?.isConnected || !(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable)) {
    const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false)
    const shown = text.length > 300 ? `${text.slice(0, 298)}…` : text
    return say(`${menu ? 'The agent is asking something, so not typed there. ' : ''}${copied ? `Copied, paste it: "${shown}"` : `Nowhere to type it: "${shown}"`}`)
  }
  el.focus()
  const line = term || el instanceof HTMLInputElement
  const t = line ? text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/ {2,}/g, ' ').trim() : text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null
  const before = field && !term ? field.value.slice(0, field.selectionStart ?? 0) : ''
  if (t) document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + t)
}

// hold Fn to talk (cloud, settings' fn unset or on): held HOLD_MS, the mic opens; its keyup inserts. A tap, or another
// key while it's held (Fn ← for Home, Fn ⌫…: that key works as ever), never opens it, or drops what it heard; the
// window's blur ends it as a keyup would. Esc drops any recording, the mic button's too, or what's being written down
// (ponytail: a keyup lost without a blur, Fn let go over a native menu, records on until the next Fn or MAX_MS). Neither Fn nor that Esc gets
// to xterm or the app's keys: listening from the module's load, before App's own capture-phase keys, in every window
// that has a prompt (the app, the new-workspace and AI windows)
const HOLD_MS = 200
let held = false
let soon: ReturnType<typeof setTimeout> | undefined // Fn is down, the mic not open yet
const release = (send: boolean) => ((held = false), clearTimeout(soon), voiceStop(send))
const isFn = (e: KeyboardEvent) => e.key === 'Fn' || e.code === 'Fn'
// immediate: the app's other window listeners (Settings' Esc, popovers') come after this one, on the same target
const eat = (e: KeyboardEvent) => (e.preventDefault(), e.stopImmediatePropagation())
window.addEventListener(
  'keydown',
  e => {
    if (isFn(e)) {
      if (!cloudVoice() || settings.fn === false) return
      eat(e)
      if (!e.repeat && !held) (held = true), (soon = setTimeout(() => held && void voiceStart(), HOLD_MS))
    } else if (held) release(false)
    else if (e.key === 'Escape' && rec) eat(e), voiceStop(false)
    else if (e.key === 'Escape' && now.phase === 'writing') eat(e), writing++, set({ phase: 'idle' })
  },
  true,
)
window.addEventListener(
  'keyup',
  e => {
    if (!isFn(e) || !held) return
    eat(e)
    release(true)
  },
  true,
)
window.addEventListener('blur', () => held && release(true))
