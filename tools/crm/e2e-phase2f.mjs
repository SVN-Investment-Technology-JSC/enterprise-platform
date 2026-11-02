// Kiểm GĐ F phase 2 (gợi ý chăm sóc lại khi Thua, cờ theo luồng, chân dung khách, đối thủ, ghi chú đơn) bằng API thật.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2f.mjs [--tenant=svn]
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
const [nv1, nv3, qtbh] = await Promise.all(['NV1', 'NV3', 'QTBH'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;
const pipelines = await nv1.get(`${crm}/v1/opportunities/pipelines`);
const std = pipelines.find((p) => p.isDefault);
const tender = pipelines.find((p) => p.profile === 'TENDER');
check('TC-CARE-05 mặc định: luồng thường bật gợi ý, luồng thầu tắt', std.careSuggestion === true && tender.careSuggestion === false, `${std.careSuggestion}/${tender.careSuggestion}`);

const lose = async (pipelineId, name) => {
  const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId, name: `P2F-${stamp} ${name}`, expectedValue: 1_000_000 });
  return nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage: 'LOST', version: opp.version, reason: 'Khách chọn nhà cung cấp khác' }, expect: [400, 409] });
};
let r = await lose(std.id, 'thua thường');
check('TC-CARE-01 Thua ở luồng thường: server báo careSuggestion.enabled = true', r.status < 300 && r.data?.careSuggestion?.enabled === true, `${r.status} ${JSON.stringify(r.data?.careSuggestion)}`);

const t = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: tender.id, name: `P2F-${stamp} thua thầu`, expectedValue: 1_000_000 });
r = await nv1.call('PATCH', `${crm}/v1/opportunities/${t.id}/stage`, { body: { stage: 'LOST', version: t.version, reason: 'Không tham gia' }, expect: [400, 409] });
check('TC-CARE-04 Thua ở luồng thầu: không gợi ý chăm sóc', r.status < 300 && !r.data?.careSuggestion?.enabled, `${r.status} ${JSON.stringify(r.data?.careSuggestion)}`);

const denied = await nv1.call('PUT', `${crm}/v1/opportunities/pipelines/${std.id}/care-suggestion`, { body: { careSuggestion: false }, expect: [403] });
check('TC-CARE-05 NV1 đổi cờ gợi ý: 403', denied.status === 403, String(denied.status));
const bad = await qtbh.call('PUT', `${crm}/v1/opportunities/pipelines/${tender.id}/care-suggestion`, { body: { careSuggestion: true }, expect: [400] });
check('TC-CARE-05 luồng thầu không bật gợi ý được (400)', bad.status === 400, String(bad.status));
await qtbh.put(`${crm}/v1/opportunities/pipelines/${std.id}/care-suggestion`, { careSuggestion: false });
r = await lose(std.id, 'thua tắt gợi ý');
check('TC-CARE-05 tắt cờ: Thua không gợi ý', r.status < 300 && !r.data?.careSuggestion?.enabled, `${r.status} ${JSON.stringify(r.data?.careSuggestion)}`);
await qtbh.put(`${crm}/v1/opportunities/pipelines/${std.id}/care-suggestion`, { careSuggestion: true });
r = await lose(std.id, 'thua bật lại');
check('TC-CARE-05 bật lại: Thua gợi ý trở lại', r.status < 300 && r.data?.careSuggestion?.enabled === true, `${r.status}`);

// TC-CARE-06: chân dung khách
const cust = await nv1.get(`${crm}/v1/customers/${kh.id}`);
const prof = await nv1.put(`${crm}/v1/customers/${kh.id}/profile`, { profileNote: `Khách ưu tiên giao hàng buổi sáng ${stamp}`, version: cust.version });
const again = await nv1.get(`${crm}/v1/customers/${kh.id}`);
check('TC-CARE-06 chân dung khách lưu và đọc lại', again.profileNote?.includes(`${stamp}`) && prof.version > cust.version, `v${cust.version} -> v${prof.version}`);
const stale = await nv1.call('PUT', `${crm}/v1/customers/${kh.id}/profile`, { body: { profileNote: 'x', version: cust.version }, expect: [409] });
check('TC-CARE-06 sai version: 409', stale.status === 409, String(stale.status));
const outProf = await nv3.call('PUT', `${crm}/v1/customers/${kh.id}/profile`, { body: { profileNote: 'x', version: again.version }, expect: [403, 404] });
check('TC-CARE-06 NV3 ngoài phạm vi: 404', outProf.status === 404, String(outProf.status));

// TC-CARE-07: đối thủ
const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2F-${stamp} đối thủ`, expectedValue: 2_000_000 });
const upd = await nv1.patch(`${crm}/v1/opportunities/${opp.id}`, { name: opp.name, version: opp.version, competitorName: 'Công ty ABC', competitorPrice: 1_750_000 });
check('TC-CARE-07 lưu đối thủ và giá đối thủ', upd.competitorName === 'Công ty ABC' && Number(upd.competitorPrice) === 1_750_000, `${upd.competitorName}/${upd.competitorPrice}`);
const neg = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}`, { body: { name: opp.name, version: upd.version, competitorPrice: -5 }, expect: [400] });
check('TC-CARE-07 giá đối thủ âm: 400', neg.status === 400, String(neg.status));

// TC-CARE-08: ghi chú đơn bán
const orders = await nv1.get(`${crm}/v1/orders?pageSize=5`);
const order = (orders.items ?? orders)[0];
if (!order) console.log('BỊ CHẶN  TC-CARE-08: NV1 không có đơn bán nào');
else {
  const od = await nv1.get(`${crm}/v1/orders/${order.id}`);
  const note = await nv1.call('PUT', `${crm}/v1/orders/${order.id}/info-note`, { body: { revision: od.revision, infoNote: `Giao hàng giờ hành chính ${stamp}` }, expect: [403, 409] });
  const od2 = await nv1.get(`${crm}/v1/orders/${order.id}`);
  check('TC-CARE-08 ghi chú đơn: lưu kèm người và thời điểm', note.status < 300 && /hành chính/.test(od2.infoNote ?? '') && !!od2.infoNotedAt && !!od2.infoNotedBy, `${note.status} ${od2.infoNotedAt}`);
}
const failed = results.filter((x) => !x.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
