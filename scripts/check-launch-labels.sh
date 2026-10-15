#!/usr/bin/env bash
# Every open issue carries EXACTLY ONE launch label: pre-launch or post-launch
# (CLAUDE.md, Issue Tracking). This lists the open issues that break that rule —
# neither label, or both — and exits 1 if there are any.
#
# Run locally:  bash scripts/check-launch-labels.sh
# Run in CI:    .github/workflows/launch-labels.yml (scheduled + on demand)
#
# The summary line is derived from the list it summarises, never written ahead
# of it (CLAUDE.md: a message that states a finding must be produced by the
# thing that found it). An empty list is only believed if the issue count it was
# drawn from is not zero, so a failed or empty listing cannot read as "all good".
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
repo_flag=()
if [ -n "$repo" ]; then repo_flag=(--repo "$repo"); fi

total=$(gh issue list "${repo_flag[@]}" --state open --limit 1000 --json number --jq 'length')
if [ "$total" -eq 0 ]; then
  echo "::error::The open-issue listing came back empty; refusing to report no offenders."
  exit 1
fi

offenders=$(gh issue list "${repo_flag[@]}" --state open --limit 1000 --json number,title,labels --jq '
  .[]
  | ([.labels[].name] | map(select(. == "pre-launch" or . == "post-launch")) | length) as $n
  | select($n != 1)
  | "#\(.number)\t\(if $n == 0 then "no launch label" else "both launch labels" end)\t\(.title)"')

count=$(printf '%s' "$offenders" | grep -c . || true)
echo "Open issues checked: $total. Missing or doubled launch label: $count."

if [ "$count" -gt 0 ]; then
  printf '%s\n' "$offenders"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### $count open issue(s) without exactly one launch label"
      echo
      echo "Each open issue needs exactly one of \`pre-launch\` / \`post-launch\` (CLAUDE.md, Issue Tracking)."
      echo
      echo "| Issue | Problem | Title |"
      echo "|---|---|---|"
      printf '%s\n' "$offenders" | awk -F'\t' '{ printf "| %s | %s | %s |\n", $1, $2, $3 }'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
fi
