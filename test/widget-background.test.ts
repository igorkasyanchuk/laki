// An extension that shows nowhere ("place": "none"): it runs in the background, and an action's JSON says what it has
// as a notification (notify) or the card on screen (alert), from any run: an event, a click, a schedule
import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('none: shows nowhere; an event handler notifies and alerts, the alert naming the extension, 5 a minute; the starter checks out', async t => {
  const rig = await fresh(t)
  mkdirSync(join(rig.data, 'widgets', 'bg'), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', 'bg', 'widget.json'), JSON.stringify({ name: 'Watcher', place: 'none', on: { 'custom.ping': 'say' }, actions: { say: `printf '{"notify": "build broke", "alert": {"title": "Prod", "text": "is down"}}'` } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'bg', on: true })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const w = ((await rig.rpc('state')).widgets ?? []).find((x: any) => x.id === 'bg')
  assert.deepEqual(w.places ?? [w.place], ['none'])
  // with another place, that one; none alone again
  await rig.rpc('widgetSet', { id: 'bg', place: ['none', 'status'] })
  assert.deepEqual(((await rig.rpc('state')).widgets ?? []).find((x: any) => x.id === 'bg').place, 'status')
  await rig.rpc('widgetSet', { id: 'bg', place: 'none' })

  await rig.cli('widget', 'emit', 'ping')
  await until(() => app.events.find((e: any) => e.ev === 'widget-say' && e.widget === 'bg' && e.notify === 'build broke'), 'a notification')
  const alert = await until(() => app.events.find((e: any) => e.ev === 'alert' && e.text === 'is down'), 'the card on screen')
  assert.equal(alert.title, 'Prod')
  assert.equal(alert.origin, 'message from the extension Watcher', "the daemon's line, not the extension's words")
  // 5 alerts a minute from it: the sixth isn't shown (its log says why); notifications each time
  for (let i = 0; i < 5; i++) assert.equal((await rig.rpc('widgetAction', { id: 'bg', action: 'say' })).out, 'build broke', "a click's note: the words, not the JSON")
  await until(() => app.events.filter((e: any) => e.ev === 'widget-say' && e.notify === 'build broke').length === 6, 'six notifications')
  assert.equal(app.events.filter((e: any) => e.ev === 'alert' && e.text === 'is down').length, 5)

  // a title alone is its words, under the extension's name; an odd name's hidden characters and lines never reach the
  // origin line (S10: Laki's words)
  mkdirSync(join(rig.data, 'widgets', 'odd'), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', 'odd', 'widget.json'), JSON.stringify({ name: 'Odd\u202e\nName', place: 'none', actions: { t: `printf '{"alert": {"title": "Only a title"}}'`, n: `printf '{"alert": {"title": "API", "text": 502}}'` } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'odd', on: true })
  await rig.rpc('widgetAction', { id: 'odd', action: 't' })
  const odd = await until(() => app.events.find((e: any) => e.ev === 'alert' && e.text === 'Only a title'), 'the title as its words')
  assert.equal(odd.origin, 'message from the extension Odd Name')
  await rig.rpc('widgetAction', { id: 'odd', action: 'n' })
  assert.equal((await until(() => app.events.find((e: any) => e.ev === 'alert' && e.text === '502'), 'a number as its words')).title, 'API')

  // the starter: nowhere, two handlers, no sample needed
  assert.equal((await rig.cli('widget', 'new', 'My bg', '--kind', 'background')).code, 0)
  const s = ((await rig.rpc('state')).widgets ?? []).find((x: any) => x.id === 'my-bg')
  assert.equal(s.place ?? s.places?.[0], 'none')
  const check = await rig.cli('widget', 'check', 'my-bg')
  assert.doesNotMatch(check.out, /✗|no sample/, check.out)
})
