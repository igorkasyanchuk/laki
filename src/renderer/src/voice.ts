// Voice (Settings › Voice). Device: macOS dictation, as the mic always did (main's startDictation:). Cloud: Laki
// records here, the daemon's voiceText has OpenRouter's speech-to-text write it down, and the text goes in where the
// cursor was when it started, as if typed (insertText: a prompt box, any field, a terminal's xterm). Hold Fn anywhere
// in Laki to talk, let go to insert; the mic button starts and stops it the same way.
// ponytail: the bubbles' Say it (floater.ts, its own window without this module) keeps macOS dictation in the cloud too
import { useSyncExternalStore } from 'react'
import type { TabView, VoiceSettings, WorkspaceView } from '../../shared/types'
import { api, bridge } from './api'
import { base64, wavOf, wsShown } from './text'
import { FLAT, FN0, type FnDo, type FnState, fnStep, HOLD_MS, levelOf, QUIET_MS, quietSay, silenceEnd, VOICE_MAX_MS, VOICE_SHORT_MS } from '../../shared/talk'

let settings: VoiceSettings = {}
let tabs: TabView[] = [] // which terminal's agent shows a menu (its ask): no typing into it
let wss: WorkspaceView[] = [] // the history's Send to…: its agents by workspace
// Recording mode, or Keep the last transcripts turned off: the history goes
api.on(m => void (m.ev === 'state' && ((settings = m.view?.settings?.voice ?? {}), (tabs = m.view?.tabs ?? []), (wss = m.view?.workspaces ?? []), (m.view?.settings?.recording || settings.history === false) && forget(), fnAsk())))
export const cloudVoice = () => settings.on !== false && settings.engine === 'cloud' // off: the mic is macOS dictation
// Send as you stop talking (settings' send): where the text goes, it's sent too (insert, below)
// ponytail: cloud only; macOS dictation's stop is macOS's, so its text is only typed
export const voiceSends = () => cloudVoice() && settings.send === true

const RATE = 16000 // what speech models take; a minute is about 2 MB of WAV
const MAX_MS = VOICE_MAX_MS // a recording stops by itself after this
const SHORT_MS = VOICE_SHORT_MS // shorter: nothing to write down (Fn's taps never open the mic: HOLD_MS)
const WARN_MS = 20000 // Q6: the bar counts down this long before the cap

// what the bar and the mic show: listening, writing it down, and a line to say (a failure, or where the text went).
// Q6: locked (a double tap: Fn again stops it), ends (the cap is near: when), quiet (nothing heard: why), undo (what
// it typed taken back)
export type VoicePhase = { phase: 'idle' | 'listening' | 'writing'; said?: string; locked?: boolean; held?: boolean; enter?: 'send' | 'insert'; ends?: number; quiet?: string; undo?: () => void }
let now: VoicePhase = { phase: 'idle' }
const subs = new Set<() => void>()
const set = (v: VoicePhase) => ((now = v), subs.forEach(f => f()))
export const useVoice = () => useSyncExternalStore(f => (subs.add(f), () => void subs.delete(f)), () => now)
// Q6: a value a component follows: the level meter's, the history's
function store<T>(v: T) {
  const subs = new Set<() => void>()
  return { get: () => v, set: (n: T) => ((v = n), subs.forEach(f => f())), use: () => useSyncExternalStore(f => (subs.add(f), () => void subs.delete(f)), () => v) }
}
const level = store(0)
export const useLevel = level.use
// Q6: the last 10 transcripts, newest first, in this window's memory only (gone as Laki quits, in Recording mode, or
// with Keep the last transcripts off); open: its list shows (⌥Fn, the bar's Earlier, the mic's menu)
const hist = store<{ list: string[]; open: boolean }>({ list: [], open: false })
export const useHistory = hist.use
export const historyOpen = (open: boolean) => hist.get().open !== open && hist.set({ ...hist.get(), open: open && hist.get().list.length > 0 })
const remember = (t: string) => settings.history !== false && hist.set({ ...hist.get(), list: [t, ...hist.get().list.filter(x => x !== t)].slice(0, 10) })
const forget = () => hist.get().list.length > 0 && hist.set({ list: [], open: false })
// the list's buttons: typed again where the cursor is (never sent), copied, or sent to an agent (the agents, by workspace)
export const voiceAgain = (t: string) => (historyOpen(false), void insert(t, document.activeElement as HTMLElement | null, false))
export const voiceCopy = (t: string) => (historyOpen(false), void navigator.clipboard?.writeText(t).then(() => say('Copied'), () => say('Not copied')))
export const voiceAgents = () => tabs.filter(t => t.kind === 'agent').map(t => ({ id: t.id, name: `${(w => (w ? wsShown(w) : '?'))(wss.find(w => w.id === t.workspace))} · ${t.name}` }))
export async function voiceSendTo(tab: string, t: string) {
  historyOpen(false)
  const why = await api.call('send', { target: tab, text: t, agent: true }).then(() => '', e => (e as Error).message)
  say(why ? `Not sent: ${why}` : `Sent to ${voiceAgents().find(a => a.id === tab)?.name ?? 'the agent'}`)
}

