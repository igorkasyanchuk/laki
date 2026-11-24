// npm run test:ui and test:sheet (--laki-smoke=<dir>, main's uiSmoke): the real window walked page by page, then the
// risky flows, each step waited for and screenshotted; index.ts starts it once the window has loaded
import { app, BrowserWindow, nativeImage } from 'electron'
import { card, floater, floats, pinGo, pinned, setFront, talk, talkW } from './floater.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pixelDiff } from '../shared/pixelDiff.ts'
import { SHEET_PAGES, SHEET_PHONE, sheetSel } from '../shared/sheetPages.ts'
import { rpc } from '../shared/conn.ts'
import { spawnSync } from 'node:child_process'
import type { View } from '../shared/types.ts'
import { openLink, panelW, quickW, RENDERER, tellWith } from './index.ts'

// R8 --laki-smoke=<dir> (npm run test:ui): the real window walked page by page. Each step opens a page (its laki://
// link, a click, a key), waits for something only that page draws, and fails on ui.tsx' Boundary (.boom) or an error
// in the console; a screenshot each, result.json at the end, then the app quits (1: a step failed)

// test:sheet: a picture against the last run's (scripts/ui-sheet.ts' LAKI_SHEET_PREV, its folder): the share of its
// pixels that changed (shared/pixelDiff.ts), both read back from their files (one scale), or new
function sheetDiff(png: string, name: string): { diff?: number; new?: true } {
  const prev = process.env.LAKI_SHEET_PREV ? join(process.env.LAKI_SHEET_PREV, `${name}.png`) : ''
  if (!prev || !existsSync(prev)) return { new: true }
  const [a, b] = [nativeImage.createFromPath(png), nativeImage.createFromPath(prev)]
  const [sa, sb] = [a.getSize(), b.getSize()]
  return { diff: pixelDiff(a.toBitmap(), sa.width, sa.height, b.toBitmap(), sb.width, sb.height) }
}

