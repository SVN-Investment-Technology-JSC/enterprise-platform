#!/usr/bin/env node
/**
 * E2E tổ chức báo giá (phase 3 C6, test_phase3 mục 2.6, TC-ORG-*): API qua gateway và trình duyệt (Playwright, Chrome hệ
 * thống). Cần seed `--step=phase3` (tổ chức ORG-A mặc định có logo, ORG-B không logo).
 *
 * Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase3-org.mjs [--tenant=svn] [--base=http://localhost:8080]
 *
 * Mỗi lượt để lại vài báo giá `QA-P3O …` (Nháp hoặc đã gửi) của NV1 và trả logo ORG-A về như cũ.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessions, materialsByCode, requireCustomers } from './seed-svn/common.mjs';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { P3_ORGS, makePng, phase3Organizations, pngDataUrl, sendQuote } from './seed-svn/phase3.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: { tenant: { type: 'string', default: 'svn' }, base: { type: 'string', default: 'http://localhost:8080' } },
});
loadEnv?.();
const config = buildConfig(values.tenant);
const password = config.password;
const crm = config.crmApi;

function loadPlaywright() {
  const root = resolve(import.meta.dirname, '../../node_modules/.pnpm');
  const dir = readdirSync(root).find((d) => d.startsWith('playwright-core@'));
  return require(resolve(root, dir, 'node_modules/playwright-core'));
}

// --- Ghi kết quả theo TC ---
const results = new Map();
const tcOf = (tc) => {
  if (!results.has(tc)) results.set(tc, { pass: 0, fail: 0 });
  return results.get(tc);
};
const check = (tc, ok, label, detail) => {
  tcOf(tc)[ok ? 'pass' : 'fail'] += 1;
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${label}${detail === undefined ? '' : `  [${String(detail).slice(0, 200)}]`}`);
};
const group = async (tc, fn) => {
  try {
    await fn();
  } catch (error) {
    check(tc, false, 'lỗi bất ngờ khi chạy', (error instanceof Error ? error.message : String(error)).split('\n')[0]);
  }
};
/** Gọi API, trả `{ status, data }` kể cả khi lỗi. */
const call = async (session, method, url, body) => {
  try {
    const data = await session.call(method, url, { body, expect: [400, 403, 404, 409, 413] });
    return data;
  } catch (error) {
    return { status: error.status ?? 0, data: error.body ?? null };
  }
};

const sessions = createSessions(config);
const [nv1, qtbh] = await Promise.all(['NV1', 'QTBH'].map((code) => sessions.as(code)));
const orgs = await phase3Organizations(config, qtbh);
for (const key of Object.keys(P3_ORGS)) if (!orgs[key]) throw new Error(`Chưa có tổ chức ${key}. Chạy seed --step=phase3 trước.`);
const A = orgs['ORG-A'];
const B = orgs['ORG-B'];
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;
const orgUrl = (id = '') => `${crm}/v1/sales-organizations${id ? `/${id}` : ''}`;

// =====================================================================================================================
// API
// =====================================================================================================================
let sentQuote;
await group('TC-ORG-07', async () => {
  const tc = 'TC-ORG-07';
  const temp = { ...P3_ORGS['ORG-B'], code: undefined, name: `QA-P3O tạm ${stamp}`, isDefault: false };
  const created = await call(nv1, 'POST', orgUrl(), temp);
  check(tc, created.status === 403, 'NV1 tạo tổ chức: 403', created.status);
  const patched = await call(nv1, 'PATCH', orgUrl(B.id), { phone: '000' });
  check(tc, patched.status === 403, 'NV1 sửa tổ chức: 403', patched.status);
  const removed = await call(nv1, 'DELETE', orgUrl(B.id));
  check(tc, removed.status === 403, 'NV1 xoá tổ chức: 403', removed.status);
  const ktv = await sessions.as('KTV');
  const read = await call(ktv, 'GET', orgUrl());
  check(tc, read.status === 200 && Array.isArray(read.data) && read.data.every((item) => !('logo' in item)), 'KTV (crm.read) đọc được danh sách, không có logo', read.status);
  const tk = await sessions.as('TK');
  const denied = await call(tk, 'GET', orgUrl());
  check(tc, denied.status === 403, 'TK (không có quyền Bán hàng) đọc danh sách: 403', denied.status);
});

