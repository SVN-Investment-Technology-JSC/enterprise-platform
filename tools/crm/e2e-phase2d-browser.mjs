// Kiểm GĐ D phase 2 (phương án kinh doanh) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2d-browser.mjs [--shots=<thư mục>]
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
const goto = async (page, hash = '') => { await page.goto(`${crmUrl}${hash}`); await page.reload(); await page.waitForTimeout(3000); };
const openQuote = async (page, code) => {
  await goto(page, '#quotes');
  const search = page.locator('input[placeholder*="Tìm"]').first();
  if (await search.count()) { await search.fill(code); await page.waitForTimeout(1500); }
  await page.locator('tbody tr.ant-table-row', { hasText: code }).first().first().click();
  await page.waitForTimeout(3000);
};
const CODE = process.env.PAKD_QUOTE_CODE ?? 'BG2600022';

try {
  {
    const { context, page } = await login('nv1');
    await openQuote(page, CODE);
    let t = await page.locator('body').innerText();
    check('TC-BP-01 (trình duyệt) báo giá nháp có khối "Phương án kinh doanh"', t.includes('Phương án kinh doanh'), '');
    const create = page.getByRole('button', { name: /Lập phương án kinh doanh/ }).first();
    if (await create.count()) await create.click();
    await page.waitForTimeout(2500);
    await shot(page, 'd-plan-created');
    await page.getByRole('button', { name: /Thêm dòng/ }).last().click().catch(() => undefined);
    await page.waitForTimeout(800);
    const amount = page.locator('input[inputmode="numeric"], input[inputmode="decimal"], .ant-input-number input').last();
    if (await amount.count()) await amount.fill('120000');
    await page.getByRole('button', { name: /^Lưu/ }).last().click().catch(() => undefined);
    await page.waitForTimeout(2500);
    t = await page.locator('body').innerText();
    check('TC-BP-01 (trình duyệt) lập PAKD: hiện doanh thu, giá vốn, lợi nhuận', /lợi nhuận/i.test(t) && /doanh thu/i.test(t) && /giá vốn/i.test(t), '');
    check('TC-BP-01 (trình duyệt) trạng thái duyệt hiển thị', /Đang soạn|Nháp|Chờ duyệt|Đã duyệt/.test(t), '');
    await shot(page, 'd-plan-saved');
    await context.close();
  }
  if (process.env.PAKD_PENDING_QUOTE_CODE) {
    const { context, page } = await login('tn');
    await openQuote(page, process.env.PAKD_PENDING_QUOTE_CODE);
    const t = await page.locator('body').innerText();
    const block = t.split('Phương án kinh doanh')[1] ?? '';
    check('TC-BP-04 (trình duyệt) người duyệt (TN) thấy doanh thu, giá vốn, lợi nhuận của PAKD chờ duyệt', /doanh thu/i.test(block) && /giá vốn/i.test(block) && /lợi nhuận/i.test(block) && /Chờ duyệt/.test(block), '');
    await shot(page, 'd-plan-approver');
    await context.close();
  }
  {
    const { context, page } = await login('ktv');
    await openQuote(page, CODE);
    const t = await page.locator('body').innerText();
    check('TC-BP-09 (trình duyệt) KTV (chỉ xem) không thấy lợi nhuận, giá vốn của PAKD', !/Lợi nhuận/.test(t.split('Phương án kinh doanh')[1] ?? ''), '');
    await shot(page, 'd-plan-ktv');
    await context.close();
  }
  {
    const { context, page } = await login('qtbh');
    await goto(page, '#settings/approval');
    let t = await page.locator('body').innerText();
    if (!t.includes('So lệch phương án kinh doanh')) { await page.getByText('Duyệt', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500); t = await page.locator('body').innerText(); }
    check('TC-BP-08 (trình duyệt) QTBH thấy cấu hình so lệch PAKD (chế độ, ngưỡng)', t.includes('So lệch phương án kinh doanh') && /Ngưỡng lệch/.test(t), '');
    await shot(page, 'd-settings');
    await context.close();
  }
  {
    const { context, page } = await login('nv1');
    await goto(page, '#settings/approval');
    const t = await page.locator('body').innerText();
    check('TC-BP-08 (trình duyệt) NV1 không thấy cấu hình so lệch PAKD', !t.includes('So lệch phương án kinh doanh'), '');
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