let rec: { stop: (send: boolean, only?: boolean, why?: string, force?: boolean) => void; at?: HTMLElement | null } | null = null // at: where its text goes; why: said as a dropped recording ends (Stop after silence heard nothing)
let saidT: ReturnType<typeof setTimeout> | undefined

// how: 'hold' Fn held (its release ends it), 'lock' Fn's double tap, 'free' the mic button or a screenshot's (Fn or the mic ends it)
export async function voiceStart(how: 'hold' | 'lock' | 'free' = 'free') {
  if (now.phase !== 'idle') return
  const target = document.activeElement as HTMLElement | null
  historyOpen(false)
  // ⏎ in the field it listens for ends it (not a terminal: its ⏎ is the agent's or the shell's): a box that sends, sent
  const enter = how === 'hold' || !isField(target) || isTerm(target) ? undefined : target!.dataset.voiceSend !== undefined ? 'send' : 'insert'
  set({ phase: 'listening', locked: how === 'lock', held: how === 'hold', enter })
  // a stop before the mic opens (a permission prompt, a device that never answers): nothing heard, so idle at once, and
  // the stream, if it comes, closed; a start meanwhile is a recording of its own
  let dropped = false
  rec = { stop: () => ((dropped = true), (rec = null), set({ phase: 'idle' })), at: target }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC)
  } catch (e) {
    if (dropped) return
    rec = null
    return say(`Microphone: ${(e as Error).message}`)
  }
  let meterOff = () => {}
  const off = () => (meterOff(), stream.getTracks().forEach(t => t.stop()))
  if (dropped) return off()
  meterOff = meter(stream)
  try {
    const r = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const at = Date.now()
    let send = false
    let only = false // typed, never sent (Send as you stop talking): the cap, the window's blur
    let why: string | undefined
    let force = false // ⏎ or Send ended it: sent whatever Send as you stop talking says
    const stop = (s: boolean, o = false, w?: string, f = false) => ((send = s), (only = o), (why = w), (force = f), r.state !== 'inactive' && r.stop())
    const limit = setTimeout(() => stop(true, true), MAX_MS)
    const warn = setTimeout(() => now.phase === 'listening' && set({ ...now, ends: at + MAX_MS }), MAX_MS - WARN_MS)
    r.ondataavailable = e => chunks.push(e.data)
    r.onstop = () => {
      clearTimeout(limit)
      clearTimeout(warn)
      off()
      rec = null
      if (!send) return why ? say(why) : set({ phase: 'idle' })
      if (Date.now() - at < SHORT_MS) return say('Too short: hold Fn, or the mic, while you talk')
      set({ phase: 'writing' })
      void write(new Blob(chunks, { type: r.mimeType }), target, !only, force)
    }
    rec = { stop, at: target }
    r.start()
  } catch (e) {
    off()
    rec = null
    say(`Microphone: ${(e as Error).message}`)
  }
}
// send: write it down and insert it; else drop it (Esc). only: insert it, never send it (Send as you stop talking).
// force: send it where it goes (a box that sends), the setting or not: ⏎ there, its Send button
export const voiceStop = (send = true, only = false, why?: string, force = false) => rec?.stop(send, only, why, force)
// is the recording under way this box's (its Send then ends it)
export const voiceIn = (el: HTMLElement | null) => !!el && rec?.at === el

