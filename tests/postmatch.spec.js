// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoRoute } = require('./helpers');

/* The post-match panel under every result: three tiers by what data exists,
   toggle chips that switch sets of shots off, an xG race that follows the
   same filters, and a shareable #/shots deep link carrying the filter state.
   /api/shots and the wire/box-score feeds are stubbed so the run is offline
   and deterministic. */

const WIRE = [
  // shots tier: an ASA league row with a game id
  { d: '2026-08-16', lg: 'mls', gid: 'GAME1', t1: 'Home City FC', t2: 'Away Town FC', s1: 2, s2: 3, dr: -9, ph: 0.61, gp: 12 },
  { d: '2026-08-15', lg: 'mls', gid: 'GAME1', t1: 'Atlanta United', t2: 'Away Town FC', s1: 2, s2: 3, dr: -7, ph: 0.55, gp: 12 },
  // result tier: NPSL has no shot data and no box score
  { d: '2026-08-15', t1: 'Amateur United', t2: 'Village Rovers', s1: 1, s2: 0, dr: 6, ph: 0.48, gp: 5 },
];
const STATS = [{
  lg: 'mls', date: '2026-08-16', eid: '1', venue: 'Stub Park', att: 1000,
  h: { n: 'Home City FC', g: 2, s: { pos: 55, sh: 3, sot: 2, ck: 4 } },
  a: { n: 'Away Town FC', g: 3, s: { pos: 45, sh: 4, sot: 3, ck: 2 } },
}, {
  // a real club id so the club page picks the row up and pre-opens it
  lg: 'mls', date: '2026-08-15', eid: '2', venue: 'Stub Park',
  h: { n: 'Atlanta United', id: 'atlanta-united', g: 2, s: { pos: 50, sh: 3 } },
  a: { n: 'Away Town FC', g: 3, s: { pos: 50, sh: 4 } },
}];
const shot = (o) => ({
  team: 'H', teamName: 'Home City FC', player: 'A Player', assist: null, minute: 10, period: 1,
  x: 88, y: 50, endY: 50, xg: 0.2, psxg: 0, goal: false, ownGoal: false,
  blocked: false, head: false, cross: false, through: false, pattern: 'Regular', yards: 12, ...o,
});
const SHOTS = { league: 'mls', gameId: 'GAME1', shots: [
  shot({ goal: true, xg: 0.5, psxg: 0.8, minute: 12, player: 'Home Scorer', head: true }),
  shot({ goal: true, xg: 0.3, psxg: 0.6, minute: 40, player: 'Home Second' }),
  shot({ blocked: true, xg: 0.05, minute: 55, period: 2 }),
  shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.4, psxg: 0.7, minute: 20, player: 'Away One' }),
  shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.6, psxg: 0.9, minute: 60, period: 2, player: 'Away Two' }),
  shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.1, psxg: 0.3, minute: 80, period: 2, player: 'Away Three', pattern: 'Corner' }),
  shot({ team: 'A', teamName: 'Away Town FC', xg: 0.25, minute: 85, period: 2, player: 'Away Miss' }),
] };
const GAMES = { league: 'mls', leagueName: 'MLS', season: '2026',
  games: [{ id: 'GAME1', date: '2026-08-16 22:00:00 UTC', home: 'Home City FC', away: 'Away Town FC', hs: 2, as: 3 }] };

async function stub(page) {
  const j = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/data/wire_npsl.json**', r => j(r, [WIRE[2]]));
  await page.route('**/data/wire_asa.json**', r => j(r, [WIRE[0], WIRE[1]]));
  await page.route('**/data/wire_usl2.json**', r => j(r, []));
  await page.route('**/data/match_stats.json**', r => j(r, STATS));
  await page.route('**/api/shots**', r => j(r, r.request().url().includes('game_id=') ? SHOTS : GAMES));
}
const errorsOf = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

