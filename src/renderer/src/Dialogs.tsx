// The pages and dialogs over the workspace, as App's `dialog` (and the few states of their own: artView, overlapsAt,
// schedulesFor…) says: Pages, in the main area (Settings, Help, the AI page, the board, New workspace…), and Dialogs,
// over everything (Ship, Check overlaps, the timers', renames, a project's notes…). App renders them with what
// appCtx.ts says they read.
import { type AppCtx, backWord, type Dialog, extKey, extOf, flowsOf, notesOf, specsOf, wsName } from './appCtx'
import type { AccountsApi, SkillInfo } from './Settings'
import { FONT_SIZE } from './settingsBase'
import { api, bridge, openExternal } from './api'
import { type AccountView, type Account, type WorkspaceView, aiOn, prAllows, type ProjectConfig, type Doctor, type Resources, type ScriptRun, type LogLine, type CompactLogLine, type GateHeld, type Project, prIn, type Sep, rowsOf, type TabView, SEP_WHERE, PERMS, MODELS, EFFORTS } from '../../shared/types'
import { type AgentUsage, UsagePage, type UsageDay } from './Usage'
import { ask, type MenuItem, Icon } from './ui'
import { type PanelTab, type Changes, type FileContent, FileFinder, type FileList } from './SidePanel'
import { DigestCard, NoticeCard, ShownDialog, ShownPops } from './Shown'
import { SharePop } from './Tunnel'
import { ReplyPop, About, Onboarding, moreOf, ScriptLogs, Logs, Fun, type Meme, NewWorkspace, ArtifactsBar, type Artifact, ArtifactView, AddProject, Prompt, Modal, TimerDialog, RemindDialog, SendLaterDialog, ProjectNotes, ImportChats, ImportWorktrees, CiLog } from './panels'
import { xterms } from './Term'
import { WidgetDialog, WidgetModal } from './Widgets'
import { Picker } from './Picker'
import { DeskPage } from './Desk'
import { CalendarPage } from './Calendar'
import { completeOf, withImages } from './PromptInput'
import { specPrompt, planTemplates } from '../../shared/plans'
import { BirdPage } from './Bird'
import { AchievementsPage } from './Achievements'
import { nameOf, youtubeEmbed, mergeActions, parseDuration, templatesFor } from './text'
import { ComparePage } from './Compare'
import { spanText, type Collision } from '../../shared/overlap'
import { Palette, paletteItems } from './Palette'
import { KeyOverlay } from './KeyOverlay'
import { ShipSheet } from './Ship'
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Page, Boundary } from './ui'
import { hasCap } from '../../shared/caps'

const SpecsPage = lazy(() => import('./Specs')) // BlockNote, Mantine and React Flow with it: loaded as it opens, so on by default costs nothing until then
const WorkflowsPage = lazy(() => import('./Workflows').then(m => ({ default: m.WorkflowsPage }))) // loaded as it opens
const NotesPage = lazy(() => import('./Notes')) // BlockNote with it: loaded as it opens
const TodoListPage = lazy(() => import('./TodoList')) // experimental, and BlockNote with it: loaded as it opens
// what a lazy page shows while its code loads (the first open): its frame, not the workspace under it for a moment;
// its code failing to load, or the page throwing, its own message (Boundary), the window kept
const Waiting = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <Page title={title} wide esc={false} onClose={onClose}>
    {null}
  </Page>
)
const Lazy = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => (
  <Boundary title={title} onClose={onClose}>
    <Suspense fallback={<Waiting title={title} onClose={onClose} />}>{children}</Suspense>
  </Boundary>
)
// E8: the bigger pages too, out of the window's first load: each loads as it opens, or as the pointer comes over its
// rail button (App's preload), in its frame meanwhile
export const PRELOAD = {
  settings: () => import('./Settings'),
  extension: () => import('./Extension'),
  uikit: () => import('./UiKit'),
  help: () => import('./Help'),
  project: () => import('./Project'),
  ai: () => import('./Ai'),
  board: () => import('./Board'),
  schedules: () => import('./Schedules'),
}
// ponytail: its props as any inside (lazy's own types don't carry a generic page's); the page's are checked where it's used
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, title: string) {
  const L = lazy(() => load().then(c => ({ default: c as ComponentType<any> })))
  return (p: P) => (
    <Lazy title={title} onClose={(p as { onClose?: () => void }).onClose ?? (() => {})}>
      <L {...p} />
    </Lazy>
  )
}
const SettingsPage = lazyPage(() => PRELOAD.settings().then(m => m.SettingsPage), 'Settings')
const ExtensionPage = lazyPage(() => PRELOAD.extension().then(m => m.ExtensionPage), 'Extension')
const UiKitPage = lazyPage(() => PRELOAD.uikit().then(m => m.UiKitPage), 'UI kit')
const HelpPage = lazyPage(() => PRELOAD.help().then(m => m.HelpPage), 'Help')
const ProjectPage = lazyPage(() => PRELOAD.project().then(m => m.ProjectPage), 'Project')
const AiPage = lazyPage(() => PRELOAD.ai().then(m => m.AiPage), 'Laki AI')
const BoardPage = lazyPage(() => PRELOAD.board().then(m => m.BoardPage), 'Board')
const SchedulesPage = lazyPage(() => PRELOAD.schedules().then(m => m.SchedulesPage), 'Scheduled')
const StarterLazy = lazy(() => PRELOAD.uikit().then(m => ({ default: m.StarterPicker })))
const StarterPicker = (p: Parameters<typeof StarterLazy>[0]) => (
  <Suspense fallback={null}>
    <StarterLazy {...p} />
  </Suspense>
)

