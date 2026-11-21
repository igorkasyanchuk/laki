// An Excel workbook (.xlsx, .xlsm) as tables for the side panel's Files (fileRead's `sheets`): the zip read with node's
// zlib, each sheet's cells from its XML, shared strings, booleans, errors, and dates by their cell's number format.
// Values only: no formulas, styles, merged cells or charts. The XML is read in one pass over its tags (walk): no
// pattern that can run to the end for each start, so a crafted part can't stall the daemon. Each part is inflated and
// read once per call, 96 MB inflated in all (a zip bomb: SheetTooBig), shared strings no more than cells can show.
// Pure (test/sheet.test.ts); the daemon runs it in a worker (sheetWorker.ts)
import { inflateRawSync } from 'node:zlib'

export type Sheet = { name: string; rows: string[][]; cut?: boolean } // cut: more rows or columns than shown
export const SHEET_ROWS = 2001 // the head and 2000 more (SidePanel's CSV_MAX)
export const SHEET_COLS = 100
export const SHEET_CELLS = 60_000 // the table's cells at most, a wide sheet's fewer rows: the window draws each one
export const SHEET_MAX = 20 << 20 // the file
const SHEETS = 20
const PART_MAX = 64 << 20 // one part inflated: past it, no table (a zip bomb)
const ALL_MAX = 96 << 20 // every part inflated, together
export const TOO_BIG = 'Too big to show as a table'
export let inflates = 0 // tests': how many parts were inflated