export async function uiSmoke(w: BrowserWindow, dir: string) {
  mkdirSync(dir, { recursive: true })
  const errors: string[] = []
  // V13: no view transitions in a smoke run (ui.tsx morph): its waits see each page as it lands; marked on every load
  const mark = () => void w.webContents.executeJavaScript("document.documentElement.dataset.smoke = ''").catch(() => {})
  w.webContents.on('dom-ready', mark)
  mark()
  w.webContents.on('console-message', (_e, level, message) => void (level >= 3 && !/^Loading the image 'https:\/\/pics\.invalid\/.*Content Security Policy/.test(message) && errors.push(message))) // S18: view-as-page's outside picture, blocked on purpose
  const js = <T>(code: string) => w.webContents.executeJavaScript(code, true) as Promise<T>
  const has = (sel: string) => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = (sel: string) => () => js(`document.querySelector(${JSON.stringify(sel)})?.click()`)
  const link = (url: string) => async () => w.webContents.send('deep-link', url)
  const key = (k: string, meta = false) => () => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, metaKey: ${meta}, bubbles: true, cancelable: true }))`)
  // E3's flows: what you'd do, by its words (a menu's item, a dialog's button), a right click where you'd make one
  const q = JSON.stringify
  const hasText = (sel: string, words: string) => js<boolean>(`[...document.querySelectorAll(${q(sel)})].some(e => e.textContent.includes(${q(words)}))`)
  const clickText = (sel: string, words: string) => js(`[...document.querySelectorAll(${q(sel)})].find(e => e.textContent.includes(${q(words)}))?.click()`)
  const ctx = (sel: string) => js(`(e => e && e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: e.getBoundingClientRect().x + 12, clientY: e.getBoundingClientRect().y + 6 })))(document.querySelector(${q(sel)}))`)
  const typeIn = (sel: string, text: string) => js(`(e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${q(text)}); e.dispatchEvent(new Event('input', { bubbles: true })) })(document.querySelector(${q(sel)}))`)
  const nap = (ms: number) => new Promise(r => setTimeout(r, ms))
  // U2: two elements both drawn and apart (their boxes don't meet)
  const apart = (a: string, b: string) => js<boolean>(`(() => { const [x, y] = [${q(a)}, ${q(b)}].map(s => document.querySelector(s)?.getBoundingClientRect()); return !!x && !!y && x.width > 0 && y.width > 0 && (x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top) })()`)
  const waitFor = async (f: () => Promise<unknown>, what: string, ms = 8000) => {
    for (const at = Date.now(); !(await f()); await nap(100)) if (Date.now() - at > ms) throw new Error(`no ${what} after ${ms / 1000} s`)
  }
  const pick = async (sel: string, item: string) => (await waitFor(() => has(sel), sel), await ctx(sel), await waitFor(() => hasText('.menu-item', item), `${item} in the menu`), await clickText('.menu-item', item))
  const answer = async (button: string) => (await waitFor(() => hasText('.ask-box button', button), `the dialog's ${button}`), await clickText('.ask-box button', button))
  const named = async (n: string) => (await rpc<View>('state')).workspaces.find(x => x.name === n || x.id === n)!
  const row = (id: string) => `[data-row="ws:${id}"]`
  // a fake claude's tab up: its banner (the demo's scripted one, test/fakes/script.cjs, or the echo)
  const claudeUp = (id: string) => waitFor(async () => /fake claude|Welcome to Claude Code/.test(await rpc<string>('screen', { target: id, lines: 10 })), 'its claude started', 15000)
  const fakeLog = () => (f => (existsSync(f) ? readFileSync(f, 'utf8') : ''))(join(process.env.HOME ?? '', 'fake.log'))
  const ws: Record<string, View['workspaces'][number]> = {}
  let before = 0 // the quick bar's step: workspaces before it sends
  const cart = () => readFileSync(join(ws.cart.path, 'src/cart.js'), 'utf8')
  const checkout = () => join(ws.co.path, 'src/checkout.js')
  const steps: [string, (() => Promise<unknown>) | null, string | (() => Promise<boolean>)][] = [
    // a row's words all or nothing: none visible shows under 8 characters before its ellipsis (styles.css .need-row-line)
    ['projects', null, async () => (await has('.sidebar .ws')) && js<boolean>("[...document.querySelectorAll('.need-row-last')].every(e => { const box = e.closest('.need-row-line')?.getBoundingClientRect(); const r = e.getBoundingClientRect(); return !box || !r.width || r.top >= box.bottom - 1 || e.scrollWidth <= e.clientWidth || e.clientWidth / (e.scrollWidth / e.textContent.length) >= 8 })")],
    ['switch-apart', null, () => apart('.reader-switch', '.pane.active .xterm-screen')], // U2: Terminal | Reader off the terminal's lines
    ['reader', click('.reader-switch button:last-child'), '.reader'],
    // the AI button: in the status bar by default; floated again from its right click, it's off the Reader's Send (U2);
    // its – puts it back
    ['fab-apart', () => pick('.sb-ai', 'Float the button again'), () => apart('.ai-fab', '.rd-box button.primary')],
    ['fab-dock', click('.ai-fab-min'), '.sb-ai'],
    ['review', click('.review-tab'), '.full-review'],
    // T18: two columns (its key's event) once the diff has 900px (the files and the comments folded away): each changed
    // line's row has an old and a new cell; then one again
    ['review-split', async () => {
      await click('.full-review button[aria-label="Hide the files"]')()
      await click('.full-review button[aria-label="Hide the comments"]')()
      await js("localStorage.getItem('laki.diffSplit') === 'split' || window.dispatchEvent(new CustomEvent('laki-diff-split'))")
    }, () => js<boolean>("(c => c.length > 0 && c.some(e => e.dataset.side === 'old') && c.some(e => e.dataset.side === 'new'))([...document.querySelectorAll('.full-review .sp-diff.split [data-side]')])")],
    ['review-unsplit', async () => {
      await js("window.dispatchEvent(new CustomEvent('laki-diff-split'))")
      await js("document.querySelectorAll('.full-review .fr-strip').forEach(b => b.click())") // the files and the comments back (each fold is remembered)
    }, async () => !(await has('.full-review .sp-diff.split')) && (await has('.full-review .sp-row'))],
    ['new-workspace', link('laki://new'), '.nw-composer'],
    ['settings', link('laki://settings'), '.settings-page .settings-nav > button.on'], // its content, not the page's frame: Settings loads as it opens (E8)
    // U10: Basic shows four heads, each only its cards (Look: Theme first); All again; Layout by its link
    ['settings-basic', async () => { await waitFor(() => has('.settings-view button'), 'Basic | All'); await clickText('.settings-view button', 'Basic'); await waitFor(() => hasText('.settings-nav button', 'Git & PRs'), 'the Basic heads'); await clickText('.settings-nav button', 'Look') }, async () => (await has('.settings-main[data-basic]')) && (await js<string>("document.querySelector('.settings-main .set-group h3')?.textContent ?? ''")) === 'Theme' && !(await hasText('.settings-main h3', 'Rail'))],
    ['settings-layout', async () => (await clickText('.settings-view button', 'All'), await link('laki://settings/layout?spot=Rail')()), async () => !(await has('.settings-main[data-basic]')) && (await hasText('.settings-main h2', 'Layout')) && (await hasText('.settings-main h3', 'Rail'))],
    // All's list is taller than the window: it scrolls, no row squeezed under its text
    ['settings-rows', null, () => js<boolean>(`[...document.querySelectorAll('.settings-nav > button')].every(b => b.scrollHeight <= b.clientHeight + 1)`)],
    // Terminal › Shell: the daemon's list came (the login shell first, Another path… last)
    ['settings-shell', link('laki://settings/terminal?spot=Shell'), () => js<boolean>(`[...document.querySelectorAll('.settings-main select')].some(s => s.options[0]?.textContent.startsWith('Your login shell') && s.options[s.options.length - 1].value === '…')`)],
    // Settings › Notifications: an old link to a setting General held lands there, its table drawn (6 rows and more)
    ['settings-notify', link('laki://settings/general?spot=Quiet'), async () => (await hasText('.settings-nav > button.on', 'Notifications')) && (await js<number>("document.querySelectorAll('.nt-table tbody tr').length")) >= 6],
    ['board', link('laki://board'), '.board'],
    // behind a rail page the sidebar is hidden but keeps its box (its scroll with it), the main area over it
    ['board-sidebar', null, () => js<boolean>(`(([s, m]) => getComputedStyle(s).visibility === 'hidden' && s.getBoundingClientRect().width > 0 && Math.abs(s.getBoundingClientRect().height - m.getBoundingClientRect().height) < 2 && m.getBoundingClientRect().left < s.getBoundingClientRect().right)([document.querySelector('.sidebar'), document.querySelector('.main')])`)],
    ['schedule', link('laki://schedules'), '.sched-empty, .sched-row, .ghosts'],
    ['ai', link('laki://ai'), '.ai-page'],
    ['workflows', click('[data-rail="workflows"]'), '.wf-page, .sched-empty'],
    // place more: an extension's item in the foot's ⋯ menu, with Video, Meme and Timer (ui-smoke.ts' Docs)
    ['more-menu', click('.foot-more'), () => hasText('.menu-item', 'Docs')],
    ['palette', async () => (await key('Escape')(), await key('k', true)()), '.palette-input'],
    // F5: the Preview of a workspace's dev server (localhost) has Pick; then the side panel shut again
    ['preview-pick', async () => {
      await key('Escape')()
      await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))")
      await waitFor(() => has('[role=tab][aria-label="Preview"]'), 'the Preview tab')
      await click('[role=tab][aria-label="Preview"]')()
    }, '.web-tools .web-pick-btn'],
    // L5: the side panel moved to its own window (its head's button): this window's panel goes, that one shows the
    // workspace's Changes (the app window's facts over BroadcastChannel); closed, the panel is back here
    ['panel-window', async () => {
      await click('.side-panel button[aria-label="Move to its own window"]')()
      const p = <T>(code: string) => (panelW && !panelW.isDestroyed() ? (panelW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => p<boolean>("!!document.querySelector('.panel-window .side-panel [role=tab][aria-selected=true]')"), 'the panel in its own window', 15000)
      await p("document.querySelector('.panel-window [role=tab][aria-label=\"Changes\"]')?.click()")
      await waitFor(() => p<boolean>("!!document.querySelector('.panel-window .side-panel :is(.sp-row, .sp-change)')"), "its Changes' files", 15000)
      await nap(500) // its page's fade in
      if (panelW && !panelW.isDestroyed()) writeFileSync(join(dir, 'panel-window.png'), (await panelW.webContents.capturePage()).toPNG())
    }, async () => !(await has('.side-panel'))],
    ['panel-back', async () => panelW?.close(), async () => (!panelW || panelW.isDestroyed()) && (await has('.side-panel'))],
    ['preview-shut', () => js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))"), async () => !(await has('.web-tools'))],
    // V9: behind another app the accent's fills and the picked row go neutral (the status colors don't); then back
    ['inactive', async () => (await key('Escape')(), w.webContents.send('front', false)), () => js<boolean>("document.documentElement.classList.contains('away') && getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim() !== getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")],
    ['active', async () => w.webContents.send('front', true), () => js<boolean>("!document.documentElement.classList.contains('away')")],
    // Q1: the quick bar (its laki:// link), a line typed and sent: a new workspace in the demo's project, the bar gone
    ['quick-bar', async () => {
      before = (await rpc<View>('state')).workspaces.filter(x => !x.archived).length
      openLink('laki://quick')
      const q = <T>(code: string) => (quickW && !quickW.isDestroyed() ? (quickW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => q<boolean>("!!document.querySelector('.quick-bar textarea') && !!document.querySelector('.quick-chip')?.textContent.includes('New workspace in')"), 'the quick bar')
      await q(`(e => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, 'Add a dark mode toggle'); e.dispatchEvent(new Event('input', { bubbles: true })) })(document.querySelector('.quick-bar textarea'))`)
      await nap(200)
      if (quickW && !quickW.isDestroyed()) writeFileSync(join(dir, 'quick-bar-window.png'), (await quickW.webContents.capturePage()).toPNG()) // its own window: the main one's screenshot doesn't have it
      await q("document.querySelector('.quick-bar button.primary').click()")
    }, async () => (!quickW || quickW.isDestroyed()) && (await rpc<View>('state')).workspaces.filter(x => !x.archived).length === before + 1],
    // Q7: show and tell, its screencapture skipped (a stub picture: the app's icon): the quick bar with the picture in
    // it and its hint, then Esc drops both
    ['show-and-tell', async () => {
      tellWith(readFileSync(join(RENDERER, 'icon-192.png')).toString('base64'))
      const q = <T>(code: string) => (quickW && !quickW.isDestroyed() ? (quickW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => q<boolean>("!!document.querySelector('.quick-bar .prompt-image img') && !!document.querySelector('.quick-tell')"), 'the picture in the quick bar')
      if (quickW && !quickW.isDestroyed()) writeFileSync(join(dir, 'show-and-tell-window.png'), (await quickW.webContents.capturePage()).toPNG())
      await q("document.querySelector('.quick-bar textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    }, async () => !quickW || quickW.isDestroyed()],
    // Q2: the talk key's pill at the pointer (no microphone opened in a smoke run): recording, who gets it; Esc drops it
    ['talk-pill', async () => {
      talk()
      const t = <T>(code: string) => (talkW && !talkW.isDestroyed() ? (talkW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => t<boolean>("!!document.querySelector('#talk.rec') && document.querySelector('.t-to').textContent.startsWith('→ ')"), 'the talk pill recording')
      if (talkW && !talkW.isDestroyed()) writeFileSync(join(dir, 'talk-pill-window.png'), (await talkW.webContents.capturePage()).toPNG())
      await t("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    }, async () => !talkW || talkW.isDestroyed()],
    // U3: Get started never opened by itself; its bar opens it: the loop's five steps, the rest folded under Explore more
    ['get-started', async () => (await key('Escape')(), await click('.onboard-bar')()), async () => (await js<number>("document.querySelectorAll('.onboard > .ob-steps > .ob-step').length")) === 5 && (await has('.ob-more-head'))],
    // (a) archive with an uncommitted file: the dialog names it; (b) archived, then Undo brings it back
    ['flow-archive-asks', async () => {
      ws.dark = await named('dark-mode')
      writeFileSync(join(ws.dark.path, 'notes.txt'), 'mine\n')
      await pick(row(ws.dark.id), 'Archive workspace')
    }, () => hasText('.ask-box', 'notes.txt')],
    ['flow-archived', () => answer('Archive'), async () => (await has('.toast-undo')) && !(await has(row(ws.dark.id)))],
    ['flow-archive-undo', click('.toast-undo'), async () => (await has(row(ws.dark.id))) && !(await named('dark-mode')).archived && (await nap(1000), !(await has(`${row(ws.dark.id)} [data-fx]`)))], // V7b: its mark's effect gone after a second
    // (c) the Review tab: a file reverted, then Undo
    ['flow-revert', async () => {
      ws.cart = await named('fix-cart-total')
      await click(row(ws.cart.id))()
      if (!(await has('.full-review'))) await click('.review-tab')()
      await pick('.full-review .sp-row[data-tip^="src/cart.js "]', 'Revert this file')
      await answer('Revert')
    }, async () => (await has('.toast-undo')) && !cart().includes('Math.round')],
    ['flow-revert-undo', click('.toast-undo'), async () => cart().includes('Math.round')],
    // (d) F1: a kept turn (one made here when the demo's agent kept none), rewound, then the rewind undone
    ['flow-rewind', async () => {
      if (await has('.full-review')) await click('.review-tab')()
      ws.co = await named('checkout-flow')
      await click(row(ws.co.id))()
      const tab = (await rpc<View>('state')).tabs.find(t => t.workspace === ws.co.id && t.kind === 'agent')!
      if (!(await rpc<unknown[]>('turnList', { tab: tab.id })).length) {
        await rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'add pay()' } }) // a turn as claude's hooks say it
        await nap(300)
        writeFileSync(checkout(), 'export const pay = () => true\n')
        await rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
        await waitFor(async () => (await rpc<unknown[]>('turnList', { tab: tab.id })).length, 'a kept turn')
      }
      await waitFor(() => has('.sb-turns'), "its Turns in the status bar")
      await click('.sb-turns')()
      await waitFor(() => hasText('.menu-item', '#'), 'its turns, newest first')
      await js(`document.querySelector('.menu-item')?.click()`) // the newest: its actions beside
      await waitFor(() => hasText('.menu-item', 'Rewind files'), 'Rewind in its menu')
      await clickText('.menu-item', 'Rewind files')
      await answer('Rewind')
    }, async () => !existsSync(checkout()) && (await rpc<{ rewind?: boolean }[]>('turnList', { tab: (await rpc<View>('state')).tabs.find(t => t.workspace === ws.co.id && t.kind === 'agent')!.id })).some(t => t.rewind)],
    ['flow-rewind-undo', async () => {
      await click('.sb-turns')()
      await waitFor(() => hasText('.menu-item', '· rewind'), 'the rewind, newest')
      await clickText('.menu-item', '· rewind')
      await waitFor(() => hasText('.menu-item', 'Undo this rewind'), 'Undo in its menu')
      await clickText('.menu-item', 'Undo this rewind')
      await answer('Undo the rewind')
    }, async () => existsSync(checkout())],
    // (e) a green PR merged from ⌘K: the fake gh's log has the merge
    ['flow-merge', async () => {
      const w = await named('checkout-flow')
      writeFileSync(join(process.env.HOME ?? '', 'gh', `pr-${w.branch!.replace(/\//g, '_')}.json`), JSON.stringify({ number: 63, state: 'OPEN', url: 'https://github.com/acme/shop/pull/63', title: 'One-page checkout', author: { login: 'ann' }, isDraft: false, headRefOid: 'fed321', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviews: [], body: '', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }))
      await rpc('prRefresh', {}).catch(() => {})
      await waitFor(async () => (await named('checkout-flow')).pr?.checks === 'pass', 'its PR green', 20000)
      await click(row(w.id))()
      await key('k', true)()
      await waitFor(() => has('.palette-input'), 'the palette')
      await typeIn('.palette-input', 'Merge')
      await waitFor(() => hasText('.palette-item', 'Merge #63'), 'Merge #63 in ⌘K')
      await clickText('.palette-item', 'Merge #63')
      await answer('Squash and merge')
    }, async () => /gh pr merge/.test(fakeLog())],
    // U8: two agents ask to run npm test: Needs you's Allow all lists it once with both names, then answers both
    ['allow-all-asks', async () => {
      await key('Escape')()
      const v = await rpc<View>('state')
      const ids = ['fix-cart-total', 'checkout-flow'].map(n => v.workspaces.find(x => x.name === n || x.id === n)!.id)
      // a claude tab of its own in each (the demo's have prompts of their own going in), started before it's asked
      const agents = await Promise.all(ids.map(id => rpc<{ id: string }>('tabNew', { ws: id, preset: 'claude' }).then(t => t.id)))
      for (const id of agents) await claudeUp(id)
      for (const id of agents) await rpc('send', { target: id, text: 'perm bash :: npm test' })
      await waitFor(() => hasText('.needs-allow-all', 'Allow all (2)'), 'Allow all (2) in Needs you')
      await click('.needs-allow-all')()
      await waitFor(() => has('.ask-box'), 'its confirm')
    }, async () => (await js<number>(`[...document.querySelectorAll('.ask-box *')].filter(e => !e.children.length && e.textContent.trim() === 'Bash: npm test').length`)) === 1 && (await hasText('.ask-box', 'fix-cart-total')) && (await hasText('.ask-box', 'checkout-flow'))],
    ['allow-all-answered', () => answer('Allow all (2)'), async () => !(await rpc<View>('state')).tabs.some(t => t.status === 'waiting' && t.ask?.what === 'npm test')],
    // Q4: a waiting agent answered from its edge bubble: the bubbles shown (Laki behind another app), its circle's click
    // (main's pinGo, as floater-click: a synthetic pointer can't capture), the pinned card's first option
    ['bubble-answer', async () => {
      const v = await rpc<View>('state')
      const id = v.workspaces.find(x => x.name === 'checkout-flow' || x.id === 'checkout-flow')!.id
      const t = (await rpc<{ id: string }>('tabNew', { ws: id, preset: 'claude' })).id
      await claudeUp(t)
      await rpc('send', { target: t, text: 'perm bash :: npm run lint' })
      await waitFor(async () => floats.items.some(x => x.tab === t && x.status === 'waiting'), 'its bubble waiting')
      setFront(false)
      await waitFor(async () => !!card && !card.isDestroyed(), 'the card window')
      await nap(300)
      pinGo({ kind: 'click', tab: t, waiting: true })
      const c = <T>(code: string) => (card && !card.isDestroyed() ? (card.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => c<boolean>("!!document.querySelector('#card.pinned [data-n]') && document.querySelector('#card.pinned .pin-what').textContent.includes('npm run lint')"), 'the pinned card with its options')
      writeFileSync(join(dir, 'bubble-answer-window.png'), (await card!.webContents.capturePage()).toPNG())
      await c("document.querySelector('#card.pinned [data-n]').click()")
      ws.answered = { id: t } as View['workspaces'][number]
    }, async () => !(await rpc<View>('state')).tabs.some(t => t.id === ws.answered.id && t.status === 'waiting') && !pinned.tab],
    // Q9: text and a picture (a synthetic DataTransfer: no file of its own, so it's saved) dropped on that circle: its
    // card pins with them, a line said, ⏎: the agent's terminal has it
    ['bubble-drop', async () => {
      const t = ws.answered.id
      await waitFor(async () => floats.items.some(x => x.tab === t) && !!floater && !floater.isDestroyed(), 'its bubble')
      const b = <T>(code: string) => (floater && !floater.isDestroyed() ? (floater.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => b<boolean>(`!!document.querySelector('.fl-dot[data-tab="${t}"]')`), 'its circle')
      const png = readFileSync(join(RENDERER, 'icon-192.png')).toString('base64')
      await b(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'see the header'); dt.items.add(new File([Uint8Array.from(atob(${q(png)}), c => c.charCodeAt(0))], 'shot.png', { type: 'image/png' })); const el = document.querySelector('.fl-dot[data-tab="${t}"]'); el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) })()`)
      const c = <T>(code: string) => (card && !card.isDestroyed() ? (card.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => c<boolean>("!!document.querySelector('#card.pinned .drop-what .mono')"), 'the card with what was dropped')
      writeFileSync(join(dir, 'bubble-drop-window.png'), (await card!.webContents.capturePage()).toPNG())
      await c(`(e => { e.value = 'make it like this'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })(document.querySelector('#card.pinned input'))`)
    }, async () => !pinned.tab && (await rpc<string>('screen', { target: ws.answered.id, lines: 30 })).includes('make it like this')],
    ['bubble-front', async () => setFront(true), async () => !floater?.isVisible()],
    // U5: the Ship sheet on dark-mode (notes.txt uncommitted, its PR #42 open): its file with a box, the PR's title
    // drafted, Push to PR (the main button follows the PR)
    ['ship-sheet', async () => {
      await key('Escape')()
      await click(row(ws.dark.id))()
      await waitFor(() => has('.tabbar [aria-label^="Ship:"]'), 'the Ship button')
      await click('.tabbar [aria-label^="Ship:"]')()
    }, async () => (await hasText('.ship-file', 'notes.txt')) && (await js<string>("document.querySelector('.ship-form input')?.value ?? ''")) !== '' && (await hasText('.ship button.primary', 'Push to PR'))],
    // Ship's Update from <base>: dark-mode one commit behind main (an empty commit on main, the stat scan's ↓1), the
    // button's merge, the banner up to date with main again, the sheet still open
    ['ship-behind', async () => {
      const repo = (await rpc<View>('state')).projects.find(p => p.id === ws.dark.project)!.path
      const r = spawnSync('git', ['-C', repo, '-c', 'user.name=Laki', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-qm', 'On main meanwhile'], { encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git commit on main: ${r.stderr}`)
      await waitFor(async () => (await named('dark-mode')).stat?.behind === 1, 'dark-mode 1 behind main', 30000) // the stat scan's 10 s: in the act, not the check's 8
    }, async () => (await named('dark-mode')).stat?.behind === 1],
    ['ship-update', async () => {
      // the sheet opened again (the bubble steps' tab focus can close the last one meanwhile)
      await key('Escape')()
      await click(row(ws.dark.id))()
      await waitFor(() => has('.tabbar [aria-label^="Ship:"]'), 'the Ship button')
      await click('.tabbar [aria-label^="Ship:"]')()
      await waitFor(() => has('.ship-update'), 'Update from main in the banner')
      await click('.ship-update')()
    }, async () => (await hasText('.ship-banner', 'up to date with')) && (await has('.ship-file'))],
    // U11: the sidebar from the keyboard: its one tab stop, ↓ to another workspace's row, Enter opens it
    ['tree-keys', async () => {
      await key('Escape')()
      const press = async (keyCode: string) => (w.webContents.sendInputEvent({ type: 'keyDown', keyCode }), w.webContents.sendInputEvent({ type: 'keyUp', keyCode }), await nap(60))
      if ((await js<number>("document.querySelectorAll('.side-scroll [role=treeitem][tabindex=\"0\"]').length")) !== 1) throw new Error('not one tab stop in the tree')
      await js("document.querySelector('.side-scroll [role=treeitem][tabindex=\"0\"]').focus()")
      for (let i = 0; i < 12 && !(await js<boolean>("(e => !!e && e.matches('.ws[data-row]:not(.sel)'))(document.activeElement)")); i++) await press('Down')
      ws.keyed = (await named((await js<string>("document.activeElement?.dataset.row ?? ''")).slice(3)))
      await press('Enter')
    }, async () => !!ws.keyed && (await has(`.ws.sel${row(ws.keyed.id)}`))],
    // U13: What's new after an update (seenVersion another version's): the card with this version's lines and All
    // changes; closed, it's seen: gone, and not back after a reload
    ['whats-new', async () => (await key('Escape')(), await rpc('settingsSet', { seenVersion: '0.0.1' })), async () => (await has('.whats-new li')) && (await hasText('.whats-new button', 'All changes'))],
    ['whats-new-once', async () => {
      await click('.whats-new header button')()
      await waitFor(async () => (await rpc<View>('state')).settings.seenVersion !== '0.0.1', 'seenVersion set')
      w.webContents.reload()
      await nap(1500)
      await waitFor(() => has('.sidebar, .welcome'), 'the window again')
    }, async () => !(await has('.whats-new'))],
    // View as page: a changed HTML file of the worktree by its 🌐 in Changes: the sandboxed frame from GET /worktree,
    // its CSS and script beside it loaded (asked of the frame's own document); Back closes it
    ['view-as-page', async () => {
      await key('Escape')()
      const d = await named('dark-mode')
      mkdirSync(join(d.path, 'emails'), { recursive: true })
      writeFileSync(join(d.path, 'emails/mail.css'), 'body { font: 16px sans-serif; padding: 40px } h1 { color: rgb(1, 2, 3) }')
      writeFileSync(join(d.path, 'emails/mail.js'), 'document.title = "ran"; document.querySelector("p").textContent = "Its script ran."')
      writeFileSync(join(d.path, 'emails/welcome.html'), '<link rel="stylesheet" href="mail.css"><h1>Welcome to Shop</h1><p></p><script src="mail.js"></script><img src="https://pics.invalid/hero.png" alt="">')
      writeFileSync(join(d.path, 'PLAN.md'), '# Dark mode plan\n\n## Goals\n\nShip it.\n\n### Colors\n\nTokens first.\n\n<h2>Rollout</h2>\n\nBehind a flag.\n')
      await click(row(d.id))()
      if (!(await has('[role=tab][aria-label="Changes"]'))) await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))")
      await waitFor(() => has('[role=tab][aria-label="Changes"]'), 'the side panel')
      await click('[role=tab][aria-label="Changes"]')()
      await waitFor(() => has('.sp-change button[aria-label^="View as page"]'), 'its View as page', 15000)
      await click('.sp-change button[aria-label^="View as page"]')()
      await waitFor(() => has('iframe.art-frame[src*="/worktree/"]'), 'the frame')
    }, async () => {
      const f = w.webContents.mainFrame.framesInSubtree.find(f => f.url.includes('/worktree/'))
      return !!f && (await hasText('.modal button', 'Reload')) && (await f.executeJavaScript('document.title === "ran" && getComputedStyle(document.querySelector("h1")).color === "rgb(1, 2, 3)"').then(Boolean, () => false)) && (await hasText('.art-hosts', 'pics.invalid (1 image)')) // S18: its outside picture blocked, the bar says so
    }],
    // S18: Allow for this report: the bar gone, the page loaded again with the host (.invalid: no request leaves)
    ['art-allow', () => clickText('.art-hosts button', 'Allow for this report'), async () => !(await has('.art-hosts')) && (await has('iframe.art-frame[src*="/worktree/"]'))],
    ['view-as-page-back', () => clickText('.modal button', 'Back'), async () => !(await has('iframe.art-frame'))],
    // Outline: a Markdown file in Files, its headings under Go to heading…, a raw <h2> among them
    ['outline', async () => {
      await click('[role=tab][aria-label="Files"]')()
      await waitFor(() => hasText('.side-panel *', 'PLAN.md'), 'PLAN.md in Files', 15000)
      await js(`[...document.querySelectorAll('.side-panel *')].find(e => !e.children.length && e.textContent.trim() === 'PLAN.md')?.click()`)
      await waitFor(() => hasText('.pv-head button', 'Outline'), 'its Outline')
      await clickText('.pv-head button', 'Outline')
    }, async () => (await has('.menu .menu-filter')) && (await hasText('.menu-item', 'Rollout')) && (await hasText('.menu-item', 'Colors'))],
    // the tab bar's overflow: a workspace with 9 tabs in a 1000px window shows +n, and the selected tab among the shown
    ['tab-overflow', async () => {
      const w = await named('checkout-flow')
      for (let i = 0; i < 8; i++) await rpc('tabNew', { ws: w.id, preset: 'shell' })
      await link(`laki://ws/${w.id}`)()
      await size(1000, 800)
    }, async () => (await has('.tab-list > .tab-more')) && (await has('.tab-list > .tab.sel'))],
    ['tab-overflow-off', () => size(1440, 900), '.tab-list'],
    // the phone (390×844): its bottom bar (five columns, each a finger's size, one lit, at the very bottom), nothing wider
    // than the screen; Projects opens the drawer over the whole width (the main area inert) with Needs you's counts, Esc
    // closes it; More's sheet has the rest and Quiet, Esc closes it
    ['phone-bar', async () => (await size(390, 844), await waitFor(() => has('.app.narrow .phone-bar'), 'the bottom bar')), () => js<boolean>("(() => { const bs = [...document.querySelectorAll('.phone-bar .pb-item')]; const r = document.querySelector('.phone-bar').getBoundingClientRect(); return bs.length === 5 && bs.every(b => (x => x.width >= 44 && x.height >= 44)(b.getBoundingClientRect())) && document.querySelectorAll('.phone-bar [aria-current=page]').length === 1 && Math.abs(r.bottom - innerHeight) < 1 && document.scrollingElement.scrollWidth <= innerWidth })()")],
    ['phone-drawer', click('.phone-bar .pb-item'), () => js<boolean>("(() => { const s = document.querySelector('.sidebar')?.getBoundingClientRect(); return !!s && Math.abs(s.width - innerWidth) < 1 && document.querySelector('main.main').inert && (!document.querySelector('.needs-list') || /to answer|failed|finished/.test(document.querySelector('.needs-counts')?.textContent ?? '')) && (c => !c || c.scrollWidth <= c.clientWidth)(document.querySelector('.needs-counts')) && (b => !b || b.getBoundingClientRect().left < 24)(document.querySelector('.side-head button')) })()")], // Needs you's counts whole (their own line, never cut); the sidebar's button at its left, no traffic lights' room
    ['phone-drawer-esc', key('Escape'), async () => !(await has('.sidebar')) && !(await js<boolean>("document.querySelector('main.main').inert"))],
    ['phone-more', click('.phone-bar .pb-item:last-child'), async () => (await hasText('.phone-sheet .ps-row', 'Settings')) && (await has('.phone-sheet .ps-quiet button'))],
    ['phone-more-esc', key('Escape'), async () => !(await has('.phone-sheet'))],
    // T8: the phone's layout with a notched phone's insets (set as styles.css' --safe-*, as env() would): its bottom
    // bar's buttons end 34px over the bottom, clear of the home indicator; the tab bar's sidebar button starts at the left
    // inset (20px here), not past a Mac's traffic lights; then back to the desktop's
    ['phone-safe', async () => {
      await size(390, 844)
      await waitFor(() => has('.app.narrow'), 'the phone layout')
      await js("(s => [['t', 47], ['r', 0], ['b', 34], ['l', 20]].forEach(([k, v]) => s.setProperty(`--safe-${k}`, `${v}px`)))(document.documentElement.style)")
      await nap(300)
    }, () => js<boolean>("(() => { const bs = [...document.querySelectorAll('.status button, .side-foot button, .phone-bar button')].filter(b => b.getBoundingClientRect().height > 0); return bs.length > 0 && bs.every(b => b.getBoundingClientRect().bottom <= innerHeight - 34) && (x => !x || (x.left >= 20 && x.left < 44))(document.querySelector('.tabbar > .side-show')?.getBoundingClientRect()) })()")],
    ['phone-safe-off', async () => (await js("['t', 'r', 'b', 'l'].forEach(k => document.documentElement.style.removeProperty(`--safe-${k}`))"), await size(1440, 900)), () => js<boolean>("!document.querySelector('.app.narrow')")],
    // U4, last (it empties the world): no project, Welcome; the demo's gh is signed out: its row has Sign in, what passes one line
    ['welcome', async () => {
      for (const w of (await rpc<View>('state')).workspaces) await rpc('wsRm', { id: w.id }).catch(() => {})
      for (const p of (await rpc<View>('state')).projects) await rpc('projectRm', { id: p.id }).catch(() => {})
    }, async () => (await has('.welcome')) && (await hasText('.welcome-checks .check', 'not signed in')) && (await hasText('.welcome-checks button', 'Sign in')) && (await has('.welcome-ready'))],
  ]
  // the first run (LAKI_SMOKE_FIRST, ui-smoke.ts' own short launch on an empty data folder, before the demo's): Welcome,
  // then Try it on a sample repo lands on New workspace with the sample's task (0.49.1's fix: it ended on Laki hit an error)
  const firstRun: typeof steps = [
    ['first-welcome', null, '.welcome'],
    ['first-sample', () => clickText('.welcome button', 'Try it on a sample repo'), async () => (await has('.nw-composer')) && (await js<boolean>("[...document.querySelectorAll('.nw-composer textarea')].some(t => t.value.includes('Fix the failing test'))"))],
  ]
  // M1: the rich demo world (LAKI_DEMO_RICH): the README's stills instead of the walk, each in Laki's two themes (dark,
  // then light): Needs you with its answer buttons, a workspace's Done check and Collision radar, the phone's view
  const readme: typeof steps = []
  // the main panel's left edges (--pane-x): the terminal's text, the tab bar's first tab's icon, the check's icon and its
  // rows' marks start within 1px of one another (the words after an icon on --pane-x2)
  const aligned = () => js<boolean>("(() => { const x = s => document.querySelector(s)?.getBoundingClientRect().left; const term = document.querySelector('.check-strip') ? x('.pane.active .xterm-screen') ?? x('.xterm-screen') : undefined; const at = [x('.tab-list > :first-child :is(.icon-svg, .glyph)'), x('.check-strip .queue-head > :first-child'), x('.check-strip .check-mark')]; return term !== undefined && at.every(v => v !== undefined && Math.abs(v - term) <= 1) })()")
  // a still shows none of the demo's insides: the fakes, the temp folder (the page's words, and the terminals of the two
  // workspaces the stills show: canvas, not in its words)
  const leftovers = async () => {
    const tabs = (await rpc<View>('state')).tabs.filter(t => t.workspace === ws.cart?.id || t.workspace === ws.co?.id)
    const texts = [await js<string>('document.body.innerText'), ...(await Promise.all(tabs.map(t => rpc<string>('screen', { target: t.id, lines: 40 }).catch(() => ''))))]
    return texts.map(x => x.match(/fake|\/private\/tmp|laki-ui-/i)?.[0]).find(Boolean)
  }
  const size = (wd: number, h: number) => (w.isMaximized() && w.unmaximize(), w.setMinimumSize(Math.min(wd, 700), 400), w.setSize(wd, h), nap(600))
  if (process.env.LAKI_DEMO_RICH) {
    readme.push(['readme-setup', async () => {
      await size(1440, 900)
      ws.cart = await named('fix-cart-total')
      ws.co = await named('checkout-flow')
      await rpc('settingsSet', { radar: true })
      await rpc('projectSet', { id: ws.cart.project, config: { lint: 'echo "eslint: 0 problems"', test: 'echo "✖ total rounds to cents: 0.30000000000000004 !== 0.3"; exit 1', check: { steps: ['lint', 'test'] } } })
      // a collision: checkout-flow changes the lines fix-cart-total changes
      writeFileSync(join(ws.co.path, 'src/cart.js'), 'export function total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0)\n}\n')
      // two agents ask to run a command: Needs you's cards
      const v = await rpc<View>('state')
      const askers = await Promise.all(['rate-limiter', 'onboarding-screens'].map(async n => (await rpc<{ id: string }>('tabNew', { ws: (await named(n)).id, preset: 'claude' })).id))
      for (const id of askers) await claudeUp(id)
      for (const id of askers) await rpc('send', { target: id, text: 'perm bash :: npm test' })
      // fix-cart-total's agent finishes a turn: its Done check runs
      const tab = v.tabs.find(t => t.workspace === ws.cart.id && t.kind === 'agent')!
      await rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix the cart total rounding' } })
      await nap(300)
      await rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Totals round to cents now, so 0.1 + 0.2 shows as 0.30. Added a test for it.' } })
      await click(row(ws.co.id))()
      await click('.onboard-bar button')() // Get started's bar: hidden, as most have it by then
    }, () => hasText('.needs-allow-all', 'Allow all (2)')])
    for (const [theme, look] of [['laki', 'dark'], ['laki-light', 'light']]) {
      readme.push([`readme-needs-you-${look}`, async () => (await size(1440, 900), await key('Escape')(), await rpc('settingsSet', { theme, themeAuto: false }), await click(row(ws.co.id))(), await js("document.querySelector('.side-scroll').scrollTop = 0"), await nap(800)), '.needs-cards']) // Needs you from its head (the row's click scrolls; a still's sticky head isn't redrawn)
      // T7: the AI button over the check's strip, not on it (nothing docked at the bottom under it: data-dock)
      readme.push([`readme-check-radar-${look}`, async () => (await click(row(ws.cart.id))(), await waitFor(async () => (await has('.check-strip')) && (await has(`${row(ws.cart.id)} .ws-radar`)), 'its check and the radar', 30000)), async () => (await has('.check-strip')) && (await js<boolean>("(f => !!f && [...document.querySelectorAll('[data-dock=\"bottom\"]')].every(d => (a => (b => b.height === 0 || b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom)(d.getBoundingClientRect()))(f.getBoundingClientRect())))(document.querySelector('.ai-fab-wrap'))")) && (await aligned())])
      readme.push([`readme-phone-${look}`, async () => (await click(row(ws.co.id))(), await size(390, 844), await waitFor(() => has('.phone-bar'), 'the bottom bar'), (await has('.sidebar')) || (await click('.phone-bar .pb-item')()), await waitFor(() => has('.side-scroll'), 'the drawer'), await js("document.querySelector('.side-scroll').scrollTop = 0"), await nap(1500)), '.app.narrow']) // the drawer (Projects on the bottom bar), Needs you at its top, its cards settled
    }
    readme.push(['readme-done', () => size(1440, 900), async () => true])
  }
  // test:sheet (scripts/ui-sheet.ts' LAKI_SHEET, JSON: { looks, themes }): the walk's pages in each look and theme at
  // 1440×900, then the phone's (390×844) for SHEET_PHONE's, each named <look>-<theme>-<page> with its layout facts; no
  // flows. Each page's picture waits for its sheetSel: what must show visible, what must not (left over from the page
  // before) gone; else the step fails, named
  const sheet: typeof steps = []
  const sheetWhy = new Map<string, () => Promise<string>>()
  const shown = (sel: string) => js<boolean>(`[...document.querySelectorAll(${q(sel)})].some(e => e.checkVisibility({ visibilityProperty: true }) && e.getBoundingClientRect().width > 0)`)
  if (process.env.LAKI_SHEET) {
    const { looks, themes, set } = JSON.parse(process.env.LAKI_SHEET) as { looks: string[]; themes: string[]; set?: Record<string, unknown> } // set: LAKI_SHEET_SET's settings
    // Projects again: the Review tab closed as you would (its agent's tab clicked: the review's own key opens it), then
    // the workspace's row and its Terminal
    const back = async () => {
      await key('Escape')()
      if (await has('.settings-page[role=dialog]')) await click('.settings-page[role=dialog] .settings-head button[aria-label^="Close"]')() // a rail page (the Board: Esc stays) by its ×
      if (await has('.full-review')) await clickText('.tab-list > .tab[data-gi]', 'claude')
      ws.cart ??= await named('fix-cart-total')
      await click(row(ws.cart.id))()
      await click('.reader-switch button:first-child')()
    }
    // every wide one first: a phone's row click hides the sidebar and the rail, which a wide page then lacks
    for (const [wd, h, pages] of [[1440, 900, SHEET_PAGES], [390, 844, SHEET_PHONE]] as const)
      for (const look of looks)
        for (const theme of themes)
          for (const n of pages) {
            const [, go] = steps.find(x => x[0] === n)!
            const first = n === pages[0]
            const name = `${look}-${theme}-${wd < 500 ? 'phone-' : ''}${n}`
            const { want, not } = sheetSel(n, wd < 500)!
            sheetWhy.set(name, async () => `${n}${wd < 500 ? ' (phone)' : ''} in ${look}, ${theme}: ${!(await shown(want)) ? `no ${want} shown` : `${not} still shown`}`)
            sheet.push([name, async () => {
              if (first) await rpc('settingsSet', { ...set, design: look, theme, themeAuto: false }), await size(wd, h)
              if (n === 'projects') return back()
              return go?.()
            }, async () => (await shown(want)) && !(await shown(not))])
          }
  }
  // the sheet's layout facts, a report: text cut short where it doesn't fit (text-overflow: clip, its own words wider
  // than its box; a scroller's not), and what reaches past the window's sides unclipped; 20 of each at most
  const facts = () => js<{ clipped: string[]; over: string[] }>(`(() => {
    const name = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
    const clipped = [], over = []
    const shut = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false } // clipped on the way: not seen past the side
    for (const e of document.querySelectorAll('body *')) {
      if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue
      const cs = getComputedStyle(e), r = e.getBoundingClientRect()
      const words = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      if (words && cs.textOverflow === 'clip' && !/auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) clipped.push(name(e))
      if (r.width && (r.right > innerWidth + 1 || r.left < -1) && !shut(e)) over.push(name(e))
    }
    return { clipped: [...new Set(clipped)].slice(0, 20), over: [...new Set(over)].slice(0, 20) }
  })()`)
  const out: { name: string; ok: boolean; ms: number; why?: string; facts?: { clipped: string[]; over: string[] } }[] = []
  // E8: the page's start to its first sidebar row painted (main.tsx' mark): what a lazy page saves shows here
  const first = await js<number>("performance.getEntriesByName('laki-sidebar')[0]?.startTime ?? -1").catch(() => -1)
  if (!process.env.LAKI_SMOKE_FIRST) out.push({ name: 'first-row', ok: first >= 0, ms: Math.round(first), ...(first < 0 && { why: 'no laki-sidebar mark' }) }) // Welcome has no row
  for (const [i, [name, go, sel]] of (process.env.LAKI_SMOKE_FIRST ? firstRun : sheet.length ? sheet : readme.length ? readme : steps).entries()) {
    const at = Date.now()
    const seen = errors.length
    let why: string | undefined
    try {
      await go?.()
      const ok = () => (typeof sel === 'string' ? has(sel) : sel())
      while (!(await ok()) && !(await has('.boom')) && Date.now() - at < 8000) await new Promise(r => setTimeout(r, 100))
      if (await has('.boom')) why = `the page threw: ${await js<string>("document.querySelector('.boom')?.textContent?.slice(0, 200) ?? ''")}`
      else if (!(await ok())) why = (await sheetWhy.get(name)?.()) ?? (typeof sel === 'string' ? `no ${sel} after 8 s` : 'not done after 8 s')
      else if (errors.length > seen) why = `console: ${errors.slice(seen).join(' | ').slice(0, 300)}`
      else if (/^readme-(needs|check|phone)/.test(name)) why = await leftovers().then(bad => bad && `it shows "${bad}"`)
    } catch (e) {
      why = (e as Error).message
    }
    await new Promise(r => setTimeout(r, 250)) // drawn
    const png = join(dir, sheet.length ? `${name}.png` : `${String(i + 1).padStart(2, '0')}-${name}.png`)
    writeFileSync(png, (await w.webContents.capturePage()).toPNG()) // a failed one's too: what it showed
    out.push({ name, ok: !why, ms: Date.now() - at, ...(why && { why }), ...(sheet.length && { facts: await facts().catch(() => undefined), ...sheetDiff(png, name) }) })
    writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2)) // so far: a window killed midway shows where
    if (/(^|-)(palette|get-started|ship-sheet)$/.test(name)) await key('Escape')()
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2))
  app.exit(out.every(s => s.ok) ? 0 : 1)
}
// R2: the main process's own log, <data>/app.log (rotated as daemon.log is): what went wrong here used to leave no
