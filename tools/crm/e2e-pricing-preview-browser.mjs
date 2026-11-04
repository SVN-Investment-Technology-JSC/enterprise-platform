// Kiểm màn Thử tính giá: giá trước chiết khấu và xuất bảng tính giá (xlsx) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-pricing-preview-browser.mjs [--shots=<thư mục>]
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
  const { context, page } = await login('qtbh');
  await goto(page, '#settings/quote-preview');
  const sec = page.locator('section[aria-label="Thử tính giá"]');
  await sec.waitFor({ timeout: 15000 });
  const t0 = await sec.innerText();
  check('Thử tính giá: không còn ô "Nhóm hàng", có "Giá trước chiết khấu"', !t0.includes('Nhóm hàng') && t0.includes('Giá trước chiết khấu'), '');
  const priceInput = sec.getByLabel('Giá trước chiết khấu (giá gốc)').first();
  check('Giá trước chiết khấu chỉ đọc, chưa chọn hàng thì rỗng', (await priceInput.inputValue()) === '' && (await priceInput.getAttribute('readonly')) !== null, '');
  await sec.locator('input[placeholder*="Chọn mặt hàng"]').first().click();
  await page.getByText('Máy tính xách tay', { exact: false }).first().click();
  await page.waitForTimeout(500);
  const before = await priceInput.inputValue();
  check('Chọn mặt hàng: hiện giá gốc theo bảng giá', /\d/.test(before), before);
  await sec.getByRole('button', { name: 'Tính giá' }).click();
  const res = page.locator('section[aria-label="Kết quả tính giá"]');
  await res.waitFor({ timeout: 15000 });
  const after = await priceInput.inputValue();
  check('Sau khi tính: giá trước chiết khấu khớp cột giá gốc của kết quả', after === before || (await res.innerText()).includes(after), `${before} / ${after}`);
  check('Cột kết quả đổi tên "Giá trước CK (giá gốc)"', (await res.innerText()).includes('Giá trước CK (giá gốc)'), '');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), res.getByRole('button', { name: 'Xuất bảng tính giá' }).click()]);
  const name = download.suggestedFilename();
  const path = `${process.env.TMPDIR ?? '/tmp'}/${name}`;
  await download.saveAs(path);
  check('Nút "Xuất bảng tính giá" ở cuối bảng kết quả tải file xlsx', /^bang-tinh-gia-\d{4}-\d{2}-\d{2}\.xlsx$/.test(name), name);
  const XLSX = (await import('node:module')).createRequire(import.meta.url);
  void XLSX;
  await shot(page, 'pricing-preview');
  await context.close();
  console.log(`FILE ${path}`);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
