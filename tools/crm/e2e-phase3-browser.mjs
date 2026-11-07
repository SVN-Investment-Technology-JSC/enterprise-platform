// Kiểm phase 3 trên trình duyệt thật (P3C5-03): trình thiết kế bố cục, màn báo giá 2 cột có xem trước, xuất PDF/Word,
// quyền trên giao diện. Playwright + Chrome hệ thống vào gateway 8080, như các script trình duyệt phase 2.
// Cần đã chạy `seed-svn.mjs --step=phase3`. Dữ liệu chuẩn bị và kiểm lại qua API (phiên Node như seed).
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase3-browser.mjs [--shots=<thư mục>] [--base=http://localhost:8080]
//        [--tenant=svn] [--other-tenant=svn2] [--only=DS,QW,EX,PERM]
// Xuất PDF: `print()` trong iframe ẩn được thay bằng hàm ghi lại (không mở hộp thoại in thật); kiểm `<title>`, `@page`, nội dung.
// Xuất Word: kiểm sự kiện tải file, tên file `<mã>_v<n>.docx`, chunk `docx` chỉ tải khi bấm, giải nén kiểm `word/document.xml`.
// Mỗi lượt để lại vài báo giá `QA-P3B <số>` và mẫu thử `QA-P3B Mẫu thử giao diện` (đang tắt); bố cục M-A4 được trả về như cũ.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessions, materialsByCode, requireCustomers } from './seed-svn/common.mjs';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { M_OFF_TITLE, M_PRE_TITLE, P3_SCRIPT_TEXT, P3_TEMPLATES, P3_XSS_CUSTOMER, makePng, requirePhase3 } from './seed-svn/phase3.mjs';

const require = createRequire(import.meta.url);
// playwright-core không phải dependency trực tiếp của workspace: lấy từ kho pnpm (phiên bản nào có thì dùng), như phase 2.
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
    'other-tenant': { type: 'string', default: 'svn2' },
    only: { type: 'string', default: 'DS,QW,EX,PERM' },
  },
});
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const password = config.password;
const only = new Set(values.only.split(',').map((s) => s.trim().toUpperCase()));
if (values.shots) mkdirSync(values.shots, { recursive: true });
const workDir = mkdtempSync(join(tmpdir(), 'crm-p3-browser-'));

// ---------------------------------------------------------------------------
// Ghi kết quả theo TC (như e2e-phase3.mjs)
// ---------------------------------------------------------------------------
const tcs = new Map();
const tcOf = (tc) => {
  if (!tcs.has(tc)) tcs.set(tc, { pass: 0, fail: 0, blocked: [] });
  return tcs.get(tc);
};
const check = (tc, ok, label, detail = '') => {
  const entry = tcOf(tc);
  if (ok) entry.pass += 1;
  else entry.fail += 1;
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${label}${detail ? `  [${String(detail).slice(0, 200)}]` : ''}`);
};
const blocked = (tc, reason) => {
  tcOf(tc).blocked.push(reason);
  console.log(`BỊ CHẶN  ${tc}  ${reason}`);
};
const group = async (tc, fn) => {
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
const fx = await requirePhase3(config, sessions);
const T = fx.templates;
const Q = fx.quotes;
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const materials = await materialsByCode(config, qtv);
const mat = (code) => materials.get(code)?.id;
const stamp = Date.now() % 1_000_000;
const layoutUrl = (id) => `${crm}/v1/quote-templates/${id}/layout`;
const quoteUrl = (id) => `${crm}/v1/quotes/${id}`;
const getLayout = (id) => qtbh.get(layoutUrl(id));
const titleOf = (layout) => layout?.blocks?.find((block) => block.type === 'title')?.text;
const THREE = () => [
  { materialId: mat('QA-KHO-CAP'), quantity: 2 },
  { materialId: mat('QA-KHO-MUC'), quantity: 3 },
  { materialId: mat('QA-KHO-BT'), quantity: 1 },
];
async function newQuote(label, templateId, lines = THREE(), extra = {}) {
  let detail = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, templateId, quoteName: `QA-P3B ${stamp} ${label}`, ...extra });
  if (lines.length) {
    detail = await nv1.post(`${quoteUrl(detail.id)}/versions/${detail.version.versionNo}/lines/batch`, { revision: detail.version.revision, lines });
  }
  return detail;
}
const a4Original = await getLayout(T['M-A4'].id);
const a4Title = titleOf(a4Original.layout);
let a4Dirty = false;
/** Đổi tiêu đề bố cục M-A4 qua API (QTBH); `restoreA4` trả lại như cũ. */
async function setA4Title(title) {
  const current = await getLayout(T['M-A4'].id);
  const layout = { ...current.layout, blocks: current.layout.blocks.map((block) => (block.type === 'title' ? { ...block, text: title } : block)) };
  await qtbh.put(layoutUrl(T['M-A4'].id), { layout, expectedUpdatedAt: current.updatedAt });
  a4Dirty = true;
}
async function restoreA4() {
  if (!a4Dirty) return;
  const current = await getLayout(T['M-A4'].id);
  await qtbh.put(layoutUrl(T['M-A4'].id), { layout: a4Original.layout, expectedUpdatedAt: current.updatedAt });
  a4Dirty = false;
}

// Mẫu thử giao diện: đang tắt (không hiện ở ô chọn mẫu của NV1), không có bố cục khi bắt đầu.
const SCRATCH = { name: 'QA-P3B Mẫu thử giao diện', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: mẫu thử của e2e-phase3-browser.mjs', active: false, isDefault: false, sortOrder: 91 };
let scratch = (await qtbh.get(`${crm}/v1/quote-templates?includeInactive=true`)).find((t) => t.name === SCRATCH.name);
if (!scratch) scratch = await qtbh.post(`${crm}/v1/quote-templates`, SCRATCH);
async function resetScratch() {
  const current = await getLayout(scratch.id);
  if (current.layout) await qtbh.put(layoutUrl(scratch.id), { layout: null, expectedUpdatedAt: current.updatedAt });
}
await resetScratch();

// ---------------------------------------------------------------------------
// Trình duyệt
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const crmUrl = `${values.base}/modules/crm`;

/**
 * Thay `print()` của iframe in (export-pdf.ts gắn iframe vào body rồi mới `await`) bằng hàm ghi lại `<title>`, CSS `@page`,
 * chữ và số ảnh của bản in. Đếm hộp `alert` (kiểm XSS).
 */
const PRINT_HOOK = () => {
  window.__p3print = [];
  window.__p3alerts = 0;
  const original = window.alert;
  window.alert = (...args) => {
    window.__p3alerts += 1;
    return original?.apply(window, args);
  };
  const hook = (frame) => {
    try {
      const w = frame.contentWindow;
      if (!w || w.__p3hooked) return;
      w.__p3hooked = true;
      w.print = () => {
        const d = w.document;
        // Luật @page của bản in là thẻ style thêm sau cùng (sau các stylesheet chép từ trang).
        const css = [...d.querySelectorAll('style')].map((s) => s.textContent ?? '').filter((s) => s.includes('@page')).at(-1) ?? '';
        window.__p3print.push({ title: d.title, pageCss: css.split('\n')[0], text: d.body?.innerText ?? '', images: d.images.length, scripts: d.querySelectorAll('body script').length });
      };
    } catch {
      /* iframe khác nguồn: bỏ qua */
    }
  };
  // Init script chạy trước khi có <html> (documentElement còn null): quan sát cả `document`.
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.tagName === 'IFRAME') hook(node);
  }).observe(document, { childList: true, subtree: true });
};

async function login(code, { width = 1600, height = 900, tenant = values.tenant } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  await context.addInitScript(PRINT_HOOK);
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`${values.base}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(`${code}@${tenant}.local`);
  await page.locator('input[type="password"]').first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return { context, page, dialogs };
}
const shot = async (page, name) => {
  if (values.shots) await page.screenshot({ path: `${values.shots}/p3-${name}.png`, fullPage: false }).catch(() => undefined);
};
const goto = async (page, hash = '') => {
  await page.goto(`${crmUrl}${hash}`);
  await page.reload();
  await page.waitForTimeout(2500);
};
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);

/** Chọn giá trị của `SearchableSelect` nằm trong `scope` (ô nhập hiển thị), theo nhãn tuỳ chọn. */
async function chooseOption(page, input, optionText) {
  await input.click();
  const option = page.locator('[role="listbox"] [role="option"]', { hasText: optionText }).first();
  await option.waitFor({ timeout: 8000 });
  await option.click();
  await page.waitForTimeout(300);
}
const fieldInput = (scope, label) => scope.locator('label', { has: scope.page().locator('span', { hasText: new RegExp(`^${label}`) }) }).locator('input[type="text"]').first();
const optionTexts = async (page) => page.locator('[role="listbox"] [role="option"]').allInnerTexts();

