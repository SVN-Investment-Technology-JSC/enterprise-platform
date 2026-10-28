// Bước `crm` (T2-24): khách hàng, người liên hệ, lead, cơ hội, hoạt động cho tenant thí điểm.
// Chạy chuyển khách Workspace (T2-15) trước. Mỗi nhân viên tự tạo khách, lead, cơ hội, hoạt động của mình để test phạm vi
// dữ liệu (TC-PERM-02, TC-PERM-04); nhóm khách do Quản trị bán hàng (QTBH) tạo. Chạy lại được: bản ghi khớp theo mã
// (khách, nhóm), tên (lead, cơ hội, người liên hệ) hoặc tiêu đề (hoạt động).
import { migrateWorkspaceCustomers } from '../migrate-workspace-customers.mjs';
import { addDays, allPages, createSessions, customersByCode, materialsByCode, vnInstant, vnToday } from './common.mjs';

export const GROUPS = [
  { key: 'DL1', code: 'QA-CRM-DL1', name: 'Đại lý cấp 1', description: 'Đại lý cấp 1, có bảng giá riêng' },
  { key: 'VIP', code: 'QA-CRM-VIP', name: 'VIP', description: 'Khách hàng VIP' },
  { key: 'DA', code: 'QA-CRM-DA', name: 'Dự án', description: 'Khách hàng mua theo dự án' },
];

const PLACES = [
  { province: 'Hà Nội', region: 'Miền Bắc' },
  { province: 'Hải Phòng', region: 'Miền Bắc' },
  { province: 'Đà Nẵng', region: 'Miền Trung' },
  { province: 'Khánh Hòa', region: 'Miền Trung' },
  { province: 'TP. Hồ Chí Minh', region: 'Miền Nam' },
  { province: 'Cần Thơ', region: 'Miền Nam' },
];
const INDUSTRIES = ['Sản xuất', 'Thương mại', 'Xây dựng', 'Giáo dục', 'Y tế'];
const CONTACT_NAMES = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Văn Cường', 'Phạm Thị Dung', 'Hoàng Văn Em', 'Vũ Thị Giang'];
const OWNERS = ['NV1', 'NV2', 'NV3'];

/** MST của KH01 dùng cho test cảnh báo trùng MST (TC-CUS-05, TC-OPP-03). */
export const DUPLICATE_TAX_CODE = '0101234567';

/** 30 khách QA-CRM-KH01..KH30: NV1 có KH01-10, NV2 có KH11-20, NV3 có KH21-30; nhóm xoay vòng DL1, VIP, Dự án. */
export const CUSTOMERS = Array.from({ length: 30 }, (_, index) => {
  const no = String(index + 1).padStart(2, '0');
  const place = PLACES[index % PLACES.length];
  return {
    code: `QA-CRM-KH${no}`,
    name: `QA Công ty TNHH Khách hàng ${no}`,
    owner: OWNERS[Math.floor(index / 10)],
    group: GROUPS[index % GROUPS.length].key,
    taxCode: index === 0 ? DUPLICATE_TAX_CODE : `0109${String(index + 1).padStart(6, '0')}`,
    ...place,
    address: `Số ${index + 1} đường Thử Nghiệm, ${place.province}`,
    industry: INDUSTRIES[index % INDUSTRIES.length],
    phone: `0241000${String(index + 1).padStart(4, '0')}`,
    email: `kh${no}@qa-crm.example`,
    paymentTermDays: 30,
  };
});

const LEADS = Array.from({ length: 10 }, (_, index) => {
  const no = String(index + 1).padStart(2, '0');
  const status = index < 5 ? 'NEW' : index < 8 ? 'WORKING' : index === 8 ? 'DISQUALIFIED' : 'WORKING';
  return {
    name: `QA-CRM Lead ${no}`,
    owner: OWNERS[index % OWNERS.length],
    contactName: CONTACT_NAMES[index % CONTACT_NAMES.length],
    phone: `0912000${String(index + 1).padStart(3, '0')}`,
    email: `lead${no}@qa-crm.example`,
    source: ['Website', 'Hội chợ', 'Giới thiệu'][index % 3],
    need: 'Quan tâm máy tính xách tay và vật tư in ấn',
    status,
    // Lead 10 cùng MST với KH01: chuyển đổi phải gắn vào khách cũ (TC-OPP-03).
    taxCode: index === 9 ? DUPLICATE_TAX_CODE : null,
  };
});

