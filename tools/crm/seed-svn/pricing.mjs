// Bước `pricing` (T3-18): bảng giá chuẩn và bảng giá Đại lý cấp 1, chính sách chiết khấu, trần chiết khấu, ngưỡng duyệt
// báo giá, hai định nghĩa quy trình duyệt ở Quy trình và gắn vào `approval_bindings` của Bán hàng.
// QTBH (crm.manage) cấu hình Bán hàng; QTV (quản trị tenant) thiết kế và công bố quy trình. Chạy lại được: bảng giá,
// chính sách, quy trình khớp theo mã; dòng giá ghi bằng route "dán nhiều dòng" (thêm hoặc cập nhật theo mặt hàng).
import { GROUPS } from './crm.mjs';
import { createSessions, list, materialsByCode } from './common.mjs';

const STANDARD_ITEMS = [
  { code: 'QA-KHO-CAP', price: 1_000_000, vatRate: 10 },
  { code: 'QA-KHO-LAP', price: 20_000_000, vatRate: 10 },
  { code: 'QA-KHO-MUC', price: 400_000, vatRate: 10 },
  { code: 'QA-KHO-BT', price: 5_000_000, vatRate: 10 },
  { code: 'QA-KHO-PM', price: 12_000_000, vatRate: 10 },
];
const DEALER_ITEMS = [
  { code: 'QA-KHO-CAP', price: 950_000, vatRate: 10 },
  { code: 'QA-KHO-LAP', price: 19_000_000, vatRate: 10 },
  { code: 'QA-KHO-MUC', price: 380_000, vatRate: 10 },
];

function priceLists(year) {
  return [
    { code: 'QA-CRM-BG-CHUAN', name: 'QA Bảng giá chuẩn', isStandard: true, validFrom: `${year}-01-01`, items: STANDARD_ITEMS, groups: [] },
    { code: 'QA-CRM-BG-DL1', name: 'QA Bảng giá Đại lý cấp 1', isStandard: false, validFrom: `${year}-01-01`, items: DEALER_ITEMS, groups: ['QA-CRM-DL1'] },
  ];
}

function discountPolicies(year) {
  return [
    {
      code: 'QA-CRM-CS-BAC',
      name: 'QA Chiết khấu theo bậc số lượng',
      priority: 10,
      stacking: 'STACK',
      exclusive: false,
      validFrom: `${year}-01-01`,
      appliesToAllCustomers: true,
      note: 'Bậc 1-9 giảm 2%, 10-49 giảm 5%, từ 50 giảm 8% (số lượng theo từng dòng)',
      rules: [
        { criterion: 'QUANTITY', minQty: 1, maxQty: 9, percent: 2 },
        { criterion: 'QUANTITY', minQty: 10, maxQty: 49, percent: 5 },
        { criterion: 'QUANTITY', minQty: 50, maxQty: null, percent: 8 },
      ],
    },
    {
      code: 'QA-CRM-CS-T12',
      name: 'QA Chương trình tháng 12',
      priority: 20,
      stacking: 'STACK',
      exclusive: false,
      percent: 3,
      validFrom: `${year}-12-01`,
      validTo: `${year}-12-31`,
      appliesToAllCustomers: true,
      note: 'Giảm thêm 3% trong tháng 12, cộng dồn với bậc số lượng (tổng cắt theo trần 10%)',
      rules: [{ criterion: 'PERIOD', fromDate: `${year}-12-01`, toDate: `${year}-12-31` }],
    },
  ];
}

const DISCOUNT_CAP_PERCENT = 10;
const QUOTE_APPROVAL = { roleLimits: { staff: 5, teamLead: 15, manager: null }, minMarginPercent: 10 };

/** Quy trình duyệt: bước 1 người lập (mọi nhân viên, tự hoàn tất khi Bán hàng mở phiên), bước 2 chức danh duyệt. */
const PROCEDURES = [
  { kind: 'QUOTE', code: 'QA-CRM-DUYET-BG', name: 'Duyệt báo giá', approver: 'SVN-KD-TN', approverLabel: 'Trưởng nhóm kinh doanh A' },
  { kind: 'ORDER_CREDIT', code: 'QA-CRM-DUYET-HM', name: 'Duyệt vượt hạn mức công nợ', approver: 'SVN-KD-QL', approverLabel: 'Quản lý kinh doanh' },
];
const PROCEDURE_CATEGORY = 'sales_marketing';

