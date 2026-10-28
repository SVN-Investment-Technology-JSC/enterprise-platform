// Bước `inventory` (T1-33): dữ liệu Kho mới cho Bán hàng, chạy SAU khi áp migration Kho mới (chứng từ kho, lô,
// chất lượng, mặt hàng SERVICE). Chỉ gọi API chứng từ kho, lô, serial; không ghi thẳng DB.
// Chạy lại được: chứng từ nhập mang idempotencyKey cố định (gọi lại trả chứng từ đã có), đổi chất lượng chỉ làm khi
// trạng thái chưa đúng, mặt hàng đã có thì chỉ chỉnh số tháng bảo hành.
import { findTenant, loginPlatformAdmin, loginTenantAdmin } from './tenant.mjs';

const WAREHOUSES = [
  { code: 'QA-KHO-HN', name: 'QA Kho chính Hà Nội', location: 'Hà Nội' },
  { code: 'QA-KHO-CL', name: 'QA Kho cách ly', location: 'Hà Nội' },
  { code: 'QA-KHO-LOI', name: 'QA Kho hàng lỗi', location: 'Hà Nội' },
];

/** Mặt hàng dịch vụ (D6): có trong danh mục để Bán hàng chọn, không có tồn. */
const SERVICES = [
  { code: 'QA-KHO-BT', name: 'QA Gói bảo trì', category: 'CONSUMABLE', unit: 'Gói', kind: 'SERVICE' },
  { code: 'QA-KHO-PM', name: 'QA Phần mềm quản lý', category: 'CONSUMABLE', unit: 'Bản quyền', kind: 'SERVICE' },
];

const WARRANTY = { code: 'QA-KHO-LAP', warrantyMonths: 12 };

/**
 * Lô của QA-KHO-MUC theo TEST.md mục 1.3 (TC-INV-08, TC-INV-13): L01 hạn 31/12 năm nay, L02 hạn 30/11 năm nay,
 * L03 đã hết hạn (31/12 năm trước), L04 còn hạn nhưng chuyển Cách ly sau khi nhập. Chạy vào tháng 12 thì L02 đã
 * hết hạn theo lịch; khi đó test FEFO cần chạy lại seed trên tenant mới.
 */
function mucLots(year) {
  return [
    { key: 'MUC-L01', lotNo: 'L01', quantity: 30, expiresOn: `${year}-12-31` },
    { key: 'MUC-L02', lotNo: 'L02', quantity: 20, expiresOn: `${year}-11-30` },
    { key: 'MUC-L03', lotNo: 'L03', quantity: 10, expiresOn: `${year - 1}-12-31` },
    { key: 'MUC-L04', lotNo: 'L04', quantity: 15, expiresOn: `${year + 1}-06-30`, quality: 'QUARANTINE' },
  ];
}
const MUC_UNIT_COST = 250_000;

/** Serial dự phòng cho đổi bảo hành (Q9). */
const SPARE_SERIALS = ['SN-DP01', 'SN-DP02', 'SN-DP03', 'SN-DP04', 'SN-DP05'];
const LAP_UNIT_COST = 15_000_000;

/** Một serial Cách ly để test xuất serial không Đạt (TC-INV-12). */
const QUARANTINE_SERIAL = { serial: 'SN039', materialCode: 'QA-KHO-LAP' };

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  throw new Error(`Không đọc được danh sách từ phản hồi: ${JSON.stringify(value).slice(0, 200)}`);
};

async function ensureWarehouses(api, admin, log) {
  const warehouses = list(await admin.get(`${api}/v1/warehouses/all`), 'warehouses', 'items');
  for (const warehouse of WAREHOUSES) {
    if (warehouses.some((item) => item.code === warehouse.code)) log.skip(`Kho ${warehouse.code} đã có.`);
    else {
      await admin.post(`${api}/v1/warehouses`, { ...warehouse, type: 'PHYSICAL' });
      log.created(`Kho ${warehouse.code} "${warehouse.name}".`);
    }
  }
}

