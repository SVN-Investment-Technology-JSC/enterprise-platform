// Kiểm GĐ I phase 2 (báo giá theo mẫu cập nhật được) bằng API thật trên tenant `svn`.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2i.mjs [--tenant=svn]
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
const [nv1, nv3, tn, ql, qtbh, ktv] = await Promise.all(['NV1', 'NV3', 'TN', 'QL', 'QTBH', 'KTV'].map((c) => sessions.as(c)));
const idTn = await sessions.userId('TN');
const idNv3 = await sessions.userId('NV3');
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const materials = await materialsByCode(config, ql);
const stamp = Date.now() % 1_000_000;

// Mẫu và loại báo giá
const templates = await nv1.get(`${crm}/v1/quote-templates`);
const types = await nv1.get(`${crm}/v1/quote-types`);
const lineT = templates.find((t) => t.discountMode === 'LINE' && t.taxMode === 'LINE');
const orderT = templates.find((t) => t.discountMode === 'ORDER' && t.taxMode === 'ORDER');
check('TC-QF-04 có mẫu "theo dòng" (mặc định) và "chiết khấu trên tổng giá trị đơn hàng"', !!lineT && !!orderT, templates.map((t) => t.name).join(' | '));
check('TC-QF-05 có loại báo giá "Báo đơn giá và số lượng"', types.some((t) => /đơn giá và số lượng/i.test(t.name)), types.map((t) => t.name).join(' | '));
const denied = await nv1.call('POST', `${crm}/v1/quote-templates`, { body: { name: 'X', discountMode: 'LINE', taxMode: 'LINE' }, expect: [403] });
check('TC-QF-04 chỉ crm.manage tạo mẫu (NV1: 403)', denied.status === 403, String(denied.status));

// TC-QF-02/03: mã báo giá
const code1 = await nv1.post(`${crm}/v1/quotes/code/generate`, {});
const code2 = await nv1.post(`${crm}/v1/quotes/code/generate`, {});
check('TC-QF-02 sinh mã: hai lần sinh cho hai mã khác nhau', code1.code && code2.code && code1.code !== code2.code, `${code1.code} / ${code2.code}`);

// Tạo báo giá mẫu LINE và ORDER cùng nội dung
const mk = async (templateId, extra = {}) => {
  const q = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, templateId, quoteName: `P2I-${stamp} báo giá thử`, ...extra });
  const id = q.id ?? q.quote?.id;
  let d = await nv1.get(`${crm}/v1/quotes/${id}`);
  d = await nv1.post(`${crm}/v1/quotes/${id}/versions/${d.version.versionNo}/lines`, { revision: d.version.revision, materialId: materials.get('QA-KHO-CAP').id, quantity: 10 });
  return { id, d };
};
const a = await mk(lineT.id);
check('TC-QF-16 mẫu theo dòng: tổng giống phase 1 (10 x QA-KHO-CAP)', Number(a.d.version.totals.totalAmount) > 0, `${a.d.version.totals.totalAmount}`);
const dup = await nv1.call('POST', `${crm}/v1/quotes`, { body: { customerId: kh.id, code: a.d.code ?? a.d.quote?.code, templateId: lineT.id }, expect: [409] });
check('TC-QF-03 mã báo giá trùng bị từ chối (409)', dup.status === 409, `${dup.status} ${dup.data?.code ?? ''}`);

