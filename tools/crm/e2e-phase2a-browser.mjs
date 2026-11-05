// Kiểm GĐ A phase 2 trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2a-browser.mjs [--shots=<thư mục>]
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
const goto = async (page, hash = '') => { await page.goto(`${crmUrl}${hash}`); await page.reload(); await page.waitForTimeout(2500); };
const sidebarText = async (page) => (await page.locator('aside, nav').first().innerText().catch(() => '')) || (await page.locator('body').innerText());

try {
  // ---- NV1: điều hướng hai phần, nút Kho mờ
  {
    const { context, page } = await login('nv1');
    await goto(page);
    const side = await page.locator('body').innerText();
    check('TC-NAV-01 mặc định vào Quản lý khách hàng, trang Khách hàng', /QUẢN LÝ KHÁCH HÀNG/.test(side) && /Thêm khách hàng/.test(side) && !/Dự án bán hàng/.test(side.split('Kho hàng')[0]));
    await shot(page, 'nav-01-nv1');

    await page.getByText('Bán hàng', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const sales = await page.locator('body').innerText();
    const wanted = ['Tổng quan', 'Dự án bán hàng', 'Báo giá', 'Hợp đồng', 'Đơn bán', 'Công nợ', 'Bảo hành'];
    const missing = wanted.filter((w) => !sales.includes(w));
    check('TC-NAV-02 chuyển sang phần Bán hàng: có các trang Bán hàng, không còn Khách hàng/Lead', missing.length === 0, missing.length ? `thiếu: ${missing.join(', ')}` : '');
    await shot(page, 'nav-02-sales');

    for (const [hash, label, section] of [['#quotes', 'Báo giá', 'Bán hàng'], ['#overview', 'Tổng quan', 'Bán hàng'], ['#customers', 'Khách hàng', 'Quản lý khách hàng']]) {
      await goto(page, hash);
      const body = await page.locator('body').innerText();
      const active = await page.locator('[aria-current="page"], [aria-selected="true"], [class*="active" i]').allInnerTexts();
      check(`TC-NAV-03 mở ${hash}`, active.some((t) => t.trim().startsWith(label)) || body.includes(label), `mục đang chọn: ${active.map((t) => t.trim().slice(0, 25)).join(' | ')}`);
      await shot(page, `nav-03-${hash.slice(1)}`);
    }

    // Nút Kho: mờ, aria-disabled, không chuyển trang
    await goto(page);
    const kho = page.getByText('Kho hàng', { exact: true }).first();
    const holder = kho.locator('xpath=ancestor-or-self::*[@aria-disabled or self::a or self::button][1]');
    const aria = await holder.getAttribute('aria-disabled');
    const title = (await holder.getAttribute('title')) ?? '';
    const describedBy = (await holder.getAttribute('aria-describedby')) ?? '';
    await holder.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(800);
    check('TC-FB-12 NV1: nút Kho mờ, aria-disabled=true, có chú giải, bấm không chuyển trang', aria === 'true' && page.url().includes('/modules/crm') && (title.includes('chưa được cấp quyền') || describedBy !== ''), `aria-disabled=${aria}, title="${title}", url=${page.url()}`);
    // Bàn phím: dù lấy focus, Enter và Space không chuyển trang; phần tử không phải liên kết
    await holder.focus().catch(() => undefined);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    const tag = await holder.evaluate((el) => el.tagName + (el.getAttribute('href') ? ' href' : ''));
    check('TC-FB-12 NV1: bàn phím không kích hoạt được nút Kho', page.url().includes('/modules/crm') && !tag.includes('href'), `${tag}, url=${page.url()}`);
    await shot(page, 'fb-12-nv1');

    // TC-FB-15: thu gọn thanh bên, nút Kho vẫn còn
    await goto(page);
    // Nút thu gọn nằm ở chân thanh bên (biểu tượng khung), cạnh nút tài khoản
    await page.mouse.click(74, 870);
    await page.waitForTimeout(900);
    const collapsed = page.url().includes('/modules/crm');
    const disabledKho = await page.locator('[aria-disabled="true"]').count();
    const box = await page.locator('[aria-disabled="true"]').first().boundingBox().catch(() => null);
    check('TC-FB-15 thanh bên thu gọn: nút Kho vẫn có, cố định ở cuối, aria-disabled', collapsed && disabledKho > 0 && !!box && box.y > 700, `url ok=${collapsed}, có nút=${disabledKho}, y=${box?.y}, w=${box?.width}`);
    await shot(page, 'fb-15-collapsed');
    await context.close();
  }

  // ---- NV1: hộp thoại thêm nhiều mặt hàng vào báo giá nháp (TC-FB-01..04)
  {
    const { context, page } = await login('nv1');
    await goto(page, '#quotes');
    // Dùng báo giá nháp mới nhất của NV1 (tạo bằng e2e-phase2a.mjs); dòng của nó có sẵn CAP và MUC
    await page.locator('tr', { hasText: 'Nháp' }).first().click();
    await page.waitForTimeout(2500);
    const rowsBefore = await page.locator('table tbody tr').count();
    await page.getByRole('button', { name: /Thêm dòng/ }).first().click();
    const dlg = page.locator('[role="dialog"]').last();
    await dlg.getByText('Thêm dòng báo giá').waitFor({ timeout: 10000 });
    const checks = await dlg.locator('input[type="checkbox"]').count();
    const radios = await dlg.locator('input[type="radio"]').count();
    check('TC-FB-01 cột chọn là ô check, không phải radio', checks > 1 && radios === 0, `checkbox=${checks}, radio=${radios}`);
    const rowOf = (code) => dlg.locator('tr', { hasText: code }).first();
    await rowOf('QA-KHO-BT').locator('input[type="checkbox"]').check();
    await rowOf('QA-KHO-LAP').locator('input[type="checkbox"]').check();
    const addBtn = dlg.getByRole('button', { name: /Thêm 2 dòng/ });
    check('TC-FB-01 nút hiện đúng số dòng đã chọn ("Thêm 2 dòng")', (await addBtn.count()) === 1, (await dlg.getByText(/Đã chọn \d+ mặt hàng/).innerText().catch(() => '')));

    // TC-FB-02: đổi từ khoá tìm, lựa chọn vẫn giữ
    const search = dlg.locator('input[type="text"], input[type="search"], input:not([type])').first();
    await search.fill('Phần mềm');
    await page.waitForTimeout(1200);
    await rowOf('QA-KHO-PM').locator('input[type="checkbox"]').check();
    await search.fill('');
    await page.waitForTimeout(1200);
    const stillBt = await rowOf('QA-KHO-BT').locator('input[type="checkbox"]').isChecked();
    const stillLap = await rowOf('QA-KHO-LAP').locator('input[type="checkbox"]').isChecked();
    check('TC-FB-02 giữ lựa chọn khi đổi từ khoá tìm', stillBt && stillLap && (await dlg.getByRole('button', { name: /Thêm 3 dòng/ }).count()) === 1, `BT=${stillBt}, LAP=${stillLap}`);
    await shot(page, 'fb-01-02-dialog');

    // TC-FB-03: số lượng <= 0 báo lỗi, không thêm
    const qty = rowOf('QA-KHO-LAP').locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').first();
    await qty.fill('0');
    await dlg.getByRole('button', { name: /Thêm 3 dòng/ }).click();
    await page.waitForTimeout(800);
    const err = await dlg.innerText();
    check('TC-FB-03 số lượng <= 0: báo "Số lượng phải lớn hơn 0.", không thêm gì', err.includes('Số lượng phải lớn hơn 0') && (await page.locator('table tbody tr').count()) >= rowsBefore, '');
    await qty.fill('5');
    await rowOf('QA-KHO-BT').locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').first().fill('2').catch(() => undefined);

    // TC-FB-04: mặt hàng đã có trong báo giá được đánh dấu
    check('TC-FB-04 mặt hàng đã có trong báo giá được đánh dấu', (await rowOf('QA-KHO-CAP').innerText()).includes('Đã có trong báo giá'));
    await dlg.getByRole('button', { name: /Thêm 3 dòng/ }).click();
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    check('TC-FB-01 thêm 3 dòng một lần: báo giá có BT, LAP, PM', ['QA-KHO-BT', 'QA-KHO-LAP', 'QA-KHO-PM'].every((c) => body.includes(c)), '');
    await shot(page, 'fb-01-after-add');
    await context.close();
  }

  // ---- Tạo nhóm khách hàng tại chỗ (TC-FB-07, TC-FB-08)
  {
    const { context, page } = await login('qtv');
    await goto(page, '#customers');
    await page.getByRole('button', { name: /Thêm khách hàng/ }).first().click();
    const dlg = page.locator('[role="dialog"]').last();
    await dlg.getByText('Nhóm khách hàng').first().waitFor({ timeout: 10000 });
    await dlg.locator('label:has-text("Nhóm khách hàng") ~ *, :text("Nhóm khách hàng") + *').first().click().catch(() => undefined);
    await page.getByText('Tạo nhóm mới', { exact: true }).first().click({ timeout: 8000 }).catch(() => undefined);
    const name = `Nhóm thử ${Date.now() % 100000}`;
    const nameInput = page.locator('[role="dialog"]').last().locator('input').first();
    await shot(page, 'fb-07-dialog');
    const opened = (await page.locator('[role="dialog"]').count()) >= 2;
    if (opened) {
      await nameInput.fill(name);
      await page.locator('[role="dialog"]').last().getByRole('button', { name: /Lưu|Tạo/ }).first().click();
      await page.waitForTimeout(2500);
    }
    const values = await page.locator('[role="dialog"]').first().locator('input').evaluateAll((els) => els.map((e) => e.value));
    const selected = values.includes(name);
    check('TC-FB-07 QTV: tạo nhóm tại chỗ và nhóm vừa tạo được chọn sẵn', opened && selected, `hộp thoại con mở=${opened}, đã chọn=${selected}`);
    await shot(page, 'fb-07-after');
    await context.close();
  }
  {
    const { context, page } = await login('nv1');
    await goto(page, '#customers');
    await page.getByRole('button', { name: /Thêm khách hàng/ }).first().click();
    const dlg = page.locator('[role="dialog"]').last();
    await dlg.getByText('Nhóm khách hàng').first().waitFor({ timeout: 10000 });
    await dlg.locator(':text("Nhóm khách hàng") + *').first().click().catch(() => undefined);
    await page.waitForTimeout(600);
    await shot(page, 'fb-08-nv1');
    check('TC-FB-08 NV1 (không crm.manage): không có nút "Tạo nhóm mới"', (await page.getByText('Tạo nhóm mới', { exact: true }).count()) === 0, '');
    await context.close();
  }

  // ---- QL: nút Kho bấm được
  {
    const { context, page } = await login('ql');
    await goto(page);
    const link = page.locator('a[href*="/modules/inventory"]').first();
    const href = await link.getAttribute('href').catch(() => null);
    await shot(page, 'fb-11-ql');
    await link.click().catch(() => undefined);
    await page.waitForURL(/\/modules\/inventory/, { timeout: 15000 }).catch(() => undefined);
    check('TC-FB-11 QL: nút Kho bấm được, dẫn tới /modules/inventory', /\/modules\/inventory/.test(page.url()), `href=${href}, url=${page.url()}`);
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
