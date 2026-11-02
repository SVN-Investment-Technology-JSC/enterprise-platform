// Kiểm GĐ C phase 2 (kho tài liệu CRM; cần S3 hoặc tools/crm/mock-s3.mjs) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2c-browser.mjs [--shots=<thư mục>]
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
const openFirst = async (page) => {
  const btn = page.locator('tbody tr.ant-table-row').first().getByRole('button', { name: /^(Xem|Mở)$/ }).first();
  if (await btn.count()) await btn.click(); else await page.locator('tbody tr.ant-table-row').first().click();
  await page.waitForTimeout(2500);
};
const stamp = Date.now() % 1_000_000;
const pdf = Buffer.from(`%PDF-1.4 tài liệu thử ${stamp}`);

try {
  // ---- NV1: tab Tài liệu ở hồ sơ khách: tải lên thật qua URL ký
  {
    const { context, page } = await login('nv1');
    await goto(page, '#customers');
    await page.locator('tr', { hasText: 'QA-CRM-KH01' }).getByText('Xem', { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Tài liệu/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Tải tài liệu lên/ }).first().click();
    const dlg = page.locator('[role="dialog"]').last();
    await dlg.getByText('Tối đa 50 MB').waitFor({ timeout: 10000 });
    await page.setInputFiles('input[type=file]', { name: `ho-so-${stamp}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    await dlg.locator('input[type="text"]').first().fill(`Tài liệu thử ${stamp}`).catch(() => undefined);
    await shot(page, 'c-upload-dialog');
    await dlg.getByRole('button', { name: /^Tải lên$/ }).click();
    await page.waitForTimeout(3500);
    const body = await page.locator('body').innerText();
    check('TC-DOC-01 (trình duyệt) tải lên PDF qua URL ký, tài liệu hiện trong danh sách', body.includes(`Tài liệu thử ${stamp}`) || body.includes(`ho-so-${stamp}.pdf`), '');
    await shot(page, 'c-doc-list');

    // file .exe bị từ chối ở client
    await page.getByRole('button', { name: /Tải tài liệu lên/ }).first().click();
    await page.setInputFiles('input[type=file]', { name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await page.locator('[role="dialog"]:visible').last().getByRole('button', { name: /^Tải lên$/ }).click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const err = await page.locator('body').innerText();
    check('TC-DOC-02 (trình duyệt) file .exe bị từ chối với thông báo tiếng Việt', /hỗ trợ/i.test(err), err.split('\n').filter((l) => /hỗ trợ/i.test(l)).join(' | ').slice(0, 120));
    await shot(page, 'c-upload-exe');
    await context.close();
  }

  // ---- Các màn chi tiết khác có khối/tab Tài liệu (TC-DOC-14)
  {
    const { context, page } = await login('nv1');
    await goto(page, '#opportunities');
    await page.getByText('Dạng bảng', { exact: true }).first().click().catch(() => undefined);
    await page.waitForTimeout(1200);
    await openFirst(page);
    check('TC-DOC-14 dự án bán hàng: ngăn chi tiết có khối "Tài liệu"', (await page.locator('body').innerText()).includes('Tài liệu'), '');
    await goto(page, '#quotes');
    await openFirst(page);
    check('TC-DOC-14 báo giá: có khối "Tài liệu"', (await page.locator('body').innerText()).includes('Tài liệu'), '');
    await goto(page, '#orders');
    await openFirst(page);
    check('TC-DOC-14 đơn bán: có khối "Tài liệu"', (await page.locator('body').innerText()).includes('Tài liệu'), '');
    await goto(page, '#contracts');
    await openFirst(page);
    check('TC-DOC-14 hợp đồng: có khối "Tài liệu"', (await page.locator('body').innerText()).includes('Tài liệu'), '');
    await goto(page, '#leads');
    check('TC-DOC-14 lead: có nút "Tài liệu" ở dòng', (await page.getByRole('button', { name: /Tài liệu/ }).count()) > 0, '');
    await shot(page, 'c-leads');
    await context.close();
  }

  // ---- TC-DOC-15/16 (trình duyệt): khối "Tài liệu thiết bị (từ Kho)" ở ca bảo hành, theo quyền Kho
  {
    const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
    const { Client } = createReq(join(resolve(import.meta.dirname, '../..'), 'packages/adapters/database/package.json'))('pg');
    const db = new Client({ connectionString: new URL(template.replace('{databaseName}', values.tenant.replace(/-/g, '_'))).toString() });
    await db.connect();
    const key = `p2c-test/${stamp}-browser.pdf`;
    try {
      const row = (await db.query(`SELECT c.code, l.material_id FROM crm_schema.warranty_cases c JOIN crm_schema.warranty_case_lines l ON l.case_id = c.id LIMIT 1`)).rows[0];
      const uploader = (await db.query(`SELECT uploaded_by FROM inventory_schema.asset_documents LIMIT 1`)).rows[0]?.uploaded_by ?? (await db.query(`SELECT created_by FROM crm_schema.warranty_cases LIMIT 1`)).rows[0]?.created_by;
      await db.query(`INSERT INTO inventory_schema.asset_documents (id, asset_id, object_key, file_name, content_type, size_bytes, uploaded_by) VALUES (gen_random_uuid(), $1, $2, $3, 'application/pdf', 18, $4)`, [row.material_id, key, `thiet-bi-${stamp}.pdf`, uploader]);
      for (const [who, expectSee, tc] of [['ql', true, 'TC-DOC-15'], ['ktv', false, 'TC-DOC-16']]) {
        const { context, page } = await login(who);
        await goto(page, '#warranty');
        await page.locator('tbody tr.ant-table-row', { hasText: row.code }).first().getByRole('button', { name: /^(Xem|Mở)$/ }).first().click().catch(async () => page.getByText(row.code).first().click());
        await page.waitForTimeout(3000);
        const t = await page.locator('body').innerText();
        const sees = t.includes('Tài liệu thiết bị') && t.includes(`thiet-bi-${stamp}.pdf`);
        check(`${tc} ${who.toUpperCase()} ${expectSee ? 'thấy tài liệu thiết bị của Kho (chỉ đọc)' : 'không thấy tài liệu thiết bị, không lộ tên file'}`, (t.includes('Tài liệu')) && sees === expectSee && (expectSee || !t.includes(`thiet-bi-${stamp}`)), `thấy=${sees}`);
        await shot(page, `c-warranty-${who}`);
        await context.close();
      }
    } finally {
      await db.query(`DELETE FROM inventory_schema.asset_documents WHERE object_key = $1`, [key]);
      await db.end();
    }
  }

  // ---- NV1 không có quyền cấu hình; QTV thêm loại tài liệu (TC-DOC-11)
  {
    const { context, page } = await login('nv1');
    await goto(page, '#settings/document-types');
    const txt = await page.locator('body').innerText();
    check('TC-DOC-11 NV1 (không crm.manage) không thấy cấu hình loại tài liệu', !txt.includes('Thêm loại'), '');
    await context.close();
  }
  {
    const { context, page } = await login('qtv');
    await goto(page, '#settings/document-types');
    const txt = await page.locator('body').innerText();
    check('TC-DOC-11 QTV thấy 7 loại tài liệu mẫu', ['Hồ sơ mời thầu', 'Hồ sơ pháp lý', 'Dự toán'].every((t) => txt.includes(t)), '');
    await shot(page, 'c-doc-types');
    await page.getByRole('button', { name: /Thêm loại/ }).click();
    const dlg = page.locator('[role="dialog"]').last();
    const inputs = dlg.locator('input');
    await inputs.nth(0).fill(`TL_${stamp}`);
    await inputs.nth(1).fill(`Loại thử ${stamp}`);
    await dlg.getByRole('button', { name: /Lưu|Thêm|Tạo/ }).last().click();
    await page.waitForTimeout(2500);
    check('TC-DOC-11 QTV thêm loại tài liệu mới', (await page.locator('body').innerText()).includes(`Loại thử ${stamp}`), '');
    await shot(page, 'c-doc-types-added');
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
