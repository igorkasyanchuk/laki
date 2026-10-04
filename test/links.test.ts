// laki:// links (links.ts): what each opens
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLink, wsLink } from '../src/renderer/src/links.ts'

test('links: workspaces, tabs, pages; nothing else', () => {
  assert.deepEqual(parseLink(wsLink('fix-login', 't 1')), { to: 'ws', ws: 'fix-login', tab: 't 1' })
  assert.deepEqual(parseLink('laki://ws/a%2Fb/'), { to: 'ws', ws: 'a/b', tab: undefined })
  assert.deepEqual(parseLink('laki://new?project=app&prompt=fix%20it&preset=codex'), { to: 'new', project: 'app', prompt: 'fix it', preset: 'codex', name: undefined })
  assert.deepEqual(parseLink('laki://schedules/app'), { to: 'schedules', project: 'app' })
  assert.deepEqual(parseLink('laki://schedules'), { to: 'schedules', project: undefined })
  assert.deepEqual(parseLink('laki://settings/remote'), { to: 'settings', section: 'remote' })
  assert.deepEqual(parseLink('laki://help'), { to: 'help' })
  assert.deepEqual(parseLink('laki://Help'), { to: 'help' }) // the host as typed: a non-special scheme keeps its case
  for (const bad of ['laki://ws', 'laki://rm/x', 'https://ws/x', 'laki:ws/x', 'nonsense', 'laki://ws/%E0%A4%A']) {
    const l = parseLink(bad)
    assert.ok(bad.endsWith('%A') ? l?.to === 'ws' : l === null, bad) // a bad escape stays as typed
  }
})
