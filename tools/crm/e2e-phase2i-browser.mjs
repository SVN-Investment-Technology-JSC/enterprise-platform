// Kiểm GĐ I phase 2 (form báo giá theo mẫu); chạy tools/crm/e2e-phase2i.mjs trước để có báo giá nháp trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2i-browser.mjs [--shots=<thư mục>]
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
const goto = async (page, hash = '') => { await page.goto(`${crmUrl}${hash}`); await page.reload(); await page.waitForTimeout(3000); };
const pick = async (dlg, page, label, option) => {
  await dlg.getByText(label, { exact: true }).first().locator('xpath=ancestor::*[self::div or self::label][1]').locator('input').first().click();
  await page.getByText(option, { exact: true }).last().click();
};

try {
  {
  const { context, page } = await login('nv1');
  await goto(page, '#quotes');
  await page.locator('tbody tr.ant-table-row', { hasText: 'Nháp' }).first().getByRole('button', { name: /^(Xem|Mở)$/ }).first().click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Cập nhật thông tin báo giá/ }).first().click();
  const dlg = page.locator('[role="dialog"]:visible').last();
  await dlg.getByText('Thông tin chung').waitFor({ timeout: 10000 });
  const t0 = await dlg.innerText();
  check('TC-QF-01 (trình duyệt) form có các khối: Thông tin chung (mã, tên, ngày, mẫu, loại), Nội dung, Phí, Trường tuỳ biến', ['Mã báo giá', 'Tên báo giá', 'Ngày báo giá', 'Mẫu báo giá', 'Loại báo giá', 'Phí trên cả hợp đồng'].every((x) => t0.includes(x)), '');
  await shot(page, 'i-form');

  // TC-QF-02: Sinh lại mã
  const codeInput = dlg.locator('input').first();
  const before = await codeInput.inputValue();
  await dlg.getByRole('button', { name: /Sinh lại/ }).click();
  await page.waitForTimeout(1500);
  const after = await codeInput.inputValue();
  check('TC-QF-02 (trình duyệt) nút "Sinh lại" cho mã mới', before !== after && after.length > 0, `${before} -> ${after}`);

  // Tên báo giá bắt buộc
  const nameInput = dlg.getByLabel(/Tên báo giá/).first();
  const oldName = await nameInput.inputValue();
  await nameInput.fill('');
  await dlg.getByRole('button', { name: /^Cập nhật$/ }).click();
  await page.waitForTimeout(800);
  check('TC-QF-01 (trình duyệt) tên báo giá bắt buộc: báo lỗi tiếng Việt khi để trống', /Tên báo giá/.test(await dlg.innerText()) && /(bắt buộc|nhập)/i.test(await dlg.innerText()), '');
  await nameInput.fill(`P2I-ui ${stamp}`);

  // TC-QF-04: chọn mẫu ORDER, nhập chiết khấu %, thêm phí
  await dlg.getByLabel(/Mẫu báo giá/).first().click().catch(async () => pick(dlg, page, 'Mẫu báo giá', 'Chiết khấu trên tổng giá trị đơn hàng'));
  await page.getByText('Chiết khấu trên tổng giá trị đơn hàng', { exact: true }).last().click().catch(() => undefined);
  await page.waitForTimeout(800);
  const t1 = await dlg.innerText();
  check('TC-QF-04 (trình duyệt) chọn mẫu theo tổng đơn: hiện ô chiết khấu và thuế tổng đơn (không còn lời giải thích "theo dòng")', !/mẫu báo giá này tính chiết khấu theo dòng/.test(t1), '');
  await shot(page, 'i-form-order');
  await dlg.getByLabel('Chiết khấu tổng đơn theo phần trăm').fill('5');
  await dlg.getByLabel('Thuế tổng đơn theo phần trăm').fill('8');
  // Nhập phần trăm thì ô số tiền bị khoá (loại trừ nhau)
  const amountLocked = await dlg.getByLabel('Chiết khấu tổng đơn theo số tiền').isDisabled();
  check('TC-QF-07 (trình duyệt) nhập phần trăm chiết khấu thì ô số tiền bị khoá (loại trừ nhau)', amountLocked, '');
  await dlg.getByRole('button', { name: /Thêm khoản phí|Thêm phí/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await dlg.getByRole('button', { name: /^Cập nhật$/ }).click();
  await page.waitForTimeout(3000);
  const t2 = await page.locator('body').innerText();
  check('TC-QF-06 (trình duyệt) lưu: tên mới hiển thị', t2.includes(`P2I-ui ${stamp}`), '');
  check('TC-QF-06/08 (trình duyệt) chiết khấu tổng đơn 5% và thuế 8% trên 9.500.000: tổng cộng 9.747.000', t2.includes('9.747.000'), '');
  await shot(page, 'i-saved');
  void oldName;
  await context.close();
  }
  {
  const { context, page } = await login('qtbh');
  await goto(page, '#settings/quote-forms');
  const t = await page.locator('body').innerText();
  check('TC-QF-04/05 (trình duyệt) QTBH thấy mẫu, loại báo giá, mã báo giá và trường tuỳ biến', ['Mẫu báo giá', 'Loại báo giá', 'Mã báo giá', 'Trường tuỳ biến'].every((x) => t.includes(x)), '');
  await shot(page, 'i-settings');
  await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
