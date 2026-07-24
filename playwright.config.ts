import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: process.platform === 'win32'
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }
      : undefined,
  },
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 120_000 },
})
