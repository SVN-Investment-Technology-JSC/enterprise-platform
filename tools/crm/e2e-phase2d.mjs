// Kiểm GĐ D phase 2 (phương án kinh doanh, ngưỡng so lệch, quyền xem giá vốn, dự toán của dự án) bằng API thật.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2d.mjs [--tenant=svn]
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
const [nv1, nv3, ql, ktv, qtbh] = await Promise.all(['NV1', 'NV3', 'QL', 'KTV', 'QTBH'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const materials = await materialsByCode(config, ql);
const stamp = Date.now() % 1_000_000;

// Báo giá nháp có doanh thu và giá vốn
const quote = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id });
const qid = quote.id ?? quote.quote?.id;
let q = await nv1.get(`${crm}/v1/quotes/${qid}`);
q = await nv1.post(`${crm}/v1/quotes/${qid}/versions/1/lines`, { revision: q.version.revision, materialId: materials.get('QA-KHO-CAP').id, quantity: 10 });
const base = `${crm}/v1/quotes/${qid}/versions/1/business-plan`;

// TC-BP-01: lập PAKD, tính lợi nhuận
const none = await nv1.get(base);
check('TC-BP-01 chưa lập PAKD thì GET trả null', none === null || none === '' || none === undefined, JSON.stringify(none));
const plan = await nv1.put(base, { note: 'PAKD thử', lines: [{ kind: 'DISCOUNT', amount: 100000 }, { kind: 'SUBCONTRACT', description: 'Thầu phụ lắp đặt', amount: 300000 }, { kind: 'OTHER', amount: 50000 }] });
const f = plan.figures;
check('TC-BP-01 PAKD có dòng chi phí và số liệu (doanh thu, giá vốn, chi phí, lợi nhuận)', plan.lines?.length === 3 && f && ['revenue', 'goodsCost', 'extraCostTotal', 'totalCost', 'profit'].every((k) => k in f) && f.profit === f.revenue - f.totalCost, JSON.stringify(f).slice(0, 200));
const sumLines = plan.lines.reduce((s, l) => s + Number(l.amount), 0);
check('TC-BP-01 tổng chi phí = tổng các dòng (450.000)', sumLines === 450000, String(sumLines));

// TC-BP-14: ghi đè đồng thời
const stale = await nv1.call('PUT', base, { body: { version: plan.version + 50, lines: [{ kind: 'OTHER', amount: 1 }] }, expect: [409, 400] });
check('TC-BP-14 sai version: 409', stale.status === 409, `${stale.status} ${stale.data?.code ?? ''}`);
const ok = await nv1.put(base, { version: plan.version, lines: [{ kind: 'DISCOUNT', amount: 100000 }, { kind: 'OTHER', amount: 50000 }] });
check('TC-BP-14 đúng version: sửa được, version tăng', ok.version > plan.version && ok.lines.length === 2, `v${plan.version} -> v${ok.version}`);

// Dòng không hợp lệ
const neg = await nv1.call('PUT', base, { body: { version: ok.version, lines: [{ kind: 'OTHER', amount: -5 }] }, expect: [400] });
check('TC-BP-02/13 số tiền âm bị từ chối (400, tiếng Việt)', neg.status === 400, `${neg.status} ${neg.data?.message ?? ''}`.slice(0, 100));

// TC-BP-09: quyền xem giá vốn
const asNv1 = await nv1.get(base);
const asKtv = await ktv.call('GET', base, { expect: [403, 404] });
check('TC-BP-09 người có quyền lập (NV1) thấy giá vốn và lợi nhuận', asNv1?.figures && asNv1.figures.profit !== undefined, JSON.stringify(asNv1?.figures).slice(0, 100));
const ktvHidden = asKtv.status === 200 && (asKtv.data?.figures === null || asKtv.data?.figures === undefined) && !JSON.stringify(asKtv.data).includes('"profit"');
check('TC-BP-09 người chỉ có quyền xem (KTV) không thấy giá vốn, lợi nhuận', ktvHidden || [403, 404].includes(asKtv.status), `${asKtv.status} ${JSON.stringify(asKtv.data).slice(0, 100)}`);
const ktvQuote = await ktv.call('GET', `${crm}/v1/quotes/${qid}`, { expect: [403, 404] });
check('TC-BP-09 chi tiết báo giá cho KTV: cờ costHidden', ktvQuote.status !== 200 || ktvQuote.data?.costHidden === true || ktvQuote.data?.version?.costHidden === true, `${ktvQuote.status} costHidden=${ktvQuote.data?.costHidden}`);

