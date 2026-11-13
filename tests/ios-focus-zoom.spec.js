const { test, expect, devices } = require('@playwright/test');
const { gotoRoute } = require('./helpers');

/* iOS zooms the page in when a text field under 16px gets focus, and inside
   the Capacitor app shell nothing zooms it back out: the TestFlight report on
   2026-11-12 was "after a search it's off". Every form control on a touch
   device must therefore render at 16px or more (css/app.css, end of file).
   Each group sets its own device: phone emulation is browser-wide in
   Chromium, so a "desktop" page opened under it still reports a coarse pointer. */

const deviceOnly = name => { const { defaultBrowserType, ...rest } = devices[name]; return rest; };

const smallFields = page => page.evaluate(() =>
  [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]),select,textarea')]
    .filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map(e => `${e.id || e.name || e.tagName}=${getComputedStyle(e).fontSize}`));

test.describe('on a phone', () => {
  test.use(deviceOnly('iPhone 13'));
  /* Double-tap zoom (TestFlight 2026-11-12: tapping the colour button twice
     left My XI magnified and shifted right). touch-action: manipulation on the
     root turns off double-tap zoom and keeps pinch zoom for accessibility. */
  test('double-tap zoom is off for the whole app (pinch zoom stays)', async ({ page }) => {
    await gotoRoute(page, '#/myxi');
    const ta = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
    expect(ta).toBe('manipulation');
    const vp = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(vp).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/);
  });
  for (const route of ['#/', '#/tiers', '#/table', '#/matches', '#/myxi', '#/about', '#/club/la-galaxy']) {
    test(`text fields on ${route} are 16px or larger (no iOS focus zoom)`, async ({ page }) => {
      await gotoRoute(page, route);
      await page.waitForTimeout(400);
      expect(await smallFields(page), 'fields that make iOS zoom on focus').toEqual([]);
    });
  }
});

test.describe('on a desktop', () => {
  test.use(deviceOnly('Desktop Chrome'));
  test('keeps the compact search field', async ({ page }) => {
    await gotoRoute(page, '#/');
    expect(await page.locator('#q').evaluate(e => getComputedStyle(e).fontSize)).toBe('14.4px');
  });
});