await group('TC-ORG-04', async () => {
  const tc = 'TC-ORG-04';
  const bad = await call(qtbh, 'POST', orgUrl(), { name: `QA-P3O thiếu MST ${stamp}`, address: 'x', phone: '1', email: 'a@b.vn' });
  const fields = (bad.data?.fieldErrors ?? []).map((item) => item.field);
  check(tc, bad.status === 400 && bad.data?.code === 'SALES_ORGANIZATION_INVALID' && fields.includes('taxCode'), 'Thiếu MST qua HTTP: 400 có fieldErrors[taxCode]', JSON.stringify(bad.data).slice(0, 160));
  const dup = await call(qtbh, 'POST', orgUrl(), { ...P3_ORGS['ORG-B'], code: undefined, name: P3_ORGS['ORG-A'].name.toUpperCase(), isDefault: false });
  check(tc, dup.status === 409 && dup.data?.code === 'SALES_ORGANIZATION_NAME_EXISTS', 'Trùng tên khác hoa thường: 409', `${dup.status} ${dup.data?.message}`);
  const inUse = await call(qtbh, 'DELETE', orgUrl(A.id));
  check(tc, inUse.status === 409 && inUse.data?.message === 'Tổ chức đã có báo giá, chỉ tắt được.', 'Xoá tổ chức đã có báo giá: 409 câu tiếng Việt', `${inUse.status} ${inUse.data?.message}`);
});

await group('TC-ORG-08', async () => {
  const tc = 'TC-ORG-08';
  const plain = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} mặc định` });
  check(tc, plain.version.form.organizationId === A.id && plain.version.form.seller?.taxCode === P3_ORGS['ORG-A'].taxCode, 'Lập không gửi tổ chức: lấy ORG-A mặc định và chép thông tin', plain.version.form.organizationName);
  check(tc, (plain.version.sellerLogo ?? '').startsWith('data:image/png;base64,'), 'Báo giá Nháp có logo hiện tại của ORG-A');
  const withB = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} B`, organizationId: B.id });
  // ORG-B seed không logo, nhưng người kiểm tay có thể đã thêm: so theo trạng thái hiện tại.
  check(tc, withB.version.form.seller?.name === P3_ORGS['ORG-B'].name && Boolean(withB.version.sellerLogo) === B.hasLogo, `Lập với ORG-B: thông tin B, logo theo ORG-B (${B.hasLogo ? 'có' : 'không có'} logo)`);
  const none = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} không tổ chức`, organizationId: null });
  check(tc, none.version.form.organizationId === null && none.version.form.seller === null, 'Lập với organizationId null: không có tổ chức');
});

await group('TC-ORG-10', async () => {
  const tc = 'TC-ORG-10';
  const draft = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} gửi khách` });
  const materials = await materialsByCode(config, await sessions.as('QTV'));
  await nv1.post(`${crm}/v1/quotes/${draft.id}/versions/1/lines/batch`, {
    revision: draft.version.revision,
    lines: [{ materialId: materials.get('QA-KHO-BT')?.id, quantity: 1 }],
  });
  sentQuote = await sendQuote(config, sessions, draft.id);
  const sentLogo = (await nv1.get(`${crm}/v1/quotes/${draft.id}`)).version.sellerLogo;
  check(tc, sentQuote.version.status === 'SENT' && !!sentLogo, 'Gửi khách: có logo chụp lúc gửi', sentQuote.version.status);
  const original = await qtbh.get(orgUrl(A.id));
  try {
    await qtbh.patch(orgUrl(A.id), { logo: pngDataUrl(makePng(64, 99)) });
    const after = (await nv1.get(`${crm}/v1/quotes/${draft.id}`)).version.sellerLogo;
    check(tc, after === sentLogo, 'Đổi logo ORG-A sau khi gửi: báo giá đã gửi giữ logo cũ');
    await qtbh.patch(orgUrl(A.id), { logo: null });
    const removed = (await nv1.get(`${crm}/v1/quotes/${draft.id}`)).version.sellerLogo;
    check(tc, removed === sentLogo, 'Bỏ logo ORG-A sau khi gửi: báo giá đã gửi vẫn giữ logo');
  } finally {
    await qtbh.patch(orgUrl(A.id), { logo: original.logo });
  }
});