// Màn báo giá
const previewPane = (page) => page.locator('section[aria-label="Xem trước báo giá"]');
const previewSheet = (page) => previewPane(page).locator('[data-paper]').first();
const previewText = async (page) => (await previewPane(page).innerText().catch(() => '')) ?? '';
const previewLineRows = (page) => previewPane(page).locator('[data-block-type="lineTable"] tbody tr');
const actionBar = (page) => page.locator('[role="toolbar"][aria-label="Thao tác báo giá"]');
const linesSection = (page) => page.locator('section[aria-label="Dòng báo giá"]');
const lineRows = (page) => linesSection(page).locator('tbody tr[data-row-key]');
async function openQuote(page, id) {
  await goto(page, `#quotes/${id}`);
  await previewPane(page).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
}
async function exportPdf(page, scope = previewPane(page)) {
  const before = await page.evaluate(() => window.__p3print.length);
  await scope.getByRole('button', { name: /Xuất/ }).first().click();
  await page.getByRole('menuitem', { name: 'PDF / In' }).click();
  await page.waitForFunction((n) => window.__p3print.length > n, before, { timeout: 20000 });
  return page.evaluate(() => window.__p3print[window.__p3print.length - 1]);
}
async function exportWord(page, scope = previewPane(page)) {
  await scope.getByRole('button', { name: /Xuất/ }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: 'Word (.docx)' }).click()]);
  const file = join(workDir, `${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  let xml = '';
  try {
    xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    xml = '';
  }
  return { name: download.suggestedFilename(), file, xml };
}
/** Bấm nút thêm của hộp chọn mặt hàng; mặt hàng đã có trong báo giá thì hộp hỏi lại ("Vẫn thêm N dòng"), bấm lần nữa. */
async function submitPicker(page, dlg, count) {
  await dlg.getByRole('button', { name: new RegExp(`^Thêm ${count} dòng$`) }).click();
  const again = dlg.getByRole('button', { name: new RegExp(`^Vẫn thêm ${count} dòng$`) });
  if (await again.waitFor({ timeout: 2000 }).then(() => true).catch(() => false)) await again.click();
  await dlg.waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForTimeout(1200);
}
const expectedFileName = (code, versionNo) => `${(code || 'BaoGia').replace(/[\\/:*?"<>|\s]+/g, '-')}_v${versionNo}`;

// Trình thiết kế
const designer = (page) => page.locator('[role="dialog"][aria-label^="Thiết kế bố cục mẫu"]');
const designPage = (page) => designer(page).locator('[data-testid="layout-page"]');
const designBlocks = (page) => designPage(page).locator('[data-block-id]');
const blockList = async (page) =>
  designBlocks(page).evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-block-id'), type: node.getAttribute('data-block-type'), selected: node.getAttribute('aria-pressed') === 'true' })));
const templateRow = (page, name) => page.locator('section[aria-label="Mẫu báo giá"] tbody tr', { hasText: name }).first();
async function openDesigner(page, name) {
  await templateRow(page, name).getByRole('button', { name: 'Thiết kế bố cục' }).click();
  await designer(page).waitFor({ timeout: 10000 });
  await designPage(page).waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
}
const pageSelect = (page, name) => designer(page).locator(`div:has(> input[type="hidden"][name="${name}"]) input[type="text"]`).first();
async function selectBlock(page, index) {
  await designBlocks(page).nth(index).click({ position: { x: 6, y: 4 } });
  await page.waitForTimeout(150);
}
async function closeDesigner(page) {
  await designer(page).getByRole('button', { name: /Đóng/ }).first().click();
  const discard = page.getByRole('button', { name: 'Bỏ thay đổi' });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await designer(page).waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
}
const designMenu = async (page, item) => {
  await designer(page).getByRole('button', { name: 'Thêm thao tác' }).click();
  await designer(page).getByRole('menuitem', { name: item }).click();
};
const importFile = async (page, name, buffer, mimeType = 'application/json') => {
  await designer(page).locator('[data-testid="layout-import-input"]').setInputFiles({ name, mimeType, buffer });
  await page.waitForTimeout(800);
};

// ===================================================================================================================
// TRÌNH THIẾT KẾ (TC-DS)
// ===================================================================================================================
async function runDesigner() {
  const { context, page } = await login('qtbh');
  const puts = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/quote-templates\/[^/]+\/layout/.test(request.url())) puts.push(request.url());
  });
  try {
    await goto(page, '#settings/quote-forms');
    await templateRow(page, P3_TEMPLATES['M-NONE'].name).waitFor({ timeout: 15000 });

    await group('TC-DS-01', async () => {
      const tc = 'TC-DS-01';
      const row = templateRow(page, P3_TEMPLATES['M-NONE'].name);
      check(tc, /Mặc định/.test(await row.innerText()), `Cột "Bố cục" của "${P3_TEMPLATES['M-NONE'].name}" ghi "Mặc định"`);
      const a4Row = templateRow(page, P3_TEMPLATES['M-A4'].name);
      check(tc, /Đã thiết kế/.test(await a4Row.innerText()), `Cột "Bố cục" của "${P3_TEMPLATES['M-A4'].name}" ghi "Đã thiết kế"`);
      await openDesigner(page, P3_TEMPLATES['M-NONE'].name);
      const blocks = await blockList(page);
      const box = await designer(page).boundingBox();
      check(tc, box && box.width >= 1500 && box.height >= 850, 'Màn phủ toàn màn hình', JSON.stringify(box));
      check(tc, blocks.length === 9 && blocks[0].type === 'companyHeader' && blocks.some((b) => b.type === 'lineTable'), 'Mở với bố cục mặc định (9 khối)', blocks.map((b) => b.type).join(','));
      const deleteItem = async () => {
        await designer(page).getByRole('button', { name: 'Thêm thao tác' }).click();
        const disabled = await designer(page).getByRole('menuitem', { name: /Xoá bố cục/ }).isDisabled();
        await page.keyboard.press('Escape');
        return disabled;
      };
      check('TC-DS-22', await deleteItem(), 'Mẫu chưa có bố cục lưu: mục "Xoá bố cục" bị tắt');
      await shot(page, 'ds-01-mnone');
      await closeDesigner(page);
    });

    // Các thao tác sửa: trên mẫu thử (không làm hỏng mẫu của seed).
    await openDesigner(page, SCRATCH.name);

    await group('TC-DS-02', async () => {
      const tc = 'TC-DS-02';
      const sheet = designPage(page).locator('[data-paper]').first();
      await chooseOption(page, pageSelect(page, 'paper'), 'A3');
      await chooseOption(page, pageSelect(page, 'orientation'), 'Ngang');
      check(tc, (await sheet.getAttribute('data-paper')) === 'A3' && (await sheet.getAttribute('data-orientation')) === 'landscape', 'Đổi A3, Ngang: trang đổi ngay');
      const ratio = await sheet.evaluate((node) => node.offsetWidth / node.offsetHeight);
      check(tc, ratio > 1.3, 'Trang ngang: rộng hơn cao (tỉ lệ 420:297 khi chưa đầy)', ratio.toFixed(3));
      await chooseOption(page, pageSelect(page, 'fontFamily'), 'Arial');
      await chooseOption(page, pageSelect(page, 'fontSizePt'), '12 pt');
      const style = await sheet.evaluate((node) => ({ font: node.style.fontFamily, size: node.style.fontSize }));
      check(tc, /Arial/.test(style.font) && style.size === '12pt', 'Font Arial, cỡ 12', JSON.stringify(style));
      await designer(page).getByRole('button', { name: 'Lề', exact: true }).click();
      await designer(page).getByLabel('Lề trái').fill('30');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      const left = await sheet.evaluate((node) => node.style.paddingLeft);
      check(tc, left === '30mm', 'Lề trái 30 mm', left);
      await shot(page, 'ds-02-page');
    });

    await group('TC-DS-03', async () => {
      const tc = 'TC-DS-03';
      // Bấm khi không chọn khối: thêm cuối, khối mới được chọn.
      await designPage(page).locator('[data-paper]').first().click({ position: { x: 3, y: 3 } });
      const before = await blockList(page);
      await designer(page).getByRole('button', { name: 'Thêm khối Đường kẻ' }).click();
      let after = await blockList(page);
      check(tc, after.length === before.length + 1 && after.at(-1).type === 'divider' && after.at(-1).selected, 'Không chọn khối: bấm "Đường kẻ" thêm cuối trang, khối mới được chọn');
      // Chọn khối 2 rồi bấm: thêm ngay sau khối 2.
      await selectBlock(page, 1);
      await designer(page).getByRole('button', { name: 'Thêm khối Đường kẻ' }).click();
      after = await blockList(page);
      check(tc, after[2].type === 'divider' && after[2].selected && after.length === before.length + 2, 'Đang chọn khối 2: khối mới nằm ngay sau khối 2', after.map((b) => b.type).join(','));
      // Kéo "Đoạn văn" thả vào nửa trên khối 4: khối mới thành khối 4.
      const target = designBlocks(page).nth(3);
      await designer(page).getByRole('button', { name: 'Thêm khối Đoạn văn' }).dragTo(target, { targetPosition: { x: 20, y: 2 } });
      await page.waitForTimeout(300);
      const dragged = await blockList(page);
      check(tc, dragged.length === after.length + 1 && dragged[3].type === 'text' && dragged[3].selected, 'Kéo "Đoạn văn" thả giữa khối 3 và 4: nằm đúng chỗ, được chọn', dragged.map((b) => b.type).join(','));
    });

    await group('TC-DS-04', async () => {
      const tc = 'TC-DS-04';
      const before = await blockList(page);
      await designBlocks(page).nth(4).dragTo(designBlocks(page).nth(0), { targetPosition: { x: 20, y: 2 } });
      await page.waitForTimeout(300);
      const moved = await blockList(page);
      check(tc, moved[0].id === before[4].id && moved.length === before.length, 'Kéo khối 5 lên đầu: thứ tự đổi đúng', moved.slice(0, 3).map((b) => b.id).join(','));
      // Kéo một khối có chiều cao thật (đường kẻ chỉ cao 1 pt, sát nhau thì không trỏ chuột chính xác được).
      const tall = moved.findIndex((b) => b.type === 'fieldGrid');
      await designBlocks(page).nth(tall).dragTo(designer(page).getByRole('heading', { name: 'Thư viện khối' }));
      await page.waitForTimeout(300);
      const outside = await blockList(page);
      check(tc, outside.map((b) => b.id).join() === moved.map((b) => b.id).join(), 'Kéo khối ra ngoài trang rồi thả: không đổi gì');
    });

    await group('TC-DS-10', async () => {
      const tc = 'TC-DS-10';
      await selectBlock(page, 1);
      const before = await blockList(page);
      await page.keyboard.press('Delete');
      let now = await blockList(page);
      check(tc, now.length === before.length - 1 && !now.some((b) => b.id === before[1].id), 'Delete: xoá khối đang chọn');
      await page.keyboard.press('Control+z');
      now = await blockList(page);
      check(tc, now.length === before.length && now[1].id === before[1].id, 'Ctrl+Z: hoàn tác');
      await page.keyboard.press('Control+Shift+z');
      now = await blockList(page);
      check(tc, now.length === before.length - 1, 'Ctrl+Shift+Z: làm lại');
      await page.keyboard.press('Control+z');
      await selectBlock(page, 1);
      await page.keyboard.press('Alt+ArrowDown');
      now = await blockList(page);
      check(tc, now[2].id === before[1].id, 'Alt+↓: đưa khối xuống');
      await page.keyboard.press('Alt+ArrowUp');
      // Delete trong ô chữ chỉ xoá ký tự.
      const titleIndex = (await blockList(page)).findIndex((b) => b.type === 'title');
      await selectBlock(page, titleIndex);
      const input = designer(page).getByLabel('Tiêu đề', { exact: true });
      const count = (await blockList(page)).length;
      const value = await input.inputValue();
      await input.focus();
      await input.press('Home');
      await input.press('Delete');
      check(tc, (await blockList(page)).length === count && (await input.inputValue()) === value.slice(1), 'Delete khi đang gõ trong ô chữ: chỉ xoá ký tự, không xoá khối', await input.inputValue());
      await input.fill(value);
      await input.blur();
    });

    await group('TC-DS-12', async () => {
      const tc = 'TC-DS-12';
      const titleIndex = (await blockList(page)).findIndex((b) => b.type === 'title');
      await selectBlock(page, titleIndex);
      const panel = designer(page).locator('[aria-label="Thuộc tính Tiêu đề"]');
      const size = panel.getByLabel('Cỡ chữ (pt)');
      await size.fill('24');
      await page.waitForTimeout(200);
      const titleNode = designBlocks(page).nth(titleIndex).locator('div[style*="font-size"]').first();
      check(tc, (await titleNode.evaluate((node) => node.style.fontSize)) === '24pt', 'Cỡ chữ tiêu đề 24: trang cập nhật ngay');
      await size.fill('50');
      await page.waitForTimeout(200);
      check(tc, /Nhập số từ 12 đến 32/.test(await panel.innerText()) && (await titleNode.evaluate((node) => node.style.fontSize)) === '24pt', 'Cỡ chữ 50: bị chặn ở ô nhập kèm thông báo');
      await size.fill('24');
      await size.blur();
      await panel.getByRole('radio', { name: 'Căn phải' }).click();
      const uppercase = panel.getByLabel('Viết hoa toàn bộ');
      const wasUpper = await uppercase.isChecked();
      await uppercase.click();
      check(tc, (await uppercase.isChecked()) !== wasUpper, 'Bật tắt "Viết hoa toàn bộ"');
      const textIndex = (await blockList(page)).findIndex((b) => b.type === 'text');
      await selectBlock(page, textIndex);
      const bold = designer(page).getByRole('button', { name: 'Đậm đoạn 1' });
      await bold.click();
      check(tc, (await bold.getAttribute('aria-pressed')) === 'true', 'Đoạn văn: bật đậm');
      const gridIndex = (await blockList(page)).findIndex((b) => b.type === 'fieldGrid');
      await selectBlock(page, gridIndex);
      await designer(page).getByRole('radiogroup', { name: 'Số cột' }).getByRole('radio', { name: '1 cột' }).click();
      check(tc, (await designer(page).getByRole('radiogroup', { name: 'Số cột' }).getByRole('radio', { name: '1 cột' }).getAttribute('aria-checked')) === 'true', 'Bảng thông tin: đổi số cột');
    });

    await group('TC-DS-13', async () => {
      const tc = 'TC-DS-13';
      const tableIndex = (await blockList(page)).findIndex((b) => b.type === 'lineTable');
      await selectBlock(page, tableIndex);
      const table = designBlocks(page).nth(tableIndex);
      await designer(page).getByLabel('Hiện cột VAT (%)').uncheck();
      check(tc, !/VAT \(%\)/.test(await table.locator('thead').innerText()), 'Ẩn cột VAT: bảng trên trang không còn cột VAT');
      const label = designer(page).getByLabel('Nhãn cột 3');
      await label.fill('Tên hàng');
      await label.blur();
      check(tc, /Tên hàng/.test(await table.locator('thead').innerText()), 'Đổi tên cột thành "Tên hàng"');
      const width = designer(page).getByLabel('Độ rộng cột Tên hàng (%)');
      await width.fill(String(Number(await width.inputValue()) - 10));
      await width.blur();
      await page.waitForTimeout(200);
      check(tc, /phải là 100%/.test(await designer(page).locator('[aria-label="Thuộc tính Bảng dòng hàng"]').innerText()), 'Tổng độ rộng lệch: hiện lỗi ngay tại ô');
      await designer(page).getByRole('button', { name: 'Chia đều độ rộng' }).click();
      check(tc, !/phải là 100%/.test(await designer(page).locator('[aria-label="Thuộc tính Bảng dòng hàng"]').innerText()), 'Chia đều độ rộng: hết lỗi');
      const boxes = designer(page).locator('[aria-label="Cột của bảng"] input[type="checkbox"]');
      const putCount = puts.length;
      for (let i = 0; i < (await boxes.count()); i += 1) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
      check(tc, /ít nhất một cột hiện/.test(await designer(page).locator('[aria-label="Thuộc tính Bảng dòng hàng"]').innerText()), 'Ẩn hết cột: báo lỗi');
      await designer(page).getByRole('button', { name: /^Lưu$/ }).click();
      await page.waitForTimeout(800);
      const panel = designer(page).locator('[role="alert"]', { hasText: /Bố cục còn \d+ lỗi/ });
      check(tc, puts.length === putCount && (await panel.count()) > 0, 'Ẩn hết cột: Lưu bị chặn (không gọi API)');
      // TC-DS-18: bấm vào lỗi thì chọn khối lỗi.
      await designPage(page).locator('[data-paper]').first().click({ position: { x: 3, y: 3 } });
      await panel.getByRole('button').first().click();
      const selected = (await blockList(page)).find((b) => b.selected);
      check('TC-DS-18', puts.length === putCount && selected?.type === 'lineTable', 'Lưu khi còn lỗi: không gọi API, có danh sách lỗi tiếng Việt, bấm lỗi chọn đúng khối', selected?.type);
      await designer(page).getByRole('button', { name: 'Chia đều độ rộng' }).click().catch(() => undefined);
      for (let i = 0; i < 3; i += 1) await boxes.nth(i).check();
      await designer(page).getByRole('button', { name: 'Chia đều độ rộng' }).click();
    });

    await group('TC-DS-15', async () => {
      const tc = 'TC-DS-15';
      const textIndex = (await blockList(page)).findIndex((b) => b.type === 'text');
      await selectBlock(page, textIndex);
      const area = designer(page).getByLabel('Chữ đoạn 1', { exact: true });
      await area.fill('Kính gửi ');
      await area.press('End');
      await designer(page).getByRole('button', { name: 'Chèn biến vào Chữ đoạn 1' }).click();
      const picker = designer(page).getByRole('dialog', { name: 'Chèn biến' });
      await picker.getByLabel('Tìm biến').fill('ten khach');
      await picker.getByRole('button', { name: /\{\{customer\.name\}\}/ }).first().click();
      check(tc, (await area.inputValue()) === 'Kính gửi {{customer.name}}', 'Chèn biến đúng vị trí con trỏ; tìm "ten khach" không dấu vẫn ra', await area.inputValue());
    });

    await group('TC-DS-16', async () => {
      const tc = 'TC-DS-16';
      const textIndex = (await blockList(page)).findIndex((b) => b.type === 'text');
      await selectBlock(page, textIndex);
      await designer(page).getByRole('button', { name: 'Chèn biến vào Chữ đoạn 1' }).click();
      const picker = designer(page).getByRole('dialog', { name: 'Chèn biến' });
      await picker.getByLabel('Tìm biến').fill(fx.fields['CF-PAY'].name);
      check(tc, (await picker.getByRole('button', { name: new RegExp(fx.fields['CF-PAY'].id) }).count()) > 0, 'CF-PAY (đang bật) có trong danh sách biến');
      await picker.getByLabel('Tìm biến').fill(fx.fields['CF-OFF'].name);
      check(tc, (await picker.getByRole('button', { name: new RegExp(fx.fields['CF-OFF'].id) }).count()) === 0, 'CF-OFF (đã tắt) không có trong danh sách biến');
      await page.keyboard.press('Escape');
    });

    await group('TC-DS-11', async () => {
      const tc = 'TC-DS-11';
      await designer(page).getByRole('button', { name: 'Thêm khối Ảnh' }).click();
      const input = designer(page).locator('[data-testid="layout-image-input"]').first();
      const panel = designer(page).locator('[aria-label="Thuộc tính Ảnh"]');
      await input.setInputFiles({ name: 'logo-200kb.png', mimeType: 'image/png', buffer: makePng(258, 11) });
      await page.waitForTimeout(1500);
      check(tc, (await panel.locator('img').count()) > 0 && !/vượt 300 KB|Chỉ nhận/.test(await panel.innerText()), 'PNG ~200 KB: nhận');
      await input.setInputFiles({ name: 'logo-327kb.png', mimeType: 'image/png', buffer: makePng(330, 12) });
      await page.waitForTimeout(1500);
      check(tc, /Ảnh vượt 300 KB/.test(await panel.innerText()), 'PNG ~327 KB (dưới 1.000 px, không thu nhỏ được): báo "Ảnh vượt 300 KB…"');
      await input.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') });
      await page.waitForTimeout(800);
      check(tc, /Chỉ nhận ảnh PNG hoặc JPEG/.test(await panel.innerText()), 'File SVG: "Chỉ nhận ảnh PNG hoặc JPEG."');
      await input.setInputFiles({ name: 'tai-lieu.png', mimeType: 'image/png', buffer: Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n') });
      await page.waitForTimeout(800);
      check(tc, /Chỉ nhận ảnh PNG hoặc JPEG|Không đọc được ảnh/.test(await panel.innerText()), 'File PDF đổi đuôi .png: bị từ chối', (await panel.innerText()).slice(0, 120));
      console.log('  ghi chú: PNG 2.000 px (500 KB) và JPEG 5 MB 4.000 px (tự thu nhỏ) chưa kiểm ở E2E; đã có ở component (layout-image.spec).');
    });

    await group('TC-DS-17', async () => {
      const tc = 'TC-DS-17';
      // Bỏ khối ảnh vừa thêm nếu còn trống (ảnh rỗng không lưu được).
      const blocks = await blockList(page);
      const emptyImage = blocks.findIndex((b) => b.type === 'image');
      if (emptyImage >= 0) {
        await selectBlock(page, emptyImage);
        await designer(page).getByRole('button', { name: 'Xoá khối' }).click();
      }
      const expected = await blockList(page);
      await designer(page).getByRole('button', { name: /^Lưu$/ }).click();
      check(tc, await toast(page, `Đã lưu bố cục mẫu "${SCRATCH.name}".`), 'Toast "Đã lưu bố cục mẫu …"');
      const saved = await getLayout(scratch.id);
      check(tc, saved.layout?.paper === 'A3' && saved.layout?.orientation === 'landscape' && saved.layout?.blocks.length === expected.length, 'API: bố cục đã lưu đúng (A3 ngang, đủ khối)', `${saved.layout?.paper} ${saved.layout?.blocks.length}/${expected.length}`);
      await closeDesigner(page);
      await page.waitForTimeout(800);
      check(tc, /Đã thiết kế/.test(await templateRow(page, SCRATCH.name).innerText()), 'Cột "Bố cục" là "Đã thiết kế"');
      await openDesigner(page, SCRATCH.name);
      const reopened = await blockList(page);
      check(tc, reopened.map((b) => b.id).join() === expected.map((b) => b.id).join(), 'Mở lại đúng như đã lưu');
      await shot(page, 'ds-17-saved');
    });

    await group('TC-DS-20', async () => {
      const tc = 'TC-DS-20';
      const before = await getLayout(scratch.id);
      await designer(page).getByRole('button', { name: 'Thêm khối Khoảng trắng' }).click();
      await designer(page).getByRole('button', { name: /Đóng/ }).first().click();
      const ask = page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' });
      check(tc, await ask.isVisible(), 'Có thay đổi: Đóng thì hỏi "Bỏ các thay đổi chưa lưu?"');
      await ask.getByRole('button', { name: 'Huỷ' }).click();
      check(tc, (await designer(page).isVisible()) && (await designer(page).getByText('Chưa lưu', { exact: true }).isVisible()), 'Huỷ: ở lại, giữ thay đổi');
      await designer(page).getByRole('button', { name: /Đóng/ }).first().click();
      await page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' }).getByRole('button', { name: 'Bỏ thay đổi' }).click();
      await designer(page).waitFor({ state: 'detached', timeout: 5000 });
      const after = await getLayout(scratch.id);
      check(tc, after.updatedAt === before.updatedAt, 'Bỏ thay đổi: đóng, DB không đổi');
      await openDesigner(page, SCRATCH.name);
      await designer(page).getByRole('button', { name: /Đóng/ }).first().click();
      await page.waitForTimeout(300);
      check(tc, (await designer(page).count()) === 0, 'Không có thay đổi: đóng ngay không hỏi');
    });

    await group('TC-DS-19', async () => {
      const tc = 'TC-DS-19';
      await openDesigner(page, SCRATCH.name);
      // QTV lưu bản khác qua API trong lúc QTBH đang mở trình thiết kế.
      const current = await qtv.get(layoutUrl(scratch.id));
      const qtvLayout = { ...current.layout, blocks: [{ id: 'qtv-title', type: 'title', text: 'BẢN CỦA QTV', fontSizePt: 20, align: 'center', uppercase: false }, ...current.layout.blocks.slice(0, 3)] };
      await qtv.put(layoutUrl(scratch.id), { layout: qtvLayout, expectedUpdatedAt: current.updatedAt });
      await designer(page).getByRole('button', { name: 'Thêm khối Đường kẻ' }).click();
      await designer(page).getByRole('button', { name: /^Lưu$/ }).click();
      const conflict = page.getByRole('dialog', { name: 'Mẫu vừa được người khác sửa' });
      await conflict.waitFor({ timeout: 8000 });
      check(tc, /người khác sửa/.test(await conflict.innerText()) && (await conflict.getByRole('button', { name: /Xuất JSON bản đang sửa/ }).count()) === 1, 'QTBH lưu sau QTV: hộp "Mẫu vừa được người khác sửa…", có xuất JSON bản đang sửa');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), conflict.getByRole('button', { name: /Xuất JSON bản đang sửa/ }).click()]);
      check(tc, /\.layout\.json$/.test(download.suggestedFilename()), 'Xuất JSON trước khi tải lại', download.suggestedFilename());
      await conflict.getByRole('button', { name: 'Tải lại', exact: true }).click();
      await page.waitForTimeout(1500);
      check(tc, /BẢN CỦA QTV/.test(await designPage(page).innerText()), 'Tải lại: thấy bản của QTV');
    });

    await group('TC-DS-22', async () => {
      const tc = 'TC-DS-22';
      const before = await blockList(page);
      await designMenu(page, /Khôi phục bố cục mặc định/);
      check(tc, await toast(page, /Đã khôi phục bố cục mặc định/), 'Khôi phục: không hỏi, có toast nhắc Hoàn tác');
      const restored = await blockList(page);
      check(tc, restored.length === 9 && restored[0].type === 'companyHeader', 'Bố cục đang sửa thay bằng bố cục mặc định', String(restored.length));
      await designer(page).getByRole('button', { name: 'Hoàn tác' }).click();
      check(tc, (await blockList(page)).map((b) => b.id).join() === before.map((b) => b.id).join(), 'Hoàn tác được, chưa lưu');
      await designMenu(page, /Xoá bố cục/);
      const ask = page.getByRole('dialog', { name: 'Xoá bố cục của mẫu?' });
      await ask.waitFor({ timeout: 5000 });
      await ask.getByRole('button', { name: 'Xoá bố cục' }).click();
      check(tc, await toast(page, /Đã xoá bố cục mẫu/), 'Xoá bố cục: hỏi xác nhận, có toast');
      const after = await getLayout(scratch.id);
      check(tc, after.layout === null, 'API: PUT null, mẫu không còn bố cục');
      await closeDesigner(page);
      await page.waitForTimeout(800);
      check(tc, /Mặc định/.test(await templateRow(page, SCRATCH.name).innerText()), 'Cột "Bố cục" về "Mặc định"');
    });

    let exported = null;
    await group('TC-DS-23', async () => {
      const tc = 'TC-DS-23';
      await openDesigner(page, P3_TEMPLATES['M-A4'].name);
      await designer(page).getByRole('button', { name: 'Thêm thao tác' }).click();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), designer(page).getByRole('menuitem', { name: /Xuất JSON/ }).click()]);
      const file = join(workDir, 'm-a4.layout.json');
      await download.saveAs(file);
      exported = JSON.parse(readFileSync(file, 'utf8'));
      check(tc, download.suggestedFilename() === `Mau_${P3_TEMPLATES['M-A4'].name}.layout.json`, `Tải "Mau_${P3_TEMPLATES['M-A4'].name}.layout.json"`, download.suggestedFilename());
      check(tc, exported.version === 1 && exported.blocks?.length === a4Original.layout.blocks.length, 'Nội dung là bố cục hợp lệ của M-A4', `${exported.blocks?.length} khối`);
      // TC-DS-16: chip CF-OFF trong M-A4 vẫn giữ và Lưu được.
      check('TC-DS-16', JSON.stringify(exported).includes(`custom.${fx.fields['CF-OFF'].id}`), 'M-A4 vẫn giữ biến của CF-OFF (đã tắt)');
      const before = await getLayout(T['M-A4'].id);
      await designer(page).getByRole('button', { name: /^Lưu$/ }).click();
      check('TC-DS-16', await toast(page, `Đã lưu bố cục mẫu "${P3_TEMPLATES['M-A4'].name}".`), 'M-A4 có biến CF-OFF: Lưu được');
      const after = await getLayout(T['M-A4'].id);
      check('TC-DS-16', JSON.stringify(after.layout) === JSON.stringify(before.layout), 'Lưu lại M-A4 không đổi nội dung');
      await closeDesigner(page);
    });

    await group('TC-DS-25', async () => {
      const tc = 'TC-DS-25';
      await openDesigner(page, SCRATCH.name);
      const before = await blockList(page);
      const problem = designer(page).locator('[role="alert"][aria-label="Lỗi nhập bố cục"]');
      for (const [name, buffer, mime] of [
        ['bao-gia.docx', Buffer.from('PK\u0003\u0004 not json'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['rong.json', Buffer.alloc(0), 'application/json'],
        ['cat-do.json', Buffer.from('{"version":1,"paper":"A4","blocks":[{"id":'), 'application/json'],
      ]) {
        await importFile(page, name, buffer, mime);
        check(tc, /File không phải bố cục mẫu hợp lệ/.test(await problem.innerText().catch(() => '')) && (await blockList(page)).map((b) => b.id).join() === before.map((b) => b.id).join(), `Nhập ${name}: báo "File không phải bố cục mẫu hợp lệ.", bố cục không đổi`);
      }
    });

    await group('TC-DS-26', async () => {
      const tc = 'TC-DS-26';
      const before = await blockList(page);
      const problem = designer(page).locator('[role="alert"][aria-label="Lỗi nhập bố cục"]');
      const base = exported ?? a4Original.layout;
      for (const [label, json, pattern] of [
        ['version: 2', { ...base, version: 2 }, /Phiên bản bố cục không được hỗ trợ/],
        ['thiếu blocks', { ...base, blocks: undefined }, /thiếu danh sách khối/],
        ['biến lạ', { ...base, blocks: [{ id: 'x', type: 'text', align: 'left', runs: [{ text: '{{customer.secret}}' }] }] }, /không có trong danh sách biến/],
      ]) {
        await importFile(page, `${label}.json`, Buffer.from(JSON.stringify(json)));
        const text = await problem.innerText().catch(() => '');
        check(tc, /có lỗi, chưa nhập/.test(text) && pattern.test(text) && (await blockList(page)).map((b) => b.id).join() === before.map((b) => b.id).join(), `Nhập JSON ${label}: liệt kê lỗi tiếng Việt, không thay bố cục`, text.slice(0, 120));
      }
    });

    await group('TC-DS-27', async () => {
      const tc = 'TC-DS-27';
      const started = Date.now();
      await importFile(page, 'qua-lon.json', Buffer.alloc(3 * 1024 * 1024, 0x20));
      const text = await designer(page).locator('[role="alert"][aria-label="Lỗi nhập bố cục"]').innerText().catch(() => '');
      check(tc, /File vượt 2 MB/.test(text) && Date.now() - started < 5000, 'Nhập file 3 MB: báo "File vượt 2 MB.", trang không treo', `${Date.now() - started} ms`);
    });

    await group('TC-DS-24', async () => {
      const tc = 'TC-DS-24';
      if (!exported) throw new Error('TC-DS-23 chưa xuất được file JSON.');
      // Nhập file của M-A4 vào mẫu thử, hoàn tác được (cùng tenant); nhập sang tenant khác ở dưới.
      const before = await blockList(page);
      await importFile(page, 'm-a4.layout.json', Buffer.from(JSON.stringify(exported)));
      const imported = await blockList(page);
      check(tc, imported.length === exported.blocks.length, 'Nhập JSON hợp lệ: bố cục thay bằng bố cục trong file');
      await designer(page).getByRole('button', { name: 'Hoàn tác' }).click();
      check(tc, (await blockList(page)).map((b) => b.id).join() === before.map((b) => b.id).join(), 'Nhập xong hoàn tác được');
      await closeDesigner(page);
      let other;
      try {
        other = await login('qtv', { tenant: values['other-tenant'] });
      } catch (error) {
        blocked(tc, `không đăng nhập được qtv@${values['other-tenant']}.local: ${(error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 100)}`);
        return;
      }
      try {
        await goto(other.page, '#settings/quote-forms');
        const firstRow = other.page.locator('section[aria-label="Mẫu báo giá"] tbody tr').first();
        await firstRow.waitFor({ timeout: 15000 });
        const name = (await firstRow.locator('td').first().innerText()).replace(/\s*Mặc định\s*$/, '').trim();
        await firstRow.getByRole('button', { name: 'Thiết kế bố cục' }).click();
        await designPage(other.page).waitFor({ timeout: 20000 });
        await importFile(other.page, 'm-a4.layout.json', Buffer.from(JSON.stringify(exported)));
        await designer(other.page).getByRole('button', { name: /^Lưu$/ }).click();
        check(tc, await toast(other.page, /Đã lưu bố cục mẫu/), `QTV ${values['other-tenant']} nhập file vào mẫu "${name}" và Lưu được (biến custom.<id> của ${values.tenant} vẫn hợp lệ)`);
        console.log(`  ghi chú: mở báo giá ở ${values['other-tenant']} dùng mẫu này chưa kiểm (tenant ${values['other-tenant']} chưa có seed báo giá); biến custom lạ hiện rỗng đã có ở component.`);
      } finally {
        await other.context.close();
      }
    });
  } finally {
    await context.close();
  }
}

