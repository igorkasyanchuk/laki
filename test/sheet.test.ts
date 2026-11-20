// An Excel workbook as tables (daemon/sheet.ts readSheets, fileRead's sheets): a zip made here (deflated and stored
// parts), shared and inline strings, rich runs, booleans, errors, dates by their style, gaps, entities, the column cap;
// fileRead gives its sheets, a broken one a file card
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import { readSheets, SHEET_CELLS, SHEET_COLS } from '../src/daemon/sheet.ts'
import { fresh } from './helpers.ts'

// a zip of these parts: each deflated, but ones named in stored kept as they are
function zip(parts: Record<string, string>, stored: string[] = []) {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let at = 0
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text)
    const store = stored.includes(name)
    const data = store ? raw : deflateRawSync(raw)
    const n = Buffer.from(name)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(store ? 0 : 8, 8)
    head.writeUInt32LE(crc32(raw), 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(raw.length, 22)
    head.writeUInt16LE(n.length, 26)
    const dirent = Buffer.alloc(46)
    dirent.writeUInt32LE(0x02014b50, 0)
    dirent.writeUInt16LE(store ? 0 : 8, 10)
    dirent.writeUInt32LE(crc32(raw), 16)
    dirent.writeUInt32LE(data.length, 20)
    dirent.writeUInt32LE(raw.length, 24)
    dirent.writeUInt16LE(n.length, 28)
    dirent.writeUInt32LE(at, 42)
    local.push(head, n, data)
    central.push(dirent, n)
    at += 30 + n.length + data.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(at, 16)
  return Buffer.concat([...local, dir, end])
}

const book = (sheets: string[], extra: Record<string, string> = {}, opts = '') =>
  zip({
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="r"><workbookPr${opts}/><sheets>${sheets.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="ws" Target="${i ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ...extra,
  }, ['xl/_rels/workbook.xml.rels'])

const STYLES = `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="&quot;Days&quot;\\ 0"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`

test('readSheets: strings, numbers, booleans, errors, dates, gaps, entities; a second sheet by an absolute target', () => {
  const x = book(['Q1 &amp; Q2', 'Empty'], {
    'xl/sharedStrings.xml': `<sst><si><t>Name</t></si><si><r><t>Ri</t></r><r><t/></r><r><t xml:space="preserve">ch </t></r><rPh><t>ignored</t></rPh></si><si/><si><t>a &lt;b&gt; &#x263A; &#128512;</t></si></sst>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline</t></is></c></row>
      <row r="3"><c r="A3"><v>3.5</v></c><c r="B3" t="b"><v>1</v></c><c r="C3" t="e"><v>#DIV/0!</v></c><c r="D3" t="str"><f>A3&amp;"x"</f><v>3.5x</v></c></row>
      <row r="4"><c r="A4" s="1"><v>45000</v></c><c r="B4" s="2"><v>45000.5</v></c><c r="C4" s="3"><v>7</v></c><c r="D4" t="s"><v>3</v></c><c r="E4" s="1"/></row>
    </sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
  })
  const [a, b] = readSheets(x)
  assert.equal(a.name, 'Q1 & Q2')
  assert.deepEqual(a.rows, [
    ['Name', 'Rich ', '', 'Inline'],
    [],
    ['3.5', 'TRUE', '#DIV/0!', '3.5x'],
    ['2023-03-15', '2023-03-15 12:00', '7', 'a <b> ☺ 😀', ''],
  ])
  assert.equal(a.cut, undefined)
  assert.deepEqual(b, { name: 'Empty', rows: [] })
})

test('readSheets: 1904 dates, cells past the column cap cut, not a workbook, not a zip', () => {
  const wide = `<row r="1">${[...Array(SHEET_COLS + 2)].map((_, i) => `<c><v>${i}</v></c>`).join('')}<c r="A2"/></row>`
  const [s] = readSheets(book(['W'], { 'xl/styles.xml': STYLES, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${wide}<row><c s="1"><v>0</v></c></row></sheetData></worksheet>` }, ' date1904="1"'))
  assert.equal(s.rows[0].length, SHEET_COLS)
  assert.equal(s.cut, true)
  assert.deepEqual(s.rows[1], ['1904-01-01'])
  assert.throws(() => readSheets(zip({ 'word/document.xml': '<w/>' })), /not an Excel workbook/)
  // a crafted one (rows and cells never closed, a tag with no end, a prefix on every tag): read in one pass, at once
  const t = Date.now()
  const [odd] = readSheets(book(['Odd'], { 'xl/sharedStrings.xml': '<x:sst><x:si><x:t>p</x:t></x:si>' + '<x:si>'.repeat(200000), 'xl/worksheets/sheet1.xml': `<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row>${'<x:row><x:c'.repeat(300000)}` }))
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`)
  assert.deepEqual(odd.rows[0], ['p'])
  // a wide one: SHEET_CELLS at most, fewer rows
  const [big] = readSheets(book(['Big'], { 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${`<row>${'<c><v>1</v></c>'.repeat(SHEET_COLS)}</row>`.repeat(2000)}</sheetData></worksheet>` }))
  assert.equal(big.cut, true)
  assert.equal(big.rows.length, Math.ceil(SHEET_CELLS / SHEET_COLS) + 1)
  assert.throws(() => readSheets(Buffer.from('PK nothing here at all, not even an end record')), /not a zip/)
})

test("fileRead: an .xlsx's sheets; one it can't read: its size only (a file card)", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const path = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).path
  writeFileSync(join(path, 'data.xlsx'), book(['Data'], { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>hi</t></is></c></row></sheetData></worksheet>' }))
  writeFileSync(join(path, 'bad.xlsx'), 'not a workbook')
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'data.xlsx' }), { size: (await rig.rpc('fileRead', { ws: ws.id, path: 'data.xlsx', stat: true })).size, sheets: [{ name: 'Data', rows: [['hi']] }] })
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'bad.xlsx' }), { size: 14 })
})