async function ensurePriceLists(config, sessions, log) {
  const qtbh = await sessions.as('QTBH');
  const admin = await sessions.as('QTV');
  const materials = await materialsByCode(config, admin);
  const groups = await qtbh.get(`${config.crmApi}/v1/customer-groups`);
  const groupId = (code) => {
    const group = groups.find((item) => item.code === code);
    if (!group) throw new Error(`Chưa có nhóm khách ${code}. Chạy --step=crm trước.`);
    return group.id;
  };
  const existing = await qtbh.get(`${config.crmApi}/v1/price-lists`);
  for (const definition of priceLists(new Date().getFullYear())) {
    let current = existing.find((item) => item.code === definition.code);
    const customerGroupIds = definition.groups.map(groupId);
    if (!current) {
      current = await qtbh.post(`${config.crmApi}/v1/price-lists`, {
        code: definition.code,
        name: definition.name,
        isStandard: definition.isStandard,
        validFrom: definition.validFrom,
        status: 'ACTIVE',
        note: 'Tạo bởi tools/crm/seed-svn.mjs',
        ...(customerGroupIds.length ? { customerGroupIds } : {}),
      });
      log.created(`Bảng giá ${definition.code} "${definition.name}".`);
    } else {
      log.skip(`Bảng giá ${definition.code} đã có.`);
      current = await qtbh.get(`${config.crmApi}/v1/price-lists/${current.id}`);
      const assigned = current.customerGroups.map((group) => group.id).sort().join(',');
      if (assigned !== [...customerGroupIds].sort().join(',')) {
        await qtbh.put(`${config.crmApi}/v1/price-lists/${current.id}/customer-groups`, { customerGroupIds });
        log.created(`Bảng giá ${definition.code}: gán nhóm ${definition.groups.join(', ') || '(không)'}.`);
      }
    }
    const items = definition.items.map((item) => {
      const material = materials.get(item.code);
      if (!material) throw new Error(`Chưa có mặt hàng ${item.code}. Chạy --step=legacy và --step=inventory trước.`);
      return { materialId: material.id, materialCode: material.code, materialName: material.name, unit: material.unit, price: item.price, vatRate: item.vatRate };
    });
    const stale = items.filter((item) => {
      const found = (current.items ?? []).find((row) => row.materialId === item.materialId && row.unit === item.unit);
      return !found || Number(found.price) !== item.price || Number(found.vatRate) !== item.vatRate;
    });
    if (!stale.length) log.skip(`Bảng giá ${definition.code}: ${items.length} dòng giá đã đúng.`);
    else {
      await qtbh.post(`${config.crmApi}/v1/price-lists/${current.id}/items/bulk`, { items: stale });
      log.created(`Bảng giá ${definition.code}: ghi ${stale.length} dòng giá (${stale.map((item) => item.materialCode).join(', ')}).`);
    }
  }
}