test('a wire row opens into the shots tier with map, xG race and Elo swing', async ({ page }) => {
  const errors = errorsOf(page);
  await stub(page);
  await gotoRoute(page, '#/wire');
  const row = page.locator('details.wirerow', { hasText: 'Home City FC' }).first();
  await row.locator('summary').click();
  const pm = row.locator('.pm');
  await expect(pm).toHaveAttribute('data-tier', 'shots');
  await expect(pm.locator('.sh-pitch .sh-mark')).toHaveCount(SHOTS.shots.length);
  await expect(pm.locator('.pm-race .pm-line')).toHaveCount(2);
  await expect(pm.locator('.pm-elo')).toContainText('61%');
  await expect(pm.locator('.pm-elo')).toContainText('9');
  /* the ESPN box score joined by league + date + names */
  await expect(pm.locator('.statcmp')).toContainText('Possession');
  expect(errors).toEqual([]);
});

test('toggles switch sets of shots off and the totals follow', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/wire');
  const row = page.locator('details.wirerow', { hasText: 'Home City FC' }).first();
  await row.locator('summary').click();
  const pm = row.locator('.pm');
  await expect(pm.locator('.sh-mark')).toHaveCount(7);
  await pm.locator('.pm-chip[data-key="away"]').click();      // home only -> 3
  await expect(pm.locator('.sh-mark')).toHaveCount(3);
  await pm.locator('.pm-chip[data-key="blocked"]').click();   // drop the blocked one -> 2
  await expect(pm.locator('.sh-mark')).toHaveCount(2);
  await expect(pm.locator('.pm-count')).toContainText('2 of 7');
  await pm.locator('.pm-chip[data-key="h1"]').click();        // both remaining were first half -> 0
  await expect(pm.locator('.sh-mark')).toHaveCount(0);
  /* the deep link carries the filter state */
  await expect(pm.locator('.pm-full')).toHaveAttribute('href', /#\/shots\/mls\/GAME1\?off=away,blocked,h1/);
  await pm.locator('.pm-reset').click();
  await expect(pm.locator('.sh-mark')).toHaveCount(7);
});

test('a league with no shot data lands on the result tier, never empty', async ({ page }) => {
  const errors = errorsOf(page);
  await stub(page);
  await gotoRoute(page, '#/wire');
  const row = page.locator('details.wirerow', { hasText: 'Amateur United' }).first();
  await row.locator('summary').click();
  const pm = row.locator('.pm');
  await expect(pm).toHaveAttribute('data-tier', 'result');
  await expect(pm.locator('.pm-elo')).toContainText('6 Elo');
  await expect(pm.locator('.sh-pitch')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a box-score result row borrows the wire game id and shows the shot map', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/matches');
  const row = page.locator('details.resrow', { hasText: 'Home City FC' }).first();
  await row.locator('summary').click();
  const pm = row.locator('.pm');
  await expect(pm).toHaveAttribute('data-tier', 'shots');
  await expect(pm.locator('.sh-mark')).toHaveCount(7);
  /* the box score bars are already drawn above the panel; not repeated inside it */
  await expect(pm.locator('.statcmp')).toHaveCount(0);
  await expect(row.locator('.statcmp')).toHaveCount(1);
});

test('#/shots deep link opens one match with its filters applied', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots/mls/GAME1?off=away&size=psxg');
  await expect(page.locator('#sh-gm')).toHaveValue('GAME1');
  await expect(page.locator('#sh-pitch .sh-mark')).toHaveCount(3);
  await expect(page.locator('.pm-size[data-size="psxg"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#sh-panel .pm-chip[data-key="away"]').click();
  await expect(page.locator('#sh-pitch .sh-mark')).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/shots/mls/GAME1?size=psxg');
});

test('a row the screen opened itself waits for a tap before fetching shots', async ({ page }) => {
  const errors = errorsOf(page);
  let shotCalls = 0;
  await stub(page);
  await page.route('**/api/shots**', r => { shotCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHOTS) }); });
  await gotoRoute(page, '#/club/atlanta-united');
  const row = page.locator('details.resrow', { hasText: 'Away Town FC' }).first();
  await expect(row).toHaveAttribute('open', '');
  const pm = row.locator('.pm');
  await expect(pm).toHaveAttribute('data-tier', 'shots');
  await expect(pm.locator('.pm-elo')).toContainText('55%');
  await expect(pm.locator('.pm-load')).toBeVisible();
  expect(shotCalls).toBe(0);
  await pm.locator('.pm-load').click();
  await expect(pm.locator('.sh-mark')).toHaveCount(SHOTS.shots.length);
  expect(shotCalls).toBe(1);
  expect(errors).toEqual([]);
});
