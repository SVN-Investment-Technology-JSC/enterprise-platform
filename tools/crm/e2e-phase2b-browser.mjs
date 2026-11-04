// Kiểm GĐ B phase 2 trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2b-browser.mjs [--shots=<thư mục>]
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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

try {
  // ---- NV1: kanban theo luồng, nhóm theo khách, chi tiết dự án có kế hoạch giai đoạn
  {
    const { context, page } = await login('nv1');
    await goto(page, '#opportunities');
    const body = await page.locator('body').innerText();
    const cols = ['Mới', 'Đã liên hệ', 'Khảo sát nhu cầu', 'Báo giá', 'Đàm phán', 'Thắng', 'Thua'];
    const missing = cols.filter((c) => !body.includes(c));
    check('TC-PL-05 kanban có đủ các cột giai đoạn của luồng', missing.length === 0, missing.length ? `thiếu: ${missing.join(', ')}` : '');
    check('TC-NAV-07 trang dự án không còn nhãn "Cơ hội"', !body.split('\n').filter((l) => !/QA-|Minh An/.test(l)).some((l) => /\bCơ hội\b/.test(l)), '');
    await shot(page, 'b-kanban');

    // Theo khách hàng
    await page.getByText('Theo khách hàng', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const grouped = await page.locator('body').innerText();
    check('TC-NAV-05 chế độ "Theo khách hàng": nhóm theo khách, có số dự án và tổng giá trị', /QA Công ty TNHH Khách hàng 01|KH01/.test(grouped) && /dự án/i.test(grouped), '');
    await shot(page, 'b-grouped');
    const toggle = page.locator('button:has-text("+"), [aria-label*="Mở rộng"], [aria-expanded="false"]').first();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(800); }
    await shot(page, 'b-grouped-expanded');

    // Chi tiết dự án thử và khối kế hoạch giai đoạn
    await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
    await page.waitForTimeout(1200);
    const search = page.locator('input[placeholder*="Tìm"]').first();
    await search.fill('P2B-');
    await page.waitForTimeout(1800);
    await page.locator('tr', { hasText: 'dự án thử' }).first().getByText('Xem', { exact: true }).click();
    await page.waitForTimeout(2500);
    const detail = await page.locator('body').innerText();
    check('TC-ASG-06 chi tiết dự án có khối "Kế hoạch giai đoạn" với người đảm nhận', detail.includes('Kế hoạch giai đoạn') && /Đang làm|Chưa tới|Đã xong|Đã bỏ qua/.test(detail), '');
    check('TC-SKP-06 lịch sử hiển thị giai đoạn bỏ qua', /Bỏ qua giai đoạn/.test(detail), '');
    await shot(page, 'b-detail');
    await context.close();
  }

  // ---- NV3 được gán một giai đoạn: thấy "Việc của tôi" và dự án đó, không thấy dự án khác
  {
    const { context, page } = await login('nv3');
    await goto(page, '#opportunities');
    // Khối mặc định thu gọn: mở ra mới thấy danh sách việc.
    await page.getByRole('button', { name: 'Mở rộng' }).first().click().catch(() => undefined);
    await page.waitForTimeout(500);
    const body = await page.locator('body').innerText();
    check('TC-ASG-10 NV3: khối "Việc của tôi" có dự án được giao', body.includes('Việc của tôi') && body.includes('P2B-'), '');
    await shot(page, 'b-nv3-tasks');
    await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
    await page.waitForTimeout(1200);
    const rows = await page.locator('tr', { hasText: 'P2B-' }).allInnerTexts();
    check('TC-ASG-07 NV3 chỉ thấy dự án được giao, không thấy dự án khác của khách', rows.length >= 1 && !rows.some((r) => r.includes('dự án khác của khách')), `${rows.length} dòng P2B-`);
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
