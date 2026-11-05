// Kiểm GĐ G phase 2 (cấu hình luồng cho quản trị viên) bằng API thật. Tạo luồng thử `P2G_<số>` từ mẫu, tắt ở cuối.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2g.mjs [--tenant=svn]
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { createSessions, requireCustomers } from './seed-svn/common.mjs';

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
const [nv1, ql, qtbh] = await Promise.all(['NV1', 'QL', 'QTBH'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;
const P = `${crm}/v1/pipelines`;
const find = (list, id) => list.find((p) => p.id === id);

// TC-CFG-08: quyền
const d1 = await nv1.call('GET', P, { expect: [403] });
const d2 = await ql.call('GET', P, { expect: [403] });
const d3 = await nv1.call('POST', P, { body: { code: 'X', name: 'X' }, expect: [403] });
check('TC-CFG-08 NV1 và QL (không crm.manage) bị 403 khi đọc, ghi cấu hình luồng', [d1, d2, d3].every((r) => r.status === 403), [d1, d2, d3].map((r) => r.status).join('/'));
const all0 = await qtbh.get(P);
check('TC-CFG-08 QTBH (crm.manage) đọc được cấu hình', Array.isArray(all0) && all0.length >= 2, `${all0.length} luồng`);

// TC-CFG-07: mẫu luồng
const templates = await qtbh.get(`${P}/templates`);
check('TC-CFG-07 có 3 mẫu luồng (bán hàng đơn giản, có PAKD, chào thầu)', templates.length === 3, templates.map((t) => t.id).join(','));
let list = await qtbh.post(P, { code: `P2G_${stamp}`, name: `Luồng thử ${stamp}`, templateId: 'SALES_SIMPLE' });
let pipe = list.find((p) => p.code === `P2G_${stamp}`);
check('TC-CFG-07 tạo luồng từ mẫu: đúng giai đoạn của mẫu, không phải mặc định', pipe && pipe.stages.map((s) => s.code).join(',').includes('WON') && pipe.isDefault === false, pipe?.stages.map((s) => s.code).join(','));
const stage = (code) => pipe.stages.find((s) => s.code === code);

// TC-CFG-01: thêm giai đoạn
list = await qtbh.post(`${P}/${pipe.id}/stages`, { code: 'SAMPLE', name: 'Gửi mẫu', semantic: 'OPEN', defaultProbability: 30 });
pipe = find(list, pipe.id);
check('TC-CFG-01 thêm giai đoạn "Gửi mẫu" (OPEN)', !!stage('SAMPLE') && stage('SAMPLE').semantic === 'OPEN', pipe.stages.map((s) => s.code).join(','));
// bước chuyển hợp lệ tới/từ giai đoạn mới
const firstOpen = pipe.stages.find((s) => s.semantic === 'OPEN' && s.code !== 'SAMPLE');
list = await qtbh.put(`${P}/${pipe.id}/stages/${firstOpen.id}/transitions`, { toStageIds: [...firstOpen.nextStageIds, stage('SAMPLE').id] });
pipe = find(list, pipe.id);
const win = pipe.stages.find((s) => s.semantic === 'WON');
const lose = pipe.stages.find((s) => s.semantic === 'LOST');
list = await qtbh.put(`${P}/${pipe.id}/stages/${stage('SAMPLE').id}/transitions`, { toStageIds: [win.id, lose.id] });
pipe = find(list, pipe.id);
check('TC-CFG-01 giai đoạn mới có bước chuyển hợp lệ', stage('SAMPLE').nextStageIds.length === 2, JSON.stringify(stage('SAMPLE').nextStageIds.length));
const board = await nv1.get(`${crm}/v1/opportunities/board?pipelineId=${pipe.id}`);
check('TC-CFG-01 giai đoạn mới xuất hiện ở kanban của luồng', JSON.stringify(board).includes('Gửi mẫu'), '');

// TC-CFG-02: đổi thứ tự
const ids = pipe.stages.map((s) => s.id);
const reordered = [ids[ids.length - 1], ...ids.slice(0, -1)];
list = await qtbh.put(`${P}/${pipe.id}/stages/order`, { stageIds: reordered });
pipe = find(list, pipe.id);
check('TC-CFG-02 đổi thứ tự giai đoạn', pipe.stages[0].id === reordered[0], pipe.stages.map((s) => s.code).join(','));
list = await qtbh.put(`${P}/${pipe.id}/stages/order`, { stageIds: ids });
pipe = find(list, pipe.id);

// Dự án trong luồng, đứng ở giai đoạn SAMPLE (để kiểm CFG-03/04/10)
const first = pipe.stages.find((s) => s.sortOrder === Math.min(...pipe.stages.map((x) => x.sortOrder)) && s.semantic === 'OPEN');
let opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `P2G-${stamp} thử`, expectedValue: 1_000_000 });
const mv = (o, code, extra = {}) => nv1.call('PATCH', `${crm}/v1/opportunities/${o.id}/stage`, { body: { stage: code, version: o.version, ...extra }, expect: [400, 403, 409] });
// đảm bảo có bước chuyển từ giai đoạn đầu của dự án tới SAMPLE
const startStage = pipe.stages.find((s) => s.code === opp.stage);
list = await qtbh.put(`${P}/${pipe.id}/stages/${startStage.id}/transitions`, { toStageIds: [...new Set([...startStage.nextStageIds, stage('SAMPLE').id])] });
pipe = find(list, pipe.id);
let r = await mv(opp, 'SAMPLE');
check('TC-CFG-01 dự án chuyển được vào giai đoạn mới', r.status === 200, `${r.status} ${r.data?.message ?? ''}`);
opp = await nv1.get(`${crm}/v1/opportunities/${opp.id}`);