// =====================================================================================================================
// Trình duyệt
// =====================================================================================================================
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const workDir = mkdtempSync(join(tmpdir(), 'crm-p3-org-'));
const PRINT_HOOK = () => {
  window.__p3print = [];
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.tagName !== 'IFRAME') continue;
        try {
          const w = node.contentWindow;
          if (!w || w.__hooked) continue;
          w.__hooked = true;
          w.print = () => window.__p3print.push({ text: w.document.body?.innerText ?? '', images: w.document.images.length });
        } catch {
          /* iframe khác nguồn */
        }
      }
  }).observe(document, { childList: true, subtree: true });
};
async function login(code) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await context.addInitScript(PRINT_HOOK);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto(`${values.base}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(`${code}@${values.tenant}.local`);
  await page.locator('input[type="password"]').first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return { context, page };
}
const goto = async (page, hash) => {
  await page.goto(`${values.base}/modules/crm${hash}`);
  await page.reload();
  await page.waitForTimeout(3000);
};
const fieldInput = (scope, label) =>
  scope.locator('label', { has: scope.page().locator('span', { hasText: new RegExp(`^${label}`) }) }).locator('input').first();
async function chooseOption(page, input, optionText) {
  await input.click();
  const option = page.locator('[role="listbox"] [role="option"]', { hasText: optionText }).first();
  await option.waitFor({ timeout: 8000 });
  await option.click();
  await page.waitForTimeout(400);
}
const preview = (page) => page.locator('section[aria-label="Xem trước báo giá"]');
const sellerSection = (page) => page.locator('section[aria-label="Tổ chức báo giá"]');

await group('TC-ORG-13', async () => {
  const tc = 'TC-ORG-13';
  const { context, page } = await login('qtbh');
  try {
    await goto(page, '#settings/sales-organizations');
    const text = await page.locator('main').innerText();
    check(tc, text.includes(P3_ORGS['ORG-A'].name) && text.includes('Mặc định'), 'Bảng có ORG-A kèm nhãn Mặc định');
    await page.getByRole('button', { name: 'Thêm tổ chức' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 5000 });
    await fieldInput(dialog, 'Tên công ty').fill(`QA-P3O thiếu MST ${stamp}`);
    await fieldInput(dialog, 'Địa chỉ').fill('Hà Nội');
    await fieldInput(dialog, 'Điện thoại').fill('024');
    await fieldInput(dialog, 'Email').fill('a@b.vn');
    let posted = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/sales-organizations')) posted += 1;
    });
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await page.waitForTimeout(800);
    const dialogText = await dialog.innerText();
    check(tc, /mã số thuế/i.test(dialogText) && posted === 0, 'Thiếu MST: báo lỗi tại ô, không gọi API', dialogText.match(/Vui lòng[^\n]*/)?.[0]);
    await dialog.getByRole('button', { name: 'Huỷ' }).click();
  } finally {
    await context.close();
  }
});

let createdId;
await group('TC-ORG-15', async () => {
  const tc = 'TC-ORG-15';
  const { context, page } = await login('nv1');
  try {
    await goto(page, '#quotes/new');
    await sellerSection(page).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const selectInput = sellerSection(page).locator('input').first();
    check(tc, (await selectInput.inputValue()).includes('Thiết bị Miền Bắc'), 'Lập mới: chọn sẵn ORG-A mặc định', await selectInput.inputValue());
    const sectionText = async () => sellerSection(page).innerText();
    check(tc, (await sectionText()).includes(P3_ORGS['ORG-A'].taxCode) && (await sellerSection(page).locator('input').count()) === 1, 'Chọn tổ chức: thông tin ORG-A chỉ xem, không có ô nhập (chỉ ô chọn)');
    const sectionBox = await sellerSection(page).boundingBox();
    const generalBox = await page.locator('section[aria-label="Thông tin báo giá"]').boundingBox();
    check(tc, !!sectionBox && !!generalBox && sectionBox.y < generalBox.y, 'Mục Tổ chức báo giá nằm trên Thông tin chung');
    await chooseOption(page, selectInput, 'Giải pháp Miền Nam');
    await page.waitForTimeout(800);
    check(tc, (await sectionText()).includes(P3_ORGS['ORG-B'].taxCode), 'Đổi sang ORG-B: thông tin ORG-B');
    await chooseOption(page, selectInput, 'Nhập thủ công');
    await page.waitForTimeout(500);
    check(tc, (await fieldInput(sellerSection(page), 'Mã số thuế').inputValue()) === P3_ORGS['ORG-B'].taxCode, 'Nhập thủ công: hiện ô, điền sẵn thông tin ORG-B để sửa');
    await fieldInput(sellerSection(page), 'Điện thoại').fill('028 0000 9999');
    await page.waitForTimeout(800);
    const shown = await preview(page).innerText();
    check(tc, shown.includes(P3_ORGS['ORG-B'].name) && shown.includes('028 0000 9999'), 'Xem trước theo thông tin nhập thủ công');
    await chooseOption(page, fieldInput(page.locator('main'), 'Báo giá đến'), 'Khách hàng 01');
    await fieldInput(page.locator('main'), 'Tên báo giá').fill(`QA-P3O ${stamp} lập trên giao diện`);
    await page.locator('[role="toolbar"][aria-label="Thao tác báo giá"]').getByRole('button', { name: 'Lưu' }).click();
    await page.waitForURL((u) => /#quotes\/[0-9a-f-]{36}/.test(u.hash), { timeout: 20000 });
    createdId = new URL(page.url()).hash.split('/')[1];
    const saved = await nv1.get(`${crm}/v1/quotes/${createdId}`);
    check(tc, saved.version.form.organizationId === null && saved.version.form.seller?.phone === '028 0000 9999' && saved.version.form.seller?.name === P3_ORGS['ORG-B'].name, 'Lưu: không gắn tổ chức, giữ thông tin nhập thủ công', saved.version.form.seller?.phone);
    await goto(page, `#quotes/${createdId}`);
    await sellerSection(page).waitFor({ timeout: 15000 });
    check(tc, (await sellerSection(page).locator('input').first().inputValue()) === 'Nhập thủ công', 'Mở lại: vẫn ở chế độ Nhập thủ công');
  } finally {
    await context.close();
  }
});

