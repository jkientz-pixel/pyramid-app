"""ESPN scoreboard date walking, shared by the fetch_* scripts.

On 2026-09-16 site.api.espn.com stopped accepting a YYYYMMDD-YYYYMMDD range in
?dates=. Every range, even one day wide, now answers 400 "Failed to get events
endpoint." (both refresh-rosters runs that day failed, e.g. run 35132844058).
Single days (YYYYMMDD), months (YYYYMM) and years (YYYY) still answer 200.

A month is not a safe unit for a bounded window: usa.ncaa.w.1 returns exactly
1000 events for September (the limit cap), and limit>1000 silently falls back
to the 25-event default. So a window is walked DAY BY DAY and merged, deduped
by event id. Months and years stay fine where a feed can never reach the cap
(the season race walks pro-league months; the Open Cup asks for its year).
"""
import time
from datetime import date, timedelta


def days(start, end):
    """Every YYYYMMDD from start to end inclusive."""
    a = date(int(start[:4]), int(start[4:6]), int(start[6:8]))
    b = date(int(end[:4]), int(end[4:6]), int(end[6:8]))
    while a <= b:
        yield a.strftime('%Y%m%d')
        a += timedelta(days=1)


def events_by_day(fetch, url_for, start, end, pause=0.2, retries=1):
    """{'events': [...]} for the window start..end, one request per day.

    `url_for(yyyymmdd)` builds the request, `fetch(url)` returns parsed JSON.
    A day that still fails after `retries` re-raises, so the caller's existing
    per-feed try/except sees a failed feed — a partial window must never pass
    for a complete one.
    """
    out, seen = [], set()
    for d in days(start, end):
        for attempt in range(retries + 1):
            try:
                data = fetch(url_for(d))
                break
            except Exception:
                if attempt == retries:
                    raise
                time.sleep(2)
        for e in data.get('events', []):
            eid = e.get('id')
            if eid in seen:
                continue
            seen.add(eid)
            out.append(e)
        time.sleep(pause)
    return {'events': out}
