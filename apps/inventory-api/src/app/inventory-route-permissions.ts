/**
 * Bảng quyền theo route của Inventory API.
 *
 * Mỗi route khai đúng method và mẫu đường dẫn (tính từ sau tiền tố `api/inventory`),
 * `:tên` khớp đúng một đoạn. Không dò chuỗi con: trước đây `path.includes('/issues')`
 * và các chuỗi tương tự làm route mới rơi vào quyền sai, và `/movements/batch` (phiếu
 * nhiều dòng của thủ kho) bị đòi `inventory.manage`.
 *
 * Route không có trong bảng bị từ chối. Thêm route mới vào controller thì phải thêm
 * dòng ở đây; spec `inventory-route-permissions.spec.ts` duyệt metadata mọi controller
 * và đỏ nếu thiếu.
 *
 * `service` là route nội bộ (`/v1/internal/...`): xác thực bằng service token ở guard,
 * không theo quyền người dùng.
 */
export type InventoryRoutePermission =
  | 'inventory.read'
  | 'inventory.manage'
  | 'inventory.transaction.write'
  | 'inventory.document.approve'
  | 'inventory.quality.write'
  | 'service';

export interface InventoryRouteRule {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly permission: InventoryRoutePermission;
}

const READ = 'inventory.read';
const MANAGE = 'inventory.manage';
const WRITE = 'inventory.transaction.write';
const APPROVE = 'inventory.document.approve';
const QUALITY = 'inventory.quality.write';

export const INVENTORY_ROUTE_RULES: readonly InventoryRouteRule[] = [
  // Kho
  { method: 'GET', path: '/v1/warehouses', permission: READ },
  { method: 'GET', path: '/v1/warehouses/all', permission: READ },
  { method: 'GET', path: '/v1/warehouses/:code', permission: READ },
  { method: 'GET', path: '/v1/warehouses/:code/stock', permission: READ },
  { method: 'POST', path: '/v1/warehouses', permission: MANAGE },
  { method: 'PATCH', path: '/v1/warehouses/:code', permission: MANAGE },
  { method: 'GET', path: '/v1/capabilities', permission: READ },
  { method: 'GET', path: '/v1/auditor-candidates', permission: READ },

  // Danh mục vật tư
  { method: 'GET', path: '/v1/materials', permission: READ },
  { method: 'GET', path: '/v1/materials/:code', permission: READ },
  { method: 'GET', path: '/v1/materials/:code/history', permission: READ },
  { method: 'GET', path: '/v1/materials/:code/stock', permission: READ },
  { method: 'POST', path: '/v1/materials', permission: MANAGE },
  { method: 'POST', path: '/v1/materials/import', permission: MANAGE },
  { method: 'PATCH', path: '/v1/materials/:code', permission: MANAGE },
  { method: 'DELETE', path: '/v1/materials/:code', permission: MANAGE },
  { method: 'DELETE', path: '/v1/materials/:code/permanent', permission: MANAGE },

  // Danh mục hợp nhất, lắp/tháo (tầng nghiệp vụ đòi cả quyền quản lý lẫn quyền ghi phát sinh)
  { method: 'GET', path: '/v1/items', permission: READ },
  { method: 'GET', path: '/v1/items/:code', permission: READ },
  { method: 'GET', path: '/v1/installations', permission: READ },
  { method: 'PATCH', path: '/v1/items/:code', permission: MANAGE },
  { method: 'POST', path: '/v1/items/:code/install', permission: MANAGE },
  { method: 'POST', path: '/v1/items/:code/uninstall', permission: MANAGE },
  { method: 'POST', path: '/v1/items/:code/return', permission: MANAGE },

  // Thiết bị
  { method: 'GET', path: '/v1/assets', permission: READ },
  { method: 'GET', path: '/v1/assets/:code', permission: READ },
  { method: 'POST', path: '/v1/assets', permission: MANAGE },
  { method: 'PATCH', path: '/v1/assets/:code', permission: MANAGE },
  { method: 'DELETE', path: '/v1/assets/:code', permission: MANAGE },
  { method: 'GET', path: '/v1/assets/:code/documents', permission: READ },
  { method: 'GET', path: '/v1/assets/:code/documents/:documentId/download', permission: READ },
  { method: 'POST', path: '/v1/assets/:code/documents', permission: MANAGE },
  { method: 'DELETE', path: '/v1/assets/:code/documents/:documentId', permission: MANAGE },
  { method: 'GET', path: '/v1/assets/:code/spare-parts', permission: READ },
  { method: 'POST', path: '/v1/assets/:code/spare-parts', permission: MANAGE },
  { method: 'DELETE', path: '/v1/assets/:code/spare-parts/:bomId', permission: MANAGE },
  { method: 'GET', path: '/v1/assets/:id/tests', permission: READ },
  { method: 'POST', path: '/v1/assets/tests', permission: MANAGE },

  // Phát sinh tồn kho
  { method: 'POST', path: '/v1/receipts', permission: WRITE },
  { method: 'POST', path: '/v1/issues', permission: WRITE },
  { method: 'POST', path: '/v1/movements/batch', permission: WRITE },
  { method: 'POST', path: '/v1/transfers', permission: WRITE },
  { method: 'GET', path: '/v1/transactions', permission: READ },

  // Giữ hàng
  { method: 'GET', path: '/v1/reservations', permission: READ },
  { method: 'GET', path: '/v1/reservations/:code', permission: READ },
  { method: 'POST', path: '/v1/reservations', permission: WRITE },
  { method: 'POST', path: '/v1/reservations/:code/release', permission: WRITE },

  // Serial, lô
  { method: 'GET', path: '/v1/serials', permission: READ },
  { method: 'POST', path: '/v1/serials', permission: MANAGE },
  { method: 'PATCH', path: '/v1/serials/:materialCode/:serialNumber', permission: MANAGE },
  { method: 'GET', path: '/v1/serials/:serial/history', permission: READ },
  { method: 'POST', path: '/v1/serials/:serial/quality', permission: QUALITY },
  { method: 'GET', path: '/v1/lots', permission: READ },
  { method: 'GET', path: '/v1/lots/suggest', permission: READ },
  { method: 'GET', path: '/v1/lots/:id', permission: READ },
  { method: 'POST', path: '/v1/lots/:id/quality', permission: QUALITY },

  // Cấu hình
  { method: 'GET', path: '/v1/settings', permission: READ },
  { method: 'PUT', path: '/v1/settings/:key', permission: MANAGE },

  // Cấp phát tài sản cho nhân sự
  { method: 'GET', path: '/v1/custody', permission: READ },
  { method: 'GET', path: '/v1/custody/assets', permission: READ },
  { method: 'GET', path: '/v1/custody/employees/:employeeId', permission: READ },
  { method: 'POST', path: '/v1/custody/assign', permission: MANAGE },

  // Chứng từ kho
  { method: 'GET', path: '/v1/stock-documents', permission: READ },
  { method: 'GET', path: '/v1/stock-documents/:id', permission: READ },
  { method: 'POST', path: '/v1/stock-documents', permission: WRITE },
  { method: 'PATCH', path: '/v1/stock-documents/:id', permission: WRITE },
  { method: 'POST', path: '/v1/stock-documents/:id/submit', permission: WRITE },
  { method: 'POST', path: '/v1/stock-documents/:id/post', permission: WRITE },
  { method: 'POST', path: '/v1/stock-documents/:id/cancel', permission: WRITE },
  { method: 'POST', path: '/v1/stock-documents/:id/reverse', permission: WRITE },
  { method: 'POST', path: '/v1/stock-documents/:id/approve', permission: APPROVE },
  { method: 'POST', path: '/v1/stock-documents/:id/reject', permission: APPROVE },

  // Báo cáo
  { method: 'GET', path: '/v1/reports/stock', permission: READ },
  { method: 'GET', path: '/v1/reports/movements', permission: READ },
  { method: 'GET', path: '/v1/reports/approvals', permission: READ },

  // Nội bộ giữa các service
  { method: 'GET', path: '/v1/internal/assets', permission: 'service' },
  { method: 'GET', path: '/v1/internal/assets/:code/task-template', permission: 'service' },
  { method: 'GET', path: '/v1/internal/materials', permission: 'service' },
  { method: 'GET', path: '/v1/internal/materials/:code', permission: 'service' },
  { method: 'GET', path: '/v1/internal/materials/:code/availability', permission: 'service' },
  { method: 'GET', path: '/v1/internal/materials/:materialId/documents', permission: 'service' },
  { method: 'GET', path: '/v1/internal/material-trade-categories', permission: 'service' },
  { method: 'GET', path: '/v1/internal/warehouses', permission: 'service' },
  { method: 'GET', path: '/v1/internal/serials/:serial', permission: 'service' },
  { method: 'POST', path: '/v1/internal/serials/:serial/quality', permission: 'service' },
  { method: 'POST', path: '/v1/internal/lots/:id/quality', permission: 'service' },
  { method: 'POST', path: '/v1/internal/reservations', permission: 'service' },
  { method: 'POST', path: '/v1/internal/reservations/:code/release', permission: 'service' },
  { method: 'POST', path: '/v1/internal/issue-requests', permission: 'service' },
  { method: 'POST', path: '/v1/internal/return-receipts', permission: 'service' },
  { method: 'POST', path: '/v1/internal/stock-documents', permission: 'service' },
  { method: 'GET', path: '/v1/internal/custody/employees/:employeeId', permission: 'service' },
  { method: 'GET', path: '/v1/internal/custody/assignable', permission: 'service' },
  { method: 'POST', path: '/v1/internal/custody/assign', permission: 'service' },
  { method: 'POST', path: '/v1/internal/data-import/validate', permission: 'service' },
  { method: 'POST', path: '/v1/internal/data-import/execute', permission: 'service' },
];

