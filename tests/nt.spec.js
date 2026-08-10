// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute, viewRendered } = require('./helpers');

test('nt overview shows Men and Women sections with team links and TV links', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/nt');
  await expect(page.locator('#view')).toContainText('Men');
  await expect(page.locator('#view')).toContainText('Women');
  /* every match row must name its team, never a bare USA */
  await expect(page.locator('#view .mrow .sn', { hasText: /^USA$/ })).toHaveCount(0);
  /* squad-history links only on teams with scraped history */
  expect(await page.locator('#view a[href="#/nt/usmnt"]').count()).toBe(1);
  expect(await page.locator('#view a[href^="#/nt/u19"]').count()).toBe(0);
  /* every team links its official U.S. Soccer page */
  expect(await page.locator('#view a[href^="https://www.ussoccer.com/teams/"]').count()).toBeGreaterThanOrEqual(14);
  /* every upcoming game with an announced broadcast must link it — logo chips */
  expect(await page.locator('#view .watchchip').count()).toBeGreaterThanOrEqual(5);
  expect(await page.locator('#view .watchchip img').count()).toBeGreaterThanOrEqual(5);
  expect(errors).toEqual([]);
});

test('nt team page lists historical squads by year', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/nt/usmnt');
  await page.waitForSelector('#ntyears');
  /* USMNT has played 12 World Cups (1930–2026); losing most should fail loudly */
  expect(await page.locator('#ntyears .chip').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#view')).toContainText('Squad history');
  /* default year renders a full squad */
  expect(await page.locator('.ntroster li').count()).toBeGreaterThanOrEqual(18);
  /* year switch re-renders */
  await page.click('#ntyears .chip[data-y="1930"]');
  await expect(page.locator('#view')).toContainText('1930 FIFA World Cup');
  expect(errors).toEqual([]);
});

test('nt player page aggregates appearances across teams', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/nt/p/landon-donovan');
  await expect(page.locator('#view h2')).toContainText('Landon Donovan');
  /* U-17 1999 + U-20 2001 + three senior World Cups */
  expect(await page.locator('.ntroster li').count()).toBeGreaterThanOrEqual(5);
  await expect(page.locator('#view')).toContainText('World tournaments');
  expect(errors).toEqual([]);
});

test('recent youth squads honor the minors policy: no birth data, no bio', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/nt/u17mnt');
  await page.waitForSelector('#ntyears');
  await page.click('#ntyears .chip[data-y="2025"]');
  await viewRendered(page);
  expect(await page.locator('.ntroster .cl-name span', { hasText: 'age ' }).count()).toBe(0);
  expect(errors).toEqual([]);
});