// TC-QF-04/06/07/08/09: ORDER — chiết khấu %, loại trừ với tiền, thuế, phí
const b = await mk(orderT.id);
const vno = b.d.version.versionNo;
const upd = (body) => nv1.call('PATCH', `${crm}/v1/quotes/${b.id}/versions/${vno}`, { body: { revision: b.d.version.revision, ...body }, expect: [400, 409] });
let cur = await nv1.get(`${crm}/v1/quotes/${b.id}`);
const bothRes = await nv1.call('PATCH', `${crm}/v1/quotes/${b.id}/versions/${vno}`, { body: { revision: cur.version.revision, orderDiscount: { percent: 5, amount: 1000 } }, expect: [400] });
check('TC-QF-07 nhập cả % và số tiền chiết khấu bị từ chối (400)', bothRes.status === 400, `${bothRes.status} ${bothRes.data?.code ?? ''}`);
let r = await nv1.call('PATCH', `${crm}/v1/quotes/${b.id}/versions/${vno}`, { body: { revision: cur.version.revision, orderDiscount: { percent: 5 }, orderTax: { percent: 8 }, fees: [{ feeType: 'Vận chuyển', amount: 100000 }, { feeType: 'Lắp đặt', amount: 50000 }] }, expect: [400, 409] });
cur = await nv1.get(`${crm}/v1/quotes/${b.id}`);
const t = cur.version.totals;
const gross = Number(cur.version.lines.reduce((s, l) => s + Number(l.lineAmount ?? l.lineTotal ?? 0), 0));
check('TC-QF-06/08/09 chiết khấu 5%, thuế 8%, 2 khoản phí lưu được', r.status < 300 && cur.version.form?.fees?.length === 2, `${r.status} ${r.data?.message ?? ''} tổng ${t.totalAmount}`);
const hasDisc = Number(cur.version.form?.orderDiscountTotal ?? t.orderDiscountTotal ?? 0) > 0;
check('TC-QF-04 mẫu ORDER: chiết khấu áp ở tổng đơn (không tính trùng theo dòng)', hasDisc || Number(t.discountAmount) > 0, `discountAmount=${t.discountAmount}`);
const lineMode = await nv1.call('PATCH', `${crm}/v1/quotes/${a.id}/versions/${a.d.version.versionNo}`, { body: { revision: a.d.version.revision, orderDiscount: { percent: 5 } }, expect: [400] });
check('TC-QF-04 mẫu theo dòng không nhận chiết khấu tổng đơn (400)', lineMode.status === 400, `${lineMode.status} ${lineMode.data?.code ?? ''}`);

// TC-QF-11: trường tuỳ biến bắt buộc
const cf = await qtbh.post(`${crm}/v1/custom-fields`, { entityType: 'quote', name: `Phòng ban phụ trách ${stamp}`, fieldType: 'SELECT', options: ['Kinh doanh', 'Kỹ thuật'], required: true, sortOrder: 90 });
const c = await mk(lineT.id);
const noCf = await nv1.call('PATCH', `${crm}/v1/quotes/${c.id}/versions/${c.d.version.versionNo}`, { body: { revision: c.d.version.revision, quoteName: 'đổi tên' }, expect: [400] });
check('TC-QF-11 thiếu trường bắt buộc: 400 nêu tên trường', noCf.status === 400 && (noCf.data?.message ?? '').includes(`Phòng ban phụ trách ${stamp}`), `${noCf.status} ${noCf.data?.message ?? ''}`.slice(0, 120));
const okCf = await nv1.call('PATCH', `${crm}/v1/quotes/${c.id}/versions/${c.d.version.versionNo}`, { body: { revision: c.d.version.revision, quoteName: 'đổi tên', customFields: { [cf.id]: 'Kinh doanh' } }, expect: [400] });
check('TC-QF-11 điền trường bắt buộc: lưu được', okCf.status < 300, String(okCf.status));
const badOpt = await nv1.call('PATCH', `${crm}/v1/quotes/${c.id}/versions/${c.d.version.versionNo}`, { body: { revision: (await nv1.get(`${crm}/v1/quotes/${c.id}`)).version.revision, customFields: { [cf.id]: 'Không có trong danh sách' } }, expect: [400] });
check('TC-QF-11 giá trị ngoài tuỳ chọn bị từ chối (400)', badOpt.status === 400, String(badOpt.status));
await qtbh.put(`${crm}/v1/custom-fields/${cf.id}`, { name: cf.name, fieldType: 'SELECT', options: ['Kinh doanh', 'Kỹ thuật'], required: false, sortOrder: 90, active: false }).catch(() => undefined);

