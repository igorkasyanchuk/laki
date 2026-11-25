// What an agent's environment holds back (settings.hideSecrets): variables in the daemon's own environment (where Laki
// was started: a shell's exports, a launchd job's) whose name looks like a secret's, or whose value is one (a password
// in a URL, a key's shape: secretValue), each with why; a value is never shown or logged. Pure: test/units-more.test.ts.
// Settings' env, the project's and the profile's always pass (the user put them there), and so does the agent's own
// sign-in key (AGENT_KEY_ENV); a profile's envAllow lets more through by name.
import { secretsIn } from './secrets.ts'

// Not caught: a secret under a plain name in no known shape (a random password alone, an in-house token format)
export const SECRET_ENV: RegExp[] = [/_TOKEN$/i, /AUTH_?TOKEN/i, /_SECRET/i, /^SECRET_/i, /_PASSWORD$/i, /_PASSWD$/i, /_KEY$/i, /^AWS_(SECRET|SESSION)/i, /_CREDENTIALS?$/i, /^NPM_TOKEN$/, /^GH_TOKEN$/, /^GITHUB_TOKEN$/, /^GITLAB_TOKEN$/, /_API_KEY$/i, /_PAT$/i]
// what looks like one but isn't: an agent's socket, a key's id or its file's path
const HARMLESS: RegExp[] = [/_SOCK$/i, /_KEY_?ID$/i, /_KEY_(FILE|PATH)$/i]
// the key each agent signs in with, from the environment: its own stays (a profile on an API key keeps working)
export const AGENT_KEY_ENV: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
}
export const secretLooking = (name: string) => SECRET_ENV.some(r => r.test(name)) && !HARMLESS.some(r => r.test(name))
// a value that is a secret whatever its name: a URL with a password in it (DATABASE_URL=postgres://user:pass@host/db),
// or one of secrets.ts' shapes (a token, a key)
export const URL_CREDS = /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i
export const secretValue = (v: string) => URL_CREDS.test(v) || secretsIn(v).length > 0
// why a value is one (the words Settings shows beside its name): a URL's password, else the shape secretsIn found
export const secretWhy = (v: string) => (URL_CREDS.test(v) ? 'a password in a URL' : (k => (k ? `looks like ${/^(an?|the) /i.test(k) ? k : `${/^[aeiou]/i.test(k) ? 'an' : 'a'} ${k}`}` : ''))(secretsIn(v)[0]?.kind))
// pass: what goes on; held: the names kept back, sorted; why: each one's reason (its name, or its value's shape). A
// name let through (allow: the agent's own sign-in key, a profile's Let through) passes whatever its value
export function envSplit(env: Record<string, string | undefined>, allow: readonly string[] = []): { pass: Record<string, string>; held: string[]; why: Record<string, string> } {
  const pass: Record<string, string> = {}
  const why: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    const w = allow.includes(k) ? '' : secretLooking(k) ? 'its name' : v.length < 20000 ? secretWhy(v) : ''
    if (w) why[k] = w
    else pass[k] = v
  }
  return { pass, held: Object.keys(why).sort(), why }
}
// what a profile's agent lets through: its own sign-in key and the profile's envAllow
export const envAllowOf = (agent: string | undefined, envAllow?: readonly string[]) => [...(AGENT_KEY_ENV[agent ?? ''] ?? []), ...(envAllow ?? [])]

// what a daemon must not keep of its starter's environment (daemon/starterEnv.ts drops them as it starts): a git hook's
// or a tool's git (another repo's GIT_DIR, its index, -c's), node --test's and npm run's (FORCE_COLOR, npm_*, INIT_CWD),
// a CI's. Not PATH, HOME, SSH_AUTH_SOCK, LANG, proxies or anything a profile sets on purpose
export const STARTER_ENV = /^(GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)|FORCE_COLOR|NO_COLOR|CI|INIT_CWD|npm_.*)$/
