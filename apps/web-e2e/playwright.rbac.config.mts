import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export default defineConfig({
  testDir: './src',
  testMatch: 'authorization.spec.ts',
  workers: 1,
  outputDir: './test-output/rbac',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:44330',
    viewport: { width: 1600, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: 'node apps/web-e2e/fixtures/rbac-api.mjs',
      cwd: root,
      url: 'http://127.0.0.1:44331/health',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm exec next start --port 44330',
      cwd: resolve(root, 'apps/web'),
      url: 'http://127.0.0.1:44330',
      reuseExistingServer: false,
      env: { API_BASE_URL: 'http://127.0.0.1:44331' },
    },
  ],
});
