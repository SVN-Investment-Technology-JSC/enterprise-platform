// Kiểm GĐ G phase 2 (màn cấu hình luồng) trên trình duyệt thật (Playwright + Chrome hệ thống) vào gateway 8080.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2g-browser.mjs [--shots=<thư mục>]
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
const goto = async (page, hash = '') => { await page.goto(`${crmUrl}${hash}`); await page.reload(); await page.waitForTimeout(3500); };
const stamp = Date.now() % 1_000_000;
const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('ep_csrf='))?.split('=')[1];
  const r = await fetch(`/api/crm/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}, { method, path, body });

try {
  {
    const { context, page } = await login('nv1');
    await goto(page, '#settings/pipelines');
    const t = await page.locator('body').innerText();
    check('TC-CFG-08 (trình duyệt) NV1 không thấy màn Cấu hình luồng', !t.includes('Tạo luồng'), '');
    await context.close();
  }
  {
    const { context, page } = await login('qtv');
    await goto(page, '#settings/pipelines');
    let t = await page.locator('body').innerText();
    check('TC-CFG-01 (trình duyệt) QTV thấy danh sách luồng (Bán hàng thông thường, Chào thầu)', t.includes('Bán hàng thông thường') && t.includes('Chào thầu') && t.includes('Tạo luồng'), '');
    await shot(page, 'g-pipelines');

    // Luồng mặc định: nút tắt/xoá bị khoá kèm giải thích
    await page.getByText('Bán hàng thông thường').first().click();
    await page.waitForTimeout(1200);
    const off = page.getByRole('button', { name: /Tắt luồng/ }).first();
    const del = page.getByRole('button', { name: /Xoá luồng/ }).first();
    const disabled = (await off.isDisabled().catch(() => false)) && (await del.isDisabled().catch(() => false));
    check('TC-CFG-05 (trình duyệt) luồng mặc định: nút Tắt/Xoá bị khoá kèm giải thích', disabled, '');
    await shot(page, 'g-default-locked');

    // Tạo luồng mới từ khung trống qua giao diện
    await page.getByRole('button', { name: /Tạo luồng/ }).first().click();
    const dlg = page.locator('[role="dialog"]:visible').last();
    const inputs = dlg.locator('input[type="text"], input:not([type])');
    await inputs.nth(0).fill(`UI_${stamp}`);
    await inputs.nth(1).fill(`Luồng giao diện ${stamp}`);
    await shot(page, 'g-create-dialog');
    await dlg.getByRole('button', { name: /^(Tạo|Lưu|Tạo luồng)$/ }).last().click();
    await page.waitForTimeout(2500);
    t = await page.locator('body').innerText();
    check('TC-CFG-07 (trình duyệt) tạo luồng mới: xuất hiện trong danh sách', t.includes(`Luồng giao diện ${stamp}`), '');

    // Thêm giai đoạn
    await page.getByText(`Luồng giao diện ${stamp}`).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Thêm giai đoạn/ }).first().click();
    const d2 = page.locator('[role="dialog"]:visible').last();
    const i2 = d2.locator('input[type="text"], input:not([type])');
    await i2.nth(0).fill('GUI_MAU');
    await i2.nth(1).fill('Gửi mẫu giao diện');
    await d2.getByRole('button', { name: /^(Thêm|Lưu|Tạo)/ }).last().click();
    await page.waitForTimeout(2500);
    t = await page.locator('body').innerText();
    check('TC-CFG-01 (trình duyệt) thêm giai đoạn "Gửi mẫu giao diện" vào luồng', t.includes('Gửi mẫu giao diện'), '');
    await shot(page, 'g-stage-added');

    // Xoá giai đoạn chưa dùng; tắt luồng thử
    const pipes = await api(page, 'GET', '/pipelines');
    const mine = pipes.find((p) => p.code === `UI_${stamp}`);
    check('TC-CFG-01 (trình duyệt, đối chiếu API) luồng và giai đoạn đã lưu ở server', !!mine && mine.stages.some((s) => s.code === 'GUI_MAU'), mine?.stages.map((s) => s.code).join(','));
    if (mine) await api(page, 'DELETE', `/pipelines/${mine.id}`);
    await context.close();
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
