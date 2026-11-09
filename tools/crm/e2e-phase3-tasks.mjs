#!/usr/bin/env node
/**
 * E2E Việc cần xử lý và thông tin cho người duyệt (phase 3 C7, test_phase3 mục 2.7, TC-TSK-*): API qua gateway và trình
 * duyệt (Playwright, Chrome hệ thống). Cần loại duyệt QUOTE gắn quy trình "Duyệt báo giá" (seed phase 1, bước TN duyệt).
 *
 * Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase3-tasks.mjs [--tenant=svn] [--base=http://localhost:8080]
 *
 * Mỗi lượt để lại 2 báo giá `QA-P3T …` của NV1 (một đã duyệt trên Quy trình, một còn chờ duyệt).
 */
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessions, materialsByCode, requireCustomers } from './seed-svn/common.mjs';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: { tenant: { type: 'string', default: 'svn' }, base: { type: 'string', default: 'http://localhost:8080' } },
});
loadEnv?.();
const config = buildConfig(values.tenant);
const crm = config.crmApi;

function loadPlaywright() {
  const root = resolve(import.meta.dirname, '../../node_modules/.pnpm');
  const dir = readdirSync(root).find((d) => d.startsWith('playwright-core@'));
  return require(resolve(root, dir, 'node_modules/playwright-core'));
}

const results = new Map();
const check = (tc, ok, label, detail) => {
  if (!results.has(tc)) results.set(tc, { pass: 0, fail: 0 });
  results.get(tc)[ok ? 'pass' : 'fail'] += 1;
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${label}${detail === undefined ? '' : `  [${String(detail).slice(0, 220)}]`}`);
};
const group = async (tc, fn) => {
  try {
    await fn();
  } catch (error) {
    check(tc, false, 'lỗi bất ngờ khi chạy', (error instanceof Error ? error.message : String(error)).split('\n')[0]);
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(fn, timeoutMs = 60_000, stepMs = 1500) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) return value;
    await sleep(stepMs);
  }
}

const sessions = createSessions(config);
const [nv1, nv2, tn, qtbh] = await Promise.all(['NV1', 'NV2', 'TN', 'QTBH'].map((code) => sessions.as(code)));
const bindings = await qtbh.get(`${crm}/v1/approval-bindings`);
const quoteBinding = bindings.find((item) => item.kind === 'QUOTE');
if (quoteBinding?.mode !== 'PROCEDURE') throw new Error('Loại QUOTE phải gắn Quy trình (seed phase 1) để chạy kịch bản này.');
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const materials = await materialsByCode(config, await sessions.as('QTV'));
const stamp = Date.now() % 1_000_000;
const quoteUrl = (id) => `${crm}/v1/quotes/${id}`;

/** Báo giá NV1 ghi đè chiết khấu 30% (luôn cần duyệt), đã trình; chờ Quy trình tạo hồ sơ. */
async function pendingQuote(label) {
  let detail = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, quoteName: `QA-P3T ${stamp} ${label}` });
  detail = await nv1.post(`${quoteUrl(detail.id)}/versions/1/lines/batch`, {
    revision: detail.version.revision,
    lines: [{ materialId: materials.get('QA-KHO-CAP')?.id, quantity: 2, overrideDiscountPercent: 30 }],
  });
  detail = await nv1.post(`${quoteUrl(detail.id)}/versions/1/submit`, { revision: detail.version.revision });
  if (detail.version.status !== 'PENDING') throw new Error(`Báo giá ${detail.code} không ở Chờ duyệt (${detail.version.status}).`);
  const withInstance = await waitFor(async () => {
    const current = await nv1.get(quoteUrl(detail.id));
    return current.procedure?.instanceId ? current : null;
  });
  if (!withInstance) throw new Error(`Báo giá ${detail.code}: Quy trình chưa tạo hồ sơ.`);
  return withInstance;
}

const first = await pendingQuote('duyệt trên Quy trình');
const second = await pendingQuote('còn chờ duyệt');
const instanceId = first.procedure.instanceId;

// =====================================================================================================================
// API
// =====================================================================================================================
await group('TC-TSK-05', async () => {
  const tc = 'TC-TSK-05';
  const instance = await tn.get(`${config.procedureApi}/v1/instances/${instanceId}`);
  const summary = instance.sourceSummary;
  const labels = (summary?.items ?? []).map((item) => item.label);
  check(tc, summary?.title?.includes(first.code), 'Hồ sơ có thông tin nguồn, tiêu đề có mã báo giá', summary?.title);
  check(tc, ['Khách hàng', 'Tổng tiền'].every((label) => labels.includes(label)), 'Có dòng Khách hàng, Tổng tiền', labels.join(', '));
  check(tc, labels.some((label) => /lý do/i.test(label)), 'Có dòng lý do cần duyệt', labels.join(', '));
  check(tc, summary?.url === `/modules/crm#quotes/${first.id}`, 'Link về báo giá trong CRM', summary?.url);
});

