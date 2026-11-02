// Kiểm GĐ A phase 2 (TC-FB, TC-NAV) trên tenant `svn`, bằng API thật.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2a.mjs [--tenant=svn]
// Phần trình duyệt: tools/crm/e2e-phase2a-browser.mjs. Không ghi mật khẩu vào repo.
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { createSessions, materialsByCode, requireCustomers } from './seed-svn/common.mjs';

const { values } = parseArgs({ options: { tenant: { type: 'string', default: 'svn' } } });
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const results = [];
const check = (tc, ok, detail = '') => {
  results.push({ tc, ok });
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${detail}`);
};

const sessions = createSessions(config);
const nv1 = await sessions.as('NV1');
const nv3 = await sessions.as('NV3');
const qtbh = await sessions.as('QTBH');
const tk = await sessions.as('TK');
const ql = await sessions.as('QL');

// TC-FB-11/12: cờ Kho trong status
const st = (s) => s.get(`${crm}/v1/status`);
const [sNv1, sQl, sQtbh] = await Promise.all([st(nv1), st(ql), st(qtbh)]);
check('TC-FB-11 (QL có quyền Kho)', sQl.inventoryEntitled === true && sQl.canAccessInventory === true, JSON.stringify({ e: sQl.inventoryEntitled, c: sQl.canAccessInventory }));
check('TC-FB-12 (NV1 không có quyền Kho: hiện nhưng không bấm được)', sNv1.inventoryEntitled === true && sNv1.canAccessInventory === false, JSON.stringify({ e: sNv1.inventoryEntitled, c: sNv1.canAccessInventory }));
console.log('  ghi chú: QTBH', JSON.stringify({ e: sQtbh.inventoryEntitled, c: sQtbh.canAccessInventory }));

// TC-FB-13: server vẫn chặn Kho với NV1
const inv = await nv1.call('GET', `${config.inventoryApi}/v1/materials?all=true`, { expect: [401, 403, 404] });
check('TC-FB-13 (NV1 gọi API Kho bị chặn)', inv.status === 403, `HTTP ${inv.status}`);

// Chuẩn bị báo giá nháp của NV1
const customers = await requireCustomers(config, nv1, ['QA-CRM-KH01']);
const materials = await materialsByCode(config, ql);
const kh = customers.get('QA-CRM-KH01');
const quote = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id });
const quoteId = quote.id ?? quote.quote?.id;
let version = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
const batch = `${crm}/v1/quotes/${quoteId}/versions/${version.versionNo ?? 1}/lines/batch`;
const lines = (codes) => codes.map((code) => ({ materialId: materials.get(code).id, quantity: 2 }));

// TC-FB-05: một dòng lỗi thì không thêm dòng nào
const bad = await nv1.call('POST', batch, {
  body: { revision: version.revision, lines: [...lines(['QA-KHO-CAP', 'QA-KHO-MUC']), { materialId: '00000000-0000-0000-0000-000000000000', quantity: 1 }] },
  expect: [400, 404, 409, 422],
});
const afterBad = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
check('TC-FB-05 (dòng lỗi: không thêm dòng nào, trả lỗi theo dòng)', bad.status >= 400 && afterBad.lines.length === 0 && Array.isArray(bad.data?.errors) && bad.data.errors.length > 0, `HTTP ${bad.status}, ${JSON.stringify(bad.data?.errors?.[0] ?? bad.data).slice(0, 160)}`);

// Thêm lô hợp lệ
const ok = await nv1.call('POST', batch, { body: { revision: afterBad.revision, lines: lines(['QA-KHO-CAP', 'QA-KHO-MUC']) }, expect: [400, 409] });
const afterOk = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
check('TC-FB-01/05 (API lô hợp lệ thêm đúng 2 dòng, một lần)', ok.status < 300 && afterOk.lines.length === 2, `HTTP ${ok.status}, ${afterOk.lines.length} dòng`);

// TC-FB-06: báo giá không còn nháp thì 409 (dùng một báo giá đã có của NV1 ở trạng thái khác Nháp)
const page = await nv1.get(`${crm}/v1/quotes?pageSize=100`);
const nonDraft = (page.items ?? []).find((q) => q.status && q.status !== 'DRAFT');
if (nonDraft) {
  const detail = await nv1.get(`${crm}/v1/quotes/${nonDraft.id}`);
  const r = await nv1.call('POST', `${crm}/v1/quotes/${nonDraft.id}/versions/${detail.version.versionNo ?? 1}/lines/batch`, { body: { revision: detail.version.revision, lines: lines(['QA-KHO-CAP']) }, expect: [400, 409] });
  check('TC-FB-06 (báo giá không còn nháp: 409)', r.status === 409, `${nonDraft.code} ${nonDraft.status} -> HTTP ${r.status}`);
} else console.log('BỊ CHẶN  TC-FB-06 qua API: NV1 không có báo giá nào ngoài trạng thái Nháp');

// TC-FB-08: không có crm.manage thì tạo nhóm trả 403; TC-FB-09: nhóm trùng
const g403 = await nv1.call('POST', `${crm}/v1/customer-groups`, { body: { code: 'P2A-X', name: 'P2A thử' }, expect: [403] });
check('TC-FB-08 (NV1 tạo nhóm: 403)', g403.status === 403, `HTTP ${g403.status}`);
const dup = await qtbh.call('POST', `${crm}/v1/customer-groups`, { body: { code: 'QA-CRM-DL1', name: 'Đại lý cấp 1' }, expect: [400, 409] });
check('TC-FB-09 (nhóm trùng: 409 tiếng Việt)', dup.status === 409, `HTTP ${dup.status} ${JSON.stringify(dup.data).slice(0, 120)}`);

// Người ngoài phạm vi: NV3 không thêm được dòng vào báo giá của NV1
const out = await nv3.call('POST', batch, { body: { revision: 1, lines: lines(['QA-KHO-CAP']) }, expect: [403, 404, 409] });
check('Phạm vi: NV3 thêm lô dòng vào báo giá của NV1 bị từ chối (404/403)', [403, 404].includes(out.status), `HTTP ${out.status}`);
void tk;

const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