// Phạm vi
const out = await nv3.call('GET', base, { expect: [403, 404] });
check('Phạm vi: NV3 xem PAKD của NV1 bị 404', out.status === 404, String(out.status));

// TC-BP-08: cài đặt ngưỡng, chế độ (chỉ crm.manage)
const cur = await nv1.get(`${crm}/v1/quote-approval/business-plan-settings`);
check('TC-BP-08/P2-D15 mặc định so theo lợi nhuận, ngưỡng 5%', cur.mode === 'PROFIT' && Number(cur.thresholdPercent) === 5, JSON.stringify(cur));
const denied = await nv1.call('PUT', `${crm}/v1/quote-approval/business-plan-settings`, { body: { mode: 'DISCOUNT', thresholdPercent: 10 }, expect: [403] });
check('TC-BP-08 NV1 đổi cấu hình: 403', denied.status === 403, String(denied.status));
const set = await qtbh.put(`${crm}/v1/quote-approval/business-plan-settings`, { mode: 'DISCOUNT', thresholdPercent: 10 });
const back = await qtbh.put(`${crm}/v1/quote-approval/business-plan-settings`, { mode: 'PROFIT', thresholdPercent: 5 });
check('TC-BP-08 QTBH (crm.manage) đổi chế độ và ngưỡng, rồi trả lại mặc định', set.mode === 'DISCOUNT' && Number(set.thresholdPercent) === 10 && back.mode === 'PROFIT', JSON.stringify(set));
const badTh = await qtbh.call('PUT', `${crm}/v1/quote-approval/business-plan-settings`, { body: { mode: 'PROFIT', thresholdPercent: 150 }, expect: [400] });
check('TC-BP-08 ngưỡng ngoài 0–100 bị từ chối (400)', badTh.status === 400, String(badTh.status));

// TC-BP-03: trình duyệt báo giá kèm PAKD (trực tiếp hoặc qua Quy trình), PAKD khoá cùng báo giá
const submit = await nv1.call('POST', `${crm}/v1/quotes/${qid}/versions/1/submit`, { body: { revision: (await nv1.get(`${crm}/v1/quotes/${qid}`)).version.revision }, expect: [400, 409] });
const afterSubmit = await nv1.get(base);
check('TC-BP-03 trình duyệt báo giá: PAKD được đính vào hồ sơ và khoá sửa', submit.status < 300 && ['PENDING_APPROVAL', 'SUBMITTED', 'PENDING'].includes(afterSubmit?.status), `submit ${submit.status}, PAKD ${afterSubmit?.status}`);
const editLocked = await nv1.call('PUT', base, { body: { version: afterSubmit?.version, lines: [{ kind: 'OTHER', amount: 1 }] }, expect: [409, 400, 403] });
check('TC-BP-03 PAKD đang chờ duyệt không sửa được', [400, 403, 409].includes(editLocked.status), String(editLocked.status));

// TC-BP-12: dự toán của dự án
const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2D-${stamp} dự toán`, expectedValue: 5000000 });
const upd = await nv1.patch(`${crm}/v1/opportunities/${opp.id}`, { name: opp.name, version: opp.version, estimateTotalValue: 4800000, estimateCostValue: 3900000 });
check('TC-BP-12 lưu tổng giá trị dự toán và giá vốn dự kiến', Number(upd.estimateTotalValue) === 4800000 && Number(upd.estimateCostValue) === 3900000, `${upd.estimateTotalValue}/${upd.estimateCostValue}`);
const negEst = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}`, { body: { name: opp.name, version: upd.version, estimateTotalValue: -1 }, expect: [400] });
check('TC-BP-12 dự toán âm bị từ chối (400)', negEst.status === 400, String(negEst.status));

const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
