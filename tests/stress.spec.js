// @ts-check
/* Stress pass (@stress): not part of the CI smoke gate — run with `npm run test:stress`.
   Hammers the SPA router, search, and every state/region view, asserting zero
   console/page errors and a sane JS heap at the end. */
const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

test.describe('@stress', () => {
  test.setTimeout(300_000);

  test('rapid navigation across 150 club pages', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, '#/map');
    const slugs = await page.evaluate(async () => {
      const { CLUBS } = await import('/js/data.js');
      const step = Math.max(1, Math.floor(CLUBS.length / 150));
      return CLUBS.filter((_, i) => i % step === 0).slice(0, 150).map(c => c.id);
    });
    expect(slugs.length).toBeGreaterThan(100);
    for (const slug of slugs) {
      await page.evaluate(s => { location.hash = `#/club/${s}`; }, slug);
      await viewRendered(page);
    }
    expect(errors).toEqual([]);
  });

  test('every state and region view renders clean', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, '#/map');
    const states = await page.evaluate(async () => {
      const { CLUBS } = await import('/js/data.js');
      return [...new Set(CLUBS.map(c => c.st).filter(Boolean))].sort();
    });
    for (const st of states) {
      await page.evaluate(s => { location.hash = `#/state/${s}`; }, st);
      await viewRendered(page);
    }
    for (const region of ['northwest', 'southwest', 'midwest', 'south', 'southeast', 'northeast']) {
      await page.evaluate(r => { location.hash = `#/region/${r}`; }, region);
      await viewRendered(page);
    }
    expect(errors).toEqual([]);
  });

  test('search hammering stays error-free', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, '#/map');
    /* the dropdown only opens for terms of 2+ chars; shorter input hides it */
    const queries = ['at', 'fc', 'united', 'city', 'sc', 'real', 'aca', 'inter',
      'sporting', 'afc', 'la ', 'ny', 'dyn', 'rovers', 'wander', 'zz', 'qq', '11', 'xx', 'club'];
    for (const q of queries) {
      await page.fill('#q', q);
      await page.waitForFunction(() =>
        !document.querySelector('#qres').hidden);
      await page.fill('#q', '');
      await page.waitForFunction(() =>
        document.querySelector('#qres').hidden);
    }
    expect(errors).toEqual([]);
  });

  test('heap stays bounded after heavy navigation', async ({ page }) => {
    await gotoRoute(page, '#/map');
    const slugs = await page.evaluate(async () => {
      const { CLUBS } = await import('/js/data.js');
      return CLUBS.slice(0, 80).map(c => c.id);
    });
    for (const slug of slugs) {
      await page.evaluate(s => { location.hash = `#/club/${s}`; }, slug);
      await viewRendered(page);
      await page.evaluate(() => { location.hash = '#/table'; });
      await viewRendered(page);
    }
    const heapMb = await page.evaluate(() =>
      // @ts-ignore chromium-only API
      performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
    expect(heapMb).toBeLessThan(800);
  });
});
