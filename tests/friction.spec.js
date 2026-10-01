// @ts-check
/* First-party friction signals (rage clicks, dead clicks, our own JS errors).
   Load-bearing: the events must fire when a page really gets in the way, must
   stay quiet when it doesn't, and must never carry page text, typed input or
   anything else that identifies a person. */
const { test, expect } = require('@playwright/test');
const { gotoRoute } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Import the shipped Worker as ESM. The repo is CommonJS, so copy both
    modules to .mjs in a temp dir with the relative import rewritten. */
async function loadFriction() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rxi-friction-'));
  fs.copyFileSync(path.join(ROOT, 'functions/api/hit.js'), path.join(dir, 'hit.mjs'));
  const src = fs.readFileSync(path.join(ROOT, 'functions/api/friction.js'), 'utf8')
    .replace("from './hit.js'", "from './hit.mjs'");
  fs.writeFileSync(path.join(dir, 'friction.mjs'), src);
  return import(path.join(dir, 'friction.mjs'));
}

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const VALID = { k: 'rage', p: '#/radar', t: 'section#radar > button.go', x: null, v: 'abcdefgh12345678', s: 'zyxwvuts87654321' };

/** Run onRequestPost against a fake D1 and return the bound row (or null). */
async function post(mod, body, ua = BROWSER_UA) {
  let bound = null;
  const env = { DB: { prepare: () => ({ bind: (...a) => { bound = a; return { run: async () => {} }; } }) } };
  const request = new Request('https://www.rankedxi.com/api/friction', {
    method: 'POST',
    headers: { 'user-agent': ua, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await mod.onRequestPost({ request, env });
  expect(res.status).toBe(204);
  return bound;
}

test('a valid rage event is stored with a coarse platform and no detail', async () => {
  const mod = await loadFriction();
  const row = await post(mod, VALID);
  expect(row).not.toBeNull();
  // ts, d, path, kind, tgt, detail, vid, sid, plat
  expect(row.slice(2)).toEqual(['#/radar', 'rage', 'section#radar > button.go', null, VALID.v, VALID.s, 'iphone']);
});

test('unknown kinds, bad ids, bots and oversized bodies are dropped', async () => {
  const mod = await loadFriction();
  expect(await post(mod, { ...VALID, k: 'keystroke' })).toBeNull();
  expect(await post(mod, { ...VALID, v: 'bad id!' })).toBeNull();
  expect(await post(mod, VALID, 'Mozilla/5.0 (compatible; Googlebot/2.1)')).toBeNull();
  expect(await post(mod, JSON.stringify({ ...VALID, pad: 'x'.repeat(3000) }))).toBeNull();
  expect(await post(mod, 'not json')).toBeNull();
});

test('targets that are not our markup are discarded, not stored', async () => {
  const mod = await loadFriction();
  const row = await post(mod, { ...VALID, t: 'Hello my email is a@b.com' });
  expect(row[4]).toBeNull();
});

test('error detail is scrubbed of emails and query strings', async () => {
  const mod = await loadFriction();
  const row = await post(mod, { ...VALID, k: 'err', x: 'Failed for jo@example.com at /api/x?token=abc123 @app.js:12' });
  expect(row[5]).toBe('Failed for [email] at /api/x @app.js:12');
  // detail is never kept for click kinds, whatever the client sends
  const click = await post(mod, { ...VALID, k: 'dead', x: 'anything' });
  expect(click[5]).toBeNull();
});

/* The tag is silent off rankedxi.com, so serve a copy that believes it is in
   production. Everything else about it is the shipped file. */
async function armTag(page) {
  const src = fs.readFileSync(path.join(ROOT, 'js/rxi-a.js'), 'utf8')
    .replace('/(^|\\.)rankedxi\\.com$/.test(location.hostname)', 'true');
  expect(src).toContain('var HOST_OK = true');
  await page.route('**/js/rxi-a.js*', r => r.fulfill({ contentType: 'application/javascript', body: src }));
  await page.route('**/api/hit', r => r.fulfill({ status: 204, body: '' }));
  const events = [];
  await page.route('**/api/friction', async r => {
    events.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status: 204, body: '' });
  });
  return events;
}

async function addButton(page, id, label, onClick) {
  await page.evaluate(([id, label, onClick]) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;padding:20px';
    if (onClick === 'mutate') b.onclick = () => { b.dataset.n = String(Date.now()); };
    document.body.appendChild(b);
  }, [id, label, onClick]);
}

test('a button that does nothing is reported as a dead click, by markup not by its words', async ({ page }) => {
  const events = await armTag(page);
  await gotoRoute(page, '#/table');
  await addButton(page, 'noop', 'Email me at secret@example.com', 'none');
  await page.click('#noop');
  await expect.poll(() => events.filter(e => e.k === 'dead').length, { timeout: 3000 }).toBe(1);
  const e = events.find(e => e.k === 'dead');
  expect(Object.keys(e).sort()).toEqual(['k', 'p', 's', 't', 'v', 'x']);
  expect(e.t).toBe('button#noop');
  expect(JSON.stringify(events)).not.toMatch(/secret|example\.com/);
});

test('a button that changes the page is not a dead click', async ({ page }) => {
  const events = await armTag(page);
  await gotoRoute(page, '#/table');
  await addButton(page, 'works', 'Go', 'mutate');
  await page.click('#works');
  await page.waitForTimeout(1400);
  expect(events.filter(e => e.k === 'dead')).toEqual([]);
});

test('three fast clicks on one spot are reported once as rage', async ({ page }) => {
  const events = await armTag(page);
  await gotoRoute(page, '#/table');
  await addButton(page, 'stuck', 'Go', 'mutate');
  await page.click('#stuck', { clickCount: 1 });
  await page.click('#stuck', { clickCount: 1 });
  await page.click('#stuck', { clickCount: 1 });
  await expect.poll(() => events.filter(e => e.k === 'rage').length, { timeout: 2000 }).toBe(1);
  expect(events.find(e => e.k === 'rage').t).toBe('button#stuck');
});

test('our own uncaught errors are reported; foreign scripts are not', async ({ page }) => {
  const events = await armTag(page);
  await gotoRoute(page, '#/table');
  await page.evaluate(() => {
    const ours = new ErrorEvent('error', { message: 'TypeError: boom', filename: location.origin + '/js/app.js?v=1', lineno: 42 });
    const theirs = new ErrorEvent('error', { message: 'ext broke', filename: 'chrome-extension://abc/x.js', lineno: 1 });
    dispatchEvent(ours);
    dispatchEvent(theirs);
  });
  await expect.poll(() => events.filter(e => e.k === 'err').length, { timeout: 2000 }).toBe(1);
  expect(events.find(e => e.k === 'err').x).toBe('TypeError: boom @app.js:42');
});

test('friction stays silent off production hostnames', async ({ page }) => {
  let pinged = false;
  await page.route('**/api/friction', async r => { pinged = true; await r.fulfill({ status: 204, body: '' }); });
  await gotoRoute(page, '#/table');
  await addButton(page, 'noop', 'x', 'none');
  await page.click('#noop');
  await page.waitForTimeout(1400);
  expect(pinged).toBe(false);
});
