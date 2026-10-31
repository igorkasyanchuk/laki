import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FIND, SECTIONS } from '../src/shared/settingsMap.ts'
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