/** Cơ hội ở đủ 7 giai đoạn; NV1 có cả 7. */
const OPPORTUNITIES = [
  ['CH01', 'NV1', 'QA-CRM-KH01', 'NEW'],
  ['CH02', 'NV1', 'QA-CRM-KH02', 'CONTACTED'],
  ['CH03', 'NV1', 'QA-CRM-KH03', 'DISCOVERY'],
  ['CH04', 'NV1', 'QA-CRM-KH04', 'QUOTING'],
  ['CH05', 'NV1', 'QA-CRM-KH05', 'NEGOTIATION'],
  ['CH06', 'NV1', 'QA-CRM-KH06', 'WON'],
  ['CH07', 'NV1', 'QA-CRM-KH07', 'LOST'],
  ['CH08', 'NV2', 'QA-CRM-KH11', 'NEW'],
  ['CH09', 'NV2', 'QA-CRM-KH12', 'CONTACTED'],
  ['CH10', 'NV2', 'QA-CRM-KH13', 'QUOTING'],
  ['CH11', 'NV2', 'QA-CRM-KH14', 'NEGOTIATION'],
  ['CH12', 'NV3', 'QA-CRM-KH21', 'NEW'],
  ['CH13', 'NV3', 'QA-CRM-KH22', 'DISCOVERY'],
  ['CH14', 'NV3', 'QA-CRM-KH23', 'LOST'],
  ['CH15', 'NV3', 'QA-CRM-KH24', 'WON'],
].map(([key, owner, customer, stage], index) => ({
  key,
  name: `QA-CRM ${key} Cung cấp thiết bị cho ${customer}`,
  owner,
  customer,
  stage,
  expectedValue: (index + 1) * 10_000_000,
}));

const STAGE_PATH = ['NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON'];
const LOST_REASON = 'Khách chọn nhà cung cấp khác (dữ liệu seed)';
/** Người duyệt trực tiếp báo giá: cấp trên của người lập theo cơ cấu tổ chức. */
const QUOTE_APPROVER = { NV1: 'TN', NV2: 'TN', NV3: 'QL' };
/** Dòng báo giá cho cơ hội Thắng: dịch vụ, giá nhập tay (bước crm chạy trước khi có bảng giá). */
const WON_QUOTE_LINE = { materialCode: 'QA-KHO-BT', quantity: 1, overrideUnitPrice: 10_000_000 };

/** Mỗi nhân viên 3 hoạt động: quá hạn (mở), sắp tới (mở), đã xong. */
function activitiesFor(owner, customerCode, opportunityName) {
  return [
    { subject: `QA-CRM HĐ ${owner} gọi lại khách (quá hạn)`, type: 'CALL', customer: customerCode, dueDays: -3 },
    { subject: `QA-CRM HĐ ${owner} gặp khách trình bày giải pháp`, type: 'MEETING', customer: customerCode, opportunity: opportunityName, dueDays: 3 },
    { subject: `QA-CRM HĐ ${owner} gửi email giới thiệu (đã xong)`, type: 'EMAIL', customer: customerCode, dueDays: -7, done: 'Đã gửi email, khách hẹn gọi lại' },
  ];
}

async function migrateWorkspace(config, sessions, log) {
  const admin = await sessions.as('QTV');
  const report = await migrateWorkspaceCustomers(config, admin, { dryRun: false, generateCodes: false }, log);
  log.info(
    `Chuyển khách Workspace: ${report.total} khách, ${report.alreadyLinked} đã gắn, ${report.created} tạo mới, ` +
      `${report.matched} khớp có sẵn, ${report.invalidCode} mã không hợp lệ, ${report.failed} lỗi.`,
  );
  if (report.failed) throw new Error('Chuyển khách Workspace có lỗi; xem dòng "!" ở trên.');
}

async function ensureGroups(config, sessions, log) {
  const qtbh = await sessions.as('QTBH');
  const groups = await qtbh.get(`${config.crmApi}/v1/customer-groups`);
  const ids = {};
  for (const group of GROUPS) {
    let found = groups.find((item) => item.code === group.code);
    if (found) log.skip(`Nhóm khách ${group.code} "${group.name}" đã có.`);
    else {
      found = await qtbh.post(`${config.crmApi}/v1/customer-groups`, {
        code: group.code,
        name: group.name,
        description: group.description,
      });
      log.created(`Nhóm khách ${group.code} "${group.name}".`);
    }
    ids[group.key] = found.id;
  }
  return ids;
}

