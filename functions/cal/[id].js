/* GET /cal/{team-id}.ics — subscribable calendar feed for a national team's
   schedule. Serves the same data/national_teams.json the app renders, so the
   feed updates whenever the data ships. Subscribe via webcal://rankedxi.com/cal/usmnt.ics
   (Apple/Outlook) or paste the https URL into Google Calendar "From URL".
   Time-TBA games become all-day events rather than inventing a kickoff —
   same rule as the in-app add-to-calendar button. Played games stay in the
   feed with the final score in the title, so a subscribed calendar doubles
   as a results history. */

const esc = s => String(s || '')
  .replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const tag = id => id === 'usmnt' ? 'USMNT' : id === 'uswnt' ? 'USWNT'
  : /^u\d+[mwbg]nt$/.test(id)
    ? 'USA ' + id.replace(/^u(\d+)([mwbg])nt$/, (s, n, g) => `U-${n}${(g === 'w' || g === 'g') ? 'W' : ''}`)
    : id.toUpperCase();

export async function onRequestGet({ request, env, params }) {
  const id = String(params.id || '').replace(/\.ics$/, '').toLowerCase();
  if (!/^[a-z0-9]{2,20}$/.test(id)) return new Response('not found', { status: 404 });

  const asset = await env.ASSETS.fetch(new URL('/data/national_teams.json', request.url));
  if (!asset.ok) return new Response('data unavailable', { status: 503 });
  const teams = ((await asset.json()).teams) || [];
  const team = teams.find(t => t.id === id);
  if (!team) return new Response('not found', { status: 404 });

  const t = tag(id);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Ranked XI//rankedxi.com//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(`${t} — Ranked XI`),
    'X-WR-CALDESC:' + esc(`${team.name} schedule & results, via rankedxi.com`),
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];

  const now = stamp(new Date());
  for (const m of team.matches || []) {
    const dt = new Date(m.start || '');
    if (isNaN(+dt)) continue;
    const ended = m.status === 'ENDED';
    const score = ended && Number.isInteger(m.us) && Number.isInteger(m.them)
      ? ` (${m.us}–${m.them})` : '';
    lines.push('BEGIN:VEVENT',
      'UID:' + String(m.start).replace(/\D/g, '') + '-' + id + '@rankedxi.com',
      'DTSTAMP:' + now);
    if (m.timeTBD) lines.push('DTSTART;VALUE=DATE:' + String(m.start).slice(0, 10).replace(/-/g, ''));
    else lines.push('DTSTART:' + stamp(dt), 'DTEND:' + stamp(new Date(+dt + 2 * 36e5)));
    lines.push('SUMMARY:' + esc(`${t} v ${m.opp}${score}`));
    const loc = [m.venue, m.city].filter(Boolean).join(', ');
    if (loc) lines.push('LOCATION:' + esc(loc));
    lines.push('DESCRIPTION:' + esc((m.round ? m.round + ' · ' : '') + 'via rankedxi.com'),
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${id}.ics"`,
      'cache-control': 'public, max-age=3600',
    },
  });
}