await group('TC-TSK-09', async () => {
  const tc = 'TC-TSK-09';
  const mine = await tn.get(`${crm}/v1/my-tasks`);
  const row = mine.awaitingMe.find((task) => task.quoteId === first.id);
  check(tc, row?.kind === 'QUOTE_APPROVAL' && row.approval?.mode === 'PROCEDURE' && row.approval.procedureInstanceId === instanceId, 'TN thấy báo giá trong Chờ tôi duyệt kèm id hồ sơ', JSON.stringify(row?.approval));
  const other = await nv2.get(`${crm}/v1/my-tasks`);
  check(tc, !other.awaitingMe.some((task) => task.quoteId === first.id), 'NV2 (không có bước duyệt) không thấy');
  const owner = await nv1.get(`${crm}/v1/my-tasks`);
  check(tc, !owner.awaitingMe.some((task) => task.quoteId === first.id), 'NV1 (người trình) không thấy trong Chờ tôi duyệt');
});

await group('TC-TSK-12', async () => {
  const tc = 'TC-TSK-12';
  const filtered = await tn.get(`${crm}/v1/quotes?awaitingMyApproval=true&limit=100`);
  const ids = (filtered.items ?? []).map((item) => item.id);
  check(tc, ids.includes(first.id) && ids.includes(second.id), 'Lọc Cần tôi duyệt (TN) có cả hai báo giá vừa trình', ids.length);
  const forTn = await tn.get(quoteUrl(first.id));
  const forNv1 = await nv1.get(quoteUrl(first.id));
  check(tc, forTn.awaitingMyApproval?.procedureInstanceId === instanceId && !forNv1.awaitingMyApproval, 'Chi tiết báo giá: awaitingMyApproval có với TN, rỗng với NV1');
});

