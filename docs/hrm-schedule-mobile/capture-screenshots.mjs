/**
 * Chụp ảnh màn hình web cho tài liệu HRM-PHAN-CA-MOBILE.md, có tô khung đỏ quanh dữ liệu và nút cần thao tác.
 *
 * Chạy (cần web dev + API đang chạy qua gateway, tài khoản có quyền hrm.schedule.manage, bulk, calendar):
 *
 *   $env:BASE_URL = 'http://localhost:8080'
 *   $env:SHOT_EMAIL = '<email tài khoản tenant>'
 *   $env:SHOT_PASSWORD = '<mật khẩu>'
 *   node docs/hrm-schedule-mobile/capture-screenshots.mjs
 *
 * Tài khoản đọc từ biến môi trường, không ghi vào file. Ảnh lưu ở docs/hrm-schedule-mobile/images/.
 * Script chỉ xem và mở hộp thoại xác nhận, KHÔNG bấm "Lưu phân ca" hay "Nhả ca", nên không ghi dữ liệu.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const EMAIL = process.env.SHOT_EMAIL;
const PASSWORD = process.env.SHOT_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('Thiếu biến môi trường SHOT_EMAIL / SHOT_PASSWORD.');

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1400 }, locale: 'vi-VN' });
const page = await context.newPage();

// Đăng nhập bằng API để lấy cookie phiên (giống màn đăng nhập tenant).
const login = await context.request.post(`${BASE}/api/auth/v1/login`, {
  data: { email: EMAIL, password: PASSWORD, portal: 'tenant' },
});
if (!login.ok()) throw new Error(`Đăng nhập thất bại (${login.status()}).`);

const url = (tab) => `${BASE}/modules/hrm/settings?view=schedules&tab=${tab}`;

/** Vẽ khung đỏ (và số thứ tự) quanh các phần tử rồi chụp; xoá khung sau khi chụp. */
async function shot(name, targets = []) {
  const boxes = [];
  for (const [index, target] of targets.entries()) {
    const box = await target.first().boundingBox().catch(() => null);
    if (box) boxes.push({ ...box, n: index + 1 });
    else console.warn(`[${name}] không thấy phần tử số ${index + 1}`);
  }
  await page.evaluate((list) => {
    for (const b of list) {
      const el = document.createElement('div');
      el.setAttribute('data-shot-mark', '1');
      el.style.cssText = `position:fixed;left:${b.x - 3}px;top:${b.y - 3}px;width:${b.width + 6}px;height:${b.height + 6}px;border:2px solid #e11d48;border-radius:4px;z-index:2147483647;pointer-events:none`;
      const tag = document.createElement('span');
      tag.textContent = String(b.n);
      tag.style.cssText = 'position:absolute;left:-2px;top:-20px;background:#e11d48;color:#fff;font:700 12px sans-serif;padding:1px 6px;border-radius:3px';
      el.appendChild(tag);
      document.body.appendChild(el);
    }
  }, boxes);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.evaluate(() => document.querySelectorAll('[data-shot-mark]').forEach((e) => e.remove()));
  console.log(`đã chụp ${name}.png (${boxes.length}/${targets.length} khung)`);
}

const byLabel = (text) => page.getByLabel(text, { exact: false });
const btn = (name) => page.getByRole('button', { name });

async function pickOption(placeholder, optionName) {
  await page.getByPlaceholder(placeholder).first().click();
  await page.getByRole('option', { name: optionName }).first().click();
}

