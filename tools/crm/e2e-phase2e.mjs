// Kiểm GĐ E phase 2 (chào thầu): hai nhánh có và không có liên danh trọn luồng, bằng API thật.
// Cần S3 (MinIO hoặc tools/crm/mock-s3.mjs) cho bước tải hồ sơ pháp lý, dự toán.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase2e.mjs [--tenant=svn]
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
const [nv1, nv3, tn, ql, qtbh] = await Promise.all(['NV1', 'NV3', 'TN', 'QL', 'QTBH'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;

const pipelines = await nv1.get(`${crm}/v1/opportunities/pipelines`);
const tender = pipelines.find((p) => p.profile === 'TENDER');
const standard = pipelines.find((p) => p.isDefault);
check('TC-TND-01 luồng "Chào thầu" có sẵn với 6 giai đoạn', tender?.stages.map((s) => s.code).join(',') === 'HSMT,PREPARE,PLAN_REVIEW,SUBMITTED,WON,LOST', tender?.stages.map((s) => s.code).join(','));

const types = await nv1.get(`${crm}/v1/document-types`);
const typeId = (code) => types.find((t) => t.code === code).id;
const upload = async (oppId, code) => {
  const bytes = Buffer.from(`tai lieu ${code}`);
  const created = await nv1.post(`${crm}/v1/documents`, { entityType: 'opportunity', entityId: oppId, documentTypeId: typeId(code), fileName: `${code}.pdf`, contentType: 'application/pdf', sizeBytes: bytes.length });
  await fetch(created.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }, body: bytes });
  await nv1.post(`${crm}/v1/documents/${created.document.id}/versions/${created.version.id}/complete`, { sizeBytes: bytes.length });
};
const move = (session, opp, stage, extra = {}) => session.call('PATCH', `${crm}/v1/opportunities/${opp.id}/stage`, { body: { stage, version: opp.version, ...extra }, expect: [400, 403, 409] });
const reload = (session, id) => session.get(`${crm}/v1/opportunities/${id}`);
const future = new Date(Date.now() + 7 * 86400_000).toISOString();

