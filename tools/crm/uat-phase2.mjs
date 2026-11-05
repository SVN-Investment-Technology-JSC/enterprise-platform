// Nhóm bước UAT phase 2 (P2H-02) của tools/crm/uat-e2e.mjs: TC-P2UAT-01 đến 08 qua API thật, đúng tài khoản từng bước.
// Kịch bản lấy từ tools/crm/e2e-phase2{a..g}.mjs. Ghi kết quả qua `record` của uat-e2e.mjs (PASS, FAIL, SKIP).
// Bước cần S3 (tải tài liệu qua URL ký, hồ sơ pháp lý của hồ sơ thầu) ghi SKIP kèm lý do khi S3 không trả lời.
// Nhóm tự dựng luồng thử `QA_P2U_<lượt>` (tắt ở cuối) và dữ liệu `QA-P2U-<lượt>`, không cần chạy --step=phase2 trước.
//
//   UAT-P2-01 luồng tuỳ biến (chuyển hợp lệ, không hợp lệ)      UAT-P2-05 chào thầu không liên danh (thua)
//   UAT-P2-02 PAKD (lập, trình, duyệt, cài đặt ngưỡng)          UAT-P2-06 gợi ý chăm sóc khi Thua
//   UAT-P2-03 tài liệu (tải lên, đối tượng xem, phạm vi)        UAT-P2-07 cấu hình luồng (QTBH)
//   UAT-P2-04 chào thầu có liên danh (trúng)                    UAT-P2-08 feedback giao diện (phần API)
import { requireCustomers } from './seed-svn/common.mjs';
import { s3Reachable, uploadDocument } from './seed-svn/phase2.mjs';

const SKIP_NO_S3 = 'S3 không trả lời (bật MinIO hoặc node tools/crm/mock-s3.mjs)';

