// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoRoute } = require('./helpers');

/* Shot Maps draws its map from /api/shots, a Pages Function the static dev
   server doesn't run. Stubbing the endpoint keeps the test deterministic and
   offline — it exercises the rendering, which is the part that breaks.

   The screen is the #/shots app route now, not the standalone /shots page:
   ids are sh-prefixed and marks take their colour from css/app.css classes
   rather than baked-in fill attributes, which is what lets the map follow the
   theme toggle. The assertions below moved with it. */

const GAMES = {
  league: 'mls', leagueName: 'MLS', season: '2026',
  games: [{ id: 'GAME1', date: '2026-08-16 22:00:00 UTC', home: 'Home City FC', away: 'Away Town FC', hs: 2, as: 3 }],
};

const shot = (o) => ({
  team: 'H', teamName: 'Home City FC', player: 'A Player', assist: null, minute: 10,
  x: 88, y: 50, endY: 50, xg: 0.2, psxg: 0, goal: false, ownGoal: false,
  blocked: false, head: false, pattern: 'Regular', yards: 12, ...o,
});

const SHOTS = {
  league: 'mls', gameId: 'GAME1',
  shots: [
    shot({ goal: true, xg: 0.5, psxg: 0.8, minute: 12, player: 'Home Scorer' }),
    shot({ goal: true, xg: 0.3, psxg: 0.6, minute: 40, player: 'Home Second' }),
    shot({ blocked: true, xg: 0.05, minute: 55 }),
    shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.4, psxg: 0.7, minute: 20, player: 'Away One' }),
    shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.6, psxg: 0.9, minute: 60, player: 'Away Two' }),
    shot({ team: 'A', teamName: 'Away Town FC', goal: true, xg: 0.1, psxg: 0.3, minute: 80, player: 'Away Three' }),
    shot({ team: 'A', teamName: 'Away Town FC', xg: 0.25, minute: 85, player: 'Away Miss' }),
  ],
};

async function stub(page, { fail = false } = {}) {
  await page.route('**/api/shots**', async (route) => {
    if (fail) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream unavailable"}' });
    const url = route.request().url();
    const body = url.includes('game_id=') ? SHOTS : GAMES;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('shot map renders every shot, with goals filled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await stub(page);
  await gotoRoute(page, '#/shots');

  const marks = page.locator('#sh-pitch .sh-mark');
  await expect(marks).toHaveCount(SHOTS.shots.length);

  // five goals in the fixture -> five filled circles
  /* fill-opacity is a class concern now (circle.sh-goal), not an attribute */
  const filled = page.locator('#sh-pitch .sh-mark circle.sh-goal');
  await expect(filled).toHaveCount(5);

  // scoreline comes from the games list, not the shots
  await expect(page.locator('#sh-score')).toContainText('2–3');
  await expect(page.locator('#sh-score')).toContainText('Home City FC');

  expect(errors).toEqual([]);
});

test('totals agree with the shot list', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  const rows = page.locator('#sh-totals tbody tr');
  // Home: 3 shots, 2 goals, xG 0.85 | Away: 4 shots, 3 goals, xG 1.35
  await expect(rows.filter({ hasText: 'Shots' })).toContainText(['3']);
  await expect(page.locator('#sh-totals')).toContainText('0.85');
  await expect(page.locator('#sh-totals')).toContainText('1.35');
});

test('every shot is also available as a table', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  await page.locator('summary', { hasText: 'Every shot as a table' }).click();
  await expect(page.locator('#sh-table tbody tr')).toHaveCount(SHOTS.shots.length);
  await expect(page.locator('#sh-table')).toContainText('Home Scorer');
});

test('legend names both teams so colour is never the only cue', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  await expect(page.locator('#sh-legend')).toContainText('Home City FC');
  await expect(page.locator('#sh-legend')).toContainText('Away Town FC');
  await expect(page.locator('#sh-legend')).toContainText('Goal');
});

test('an upstream failure degrades without throwing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await stub(page, { fail: true });
  await gotoRoute(page, '#/shots');
  await expect(page.locator('#sh-score')).toContainText(/unavailable/i);
  await expect(page.locator('#sh-pitch .sh-mark')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* ---- what moving into the app added -------------------------------------
   The standalone page read --home/--away out of getComputedStyle once at load
   and baked the hex into every SVG attribute, so it could never follow a theme
   change. These cover the behaviour the port introduced. */

test('the league picker offers all six pro leagues', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  await expect(page.locator('#sh-lg option')).toHaveCount(6);
});

test('the shot map follows the app theme', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  await page.waitForSelector('#sh-pitch .sh-mark');
  const grass = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('.sh-pitchwrap')).backgroundColor);
  const before = await grass();
  await page.click('#themebtn');
  expect(await grass()).not.toBe(before);
  /* marks survive the repaint — they are classed, not re-rendered */
  await expect(page.locator('#sh-pitch .sh-mark')).toHaveCount(SHOTS.shots.length);
});

test('the Tools tab stays lit on the shot map', async ({ page }) => {
  await stub(page);
  await gotoRoute(page, '#/shots');
  await expect(page.locator('.tabbar a[data-tab="tools"]')).toHaveClass(/active/);
});

/* A slow response must not paint over whatever screen the user landed on. */
test('routing away mid-load leaves the next screen alone', async ({ page }) => {
  await page.route('**/api/shots**', async r => {
    await new Promise(res => setTimeout(res, 900));
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
  });
  await gotoRoute(page, '#/shots');
  await page.evaluate(() => { location.hash = '#/tools'; });
  await page.waitForSelector('.toolgrid');
  await page.waitForTimeout(1400);
  await expect(page.locator('.toolgrid')).toBeVisible();
  await expect(page.locator('#sh-pitch')).toHaveCount(0);
});