async function ensureMaterials(api, admin, log) {
  const materials = list(await admin.get(`${api}/v1/materials?all=true`), 'materials', 'items');
  const byCode = new Map(materials.map((item) => [item.code, item]));
  for (const code of ['QA-KHO-LAP', 'QA-KHO-MUC']) {
    if (!byCode.has(code)) throw new Error(`Chưa có mặt hàng ${code}. Chạy --step=legacy trước.`);
  }
  for (const service of SERVICES) {
    const found = byCode.get(service.code);
    if (!found) {
      await admin.post(`${api}/v1/materials`, service);
      log.created(`Mặt hàng dịch vụ ${service.code} "${service.name}".`);
    } else if (found.kind !== 'SERVICE') {
      throw new Error(`${service.code} đã có nhưng là ${found.kind}, không phải SERVICE; cần xử lý tay.`);
    } else log.skip(`Mặt hàng dịch vụ ${service.code} đã có.`);
  }
  const lap = byCode.get(WARRANTY.code);
  if (lap.warrantyMonths === WARRANTY.warrantyMonths) log.skip(`${WARRANTY.code} đã có bảo hành ${WARRANTY.warrantyMonths} tháng.`);
  else {
    await admin.patch(`${api}/v1/materials/${WARRANTY.code}`, { warrantyMonths: WARRANTY.warrantyMonths });
    log.created(`${WARRANTY.code}: bảo hành ${WARRANTY.warrantyMonths} tháng.`);
  }
}

/**
 * Tạo chứng từ nhập mua có khoá chống lặp rồi ghi sổ. Gọi lại cùng khoá trả chứng từ đã có: đã ghi sổ thì bỏ qua,
 * còn Nháp (lần trước dừng giữa chừng) thì ghi sổ tiếp.
 */
async function receiveOnce(api, admin, log, { key, label, lines, note }, tenantSlug) {
  const document = await admin.post(`${api}/v1/stock-documents`, {
    docType: 'RECEIPT_PURCHASE',
    warehouseCode: 'QA-KHO-HN',
    idempotencyKey: `qa-seed-inventory:${tenantSlug}:${key}`,
    note,
    lines,
  });
  if (document.status === 'POSTED') {
    log.skip(`${label}: chứng từ ${document.code} đã ghi sổ.`);
    return document;
  }
  if (document.status !== 'DRAFT') {
    throw new Error(`${label}: chứng từ ${document.code} đang ở trạng thái ${document.status}, cần xử lý tay.`);
  }
  const posted = await admin.post(`${api}/v1/stock-documents/${document.id}/post`);
  log.created(`${label}: ghi sổ chứng từ ${posted.document.code}.`);
  return posted.document;
}

async function seedLots(api, admin, log, tenantSlug) {
  const lots = mucLots(new Date().getFullYear());
  for (const lot of lots) {
    await receiveOnce(
      api,
      admin,
      log,
      {
        key: lot.key,
        label: `Nhập lô ${lot.lotNo} QA-KHO-MUC (${lot.quantity}, hạn ${lot.expiresOn})`,
        note: `Seed inventory ${lot.key}`,
        lines: [
          {
            materialCode: 'QA-KHO-MUC',
            quantity: lot.quantity,
            unitCost: MUC_UNIT_COST,
            lot: { lotNo: lot.lotNo, expiresOn: lot.expiresOn },
          },
        ],
      },
      tenantSlug,
    );
  }
  const stored = list(await admin.get(`${api}/v1/lots?materialCode=QA-KHO-MUC`), 'lots', 'items');
  for (const lot of lots.filter((item) => item.quality)) {
    const found = stored.find((item) => item.lotNo === lot.lotNo);
    if (!found) throw new Error(`Không thấy lô ${lot.lotNo} sau khi nhập.`);
    if (found.qualityStatus === lot.quality) {
      log.skip(`Lô ${lot.lotNo} đã ở trạng thái ${lot.quality}.`);
      continue;
    }
    await admin.post(`${api}/v1/lots/${found.id}/quality`, {
      qualityStatus: lot.quality,
      reason: 'Seed: lô cách ly để test FEFO và tồn khả dụng',
    });
    log.created(`Lô ${lot.lotNo}: ${found.qualityStatus} -> ${lot.quality}.`);
  }
  return lots;
}

