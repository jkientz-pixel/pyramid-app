// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

/* The Tools tab is a hub: it replaced the separate Predict and Sim tabs and is
   the only in-app door to the two standalone tool pages. These tests guard the
   two things that silently break — a card losing its link, and the tab going
   dark on a screen that lives under it. */

test('the Tools hub lists all four tools', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tools');
  const cards = page.locator('.toolcard');
  await expect(cards).toHaveCount(4);
  for (const [name, href] of [
    ['Matchup Machine', '#/predict'],
    ['Rank Simulator', '#/sim'],
    ['Player Coach', '/coach'],
    ['Shot Maps', '/shots'],
  ]) {
    await expect(page.locator(`.toolcard:has-text("${name}")`)).toHaveAttribute('href', href);
  }
  expect(errors).toEqual([]);
});

test('Predict and Sim keep the Tools tab lit', async ({ page }) => {
  for (const hash of ['#/predict', '#/sim']) {
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

test('the standalone tool pages link back to the hub', async ({ page }) => {
  for (const path of ['/shots', '/coach']) {
    await page.goto(path);
    await expect(page.locator('a.back')).toHaveAttribute('href', '/app#/tools');
  }
});
