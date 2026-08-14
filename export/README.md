# Ranked XI club export

Every club on the US soccer pyramid as mapped by [Ranked XI](https://www.rankedxi.com) — 3,974 clubs across pro, amateur, college, and youth levels, men's and women's sides both. Built for Football Manager database creators, mapmakers, and anyone else who needs the real club list with real geography.

**Snapshot date: 2026-08-14.** This is a point-in-time copy, not a live feed. The app updates several times a week; this file doesn't. A fresh copy is always at [rankedxi.com/data](https://www.rankedxi.com/data).

## Files

- `rankedxi-clubs.csv` — one row per club
- `rankedxi-clubs.json` — same data plus a `meta` block

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable slug, matches the club's page at `rankedxi.com/club/<id>` |
| `name` | Club name |
| `league_code` / `league` | League the club plays in |
| `level` | `pro`, `amateur`, `college`, or `youth` |
| `gender` | `M` or `W` |
| `city`, `state` | Home city and state |
| `lat`, `lon` | Coordinates (home ground where verified) |
| `location_accuracy` | `verified` or `approximate` |
| `rating` | Elo-style rating on the snapshot date; blank = unrated |
| `rating_basis` | `real_results`, `standings`, or `results_model` — how that rating was built (see [methodology](https://www.rankedxi.com/methodology)) |
| `website` | Club's own site |
| `crest_url` | Crest as displayed on Ranked XI, for identification |

Youth clubs are organization listings only — no ratings, no player data, ever.

## What's not included

Rosters and crest image files. Roster data reaches Ranked XI through league feeds with their own terms, and crest artwork belongs to the clubs; neither is ours to redistribute in bulk.

## License

The club data in this export is released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): free to use and adapt with attribution to **Ranked XI (rankedxi.com)**. Club names and crests remain the property of their owners and appear for identification only.

Found an error? Every club page on the site has a "suggest a fix" button, or email hello@rankedxi.com.
