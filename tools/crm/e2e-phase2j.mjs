// Kiểm GĐ J phase 2 (khuyến mãi theo dự án, danh mục khuyến mãi, chọn tài liệu có sẵn) bằng API thật.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2j.mjs [--tenant=svn]
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
const [nv1, nv3, ktv, qtbh, ql] = await Promise.all(['NV1', 'NV3', 'KTV', 'QTBH', 'QL'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;
const materials = await materialsByCode(config, ql);

// Danh mục (cần crm.manage)
const mk = (kind, n, extra = {}) => ({ kind, code: `P2J${stamp}${n}`, name: `P2J ${kind} ${n}`, discountType: 'PERCENT', value: 5, ...extra });
const denied = await nv1.call('POST', `${crm}/v1/promotions/catalog`, { body: mk('PROGRAM', 'X'), expect: [403] });
check('TC-QF-17 NV1 tạo danh mục khuyến mãi: 403', denied.status === 403, String(denied.status));
const prog = await qtbh.post(`${crm}/v1/promotions/catalog`, mk('PROGRAM', 'A'));
const pol = await qtbh.post(`${crm}/v1/promotions/catalog`, mk('DISCOUNT_POLICY', 'B', { discountType: 'AMOUNT', value: 200000 }));
const expired = await qtbh.post(`${crm}/v1/promotions/catalog`, mk('PROGRAM', 'C', { validFrom: '2020-01-01', validTo: '2020-12-31' }));
check('TC-QF-17 QTBH tạo chương trình và chính sách chiết khấu; mã viết hoa', prog.id && pol.id && prog.code === prog.code.toUpperCase() && prog.effective === true && expired.effective === false, `${prog.code} ${pol.code}`);
const dupCode = await qtbh.call('POST', `${crm}/v1/promotions/catalog`, { body: { ...mk('PROGRAM', 'A'), code: prog.code.toLowerCase() }, expect: [409] });
check('TC-QF-17 trùng mã (không phân biệt hoa thường): 409', dupCode.status === 409, String(dupCode.status));
const badPct = await qtbh.call('POST', `${crm}/v1/promotions/catalog`, { body: mk('PROGRAM', 'D', { value: 150 }), expect: [400] });
check('TC-QF-17 phần trăm vượt 100: 400', badPct.status === 400, String(badPct.status));
const list = await nv1.get(`${crm}/v1/promotions/catalog`);
const items = Array.isArray(list) ? list : list.items ?? [];
check('TC-QF-17 NV1 đọc danh mục, mặc định chỉ mục đang bật', items.some((i) => i.id === prog.id), `${items.length}`);

// Dự án
const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2J-${stamp} khuyến mãi`, expectedValue: 5000000 });
const forbid = await nv3.call('GET', `${crm}/v1/opportunities/${opp.id}/promotions`, { expect: [403, 404] });
check('TC-QF-17 NV3 xem khuyến mãi dự án của NV1: 404', forbid.status === 404, String(forbid.status));
const link1 = await nv1.post(`${crm}/v1/opportunities/${opp.id}/promotions`, { catalogId: prog.id, note: 'Áp dụng quý 4' });
const link2 = await nv1.post(`${crm}/v1/opportunities/${opp.id}/promotions`, { catalogId: pol.id });
check('TC-QF-17 gắn nhiều khuyến mãi vào dự án', link1.length === 1 && link2.length === 2, `${link2.length}`);
const dupLink = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/promotions`, { body: { catalogId: prog.id }, expect: [409] });
const expLink = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/promotions`, { body: { catalogId: expired.id }, expect: [409] });
check('TC-QF-17 chọn trùng và chọn mục hết hiệu lực: 409', dupLink.status === 409 && expLink.status === 409, `${dupLink.status}/${expLink.status}`);
const ktvWrite = await ktv.call('POST', `${crm}/v1/opportunities/${opp.id}/promotions`, { body: { catalogId: pol.id }, expect: [403, 404] });
check('TC-QF-17 người không có quyền ghi dự án: 403/404', [403, 404].includes(ktvWrite.status), String(ktvWrite.status));

// Báo giá
const q = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, opportunityId: opp.id });
const qid = q.id ?? q.quote?.id;
let d = await nv1.get(`${crm}/v1/quotes/${qid}`);
const url = `${crm}/v1/quotes/${qid}/versions/${d.version.versionNo ?? 1}/promotions`;
const before = JSON.stringify(d.version.totals);
const set = await nv1.put(url, { catalogIds: [prog.id, pol.id], revision: d.version.revision });
check('TC-QF-17 chọn nhiều khuyến mãi cho báo giá, lưu ảnh chụp', set.promotions?.length === 2 && set.promotions.every((p) => p.code && p.name), JSON.stringify(set.promotions?.map((p) => p.code)));
d = await nv1.get(`${crm}/v1/quotes/${qid}`);
check('TC-QF-17 khuyến mãi chỉ là thông tin kèm theo, tổng không đổi', JSON.stringify(d.version.totals) === before && d.version.promotions?.length === 2, before.slice(0, 80));
const stale = await nv1.call('PUT', url, { body: { catalogIds: [prog.id], revision: 0 }, expect: [409] });
check('TC-QF-17 sai revision: 409', stale.status === 409, String(stale.status));
const other = await qtbh.post(`${crm}/v1/promotions/catalog`, mk('PROGRAM', 'E'));
const notIn = await nv1.call('PUT', url, { body: { catalogIds: [other.id], revision: set.revision }, expect: [400] });
check('TC-QF-17 khuyến mãi ngoài tập của dự án: 400', notIn.status === 400, String(notIn.status));
const q2 = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id });
const q2id = q2.id ?? q2.quote?.id;
const d2 = await nv1.get(`${crm}/v1/quotes/${q2id}`);
const noOpp = await nv1.call('PUT', `${crm}/v1/quotes/${q2id}/versions/1/promotions`, { body: { catalogIds: [prog.id], revision: d2.version.revision }, expect: [409] });
check('TC-QF-17 báo giá không có dự án mà chọn khuyến mãi: 409', noOpp.status === 409, String(noOpp.status));
// Khoá sau khi gửi duyệt (cần có dòng hàng)
await nv1.post(`${crm}/v1/quotes/${qid}/versions/1/lines`, { revision: (await nv1.get(`${crm}/v1/quotes/${qid}`)).version.revision, materialId: materials.get('QA-KHO-CAP').id, quantity: 2 });
d = await nv1.get(`${crm}/v1/quotes/${qid}`);
const submit = await nv1.call('POST', `${crm}/v1/quotes/${qid}/versions/1/submit`, { body: { revision: d.version.revision }, expect: [200, 201, 400, 409] });
const locked = await nv1.call('PUT', url, { body: { catalogIds: [prog.id], revision: (await nv1.get(`${crm}/v1/quotes/${qid}`)).version.revision }, expect: [409, 400] });
check('TC-QF-17 phiên bản đã gửi duyệt không sửa khuyến mãi: 409', submit.status < 300 && locked.status === 409, `submit ${submit.status}, sửa ${locked.status}`);
// Gỡ khỏi dự án không làm mất ảnh chụp
const left = await nv1.call('DELETE', `${crm}/v1/opportunities/${opp.id}/promotions/${link1[0].id}`, { expect: [200, 204] });
d = await nv1.get(`${crm}/v1/quotes/${qid}`);
check('TC-QF-17 bỏ khuyến mãi khỏi dự án: ảnh chụp trên báo giá giữ nguyên', left.status < 300 && d.version.promotions?.length === 2, String(left.status));
// Tắt danh mục
const off = await qtbh.call('PUT', `${crm}/v1/promotions/catalog/${pol.id}`, { body: { ...mk('DISCOUNT_POLICY', 'B', { discountType: 'AMOUNT', value: 200000 }), code: pol.code, active: false }, expect: [200] });
check('TC-QF-17 vô hiệu hoá mục danh mục', off.status === 200 && off.data?.active === false, String(off.status));

// Chọn tài liệu có sẵn (TC-QF-12)
const bytes = Buffer.from('tai lieu mau 1');
const types = await nv1.get(`${crm}/v1/document-types`);
const created = await nv1.post(`${crm}/v1/documents`, { entityType: 'opportunity', entityId: opp.id, documentTypeId: types[0].id, name: 'Tài liệu dự án', fileName: 'mau.pdf', contentType: 'application/pdf', sizeBytes: bytes.length });
await fetch(created.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }, body: bytes });
await nv1.post(`${crm}/v1/documents/${created.document.id}/versions/${created.version.id}/complete`, { sizeBytes: bytes.length });
const cands = await nv1.get(`${crm}/v1/quotes/${qid}/document-candidates?sourceType=opportunity`);
const cand = cands.find((c) => c.document.id === created.document.id);
check('TC-QF-12 ứng viên tài liệu từ dự án của báo giá', !!cand && cand.attached === false, `${cands.length}`);
const refs = await nv1.post(`${crm}/v1/quotes/${qid}/document-references`, { documentId: created.document.id });
check('TC-QF-12 đính kèm tham chiếu vào báo giá', refs.length === 1 && refs[0].document.id === created.document.id, `${refs.length}`);
const dupRef = await nv1.call('POST', `${crm}/v1/quotes/${qid}/document-references`, { body: { documentId: created.document.id }, expect: [409] });
check('TC-QF-12 đính kèm trùng: 409', dupRef.status === 409, String(dupRef.status));
const dl = await nv1.get(`${crm}/v1/quotes/${qid}/document-references/${refs[0].id}/download`);
const got = await fetch(dl.downloadUrl);
check('TC-QF-12 tải qua URL ký, đúng nội dung', got.status === 200 && (await got.text()) === 'tai lieu mau 1', String(got.status));
const noPerm = await nv3.call('POST', `${crm}/v1/quotes/${qid}/document-references`, { body: { documentId: created.document.id }, expect: [403, 404] });
check('TC-QF-12 báo giá ngoài phạm vi (NV3) không đính kèm được: 403/404', [403, 404].includes(noPerm.status), String(noPerm.status));
const out = await nv3.call('GET', `${crm}/v1/quotes/${qid}/document-candidates?sourceType=opportunity`, { expect: [403, 404] });
check('TC-QF-12 NV3 ngoài phạm vi không xem được ứng viên: 404', out.status === 404, String(out.status));
const rm = await nv1.call('DELETE', `${crm}/v1/quotes/${qid}/document-references/${refs[0].id}`, { expect: [200, 204] });
const refs2 = await nv1.get(`${crm}/v1/quotes/${qid}/document-references`);
const still = await nv1.get(`${crm}/v1/documents/${created.document.id}`);
check('TC-QF-12 gỡ tham chiếu, tài liệu nguồn còn nguyên', rm.status < 300 && refs2.length === 0 && still.document?.id === created.document.id || still.id === created.document.id, String(rm.status));

const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
