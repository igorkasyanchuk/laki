// laki:// links (links.ts): what each opens
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkWorkspaces, parseLink, wsLink } from '../src/renderer/src/links.ts'

test('links: workspaces, tabs, pages; nothing else', () => {
  assert.deepEqual(parseLink(wsLink('fix-login', 't 1')), { to: 'ws', ws: 'fix-login', tab: 't 1' })
  assert.deepEqual(parseLink('laki://ws/a%2Fb/'), { to: 'ws', ws: 'a/b', tab: undefined })
  assert.deepEqual(parseLink('laki://new?project=app&prompt=fix%20it&preset=codex'), { to: 'new', project: 'app', prompt: 'fix it', preset: 'codex', name: undefined })
  assert.deepEqual(parseLink('laki://schedules/app'), { to: 'schedules', project: 'app' })
  assert.deepEqual(parseLink('laki://schedules'), { to: 'schedules', project: undefined })
  assert.deepEqual(parseLink('laki://settings/remote'), { to: 'settings', section: 'remote' })
  assert.deepEqual(parseLink('laki://settings/widgets/my-prs/inspect'), { to: 'extension', id: 'my-prs', inspect: true })
  assert.deepEqual(parseLink('laki://settings/widgets/my-prs'), { to: 'extension', id: 'my-prs' })
  assert.deepEqual(parseLink('laki://settings/widgets'), { to: 'settings', section: 'widgets' })
  assert.deepEqual(parseLink('laki://help'), { to: 'help' })
  assert.deepEqual(parseLink('laki://about'), { to: 'about' })
  assert.deepEqual(parseLink('laki://onboard'), { to: 'onboard' })
  assert.deepEqual(parseLink('laki://board'), { to: 'board' })
  assert.deepEqual(parseLink('laki://ai'), { to: 'ai' })
  assert.deepEqual(parseLink('laki://Help'), { to: 'help' }) // the host as typed: a non-special scheme keeps its case
  for (const bad of ['laki://ws', 'laki://rm/x', 'https://ws/x', 'laki:ws/x', 'nonsense', 'laki://ws/%E0%A4%A']) {
    const l = parseLink(bad)
    assert.ok(bad.endsWith('%A') ? l?.to === 'ws' : l === null, bad) // a bad escape stays as typed
  }
})

test("links: an AI answer's workspaces in bold become links, once, the longest name first", () => {
  const wss = [{ id: 'w2', name: 'create' }, { id: 'w1', name: 'create-some-dummy-pr' }, { id: 'w3', name: 'a.b' }]
  const link = linkWorkspaces(wss)
  assert.equal(
    link('In **create-some-dummy-pr**, [**create**](laki://ws/x), **create**, **axb**, **a.b**.'),
    'In [**create-some-dummy-pr**](laki://ws/w1), [**create**](laki://ws/x), [**create**](laki://ws/w2), **axb**, [**a.b**](laki://ws/w3).',
  )
  // not inside a link it made, nor code
  assert.equal(link('[see **create** there](https://x.dev) `**create**`\n```\n**create**\n```'), '[see **create** there](https://x.dev) `**create**`\n```\n**create**\n```')
  assert.equal(linkWorkspaces([])('**create**'), '**create**')
})
