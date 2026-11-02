// Kiểm GĐ B/H phase 2: TC-NAV-06 (tạo dự án bán hàng từ trang khách) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2h-browser.mjs [--shots=<thư mục>]
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire as createReq } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
// playwright-core không phải dependency trực tiếp của workspace: lấy từ kho pnpm (phiên bản nào có thì dùng).
function loadPlaywright() {
  try { return require('playwright-core'); } catch { /* thử kho pnpm */ }
  const dir = readdirSync(resolve(import.meta.dirname, '../../node_modules/.pnpm')).find((d) => d.startsWith('playwright-core@'));
  if (!dir) throw new Error('Không tìm thấy playwright-core.');
  return require(resolve(import.meta.dirname, '../../node_modules/.pnpm', dir, 'node_modules/playwright-core'));
}
const { chromium } = loadPlaywright();
const { values } = parseArgs({ options: { shots: { type: 'string', default: '' }, base: { type: 'string', default: 'http://localhost:8080' }, tenant: { type: 'string', default: 'svn' } } });
const password = process.env.SVN_SEED_PASSWORD;
if (!password) throw new Error('Thiếu SVN_SEED_PASSWORD.');
if (values.shots) mkdirSync(values.shots, { recursive: true });
const results = [];
const check = (tc, ok, detail = '') => { results.push({ tc, ok }); console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${detail}`); };

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

async function login(code) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${values.base}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(`${code}@${values.tenant}.local`);
  await page.locator('input[type="password"]').first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return { context, page };
}
const shot = async (page, name) => { if (values.shots) await page.screenshot({ path: `${values.shots}/${name}.png`, fullPage: false }); };

const crmUrl = `${values.base}/modules/crm`;
const stamp = Date.now() % 1_000_000;
try {
  const { context, page } = await login('nv1');
  await page.goto(`${crmUrl}#customers`); await page.reload(); await page.waitForTimeout(3000);
  await page.locator('tr', { hasText: 'QA-CRM-KH01' }).getByText('Xem', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole('tab', { name: /Dự án bán hàng/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Thêm dự án bán hàng/ }).first().click();
  const dlg = page.locator('[role="dialog"]:visible').last();
  await dlg.getByLabel(/Tên/).first().fill(`P2H-${stamp} từ trang khách`);
  await shot(page, 'h-nav06-dialog');
  await dlg.getByRole('button', { name: /^(Lưu|Tạo|Thêm)/ }).last().click();
  await page.waitForTimeout(2500);
  let t = await page.locator('body').innerText();
  check('TC-NAV-06 (trình duyệt) tạo dự án từ trang khách: hiện trong tab Dự án bán hàng của khách', t.includes(`P2H-${stamp} từ trang khách`), '');
  await page.goto(`${crmUrl}#opportunities`); await page.reload(); await page.waitForTimeout(3000);
  await page.getByText('Theo khách hàng', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const expand = page.locator('tr', { hasText: 'QA-CRM-KH01' }).first();
  await expand.click().catch(() => undefined);
  await page.waitForTimeout(1000);
  t = await page.locator('body').innerText();
  check('TC-NAV-06 (trình duyệt) dự án mới nằm trong nhóm của đúng khách ở chế độ "Theo khách hàng"', t.includes(`P2H-${stamp} từ trang khách`), '');
  await shot(page, 'h-nav06-grouped');
  await context.close();
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
