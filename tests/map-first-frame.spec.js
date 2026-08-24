// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* The illustrated SVG is the offline fallback. It used to be the first frame
   of every map load and flashed until leaflet.js arrived — Jeremy saw "an
   artifact of the old map" on refresh. Now the box waits in `loading` and the
   SVG paints only when Leaflet genuinely cannot load. */

test('a normal map load never paints the illustrated SVG', async ({ page }) => {
  const errors = trackErrors(page);
  /* record every mode the box passes through, from the first paint on */
  await page.addInitScript(() => {
    const seen = new Set();
    const tick = () => { const b = document.querySelector('.mapbox'); if (b) seen.add(b.dataset.mode); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    Object.defineProperty(window, '__mapModes', { get: () => [...seen] });
  });
  await gotoRoute(page, '#/map');
  await page.waitForSelector('.leafmap.leaflet-container');
  const modes = await page.evaluate(() => window.__mapModes);
  expect(modes).not.toContain('art');
  expect(modes).toContain('street');
  await expect(page.locator('svg.usmap')).toBeHidden();
  expect(errors).toEqual([]);
});

test('when leaflet.js cannot load the illustrated SVG takes over', async ({ page }) => {
  await page.route('**/js/vendor/leaflet.js', r => r.abort());
  await gotoRoute(page, '#/map');
  await expect(page.locator('.mapbox')).toHaveAttribute('data-mode', 'art');
  await expect(page.locator('svg.usmap')).toBeVisible();
});
