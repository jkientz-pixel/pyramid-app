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
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // dev_server.py resolves extensionless URLs (/app -> app.html) the way
    // Cloudflare Pages does; a bare http.server 404s the new internal links
    command: 'python3 scripts/dev_server.py 8080',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
});
