// @ts-check
const { test, expect } = require('@playwright/test');

/* The suite blocks service workers (see playwright.config.js): registering one
   per context, then tearing that context down mid-install, crashed the browser
   process often enough to fail a random unrelated test in ~30% of runs. This
   file is the one place that opts back in, so the registration still has a
   test — coverage the suite never actually had before. */
test.use({ serviceWorkers: 'allow' });

test('the app registers a service worker that takes control of the page', async ({ page }) => {
  await page.goto('/app.html#/map');
  const scope = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(r => (r.active ? new URL(r.scope).pathname : 'inactive')),
    new Promise(r => setTimeout(() => r('timeout'), 15000)),
  ]));
  expect(scope).toBe('/');
});

test('the shell precache lists the code the app needs to boot', async ({ page }) => {
  /* an installed PWA once went blank offline because SHELL held the documents
     but not the JS — assert the modules are still in the list */
  const res = await page.request.get('/sw.js');
  const body = await res.text();
  for (const asset of ['/app.html', '/js/app.js', '/js/data.js', '/css/app.css']) {
    expect(body).toContain(asset);
  }
});
