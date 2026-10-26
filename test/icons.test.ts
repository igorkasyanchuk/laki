import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PACKS } from '../src/shared/iconPacks.ts'
import { ICONS, iconLook, iconOf, iconSvg, iconTurns, lookOf, setIconLook } from '../src/shared/icons.ts'

test('icon packs: a look from settings, Tabler by default, a bad value its default', () => {
  assert.deepEqual(lookOf(), { pack: 'tabler', width: 2, size: 14 })
  assert.deepEqual(lookOf({ iconPack: 'lucide', iconWidth: 1.5, iconSize: 18 }), { pack: 'lucide', width: 1.5, size: 18 })
  assert.deepEqual(lookOf({ iconPack: 'feather', iconWidth: 7, iconSize: 3 }), { pack: 'tabler', width: 2, size: 14 })
})

test('icon packs: only Laki names, only shapes; a name a pack lacks is drawn by Laki own', () => {
  for (const [pack, icons] of Object.entries(PACKS))
    for (const [name, inner] of Object.entries(icons)) {
      assert.ok(name in ICONS, `${pack}: ${name} isn't a Laki icon`)
      // what goes into the page as markup: shapes with geometry only (scripts/icon-packs.ts checks it as it writes)
      assert.match(inner, /^(<(path|circle|rect|line|polyline|polygon|ellipse)( (d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|width|height|fill|stroke)="[^"<>'&]*")*\/>)+$/, `${pack}: ${name}`)
    }
  assert.equal(Object.keys(PACKS.tabler).length, Object.keys(ICONS).length) // Tabler has every one
  const t = iconOf('github', lookOf({ iconPack: 'tabler' }))
  assert.equal(t.box, 24)
  assert.equal(t.inner, PACKS.tabler.github)
  const l = iconOf('github', lookOf({ iconPack: 'lucide' })) // Lucide has no brands
  assert.deepEqual([l.box, l.fill, l.inner], [16, true, `<path d="${ICONS.github}"/>`])
  // the width as at a 24 grid: Laki's 1.4 at 16 is its 2
  assert.equal(iconOf('plus', lookOf({ iconPack: 'laki', iconWidth: 1 })).sw, 0.7)
  assert.equal(iconOf('more', lookOf({ iconPack: 'laki' })).sw, 2.4)
  assert.equal(iconOf('plus', lookOf({ iconPack: 'lucide', iconWidth: 1.5 })).sw, 1.5)
})

test('icon packs: iconSvg draws the look set; a change counts once', async () => {
  const was = iconLook()
  const n = iconTurns()
  setIconLook(lookOf({ iconPack: 'lucide', iconWidth: 1.25 }))
  setIconLook(lookOf({ iconPack: 'lucide', iconWidth: 1.25 })) // the same: no change
  assert.equal(iconTurns(), n + 1)
  const svg = iconSvg('x', 12)
  assert.match(svg, /viewBox="0 0 24 24"/)
  assert.match(svg, /stroke-width="1.25"/)
  assert.ok(svg.includes(PACKS.lucide.x))
  assert.match(iconSvg('x', 12, lookOf({ iconPack: 'laki' })), /viewBox="0 0 16 16"/)
  setIconLook(was)
})