const GLOBAL_PREFIX = '/api/inventory';

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Đường dẫn của request bỏ tiền tố toàn cục và dấu `/` thừa. */
export function normalizeInventoryPath(path: string): string {
  const withoutPrefix =
    path === GLOBAL_PREFIX || path.startsWith(`${GLOBAL_PREFIX}/`)
      ? path.slice(GLOBAL_PREFIX.length)
      : path;
  return `/${segments(withoutPrefix).join('/')}`;
}

function matchScore(rule: string[], actual: string[]): number {
  if (rule.length !== actual.length) return -1;
  let literal = 0;
  for (let index = 0; index < rule.length; index++) {
    const part = rule[index];
    if (part.startsWith(':')) continue;
    if (part !== actual[index]) return -1;
    literal++;
  }
  return literal;
}

/**
 * Tìm dòng khớp với method và đường dẫn. Nhiều dòng khớp (ví dụ `/warehouses/all` và
 * `/warehouses/:code`) thì lấy dòng có nhiều đoạn cố định hơn, như router.
 * Không khớp dòng nào thì trả `undefined`: guard từ chối.
 */
export function resolveInventoryRoute(method: string, path: string): InventoryRouteRule | undefined {
  // Express trả HEAD bằng handler GET.
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const actual = segments(normalizeInventoryPath(path));
  let best: InventoryRouteRule | undefined;
  let bestScore = -1;
  for (const rule of INVENTORY_ROUTE_RULES) {
    if (rule.method !== verb) continue;
    const score = matchScore(segments(rule.path), actual);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}
