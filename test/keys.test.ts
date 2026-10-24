// Settings › Keys (shared/keys.ts): the keys in use over the defaults, a press to its action, what else has a key
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyClash, keyFor, keyLabel, keyMap, keyOk, KEYS, keyShow, overlayKeys } from '../src/shared/keys.ts'

const press = (key: string, code: string, mods: { meta?: boolean; alt?: boolean; ctrl?: boolean; shift?: boolean } = { meta: true }) => ({ key, code, metaKey: !!mods.meta, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift })

test('keys: the defaults, yours over them, none, and nothing that would be typed', () => {
  const d = keyMap()
  assert.equal(Object.keys(d).length, KEYS.length)
  assert.equal(d.palette, '⌘K')
  assert.equal(d.panel, '⌥⌘B')
  assert.deepEqual(keyMap(undefined), d)
  assert.deepEqual(keyMap('nope'), d)
  const m = keyMap({ palette: '⌥⌘K', newWs: '', help: 'K', find: '⇧F', next: 7, back: '⌘', unknown: '⌘Q' })
  assert.equal(m.palette, '⌥⌘K')
  assert.equal(m.newWs, '') // none
  assert.equal(m.help, '⌘/') // a key alone: the default
  assert.equal(m.find, '⌘F') // ⇧ alone doesn't count
  assert.equal(m.next, '⌘J') // not text
  assert.equal(m.back, '⌘[') // modifiers, no key
  assert.equal('unknown' in m, false)
  assert.ok(keyOk('⌃R') && keyOk('⌥X') && keyOk('⇧⌘Enter') && !keyOk('Enter') && !keyOk('⇧A') && !keyOk('') && !keyOk('⌘⌥K'))
})

test('keys: a press is its action, by the character first, then by the key; a rebound one leaves its old keys', () => {
  const d = keyMap()
  assert.equal(keyFor(press('k', 'KeyK'), d), 'palette')
  assert.equal(keyFor(press('K', 'KeyK', { meta: true, shift: true }), d), undefined) // ⇧⌘K isn't ⌘K
  assert.equal(keyFor(press('A', 'KeyA', { meta: true, shift: true }), d), 'artifacts')
  assert.equal(keyFor(press('Enter', 'Enter', { meta: true, shift: true }), d), 'full')
  assert.equal(keyFor(press('∫', 'KeyB', { meta: true, alt: true }), d), 'panel') // ⌥ changes the character: the key counts
  assert.equal(keyFor(press('л', 'KeyK'), d), 'palette') // another alphabet: the key
  assert.equal(keyFor(press('k', 'KeyV'), d), 'palette') // Dvorak's K (where QWERTY has V): the character wins
  assert.equal(keyFor(press('[', 'BracketLeft'), d), 'back')
  assert.equal(keyFor(press(',', 'Comma'), d), 'settings')
  assert.equal(keyFor(press('k', 'KeyK', {}), d), undefined) // typed
  assert.equal(keyFor(press('e', 'KeyE'), d), undefined) // a fixed one: App's own
  const m = keyMap({ palette: '⌥⌘P', newWs: '' })
  assert.equal(keyFor(press('k', 'KeyK'), m), undefined) // the old keys do nothing now
  assert.equal(keyFor(press('π', 'KeyP', { meta: true, alt: true }), m), 'palette')
  assert.equal(keyFor(press('n', 'KeyN'), m), undefined) // none
  assert.equal(keyFor(press('p', 'KeyP'), m), 'files') // ⌘P stays the file finder's
  assert.equal(keyLabel(press(' ', 'Space', { ctrl: true, alt: true })), '⌃⌥Space')
})

test('keys: what else has them', () => {
  const d = keyMap()
  for (const x of KEYS) assert.equal(keyClash(x.id, d), '', x.id) // the defaults clash with nothing
  const m = keyMap({ palette: '⌘P', help: '⌃⌥⌘L', find: '⌘C', next: '⌃R', later: '' })
  assert.equal(keyClash('palette', m), 'Find a file') // another of them
  assert.equal(keyClash('files', m), 'Palette')
  assert.equal(keyClash('help', m), '') // the hotkey's only when given
  assert.equal(keyClash('help', m, [['⌃⌥⌘L', 'the global hotkey']]), 'the global hotkey')
  assert.equal(keyClash('find', m), 'Copy') // a fixed one
  assert.match(keyClash('next', m), /terminal/) // ⌃ alone: the terminal's
  assert.equal(keyClash('later', m), '') // none clashes with nothing
  assert.equal(keyClash('later', keyMap({ later: '', back: '' })), '')
  assert.equal(keyShow('⇧⌘Enter'), '⇧⌘⏎')
  assert.equal(keyShow('⌘ArrowUp'), '⌘↑')
})

test('hold ⌘: a badge for each key whose button is on screen, yours over the default, the rest in the strip', () => {
  const o = overlayKeys({ palette: '⇧⌘P', later: '' }, new Set(['sidebar', 'palette', 'later', 'full']))
  assert.deepEqual(o.badges, { sidebar: '⌘B', palette: '⇧⌘P', full: '⇧⌘⏎' }) // later unbound: no badge
  assert.deepEqual(o.strip.find(([, l]) => l === 'Find a file'), ['⌘P', 'Find a file'])
  assert.ok(!o.strip.some(([, l]) => l === 'Send a message later')) // unbound: not in the strip either
  assert.ok(!o.strip.some(([, l]) => l === 'Palette')) // on screen: a badge, not a strip entry
  assert.equal(o.strip.length, KEYS.length - 4)
})
