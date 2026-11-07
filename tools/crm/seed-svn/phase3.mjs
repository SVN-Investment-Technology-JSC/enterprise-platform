// Bước `phase3` (P3C5-01): dữ liệu phase 3 (bố cục in của mẫu báo giá, bản chụp khi gửi) theo
// docs/crm/phase3/test_phase3.md mục 1.3, chỉ qua API thật. Chạy lại được: mẫu khớp theo tên, trường tuỳ biến theo tên,
// báo giá theo "Tên báo giá" (tiền tố QA-P3), mặt hàng và khách theo mã. Bản ghi đã có thì bỏ qua, không ghi đè bố cục
// (script e2e phase 3 tự trả bố cục về như cũ sau khi sửa).
//
// Cần đã chạy các bước inventory, crm, pricing (khách QA-CRM-KH01, KH21; mặt hàng QA-KHO-CAP, MUC, BT; bảng giá chuẩn)
// và migration crm 0034 đã áp cho tenant.
import { deflateSync, crc32 } from 'node:zlib';
import { allPages, createSessions, materialsByCode, requireCustomers } from './common.mjs';

export const P3_PREFIX = 'QA-P3';

/** Mẫu báo giá của phase 3 (tên theo test_phase3 mục 1.3). `M-PRE`: mẫu của báo giá gửi trước phase 3 (Q-OLD). */
export const P3_TEMPLATES = {
  'M-A4': { name: 'Báo giá thiết bị', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: VAT theo dòng, bố cục A4 đứng có logo' },
  'M-A3': { name: 'Báo giá dịch vụ', discountMode: 'ORDER', taxMode: 'ORDER', description: 'QA-P3: chiết khấu, thuế tổng đơn, bố cục A3 ngang' },
  'M-NONE': { name: 'Báo giá cơ bản', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: chưa có bố cục' },
  'M-OFF': { name: 'QA-P3 Mẫu đã tắt', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: mẫu đang tắt, có bố cục' },
  'M-PRE': { name: 'QA-P3 Mẫu trước phase 3', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: mẫu của báo giá gửi trước phase 3' },
};

/** Trường tuỳ biến của báo giá. */
export const P3_FIELDS = {
  'CF-PAY': { name: 'Điều khoản thanh toán', sortOrder: 31 },
  'CF-SHIP': { name: 'Tiến độ giao hàng', sortOrder: 32 },
  'CF-OFF': { name: 'QA-P3 Ghi chú cũ (đã tắt)', sortOrder: 33 },
};

/** Báo giá của phase 3, khớp theo "Tên báo giá". */
export const P3_QUOTES = {
  'Q-DRAFT': `${P3_PREFIX} Q-DRAFT báo giá nháp 3 dòng`,
  'Q-LONG': `${P3_PREFIX} Q-LONG báo giá 200 dòng`,
  'Q-SENT': `${P3_PREFIX} Q-SENT báo giá đã gửi có bản chụp`,
  'Q-OLD': `${P3_PREFIX} Q-OLD báo giá gửi trước phase 3`,
  'Q-ORDER': `${P3_PREFIX} Q-ORDER chiết khấu, thuế tổng đơn`,
  'Q-XSS': `${P3_PREFIX} Q-XSS ký tự đặc biệt`,
  'Q-OUT': `${P3_PREFIX} Q-OUT ngoài phạm vi NV1`,
  'Q-OFFUSE': `${P3_PREFIX} Q-OFFUSE báo giá dùng mẫu đã tắt`,
};

export const P3_XSS_CUSTOMER = { code: 'QA-P3-XSS', name: '<img src=x onerror=alert(1)>' };
export const P3_LONG_WORD = 'X'.repeat(80);
export const P3_MATERIALS = {
  long: {
    code: 'QA-P3-DAI',
    name: `QA-P3 Dịch vụ khảo sát, lắp đặt, cấu hình, hiệu chỉnh và bảo trì định kỳ hệ thống thiết bị tại công trình của khách hàng ${P3_LONG_WORD}`,
    category: 'CONSUMABLE',
    unit: 'Gói',
    kind: 'SERVICE',
  },
  special: { code: 'QA-P3-KYTU', name: `"&<>'`, category: 'CONSUMABLE', unit: 'Gói', kind: 'SERVICE' },
};
export const P3_SCRIPT_TEXT = '<script>alert(1)</script>';

// ---------------------------------------------------------------------------
// Ảnh PNG sinh tại chỗ (nhiễu giả ngẫu nhiên, không nén được) để có logo ~150 KB
// ---------------------------------------------------------------------------

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** PNG RGB `size`x`size` điểm ảnh nhiễu theo `seed` (cùng seed cho cùng file). */
export function makePng(size, seed = 1) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size * 3; x += 1) raw[row + 1 + x] = next();
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const pngDataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

// ---------------------------------------------------------------------------
// Bố cục
// ---------------------------------------------------------------------------

const column = (key, label, widthPct, align, visible) => ({ key, label, widthPct, align, visible });

/** M-A4: A4 đứng, đủ 11 loại khối, logo PNG ~150 KB; điều khoản dùng biến của CF-PAY, CF-SHIP và CF-OFF. */
export function layoutA4(fields, title = 'BÁO GIÁ THIẾT BỊ') {
  return {
    version: 1,
    paper: 'A4',
    orientation: 'portrait',
    marginsMm: { top: 15, right: 15, bottom: 15, left: 20 },
    fontFamily: 'Times New Roman',
    fontSizePt: 12,
    blocks: [
      {
        id: 'company',
        type: 'companyHeader',
        name: 'CÔNG TY TNHH THỬ NGHIỆM QA PHASE 3',
        lines: ['Địa chỉ: Số 1 đường Thử Nghiệm, Hà Nội', 'Mã số thuế: 0100000003', 'Điện thoại: 024 0000 0003'],
        logo: pngDataUrl(makePng(224, 3)),
        logoPosition: 'left',
        align: 'left',
      },
      { id: 'company-divider', type: 'divider', thicknessPt: 1, style: 'solid' },
      {
        id: 'title',
        type: 'title',
        text: title,
        subtitle: 'Số: {{quote.code}} - Ngày: {{quote.date}}',
        fontSizePt: 20,
        align: 'center',
        uppercase: true,
        marginTopMm: 4,
      },
      {
        id: 'customer',
        type: 'fieldGrid',
        columns: 2,
        labelWidthPct: 35,
        marginTopMm: 4,
        items: [
          { label: 'Báo giá đến', value: '{{customer.name}}' },
          { label: 'Mã số thuế', value: '{{customer.taxCode}}' },
          { label: 'Địa chỉ', value: '{{customer.address}}' },
          { label: 'Hiệu lực đến', value: '{{quote.validUntil}}' },
          { label: 'Người báo giá', value: '{{owner.name}}' },
          { label: 'Tên báo giá', value: '{{quote.name}}' },
        ],
      },
      {
        id: 'intro',
        type: 'text',
        align: 'left',
        marginTopMm: 4,
        runs: [
          { text: 'Công ty chúng tôi trân trọng gửi tới Quý khách báo giá thiết bị như sau. ', italic: true },
          { text: `Ghi chú kỹ thuật: ${P3_SCRIPT_TEXT}`, bold: true },
        ],
      },
      {
        id: 'lines',
        type: 'lineTable',
        marginTopMm: 2,
        zebra: true,
        showGroupByCategory: false,
        columns: [
          column('index', 'TT', 5, 'center', true),
          column('materialCode', 'Mã hàng', 10, 'left', true),
          column('materialName', 'Tên hàng hoá, dịch vụ', 25, 'left', true),
          column('unit', 'ĐVT', 7, 'center', true),
          column('quantity', 'Số lượng', 8, 'right', true),
          column('unitPrice', 'Đơn giá', 13, 'right', true),
          column('vatRate', 'VAT (%)', 7, 'right', true),
          column('lineAmount', 'Thành tiền', 12, 'right', true),
          column('lineTotal', 'Tổng cộng', 13, 'right', true),
          column('listPrice', 'Đơn giá gốc', 12, 'right', false),
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        align: 'right',
        showAmountInWords: true,
        marginTopMm: 2,
        rows: [
          { key: 'subtotal', label: 'Cộng tiền hàng', visible: true },
          { key: 'lineDiscount', label: 'Chiết khấu', visible: true },
          { key: 'vat', label: 'Thuế GTGT', visible: true },
          { key: 'grandTotal', label: 'Tổng cộng', visible: true },
        ],
      },
      {
        id: 'terms',
        type: 'terms',
        numbered: true,
        marginTopMm: 4,
        items: [
          { label: 'Điều khoản thanh toán', value: `{{custom.${fields['CF-PAY']}}}` },
          { label: 'Tiến độ giao hàng', value: `{{custom.${fields['CF-SHIP']}}}` },
          { label: 'Ghi chú cũ', value: `{{custom.${fields['CF-OFF']}}}` },
          { label: 'Hiệu lực báo giá', value: 'Đến hết ngày {{quote.validUntil}}' },
        ],
      },
      { id: 'stamp', type: 'image', src: pngDataUrl(makePng(48, 7)), heightMm: 15, align: 'right', marginTopMm: 2 },
      { id: 'gap', type: 'spacer', heightMm: 4 },
      {
        id: 'signature',
        type: 'signature',
        heightMm: 30,
        marginTopMm: 4,
        left: { title: 'ĐẠI DIỆN BÊN MUA', subtitle: '(Ký, ghi rõ họ tên)' },
        right: { title: 'ĐẠI DIỆN BÊN BÁN', subtitle: '(Ký, đóng dấu)', name: '{{owner.name}}' },
      },
    ],
  };
}

/** M-A3: A3 ngang, bảng 5 cột, có dòng chiết khấu, phí, thuế tổng đơn. */
export function layoutA3() {
  return {
    version: 1,
    paper: 'A3',
    orientation: 'landscape',
    marginsMm: { top: 12, right: 12, bottom: 12, left: 15 },
    fontFamily: 'Arial',
    fontSizePt: 11,
    blocks: [
      { id: 'company', type: 'companyHeader', name: 'CÔNG TY TNHH THỬ NGHIỆM QA PHASE 3', lines: ['Mã số thuế: 0100000003'], logoPosition: 'right', align: 'left' },
      { id: 'title', type: 'title', text: 'BÁO GIÁ DỊCH VỤ', subtitle: 'Số: {{quote.code}}', fontSizePt: 18, align: 'center', uppercase: true },
      {
        id: 'customer',
        type: 'fieldGrid',
        columns: 1,
        labelWidthPct: 25,
        items: [
          { label: 'Khách hàng', value: '{{customer.name}}' },
          { label: 'Hiệu lực đến', value: '{{quote.validUntil}}' },
        ],
      },
      {
        id: 'lines',
        type: 'lineTable',
        columns: [
          column('index', 'TT', 6, 'center', true),
          column('materialName', 'Dịch vụ', 44, 'left', true),
          column('quantity', 'Số lượng', 10, 'right', true),
          column('unitPrice', 'Đơn giá', 20, 'right', true),
          column('lineAmount', 'Thành tiền', 20, 'right', true),
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        align: 'right',
        showAmountInWords: true,
        rows: [
          { key: 'subtotal', label: 'Cộng tiền hàng', visible: true },
          { key: 'orderDiscount', label: 'Chiết khấu tổng đơn', visible: true },
          { key: 'fees', label: 'Phí', visible: true },
          { key: 'vat', label: 'Thuế GTGT', visible: true },
          { key: 'orderTax', label: 'Thuế tổng đơn', visible: true },
          { key: 'grandTotal', label: 'Tổng cộng', visible: true },
        ],
      },
      {
        id: 'signature',
        type: 'signature',
        heightMm: 25,
        left: { title: 'KHÁCH HÀNG' },
        right: { title: 'NHÀ CUNG CẤP', name: '{{owner.name}}' },
      },
    ],
  };
}

/** Bố cục ngắn có tiêu đề riêng (M-OFF, M-PRE). */
export function simpleLayout(title) {
  return {
    version: 1,
    paper: 'A4',
    orientation: 'portrait',
    marginsMm: { top: 15, right: 15, bottom: 15, left: 20 },
    fontFamily: 'Roboto',
    fontSizePt: 11,
    blocks: [
      { id: 'title', type: 'title', text: title, subtitle: 'Số: {{quote.code}}', fontSizePt: 18, align: 'center', uppercase: true },
      { id: 'customer', type: 'fieldGrid', columns: 1, labelWidthPct: 30, items: [{ label: 'Khách hàng', value: '{{customer.name}}' }] },
      {
        id: 'lines',
        type: 'lineTable',
        columns: [
          column('index', 'TT', 8, 'center', true),
          column('materialName', 'Hàng hoá', 52, 'left', true),
          column('quantity', 'Số lượng', 15, 'right', true),
          column('lineTotal', 'Tổng cộng', 25, 'right', true),
        ],
      },
      { id: 'totals', type: 'totals', align: 'right', showAmountInWords: false, rows: [{ key: 'grandTotal', label: 'Tổng cộng', visible: true }] },
    ],
  };
}

export const M_OFF_TITLE = 'BÁO GIÁ MẪU ĐÃ TẮT';
export const M_PRE_TITLE = 'BÁO GIÁ THEO MẪU SAU PHASE 3';

// ---------------------------------------------------------------------------
// Đọc dữ liệu phase 3 (dùng chung cho seed và script e2e)
// ---------------------------------------------------------------------------

/** Mẫu theo khoá M-*, đọc bằng phiên có `crm.manage` (thấy cả mẫu đang tắt). */
export async function phase3Templates(config, session) {
  const all = await session.get(`${config.crmApi}/v1/quote-templates?includeInactive=true`);
  const byName = new Map(all.map((template) => [template.name, template]));
  return Object.fromEntries(Object.entries(P3_TEMPLATES).map(([key, def]) => [key, byName.get(def.name)]));
}

export async function phase3Fields(config, session) {
  const all = await session.get(`${config.crmApi}/v1/custom-fields?entityType=quote&includeInactive=true`);
  const byName = new Map(all.map((field) => [field.name, field]));
  return Object.fromEntries(Object.entries(P3_FIELDS).map(([key, def]) => [key, byName.get(def.name)]));
}

/** Báo giá QA-P3 theo khoá Q-*, đọc bằng phiên thấy toàn bộ (QTV). Trả tóm tắt (id, code, status...). */
export async function phase3Quotes(config, session) {
  // Tìm theo `q` chỉ khớp mã và tên khách, không khớp tên báo giá: đọc hết rồi lọc.
  const items = await allPages(session, `${config.crmApi}/v1/quotes`, 20_000);
  const byName = new Map();
  for (const item of items) if (item.quoteName && !byName.has(item.quoteName)) byName.set(item.quoteName, item);
  return Object.fromEntries(Object.entries(P3_QUOTES).map(([key, name]) => [key, byName.get(name)]));
}

/** Đọc đủ dữ liệu phase 3; thiếu thì ném lỗi gợi ý chạy seed. */
export async function requirePhase3(config, sessions) {
  const qtbh = await sessions.as('QTBH');
  const admin = await sessions.as('QTV');
  const [templates, fields, quotes] = await Promise.all([phase3Templates(config, qtbh), phase3Fields(config, qtbh), phase3Quotes(config, admin)]);
  const missing = [
    ...Object.entries(templates).filter(([, value]) => !value).map(([key]) => key),
    ...Object.entries(fields).filter(([, value]) => !value).map(([key]) => key),
    ...Object.entries(quotes).filter(([, value]) => !value).map(([key]) => key),
  ];
  if (missing.length) throw new Error(`Thiếu dữ liệu phase 3: ${missing.join(', ')}. Chạy node tools/crm/seed-svn.mjs --step=phase3 trước.`);
  return { templates, fields, quotes };
}

// ---------------------------------------------------------------------------
// Đưa báo giá tới trạng thái Đã gửi khách
// ---------------------------------------------------------------------------

/**
 * Trình duyệt rồi gửi khách phiên bản hiện tại. Không vượt ngưỡng thì trình duyệt là duyệt luôn; cần duyệt thì TN duyệt
 * trên Quy trình (gắn PROCEDURE) hoặc trực tiếp trên CRM. Trả báo giá sau khi gửi.
 */
export async function sendQuote(config, sessions, quoteId, ownerCode = 'NV1') {
  const owner = await sessions.as(ownerCode);
  const url = `${config.crmApi}/v1/quotes/${quoteId}`;
  let quote = await owner.get(url);
  const act = async (session, action, body = {}) => {
    quote = await session.post(`${url}/versions/${quote.version.versionNo}/${action}`, { revision: quote.version.revision, ...body });
  };
  if (quote.version.status === 'DRAFT') await act(owner, 'submit');
  if (quote.version.status === 'PENDING') {
    const tn = await sessions.as('TN');
    if (quote.procedure) {
      const instanceId = await waitValue(async () => (await owner.get(url)).procedure?.instanceId, 30_000);
      if (!instanceId) throw new Error(`Báo giá ${quote.code}: chưa có phiên Quy trình để duyệt.`);
      const instance = await waitValue(async () => {
        const current = await tn.get(`${config.procedureApi}/v1/instances/${instanceId}`);
        const actions = current?.authorization?.availableActions ?? current?.availableActions ?? [];
        return actions.includes('approve') || actions.includes('complete') ? current : null;
      }, 60_000);
      if (!instance) throw new Error(`Báo giá ${quote.code}: TN không có hành động duyệt trên phiên ${instanceId}.`);
      const actions = instance?.authorization?.availableActions ?? instance?.availableActions ?? [];
      await tn.post(`${config.procedureApi}/v1/instances/${instanceId}/actions`, {
        action: actions.includes('approve') ? 'approve' : 'complete',
        comment: 'QA-P3: duyệt báo giá',
        idempotencyKey: `qa-p3:${quoteId}:${quote.version.versionNo}`,
      });
      quote = (await waitValue(async () => {
        const current = await owner.get(url);
        return current.version.status === 'APPROVED' ? current : null;
      }, 60_000)) ?? (await owner.get(url));
    } else {
      await act(tn, 'approve', { reason: 'QA-P3: duyệt báo giá' });
    }
  }
  if (quote.version.status === 'APPROVED') await act(owner, 'send');
  if (quote.version.status !== 'SENT') throw new Error(`Báo giá ${quote.code} dừng ở ${quote.version.status}, không gửi khách được.`);
  return quote;
}

async function waitValue(check, timeoutMs, intervalMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Bước seed
// ---------------------------------------------------------------------------

export async function runPhase3Step(config, log) {
  log.section(`Bước phase3 cho ${config.tenantSlug}`);
  const crm = config.crmApi;
  const sessions = createSessions(config);
  const [nv1, nv3, qtbh, admin] = await Promise.all(['NV1', 'NV3', 'QTBH', 'QTV'].map((code) => sessions.as(code)));
  const customers = await requireCustomers(config, admin, ['QA-CRM-KH01', 'QA-CRM-KH21']);
  const kh01 = customers.get('QA-CRM-KH01');
  const kh21 = customers.get('QA-CRM-KH21');

  // ---- 1. Mặt hàng dịch vụ tên dài, tên ký tự đặc biệt ----
  log.section('Mặt hàng dịch vụ cho Q-LONG, Q-XSS');
  let materials = await materialsByCode(config, admin);
  for (const material of Object.values(P3_MATERIALS)) {
    if (materials.has(material.code)) {
      log.skip(`Mặt hàng ${material.code} đã có.`);
      continue;
    }
    try {
      await admin.post(`${config.inventoryApi}/v1/materials`, material);
      log.created(`Mặt hàng ${material.code} "${material.name.slice(0, 60)}".`);
    } catch (error) {
      log.warn(`Không tạo được mặt hàng ${material.code}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
    }
  }
  materials = await materialsByCode(config, admin);
  for (const code of ['QA-KHO-CAP', 'QA-KHO-MUC', 'QA-KHO-BT']) {
    if (!materials.has(code)) throw new Error(`Chưa có mặt hàng ${code}. Chạy --step=inventory trước.`);
  }
  const material = (code) => materials.get(code)?.id;

  // ---- 2. Trường tuỳ biến ----
  log.section('Trường tuỳ biến CF-PAY, CF-SHIP, CF-OFF');
  let fields = await phase3Fields(config, qtbh);
  for (const [key, def] of Object.entries(P3_FIELDS)) {
    if (fields[key]) {
      log.skip(`Trường "${def.name}" đã có (${fields[key].active ? 'bật' : 'tắt'}).`);
      continue;
    }
    await qtbh.post(`${crm}/v1/custom-fields`, { entityType: 'quote', name: def.name, fieldType: 'TEXT', required: false, sortOrder: def.sortOrder });
    log.created(`Trường tuỳ biến "${def.name}" (văn bản).`);
  }
  fields = await phase3Fields(config, qtbh);
  for (const key of ['CF-PAY', 'CF-SHIP']) {
    if (!fields[key].active) {
      await qtbh.put(`${crm}/v1/custom-fields/${fields[key].id}`, { name: fields[key].name, fieldType: 'TEXT', active: true });
      log.created(`Bật lại trường "${fields[key].name}".`);
    }
  }
  const fieldIds = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.id]));
  const requiredActive = (await qtbh.get(`${crm}/v1/custom-fields?entityType=quote`)).filter((field) => field.required && field.active);
  if (requiredActive.length) {
    log.warn(`Có trường bắt buộc đang bật (${requiredActive.map((field) => field.name).join(', ')}): báo giá seed có thể không lưu được thông tin chung.`);
  }

  // ---- 3. Mẫu báo giá và bố cục ----
  log.section('Mẫu báo giá M-A4, M-A3, M-NONE, M-OFF, M-PRE');
  let templates = await phase3Templates(config, qtbh);
  for (const [key, def] of Object.entries(P3_TEMPLATES)) {
    if (templates[key]) {
      log.skip(`Mẫu "${def.name}" đã có (${templates[key].active ? 'bật' : 'tắt'}, ${templates[key].hasLayout ? 'có bố cục' : 'chưa có bố cục'}).`);
      continue;
    }
    await qtbh.post(`${crm}/v1/quote-templates`, { ...def, active: true, isDefault: false, sortOrder: 50 });
    log.created(`Mẫu "${def.name}" (${def.discountMode}/${def.taxMode}).`);
  }
  templates = await phase3Templates(config, qtbh);
  const layoutUrl = (key) => `${crm}/v1/quote-templates/${templates[key].id}/layout`;
  const desiredLayouts = { 'M-A4': () => layoutA4(fieldIds), 'M-A3': () => layoutA3(), 'M-OFF': () => simpleLayout(M_OFF_TITLE) };
  for (const [key, build] of Object.entries(desiredLayouts)) {
    const current = await qtbh.get(layoutUrl(key));
    if (current.layout) {
      log.skip(`Mẫu "${templates[key].name}" đã có bố cục.`);
      continue;
    }
    const saved = await qtbh.put(layoutUrl(key), { layout: build(), expectedUpdatedAt: current.updatedAt });
    log.created(`Bố cục mẫu "${templates[key].name}" (${saved.layout.paper} ${saved.layout.orientation}, ${saved.layout.blocks.length} khối).`);
  }
  {
    const current = await qtbh.get(layoutUrl('M-NONE'));
    if (current.layout) {
      await qtbh.put(layoutUrl('M-NONE'), { layout: null, expectedUpdatedAt: current.updatedAt });
      log.created(`Xoá bố cục của mẫu "${templates['M-NONE'].name}" (M-NONE phải chưa có bố cục).`);
    } else log.skip(`Mẫu "${templates['M-NONE'].name}" chưa có bố cục.`);
  }

  // ---- 4. Báo giá ----
  log.section('Báo giá Q-DRAFT, Q-LONG, Q-SENT, Q-OLD, Q-ORDER, Q-XSS, Q-OUT, Q-OFFUSE');
  let quotes = await phase3Quotes(config, admin);
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      log.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    }
  };
  const create = async (session, key, body, lines) => {
    let detail = await session.post(`${crm}/v1/quotes`, { quoteName: P3_QUOTES[key], ...body });
    if (lines.length) {
      detail = await session.post(`${crm}/v1/quotes/${detail.id}/versions/${detail.version.versionNo}/lines/batch`, {
        revision: detail.version.revision,
        lines,
      });
    }
    log.created(`${key}: báo giá ${detail.code} (${lines.length} dòng).`);
    return detail;
  };
  const threeLines = [
    { materialId: material('QA-KHO-CAP'), quantity: 2 },
    { materialId: material('QA-KHO-MUC'), quantity: 3 },
    { materialId: material('QA-KHO-BT'), quantity: 1 },
  ];
  const customValues = {
    [fieldIds['CF-PAY']]: 'Thanh toán 50% khi ký hợp đồng, 50% trong 30 ngày sau khi giao hàng',
    [fieldIds['CF-SHIP']]: 'Giao hàng trong 15 ngày kể từ ngày ký',
  };

  await attempt('Q-DRAFT', async () => {
    if (quotes['Q-DRAFT']) return log.skip(`Q-DRAFT đã có (${quotes['Q-DRAFT'].code}, ${quotes['Q-DRAFT'].status}).`);
    await create(nv1, 'Q-DRAFT', { customerId: kh01.id, templateId: templates['M-A4'].id, customFields: customValues }, threeLines);
  });

  await attempt('Q-LONG', async () => {
    if (quotes['Q-LONG']) return log.skip(`Q-LONG đã có (${quotes['Q-LONG'].code}).`);
    const longId = material(P3_MATERIALS.long.code);
    const lines = Array.from({ length: 200 }, (_, index) =>
      longId && index % 2 === 0
        ? { materialId: longId, quantity: 1 + (index % 5), overrideUnitPrice: 1_500_000 }
        : { materialId: material(index % 4 === 1 ? 'QA-KHO-CAP' : 'QA-KHO-MUC'), quantity: 1 + (index % 7) },
    );
    if (!longId) log.warn('Q-LONG: không có mặt hàng tên dài QA-P3-DAI, dùng mặt hàng có sẵn.');
    await create(nv1, 'Q-LONG', { customerId: kh01.id, templateId: templates['M-A4'].id }, lines);
  });

  await attempt('Q-SENT', async () => {
    const found = quotes['Q-SENT'];
    if (found && found.status !== 'DRAFT') return log.skip(`Q-SENT đã có (${found.code}, ${found.status}).`);
    // CF-OFF còn bật lúc lập: Q-SENT là "báo giá cũ" mang giá trị của trường sau này bị tắt.
    const detail = found
      ? await nv1.get(`${crm}/v1/quotes/${found.id}`)
      : await create(
          nv1,
          'Q-SENT',
          {
            customerId: kh01.id,
            templateId: templates['M-A4'].id,
            customFields: { ...customValues, [fieldIds['CF-OFF']]: 'Giá trị của trường đã tắt (QA-P3)' },
          },
          threeLines,
        );
    const sent = await sendQuote(config, sessions, detail.id);
    log.created(`Q-SENT: gửi khách ${sent.code}, ${sent.version.layoutSnapshot ? 'có' : 'KHÔNG có'} bản chụp bố cục.`);
  });

  await attempt('Q-OLD', async () => {
    const found = quotes['Q-OLD'];
    if (found && found.status !== 'DRAFT') return log.skip(`Q-OLD đã có (${found.code}, ${found.status}).`);
    // Gửi khi mẫu M-PRE chưa có bố cục (giống báo giá gửi trước phase 3), rồi mới thêm bố cục cho mẫu.
    const current = await qtbh.get(layoutUrl('M-PRE'));
    if (current.layout) {
      await qtbh.put(layoutUrl('M-PRE'), { layout: null, expectedUpdatedAt: current.updatedAt });
      log.created('M-PRE: tạm xoá bố cục để gửi Q-OLD không có bản chụp.');
    }
    const detail = found
      ? await nv1.get(`${crm}/v1/quotes/${found.id}`)
      : await create(nv1, 'Q-OLD', { customerId: kh01.id, templateId: templates['M-PRE'].id }, threeLines.slice(0, 2));
    const sent = await sendQuote(config, sessions, detail.id);
    log.created(`Q-OLD: gửi khách ${sent.code}, bản chụp ${sent.version.layoutSnapshot ? 'CÓ (sai)' : 'rỗng'}.`);
  });
  await attempt('M-PRE bố cục', async () => {
    const current = await qtbh.get(layoutUrl('M-PRE'));
    if (current.layout) return log.skip('M-PRE đã có bố cục.');
    await qtbh.put(layoutUrl('M-PRE'), { layout: simpleLayout(M_PRE_TITLE), expectedUpdatedAt: current.updatedAt });
    log.created('M-PRE: thêm bố cục sau khi Q-OLD đã gửi.');
  });

  await attempt('Q-ORDER', async () => {
    let detail = quotes['Q-ORDER'] ? await nv1.get(`${crm}/v1/quotes/${quotes['Q-ORDER'].id}`) : null;
    if (!detail) {
      detail = await create(nv1, 'Q-ORDER', { customerId: kh01.id, templateId: templates['M-A3'].id }, [
        { materialId: material('QA-KHO-CAP'), quantity: 10 },
        { materialId: material('QA-KHO-BT'), quantity: 1 },
      ]);
    }
    const form = detail.version.form;
    if (form.fees.length === 2 && form.orderDiscount.inputKind && form.orderTax.inputKind) return log.skip(`Q-ORDER đã có chiết khấu, thuế tổng đơn, 2 khoản phí (${detail.code}).`);
    if (detail.version.status !== 'DRAFT') return log.warn(`Q-ORDER ${detail.code} không còn Nháp, không sửa được.`);
    await nv1.patch(`${crm}/v1/quotes/${detail.id}/versions/${detail.version.versionNo}`, {
      revision: detail.version.revision,
      orderDiscount: { percent: 5 },
      orderTax: { percent: 10 },
      fees: [
        { feeType: 'Vận chuyển', amount: 200_000 },
        { feeType: 'Lắp đặt', amount: 300_000 },
      ],
    });
    log.created(`Q-ORDER: chiết khấu tổng đơn 5%, thuế tổng đơn 10%, 2 khoản phí (${detail.code}).`);
  });

  await attempt('Q-XSS', async () => {
    if (quotes['Q-XSS']) return log.skip(`Q-XSS đã có (${quotes['Q-XSS'].code}).`);
    const all = await allPages(admin, `${crm}/v1/customers?q=${encodeURIComponent(P3_XSS_CUSTOMER.code)}`);
    let customer = all.find((item) => item.code === P3_XSS_CUSTOMER.code);
    if (!customer) {
      customer = await nv1.post(`${crm}/v1/customers`, { ...P3_XSS_CUSTOMER, kind: 'CUSTOMER', confirmDuplicateTaxCode: true });
      log.created(`Khách ${P3_XSS_CUSTOMER.code} tên ${P3_XSS_CUSTOMER.name}.`);
    }
    const specialId = material(P3_MATERIALS.special.code);
    if (!specialId) log.warn('Q-XSS: không có mặt hàng tên "&<>\' (QA-P3-KYTU); chỉ có tên khách đặc biệt.');
    await create(nv1, 'Q-XSS', { customerId: customer.id, templateId: templates['M-A4'].id }, [
      ...(specialId ? [{ materialId: specialId, quantity: 1, overrideUnitPrice: 2_000_000 }] : []),
      { materialId: material('QA-KHO-CAP'), quantity: 1 },
    ]);
  });

  await attempt('Q-OUT', async () => {
    if (quotes['Q-OUT']) return log.skip(`Q-OUT đã có (${quotes['Q-OUT'].code}).`);
    await create(nv3, 'Q-OUT', { customerId: kh21.id, templateId: templates['M-A4'].id }, threeLines.slice(0, 1));
  });

  await attempt('Q-OFFUSE và tắt M-OFF', async () => {
    if (!quotes['Q-OFFUSE']) {
      const template = templates['M-OFF'];
      if (!template.active) await qtbh.put(`${crm}/v1/quote-templates/${template.id}`, { ...P3_TEMPLATES['M-OFF'], active: true, isDefault: false, sortOrder: template.sortOrder });
      await create(nv1, 'Q-OFFUSE', { customerId: kh01.id, templateId: template.id }, threeLines.slice(0, 1));
    } else log.skip(`Q-OFFUSE đã có (${quotes['Q-OFFUSE'].code}).`);
    templates = await phase3Templates(config, qtbh);
    if (templates['M-OFF'].active) {
      await qtbh.put(`${crm}/v1/quote-templates/${templates['M-OFF'].id}`, { ...P3_TEMPLATES['M-OFF'], active: false, isDefault: false, sortOrder: templates['M-OFF'].sortOrder });
      log.created(`Tắt mẫu "${templates['M-OFF'].name}".`);
    } else log.skip(`Mẫu "${templates['M-OFF'].name}" đang tắt.`);
  });

  await attempt('Tắt CF-OFF', async () => {
    const field = (await phase3Fields(config, qtbh))['CF-OFF'];
    if (!field.active) return log.skip(`Trường "${field.name}" đang tắt.`);
    await qtbh.put(`${crm}/v1/custom-fields/${field.id}`, { name: field.name, fieldType: 'TEXT', active: false });
    log.created(`Tắt trường "${field.name}" (Q-SENT vẫn giữ giá trị, M-A4 vẫn dùng biến của trường này).`);
  });

  // ---- 5. Tóm tắt ----
  log.section('Tóm tắt dữ liệu phase 3');
  templates = await phase3Templates(config, qtbh);
  for (const [key, template] of Object.entries(templates)) {
    log.info(`${key.padEnd(7)} ${template.name} (${template.active ? 'bật' : 'tắt'}, ${template.hasLayout ? 'có bố cục' : 'chưa có bố cục'}) ${template.id}`);
  }
  fields = await phase3Fields(config, qtbh);
  for (const [key, field] of Object.entries(fields)) log.info(`${key.padEnd(7)} ${field.name} (${field.active ? 'bật' : 'tắt'}) ${field.id}`);
  quotes = await phase3Quotes(config, admin);
  for (const [key, quote] of Object.entries(quotes)) {
    if (!quote) {
      log.warn(`${key}: chưa có.`);
      continue;
    }
    const detail = await admin.get(`${crm}/v1/quotes/${quote.id}`);
    log.info(
      `${key.padEnd(8)} ${detail.code} ${detail.version.status} v${detail.version.versionNo}, ${detail.version.lines.length} dòng, ` +
        `bản chụp ${detail.version.layoutSnapshot ? 'có' : 'không'}, mẫu ${detail.version.form.templateName ?? '-'}`,
    );
  }
}
