// the main area's body (App's .body): the workspace's panes, the file preview, the side panel and Review tab, the
// empty page, a Browsers page; App's, read from AppCtx
import type { AppCtx } from './appCtx'
import { type AgentDid, type Doctor, placesOf, type TabView } from '../../shared/types'
import { Backdrop } from './Backdrop'
import { BrowserPane } from './Browser'
import { CheckStrip, GoalStrip, HookStrip, InstallStrip, LaterStrip, McpStrip, PlanStrip, QueueStrip, Ready, SecretStrip, ShowStrip, SignInStrip, SuggestStrip, StarLaki, Welcome, WorkersDock } from './panels'
import { Glyph as ExtGlyph, inWs, status as extStatus, WidgetBody, WidgetPanel } from './Widgets'
import { edited, type FileContent, FilePreview, fileNoteText, type FilesRoot, SidePanel } from './SidePanel'
import type { ReviewNote } from '../../shared/reviewNotes'
import { Glyph, rollup } from './Glyph'
import { ask, choose, Icon, IconButton } from './ui'
import { sbSay } from './StatusBar'
import { bulkAnswer } from './Needs'
import { InfoTab } from './Info'
import { PanelHandle, Panes } from './Panes'
import { Reader } from './Reader'
import { SideChat } from './SideChat'
import type { SpendView } from './Spend'
import { Suspense } from 'react'
import { TabStrip } from './TabBar'
import { Term } from './Term'
import { TurnStrip } from './TurnStrip'
import { api, bridge, openExternal, openKeptLink } from './api'
import { colorOf, wsName } from './appCtx'
import { hasCap } from '../../shared/caps'
import { isCopilot, isCursor, notInstalled, tabAgent } from '../../shared/install'
import { keepFile } from './PromptInput'
import { pendingWords, prNo } from './text'
import { resize, tabsOf } from '../../shared/layout'
import { reviewQueue } from '../../shared/nextStep'
import { termLook } from './settingsBase'
import { transparent } from './themes'
import { fileKey } from './AppParts'
import { lazy } from 'react'

// E8: loaded as it first shows (the Review tab): not in the window's first load
const FullReview = lazy(() => import('./FullReview').then(m => ({ default: m.FullReview })))

// OSC 52 (Term's onClip): a program's copy to the Mac's clipboard, as Settings › Terminal › Programs may copy to the
// clipboard says (termClip): a shell tab asks once (Allow, Not now: kept on the tab, tabSet's clip), an agent's only
// with Shells and agents, none with Never; the status bar says it for two seconds
const clipAsks = new Map<string, Promise<boolean>>()
const clipSaid = new Map<string, boolean>() // answered here, before the view brings the tab's clip
async function clipCopy(t: TabView | undefined, text: string, how: 'ask' | 'all' | 'never' = 'ask') {
  if (!t || how === 'never' || (t.kind === 'agent' && how !== 'all')) return
  const said = t.clip ?? clipSaid.get(t.id)
  if (how === 'ask' && said === false) return
  if (how === 'ask' && said === undefined) {
    const asked = clipAsks.get(t.id) ?? choose('Let this tab copy to your clipboard?', `A program in ${t.name} (vim, tmux, ssh) asks to put text on your clipboard. Asked once for this tab`, [{ label: 'Allow', primary: true }, { label: 'Not now' }]).then(i => i === 0)
    if (!clipAsks.has(t.id)) {
      clipAsks.set(t.id, asked)
      void asked.then(yes => (clipAsks.delete(t.id), clipSaid.set(t.id, yes), api.call('tabSet', { id: t.id, clip: yes }))).catch(() => {})
    }
    if (!(await asked)) return
  }
  if (await bridge?.copyText?.(text).catch(() => false)) (n => sbSay(`Copied ${n} line${n === 1 ? '' : 's'}`))(text.replace(/\r?\n$/, '').split('\n').length)
}

