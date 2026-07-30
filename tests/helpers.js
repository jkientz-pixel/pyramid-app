/* Shared test helpers: console/page error tracking and view-render waits. */

/** Collect page errors and console errors for later assertion. */
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return errors;
}

/** Wait until the SPA router has rendered something into #view. */
async function viewRendered(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('#view');
    return v && v.children.length > 0;
  });
}

/** Navigate to an app hash route and wait for the view to render. */
async function gotoRoute(page, hash) {
  await page.goto(`/app.html${hash}`);
  await viewRendered(page);
}

module.exports = { trackErrors, viewRendered, gotoRoute };
