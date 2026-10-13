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

/* ---- 2027 qualifying (ussoccer.com feed, data/opencup_qual.json) ---------- */
const qual = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'opencup_qual.json'), 'utf8'));

test('the current-edition view says 2027 qualifying is live and links to it', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/opencup');
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  /* the default stays on the edition in play, not the qualifying edition */
  await expect(v.locator('h2')).toContainText(`The ${live.year} Open Cup`);
  const b = v.locator('.oc-qbanner');
  await expect(b).toContainText(`${qual.year} qualifying is live`);
  await b.click();
  await expect(page).toHaveURL(new RegExp(`#/opencup/${qual.year}$`));
  expect(errors).toEqual([]);
});

test('2027 qualifying renders every round, tiers, picks and stated venues', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, `#/opencup/${qual.year}`);
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  await expect(v.locator('h2')).toContainText(`The ${qual.year} Open Cup`);
  const rounds = await v.locator('.oc-round h3').allTextContents();
  expect(rounds[0]).toBe('Third Qualifying Round');
  expect(rounds).toEqual(expect.arrayContaining(['Second Qualifying Round', 'First Qualifying Round']));
  const third = qual.ties.filter(t => t.round === 'Third Qualifying Round');
  const block = v.locator('.oc-round', { has: page.locator('h3', { hasText: 'Third Qualifying Round' }) });
  expect(await block.locator('.oc-tie').count()).toBe(third.length);
  /* venue and city exactly as U.S. Soccer prints them */
  await expect(block).toContainText(`${third[0].venue}, ${third[0].city}`);
  /* stated local kickoff, not the viewer's timezone */
  await expect(block).toContainText(/\b\d{1,2}:\d{2} [AP]M (ET|CT|MT|PT)\b/);
  /* at least some pending ties carry the model's pick, and some sides link to clubs */
  expect(await block.locator('.oc-sub', { hasText: 'Our pick' }).count()).toBeGreaterThan(3);
  expect(await v.locator('.oc-tie a[href^="#/club/"]').count()).toBeGreaterThan(20);
  expect(await v.locator('.oc-tie .gk-tier').count()).toBeGreaterThan(20);
  /* a small set of closest-call cards, not 32 */
  const cards = await v.locator('.oc-next').count();
  expect(cards).toBeGreaterThan(0);
  expect(cards).toBeLessThanOrEqual(6);
  /* unmatched names are plain text, never a link */
  const un = third.find(t => !t.id1);
  if (un) expect(await block.locator(`a:text-is("${un.t1}")`).count()).toBe(0);
  expect(errors).toEqual([]);
});

test('2027 qualifying results show scores, extra time and forfeits', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, `#/opencup/${qual.year}`);
  await page.waitForSelector('.oc-round');
  const v = page.locator('#view');
  const pens = qual.ties.find(t => t.pens);
  if (pens) await expect(v).toContainText(`${pens.pens[0]}–${pens.pens[1]} pens`);
  if (qual.ties.some(t => t.forfeit)) await expect(v).toContainText('forfeit');
  expect(await v.locator('.oc-score').filter({ hasText: /\d–\d/ }).count()).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