export function bodyOf(app: AppCtx) {
  const { artsIn, attachable, browsed, byId, call, checkHid, ciLog, closeFile, closePreview, closeTabs, copy, detachPr, dialog, done, fail, finds, floated, floatTab, full, git, group, groups, guests, hookHid, infoOf, inReader, kh, kt, label, labelApi, laterCancel, laterChange, laterNow, live, narrow, newTabActions, newWs, noBar, openIn, openProject, ownWidgets, pageSeen, paneDeps, panelApi,
    panelHost, setNewFor, setNewInit, showNew, panelShown, panelTab, panelW, paneNow, prAct, previewed, previewW, prFix, project, queueRemove, queueSave, quickNew, railKind, readerLive, readSwitch, replyTo, reviewApi, reviewGo, reviewOn, reviewTight, ring, selectTab, setArtsIn, setAuto, setCheckHid, setDialog, setGroups, setHookHid, setOpenFiles, setPanelOpen, setPanelTab, setPanelW, setPreviewW, setReply, setReveal, setReviewTight, setShownFile, setTimer, settings, setWsId, sizeOf, start, statKey, tab, tabMenu, tabsAt, theme, timers, toast, turnLive, view, welcomeRun, welcomeSample, widgetApi, workerAsks, ws, wsFiles, wsTabMenu, drag } = app
  // the workers dock's Stop all: each turn under way gets Esc (stopAll's one tab, as its Stop), after you say so
  const stopWorkers = async (ts: TabView[]) => {
    if (!(await ask(`Stop ${ts.length} ${ts.length === 1 ? "worker's turn" : "workers' turns"}?`, { text: 'Each agent gets Esc, as its own Stop: what it was doing ends there; its tab and its work stay.', ok: `Stop ${ts.length}`, danger: true }))) return
    let n = 0
    for (const t of ts) await call('stopAll', { tab: t.id }).then(() => n++, () => {})
    done(`Stopped ${n}`)
  }
  // its Archive done: each done worker archived only while nothing of it is uncommitted (wsArchive's ifClean: one with
  // changes, or an extension's gate holding it, stays, named); Undo brings them back
  const archiveWorkers = async (ids: string[]) => {
    const name = (id: string) => (w => (w ? wsName(w) : id))(view.workspaces.find(w => w.id === id))
    if (!(await ask(`Archive ${ids.length} finished ${ids.length === 1 ? 'worker' : 'workers'}?`, { text: 'Their tabs stop and their worktrees go (their branches stay); one with uncommitted changes stays as it is.', facts: [{ label: 'Workers', value: ids.map(name).join(', ') }], ok: 'Archive' }))) return
    const gone: string[] = []
    const kept: string[] = []
    for (const id of ids) {
      const r: { dirty?: number; held?: unknown[] } | null = await call<{ dirty?: number; held?: unknown[] } | null>('wsArchive', { id, ifClean: true }).catch(() => ({ dirty: -1 }))
      ;(r && (r.dirty || r.held?.length) ? kept : gone).push(id)
    }
    const undo = gone.length ? () => void Promise.all(gone.map(id => app.restore(id))) : undefined
    if (kept.length) toast(`Archived ${gone.length}; kept (uncommitted changes, or held): ${kept.map(name).join(', ')}`, undo)
    else done(`Archived ${gone.length}`, undo)
  }
  return (
        <div className="body">
          {tabsAt === 'left' && <TabStrip app={app} />}
          <div className="term-wrap" data-review={reviewOn && ws ? '' : undefined}>
            {group ? (
              <Panes
                head={readSwitch}
                layout={group}
                active={tab?.id ?? null}
                drag={drag}
                label={label}
                color={id => colorOf(byId(id))}
                onMenu={(e, id) => wsTabMenu(e, tabMenu([id]))}
                ghost={drag && (() => { // a pill: the tab's glyph and names, as in the tab bar
                  const ts = (drag.whole ? tabsOf(groups.find(g => tabsOf(g).includes(drag.tab)) ?? null) : [drag.tab]).map(byId).filter((t): t is TabView => !!t)
                  return ts.length > 1 ? <><Glyph s={rollup(ts)} /><span>{ts.map(t => t.name).join(' · ')}</span></> : label(drag.tab)
                })()}
                deps={paneDeps}
                render={id => floated.includes(id) ? (
                  <div className="floated">
                    <span>In a window of its own, over every app</span>
                    <div className="row">
                      <button onClick={() => floatTab(id)}>Show it</button>
                      <button onClick={() => floatTab(id, false)}>Bring it back</button>
                    </div>
                  </div>
                ) : (
                  <>
                  <Term
                    key={transparent() ? 'clear' : 'solid' /* xterm takes allowTransparency only as it opens */}
                    tab={id}
                    active={id === tab?.id && !dialog && !reviewOn && !inReader(id)}
                    findSeq={finds[id] ?? 0}
                    fontSize={narrow ? Math.min(sizeOf(id), 11) : sizeOf(id) /* ponytail: a phone's own size, not a setting */}
                    fontFamily={settings.fontFamily}
                    copyOnSelect={settings.copyOnSelect !== false}
                    editKeys={settings.editKeys !== false}
                    theme={theme}
                    look={termLook(settings)}
                    onFile={path => paneNow.current.openPath(id, path)}
                    onReply={replyTo(id).length ? (text, at) => setReply({ tab: id, text, ...at }) : undefined}
                    onSelection={(text, how) => paneNow.current.selectionTo(id)(text, how)}
                    onCode={(path, line, other) => paneNow.current.openCode(id)(path, line, other)}
                    codeTo={settings.fileClick === 'editor' ? 'editor' : 'preview'}
                    image={path => paneNow.current.peekImage(id)(path)}
                    text={path => paneNow.current.peekText(id)(path)}
                    cwd={view?.workspaces.find(x => x.id === byId(id)?.workspace)?.path}
                    onClip={text => void clipCopy(byId(id), text, settings.termClip)}
                    pictures={settings.termPictures !== false}
                    savePicture={f => keepFile(f, (data, ext) => api.call<string>('imageSave', { data, ext })).then(r => r.path)}
                  />
                  {inReader(id) && <Reader tab={byId(id)!} api={readerLive} active={id === tab?.id && !dialog && !reviewOn} look={{ tools: settings.readerTools, scroll: settings.readerScroll, times: settings.readerTimes }} />}
                  </>
                )}
                foot={id =>
                  (t =>
                    t && (
                      <>
                        <SecretStrip tab={t} kept={hasCap(view, 'secret.kept')} onGive={(id, o) => call('secretGive', o ? { id, ...o } : { id, refuse: true })} />
                        <WorkersDock tab={t.id} workers={workerAsks(t.id)} onAnswer={(tab, n, label) => call('answer', { tab, n, label })} onOpen={(w, id) => (setReveal(r => [...r, w]), selectTab({ id, workspace: w }))} onAllow={ts => bulkAnswer(ts, true, { view, toast, done })} onStop={stopWorkers} onArchive={hasCap(view, 'archive.dirty') ? archiveWorkers : undefined /* an older daemon archives whatever is there: no bulk */} />
                        <ShowStrip tab={t} onClose={() => void call('showDone', { tab: t.id }).catch(() => {})} onCopy={copy} />
                        {(w =>
                          w?.suggests && (
                            // #5: what its agents suggested: under the tab that did (one gone, or none: the workspace's first agent's)
                            <SuggestStrip
                              list={w.suggests.filter(s => !s.answered && (s.tab === t.id || ((!s.tab || !view?.tabs.some(x => x.id === s.tab)) && view?.tabs.find(x => x.workspace === w.id && x.kind === 'agent')?.id === t.id)))}
                              onStart={s => call<{ made?: string }>('suggestAnswer', { ws: w.id, id: s.id, act: 'start' }).then(r => r.made && showNew(r.made), () => {})}
                              onEdit={s => (setNewFor(w.project), setNewInit({ prompt: s.prompt, name: s.title, suggested: { ws: w.id, id: s.id } }), setDialog('new'))}
                              onDismiss={s => void call('suggestAnswer', { ws: w.id, id: s.id, act: 'dismiss' }).catch(() => {})}
                            />
                          ))(view?.workspaces.find(x => x.id === t.workspace))}
                        {(noBar || full) && t.kind === 'agent' && settings.turnChanges !== false && <TurnStrip tab={t} api={turnLive(t.workspace)} /> /* the status bar's Turns, when there's none (off, or full screen hides it) */}
                        <PlanStrip tab={t} onAnswer={n => call('answer', { tab: t.id, n })} onSend={text => void call('send', { target: t.id, text, whenIdle: true }).catch(() => {})} />
                        {t.queue?.length ? <QueueStrip tab={t} onSave={(q, was) => queueSave(t, q, was)} onRemove={i => queueRemove(t, i)} onNow={() => void call('queueNow', { tab: t.id }).catch(() => {})} onResume={() => void call('queueResume', { tab: t.id }).catch(() => {})} onClear={() => queueRemove(t)} /> : null}
                        {(c => c && c.tab === t.id && !checkHid.includes(`${t.workspace}:${c.at}`) && <CheckStrip tab={t} check={c} onAgain={() => void call('checkAgain', { ws: t.workspace }).catch(() => {})} onStop={() => void call('checkStop', { ws: t.workspace }).catch(() => {})} onSend={text => void call('send', { target: t.id, text, whenIdle: true }).then(() => (setCheckHid(h => [...h, `${t.workspace}:${c.at}`]), toast(`Sent to ${t.name}`)), () => {})} onHide={() => setCheckHid(h => [...h, `${t.workspace}:${c.at}`])} />)(view.workspaces.find(x => x.id === t.workspace)?.check)}
                        {(a => a && notInstalled(t) && (
                          <InstallStrip
                            agent={a}
                            onCopy={copy}
                            onInstall={cmd => void call<{ id: string }>('tabNew', { ws: t.workspace, kind: 'shell' }).then(sh => call('send', { target: sh.id, text: cmd, enter: false })).catch(fail)}
                            onAgain={() => void call('input', { tab: t.id, data: '\r' }).catch(fail)}
                          />
                        ))(tabAgent(t, view?.presets) ?? (t.preset === 'acp' ? (pr => (isCursor(pr) ? ('cursor' as const) : isCopilot(pr) ? ('copilot' as const) : undefined))(view?.presets.find(x => x.name === t.profile)) : undefined))}
                        <SignInStrip tab={t} onAct={act => void call('signIn', { tab: t.id, act }).catch(fail)} />
                        <McpStrip tab={t} onAct={(name, act) => void call<{ ws?: string; tab?: string }>('mcpSignIn', { tab: t.id, name, act }).then(r => r.ws && r.tab && (setReveal(x => [...x, r.ws!]), selectTab({ id: r.tab, workspace: r.ws })), fail)} />
                        <GoalStrip tab={t} onCmd={cmd => void call('send', { target: t.id, text: cmd }).catch(fail)} onOwn={a => void call(a === 'clear' ? 'goalClear' : 'goalSet', { tab: t.id, ...(a === 'resume' && { resume: true }) }).catch(fail)} />
                        {!hookHid.includes(t.id) && <HookStrip tab={t} onCopy={copy} onHide={() => setHookHid(h => [...h, t.id])} />}
                        {/* Send later's for this tab: its timers, also over the sidebar's foot */}
                        <LaterStrip tab={t} later={timers.filter(x => x.then === 'send' && x.tab === t.id)} onNow={ring} onEdit={x => setDialog({ sendLater: t.workspace, edit: x })} onCancel={x => setTimer(x, () => null)} />
                      </>
                    ))(byId(id))
                }
                onFocus={id => id !== tab?.id && selectTab(id)}
                hoverFocus={settings.hoverFocus !== false}
                onClose={id => byId(id) && closeTabs([byId(id)!])}
                onResize={(path, at) => setGroups(groups.map(g => (g === group ? resize(g, path, at) : g)))}
                startDrag={(e, id) => start(e, id, false)}
              />
            ) : (
              <div className="empty-wrap">
              {!(ws && ws.browser !== undefined) && <Backdrop kind={settings.backdrop} motion={settings.motion} />}
              <div className="empty">
                {ws ? (
                  ws.browser === undefined && <Ready name={wsName(ws)} branch={ws.kind === 'worktree' ? ws.branch : undefined} project={view.projects.find(p => p.id === ws.project)?.name} actions={newTabActions.filter(x => x.label !== 'Command…')} later={ws.pending && { title: `${ws.pending.agent} ${pendingWords(ws.pending, true).replace(/^S/, 's')}`, prompt: ws.pending.prompt, failed: ws.pending.failed, onStart: () => laterNow(ws), onChange: () => void laterChange(ws), onCancel: () => void laterCancel(ws) }} />
                ) : (
                  view.projects.some(p => !p.kind) || railKind !== 'projects' ? ( /* U4: Welcome until a project of yours, a Terminals tab of its own aside */
                    <>
                      {/* none picked: a fresh start, or the last of this rail kind went (the rail stays on it) */}
                      <p>{railKind === 'shells' ? 'No terminals open.' : railKind === 'browsers' ? 'No pages open.' : live.length ? 'No workspace selected.' : 'No workspaces yet.'}</p>
                      {railKind === 'shells' || railKind === 'browsers' ? <button className="primary" onClick={() => void quickNew(railKind)}>{railKind === 'shells' ? 'New terminal' : 'New browser'}</button> : <button className="primary" onClick={() => newWs()}>New workspace  ⌘N</button>}
                      <StarLaki />
                    </>
                  ) : (
                    <Welcome onOpen={openProject} onSsh={() => setDialog('project')} onClone={() => setDialog('clone')} onNew={hasCap(view, 'projectNew') ? () => setDialog('newProject') : undefined} check={() => api.call<Doctor>('doctor')} onRun={welcomeRun} onSample={hasCap(view, 'sample') ? welcomeSample : undefined} />
                  )
                )}
              </div>
              </div>
            )}
            {browsed.flatMap(id => {
              const w = live.find(x => x.id === id)
              return w?.browser !== undefined ? [<BrowserPane key={id} onGuest={g => (g ? guests.current.set(id, g) : guests.current.delete(id))} url={w.browser} hidden={id !== ws?.id || !!dialog} onPage={(url, title) => pageSeen(id, url, title)} onOpen={openExternal} onShot={r => (r.error ? toast(`No screenshot: ${r.error}`) : r.path ? toast(`Saved to Downloads: ${r.path.split('/').pop()}`, () => void bridge?.openPath?.(r.path!), 'Open', true) : done('Screenshot copied'))} />] : []
            })}
            {reviewOn && ws && <Suspense fallback={null}><FullReview key={ws.id} ws={ws.id} project={ws.project} base={ws.base} branch={ws.branch} pr={ws.pr} linked={ws.prLinked} empty={!ws.stat?.files} worktree={ws.kind === 'worktree'} api={reviewApi(ws)} stat={statKey} notesAt={ws.notesAt} caps={!settings.design || settings.design === 'classic' || settings.design === 'frosted'} onOpen={openExternal} onTight={() => setReviewTight(true)} next={() => (q => q[0] && { name: wsName(q[0]), files: q[0].stat?.files, pr: q[0].pr?.state === 'OPEN' ? `${prNo(q[0].pr)} ${q[0].pr.checks === 'pass' ? 'checks pass' : q[0].pr.checks === 'fail' ? 'checks fail' : 'in review'}` : 'no PR', more: q.length - 1, key: kh('reviewNext'), go: () => reviewGo(q[0]) })(reviewQueue(view, ws.id))} /></Suspense>}
          </div>
          {tabsAt === 'right' && <TabStrip app={app} />}
          {previewed && ws && (
            <div className={`pv-wrap ${previewW ? 'sized' : ''}`} style={previewW ? { width: previewW } : undefined}>
              <PanelHandle onWidth={w => setPreviewW(w || null)} init={0} />
              {wsFiles.length > 1 && (
                <div className="pv-tabs" role="tablist" aria-label="Open files">
                  {wsFiles.map(f => (
                    <div key={fileKey(f)} role="tab" aria-selected={f === previewed} className={`pv-tab ${f === previewed ? 'on' : ''}`} data-tip={`${f.ext ? `${view.widgets?.find(x => x.id === f.ext)?.name ?? f.ext} · ` : ''}${f.storage ? `Artifacts › ${f.path}` : f.path}`} onClick={() => setShownFile(m => ({ ...m, [ws.id]: fileKey(f) }))} onAuxClick={e => e.button === 1 && void closeFile(f)}>
                      {(x => (x ? <ExtGlyph w={x} size={12} /> : <Icon name="file" size={12} />))(f.ext && view.widgets?.find(x => x.id === f.ext))}
                      <span className="pv-tab-name">{f.path.split('/').pop()}</span>
                      {edited(f.edit) && <span className="pv-dirty" aria-label="unsaved" />}
                      <IconButton icon="x" title="Close" className="pv-tab-x" onClick={e => (e.stopPropagation(), void closeFile(f))} />
                    </div>
                  ))}
                </div>
              )}
            {previewed.ext ? (
              // a file opener's full view, its data what its action on this file kept
              // ponytail: one data per extension (per workspace): two files' tabs of one opener show the last one run
              (w => (
                <div className="preview">
                  <div className="pv-head">
                    {w ? <ExtGlyph w={w} /> : <Icon name="panel" />}
                    <span className="pv-path" data-tip={previewed.path}>
                      {w?.name ?? previewed.ext} <span className="muted">{previewed.path}</span>
                    </span>
                    {w && <span className="muted small pv-wide">{extStatus(w)}</span>}
                    <IconButton icon="x" title={kt('Close', 'closeTab')} onClick={closePreview} />
                  </div>
                  <div className="pv-body pv-ext">{w ? <WidgetBody w={w} full api={widgetApi} /> : <div className="muted small pad">That extension is gone (or off).</div>}</div>
                </div>
              ))((x => (x?.on ? inWs(x, ws.id) : undefined))(view.widgets?.find(x => x.id === previewed.ext)))
            ) : (
            <FilePreview
              key={previewed.n}
              path={previewed.path}
              line={previewed.line}
              load={() => api.call<FileContent>('fileRead', { ws: ws.id, path: previewed.path, storage: previewed.storage, media: true })}
              db={hasCap(view, 'file.db') ? q => api.call('dbRead', { ws: ws.id, path: previewed.path, storage: previewed.storage, ...q }) : undefined}
              onOpen={() => (previewed.storage ? panelApi(ws).artifacts?.open(previewed.path) : panelApi(ws).openFile(previewed.path))}
              onDefault={() => openIn('default', { ws: ws.id, file: previewed.path, storage: previewed.storage })}
              onEditor={previewed.storage ? () => openIn('editor', { ws: ws.id, file: previewed.path, storage: true }) : undefined}
              onReveal={() => openIn('finder', { ws: ws.id, file: previewed.path, storage: previewed.storage })}
              openLabel={previewed.storage ? 'Open' : undefined}
              readOnly={previewed.storage}
              onClose={closePreview}
              edit={previewed.edit}
              onEdit={edit => setOpenFiles(l => l.map(x => (x.ws === previewed.ws && fileKey(x) === fileKey(previewed) ? { ...x, edit } : x)))}
              save={(text, was, force) => api.call('fileWrite', { ws: ws.id, path: previewed.path, text, was, force })}
              comment={
                previewed.storage
                  ? undefined
                  : {
                      agent: panelApi(ws).agents[0]?.name,
                      // into the Review tab's Yours (its whole list, as the Review sets it): side RIGHT, quote as a diff line's
                      add: c => {
                        const note: ReviewNote = { id: crypto.randomUUID(), path: c.path, line: c.line, ...(c.startLine && { startLine: c.startLine }), side: 'RIGHT', body: c.body, quote: ` ${c.quote}` }
                        // an open Review tab takes it too (FullReview's laki-note), so its next save keeps it
                        return api.call<{ notes?: ReviewNote[] }>('reviewNotesGet', { ws: ws.id }).then(r => api.call('reviewNotesSet', { ws: ws.id, notes: [...(r?.notes ?? []), note] })).then(() => void window.dispatchEvent(new CustomEvent('laki-note', { detail: { ws: ws.id, note } })))
                      },
                      send: c => panelApi(ws).toAgent(fileNoteText(c), true),
                    }
              }
            />
            )}
            </div>
          )}
          {panelShown && !(reviewOn && reviewTight) && ws && ( // the right panel: Info, Files, Changes, Review, Preview (U6: not beside a Review tab too narrow for its diff)
            <SidePanel
              w={infoOf(ws)}
              git={git}
              tab={panelTab}
              onTab={setPanelTab}
              api={panelApi(ws)}
              sim={project?.config?.simulator ?? settings.simulator === true} /* the project's own over Settings' */
              turn={view.tabs.some(t => t.workspace === ws.id && t.changes)}
              float={bridge?.floatPanel ? { out: false, go: () => panelHost.float() } : undefined}
              width={panelW}
              onWidth={setPanelW}
              onClose={() => setPanelOpen(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onLog={c => ciLog(ws, c)}
              onAct={(act, method) => prAct(ws, act, method)}
              onLabel={labelApi(ws)}
              root={artsIn === ws.id ? 'artifacts' : 'ws'}
              onRoot={(r: FilesRoot) => setArtsIn(r === 'artifacts' ? ws.id : null)}
              ext={ownWidgets.filter(w => w.on && placesOf(w).includes('panel')).map(w => ({ id: `ext:${w.id}` as const, label: w.name, icon: <ExtGlyph w={w} size={14} />, body: <WidgetPanel w={w} api={widgetApi} /> }))}
              side={(t => t && <SideChat key={t.id} tab={t} onSent={done} />)(tab?.kind === 'agent' && tab.workspace === ws.id ? tab : view.tabs.find(t => t.workspace === ws.id && t.kind === 'agent'))}
              info={
                <InfoTab
                w={infoOf(ws)}
                onOpen={url => void openKeptLink(url).catch(fail) /* its .url links too: a file:/// one */}
                onToggle={(k, v) => setAuto(ws, k, v)}
                onFix={what => prFix(ws, what)}
                onLog={c => ciLog(ws, c)}
                onAct={(act, method) => prAct(ws, act, method)}
                onLabel={labelApi(ws)}
                onRename={() => setDialog({ renameWs: ws.id })}
                onAttach={attachable(ws) ? () => setDialog({ attachPr: ws.id }) : undefined}
                onCopy={copy}
                onWs={id => (setReveal(r => [...r, id]), setWsId(id))}
                onTab={(w, t) => (setReveal(r => [...r, w]), selectTab({ id: t, workspace: w }))}
                onPrimary={url => call('prAttach', { ws: ws.id, pr: url }).then(r => done(`PR #${(r as { number: number }).number} is this workspace's PR`), () => {})}
                onUnrelate={url => call('wsSet', { id: ws.id, unrelate: url }).catch(() => {})}
                onDetach={() => detachPr(ws)}
                sees={(['claude', 'codex'] as const).filter(a => !ws.host && view.tabs.some(t => t.workspace === ws.id && tabAgent(t, view.presets) === a))}
                onSees={a => setDialog({ sees: a, in: ws.project })}
                agentLog={hasCap(view, 'agent.log') ? () => call<AgentDid[]>('agentLog', { ws: ws.id }) : undefined}
                spend={hasCap(view, 'ws.spend') && !ws.host ? () => call<SpendView>('wsSpend', { ws: ws.id }) : undefined}
                tabName={id => view.tabs.find(t => t.id === id)?.name ?? id}
                onStorage={bridge?.openPath && ws.storage ? () => void bridge!.openPath!(ws.storage!).then(r => r === 'missing' && toast('Nothing kept yet: its folder is made with its first tab')) : undefined}
                />
              }
            />
          )}
        </div>
  )
}