async function ensurePolicies(config, sessions, log) {
  const qtbh = await sessions.as('QTBH');
  const existing = list(await qtbh.get(`${config.crmApi}/v1/discount-policies`), 'items');
  for (const policy of discountPolicies(new Date().getFullYear())) {
    if (existing.some((item) => item.code === policy.code)) {
      log.skip(`Chính sách ${policy.code} đã có.`);
      continue;
    }
    await qtbh.post(`${config.crmApi}/v1/discount-policies`, { ...policy, status: 'ACTIVE' });
    log.created(`Chính sách ${policy.code} "${policy.name}".`);
  }

  const settings = await qtbh.get(`${config.crmApi}/v1/pricing/settings`);
  if (Number(settings.discountCapPercent) === DISCOUNT_CAP_PERCENT) log.skip(`Trần chiết khấu đã là ${DISCOUNT_CAP_PERCENT}%.`);
  else {
    await qtbh.put(`${config.crmApi}/v1/pricing/settings`, { discountCapPercent: DISCOUNT_CAP_PERCENT });
    log.created(`Trần chiết khấu: ${settings.discountCapPercent}% -> ${DISCOUNT_CAP_PERCENT}%.`);
  }

  const approval = await qtbh.get(`${config.crmApi}/v1/quote-approval/settings`);
  if (JSON.stringify(approval) === JSON.stringify(QUOTE_APPROVAL)) {
    log.skip('Ngưỡng duyệt báo giá đã đúng (NV 5%, TN 15%, biên tối thiểu 10%).');
  } else {
    await qtbh.put(`${config.crmApi}/v1/quote-approval/settings`, QUOTE_APPROVAL);
    log.created('Ngưỡng duyệt báo giá: NV 5%, TN 15%, QL không giới hạn, biên tối thiểu 10%.');
  }
}

async function positionIds(config, admin) {
  const core = await admin.get(`${config.platformApi}/platform/v1/tenant-organization/core-snapshot`);
  return new Map(core.nodes.filter((node) => node.category === 'position').map((node) => [node.code, node]));
}

/** Tạo, công bố định nghĩa quy trình; trả id theo loại duyệt. Lỗi thì trả lý do để gắn DIRECT. */
async function ensureProcedures(config, sessions, log) {
  const admin = await sessions.as('QTV');
  const positions = await positionIds(config, admin);
  const ids = {};
  for (const procedure of PROCEDURES) {
    try {
      const workspace = await admin.get(`${config.procedureApi}/v1/workspace`);
      if (!workspace.permissions?.canManageDefinitions || !workspace.permissions?.canPublishDefinitions) {
        throw new Error('QTV không có quyền thiết kế, công bố quy trình.');
      }
      const position = positions.get(procedure.approver);
      if (!position) throw new Error(`Chưa có chức danh ${procedure.approver}. Chạy --step=tenant trước.`);
      const body = {
        name: procedure.name,
        description: `Duyệt cho Bán hàng (${procedure.kind}); tạo bởi tools/crm/seed-svn.mjs`,
        kind: 'process',
        category: PROCEDURE_CATEGORY,
        steps: [
          {
            key: 'GUI_DUYET',
            order: 1,
            name: 'Người lập gửi duyệt',
            assignments: [{ role: 'S', subjectType: 'everyone', subjectId: 'everyone', subjectLabel: 'Toàn bộ nhân viên' }],
          },
          {
            key: 'DUYET',
            order: 2,
            name: `${procedure.approverLabel} duyệt`,
            assignments: [{ role: 'A', subjectType: 'position', subjectId: position.id, subjectLabel: procedure.approverLabel }],
          },
        ],
      };
      // Bản đã công bố mới nhất theo mã; không có thì bản nháp.
      const sameCode = workspace.definitions.filter((item) => item.code === procedure.code && item.status !== 'archived');
      let definition = sameCode.find((item) => item.status === 'published') ?? sameCode.find((item) => item.status === 'draft');
      if (!definition) {
        definition = await admin.post(`${config.procedureApi}/v1/definitions`, { code: procedure.code, ...body });
        log.created(`Quy trình ${procedure.code} "${procedure.name}" (nháp).`);
      }
      if (definition.status !== 'published') {
        const check = await admin.post(`${config.procedureApi}/v1/definitions/${definition.id}/validate`);
        const errors = check?.errors ?? [];
        if (errors.length) throw new Error(`kiểm tra trước khi công bố báo lỗi: ${JSON.stringify(errors).slice(0, 300)}`);
        definition = await admin.post(`${config.procedureApi}/v1/definitions/${definition.id}/publish`);
        log.created(`Công bố quy trình ${procedure.code}.`);
      } else log.skip(`Quy trình ${procedure.code} đã công bố.`);
      ids[procedure.kind] = { id: definition.id, name: procedure.name };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.warn(`Không tạo, công bố được quy trình ${procedure.code}: ${reason}`);
      ids[procedure.kind] = { error: reason };
    }
  }
  return ids;
}

