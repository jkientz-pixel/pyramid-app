// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* The claim flow talks to three endpoints; every test stubs them so the
   screen's three faces can be exercised without a D1 or a mailbox. */
const CLUB = { id: 'atlanta-united', name: 'Atlanta United', domain: 'atlutd.com' };

const stubSession = (page, signedIn, email) => page.route('**/api/auth/session', r =>
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(signedIn ? { ok: true, signedIn: true, email, picks: '', home: false, rev: 0 } : { ok: true, signedIn: false }) }));

const stubClaim = (page, state) => page.route('**/api/claim?*', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, club: CLUB, ...state }) }));

/* a 600x600 PNG minted in the browser, so the size check has something real */
async function pngBuffer(page, size) {
  const dataUrl = await page.evaluate(s => {
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d'); g.fillStyle = '#c00'; g.beginPath(); g.arc(s / 2, s / 2, s / 2.5, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  }, size);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('club page carries the claim CTA and it routes to #/claim', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, false);
  await gotoRoute(page, '#/club/atlanta-united');
  const cta = page.locator('a.claim[href="#/claim/atlanta-united"]').first();
  await expect(cta).toBeVisible();
  await expect(page.locator('details', { hasText: 'Run this club? Add to this page' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('signed out: the claim screen asks for a club email and explains the instant path', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, false);
  await stubClaim(page, { signedIn: false });
  await gotoRoute(page, '#/claim/atlanta-united');
  await expect(page.locator('h2.disp')).toHaveText('Atlanta United');
  await expect(page.locator('.claimauth input[name=email]')).toBeVisible();
  await expect(page.locator('.claimscr')).toContainText('atlutd.com');
  expect(errors).toEqual([]);
});

test('unknown club is an honest not-found', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, false);
  await gotoRoute(page, '#/claim/no-such-club-xyz');
  await expect(page.locator('h2.disp')).toContainText("isn't here");
  expect(errors).toEqual([]);
});

test('signed in on the club domain: claim form promises instant verification and posts', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, true, 'media@atlutd.com');
  await stubClaim(page, { signedIn: true, email: 'media@atlutd.com', emailDomain: 'atlutd.com', freeMail: false, selfVerifies: true, claim: null });
  await gotoRoute(page, '#/claim/atlanta-united');
  await expect(page.locator('.claim-ok')).toContainText('verify instantly');
  let posted = null;
  await page.route('**/api/claim', r => {
    if (r.request().method() !== 'POST') return r.fallback();
    posted = r.request().postDataJSON();
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"status":"verified","domainMatch":true}' });
  });
  await page.click('.claimform .joinbtn');
  await expect(page.locator('.claimform .claim-msg')).toContainText('name is required');
  await page.fill('.claimform input[name=repName]', 'Sam Media');
  await page.selectOption('.claimform select[name=repRole]', 'media');
  /* after the POST the screen re-asks /api/claim; answer "verified" this time */
  await page.unroute('**/api/claim?*');
  await stubClaim(page, { signedIn: true, email: 'media@atlutd.com', emailDomain: 'atlutd.com', freeMail: false, selfVerifies: true,
    claim: { id: 1, ts: '2026-08-24T12:00:00Z', status: 'verified', domainMatch: 1, repName: 'Sam Media', repRole: 'media' } });
  await page.route('**/api/club-profile?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"submission":null}' }));
  await page.click('.claimform .joinbtn');
  await expect(page.locator('form.intake')).toBeVisible();
  expect(posted.club).toBe('atlanta-united');
  expect(posted.repRole).toBe('media');
  expect(errors).toEqual([]);
});

test('signed in on gmail with a pending claim: form stays hidden, review notice shows', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, true, 'coach@gmail.com');
  await stubClaim(page, { signedIn: true, email: 'coach@gmail.com', emailDomain: 'gmail.com', freeMail: true, selfVerifies: false,
    claim: { id: 2, ts: '2026-08-24T12:00:00Z', status: 'pending', domainMatch: 0, repName: 'Pat Coach', repRole: 'coach' } });
  await gotoRoute(page, '#/claim/atlanta-united');
  await expect(page.locator('.claim-warn')).toContainText('under review');
  await expect(page.locator('form.intake')).toHaveCount(0);
  await expect(page.locator('.claimscr')).toContainText('atlutd.com');
  expect(errors).toEqual([]);
});

test('verified: intake form prefills known data, rejects a small crest, then posts multipart', async ({ page }) => {
  const errors = trackErrors(page);
  await stubSession(page, true, 'media@atlutd.com');
  await stubClaim(page, { signedIn: true, email: 'media@atlutd.com', emailDomain: 'atlutd.com', freeMail: false, selfVerifies: true,
    claim: { id: 1, ts: '2026-08-24T12:00:00Z', status: 'verified', domainMatch: 1, repName: 'Sam Media', repRole: 'media' } });
  await page.route('**/api/club-profile?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"submission":null}' }));
  await gotoRoute(page, '#/claim/atlanta-united');
  const f = page.locator('form.intake');
  await expect(f).toBeVisible();
  /* seeded from CLUBS: the club's own website and capacity */
  await expect(f.locator('input[name=website]')).toHaveValue('https://atlutd.com');
  await expect(f.locator('input[name=capacity]')).toHaveValue('71000');
  /* optional groups are collapsed; the essentials are not */
  await expect(f.locator('details.fgroup')).toHaveCount(5);
  await expect(f.locator('fieldset legend', { hasText: 'The essentials' })).toBeVisible();

  const small = await pngBuffer(page, 200);
  await f.locator('input[name=logo]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: small });
  await expect(f.locator('.logo-msg')).toContainText('too small');

  const big = await pngBuffer(page, 600);
  await f.locator('input[name=logo]').setInputFiles({ name: 'crest.png', mimeType: 'image/png', buffer: big });
  await expect(f.locator('.logo-msg')).toContainText('600×600px');

  await f.locator('input[name=contactEmail]').fill('info@atlutd.com');
  await f.locator('input[name=venueName]').fill('Mercedes-Benz Stadium');
  await f.locator('input[name=venueCity]').fill('Atlanta');
  await f.locator('input[name=venueState]').fill('GA');
  await f.locator('select[name=surface]').selectOption('turf');

  let ct = '', body = '';
  await page.route('**/api/club-profile', r => {
    if (r.request().method() !== 'POST') return r.fallback();
    ct = r.request().headers()['content-type'] || '';
    body = r.request().postData() || '';
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"fields":7,"logo":{"mime":"image/png","w":600,"h":600,"bytes":1234}}' });
  });
  await f.locator('.joinbtn').click();
  await expect(page.locator('.claim-ok')).toContainText('Got it');
  expect(ct).toContain('multipart/form-data');
  expect(body).toContain('name="club"');
  expect(body).toContain('name="surface"');
  expect(body).toContain('name="logo"; filename="crest.png"');
  /* untouched colour pickers must not post #000000 as the club's colours */
  expect(body).not.toContain('name="color1"');
  expect(errors).toEqual([]);
});