// TC-CFG-04 / 03: giai đoạn đang có dự án
const del = await qtbh.call('DELETE', `${P}/${pipe.id}/stages/${stage('SAMPLE').id}`, { expect: [409] });
check('TC-CFG-04 không xoá giai đoạn đang có dự án (409, đề nghị tắt)', del.status === 409 && /tắt/i.test(del.data?.message ?? ''), `${del.status} ${del.data?.message ?? ''}`.slice(0, 120));
list = await qtbh.patch(`${P}/${pipe.id}/stages/${stage('SAMPLE').id}`, { active: false });
pipe = find(list, pipe.id);
const still = await nv1.get(`${crm}/v1/opportunities/${opp.id}`);
check('TC-CFG-03 tắt giai đoạn đang có dự án: dự án vẫn xem được', still.stage === 'SAMPLE' && pipe.stages.find((s) => s.code === 'SAMPLE').active === false, still.stage);
r = await mv(still, lose.code, { reason: 'Thử cấu hình' });
check('TC-CFG-03 dự án ở giai đoạn đã tắt vẫn chuyển đi được', r.status === 200, `${r.status} ${r.data?.message ?? ''}`);
const opp2 = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `P2G-${stamp} thử 2`, expectedValue: 1 });
const into = await mv(opp2, 'SAMPLE');
check('TC-CFG-03 không chuyển mới vào giai đoạn đã tắt (409)', into.status === 409, `${into.status}`);

// TC-CFG-05: WON/LOST cuối cùng
const lastWon = await qtbh.call('PATCH', `${P}/${pipe.id}/stages/${win.id}`, { body: { active: false }, expect: [409] });
check('TC-CFG-05 không tắt giai đoạn WON cuối cùng (409)', lastWon.status === 409, `${lastWon.status} ${lastWon.data?.code ?? ''}`);
const delLost = await qtbh.call('DELETE', `${P}/${pipe.id}/stages/${lose.id}`, { expect: [409] });
check('TC-CFG-05 không xoá giai đoạn LOST cuối cùng (409)', delLost.status === 409, `${delLost.status} ${delLost.data?.code ?? ''}`);

// TC-CFG-06/11 + TC-CFG-09: điều kiện áp ngay ở lần chuyển kế tiếp (không dùng cache cũ)
const docTypes = await qtbh.get(`${crm}/v1/document-types`);
const legal = docTypes.find((t) => t.code === 'LEGAL_DOSSIER');
const opp3 = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `P2G-${stamp} điều kiện`, expectedValue: 1 });
const s3 = pipe.stages.find((s) => s.code === opp3.stage);
const target = pipe.stages.find((x) => x.id === s3.nextStageIds.find((id) => pipe.stages.find((y) => y.id === id)?.semantic === 'OPEN' && pipe.stages.find((y) => y.id === id)?.active));
list = await qtbh.put(`${P}/${pipe.id}/stages/${target.id}/requirements`, { requirements: [{ kind: 'DOCUMENT_TYPE', ref: legal.code, required: true, message: `Cần ${legal.name}` }] });
pipe = find(list, pipe.id);
const blocked = await mv(opp3, target.code);
check('TC-CFG-06/09 điều kiện tài liệu bắt buộc áp ngay ở lần chuyển kế tiếp (409)', blocked.status === 409, `${blocked.status} ${blocked.data?.message ?? ''}`.slice(0, 110));
list = await qtbh.put(`${P}/${pipe.id}/stages/${target.id}/requirements`, { requirements: [{ kind: 'DOCUMENT_TYPE', ref: legal.code, required: false, message: 'Nên có' }] });
pipe = find(list, pipe.id);
check('TC-CFG-11 lưu đúng cờ "bắt buộc" của điều kiện tài liệu', pipe.stages.find((s) => s.id === target.id).requirements[0].required === false, '');
const free = await mv(opp3, target.code);
check('TC-CFG-11 bỏ tick bắt buộc: chuyển được ngay (chỉ gợi ý)', free.status === 200, `${free.status}`);
const badRef = await qtbh.call('PUT', `${P}/${pipe.id}/stages/${target.id}/requirements`, { body: { requirements: [{ kind: 'DOCUMENT_TYPE', ref: 'KHONG_CO', required: true, message: 'x' }] }, expect: [400] });
check('TC-CFG-06 tham chiếu loại tài liệu không có thật bị từ chối (400)', badRef.status === 400, String(badRef.status));

// TC-CFG-10: lịch sử không bị viết lại
const hist = (await nv1.get(`${crm}/v1/opportunities/${opp.id}`)).history;
check('TC-CFG-10 lịch sử chuyển giai đoạn giữ nguyên sau khi đổi cấu hình', hist.some((h) => h.toStage === 'SAMPLE') && hist.some((h) => h.toStage === lose.code), `${hist.length} dòng`);

// Mặc định: không tắt, không xoá luồng mặc định
const def = all0.find((p) => p.isDefault);
const offDef = await qtbh.call('PATCH', `${P}/${def.id}`, { body: { active: false }, expect: [409, 400] });
const delDef = await qtbh.call('DELETE', `${P}/${def.id}`, { expect: [409, 400] });
check('Luồng mặc định không tắt, không xoá được', [offDef.status, delDef.status].every((s) => [400, 409].includes(s)), `${offDef.status}/${delDef.status}`);

// Dọn: tắt luồng thử (đã có dự án nên không xoá được)
const del2 = await qtbh.call('DELETE', `${P}/${pipe.id}`, { expect: [409] });
check('TC-CFG-04 luồng đang có dự án không xoá được (409)', del2.status === 409, String(del2.status));
await qtbh.patch(`${P}/${pipe.id}`, { active: false });
console.log('Đã tắt luồng thử', pipe.code);

const failed = results.filter((x) => !x.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
