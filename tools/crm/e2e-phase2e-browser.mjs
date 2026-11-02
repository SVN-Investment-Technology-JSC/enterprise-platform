// Kiểm GĐ E phase 2 (chào thầu; chạy tools/crm/e2e-phase2e.mjs trước để có dữ liệu) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2e-browser.mjs [--shots=<thư mục>]
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
const openByName = async (page, text) => {
  await goto(page, '#opportunities');
  await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
  await page.waitForTimeout(1200);
  const search = page.locator('input[placeholder*="Tìm"]').first();
  await search.fill(text);
  await page.waitForTimeout(1800);
  await page.locator('tbody tr.ant-table-row', { hasText: text }).first().getByRole('button', { name: /^(Xem|Mở)$/ }).first().click();
  await page.waitForTimeout(3000);
};

try {
  {
    const { context, page } = await login('nv1');
    await openByName(page, 'P2E-liên danh');
    let t = await page.locator('body').innerText();
    check('TC-TND-01 (trình duyệt) dự án luồng Chào thầu: có khối "Hồ sơ thầu" với thông tin gói thầu', t.includes('Hồ sơ thầu') && /Sở Thông tin/.test(t), '');
    check('TC-TND-14 (trình duyệt) danh sách đối tác liên danh hiển thị', /Công ty đối tác A/.test(t), '');
    check('TC-TND-03 (trình duyệt) trạng thái duyệt phương án và các vòng hiển thị', /Đã duyệt|Chờ duyệt|Bị từ chối|vòng/i.test(t), '');
    check('TC-TND-08 (trình duyệt) kết quả thầu Trúng hiển thị giá trúng', /Trúng/.test(t) && /18\.500\.000/.test(t), '');
    await shot(page, 'e-tender-won');
    await context.close();
  }
  {
    const { context, page } = await login('nv1');
    await openByName(page, 'không liên danh');
    const t = await page.locator('body').innerText();
    check('TC-TND-09 (trình duyệt) Trượt: hiển thị đơn vị trúng và lý do, không hiện gợi ý chăm sóc', /Công ty Đối Thủ/.test(t) && /Giá cao hơn đối thủ/.test(t) && !/gợi ý.*chăm sóc|chăm sóc lại/i.test(t), '');
    await shot(page, 'e-tender-lost');
    await context.close();
  }
  {
    const { context, page } = await login('nv1');
    await goto(page, '#opportunities');
    await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
    await page.locator('input[placeholder*="Tìm"]').first().fill('P2E-');
    await page.waitForTimeout(1800);
    const t = await page.locator('tbody tr.ant-table-row').allInnerTexts();
    check('TC-PL-11 (trình duyệt) danh sách dự án có cột Luồng, dự án thầu thuộc "Chào thầu"', t.filter((r) => r.includes('gói thầu')).every((r) => r.includes('Chào thầu')) && t.filter((r) => r.includes('thường')).every((r) => r.includes('Bán hàng thông thường')) && t.some((r) => r.includes('Chào thầu')), `${t.length} dòng`);
    await shot(page, 'e-pipeline-filter');
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
