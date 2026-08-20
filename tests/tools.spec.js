// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

/* The Tools tab is a hub: it replaced the separate Predict and Sim tabs and is
   the only in-app door to the other two tools. All four are app routes now —
   Player Coach and Shot Maps used to be standalone pages with their own
   palette. These tests guard the two things that silently break: a card losing
   its link, and the tab going dark on a screen that lives under it. */

test('the Tools hub lists all five tools', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tools');
  const cards = page.locator('.toolcard');
  await expect(cards).toHaveCount(5);
  for (const [name, href] of [
    ['Matchup Machine', '#/predict'],
    ['Rank Simulator', '#/sim'],
    ['Player Simulator', '#/player-sim'],
    ['Shot Maps', '#/shots'],
    ['Player Radar', '#/radar'],
  ]) {
    await expect(page.locator(`.toolcard:has-text("${name}")`)).toHaveAttribute('href', href);
  }
  expect(errors).toEqual([]);
});

test('every tool screen keeps the Tools tab lit', async ({ page }) => {
  for (const hash of ['#/predict', '#/sim', '#/player-sim', '#/shots', '#/radar']) {
    await gotoRoute(page, hash);
    await expect(page.locator('.tabbar a[data-tab="tools"]')).toHaveClass(/active/);
  }
});

test('a hub card opens its tool and the tab bar follows', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tools');
  await page.click('.toolcard:has-text("Matchup Machine")');
  await viewRendered(page);
  expect(page.url()).toContain('#/predict');
  await expect(page.locator('.tabbar a[data-tab="tools"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('the old Predict and Sim tabs are gone from the tab bar', async ({ page }) => {
  await gotoRoute(page, '#/map');
  await expect(page.locator('.tabbar a[data-tab="predict"]')).toHaveCount(0);
  await expect(page.locator('.tabbar a[data-tab="sim"]')).toHaveCount(0);
  await expect(page.locator('.tabbar a')).toHaveCount(8);
});

/* /coach and /shots are still real URLs — they are in the sitemap and are the
   only crawlable surface for tools that otherwise live behind a hash route.
   They are landing pages now, and their job is to lead into the app. */
test('the tool landing pages lead into the app routes', async ({ page }) => {
  for (const [path, hash] of [['/shots', '/app#/shots'],
    ['/player-simulator', '/app#/player-sim']]) {
    await page.goto(path);
    await expect(page.locator(`a.cta[href="${hash}"]`).first()).toBeVisible();
    await expect(page.locator('a[href="/app#/tools"]')).toHaveCount(1);
  }
});

/* The tool shipped as "Player Coach" at /coach and #/coach before it was
   renamed to pair with Rank Simulator. Both old entry points still resolve,
   so a bookmark or an indexed link does not dead-end. */
test('the old coach URLs still reach the simulator', async ({ page }) => {
  await page.goto('/app.html#/coach');
  await page.waitForFunction(() => location.hash === '#/player-sim');
  await page.waitForSelector('#cch-rating');
});

test('no surface still calls it Player Coach', async ({ page }) => {
  for (const path of ['/app', '/player-simulator', '/']) {
    const body = await (await page.request.get(path)).text();
    expect(body).not.toContain('Player Coach');
  }
});
