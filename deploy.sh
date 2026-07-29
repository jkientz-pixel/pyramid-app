#!/bin/bash
# Rank XI dual deploy: GitHub (repo of record + legacy URL) + Cloudflare Pages (canonical)
set -e
cd "$(dirname "$0")"

# stamp one fresh cache-bust token across app.html/index.html/app.js/sw.js —
# replaces the manual ?v= sed ritual; preflight still verifies consistency
NEWV=$(python3 scripts/bump_version.py | tail -1 | awk '{print $NF}')

python3 scripts/preflight.py

git diff --quiet app.html index.html js/app.js sw.js || \
  git commit -m "chore: cache-bust v${NEWV}" -- app.html index.html js/app.js sw.js
git push

# Ship a staged tree, not the repo root. `wrangler pages deploy .` uploaded the
# scrapers and every raw scrape dump — including per-player names and birth years
# that the app never fetches — to public URLs. Only runtime assets go out.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R app.html index.html npsl-rankings.html upsl-rankings.html \
      manifest.webmanifest sw.js robots.txt sitemap.xml _headers \
      js css crests \
      icon-192.png icon-512.png apple-touch-icon.png og.png "$STAGE/"
# local editor/backup droppings must not reach production
find "$STAGE/js" "$STAGE/css" \( -name '*.bak' -o -name '*.tmp' \) -delete

# only the data files app.js actually fetches
mkdir -p "$STAGE/data"
for f in $(grep -ohE "fetch\('data/[a-z0-9_.-]+" js/app.js | sed "s/.*'//"); do
  cp "$f" "$STAGE/data/"
done

echo "staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1))"
npx -y wrangler@4.114.0 pages deploy "$STAGE" --project-name=rank-xi --branch=master --commit-dirty=true
echo "Deployed: https://rank-xi.pages.dev"
