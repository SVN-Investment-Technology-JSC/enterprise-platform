// Bước `legacy` (T0-19): dữ liệu theo code Kho và Workspace hiện tại, chạy TRƯỚC khi áp migration Kho mới,
// để có dữ liệu cũ cho test migration (TC-MIG-*) và chuyển khách Workspace sang Bán hàng.
// Chỉ gọi API; giữ hàng cũ đi qua route nội bộ /v1/internal/reservations, không gửi trường nguồn.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTenant, loginPlatformAdmin, loginTenantAdmin } from './tenant.mjs';
import { request } from './http.mjs';

const WAREHOUSES = [
  { code: 'QA-KHO-HN', name: 'QA Kho chính Hà Nội', location: 'Hà Nội' },
  { code: 'QA-KHO-CL', name: 'QA Kho cách ly', location: 'Hà Nội' },
  { code: 'QA-KHO-LOI', name: 'QA Kho hàng lỗi', location: 'Hà Nội' },
];

const MATERIALS = [
  { code: 'QA-KHO-LAP', name: 'QA Máy tính xách tay (có serial)', category: 'SPARE_PART', unit: 'Cái', isSerialized: true },
  { code: 'QA-KHO-MUC', name: 'QA Mực in', category: 'CONSUMABLE', unit: 'Hộp' },
  { code: 'QA-KHO-CAP', name: 'QA Cáp mạng', category: 'CONSUMABLE', unit: 'Cuộn' },
];

/** 3 lần nhập QA-KHO-CAP: 10 x 700.000 + 10 x 800.000 + 10 x 900.000 => bình quân 800.000. */
const RECEIPTS = [
  { key: 'CAP-1', warehouseCode: 'QA-KHO-HN', materialCode: 'QA-KHO-CAP', quantity: 10, unitCost: 700_000 },
  { key: 'CAP-2', warehouseCode: 'QA-KHO-HN', materialCode: 'QA-KHO-CAP', quantity: 10, unitCost: 800_000 },
  { key: 'CAP-3', warehouseCode: 'QA-KHO-HN', materialCode: 'QA-KHO-CAP', quantity: 10, unitCost: 900_000 },
  { key: 'LAP-1', warehouseCode: 'QA-KHO-HN', materialCode: 'QA-KHO-LAP', quantity: 40, unitCost: 15_000_000 },
  { key: 'MUC-1', warehouseCode: 'QA-KHO-HN', materialCode: 'QA-KHO-MUC', quantity: 50, unitCost: 250_000 },
];
const RECEIPT_REFERENCE_TYPE = 'QA-SEED-LEGACY';

const SERIALS = Array.from({ length: 40 }, (_, index) => `SN${String(index + 1).padStart(3, '0')}`);
/** Serial dùng để thử tạo cặp trùng: chính SN040, nên thử không thành cũng không sinh serial thừa. */
const DUPLICATE_SERIAL = SERIALS.at(-1);
const DUPLICATE_ATTEMPTS = 10;

const LEGACY_RESERVATION = {
  referenceType: 'QA-LEGACY-RESERVATION',
  warehouseCode: 'QA-KHO-HN',
  items: [{ materialCode: 'QA-KHO-CAP', quantityReserved: 5 }],
};

const CUSTOMERS = Array.from({ length: 5 }, (_, index) => ({
  code: `QA-CRM-WS0${index + 1}`,
  name: `QA Khách hàng Workspace ${index + 1}`,
}));
const PROJECTS = [
  { name: 'QA-CRM Dự án 1 (WS01)', customer: 'QA-CRM-WS01' },
  { name: 'QA-CRM Dự án 2 (WS02)', customer: 'QA-CRM-WS02' },
  { name: 'QA-CRM Dự án 3 (WS03)', customer: 'QA-CRM-WS03' },
];
const CONTRACTS = [
  { code: 'QA-CRM-HD01', name: 'QA Hợp đồng 1 (WS01)', customer: 'QA-CRM-WS01', project: 'QA-CRM Dự án 1 (WS01)', value: 120_000_000, status: 'active' },
  { code: 'QA-CRM-HD02', name: 'QA Hợp đồng 2 (WS02)', customer: 'QA-CRM-WS02', value: 80_000_000 },
];

