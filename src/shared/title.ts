// A window's title (Mission Control, the Window menu, Stage Manager, a screen share's picker, Linux's title bar): what
// the page says it shows (App: "<workspace> — <project>" or the page; a floated tab "<tab> — <workspace>"; the side
// panel "<its tab> — <workspace>"), cleaned: control characters out, 120 characters at most, "Laki" when empty. hide:
// Recording mode's private workspace and project names, each put as "Laki". The renderer sets it (document.title and
// the bridge's title) and main again on its way in (main/guards.ts re-exports it). Pure: test/main-guards.test.ts
export const TITLE_MAX = 120
export function titleOf(raw: unknown, hide: readonly string[] = []): string {
  let s = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
  for (const h of hide) if (typeof h === 'string' && h.trim()) s = s.split(h).join('Laki')
  s = s.replace(/\s+/g, ' ').trim()
  return [...s].slice(0, TITLE_MAX).join('').trim() || 'Laki'
}
type Veiled = { settings?: { recording?: boolean }; workspaces?: { name?: string; private?: boolean; project?: string; pr?: { title?: string } }[]; projects?: { id?: string; name?: string; private?: boolean }[] }
// the private names Recording mode hides, from a view: its workspaces' and projects', and a private workspace's PR title
// (a workspace named pr-42 shows it)
export const hiddenNames = (v?: Veiled | null) =>
  v?.settings?.recording ? [...(v.workspaces ?? []), ...(v.projects ?? [])].filter(x => x.private).flatMap(x => [x.name, 'pr' in x ? x.pr?.title : undefined]).filter((n): n is string => !!n) : []
// a workspace Recording mode hides (it or its project Private): its window's title is Laki's alone
export const veiledWs = (v: Veiled | null | undefined, w?: { private?: boolean; project?: string } | null) => !!v?.settings?.recording && !!w && (!!w.private || !!v.projects?.find(p => p.id === w.project)?.private)