// Q6: the level meter while it listens (the bar's), and "I can't hear you" with the input's name after QUIET_MS of
// nothing (gone as soon as it hears something); its stop. No AudioContext: it records all the same, no meter
function meter(stream: MediaStream, onLevel?: (l: number) => void) {
  try {
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const device = stream.getAudioTracks()[0]?.label
    let loud = Date.now()
    let heard = false
    const t = setInterval(() => {
      an.getByteTimeDomainData(buf)
      const l = levelOf(buf)
      level.set(l)
      onLevel?.(l)
      if (l >= FLAT) (loud = Date.now()), (heard = true)
      if (onLevel || now.phase !== 'listening') return // Settings' test: its own level only, a recording's state isn't its to set
      // Stop after silence: typed, never sent (as the cap); nothing heard at all: dropped, and why
      const end = silenceEnd(Date.now() - loud, settings.silence, heard)
      if (end) return void voiceStop(end === 'type', true, end === 'drop' ? quietSay(device) : undefined)
      const quiet = Date.now() - loud >= QUIET_MS ? quietSay(device) : undefined
      if (quiet !== now.quiet) set({ ...now, quiet })
    }, 80)
    return () => (clearInterval(t), level.set(0), void ctx.close().catch(() => {}))
  } catch {
    return () => {}
  }
}

// Settings › Voice's Test: the microphone for TEST_MS at most (stop ends it sooner), the level meter moving as it
// records; then what it recorded, to play back, whether anything was heard and the input's name. heardText: what the
// speech model writes of it (the cloud's)
export const TEST_MS = 10000
const MIC = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }
export function micTest() {
  let stop = () => {}
  let stopped = false
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia(MIC)
    let peak = 0
    const meterOff = meter(stream, l => (peak = Math.max(peak, l)))
    try {
      const r = new MediaRecorder(stream)
      const chunks: Blob[] = []
      r.ondataavailable = e => chunks.push(e.data)
      const ended = new Promise<void>(ok => (r.onstop = () => ok()))
      stop = () => void (r.state !== 'inactive' && r.stop())
      const cap = setTimeout(stop, TEST_MS)
      r.start()
      if (stopped) stop() // Stop before the mic opened
      await ended
      clearTimeout(cap)
      return { audio: new Blob(chunks, { type: r.mimeType }), heard: peak >= FLAT, device: stream.getAudioTracks()[0]?.label }
    } finally {
      meterOff()
      stream.getTracks().forEach(t => t.stop())
    }
  })()
  return { stop: () => ((stopped = true), stop()), done }
}
// a recording as the speech model takes it: decoding resamples to the context's rate, 16 kHz, its first channel
const wavB64 = async (audio: Blob) => base64(wavOf((await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await audio.arrayBuffer())).getChannelData(0), RATE))
export const heardText = async (audio: Blob) => (await api.call<{ text: string }>('voiceText', { audio: await wavB64(audio) })).text

// the write under way; Esc while it works makes it another's, so its text goes nowhere
let writing = 0
async function write(audio: Blob, target: HTMLElement | null, may: boolean, force = false) {
  const mine = ++writing
  try {
    const { text, fixed, fillers } = await api.call<{ text: string; fixed?: string[]; fillers?: number }>('voiceText', { audio: await wavB64(audio) })
    if (mine !== writing) return
    set({ phase: 'idle' })
    if (text) remember(text)
    const typed = !!text && (await insert(text, target, may, force))
    // Q6: typed into a field: Undo takes it back (as ⌘Z there would)
    if (text && (typed || fixed?.length || fillers) && now.phase === 'idle') say([now.said, typed && 'Typed', fixed?.length && `Word fixes: ${fixed.join(', ')}`, fillers && `${fillers} filler word${fillers > 1 ? 's' : ''} removed`].filter(Boolean).join(' · '), typed ? () => (el => el && undoIn(el))(isField(target) ? target : fieldNow()) : undefined)
  } catch (e) {
    if (mine === writing) say((e as Error).message)
  }
}

