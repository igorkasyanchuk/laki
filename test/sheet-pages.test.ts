// test:sheet's pages (src/shared/sheetPages.ts): every one, wide and on the phone, names what must show and what must
// not, so a page added later without a forbidden selector fails npm run check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHEET_PAGES, SHEET_PHONE, sheetSel } from '../src/shared/sheetPages.ts'

test('every sheet page has a selector that must show and one that must not', () => {
  for (const [pages, phone] of [[SHEET_PAGES, false], [SHEET_PHONE, true]] as const)
    for (const p of pages) {
      const s = sheetSel(p, phone)
      assert.ok(s?.want.trim(), `${p}${phone ? ' (phone)' : ''}: no selector that must show`)
      assert.ok(s?.not.trim(), `${p}${phone ? ' (phone)' : ''}: no selector that must not show`)
      assert.notEqual(s!.want, s!.not, p)
    }
  assert.ok(SHEET_PHONE.every(p => (SHEET_PAGES as readonly string[]).includes(p)), 'a phone page is a wide one too')
})

test('Projects and the Reader forbid the Review tab, left open by the page before', () => {
  for (const p of ['projects', 'reader']) for (const phone of [false, true]) assert.match(sheetSel(p, phone)!.not, /\.full-review\b/)
  assert.match(sheetSel('projects', true)!.not, /\.board\b/) // the phone's walk ends on the Board
  assert.equal(sheetSel('nope'), undefined)
})
