// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* Follow feed + match alerts. Atlanta United is the fixture club because it
   is stable in both CLUBS (slug atlanta-united) and the ASA results wire. */

test('following a club surfaces it and its results feed', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await page.click('.favbtn');
  await expect(page.locator('.favbtn')).toContainText('Following');
  await gotoRoute(page, '#/following');
  await expect(page.locator('#view')).toContainText('Atlanta United');
  await expect(page.locator('#followfeed')).toContainText('Latest results');
  await expect(page.locator('#followfeed .match').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('following a school works and the feed is honest about coverage', async ({ page }) => {
  const errors = trackErrors(page);
  /* college programs are clubs too — and NCAA has no results wire yet,
     so the feed must say so instead of sitting silently empty */
  await gotoRoute(page, '#/club/stanford-university-cardinal');
  await page.click('.favbtn');
  await expect(page.locator('.favbtn')).toContainText('Following');
  await gotoRoute(page, '#/following');
  await expect(page.locator('#view')).toContainText('Stanford University Cardinal');
  await expect(page.locator('#followfeed')).toContainText('No results feed yet');
  expect(errors).toEqual([]);
});

test('match alerts toggle stores the opt-in and flips state', async ({ page }) => {
  /* Playwright's headless shell reports Notification.permission as 'denied'
     even when the permission is granted (permissions.query says granted), so
     stub the permission API — the test targets the toggle flow, not the
     browser's permission UI. */
  await page.addInitScript(() => {
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => perm });
    Notification.requestPermission = async () => (perm = 'granted');
  });
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await page.click('.favbtn');
  await gotoRoute(page, '#/following');
  await expect(page.locator('#alertbtn')).toContainText('Turn on');
  await page.click('#alertbtn');
  await expect(page.locator('#alertbtn')).toContainText('Turn off');
  expect(await page.evaluate(() => localStorage.getItem('pyr-alerts'))).toBe('on');
  await page.click('#alertbtn');
  await expect(page.locator('#alertbtn')).toContainText('Turn on');
  expect(await page.evaluate(() => localStorage.getItem('pyr-alerts'))).toBe(null);
  expect(errors).toEqual([]);
});

test('unseen results badge shows on the tab and clears after viewing the feed', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('pyr-favs', JSON.stringify({ clubs: ['atlanta-united'], players: [] }));
    localStorage.setItem('pyr-feed-seen', '2000-01-01');
  });
  await gotoRoute(page, '#/map');
  const dot = page.locator('.tabbar a[data-tab="following"] .tabdot');
  await expect(dot).toBeVisible();
  await gotoRoute(page, '#/following');
  await expect(page.locator('#followfeed .match').first()).toBeVisible();
  await expect(dot).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('first visit never floods the badge with season history', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('pyr-favs', JSON.stringify({ clubs: ['atlanta-united'], players: [] }));
    /* no pyr-feed-seen — a fresh browser must baseline silently */
  });
  await gotoRoute(page, '#/map');
  await expect(page.locator('.tabbar a[data-tab="following"] .tabdot')).toHaveCount(0);
  expect(errors).toEqual([]);
});
