// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

test('league page shows about, watch links, official site and all clubs', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/league/mls');
  await expect(page.locator('#view h2')).toContainText('MLS');
  await expect(page.locator('#view')).toContainText('Major League Soccer');
  await expect(page.locator('#view')).toContainText('Where to watch');
  expect(await page.locator('#view .watchlink').count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator('#view a.hdrlink[href^="https://"]').count()).toBe(1);
  /* 30 MLS clubs — a thin list means the club join broke */
  expect(await page.locator('#view .clublist li').count()).toBeGreaterThanOrEqual(28);
  expect(errors).toEqual([]);
});

test('tiers tiles link to internal league pages, not external sites', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tiers');
  expect(await page.locator('.tierlg[href^="#/league/"]').count()).toBeGreaterThanOrEqual(10);
  expect(await page.locator('.tier-leagues a[target="_blank"]:not(.coming)').count()).toBe(0);
  await page.click('.tierlg[href="#/league/mls"]');
  await expect(page.locator('#view')).toContainText('Where to watch');
  expect(errors).toEqual([]);
});

test('club page league chip routes to the league page', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/league/upsl');
  /* biggest league in the dataset — the full directory must render */
  expect(await page.locator('#view .clublist li').count()).toBeGreaterThanOrEqual(300);
  const first = page.locator('#view .clublist li a').first();
  await first.click();
  await page.waitForFunction(() => location.hash.startsWith('#/club/'));
  await page.click('.lgchip');
  await page.waitForFunction(() => location.hash === '#/league/upsl');
  expect(errors).toEqual([]);
});

test('unknown league key falls back to the pyramid', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/league/nope');
  await expect(page.locator('#view')).toContainText('The Pyramid');
  expect(errors).toEqual([]);
});
