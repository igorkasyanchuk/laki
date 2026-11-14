// Ship's PR body from the repo's own template (core.ts prTemplate finds it): pure
// where each forge keeps it, the first that's there wins
export const PR_TEMPLATES = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'docs/PULL_REQUEST_TEMPLATE.md', 'pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md']
export const MR_TEMPLATES = ['.gitlab/merge_request_templates/Default.md']
export const TEMPLATE_MAX = 20 * 1024

// the template with its HTML comments gone and the summary under its first heading that reads like a description
// (What, Summary, Description, Changes), else before its first heading; its checklists as they are (unticked)
export function fillTemplate(template: string, summary: string): string {
  const lines = template
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const said = summary.trim()
  if (said) {
    const heading = (l: string) => /^\s{0,3}#{1,6}\s/.test(l)
    const at = lines.findIndex(l => heading(l) && /\b(what|summary|description|changes)\b/i.test(l))
    if (at >= 0) lines.splice(at + 1, 0, '', said)
    else {
      const first = lines.findIndex(heading)
      lines.splice(first < 0 ? 0 : first, 0, said, '')
    }
  }
  return lines
    .map(l => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
