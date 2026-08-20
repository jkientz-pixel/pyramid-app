// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    /* Blocked on purpose. The app registers a service worker on every page
       load; a context torn down mid-install took the whole browser process
       with it (SIGSEGV, same fault address every time), and whichever test
       started next died with "browser has been closed" — a ~30% chance per
       run of one random unrelated failure. Blocking it took that to ~8%.
       tests/sw.spec.js opts back in so the registration still has coverage. */
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  /* channel:'chromium' picks the full headless browser over Playwright's
     default chrome-headless-shell. The shell is the binary that crashes, and
     it also skips the /favicon.ico a real Chrome requests — which is how two
     generated pages 404'd unnoticed. Slightly slower, honest about what
     production browsers actually do. */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    // dev_server.py resolves extensionless URLs (/app -> app.html) the way
    // Cloudflare Pages does; a bare http.server 404s the new internal links
    command: 'python3 scripts/dev_server.py 8080',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
});
