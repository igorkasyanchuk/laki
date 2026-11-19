// Settings › Terminal › Shell (settings.termShell): the shell Laki's shell tabs start, by its full path. Only shells whose
// quoting Laki knows (a {{variable}} typed into one: core.ts varsIn), each of which takes -l: the POSIX family, fish and
// nushell. Pure: test/units-more.test.ts
export const SHELL_KINDS: Record<string, 'posix' | 'fish' | 'nu'> = { sh: 'posix', bash: 'posix', zsh: 'posix', dash: 'posix', ksh: 'posix', mksh: 'posix', yash: 'posix', fish: 'fish', nu: 'nu' }
export const shellKind = (path: string): 'posix' | 'fish' | 'nu' | undefined => SHELL_KINDS[path.split('/').pop() ?? '']
// a value as one word of that shell: POSIX single quotes ('\'' inside); fish's, where \ and ' are escaped inside; nu's
// double-quoted string (JSON's escapes; no $ or ( is read in one without the $ before it)
export function shellWord(v: string, kind: 'posix' | 'fish' | 'nu' = 'posix'): string {
  if (kind === 'fish') return `'${v.replace(/[\\']/g, '\\$&')}'`
  if (kind === 'nu') return JSON.stringify(v)
  return `'${v.replace(/'/g, `'\\''`)}'`
}
// where the shells may be beyond /etc/shells: Homebrew's (Apple silicon, Intel) and Nix's
export const SHELL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/run/current-system/sw/bin']
