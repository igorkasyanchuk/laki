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
