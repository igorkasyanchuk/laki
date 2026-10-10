# an author's open PRs in $WIDGET_REPO ($WIDGET_AUTHOR, a login; empty: you), as JSON: counts (open, drafts,
# conflicts, and the PRs with each of $WIDGET_LABEL1..3) and the PRs grouped by what they need. $WIDGET_ONLY and
# $WIDGET_HIDE: labels, comma-separated (only PRs with any of the first, none of the second)
# owner/name from what was typed: a link to the repo (or a page of it) works too; a GitHub Enterprise host stays
repo=$(printf %s "$WIDGET_REPO" | sed -E 's#^ +##; s# +$##; s#^https?://##; s#^(www\.)?github\.com/##; s#\.git$##; s#^(([^/]+\.[^/]+/)?[^/]+/[^/]+).*#\1#')
[ -n "$repo" ] || { echo 'Set Repo (owner/name) in Settings › Extensions' >&2; exit 1; }
author=$(printf %s "$WIDGET_AUTHOR" | tr -d ' ')
case "$author" in '' | @me) author=@me ;; @*) author=${author#@} ;; esac
exec gh pr list --repo "$repo" --author "$author" --state open --limit 100 \
  --json number,title,url,author,createdAt,isDraft,labels,reviewDecision,mergeable,statusCheckRollup \
  --jq 'def names(v): v // "" | split(",") | map(ascii_downcase) | map(select(. != ""));
  def has($l): any(.labels[]; (.name | ascii_downcase) == ($l | ascii_downcase));
  names(env.WIDGET_ONLY) as $only | names(env.WIDGET_HIDE) as $hide |
  [env.WIDGET_LABEL1, env.WIDGET_LABEL2, env.WIDGET_LABEL3 | . // "" | gsub("^\\s+|\\s+$"; "") | select(. != "")] as $count |
  [.[] | [.labels[].name | ascii_downcase] as $ls
    | select(($only | length) == 0 or any($ls[]; . as $l | $only | any(. == $l)))
    | select(any($ls[]; . as $l | $hide | any(. == $l)) | not)
    | ([.statusCheckRollup[]? | (.conclusion // .state // "")] as $s
      | if ($s | length) == 0 then "none"
        elif any($s[]; . == "FAILURE" or . == "ERROR" or . == "TIMED_OUT" or . == "CANCELLED" or . == "ACTION_REQUIRED" or . == "STARTUP_FAILURE") then "failing"
        elif all($s[]; . == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED") then "passing"
        else "pending" end) as $ci
    | {
      number, title, url, createdAt, draft: .isDraft, author: .author.login,
      labels: [.labels[] | {name, color}],
      ci: $ci, approved: (.reviewDecision == "APPROVED"), changes: (.reviewDecision == "CHANGES_REQUESTED"),
      conflict: (.mergeable == "CONFLICTING"),
      group: (if .isDraft then "draft" elif .mergeable == "CONFLICTING" then "conflict" elif $ci == "failing" then "failing"
        elif .reviewDecision == "CHANGES_REQUESTED" then "changes" elif .reviewDecision == "APPROVED" then "approved" else "review" end)
    }] as $prs
  | def n(f): [$prs[] | select(f)] | length;
  {
    stats: ([{name: "open", n: ($prs | length)}, {name: "drafts", n: n(.draft)}, {name: "conflicts", n: n(.conflict), bad: (n(.conflict) > 0)}]
      + [$count[] as $c | {name: $c, n: n(has($c)), color: (first($prs[].labels[] | select((.name | ascii_downcase) == ($c | ascii_downcase)) | .color) // "")}]),
    groups: [["conflict", "Conflicts"], ["failing", "Failing CI"], ["changes", "Changes asked"], ["approved", "Approved"], ["review", "In review"], ["draft", "Drafts"]
      | .[0] as $g | {name: .[1], prs: [$prs[] | select(.group == $g)]} | select(.prs | length > 0)]
  }'
