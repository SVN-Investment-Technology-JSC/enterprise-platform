// Bước `phase2` (P2H-01): dữ liệu phase 2 cho tenant thí điểm, chỉ qua API thật (TEST_PHASE2.md mục 1.3).
// Luồng "Bán hàng thông thường" và "Chào thầu" đã có sẵn từ migration; bước này thêm:
//   1. luồng thử 5 giai đoạn `QA_P2_5GD` (mẫu SALES_SIMPLE) có giai đoạn bỏ qua được và quy tắc gán người;
//   2. dự án trên luồng thử ở nhiều giai đoạn, vài dự án đã gán người đảm nhận giai đoạn;
//   3. cơ hội thầu ở nhiều giai đoạn (có và không liên danh) kèm hồ sơ thầu;
//   4. PAKD ở ba trạng thái (đang soạn, chờ duyệt, đã duyệt);
//   5. tài liệu mẫu trên khách và cơ hội;
//   6. Cài đặt PAKD về mặc định (so theo lợi nhuận, ngưỡng 5%).
// Mọi dữ liệu có tiền tố QA-P2. Chạy lại được: khớp theo mã luồng, tên cơ hội, tên tài liệu. Mỗi nhóm việc bọc
// try/catch: lỗi một nhóm chỉ cảnh báo, các nhóm sau vẫn chạy. Phần cần S3 (tài liệu, hồ sơ pháp lý) tự bỏ qua kèm
// cảnh báo khi S3 không sẵn (MinIO hoặc `node tools/crm/mock-s3.mjs`).
// Cần đã chạy các bước crm và inventory (khách QA-CRM-KH01, KH21, mặt hàng QA-KHO-CAP).
import { allPages, createSessions, materialsByCode, requireCustomers } from './common.mjs';

export const PIPELINE_CODE = 'QA_P2_5GD';
export const PIPELINE_NAME = 'Bán hàng 5 giai đoạn';
const PREFIX = 'QA-P2';

/** S3 có trả lời không (mọi mã HTTP đều tính là có). Dùng chung cho bước seed và UAT. */
export async function s3Reachable() {
  const endpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_INTERNAL_ENDPOINT ?? 'http://localhost:9010';
  try {
    await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

/** Xin URL ký, PUT nội dung, xác nhận. Ném lỗi nếu bước nào thất bại. */
export async function uploadDocument(session, crmApi, { entityType, entityId, documentTypeId, name, fileName = 'tai-lieu.pdf' }) {
  const bytes = Buffer.from(`${PREFIX} ${name}`);
  const created = await session.post(`${crmApi}/v1/documents`, {
    entityType,
    entityId,
    documentTypeId,
    name,
    fileName,
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
  });
  const put = await fetch(created.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) },
    body: bytes,
  });
  if (!put.ok) throw new Error(`PUT lên S3 trả ${put.status}`);
  await session.post(`${crmApi}/v1/documents/${created.document.id}/versions/${created.version.id}/complete`, { sizeBytes: bytes.length });
  return created;
}

const plus = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

