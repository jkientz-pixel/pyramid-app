#!/bin/bash
# Rank XI dual deploy: GitHub (repo of record + legacy URL) + Cloudflare Pages (canonical)
set -e
cd "$(dirname "$0")"

# stamp one fresh cache-bust token across app.html/index.html/app.js/sw.js —
# replaces the manual ?v= sed ritual; preflight still verifies consistency
NEWV=$(python3 scripts/bump_version.py | tail -1 | awk '{print $NF}')

# regenerate the static SEO surface from current data: league landing pages,
# per-club share cards (og/ — must run before club pages so they can point
# og:image at the cards), per-club pages (club/), and the full sitemap
python3 scripts/gen_seo_pages.py
python3 scripts/gen_og_cards.py
python3 scripts/gen_club_pages.py

python3 scripts/preflight.py

git diff --quiet app.html index.html js/app.js sw.js || \
  git commit -m "chore: cache-bust v${NEWV}" -- app.html index.html js/app.js sw.js
git push

# Ship a staged tree, not the repo root. `wrangler pages deploy .` uploaded the
# scrapers and every raw scrape dump — including per-player names and birth years
# that the app never fetches — to public URLs. Only runtime assets go out.
# Stage path is fixed (not mktemp): wrangler.toml's pages_build_output_dir must
# name it so deploys pick up the functions/ dir and the D1 signups binding.
STAGE=".deploy-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

# 404.html must ship: its presence is what turns off the Pages SPA fallback,
# so bad URLs return a real 404 instead of the homepage with HTTP 200
cp -R app.html index.html 404.html npsl-rankings.html upsl-rankings.html \
      methodology.html privacy.html coach.html club .well-known \
      manifest.webmanifest sw.js robots.txt sitemap.xml _headers \
      js css crests fonts \
      icon-192.png icon-512.png apple-touch-icon.png og.png google-play-badge.png "$STAGE/"
# per-club share cards (skipped gracefully when gen_og_cards had no Pillow)
if [ -d og ]; then cp -R og "$STAGE/"; rm -f "$STAGE/og/.cards.json"; fi
# local editor/backup droppings must not reach production
find "$STAGE/js" "$STAGE/css" \( -name '*.bak' -o -name '*.tmp' \) -delete

# only the data files app.js actually fetches
mkdir -p "$STAGE/data"
for f in $(grep -ohE "(fetch|grab)\('data/[a-z0-9_.-]+" js/app.js | sed "s/.*'//" | sort -u); do
  cp "$f" "$STAGE/data/"
done

echo "staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1))"
# No directory arg: wrangler.toml supplies project name, output dir, functions/,
# and the D1 signups binding (bindings only apply when deploying via config).
npx -y wrangler@4.114.0 pages deploy --branch=master --commit-dirty=true
echo "Deployed: https://rank-xi.pages.dev"

# Post-deploy gate: a deploy that ships but serves 404s must fail loudly —
# the wire JSONs were 404 in production for days (staging grep missed grab()
# fetches) and nothing noticed. Verify against the project domain (custom
# domain adds redirects + edge cache); retry to ride out propagation lag.
# In the scheduled Action a non-zero exit here files the failure issue.
LIVE="https://rank-xi.pages.dev"
verify_url() {
  for i in 1 2 3 4 5; do
    curl -sfo /dev/null "$1" && return 0
    sleep 3
  done
  echo "DEPLOY VERIFY FAILED: $1" >&2
  return 1
}
vfail=0
curl -sfL "$LIVE/app.html" | grep -q "$NEWV" || \
  { echo "DEPLOY VERIFY FAILED: live app.html is not serving v$NEWV" >&2; vfail=1; }
for f in "$STAGE"/data/*.json; do
  verify_url "$LIVE/data/$(basename "$f")?v=$NEWV" || vfail=1
done
if [ "$vfail" -ne 0 ]; then
  echo "DEPLOY VERIFY FAILED — live site disagrees with what was staged" >&2
  exit 1
fi
echo "verified: v$NEWV live, $(ls "$STAGE"/data/*.json | wc -l | tr -d ' ') data files serving 200"