async function ensureCustomers(config, sessions, groupIds, log) {
  const admin = await sessions.as('QTV');
  const existing = await customersByCode(config, admin);
  const result = new Map();
  for (const customer of CUSTOMERS) {
    const ownerId = await sessions.userId(customer.owner);
    let detail = existing.get(customer.code);
    if (detail) {
      if (detail.ownerUserId !== ownerId) log.warn(`${customer.code} đã có nhưng người phụ trách khác ${customer.owner}; giữ nguyên.`);
      else log.skip(`Khách ${customer.code} (${customer.owner}) đã có.`);
      detail = await admin.get(`${config.crmApi}/v1/customers/${detail.id}`);
    } else {
      const owner = await sessions.as(customer.owner);
      const { owner: _owner, group, ...fields } = customer;
      detail = await owner.post(`${config.crmApi}/v1/customers`, {
        ...fields,
        kind: 'CUSTOMER',
        groupId: groupIds[group],
        // KH01 mang MST dùng cho test trùng; các khách khác MST riêng. Xác nhận để chạy lại sau khi dữ liệu test đã thêm
        // khách trùng MST vẫn tạo được.
        confirmDuplicateTaxCode: true,
      });
      log.created(`Khách ${customer.code} "${customer.name}" (${customer.owner}, nhóm ${group}, ${customer.province}).`);
    }
    result.set(customer.code, detail);
  }
  return result;
}

async function ensureContacts(config, sessions, customers, log) {
  let created = 0;
  for (const [index, customer] of CUSTOMERS.entries()) {
    const detail = customers.get(customer.code);
    const wanted = [
      { fullName: CONTACT_NAMES[index % CONTACT_NAMES.length], title: 'Giám đốc', isPrimary: true },
      ...(index % 5 === 0 ? [{ fullName: CONTACT_NAMES[(index + 3) % CONTACT_NAMES.length], title: 'Kế toán trưởng' }] : []),
    ];
    const owner = await sessions.as(customer.owner);
    for (const [position, contact] of wanted.entries()) {
      if (detail.contacts.some((item) => item.fullName === contact.fullName)) continue;
      const updated = await owner.post(`${config.crmApi}/v1/customers/${detail.id}/contacts`, {
        ...contact,
        phone: `0903${String(index + 1).padStart(3, '0')}${position}00`,
        email: `lienhe${position + 1}.${customer.code.toLowerCase()}@qa-crm.example`,
      });
      detail.contacts = updated.contacts;
      created += 1;
    }
  }
  if (created) log.created(`${created} người liên hệ.`);
  else log.skip('Người liên hệ của 30 khách đã đủ.');
}

async function ensureLeads(config, sessions, log) {
  const admin = await sessions.as('QTV');
  const existing = new Map(
    (await allPages(admin, `${config.crmApi}/v1/leads?q=${encodeURIComponent('QA-CRM Lead')}`)).map((lead) => [lead.name, lead]),
  );
  for (const lead of LEADS) {
    const owner = await sessions.as(lead.owner);
    const { owner: _owner, status, ...fields } = lead;
    let current = existing.get(lead.name);
    if (!current) {
      current = await owner.post(`${config.crmApi}/v1/leads`, fields);
      log.created(`Lead "${lead.name}" (${lead.owner}).`);
    }
    if (current.status === status || current.status === 'CONVERTED') {
      if (existing.has(lead.name)) log.skip(`Lead "${lead.name}" đã có (${current.status}).`);
      continue;
    }
    await owner.patch(`${config.crmApi}/v1/leads/${current.id}`, { ...fields, status, version: current.version });
    log.created(`Lead "${lead.name}": ${current.status} -> ${status}.`);
  }
}