// the pages in the main area, over the panes
export function Pages({ app }: { app: AppCtx }) {
  const { nextNeed, achAll, achHidden, achKept, achN, achRef, achSet, aiNames, allows, apps, archive, artMenu, artPage, artView, asFile, bgUrl, busyWith, byId, call, calOn, cfgSheet, copy, deskOn, dialog, done, earn, extCfg, extInserts, extModal, extWs, fail, flowsOn, fontSize, full, gallery, going, held, hereCtx, hist, hotkey, quickKey, inBrowser, inViewer, kb, layoutsOn, live, made, needsYou, newFor, newImages, newInit, newWs, notesOn, onboardDone, openFile, openIn, openMenu, openProject, order, own, pageZoom, picking, pinPlan, placeName, notices, answerNotice, pops, quickNew, rail, reply, replyTo, revealArt, rmWs, samePlan, schedulesFor, selectTab, setAiFloat, setArtsIn, setArtView, setDialog, setExtModal, setGallery, setMaking, setNewFor, setNewImages, setNewInit, setOnboard, setPicking, setPops, setReply, setReveal, setRunsSeen, setSeenSecs, setSharing, setShown, settings, settingsKey, setWsId, sharing, shotKey, shown, showNew, shownWidgets, showPanel, specsOn, stale, toast, todosOn, toggleFull, view, whereNow, widgetApi, ws, wsHere } = app
  // a page's own move that isn't a place of its own (a Settings section, an extension page's tab): the place it's at
  // says it, so Back or Forward to it opens there, not where it was opened
  // (after App's own effect: a page's first report comes from its effects, which run before App's records its place)
  const keepHere = (mine: (d: Dialog) => boolean, d: Dialog) =>
    queueMicrotask(() => {
      const h = hist.current
      if (h.at[h.i] && mine(h.at[h.i].d)) h.at[h.i] = { ...h.at[h.i], d }
    })
  // a new extension's first ask names it: the dialog (and the place in the history) says which, so Back, ⌘K's way back
  // and a reopen go to it and its chat, not a blank page; its key stays, so it isn't drawn again
  const nameExt = (e: { extension: string; back?: Dialog; key?: string }, id: string) => {
    const k = extKey(e)
    const d: Dialog = { extension: id, back: e.back, key: k }
    const it = (x: Dialog) => (e => !!e && extKey(e) === k)(extOf(x)) // that page still, not another extension's opened meanwhile
    const h = hist.current
    if (h.at[h.i] && it(h.at[h.i].d)) h.at[h.i] = { ...h.at[h.i], d }
    h.going = JSON.stringify({ d, ws: ws?.id ?? null })
    setDialog(x => (it(x) ? d : x))
  }
  // Settings › Agents & profiles' accounts: Sign in opens its terminal (Settings closes: the sign-in is there)
  const accountsApi: AccountsApi = {
    load: () => api.call<AccountView[]>('accounts'),
    usage: () => api.call<AgentUsage[]>('usage'),
    add: (agent, name) => call<Account>('accountAdd', { agent, name }),
    rename: (id, name) => call('accountSet', { id, name }),
    remove: async a => {
      if (!(await ask(`Remove the account ${a.name}?`, { text: `Its sign-in goes with it (${a.email ?? 'its folder'}, and Claude's Keychain item for it). Its chats stay: they're shared. Tabs on it start on the default next time.`, ok: 'Remove', danger: true }))) throw new Error('kept')
      return call('accountRm', { id: a.id })
    },
    login: a => call<WorkspaceView>('accountLogin', { id: a.id, agent: a.agent }).then(w => (setDialog(null), showNew(w.id))),
  }
  // the Artifacts in the side panel's Files (the strip's ⋯ › Open in Files)
  const artifactsInFiles = () => (setArtsIn(ws?.id ?? null), showPanel('files'), setGallery(null))
  const onboardGo = (id: string) => {
    setDialog(null)
    if (id === 'project') openProject()
    else if (id === 'workspace') view?.projects.some(p => !p.kind) ? newWs() : openProject()
    else if (id === 'settings') setDialog('settings')
    else if (id === 'answer') nextNeed() // U3: the next tab that waits for you, else says none does
    else if (id === 'changes') (ws ? showPanel('changes') : toast('Pick a workspace first: its changes show in Changes'))
    else if (id === 'ship') (ws?.kind === 'worktree' ? setDialog('ship') : toast('Ship needs a worktree: start a task first'))
    else if (id === 'shell') quickNew('shells')
    else if (id === 'experimental') setDialog({ section: 'general', spot: 'Cloud workspaces' })
    else if (id === 'workflows' && !flowsOn) setDialog({ section: 'general', spot: 'Pages' }) // Workflows off: where it's turned on again
    else if (id === 'schedules') setDialog('schedules')
    else if (id === 'workflows') setDialog({ workflows: '' })
    else setDialog({ section: id })
  }
  const settingsFor = dialog && typeof dialog === 'object' && 'settings' in dialog ? view.projects.find(p => p.id === dialog.settings) : undefined
  const section = dialog && typeof dialog === 'object' && 'section' in dialog ? dialog.section : undefined // a Settings section asked for
  // an achievement's Show me (achievements.ts' go): where it's done; a page that's off, where it's turned on
  const achGo = (go: string) => {
    const [k, arg, spot] = go.split(':')
    const off: Record<string, boolean> = { workflows: !flowsOn, specs: !specsOn, notes: !notesOn, calendar: !calOn, todos: !todosOn, desk: !deskOn, ai: !aiOn(settings), device: !(view.projects.find(p => p.id === ws?.project)?.config?.simulator ?? settings.simulator === true) }
    const at = k === 'panel' ? arg : k // the Simulator tab: off unless Settings › Simulators (or the project's own) turns it on
    setDialog(null)
    if (off[at]) setDialog(at === 'ai' || at === 'device' ? { section: at === 'ai' ? 'ai' : 'simulator' } : { section: 'general', spot: 'Pages' })
    else if (k === 'project') void openProject()
    else if (k === 'new') view.projects.some(p => !p.kind) ? newWs() : void openProject()
    else if (k === 'shells' || k === 'browsers') void quickNew(k)
    else if (k === 'section') setDialog({ section: arg, ...(spot && { spot }) })
    else if (k === 'workflows') setDialog({ workflows: '' })
    else if (k === 'specs') setDialog({ specs: '' })
    else if (k === 'notes') setDialog({ note: '' })
    else if (k === 'panel' || k === 'newtab' || k === 'rename' || k === 'ship') {
      if (!ws || ws.browser !== undefined) toast('Select a workspace first, then try it there')
      else if (k === 'panel') showPanel(arg as PanelTab)
      else if (k === 'rename') setDialog({ renameWs: ws.id })
      else if (k === 'ship') ws.kind === 'worktree' ? setDialog('ship') : toast('Ship needs a worktree: start a workspace first')
      else setTimeout(() => document.querySelector<HTMLElement>('.newtab-btn')?.click(), 50) // its menu, where it is
    } else setDialog(k as Dialog) // a page: help, palette, board, schedules, timer, ai, desk, todos
  }
  const deskWidgets = shownWidgets.filter(w => !(w.on && w.hidden)).map(w => (w.project ? { ...w, name: `${w.name} · ${view.projects.find(p => p.id === w.project)?.name ?? w.project}` } : w)) // the Desk: every one, a repo's named with its project
  return (
    <>
      {(dialog === 'settings' || settingsFor || section) && (
        <SettingsPage
          key={settingsKey}
          own={own}
          settings={view.settings}
          presets={view.presets}
          apps={apps}
          onClose={() => setDialog(null)}
          onSection={id => {
            keepHere(d => d === 'settings' || (!!d && typeof d === 'object' && ('section' in d || 'settings' in d)), { section: id })
            setSeenSecs(l => (l.includes(id) ? l : [...l, id]))
            if (id === 'resources' || id === 'simulator') earn(id === 'resources' ? 'resources' : 'simTab')
          }}
          onSave={({ achievements: _, recording: __, modelEfforts: ___, ...s }) => {
            // achievements: App's own (earn), never this page's copy from when it opened (Recording mode and the efforts per
            // model likewise: ⌘K's, the new-workspace page's); a profile: the list longer than the one in use
            if (s.presets && s.presets.length > (settings.presets ?? view.presets).length) earn('profile')
            call('settingsSet', s).catch(() => {})
          }}
          projects={view.projects.filter(p => !p.kind).map(p => ({ ...p, git: p.git !== false })) /* Terminals and Browsers: not projects, nothing to set */}
          archived={view.archivedProjects}
          updateIdle={!!view.updateIdle}
          managed={view.managed}
          onUpdateIdle={on => void call('updateIdle', { on })}
          onUnarchive={id => void call('projectArchive', { project: id, on: false }).then(() => done(`${view.archivedProjects?.find(x => x.id === id)?.name ?? 'The project'} is back`), () => {})}
          projectFile={id => api.call<ProjectConfig>('projectFile', { id })}
          onSaveProject={(id, p) => call('projectSet', { id, ...p }).catch(() => {})}
          onAllowProject={view.managed?.allowRules === false ? undefined : (id, allow) => call('projectSet', { id, allow })}
          onMemory={id => setDialog({ project: id, tab: 'memory' })}
          achievements={{ n: achN, of: achAll.length, hidden: achHidden.length, off: !!achKept.off, setOff: off => void achSet({ off }).catch(fail), unhide: () => void achSet({ hidden: [] }).catch(fail), open: () => setDialog('achievements') }}
          renameProjects
          skill={{ app: 'Laki', load: () => api.call<SkillInfo[]>('skills').then(r => (stale(r), r)), set: (agent, on, skill) => api.call<SkillInfo[]>('skillSet', { agent, on, skill }).then(r => (stale(r), r)), doctor: () => api.call<Doctor>('doctor') }}
          accounts={layoutsOn ? accountsApi : undefined}
          hooks={hasCap(view, 'hooks.seen') ? () => api.call('hooksSeen') : undefined}
          ai={{ state: () => api.call('aiState'), key: key => api.call('aiKey', { key }), open: () => setDialog('ai') }}
          bg={{
            url: bgUrl,
            set: async f => {
              if (!f) return api.call('bgSet', {})
              const data = await new Promise<string>((ok, no) => {
                const r = new FileReader()
                r.onload = () => ok(String(r.result).split(',')[1] ?? '')
                r.onerror = () => no(new Error("couldn't read that file"))
                r.readAsDataURL(f)
              })
              return api.call('bgSet', { data, ext: f.name.split('.').pop() })
            },
          }}
          webhookTest={w => api.call('webhookTest', w)}
          cli={{ state: () => api.call('cliState'), install: () => api.call('cliInstall'), remove: () => api.call('cliRemove') }}
          storage={() => api.call('storageInfo')}
          uiReset={() => api.call('uiReset')}
          simulator={p => api.call('sim', p)}
          tunnels={n => api.call('tunnelCheck', n)}
          call={(m, x) => api.call(m, x)}
          resources={{
            load: () => api.call<Resources>('resources'),
            tabs: view.tabs,
            wsName: id => (w => (w ? wsName(w) : id))(view.workspaces.find(w => w.id === id)),
            sleep: tab => api.call('tabSleep', { tab }),
            stopOther: key => api.call('resourceStop', { key }),
            open: tab => (setDialog(null), selectTab(tab), view.tabs.find(t => t.id === tab)?.asleep && call('tabWake', { tab }).catch(() => {})),
            procs: bridge?.procs,
            budgetSaid: () => app.budgetSaid.current,
            // main's (the bubbles, an agent browser), else the page's own frames (laki-stop: the video, a widget, the preview)
            stop: what => (what === 'floater' || what.startsWith('browse:') ? bridge?.procStop?.(what) : window.dispatchEvent(new CustomEvent('laki-stop', { detail: what }))),
            widgetName: id => view.widgets?.find(w => w.id === id)?.name ?? id,
          }}
          remote={{ state: view.remote, devices: view.remoteDevices, pair: () => api.call('remotePair'), revoke: id => api.call('remoteDeviceRm', id ? { id } : { all: true }), start: (hours, mail, open, pin, via, funnel, host) => api.call('remoteStart', { hours, mail, open, pin, via, funnel, host }), stop: () => api.call('remoteStop'), copy, open: openExternal }}
          widgets={extCfg}
          logs={(key, title) => setDialog({ logs: key, title })}
          scriptLogs={() => setDialog('scriptLogs')}
          section={settingsFor ? `project:${settingsFor.id}` : section}
          script={typeof dialog === 'object' && dialog && 'script' in dialog ? dialog.script : undefined}
          spot={typeof dialog === 'object' && dialog && 'spot' in dialog ? dialog.spot : undefined}
        />
      )}
      {shown[0] && <ShownDialog s={shown[0]} left={shown.length - 1} onOpenRun={() => (setDialog({ workflows: '', run: shown[0].run }), setShown([]))} onClose={() => setShown(q => q.slice(1))} />}
      <ShownPops
        pops={pops}
        notices={
          (view.digest || notices.length > 0) && [
            view.digest && <DigestCard key="digest" d={view.digest} onOpen={r => (setDialog(null), r.tab && view.tabs.some(t => t.id === r.tab) ? selectTab(r.tab) : setWsId(r.ws))} onClose={() => void call('dndSet', { seen: true }).catch(() => {})} />,
            ...notices.map(n => {
            // Open: off any page, to its session (a workspace: as you left it); one without choices goes as you do
            const tab = [n.to ? n.to.tab : n.tab].find(id => id && view.tabs.some(t => t.id === id))
            const w = (!tab && n.to && view.workspaces.find(x => x.id === n.to!.ws && !x.archived)) || undefined
            const open = tab || w ? () => (setDialog(null), tab ? selectTab(tab) : setWsId(w!.id), !n.choices.length && answerNotice(n)) : undefined
            return <NoticeCard key={n.id} n={n} onAnswer={c => answerNotice(n, c)} onOpen={open} />
          }),
          ]
        }
        onShow={p => (setShown(q => [...q, p]), setPops(q => q.filter(x => x !== p)))} onOpenRun={p => (setDialog({ workflows: '', run: p.run }), setPops(q => q.filter(x => x !== p)))} onClose={k => setPops(q => q.filter(x => x.key !== k))} />
      {(t =>
        t && (
          <SharePop
            name={t.name}
            share={t.share}
            onClose={() => setSharing(null)}
            api={{
              // the link copied as it's made: what you share it for
              start: hours => api.call<{ url: string }>('shareStart', { tab: t.id, hours }).then(r => navigator.clipboard.writeText(r.url).then(() => done('Share link copied'), () => {})),
              stop: () => api.call('shareStop', { tab: t.id }),
              open: openExternal,
              copy,
            }}
          />
        ))(sharing ? byId(sharing) : undefined)}
      {(t =>
        t &&
        reply && (
          <ReplyPop
            key={`${reply.tab}:${reply.x}:${reply.y}`}
            from={t}
            text={reply.text}
            at={reply}
            to={replyTo(t.id)}
            onAdd={(to, text) => call('send', { target: to.id, text, enter: false }).then(() => (selectTab(to.id), xterms.get(to.id)?.focus(), toast(`In ${to.name}'s prompt: finish it there`)))}
            onSend={(to, text) => call<{ queued?: number }>('send', { target: to.id, text, ...(to.kind === 'agent' && { whenIdle: true, steer: true }) }).then(r => done(r.queued ? `Queued for ${to.name}: it goes after its turn` : `Sent to ${to.name}`))}
            onClose={() => setReply(null)}
          />
        ))(reply ? byId(reply.tab) : undefined)}
      {(w => w && <WidgetDialog w={w} api={widgetApi} onClose={() => setDialog(dialog && typeof dialog === 'object' && 'widget' in dialog ? (dialog.back ?? null) : null)} />)(dialog && typeof dialog === 'object' && 'widget' in dialog ? shownWidgets.find(x => x.id === dialog.widget) : undefined)}
      {(w => w && extModal && <WidgetModal key={extModal.n} w={w} ws={extModal.ws} m={extModal.m} api={widgetApi} onClose={m => setExtModal(x => (!m || x?.m === m ? null : x))} />)(extModal ? view.widgets?.find(x => x.id === extModal.wid) : undefined)}
      {(e => e && (
        <ExtensionPage
          key={extKey(e)}
          id={e.extension}
          tab={e.tab}
          edit={e.edit}
          start={e.start}
          widgets={view.widgets ?? []}
          cfg={extCfg}
          api={widgetApi}
          ai={settings.ai}
          spots={order.filter(w => !w.host && !view.projects.find(p => p.id === w.project)?.kind).map(w => ({ id: w.id, name: wsName(w) }))}
          here={wsHere}
          back={backWord(e.back)}
          onNamed={id => nameExt(e, id)}
          onAiSettings={() => setDialog({ section: 'ai' })}
          onTab={tab => keepHere(d => (x => !!x && extKey(x) === extKey(e))(extOf(d)), { ...e, tab })}
          onClose={() => setDialog(e.back ?? null)}
        />
      ))(extOf(dialog))}
      {dialog && typeof dialog === 'object' && 'uikit' in dialog && <UiKitPage key={String(dialog.icons)} icons={dialog.icons} back={extOf(dialog.back ?? null) ? placeName({ d: dialog.back!, ws: null }) : backWord(dialog.back)} copy={copy} onClose={() => setDialog(dialog.back ?? { section: 'widgets' })} />}
      {dialog === 'help' && <HelpPage cli="laki" ship keys={kb} global={{ open: held.open ? hotkey || '' : '', shot: held.shot ? shotKey || '' : '', quick: held.quick ? quickKey || '' : '' }} zoom={(fontSize / FONT_SIZE) * pageZoom * own} onClose={() => setDialog(null)} />}
      {dialog === 'about' && <About onClose={() => setDialog(null)} />}
      {picking && <Picker copy={copy} widgets={view?.widgets} onClose={() => setPicking(false)} />}
      {dialog === 'desk' && deskOn && (
        <DeskPage
          widgets={deskWidgets}
          wsName={ws && wsHere ? wsName(ws) : undefined}
          tiles={settings.deskTiles}
          tabs={settings.deskTabs}
          api={{
            ...widgetApi,
            place: (id, place, on) => (on ? extCfg.set(id, { place, on }) : call('widgetSet', { id, place, ...(on !== undefined && { on }) })), // on: a repo's sheet first
            build: aiOn(settings) ? start => setDialog({ extension: '', back: 'desk', start }) : undefined, // a new extension's page, its first ask Build with AI's: it writes one placed on the Desk
            save: o => void call('settingsSet', { ...(o.tiles && { deskTiles: o.tiles }), ...(o.tabs && { deskTabs: o.tabs }) }).catch(() => {}),
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {(o =>
        o &&
        notesOn && (
          <Lazy title="Notes" onClose={() => setDialog(null)}>
            <NotesPage id={o.note} api={{ call: (m, p) => api.call(m, p) }} onOpen={note => setDialog({ note })} onClose={() => setDialog(null)} />
          </Lazy>
        ))(notesOf(dialog))}
      {dialog === 'todos' && todosOn && (
        <Lazy title="To-dos" onClose={() => setDialog(null)}>
          <TodoListPage api={{ call: (m, p) => api.call(m, p) }} onClose={() => setDialog(null)} />
        </Lazy>
      )}
      {dialog === 'calendar' && calOn && (
        <CalendarPage
          schedules={view.schedules?.filter(s => !s.archived) ?? []}
          runs={view.runs ?? []}
          reminders={view.reminders ?? []}
          workspaces={live.map(w => ({ id: w.id, name: wsName(w) }))}
          api={{
            add: r => call('reminderAdd', r),
            set: r => call('reminderSet', r),
            rm: id => call('reminderRm', { id }),
            openWs: id => (setDialog(null), setWsId(id)),
            openSchedules: () => setDialog('schedules'),
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'onboard' && (
        <Onboarding
          more={moreOf(settings)}
          done={onboardDone}
          onGo={onboardGo}
          onTick={id => setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] }))}
          onSkip={() => setDialog(null)}
          onOff={() => (setOnboard(o => ({ ...o, off: true })), setDialog(null))}
          theme={settings.theme ?? 'default'}
          onTheme={theme => call('settingsSet', { theme }).catch(() => {})}
          auto={!!settings.themeAuto}
          onAuto={themeAuto => call('settingsSet', { themeAuto }).catch(() => {})}
        />
      )}
      {dialog === 'scriptLogs' && <ScriptLogs load={() => api.call<ScriptRun[]>('scriptLogs')} copy={copy} onClose={() => setDialog({ section: 'general' })} />}
      {dialog && typeof dialog === 'object' && 'logs' in dialog && <Logs title={dialog.title} load={() => api.call<LogLine[]>('logs', { key: dialog.logs })} copy={copy} onClose={() => setDialog(dialog.back ?? (dialog.logs === 'new' ? { section: 'general' } : null))} />}
      {dialog === 'fun' && <Fun load={() => api.call<Meme>('meme')} onClose={() => setDialog(null)} />}
      {dialog === 'starters' && <StarterPicker onClose={() => setDialog(null)} onPick={k => (setDialog(null), void extCfg.make!(k))} />}
      {dialog && typeof dialog === 'object' && 'project' in dialog && (p => p && (
        <ProjectPage
          key={p.id}
          project={p}
          schedules={view.schedules?.filter(s => s.project === p.id && !s.archived) ?? []}
          tab={dialog.tab}
          onTab={tab => setDialog({ project: p.id, tab })}
          onClose={() => setDialog(null)}
          api={{
            save: o => call('projectSet', { id: p.id, ...o }),
            saveSettings: o => call('projectSet', { id: p.id, ...o }).catch(() => {}),
            ...(aiOn(settings) && { compact: { run: () => call('memoryCompact', { project: p.id }), log: () => api.call<CompactLogLine[]>('memoryCompactLog', { project: p.id }) } }),
            file: id => api.call<ProjectConfig>('projectFile', { id }),
            global: { actions: settings.actions, templates: settings.templates, simulator: settings.simulator === true, flows: flowsOn },
            onGlobal: sec => setDialog({ section: sec }),
            schedules: () => setDialog({ schedules: p.id }),
            setSchedule: (id, on) => call('scheduleSet', { id, on }),
            specs: specsOn ? { list: () => api.call('planList', { project: p.id }), open: at => setDialog({ specs: p.id, ...at }) } : undefined,
          }}
        />
      ))(view.projects.find(x => x.id === dialog.project && !x.kind))}
      {dialog === 'ai' && <AiPage settings={settings.ai ?? {}} workspaces={aiNames} onClose={() => setDialog(null)} onSettings={spot => setDialog({ section: 'ai', ...(spot && { spot }) })} onLater={text => setDialog({ sendLater: ws?.id ?? '', to: 'ai', text, back: 'ai' })} inserts={extInserts(hereCtx())} complete={completeOf(view, { project: extWs(ws)?.project })} />}
      {(o =>
        o &&
        specsOn && (
          <Lazy title="Specs & Brainstorms" onClose={() => setDialog(null)}>
            <SpecsPage
              key={o.specs}
              projects={view.projects.filter(p => !p.kind)}
              at={{ project: o.specs || undefined, of: o.of, kind: o.kind, slug: o.slug, templates: o.templates }}
              onNav={to => setDialog(d => (specsOf(d) ? { specs: specsOf(d)!.specs, ...to } : d))}
              onClose={() => setDialog(null)}
              api={{
                call,
                aiOn: aiOn(settings),
                start: p => (setNewFor(p.project), setNewInit({ prompt: specPrompt(p) }), setDialog('new')),
                aiSettings: () => setDialog({ section: 'ai' }),
                templates: planTemplates(settings),
                saveTemplates: planTemplates => call('settingsSet', { planTemplates }),
                copy,
                reveal: path => void bridge?.openPath?.(path),
                full,
                toggleFull: () => toggleFull(),
                ...(rail && { pinned: r => (settings.railPlans ?? []).some(x => samePlan(x, r)), pin: pinPlan }),
              }}
            />
          </Lazy>
        ))(specsOf(dialog))}
      {(o =>
        o &&
        flowsOn && (
          <Lazy title="Workflows" onClose={() => setDialog(null)}>
            <WorkflowsPage
              key={o.run ?? (o.start ? JSON.stringify(o.start) : o.wf ? JSON.stringify(o.wf) : '')}
              view={view}
              projects={view.projects.filter(p => !p.kind)}
              presets={view.presets.filter(p => !p.off)}
              actions={settings.actions}
              at={{ run: o.run, start: o.start, wf: o.wf }}
              nav={o.nav}
              onNav={nav => setDialog(d => (d && typeof d === 'object' && 'workflows' in d ? { ...d, nav } : d))}
              onClose={() => setDialog(null)}
              api={{
                call,
                openWs: id => (setDialog(null), setWsId(id)),
                openTab: (ws, tab) => (setDialog(null), selectTab({ id: tab, workspace: ws })),
                toast: (text, undo) => toast(text, undo),
                phone: !!settings.webhook?.url?.trim(),
                settings: section => setDialog({ section }),
                // Laki AI's floating chat over the page (it knows the open workflow); an ask: sent there, as you'd type it
                ai: aiOn(settings) ? ask => (setAiFloat(true), ask && void whereNow().then(context => api.call('aiAsk', { text: ask, context })).catch(fail)) : undefined,
                globals: settings.flowVars,
                setGlobals: flowVars => call('settingsSet', { flowVars }),
              }}
            />
          </Lazy>
        ))(flowsOf(dialog))}
      {dialog === 'usage' && <UsagePage load={() => api.call<{ keep: number; rows: UsageDay[] }>('usageDays')} onClose={() => setDialog(null)} />}
      {dialog === 'bird' && settings.birdView !== false && (
        <BirdPage
          view={view}
          onClose={() => setDialog(null)}
          api={{ screen: tab => api.call<string>('screen', { target: tab, lines: 40 }) /* no toast: a tab closed meanwhile */, open: (ws, tab) => (setDialog(null), selectTab({ id: tab, workspace: ws })), needs: needsYou }}
        />
      )}
      {dialog === 'achievements' && (
        <AchievementsPage
          kept={achKept}
          onClose={() => setDialog(null)}
          api={{
            go: achGo,
            hide: (id, hide) => (h => void achSet({ hidden: hide ? [...h, id] : h }).catch(fail))((achRef.current.hidden ?? []).filter(x => x !== id)),
            off: off => void achSet({ off }).then(() => off && (setDialog(null), toast('Achievements off: Settings › Achievements turns them back on')), fail),
          }}
        />
      )}
      {dialog === 'board' && (
        <BoardPage
          view={view}
          timers={settings.timers}
          going={going}
          onClose={() => setDialog(null)}
          api={{
            merge: w => allows(w, 'merge'),
            open: id => (setWsId(id), setDialog(null)),
            start: t => {
              // a folder's own workspace has its session already: another one beside it, for this prompt
              const plain = view.projects.find(p => p.id === t.project)?.git === false
              const prompt = withImages(t.text, (t.images ?? []).map(path => ({ path })))
              return call('wsNew', { project: t.project, prompt, place: 'top', ...(plain && { local: true, another: true, name: nameOf(t.text) }) }).then(() => call('todoRm', { id: t.id }))
            },
            add: (project, text, images) => call('todoAdd', { project, text, images }),
            saveImage: (data, ext) => api.call<string>('imageSave', { data, ext }),
            saveFile: (data, name) => api.call<string>('fileSave', { data, name }),
            rm: id => call('todoRm', { id }),
            menu: (e, w) =>
              openMenu(e, [
                { label: 'Open', icon: 'arrowRight', key: 'o', run: () => (setWsId(w.id), setDialog(null)) },
                null,
                ...(w.kind === 'worktree' ? [{ label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(w) } as MenuItem] : []),
                { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(w) },
              ]),
            archiveAll: (e, merged) => openMenu(e, [{ label: `Archive all ${merged.length}`, icon: 'archive', key: 'a', run: async () => { if (await ask(`Archive all ${merged.length} merged?`, { text: `${merged.map(wsName).join(', ')}: their tabs stop, worktrees are removed (the branches stay).`, ok: 'Archive' })) for (const w of merged) await archive(w, true) } }], 'right'), // asked once, then one by one: one with changes asks again
          }}
        />
      )}
      {typeof dialog === 'object' && dialog && 'compare' in dialog && (
        <ComparePage
          view={view}
          race={dialog.compare}
          timers={settings.timers}
          onClose={() => setDialog(null)}
          api={{
            open: id => (setWsId(id), setDialog(null)),
            changes: id => api.call<Changes>('diff', { ws: id }),
            keep: async (winner, losers) => {
              if (!(await ask(`Keep ${wsName(winner)}?`, { text: `${losers.map(wsName).join(', ')} ${losers.length === 1 ? 'is' : 'are'} archived: tabs stop and worktrees go (the branches stay).`, ok: 'Archive the others', danger: true }))) return
              const gone: string[] = []
              const held: string[] = []
              await busyWith(losers.map(w => w.id), 'archiving', async () => {
                for (const w of losers) if (await call<{ held?: GateHeld[] } | null>('wsArchive', { id: w.id }).then(r => (r?.held && held.push(`${wsName(w)} (${r.held.map(h => h.why).join('; ')})`), !r?.held), () => false)) gone.push(w.id) // held by a gate: it stays
              })
              setWsId(winner.id)
              setDialog(null)
              toast(`Kept ${wsName(winner)}, archived ${gone.length}${held.length ? `; a gate held ${held.join(', ')}` : ''}`, () => gone.reduce((p, id) => p.then(() => call('wsRestore', { id })), Promise.resolve<unknown>(undefined)).then(() => setWsId(winner.id), () => {}))
            },
          }}
        />
      )}
      {schedulesFor !== undefined && (
        <SchedulesPage
          key={schedulesFor /* another project's menu: its filter */}
          project={schedulesFor}
          view={view}
          onSeen={id => (setRunsSeen(id), localStorage.setItem('laki.runsSeen', JSON.stringify(id)))}
          onClose={() => setDialog(null)}
          api={{
            set: s => api.call('scheduleSet', s),
            rm: id => api.call('scheduleRm', { id }),
            toast: (text, undo) => toast(text, undo),
            run: id => api.call('scheduleRun', { id }),
            flows: flowsOn ? () => api.call('flowList', {}) : undefined,
            branches: project => api.call('branches', { project }),
            open: (w, t) => (setDialog(null), t && view.tabs.some(x => x.id === t) ? selectTab(t) : setWsId(w)),
            pick: async () => {
              const path = bridge ? await bridge.pickFolder() : prompt('The folder’s full path') // a browser has no folder picker
              return path?.trim() ? api.call<Project>('projectAdd', { path: path.trim() }) : null
            },
          }}
        />
      )}
      {dialog === 'new' && (
        <NewWorkspace
          key={`${newFor}${JSON.stringify(newInit ?? '')}`} // another project asked for while it's open (＋, a dropped folder, a link)
          view={{ ...view, projects: view.projects.filter(p => !p.kind) } /* Terminals and Browsers make theirs with + */}
          // newFor: a project just added may not be in the view yet (projectAdd answers first): the page starts there
          // anyway, not in the selected workspace's project
          project={newFor && !view.projects.find(p => p.id === newFor)?.kind ? newFor : [ws?.project].find(id => view.projects.some(p => p.id === id && !p.kind))}
          agent={settings.agent}
          initial={newInit}
          images={newImages}
          inserts={project => extInserts({}, project)}
          onClose={() => {
            setDialog(null)
            setNewFor(undefined)
            setNewInit(undefined)
            setNewImages([])
          }}
          onCreate={async p => {
            // a row in the sidebar meanwhile (it stays when Esc closes the page: the workspace is still coming)
            const key = ++made.current.key
            const page = made.current.page
            const pr = prIn(p.prompt) // a prompt naming a PR: the workspace is named after it
            const name = p.name?.trim() || (pr ? `PR #${pr.replace(/.*\/pull\//, '')}` : nameOf(p.prompt ?? '')) || 'new workspace'
            setMaking(m => [...m, { key, project: p.project, place: p.place, name: p.fan ? `${name} ×${p.fan.length}` : name }])
            const gone = () => setMaking(m => m.filter(x => x.key !== key))
            // a race: a workspace per agent, then Compare
            // a PR whose branch a workspace has already: that one, a click away
            const got = await (p.fan
              ? call<WorkspaceView[]>('wsFan', { ...p, presets: p.fan })
              : api.call<WorkspaceView>('wsNew', p).then(
                  w => [w],
                  e => {
                    const there = (e as Error).message.match(/checked out in workspace (\S+)$/)?.[1]
                    toast((e as Error).message, there ? () => (setWsId(there), setDialog(null)) : undefined, 'Open it', false, true)
                    throw e
                  },
                )
            ).finally(gone)
            if (page !== made.current.page) {
              // closed meanwhile: you went on with something else, which keeps the focus; the new one is a click away
              setReveal(r => [...r, ...got.map(w => w.id)])
              return toast(`${wsName(got[0])}${got.length > 1 ? ` and ${got.length - 1} more` : ''} ready`, () => showNew(got[0].id, ...got.slice(1).map(w => w.id)), 'Open', true)
            }
            showNew(got[0].id, ...got.slice(1).map(w => w.id))
            ;(pj => pj?.cfgWait && void cfgSheet(pj))(view?.projects.find(x => x.id === got[0].project))
            setDialog(d => (d !== 'new' ? d : p.fan && got[0].race ? { compare: got[0].race } : null))
            setNewFor(undefined)
            setNewInit(undefined)
            setNewImages([])
          }}
        />
      )}
      {ws && gallery === ws.id && ws.storage && (
        <ArtifactsBar
          ws={ws.id}
          n={ws.artifacts ?? 0}
          links={ws.links}
          onClose={() => setGallery(null)}
          api={{
            list: () => api.call<Artifact[]>('artifactList', { ws: ws.id }),
            read: (path, media) => api.call<FileContent>('fileRead', { ws: ws.id, path, storage: true, media }),
            stat: path => api.call<{ size: number; at?: number }>('fileRead', { ws: ws.id, path, storage: true, stat: true }),
            open: path => openIn('default', { ws: ws.id, file: path, storage: true }),
            editor: path => openIn('editor', { ws: ws.id, file: path, storage: true }),
            reveal: bridge?.openPath && (path => revealArt(ws, path)),
            files: artifactsInFiles,
            menu: path => artMenu(ws, path),
            copy,
            page: path => (inViewer(path) ? artPage(ws, path) : undefined),
            unlink: url => api.call('linkRm', { ws: ws.id, url }),
            external: bridge?.openPath && (path => inBrowser(ws, path)), // HTML as the sandboxed page (L11), as the right click's
          }}
        />
      )}
      {artView && (w => w && (
        <ArtifactView
          key={`${w.id}/${artView.path}`}
          path={artView.path}
          page={artPage(w, artView.path)}
          read={() => api.call<FileContent>('fileRead', { ws: w.id, path: artView.path, storage: true })}
          stamp={() => api.call<{ size: number; at?: number }>('fileRead', { ws: w.id, path: artView.path, storage: true, stat: true })}
          onExternal={bridge?.openPath && (() => inBrowser(w, artView.path))}
          onFile={asFile(w, artView.path)}
          onSource={() => (setArtView(null), openFile({ ws: w.id, path: artView.path, storage: true }))}
          onReveal={bridge?.openPath && (() => revealArt(w, artView.path))}
          onClose={() => setArtView(null)}
        />
      ))(view.workspaces.find(x => x.id === artView.ws))}
    </>
  )
}

// the dialogs over everything (and the keys overlay, between them as it always was)
export function Dialogs({ app }: { app: AppCtx }) {
  const { addTimer, byId, call, checking, copy, dialog, done, earn, extInserts, gated, hereCtx, live, narrow, newTab, newWs, overlapsAt, panelApi, prFix, projOf, radarKey, radarOf, restart, selectTab, setDialog, setOverlapsAt, setRadarHid, setSideOpen, setTimer, settings, setVideo, setWsId, showNew, tab, timers, toast, touch, view, ws } = app
  const [cloning, setCloning] = useState(false)
  const [cloneLine, setCloneLine] = useState('') // git's own progress, as it clones (the daemon's cloneProgress)
  useEffect(() => (cloning ? api.on(m => m.ev === 'cloneProgress' && setCloneLine(String(m.line))) : setCloneLine('')), [cloning])
  // a sep: name it (a new one goes at the top: groups are made from the project's ⋯ only), or rename it
  // template: the default prompt template of a new workspace under it ('' none)
  // a group's name and defaults (Edit group: template, agent, where, permission mode, model, effort, base; '' none)
  const sepName = async (o: { sep: string; id?: string }, name: string, d: Partial<Sep>) => {
    const p = view!.projects.find(p => p.id === o.sep)
    if (!p) return
    const own = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v || undefined])) as Partial<Sep> // '' drops it
    if (o.id) return void (await call('projectSet', { id: p.id, seps: p.seps?.map(x => (x.id === o.id ? { ...x, name, ...own } : x)) }))
    const id = `sep-${Math.random().toString(36).slice(2, 10)}`
    const ids = [id, ...rowsOf(p, view!.workspaces).map(x => x.id)]
    await call('projectSet', { id: p.id, seps: [...(p.seps ?? []), { id, name, ...own }], rows: ids })
  }
  // inDialog: Check overlaps' (no Hide: that's the radar's marks; Open closes it)
  const radarMenu = (w: WorkspaceView, list = radarOf(w), inDialog = false): MenuItem[] =>
    list.flatMap((c, i): MenuItem[] => {
      const o = c.ws ? view.workspaces.find(x => x.id === c.ws) : undefined
      const where = `${c.file} (${spanText(c.theirs)} there, ${spanText(c.mine)} here)`
      const hide: MenuItem[] = inDialog ? [] : [{ label: 'Hide until it changes', icon: 'eye', tip: 'Shows again when either side changes those lines', run: () => setRadarHid(h => [...h, radarKey(w, c)]) }]
      if (!o)
        return [
          ...(i ? [null] : []),
          { head: `${c.base} changed ${c.file} since this branched` },
          { label: `Ask the agent to merge ${c.base} in`, icon: 'gitMerge', sub: `${spanText(c.theirs)} there, ${spanText(c.mine)} here`, tip: 'Sent when its turn ends', run: () => void call('send', { target: w.id, whenIdle: true, text: `${c.base} has changed ${where} since this branch started, where you change it too. Merge ${c.base} in now (git merge ${c.base}; no rebase, no force push), resolve any conflicts keeping what both sides meant, run what you can locally, then say what changed.` }).then(() => toast('Sent to the agent'), () => {}) },
          ...hide,
        ]
      const tell = (to: WorkspaceView, other: WorkspaceView, mine: Collision['mine'], theirs: Collision['theirs']) =>
        void call('send', { target: to.id, whenIdle: true, text: `Heads up: workspace ${wsName(other)} (branch ${other.branch}) also changes ${c.file}, ${spanText(theirs)}, where you change ${spanText(mine)}. Both will merge into ${to.base}. Read its change with \`laki diff ${other.id}\` and keep yours compatible with it; tell me if you can't.` }).then(() => toast(`Sent to ${wsName(to)}'s agent`), () => {})
      return [
        ...(i ? [null] : []),
        { head: `${wsName(o)} changes ${c.file} too` },
        { label: `Open ${wsName(o)}`, icon: 'arrowUpRight', sub: `${spanText(c.theirs)} there, ${spanText(c.mine)} here`, run: () => (setWsId(o.id), inDialog && setOverlapsAt(null)) },
        { label: "Tell this one's agent", icon: 'send', tip: `Sends it where ${wsName(o)}'s change is, to build on`, run: () => tell(w, o, c.mine, c.theirs) },
        { label: `Tell ${wsName(o)}'s agent`, icon: 'send', run: () => tell(o, w, c.theirs, c.mine) },
        ...hide,
      ]
    })
  return (
    <>
      {dialog === 'project' && (
        <AddProject
          onClose={() => setDialog(null)}
          onAdd={async path => {
            const p = await call<Project>('projectAdd', { path })
            newWs(p.id) // as a picked folder goes
          }}
        />
      )}
      {dialog === 'files' && ws && <FileFinder files={() => api.call<FileList>('files', { ws: ws.id })} onPick={path => panelApi(ws).preview(path)} onClose={() => setDialog(null)} />}
      {dialog === 'palette' && <Palette items={paletteItems(app)} forName={ws ? wsName(ws) : undefined} onClose={() => setDialog(null)} />}
      <KeyOverlay on={settings.keyOverlay !== false && !narrow && !touch && !dialog} keys={settings.keys} />
      {dialog === 'ship' && ws && (
        <ShipSheet
          ws={ws}
          title={`Ship ${wsName(ws)}`}
          busy={checking === `ship:${ws.id}` ? 'Checking…' : undefined}
          land={prAllows(projOf(ws)?.config, 'land')}
          call={call}
          onClose={() => setDialog(null)}
          onShip={async ({ autoLand, autoFix, ...a }) => {
            const t = await gated(ws, 'ship', force => call<TabView | { held: GateHeld[] }>('ship', { ws: ws.id, ...a, force }))
            if (!t || !('id' in t)) return
            // the PR's switches as the sheet left them (a PR the ship opens takes them)
            if (a.mode === 'pr') for (const [k, v] of [['autoLand', autoLand], ['autoFix', autoFix]] as const) if (!!ws[k] !== v) call('wsSet', { id: ws.id, [k]: v }).catch(() => {})
            setDialog(null)
            selectTab(t)
          }}
        />
      )}
      {overlapsAt &&
        (w =>
          w && (
            <Modal title={`Collision radar · ${wsName(w)}`} onClose={() => setOverlapsAt(null)}>
              {overlapsAt.err ? (
                <p className="warn small">{overlapsAt.err}</p>
              ) : !overlapsAt.list ? (
                <p className="muted small">Comparing its changes with {projOf(w)?.name}'s other worktrees and with {w.base ?? 'its base'}…</p>
              ) : !overlapsAt.list.length ? (
                <p className="muted small">None: no other worktree of {projOf(w)?.name} changes the same lines, and {w.base ?? 'its base'} hasn't changed them since it branched.</p>
              ) : (
                <div className="overlaps">
                  {radarMenu(w, overlapsAt.list, true).map((it, i) =>
                    !it ? null : 'head' in it ? (
                      <b key={i} className="overlaps-head">
                        {it.head}
                      </b>
                    ) : 'run' in it && it.run ? (
                      <button key={i} className="overlaps-act" data-tip={it.tip} onClick={it.run}>
                        {it.icon && <Icon name={it.icon} />} {it.label}
                        {it.sub && <span className="muted small">{it.sub}</span>}
                      </button>
                    ) : null,
                  )}
                </div>
              )}
            </Modal>
          ))(view.workspaces.find(x => x.id === overlapsAt.w))}
      {dialog === 'video' && (
        <Prompt
          title="Watch a YouTube video"
          placeholder="https://www.youtube.com/watch?v=…"
          hint="It plays at the bottom of the sidebar, beside your work; × closes it."
          onClose={() => setDialog(null)}
          onSubmit={async link => {
            const src = youtubeEmbed(link)
            if (!src) {
              toast('Not a YouTube link: a video, a short or a playlist')
              throw new Error('not YouTube') // the dialog stays open
            }
            setVideo({ src, play: true, at: Date.now() })
            earn('video')
            setSideOpen(true) // asked for from ⌘K with the sidebar hidden: shown, not just heard
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'timerCmd' in dialog && ws && (
        <Prompt
          title="When it ends, run"
          placeholder="say 'time is up' · npm test · open https://…"
          hint={`Runs through your login shell in ${wsName(ws)}, in a tab of its own (it closes when the command succeeds).`}
          initial={timers.find(t => t.id === dialog.timerCmd)?.cmd}
          onClose={() => setDialog(null)}
          onSubmit={async cmd => {
            setTimer(dialog.timerCmd, x => ({ ...x, then: 'command', cmd, ws: ws.id }))
            setDialog(null)
          }}
        />
      )}
      {(dialog === 'timer' || dialog === 'importantTimer') && (
        <TimerDialog
          key={dialog}
          where={ws ? wsName(ws) : undefined}
          important={dialog === 'importantTimer'}
          onClose={() => setDialog(null)}
          onStart={(ms, cmd, note, important) => {
            addTimer(ms, { ...(cmd && ws && { then: 'command' as const, cmd, ws: ws.id }), ...(note && { note }), ...(important && { important }) })
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'remind' in dialog && (
        <RemindDialog
          name={wsName(live.find(w => w.id === dialog.remind) ?? { id: dialog.remind })}
          onClose={() => setDialog(null)}
          onPick={ms => {
            addTimer(ms, { then: 'remind', ws: dialog.remind })
            setDialog(null)
            done(`I'll remind you at ${new Date(Date.now() + ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'sendLater' in dialog && (() => {
        const old = timers.find(t => t.id === dialog.edit)
        const agents = [
          ...(view?.tabs ?? []).filter(t => t.workspace === dialog.sendLater && t.kind === 'agent' && (t.status !== 'exited' || t.id === old?.tab)).map(t => ({ id: t.id, name: t.name })),
          ...(aiOn(settings) || old?.tab === 'ai' ? [{ id: 'ai', name: 'Laki AI' }] : []),
        ]
        const w = live.find(x => x.id === dialog.sendLater)
        const picks = mergeActions(settings.actions, view?.projects.find(p => p.id === w?.project)?.config?.actions).filter(a => a.target !== 'shell') // Run ▾'s agent actions
        return (
          <SendLaterDialog
            agents={agents}
            tab={old?.tab ?? dialog.to ?? (agents.some(t => t.id === tab?.id) ? tab!.id : undefined)}
            text={old?.text ?? dialog.text}
            at={old?.end}
            picks={picks}
            inserts={to => (t => extInserts(to === 'ai' ? hereCtx() : { ws: t?.workspace, tab: t?.id }))(view.tabs.find(x => x.id === to))}
            complete={to => (to === 'ai' ? completeOf(view, { project: w?.project }) : (t => completeOf(view, { ws: t?.workspace, agent: t?.kind === 'agent' ? t.preset : undefined }))(view.tabs.find(x => x.id === to)))}
            onClose={() => setDialog(dialog.back ?? null)}
            onPick={o => {
              if (old) setTimer(old.id, x => ({ ...x, tab: o.tab, text: o.text, end: Date.now() + o.ms, ms: o.ms }))
              else addTimer(o.ms, { then: 'send', ws: dialog.sendLater, tab: o.tab, text: o.text })
              setDialog(dialog.back ?? null) // from the AI page: back there
              done(`It goes to ${agents.find(t => t.id === o.tab)?.name ?? 'the agent'} at ${new Date(Date.now() + o.ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
            }}
          />
        )
      })()}
      {typeof dialog === 'object' && dialog && 'timerNote' in dialog && (
        <Prompt
          title="The timer's message"
          initial={timers.find(t => t.id === dialog.timerNote)?.note ?? ''}
          placeholder="Go out · Stretch · Check the oven"
          hint="On its bar, and what it says as it ends."
          onClose={() => setDialog(null)}
          onSubmit={async typed => {
            setTimer(dialog.timerNote, x => ({ ...x, note: typed.trim().slice(0, 120) || undefined }))
            setDialog(null)
          }}
        />
      )}
      {typeof dialog === 'object' && dialog && 'timer' in dialog && (
        <Prompt
          title="Start this timer over with"
          placeholder="25 · 1h 30m · 90s"
          hint="Minutes, or with units (h, m, s); up to a day. It starts at once."
          onClose={() => setDialog(null)}
          onSubmit={async typed => {
            const ms = parseDuration(typed)
            if (!ms) {
              toast('A length like 25, 1h 30m or 90s, up to 24 hours')
              throw new Error('no length') // the dialog stays open
            }
            restart(dialog.timer, ms)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'custom' && ws && (
        <Prompt
          title="New tab: command"
          placeholder="aider --model sonnet"
          hint="Runs through your login shell, in the workspace."
          onClose={() => setDialog(null)}
          onSubmit={async cmd => {
            setDialog(null)
            await newTab('custom', cmd)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'rename' in dialog && byId(dialog.rename) && (
        <Prompt
          title="Rename"
          initial={byId(dialog.rename)!.name}
          onClose={() => setDialog(null)}
          onSubmit={async name => {
            await call('tabSet', { id: dialog.rename, name })
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'sep' in dialog && (() => {
        const p = view.projects.find(p => p.id === dialog.sep)
        const s = p?.seps?.find(x => x.id === dialog.id)
        const tpls = templatesFor(settings.templates, p?.config?.templates)
        const keys: string[] = [] // each pick's field, in order
        return (
        <Prompt
          title={dialog.id ? 'Edit group' : 'New group'}
          hint={dialog.id ? undefined : 'A named line between workspaces. Drag it, or them, to sort.'}
          initial={s?.name}
          picks={([
            ...(tpls.length || s?.template ? [{ key: 'template', label: 'Default prompt template: a new workspace here starts with it', none: 'None: the last one used', options: tpls.map(t => t.name), value: s?.template }] : []),
            { key: 'preset', label: 'Default agent: a new workspace here starts it', none: 'None: the last one used', options: view.presets.filter(x => !x.off).map(x => x.name), value: s?.preset },
            ...(p?.git === false ? [] : [{ key: 'where', label: 'Where: a new workspace here is made', none: 'As last picked', options: [...SEP_WHERE], names: { worktree: 'New worktree', bare: 'New worktree, no setup', local: "Local: the project's folder" }, value: s?.where }]),
            { key: 'perm', label: 'Permission mode', none: "The agent profile's", options: ['ask', ...new Set(Object.values(PERMS).flatMap(m => m!.map(x => x[0])))], names: { ask: 'Ask first', ...Object.fromEntries(Object.values(PERMS).flatMap(m => m!.map(x => [x[0], x[1]]))) }, value: s?.perm },
            { key: 'model', label: 'Model', none: "The agent profile's", options: Object.values(MODELS).flat(), value: s?.model, free: true },
            { key: 'effort', label: 'Effort', none: "The agent profile's", options: [...new Set(Object.values(EFFORTS).flat())], value: s?.effort },
            ...(p?.git === false ? [] : [{ key: 'base', label: 'Base branch for new worktrees', none: "The repo's main branch", options: [], value: s?.base, free: true }]),
          ] as ({ key: string; label: string; none: string; options: string[]; value?: string; names?: Record<string, string>; free?: boolean })[]).map(({ key, ...x }) => (keys.push(key), x))}
          onClose={() => setDialog(null)}
          onSubmit={async (name, picked) => {
            await sepName(dialog, name, Object.fromEntries(keys.map((k, i) => [k, picked[i]?.trim() ?? ''])))
            setDialog(null)
          }}
        />
        )
      })()}
      {dialog && typeof dialog === 'object' && 'notes' in dialog && (p => p && <ProjectNotes name={p.name} notes={p.notes ?? ''} onSave={notes => call('projectSet', { id: p.id, notes })} onClose={() => setDialog(null)} />)(view?.projects.find(p => p.id === dialog.notes))}
      {dialog && typeof dialog === 'object' && 'importChats' in dialog && (p =>
        p && (
          <ImportChats
            name={p.name}
            wsName={id => (w => (w ? wsName(w) : "the project's folder"))(view.workspaces.find(w => w.id === id))}
            load={() => call('chatList', { project: p.id })}
            onClose={() => setDialog(null)}
            onImport={async ids => {
              const made = await call<{ id: string; workspace: string }[]>('chatImport', { project: p.id, ids })
              setDialog(null)
              if (made[0]) (showNew(made[0].workspace), selectTab(made[0])) // by ref: the view hasn't the tab yet
              done(`${made.length} chat${made.length === 1 ? '' : 's'} imported`)
            }}
          />
        ))(view.projects.find(p => p.id === dialog.importChats))}
      {dialog && typeof dialog === 'object' && 'importWt' in dialog && (p =>
        p && (
          <ImportWorktrees
            name={p.name}
            load={() => call('worktreeList', { project: p.id })}
            onClose={() => setDialog(null)}
            onImport={async paths => {
              const made = await call<{ id: string }[]>('worktreeImport', { project: p.id, paths })
              setDialog(null)
              done(`${made.length} worktree${made.length === 1 ? '' : 's'} imported`)
            }}
          />
        ))(view.projects.find(p => p.id === dialog.importWt))}
      {dialog === 'clone' && ( // U7: Welcome's and ⌘K's
        <Prompt
          title="Clone a repository"
          placeholder="https://github.com/owner/repo, git@host:owner/repo.git, or owner/repo"
          hint={(cloning && cloneLine) || 'Cloned with your own git (gh for owner/repo, with its sign-in), then added as a project.'}
          picks={[{ label: 'Into', none: '~/code, else beside your last project', options: [], free: true }]}
          busy={cloning ? 'Cloning…' : undefined}
          onClose={() => setDialog(null)}
          onSubmit={async (url, [into]) => {
            setCloning(true)
            const p = await call<{ id: string }>('projectClone', { url, into }).finally(() => setCloning(false)) // a failure: the toast says git's last line
            setDialog(null)
            newWs(p.id)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'attachPr' in dialog && (w => w && (
        <Prompt
          title="Attach a pull request"
          placeholder="https://github.com/owner/repo/pull/12, or 12"
          hint={`Its URL, or its number in this repo. Its status and checks show here; the PR switches work when its branch is this workspace's (${w.branch}).`}
          onClose={() => setDialog(null)}
          onSubmit={async pr => {
            const r = await call<{ number: number; linked: boolean }>('prAttach', { ws: w.id, pr })
            setDialog(null)
            done(`PR #${r.number} attached${r.linked ? ': only linked, its branch is another one' : ''}`)
          }}
        />
      ))(live.find(w => w.id === dialog.attachPr))}
      {dialog && typeof dialog === 'object' && 'ciLog' in dialog && (w => w && (
        <CiLog
          key={dialog.job}
          name={dialog.name}
          url={dialog.url}
          load={() => api.call<string>('prLog', { ws: w.id, job: dialog.job }) /* its failure shows in it, not as a toast */}
          onSend={() => prFix(w, 'ci', dialog.job)}
          onOpen={openExternal}
          copy={copy}
          onClose={() => setDialog(null)}
        />
      ))(live.find(w => w.id === dialog.ciLog))}
      {dialog && typeof dialog === 'object' && 'renameWs' in dialog && live.some(w => w.id === dialog.renameWs) && (
        <Prompt
          title="Rename workspace"
          hint="Only the name shown here: the folder and branch keep the id. Enter the id to go back to it."
          initial={(w => w.name || w.id)(live.find(w => w.id === dialog.renameWs)!)}
          onClose={() => setDialog(null)}
          onSubmit={async name => {
            await call('wsSet', { id: dialog.renameWs, name })
            setDialog(null)
          }}
        />
      )}
    </>
  )
}