export async function runPhase2Step(config, log) {
  log.section(`Bước phase2 cho ${config.tenantSlug}`);
  const crm = config.crmApi;
  const sessions = createSessions(config);
  const [nv1, nv2, tn, qtbh, admin] = await Promise.all(['NV1', 'NV2', 'TN', 'QTBH', 'QTV'].map((code) => sessions.as(code)));
  const customers = await requireCustomers(config, admin, ['QA-CRM-KH01', 'QA-CRM-KH11', 'QA-CRM-KH21']);
  const kh = customers.get('QA-CRM-KH01');
  const materials = await materialsByCode(config, admin);
  const s3 = await s3Reachable();
  if (!s3) log.warn('S3 không trả lời: bỏ qua tài liệu mẫu và các bước hồ sơ thầu cần tải tài liệu (bật MinIO hoặc node tools/crm/mock-s3.mjs rồi chạy lại).');

  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      log.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400));
    }
  };

  // Cơ hội đã có theo tên (mọi cơ hội QA-P2)
  const existing = new Map((await allPages(admin, `${crm}/v1/opportunities?q=${encodeURIComponent(PREFIX)}`)).map((o) => [o.name, o]));
  const ensureOpp = async (session, name, body) => {
    const found = existing.get(name);
    if (found) {
      log.skip(`Cơ hội "${name}" đã có (${found.stage}).`);
      return session.get(`${crm}/v1/opportunities/${found.id}`);
    }
    const created = await session.post(`${crm}/v1/opportunities`, { customerId: kh.id, name, expectedValue: 20_000_000, ...body });
    log.created(`Cơ hội "${name}".`);
    return created;
  };
  // Chỉ chuyển TIẾN: chạy lại không kéo dự án đã đi xa hơn về giai đoạn trước (idempotent).
  const STAGE_ORDER = ['NEW', 'QUOTING', 'NEGOTIATION', 'HSMT', 'PREPARE', 'PLAN_REVIEW', 'SUBMITTED'];
  const moveTo = async (session, opp, stage, extra = {}) => {
    if (opp.stage === stage) return opp;
    const from = STAGE_ORDER.indexOf(opp.stage);
    const to = STAGE_ORDER.indexOf(stage);
    if (from >= 0 && to >= 0 && from > to) return opp;
    const moved = await session.patch(`${crm}/v1/opportunities/${opp.id}/stage`, { stage, version: opp.version, ...extra });
    log.created(`"${opp.name}" chuyển ${opp.stage} -> ${stage}.`);
    return moved;
  };

  // ---- 1. Luồng thử 5 giai đoạn ----
  let pipeline;
  await attempt('Luồng thử 5 giai đoạn', async () => {
    log.section('Luồng thử 5 giai đoạn (SALES_SIMPLE)');
    let all = await qtbh.get(`${crm}/v1/pipelines`);
    pipeline = all.find((p) => p.code === PIPELINE_CODE);
    if (!pipeline) {
      all = await qtbh.post(`${crm}/v1/pipelines`, { code: PIPELINE_CODE, name: PIPELINE_NAME, templateId: 'SALES_SIMPLE' });
      pipeline = all.find((p) => p.code === PIPELINE_CODE);
      log.created(`Luồng "${PIPELINE_NAME}" (${PIPELINE_CODE}) từ mẫu SALES_SIMPLE.`);
    } else log.skip(`Luồng ${PIPELINE_CODE} đã có.`);
    if (!pipeline.active) {
      all = await qtbh.patch(`${crm}/v1/pipelines/${pipeline.id}`, { active: true });
      pipeline = all.find((p) => p.code === PIPELINE_CODE);
      log.created(`Bật lại luồng ${PIPELINE_CODE}.`);
    }
    // Quy tắc gán mặc định: Báo giá bỏ qua được; Đàm phán gán quản lý trực tiếp; Mới gán chủ dự án.
    const wanted = {
      NEW: { assigneeRule: 'PROJECT_OWNER' },
      QUOTING: { skippable: true, assigneeRule: 'PROJECT_OWNER' },
      NEGOTIATION: { assigneeRule: 'DIRECT_MANAGER' },
    };
    for (const [code, patch] of Object.entries(wanted)) {
      const stage = pipeline.stages.find((s) => s.code === code);
      if (!stage) throw new Error(`Mẫu không có giai đoạn ${code}.`);
      const differs = Object.entries(patch).some(([key, value]) => stage[key] !== value);
      if (!differs) {
        log.skip(`Giai đoạn ${code} đã đúng cấu hình.`);
        continue;
      }
      all = await qtbh.patch(`${crm}/v1/pipelines/${pipeline.id}/stages/${stage.id}`, patch);
      pipeline = all.find((p) => p.code === PIPELINE_CODE);
      log.created(`Giai đoạn ${code}: ${JSON.stringify(patch)}.`);
    }
  });

  // ---- 2. Dự án trên luồng thử, đã gán người đảm nhận ----
  if (pipeline) {
    await attempt('Dự án trên luồng thử', async () => {
      log.section('Dự án trên luồng thử');
      const idNv3 = await sessions.userId('NV3');
      const planOf = async (session, id) => (await session.get(`${crm}/v1/opportunities/${id}/stage-plan`)).items;

      await ensureOpp(nv1, `${PREFIX} 5GD Mới`, { pipelineId: pipeline.id });

      let quoting = await ensureOpp(nv1, `${PREFIX} 5GD Báo giá`, { pipelineId: pipeline.id });
      quoting = await moveTo(nv1, quoting, 'QUOTING');

      // Bỏ qua Báo giá, sang thẳng Đàm phán (người đảm nhận: quản lý trực tiếp của NV1)
      let skipped = await ensureOpp(nv1, `${PREFIX} 5GD Bỏ qua Báo giá`, { pipelineId: pipeline.id });
      if (skipped.stage === 'NEW') {
        const quotingPlan = (await planOf(nv1, skipped.id)).find((item) => item.stage.code === 'QUOTING');
        if (quotingPlan?.status !== 'SKIPPED') {
          await nv1.post(`${crm}/v1/opportunities/${skipped.id}/stage-plan/${quotingPlan.stage.id}/skip`, { reason: 'Khách đã có báo giá từ trước (dữ liệu mẫu)' });
          log.created(`"${skipped.name}": bỏ qua giai đoạn Báo giá.`);
        }
        skipped = await nv1.get(`${crm}/v1/opportunities/${skipped.id}`);
        skipped = await moveTo(nv1, skipped, 'NEGOTIATION');
      }

      // Đổi người đảm nhận Đàm phán sang NV3 (ghi đè theo dự án)
      let assigned = await ensureOpp(nv1, `${PREFIX} 5GD Gán NV3`, { pipelineId: pipeline.id });
      assigned = await moveTo(nv1, assigned, 'QUOTING');
      assigned = await moveTo(nv1, await nv1.get(`${crm}/v1/opportunities/${assigned.id}`), 'NEGOTIATION');
      const negotiation = (await planOf(nv1, assigned.id)).find((item) => item.stage.code === 'NEGOTIATION');
      if (negotiation && negotiation.assigneeUserId !== idNv3) {
        await nv1.patch(`${crm}/v1/opportunities/${assigned.id}/stage-plan/${negotiation.stage.id}/assignee`, { assigneeUserId: idNv3 });
        log.created(`"${assigned.name}": Đàm phán giao NV3.`);
      } else log.skip(`"${assigned.name}": Đàm phán đã giao NV3.`);

      // Dự án của NV2 để có người đảm nhận khác chủ
      await ensureOpp(nv2, `${PREFIX} 5GD NV2 Mới`, { pipelineId: pipeline.id, customerId: customers.get('QA-CRM-KH11').id });
    });
  }

  // ---- 3. Cơ hội thầu ----
  await attempt('Cơ hội thầu', async () => {
    log.section('Cơ hội thầu (luồng Chào thầu)');
    const pipelines = await nv1.get(`${crm}/v1/opportunities/pipelines`);
    const tender = pipelines.find((p) => p.profile === 'TENDER');
    if (!tender) throw new Error('Không có luồng Chào thầu (profile TENDER).');
    const types = await nv1.get(`${crm}/v1/document-types`);
    const typeId = (code) => types.find((t) => t.code === code)?.id;

    const ensureProfile = async (opp, joint, scenario) => {
      const current = await nv1.call('GET', `${crm}/v1/opportunities/${opp.id}/tender`, { expect: [404] });
      if (current.status === 200 && current.data?.id) {
        log.skip(`"${opp.name}": hồ sơ thầu đã có.`);
        return current.data;
      }
      const profile = await nv1.post(`${crm}/v1/opportunities/${opp.id}/tender`, {
        packageName: `Gói thầu ${opp.name}`,
        inviterName: 'Sở Thông tin và Truyền thông (dữ liệu mẫu)',
        packageCode: `GT-${opp.name.replace(/\W+/g, '').slice(-8)}`,
        submissionDeadline: plus(14),
        hasJointVenture: joint,
        scenario,
      });
      log.created(`"${opp.name}": hồ sơ thầu${joint ? ' có liên danh' : ''}.`);
      return profile;
    };
    const reloadOpp = (opp) => nv1.get(`${crm}/v1/opportunities/${opp.id}`);

    // T1: HSMT, không liên danh
    let t1 = await ensureOpp(nv1, `${PREFIX} Thầu HSMT (không liên danh)`, { pipelineId: tender.id });
    await ensureProfile(t1, false, 'Tự thực hiện toàn bộ');

    // T2: Chuẩn bị, có liên danh và đã có đối tác
    let t2 = await ensureOpp(nv1, `${PREFIX} Thầu chuẩn bị (liên danh)`, { pipelineId: tender.id });
    let p2 = await ensureProfile(t2, true, 'Liên danh với đối tác A cung cấp phần mềm');
    if (!(p2.partners?.length > 0)) {
      p2 = await nv1.post(`${crm}/v1/opportunities/${t2.id}/tender/partners`, { name: `${PREFIX} Công ty đối tác A`, scope: 'Phần mềm' });
      log.created(`"${t2.name}": đối tác liên danh.`);
    }
    t2 = await moveTo(nv1, await reloadOpp(t2), 'PREPARE');

    // T3: Chờ duyệt phương án (liên danh), T4: Đã nộp (không liên danh); cần hồ sơ pháp lý và dự toán trên S3
    if (!s3) {
      log.warn('Bỏ qua cơ hội thầu ở Chờ duyệt phương án và Đã nộp (cần tài liệu trên S3).');
      return;
    }
    const hasDoc = async (opp, code) => JSON.stringify(await nv1.get(`${crm}/v1/documents?entityType=opportunity&entityId=${opp.id}`)).includes(typeId(code));
    const ensureDocs = async (opp) => {
      for (const code of ['LEGAL_DOSSIER', 'ESTIMATE']) {
        if (await hasDoc(opp, code)) continue;
        await uploadDocument(nv1, crm, { entityType: 'opportunity', entityId: opp.id, documentTypeId: typeId(code), name: `${PREFIX} ${code}`, fileName: `${code}.pdf` });
        log.created(`"${opp.name}": tài liệu ${code}.`);
      }
    };
    const planStatus = (p) => p?.plan?.status ?? p?.planStatus;

    let t3 = await ensureOpp(nv1, `${PREFIX} Thầu chờ duyệt phương án (liên danh)`, { pipelineId: tender.id });
    let p3 = await ensureProfile(t3, true, 'Liên danh với đối tác B');
    if (!(p3.partners?.length > 0)) p3 = await nv1.post(`${crm}/v1/opportunities/${t3.id}/tender/partners`, { name: `${PREFIX} Công ty đối tác B`, scope: 'Triển khai' });
    t3 = await moveTo(nv1, await reloadOpp(t3), 'PREPARE');
    await ensureDocs(t3);
    t3 = await moveTo(nv1, await reloadOpp(t3), 'PLAN_REVIEW');
    p3 = await nv1.get(`${crm}/v1/opportunities/${t3.id}/tender`);
    if (!['PENDING', 'PENDING_APPROVAL', 'APPROVED'].includes(planStatus(p3))) {
      await nv1.post(`${crm}/v1/opportunities/${t3.id}/tender/plan/submit`, { version: p3.version });
      log.created(`"${t3.name}": trình duyệt phương án.`);
    }

    let t4 = await ensureOpp(nv1, `${PREFIX} Thầu đã nộp (không liên danh)`, { pipelineId: tender.id });
    let p4 = await ensureProfile(t4, false, 'Tự thực hiện toàn bộ');
    t4 = await moveTo(nv1, await reloadOpp(t4), 'PREPARE');
    await ensureDocs(t4);
    t4 = await moveTo(nv1, await reloadOpp(t4), 'PLAN_REVIEW');
    p4 = await nv1.get(`${crm}/v1/opportunities/${t4.id}/tender`);
    if (!['PENDING', 'PENDING_APPROVAL', 'APPROVED'].includes(planStatus(p4))) {
      p4 = await nv1.post(`${crm}/v1/opportunities/${t4.id}/tender/plan/submit`, { version: p4.version });
      log.created(`"${t4.name}": trình duyệt phương án.`);
    }
    p4 = await nv1.get(`${crm}/v1/opportunities/${t4.id}/tender`);
    if (['PENDING', 'PENDING_APPROVAL'].includes(planStatus(p4))) {
      p4 = await tn.post(`${crm}/v1/opportunities/${t4.id}/tender/plan/approve`, { version: p4.version });
      log.created(`"${t4.name}": TN duyệt phương án.`);
    }
    p4 = await nv1.get(`${crm}/v1/opportunities/${t4.id}/tender`);
    if (!p4.submissionMethod) p4 = await nv1.put(`${crm}/v1/opportunities/${t4.id}/tender`, { version: p4.version, submissionMethod: 'ONLINE' });
    await moveTo(nv1, await reloadOpp(t4), 'SUBMITTED');
  });

  // ---- 4. PAKD ở ba trạng thái ----
  await attempt('PAKD', async () => {
    log.section('PAKD (đang soạn, chờ duyệt, đã duyệt)');
    const cap = materials.get('QA-KHO-CAP');
    if (!cap) throw new Error('Chưa có mặt hàng QA-KHO-CAP. Chạy --step=inventory trước.');
    const targets = [
      { name: `${PREFIX} PAKD đang soạn`, want: 'DRAFT' },
      { name: `${PREFIX} PAKD chờ duyệt`, want: 'PENDING' },
      { name: `${PREFIX} PAKD đã duyệt`, want: 'APPROVED' },
    ];
    for (const target of targets) {
      const opp = await ensureOpp(nv1, target.name, {});
      const quotes = await nv1.get(`${crm}/v1/quotes?opportunityId=${opp.id}`);
      let quote = (quotes.items ?? quotes)[0];
      if (!quote) {
        quote = await nv1.post(`${crm}/v1/quotes`, { opportunityId: opp.id, note: `${target.name} (dữ liệu mẫu)` });
        log.created(`Báo giá cho "${target.name}".`);
      }
      const quoteId = quote.id ?? quote.quote?.id;
      let detail = await nv1.get(`${crm}/v1/quotes/${quoteId}`);
      if (detail.version.status === 'DRAFT' && !detail.version.lines.length) {
        detail = await nv1.post(`${crm}/v1/quotes/${quoteId}/versions/${detail.version.versionNo}/lines`, {
          revision: detail.version.revision,
          materialId: cap.id,
          quantity: 10,
        });
      }
      const base = `${crm}/v1/quotes/${quoteId}/versions/${detail.version.versionNo}/business-plan`;
      let plan = await nv1.get(base);
      if (!plan) {
        plan = await nv1.put(base, {
          note: `${target.name}`,
          lines: [{ kind: 'DISCOUNT', amount: 100_000 }, { kind: 'SUBCONTRACT', description: 'Thầu phụ lắp đặt', amount: 300_000 }, { kind: 'OTHER', amount: 50_000 }],
        });
        log.created(`PAKD của "${target.name}" (${plan.status}).`);
      } else log.skip(`PAKD của "${target.name}" đã có (${plan.status}).`);
      if (target.want !== 'DRAFT' && plan.status === 'DRAFT') {
        plan = await nv1.post(`${base}/submit`, { version: plan.version });
        log.created(`PAKD của "${target.name}": trình duyệt.`);
      }
      if (target.want === 'APPROVED' && plan.status === 'PENDING') {
        plan = await tn.post(`${base}/approve`, { version: plan.version, reason: 'Duyệt (dữ liệu mẫu)' });
        log.created(`PAKD của "${target.name}": TN duyệt.`);
      }
      if (plan.status !== target.want) log.warn(`PAKD "${target.name}" đang ${plan.status}, muốn ${target.want}.`);
    }
  });

  // ---- 5. Khách có nhóm và không nhóm; tài liệu mẫu trên khách và cơ hội ----
  await attempt('Khách có nhóm và tài liệu mẫu', async () => {
    log.section('Khách có nhóm / không nhóm, tài liệu mẫu');
    const all = await allPages(admin, `${crm}/v1/customers`);
    const grouped = all.filter((c) => c.groupId ?? c.group?.id ?? c.customerGroupId);
    log.info(`Khách: ${all.length} (có nhóm ${grouped.length}, chưa có nhóm ${all.length - grouped.length}).`);
    if (grouped.length === 0 || grouped.length === all.length) log.warn('Cần cả khách có nhóm và không nhóm; kiểm lại dữ liệu bước crm (hoặc tên trường nhóm khác dự kiến).');
    if (!s3) return log.warn('Bỏ qua tài liệu mẫu (S3 không sẵn).');
    const types = await nv1.get(`${crm}/v1/document-types`);
    const type = types.find((t) => t.code === 'LEGAL_DOSSIER') ?? types[0];
    const quotingOpp = existing.get(`${PREFIX} 5GD Báo giá`) ?? (await allPages(admin, `${crm}/v1/opportunities?q=${encodeURIComponent(`${PREFIX} 5GD Báo giá`)}`))[0];
    const targets = [
      { entityType: 'customer', entityId: kh.id, name: `${PREFIX} Hợp đồng khung khách` },
      ...(quotingOpp ? [{ entityType: 'opportunity', entityId: quotingOpp.id, name: `${PREFIX} Hồ sơ dự án` }] : []),
    ];
    for (const target of targets) {
      const list = await nv1.get(`${crm}/v1/documents?entityType=${target.entityType}&entityId=${target.entityId}`);
      if (JSON.stringify(list).includes(target.name)) {
        log.skip(`Tài liệu "${target.name}" đã có.`);
        continue;
      }
      await uploadDocument(nv1, crm, { ...target, documentTypeId: type.id });
      log.created(`Tài liệu "${target.name}".`);
    }
  });

  // ---- 6. Cài đặt PAKD về mặc định ----
  await attempt('Cài đặt PAKD', async () => {
    log.section('Cài đặt PAKD');
    const current = await qtbh.get(`${crm}/v1/quote-approval/business-plan-settings`);
    if (current.mode === 'PROFIT' && Number(current.thresholdPercent) === 5) return log.skip('Cài đặt PAKD đã là mặc định (theo lợi nhuận, 5%).');
    await qtbh.put(`${crm}/v1/quote-approval/business-plan-settings`, { mode: 'PROFIT', thresholdPercent: 5 });
    log.created('Cài đặt PAKD về mặc định (theo lợi nhuận, 5%).');
  });
}
