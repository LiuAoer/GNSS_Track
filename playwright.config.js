import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    channel: 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'npm run dev -- --port 5173', url: 'http://localhost:5173', reuseExistingServer: true },
});
