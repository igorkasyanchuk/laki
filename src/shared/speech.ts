// Laki Speech's lines (native/laki-speech.swift, the talk key's on-device engine): one JSON object a line on its stdout,
// read by main (src/main/index.ts) and sent on to the talk pill. Pure: what isn't one of these is nothing
export type SpeechLine =
  | { kind: 'level'; level: number } // the mic's loudness, 0 to 1, about 12 a second
  | { kind: 'partial'; text: string } // what it has so far
  | { kind: 'final'; text: string } // stopped: what it heard ('' none)
  | { kind: 'error'; error: string; code: string } // no-on-device, locale, denied, mic-denied, mic, recognition
  | { kind: 'version'; version: string }
  | { kind: 'locales'; locales: string[] }

export function speechLine(line: string): SpeechLine | undefined {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(line)
  } catch {
    return
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return
  if (typeof j.level === 'number' && Number.isFinite(j.level)) return { kind: 'level', level: Math.max(0, Math.min(1, j.level)) }
  if (typeof j.partial === 'string') return { kind: 'partial', text: j.partial.slice(0, 20000) }
  if (typeof j.final === 'string') return { kind: 'final', text: j.final.slice(0, 20000) }
  if (typeof j.error === 'string') return { kind: 'error', error: j.error.slice(0, 300), code: typeof j.code === 'string' ? j.code : 'error' }
  if (typeof j.version === 'string') return { kind: 'version', version: j.version }
  if (Array.isArray(j.locales)) return { kind: 'locales', locales: j.locales.filter((x): x is string => typeof x === 'string' && /^[\w-]{2,20}$/.test(x)) }
}