// ---------------------------------------------------------------- Phân ca
await page.goto(url('assign'), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.getByText('Thông tin phân ca').waitFor();
await shot('01-phan-ca-form', [
  page.getByPlaceholder('Chọn đối tượng áp dụng…'),
  byLabel('Ngày hiệu lực'),
  page.getByRole('checkbox', { name: /Không có ngày kết thúc/ }),
  byLabel('Ghi chú'),
  page.getByPlaceholder('Chọn cách thiết lập ca…'),
  btn('Xác nhận phân ca'),
]);

await pickOption(/Tìm theo mã hoặc tên nhân viên/, /./);
// Ca làm việc: lối tắt "Ngày thường (T2-T6)" (tenant có thể chưa có mẫu lịch tuần đang hoạt động).
await pickOption(/Chọn ca cho T2-T6/, /./);
await shot('02-phan-ca-da-chon', [
  page.getByPlaceholder(/Tìm theo mã hoặc tên nhân viên/),
  page.getByPlaceholder(/Chọn ca cho T2-T6/),
  btn('Xác nhận phân ca'),
]);

await btn('Xác nhận phân ca').click();
const assignDialog = page.getByRole('dialog', { name: 'Tổng quan phân ca' });
await assignDialog.waitFor();
await page.waitForTimeout(1200); // chờ bản xem trước
await shot('03-phan-ca-popup-tong-quan', [
  assignDialog.getByTestId('assign-overview'),
  assignDialog.getByText('Khi ngày đã có lịch khác', { exact: true }),
]);
// Phần cuối popup (cuộn xuống): xác nhận và nút Lưu.
await assignDialog.getByRole('checkbox', { name: /đồng ý áp dụng/ }).scrollIntoViewIfNeeded();
await shot('03b-phan-ca-popup-xac-nhan', [
  assignDialog.getByRole('checkbox', { name: /đồng ý áp dụng/ }),
  assignDialog.getByRole('button', { name: 'Lưu phân ca' }),
]);
await assignDialog.getByRole('button', { name: 'Quay lại chỉnh sửa' }).click();

// ---------------------------------------------------------------- Nhả ca
await page.goto(url('release'), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.getByText('Thông tin nhả ca').waitFor();
await shot('04-nha-ca-form', [
  page.getByPlaceholder('Chọn đối tượng áp dụng…'),
  byLabel('Từ ngày'),
  byLabel('Đến ngày'),
  byLabel('Lý do'),
  btn('Xác nhận nhả ca'),
]);
await pickOption(/Tìm theo mã hoặc tên nhân viên/, /./);
await btn('Xác nhận nhả ca').click();
const releaseDialog = page.getByRole('dialog', { name: 'Tổng quan nhả ca' });
await releaseDialog.waitFor();
await page.waitForTimeout(1200);
await shot('05-nha-ca-popup-tong-quan', [
  releaseDialog.getByTestId('release-overview'),
  releaseDialog.getByText('Phạm vi ảnh hưởng', { exact: true }),
  releaseDialog.getByRole('checkbox', { name: /đồng ý nhả ca/ }),
  releaseDialog.getByRole('button', { name: 'Nhả ca' }),
]);
await releaseDialog.getByRole('button', { name: 'Quay lại chỉnh sửa' }).click();

// ---------------------------------------------------------------- Ngoại lệ (tab Lịch làm việc)
await page.goto(url('calendar'), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.getByRole('button', { name: 'Công cụ phân ca' }).waitFor();
await shot('06-lich-lam-viec-luoi', [page.getByRole('button', { name: 'Công cụ phân ca' })]);
await page.getByRole('button', { name: 'Công cụ phân ca' }).click();
await shot('07-cong-cu-menu', [page.getByRole('menuitem', { name: 'Thiết lập ngoại lệ' })]);
await page.getByRole('menuitem', { name: 'Thiết lập ngoại lệ' }).click();
const ex = page.getByRole('dialog', { name: 'Thiết lập ngoại lệ' });
await ex.waitFor();
await pickOption(/Tìm theo mã hoặc tên nhân viên/, /./);
await shot('08-ngoai-le-buoc-1-pham-vi', [
  ex.getByPlaceholder(/Tìm theo mã hoặc tên nhân viên/),
  ex.getByRole('button', { name: 'Tiếp tục' }),
]);
await ex.getByRole('button', { name: 'Tiếp tục' }).click();
await shot('09-ngoai-le-buoc-2-ca', [
  ex.getByRole('radio', { name: 'Nghỉ' }),
  ex.getByRole('radio', { name: 'Làm theo ca' }),
  ex.getByRole('button', { name: 'Tiếp tục' }),
]);
await ex.getByRole('button', { name: 'Tiếp tục' }).click();
await shot('10-ngoai-le-buoc-3-thoi-gian', [
  ex.getByLabel('Từ ngày'),
  ex.getByLabel('Đến ngày'),
  ex.getByText('Khi ngày đã có lịch khác'),
  ex.getByRole('button', { name: 'Tiếp tục' }),
]);
await ex.getByRole('button', { name: 'Tiếp tục' }).click();
await page.waitForTimeout(1200);
await shot('11-ngoai-le-buoc-4-xem-truoc', [
  ex.getByLabel('Tóm tắt xem trước'),
  ex.getByRole('button', { name: 'Lưu phân ca' }),
]);

await browser.close();
