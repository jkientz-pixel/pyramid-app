// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* Player Simulator — named to pair with Rank Simulator; it shipped as "Player
   Coach" at /coach on 2026-08-17. It was a 427KB standalone page that inlined
   its whole dataset and hard-coded a dark palette, and is an app route now,
   lazily importing js/player-sim.js and fetching data/coach_players.json. These
   tests cover the seams that move introduced: the lazy import, the split-out
   payload, and the theme support the old page never had. */

const ready = async page => {
  await page.waitForSelector('#cch-rating');
  await page.waitForFunction(() => document.querySelector('#cch-rating')?.textContent !== '—');
};

test('the simulator loads a player and rates them', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/player-sim');
  await ready(page);
  await expect(page.locator('#cch-rating')).toHaveText(/^\d{2}$/);
  await expect(page.locator('#cch-pname')).not.toHaveText('—');
  /* one lever per weighted stat for the position */
  expect(await page.locator('.cch-lever').count()).toBeGreaterThanOrEqual(5);
  expect(errors).toEqual([]);
});

test('applying a target moves the rating and reports the delta', async ({ page }) => {
  await gotoRoute(page, '#/player-sim');
  await ready(page);
  const before = Number(await page.textContent('#cch-rating'));
  await page.locator('.cch-gain').first().click();
  await expect(page.locator('#cch-chip')).toContainText('vs real rating');
  const after = Number(await page.textContent('#cch-rating'));
  expect(after).toBeGreaterThan(before);
});

test('reset returns the simulation to the real stats', async ({ page }) => {
  await gotoRoute(page, '#/player-sim');
  await ready(page);
  const real = await page.textContent('#cch-rating');
  await page.locator('.cch-gain').first().click();
  expect(await page.textContent('#cch-rating')).not.toBe(real);
  await page.click('#cch-reset');
  expect(await page.textContent('#cch-rating')).toBe(real);
  await expect(page.locator('#cch-chip')).toHaveText('current form');
});

test('switching league reloads the roster from that league', async ({ page }) => {
  await gotoRoute(page, '#/player-sim');
  await ready(page);
  const first = await page.textContent('#cch-pname');
  await page.selectOption('#cch-lg', 'nwsl');
  await expect(page.locator('#cch-pmeta')).toContainText('NWSL');
  expect(await page.textContent('#cch-pname')).not.toBe(first);
});

/* The standalone page could not do this at all: it read its colours out of
   getComputedStyle once at load, so a theme change left it dark. */
test('the simulator follows the app theme', async ({ page }) => {
  await gotoRoute(page, '#/player-sim');
  await ready(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await bg();
  await page.click('#themebtn');
  expect(await bg()).not.toBe(before);
  /* the rating still renders against the new ground */
  await expect(page.locator('#cch-rating')).toHaveText(/^\d{2}$/);
});

test('the payload is a separate cacheable file, not inlined in the page', async ({ page }) => {
  const res = await page.request.get('/data/coach_players.json');
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(Object.keys(data)).toContain('mls');
  const total = Object.values(data).reduce((n, d) => n + d.players.length, 0);
  expect(total).toBeGreaterThan(1500);
  /* and the landing page must stay small now that it no longer carries it */
  const landing = await page.request.get('/player-simulator');
  expect((await landing.body()).length).toBeLessThan(50_000);
});
