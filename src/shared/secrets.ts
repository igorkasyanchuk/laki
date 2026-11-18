// Secrets by their shape: the patterns the daemon masks (share.ts' redact: a share, a phone push; findSecrets: Ship's
// check) and secretsIn, the prompt boxes' warning (PromptInput, the Reader's box, the quick bar, the phone): which of a
// text's spans look like a secret, and what kind. Pure: the window runs it, nothing leaves it for this
// L9: token-shaped strings masked in what a share shows (its page and Markdown) and a phone push says: API keys (sk-…,
// Stripe's, GitHub's, Slack's, Google's, npm's, Hugging Face's, AWS's key ids), a private key's PEM block, a Bearer
// token, a JWT, a token's, key's or secret's value in a URL, a URL's password, a NAME=value whose name says secret.
// ponytail: shapes, not every secret
export const SECRETS: [RegExp, string, string][] = [ // the pattern, what it's masked as, its kind (Ship's secret check)
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '••••', 'private key'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g, '••••', 'API key'],
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/'"<>]{1,256}:)[^\s@/'"<>]{1,256}@/gi, '$1••••@', 'password in a URL'], // bounded: an unbounded scheme or name backtracks over a long word (100 KB: seconds)
  [/\b([A-Z0-9_]{0,64}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY)[A-Z0-9_]{0,64}\s*[=:]\s*)(?:(['"])[^'"\n]{2,}\2|(?![\d.]+(?![^\s'"&]))[^\s'"&]{4,})/g, '$1••••', 'secret in a variable'], // an env var's way: in capitals; a number isn't one (MAX_TOKENS=4096)
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1••••', 'Bearer token'],
  [/(?<![\w-])eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '••••', 'JWT'], // at a run's start, not \b: after each - of eyJ-eyJ-… it scanned the rest again (100 KB: 3 s). ponytail: x-eyJ… stays
  [/([?&](?:token|access_token|key|api_key|apikey|secret|password|auth|sig|signature)=)[^&\s"'#<>]+/gi, '$1••••', 'token in a URL'],
]

// a prompt box's warning (secretHint.tsx): the spans that look like a secret, each its kind; conservative: a UUID, a git
// hash, a base64 picture (data:…;base64,) and a low-entropy value (password=changeme… is still one: a word, not a key)
// never match. Kinds: GitHub token, AWS access key, Slack token, OpenAI key, Anthropic key, private key, JWT, password,
// secret in a variable, Bearer token, token in a URL, password in a URL, API key (the rest)
export type SecretSpan = { kind: string; start: number; end: number }
const PAIR = /\b(?:password|passwd|pwd|pass|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret)\s*[=:]\s*(['"]?)([^\s'"&,;]{8,200})\1/gi // the generic "password=…" pairs, any case
const entropy = (s: string) => {
  const n = new Map<string, number>()
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1)
  return [...n.values()].reduce((h, k) => h - (k / s.length) * Math.log2(k / s.length), 0)
}
const strong = (v: string) => v.length >= 8 && entropy(v) >= 3 && /[A-Za-z]/.test(v) && /[\d_\-+/=!@#$%^*]/.test(v) // not a word: letters and digits or marks
function kindOf(kind: string, m: string) {
  if (kind !== 'API key') return kind
  return /^gh[pousr]_|^github_pat_/.test(m) ? 'GitHub token' : /^(AKIA|ASIA)/.test(m) ? 'AWS access key' : /^xox/.test(m) ? 'Slack token' : /^sk-ant-/.test(m) ? 'Anthropic key' : /^sk-(proj-)?/.test(m) ? 'OpenAI key' : kind
}
export function secretsIn(text: string): SecretSpan[] {
  const out: SecretSpan[] = []
  const free = (a: number, b: number) => !out.some(x => a < x.end && b > x.start)
  const pics = [...text.matchAll(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g)].map(m => [m.index!, m.index! + m[0].length] as const) // a pasted picture's bytes
  const inPic = (a: number) => pics.some(([x, y]) => a >= x && a < y)
  for (const [re, mask, kind] of SECRETS) {
    if (kind === 'secret in a variable') continue // PAIR below, with its entropy check
    for (const m of text.matchAll(re)) {
      // the value alone: a URL's ?token=, its user: and @, a Bearer stay as they are (what Pass as a secret replaces)
      const a = m.index! + (mask.startsWith('$1') ? m[1].length : 0), b = m.index! + m[0].length - (kind === 'password in a URL' ? 1 : 0)
      if (inPic(m.index!) || !free(a, b)) continue
      if ((kind === 'token in a URL' || kind === 'password in a URL') && !strong(text.slice(a, b))) continue
      out.push({ kind: kindOf(kind, m[0]), start: a, end: b })
    }
  }
  for (const m of text.matchAll(PAIR)) {
    const v = m[2]
    const a = m.index! + m[0].lastIndexOf(v), b = a + v.length
    if (inPic(a) || !free(a, b) || !strong(v) || /^[0-9a-f]{40}$/i.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) continue
    out.push({ kind: /pass|pwd/i.test(m[0]) ? 'password' : 'secret in a variable', start: a, end: b })
  }
  return out.sort((x, y) => x.start - y.start)
}
// what replaces a secret in a prompt as it's passed as one (the daemon's secretKeep made the file)
const noun = (kind: string) => (/password/.test(kind) ? 'password' : kind === 'private key' ? 'private key' : kind === 'secret in a variable' ? 'secret' : 'token')
export const secretLine = (path: string, kind: string) => `The ${noun(kind)} is in the file ${path}; read it from there and never print it.`
// a secret as a line may show it: its first 4 and last 3 characters
export const maskSecret = (v: string) => (v.length <= 10 ? '••••' : `${v.slice(0, 4)}…${v.slice(-3)}`)
// the text with each secret masked (a draft that's kept: secretHint's)
export const maskSecrets = (text: string) => secretsIn(text).reduceRight((t, s) => t.slice(0, s.start) + maskSecret(t.slice(s.start, s.end)) + t.slice(s.end), text)
