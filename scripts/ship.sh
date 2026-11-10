#!/usr/bin/env bash
# One step to send a change live, safe with more than one person working (Nov 9: Nick and Amanda both ship).
#  1. commits your work, 2. brings in everyone else's latest changes first (rebase onto origin/main),
#  3. bumps APP_VERSION by one from the NEWEST number (1.3.207 -> 1.3.208), 4. pushes to main (Vercel deploys main).
# If someone pushed in the meantime it simply tries again (up to 5 times). If both of you changed the same lines it
# stops, undoes nothing of yours, and says which files: ask Claude to merge them, then ship again.
# Usage: bash scripts/ship.sh "What changed"   (set CLAUDE_SESSION_URL to add the session line to the commit)
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:?say what changed}"
trailer="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
[ -n "${CLAUDE_SESSION_URL:-}" ] && trailer="$trailer
Claude-Session: $CLAUDE_SESSION_URL"

# 1. your work as one commit (no version yet)
git add -A
if ! git diff --cached --quiet; then git commit -q -m "$msg"
elif [ -z "$(git log --oneline origin/main..HEAD 2>/dev/null)" ]; then echo "Nothing to ship: no changes."; exit 0; fi

for try in 1 2 3 4 5; do
  # 2. everyone else's latest first
  timeout 100 git fetch -q origin main
  if ! git rebase -q FETCH_HEAD; then
    echo "STOPPED: your change and someone else's both touched:"; git diff --name-only --diff-filter=U | sed 's/^/  - /'
    git rebase --abort || true
    echo "Nothing was pushed and your work is safe. Ask Claude to merge these, then run ship again."; exit 1
  fi
  # 3. the next version after the newest one
  cur=$(grep -oE 'APP_VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' lib/version.ts | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  major=${cur%.*}; minor=${cur##*.}
  next=$(printf "%s.%03d" "$major" $((10#$minor + 1)))
  sed -i "s/APP_VERSION = \"$cur\"/APP_VERSION = \"$next\"/" lib/version.ts
  git add lib/version.ts
  git commit -q --amend -m "$msg ($next)

$trailer"
  # 4. send it
  if timeout 100 git push -q origin HEAD:main; then git log --oneline -1; exit 0; fi
  echo "Someone shipped at the same moment; taking theirs and trying again ($try)…"
  # take the version bump back out so the next try numbers after theirs
  git checkout -q HEAD~1 -- lib/version.ts; git add lib/version.ts; git commit -q --amend -m "$msg"
done
echo "Couldn't push after 5 tries. Nothing is lost; run ship again."; exit 1