async function seedSerials(api, admin, log, tenantSlug) {
  await receiveOnce(
    api,
    admin,
    log,
    {
      key: 'LAP-SPARE',
      label: `Nhập ${SPARE_SERIALS.length} serial dự phòng QA-KHO-LAP`,
      note: 'Seed inventory: serial dự phòng cho đổi bảo hành',
      lines: [
        { materialCode: 'QA-KHO-LAP', quantity: SPARE_SERIALS.length, unitCost: LAP_UNIT_COST, serials: SPARE_SERIALS },
      ],
    },
    tenantSlug,
  );

  const { serial, materialCode } = QUARANTINE_SERIAL;
  const history = await admin.get(
    `${api}/v1/serials/${encodeURIComponent(serial)}/history?materialCode=${encodeURIComponent(materialCode)}`,
  );
  if (history.qualityStatus === 'QUARANTINE') log.skip(`Serial ${serial} đã Cách ly.`);
  else {
    await admin.post(`${api}/v1/serials/${encodeURIComponent(serial)}/quality`, {
      qualityStatus: 'QUARANTINE',
      reason: 'Seed: serial cách ly để test xuất serial không Đạt',
      materialCode,
    });
    log.created(`Serial ${serial}: ${history.qualityStatus} -> QUARANTINE.`);
  }
}

/** In tóm tắt để đối chiếu với TEST.md mục 1.3. */
async function summary(api, admin, log, lots) {
  const stored = list(await admin.get(`${api}/v1/lots?materialCode=QA-KHO-MUC`), 'lots', 'items');
  for (const lot of lots) {
    const found = stored.find((item) => item.lotNo === lot.lotNo);
    log.info(
      `Lô ${lot.lotNo}: hạn ${found?.expiresOn ?? '?'}, chất lượng ${found?.qualityStatus ?? '?'}, số lượng ${found?.quantity ?? '?'}.`,
    );
  }
  const suggestion = await admin.get(`${api}/v1/lots/suggest?materialCode=QA-KHO-MUC&warehouseCode=QA-KHO-HN&quantity=10`);
  log.info(`Gợi ý FEFO xuất 10: ${suggestion.lines.map((line) => `${line.lotNo} x ${line.quantity}`).join(', ') || 'không có'}.`);
  const serials = list(await admin.get(`${api}/v1/serials?materialCode=QA-KHO-LAP`), 'serials', 'items');
  const spare = serials.filter((item) => SPARE_SERIALS.includes(item.serialNumber)).length;
  const quarantined = serials.filter((item) => item.qualityStatus === 'QUARANTINE').map((item) => item.serialNumber);
  log.info(`Serial QA-KHO-LAP: ${serials.length} (dự phòng ${spare}/${SPARE_SERIALS.length}, Cách ly: ${quarantined.join(', ') || 'không'}).`);
}

export async function runInventoryStep(config, log) {
  log.section(`Bước inventory cho ${config.tenantSlug}`);
  const platform = await loginPlatformAdmin(config);
  const tenant = await findTenant(config, platform);
  if (!tenant) throw new Error(`Chưa có tenant ${config.tenantSlug}. Chạy --step=tenant trước.`);
  const admin = await loginTenantAdmin(config);
  const api = config.inventoryApi;

  log.section('Kho và mặt hàng');
  await ensureWarehouses(api, admin, log);
  await ensureMaterials(api, admin, log);
  log.section('Lô QA-KHO-MUC');
  const lots = await seedLots(api, admin, log, config.tenantSlug);
  log.section('Serial QA-KHO-LAP');
  await seedSerials(api, admin, log, config.tenantSlug);
  log.section('Tóm tắt');
  await summary(api, admin, log, lots);
}