export async function runPhase2Uat(config, sessions, ctx, record) {
  const crm = config.crmApi;
  const P = `${crm}/v1/pipelines`;
  const tag = `QA-P2U-${ctx.stamp}`;
  const [nv1, nv3, tn, ql, qtbh, ktv, admin] = await Promise.all(['NV1', 'NV3', 'TN', 'QL', 'QTBH', 'KTV', 'QTV'].map((code) => sessions.as(code)));
  const kh = (await requireCustomers(config, admin, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
  const s3 = await s3Reachable();
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  console.log(`\nPhase 2: S3 ${s3 ? 'sẵn' : 'KHÔNG sẵn (bước phụ thuộc S3 sẽ SKIP)'}\n`);

  const group = async (step, account, title, fn) => {
    const check = (condition, label, details = '', who = account) => record(step, who, label, condition ? 'PASS' : 'FAIL', details);
    const skip = (label, reason, who = account) => record(step, who, label, 'SKIP', reason);
    try {
      await fn(check, skip);
    } catch (error) {
      record(step, account, `${title}: lỗi khi gọi API`, 'FAIL', error instanceof Error ? error.message : String(error));
    }
  };
  const reload = (session, id) => session.get(`${crm}/v1/opportunities/${id}`);
  /** Chuyển giai đoạn bằng phiên bản mới nhất; trả về `{ status, data }`. */
  const move = async (session, id, stage, extra = {}) => {
    const opp = await reload(session, id);
    return session.call('PATCH', `${crm}/v1/opportunities/${id}/stage`, { body: { stage, version: opp.version, ...extra }, expect: [400, 403, 404, 409] });
  };
  const msg = (r) => `${r.status} ${r.data?.message ?? r.data?.code ?? ''}`.trim().slice(0, 110);

  const pipelines = await nv1.get(`${crm}/v1/opportunities/pipelines`);
  const standard = pipelines.find((p) => p.isDefault);
  const tender = pipelines.find((p) => p.profile === 'TENDER');
  const types = await nv1.get(`${crm}/v1/document-types`);
  const typeId = (code) => types.find((t) => t.code === code)?.id;

  // -------------------------------------------------------------------------
  // UAT-P2-01 và UAT-P2-07: luồng tuỳ biến, rồi quản trị viên đổi luồng khi đang có dự án (TC-P2UAT-01, 06)
  // -------------------------------------------------------------------------
  let pipe;
  await group('UAT-P2-01', 'NV1', 'Luồng tuỳ biến', async (check) => {
    const templates = await qtbh.get(`${P}/templates`);
    check(templates.length === 3, 'QTBH thấy 3 mẫu luồng (bán hàng đơn giản, có PAKD, chào thầu)', templates.map((t) => t.id).join(','), 'QTBH');
    const list = await qtbh.post(P, { code: `QA_P2U_${ctx.stamp}`, name: `Luồng thử ${tag}`, templateId: 'SALES_SIMPLE' });
    pipe = list.find((p) => p.code === `QA_P2U_${ctx.stamp}`);
    check(pipe?.stages.map((s) => s.code).join(',') === 'NEW,QUOTING,NEGOTIATION,WON,LOST' && pipe.isDefault === false, 'Tạo luồng 5 giai đoạn từ mẫu SALES_SIMPLE (không phải mặc định)', pipe?.stages.map((s) => s.code).join(','), 'QTBH');

    const created = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `${tag} luồng 5 giai đoạn`, expectedValue: 1_000_000 });
    check(created.stage === 'NEW' && created.pipeline?.code === pipe.code, 'NV1 tạo cơ hội vào luồng mới: giai đoạn đầu NEW', `${created.stage} / ${created.pipeline?.code}`);
    let r = await move(nv1, created.id, 'NEGOTIATION');
    check(r.status === 409, 'Chuyển nhảy NEW -> NEGOTIATION (không có trong bảng chuyển): 409', msg(r));
    r = await move(nv1, created.id, 'LOST');
    check([400, 409].includes(r.status), 'Sang Thua không lý do: bị từ chối', msg(r));
    r = await move(nv1, created.id, 'QUOTING');
    check(r.status === 200 && r.data?.stage === 'QUOTING', 'NEW -> QUOTING hợp lệ', msg(r));
    r = await move(nv1, created.id, 'NEGOTIATION');
    check(r.status === 200 && r.data?.stage === 'NEGOTIATION', 'QUOTING -> NEGOTIATION hợp lệ', msg(r));
    r = await move(nv1, created.id, 'WON');
    check(r.status === 409, 'NEGOTIATION -> WON khi chưa có báo giá Khách chấp nhận: 409 (điều kiện của mẫu)', msg(r));
    r = await move(nv1, created.id, 'LOST', { reason: 'Khách chọn nhà cung cấp khác' });
    check(r.status === 200 && r.data?.stage === 'LOST', 'NEGOTIATION -> LOST có lý do', msg(r));
    const outsider = await nv3.call('GET', `${crm}/v1/opportunities/${created.id}`, { expect: [403, 404] });
    check(outsider.status === 404, 'NV3 ngoài phạm vi không thấy cơ hội của NV1: 404', String(outsider.status), 'NV3');
    const denied = await nv1.call('POST', P, { body: { code: 'X', name: 'X' }, expect: [403] });
    check(denied.status === 403, 'NV1 (không crm.manage) tạo luồng: 403', String(denied.status));
  });

  await group('UAT-P2-07', 'QTBH', 'Cấu hình luồng', async (check, skip) => {
    if (!pipe) return skip('Cấu hình luồng', 'Không có luồng thử vì UAT-P2-01 không tạo được luồng', 'QTBH');
    const find = (list) => list.find((p) => p.id === pipe.id);
    const stage = (code) => pipe.stages.find((s) => s.code === code);
    let list = await qtbh.post(`${P}/${pipe.id}/stages`, { code: 'SAMPLE', name: 'Gửi mẫu', semantic: 'OPEN', defaultProbability: 30 });
    pipe = find(list);
    check(stage('SAMPLE')?.semantic === 'OPEN', 'Thêm giai đoạn "Gửi mẫu" khi luồng đang có cơ hội', pipe.stages.map((s) => s.code).join(','));
    const quoting = stage('QUOTING');
    list = await qtbh.put(`${P}/${pipe.id}/stages/${quoting.id}/transitions`, { toStageIds: [...new Set([...quoting.nextStageIds, stage('SAMPLE').id])] });
    pipe = find(list);
    list = await qtbh.put(`${P}/${pipe.id}/stages/${stage('SAMPLE').id}/transitions`, { toStageIds: [stage('WON').id, stage('LOST').id] });
    pipe = find(list);

    const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `${tag} cấu hình luồng`, expectedValue: 1_000_000 });
    await move(nv1, opp.id, 'QUOTING');
    let r = await move(nv1, opp.id, 'SAMPLE');
    check(r.status === 200, 'NV1 thấy ngay và chuyển được cơ hội vào giai đoạn mới', msg(r), 'NV1');
    const board = await nv1.get(`${crm}/v1/opportunities/board?pipelineId=${pipe.id}`);
    check(JSON.stringify(board).includes('Gửi mẫu'), 'Giai đoạn mới hiện ở kanban của luồng', '', 'NV1');

    const del = await qtbh.call('DELETE', `${P}/${pipe.id}/stages/${stage('SAMPLE').id}`, { expect: [409] });
    check(del.status === 409, 'Không xoá giai đoạn đang có cơ hội (409, đề nghị tắt)', msg(del));
    list = await qtbh.patch(`${P}/${pipe.id}/stages/${stage('SAMPLE').id}`, { active: false });
    pipe = find(list);
    const still = await reload(nv1, opp.id);
    check(still.stage === 'SAMPLE' && pipe.stages.find((s) => s.code === 'SAMPLE').active === false, 'Tắt giai đoạn đang có cơ hội: cơ hội không mất, vẫn xem được', still.stage, 'NV1');
    const other = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: pipe.id, name: `${tag} cấu hình luồng 2`, expectedValue: 1 });
    await move(nv1, other.id, 'QUOTING');
    r = await move(nv1, other.id, 'SAMPLE');
    check(r.status === 409, 'Không chuyển mới vào giai đoạn đã tắt: 409', msg(r), 'NV1');
    r = await move(nv1, opp.id, 'LOST', { reason: 'Thử cấu hình luồng' });
    check(r.status === 200, 'Cơ hội đứng ở giai đoạn đã tắt vẫn chuyển đi được', msg(r), 'NV1');
    const lastWon = await qtbh.call('PATCH', `${P}/${pipe.id}/stages/${stage('WON').id}`, { body: { active: false }, expect: [409] });
    check(lastWon.status === 409, 'Không tắt giai đoạn Thắng cuối cùng: 409', msg(lastWon));
    const asNv1 = await nv1.call('GET', P, { expect: [403] });
    check(asNv1.status === 403, 'NV1 đọc cấu hình luồng: 403', String(asNv1.status), 'NV1');
    const delPipe = await qtbh.call('DELETE', `${P}/${pipe.id}`, { expect: [409] });
    check(delPipe.status === 409, 'Luồng đang có cơ hội không xoá được: 409', msg(delPipe));
    await qtbh.patch(`${P}/${pipe.id}`, { active: false });
    const after = (await qtbh.get(P)).find((p) => p.id === pipe.id);
    check(after?.active === false, 'Tắt luồng thử khi dọn', `active=${after?.active}`);
  });

  // -------------------------------------------------------------------------
  // UAT-P2-02: PAKD (TC-P2UAT-01 phần PAKD, TC-P2UAT-02)
  // -------------------------------------------------------------------------
  await group('UAT-P2-02', 'NV1', 'PAKD', async (check, skip) => {
    const materials = await admin.get(`${crm}/v1/catalog/materials?q=QA-KHO`);
    const cap = materials.find((m) => m.code === 'QA-KHO-CAP');
    if (!cap) throw new Error('Chưa có mặt hàng QA-KHO-CAP trong danh mục.');
    const quote = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, note: `${tag} PAKD` });
    const quoteId = quote.id ?? quote.quote?.id;
    let detail = await nv1.get(`${crm}/v1/quotes/${quoteId}`);
    detail = await nv1.post(`${crm}/v1/quotes/${quoteId}/versions/${detail.version.versionNo}/lines`, { revision: detail.version.revision, materialId: cap.id, quantity: 10 });
    const base = `${crm}/v1/quotes/${quoteId}/versions/${detail.version.versionNo}/business-plan`;
    const none = await nv1.get(base);
    check(!none, 'Báo giá chưa có PAKD: GET trả rỗng', JSON.stringify(none));
    let plan = await nv1.put(base, { note: `${tag} PAKD`, lines: [{ kind: 'DISCOUNT', amount: 100_000 }, { kind: 'SUBCONTRACT', description: 'Thầu phụ lắp đặt', amount: 300_000 }, { kind: 'OTHER', amount: 50_000 }] });
    const f = plan.figures;
    check(plan.lines?.length === 3 && f && f.profit === f.revenue - f.totalCost, 'NV1 lập PAKD: lợi nhuận = doanh thu trừ tổng chi phí', JSON.stringify(f).slice(0, 140));
    const stale = await nv1.call('PUT', base, { body: { version: plan.version + 50, lines: [{ kind: 'OTHER', amount: 1 }] }, expect: [400, 409] });
    check(stale.status === 409, 'Lưu PAKD với version cũ: 409', msg(stale));
    const neg = await nv1.call('PUT', base, { body: { version: plan.version, lines: [{ kind: 'OTHER', amount: -5 }] }, expect: [400] });
    check(neg.status === 400, 'Chi phí âm bị từ chối: 400', msg(neg));
    plan = await nv1.get(base);

    const asKtv = await ktv.call('GET', base, { expect: [403, 404] });
    const hidden = [403, 404].includes(asKtv.status) || (asKtv.status === 200 && !asKtv.data?.figures && !JSON.stringify(asKtv.data).includes('"profit"'));
    check(hidden, 'KTV (chỉ có quyền xem) không thấy giá vốn, lợi nhuận của PAKD', `${asKtv.status}`, 'KTV');
    const outsider = await nv3.call('GET', base, { expect: [403, 404] });
    check(outsider.status === 404, 'NV3 ngoài phạm vi xem PAKD của NV1: 404', String(outsider.status), 'NV3');

    plan = await nv1.post(`${base}/submit`, { version: plan.version });
    check(plan.status === 'PENDING', 'NV1 trình duyệt PAKD: Chờ duyệt', plan.status);
    const locked = await nv1.call('PUT', base, { body: { version: plan.version, lines: [{ kind: 'OTHER', amount: 1 }] }, expect: [400, 403, 409] });
    check([400, 403, 409].includes(locked.status), 'PAKD đang chờ duyệt không sửa được', msg(locked));
    const self = await nv1.call('POST', `${base}/approve`, { body: { version: plan.version, reason: 'Tự duyệt' }, expect: [403, 409] });
    check([403, 409].includes(self.status), 'NV1 tự duyệt PAKD của mình bị chặn', msg(self));
    const approved = await tn.post(`${base}/approve`, { version: plan.version, reason: 'Duyệt trong UAT' });
    check(approved.status === 'APPROVED', 'TN duyệt PAKD: Đã duyệt', approved.status, 'TN');

    // Cài đặt ngưỡng so lệch (TC-BP-08); đổi rồi trả lại mặc định
    const cur = await nv1.get(`${crm}/v1/quote-approval/business-plan-settings`);
    check(cur.mode === 'PROFIT' && Number(cur.thresholdPercent) === 5, 'Cài đặt PAKD mặc định: theo lợi nhuận, ngưỡng 5%', JSON.stringify(cur));
    const deny = await nv1.call('PUT', `${crm}/v1/quote-approval/business-plan-settings`, { body: { mode: 'DISCOUNT', thresholdPercent: 10 }, expect: [403] });
    check(deny.status === 403, 'NV1 đổi cài đặt PAKD: 403', String(deny.status));
    const changed = await qtbh.put(`${crm}/v1/quote-approval/business-plan-settings`, { mode: 'DISCOUNT', thresholdPercent: 10 });
    const restored = await qtbh.put(`${crm}/v1/quote-approval/business-plan-settings`, { mode: cur.mode, thresholdPercent: Number(cur.thresholdPercent) });
    check(changed.mode === 'DISCOUNT' && restored.mode === cur.mode && Number(restored.thresholdPercent) === Number(cur.thresholdPercent), 'QTBH đổi chế độ, ngưỡng rồi trả lại như cũ', JSON.stringify(restored), 'QTBH');
    const bad = await qtbh.call('PUT', `${crm}/v1/quote-approval/business-plan-settings`, { body: { mode: 'PROFIT', thresholdPercent: 150 }, expect: [400] });
    check(bad.status === 400, 'Ngưỡng ngoài 0 đến 100 bị từ chối: 400', String(bad.status), 'QTBH');
    skip('Sửa báo giá đã gửi lệch ngưỡng buộc trình lại (TC-BP-06, 07)', 'Phủ bởi integration test (business-plan, biên ngưỡng); UAT API không dựng lại chuỗi gửi, sửa, so lệch', 'TN');
  });

  // -------------------------------------------------------------------------
  // UAT-P2-03: tài liệu (TC-P2UAT-07)
  // -------------------------------------------------------------------------
  await group('UAT-P2-03', 'NV1', 'Tài liệu', async (check, skip) => {
    check(types.length >= 7, 'Có từ 7 loại tài liệu mẫu', types.map((t) => t.code).join(','));
    const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `${tag} tài liệu`, expectedValue: 1_000_000 });
    const exe = await nv1.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'a.exe', contentType: 'application/x-msdownload', sizeBytes: 10 }, expect: [400] });
    check(exe.status === 400, 'Tệp .exe bị từ chối: 400', msg(exe));
    const outList = await nv3.call('GET', `${crm}/v1/documents?entityType=opportunity&entityId=${opp.id}`, { expect: [403, 404] });
    const outUp = await nv3.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3 }, expect: [403, 404] });
    check(outList.status === 404 && outUp.status === 404, 'NV3 ngoài phạm vi: xem danh sách và tải lên đều 404', `${outList.status}/${outUp.status}`, 'NV3');
    if (!s3) {
      skip('Tải lên qua URL ký, xem, tải xuống, đổi đối tượng xem', SKIP_NO_S3);
      skip('QL (xem toàn bộ) thấy tài liệu, NV3 không tải được', SKIP_NO_S3, 'QL');
      return;
    }
    const legal = typeId('LEGAL_DOSSIER') ?? types[0].id;
    const created = await uploadDocument(nv1, crm, { entityType: 'opportunity', entityId: opp.id, documentTypeId: legal, name: `${tag} hồ sơ` });
    const docId = created.document.id;
    const listed = await nv1.get(`${crm}/v1/documents?entityType=opportunity&entityId=${opp.id}`);
    const items = Array.isArray(listed) ? listed : (listed?.items ?? []);
    check(items.length === 1, 'Tải lên qua URL ký rồi xác nhận: danh sách có 1 tài liệu', `${items.length}`);
    const dl = await nv1.get(`${crm}/v1/documents/${docId}/download`);
    const url = dl.url ?? dl.downloadUrl;
    const got = await fetch(url).then((r) => r.text()).catch(() => '');
    check(got.includes(`${tag} hồ sơ`), 'Tải xuống bằng URL ký trả đúng nội dung', got.slice(0, 40));
    const aud = await nv1.patch(`${crm}/v1/documents/${docId}/audience`, { audience: 'customer' });
    check((aud.audience ?? aud.document?.audience) === 'customer', 'Đổi đối tượng xem sang khách hàng', '');
    await nv1.patch(`${crm}/v1/documents/${docId}/audience`, { audience: 'internal' });
    const outGet = await nv3.call('GET', `${crm}/v1/documents/${docId}`, { expect: [403, 404] });
    const outDl = await nv3.call('GET', `${crm}/v1/documents/${docId}/download`, { expect: [403, 404] });
    check(outGet.status === 404 && outDl.status === 404, 'NV3 ngoài phạm vi: xem và tải tài liệu 404', `${outGet.status}/${outDl.status}`, 'NV3');
    const asQl = await ql.call('GET', `${crm}/v1/documents/${docId}`, { expect: [403, 404] });
    check(asQl.status === 200, 'QL (xem toàn bộ) xem được tài liệu', String(asQl.status), 'QL');
  });

  // -------------------------------------------------------------------------
  // UAT-P2-04 và UAT-P2-05: chào thầu có và không có liên danh (TC-P2UAT-03, 04)
  // -------------------------------------------------------------------------
  const tenderBranch = async (step, joint, label) => {
    await group(step, 'NV1', `Chào thầu ${label}`, async (check, skip) => {
      if (!tender) throw new Error('Không có luồng Chào thầu (profile TENDER).');
      let opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: tender.id, name: `${tag} thầu ${label}`, expectedValue: 20_000_000 });
      check(opp.stage === 'HSMT', `Tạo cơ hội luồng thầu (${label}): giai đoạn đầu HSMT`, opp.stage);
      let profile = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender`, { packageName: `Gói thầu ${tag} ${label}`, inviterName: 'Sở Thông tin', packageCode: `GT-${ctx.stamp}${joint ? 'A' : 'B'}`, submissionDeadline: future, hasJointVenture: joint, scenario: joint ? 'Liên danh với đối tác A' : 'Tự thực hiện' });
      check(!!profile.id && profile.hasJointVenture === joint, 'Nhập hồ sơ thầu', `v${profile.version}`);
      const dup = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender`, { body: { packageName: 'x', inviterName: 'y' }, expect: [400, 409] });
      check([400, 409].includes(dup.status), 'Hồ sơ thầu thứ hai cho cùng cơ hội bị từ chối', String(dup.status));
      let r = await move(nv1, opp.id, 'PREPARE');
      check(r.status === 200, 'HSMT -> PREPARE', msg(r));
      r = await move(nv1, opp.id, 'PLAN_REVIEW');
      check(r.status === 409 && /Hồ sơ pháp lý|LEGAL_DOSSIER|Dự toán|ESTIMATE/.test(JSON.stringify(r.data)), 'Thiếu hồ sơ pháp lý, dự toán: 409 nêu loại tài liệu', msg(r));
      if (!s3) {
        skip('Tải hồ sơ pháp lý, dự toán; duyệt phương án; nộp; ghi kết quả', SKIP_NO_S3);
        return;
      }
      await uploadDocument(nv1, crm, { entityType: 'opportunity', entityId: opp.id, documentTypeId: typeId('LEGAL_DOSSIER'), name: `${tag} pháp lý ${label}`, fileName: 'LEGAL_DOSSIER.pdf' });
      await uploadDocument(nv1, crm, { entityType: 'opportunity', entityId: opp.id, documentTypeId: typeId('ESTIMATE'), name: `${tag} dự toán ${label}`, fileName: 'ESTIMATE.pdf' });
      r = await move(nv1, opp.id, 'PLAN_REVIEW');
      check(r.status === 200, 'Đủ tài liệu: sang Chờ duyệt phương án', msg(r));
      profile = await nv1.get(`${crm}/v1/opportunities/${opp.id}/tender`);
      if (joint) {
        const noPartner = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/submit`, { body: { version: profile.version }, expect: [400, 409] });
        check([400, 409].includes(noPartner.status), 'Có liên danh mà chưa có đối tác: không trình duyệt được', msg(noPartner));
        profile = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender/partners`, { name: 'Công ty đối tác A', scope: 'Phần mềm' });
        check(profile.partners?.length === 1, 'Thêm đối tác liên danh', JSON.stringify(profile.partners?.[0] ?? {}).slice(0, 80));
      }
      const submitted = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender/plan/submit`, { version: profile.version });
      check(['PENDING', 'PENDING_APPROVAL'].includes(submitted.plan?.status ?? submitted.planStatus), `NV1 trình duyệt phương án${joint ? '' : ' (không liên danh vẫn có bước duyệt)'}`, String(submitted.plan?.status ?? submitted.planStatus));
      const self = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/approve`, { body: { version: submitted.version }, expect: [403, 409] });
      check([403, 409].includes(self.status), 'Người trình không tự duyệt phương án', String(self.status));
      r = await move(nv1, opp.id, 'SUBMITTED');
      check(r.status === 409, 'Chưa duyệt phương án: không sang Đã nộp (409)', msg(r));
      const ok = await tn.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/plan/approve`, { body: { version: submitted.version }, expect: [400, 403, 409] });
      check(ok.status < 300, 'TN duyệt phương án', msg(ok), 'TN');
      profile = await nv1.get(`${crm}/v1/opportunities/${opp.id}/tender`);
      r = await move(nv1, opp.id, 'SUBMITTED');
      check(r.status === 409, 'Thiếu hình thức nộp: 409', msg(r));
      profile = await nv1.put(`${crm}/v1/opportunities/${opp.id}/tender`, { version: profile.version, submissionMethod: 'ONLINE' });
      r = await move(nv1, opp.id, 'SUBMITTED');
      check(r.status === 200, 'Đủ phương án đã duyệt và hình thức nộp: sang Đã nộp', msg(r));
      profile = await nv1.get(`${crm}/v1/opportunities/${opp.id}/tender`);
      if (joint) {
        const noPrice = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/result`, { body: { version: profile.version, result: 'WON' }, expect: [400, 409] });
        check(noPrice.status === 400, 'Trúng thiếu giá trúng: 400', msg(noPrice));
        const won = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/result`, { body: { version: profile.version, result: 'WON', winningPrice: 18_500_000 }, expect: [400, 409] });
        const after = await reload(nv1, opp.id);
        check(won.status < 300 && after.stage === 'WON' && Number(won.data?.contractDraft?.value) === 18_500_000, 'Trúng thầu: cơ hội Thắng, có dữ liệu hợp đồng điền sẵn', `${won.status} ${after.stage}`);
        const contract = won.data?.contractDraft ? await qtbh.call('POST', `${crm}/v1/contracts`, { body: won.data.contractDraft, expect: [400, 403, 409] }) : { status: 0 };
        check([200, 201].includes(contract.status), 'QTBH tạo hợp đồng từ dữ liệu điền sẵn', msg(contract), 'QTBH');
      } else {
        const noReason = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/result`, { body: { version: profile.version, result: 'LOST' }, expect: [400, 409] });
        check([400, 409].includes(noReason.status), 'Trượt thầu không lý do bị chặn', msg(noReason));
        const lost = await nv1.call('POST', `${crm}/v1/opportunities/${opp.id}/tender/result`, { body: { version: profile.version, result: 'LOST', reason: 'Giá cao hơn đối thủ', winnerName: 'Công ty Đối Thủ', winningPrice: 15_000_000 }, expect: [400, 409] });
        const after = await reload(nv1, opp.id);
        check(lost.status < 300 && after.stage === 'LOST' && lost.data?.winnerName === 'Công ty Đối Thủ', 'Trượt thầu: cơ hội Thua, ghi đơn vị trúng và lý do', `${lost.status} ${after.stage}`);
      }
      const outsider = await nv3.call('GET', `${crm}/v1/opportunities/${opp.id}/tender`, { expect: [403, 404] });
      check(outsider.status === 404, 'NV3 ngoài phạm vi xem hồ sơ thầu: 404', String(outsider.status), 'NV3');
    });
  };
  await tenderBranch('UAT-P2-04', true, 'liên danh');
  await tenderBranch('UAT-P2-05', false, 'không liên danh');

  // -------------------------------------------------------------------------
  // UAT-P2-06: gợi ý chăm sóc lại khi Thua (TC-P2UAT-05); server trả cờ careSuggestion
  // -------------------------------------------------------------------------
  await group('UAT-P2-06', 'NV1', 'Gợi ý chăm sóc', async (check) => {
    check(standard.careSuggestion === true && tender.careSuggestion === false, 'Mặc định: luồng thường bật gợi ý, luồng thầu tắt', `${standard.careSuggestion}/${tender.careSuggestion}`);
    const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: standard.id, name: `${tag} thua thường`, expectedValue: 1_000_000 });
    let r = await move(nv1, opp.id, 'LOST', { reason: 'Khách chọn nhà cung cấp khác' });
    check(r.status === 200 && r.data?.careSuggestion?.enabled === true, 'Thua ở luồng thường: server báo careSuggestion.enabled = true', `${r.status} ${JSON.stringify(r.data?.careSuggestion)}`);
    const activity = await nv1.call('POST', `${crm}/v1/activities`, { body: { type: 'CALL', subject: `${tag} chăm sóc lại sau khi Thua`, customerId: kh.id, opportunityId: opp.id, dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }, expect: [400, 403, 404] });
    check(activity.status === 201 || activity.status === 200, 'NV1 tạo lịch chăm sóc lại gắn cơ hội đã Thua', msg(activity));
    const t = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, pipelineId: tender.id, name: `${tag} thua thầu`, expectedValue: 1_000_000 });
    r = await move(nv1, t.id, 'LOST', { reason: 'Không tham gia' });
    check(r.status === 200 && !r.data?.careSuggestion?.enabled, 'Thua ở luồng thầu: không gợi ý chăm sóc', `${r.status} ${JSON.stringify(r.data?.careSuggestion)}`);
    const denied = await nv1.call('PUT', `${crm}/v1/opportunities/pipelines/${standard.id}/care-suggestion`, { body: { careSuggestion: false }, expect: [403] });
    check(denied.status === 403, 'NV1 đổi cờ gợi ý của luồng: 403', String(denied.status));
    const bad = await qtbh.call('PUT', `${crm}/v1/opportunities/pipelines/${tender.id}/care-suggestion`, { body: { careSuggestion: true }, expect: [400] });
    check(bad.status === 400, 'Luồng thầu không bật gợi ý được: 400', String(bad.status), 'QTBH');
  });

  // -------------------------------------------------------------------------
  // UAT-P2-08: ba mục feedback giao diện, phần API (TC-P2UAT-08); thao tác trên giao diện vẫn làm tay
  // -------------------------------------------------------------------------
  await group('UAT-P2-08', 'NV1', 'Feedback giao diện', async (check) => {
    const [sNv1, sQl] = await Promise.all([nv1.get(`${crm}/v1/status`), ql.get(`${crm}/v1/status`)]);
    check(sQl.inventoryEntitled === true && sQl.canAccessInventory === true, 'QL có quyền Kho: cờ canAccessInventory = true', JSON.stringify({ e: sQl.inventoryEntitled, c: sQl.canAccessInventory }), 'QL');
    check(sNv1.inventoryEntitled === true && sNv1.canAccessInventory === false, 'NV1 không có quyền Kho: hiện nhưng không bấm được (entitled, không access)', JSON.stringify({ e: sNv1.inventoryEntitled, c: sNv1.canAccessInventory }));
    const inv = await nv1.call('GET', `${config.inventoryApi}/v1/materials?all=true`, { expect: [401, 403, 404] });
    check(inv.status === 403, 'Server vẫn chặn NV1 gọi API Kho: 403', String(inv.status));
    const materials = await admin.get(`${crm}/v1/catalog/materials?q=QA-KHO`);
    const ids = ['QA-KHO-CAP', 'QA-KHO-MUC'].map((code) => materials.find((m) => m.code === code)?.id);
    const quote = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, note: `${tag} chọn nhiều mặt hàng` });
    const quoteId = quote.id ?? quote.quote?.id;
    let version = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
    const batch = `${crm}/v1/quotes/${quoteId}/versions/${version.versionNo ?? 1}/lines/batch`;
    const bad = await nv1.call('POST', batch, { body: { revision: version.revision, lines: [...ids.map((materialId) => ({ materialId, quantity: 2 })), { materialId: '00000000-0000-0000-0000-000000000000', quantity: 1 }] }, expect: [400, 404, 409, 422] });
    version = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
    check(bad.status >= 400 && version.lines.length === 0, 'Chọn nhiều mặt hàng có một dòng lỗi: không thêm dòng nào', `${bad.status}, ${version.lines.length} dòng`);
    const ok = await nv1.call('POST', batch, { body: { revision: version.revision, lines: ids.map((materialId) => ({ materialId, quantity: 2 })) }, expect: [400, 409] });
    version = (await nv1.get(`${crm}/v1/quotes/${quoteId}`)).version;
    check(ok.status < 300 && version.lines.length === 2, 'Chọn nhiều mặt hàng hợp lệ: thêm đúng 2 dòng một lần', `${ok.status}, ${version.lines.length} dòng`);
    const g403 = await nv1.call('POST', `${crm}/v1/customer-groups`, { body: { code: `P2U${ctx.stamp}`, name: 'Thử' }, expect: [403] });
    check(g403.status === 403, 'NV1 (không crm.manage) tạo nhóm khách: 403', String(g403.status));
    const dup = await qtbh.call('POST', `${crm}/v1/customer-groups`, { body: { code: 'QA-CRM-DL1', name: 'Đại lý cấp 1' }, expect: [400, 409] });
    check(dup.status === 409, 'Tạo nhóm khách trùng mã: 409', msg(dup), 'QTBH');
  });
}