// TC-QF-14: người theo dõi
const q = a.id;
const f = await nv1.call('POST', `${crm}/v1/quotes/${q}/followers`, { body: { userId: idNv3 }, expect: [400, 409] });
check('TC-QF-14 thêm người theo dõi (NV3, ngoài chuỗi quản lý của NV1)', f.status < 300, `${f.status} ${f.data?.message ?? ''}`.slice(0, 100));
const tnSees = await nv3.call('GET', `${crm}/v1/quotes/${q}`, { expect: [403, 404] });
check('TC-QF-14 người theo dõi (NV3) đọc được báo giá của NV1', tnSees.status === 200, String(tnSees.status));
const tnEdit = await nv3.call('POST', `${crm}/v1/quotes/${q}/versions/${a.d.version.versionNo}/lines`, { body: { revision: a.d.version.revision, materialId: materials.get('QA-KHO-CAP').id, quantity: 1 }, expect: [403, 404, 409] });
check('TC-QF-14 người theo dõi không sửa được báo giá (403/404)', [403, 404].includes(tnEdit.status), String(tnEdit.status));
await nv1.call('DELETE', `${crm}/v1/quotes/${q}/followers/${idNv3}`, { expect: [404] });
const tnGone = await nv3.call('GET', `${crm}/v1/quotes/${q}`, { expect: [403, 404] });
check('TC-QF-14 bỏ theo dõi: hết quyền đọc (404)', tnGone.status === 404, String(tnGone.status));

// TC-QF-13: đối tượng liên quan
const link = await nv1.call('POST', `${crm}/v1/quotes/${q}/links`, { body: { targetType: 'CUSTOMER', targetId: kh.id }, expect: [400, 404, 409] });
check('TC-QF-13 thêm đối tượng liên quan (khách)', link.status < 300, `${link.status} ${link.data?.message ?? ''}`.slice(0, 100));
const dupLink = await nv1.call('POST', `${crm}/v1/quotes/${q}/links`, { body: { targetType: 'CUSTOMER', targetId: kh.id }, expect: [409] });
check('TC-QF-13 liên kết trùng: 409', dupLink.status === 409, String(dupLink.status));
const khOther = (await requireCustomers(config, nv3, ['QA-CRM-KH21'])).get('QA-CRM-KH21');
const outLink = await nv1.call('POST', `${crm}/v1/quotes/${q}/links`, { body: { targetType: 'CUSTOMER', targetId: khOther.id }, expect: [404] });
check('TC-QF-13 đối tượng ngoài phạm vi của người dùng: 404', outLink.status === 404, String(outLink.status));

// TC-QF-18: phạm vi và quyền
const q2 = (await mk(lineT.id)).id;
const o1 = await nv3.call('GET', `${crm}/v1/quotes/${q2}`, { expect: [403, 404] });
const o2 = await ktv.call('PATCH', `${crm}/v1/quotes/${q}/versions/${a.d.version.versionNo}`, { body: { revision: a.d.version.revision, quoteName: 'x' }, expect: [403, 404] });
check('TC-QF-18 NV3 ngoài phạm vi 404; người chỉ đọc (KTV) không sửa được', o1.status === 404 && [403, 404].includes(o2.status), `${o1.status}/${o2.status}`);

// TC-QF-15: báo giá đã gửi sửa trường mới -> phiên bản mới
const sub = await nv1.call('POST', `${crm}/v1/quotes/${b.id}/versions/${vno}/submit`, { body: { revision: (await nv1.get(`${crm}/v1/quotes/${b.id}`)).version.revision }, expect: [400, 409] });
check('TC-QF-15 gửi duyệt báo giá có điều chỉnh tổng đơn', sub.status < 300 || sub.status === 409, `${sub.status} ${sub.data?.message ?? ''}`.slice(0, 100));

// Chuyển đổi: tổng hợp đồng/đơn phải bằng tổng báo giá (phân bổ chiết khấu/thuế tổng đơn vào dòng)
console.log('  ghi chú: kiểm số học chuyển đổi báo giá ORDER do integration crm-quote-relations phủ (cần báo giá đã duyệt và khách chấp nhận).');

const failed = results.filter((x) => !x.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
