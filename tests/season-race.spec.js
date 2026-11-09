// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { trackErrors, gotoRoute } = require('./helpers');

/* the screen opens on MLS; once its regular season is over nothing is left to force */
const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule_rest.json'), 'utf8'));
const mlsGamesLeft = schedule.fixtures.some(f => f.lg === 'mls');

/* Season Race is the only screen that turns the table into a probability, and
   the numbers it prints are easy to get subtly wrong in ways that still look
   plausible. These guard the invariants a reader would never catch by eye. */

const race = async page => {
  await gotoRoute(page, '#/race');
  await page.waitForSelector('.rc-tbl tbody tr', { timeout: 20000 });
};

test('the race screen renders a table per group with real clubs', async ({ page }) => {
  const errors = trackErrors(page);
  await race(page);
  expect(await page.locator('.rc-tbl').count()).toBeGreaterThan(0);
  expect(await page.locator('.rc-tbl tbody tr').count()).toBeGreaterThan(10);
  await expect(page.locator('.rc-pill')).toBeVisible();      // season state
  expect(errors).toEqual([]);
});

test('projected points never fall below points already banked', async ({ page }) => {
  await race(page);
  /* the run-in cannot take points away — a projection under the current total
     means the baseline and the simulated table have drifted apart */
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.rc-tbl tbody tr').forEach(tr => {
      const td = tr.querySelectorAll('td');
      const now = +td[td.length - 5].textContent;
      const proj = +td[td.length - 3].textContent;
      if (proj < now) out.push(tr.innerText.split('\n')[0] + ` ${now} -> ${proj}`);
    });
    return out;
  });
  expect(bad).toEqual([]);
});

test('group odds across one group sum to about 100%', async ({ page }) => {
  await race(page);
  /* exactly one club finishes top of each group, so the column has to add up;
     a tiebreak or grouping bug shows here before it shows anywhere else */
  const sums = await page.evaluate(() => {
    return [...document.querySelectorAll('.rc-tbl')].map(t => {
      let s = 0;
      t.querySelectorAll('tbody tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const txt = cells[cells.length - 3].textContent.trim();
        if (txt.startsWith('<1')) s += 0.5;
        else if (/^\d/.test(txt)) s += parseFloat(txt);
      });
      return Math.round(s);
    });
  });
  for (const s of sums) expect(s).toBeGreaterThan(90);
  for (const s of sums) expect(s).toBeLessThan(110);
});

test('a club opens its own view, listing whatever fixtures remain', async ({ page }) => {
  const errors = trackErrors(page);
  await race(page);
  await page.click('.rc-tbl tbody tr');
  await page.waitForSelector('.rc-stat', { timeout: 20000 });
  expect(await page.locator('.rc-stat').count()).toBe(6);
  const rows = await page.locator('.rc-fx li').count();
  if (mlsGamesLeft) expect(rows).toBeGreaterThan(0);
  else expect(rows).toBe(0);
  expect(errors).toEqual([]);
});

test('forcing every remaining game to a win drives the club to the top', async ({ page }) => {
  test.skip(!mlsGamesLeft, 'off-season: no fixtures left to force');
  await race(page);
  await page.click('.rc-tbl tbody tr');
  await page.waitForSelector('.rc-fx li', { timeout: 20000 });
  const rows = await page.locator('.rc-fx li').count();
  for (let i = 0; i < rows; i++) {
    await page.locator('.rc-fx li').nth(i).locator('.rc-wdl button.W').click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  /* winning out cannot lower a club's odds of winning its own group */
  const group = await page.locator('.rc-stat b').nth(3).textContent();
  expect(group === '100%' || parseInt(group, 10) >= 50).toBeTruthy();
});
