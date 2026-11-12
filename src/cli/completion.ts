// laki completion zsh|bash|fish: a completion script, its words from USAGE (usage.ts completionWords) as this CLI has
// them; a workspace's, a project's or a profile's name from `laki _complete <kind> <prefix>`, which asks a running
// daemon and never starts one (main.ts)
import { completionWords } from '../shared/usage.ts'

const w = completionWords()
const cases = (pick: (c: string) => string[], line: (c: string, words: string) => string) =>
  w.commands
    .filter(c => pick(c).length)
    .map(c => line(c, pick(c).join(' ')))
    .join('\n')
const kinds = (k: 'ws' | 'project') => w.commands.filter(c => w.names[c] === k)

const zsh = () => `#compdef laki
# laki completion zsh: eval "$(laki completion zsh)" in ~/.zshrc (after compinit)
_laki() {
  local cmd=\${words[2]} cur=\${words[CURRENT]} prev=\${words[CURRENT-1]}
  if (( CURRENT == 2 )); then compadd -- ${w.commands.join(' ')}; return; fi
  if [[ $prev == --preset ]]; then compadd -- \${(f)"$(laki _complete profile "$cur" 2>/dev/null)"}; return; fi
  if [[ $cur == -* ]]; then
    case $cmd in
${cases(c => w.options[c], (c, o) => `      ${c}) compadd -- ${o} ;;`)}
    esac
    return
  fi
  if (( CURRENT == 3 )); then
    case $cmd in
${cases(c => w.subs[c], (c, s) => `      ${c}) compadd -- ${s} ;;`)}
    esac
  fi
  case $cmd in
    ${kinds('ws').join('|') || '_none_'}) compadd -- \${(f)"$(laki _complete ws "$cur" 2>/dev/null)"} ;;
    ${kinds('project').join('|') || '_none_'}) compadd -- \${(f)"$(laki _complete project "$cur" 2>/dev/null)"} ;;
  esac
}
compdef _laki laki
`

const bash = () => `# laki completion bash: eval "$(laki completion bash)" in ~/.bashrc
_laki() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]} cmd=\${COMP_WORDS[1]} words="" kind=""
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${w.commands.join(' ')}" -- "$cur")); return; fi
  if [ "$prev" = --preset ]; then COMPREPLY=($(laki _complete profile "$cur" 2>/dev/null)); return; fi
  case $cur in
    -*)
      case $cmd in
${cases(c => w.options[c], (c, o) => `        ${c}) words="${o}" ;;`)}
      esac
      COMPREPLY=($(compgen -W "$words" -- "$cur"))
      return ;;
  esac
  if [ "$COMP_CWORD" -eq 2 ]; then
    case $cmd in
${cases(c => w.subs[c], (c, s) => `      ${c}) words="${s}" ;;`)}
    esac
  fi
  case $cmd in
    ${kinds('ws').join('|') || '_none_'}) kind=ws ;;
    ${kinds('project').join('|') || '_none_'}) kind=project ;;
  esac
  COMPREPLY=($(compgen -W "$words" -- "$cur") $([ -n "$kind" ] && laki _complete "$kind" "$cur" 2>/dev/null))
}
complete -F _laki laki
`

const fish = () =>
  [
    '# laki completion fish: laki completion fish | source, in ~/.config/fish/config.fish',
    'complete -c laki -f',
    `complete -c laki -n __fish_use_subcommand -a '${w.commands.join(' ')}'`,
    ...w.commands.filter(c => w.subs[c].length).map(c => `complete -c laki -n '__fish_seen_subcommand_from ${c}' -a '${w.subs[c].join(' ')}'`),
    ...w.commands.flatMap(c => w.options[c].map(o => `complete -c laki -n '__fish_seen_subcommand_from ${c}' -l ${o.slice(2)}`)),
    ...(['ws', 'project'] as const).filter(k => kinds(k).length).map(k => `complete -c laki -n '__fish_seen_subcommand_from ${kinds(k).join(' ')}' -a '(laki _complete ${k} (commandline -ct))'`),
    "complete -c laki -n '__fish_seen_subcommand_from new' -l preset -x -a '(laki _complete profile (commandline -ct))'",
    '',
  ].join('\n')

export function completion(shell: string | undefined) {
  const f = { zsh, bash, fish }[shell as 'zsh']
  if (!f) throw new Error('laki completion zsh|bash|fish')
  return f()
}
