import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillTemplate, MAIL_OK, nameOf, parseMails, shortPath, templated } from '../src/renderer/src/text.ts'

test('prompt templates: variables, unknown ones kept, a template without {{prompt}} gets it after', () => {
  assert.equal(fillTemplate('Fix {{ prompt }} in {{project}} from {{base}}; {{who}}', { prompt: 'login', project: 'app', base: 'main' }), 'Fix login in app from main; {{who}}')
  assert.equal(fillTemplate('{{constructor}}', {}), '{{constructor}}')
  const fix = { name: 'fix', text: 'Investigate and fix: {{prompt}}\nAdd a test.' }
  assert.equal(templated(fix, 'the redirect'), 'Investigate and fix: the redirect\nAdd a test.')
  assert.equal(templated({ name: 'tests', text: 'Write tests first.' }, 'for parse()'), 'Write tests first.\n\nfor parse()')
  assert.equal(templated(undefined, 'as typed'), 'as typed')
  assert.equal(nameOf('  the cart total rounding is off '), 'the cart total rounding')
  assert.equal(nameOf(' '), undefined)
})

test('short paths for the status bar', () => {
  assert.equal(shortPath('/Users/igor/projects/app'), '~/projects/app')
  assert.equal(shortPath('/Users/igor/.laki/worktrees/app/fix-login'), '~/…/app/fix-login')
  assert.equal(shortPath('/opt/src/a/b/c'), '/…/b/c')
  assert.equal(shortPath('/Users/igor'), '~')
})

test('tunnel emails: whole domains by *@, @ or a bare name; what the daemons take', async () => {
  assert.deepEqual(parseMails(' me@x.dev, *@gmail.com;@team.dev  corp.io me@x.dev'), ['me@x.dev', '*@gmail.com', '*@team.dev', '*@corp.io'])
  for (const m of ['me@x.dev', '*@gmail.com', 'a.b+c@sub.team.dev']) assert.ok(MAIL_OK.test(m), m)
  for (const m of ['me*@x.dev', '*@*.x.dev', '*@localhost', 'a@b.dev,c@d.dev', '@x.dev', 'nope']) assert.ok(!MAIL_OK.test(m), m)
  // the daemon's own check is the same pattern
  const core = (await import('node:fs')).readFileSync(new URL('../src/daemon/core.ts', import.meta.url), 'utf8')
  assert.ok(core.includes(`const MAIL = /${MAIL_OK.source}/`), 'core.ts MAIL differs from text.ts MAIL_OK')
})

test('themes: unique ids, and every look has rules in look.css', async () => {
  const { THEMES } = await import('../src/renderer/src/themes.ts')
  const css = (await import('node:fs')).readFileSync(new URL('../src/renderer/src/look.css', import.meta.url), 'utf8')
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length)
  for (const t of THEMES) if (t.look) assert.ok(css.includes(`[data-look='${t.look}']`), t.look)
})
