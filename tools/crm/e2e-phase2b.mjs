// Kiểm GĐ B phase 2 (luồng cơ hội dạng dữ liệu, kế hoạch giai đoạn, gán người, bỏ qua giai đoạn) bằng API thật.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> TENANT_DATABASE_URL_TEMPLATE=... node tools/crm/e2e-phase2b.mjs [--tenant=svn]
// Dựng tạm cấu hình giai đoạn của luồng mặc định (skippable, quy tắc gán) trong DB local rồi trả lại như cũ.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { createSessions, requireCustomers } from './seed-svn/common.mjs';

const { values } = parseArgs({ options: { tenant: { type: 'string', default: 'svn' } } });
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const root = resolve(import.meta.dirname, '../..');
const results = [];
const check = (tc, ok, detail = '') => {
  results.push({ tc, ok });
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${detail}`);
};

async function withDb(fn) {
  const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
  if (!template) throw new Error('Thiếu TENANT_DATABASE_URL_TEMPLATE.');
  const url = new URL(template.replace('{databaseName}', values.tenant.replace(/-/g, '_')));
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`Từ chối DB không phải local: ${url.hostname}`);
  const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const sessions = createSessions(config);
const [nv1, nv2, nv3, tn, ql] = await Promise.all(['NV1', 'NV2', 'NV3', 'TN', 'QL'].map((c) => sessions.as(c)));
const [idNv1, idNv3, idTn] = await Promise.all(['NV1', 'NV3', 'TN'].map((c) => sessions.userId(c)));
const customers = await requireCustomers(config, nv1, ['QA-CRM-KH01']);
const kh = customers.get('QA-CRM-KH01');

// Cấu hình tạm: CONTACTED bỏ qua được; DISCOVERY gán quản lý trực tiếp; QUOTING gán chủ dự án; NEGOTIATION gán cố định TN
const original = await withDb(async (db) => (await db.query(`SELECT id, code, skippable, assignee_rule, assignee_param FROM crm_schema.pipeline_stages ps WHERE pipeline_id = (SELECT id FROM crm_schema.pipelines WHERE is_default)`)).rows);
const restore = () => withDb(async (db) => {
  for (const r of original) await db.query(`UPDATE crm_schema.pipeline_stages SET skippable=$2, assignee_rule=$3, assignee_param=$4 WHERE id=$1`, [r.id, r.skippable, r.assignee_rule, r.assignee_param]);
});
const setRule = (code, patch) => withDb((db) => db.query(
  `UPDATE crm_schema.pipeline_stages SET skippable=COALESCE($2, skippable), assignee_rule=COALESCE($3, assignee_rule), assignee_param=$4 WHERE code=$1 AND pipeline_id=(SELECT id FROM crm_schema.pipelines WHERE is_default)`,
  [code, patch.skippable ?? null, patch.rule ?? null, patch.param ?? null]));

try {
  await setRule('CONTACTED', { skippable: true });
  await setRule('DISCOVERY', { rule: 'DIRECT_MANAGER' });
  await setRule('QUOTING', { rule: 'PROJECT_OWNER' });
  await setRule('NEGOTIATION', { rule: 'FIXED_USER', param: idTn });
  // Cache cấu hình phía API ngắn (30 giây): chờ để lần đọc kế tiếp thấy cấu hình mới
  await new Promise((r) => setTimeout(r, 31_000));

  const stamp = Date.now() % 1_000_000;
  const create = (session, extra = {}) => session.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2B-${stamp} dự án thử`, expectedValue: 1_000_000, ...extra });
  const planOf = async (session, id) => (await session.get(`${crm}/v1/opportunities/${id}/stage-plan`)).items;
  const item = (items, code) => items.find((i) => i.stage.code === code);

  // TC-PL-04/11: luồng mặc định, giai đoạn đầu
  const pipelines = await nv1.get(`${crm}/v1/opportunities/pipelines`);
  const def = pipelines.find((p) => p.isDefault);
  check('TC-PL-01/04 luồng mặc định có 7 giai đoạn đúng thứ tự', def && def.stages.map((s) => s.code).join(',') === 'NEW,CONTACTED,DISCOVERY,QUOTING,NEGOTIATION,WON,LOST', def?.stages.map((s) => s.code).join(','));

  const opp = await create(nv1);
  check('TC-PL-11 tạo dự án vào luồng mặc định, giai đoạn đầu NEW', opp.stage === 'NEW' && opp.pipeline?.code === 'SALES_STANDARD', `${opp.stage} / ${opp.pipeline?.code}`);

  // TC-ASG-01/02: kế hoạch và gán người theo quy tắc
  const plan = await planOf(nv1, opp.id);
  check('TC-ASG-01 giai đoạn quy tắc "chủ dự án" gán NV1', item(plan, 'QUOTING')?.assigneeUserId === idNv1, String(item(plan, 'QUOTING')?.assigneeUserId));
  check('TC-ASG-02 quy tắc "quản lý trực tiếp" gán TN (sơ đồ công ty)', item(plan, 'DISCOVERY')?.assigneeUserId === idTn, String(item(plan, 'DISCOVERY')?.assigneeUserId));
  check('TC-ASG-04/05 quy tắc cố định gán đúng người', item(plan, 'NEGOTIATION')?.assigneeUserId === idTn);

  // TC-PL-06: chuyển không có trong bảng
  const bad = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage: 'NEGOTIATION', version: opp.version }, expect: [400, 409] });
  check('TC-PL-06 chuyển nhảy cách không có trong bảng: 409 tiếng Việt', bad.status === 409, `${bad.status} ${bad.data?.message ?? ''}`);
  // TC-PL-07: Thua cần lý do
  const lost = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage: 'LOST', version: opp.version }, expect: [400, 409] });
  check('TC-PL-07 sang Thua không lý do bị từ chối', [400, 409].includes(lost.status), `${lost.status} ${lost.data?.code ?? ''}`);

  // TC-SKP: bỏ qua giai đoạn
  const stageId = (code) => item(plan, code).stage.id;
  const s1 = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/stage-plan/${stageId('DISCOVERY')}/skip`, { body: { reason: 'thử' }, expect: [409] });
  check('TC-SKP-01 giai đoạn không cho bỏ qua: 409', s1.status === 409, `${s1.status} ${s1.data?.message ?? ''}`);
  const s2 = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/stage-plan/${stageId('CONTACTED')}/skip`, { body: {}, expect: [400] });
  check('TC-SKP-03 bỏ qua không lý do: 400', s2.status === 400, `${s2.status} ${s2.data?.code ?? ''}`);
  const s3 = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/stage-plan/${stageId('NEW')}/skip`, { body: { reason: 'thử' }, expect: [409] });
  check('TC-SKP-08 không bỏ qua giai đoạn hiện tại: 409', s3.status === 409, `${s3.status} ${s3.data?.code ?? ''}`);
  const s4 = await nv3.call('POST', `${crm}/v1/opportunities/${opp.id}/stage-plan/${stageId('CONTACTED')}/skip`, { body: { reason: 'thử' }, expect: [403, 404] });
  check('TC-SKP-09 người ngoài (NV3) bỏ qua giai đoạn: 403/404', [403, 404].includes(s4.status), String(s4.status));
  const s5 = await nv1.post(`${crm}/v1/opportunities/${opp.id}/stage-plan/${stageId('CONTACTED')}/skip`, { reason: 'Khách đã quen, không cần liên hệ' });
  check('TC-SKP-03 bỏ qua có lý do thành công', item(s5.items, 'CONTACTED')?.status === 'SKIPPED');

  // TC-SKP-04: chuyển tiến một bước tới giai đoạn kế còn áp dụng
  let cur = await nv1.get(`${crm}/v1/opportunities/${opp.id}`);
  cur = await nv1.patch(`${crm}/v1/opportunities/${opp.id}/stage`, { stage: 'DISCOVERY', version: cur.version }).catch((e) => ({ error: String(e.message).slice(0, 160) }));
  check('TC-SKP-04 chuyển tiến sang giai đoạn kế còn áp dụng (DISCOVERY, bỏ CONTACTED)', cur.stage === 'DISCOVERY', cur.error ?? cur.stage);
  const hist = (await nv1.get(`${crm}/v1/opportunities/${opp.id}`)).history ?? [];
  check('TC-SKP-06 lịch sử ghi giai đoạn bỏ qua (kind SKIP)', hist.some((h) => h.kind === 'SKIP'), `${hist.length} dòng`);

  // TC-ASG-09: DISCOVERY đang giao cho TN; NV2 (cùng nhóm, không phải chủ/người đảm nhận) không chuyển được
  let now = await nv1.get(`${crm}/v1/opportunities/${opp.id}`);
  const forbidden = await nv2.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage: 'QUOTING', version: now.version }, expect: [403, 404] });
  check('TC-ASG-09 người không được gán không chuyển giai đoạn: 403/404', [403, 404].includes(forbidden.status), String(forbidden.status));
  const byTn = await tn.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage: 'QUOTING', version: now.version }, expect: [403] });
  check('TC-ASG-09 người đảm nhận giai đoạn hiện tại (TN) chuyển được', byTn.status === 200 && byTn.data?.stage === 'QUOTING', `${byTn.status}`);

  // TC-ASG-06/07/08: ghi đè người đảm nhận; người được gán ngoài nhóm thấy dự án đó, không thấy dự án khác
  const other = await create(nv1, { name: `P2B-${stamp} dự án khác của khách` });
  const before = await nv3.call('GET', `${crm}/v1/opportunities/${opp.id}`, { expect: [403, 404] });
  check('TC-ASG-08 NV3 chưa được gán: 404', before.status === 404, String(before.status));
  const cur2 = await nv1.get(`${crm}/v1/opportunities/${opp.id}`);
  const plan2 = await planOf(nv1, opp.id);
  const assign = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage-plan/${item(plan2, 'NEGOTIATION').stage.id}/assignee`, { body: { assigneeUserId: idNv3 }, expect: [400, 403] });
  check('TC-ASG-06 ghi đè người đảm nhận theo dự án', assign.status === 200 && item(assign.data.items, 'NEGOTIATION')?.assigneeUserId === idNv3, String(assign.status));
  const plan3 = await planOf(nv1, other.id);
  check('TC-ASG-06 dự án khác giữ người đảm nhận theo quy tắc', item(plan3, 'NEGOTIATION')?.assigneeUserId === idTn);
  const seen = await nv3.call('GET', `${crm}/v1/opportunities/${opp.id}`, { expect: [403, 404] });
  const unseen = await nv3.call('GET', `${crm}/v1/opportunities/${other.id}`, { expect: [403, 404] });
  check('TC-ASG-07 NV3 được gán thấy dự án đó', seen.status === 200, String(seen.status));
  check('TC-ASG-07 NV3 không thấy dự án khác của cùng khách (404)', unseen.status === 404, String(unseen.status));
  const mine = await nv3.get(`${crm}/v1/opportunities/my-stage-tasks`);
  check('TC-ASG-10 "Việc của tôi" của NV3 có giai đoạn được giao', mine.some((t) => t.opportunityId === opp.id), `${mine.length} việc`);
  const nv3Assign = await nv3.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage-plan/${item(plan2, 'NEGOTIATION').stage.id}/assignee`, { body: { assigneeUserId: idNv3 }, expect: [403, 404] });
  check('TC-ASG-09 người được gán không tự đổi người đảm nhận: 403', nv3Assign.status === 403, String(nv3Assign.status));

  // TC-PL-12 / TC-P2REG-08: dashboard theo nghĩa giai đoạn
  const dash = await ql.get(`${crm}/v1/dashboard`).catch(() => null);
  const rows = dash?.pipeline ?? dash?.kpis?.pipelineStages ?? [];
  console.log('  ghi chú dashboard:', dash ? JSON.stringify(rows).slice(0, 160) : 'không đọc được /v1/dashboard');
} finally {
  await restore();
  console.log('Đã trả cấu hình giai đoạn của luồng mặc định về như cũ.');
}
const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