// =====================================================================================================================
// Trình duyệt
// =====================================================================================================================
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function login(code) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto(`${values.base}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(`${code}@${values.tenant}.local`);
  await page.locator('input[type="password"]').first().fill(config.password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return { context, page };
}
const goto = async (page, hash) => {
  await page.goto(`${values.base}/modules/crm${hash}`);
  await page.reload();
  await page.waitForTimeout(3000);
};

await group('TC-TSK-13', async () => {
  const tc = 'TC-TSK-13';
  const { context, page } = await login('tn');
  try {
    await goto(page, '#tasks');
    const main = await page.locator('main').innerText();
    check(tc, main.includes('Chờ tôi duyệt') && main.includes('Việc của tôi'), 'Trang có hai bảng Chờ tôi duyệt, Việc của tôi');
    check(tc, main.includes(first.code) && main.includes(second.code), 'Bảng Chờ tôi duyệt có hai báo giá vừa trình');
    const nav = await page.locator('nav, aside').first().innerText();
    check(tc, nav.includes('Việc cần xử lý'), 'Thanh bên có mục Việc cần xử lý');
  } finally {
    await context.close();
  }
});

await group('TC-TSK-14', async () => {
  const tc = 'TC-TSK-14';
  const { context, page } = await login('tn');
  try {
    await goto(page, '#tasks');
    const row = page.locator('tr', { hasText: first.code }).first();
    await row.getByRole('link', { name: /Duyệt trên Quy trình/ }).or(row.getByRole('button', { name: /Duyệt trên Quy trình/ })).first().click();
    await page.waitForURL((u) => u.pathname.startsWith('/modules/procedure'), { timeout: 20000 });
    check(tc, new URL(page.url()).searchParams.get('returnTo') === '/modules/crm#tasks', 'Mở hồ sơ bên Quy trình kèm returnTo về Việc cần xử lý', page.url());
    await page.getByText(/Thông tin cần duyệt/i).first().waitFor({ timeout: 20000 });
    const block = await page.locator('body').innerText();
    // Tiêu đề khối viết hoa bằng CSS: so không phân biệt hoa thường.
    check(tc, /thông tin cần duyệt/i.test(block) && block.includes(first.code) && block.includes('Khách hàng'), 'TC-TSK-04: hồ sơ có khối Thông tin cần duyệt (mã báo giá, khách hàng)');
    check(tc, block.includes('Mở từ Bán hàng'), 'Dải quay về ghi "Mở từ Bán hàng"');
    check(tc, block.includes('Bán hàng: Báo giá'), 'TC-TSK-04: hàng Nguồn ghi "Bán hàng: Báo giá"');
    await page.locator('button:visible', { hasText: /^Phê duyệt$/ }).last().click();
    // Hộp xác nhận lớn của Quy trình (QT-L3): nút "Đồng ý phê duyệt".
    await page.getByText('Xác nhận phê duyệt bước này?').first().waitFor({ timeout: 10000 });
    await page.locator('button:visible', { hasText: /^Đồng ý phê duyệt$/ }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/modules/crm') && u.hash.startsWith('#tasks'), { timeout: 30000 });
    check(tc, true, 'Duyệt xong tự quay về trang Việc cần xử lý của CRM', page.url());
    const approved = await waitFor(async () => {
      const current = await nv1.get(quoteUrl(first.id));
      return current.version.status === 'APPROVED' ? current : null;
    });
    check(tc, approved?.version.status === 'APPROVED', 'Báo giá sang Đã duyệt');
    await page.reload();
    await page.waitForTimeout(3000);
    const after = await page.locator('main').innerText();
    check(tc, !after.includes(first.code) && after.includes(second.code), 'Báo giá vừa duyệt hết trong danh sách, báo giá kia còn');
  } finally {
    await context.close();
  }
});

await group('TC-TSK-11', async () => {
  const tc = 'TC-TSK-11';
  const owner = await nv1.get(`${crm}/v1/my-tasks`);
  check(tc, owner.mine.some((task) => task.quoteId === first.id && task.kind === 'QUOTE_READY_TO_SEND'), 'NV1: Việc của tôi có báo giá đã duyệt chờ gửi khách');
});

await group('TC-TSK-16', async () => {
  const tc = 'TC-TSK-16';
  const { context, page } = await login('tn');
  try {
    await goto(page, '#quotes');
    const main = await page.locator('main').innerText();
    check(tc, /Cần tôi duyệt \(\d+\)/.test(main), 'Danh sách báo giá có khối Cần tôi duyệt (n)', main.match(/Cần tôi duyệt \(\d+\)/)?.[0]);
    await page.locator('label', { hasText: /^\s*Cần tôi duyệt\s*$/ }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(2500);
    const filtered = await page.locator('section[aria-label="Danh sách báo giá"]').innerText();
    check(tc, filtered.includes(second.code) && !filtered.includes(first.code), 'Bộ lọc Cần tôi duyệt: chỉ còn báo giá đang chờ TN');
  } finally {
    await context.close();
  }
  const other = await login('nv3');
  try {
    await goto(other.page, '#quotes');
    const text = await other.page.locator('main').innerText();
    check(tc, !/Cần tôi duyệt \(\d+\)/.test(text), 'NV3 (không có việc chờ) không thấy khối');
  } finally {
    await other.context.close();
  }
});

await group('TC-TSK-17', async () => {
  const tc = 'TC-TSK-17';
  const { context, page } = await login('tn');
  try {
    await goto(page, `#quotes/${second.id}`);
    const text = await page.locator('main').innerText();
    check(tc, text.includes('Báo giá này đang chờ bạn duyệt'), 'TN mở báo giá đang chờ: có dòng thông báo');
    const link = page.getByRole('link', { name: /Duyệt trên Quy trình/ }).first();
    const href = (await link.count()) ? await link.getAttribute('href') : '';
    check(tc, (href ?? '').includes(`#workspace/${second.procedure.instanceId}`) && (href ?? '').includes('returnTo='), 'Nút Duyệt trên Quy trình trỏ đúng hồ sơ, có returnTo', href);
  } finally {
    await context.close();
  }
  const owner = await login('nv1');
  try {
    await goto(owner.page, `#quotes/${second.id}`);
    const text = await owner.page.locator('main').innerText();
    check(tc, !text.includes('Báo giá này đang chờ bạn duyệt'), 'NV1 (người trình) không thấy dòng thông báo');
  } finally {
    await owner.context.close();
  }
});

await browser.close();

console.log('\nKết quả theo TC:');
let passed = 0;
for (const [tc, entry] of [...results.entries()].sort()) {
  const ok = entry.fail === 0 && entry.pass > 0;
  if (ok) passed += 1;
  console.log(`  ${tc.padEnd(12)} ${ok ? 'ĐẠT' : 'LỖI'}           ${entry.pass} đạt, ${entry.fail} lỗi`);
}
console.log(`\nTổng: ${passed}/${results.size} TC đạt.`);
process.exitCode = passed === results.size ? 0 : 1;
