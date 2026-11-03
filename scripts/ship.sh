#!/usr/bin/env bash
# One step to send a change live: bumps APP_VERSION by one (1.2.008 -> 1.2.009), commits everything with the
# message given, and pushes to main (Vercel deploys main). Usage: bash scripts/ship.sh "What changed"
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:?say what changed}"
cur=$(grep -oE 'APP_VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' lib/version.ts | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
major=${cur%.*}; minor=${cur##*.}
next=$(printf "%s.%03d" "$major" $((10#$minor + 1)))
sed -i "s/APP_VERSION = \"$cur\"/APP_VERSION = \"$next\"/" lib/version.ts
git add -A
git commit -q -m "$msg ($next)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01USnzAy28BuCVyhgCQyyvnV"
timeout 100 git fetch -q origin main
git rebase -q FETCH_HEAD
timeout 100 git push -q origin HEAD:main
git log --oneline -1
