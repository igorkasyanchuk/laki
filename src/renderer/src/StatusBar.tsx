// the status bar (settings.statusBar, on unless false): under the terminals, or the wide one under everything (wideBar); App's, read from AppCtx
import type { AppCtx } from './appCtx'
import { type AgentUsage, ctxPct, ctxText, level, levelWord, UsageButton, usageText } from './Usage'
import { type AiCredits, aiOn, costWords } from '../../shared/types'
import { BgButton } from './BgTasks'
import { FLOW_ENDED } from '../../shared/workflow'
import { Icon, IconButton, MidText, Num } from './ui'
import { PRStatus } from './Info'
import { TunnelButton } from './Tunnel'
import { TurnButton } from './TurnStrip'
import { WidgetStrip } from './Widgets'
import { api, openExternal } from './api'
import { csWord, shortPath } from './text'
import { hasCap } from '../../shared/caps'
import { hhmm } from '../../shared/tray'
import { settingsOf, wsName } from './appCtx'

export function statusBarOf(app: AppCtx) {
  const { achAll, achKept, achMore, achN, AI_TIP, aiDock, aiFab, aiFloat, attachable, behindMenu, branchFull, call, cfgSheet, connected, costsOn, ctxOn, dialog, dock, fail, flowsOn, fly, footButtons, gallery, git, infoOf, kt, labels, limits, noBar, openMenu, openPort, ownWidgets, pageBar, ports, portStop, portUp, prMenu, problem, project, rail, readerApi, setAiFloat, setAuto, setBranchFull, setDialog, settings, shortBranch, tab, toAi, toggleArtifacts, toSettings, tracked, tunnelApi, turnApi, upd, view, wideBar, widgetApi, ws } = app
  return view && !(noBar && connected) && (ws?.browser === undefined || !connected || wideBar) && ( // a browser page: none, unless something's wrong (the wide bar: always)
        <div className={`status ${wideBar ? 'wide' : ''}`}>
          {wideBar && <span className="sb-foot">{footButtons(labels, true)}</span>}
          {/* V11: two groups, each a capsule over the bar (empty: none drawn) */}
          <span className="sb-group capsule">
          {ws && ws.browser === undefined && !pageBar && ( // a Browsers page: no port, branch or folder of its own
            <>
              {ctxOn && tab?.context && (
                // the focused tab's context: how full, so you compact or start a new chat in time
                // B7: a click lists the skills its chat loaded, in that order; one opens its SKILL.md
                <button
                  type="button"
                  className="sb-ctx"
                  aria-label={`${tab.name}'s context: ${ctxPct(tab.context)}%, ${levelWord(ctxPct(tab.context))}${tab.skills?.length ? `, ${tab.skills.length} skill${tab.skills.length === 1 ? '' : 's'} loaded` : ''}`}
                  data-tip={`${tab.name}'s context (${levelWord(ctxPct(tab.context))}): ${ctxText(tab.context)}${costsOn && tab.usage ? ` · its chat used ${usageText(tab.usage)} at API prices` : ''}${tab.skills?.length ? ` · skills loaded: ${tab.skills.map(s => s.name).join(', ')}` : ''} · /compact or a new chat before it fills · click: the skills it loaded`}
                  onClick={e =>
                    openMenu(e, [
                      { head: `Context · ${ctxText(tab.context!)}` },
                      { head: tab.skills?.length ? `Skills loaded (${tab.skills.length})` : 'No skills loaded yet' },
                      ...(tab.skills ?? []).map(s => ({ label: s.name, icon: 'bookOpen' as const, hint: s.path ? shortPath(s.path) : undefined, tip: 'Opens its SKILL.md in your editor', run: () => void call('skillOpen', { tab: tab.id, name: s.name }).catch(fail) })),
                    ])
                  }
                >
                  <span className={`usage-bar ${level(ctxPct(tab.context))}`}>
                    <i style={{ width: `${ctxPct(tab.context)}%` }} />
                  </span>
                  <Num value={`${ctxPct(tab.context)}%`} />
                  {!!tab.skills?.length && <span className="sb-skills" aria-hidden><Icon name="bookOpen" size={12} />{tab.skills.length}</span>}
                </button>
              )}
              {costsOn && ws.cost?.warn && (
                // #3: its agents' cost while a cost warning holds for it: yellow, then red past its amounts
                <span className="sb-cost" data-level={ws.cost.level} data-tip={costWords(ws.cost)}>
                  <Num value={`$${ws.cost.usd.toFixed(2)}`} />
                </span>
              )}
              {tab?.kind === 'agent' && tab.workspace === ws.id && settings.turnChanges !== false && <TurnButton key={tab.id} tab={tab} api={turnApi(ws.id)} onMenu={openMenu} /> /* F1: the focused agent's kept turns */}
              <BgButton tabs={view.tabs.filter(t => t.workspace === ws.id && t.preset === 'claude')} api={{ bgOutput: readerApi.bgOutput!, send: readerApi.send }} />
              {git && (
                // short (no branch prefix, cut), all of it on hover; a click shows it whole, its base too
                <button
                  className={`sb-branch ${branchFull ? 'full' : ''}`}
                  data-tip={`${ws.kind === 'worktree' ? `${ws.branch} ← ${ws.base}` : `${ws.branch}, the repo itself`} · click: ${branchFull ? 'shorter' : 'all of it'}`}
                  onClick={() => setBranchFull(f => !f)}
                >
                  <Icon name="fork" size={11} />
                  {branchFull ? ws.branch : <MidText text={shortBranch(ws.branch)} />}
                  {branchFull && ws.kind === 'worktree' && <span className="muted"> ← {ws.base}</span>}
                </button>
              )}
              {git && !!ws.stat?.behind && (
                // F8: its base has commits it hasn't (as this clone has the base: no fetch): Update merges it in, or rebases
                <button className="sb-behind" data-tip={`${ws.stat.behind} commit${ws.stat.behind > 1 ? 's' : ''} behind ${ws.base}${ws.stat.clean ? ': merging it in is clean' : ws.stat.clean === false ? ': merging it in conflicts' : ''} · click: update`} onClick={e => openMenu(e, behindMenu(ws))}>
                  ↓{ws.stat.behind}
                </button>
              )}
              {ws.codespace !== undefined && (
                // a cloud workspace: its codespace and its state (why it failed, cut: all of it on hover)
                <button className="sb-flow" data-status={ws.csState === 'Failed' ? 'failed' : ws.csState === 'Available' ? undefined : 'waiting'} data-tip={`Codespace ${ws.codespace || '(being made)'}: ${csWord(ws.csState)}${ws.csError ? ` · ${ws.csError}` : ''} · click: your codespaces on GitHub`} onClick={() => openExternal('https://github.com/codespaces')}>
                  <span className="sb-flow-icon">
                    <Icon name="cloud" size={12} />
                  </span>
                  <span className="sb-flow-name">
                    codespace<span className="muted"> · {csWord(ws.csState)}{ws.csState === 'Failed' && ws.csError ? `: ${ws.csError}` : ''}</span>
                  </span>
                </button>
              )}
              {(pj =>
                pj?.cfgWait && (
                  // its repo's .laki.json, not trusted as it is: its setup, scripts and env wait for you
                  <button className="sb-flow" data-status="waiting" data-tip="This repo's .laki.json isn't trusted yet: its setup, scripts and env wait · click: look at it" onClick={() => cfgSheet(pj)}>
                    <span className="sb-flow-icon">
                      <Icon name="shieldAlert" size={11} />
                    </span>
                    <span className="sb-flow-name">.laki.json waits for you</span>
                  </button>
                ))(view.projects.find(x => x.id === ws.project))}
              {(f =>
                f && (
                  // the workflow run that made this workspace, or sent the focused tab its last block: a click opens it
                  <button className="sb-flow" data-status={f.status} data-tip={`Workflow run: ${f.name} · ${f.status}${f.block ? ` at ${f.block}` : ''} · click: open it`} onClick={() => setDialog({ workflows: '', run: f.id })}>
                    <span className="sb-flow-icon">
                      <Icon name={f.status === 'running' ? 'gear' : 'flow'} size={12} />
                    </span>
                    <span className="sb-flow-name">
                      {f.name}
                      {f.block && ['running', 'waiting', 'paused'].includes(f.status) && <span className="muted"> · {f.block}</span>}
                    </span>
                  </button>
                ))(flowsOn ? ([tab?.flow, ws.flow].map(id => id && view.flows?.find(r => r.id === id)).find(Boolean) || view.flows?.find(r => r.ws === ws.id && !FLOW_ENDED.includes(r.status))) : undefined)}{/* the tab's run gone (past the 100 kept): the workspace's; else one going in it (a workspace you picked) */}
              <PRStatus w={infoOf(ws)} face={!ws.pr?.mine || settings.ownAvatar !== false} onOpen={openExternal} onToggle={(k, v) => setAuto(ws, k, v)} onMenu={e => openMenu(e, prMenu(ws))} />
              {attachable(ws) && ws.kind !== 'local' && (
                <button className="pr pr-attach" data-tip={`No PR found for ${ws.branch}: attach one by its URL or number`} onClick={() => setDialog({ attachPr: ws.id })}>
                  + PR
                </button>
              )}
              {ws.setup && <span className="warn-soft">setup running…</span>}
            </>
          )}
          {!!ws?.artifacts && ws.storage && !pageBar && ( // the files its agents keep for you ($LAKI_STORAGE_FOLDER): shown here; Finder and Files from the strip's ⋯
            <button
              className={`listen port-main ${gallery === ws.id ? 'on' : ''}`}
              data-tip={`${shortPath(ws.storage)}: what its agents keep for you ($LAKI_STORAGE_FOLDER) · ⌘⇧A`}
              onClick={toggleArtifacts}
            >
              Artifacts: {ws.artifacts}
            </button>
          )}
          </span>
          <span className="spacer" />
          <span className="sb-group capsule">
          {/* U3: the right end: the ports, then the plan's limits; left of the spacer what the open work is (branch, PR, checks) */}
          {ws && ws.browser === undefined && !pageBar && (
            <>
              {!project?.kind && ( // a terminal in your home folder: no $PORT of its own to show
              <span className="port-item">
                <button
                  className={`listen ${portUp ? '' : 'port-main'}`}
                  data-tip={`$PORT · ${portUp ? 'listening · ' : ''}open http://localhost:${ws.port}`}
                  onClick={() => openPort(ws.port)}
                >
                  $PORT {ws.port}
                  {ws.portNames?.[ws.port] && <span className="port-name">{ws.portNames[ws.port]}</span>}
                </button>
                <TunnelButton key={ws.id} port={ws.port} tunnel={ws.tunnels?.find(t => t.port === ws.port)} api={tunnelApi(ws)} />
                {portStop(ws, ws.port)}
              </span>
              )}
              {ports.map(port => (
                <span key={`${ws.id}:${port}`} className="port-item">
                  <button className="listen" data-tip={ws.ports.includes(port) ? `listening · open http://localhost:${port}` : 'not listening now'} onClick={() => openPort(port)}>
                    ↗{port}
                    {ws.portNames?.[port] && <span className="port-name">{ws.portNames[port]}</span>}
                  </button>
                  <TunnelButton port={port} tunnel={ws.tunnels?.find(t => t.port === port) /* an older daemon has none */} api={tunnelApi(ws)} />
                  {portStop(ws, port)}
                </span>
              ))}
            </>
          )}
          {tracked.length > 0 && ws?.browser === undefined && <UsageButton key={tracked.join()} asks={settings.usage} onAsk={agent => call('settingsSet', { usage: { ...settings.usage, [agent]: true } })} load={() => api.call<AgentUsage[]>('usage').then(limits)} credits={hasCap(view, 'ai.credits') ? () => api.call<AiCredits | null>('aiCredits') : undefined} onDays={() => setDialog('usage')} onUse={(agent, id) => call('settingsSet', { accountUse: { ...settings.accountUse, [agent]: id } }).catch(() => {})} today={costsOn && view.today ? { ...view.today, ws: view.today.ws.map(w => ({ ...w, name: (x => (x ? wsName(x) : 'a removed workspace'))(view.workspaces.find(x => x.id === w.ws)) })) } : undefined} /> /* remounts as agents are turned on or off */}
          {view.dnd && ( // U8: Quiet: until when; a click ends it now (its digest shows)
            <button className="sb-rec" data-tip="Quiet: no notifications, sounds, cards or phone pushes, but an important workspace's ask and laki alert's · click: end now, and see what happened meanwhile" onClick={() => void call('dndSet', { off: true }).catch(() => {})}>
              <Icon name="moon" size={11} />
              until {hhmm(view.dnd.until)}
            </button>
          )}
          {settings.recording && ( // Recording mode: private workspaces hidden until this is clicked
            <button className="sb-rec" data-tip="Recording mode: private workspaces and projects are hidden (they keep running). Click to show them" onClick={() => void call('settingsSet', { recording: false }).catch(() => {})}>
              <Icon name="lock" size={11} />
              Recording
            </button>
          )}
          {view.remote && ws?.browser === undefined && (
            <button
              className={`remote-badge ${view.remote.url ? '' : 'starting'} ${view.remote.open ? 'open' : ''} ${view.remote.check?.ok === false ? 'unreachable' : ''}`}
              data-tip={`${view.remote.check?.ok === false ? `Not reachable from outside (${view.remote.check.what}): ${view.remote.check.why} · ` : ''}${view.remote.open ? 'Remote access for anyone with the link (no email): Settings › Remote access' : `Remote access for ${view.remote.mail}: Settings › Remote access`}`}
              onClick={() => setDialog({ section: 'remote' })}
            >
              {!view.remote.url ? 'Remote starting…' : view.remote.open ? 'Remote: open to anyone with the link' : view.remote.until ? `Remote until ${new Date(view.remote.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Remote on'}
            </button>
          )}
          {!connected && <span className="warn" data-tip={problem}>{problem ? 'not connected: hover for why' : 'reconnecting…'}</span>}
          {upd?.latest && ( // a newer release: here until you update (Settings › General › Updates: its notes, Update)
            <button className={`sb-update ${upd.status === 'ready' ? 'sb-ready' : ''}`} data-tip={`Laki ${upd.version} → ${upd.latest.version}: what's new and Update in Settings › Updates`} onClick={() => setDialog({ section: 'general', spot: 'Updates' })}>
              <Icon name="download" size={11} />
              {view?.updateIdle ? 'Updates when idle' : upd.status === 'ready' ? 'Restart to update' : upd.status === 'downloading' ? `Downloading ${upd.latest.version}…` : `Update to ${upd.latest.version}`}
            </button>
          )}
          <WidgetStrip widgets={ownWidgets} api={widgetApi} place="status" />
          {!achKept.off && achN > 0 /* none yet: no 0/54 from the first second (⌘K and Settings › Achievements open it) */ && (
            <button className={`sb-trophy ${dialog === 'achievements' ? 'on' : ''}`} aria-label={`Achievements: ${achN} of ${achAll.length}`} data-tip={`Achievements: ${achN} of ${achAll.length} · click: what to try next`} onClick={() => setDialog(d => (d === 'achievements' ? null : 'achievements'))}>
              <Icon name="trophy" size={11} />
              {achN}/{achAll.length}
              {achMore > 0 && <b className="sb-new" data-tip={`${achMore} more unlocked`}>+{achMore}</b>}
            </button>
          )}
          {aiFab && aiDock && (
            // the AI button minimized: here until its right click puts it back
            <button
              className={`sb-ai ${aiFloat ? 'on' : ''} ${fly}`}
              data-tip={`${aiFloat ? 'Close Laki AI (Esc)' : 'Ask Laki AI about what is on screen'} · right click: float the button again`}
              onClick={() => setAiFloat(o => !o)}
              onContextMenu={e => openMenu(e, [{ label: 'Float the button again', icon: 'popOut', run: () => dock(false) }])}
            >
              <Icon name="ai" size={11} />
              AI
            </button>
          )}
          </span>
          {wideBar && !rail && ( // no rail: its AI and Settings at the end
            <span className="sb-foot">
              {aiOn(settings) && <IconButton icon="ai" title={AI_TIP} label={labels ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
              <IconButton icon="gear" title={kt('Settings', 'settings')} keyId="settings" label={labels ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </span>
          )}
        </div>
  )
}