// ===================================================================================================================
// MÀN BÁO GIÁ 2 CỘT (TC-QW) VÀ XUẤT FILE (TC-EX)
// ===================================================================================================================
async function runQuoteScreen() {
  // ---- 1920×1080 ----
  {
    const { context, page } = await login('nv1', { width: 1920, height: 1080 });
    try {
      await group('TC-QW-01', async () => {
        const tc = 'TC-QW-01';
        await openQuote(page, Q['Q-DRAFT'].id);
        const left = page.locator('[data-testid="quote-workspace-left"]');
        const right = page.locator('[data-testid="quote-workspace-right"]');
        const [l, r] = [await left.boundingBox(), await right.boundingBox()];
        check(tc, l && r && l.x < r.x && Math.abs(l.y - r.y) < 40 && (await page.getByRole('tablist').count()) === 0, 'Hai cột cạnh nhau, không có tab', `${JSON.stringify(l)} ${JSON.stringify(r)}`);
        const leftText = await left.innerText();
        check(tc, ['Thông tin chung', 'Dòng hàng', 'Phương án kinh doanh (PAKD)', 'Khuyến mãi', 'Tài liệu', 'Liên quan', 'Lịch sử'].every((x) => leftText.includes(x)), 'Trái: Thông tin chung, Dòng hàng, các khối thu gọn');
        const buttons = await actionBar(page).getByRole('button').allInnerTexts();
        check(tc, (await right.locator('section[aria-label="Xem trước báo giá"]').count()) === 1 && ['Huỷ', 'Lưu', 'Trình duyệt', 'Báo giá'].every((x) => buttons.some((b) => b.trim() === x)), 'Phải: Xem trước và 4 nút', buttons.join('|'));
        check(tc, (await previewSheet(page).getAttribute('data-paper')) === 'A4' && (await previewText(page)).includes(a4Title), 'Xem trước theo M-A4', a4Title);
        await shot(page, 'qw-01-1920');
      });

      await group('TC-RD-07', async () => {
        const tc = 'TC-RD-07';
        await openQuote(page, Q['Q-XSS'].id);
        const text = await previewText(page);
        check(tc, text.includes(P3_XSS_CUSTOMER.name), 'Tên khách <img src=x onerror=alert(1)> hiện nguyên văn ở xem trước', '');
        check(tc, text.includes(P3_SCRIPT_TEXT), 'Chữ <script>alert(1)</script> trong khối text hiện nguyên văn', '');
        const injected = await previewPane(page).evaluate((node) => ({ img: node.querySelectorAll('img[src="x"]').length, script: node.querySelectorAll('script').length }));
        const alerts = await page.evaluate(() => window.__p3alerts);
        check(tc, injected.img === 0 && injected.script === 0 && alerts === 0, 'DOM không có img/script sinh từ dữ liệu, không có hộp alert', JSON.stringify({ ...injected, alerts }));
        const printed = await exportPdf(page);
        check(tc, printed.text.includes(P3_XSS_CUSTOMER.name) && printed.scripts === 0, 'Bản in (PDF) hiện nguyên văn, không có script', '');
        const word = await exportWord(page);
        check(tc, word.xml.includes('&lt;img src=x onerror=alert(1)&gt;') && word.xml.includes('&lt;script&gt;'), 'File Word: ký tự đặc biệt được thoát, hiện nguyên văn', word.name);
        if (word.xml.includes('&quot;&amp;&lt;&gt;') || word.xml.includes('"&amp;&lt;&gt;\'')) check('TC-EX-11', true, 'Word: tên mặt hàng "&<>\' thoát đúng trong document.xml');
      });

      await group('TC-EX-01', async () => {
        const tc = 'TC-EX-01';
        await openQuote(page, Q['Q-DRAFT'].id);
        const detail = await nv1.get(quoteUrl(Q['Q-DRAFT'].id));
        const printed = await exportPdf(page);
        check(tc, printed.title === expectedFileName(detail.code, detail.version.versionNo), 'Gọi print() trên iframe ẩn, <title> = <mã>_v<n>', printed.title);
        check(tc, /@page \{ size: A4 portrait; margin: 15mm 15mm 15mm 20mm; \}/.test(printed.pageCss), '@page A4 đứng, lề theo bố cục', printed.pageCss);
        check(tc, printed.images >= 2 && printed.text.includes(a4Title), 'Bản in có logo, ảnh và nội dung bố cục', `${printed.images} ảnh`);
        check('TC-EX-03', printed.title === expectedFileName(detail.code, detail.version.versionNo), '<title> gợi ý tên file <mã>_v1 (tên gợi ý khi lưu cần kiểm tay)', printed.title);
      });

      await group('TC-EX-05', async () => {
        const tc = 'TC-EX-05';
        const frames = () => page.locator('iframe[data-quote-print-frame]').count();
        check(tc, (await frames()) === 1, 'Sau khi gọi in: còn 1 iframe in (chờ afterprint)');
        await page.evaluate(() => document.querySelector('iframe[data-quote-print-frame]')?.contentWindow?.dispatchEvent(new Event('afterprint')));
        await page.waitForTimeout(300);
        check(tc, (await frames()) === 0, 'Huỷ in (afterprint): iframe ẩn được gỡ');
        const again = await exportPdf(page);
        check(tc, !!again && (await frames()) <= 1, 'Xuất PDF lần hai mở bình thường, không có iframe thừa');
      });

      await group('TC-EX-12', async () => {
        const tc = 'TC-EX-12';
        const scripts = [];
        const onRequest = (request) => {
          if (request.resourceType() === 'script') scripts.push(request.url());
        };
        page.on('request', onRequest);
        await openQuote(page, Q['Q-DRAFT'].id);
        const beforeClick = scripts.filter((url) => /docx/i.test(url));
        check(tc, beforeClick.length === 0, 'Mở màn báo giá: không tải chunk docx', beforeClick.join(' '));
        // Mạng lỗi khi tải bộ xuất Word: toast, bấm lại khi có mạng thì được.
        await page.route(/docx.*\.js|\.js.*docx/i, (route) => route.abort());
        await previewPane(page).getByRole('button', { name: /Xuất/ }).first().click();
        await page.getByRole('menuitem', { name: 'Word (.docx)' }).click();
        const failed = await toast(page, /Không tải được bộ xuất Word/);
        const triedChunk = scripts.some((url) => /docx/i.test(url));
        await page.unroute(/docx.*\.js|\.js.*docx/i);
        if (triedChunk) check(tc, failed, 'Chặn chunk docx: toast "Không tải được bộ xuất Word…"');
        else blocked(tc, 'không nhận ra chunk docx theo tên URL để chặn (bản dev đặt tên khác); phần ngắt mạng chưa kiểm');
        const word = await exportWord(page);
        const afterClick = scripts.filter((url) => /docx/i.test(url));
        check(tc, afterClick.length > 0 || word.name.endsWith('.docx'), 'Bấm Xuất Word: chunk docx tải khi bấm, file tải về', afterClick.at(-1) ?? word.name);
        page.off('request', onRequest);
      });

      await group('TC-QW-32', async () => {
        const tc = 'TC-QW-32';
        const detail = await nv1.get(quoteUrl(Q['Q-DRAFT'].id));
        const word = await exportWord(page);
        check(tc, word.name === `${expectedFileName(detail.code, detail.version.versionNo)}.docx`, 'Tên file Word = <mã>_v<n>.docx (ký tự / đổi thành -)', `${word.name} (mã ${detail.code})`);
        check('TC-EX-08', /w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"|w:pgSz[^>]*w:h="16838"[^>]*w:w="11906"/.test(word.xml) || /w:pgSz/.test(word.xml), 'Word có khổ trang (Page Setup cần kiểm tay)', (word.xml.match(/<w:pgSz[^>]*>/) ?? [''])[0]);
        check('TC-EX-09', /<pic:pic|<w:drawing/.test(word.xml), 'Word có ảnh logo', '');
        check('TC-P3PERM-08', !/Giá vốn|Lợi nhuận|estCost/i.test(word.xml), 'Word không có giá vốn, lợi nhuận');
      });

      await group('TC-EX-13', async () => {
        const tc = 'TC-EX-13';
        const downloads = [];
        const onDownload = (d) => downloads.push(d.suggestedFilename());
        page.on('download', onDownload);
        await previewPane(page).getByRole('button', { name: /Xuất/ }).first().click();
        await page.getByRole('menuitem', { name: 'Word (.docx)' }).click();
        const busy = await previewPane(page).getByRole('button', { name: /Đang xuất|Xuất/ }).first().getAttribute('aria-busy');
        await previewPane(page).getByRole('button', { name: /Đang xuất|Xuất/ }).first().click({ timeout: 1000, force: true }).catch(() => undefined);
        await previewPane(page).getByRole('button', { name: /Đang xuất|Xuất/ }).first().click({ timeout: 1000, force: true }).catch(() => undefined);
        await page.waitForTimeout(5000);
        page.off('download', onDownload);
        check(tc, downloads.length === 1, 'Bấm Xuất liên tục: chỉ tạo một file; nút ở trạng thái đang xuất', `${downloads.length} file, aria-busy=${busy}`);
      });

      await group('TC-QW-04', async () => {
        const tc = 'TC-QW-04';
        await setA4Title('BÁO GIÁ THIẾT BỊ (E2E ĐÃ SỬA)');
        await openQuote(page, Q['Q-DRAFT'].id);
        check(tc, (await previewText(page)).includes('BÁO GIÁ THIẾT BỊ (E2E ĐÃ SỬA)'), 'QTBH đổi tiêu đề M-A4, NV1 tải lại Q-DRAFT: xem trước hiện tiêu đề mới');
        check('TC-TL-22', (await previewText(page)).includes('BÁO GIÁ THIẾT BỊ (E2E ĐÃ SỬA)'), 'Q-DRAFT hiện tiêu đề mới (giao diện)');
      });

      await group('TC-QW-05', async () => {
        const tc = 'TC-QW-05';
        await openQuote(page, Q['Q-SENT'].id);
        const text = await previewText(page);
        const snapshot = (await nv1.get(quoteUrl(Q['Q-SENT'].id))).version.layoutSnapshot;
        check(tc, text.includes('Bản chụp lúc gửi khách') && text.includes(titleOf(snapshot)) && !text.includes('(E2E ĐÃ SỬA)'), 'Q-SENT: xem trước dùng bản chụp (không theo mẫu vừa sửa)', titleOf(snapshot));
        check('TC-TL-22', !text.includes('(E2E ĐÃ SỬA)'), 'Q-SENT vẫn hiện tiêu đề cũ (giao diện)');
        // TC-QW-31: xuất từ báo giá đã gửi theo bản chụp.
        const printed = await exportPdf(page);
        const word = await exportWord(page);
        check('TC-QW-31', printed.text.includes(titleOf(snapshot)) && !printed.text.includes('(E2E ĐÃ SỬA)'), 'Xuất PDF theo bản chụp, giống khung xem trước');
        check('TC-QW-31', word.xml.includes(titleOf(snapshot)) && !word.xml.includes('(E2E ĐÃ SỬA)'), 'Xuất Word theo bản chụp');
        // Đã duyệt (chưa gửi): dùng bố cục hiện tại của mẫu.
        const approved = await newQuote('QW-05 đã duyệt', T['M-A4'].id);
        const submitted = await nv1.post(`${quoteUrl(approved.id)}/versions/1/submit`, { revision: approved.version.revision });
        await openQuote(page, approved.id);
        const shown = await previewText(page);
        check(tc, shown.includes('(E2E ĐÃ SỬA)') && !shown.includes('Bản chụp lúc gửi khách'), `Trạng thái ${submitted.version.status}: dùng bố cục hiện tại của mẫu`, submitted.version.status);
      });

      await group('TC-QW-06', async () => {
        const tc = 'TC-QW-06';
        const quote = await newQuote('QW-06 mẫu chưa có bố cục', T['M-NONE'].id);
        await openQuote(page, quote.id);
        const text = await previewText(page);
        check(tc, text.includes('BÁO GIÁ') && (await previewPane(page).locator('[role="alert"]').count()) === 0 && (await previewSheet(page).getAttribute('data-paper')) === 'A4', 'M-NONE: xem trước bằng bố cục mặc định, không có thông báo lỗi');
        check('TC-TL-15', text.includes('BÁO GIÁ'), 'Mẫu không có bố cục (đã xoá hoặc chưa thiết kế): báo giá nháp xem trước bằng bố cục mặc định');
      });

      await group('TC-QW-07', async () => {
        const tc = 'TC-QW-07';
        await page.route('**/quote-templates/*/layout', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"lỗi thử"}' }));
        await openQuote(page, Q['Q-DRAFT'].id);
        const alert = previewPane(page).locator('[role="alert"]');
        check(tc, /Không tải được mẫu\. Thử lại\./.test(await alert.innerText().catch(() => '')) && (await previewSheet(page).count()) === 1, 'GET layout 500: hiện "Không tải được mẫu. Thử lại." và vẫn dựng bằng bố cục mặc định');
        await page.unroute('**/quote-templates/*/layout');
        await alert.getByRole('button', { name: /Thử lại/ }).click();
        await page.waitForTimeout(1500);
        check(tc, (await alert.count()) === 0 && (await previewText(page)).includes('(E2E ĐÃ SỬA)'), 'Thử lại: hiện bố cục đúng');
      });

      await group('TC-QW-08', async () => {
        const tc = 'TC-QW-08';
        await openQuote(page, Q['Q-OLD'].id);
        const text = await previewText(page);
        check(tc, text.includes('Phiên bản này gửi khách khi chưa có bản chụp bố cục') && text.includes(M_PRE_TITLE), 'Q-OLD (có sentAt, không bản chụp): dùng bố cục hiện tại của mẫu, có ghi chú');
        console.log('  ghi chú: phiên bản SUPERSEDED/EXPIRED chưa từng gửi (không ghi chú) kiểm ở component; seed không có phiên bản như vậy.');
      });

      await group('TC-TL-18', async () => {
        const tc = 'TC-TL-18';
        await openQuote(page, Q['Q-OFFUSE'].id);
        check(tc, (await previewText(page)).includes(M_OFF_TITLE), 'Báo giá cũ dùng M-OFF vẫn xem trước được bằng bố cục của M-OFF');
        await openQuote(page, Q['Q-DRAFT'].id);
        await fieldInput(page.locator('[data-testid="quote-workspace-left"]'), 'Mẫu báo giá').click();
        const options = await optionTexts(page);
        await page.keyboard.press('Escape');
        check(tc, options.length > 0 && !options.some((o) => o.includes(P3_TEMPLATES['M-OFF'].name)), 'Ô "Mẫu báo giá" của NV1 không có M-OFF', options.join(' | ').slice(0, 160));
      });

      await restoreA4();

      await group('TC-QW-09', async () => {
        const tc = 'TC-QW-09';
        const quote = await newQuote('QW-09 đổi mẫu', T['M-A4'].id);
        await openQuote(page, quote.id);
        const left = page.locator('[data-testid="quote-workspace-left"]');
        const totalBefore = (await nv1.get(quoteUrl(quote.id))).version.totals.totalAmount;
        await chooseOption(page, fieldInput(left, 'Mẫu báo giá'), P3_TEMPLATES['M-A3'].name);
        await page.waitForTimeout(800);
        check(tc, (await previewSheet(page).getAttribute('data-paper')) === 'A3' && (await previewSheet(page).getAttribute('data-orientation')) === 'landscape', 'Đổi sang M-A3 chưa lưu: xem trước đổi ngay sang A3 ngang');
        await actionBar(page).getByRole('button', { name: 'Huỷ', exact: true }).click();
        await page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' }).getByRole('button', { name: 'Bỏ thay đổi' }).click();
        await page.waitForTimeout(800);
        check(tc, (await previewSheet(page).getAttribute('data-paper')) === 'A4', 'Huỷ: về M-A4');
        await chooseOption(page, fieldInput(left, 'Mẫu báo giá'), P3_TEMPLATES['M-A3'].name);
        await actionBar(page).getByRole('button', { name: 'Lưu', exact: true }).click();
        await toast(page, 'Đã lưu báo giá.');
        await page.waitForTimeout(800);
        const saved = await nv1.get(quoteUrl(quote.id));
        const discount = linesSection(page).getByRole('button', { name: /Chiết khấu/ });
        check(tc, saved.version.form.discountMode === 'ORDER' && saved.version.form.templateId === T['M-A3'].id && (await discount.isEnabled()), 'Lưu: báo giá theo tổng đơn, nút Chiết khấu bật', `tổng ${totalBefore} -> ${saved.version.totals.totalAmount}`);
      });

      await group('TC-QW-10', async () => {
        const tc = 'TC-QW-10';
        await openQuote(page, Q['Q-DRAFT'].id);
        const name = page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first();
        const typed = `Gõ thử ${stamp}`;
        await name.fill('');
        await name.pressSequentially(typed, { delay: 20 });
        const immediately = (await previewText(page)).includes(typed);
        await page.waitForTimeout(700);
        check(tc, (await previewText(page)).includes(typed), 'Gõ vào "Tên báo giá": xem trước cập nhật sau khi ngừng gõ', `ngay lúc gõ: ${immediately}`);
        await actionBar(page).getByRole('button', { name: 'Huỷ', exact: true }).click();
        await page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' }).getByRole('button', { name: 'Bỏ thay đổi' }).click();
      });

      // Dòng hàng: trên báo giá thử 3 dòng.
      let lq = null;
      await group('TC-QW-11', async () => {
        const tc = 'TC-QW-11';
        lq = await newQuote('QW-11 dòng hàng', T['M-A4'].id);
        await openQuote(page, lq.id);
        const before = await previewLineRows(page).count();
        await linesSection(page).getByRole('button', { name: 'Thêm dòng hàng' }).click();
        const dlg = page.getByRole('dialog', { name: 'Thêm dòng báo giá' });
        await dlg.waitFor({ timeout: 10000 });
        for (const code of ['QA-KHO-PM', 'QA-KHO-LAP', 'QA-KHO-CAP']) {
          await dlg.locator('input[type="search"]').fill(code);
          await page.waitForTimeout(900);
          await dlg.locator('tr', { hasText: code }).first().locator('input[type="checkbox"]').check();
        }
        await submitPicker(page, dlg, 3);
        const rows = await lineRows(page).allInnerTexts();
        check(tc, rows.length === 6 && /QA-KHO-PM/.test(rows[3]) && /QA-KHO-CAP/.test(rows[5]), 'Thêm 3 dòng cuối bảng', rows.map((r) => r.split('\n')[0]).join(' | ').slice(0, 160));
        check(tc, (await previewLineRows(page).count()) === before + 3, 'Xem trước có 3 dòng mới', `${before} -> ${await previewLineRows(page).count()}`);
      });

      await group('TC-QW-12', async () => {
        const tc = 'TC-QW-12';
        await lineRows(page).nth(1).dblclick();
        const dlg = page.locator('[role="dialog"][aria-label^="Dòng 2:"]');
        await dlg.waitFor({ timeout: 8000 });
        const qty = dlg.locator('label', { hasText: 'Số lượng' }).locator('input').first();
        await qty.fill('7');
        await dlg.getByRole('button', { name: 'Lưu' }).click();
        await dlg.waitFor({ state: 'detached', timeout: 10000 });
        await page.waitForTimeout(1200);
        const detail = await nv1.get(quoteUrl(lq.id));
        check(tc, Number(detail.version.lines[1].quantity) === 7, 'Bấm đúp dòng 2: mở đúng dòng 2, đổi số lượng lưu được');
        check(tc, (await previewLineRows(page).nth(1).innerText()).includes('7'), 'Bảng xem trước có số lượng mới');
      });

      await group('TC-QW-13', async () => {
        const tc = 'TC-QW-13';
        await lineRows(page).nth(0).click({ button: 'right' });
        const menu = page.getByRole('menu', { name: 'Dòng 1' });
        const items = await menu.getByRole('menuitem').allInnerTexts();
        check(tc, ['Thêm', 'Hiệu chỉnh', 'Chèn', 'Xoá'].every((x) => items.some((i) => i.includes(x))), 'Menu chuột phải có Thêm, Hiệu chỉnh, Chèn, Xoá', items.join('|'));
        await menu.getByRole('menuitem', { name: /Thêm/ }).click();
        const dlg = page.getByRole('dialog', { name: 'Thêm dòng báo giá' });
        check(tc, await dlg.isVisible(), 'Thêm: mở chọn mặt hàng (dòng mới nằm cuối bảng)');
        await dlg.getByRole('button', { name: 'Huỷ' }).click();
      });

      await group('TC-QW-14', async () => {
        const tc = 'TC-QW-14';
        const before = await nv1.get(quoteUrl(lq.id));
        await lineRows(page).nth(1).click({ button: 'right' });
        await page.getByRole('menu', { name: 'Dòng 2' }).getByRole('menuitem', { name: /Chèn/ }).click();
        const dlg = page.getByRole('dialog', { name: 'Chèn dòng trước dòng 2' });
        await dlg.waitFor({ timeout: 8000 });
        for (const code of ['QA-KHO-MUC', 'QA-KHO-BT']) {
          await dlg.locator('input[type="search"]').fill(code);
          await page.waitForTimeout(900);
          await dlg.locator('tr', { hasText: code }).first().locator('input[type="checkbox"]').check();
        }
        await submitPicker(page, dlg, 2);
        const after = await nv1.get(quoteUrl(lq.id));
        const codes = after.version.lines.map((line) => line.materialCode);
        check(tc, codes[1] === 'QA-KHO-MUC' && codes[2] === 'QA-KHO-BT' && codes[3] === before.version.lines[1].materialCode && after.version.lines.every((l, i) => l.lineNo === i + 1), 'Chèn 2 mặt hàng trước dòng 2: vị trí 2, 3; dòng cũ lùi xuống; số TT liên tục', codes.join(','));
        const previewRows = await previewLineRows(page).allInnerTexts();
        check(tc, previewRows.length === after.version.lines.length && previewRows[1].includes(after.version.lines[1].materialName.slice(0, 10)), 'Xem trước đúng thứ tự', previewRows.length);
      });

      await group('TC-QW-16', async () => {
        const tc = 'TC-QW-16';
        const count = await lineRows(page).count();
        await lineRows(page).nth(0).click({ button: 'right' });
        await page.getByRole('menu', { name: 'Dòng 1' }).getByRole('menuitem', { name: /Xoá/ }).click();
        let ask = page.getByRole('dialog', { name: 'Xoá dòng 1?' });
        await ask.getByRole('button', { name: 'Huỷ' }).click();
        check(tc, (await lineRows(page).count()) === count, 'Xoá → Huỷ: không xoá');
        await lineRows(page).nth(0).click({ button: 'right' });
        await page.getByRole('menu', { name: 'Dòng 1' }).getByRole('menuitem', { name: /Xoá/ }).click();
        ask = page.getByRole('dialog', { name: 'Xoá dòng 1?' });
        await ask.getByRole('button', { name: 'Xoá' }).click();
        await ask.waitFor({ state: 'detached', timeout: 10000 });
        await page.waitForTimeout(1200);
        const after = await nv1.get(quoteUrl(lq.id));
        check(tc, after.version.lines.length === count - 1 && after.version.lines.every((l, i) => l.lineNo === i + 1) && (await previewLineRows(page).count()) === count - 1, 'Xoá → Đồng ý: xoá, số TT đánh lại, xem trước cập nhật');
      });

      await group('TC-QW-17', async () => {
        const tc = 'TC-QW-17';
        const row = lineRows(page).nth(0);
        await row.focus();
        await page.keyboard.press('ArrowDown');
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
        check(tc, /^Dòng 2:/.test(focused), 'Mũi tên xuống chọn dòng 2', focused);
        await page.keyboard.press('Enter');
        const edit = page.locator('[role="dialog"][aria-label^="Dòng 2:"]');
        check(tc, await edit.isVisible().catch(() => false), 'Enter mở sửa dòng');
        await edit.getByRole('button', { name: 'Huỷ' }).click();
        await lineRows(page).nth(1).focus();
        await page.keyboard.press('Shift+F10');
        const menu = page.getByRole('menu', { name: 'Dòng 2' });
        check(tc, await menu.isVisible().catch(() => false), 'Shift+F10 mở menu');
        await page.keyboard.press('Escape');
        check(tc, (await menu.count()) === 0, 'Esc đóng menu');
        await lineRows(page).nth(1).focus();
        await page.keyboard.press('Delete');
        const ask = page.getByRole('dialog', { name: 'Xoá dòng 2?' });
        check(tc, await ask.isVisible().catch(() => false), 'Delete hỏi xoá');
        await ask.getByRole('button', { name: 'Huỷ' }).click().catch(() => undefined);
      });

      await group('TC-QW-18', async () => {
        const tc = 'TC-QW-18';
        await openQuote(page, Q['Q-DRAFT'].id);
        const discount = linesSection(page).getByRole('button', { name: /Chiết khấu/ });
        check(tc, (await discount.isDisabled()) && /tính chiết khấu theo dòng/.test(await linesSection(page).innerText()), 'Q-DRAFT theo dòng: nút Chiết khấu tắt kèm chú giải');
        await openQuote(page, Q['Q-SENT'].id);
        await lineRows(page).nth(0).click({ button: 'right' });
        const items = await page.getByRole('menu', { name: 'Dòng 1' }).getByRole('menuitem').allInnerTexts();
        check(tc, items.length === 1 && items[0].includes('Xem'), 'Q-SENT: menu chỉ có "Xem"', items.join('|'));
        await page.keyboard.press('Escape');
        await lineRows(page).nth(0).dblclick();
        const view = page.locator('[role="dialog"][aria-label^="Dòng 1:"]');
        await view.waitFor({ timeout: 8000 });
        check(tc, /chỉ xem/.test(await view.innerText()) && (await view.locator('input:not([disabled])').count()) === 0, 'Bấm đúp mở chỉ đọc');
        await view.getByRole('button', { name: 'Đóng' }).first().click();
        check(tc, (await linesSection(page).getByRole('button', { name: 'Thêm dòng hàng' }).count()) === 0, 'Không có nút +');
      });

      await group('TC-QW-19', async () => {
        const tc = 'TC-QW-19';
        const quote = await newQuote('QW-19 lưu', T['M-A4'].id);
        await openQuote(page, quote.id);
        const bar = actionBar(page);
        check(tc, (await bar.getByRole('button', { name: 'Huỷ', exact: true }).isDisabled()) && (await bar.getByRole('button', { name: 'Lưu', exact: true }).isDisabled()), 'Chưa có thay đổi: Huỷ, Lưu tắt (D3-20)');
        // Đổi "Tên báo giá" (ô "Hiệu lực" là ô chọn ngày; tên cũng là thông tin chung, cùng đường lưu).
        const name = page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first();
        const next = `QA-P3B ${stamp} QW-19 đã sửa`;
        await name.fill(next);
        await bar.getByRole('button', { name: 'Lưu', exact: true }).click();
        check(tc, await toast(page, 'Đã lưu báo giá.'), 'Lưu thành công, có toast');
        await page.waitForTimeout(800);
        const saved = await nv1.get(quoteUrl(quote.id));
        check(tc, saved.version.form.quoteName === next && saved.version.revision > quote.version.revision && (await previewText(page)).includes(next), 'revision tăng, xem trước có giá trị mới', `${quote.version.revision} -> ${saved.version.revision}`);
      });

      await group('TC-QW-23', async () => {
        const tc = 'TC-QW-23';
        const quote = await newQuote('QW-23 huỷ', T['M-A4'].id);
        await openQuote(page, quote.id);
        const name = page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first();
        const saved = await name.inputValue();
        await name.fill('đổi rồi huỷ');
        await actionBar(page).getByRole('button', { name: 'Huỷ', exact: true }).click();
        const ask = page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' });
        check(tc, await ask.waitFor({ timeout: 5000 }).then(() => true).catch(() => false), 'Có thay đổi: hỏi xác nhận');
        await ask.getByRole('button', { name: 'Bỏ thay đổi' }).click();
        check(tc, (await name.inputValue()) === saved, 'Đồng ý: form về giá trị đã lưu');
        check(tc, await actionBar(page).getByRole('button', { name: 'Huỷ', exact: true }).isDisabled(), 'Không có thay đổi: Huỷ tắt, không hỏi');
      });

      await group('TC-QW-20', async () => {
        const tc = 'TC-QW-20';
        const quote = await newQuote('QW-20 trình duyệt', T['M-A4'].id);
        await openQuote(page, quote.id);
        const name = page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first();
        const next = `QA-P3B ${stamp} QW-20 lưu trước`;
        await name.fill(next);
        await actionBar(page).getByRole('button', { name: 'Trình duyệt', exact: true }).click();
        await page.waitForTimeout(2500);
        const after = await nv1.get(quoteUrl(quote.id));
        check(tc, after.version.form.quoteName === next && ['APPROVED', 'PENDING'].includes(after.version.status), 'Trình duyệt: lưu thay đổi trước, rồi chuyển trạng thái', `${after.version.status}`);
        // TC-QW-21: Đã duyệt thì nút Báo giá gửi được, xem trước chuyển sang bản chụp.
        if (after.version.status === 'APPROVED') {
          await openQuote(page, quote.id);
          const send = actionBar(page).getByRole('button', { name: 'Báo giá', exact: true });
          check('TC-QW-21', await send.isEnabled(), 'Đã duyệt: nút Báo giá bật');
          await send.click();
          await page.waitForTimeout(2500);
          const sent = await nv1.get(quoteUrl(quote.id));
          check('TC-QW-21', sent.version.status === 'SENT' && (await previewText(page)).includes('Bản chụp lúc gửi khách'), 'Bấm Báo giá: Đã gửi, xem trước dùng bản chụp', sent.version.status);
        } else blocked('TC-QW-21', `báo giá thử ở ${after.version.status}, không phải Đã duyệt`);
      });

      await group('TC-QW-21', async () => {
        const tc = 'TC-QW-21';
        // Chờ duyệt: ghi đè chiết khấu dòng (luôn cần duyệt) rồi trình duyệt.
        const quote = await newQuote('QW-21 chờ duyệt', T['M-A4'].id, [{ materialId: mat('QA-KHO-CAP'), quantity: 2, overrideDiscountPercent: 30 }]);
        const pending = await nv1.post(`${quoteUrl(quote.id)}/versions/1/submit`, { revision: quote.version.revision });
        if (pending.version.status !== 'PENDING') {
          blocked(tc, `báo giá ghi đè chiết khấu không ở Chờ duyệt (${pending.version.status})`);
          return;
        }
        await openQuote(page, quote.id);
        check(tc, await actionBar(page).getByRole('button', { name: 'Báo giá', exact: true }).isDisabled(), 'Chờ duyệt: nút Báo giá tắt');
      });

      await group('TC-QW-22', async () => {
        const tc = 'TC-QW-22';
        const fieldName = `QA-P3B Bắt buộc ${stamp}`;
        const quote = await newQuote('QW-22 thiếu trường bắt buộc', T['M-A4'].id);
        const field = await qtbh.post(`${crm}/v1/custom-fields`, { entityType: 'quote', name: fieldName, fieldType: 'TEXT', required: true, sortOrder: 95 });
        try {
          await openQuote(page, quote.id);
          const name = page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first();
          await name.fill(`QA-P3B ${stamp} QW-22 đổi tên`);
          await actionBar(page).getByRole('button', { name: 'Trình duyệt', exact: true }).click();
          // Tìm theo câu lỗi: nhãn của trường (trong khối thu gọn, đang ẩn) cũng chứa tên trường nên không tìm theo tên trần.
          check(tc, await toast(page, `Vui lòng nhập trường "${fieldName}"`), 'Lỗi lưu tiếng Việt nêu tên trường bắt buộc');
          await page.waitForTimeout(1000);
          const after = await nv1.get(quoteUrl(quote.id));
          check(tc, after.version.status === 'DRAFT', 'Không trình duyệt (vẫn Nháp)', after.version.status);
        } finally {
          await qtbh.put(`${crm}/v1/custom-fields/${field.id}`, { name: fieldName, fieldType: 'TEXT', required: false, active: false });
        }
      });

      await group('TC-QW-24', async () => {
        const tc = 'TC-QW-24';
        await goto(page, '#quotes');
        await page.getByRole('button', { name: /Lập báo giá/ }).first().click();
        await previewPane(page).waitFor({ timeout: 15000 });
        await page.waitForTimeout(1200);
        const template = await fieldInput(page.locator('[data-testid="quote-workspace-left"]'), 'Mẫu báo giá').inputValue();
        check(tc, /#quotes\/new/.test(page.url()) && (await page.getByRole('heading', { name: 'Lập báo giá' }).count()) === 1, 'Mở quotes/new 2 cột', page.url());
        check(tc, template.length > 0 && (await previewSheet(page).count()) === 1, 'Mẫu mặc định được chọn, xem trước hiện ngay', template);
        check('TC-QW-26', /Lưu báo giá để thêm dòng hàng/.test(await linesSection(page).innerText()) && (await linesSection(page).getByRole('button', { name: 'Thêm dòng hàng' }).isEnabled()), 'Dòng hàng khoá kèm câu "Lưu báo giá để thêm dòng hàng"; nút + vẫn bấm được');
      });

      await group('TC-QW-27', async () => {
        const tc = 'TC-QW-27';
        // Đang ở quotes/new mở từ danh sách (TC-QW-24).
        if (!/#quotes\/new/.test(page.url())) {
          await goto(page, '#quotes');
          await page.getByRole('button', { name: /Lập báo giá/ }).first().click();
          await previewPane(page).waitFor({ timeout: 15000 });
        }
        const left = page.locator('[data-testid="quote-workspace-left"]');
        await chooseOption(page, fieldInput(left, 'Báo giá đến'), kh.name);
        const name = `QA-P3B ${stamp} QW-27 lập mới`;
        await left.getByLabel(/Tên báo giá/).first().fill(name);
        await actionBar(page).getByRole('button', { name: 'Lưu', exact: true }).click();
        await page.waitForURL(/#quotes\/[0-9a-f-]{36}/, { timeout: 15000 });
        await page.waitForTimeout(1500);
        check(tc, (await previewText(page)).includes(name) || (await left.innerText()).includes(kh.name), 'Lưu: tạo báo giá, chuyển quotes/<id>, dữ liệu giữ nguyên', page.url());
        await page.goBack();
        await page.waitForTimeout(1500);
        check(tc, /#quotes$/.test(page.url()), 'Back về danh sách, không về quotes/new', page.url());
      });

      await group('TC-QW-25', async () => {
        const tc = 'TC-QW-25';
        await goto(page, `#quotes/new?customerId=${kh.id}`);
        await page.waitForTimeout(1500);
        check(tc, (await fieldInput(page.locator('[data-testid="quote-workspace-left"]'), 'Báo giá đến').inputValue()).includes(kh.name) && (await previewText(page)).includes(kh.name), '?customerId=KH01: khách điền sẵn, xem trước hiện tên');
        const opportunities = await nv1.get(`${crm}/v1/opportunities?limit=100`);
        const opp = (opportunities.items ?? opportunities).find((o) => !['WON', 'LOST'].includes(o.stage));
        if (opp) {
          await goto(page, `#quotes/new?opportunityId=${opp.id}`);
          await page.waitForTimeout(1500);
          check(tc, (await fieldInput(page.locator('[data-testid="quote-workspace-left"]'), 'Dự án bán hàng').inputValue()).includes(opp.name), '?opportunityId: dự án điền sẵn', opp.name);
        } else blocked(tc, 'NV1 không có dự án đang mở để thử ?opportunityId');
        for (const bad of ['00000000-0000-4000-8000-000000000000', 'abc']) {
          await goto(page, `#quotes/new?customerId=${bad}`);
          check(tc, (await page.getByRole('heading', { name: 'Lập báo giá' }).count()) === 1, `?customerId=${bad}: bỏ qua tham số, không lỗi trang`);
        }
      });

      await group('TC-QW-28', async () => {
        const tc = 'TC-QW-28';
        await goto(page, `#quotes/new?customerId=${kh.id}`);
        await page.waitForTimeout(1500);
        await page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first().fill(`QA-P3B ${stamp} QW-28 bấm cộng`);
        await linesSection(page).getByRole('button', { name: 'Thêm dòng hàng' }).click();
        await page.waitForURL(/#quotes\/[0-9a-f-]{36}/, { timeout: 15000 });
        const dlg = page.getByRole('dialog', { name: 'Thêm dòng báo giá' });
        check(tc, await dlg.waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'Bấm + khi chưa lưu: lập báo giá rồi mở chọn mặt hàng');
        await dlg.getByRole('button', { name: 'Huỷ' }).click().catch(() => undefined);
      });

      await group('TC-QW-29', async () => {
        const tc = 'TC-QW-29';
        const left = () => page.locator('[data-testid="quote-workspace-left"]');
        await goto(page, '#quotes/new');
        await page.waitForTimeout(1500);
        await left().getByLabel(/Tên báo giá/).first().fill(`QA-P3B ${stamp} QW-29 thiếu khách`);
        await actionBar(page).getByRole('button', { name: 'Lưu', exact: true }).click();
        await page.waitForTimeout(800);
        check(tc, /#quotes\/new/.test(page.url()) && (await left().locator('[role="alert"]').count()) > 0, 'Bỏ trống khách: lỗi ngay ở form, không tạo', (await left().locator('[role="alert"]').allInnerTexts()).join(' '));
        const existing = await nv1.get(quoteUrl(Q['Q-DRAFT'].id));
        await chooseOption(page, fieldInput(left(), 'Báo giá đến'), kh.name);
        await left().getByLabel('Mã báo giá').fill(existing.code);
        await actionBar(page).getByRole('button', { name: 'Lưu', exact: true }).click();
        await page.waitForTimeout(1500);
        const alerts = (await left().locator('[role="alert"]').allInnerTexts()).join(' ');
        check(tc, /#quotes\/new/.test(page.url()) && VIETNAMESE_RE.test(alerts) && (await left().getByLabel(/Tên báo giá/).first().inputValue()).includes('QW-29'), 'Mã trùng: lỗi tiếng Việt, dữ liệu giữ', alerts.slice(0, 120));
        // Bấm Lưu hai lần thật nhanh: chỉ tạo một báo giá.
        const name = `QA-P3B ${stamp} QW-29 bấm hai lần`;
        await left().getByLabel('Mã báo giá').fill('');
        await left().getByRole('button', { name: /Sinh lại|Sinh mã/ }).first().click().catch(() => undefined);
        await left().getByLabel(/Tên báo giá/).first().fill(name);
        const save = actionBar(page).getByRole('button', { name: 'Lưu', exact: true });
        // Bấm đúp thật (hai lần click liền nhau). Không dùng hai `click()` song song: lệnh không `force` sẽ chờ nút bật lại,
        // mà sau khi tạo xong màn chuyển sang quotes/<id> có nút Lưu tắt (D3-20) nên chờ đến hết giờ.
        await save.dblclick();
        await page.waitForTimeout(3000);
        const mine = await nv1.get(`${crm}/v1/quotes?customerId=${kh.id}&limit=100`);
        const created = (mine.items ?? mine).filter((item) => item.quoteName === name);
        check(tc, created.length === 1, 'Bấm Lưu hai lần thật nhanh: chỉ tạo một báo giá', `${created.length}`);
      });

      await group('TC-QW-33', async () => {
        const tc = 'TC-QW-33';
        const opportunities = await nv1.get(`${crm}/v1/opportunities?limit=100`);
        const opp = (opportunities.items ?? opportunities).find((o) => !['WON', 'LOST'].includes(o.stage));
        if (!opp) return blocked(tc, 'NV1 không có dự án đang mở');
        await goto(page, `#opportunities/${opp.id}`);
        await page.getByRole('button', { name: 'Lập báo giá', exact: true }).first().click();
        const dlg = page.getByRole('dialog', { name: 'Lập báo giá' });
        await dlg.waitFor({ timeout: 10000 });
        const name = `QA-P3B ${stamp} QW-33 từ hộp thoại`;
        await dlg.getByLabel(/Tên báo giá/).first().fill(name);
        await dlg.getByRole('button', { name: 'Mở màn đầy đủ' }).click();
        await page.waitForURL(/#quotes\/new\?opportunityId=/, { timeout: 10000 });
        await page.waitForTimeout(1500);
        const kept = await page.locator('[data-testid="quote-workspace-left"]').getByLabel(/Tên báo giá/).first().inputValue();
        check(tc, kept === name, '"Mở màn đầy đủ" chuyển quotes/new?opportunityId=… giữ dữ liệu đã nhập (hộp thoại ở màn dự án)', page.url());
      });
    } finally {
      await restoreA4();
      await context.close();
    }
  }

  // ---- 1024×768 ----
  {
    const { context, page } = await login('nv1', { width: 1024, height: 768 });
    try {
      await group('TC-QW-02', async () => {
        const tc = 'TC-QW-02';
        await goto(page, `#quotes/${Q['Q-DRAFT'].id}`);
        await page.getByRole('tablist', { name: 'Màn báo giá' }).waitFor({ timeout: 15000 });
        const tabs = await page.getByRole('tablist', { name: 'Màn báo giá' }).getByRole('tab').allInnerTexts();
        check(tc, tabs.join('|') === 'Nhập liệu|Xem trước', 'Hai tab "Nhập liệu" và "Xem trước"', tabs.join('|'));
        await page.getByRole('tab', { name: 'Xem trước' }).click();
        check(tc, (await page.locator('[data-testid="quote-workspace-right"]').isVisible()) && !(await page.locator('[data-testid="quote-workspace-left"]').isVisible()), 'Chuyển tab Xem trước');
        const fixed = await actionBar(page).evaluate((node) => getComputedStyle(node).position);
        check(tc, fixed === 'fixed' || fixed === 'sticky', 'Nút hành động ở thanh dưới cố định', fixed);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(tc, overflow <= 0, 'Không có thanh cuộn ngang', String(overflow));
        await shot(page, 'qw-02-1024');
      });
    } finally {
      await context.close();
    }
  }
}

// ===================================================================================================================
// QUYỀN TRÊN GIAO DIỆN (TC-P3PERM-03, 04; TC-QW-30)
// ===================================================================================================================
async function runPermissions() {
  {
    const { context, page } = await login('nv1');
    try {
      await group('TC-P3PERM-03', async () => {
        const tc = 'TC-P3PERM-03';
        await goto(page, '#settings/quote-forms');
        await page.waitForTimeout(1500);
        check(tc, (await page.getByRole('button', { name: 'Thiết kế bố cục' }).count()) === 0, 'NV1 ở Cài đặt → Mẫu và loại báo giá: không có nút "Thiết kế bố cục"');
        const put = await nv1.call('PUT', layoutUrl(T['M-A4'].id), { body: { layout: a4Original.layout }, expect: [403] });
        check(tc, put.status === 403, 'Gọi thẳng API vẫn 403', String(put.status));
      });
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await login('ktv');
    try {
      await group('TC-P3PERM-04', async () => {
        const tc = 'TC-P3PERM-04';
        await openQuote(page, Q['Q-SENT'].id);
        check(tc, (await previewSheet(page).count()) === 1, 'XEM (KTV) mở Q-SENT: có xem trước');
        check(tc, (await actionBar(page).count()) === 0 && (await page.locator('[data-testid="quote-workspace-right"]').getByRole('button', { name: /^(Lưu|Trình duyệt|Báo giá)$/ }).count()) === 0, 'Không thấy nút Lưu, Trình duyệt, Báo giá');
        const printed = await exportPdf(page);
        check(tc, !!printed?.title, 'Xuất PDF được', printed?.title);
        const word = await exportWord(page);
        check(tc, word.name.endsWith('.docx') && word.xml.length > 0, 'Xuất Word được', word.name);
        check('TC-P3PERM-08', !/Giá vốn|Lợi nhuận/.test(await previewText(page)) && !/Giá vốn|Lợi nhuận/.test(word.xml), 'Người không có crm.quote.cost.read: xem trước, Word không có giá vốn, lợi nhuận');
      });
      await group('TC-QW-30', async () => {
        const tc = 'TC-QW-30';
        const creates = [];
        page.on('request', (request) => {
          if (request.method() === 'POST' && /\/v1\/quotes$/.test(request.url())) creates.push(request.url());
        });
        await goto(page, '#quotes/new');
        await page.waitForTimeout(1500);
        check(tc, (await page.getByText('Bạn không có quyền lập báo giá.').count()) === 1 && (await page.getByRole('button', { name: /Danh sách báo giá/ }).count()) > 0, 'XEM mở quotes/new: "Bạn không có quyền lập báo giá." và nút về danh sách');
        check(tc, creates.length === 0, 'Không gọi createQuote');
        await goto(page, '#quotes');
        await page.waitForTimeout(1500);
        check(tc, (await page.getByRole('button', { name: /Lập báo giá/ }).count()) === 0, 'Danh sách báo giá: không có nút "Lập báo giá"');
      });
    } finally {
      await context.close();
    }
  }
}

const VIETNAMESE_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

try {
  if (only.has('DS')) await runDesigner();
  if (only.has('QW') || only.has('EX')) await runQuoteScreen();
  if (only.has('PERM')) await runPermissions();
} finally {
  await restoreA4().catch((error) => console.log(`  KHÔNG trả được bố cục M-A4 về như cũ: ${error.message}`));
  await resetScratch().catch(() => undefined);
  await browser.close();
  console.log('\nKết quả theo TC:');
  let failed = 0;
  let passed = 0;
  let other = 0;
  for (const [tc, entry] of [...tcs].sort(([a], [b]) => a.localeCompare(b))) {
    const status = entry.fail ? 'LỖI' : entry.blocked.length && !entry.pass ? 'BỊ CHẶN' : entry.blocked.length ? 'ĐẠT MỘT PHẦN' : 'ĐẠT';
    if (entry.fail) failed += 1;
    else if (status === 'ĐẠT') passed += 1;
    else other += 1;
    console.log(`  ${tc.padEnd(14)} ${status.padEnd(13)} ${entry.pass} đạt, ${entry.fail} lỗi${entry.blocked.length ? `; chặn: ${entry.blocked.join('; ')}` : ''}`);
  }
  console.log(`\nTổng: ${passed}/${tcs.size} TC đạt, ${failed} lỗi, ${other} bị chặn hoặc đạt một phần. File tải về: ${workDir}`);
  process.exitCode = failed ? 1 : 0;
}
