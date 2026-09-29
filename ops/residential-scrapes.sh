#!/bin/bash
# Residential-IP scrapes (UPSL standings + Massey college ratings), run by
# launchd on the Mac mini (ops/com.rankedxi.residential-scrapes.plist).
#
# upsl.com and masseyratings.com sit behind Cloudflare and challenge datacenter IPs, so this can't
# run in GitHub Actions. It runs from a residential IP in a DEDICATED clone
# (never the working copy), scrapes one division at a time at a human pace,
# and commits only the scraped source files. The scheduled GitHub refresh
# turns them into ratings (rate_upsl_standings.py, apply_massey.py) and its
# freshness gate opens an issue if any league is more than 4 days old — so a silent failure here
# still gets reported.
#
# A Cloudflare challenge is never worked around: both scrapers stop at the
# challenge page and that division/layer keeps its last good data.
# One-time install on the mini:
#   git clone https://github.com/jkientz-pixel/pyramid-app.git ~/rankxi-upsl-runner
#   /usr/bin/python3 -m venv ~/.venvs/rankxi-upsl
#   ~/.venvs/rankxi-upsl/bin/pip install playwright && ~/.venvs/rankxi-upsl/bin/python -m playwright install chromium
#   cp ~/rankxi-upsl-runner/ops/com.rankedxi.residential-scrapes.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.rankedxi.residential-scrapes.plist
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:$PATH
CLONE="$HOME/rankxi-upsl-runner"
PY="$HOME/.venvs/rankxi-upsl/bin/python"
log() { echo "$(date '+%F %T') $*"; }

cd "$CLONE" || { log "no clone at $CLONE"; exit 1; }
git fetch -q origin master && git reset -q --hard origin/master || { log "git sync failed"; exit 1; }

ok=0
for div in "Premier" "Division 1" "Division 2"; do
  if "$PY" scripts/scrape_upsl.py "$div"; then ok=$((ok + 1)); fi
  sleep 30
done
log "UPSL divisions refreshed: $ok/3"
# college ratings: in season Aug-Dec only (Massey keeps last season up otherwise)
case "$(date +%m)" in 08|09|10|11|12)
  "$PY" scripts/scrape_massey.py && log "Massey refreshed" || log "Massey partial/failed" ;;
esac

FILES="data/upsl.json data/massey_*.json"
if git diff --quiet -- $FILES; then
  log "no change"; exit 0
fi
git add $FILES
git -c user.name="scrape-bot" -c user.email="actions@github.com" \
  commit -q -m "chore: residential scrape refresh (UPSL $ok/3 divisions, Massey)"
for attempt in 1 2 3; do
  git pull -q --rebase origin master && git push -q origin HEAD:master && { log "pushed"; exit 0; }
  sleep 20
done
log "push failed"; exit 1
