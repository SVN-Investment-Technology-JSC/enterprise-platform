// Kiểm GĐ F phase 2 (gợi ý chăm sóc lại khi Thua, chân dung khách, đối thủ, ghi chú đơn) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2f-browser.mjs [--shots=<thư mục>]
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
const stamp = Date.now() % 1_000_000;
const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('ep_csrf='))?.split('=')[1];
  const r = await fetch(`/api/crm/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}, { method, path, body });
const openOpp = async (page, name) => {
  await goto(page, '#opportunities');
  await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
  await page.waitForTimeout(1000);
  await page.locator('input[placeholder*="Tìm"]').first().fill(name);
  await page.waitForTimeout(1800);
  await page.locator('tbody tr.ant-table-row', { hasText: name }).first().first().click();
  await page.waitForTimeout(2500);
};
const loseViaDetail = async (page, name, stageLabel) => {
  await openOpp(page, name);
  const picker = page.getByPlaceholder(/Chọn giai đoạn tiếp/).first();
  if (!(await picker.count())) await shot(page, 'f-no-picker');
  await picker.click({ timeout: 8000 });
  await page.getByText(stageLabel, { exact: true }).last().click();
  await page.getByRole('button', { name: /^Chuyển giai đoạn$/ }).first().click();
  await page.waitForTimeout(1200);
  const reason = page.locator('textarea').last();
  await reason.fill('Khách chọn nhà cung cấp khác');
  await page.locator('[role="dialog"]:visible').last().getByRole('button', { name: /Lưu|Xác nhận|Chuyển/ }).last().click();
  await page.waitForTimeout(2500);
};

try {
  const { context, page } = await login('nv1');
  await goto(page, '#opportunities');
  const cust = await api(page, 'GET', '/customers?q=QA-CRM-KH01');
  const kh = (cust.items ?? cust).find((c) => c.code === 'QA-CRM-KH01');
  const pipes = await api(page, 'GET', '/opportunities/pipelines');
  const tender = pipes.find((p) => p.profile === 'TENDER');
  const a = await api(page, 'POST', '/opportunities', { customerId: kh.id, name: `P2F-UI-${stamp} bỏ qua`, expectedValue: 1000000 });
  const b = await api(page, 'POST', '/opportunities', { customerId: kh.id, name: `P2F-UI-${stamp} tạo lịch`, expectedValue: 1000000 });
  const c = await api(page, 'POST', '/opportunities', { customerId: kh.id, pipelineId: tender.id, name: `P2F-UI-${stamp} thầu`, expectedValue: 1000000 });

  // TC-CARE-01 + 02: Thua → gợi ý → Bỏ qua → không tạo hoạt động
  await loseViaDetail(page, `P2F-UI-${stamp} bỏ qua`, 'Thua');
  let t = await page.locator('body').innerText();
  check('TC-CARE-01 (trình duyệt) sau khi lưu Thua hiện hộp thoại gợi ý "chăm sóc lại"', /chăm sóc lại/i.test(t), '');
  await shot(page, 'f-care-dialog');
  await page.getByRole('button', { name: /Bỏ qua/ }).last().click();
  await page.waitForTimeout(1500);
  let acts = await api(page, 'GET', `/activities?opportunityId=${a.id}`);
  check('TC-CARE-02 (trình duyệt) Bỏ qua: không tạo hoạt động nào', (acts.items ?? acts).length === 0, `${(acts.items ?? acts).length} hoạt động`);

  // TC-CARE-03: chấp nhận
  await loseViaDetail(page, `P2F-UI-${stamp} tạo lịch`, 'Thua');
  t = await page.locator('body').innerText();
  const shown = /chăm sóc lại/i.test(t);
  await page.getByRole('button', { name: /Tạo lịch/ }).last().click().catch(() => undefined);
  await page.waitForTimeout(2500);
  acts = await api(page, 'GET', `/activities?opportunityId=${b.id}`);
  check('TC-CARE-03 (trình duyệt) Tạo lịch: có hoạt động gắn đúng dự án, có hạn', shown && (acts.items ?? acts).length === 1 && !!(acts.items ?? acts)[0].dueAt, `hiện=${shown}, ${(acts.items ?? acts).length} hoạt động`);
  await shot(page, 'f-care-created');

  // TC-CARE-04: luồng thầu Trượt không gợi ý
  await loseViaDetail(page, `P2F-UI-${stamp} thầu`, 'Trượt');
  t = await page.locator('body').innerText();
  check('TC-CARE-04 (trình duyệt) Trượt ở luồng thầu: không hiện gợi ý chăm sóc', !/Tạo lịch chăm sóc lại/i.test(t), '');
  check('TC-TND-09 (trình duyệt, kiểm lại sau GĐ F) Trượt thầu không có gợi ý', !/Tạo lịch chăm sóc lại/i.test(t), '');
  await shot(page, 'f-care-tender');

  // TC-CARE-07: đối thủ
  await openOpp(page, 'đối thủ');  // dự án tạo bởi e2e-phase2f.mjs có đối thủ; chạy script API trước
  await page.waitForTimeout(500);
  t = await page.locator('body').innerText();
  check('TC-CARE-07 (trình duyệt) có khối "Đối thủ" ở chi tiết dự án', /Đối thủ/.test(t), '');
  await shot(page, 'f-competitor');

  // TC-CARE-06: chân dung khách
  await goto(page, '#customers');
  await page.locator('tr', { hasText: 'QA-CRM-KH01' }).first().click();
  await page.waitForTimeout(2500);
  t = await page.locator('body').innerText();
  check('TC-CARE-06 (trình duyệt) hồ sơ khách có khối "Chân dung khách hàng" và nội dung đã lưu', /Chân dung khách hàng/.test(t) && /giao hàng buổi sáng/.test(t), '');
  await shot(page, 'f-portrait');

  // TC-CARE-08: ghi chú đơn
  await goto(page, '#orders');
  await page.locator('tbody tr.ant-table-row').first().first().click();
  await page.waitForTimeout(2500);
  t = await page.locator('body').innerText();
  check('TC-CARE-08 (trình duyệt) đơn bán có khối "Ghi chú thông tin đơn hàng"', /Ghi chú thông tin đơn hàng/.test(t), '');
  await shot(page, 'f-order-note');
  await context.close();
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
