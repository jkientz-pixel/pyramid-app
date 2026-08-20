// Shot-map data proxy.
//
// American Soccer Analysis serves shot-level data for the six pro leagues the
// Player Simulator already uses, but it sends no CORS header — and our own CSP is
// connect-src 'self'. Both block a direct browser fetch, so the page calls
// here and this Function calls ASA server-side.
//
//   GET /api/shots?league=mls&season=2026   -> completed games, newest first
//   GET /api/shots?league=mls&game_id=<id>  -> every shot in one game
//
// Responses are cached at the edge: shot data for a finished match never
// changes, and ASA is a free community resource we shouldn't hammer.

const ASA = 'https://app.americansocceranalysis.com/api/v1'

// Allowlist, not passthrough — the league segment is interpolated into an
// outbound URL, so it must never carry user-controlled text.
const LEAGUES = {
  mls: 'MLS',
  nwsl: 'NWSL',
  uslc: 'USL Championship',
  usl1: 'USL League One',
  mlsnp: 'MLS Next Pro',
  usls: 'USL Super League',
}

const ID_RE = /^[A-Za-z0-9]{1,24}$/
const SEASON_RE = /^\d{4}$/

const GAMES_TTL = 60 * 30      // fixtures move; half an hour
const SHOTS_TTL = 60 * 60 * 24 // a finished match is immutable

const json = (body, status = 200, ttl = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
    },
  })

async function asa(path) {
  const res = await fetch(`${ASA}${path}`, {
    headers: { accept: 'application/json', 'user-agent': 'RankedXI/1.0 (+https://www.rankedxi.com)' },
  })
  if (!res.ok) throw new Error(`ASA ${res.status}`)
  return res.json()
}

// team_id -> display name, so the client never has to make a second call
async function teamNames(league) {
  const teams = await asa(`/${league}/teams`)
  const map = {}
  for (const t of teams) map[t.team_id] = t.team_name || t.team_short_name || t.team_id
  return map
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url)
  const league = (url.searchParams.get('league') || '').toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(LEAGUES, league)) {
    return json({ error: 'unknown league' }, 400)
  }

  const cache = caches.default
  const cacheKey = new Request(url.toString(), request)
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  try {
    const gameId = url.searchParams.get('game_id')

    if (gameId) {
      if (!ID_RE.test(gameId)) return json({ error: 'bad game_id' }, 400)
      const [shots, names] = await Promise.all([
        asa(`/${league}/games/shots?game_id=${gameId}`),
        teamNames(league),
      ])
      // Trim to what the map draws. The raw rows carry a dozen fields we'd
      // otherwise ship to every visitor for nothing.
      const out = shots.map(s => ({
        team: s.team_id,
        teamName: names[s.team_id] || s.team_id,
        player: s.shooter_player_name,
        // ASA sends the string "0" (not null) when a shot had no assist.
        assist: s.assist_player_name && s.assist_player_name !== '0' ? s.assist_player_name : null,
        minute: s.game_minute,
        x: s.shot_location_x,
        y: s.shot_location_y,
        endY: s.shot_end_location_y,
        xg: s.shot_xg,
        psxg: s.shot_psxg,
        goal: !!s.goal,
        ownGoal: !!s.own_goal,
        blocked: !!s.blocked,
        head: !!s.head,
        pattern: s.pattern_of_play,
        yards: s.distance_from_goal_yds,
      }))
      const res = json({ league, gameId, shots: out }, 200, SHOTS_TTL)
      await cache.put(cacheKey, res.clone())
      return res
    }

    const season = url.searchParams.get('season') || String(new Date().getUTCFullYear())
    if (!SEASON_RE.test(season)) return json({ error: 'bad season' }, 400)

    const [games, names] = await Promise.all([
      asa(`/${league}/games?season_name=${season}`),
      teamNames(league),
    ])
    const out = games
      .filter(g => g.status === 'FullTime')
      .map(g => ({
        id: g.game_id,
        date: g.date_time_utc,
        home: names[g.home_team_id] || g.home_team_id,
        away: names[g.away_team_id] || g.away_team_id,
        hs: g.home_score,
        as: g.away_score,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    const res = json({ league, leagueName: LEAGUES[league], season, games: out }, 200, GAMES_TTL)
    await cache.put(cacheKey, res.clone())
    return res
  } catch (err) {
    // Never leak the upstream URL or stack to the client.
    return json({ error: 'upstream unavailable' }, 502)
  }
}
