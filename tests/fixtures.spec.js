// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoRoute, viewRendered, trackErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

/* #/matches is one of eight primary nav tabs and it read "No verified fixtures
   in the next two weeks" through the fourth week of August, with MLS, both USL
   pro divisions, NWSL and the whole college season playing. These tests guard
   the fix without asserting a fixture COUNT — the file has a rolling horizon,
   so a count assertion would start failing three weeks after it was written.
   They assert the invariants instead: shape, freshness, and that the screen
   tells the truth either way. */

const FIXTURES = path.join(__dirname, '..', 'data', 'fixtures.json');
const rows = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));

test('every fixture row carries the fields the UI reads', () => {
  expect(Array.isArray(rows)).toBe(true);
  for (const f of rows) {
    expect(typeof f.lg).toBe('string');
    expect(typeof f.t1).toBe('string');
    expect(typeof f.t2).toBe('string');
    expect(f.t1.length).toBeGreaterThan(0);
    expect(f.t2.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(f.start))).toBe(false);
  }
});

/* The empty state exists to stop a stale feed presenting old games as
   upcoming. A fixture file that has quietly gone stale must fail here rather
   than ship last month's schedule as this week's. */
test('no fixture in the file is already in the past', () => {
  const now = Date.now();
  const stale = rows.filter(f => Date.parse(f.start) < now - 24 * 3600e3);
  expect(stale.map(f => `${f.t1} v ${f.t2} @ ${f.start}`)).toEqual([]);
});

test('a resolved club id always names a real club', () => {
  const data = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
  const clubs = JSON.parse(data.match(/export const CLUBS=(\[.*?\]);/s)[1]);
  const ids = new Set(clubs.map(c => c.id));
  const bad = rows.filter(f => (f.id1 && !ids.has(f.id1)) || (f.id2 && !ids.has(f.id2)));
  expect(bad.map(f => `${f.t1} v ${f.t2}`)).toEqual([]);
});

test('#/matches renders fixtures, or says plainly that it has none', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/matches');
  await viewRendered(page);
  const box = page.locator('#realfx');
  await expect(box).toBeAttached();
  await page.waitForFunction(() => {
    const el = document.querySelector('#realfx');
    return el && el.textContent.trim().length > 0;
  });
  const text = await box.textContent();
  const shown = await box.locator('.fxrow').count();
  if (shown === 0) {
    expect(text).toContain('No verified fixtures');
  } else {
    expect(text).toContain('Verified fixtures');
    // every row names two sides
    expect(await box.locator('.fxrow .side').count()).toBe(shown * 2);
  }
  expect(errors).toEqual([]);
});

/* A men's league fixture must never render into the women's view. The screen
   re-renders on the sex toggle and the fetch is async, so this also covers the
   late-resolution race the fxSex capture guards. */
test('the fixtures list only shows leagues of the selected sex', async ({ page }) => {
  await gotoRoute(page, '#/matches');
  await viewRendered(page);
  await page.waitForFunction(() => document.querySelector('#realfx')?.textContent.trim().length > 0);
  const readLeagues = () => page.evaluate(() =>
    [...document.querySelectorAll('#realfx [data-fxlg]')]
      .map(b => b.dataset.fxlg).filter(g => g !== 'all'));
  const men = await readLeagues();
  const wToggle = page.locator('[data-sex="w"]');
  if (await wToggle.count()) {
    await wToggle.click();
    await viewRendered(page);
    await page.waitForFunction(() => document.querySelector('#realfx')?.textContent.trim().length > 0);
    const women = await readLeagues();
    expect(men.filter(g => women.includes(g))).toEqual([]);
  }
});
