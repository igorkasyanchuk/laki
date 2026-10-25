// Settings' connect sections: phone pushes, tunnels, remote access and the simulators. Settings.tsx re-exports it.
import { ANSWER_WHY, answerOk, type NamedTunnel, type SimCheck, type SimDev, type Webhook, webhookUrl } from '../../shared/types'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Group, Says } from './SettingsKit'
import { Icon, IconButton, Switch } from './ui'
import { QR } from './Tunnel'

// the webhook's formats (Settings › Phone pushes): id, name, an example URL
const FORMATS: [NonNullable<Webhook['format']>, string, string][] = [
  ['ntfy', 'ntfy', 'https://ntfy.sh/a-topic-only-you-know'],
  ['slack', 'Slack', 'https://hooks.slack.com/services/…'],
  ['telegram', 'Telegram', 'https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>'],
  ['json', 'Generic JSON', 'https://example.com/hook'],
]

const DETAILS: [Webhook['detail'], string][] = [[undefined, 'The question and its choices'], ['titles', 'Only who needs you']]
export function WebhookSection({ w, onChange: put, test }: { w: Webhook; onChange: (w: Webhook) => void; test?: (w: Webhook) => Promise<unknown> }) {
  // a URL or format answers can't use (a public ntfy.sh topic) turns them off: the daemon refuses them on
  const onChange = (n: Webhook) => put(n.answer && !answerOk(n) ? { ...n, answer: false } : n)
  const tapOk = answerOk(w)
  const [said, setSaid] = useState('') // the last Send test's outcome
  const format = w.format ?? 'ntfy'
  let bad = '' // the daemon's own check, as you type
  try {
    if (w.url?.trim()) webhookUrl(w.url)
  } catch (e) {
    bad = (e as Error).message
  }
  return (
    <>
      <h2>Phone pushes</h2>
      <p className="muted small">
        Pushes to your phone when an agent waits for you or finishes, posted to this URL and nowhere else. ntfy: a topic's URL, which the ntfy app
        subscribes to; Slack: an incoming webhook; Telegram: your bot's whole sendMessage URL, chat_id included; generic JSON gets{' '}
        <code>{'{event, workspace, tab, agent, message, ts}'}</code>. Muted workspaces and tabs don't push.
      </p>
      <Group title="Where to">
      <div className="grid2">
        <label>
          Format
          <select value={format} onChange={e => onChange({ ...w, format: e.target.value as Webhook['format'] })}>
            {FORMATS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        URL
        <input className="mono" value={w.url ?? ''} placeholder={FORMATS.find(f => f[0] === format)?.[2]} spellCheck={false} onChange={e => onChange({ ...w, url: e.target.value })} />
      </label>
      {bad && <p className="muted small">{bad}</p>}
      </Group>
      <Group title="When">
      <div className="setting-box">
        <Switch className="switch-row" on={w.waiting !== false} onChange={v => onChange({ ...w, waiting: v })}>
          <Says title="Waiting for you" hint="A permission prompt or a question, with what it asks; once per wait" />
        </Switch>
        <Switch className="switch-row" on={w.done === true} onChange={v => onChange({ ...w, done: v })}>
          <Says title="Finished" hint="The end of a turn, with its last question if it asks one" />
        </Switch>
      </div>
      </Group>
      <Group title="What it sends" hint="It goes through the service you picked (ntfy, Slack, Telegram) and stays there">
      <div className="seg" role="radiogroup" aria-label="What it sends">
        {DETAILS.map(([v, label]) => (
          <button key={label} type="button" role="radio" aria-checked={w.detail === v} className={w.detail === v ? 'on' : ''} onClick={() => onChange({ ...w, detail: v, ...(v && { answer: false }) })}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {w.detail === 'titles'
          ? 'Only which agent, in which workspace, waits or is done. Nothing it shows: no question, no choices, no buttons.'
          : "The agent's name and workspace, the question it asks or its last question, and its numbered choices, as they are on its screen: a command or a file path may be among them."}
      </p>
      </Group>
      <Group title="Answers" hint="A waiting agent's choices go as text, unless it sends titles only. With this on, Telegram and ntfy get a button per choice (ntfy: the first 3)">
      <div className="setting-box">
        <Switch
          className="switch-row"
          on={!!w.answer}
          disabled={!w.answer && (!tapOk || w.detail === 'titles')}
          onChange={v => onChange({ ...w, answer: v, answerOff: undefined, replyTopic: w.replyTopic || (v ? [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14) : undefined) })}
        >
          <Says
            title="Answer from the phone"
            hint={`A tap picks that choice in an agent's question and a workflow's (its Ask you, a confirm, a stuck block), as a click here would: it can allow a command or an edit; typed answers only in Laki. Laki listens only while a pushed question waits (every 5 s, a day at most) and only while the same menu is on screen. ${format === 'telegram' ? "Telegram: taps from your bot's chat only." : format === 'ntfy' ? `ntfy: taps come back on a reply topic, signed by this Mac. ${tapOk ? 'Keep your topic hard to guess, with an access token.' : `${ANSWER_WHY}.`}` : 'Slack and JSON: the choices as text only.'}`}
          />
        </Switch>
        {w.answerOff && !w.answer && <p className="warn small">Laki turned this off as it updated: {ANSWER_WHY}, then turn it on again.</p>}
        {w.answer && format === 'ntfy' && w.replyTopic && URL.canParse(w.url?.trim() ?? '') && (
          <p className="muted small">
            Reply topic: <code>{(u => `${u.origin}${u.pathname.replace(/\/+$/, '')}-${w.replyTopic}`)(new URL(w.url!.trim()))}</code>
          </p>
        )}
      </div>
      </Group>
      {test && (
        <div className="row-buttons">
          <button type="button" disabled={!w.url?.trim()} onClick={() => (setSaid('Sending…'), test(w).then(() => setSaid('Sent: check your phone'), e => setSaid(`Didn't go: ${e.message}`)))}>
            Send test
          </button>
          {said && <span className="muted small">{said}</span>}
        </div>
      )}
    </>
  )
}
// Simulators: the side panel's Simulator tab (settings.simulator), and what an iOS Simulator or an Android emulator needs
// on this Mac (the daemon's sim check), each one missing with its fix to copy
export type SimApi = <T = unknown>(p: { op: string; device?: string; [k: string]: unknown }) => Promise<T>
const GOING_MAX = 180_000 // a start or stop not seen done by then: its button back

// Devices: every iOS Simulator and Android virtual device this Mac has, Start or Stop each (the daemon's sim devices,
// start, stop); the side panel's Simulator tab shows the running ones. While one starts or stops, the list again every
// 2 s until it says so
function SimDevices({ sim }: { sim: SimApi }) {
  const [devs, setDevs] = useState<SimDev[] | null>(null)
  const [why, setWhy] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [going, setGoing] = useState<Record<string, { op: 'start' | 'stop'; at: number }>>({})
  // a failure says why as the next list would (err is Start's and Stop's own)
  const load = () => sim<{ devices: SimDev[]; why: string[] }>({ op: 'devices' }).then(r => (setDevs(r.devices), setWhy(r.why)), e => (setDevs(d => d ?? []), setWhy([String(e?.message ?? e)])))
  useEffect(() => void load(), [])
  const waiting = Object.keys(going).length > 0
  useEffect(() => {
    if (!waiting) return
    let on = true
    let t: ReturnType<typeof setTimeout>
    const again = () => (t = setTimeout(() => void load().finally(() => on && again()), 2000)) // 2 s after the last came: none piled up
    again()
    return () => ((on = false), clearTimeout(t))
  }, [waiting])
  useEffect(() => {
    if (!devs) return
    setGoing(g => {
      const left = Object.fromEntries(Object.entries(g).filter(([id, w]) => Date.now() - w.at < GOING_MAX && devs.find(d => d.id === id)?.on !== (w.op === 'start')))
      return Object.keys(left).length === Object.keys(g).length ? g : left
    })
  }, [devs])
  const power = (d: SimDev) => {
    const op = d.on ? 'stop' : 'start'
    setErr('')
    setGoing(g => ({ ...g, [d.id]: { op, at: Date.now() } }))
    sim({ op, device: d.id }).then(load, e => (setErr(String(e?.message ?? e)), setGoing(({ [d.id]: _, ...g }) => g)))
  }
  const heads = (d: SimDev) => (d.on ? 'Running' : d.os === 'ios' ? (d.runtime ?? 'iOS') : 'Android')
  return (
    <Group
      title="Devices"
      hint="Start one and the side panel's Simulator tab shows it. More of them: Xcode › Window › Devices and Simulators (+), or Android Studio's Device Manager"
      act={
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      {err && <p className="warn small">{err}</p>}
      {why.map(w => (
        <p key={w} className="muted small">
          {w}
        </p>
      ))}
      {!devs ? (
        <p className="muted small">Looking…</p>
      ) : !devs.length ? (
        <p className="muted small">None on this Mac: install Xcode (its iOS Simulator) or Android Studio and make a virtual device there.</p>
      ) : (
        devs.map((d, i) => {
          const g = going[d.id]
          return (
            <Fragment key={d.id}>
              {heads(d) !== (i ? heads(devs[i - 1]) : '') && <div className="sim-dev-head">{heads(d)}</div>}
              <div className="sim-dev" data-on={d.on || undefined}>
                <Icon name={/ipad/i.test(d.name) ? 'tablet' : 'smartphone'} />
                <span className="sim-dev-name">
                  {d.name}
                  {d.on && <span className="muted"> · {d.runtime ?? 'Android'}</span>}
                </span>
                <button type="button" className={d.on ? '' : 'primary'} disabled={!!g} onClick={() => power(d)}>
                  {g ? (g.op === 'start' ? 'Starting…' : 'Stopping…') : d.on ? 'Stop' : 'Start'}
                </button>
              </div>
            </Fragment>
          )
        })
      )}
    </Group>
  )
}

export function SimSection({ sim, on, onOn }: { sim: SimApi; on: boolean; onOn: (v: boolean) => void }) {
  const [checks, setChecks] = useState<SimCheck[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState('') // the check whose fix was just copied
  const run = () => (setBusy(true), sim<{ checks: SimCheck[] }>({ op: 'check' }).then(r => (setChecks(r.checks), setErr('')), e => setErr(String(e?.message ?? e))).finally(() => setBusy(false)))
  useEffect(() => void run(), [])
  const again = (
    <button type="button" disabled={busy} onClick={run}>
      {busy ? 'Checking…' : 'Check again'}
    </button>
  )
  const list = (os: SimCheck['os']) =>
    checks?.filter(c => c.os === os).map(c => (
      <div key={c.id} className="sim-check" data-state={c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}>
        <Icon name={c.ok ? 'checkCircle' : c.warn ? 'alertCircle' : 'xCircle'} />
        <div>
          <div>
            {c.label} <span className="muted">· {c.says}</span>
          </div>
          {c.fix && (
            <div className="tunnel-code sim-fix">
              <code>{c.fix}</code>
              {!c.fix.includes('›') && <IconButton icon={copied === c.id ? 'check' : 'copy'} title={copied === c.id ? 'Copied' : 'Copy'} onClick={() => navigator.clipboard.writeText(c.fix!).then(() => (setCopied(c.id), setTimeout(() => setCopied(''), 2000)), e => setErr(String(e?.message ?? e)))} />}
            </div>
          )}
        </div>
      </div>
    ))
  return (
    <>
      <h2>Simulators</h2>
      <p className="muted small">An iPhone in the iOS Simulator or an Android emulator (or a phone on USB) in the side panel: its screen live, your clicks as taps, a screenshot into the prompt for the agent.</p>
      <Group title="Side panel">
        <div className="setting-box">
          <Switch className="switch-row" on={on} onChange={onOn}>
            <Says title="Simulator tab" hint="The side panel's Simulator: the running simulators and adb's devices, one picked. Start one under Devices below (or in Simulator or Android Studio). A project's settings can turn it on or off just there" />
          </Switch>
        </div>
      </Group>
      <SimDevices sim={sim} />
      {err && <p className="warn small">{err}</p>}
      <Group title="iOS" hint="Xcode's Simulator, on a Mac. idb adds taps, swipes and typing; without it the screen still shows" act={again}>
        {list('ios') ?? (busy && <p className="muted small">Checking…</p>)}
      </Group>
      <Group title="Android" hint="adb from Android Studio's SDK (Laki finds it there, no PATH needed), and an emulator or a phone with USB debugging on">
        {list('android') ?? (busy && <p className="muted small">Checking…</p>)}
      </Group>
    </>
  )
}

// Settings › Tunnels: Expose to the world's two kinds. A random address (cloudflared's quick tunnels, nothing to set up),
// and permanent ones: your named tunnel and the domain its hostnames go under (settings.tunnel), each step checked by
// the daemon (tunnelCheck) with the command that does it
export type TunnelCheck = { version?: string; cert: boolean; tunnel?: { id: string; name: string }; creds: boolean; why?: string; ok: boolean }
const DOMAIN_OK = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/ // the daemon's
// Tunnels and Remote access, each at the top of the other's section: which one does what, and a way over
function TwoWays({ here, other }: { here: 'tunnels' | 'remote'; other?: () => void }) {
  return (
    <div className="two-ways">
      <div className={here === 'tunnels' ? 'on' : ''}>
        <b>Tunnels</b>
        <span className="muted small">A workspace&rsquo;s dev server (a port) on the internet, for whoever you send the link: a client, a teammate, your phone trying the app.</span>
      </div>
      <div className={here === 'remote' ? 'on' : ''}>
        <b>Remote access</b>
        <span className="muted small">Laki itself, its terminals and agents, for you alone from a phone or another computer.</span>
      </div>
      <p className="muted small">
        Both run cloudflared on this Mac (Remote access can use Tailscale instead); each has its own link and its own lock.{' '}
        {other && (
          <button type="button" className="link" onClick={other}>
            {here === 'tunnels' ? 'Remote access' : 'Tunnels'} ›
          </button>
        )}
      </p>
    </div>
  )
}

// other: Settings › Remote access (none where that isn't shown)
export function TunnelsSection({ named, onNamed, check, other }: { named: NamedTunnel; onNamed: (n: NamedTunnel) => void; check: (n: NamedTunnel) => Promise<TunnelCheck>; other?: () => void }) {
  const [c, setC] = useState<TunnelCheck | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const seq = useRef(0) // the newest check's: an older one answering later is dropped
  const run = () => {
    const n = ++seq.current
    setBusy(true)
    // the name and domain as typed: Settings saves them a moment later
    void check({ name: named.name ?? '', domain: named.domain ?? '' })
      .then(r => n === seq.current && (setC(r), setErr('')), e => n === seq.current && setErr(String(e?.message ?? e)))
      .finally(() => n === seq.current && setBusy(false))
  }
  useEffect(() => void run(), [])
  const name = named.name?.trim() ?? ''
  const domain = named.domain?.trim().toLowerCase().replace(/^\.+|\.+$/g, '') ?? ''
  const steps: { id: string; ok: boolean; label: string; says: string; fix?: string }[] = c
    ? [
        { id: 'cf', ok: !!c.version, label: 'cloudflared', says: c.version ? `version ${c.version}` : 'not installed', fix: 'brew install cloudflared' },
        { id: 'cert', ok: c.cert, label: 'Signed in to Cloudflare', says: c.cert ? 'its certificate is in ~/.cloudflared' : 'it opens your browser: pick the domain the tunnels go under', fix: 'cloudflared tunnel login' },
        { id: 'tunnel', ok: !!c.tunnel, label: name ? `The tunnel ${name}` : 'A named tunnel', says: c.tunnel ? `in your account, ${c.tunnel.id}` : !name ? 'its name below' : c.why ?? 'not in your account yet', fix: `cloudflared tunnel create ${name || 'laki'}` },
        // two Macs on one tunnel are both its connectors: Cloudflare sends each visitor to either, whatever its ingress
        { id: 'creds', ok: c.creds, label: 'Its credentials on this Mac', says: c.creds ? `~/.cloudflared/${c.tunnel!.id}.json` : c.tunnel ? 'made on the Mac that created the tunnel: here, make one of its own and put its name above (two Macs on one tunnel share its visitors)' : 'made with the tunnel', fix: c.tunnel ? `cloudflared tunnel create ${name}-2` : undefined },
        { id: 'domain', ok: DOMAIN_OK.test(domain), label: 'Its domain', says: DOMAIN_OK.test(domain) ? `addresses like name.${domain}` : 'below: the one you picked at login, like example.com' },
      ]
    : []
  const first = steps.findIndex(x => !x.ok) // the next step: the one that shows its command
  const copy = (id: string, text: string) => navigator.clipboard.writeText(text).then(() => (setCopied(id), setTimeout(() => setCopied(''), 2000)), e => setErr(String(e?.message ?? e)))
  const code = (id: string, text: string) => (
    <div className="tunnel-code sim-fix">
      <code>{text}</code>
      <IconButton icon={copied === id ? 'check' : 'copy'} title={copied === id ? 'Copied' : 'Copy'} onClick={() => copy(id, text)} />
    </div>
  )
  const eg = DOMAIN_OK.test(domain) ? domain : 'example.com'
  // how to set one up, once: what the checks above look for, then using it
  const howto: [string, string, string?][] = [
    ['A domain on Cloudflare', "Add your domain to Cloudflare (the free plan does) and move its nameservers there, as Cloudflare's dashboard says: the records Laki adds live in its DNS."],
    ['Install cloudflared', "Homebrew, or Cloudflare's download.", 'brew install cloudflared'],
    ['Sign in', 'Your browser opens: pick that domain. Its certificate goes to ~/.cloudflared/cert.pem.', 'cloudflared tunnel login'],
    ['Make the tunnel', "Once: its credentials go to ~/.cloudflared/<id>.json. A second Mac makes its own under another name: two Macs on one tunnel share its visitors.", `cloudflared tunnel create ${name || 'laki'}`],
    ['Tell Laki', 'Its name and the domain above, until every check is green.'],
    ['Expose a port', `The globe beside a port in the status bar › Address › Permanent, a name (shop is shop.${eg}) › Expose permanently. It stays until you stop it, and comes back each time Laki starts.`],
    ['Keep it to you (optional)', "Cloudflare's dashboard › Zero Trust › Access › Applications › Add an application › Self-hosted: the address, and a policy that allows your email. Visitors sign in first."],
    ["When you're done with a name", `Stop leaves its DNS record, so the name stays yours: delete it in the dashboard's DNS records. A name is one word under the domain (shop.${eg}, not a.shop.${eg}): Cloudflare's free certificate covers only that.`],
  ]
  return (
    <>
      <h2>Tunnels</h2>
      <TwoWays here="tunnels" other={other} />
      <p className="muted small">The globe beside a port in the status bar puts your dev server on the internet through Cloudflare&rsquo;s cloudflared.</p>
      <Group title="A random address" hint="Nothing to set up: a new trycloudflare.com address each time, for 1, 8 or 24 hours or until you stop it, for anyone or only some emails">
        <p className="muted small">
          When cloudflared drops (the network, the Mac asleep), Laki starts it again, and brings it back after its daemon restarts; a random address is new each time, and
          a toast gives you the new one. Cloudflare offers these without an account and without any promise to keep them up.
        </p>
      </Group>
      <Group title="Permanent addresses" hint="Your own Cloudflare domain: a name per port that stays, comes back after restarts and runs until you stop it" act={<button type="button" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Check again'}</button>}>
        <label>
          <span>Named tunnel</span>
          <input className="mono" value={named.name ?? ''} placeholder="laki" spellCheck={false} onChange={e => onNamed({ ...named, name: e.target.value })} onBlur={run} />
        </label>
        <label>
          <span>Domain</span>
          <input className="mono" value={named.domain ?? ''} placeholder="example.com" spellCheck={false} onChange={e => onNamed({ ...named, domain: e.target.value })} onBlur={run} />
        </label>
        {err && <p className="warn small">{err}</p>}
        {steps.map((x, i) => (
          <div key={x.id} className="sim-check" data-state={x.ok ? 'ok' : i === first ? 'bad' : 'warn'}>
            <Icon name={x.ok ? 'checkCircle' : i === first ? 'xCircle' : 'alertCircle'} />
            <div>
              <div>
                {x.label} <span className="muted">· {x.says}</span>
              </div>
              {!x.ok && i === first && x.fix && code(x.id, x.fix)}
            </div>
          </div>
        ))}
        <p className="muted small">
          Laki adds a DNS record for each name (never over one that&rsquo;s there) and runs one cloudflared for all of them. A permanent address is public, and certificate logs
          make such names easy to find: protect it with Cloudflare Access in your dashboard (Zero Trust › Access) when it shouldn&rsquo;t be open.
        </p>
      </Group>
      <Group title="How to set one up" hint={c?.ok ? 'Done: every check above is green' : 'Once, about ten minutes, with a domain of yours'}>
        <ol className="tunnel-steps">
          {howto.map(([t, says, cmd], i) => (
            <li key={t}>
              <span className="ext-step-n">{i + 1}</span>
              <div>
                <b>{t}</b>
                <p className="muted small">{says}</p>
                {cmd && code(`how${i}`, cmd)}
              </div>
            </li>
          ))}
        </ol>
      </Group>
    </>
  )
}

// remote access: this app in a browser elsewhere, through cloudflared, for one email (open: none, anyone with the
// link, after a typed confirm; pin: Laki's PIN instead, shown here, typed on the page), or through tailscale serve for
// the tailnet's devices (via); no link yet: starting
export type Remote = { mail: string; open?: boolean; pin?: string; tries?: number; used?: boolean; until?: number; url?: string; link?: string; via?: 'tailscale'; funnel?: boolean; peers?: number }
export type RemoteApi = { state?: Remote; start: (hours: number, mail: string, open: boolean, pin: boolean, via?: 'tailscale', funnel?: boolean) => Promise<unknown>; stop: () => Promise<unknown>; copy: (text: string) => void; open: (url: string) => void }
const REMOTE_HOURS = [1, 2, 4, 8, 12, 24, 48, 72, 0] // the daemon's too; 0: forever
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/

const TRIES = [1, 2, 3, 5, 10] // wrong PINs before it stops (the daemon takes 1-10)
type RemoteAuth = 'email' | 'pin' | 'tailscale'
type RemoteOpts = { mail: string; auth: RemoteAuth; tries: number; tsPin: boolean; funnel: boolean }
const AUTHS: [RemoteAuth, string][] = [['email', 'Email (Cloudflare)'], ['pin', 'PIN (Laki)'], ['tailscale', 'Tailscale']]
// other: Settings › Tunnels (none where that isn't shown)
export function RemoteSection({ api, opts, set, other }: { api: RemoteApi; opts: RemoteOpts; set: (o: Partial<RemoteOpts>) => void; other?: () => void }) {
  const { mail, auth, tries, funnel } = opts
  const ts = auth === 'tailscale'
  const pin = auth === 'pin' || (ts && (opts.tsPin || funnel)) // Funnel: on the internet, so a PIN always
  const [hours, setHours] = useState(1)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState('') // no email: confirm, typed
  const r = api.state
  const open = !pin && !ts && !mail.trim()
  const shown = open ? REMOTE_HOURS.filter(h => h && h <= 24) : REMOTE_HOURS // without an email, 24 hours at most (the daemon's rule)
  const forHours = shown.includes(hours) ? hours : 24
  const ok = pin || ts || (open ? sure.trim().toLowerCase() === 'confirm' : ONE_MAIL.test(mail.trim()))
  const fail = (e: unknown) => setErr(String((e as Error).message ?? e))
  const start = async () => {
    if (busy || !ok) return
    setBusy(true)
    setErr('')
    await api.start(forHours, mail.trim(), open, pin, ts ? 'tailscale' : undefined, ts && funnel).then(() => setSure(''), fail) // the next start without an email asks again
    setBusy(false)
  }
  const stop = () => (setErr(''), api.stop().catch(fail))
  const ends = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <>
      <h2>Remote access</h2>
      <TwoWays here="remote" other={other} />
      <p className="muted small">
        This app in a browser on another computer or a phone: its terminals and agents, as if you sat here. cloudflared publishes Laki's daemon at a
        random trycloudflare.com address; Cloudflare lets in only the email below, with a one-time code it sends there, and the link carries a key of
        its own (without an email, that key is the only lock). With a PIN instead, there's no Cloudflare sign-in: the page asks for a PIN Laki shows
        here, and a wrong one (twice, unless you pick otherwise) stops remote access. The link opens once, in one tab. It stops after the time you pick (or never: Forever; without an email, 24 hours at most), when you
        stop it, or with the daemon, and a stopped link never works again. With Tailscale, tailscale serve publishes it on this Mac's name in your
        tailnet instead: only your tailnet's devices reach it, with the link's key.
      </p>
      <p className="warn-soft small">Whoever gets in has a shell on this Mac as you: use an address only you read.</p>
      {r?.link ? (
        <div className="remote-on">
          <QR text={r.link} label="the remote access link" />
          <div className="remote-side">
            <div className="tunnel-code">
              <code>{r.link}</code>
              <IconButton icon="copy" title="Copy the link" onClick={() => api.copy(r.link!)} />
              {!r.via && !r.used && <IconButton icon="link" title="Open (here: the link opens once)" onClick={() => api.open(r.link!)} />}
            </div>
            <p className={r.used ? 'warn-soft small' : 'muted small'}>
              {r.used ? 'Opened: the link works once, in one tab, and that tab stays in. For another device, stop remote access and start it again.' : 'The link opens once, in one tab: the page keeps its own key after that.'}
            </p>
            {r.via === 'tailscale' && (
              <p className={r.peers === 0 && !r.funnel ? 'warn-soft small' : 'muted small'}>
                {r.peers === 0 && !r.funnel ? 'No other device is on your tailnet right now, and this Mac can’t open its own Tailscale link (macOS keeps its tailnet address to itself). Put Tailscale on your phone or another computer, sign in with the same account, then open the link there.' : `Open it on ${r.funnel ? 'any device' : 'another device in your tailnet'}: this Mac can’t open its own Tailscale link. The first visit can take a few seconds (its HTTPS certificate).`}
              </p>
            )}
            {r.pin ? (
              <div className="remote-pin-box">
                <span className="small muted">PIN</span>
                <code className="remote-pin">{`${r.pin.slice(0, 3)} ${r.pin.slice(3)}`}</code>
                <span className="muted small">
                  The page asks for it. {r.tries === 1 ? 'One more wrong PIN stops' : `${r.tries} wrong PINs stop`} remote access. {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
                </span>
              </div>
            ) : r.via === 'tailscale' ? (
              <p className="muted small">
                Only devices in your tailnet reach it, with this link{r.peers ? ` (${r.peers} online now)` : ''}. {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
              </p>
            ) : r.open ? (
              <div className="remote-risk" role="alert">
                <b>Anyone with this link gets in.</b>
                <span className="small">
                  No email check: a shell on this Mac as you. Don't paste it where others read; stop it as soon as you're done.{' '}
                  {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
                </span>
              </div>
            ) : (
              <p className="muted small">
                Only <b>{r.mail}</b> gets in. Scan it with a phone, or send the link to yourself. {r.until ? `Ends ${ends(r.until)}.` : 'Runs until you stop it.'}
              </p>
            )}
            <div className="row">
              <button className="danger" onClick={stop}>
                Stop remote access
              </button>
            </div>
          </div>
        </div>
      ) : r ? (
        <>
          <p className="muted">Starting {r.via ? 'tailscale serve' : 'cloudflared'}… it takes a few seconds.</p>
          {r.open && <p className="field-err">Without an email: anyone with the link will get in.</p>}
          <div className="row">
            <button onClick={stop}>Cancel</button>
          </div>
        </>
      ) : (
        <form className="remote-form" onSubmit={e => (e.preventDefault(), start())}>
          <div className="field">
            <span>Sign in with</span>
            <div className="seg" role="radiogroup" aria-label="Sign in with">
              {AUTHS.map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={auth === v} className={auth === v ? 'on' : ''} onClick={() => set({ auth: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {ts && (
            <p className="muted small">
              tailscale serve publishes it at https://&lt;this Mac&gt;.&lt;your tailnet&gt;.ts.net, for your tailnet's devices only; open it on your
              phone or another computer with Tailscale on (this Mac can't open its own). It needs Tailscale here, connected, and HTTPS certificates on
              for the tailnet (its admin console › DNS). On Linux, once: <code>sudo tailscale set --operator=$USER</code>.
            </p>
          )}
          {ts && (
            <>
              <Switch on={funnel} onChange={v => set({ funnel: v })} tip="tailscale funnel: anyone on the internet with the link reaches it, then the PIN">
                Funnel: on the internet, not just your tailnet (needs Funnel on for your tailnet; a PIN always)
              </Switch>
              <Switch on={pin} onChange={v => set({ tsPin: v })} disabled={funnel} tip={funnel ? 'Funnel always asks for a PIN' : 'The page asks for a PIN Laki shows here'}>
                Ask for a PIN as well
              </Switch>
            </>
          )}
          {pin ? (
            <div className="field">
              <span>
                Wrong PINs before it stops <span className="muted">· a new PIN each start, shown here</span>
              </span>
              <div className="seg" role="radiogroup" aria-label="Wrong PINs before it stops">
                {TRIES.map(n => (
                  <button key={n} type="button" role="radio" aria-checked={n === tries} className={n === tries ? 'on' : ''} onClick={() => set({ tries: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : ts ? null : (
          <>
          <label>
            <span>
              Email <span className="muted">· the only one let in (optional, but leave it out only if you must)</span>
            </span>
            <input value={mail} inputMode="email" autoComplete="email" spellCheck={false} placeholder="you@example.com" onChange={e => set({ mail: e.target.value })} />
          </label>
          {!open && !ok && <span className="field-err">One email address, like you@example.com</span>}
          {open && (
            <div className="remote-risk" role="alert">
              <b>No email: anyone who gets the link gets in.</b>
              <span className="small">
                There's no Cloudflare sign-in then: the link alone opens a shell on this Mac as you, with your files, keys, and agents. A link in a chat,
                a screenshot or a browser's history is enough. Prefer an email; if you go on, pick a short time and stop it when you're done.
              </span>
              <label>
                <span className="small">
                  Type <b>confirm</b> to start without an email
                </span>
                <input value={sure} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="confirm" onChange={e => setSure(e.target.value)} />
              </label>
            </div>
          )}
          </>
          )}
          <div className="field">
            <span>For</span>
            <div className="seg" role="radiogroup" aria-label="For how long">
              {shown.map(h => (
                <button key={h} type="button" role="radio" aria-checked={h === forHours} className={h === forHours ? 'on' : ''} onClick={() => setHours(h)}>
                  {h ? `${h}h` : 'Forever'}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <button type="submit" className={open ? 'danger' : 'primary'} disabled={!ok || busy}>
              {busy ? 'Starting…' : open ? 'Start without an email' : ts ? (funnel ? 'Start on the internet, with a PIN' : `Start on your tailnet${pin ? ', with a PIN' : ''}`) : pin ? 'Start with a PIN' : 'Start remote access'}
            </button>
          </div>
        </form>
      )}
      {err && <p className="field-err">{err}</p>}
      {(r ? !r.via : !ts) && (
      <div className="remote-tip">
        <p className="muted small">
          Won't start, or Cloudflare's sign-in won't let you in? Run this once in a terminal: it signs cloudflared in to your Cloudflare account (a browser
          page opens to pick one), which can fix it.
        </p>
        <div className="tunnel-code">
          <code>cloudflared tunnel login</code>
          <IconButton icon="copy" title="Copy the command" onClick={() => api.copy('cloudflared tunnel login')} />
        </div>
      </div>
      )}
    </>
  )
}