/** UUID xác định từ khoá, để `referenceId` của mỗi lần nhập giống nhau giữa các lần chạy. */
function stableUuid(key) {
  const h = createHash('sha1').update(`seed-svn:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  throw new Error(`Không đọc được danh sách từ phản hồi: ${JSON.stringify(value).slice(0, 200)}`);
};

async function seedInventory(config, admin, tenantId, log, report) {
  const api = config.inventoryApi;

  const warehouses = list(await admin.get(`${api}/v1/warehouses/all`), 'warehouses', 'items');
  for (const warehouse of WAREHOUSES) {
    if (warehouses.some((item) => item.code === warehouse.code)) log.skip(`Kho ${warehouse.code} đã có.`);
    else {
      await admin.post(`${api}/v1/warehouses`, { ...warehouse, type: 'PHYSICAL' });
      log.created(`Kho ${warehouse.code} "${warehouse.name}".`);
    }
  }

  const materials = list(await admin.get(`${api}/v1/materials?all=true`), 'materials', 'items');
  for (const material of MATERIALS) {
    if (materials.some((item) => item.code === material.code)) log.skip(`Mặt hàng ${material.code} đã có.`);
    else {
      await admin.post(`${api}/v1/materials`, material);
      log.created(`Mặt hàng ${material.code} "${material.name}".`);
    }
  }

  // Nhập kho: mỗi lần nhập mang referenceId cố định; lịch sử của mặt hàng đã có referenceId đó thì bỏ qua.
  const historyByMaterial = new Map();
  for (const receipt of RECEIPTS) {
    if (!historyByMaterial.has(receipt.materialCode)) {
      const history = await admin.get(`${api}/v1/materials/${receipt.materialCode}/history`);
      historyByMaterial.set(receipt.materialCode, list(history, 'transactions', 'items', 'history'));
    }
    const referenceId = stableUuid(`receipt:${receipt.key}`);
    const done = historyByMaterial.get(receipt.materialCode).some((tx) => tx.referenceId === referenceId);
    if (done) {
      log.skip(`Nhập ${receipt.key}: ${receipt.quantity} ${receipt.materialCode} @ ${receipt.unitCost} đã ghi.`);
      continue;
    }
    await admin.post(`${api}/v1/receipts`, {
      warehouseCode: receipt.warehouseCode,
      materialCode: receipt.materialCode,
      quantity: receipt.quantity,
      unitCost: receipt.unitCost,
      referenceType: RECEIPT_REFERENCE_TYPE,
      referenceId,
      note: `Seed legacy ${receipt.key}`,
    });
    log.created(`Nhập ${receipt.key}: ${receipt.quantity} ${receipt.materialCode} @ ${receipt.unitCost} vào ${receipt.warehouseCode}.`);
  }

  // Serial: khai như màn hình Kho làm (POST /v1/serials), gắn kho QA-KHO-HN. API tự bỏ serial đã có.
  // SN040 khai riêng ở bước thử tạo cặp trùng bên dưới.
  const registered = await admin.post(`${api}/v1/serials`, {
    materialCode: 'QA-KHO-LAP',
    warehouseCode: 'QA-KHO-HN',
    serialNumbers: SERIALS.filter((serial) => serial !== DUPLICATE_SERIAL),
  });
  if (registered.added) log.created(`Khai ${registered.added} serial QA-KHO-LAP (tổng ${registered.total}).`);
  else log.skip(`Serial SN001..SN039 đã có (tổng ${registered.total}).`);

  report.duplicateSerial = await seedDuplicateSerial(api, admin, log);

  // Giữ hàng cũ: route nội bộ, không có sourceType/sourceId/idempotencyKey.
  const reservations = list(await admin.get(`${api}/v1/reservations`), 'reservations', 'items');
  const existing = reservations.find((item) => item.referenceType === LEGACY_RESERVATION.referenceType);
  if (existing) {
    log.skip(`Giữ hàng cũ ${existing.reservationCode} (${existing.status}) đã có.`);
    report.reservation = existing.reservationCode;
  } else {
    const { data } = await request('POST', `${api}/v1/internal/reservations`, {
      headers: { 'x-service-token': config.serviceToken, 'x-tenant-id': tenantId },
      body: {
        ...LEGACY_RESERVATION,
        referenceId: stableUuid('legacy-reservation'),
        notes: 'Giữ hàng cũ, không có chứng từ nguồn (seed legacy)',
      },
    });
    log.created(`Giữ hàng cũ ${data.reservationCode}: 5 QA-KHO-CAP ở QA-KHO-HN, không có nguồn.`);
    report.reservation = data.reservationCode;
  }
}

/**
 * Cặp serial trùng cố ý. POST /v1/serials kiểm "chưa có" bằng NOT EXISTS và chưa có ràng buộc UNIQUE
 * (migration 0013 mới thêm), nên gọi tuần tự không bao giờ tạo trùng. Cách duy nhất qua API là nhiều
 * request cùng lúc cho cùng một serial (đúng cách dữ liệu trùng sinh ra ngoài thực tế). Không chắc thành công.
 */
async function seedDuplicateSerial(api, admin, log) {
  const serials = list(await admin.get(`${api}/v1/serials?materialCode=QA-KHO-LAP`), 'serials', 'items');
  const count = serials.filter((item) => item.serialNumber === DUPLICATE_SERIAL).length;
  if (count >= 2) {
    log.skip(`Cặp serial trùng ${DUPLICATE_SERIAL} đã có (${count} bản).`);
    return { serial: DUPLICATE_SERIAL, copies: count };
  }
  if (count === 1) {
    log.warn(`Serial ${DUPLICATE_SERIAL} đã có 1 bản (lần trước tạo trùng không thành); API tuần tự không cho thêm bản thứ hai.`);
    return { serial: DUPLICATE_SERIAL, copies: 1 };
  }
  const results = await Promise.allSettled(
    Array.from({ length: DUPLICATE_ATTEMPTS }, () =>
      admin.post(`${api}/v1/serials`, { materialCode: 'QA-KHO-LAP', warehouseCode: 'QA-KHO-HN', serialNumbers: [DUPLICATE_SERIAL] }),
    ),
  );
  const added = results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value.added ?? 0 : 0), 0);
  if (added >= 2) log.created(`Cặp serial trùng ${DUPLICATE_SERIAL}: ${added} bản (gửi ${DUPLICATE_ATTEMPTS} request đồng thời).`);
  else log.warn(`Không tạo được serial trùng qua API: ${DUPLICATE_SERIAL} chỉ có ${added} bản sau ${DUPLICATE_ATTEMPTS} request đồng thời.`);
  return { serial: DUPLICATE_SERIAL, copies: added };
}

async function seedWorkspace(config, admin, log) {
  const api = config.workspaceApi;
  const customerIds = {};
  const customers = list(await admin.get(`${api}/v1/customers?query=QA-CRM-WS`), 'customers', 'items');
  for (const customer of CUSTOMERS) {
    let found = customers.find((item) => item.code === customer.code);
    if (found) log.skip(`Khách hàng Workspace ${customer.code} đã có.`);
    else {
      found = await admin.post(`${api}/v1/customers`, { ...customer, note: 'Seed legacy' });
      log.created(`Khách hàng Workspace ${customer.code} "${customer.name}".`);
    }
    customerIds[customer.code] = found.id;
  }

  const projectIds = {};
  for (const project of PROJECTS) {
    const page = await admin.get(`${api}/v1/projects?search=${encodeURIComponent(project.name)}&pageSize=50`);
    let found = list(page, 'items', 'projects', 'data').find((item) => item.name === project.name);
    if (found) log.skip(`Dự án "${project.name}" đã có (${found.code}).`);
    else {
      found = await admin.post(`${api}/v1/projects`, {
        name: project.name,
        customerId: customerIds[project.customer],
        description: 'Seed legacy',
      });
      log.created(`Dự án "${project.name}" (${found.code}) gắn khách ${project.customer}.`);
    }
    projectIds[project.name] = found.id;
  }

  for (const contract of CONTRACTS) {
    const customerId = customerIds[contract.customer];
    const existing = list(await admin.get(`${api}/v1/customers/${customerId}/contracts`), 'contracts', 'items');
    if (existing.some((item) => item.code === contract.code)) {
      log.skip(`Hợp đồng Workspace ${contract.code} đã có.`);
      continue;
    }
    await admin.post(`${api}/v1/contracts`, {
      customerId,
      code: contract.code,
      name: contract.name,
      value: contract.value,
      ...(contract.status ? { status: contract.status } : {}),
      ...(contract.project ? { projectId: projectIds[contract.project] } : {}),
      note: 'Seed legacy',
    });
    log.created(`Hợp đồng Workspace ${contract.code} (khách ${contract.customer}${contract.project ? `, dự án "${contract.project}"` : ''}).`);
  }
  return { customers: Object.keys(customerIds).length, projects: Object.keys(projectIds).length, contracts: CONTRACTS.length };
}

/** Tổng tồn theo kho, mặt hàng (quantity, quantity_reserved) để đối soát trước và sau migration. */
async function inventorySnapshot(config, admin) {
  const api = config.inventoryApi;
  const warehouses = list(await admin.get(`${api}/v1/warehouses/all`), 'warehouses', 'items');
  const materials = list(await admin.get(`${api}/v1/materials?all=true`), 'materials', 'items');
  const materialCode = new Map(materials.map((item) => [item.id, item.code]));
  const rows = [];
  for (const warehouse of warehouses) {
    const stock = list(await admin.get(`${api}/v1/warehouses/${warehouse.code}/stock`), 'stock', 'items');
    for (const line of stock) {
      rows.push({
        warehouse: warehouse.code,
        material: materialCode.get(line.materialId) ?? line.materialId,
        quantity: Number(line.quantity),
        quantityReserved: Number(line.quantityReserved),
      });
    }
  }
  rows.sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.material.localeCompare(b.material));
  const serials = list(await admin.get(`${api}/v1/serials?materialCode=QA-KHO-LAP`), 'serials', 'items');
  const serialsByStatus = {};
  for (const serial of serials) serialsByStatus[serial.currentStatus] = (serialsByStatus[serial.currentStatus] ?? 0) + 1;
  const history = list(await admin.get(`${api}/v1/materials/QA-KHO-CAP/history`), 'transactions', 'items', 'history');
  const capIn = history.filter((tx) => Number(tx.quantity) > 0);
  const capQty = capIn.reduce((sum, tx) => sum + Number(tx.quantity), 0);
  const capValue = capIn.reduce((sum, tx) => sum + Number(tx.quantity) * Number(tx.unitCost), 0);
  return {
    stock: rows,
    serials: { material: 'QA-KHO-LAP', total: serials.length, byStatus: serialsByStatus },
    capWeightedAverage: capQty ? capValue / capQty : null,
  };
}

export async function runLegacyStep(config, log) {
  log.section(`Bước legacy cho ${config.tenantSlug}`);
  const platform = await loginPlatformAdmin(config);
  const tenant = await findTenant(config, platform);
  if (!tenant) throw new Error(`Chưa có tenant ${config.tenantSlug}. Chạy --step=tenant trước.`);
  const admin = await loginTenantAdmin(config);
  const report = {};

  log.section('Kho');
  await seedInventory(config, admin, tenant.id, log, report);
  log.section('Workspace');
  report.workspace = await seedWorkspace(config, admin, log);

  log.section('Tổng tồn để đối soát');
  const snapshot = await inventorySnapshot(config, admin);
  for (const row of snapshot.stock) {
    log.info(`${row.warehouse.padEnd(12)} ${row.material.padEnd(12)} quantity=${row.quantity} reserved=${row.quantityReserved}`);
  }
  log.info(`Serial QA-KHO-LAP: ${snapshot.serials.total} (${JSON.stringify(snapshot.serials.byStatus)}).`);
  log.info(`Giá bình quân nhập QA-KHO-CAP: ${snapshot.capWeightedAverage}.`);
  log.info(`Giữ hàng cũ: ${report.reservation}. Serial trùng ${report.duplicateSerial.serial}: ${report.duplicateSerial.copies} bản.`);
  log.info(`Workspace: ${report.workspace.customers} khách, ${report.workspace.projects} dự án, ${report.workspace.contracts} hợp đồng.`);
  if (snapshot.capWeightedAverage !== 800_000) throw new Error(`Giá bình quân QA-KHO-CAP phải là 800000, nhận ${snapshot.capWeightedAverage}.`);

  const dir = join(process.env.SVN_SEED_OUTPUT_DIR ?? tmpdir(), 'crm-seed');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${config.tenantSlug}-legacy-snapshot.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ tenant: config.tenantSlug, tenantId: tenant.id, takenAt: new Date().toISOString(), ...snapshot, reservation: report.reservation, duplicateSerial: report.duplicateSerial }, null, 2)}\n`,
  );
  log.info(`Ảnh chụp tồn: ${file}`);
}
