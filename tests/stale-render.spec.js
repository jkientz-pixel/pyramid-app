// @ts-check
/* Nine screens await their data before they paint. That opens a window where
   the reader routes away — most naturally, taps Back out of a club — while the
   screen they left is still loading, and the late paint then lands on top of
   whatever they navigated to. The address bar said #/map and the club page was
   what you were looking at, so Back appeared not to work at all.
   These tests hold the data open on purpose so the window is always there,
   rather than waiting for a slow connection to produce it by chance. */
const { test, expect } = require('@playwright/test');
const { gotoRoute, viewRendered } = require('./helpers');

/** Hold a request open long enough that the reader can outrun it. */
async function stall(page, glob, ms = 1200) {
  await page.route(glob, async r => {
    await new Promise(s => setTimeout(s, ms));
    await r.continue();
  });
}

test('backing out of a still-loading club leaves you on the map', async ({ page }) => {
  await stall(page, '**/rosters.js*');
  await stall(page, '**/cup_receipts.json*');

  await gotoRoute(page, '#/map');
  await page.waitForSelector('.leafmap.leaflet-container');
  await page.goto('/app.html#/club/portland-timbers');
  await page.waitForTimeout(150);        // routed, and still awaiting its data
  await page.goBack();
  await viewRendered(page);
  await page.waitForSelector('.leafmap.leaflet-container');

  // give the overtaken club render every chance to land on top of the map
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    hasMap: !!document.querySelector('.leafmap'),
    hasClub: !!document.querySelector('.clubhead'),
  }));
  expect(after.hash).toBe('#/map');
  expect(after.hasClub).toBe(false);     // the screen the reader left
  expect(after.hasMap).toBe(true);       // the screen the URL promises
});

/* screenLeague already carried a hand-rolled version of this check before
   routedAway() existed, so this one does not reproduce a bug — it holds the
   rewrite honest, and fails if the guard is ever dropped from that screen. */
test('outrunning a league page does not paint it over the next screen', async ({ page }) => {
  await stall(page, '**/leagues_info.json*');

  await gotoRoute(page, '#/map');
  await page.goto('/app.html#/league/mls');
  await page.waitForTimeout(150);
  await page.goto('/app.html#/tiers');
  await viewRendered(page);

  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    title: document.title,
  }));
  expect(after.hash).toBe('#/tiers');
  expect(after.title).not.toMatch(/League/i);
});