// the zip's parts by name, from its central directory (no ZIP64: a workbook under 4 GB)
function unzip(buf: Buffer): Map<string, () => Buffer> {
  let total = 0
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('not a zip')
  const parts = new Map<string, () => Buffer>()
  let at = buf.readUInt32LE(end + 16)
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken zip')
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
    let got: Buffer | undefined
    parts.set(name, () => {
      if (got) return got // once per call, however many sheets point at it
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('a broken zip')
      const from = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const raw = buf.subarray(from, from + size)
      if (method !== 0 && method !== 8) throw new Error(`zip method ${method}`)
      if (method === 8) inflates++
      try {
        got = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.min(PART_MAX, ALL_MAX - total) })
      } catch (e) {
        throw (e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? new Error(TOO_BIG) : e
      }
      if ((total += got.length) > ALL_MAX) throw new Error(TOO_BIG)
      return got
    })
  }
  return parts
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const code = (n: number, m: string) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m)
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] !== '#' ? (ENT[e] ?? m) : code(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1)), m)))
// a tag's attribute (an odd, huge tag: none); each name's pattern made once
const ATTR = new Map<string, RegExp>()
const attr = (attrs: string, name: string) => {
  if (attrs.length > 4096) return ''
  const re = ATTR.get(name) ?? (ATTR.set(name, new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`)), ATTR.get(name)!)
  const m = re.exec(attrs)
  return unxml(m?.[1] ?? m?.[2] ?? '')
}
// A1's column: 0 for A, 26 for AA
const colOf = (ref: string) => [...(/^[A-Z]{1,4}/.exec(ref)?.[0] ?? '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

// each tag in order (its name without a prefix, its attributes, open, close or both), with the text before it; f's
// false stops. Declarations and comments are skipped
type Kind = 'open' | 'close' | 'self'
function walk(xml: string, f: (name: string, attrs: string, kind: Kind, text: string) => boolean | void) {
  let i = 0
  for (let lt = xml.indexOf('<'); lt >= 0; lt = xml.indexOf('<', i)) {
    const gt = xml.indexOf('>', lt)
    if (gt < 0) return
    const text = xml.slice(i, lt)
    i = gt + 1
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') continue
    const close = xml[lt + 1] === '/'
    const self = xml[gt - 1] === '/'
    const body = xml.slice(lt + (close ? 2 : 1), self ? gt - 1 : gt)
    const sp = body.search(/\s/)
    const full = sp < 0 ? body : body.slice(0, sp)
    if (f(full.slice(full.indexOf(':') + 1), sp < 0 ? '' : body.slice(sp), close ? 'close' : self ? 'self' : 'open', text) === false) return
  }
}

// shared strings: each item's text, its runs' <t> joined, phonetic hints (rPh) left out; max: no more than a table's
// cells can show
function stringsOf(xml: string, max = SHEET_CELLS) {
  const out: string[] = []
  let cur = ''
  let inT = false
  let rph = false
  walk(xml, (name, _, kind, text) => {
    if (inT && !rph) cur += unxml(text)
    if (name === 'si') {
      if (kind === 'open') cur = ''
      else if (out.push(kind === 'self' ? '' : cur) >= max) return false
    } else if (name === 't') inT = kind === 'open'
    else if (name === 'rPh') rph = kind === 'open'
  })
  return out
}

// the cell styles that show a date: Excel's built-in date formats, or a custom one with a day, month, year or hour
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
function dateStyles(xml: string) {
  const custom = new Map<number, string>()
  const xfs: boolean[] = []
  let inXfs = false
  walk(xml, (name, attrs, kind) => {
    if (name === 'numFmt' && kind !== 'close') custom.set(Number(attr(attrs, 'numFmtId')), attr(attrs, 'formatCode'))
    else if (name === 'cellXfs') inXfs = kind === 'open'
    else if (name === 'xf' && inXfs && kind !== 'close') {
      const id = Number(attr(attrs, 'numFmtId'))
      xfs.push(DATE_IDS.has(id) || /[dmyh]/i.test((custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')))
    }
  })
  return xfs
}
// Excel's day number as a date, and a time when it has one
function dateText(n: number) {
  const t = new Date(Math.round((n - 25569) * 86400) * 1000)
  if (Number.isNaN(t.getTime())) return String(n)
  const iso = t.toISOString()
  return n % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 19).replace(/:00$/, '')}` : iso.slice(0, 10)
}

// a sheet's rows, its first SHEET_ROWS and SHEET_COLS, SHEET_CELLS in all (cut: there's more)
function rowsOf(xml: string, strings: string[], dates: boolean[], shift: number) {
  const rows: string[][] = []
  let cut = false
  let r = -1
  let row: string[] = []
  let cells = 0
  let c = -1
  let cell: { t: string; s: number } | null = null
  let v = ''
  let is = ''
  let inV = false
  let inT = false
  let rph = false
  const put = () => {
    if (!cell) return
    if (c >= SHEET_COLS) return void (cut = true)
    const value =
      cell.t === 's' ? (strings[Number(v)] ?? '')
      : cell.t === 'inlineStr' ? is
      : cell.t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
      : cell.t === 'str' || cell.t === 'e' || !v ? v
      : dates[cell.s] ? dateText(Number(v) + shift)
      : v
    while (row.length < c) row.push('')
    row[c] = value
    cell = null
  }
  const end = () => {
    while (rows.length < r) rows.push([])
    rows[r] = row
    if ((cells += row.length) > SHEET_CELLS) return (cut = true), false
  }
  walk(xml, (name, attrs, kind, text) => {
    if (inV) v += unxml(text)
    else if (inT && !rph) is += unxml(text)
    if (name === 'row') {
      if (kind === 'close') return end()
      const n = Number(attr(attrs, 'r'))
      r = n > 0 ? n - 1 : r + 1 // its number, else the next
      if (r >= SHEET_ROWS) return (cut = true), false
      row = []
      c = -1
      if (kind === 'self') return end()
    } else if (name === 'c') {
      if (kind === 'close') return put()
      const ref = attr(attrs, 'r')
      c = ref ? colOf(ref) : c + 1
      cell = { t: attr(attrs, 't'), s: Number(attr(attrs, 's')) || 0 }
      v = is = ''
      if (kind === 'self') put()
    } else if (name === 'v') inV = kind === 'open'
    else if (name === 't') inT = kind === 'open'
    else if (name === 'rPh') rph = kind === 'open'
  })
  return { rows, cut }
}

export function readSheets(buf: Buffer): Sheet[] {
  const parts = unzip(buf)
  const texts = new Map<string, string>()
  const text = (name: string) => texts.get(name) ?? (t => (texts.set(name, t), t))(parts.get(name)?.().toString('utf8') ?? '')
  const book = text('xl/workbook.xml')
  if (!book) throw new Error('not an Excel workbook')
  const sheets: { name: string; id: string }[] = []
  let shift = 0 // a workbook from Mac Excel of old: days from 1904
  walk(book, (name, attrs, kind) => {
    if (kind === 'close') return
    if (name === 'sheet' && sheets.length < SHEETS) sheets.push({ name: attr(attrs, 'name'), id: attr(attrs, 'r:id') })
    else if (name === 'workbookPr' && /^(1|true)$/.test(attr(attrs, 'date1904'))) shift = 1462
  })
  const rels = new Map<string, string>()
  walk(text('xl/_rels/workbook.xml.rels'), (name, attrs, kind) => void (name === 'Relationship' && kind !== 'close' && rels.set(attr(attrs, 'Id'), attr(attrs, 'Target'))))
  const strings = stringsOf(text('xl/sharedStrings.xml'))
  const dates = dateStyles(text('xl/styles.xml'))
  const read = new Map<string, ReturnType<typeof rowsOf>>() // sheets that point at one part: read once
  return sheets.map((s, i) => {
    const target = rels.get(s.id) ?? ''
    const part = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : ''
    const { rows, cut } = read.get(part) ?? (r => (read.set(part, r), r))(rowsOf(part ? text(part) : '', strings, dates, shift))
    return { name: s.name || `Sheet ${i + 1}`, rows, ...(cut && { cut }) }
  })
}
