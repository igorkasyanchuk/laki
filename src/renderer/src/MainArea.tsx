// the main area's children above the status bar: full screen's exit, the tab bar, the banners (an old daemon, a hung
// one, trouble, a broken worktree, a full disk, newer data, when done, old skills), Laki AI's glow, the lock and passkey
// cards, What's new, the body, the ask bar, a phone's key bar, the tab strip at the bottom, the pages; App's, from AppCtx
import type { AppCtx } from './appCtx'
import { AskWrap } from './Diff'
import { BarChoices, KeyBar, PeekGlow, staleDaemon, UnlockForm, WHEN_DONE_WORDS } from './AppParts'
import { CopyDiagnostics, WhatsNew } from './panels'
import { Countdown, Icon, IconButton, StaleDaemon } from './ui'
import { Pages } from './Dialogs'
import { TabBar, TabStrip } from './TabBar'
import { aiOn } from '../../shared/types'
import { api, bridge, passkeyReady, passkeySetUp } from './api'
import { version as appVersion } from '../../../package.json'
import { bodyOf } from './Body'
import { hasCap } from '../../shared/caps'
import { ruleFrom } from '../../shared/ask'
import { xterms } from './Term'

export function mainOf(app: AppCtx) {
  const { alwaysAllow, call, connected, fail, full, glow, hung, inReader, keyOffer, kt, listOff, locked, narrow, news, newsSeen, oldSkills, panelOpen, previewed, restartDaemon, reviewOn, setDialog, setGlow, setHung, setKeyOffer, setLink, setOldSkills, settings, setTroubleSeen, sideOpen, skillsLater, tab, tabsAt, toast, toggleFull, touch, troubleSeen, updateSkills, video, view, ws } = app
  return (
        <>
        {full && <IconButton icon="minimize" title={kt('Exit full screen', 'full')} className="full-exit" onClick={() => toggleFull(false)} />}
        <TabBar app={app} />
        {connected && staleDaemon(view) && <StaleDaemon restart={restartDaemon} />}
        {hung === 'yes' && (
          <div className="stale-bar soft" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>The daemon isn't answering.</b>{view.settings.ptyHost && !view.ptyHostOff && ' If you restart it, your terminals stay.'}
            </span>
            <button onClick={() => void bridge?.restartDaemon?.(true).then(ok => (ok ? setHung('no') : fail(new Error("the daemon didn't stop")))).catch(fail)}>Restart the daemon</button>
            <button onClick={() => setHung('waited')}>Wait</button>
          </div>
        )}
        {connected && view.trouble && view.trouble.at > troubleSeen && (
          <div className="stale-bar soft" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>Something went wrong inside Laki's daemon</b> ({view.trouble.n === 1 ? 'an error' : `${view.trouble.n} errors`} since it started; the last: {view.trouble.last}). It goes on running; a restart keeps your terminals.
            </span>
            <CopyDiagnostics />
            <button onClick={() => void restartDaemon().catch(fail)}>Restart the daemon</button>
            <IconButton icon="x" title="Dismiss" onClick={() => setTroubleSeen(view.trouble!.at)} />
          </div>
        )}
        {connected && ws?.broken && ( // T13: its worktree broke: what Laki found, and the repairs for that kind
          <div className="stale-bar" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>{ws.broken.kind === 'gone' ? "This workspace's worktree folder is gone." : ws.broken.kind === 'moved' ? 'The repo moved: this worktree lost its link to it.' : "This worktree isn't linked to its repo."}</b> {ws.broken.detail}.
              {ws.broken.remote ? ` Repair it on ${ws.host}: Laki only finds it there.` : ws.broken.kind === 'gone' ? ` Recreate checks out ${ws.branch} there again.` : ' Relink runs git worktree repair.'}
            </span>
            {!ws.broken.remote &&
              (([how, label]) => <button onClick={() => void api.call<{ lost?: string }>('wsRepair', { ws: ws.id, how }).then(r => toast(how === 'relink' ? 'Relinked' : r.lost ? `Recreated. Lost: ${r.lost}` : 'Recreated'), fail)}>{label}</button>)(ws.broken.kind === 'gone' ? ['recreate', 'Recreate'] : ['relink', 'Relink'])}
            {!ws.broken.remote && (
              <button className="ghost" onClick={() => void api.call<{ kept?: string }>('wsRepair', { ws: ws.id, how: 'forget' }).then(r => toast(r.kept ? `Archived. Its folder stays at ${r.kept}` : 'Archived. Its branch stays'), fail)}>
                Archive, keep the branch
              </button>
            )}
          </div>
        )}
        {connected && view.diskFull && (
          <div className="stale-bar" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>The disk is full.</b> Laki can't save its state ({Math.round(view.diskFull.free / 1e6)} MB free): it keeps it in memory and saves once there's room. Don't quit Laki until then.
            </span>
            <button onClick={() => setDialog({ section: 'resources' })}>What Laki holds</button>
          </div>
        )}
        {connected && view.newerData && (
          <div className="stale-bar" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>This data was written by a newer Laki.</b> This one may not keep what it added: a copy is in Laki's data folder as state.json.v{view.newerData}. Update Laki to the version you used last.
            </span>
          </div>
        )}
        {connected && view.whenDone && (
          <div className="stale-bar soft" role="alert">
            <Icon name={view.whenDone.act === 'lock' ? 'lock' : view.whenDone.act === 'sleep' ? 'moon' : 'power'} size={16} />
            <span>
              <b>Everything is done.</b> The Mac {WHEN_DONE_WORDS[view.whenDone.act]} in <Countdown to={view.whenDone.at} />.
            </span>
            <button onClick={() => void api.call('settingsSet', { whenDone: 'off' })}>Cancel</button>
          </div>
        )}
        {connected && !staleDaemon(view) && oldSkills.length > 0 && (
          <div className="stale-bar soft" role="status">
            <Icon name="import" size={16} />
            <span>
              <b>Laki's skill is out of date in {[...new Set(oldSkills.map(r => r.name))].join(', ')}.</b> Its agents read older commands and paths than this Laki's.
            </span>
            <button onClick={() => void updateSkills()}>Update</button>
            <button className="ghost" onClick={() => ((skillsLater.current = true), setOldSkills([]))}>
              Not now
            </button>
          </div>
        )}
        {glow && <PeekGlow key={glow.n} tab={glow.tab} onDone={() => setGlow(null)} />}
        {locked && connected && (
          // D6: locked again after its idle minutes: nothing comes until it unlocks, so nothing of it shows
          <div className="splash pinning lock-over">
            <UnlockForm pin={locked.pin} />
          </div>
        )}
        {keyOffer && (
          <div className="stale-bar soft" role="status">
            <Icon name="fingerprint" size={16} />
            <span>
              <b>Unlock Laki here with Face ID or Touch ID?</b> A passkey of this device's: each time you open Laki here, and after a while without using it.
            </span>
            <button onClick={() => void passkeySetUp().then(() => (setKeyOffer(false), toast('Passkey set up: this device unlocks with it')), e => (passkeyReady('passkeyOptions'), !/NotAllowed|cancel/i.test(String(e?.name ?? e?.message)) && toast(String(e?.message ?? e))))}>Set up</button>
            <button className="ghost" onClick={() => setKeyOffer(false)}>
              Not now
            </button>
          </div>
        )}
        {connected && news.length > 0 && <WhatsNew version={appVersion} lines={news} onTry={setLink} onAll={() => (newsSeen(), setDialog({ section: 'notes' }))} onClose={newsSeen} />}
        {bodyOf(app)}
        {tab?.ask && !tab.planAsk /* its plan card has them */ && !(inReader(tab.id) && !reviewOn && !(narrow && (panelOpen || previewed))) /* the Reader's own card has them, unless the review or a phone's panel is over it */ && !(app.needsShown && sideOpen && !video && !listOff) /* the sidebar's Needs you card has them */ && (
          // the waiting agent's menu as buttons (a phone's thumb, or no reaching for arrows): the daemon moves and presses ⏎
          <AskWrap key={`${tab.id}:${tab.ask.what}`} diff={tab.ask.diff} tab={tab.id} ask={tab.ask} explain={aiOn(settings) && hasCap(view, 'ask.explain') ? () => call('askExplain', { tab: tab.id }) : undefined}>{(chip, explain) => (
          <div className="ask-bar" data-dock="bottom">
            {tab.ask!.tool ? (
              // claude's permission ask (PermissionRequest): the tool and what it touches, the change it makes (chip)
              <>
                <span className="tag ask-tool">{tab.ask!.tool}</span>
                <span className="ask-what mono" data-tip={tab.ask!.what}>{tab.ask!.what}</span>
                {explain}
                {chip}
              </>
            ) : (
              <span className="muted">{tab.name} asks:</span>
            )}
            <BarChoices tab={tab} answer={(n, label, say) => void call('answer', { tab: tab.id, n, label, ...(say && { say }) }).catch(() => {})} />
            {tab.held ? (
              <span className="muted small" data-tip="Settings › the project › Always ask for: no rule answers it">
                Asked because it touches {tab.held}
              </span>
            ) : !view.managed?.allowRules && ruleFrom(tab.ask) && (
              <button className="link small" data-tip="A rule of the project's: the same ask from any agent here is answered Allow (Settings › the project › Auto-answer rules)" onClick={() => void alwaysAllow(tab).catch(() => {})}>
                Always allow here
              </button>
            )}
          </div>
          )}</AskWrap>
        )}
        {touch && tab && !(narrow && (panelOpen || previewed)) /* not under a panel */ && (
          <KeyBar onKey={data => api.send('input', { tab: tab.id, data: xterms.get(tab.id)?.modes.applicationCursorKeysMode ? data.replace(/^\x1b\[([ABCD])$/, '\x1bO$1') : data })} />
        )}
        {tabsAt === 'bottom' && <TabStrip app={app} />}
        <Pages app={app} />
        </>
  )
}
