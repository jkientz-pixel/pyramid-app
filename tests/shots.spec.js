// @ts-check
const { test, expect } = require('@playwright/test');

/* /shots draws its map from /api/shots, a Pages Function the static dev server
   doesn't run. Stubbing the endpoint keeps the test deterministic and offline —
   it exercises the rendering, which is the part that breaks. */

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
  await page.goto('/shots');

  const marks = page.locator('#pitch .mark');
  await expect(marks).toHaveCount(SHOTS.shots.length);

  // five goals in the fixture -> five filled circles
  const filled = page.locator('#pitch .mark circle[fill-opacity=".92"]');
  await expect(filled).toHaveCount(5);

  // scoreline comes from the games list, not the shots
  await expect(page.locator('#score')).toContainText('2–3');
  await expect(page.locator('#score')).toContainText('Home City FC');

  expect(errors).toEqual([]);
});

test('totals agree with the shot list', async ({ page }) => {
  await stub(page);
  await page.goto('/shots');
  const rows = page.locator('#totals tbody tr');
  // Home: 3 shots, 2 goals, xG 0.85 | Away: 4 shots, 3 goals, xG 1.35
  await expect(rows.filter({ hasText: 'Shots' })).toContainText(['3']);
  await expect(page.locator('#totals')).toContainText('0.85');
  await expect(page.locator('#totals')).toContainText('1.35');
});

test('every shot is also available as a table', async ({ page }) => {
  await stub(page);
  await page.goto('/shots');
  await page.locator('summary', { hasText: 'Every shot as a table' }).click();
  await expect(page.locator('#shottable tbody tr')).toHaveCount(SHOTS.shots.length);
  await expect(page.locator('#shottable')).toContainText('Home Scorer');
});

test('legend names both teams so colour is never the only cue', async ({ page }) => {
  await stub(page);
  await page.goto('/shots');
  await expect(page.locator('#legend')).toContainText('Home City FC');
  await expect(page.locator('#legend')).toContainText('Away Town FC');
  await expect(page.locator('#legend')).toContainText('Goal');
});

test('an upstream failure degrades without throwing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await stub(page, { fail: true });
  await page.goto('/shots');
  await expect(page.locator('#score')).toContainText(/unavailable/i);
  await expect(page.locator('#pitch .mark')).toHaveCount(0);
  expect(errors).toEqual([]);
});