async function ensureBindings(config, sessions, procedures, log) {
  const qtbh = await sessions.as('QTBH');
  const bindings = await qtbh.get(`${config.crmApi}/v1/approval-bindings`);
  for (const procedure of PROCEDURES) {
    const current = bindings.find((item) => item.kind === procedure.kind);
    const target = procedures[procedure.kind];
    const wanted = target?.id
      ? { mode: 'PROCEDURE', procedureDefinitionId: target.id }
      : { mode: 'DIRECT', procedureDefinitionId: null };
    if (current?.mode === wanted.mode && (current.procedureDefinitionId ?? null) === wanted.procedureDefinitionId) {
      log.skip(`Cách duyệt ${procedure.kind} đã là ${wanted.mode}${target?.id ? ` (${target.name})` : ''}.`);
      continue;
    }
    await qtbh.put(`${config.crmApi}/v1/approval-bindings/${procedure.kind}`, wanted);
    if (target?.id) log.created(`Cách duyệt ${procedure.kind}: qua Quy trình "${target.name}".`);
    else log.warn(`Cách duyệt ${procedure.kind}: DIRECT vì quy trình không công bố được (${target?.error}).`);
  }
}

async function summary(config, sessions, log) {
  const nv1 = await sessions.as('NV1');
  const qtv = await sessions.as('QTV');
  const materials = await materialsByCode(config, qtv);
  const cap = materials.get('QA-KHO-CAP');
  const preview = async (customerGroupId, quantity, date) =>
    nv1.post(`${config.crmApi}/v1/pricing/quote-preview`, {
      ...(customerGroupId ? { customerGroupId } : {}),
      ...(date ? { date } : {}),
      lines: [{ materialId: cap.id, quantity, unit: cap.unit }],
    });
  for (const quantity of [9, 10, 50]) {
    const result = await preview(null, quantity);
    const line = result.lines[0];
    log.info(
      `Thử tính ${quantity} QA-KHO-CAP (bảng chuẩn): giá ${line.listPrice}, chiết khấu ${line.discountPercent}%, ` +
        `thành tiền trước VAT ${line.lineAmount}, VAT ${line.vatAmount}.`,
    );
  }
  const december = await preview(null, 50, `${new Date().getFullYear()}-12-15`);
  log.info(
    `Thử tính 50 QA-KHO-CAP ngày 15/12: chiết khấu ${december.lines[0].discountPercent}%` +
      `${december.lines[0].cappedAt === null ? '' : ` (chạm trần ${december.lines[0].cappedAt}%)`}.`,
  );
  const groups = await nv1.get(`${config.crmApi}/v1/customer-groups`);
  const dealer = groups.find((group) => group.code === GROUPS[0].code);
  const dealerLine = (await preview(dealer.id, 1)).lines[0];
  log.info(`Thử tính 1 QA-KHO-CAP nhóm Đại lý cấp 1: giá ${dealerLine.listPrice} (${dealerLine.priceSource} ${dealerLine.priceReferenceCode}).`);
  const bindings = await nv1.get(`${config.crmApi}/v1/approval-bindings`);
  log.info(`Cách duyệt: ${bindings.map((item) => `${item.kind}=${item.mode}${item.procedureDefinitionName ? ` (${item.procedureDefinitionName})` : ''}`).join(', ')}.`);
}

export async function runPricingStep(config, log) {
  log.section(`Bước pricing cho ${config.tenantSlug}`);
  const sessions = createSessions(config);
  log.section('Bảng giá');
  await ensurePriceLists(config, sessions, log);
  log.section('Chính sách chiết khấu, trần, ngưỡng duyệt');
  await ensurePolicies(config, sessions, log);
  log.section('Quy trình duyệt (Quy trình) và cách duyệt (Bán hàng)');
  const procedures = await ensureProcedures(config, sessions, log);
  await ensureBindings(config, sessions, procedures, log);
  log.section('Tóm tắt');
  await summary(config, sessions, log);
}
