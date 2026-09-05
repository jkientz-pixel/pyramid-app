// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* USL League Two squads are built from team sheets. As of 2026-09-05 each
   row links to a player page (#/player/<club>/u<pid>) that shows the match
   log behind the appearance count, the club's listed coaching staff sits above
   the squad, and shirt numbers appear where a player wore one consistently.
   The sheets carry no positions, so none may appear — no guessed ones. */

const CLUB = '#/club/ac-connecticut';

test('every squad row links to that player’s page', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const links = page.locator('.apps-row > a');
  const n = await links.count();
  expect(n).toBeGreaterThan(15);
  for (const href of await links.evaluateAll(as => as.map(a => a.getAttribute('href')))) {
    expect(href).toMatch(/^#\/player\/ac-connecticut\/u\d+$/);
  }
  await expect(page.locator('.apps-list .apps-head')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the club’s coaching staff from the team sheet sits above the squad', async ({ page }) => {
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const staff = page.locator('.usl2staff li');
  expect(await staff.count()).toBeGreaterThan(0);
  await expect(staff.first().locator('.sq-pos')).not.toHaveText('');
  await expect(page.locator('.kicker.sq-sub')).toContainText('Coaching staff');
});

test('a USL2 player page shows the appearance stats and the match log behind them', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  const first = page.locator('.apps-row > a').first();
  const name = (await first.locator('.apps-name').textContent() || '').trim();
  const total = Number((await first.locator('.apps-n').evaluate(e => e.childNodes[0].textContent)).trim());
  await first.click();
  await expect(page).toHaveURL(/#\/player\/ac-connecticut\/u\d+$/);
  await expect(page.locator('h2')).toHaveText(name);
  await expect(page.locator('.statgrid .stat')).toHaveCount(6);
  await expect(page.locator('.statgrid .stat').first()).toContainText(String(total));
  await expect(page.locator('.mlog li')).toHaveCount(total);
  await expect(page.locator('.mlog li .ml-role').first()).toHaveText(/Started|Bench/);
  await expect(page.locator('.mlog li .ml-score b').first()).toHaveText(/^[WDL]?$/);
  // no position, no age, anywhere on the sheet-driven page
  const text = await page.locator('.clubhead, .statgrid, .mlog').allInnerTexts();
  expect(text.join(' ')).not.toMatch(/\b(19|20)\d\d\b/);
  expect(text.join(' ')).not.toMatch(/\b(GK|DF|MF|FW)\b/);
  expect(errors).toEqual([]);
});

test('an unknown sheet player id falls back to the club page', async ({ page }) => {
  await gotoRoute(page, '#/player/ac-connecticut/u0');
  await page.waitForSelector('.apps-row');
  await expect(page.locator('h2').first()).toContainText('AC Connecticut');
});

test('the match log rows carry a real date and a club-side score', async ({ page }) => {
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.apps-row');
  await page.locator('.apps-row > a').first().click();
  await page.waitForSelector('.mlog li');
  const rows = await page.locator('.mlog li').evaluateAll(lis => lis.map(li => ({
    date: li.querySelector('.ml-date').textContent.trim(),
    res: li.querySelector('.ml-score b').textContent.trim(),
    score: li.querySelector('.ml-score').textContent.replace(/[WDL]/, '').trim(),
  })));
  for (const r of rows) {
    expect(r.date).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    if (!r.score) continue;
    const [gf, ga] = r.score.split('–').map(Number);
    expect(r.res).toBe(gf > ga ? 'W' : gf < ga ? 'L' : 'D');
  }
});

/* Roster-driven squads (pro clubs) got the same table treatment: a header
   row, fixed columns, and a legend instead of bare "1g 0a". */
test('a pro club’s squad table has a header row and a legend', async ({ page }) => {
  await gotoRoute(page, '#/club/atlanta-united');
  await page.waitForSelector('.squad .sq-head');
  await expect(page.locator('.squad .sq-head .sq-ga')).toContainText('G · A');
  await expect(page.locator('.squad li a .sq-ga').first()).toHaveText(/^(\d+ · \d+|\d+ CS)$/);
  await expect(page.locator('.note', { hasText: 'goals and assists' })).toHaveCount(1);
  // no empty staff box when the club has no listed coach
  for (const ul of await page.locator('.squad.staff').all()) expect(await ul.locator('li').count()).toBeGreaterThan(0);
});

/* Coaching staff rows open #/staff/<sid>: the record the sheets support plus
   an honest blank where a résumé would go and the claim form to fill it. */
test('a staff row opens a coach page with the sheet record and a claim path', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, CLUB);
  await page.waitForSelector('.usl2staff li a');
  const first = page.locator('.usl2staff li a').first();
  const name = (await first.locator('.sq-name').textContent() || '').trim();
  const sheets = Number(((await first.locator('.sq-form').textContent()) || '').match(/(\d+) sheet/)[1]);
  expect(await first.getAttribute('href')).toMatch(/^#\/staff\/\d+$/);
  await first.click();
  await expect(page).toHaveURL(/#\/staff\/\d+$/);
  await expect(page.locator('h2')).toHaveText(name);
  await expect(page.locator('.statgrid .stat')).toHaveCount(3);
  await expect(page.locator('.statgrid .stat').first()).toContainText(String(sheets));
  await expect(page.locator('.mlog li')).toHaveCount(sheets);
  await expect(page.locator('.kicker', { hasText: 'résumé' })).toHaveCount(1);
  await expect(page.locator('.claimform select[name=role] option').first()).toHaveText(/this coach/);
  await expect(page.locator('.claimform input[name=fa]')).toHaveCount(0);
  await expect(page.locator('h2')).not.toHaveText(/\b(19|20)\d\d\b/);
  expect(errors).toEqual([]);
});

test('an unknown staff id is a 404, not a blank page', async ({ page }) => {
  await gotoRoute(page, '#/staff/0');
  await expect(page.locator('.kicker', { hasText: '404' })).toHaveCount(1);
  await expect(page.locator('.mlog')).toHaveCount(0);
});