await group('TC-ORG-16', async () => {
  const tc = 'TC-ORG-16';
  const { context, page } = await login('nv1');
  try {
    const plain = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} đầu trang` });
    await goto(page, `#quotes/${plain.id}`);
    await preview(page).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const text = await preview(page).innerText();
    const a = P3_ORGS['ORG-A'];
    check(tc, [a.name, a.address, a.taxCode, a.phone, a.email].every((part) => text.includes(part)) && !text.includes('TÊN CÔNG TY'), 'Đầu trang mặc định có tên, địa chỉ, MST, điện thoại, email của ORG-A; không còn "TÊN CÔNG TY"');
    const logos = await preview(page).locator('[data-block-type="companyHeader"] img').count();
    check(tc, logos === 1, 'Đầu trang có logo ORG-A', logos);
    await chooseOption(page, sellerSection(page).locator('input').first(), 'Giải pháp Miền Nam');
    await page.waitForTimeout(800);
    const textB = await preview(page).innerText();
    const logosB = await preview(page).locator('[data-block-type="companyHeader"] img').count();
    check(tc, textB.includes(P3_ORGS['ORG-B'].name) && !textB.includes(a.taxCode) && logosB === (B.hasLogo ? 1 : 0), `Đổi sang ORG-B (chưa lưu): đầu trang theo ORG-B, logo theo ORG-B (${B.hasLogo ? 'có' : 'không'})`, logosB);
  } finally {
    await context.close();
  }
});