function say(said: string, undo?: () => void) {
  set({ phase: 'idle', said, undo })
  clearTimeout(saidT)
  saidT = setTimeout(() => now.said === said && set({ phase: 'idle' }), 6000)
}


// as typed where the cursor was: a field gets a space before it after a word; a terminal or a one-line field gets one
// line (a newline there is Enter: it would run or send what's half said), and no field anything but newlines and tabs
// of the control characters. No field (the focus went nowhere), or a terminal whose agent shows a menu (its keys pick
// an option, as `send` refuses then too): the clipboard, else the text on the bar to type.
// Send as you stop talking (may: not the cap's or a blur's): an idle agent tab's terminal gets it as send gives it
// (typed, then Enter; refused, it began asking meanwhile: copied, never typed there, its keys would pick); a box that sends (data-voice-send: a PromptInput with onSubmit, Send later's) its ⌘⏎ once its
// state has the text. Never a shell, nor any other field
const isTerm = (el: HTMLElement | null) => !!el?.classList.contains('xterm-helper-textarea')
const isField = (el: Element | null): el is HTMLElement => !!el?.isConnected && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el as HTMLElement).isContentEditable)
// where it started is gone (its panel closed, its box drawn again): the field with the focus now, else a prompt box on
// screen; typed there, never sent, and never a terminal (not where you meant it: its agent or shell would get it)
const fieldNow = () => (isField(document.activeElement) && !isTerm(document.activeElement) ? document.activeElement : [...document.querySelectorAll<HTMLElement>('textarea[data-voice-send]')].find(e => e.offsetParent) ?? null)
const undoIn = (el: HTMLElement) => (set({ phase: 'idle' }), el.isConnected && (el.focus(), document.execCommand('undo')))
// true: typed into a field (not a terminal, not sent), so Undo can take it back
async function insert(text: string, el: HTMLElement | null, may: boolean, force = false): Promise<boolean> {
  if (!isField(el)) (el = fieldNow()), (may = false)
  const term = isTerm(el)
  const tab = term ? tabs.find(t => t.id === el!.closest<HTMLElement>('[data-pane]')?.dataset.pane) : undefined
  const menu = tab?.ask
  if (menu || !isField(el)) {
    const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false)
    const shown = text.length > 300 ? `${text.slice(0, 298)}…` : text
    return say(`${menu ? 'The agent is asking something, so not typed there. ' : ''}${copied ? `Copied, paste it: "${shown}"` : `Nowhere to type it: "${shown}"`}`), false
  }
  el.focus()
  const line = term || el instanceof HTMLInputElement
  const t = line ? text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/ {2,}/g, ' ').trim() : text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null
  const before = field && !term ? field.value.slice(0, field.selectionStart ?? 0) : ''
  const sends = may && !!t && (voiceSends() || (force && el.dataset.voiceSend !== undefined))
  if (sends && tab?.kind === 'agent' && tab.status === 'idle') {
    const why = await api.call('send', { target: tab.id, text: t, agent: true }).then(() => '', e => (e as Error).message)
    if (!why) return say(`Sent to ${tab.name}`), false
    const copied = await navigator.clipboard?.writeText(t).then(() => true, () => false)
    return say(`Not sent: ${why}${copied ? '. Copied, paste it' : ''}`), false
  }
  if (t) document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + t)
  if (sends && el.dataset.voiceSend !== undefined) {
    await new Promise(ok => setTimeout(ok, 50)) // its box's state takes the text first
    if (!el.isConnected) return false
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    return say('Sent'), false
  }
  return !!t && !term
}

