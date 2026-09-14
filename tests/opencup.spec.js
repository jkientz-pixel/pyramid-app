// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { trackErrors, gotoRoute } = require('./helpers');

const live = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'opencup_live.json'), 'utf8'));
const matches = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'opencup_matches.json'), 'utf8'));

test('the current edition renders round by round, latest round first', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup');
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  await expect(v.locator('h2')).toContainText(`The ${live.year} Open Cup`);
  const rounds = await v.locator('.oc-round h3').allTextContents();
  expect(rounds.length).toBeGreaterThanOrEqual(4);
  /* the 2026 article's "Teams" sub-heading must never surface as a round */
  expect(rounds).not.toContain('Teams');
  expect(rounds).toContain('Round of 32');
  const qf = rounds.indexOf('Quarterfinals'), r32 = rounds.indexOf('Round of 32');
  expect(qf).toBeGreaterThanOrEqual(0);
  expect(qf).toBeLessThan(r32);
  /* tier badges and club links are the point of the page */
  expect(await v.locator('.oc-tie .gk-tier').count()).toBeGreaterThan(40);
  expect(await v.locator('.oc-tie a[href^="#/club/"]').count()).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('unplayed ties from the live feed render as next-up cards, played ones do not', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup');
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  const wikiRounds = new Set(matches.matches.filter(m => m.year === live.year).map(m => m.round));
  const upcoming = live.ties.filter(t => t.state !== 'post' && !wikiRounds.has(t.round));
  expect(await v.locator('.oc-next').count()).toBe(upcoming.length);
  if (upcoming.length) {
    const card = v.locator('.oc-next').first();
    await expect(card).toContainText(upcoming[0].round);
    if (upcoming[0].tv) await expect(card).toContainText(upcoming[0].tv[0]);
    /* both semifinalists are rated MLS clubs, so the call carries percentages */
    if (upcoming[0].id1 && upcoming[0].id2) await expect(card.locator('.oc-call')).toContainText('%');
  }
  expect(errors).toEqual([]);
});

test('a past edition shows its champion and switching years routes', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup/2024');
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  await expect(v.locator('h2')).toContainText('The 2024 Open Cup');
  await expect(v.locator('.oc-lead')).toContainText('Champions');
  await expect(v.locator('.oc-lead')).toContainText('Los Angeles FC');
  expect(await v.locator('.oc-next').count()).toBe(0);
  await v.locator('#oc-years [data-yr="2023"]').click();
  await expect(page).toHaveURL(/#\/opencup\/2023$/);
  await expect(v.locator('h2')).toContainText('The 2023 Open Cup');
  await expect(v.locator('.oc-lead')).toContainText('Houston Dynamo');
  expect(errors).toEqual([]);
});

test('rating receipts show up as movement chips on non-MLS winners', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup/2025');
  await page.waitForSelector('.oc-round');
  expect(await page.locator('#view .oc-d').count()).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('an edition that never happened says so instead of erroring', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup/2020');
  await expect(page.locator('#view')).toContainText('No record of a 2020 edition');
  expect(await page.locator('#view .oc-round').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('the Trophy Room, Giant-Killings and Matches all point at the Cup page', async ({ page }) => {
  for (const [route, sel] of [['#/cups', '.fa-card[href="#/opencup"]'], ['#/upsets', '.gk-cta[href="#/opencup"]'], ['#/matches', '.fa-card[href="#/opencup"]']]) {
    await gotoRoute(page, route);
    await expect(page.locator(`#view ${sel}`).first()).toBeVisible();
  }
});
