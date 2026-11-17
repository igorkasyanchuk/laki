// What an agent's environment holds back (settings.hideSecrets): names that look like secrets in the daemon's own
// environment (where Laki was started: a shell's exports, a launchd job's), never the values. Pure: test/units-more.test.ts.
// Settings' env, the project's and the profile's always pass (the user put them there), and so does the agent's own
// sign-in key (AGENT_KEY_ENV); a profile's envAllow lets more through by name.

// ponytail: names, not values: a secret under a plain name (DATABASE_URL with a password in it) passes
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
// pass: what goes on; held: the names kept back, sorted
export function envSplit(env: Record<string, string | undefined>, allow: readonly string[] = []): { pass: Record<string, string>; held: string[] } {
  const pass: Record<string, string> = {}
  const held: string[] = []
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (secretLooking(k) && !allow.includes(k)) held.push(k)
    else pass[k] = v
  }
  return { pass, held: held.sort() }
}
// what a profile's agent lets through: its own sign-in key and the profile's envAllow
export const envAllowOf = (agent: string | undefined, envAllow?: readonly string[]) => [...(AGENT_KEY_ENV[agent ?? ''] ?? []), ...(envAllow ?? [])]
