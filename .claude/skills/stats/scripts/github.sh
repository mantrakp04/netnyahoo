#!/usr/bin/env bash
# GitHub side of the stats: repo, traffic (14 days), and downloads per release.
# usage: .claude/skills/stats/scripts/github.sh
set -euo pipefail
repo=mantrakp04/netnyahoo
cd "$(git rev-parse --show-toplevel)"

gh api "repos/$repo" -q '"stars \(.stargazers_count)  forks \(.forks_count)  open issues \(.open_issues_count)"'
gh api "repos/$repo/stargazers?per_page=100" -H "Accept: application/vnd.github.star+json" --paginate \
  -q '.[].starred_at[:10]' | sort | uniq -c | tail -5 | awk '{print "  stars on " $2 ": " $1}'
gh api "repos/$repo/traffic/views" -q '"repo views (14d) \(.count), \(.uniques) people"'
gh api "repos/$repo/traffic/clones" -q '"clones (14d) \(.count), \(.uniques) people"'
gh api "repos/$repo/traffic/popular/referrers" -q '.[] | "  from \(.referrer): \(.count) views, \(.uniques) people"'
echo
# Per version: DMG downloads (new), zip (Sparkle updates), appcast fetches; first launches need the key.
node scripts/update-checks.mjs "${1:-14}" 2>&1 | sed '/^Set POSTHOG/d'
