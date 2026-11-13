import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASIC, FIND, HELP, isBasic, SECTIONS } from '../src/shared/settingsMap.ts'
import { skillTools } from '../src/shared/tools.ts'

test("laki_settings_find: where a setting is, a link that opens it lit, the values its words name; never a private one's", async () => {
  const rpc = async (m: string) => (m === 'state' ? { settings: { copyOnSelect: false, envCopy: 'secret', webhookCopy: { url: 'x' } } } : {})
  const tool = skillTools(rpc as never).find(t => t.name === 'laki_settings_find')!
  const r = (await tool.run({ q: 'copy selected text' })) as { settings: { where: string; link: string }[]; values: Record<string, unknown> }
  assert.deepEqual(r.settings[0], { where: 'Settings › Terminal › Copy selected text', link: 'laki://settings/terminal?spot=Copy%20selected%20text' })
  assert.deepEqual(r.values, { copyOnSelect: false })
  await assert.rejects(Promise.resolve().then(() => tool.run({ q: ' ' })), /what to look for/)
  for (const [sec] of FIND) assert.ok(SECTIONS.some(s => s.id === sec), `${sec}: a section`)
})

test("U10: Basic's four heads name real sections and cards; its settings are FIND's, marked basic by laki_settings_find", async () => {
  const src = ['Settings', 'SettingsAgents', 'SettingsConnect', 'SettingsProject'].map(f => readFileSync(join(import.meta.dirname, `../src/renderer/src/${f}.tsx`), 'utf8')).join('\n')
  assert.deepEqual(BASIC.map(b => b.label), ['Agents', 'Notifications', 'Look', 'Git & PRs'])
  for (const b of BASIC)
    for (const [sec, card] of b.cards) {
      assert.ok(SECTIONS.some(s => s.id === sec), `${b.label}: ${sec} is a section`)
      assert.ok(card === '*' || src.includes(`<Group title="${card}"`), `${b.label}: ${sec} has a card ${card}`)
    }
  const basic = FIND.filter(isBasic)
  assert.ok(basic.length >= 20 && basic.length <= 30, `about 25 basic settings, not ${basic.length}`)
  const rpc = async (m: string) => (m === 'state' ? { settings: {} } : {})
  const tool = skillTools(rpc as never).find(t => t.name === 'laki_settings_find')!
  const r = (await tool.run({ q: 'sync the base branch' })) as { settings: { where: string; basic?: boolean }[] }
  assert.deepEqual([r.settings[0].where, r.settings[0].basic], ['Settings › Git & worktrees › Sync the base branch', true])
  // Appearance in three: Theme & type keeps its id (old links), Layout and Extras are new
  assert.deepEqual(SECTIONS.filter(s => ['appearance', 'layout', 'extras'].includes(s.id)).map(s => s.label), ['Theme & type', 'Layout', 'Extras'])
  assert.deepEqual(['Rail', 'Glass', 'Background image', 'Custom CSS', 'Theme'].map(t => FIND.find(f => f[1] === t)?.[0]), ['layout', 'layout', 'layout', 'extras', undefined]) // the window's glass: under Layout's Design
  // hints: one line; the 20 longest moved their words into a ? card
  const hint = (t: string) => src.match(new RegExp(`<Says title="${t.replace(/[()+]/g, '\\$&')}" hint="([^"]+)"`))?.[1] ?? ''
  for (const t of ['Cloud workspaces (GitHub Codespaces)', 'Review tab', 'Reader view', 'Turns kept', 'Development mode', '+ button']) {
    assert.ok(hint(t) && hint(t).length <= 90, `${t}: a one-line hint`)
    assert.ok(HELP[t]?.what && HELP[t].when && HELP[t].cost, `${t}: a ? card`)
  }
})