// hold Fn to talk (cloud, settings' fn unset or on): held HOLD_MS, the mic opens; its keyup inserts. A tap, or another
// key while it's held (Fn ← for Home, Fn ⌫…: that key works as ever), never opens it, or drops what it heard; the
// window's blur ends it as a keyup would. Q6: two quick taps lock it on (settings' lock unset or on; the bar: Locked),
// the next Fn stops it and inserts; ⌥Fn opens the last transcripts. The keys' rules are talk.ts' fnStep (pure, tested).
// Esc drops any recording, the mic button's too, or what's being written down
// (ponytail: a keyup lost without a blur, Fn let go over a native menu, records on until the next Fn or MAX_MS). Neither Fn nor that Esc gets
// to xterm or the app's keys: listening from the module's load, before App's own capture-phase keys, in every window
// that has a prompt (the app, the new-workspace and AI windows)
let fn: FnState = FN0
let soon: ReturnType<typeof setTimeout> | undefined // Fn is down, the mic not open yet
let alt = false // ⌥ is down: ⌥Fn is the history's
const isFn = (e: KeyboardEvent) => e.key === 'Fn' || e.code === 'Fn'
export const fnOn = () => cloudVoice() && settings.fn !== false
// the keys held now, by when each went down (or repeated): Fn with one of them (Fn ←, Fn ⌫) is that key's, never the mic.
// A keyup that went elsewhere (a webview took the focus) stops counting after DOWN_MS (macOS's longest repeat delay)
const DOWN_MS = 2500
const down = new Map<string, number>()
const keyHeld = () => [...down.values()].some(t => Date.now() - t < DOWN_MS)
const fnDo = (d: FnDo, only = false) => {
  if (d === 'open' || d === 'lock') now.phase === 'idle' ? void voiceStart(d === 'lock' ? 'lock' : 'hold') : (fn = FN0) // still writing the last one down
  else if (d === 'insert') voiceStop(true, only)
  else if (d === 'drop') voiceStop(false)
}
const fnEv = (ev: Parameters<typeof fnStep>[1], only = false) => {
  const [s, d] = fnStep(fn, ev, Date.now(), settings.lock !== false, now.phase === 'listening')
  fn = s
  if (!s.held) clearTimeout(soon)
  fnDo(d, only)
}
// a recording that ended some other way (Esc, the mic button, the cap): Fn's next press starts afresh
subs.add(() => now.phase !== 'listening' && (fn.locked || fn.open) && (fn = fnStep(fn, 'end', Date.now())[0]))
function fnDown() {
  if (alt) return historyOpen(!hist.get().open)
  if (fn.held || (!fn.locked && keyHeld())) return
  fnEv('down')
  if (fn.held && !fn.skip) soon = setTimeout(() => fnEv('held'), HOLD_MS)
}
// macOS: Fn from main (preload's onFn), its own key events never reach a page; elsewhere, or a build without it, keydown's
let fnAsked: boolean | undefined
const fnAsk = () => fnOn() !== fnAsked && bridge?.fnWatch && bridge.fnWatch((fnAsked = fnOn()))
bridge?.onFn?.(on => (on ? fnOn() && fnDown() : fn.held && fnEv('up')))
// immediate: the app's other window listeners (Settings' Esc, popovers') come after this one, on the same target
const eat = (e: KeyboardEvent) => (e.preventDefault(), e.stopImmediatePropagation())
window.addEventListener('keyup', e => void (down.delete(e.code), e.key === 'Alt' && (alt = false)), true)
window.addEventListener(
  'keydown',
  e => {
    if (isFn(e)) {
      if (!fnOn()) return
      eat(e)
      if (!e.repeat) fnDown()
      return
    }
    if (e.key === 'Alt') alt = true
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) down.set(e.code, Date.now())
    if (fn.held) fnEv('key')
    else if (e.key === 'Escape' && rec) eat(e), voiceStop(false)
    // ⏎ in the field it listens for (or, that one gone, the one with the focus): done talking; a box that sends, sent.
    // Shift's is a new line as ever
    else if (e.key === 'Enter' && rec && now.enter && !e.shiftKey && !e.altKey && !e.isComposing && isField(document.activeElement) && !isTerm(document.activeElement) && (document.activeElement === rec.at || !isField(rec.at ?? null))) eat(e), voiceStop(true, false, undefined, true)
    else if (e.key === 'Escape' && now.phase === 'writing') eat(e), writing++, set({ phase: 'idle' })
    else if (e.key === 'Escape' && hist.get().open) eat(e), historyOpen(false)
  },
  true,
)
window.addEventListener(
  'keyup',
  e => {
    if (!isFn(e) || !fn.held) return
    eat(e)
    fnEv('up')
  },
  true,
)
window.addEventListener('blur', () => (down.clear(), (alt = false), fn.held && fnEv('blur', true))) // typed, not sent: Fn wasn't let go
