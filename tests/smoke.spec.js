// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

/* Every top-level hash route the router dispatches (js/app.js route()).
   Each must render into #view without a single console/page error. */
const ROUTES = [
  '#/map',
  '#/tiers',
  '#/table',
  '#/matches',
  '#/following',
  '#/about',
  '#/cups',
  '#/wire',
  '#/pricing',
  '#/freeagents',
  '#/freeagent',
  '#/clubtools',
  '#/legal',
  '#/region/midwest',
  '#/state/CA',
  '#/club/atlanta-united',
  '#/legends/atlanta-united',
];

for (const route of ROUTES) {
  test(`route ${route} renders without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, route);
    expect(errors).toEqual([]);
  });
}

test('default route falls back to the map', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '');
  await expect(page.locator('#regionchips')).toBeVisible();
  expect(errors).toEqual([]);
});

test('unknown route falls back to the map without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/definitely-not-a-route');
  await expect(page.locator('#regionchips')).toBeVisible();
  expect(errors).toEqual([]);
});

test('legacy numeric club id redirects to the permanent slug', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/0');
  await page.waitForFunction(() => /^#\/club\/[a-z0-9-]+$/.test(location.hash));
  expect(page.url()).not.toContain('#/club/0');
  expect(errors).toEqual([]);
});

test('club page shows name, rating and links out', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await expect(page.locator('#view')).toContainText('Atlanta United');
  expect(errors).toEqual([]);
});

test('player page reachable from a club roster', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  const playerLink = page.locator('#view a[href^="#/player/"]').first();
  await expect(playerLink).toBeVisible();
  await playerLink.click();
  await viewRendered(page);
  expect(page.url()).toContain('#/player/');
  expect(errors).toEqual([]);
});

test('search finds a club and navigates to it', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/map');
  await page.fill('#q', 'Atlanta United');
  const firstHit = page.locator('#qres a, #qres [data-i], #qres li').first();
  await expect(firstHit).toBeVisible();
  await firstHit.click();
  await viewRendered(page);
  await expect(page.locator('#view')).toContainText('Atlanta United');
  expect(errors).toEqual([]);
});

test('theme toggle flips and persists the theme', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#themebtn');
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  await viewRendered(page);
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(persisted).toBe(after);
});

test('tab bar navigates between sections', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/map');
  for (const tab of ['tiers', 'table', 'matches', 'following', 'about']) {
    await page.click(`.tabbar a[data-tab="${tab}"]`);
    await viewRendered(page);
    await expect(page.locator(`.tabbar a[data-tab="${tab}"]`)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
});

/* Static pages outside the SPA shell. */
for (const path of ['/index.html', '/npsl-rankings.html', '/upsl-rankings.html']) {
  test(`static page ${path} loads without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
