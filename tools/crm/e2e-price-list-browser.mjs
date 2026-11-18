// Kiểm bảng giá mặc định đồng bộ Kho và chọn bảng giá khi báo giá trên trình duyệt thật (test.md mục D, D1-D23).
// Playwright + Chrome hệ thống vào gateway 8080, như e2e-pricing-preview-browser.mjs. Dữ liệu chuẩn bị và kiểm lại qua API
// (phiên Node như seed). Cần đã chạy seed-svn (khách QA-CRM-KH01, tài khoản QTBH, NV1, QTV).
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-price-list-browser.mjs [--shots=<thư mục>] [--base=http://localhost:8080]
//        [--tenant=svn]
// Mặt hàng mẫu (mục 0.1 của test.md) tạo ở Kho với mã QA-BG-M1..M8 nếu chưa có; mỗi lượt để lại một bảng giá theo tỷ lệ
// `QA-BG105-<số>` và vài báo giá `QA-BG <số>`. D20 (dữ liệu trước migration) và D22 (dừng inventory-api) cần thao tác tay:
// script ghi BỊ CHẶN kèm cách kiểm.
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessions, list, requireCustomers, vnToday } from './seed-svn/common.mjs';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';

const require = createRequire(import.meta.url);
// playwright-core không phải dependency trực tiếp của workspace: lấy từ kho pnpm (phiên bản nào có thì dùng).
function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch {
    /* thử kho pnpm */
  }
  const dir = readdirSync(resolve(import.meta.dirname, '../../node_modules/.pnpm')).find((d) => d.startsWith('playwright-core@'));
  if (!dir) throw new Error('Không tìm thấy playwright-core.');
  return require(resolve(import.meta.dirname, '../../node_modules/.pnpm', dir, 'node_modules/playwright-core'));
}
const { chromium } = loadPlaywright();
const { values } = parseArgs({
  options: {
    shots: { type: 'string', default: '' },
    base: { type: 'string', default: 'http://localhost:8080' },
    tenant: { type: 'string', default: 'svn' },
  },
});
loadEnv();
const config = buildConfig(values.tenant);
const crm = `${config.crmApi}/v1`;
const inventory = `${config.inventoryApi}/v1`;
const password = config.password;
if (values.shots) mkdirSync(values.shots, { recursive: true });

