import { defineConfig, devices } from '@playwright/test';

// Separate ports keep the assistant's real-data checks away from other development sessions.
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'assistant.real.spec.ts', workers: 1, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:5185', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    { command: 'npm run dev', cwd: '../backend', env: { PORT: '3015', ANTHROPIC_API_KEY: '' }, url: 'http://127.0.0.1:3015/api/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5185 --strictPort', env: { MONEY_JUNGLE_API_TARGET: 'http://127.0.0.1:3015' }, url: 'http://127.0.0.1:5185', reuseExistingServer: false },
  ],
});
