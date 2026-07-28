#!/bin/bash
# Rank XI dual deploy: GitHub (repo of record + legacy URL) + Cloudflare Pages (canonical)
set -e
cd "$(dirname "$0")"

python3 scripts/preflight.py

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

# only the data files app.js actually fetches
mkdir -p "$STAGE/data"
for f in $(grep -ohE "fetch\('data/[a-z0-9_.-]+" js/app.js | sed "s/.*'//"); do
  cp "$f" "$STAGE/data/"
done

echo "staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1))"
npx -y wrangler@4.114.0 pages deploy "$STAGE" --project-name=rank-xi --branch=master --commit-dirty=true
echo "Deployed: https://rank-xi.pages.dev"