await group('TC-ORG-17', async () => {
  const tc = 'TC-ORG-17';
  const { context, page } = await login('nv1');
  try {
    const plain = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3O ${stamp} xuất file` });
    await goto(page, `#quotes/${plain.id}`);
    await preview(page).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await preview(page).getByRole('button', { name: /Xuất/ }).first().click();
    await page.getByRole('menuitem', { name: 'PDF / In' }).click();
    await page.waitForFunction(() => window.__p3print.length > 0, null, { timeout: 20000 });
    const printed = await page.evaluate(() => window.__p3print.at(-1));
    check(tc, printed.text.includes(P3_ORGS['ORG-A'].name) && printed.text.includes(P3_ORGS['ORG-A'].taxCode) && printed.images >= 1, 'PDF: bản in có thông tin và logo ORG-A', printed.images);
    await preview(page).getByRole('button', { name: /Xuất/ }).first().click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: 'Word (.docx)' }).click()]);
    const file = join(workDir, download.suggestedFilename());
    await download.saveAs(file);
    const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const media = execFileSync('unzip', ['-l', file], { encoding: 'utf8' }).split('\n').filter((line) => line.includes('word/media/')).length;
    check(tc, xml.includes(P3_ORGS['ORG-A'].taxCode) && xml.includes('Thiết bị Miền Bắc') && media >= 1, 'Word: document.xml có thông tin ORG-A, word/media có logo', `media=${media}`);
  } finally {
    await context.close();
  }
});

await group('TC-ORG-19', async () => {
  const tc = 'TC-ORG-19';
  if (!sentQuote) return check(tc, false, 'Không có báo giá đã gửi (TC-ORG-10 lỗi)');
  const { context, page } = await login('nv1');
  try {
    await goto(page, `#quotes/${sentQuote.id}`);
    await sellerSection(page).waitFor({ timeout: 15000 });
    const inputs = await sellerSection(page).locator('input').count();
    const recopy = await sellerSection(page).getByRole('button', { name: /Lấy lại từ tổ chức/ }).count();
    check(tc, inputs === 0 && recopy === 0, 'Báo giá đã gửi: mục Tổ chức báo giá chỉ xem', `inputs=${inputs}`);
    const text = await sellerSection(page).innerText();
    check(tc, text.includes(P3_ORGS['ORG-A'].name), 'Mục chỉ xem hiện tên ORG-A');
  } finally {
    await context.close();
  }
});

await browser.close();

// --- Tổng kết ---
console.log('\nKết quả theo TC:');
let passed = 0;
for (const [tc, entry] of [...results.entries()].sort()) {
  const ok = entry.fail === 0 && entry.pass > 0;
  if (ok) passed += 1;
  console.log(`  ${tc.padEnd(14)} ${ok ? 'ĐẠT' : 'LỖI'}           ${entry.pass} đạt, ${entry.fail} lỗi`);
}
console.log(`\nTổng: ${passed}/${results.size} TC đạt.`);
process.exitCode = passed === results.size ? 0 : 1;