async function runBranch(label, joint) {
  const tag = `${label} ${stamp}`;
  let opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: tender.id, name: `P2E-${tag} gói thầu`, expectedValue: 20_000_000 });
  check(`TC-TND-01 [${label}] tạo cơ hội luồng thầu: giai đoạn đầu HSMT`, opp.stage === 'HSMT' && opp.pipeline?.code === 'TENDER_STANDARD', `${opp.stage}`);
  const profile = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender`, { packageName: `Gói thầu ${tag}`, inviterName: 'Sở Thông tin', packageCode: `GT-${stamp}`, submissionDeadline: future, hasJointVenture: joint, scenario: joint ? 'Liên danh với đối tác A cung cấp phần mềm' : 'Tự thực hiện toàn bộ' });
  check(`TC-TND-01 [${label}] tạo hồ sơ thầu 1-1`, !!profile.id && profile.hasJointVenture === joint, `v${profile.version}`);
  const dup = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender`, { body: { packageName: 'x', inviterName: 'y' }, expect: [400, 409] });
  check(`TC-TND-13 [${label}] hồ sơ thầu thứ hai cho cùng cơ hội bị từ chối`, [400, 409].includes(dup.status), String(dup.status));

  opp = await reload(nv1, opp.id);
  let r = await move(nv1, opp, 'PREPARE');
  check(`[${label}] HSMT → PREPARE`, r.status === 200, String(r.status));
  opp = await reload(nv1, opp.id);
  r = await move(nv1, opp, 'PLAN_REVIEW');
  check(`TC-TND-02 [${label}] thiếu hồ sơ pháp lý và dự toán: 409 nêu loại tài liệu`, r.status === 409 && /Hồ sơ pháp lý|LEGAL_DOSSIER/.test(JSON.stringify(r.data)), `${r.status} ${r.data?.message ?? ''}`.slice(0, 130));
  await upload(opp.id, 'LEGAL_DOSSIER');
  await upload(opp.id, 'ESTIMATE');
  opp = await reload(nv1, opp.id);
  r = await move(nv1, opp, 'PLAN_REVIEW');
  check(`TC-TND-02 [${label}] đủ tài liệu: sang Chờ duyệt phương án`, r.status === 200, String(r.status));

  // Duyệt phương án: không duyệt thì trả về sửa
  let p = await nv1.get(`${crm}/v1/opportunities/${opp.id}/tender`);
  if (joint) {
    const needPartner = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/submit`, { body: { version: p.version }, expect: [400, 409] });
    check(`TC-TND-03 [${label}] có liên danh mà chưa có đối tác: không trình duyệt được`, [400, 409].includes(needPartner.status), `${needPartner.status} ${needPartner.data?.code ?? ''}`);
    p = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender/partners`, { name: 'Công ty đối tác A', scope: 'Phần mềm' });
    p = await nv1.put(`${crm}/v1/opportunities/${opp.id}/tender/partners/${p.partners[0].id}`, { name: 'Công ty đối tác A', scope: 'Phần mềm và triển khai' });
    check(`TC-TND-14 [${label}] thêm, sửa đối tác liên danh`, p.partners?.[0]?.scope === 'Phần mềm và triển khai', JSON.stringify(p.partners?.[0] ?? {}).slice(0, 100));
  }
  const submitted = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender/plan/submit`, { version: p.version });
  const mode = submitted.plan?.status ?? submitted.planStatus;
  check(`TC-TND-04 [${label}] ${joint ? '' : 'không liên danh vẫn '}trình duyệt phương án`, ['PENDING', 'PENDING_APPROVAL'].includes(mode), String(mode));
  const self = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/approve`, { body: { version: submitted.version }, expect: [403, 409] });
  check(`TC-TND-03 [${label}] người trình không tự duyệt`, [403, 409].includes(self.status), String(self.status));
  // Từ chối rồi trình lại (TC-TND-05) — chỉ làm ở nhánh liên danh để rút ngắn
  let cur = submitted;
  if (joint) {
    const rej = await tn.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/reject`, { body: { version: cur.version, reason: 'Cần bổ sung phạm vi liên danh' }, expect: [400, 403, 409] });
    check('TC-TND-05 TN từ chối phương án (có lý do)', rej.status < 300, `${rej.status} ${rej.data?.message ?? ''}`.slice(0, 100));
    cur = rej.data;
    const fix = await nv1.put(`${crm}/v1/opportunities/${opp.id}/tender`, { version: cur.version, scenario: 'Liên danh A, bổ sung phạm vi triển khai' });
    const again = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender/plan/submit`, { version: fix.version });
    check('TC-TND-05 sửa và trình lại: vòng duyệt mới, giữ lịch sử', (again.rounds?.length ?? 0) >= 2, `${again.rounds?.length} vòng`);
    cur = again;
  }
  // Chưa duyệt thì không sang Đã nộp
  opp = await reload(nv1, opp.id);
  r = await move(nv1, opp, 'SUBMITTED');
  check(`TC-TND-06 [${label}] chưa duyệt phương án: không sang Đã nộp (409)`, r.status === 409, `${r.status} ${r.data?.message ?? ''}`.slice(0, 120));
  const ok = await tn.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/approve`, { body: { version: cur.version }, expect: [400, 403, 409] });
  check(`TC-TND-03/04 [${label}] TN duyệt phương án`, ok.status < 300, `${ok.status} ${ok.data?.message ?? ''}`.slice(0, 100));

  // Thiếu hình thức nộp thì chặn (TC-TND-06)
  opp = await reload(nv1, opp.id);
  r = await move(nv1, opp, 'SUBMITTED');
  check(`TC-TND-06 [${label}] thiếu hình thức nộp: 409`, r.status === 409, `${r.status} ${r.data?.message ?? ''}`.slice(0, 120));
  p = await nv1.get(`${crm}/v1/opportunities/${opp.id}/tender`);
  p = await nv1.put(`${crm}/v1/opportunities/${opp.id}/tender`, { version: p.version, submissionMethod: 'ONLINE' });
  opp = await reload(nv1, opp.id);
  r = await move(nv1, opp, 'SUBMITTED');
  check(`TC-TND-06 [${label}] đủ phương án đã duyệt và hình thức nộp: sang Đã nộp`, r.status === 200, `${r.status} ${r.data?.message ?? ''}`.slice(0, 100));
  return { opp: await reload(nv1, opp.id), tag };
}

// Nhánh có liên danh: trúng thầu → hợp đồng
const a = await runBranch('liên danh', true);
{
  let p = await nv1.get(`${crm}/v1/opportunities/${a.opp.id}/tender`);
  const noReason = await nv1.call('POST', `${crm}/v1/opportunities/${a.opp.id}/tender/result`, { body: { version: p.version, result: 'WON' }, expect: [400, 409] });
  check('TC-TND-08 Trúng thiếu giá trúng bị từ chối (400)', noReason.status === 400, `${noReason.status} ${noReason.data?.code ?? ''}`);
  const won = await nv1.call('POST', `${crm}/v1/opportunities/${a.opp.id}/tender/result`, { body: { version: p.version, result: 'WON', winningPrice: 18_500_000 }, expect: [400, 409] });
  const after = await reload(nv1, a.opp.id);
  check('TC-TND-08 Trúng: cơ hội WON, có giá trúng và dữ liệu hợp đồng', won.status < 300 && after.stage === 'WON' && !!won.data?.contractDraft && Number(won.data.contractDraft.value) === 18_500_000, `${won.status} ${after.stage} draft=${JSON.stringify(won.data?.contractDraft ?? null).slice(0, 80)}`);
  const contract = won.data?.contractDraft ? await qtbh.call('POST', `${crm}/v1/contracts`, { body: won.data.contractDraft, expect: [400, 403, 409] }) : { status: 0 };
  check('TC-TND-08 QTBH (quyền hợp đồng) tạo được hợp đồng từ dữ liệu điền sẵn', contract.status === 201 || contract.status === 200, `${contract.status} ${contract.data?.message ?? ''}`.slice(0, 100));
}

// Nhánh không liên danh: trượt thầu → kết thúc
const b = await runBranch('không liên danh', false);
{
  let p = await nv1.get(`${crm}/v1/opportunities/${b.opp.id}/tender`);
  const noReason = await nv1.call('POST', `${crm}/v1/opportunities/${b.opp.id}/tender/result`, { body: { version: p.version, result: 'LOST' }, expect: [400, 409] });
  check('TC-TND-09 Trượt không lý do bị chặn', [400, 409].includes(noReason.status), `${noReason.status} ${noReason.data?.code ?? ''}`);
  const lost = await nv1.call('POST', `${crm}/v1/opportunities/${b.opp.id}/tender/result`, { body: { version: p.version, result: 'LOST', reason: 'Giá cao hơn đối thủ', winnerName: 'Công ty Đối Thủ', winningPrice: 15_000_000 }, expect: [400, 409] });
  const after = await reload(nv1, b.opp.id);
  check('TC-TND-09/10 Trượt: cơ hội LOST, ghi đơn vị trúng và lý do', lost.status < 300 && after.stage === 'LOST' && lost.data?.winnerName === 'Công ty Đối Thủ', `${lost.status} ${after.stage}`);
  const acts = await nv1.get(`${crm}/v1/activities?opportunityId=${b.opp.id}`).catch(() => ({ items: [] }));
  check('TC-TND-09 Trượt thầu không tự tạo hoạt động chăm sóc', (acts.items ?? acts).length === 0, `${(acts.items ?? acts).length} hoạt động`);
}

// TC-TND-13: cơ hội luồng thường không có hồ sơ thầu
const normal = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: standard.id, name: `P2E-${stamp} thường` });
const bad = await nv1.call('POST', `${crm}/v1/opportunities/${normal.id}/tender`, { body: { packageName: 'x', inviterName: 'y' }, expect: [400, 409] });
check('TC-TND-13 cơ hội luồng bán hàng thường không tạo được hồ sơ thầu', [400, 409].includes(bad.status), String(bad.status));

// TC-TND-12: phạm vi dữ liệu
const out = await nv3.call('GET', `${crm}/v1/opportunities/${a.opp.id}/tender`, { expect: [403, 404] });
check('TC-TND-12 NV3 ngoài phạm vi: 404', out.status === 404, String(out.status));

// TC-TND-11: báo cáo thầu
const rep = await ql.get(`${crm}/v1/reports/tender`);
const row = rep.rows?.find((r) => r.pipelineCode === 'TENDER_STANDARD');
check('TC-TND-11 báo cáo thầu theo luồng: có trúng, trượt và tỷ lệ trúng', !!row && row.byStatus.WON.count >= 1 && row.byStatus.LOST.count >= 1 && row.winRatePercent !== null, JSON.stringify(row?.byStatus ?? {}).slice(0, 140));
const nv1Rep = await nv1.call('GET', `${crm}/v1/reports/tender`, { expect: [403] });
check('TC-TND-11 người không có crm.report.read: 403', nv1Rep.status === 403, String(nv1Rep.status));

const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
