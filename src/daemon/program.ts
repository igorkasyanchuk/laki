// OSC 7501, the Program Status Protocol: an agent says what it's doing through its own terminal (idle, working, blocked,
// done, error; a record for the program, the root, and one per child id). Shadow for now: Session answers the query and
// keeps the records, core compares the root's with the status from hooks (Settings › Agents & profiles' line), and
// nothing else reads them. A hint from a terminal's output: never an approval, never what a tab shows.
// ponytail: msg and title are checked (a bad one drops the report) but not kept, and a child's app isn't inherited: nothing shows either
import type { ProgramState } from '../shared/types.ts'

export type ProgramRecord = { id: string; state: ProgramState; kind?: string; app?: string; progress?: number; at: number } // id '': the root

export const PROGRAM_REPLY = '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\'
const STATES = new Set(['idle', 'working', 'done', 'blocked', 'error'])
const KINDS = new Set(['permission', 'question', 'auth'])
const MAX_PAYLOAD = 4096 - 9 // of the whole sequence: its ESC ] 7501 ; and its ST
const MAX_RECORDS = 64 // the least the protocol allows
const KEY = /^[a-z]+$/
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/
const NAME = /^[A-Za-z0-9_.+-]{1,32}$/ // an app, a segment of an id
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const utf8 = new TextDecoder('utf-8', { fatal: true })

const idOk = (id: string) => id.length <= 128 && id.split('/').length <= 8 && id.split('/').every(s => NAME.test(s))
function textOk(v: string, encoded: number, decoded: number) {
  if (v.length > encoded || !BASE64.test(v) || v.replace(/=+$/, '').length % 4 === 1) return false
  const b = Buffer.from(v, 'base64')
  if (b.length > decoded) return false
  try {
    return !CONTROL.test(utf8.decode(b))
  } catch {
    return false
  }
}

// a report: a record, a clear (id: that one and those under it; none: all), or undefined: dropped whole
export function parseReport(d: string): ProgramRecord | { clear: true; id?: string } | undefined {
  if (Buffer.byteLength(d) > MAX_PAYLOAD) return undefined
  const kv = new Map<string, string>()
  for (const pair of d.split(':')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const k = pair.slice(0, eq).trim()
    const v = pair.slice(eq + 1).trim()
    if (k.length > 16 || (k === 'id' && !idOk(v)) || ((k === 'msg' || k === 'title') && !VALUE.test(v))) return undefined // an id skipped as a bad pair would be the root's: state=clear:id=a@b, every record; a bad msg or title drops it too, whatever's wrong with it
    if (KEY.test(k) && VALUE.test(v)) kv.set(k, v)
  }
  const id = kv.get('id')
  const msg = kv.get('msg')
  const title = kv.get('title')
  if ((msg !== undefined && !textOk(msg, 2732, 2048)) || (title !== undefined && !textOk(title, 256, 192))) return undefined
  const state = kv.get('state') ?? ''
  if (state === 'clear') return { clear: true, ...(id !== undefined && { id }) }
  if (!STATES.has(state)) return undefined
  const kind = state === 'blocked' && KINDS.has(kv.get('kind') ?? '') ? kv.get('kind') : undefined
  const app = NAME.test(kv.get('app') ?? '') ? kv.get('app') : undefined
  const n = /^\d{1,3}$/.test(kv.get('progress') ?? '') ? Number(kv.get('progress')) : -1
  const progress = (state === 'working' || state === 'blocked') && n <= 100 && n >= 0 ? n : undefined
  return { id: id ?? '', state: state as ProgramState, ...(kind && { kind }), ...(app && { app }), ...(progress !== undefined && { progress }), at: Date.now() }
}

// one terminal's records: a Session's, so a new program in the tab starts with none
export class ProgramRecords {
  private records = new Map<string, ProgramRecord>()
  root = () => this.records.get('')
  get = (id: string) => this.records.get(id)
  clear = () => this.records.clear()
  // the shell's prompt is back (OSC 133 A): what was working or blocked isn't any more
  prompt() {
    for (const [id, r] of this.records) if (r.state === 'working' || r.state === 'blocked') this.records.delete(id)
  }
  // true when the root's changed: a child's report can't touch its parent
  report(d: string) {
    const r = parseReport(d)
    if (!r) return false
    if ('clear' in r) {
      if (r.id === undefined) {
        const had = !!this.root()
        this.clear()
        return had
      }
      for (const id of [...this.records.keys()]) if (id === r.id || id.startsWith(`${r.id}/`)) this.records.delete(id)
      return false
    }
    const was = this.records.get(r.id)?.state
    this.records.delete(r.id) // last in the Map: the most recently updated
    this.records.set(r.id, r)
    if (this.records.size > MAX_RECORDS) this.records.delete([...this.records.keys()].find(id => id !== '')!)
    return r.id === '' && was !== r.state // the same state again (its progress, say) restarts no settling
  }
}