/** Báo giá được khách chấp nhận cho cơ hội (điều kiện chuyển Thắng). Trả `false` khi không làm tiếp được. */
async function ensureAcceptedQuote(config, sessions, opportunity, definition, materials, log) {
  const owner = await sessions.as(definition.owner);
  const quotes = await allPages(owner, `${config.crmApi}/v1/quotes?opportunityId=${opportunity.id}`);
  if (quotes.some((quote) => quote.status === 'ACCEPTED')) return true;
  let quote = quotes.find((item) => !['DECLINED', 'EXPIRED'].includes(item.status));
  const url = (id) => `${config.crmApi}/v1/quotes/${id}`;
  quote = quote
    ? await owner.get(url(quote.id))
    : await owner.post(`${config.crmApi}/v1/quotes`, { opportunityId: opportunity.id, note: `Seed: báo giá cho ${definition.key}` });
  let version = quote.version;
  const act = async (session, action, body = {}) => {
    const updated = await session.post(`${url(quote.id)}/versions/${version.versionNo}/${action}`, { revision: version.revision, ...body });
    quote = updated;
    version = updated.version;
  };
  if (version.status === 'DRAFT' && !version.lines.length) {
    const material = materials.get(WON_QUOTE_LINE.materialCode);
    if (!material) throw new Error(`Chưa có mặt hàng ${WON_QUOTE_LINE.materialCode}. Chạy --step=inventory trước.`);
    const updated = await owner.post(`${url(quote.id)}/versions/${version.versionNo}/lines`, {
      revision: version.revision,
      materialId: material.id,
      quantity: WON_QUOTE_LINE.quantity,
      overrideUnitPrice: WON_QUOTE_LINE.overrideUnitPrice,
    });
    quote = updated;
    version = updated.version;
  }
  if (version.status === 'DRAFT') await act(owner, 'submit');
  if (version.status === 'PENDING') {
    if (quote.procedure) {
      log.warn(`${definition.key}: báo giá ${quote.code} đang chờ duyệt qua Quy trình; duyệt xong rồi chạy lại để chuyển Thắng.`);
      return false;
    }
    await act(await sessions.as(QUOTE_APPROVER[definition.owner]), 'approve', { reason: 'Seed: duyệt báo giá' });
  }
  if (version.status === 'APPROVED') await act(owner, 'send');
  if (version.status === 'SENT') await act(owner, 'accept');
  if (version.status !== 'ACCEPTED') {
    log.warn(`${definition.key}: báo giá ${quote.code} ở trạng thái ${version.status}, không chuyển Thắng được.`);
    return false;
  }
  log.created(`${definition.key}: báo giá ${quote.code} khách chấp nhận.`);
  return true;
}

async function ensureOpportunities(config, sessions, customers, log) {
  const admin = await sessions.as('QTV');
  const materials = await materialsByCode(config, admin);
  const existing = new Map(
    (await allPages(admin, `${config.crmApi}/v1/opportunities?q=${encodeURIComponent('QA-CRM')}`)).map((item) => [item.name, item]),
  );
  const result = new Map();
  for (const definition of OPPORTUNITIES) {
    const owner = await sessions.as(definition.owner);
    let current = existing.get(definition.name);
    if (!current) {
      current = await owner.post(`${config.crmApi}/v1/opportunities`, {
        customerId: customers.get(definition.customer).id,
        name: definition.name,
        expectedValue: definition.expectedValue,
        expectedCloseDate: addDays(vnToday(), 30),
        need: 'Thiết bị văn phòng và dịch vụ bảo trì',
      });
      log.created(`Cơ hội ${definition.key} (${definition.owner}, ${definition.customer}).`);
    }
    const target = definition.stage;
    const start = current.stage;
    const changeStage = async (stage, reason) => {
      current = await owner.patch(`${config.crmApi}/v1/opportunities/${current.id}/stage`, {
        stage,
        ...(reason ? { reason } : {}),
        version: current.version,
      });
    };
    if (current.stage !== target && ['WON', 'LOST'].includes(current.stage)) {
      log.warn(`Cơ hội ${definition.key} đã ${current.stage}, không đưa về ${target} được.`);
    } else if (target === 'LOST' && current.stage !== 'LOST') {
      await changeStage('LOST', LOST_REASON);
    } else if (target !== 'LOST') {
      const goal = STAGE_PATH.indexOf(target);
      while (STAGE_PATH.indexOf(current.stage) < goal) {
        const next = STAGE_PATH[STAGE_PATH.indexOf(current.stage) + 1];
        if (next === 'WON' && !(await ensureAcceptedQuote(config, sessions, current, definition, materials, log))) break;
        await changeStage(next);
      }
      if (STAGE_PATH.indexOf(current.stage) > goal) log.warn(`Cơ hội ${definition.key} đang ${current.stage}, sau ${target}; giữ nguyên.`);
    }
    if (current.stage === start) {
      if (existing.has(definition.name)) log.skip(`Cơ hội ${definition.key} đã ở ${current.stage}.`);
    } else log.created(`Cơ hội ${definition.key}: ${start} -> ${current.stage}.`);
    result.set(definition.key, current);
  }
  return result;
}

