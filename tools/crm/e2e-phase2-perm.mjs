// Ma trận quyền cho API mới của phase 2 (TC-P2PERM-01): mỗi tài khoản gọi từng route, so với kỳ vọng.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2-perm.mjs [--tenant=svn]
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { createSessions } from './seed-svn/common.mjs';

const { values } = parseArgs({ options: { tenant: { type: 'string', default: 'svn' } } });
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const sessions = createSessions(config);
const ACCOUNTS = ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK', 'QTBH', 'QTV'];
const S = Object.fromEntries(await Promise.all(ACCOUNTS.map(async (a) => [a, await sessions.as(a)])));
const nv1 = S.NV1;
// Dữ liệu của NV1 để thử phạm vi: một dự án thầu có hồ sơ và tài liệu (do e2e-phase2e/uat tạo), và một báo giá có PAKD
const opps = await nv1.get(`${crm}/v1/opportunities?pageSize=100`);
const tenderOpp = (opps.items ?? opps).find((o) => o.pipeline?.code === 'TENDER_STANDARD');
const quotes = await nv1.get(`${crm}/v1/quotes?pageSize=50`);
const quote = (quotes.items ?? quotes)[0];
const ok = [200, 201, 204];
// route: [mô tả, method, đường dẫn, body, tài khoản được phép (2xx), tài khoản bị 403 hoặc 404 (còn lại không kiểm)]
const ALL_CRM_READ = ['NV1', 'NV3', 'TN', 'QL', 'KT', 'QTBH', 'QTV'];
const routes = [
  ['Danh sách luồng (cấu hình)', 'GET', '/v1/pipelines', undefined, ['QTBH', 'QTV'], ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK']],
  ['Mẫu luồng', 'GET', '/v1/pipelines/templates', undefined, ['QTBH', 'QTV'], ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK']],
  ['Tạo luồng', 'POST', '/v1/pipelines', { code: 'X', name: 'X' }, [], ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK']],
  ['Luồng cho giao diện (đọc)', 'GET', '/v1/opportunities/pipelines', undefined, ALL_CRM_READ, ['TK']],
  ['Loại tài liệu (đọc)', 'GET', '/v1/document-types', undefined, ALL_CRM_READ, ['TK']],
  ['Tạo loại tài liệu', 'POST', '/v1/document-types', { code: 'X', name: 'X' }, [], ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK']],
  ['Cấu hình so lệch PAKD (đọc)', 'GET', '/v1/quote-approval/business-plan-settings', undefined, ALL_CRM_READ, ['TK']],
  ['Cấu hình so lệch PAKD (ghi)', 'PUT', '/v1/quote-approval/business-plan-settings', { mode: 'PROFIT', thresholdPercent: 5 }, ['QTBH', 'QTV'], ['NV1', 'NV3', 'TN', 'QL', 'KT', 'TK']],
  ['Báo cáo thầu', 'GET', '/v1/reports/tender', undefined, ['QL', 'QTV'], ['NV1', 'NV3', 'TK']],
  ['Việc của tôi', 'GET', '/v1/opportunities/my-stage-tasks', undefined, ALL_CRM_READ, ['TK']],
  ...(tenderOpp ? [
    ['Hồ sơ thầu của NV1 (phạm vi)', 'GET', `/v1/opportunities/${tenderOpp.id}/tender`, undefined, ['NV1', 'TN', 'QL', 'QTV'], ['NV3', 'TK']],
    ['Danh sách tài liệu của dự án thầu (phạm vi)', 'GET', `/v1/documents?entityType=opportunity&entityId=${tenderOpp.id}`, undefined, ['NV1', 'TN', 'QL', 'QTV'], ['NV3', 'TK']],
    ['Kế hoạch giai đoạn (phạm vi)', 'GET', `/v1/opportunities/${tenderOpp.id}/stage-plan`, undefined, ['NV1', 'TN', 'QL', 'QTV'], ['NV3', 'TK']],
  ] : []),
  ...(quote ? [
    ['PAKD của báo giá NV1 (phạm vi)', 'GET', `/v1/quotes/${quote.id}/versions/1/business-plan`, undefined, ['NV1', 'TN', 'QL', 'QTV'], ['NV3', 'TK']],
  ] : []),
];
let bad = 0;
const rows = [];
for (const [label, method, path, body, allowed, denied] of routes) {
  const statuses = {};
  for (const a of ACCOUNTS) {
    const r = await S[a].call(method, `${crm}${path}`, { body, expect: [400, 401, 403, 404, 409, 422] });
    statuses[a] = r.status;
    const isAllowed = allowed.includes(a);
    const isDenied = denied.includes(a);
    // Bị từ chối: 403 hoặc 404. Được phép: không phải 401, 403, 404 (400 do body thử vẫn tính là qua quyền).
    if (isDenied && ![403, 404].includes(r.status)) { bad += 1; console.log(`LỖI  ${label} [${a}] phải bị từ chối, nhận ${r.status}`); }
    if (isAllowed && [401, 403, 404].includes(r.status)) { bad += 1; console.log(`LỖI  ${label} [${a}] phải được phép, nhận ${r.status}`); }
  }
  rows.push([label, method, ACCOUNTS.map((a) => `${a}=${statuses[a]}`).join(' ')]);
}
// Dọn dữ liệu thử do phép gọi POST của tài khoản có quyền (luồng 'X', loại tài liệu 'X')
for (const pipeline of (await S.QTBH.get(`${crm}/v1/pipelines`)).filter((p) => p.code === 'X')) {
  await S.QTBH.call('DELETE', `${crm}/v1/pipelines/${pipeline.id}`, { expect: [409] });
}
console.log('\nMa trận (trạng thái HTTP):');
for (const [label, method, line] of rows) console.log(`${method.padEnd(4)} ${label.padEnd(46)} ${line}`);
console.log(`\nTổng: ${routes.length} route x ${ACCOUNTS.length} tài khoản, ${bad} lỗi`);
process.exit(bad ? 1 : 0);