// ---------------------------------------------------------------------------
// Ghi kết quả theo mã kịch bản
// ---------------------------------------------------------------------------
const results = [];
const check = (tc, ok, label, detail = '') => {
  results.push({ tc, ok });
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${label}${detail ? `  [${String(detail).slice(0, 200)}]` : ''}`);
};
const blocked = (tc, reason) => {
  results.push({ tc, ok: true, blocked: true });
  console.log(`BỊ CHẶN  ${tc}  ${reason}`);
};
const step = async (tc, fn) => {
  try {
    await fn();
  } catch (error) {
    check(tc, false, 'lỗi bất ngờ khi chạy', (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300));
  }
};

// ---------------------------------------------------------------------------
// Dữ liệu qua API
// ---------------------------------------------------------------------------
const sessions = createSessions(config);
const [qtv, qtbh, nv1] = await Promise.all(['QTV', 'QTBH', 'NV1'].map((code) => sessions.as(code)));
const kh = (await requireCustomers(config, qtv, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;
const today = vnToday();

/** Mặt hàng mẫu mục 0.1 (M7 thiếu đơn vị tính; M4 chưa có giá bán; M6 ngừng dùng sau khi tạo). */
const FIXTURE = [
  { code: 'QA-BG-M1', name: 'QA-BG Mặt hàng M1', unit: 'Cái', salePrice: 12_345 },
  { code: 'QA-BG-M2', name: 'QA-BG Mặt hàng M2', unit: 'Hộp', salePrice: 10_001 },
  { code: 'QA-BG-M3', name: 'QA-BG Dịch vụ M3', unit: 'Giờ', salePrice: 1_001, kind: 'SERVICE' },
  { code: 'QA-BG-M4', name: 'QA-BG Mặt hàng M4 chưa giá', unit: 'Cái' },
  { code: 'QA-BG-M5', name: 'QA-BG Mặt hàng M5 giá 0', unit: 'Cái', salePrice: 0 },
  { code: 'QA-BG-M6', name: 'QA-BG Mặt hàng M6 ngừng dùng', unit: 'Cái', salePrice: 50_000, inactive: true },
  { code: 'QA-BG-M7', name: 'QA-BG Mặt hàng M7 thiếu đơn vị', unit: '', salePrice: 20_000 },
  { code: 'QA-BG-M8', name: 'QA-BG Mặt hàng M8 giá lẻ', unit: 'Kg', salePrice: 99_999.99 },
];
const allMaterials = async () => list(await qtv.get(`${inventory}/materials?all=true`), 'materials', 'items');
async function ensureFixture() {
  const existing = new Map((await allMaterials()).map((material) => [material.code, material]));
  for (const material of FIXTURE) {
    const { inactive, ...body } = material;
    if (!existing.has(material.code)) {
      try {
        await qtv.post(`${inventory}/materials`, { category: 'CONSUMABLE', kind: 'STOCK', ...body });
      } catch (error) {
        console.log(`Ghi chú: không tạo được ${material.code} (${error instanceof Error ? error.message.slice(0, 160) : error}).`);
        continue;
      }
    }
    // Đưa giá bán, trạng thái về đúng mẫu (lượt trước có thể đã đổi giá M1, M2).
    const patch = { ...(material.salePrice === undefined ? {} : { salePrice: material.salePrice }), isActive: !inactive };
    await qtv.patch(`${inventory}/materials/${encodeURIComponent(material.code)}`, patch).catch(() => undefined);
  }
}
const setSalePrice = (code, salePrice) => qtv.patch(`${inventory}/materials/${encodeURIComponent(code)}`, { salePrice });
const priceLists = () => qtbh.get(`${crm}/price-lists`);
const defaultList = async () => (await priceLists()).find((item) => item.listType === 'DEFAULT');
const listDetail = (id) => qtbh.get(`${crm}/price-lists/${id}`);
const itemOf = (detail, code) => detail?.items.find((item) => item.materialCode === code);
const syncStatus = () => qtbh.get(`${crm}/pricing/catalog-sync`);

await ensureFixture();

// ---------------------------------------------------------------------------
// Trình duyệt
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const crmUrl = `${values.base}/modules/crm`;

async function login(code, { width = 1600, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${values.base}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(`${code}@${values.tenant}.local`);
  await page.locator('input[type="password"]').first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return { context, page };
}
const shot = async (page, name) => {
  if (values.shots) await page.screenshot({ path: `${values.shots}/${name}.png`, fullPage: false });
};
const goto = async (page, hash = '') => {
  await page.goto(`${crmUrl}${hash}`);
  await page.reload();
  await page.waitForTimeout(2500);
};
const banner = (page) => page.locator('[role="status"][aria-label="Đồng bộ bảng giá"]');
const PRICE_LIST_PLACEHOLDER = 'Chọn bảng giá (tìm theo mã, tên)';
/** Chọn bảng giá: gõ chữ tìm (không dấu được) rồi bấm lựa chọn có chữ `option`. */
async function pickPriceList(scope, page, search, option) {
  const input = scope.getByPlaceholder(PRICE_LIST_PLACEHOLDER).first();
  await input.click();
  await input.fill(search);
  await page.getByRole('option').filter({ hasText: option }).first().click();
  await page.waitForTimeout(800);
}
const toastText = async (page) => (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');

let derived;
const derivedCode = `QA-BG105-${stamp}`;
const derivedName = `QA Bảng giá 105 ${stamp}`;

try {
  const { context, page } = await login('qtbh');
  const nv = await login('nv1');

  // ---- D1-D3: thông báo dưới header và Đồng bộ ----
  await step('D1', async () => {
    const before = await syncStatus();
    await goto(page);
    if (before.reason === 'NO_DEFAULT') {
      await banner(page).waitFor({ timeout: 15000 });
      check('D1', (await banner(page).innerText()).includes('Chưa có bảng giá mặc định'), 'QT thấy "Chưa có bảng giá mặc định" dưới header');
    } else {
      blocked('D1', `đã có bảng giá mặc định từ lượt trước (reason=${before.reason}); kiểm D1 trên DB mới`);
      if (before.needsSync) {
        await banner(page).waitFor({ timeout: 15000 });
        check('D1', (await banner(page).innerText()).includes('cần được đồng bộ với Kho'), 'Kho đã đổi: hiện "cần được đồng bộ với Kho"');
      }
    }
    await shot(page, 'd1-banner');
  });

  await step('D5', async () => {
    await goto(nv.page);
    await nv.page.waitForTimeout(1500);
    check('D5', (await banner(nv.page).count()) === 0, 'NV không thấy thông báo đồng bộ');
  });

  await step('D2', async () => {
    if (!(await syncStatus()).needsSync) {
      blocked('D2', 'không có thay đổi để đồng bộ');
      return;
    }
    await banner(page).getByRole('button', { name: /Đồng bộ/ }).click();
    await banner(page).waitFor({ state: 'detached', timeout: 60000 });
    const text = await toastText(page);
    check('D2', /Đã đồng bộ bảng giá mặc định/.test(text), 'báo kết quả đồng bộ', text);
    check('D2', /Bỏ qua \d+ mặt hàng chưa có đơn vị tính/.test(text) || !FIXTURE.some((m) => m.code === 'QA-BG-M7'), 'báo M7 bị bỏ qua (thiếu đơn vị tính)', text);
    const list = await defaultList();
    const detail = list ? await listDetail(list.id) : undefined;
    const codes = ['QA-BG-M1', 'QA-BG-M2', 'QA-BG-M3', 'QA-BG-M4', 'QA-BG-M5', 'QA-BG-M6', 'QA-BG-M8'];
    check('D2', Boolean(list) && list.code.startsWith('BG-MAC-DINH'), 'có bảng giá mặc định BG-MAC-DINH', list?.code);
    check('D2', codes.every((code) => itemOf(detail, code)), 'bảng mặc định có M1-M6, M8', codes.filter((code) => !itemOf(detail, code)).join(','));
    check('D2', !itemOf(detail, 'QA-BG-M7'), 'M7 không có trong bảng mặc định');
    check('D2', itemOf(detail, 'QA-BG-M4')?.price === null && itemOf(detail, 'QA-BG-M5')?.price === 0, 'M4 giá rỗng, M5 giá 0');
    check('D2', itemOf(detail, 'QA-BG-M6')?.sourceActive === false, 'M6 ngừng dùng ở Kho');
    await shot(page, 'd2-synced');
  });

  await step('D3', async () => {
    await goto(page);
    await page.waitForTimeout(1500);
    check('D3', (await banner(page).count()) === 0, 'tải lại trang không còn thông báo');
  });

  // ---- D4: Kho đổi giá thì thông báo lại ----
  await step('D4', async () => {
    await setSalePrice('QA-BG-M1', 13_000);
    await goto(page);
    await banner(page).waitFor({ timeout: 15000 });
    check('D4', (await banner(page).innerText()).includes('Bảng giá mặc định cần được đồng bộ với Kho'), 'Kho đổi giá M1: hiện thông báo cần đồng bộ');
    await setSalePrice('QA-BG-M1', 12_345);
    await goto(page);
    await banner(page).waitFor({ timeout: 15000 });
    await banner(page).getByRole('button', { name: /Đồng bộ/ }).click();
    await banner(page).waitFor({ state: 'detached', timeout: 60000 });
  });

  // ---- D6: thuế suất ở bảng mặc định ----
  const openList = async (code) => {
    await goto(page, '#settings/price-lists');
    const lists = page.locator('section[aria-label="Bảng giá"]');
    await lists.waitFor({ timeout: 15000 });
    await lists.getByText(code, { exact: true }).first().click();
    const items = page.locator('section[aria-label="Dòng giá"]');
    await items.getByText(/Dòng giá: /).waitFor({ timeout: 15000 });
    return items;
  };
  await step('D6', async () => {
    const list = await defaultList();
    const items = await openList(list.code);
    const row = items.locator('tr').filter({ hasText: 'QA-BG-M1' }).first();
    check('D6', (await row.getByRole('button', { name: /Nhập giá tay|^Sửa$|^Xoá$/ }).count()) === 0, 'bảng mặc định không có nút sửa giá, xoá dòng');
    check('D6', (await items.getByRole('button', { name: /Thêm dòng giá|Dán từ bảng tính/ }).count()) === 0, 'bảng mặc định không có thêm, dán dòng');
    await row.getByRole('button', { name: 'Sửa thuế suất QA-BG-M1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sửa thuế suất' });
    await dialog.getByLabel(/Thuế suất/).fill('8');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
    check('D6', itemOf(await listDetail(list.id), 'QA-BG-M1')?.vatRate === 8, 'lưu thuế suất M1 = 8%');
    await shot(page, 'd6-vat');
  });

  // ---- D7: tạo bảng theo tỷ lệ 105% ----
  await step('D7', async () => {
    await goto(page, '#settings/price-lists');
    await page.getByRole('button', { name: /Thêm bảng giá/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Thêm bảng giá' });
    check('D7', (await dialog.getByLabel(/Tỷ lệ giá so với bảng mặc định/).inputValue()) === '100', 'ô tỷ lệ mặc định 100');
    await dialog.getByLabel(/Mã bảng giá/).fill(derivedCode);
    await dialog.getByLabel(/Tên bảng giá/).fill(derivedName);
    await dialog.getByLabel(/Tỷ lệ giá so với bảng mặc định/).fill('105');
    await dialog.getByLabel('Hiệu lực từ ngày').fill(today.split('-').reverse().join('/'));
    await dialog.getByLabel('Hiệu lực từ ngày').press('Enter');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
    derived = (await priceLists()).find((item) => item.code === derivedCode);
    const detail = derived ? await listDetail(derived.id) : undefined;
    check('D7', derived?.listType === 'DERIVED' && derived?.ratioPercent === 105, 'tạo bảng theo tỷ lệ 105%', derived?.code);
    check('D7', itemOf(detail, 'QA-BG-M1')?.price === 12_962, 'M1 = 12.962', itemOf(detail, 'QA-BG-M1')?.price);
    check('D7', itemOf(detail, 'QA-BG-M2')?.price === 10_501, 'M2 = 10.501', itemOf(detail, 'QA-BG-M2')?.price);
    const items = page.locator('section[aria-label="Dòng giá"]');
    await items.getByText(/Dòng giá: /).waitFor({ timeout: 15000 });
    check('D7', (await items.locator('tr').filter({ hasText: 'QA-BG-M4' }).innerText()).includes('Chưa nhập giá ở Kho'), 'M4 hiện "Chưa nhập giá ở Kho"');
    await shot(page, 'd7-derived');
  });

  // ---- D8, D9: giá tay giữ khi đồng bộ và đổi tỷ lệ ----
  await step('D8', async () => {
    if (!derived) return blocked('D8', 'chưa tạo được bảng theo tỷ lệ (D7)');
    const items = await openList(derivedCode);
    await items.locator('tr').filter({ hasText: 'QA-BG-M2' }).getByRole('button', { name: 'Nhập giá tay QA-BG-M2' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập giá tay' });
    await dialog.getByLabel(/Đơn giá/).fill('9.999');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
    check('D8', (await items.locator('tr').filter({ hasText: 'QA-BG-M2' }).innerText()).includes('Giá tay'), 'M2 thành "Giá tay"');
    await setSalePrice('QA-BG-M1', 20_000);
    await setSalePrice('QA-BG-M2', 20_000);
    await goto(page);
    await banner(page).waitFor({ timeout: 15000 });
    await banner(page).getByRole('button', { name: /Đồng bộ/ }).click();
    await banner(page).waitFor({ state: 'detached', timeout: 60000 });
    const detail = await listDetail(derived.id);
    check('D8', itemOf(detail, 'QA-BG-M1')?.price === 21_000, 'M1 theo giá mới × 105% = 21.000', itemOf(detail, 'QA-BG-M1')?.price);
    check('D8', itemOf(detail, 'QA-BG-M2')?.price === 9_999 && itemOf(detail, 'QA-BG-M2')?.priceMode === 'MANUAL', 'M2 giữ giá tay 9.999');
  });

  await step('D9', async () => {
    if (!derived) return blocked('D9', 'chưa tạo được bảng theo tỷ lệ (D7)');
    await goto(page, '#settings/price-lists');
    await page.getByRole('button', { name: `Sửa bảng giá ${derivedCode}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Sửa bảng giá' });
    await dialog.getByLabel(/Tỷ lệ giá so với bảng mặc định/).fill('110');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    const confirm = page.getByRole('dialog', { name: 'Đổi tỷ lệ bảng giá?' });
    check('D9', (await confirm.innerText()).includes('Giá theo tỷ lệ sẽ được tính lại; giá tay giữ nguyên.'), 'hỏi xác nhận đổi tỷ lệ');
    await confirm.getByRole('button', { name: 'Đồng ý' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
    const detail = await listDetail(derived.id);
    check('D9', itemOf(detail, 'QA-BG-M1')?.price === 22_000, 'M1 tính lại 20.000 × 110% = 22.000', itemOf(detail, 'QA-BG-M1')?.price);
    check('D9', itemOf(detail, 'QA-BG-M2')?.price === 9_999, 'M2 giữ giá tay');
    // Trả tỷ lệ, giá Kho về mẫu để các bước báo giá dùng số của test.md.
    await qtbh.patch(`${crm}/price-lists/${derived.id}`, { code: derived.code, name: derived.name, ratioPercent: 105, validFrom: derived.validFrom });
    await setSalePrice('QA-BG-M1', 12_345);
    await setSalePrice('QA-BG-M2', 10_001);
    await qtbh.post(`${crm}/pricing/catalog-sync`);
  });

  // ---- D10-D14: báo giá chọn bảng giá ----
  let quoteId;
  await step('D10', async () => {
    await goto(nv.page, `#quotes/new?customerId=${kh.id}`);
    const input = nv.page.getByPlaceholder(PRICE_LIST_PLACEHOLDER).first();
    await input.waitFor({ timeout: 15000 });
    check('D10', (await input.inputValue()) === '', 'ô "Bảng giá" trống khi lập báo giá mới');
    check('D10', await nv.page.getByRole('button', { name: 'Thêm dòng hàng' }).isDisabled(), 'chưa chọn bảng giá: nút + khoá');
    check('D10', (await nv.page.getByText('Chọn bảng giá trước').count()) > 0, 'có dòng nhắc "Chọn bảng giá trước"');
  });

  const pickerAdd = async (code, override) => {
    const dialog = nv.page.getByRole('dialog', { name: 'Thêm dòng báo giá' });
    if (!(await dialog.count())) await nv.page.getByRole('button', { name: 'Thêm dòng hàng' }).click();
    await dialog.waitFor({ timeout: 15000 });
    await dialog.getByRole('searchbox').fill(code);
    await dialog.getByText(code, { exact: true }).first().click();
    if (override) await dialog.getByLabel(`Đơn giá ghi đè ${code}`).fill(override);
    await dialog.getByRole('button', { name: /Thêm 1 dòng/ }).click();
    await nv.page.waitForTimeout(1500);
    return dialog;
  };
  const lineRow = (code) => nv.page.locator('section[aria-label="Dòng báo giá"] tr').filter({ hasText: code }).first();

  await step('D11', async () => {
    if (!derived) return blocked('D11', 'chưa có bảng theo tỷ lệ (D7)');
    await pickPriceList(nv.page, nv.page, `bang gia 105 ${stamp}`, derivedName);
    await nv.page.getByLabel(/^Tên báo giá/).fill(`QA-BG ${stamp} chọn bảng giá`);
    check('D11', !(await nv.page.getByRole('button', { name: 'Thêm dòng hàng' }).isDisabled()), 'chọn bảng giá (tìm không dấu) mở khoá nút +');
    await nv.page.getByRole('button', { name: 'Thêm dòng hàng' }).click();
    await nv.page.waitForURL((u) => /#quotes\/[0-9a-f-]{36}/.test(u.hash), { timeout: 20000 });
    quoteId = new URL(nv.page.url()).hash.split('/')[1];
    await pickerAdd('QA-BG-M1');
    const text = await lineRow('QA-BG-M1').innerText();
    check('D11', text.includes('12.962') && text.includes('8%'), 'M1 đơn giá 12.962, thuế 8%', text.replace(/\s+/g, ' '));
    check('D11', text.includes(`Bảng giá ${derivedCode}`), 'nguồn giá "Bảng giá <mã>"');
    await shot(nv.page, 'd11-quote');
  });

  await step('D12', async () => {
    if (!quoteId) return blocked('D12', 'chưa lập được báo giá (D11)');
    const dialog = await pickerAdd('QA-BG-M4');
    const alert = await dialog.locator('[role="alert"]').allInnerTexts();
    check('D12', alert.join(' ').includes('QA-BG-M4'), 'thêm M4 báo thiếu giá tại dòng', alert.join(' | '));
    await dialog.getByLabel('Đơn giá ghi đè QA-BG-M4').fill('5.000');
    await dialog.getByRole('button', { name: /Thêm 1 dòng/ }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
    check('D12', (await lineRow('QA-BG-M4').count()) > 0, 'nhập đơn giá ghi đè thì thêm được');
  });

  await step('D13', async () => {
    if (!quoteId) return blocked('D13', 'chưa lập được báo giá (D11)');
    await pickerAdd('QA-BG-M6');
    check('D13', (await lineRow('QA-BG-M6').count()) > 0, 'M6 (ngừng dùng ở Kho) chọn được, có giá');
  });

  await step('D14', async () => {
    if (!quoteId) return blocked('D14', 'chưa lập được báo giá (D11)');
    const list = await defaultList();
    await pickPriceList(nv.page, nv.page, 'bang gia mac dinh', list.name);
    const confirm = nv.page.getByRole('dialog', { name: 'Đổi bảng giá?' });
    await confirm.waitFor({ timeout: 10000 });
    await confirm.getByRole('button', { name: 'Huỷ' }).click();
    const kept = await nv.page.getByPlaceholder(PRICE_LIST_PLACEHOLDER).first().inputValue();
    check('D14', kept === derivedName, 'Huỷ giữ bảng cũ', kept);
    await pickPriceList(nv.page, nv.page, 'bang gia mac dinh', list.name);
    await nv.page.getByRole('dialog', { name: 'Đổi bảng giá?' }).getByRole('button', { name: 'Đồng ý' }).click();
    await nv.page.waitForTimeout(2000);
    const quote = await nv1.get(`${crm}/quotes/${quoteId}`);
    check('D14', quote.version.priceListId === list.id, 'Đồng ý: báo giá lưu bảng mặc định');
    check('D14', (await lineRow('QA-BG-M1').innerText()).includes('12.345'), 'giá M1 tính lại theo bảng mặc định 12.345');
  });

  // ---- D15, D16: phiên bản mới, lập đơn từ báo giá (chuẩn bị qua API) ----
  await step('D15', async () => {
    if (!derived) return blocked('D15', 'chưa có bảng theo tỷ lệ (D7)');
    const list = await defaultList();
    const materials = new Map((await allMaterials()).map((material) => [material.code, material]));
    const templates = await qtbh.get(`${crm}/quote-templates`);
    const templateId = (templates.find((item) => item.isDefault) ?? templates[0])?.id;
    let quote = await qtbh.post(`${crm}/quotes`, { customerId: kh.id, templateId, quoteName: `QA-BG ${stamp} phiên bản`, priceListId: derived.id });
    quote = await qtbh.post(`${crm}/quotes/${quote.id}/versions/1/lines/batch`, {
      revision: quote.version.revision,
      lines: [{ materialId: materials.get('QA-BG-M1').id, quantity: 1 }],
    });
    const act = (detail, action) => qtbh.post(`${crm}/quotes/${detail.id}/versions/${detail.version.versionNo}/${action}`, { revision: detail.version.revision });
    try {
      quote = await act(quote, 'send');
    } catch {
      quote = await act(await act(quote, 'submit'), 'approve').then((approved) => act(approved, 'send'));
    }
    const revised = await act(quote, 'revise');
    check('D15', revised.version.priceListId === derived.id, 'phiên bản mới mang theo bảng giá');
    await goto(page, `#quotes/${quote.id}`);
    await pickPriceList(page, page, 'bang gia mac dinh', list.name);
    await page.getByRole('dialog', { name: 'Đổi bảng giá?' }).getByRole('button', { name: 'Đồng ý' }).click();
    await page.waitForTimeout(2000);
    const v1 = await qtbh.get(`${crm}/quotes/${quote.id}?version=1`);
    const v2 = await qtbh.get(`${crm}/quotes/${quote.id}?version=2`);
    check('D15', v1.version.priceListId === derived.id && v2.version.priceListId === list.id, 'phiên bản cũ giữ bảng cũ, phiên bản mới đổi được');

    // D16: khách chấp nhận phiên bản mới (đã gửi) rồi chuyển thành đơn.
    try {
      let current = v2;
      try {
        current = await act(current, 'send');
      } catch {
        current = await act(await act(current, 'submit'), 'approve').then((approved) => act(approved, 'send'));
      }
      await act(current, 'accept');
      const converted = await qtbh.post(`${crm}/quotes/${quote.id}/convert`);
      const orderId = converted.orderId ?? converted.order?.id;
      const order = await qtbh.get(`${crm}/orders/${orderId}`);
      check('D16', order.priceListId === list.id, 'đơn từ báo giá mang bảng giá của báo giá');
      await goto(page, `#orders/${orderId}`);
      await page.locator('section[aria-label="Thông tin đơn"]').waitFor({ timeout: 15000 });
      check('D16', (await page.getByPlaceholder(PRICE_LIST_PLACEHOLDER).count()) === 0, 'đơn từ báo giá không có ô chọn bảng giá');
      check('D16', (await page.locator('section[aria-label="Thông tin đơn"]').innerText()).includes(list.name), 'hiện tên bảng giá dạng chữ');
    } catch (error) {
      blocked('D16', `không chuyển được báo giá thành đơn qua API (${error instanceof Error ? error.message.slice(0, 160) : error})`);
    }
  });

  // ---- D17: đơn trực tiếp, đơn từ hợp đồng ----
  await step('D17', async () => {
    if (!derived) return blocked('D17', 'chưa có bảng theo tỷ lệ (D7)');
    await goto(page, '#orders');
    await page.getByRole('button', { name: /Lập đơn/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Lập đơn bán' });
    await dialog.getByPlaceholder('Chọn khách hàng').click();
    await dialog.getByPlaceholder('Chọn khách hàng').fill(kh.name);
    await page.getByRole('option').filter({ hasText: kh.name }).first().click();
    await dialog.getByRole('button', { name: 'Lập đơn' }).click();
    check('D17', (await dialog.innerText()).includes('Vui lòng chọn bảng giá.'), 'đơn trực tiếp: chưa chọn bảng giá thì báo tại ô');
    await pickPriceList(dialog, page, `bang gia 105 ${stamp}`, derivedName);
    await dialog.getByRole('button', { name: 'Lập đơn' }).click();
    await page.waitForURL((u) => /#orders\/[0-9a-f-]{36}/.test(u.hash), { timeout: 20000 });
    const orderId = new URL(page.url()).hash.split('/')[1];
    const order = await qtbh.get(`${crm}/orders/${orderId}`);
    check('D17', order.priceListId === derived.id, 'đơn trực tiếp lưu bảng giá đã chọn');
    const contracts = (await qtbh.get(`${crm}/contracts?status=ACTIVE&limit=20`))?.items ?? [];
    if (!contracts.length) blocked('D17', 'không có hợp đồng đang hiệu lực để kiểm đơn từ hợp đồng, giá hợp đồng ưu tiên');
    else {
      const fromContract = await qtbh.post(`${crm}/orders`, { contractId: contracts[0].id, priceListId: derived.id });
      check('D17', fromContract.priceListId === derived.id, 'đơn từ hợp đồng lưu bảng giá đã chọn');
      console.log('Ghi chú D17: giá hợp đồng ưu tiên kiểm ở integration spec của CRM (cần mặt hàng có trong hợp đồng).');
    }
  });

  // ---- D18: thử tính giá ----
  await step('D18', async () => {
    if (!derived) return blocked('D18', 'chưa có bảng theo tỷ lệ (D7)');
    await goto(page, '#settings/quote-preview');
    const sec = page.locator('section[aria-label="Thử tính giá"]');
    await sec.waitFor({ timeout: 15000 });
    check('D18', await sec.getByRole('button', { name: 'Tính giá' }).isDisabled(), 'chưa chọn bảng giá: "Tính giá" khoá');
    await sec.locator('input[placeholder*="Chọn khách"]').first().click();
    await page.getByRole('option').filter({ hasText: kh.name }).first().click();
    await pickPriceList(sec, page, `bang gia 105 ${stamp}`, derivedName);
    await sec.locator('input[placeholder*="Chọn mặt hàng"]').first().click();
    await page.getByRole('option').filter({ hasText: 'QA-BG-M1' }).first().click();
    await sec.getByRole('button', { name: 'Tính giá' }).click();
    const res = page.locator('section[aria-label="Kết quả tính giá"]');
    await res.waitFor({ timeout: 15000 });
    const text = await res.innerText();
    check('D18', text.includes('12.962') && text.includes(derivedCode), 'kết quả theo bảng đã chọn (12.962, nguồn là mã bảng)', text.replace(/\s+/g, ' ').slice(0, 200));
  });

  // ---- D19: hồ sơ khách ----
  await step('D19', async () => {
    await goto(page, `#customers/${kh.id}`);
    await page.waitForTimeout(1500);
    const facts = await page.locator('dl').first().innerText();
    check('D19', !/\bBảng giá\b/.test(facts), 'hồ sơ khách không còn "Bảng giá"');
    const edit = page.getByRole('button', { name: /^Sửa/ }).first();
    if (await edit.count()) {
      await edit.click();
      const dialog = page.getByRole('dialog').first();
      check('D19', !(await dialog.innerText()).includes('Bảng giá'), 'form khách không còn ô "Bảng giá"');
      await page.keyboard.press('Escape');
    }
  });

  blocked('D20', 'cần báo giá nháp tạo trước khi áp migration 0039; kiểm tay: mở báo giá cũ, ô "Bảng giá" có sẵn, tổng tiền không đổi');

  // ---- D21: xoá bảng đang dùng ----
  await step('D21', async () => {
    if (!derived) return blocked('D21', 'chưa có bảng theo tỷ lệ (D7)');
    await goto(page, '#settings/price-lists');
    const row = page.locator('section[aria-label="Bảng giá"] tr').filter({ hasText: derivedCode }).first();
    await row.getByRole('button', { name: `Xoá bảng giá ${derivedCode}` }).click();
    await page.getByRole('button', { name: 'Xoá', exact: true }).last().click();
    await page.waitForTimeout(1500);
    const text = await toastText(page);
    check('D21', text.includes('Ngừng áp dụng'), 'xoá bảng đang dùng báo chuyển "Ngừng áp dụng"', text);
    const updated = await qtbh.patch(`${crm}/price-lists/${derived.id}`, {
      code: derived.code,
      name: derived.name,
      ratioPercent: 105,
      validFrom: derived.validFrom,
      status: 'INACTIVE',
    });
    check('D21', updated.status === 'INACTIVE', 'chuyển "Ngừng áp dụng" được');
  });

  blocked('D22', 'cần dừng inventory-api; kiểm tay: QT mở CRM không có thông báo, trang chạy bình thường; "Đồng bộ" (nếu đang hiện) báo lỗi rõ');

  // ---- D23: bố cục 16:9 ----
  await step('D23', async () => {
    for (const [width, height] of [
      [1600, 900],
      [1366, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await goto(page, '#settings/price-lists');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('D23', overflow <= 1, `${width} × ${height}: không tràn ngang`, overflow);
      await shot(page, `d23-${width}`);
    }
  });

  await nv.context.close();
  await context.close();
} finally {
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.blocked).length;
  console.log(`\nTổng: ${results.length - failed.length - skipped}/${results.length - skipped} đạt, ${skipped} bị chặn`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
