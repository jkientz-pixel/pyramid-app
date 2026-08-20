// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* USL2 club pages used to say "Roster unclaimed. Real rosters come from league
   feeds" while data/usl2_lineups.json sat in the repo holding 1,039 matches of
   team sheets. These squads are that feed.

   The load-bearing test here is the last one: this data set is the reason the
   minors policy exists, and the published artefact must not carry an age. */

const CLUB = '#/club/ac-connecticut';

test('a USL2 club page lists the squad that actually played', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const rows = await page.locator('.apps-row').count();
  expect(rows).toBeGreaterThan(15);
  await expect(page.locator('.kicker', { hasText: 'players used' })).toContainText(String(rows));
  expect(errors).toEqual([]);
});

test('players are ordered by appearances, most-used first', async ({ page }) => {
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const totals = await page.$$eval('.apps-n', els =>
    els.map(e => Number(e.childNodes[0].textContent.trim())));
  for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
});

test('each row’s total equals its starts plus its sub appearances', async ({ page }) => {
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const rows = await page.$$eval('.apps-n', els => els.map(e => ({
    total: Number(e.childNodes[0].textContent.trim()),
    detail: e.querySelector('small').textContent,
  })));
  for (const { total, detail } of rows) {
    const starts = Number(detail.match(/(\d+) start/)[1]);
    const subs = Number((detail.match(/(\d+) sub/) || [0, 0])[1]);
    expect(starts + subs).toBe(total);
  }
});

test('clubs outside USL2 keep the unclaimed-roster message', async ({ page }) => {
  await gotoRoute(page, '#/club/atlanta-united');
  await expect(page.locator('.apps-row')).toHaveCount(0);
});

/* The policy is name kept, birth year blanked, opt-in to show age. The simplest
   way to keep that true forever for this surface is to publish no age at all. */
test('no age or birth year is published with an appearance', async ({ page }) => {
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const text = await page.locator('.apps-list').innerText();
  expect(text).not.toMatch(/\b(19|20)\d\d\b/);
  const res = await page.request.get('/data/usl2_appearances.json');
  const data = await res.json();
  for (const squad of Object.values(data)) {
    for (const p of squad.players) {
      expect(p).not.toHaveProperty('y');
      expect(p).not.toHaveProperty('age');
    }
  }
});

/* The source file is the one that leaked. Guard it directly, not just the
   artefact built from it. */
test('the source lineups file carries no under-18 birth year', async ({ page }) => {
  const res = await page.request.get('/data/usl2_lineups.json');
  const data = await res.json();
  const offenders = [];
  for (const m of Object.values(data.matches)) {
    for (const t of m.teams || []) {
      for (const group of ['starting', 'reserves']) {
        for (const p of t[group] || []) {
          if (p.y && Number(p.y) >= 2008) offenders.push(`${p.n} (${p.y})`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});
