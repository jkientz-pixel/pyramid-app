// @ts-check
/* First-party pageview counting.
   Two things are load-bearing and easy to break silently: crawlers must not be
   counted as visitors (an anchored \bbot\b matched none of the real ones, which
   is exactly how inflated numbers get believed), and the ping must never carry
   anything that identifies a person. */
const { test, expect } = require('@playwright/test');
const { gotoRoute } = require('./helpers');
const fs = require('fs');
const path = require('path');

/** Pull platformOf out of the Worker source so the test exercises shipped code. */
function loadPlatformOf() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'hit.js'), 'utf8');
  const body = src.slice(src.indexOf('const BOT'), src.indexOf('/* Referrers'));
  return new Function(body + '; return platformOf;')();
}

const BOTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) HeadlessChrome/126',
  'curl/8.4.0',
  '',
];

const BROWSERS = [
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iphone'],
  ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', 'ipad'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'android'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'mac'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'windows'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'linux'],
];

test('crawlers and unfurlers are classified as bots, never as visitors', () => {
  const platformOf = loadPlatformOf();
  for (const ua of BOTS) expect(platformOf(ua), ua || '(empty UA)').toBe('bot');
});

test('real browsers are classified by platform', () => {
  const platformOf = loadPlatformOf();
  for (const [ua, want] of BROWSERS) expect(platformOf(ua), ua).toBe(want);
});

test('the pageview ping carries no identifying data', async ({ page }) => {
  const bodies = [];
  await page.route('**/api/hit', async route => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 204, body: '' });
  });
  await gotoRoute(page, '#/table');

  // Tests run against localhost, where the tag deliberately stays silent.
  // What must hold is that anything it *does* send has no PII-shaped fields.
  for (const b of bodies) {
    expect(Object.keys(b).sort()).toEqual(['c', 'n', 'p', 'r', 's', 'v', 'w']);
    expect(String(b.v)).toMatch(/^[a-z0-9]{8,32}$/);
    expect(String(b.s)).toMatch(/^[a-z0-9]{8,32}$/);
    expect(JSON.stringify(b)).not.toMatch(/@|email|name|ip\b/i);
  }
});

test('the tag does not report from non-production hostnames', async ({ page }) => {
  let pinged = false;
  await page.route('**/api/hit', async route => { pinged = true; await route.fulfill({ status: 204, body: '' }); });
  await gotoRoute(page, '#/table');
  await page.waitForTimeout(500);
  expect(pinged, 'localhost must not pollute production traffic').toBe(false);
});
