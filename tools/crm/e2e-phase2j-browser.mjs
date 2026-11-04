// Kiểm GĐ J phase 2 (khuyến mãi theo dự án, chọn tài liệu có sẵn) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2j-browser.mjs [--shots=<thư mục>]
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

const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('ep_csrf='))?.split('=')[1];
  const r = await fetch(`/api/crm/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}, { method, path, body });
const code = `P2JUI${stamp}`;
const oppName = `P2J-UI-${stamp} khuyến mãi`;
let prepared;
try {
  {
  const { context, page } = await login('qtbh');
  await goto(page, '#settings/promotions');
  const sec = page.locator('section[aria-label="Khuyến mãi và chiết khấu"]');
  await sec.waitFor({ timeout: 10000 });
  check('TC-QF-17 (trình duyệt) QTBH thấy tab Cài đặt "Khuyến mãi và chiết khấu"', true, '');
  await sec.getByRole('button', { name: 'Thêm khuyến mãi' }).click();
  const dlg = page.locator('[role="dialog"]:visible').last();
  await dlg.getByLabel('Mã', { exact: true }).fill(code.toLowerCase());
  await dlg.getByLabel('Tên', { exact: true }).fill('Khuyến mãi thử UI');
  await dlg.getByLabel('Giá trị', { exact: true }).fill('150');
  await dlg.getByRole('button', { name: 'Lưu' }).click();
  await page.waitForTimeout(600);
  check('TC-QF-17 (trình duyệt) nhập phần trăm vượt 100: báo lỗi tiếng Việt, chưa lưu', /không quá 100/.test(await dlg.innerText()), '');
  await dlg.getByLabel('Giá trị', { exact: true }).fill('5');
  await dlg.getByRole('button', { name: 'Lưu' }).click();
  await page.waitForTimeout(2000);
  const txt = await sec.innerText();
  check('TC-QF-17 (trình duyệt) tạo chương trình khuyến mãi: hiện trong bảng, mã viết hoa, còn hiệu lực', txt.includes(code) && txt.includes('Còn hiệu lực'), '');
  await shot(page, 'j-settings');
  await context.close();
  }
  {
  const { context, page } = await login('nv1');
  await goto(page, '#opportunities');
  const kh = (await api(page, 'GET', '/customers?search=QA-CRM-KH01'));
  const customerId = (kh.items ?? kh)[0].id;
  const opp = await api(page, 'POST', '/opportunities', { customerId, name: oppName, expectedValue: 4000000 });
  const q = await api(page, 'POST', '/quotes', { customerId, opportunityId: opp.id, quoteName: `P2J-UI-${stamp} báo giá` });
  const quoteId = q.id ?? q.quote?.id;
  const types = await api(page, 'GET', '/document-types');
  const bytes = Buffer.from('noi dung tai lieu ui');
  const created = await api(page, 'POST', '/documents', { entityType: 'opportunity', entityId: opp.id, documentTypeId: types[0].id, name: 'Tài liệu UI', fileName: 'ui.pdf', contentType: 'application/pdf', sizeBytes: bytes.length });
  await fetch(created.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }, body: bytes });
  await api(page, 'POST', `/documents/${created.document.id}/versions/${created.version.id}/complete`, { sizeBytes: bytes.length });
  prepared = { opp, quoteId, quoteCode: q.code ?? q.quote?.code };

  // Dự án: thêm khuyến mãi
  await goto(page, '#opportunities');
  await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
  await page.waitForTimeout(1000);
  await page.locator('input[placeholder*="Tìm"]').first().fill(oppName);
  await page.waitForTimeout(1800);
  await page.locator('tbody tr.ant-table-row', { hasText: oppName }).first().first().click();
  await page.waitForTimeout(2500);
  const psec = page.locator('section[aria-label="Khuyến mãi của dự án"]');
  await psec.waitFor({ timeout: 10000 });
  check('TC-QF-17 (trình duyệt) chi tiết dự án có khối "Khuyến mãi của dự án" rỗng', /chưa có khuyến mãi/.test(await psec.innerText()), '');
  await psec.locator('input[placeholder*="Chọn từ danh mục"]').first().click();
  await page.getByText(code, { exact: false }).last().click();
  await psec.getByLabel('Ghi chú khuyến mãi').fill('Áp dụng cho dự án UI');
  await psec.getByRole('button', { name: 'Thêm khuyến mãi' }).click();
  await page.waitForTimeout(2000);
  check('TC-QF-17 (trình duyệt) thêm khuyến mãi vào dự án: hiện dòng kèm ghi chú', (await psec.innerText()).includes(code) && (await psec.innerText()).includes('Áp dụng cho dự án UI'), '');
  await shot(page, 'j-opp');
  await context.close();
  }
  {
  const { context, page } = await login('nv1');
  await goto(page, '#quotes');
  await page.locator('input[placeholder*="Tìm"]').first().fill(prepared.quoteCode).catch(() => undefined);
  await page.waitForTimeout(1800);
  await page.locator('tbody tr.ant-table-row', { hasText: prepared.quoteCode }).first().first().click();
  await page.waitForTimeout(3000);
  const qsec = page.locator('section[aria-label="Khuyến mãi"]');
  await qsec.waitFor({ timeout: 10000 });
  const t0 = await qsec.innerText();
  check('TC-QF-17 (trình duyệt) báo giá ghi rõ khuyến mãi chỉ là thông tin kèm theo', /không tự trừ vào tổng/.test(t0), '');
  await qsec.locator('input[placeholder*="Thêm khuyến mãi của dự án"]').first().click();
  await page.getByText(code, { exact: false }).last().click();
  await page.waitForTimeout(500);
  await qsec.getByRole('button', { name: 'Lưu khuyến mãi' }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'j-quote-promo');
  await page.reload(); await page.waitForTimeout(3500);
  const afterReload = await page.locator('section[aria-label="Khuyến mãi"]').innerText();
  check('TC-QF-17 (trình duyệt) lưu khuyến mãi cho báo giá, tải lại vẫn còn', afterReload.includes(code), '');

  // Tài liệu có sẵn
  const rsec = page.locator('section[aria-label="Tài liệu tham chiếu"]');
  await rsec.waitFor({ timeout: 10000 });
  await rsec.getByRole('button', { name: 'Chọn từ tài liệu có sẵn' }).click();
  const dlg = page.locator('[role="dialog"]:visible').last();
  await page.waitForTimeout(2000);
  const cand = dlg.locator('[aria-label="Tài liệu ứng viên"]');
  check('TC-QF-12 (trình duyệt) hộp thoại liệt kê tài liệu của dự án để chọn', (await cand.innerText()).includes('Tài liệu UI'), '');
  await shot(page, 'j-picker');
  await cand.getByRole('button', { name: 'Đính kèm' }).first().click();
  await page.waitForTimeout(2000);
  check('TC-QF-12 (trình duyệt) đính kèm: dòng chuyển "Đã đính kèm"', (await cand.innerText()).includes('Đã đính kèm'), '');
  await dlg.getByRole('button', { name: /^(Xong|Đóng)$/ }).first().click();
  await page.waitForTimeout(1000);
  check('TC-QF-12 (trình duyệt) khối tài liệu có sẵn hiện tài liệu vừa chọn, có nút Tải xuống', /Tài liệu UI/.test(await rsec.innerText()) && (await rsec.getByRole('button', { name: 'Tải xuống' }).count()) > 0, '');
  await shot(page, 'j-quote-docs');
  await context.close();
  }
  {
  const { context, page } = await login('nv3');
  await goto(page, '#opportunities');
  const r = await api(page, 'GET', `/opportunities/${prepared.opp.id}/promotions`);
  check('TC-QF-17 (trình duyệt) NV3 ngoài phạm vi không đọc được khuyến mãi dự án của NV1', !Array.isArray(r), JSON.stringify(r).slice(0, 80));
  await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