async function ensureActivities(config, sessions, customers, opportunities, log) {
  for (const owner of OWNERS) {
    const session = await sessions.as(owner);
    const userId = await sessions.userId(owner);
    const mine = await allPages(session, `${config.crmApi}/v1/activities?assigneeUserId=${userId}`);
    const firstCustomer = CUSTOMERS.find((customer) => customer.owner === owner).code;
    const firstOpportunity = OPPORTUNITIES.find((item) => item.owner === owner && item.stage === 'NEW').key;
    for (const activity of activitiesFor(owner, firstCustomer, firstOpportunity)) {
      let current = mine.find((item) => item.subject === activity.subject);
      if (!current) {
        current = await session.post(`${config.crmApi}/v1/activities`, {
          type: activity.type,
          subject: activity.subject,
          description: 'Dữ liệu seed tools/crm/seed-svn.mjs',
          customerId: customers.get(activity.customer).id,
          ...(activity.opportunity ? { opportunityId: opportunities.get(activity.opportunity).id } : {}),
          dueAt: vnInstant(activity.dueDays),
        });
        log.created(`Hoạt động "${activity.subject}" (hạn ${activity.dueDays > 0 ? '+' : ''}${activity.dueDays} ngày).`);
      } else log.skip(`Hoạt động "${activity.subject}" đã có (${current.status}).`);
      if (activity.done && current.status === 'OPEN') {
        await session.patch(`${config.crmApi}/v1/activities/${current.id}`, {
          version: current.version,
          status: 'DONE',
          result: activity.done,
        });
        log.created(`Hoạt động "${activity.subject}": hoàn tất.`);
      }
    }
  }
}

async function summary(config, sessions, log) {
  const admin = await sessions.as('QTV');
  const customers = await allPages(admin, `${config.crmApi}/v1/customers?q=${encodeURIComponent('QA-CRM-KH')}`);
  const byOwner = {};
  for (const owner of OWNERS) {
    const userId = await sessions.userId(owner);
    byOwner[owner] = customers.filter((customer) => customer.ownerUserId === userId).length;
  }
  log.info(`Khách QA-CRM-KH: ${customers.length} (${OWNERS.map((owner) => `${owner} ${byOwner[owner]}`).join(', ')}).`);
  const nv1 = await sessions.as('NV1');
  const visible = await allPages(nv1, `${config.crmApi}/v1/customers?q=${encodeURIComponent('QA-CRM-KH')}`);
  log.info(`NV1 thấy ${visible.length} khách QA-CRM-KH (mong đợi 10, chỉ của mình).`);
  const board = await admin.get(`${config.crmApi}/v1/opportunities/board`);
  log.info(`Kanban (QTV): ${board.columns.map((column) => `${column.stage} ${column.total}`).join(', ')}.`);
}

export async function runCrmStep(config, log) {
  log.section(`Bước crm cho ${config.tenantSlug}`);
  const sessions = createSessions(config);
  log.section('Chuyển khách Workspace sang Bán hàng (T2-15)');
  await migrateWorkspace(config, sessions, log);
  log.section('Nhóm khách hàng');
  const groupIds = await ensureGroups(config, sessions, log);
  log.section('Khách hàng và người liên hệ');
  const customers = await ensureCustomers(config, sessions, groupIds, log);
  await ensureContacts(config, sessions, customers, log);
  log.section('Lead');
  await ensureLeads(config, sessions, log);
  log.section('Cơ hội');
  const opportunities = await ensureOpportunities(config, sessions, customers, log);
  log.section('Hoạt động');
  await ensureActivities(config, sessions, customers, opportunities, log);
  log.section('Tóm tắt');
  await summary(config, sessions, log);
}
