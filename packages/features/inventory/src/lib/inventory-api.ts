import type {
  AddAssetBomRequest,
  Asset,
  AssetBomLine,
  AssetDocument,
  CreateAssetDocumentResponse,
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  CreateWarehouseRequest,
  InstallItemRequest,
  InstalledMaterial,
  InventoryItem,
  InventorySettingsKey,
  InventorySettingsSnapshot,
  InventoryTransaction,
  Material,
  MaterialInventory,
  RegisterSerialsRequest,
  Reservation,
  RetireResult,
  ReturnItemToStockRequest,
  SerialTracking,
  SettingsEntry,
  UninstallMaterialRequest,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSerialRequest,
  UpdateWarehouseRequest,
  Warehouse,
  StocktakeSession,
  StocktakeLine,
  CreateStocktakeRequest,
} from '@enterprise-platform/contracts-inventory';

const API = '/api/inventory/v1';

function csrf(): string {
  return document.cookie.split('; ').find((part) => part.startsWith('ep_csrf='))?.split('=')[1] ?? '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf(), ...init?.headers },
  });
  if (response.status === 401) {
    /**
     * Về trang chủ Platform, KHÔNG về `/tenant/login` — route đó không tồn tại
     * (trả 404), và slug tenant thì client không đọc được: nó nằm trong cookie
     * `ep_access` httpOnly, còn đường dẫn module (`/modules/...`) không mang
     * slug. Trang chủ sẽ đưa người dùng tới đúng chỗ đăng nhập.
     */
    window.location.assign('/');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Không thể hoàn tất yêu cầu kho.');
  }
  /**
   * 204 và mọi phản hồi rỗng: KHÔNG gọi `response.json()`.
   *
   * `json()` trên body rỗng ném `Unexpected end of JSON input`, nên thao tác đã
   * thành công ở server vẫn hiện ra như thất bại trên giao diện — đúng lỗi "xoá
   * phụ tùng báo lỗi dù đã xoá".
   */
  /**
   * 204 không có body: gọi `json()` sẽ ném lỗi phân tích cú pháp, làm một thao
   * tác đã thành công trông như thất bại — đúng lỗi "xoá vật tư tiêu chuẩn báo
   * lỗi dù đã xoá".
   *
   * Chỉ xét `status`, KHÔNG dùng `headers.get('content-length')` hay
   * `response.text()`: cả hai đều giả định một `Response` đầy đủ, trong khi
   * fetch giả lập ở test thường chỉ có `ok` và `json`. Đây cũng đúng khuôn mà
   * module Quy trình đã dùng từ trước.
   */
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Everything the screen needs, fetched together so a tab switch never waits on the network. */
export interface InventoryWorkspace {
  readonly warehouses: Warehouse[];
  readonly materials: Material[];
  readonly assets: Asset[];
  readonly stock: Array<MaterialInventory & { warehouseCode?: string; materialCode?: string }>;
}

export async function loadInventoryWorkspace(): Promise<InventoryWorkspace> {
  const [warehouses, materials, assets] = await Promise.all([
    request<Warehouse[]>('/warehouses'),
    request<Material[]>('/materials?all=true'),
    request<Asset[]>('/assets'),
  ]);

  // Stock is per-warehouse; fan out and stitch the codes back on so the table can
  // show them without a second lookup per row.
  const perWarehouse = await Promise.all(
    warehouses.map(async (warehouse) => {
      const rows = await request<MaterialInventory[]>(
        `/warehouses/${encodeURIComponent(warehouse.code)}/stock`,
      );
      return rows.map((row) => ({
        ...row,
        warehouseCode: warehouse.code,
        materialCode: materials.find((material) => material.id === row.materialId)?.code,
      }));
    }),
  );

  return { warehouses, materials, assets, stock: perWarehouse.flat() };
}

export type InventoryLedgerRow = InventoryTransaction;
export type InventoryReservationRow = Reservation;
export function loadLedger(limit = 50): Promise<InventoryLedgerRow[]> {
  return request<InventoryLedgerRow[]>(`/transactions?limit=${limit}`);
}

/** Một quy trình đã công bố bên module Quy trình, để chọn khi mở work order. */
export interface ProcedureOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Quy trình đã công bố, đọc từ module Quy trình.
 *
 * Gọi bằng CHÍNH PHIÊN của người dùng qua gateway, không phải service token:
 * đây là dữ liệu của module Quy trình, và thủ kho chỉ nên thấy những quy trình
 * họ vốn có quyền thấy. Kho không đọc thẳng bảng của Quy trình.
 *
 * Quy trình không đọc được thì trả mảng rỗng — form vẫn dùng được, chỉ là chưa
 * mở được work order.
 */
export async function loadProcedureOptions(): Promise<ProcedureOption[]> {
  try {
    const response = await fetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      definitions?: { id: string; code: string; name: string; status: string }[];
    };
    return (body.definitions ?? [])
      .filter((item) => item.status === 'published')
      .map(({ id, code, name }) => ({ id, code, name }));
  } catch {
    return [];
  }
}

/**
 * Mở một work order bên Quy trình cho lệnh kho vừa thực hiện.
 *
 * Kho KHÔNG ghi thẳng vào dữ liệu Quy trình từ phía server. Lời gọi này chạy
 * trong trình duyệt dưới danh nghĩa chính thủ kho, qua API công khai của
 * Quy trình — đúng như họ tự vào module đó bấm mở hồ sơ.
 */
export async function openMovementWorkOrder(input: {
  definitionId: string;
  title: string;
}): Promise<{ id: string; code: string }> {
  const response = await fetch('/api/procedure/v1/instances', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
    body: JSON.stringify({
      definitionId: input.definitionId,
      title: input.title,
      idempotencyKey: `inventory-movement:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Không mở được work order cho lệnh kho.');
  }
  return (await response.json()) as { id: string; code: string };
}

/** Danh mục hợp nhất: vật tư kho và thiết bị chung một danh sách. */
export function loadInventoryItems(): Promise<InventoryItem[]> {
  return request<InventoryItem[]>('/items');
}

/**
 * Lắp vật tư từ kho vào một thiết bị — một lệnh xuất.
 *
 * Mã vật tư ở lại danh mục kho với phần tồn còn lại; chỉ số lượng lắp mới rời
 * kho. Trả về bút toán để màn hình báo mã phiếu.
 */
export function installItem(
  code: string,
  input: InstallItemRequest,
): Promise<InventoryTransaction> {
  return request<InventoryTransaction>(`/items/${encodeURIComponent(code)}/install`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Hồ sơ đầy đủ của một mã BẤT KỲ — kho hay đã lắp đều mở được.
 *
 * `loadAsset` cũ đi qua view `assets` (lọc kind='ASSET') nên mã kho luôn 404;
 * đó là lý do hồ sơ trước đây chỉ mở được từ cây thiết bị.
 */
export function loadItemProfile(code: string): Promise<Asset> {
  return request<Asset>(`/items/${encodeURIComponent(code)}`);
}

export function updateItemProfile(code: string, patch: UpdateAssetRequest): Promise<Asset> {
  return request<Asset>(`/items/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Vật tư đang lắp trên từng thiết bị. */
export function loadInstallations(): Promise<InstalledMaterial[]> {
  return request<InstalledMaterial[]>('/installations');
}

/** Tháo một đơn vị đang lắp khỏi cây, nhập ngược về kho. */
export function uninstallMaterial(
  unitCode: string,
  input: UninstallMaterialRequest,
): Promise<InventoryTransaction> {
  return request<InventoryTransaction>(`/items/${encodeURIComponent(unitCode)}/uninstall`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Thanh lý: tháo khỏi cây và nhập về kho được chọn.
 *
 * Kho là bắt buộc — thao tác này ghi một bút toán NHẬP thật, nên phải biết nhập
 * vào đâu. Trả về chính bút toán đó để màn hình báo lại mã phiếu.
 */
export function returnItemToStock(
  code: string,
  input: ReturnItemToStockRequest,
): Promise<InventoryTransaction> {
  return request<InventoryTransaction>(`/items/${encodeURIComponent(code)}/return`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Lịch sử nhập/xuất của một mã vật tư, mới nhất trước. */
export function loadMaterialHistory(
  code: string,
  limit = 50,
): Promise<InventoryLedgerRow[]> {
  return request<InventoryLedgerRow[]>(
    `/materials/${encodeURIComponent(code)}/history?limit=${limit}`,
  );
}

/** Một hồ sơ đang chạy bên Quy trình — để đổi id tham chiếu thành mã đọc được. */
export interface ProcedureWorkOrder {
  readonly id: string;
  readonly code: string;
  readonly title: string;
}

/**
 * Một yêu cầu cấp phát vật tư phát sinh từ quy trình con / bảo trì.
 * Kèm thông tin bảng kê CSV đã được tự động sinh.
 */
export interface ProcedureRequisitionLine {
  readonly materialCode: string;
  readonly quantity: number;
  readonly materialName?: string;
  readonly unit?: string;
}

export interface ProcedureRequisition {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: string;
  readonly startedAt: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly assetCode?: string;
  readonly kind: 'issue' | 'purchase';
  readonly lines: readonly ProcedureRequisitionLine[];
  /** Tên tệp bảng kê CSV tự động đính kèm (VD: bang-ke-vat-tu-PR-20260904-323C38.csv) */
  readonly csvFileName: string;
  /** Tải nội dung file CSV qua URL hoặc dữ liệu dựng sẵn */
  readonly downloadUrl?: string;
}

const FULFILLED_REQUISITIONS_STORAGE_KEY = 'ep:inventory:fulfilled_requisitions';

export function getFulfilledRequisitionCodes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FULFILLED_REQUISITIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function markRequisitionFulfilled(code: string): void {
  if (!code || typeof window === 'undefined') return;
  try {
    const current = getFulfilledRequisitionCodes();
    if (!current.includes(code)) {
      current.push(code);
      window.localStorage.setItem(FULFILLED_REQUISITIONS_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // Bỏ qua nếu không truy cập được localStorage
  }
}

/**
 * Tải danh sách yêu cầu vật tư từ quy trình.
 * Đọc các hồ sơ sinh tự động từ quy trình cha (sourceType === 'auto_from_parent')
 * hoặc các hồ sơ cha có khai báo `materialOrders`.
 */
export async function loadProcedureRequisitions(): Promise<ProcedureRequisition[]> {
  try {
    const response = await fetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      instances?: Array<{
        id: string;
        code: string;
        title?: string;
        status: string;
        startedAt: string;
        sourceType?: string;
        sourceId?: string;
        assetCode?: string;
        materialOrders?: Array<{
          code: string;
          kind: 'issue' | 'purchase';
          createdAt: string;
          lines: readonly {
            materialCode: string;
            quantity: number;
            materialName?: string;
            unit?: string;
          }[];
        }>;
      }>;
    };

    const instances = body.instances ?? [];
    const fulfilledCodes = new Set(getFulfilledRequisitionCodes());
    const requisitions: ProcedureRequisition[] = [];

    // 1. Thu thập từ `materialOrders` ghi trên hồ sơ cha
    for (const inst of instances) {
      if (inst.materialOrders && inst.materialOrders.length > 0) {
        for (const order of inst.materialOrders) {
          if (fulfilledCodes.has(order.code)) continue;

          const childInst = instances.find((c) => c.code === order.code);
          const status = childInst?.status ?? 'active';
          if (status === 'completed' || status === 'cancelled' || status === 'rejected') {
            continue;
          }

          requisitions.push({
            id: childInst?.id ?? order.code,
            code: order.code,
            title: childInst?.title ?? `Yêu cầu cấp phát vật tư từ ${inst.code}`,
            status,
            startedAt: order.createdAt || inst.startedAt,
            sourceType: 'auto_from_parent',
            sourceId: inst.id,
            assetCode: inst.assetCode,
            kind: 'issue',
            lines: order.lines ?? [],
            csvFileName: `bang-ke-vat-tu-${order.code}.csv`,
          });
        }
      }
    }

    // 2. Thu thập từ chính các quy trình con nếu chưa có trong danh sách
    for (const inst of instances) {
      if (
        inst.sourceType === 'auto_from_parent' &&
        !requisitions.some((r) => r.code === inst.code || r.id === inst.id)
      ) {
        if (fulfilledCodes.has(inst.code)) continue;
        if (inst.status === 'completed' || inst.status === 'cancelled' || inst.status === 'rejected') {
          continue;
        }

        requisitions.push({
          id: inst.id,
          code: inst.code,
          title: inst.title ?? inst.code,
          status: inst.status,
          startedAt: inst.startedAt,
          sourceType: inst.sourceType,
          sourceId: inst.sourceId,
          assetCode: inst.assetCode,
          kind: 'issue',
          lines: [],
          csvFileName: `bang-ke-vat-tu-${inst.code}.csv`,
        });
      }
    }

    // Lấy đính kèm downloadUrl cho từng yêu cầu
    await Promise.all(
      requisitions.map(async (req) => {
        if (!req.id || req.id === req.code) return;
        try {
          const attRes = await fetch(`/api/procedure/v1/instances/${encodeURIComponent(req.id)}/attachments`, {
            cache: 'no-store',
            credentials: 'same-origin',
          });
          if (attRes.ok) {
            const atts = (await attRes.json()) as Array<{ fileName: string; downloadUrl?: string }>;
            const csvAtt = atts.find((a) => a.fileName === req.csvFileName || a.fileName.endsWith('.csv'));
            if (csvAtt?.downloadUrl) {
              (req as { downloadUrl?: string }).downloadUrl = csvAtt.downloadUrl;
            }
          }
        } catch {
          // Bỏ qua nếu lỗi lấy attachment, vẫn hiển thị được dòng yêu cầu
        }
      }),
    );

    return requisitions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch {
    return [];
  }
}

/**
 * Tải nội dung file CSV của yêu cầu vật tư nếu cần xem trước hoặc trích xuất dòng.
 */
export function generateRequisitionCsvContent(req: ProcedureRequisition): string {
  const cell = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
  const header = ['Mã vật tư', 'Tên vật tư', 'Số lượng yêu cầu', 'Đơn vị tính'];
  const rows = req.lines.map((line) =>
    [
      cell(line.materialCode),
      cell(line.materialName ?? ''),
      cell(line.quantity),
      cell(line.unit ?? ''),
    ].join(','),
  );
  return [header.map(cell).join(','), ...rows].join('\n');
}

/**
 * Hồ sơ bên module Quy trình, CHỈ ĐỌC.
 *
 * Kho không được ghi vào dữ liệu của Quy trình; ở đây chỉ mượn mã và tiêu đề để
 * thủ kho biết phiếu giữ chỗ thuộc về việc nào. Quy trình không phản hồi thì trả
 * danh sách rỗng — màn hình kho vẫn phải dùng được.
 */
export async function loadProcedureWorkOrders(): Promise<ProcedureWorkOrder[]> {
  try {
    const response = await fetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      instances?: { id: string; code: string; title?: string }[];
    };
    return (body.instances ?? []).map(({ id, code, title }) => ({ id, code, title: title ?? code }));
  } catch {
    return [];
  }
}

/** Cá thể theo sê-ri của một mã vật tư. */
export function loadSerials(materialCode: string): Promise<SerialTracking[]> {
  return request<SerialTracking[]>(`/serials?materialCode=${encodeURIComponent(materialCode)}`);
}

/** Khai sê-ri cho một mã — làm lúc nhập kho, khi còn cầm hiện vật trong tay. */
export function registerSerials(
  input: RegisterSerialsRequest,
): Promise<{ added: number; total: number }> {
  return request<{ added: number; total: number }>('/serials', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Sửa tình trạng / vị trí sử dụng của MỘT cá thể. */
export function updateSerial(
  materialCode: string,
  serialNumber: string,
  patch: UpdateSerialRequest,
): Promise<SerialTracking> {
  return request<SerialTracking>(
    `/serials/${encodeURIComponent(materialCode)}/${encodeURIComponent(serialNumber)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

// ---------------------------------------------------------------- Quản lý Lô (Batch / Lot)
const LOTS_STORAGE_KEY = 'ep:inventory:lot_tracking';

export async function loadLots(materialCode: string): Promise<import('@enterprise-platform/contracts-inventory').LotTracking[]> {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(`${LOTS_STORAGE_KEY}:${materialCode}`);
    if (raw) return JSON.parse(raw);

    // Mẫu ban đầu cho các vật tư tiêu biểu khi chưa có dữ liệu lưu
    if (materialCode.includes('DAU') || materialCode.includes('CAP') || materialCode === 'VT-001') {
      const defaultLots: import('@enterprise-platform/contracts-inventory').LotTracking[] = [
        {
          id: `lot-${materialCode}-01`,
          materialCode,
          lotNumber: `LOT-2026-Q1-A01`,
          status: 'PASSED',
          quantity: 120,
          unit: 'Thùng / Cuộn',
          warehouseCode: 'WH-CENTRAL',
          manufactureDate: '2026-01-15',
          expiryDate: '2028-01-15',
          supplier: 'Tổng công ty Dầu khí / Cáp điện',
          coCqNumber: 'CO-CQ-VN-2026/889',
          note: 'Hàng nhập khẩu chính hãng, đã kiểm định chất lượng',
          createdAt: new Date().toISOString(),
        },
        {
          id: `lot-${materialCode}-02`,
          materialCode,
          lotNumber: `LOT-2025-Q4-B02`,
          status: 'NEAR_EXPIRY',
          quantity: 35,
          unit: 'Thùng / Cuộn',
          warehouseCode: 'WH-BACKUP',
          manufactureDate: '2025-04-10',
          expiryDate: '2026-10-10',
          supplier: 'Nhà phân phối Miền Bắc',
          coCqNumber: 'CO-CQ-VN-2025/112',
          note: 'Cận hạn dùng dưới 60 ngày - Ưu tiên xuất theo FEFO',
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(`${LOTS_STORAGE_KEY}:${materialCode}`, JSON.stringify(defaultLots));
      return defaultLots;
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveLots(
  materialCode: string,
  lots: import('@enterprise-platform/contracts-inventory').LotTracking[],
): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${LOTS_STORAGE_KEY}:${materialCode}`, JSON.stringify(lots));
}

/** Gồm cả kho đã ngừng dùng — cho màn Cài đặt. */
export function loadAllWarehouses(): Promise<Warehouse[]> {
  return request<Warehouse[]>('/warehouses/all');
}

export function createWarehouse(input: CreateWarehouseRequest): Promise<Warehouse> {
  return request<Warehouse>('/warehouses', { method: 'POST', body: JSON.stringify(input) });
}

export function updateWarehouse(
  code: string,
  patch: UpdateWarehouseRequest,
): Promise<Warehouse> {
  return request<Warehouse>(`/warehouses/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function loadReservations(): Promise<InventoryReservationRow[]> {
  return request<InventoryReservationRow[]>('/reservations');
}

export function receiveStock(input: {
  warehouseCode: string;
  materialCode: string;
  quantity: number;
  unitCost?: number;
  note?: string;
}): Promise<InventoryTransaction> {
  return request<InventoryTransaction>('/receipts', { method: 'POST', body: JSON.stringify(input) });
}

export function issueStock(input: {
  warehouseCode: string;
  materialCode: string;
  quantity: number;
  note?: string;
}): Promise<InventoryTransaction> {
  return request<InventoryTransaction>('/issues', { method: 'POST', body: JSON.stringify(input) });
}

export function transferStock(input: {
  fromWarehouseCode: string;
  toWarehouseCode: string;
  materialCode: string;
  quantity: number;
  note?: string;
}): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
  return request<{ out: InventoryTransaction; in: InventoryTransaction }>('/transfers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createReservation(input: CreateStockReservationRequest): Promise<Reservation> {
  return request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify(input) });
}

/** Trang chủ doanh nghiệp của người đang đăng nhập, để nút quay lại trỏ đúng chỗ. */
export function updateAsset(
  code: string,
  patch: UpdateAssetRequest,
): Promise<Asset> {
  return request<Asset>(`/assets/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ---- Danh mục vật tư -------------------------------------------------------

export function createMaterial(input: CreateMaterialRequest): Promise<Material> {
  return request<Material>('/materials', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMaterial(code: string, patch: UpdateMaterialRequest): Promise<Material> {
  return request<Material>(`/materials/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Ngừng dùng vật tư: server xoá hẳn nếu chưa có giao dịch, ngược lại chỉ hạ cờ. */
export function retireMaterial(code: string): Promise<RetireResult> {
  return request<RetireResult>(`/materials/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

// ---- Danh mục thiết bị -----------------------------------------------------

export function createAsset(input: CreateAssetRequest): Promise<Asset> {
  return request<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) });
}

export function retireAsset(code: string): Promise<RetireResult> {
  return request<RetireResult>(`/assets/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await fetch('/api/auth/v1/me', { credentials: 'include' });
    if (!response.ok) return '/';
    return '/dashboard';
  } catch {
    return '/';
  }
}

/** Cấu hình module do tenant admin đặt; đọc mới mỗi lần vào màn cài đặt. */
export const loadInventorySettings = () =>
  request<InventorySettingsSnapshot>('/settings', { cache: 'no-store' });

export const saveInventorySetting = (
  key: InventorySettingsKey,
  value: unknown,
  expectedVersion: number,
) =>
  request<SettingsEntry<unknown>>(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, expectedVersion }),
  });

/** Phụ tùng tiêu chuẩn của một thiết bị. */
export const loadAssetSpareParts = (assetCode: string) =>
  request<AssetBomLine[]>(`/assets/${encodeURIComponent(assetCode)}/spare-parts`, {
    cache: 'no-store',
  });

export const addAssetSparePart = (assetCode: string, input: AddAssetBomRequest) =>
  request<AssetBomLine>(`/assets/${encodeURIComponent(assetCode)}/spare-parts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const removeAssetSparePart = (assetCode: string, bomId: string) =>
  request<void>(`/assets/${encodeURIComponent(assetCode)}/spare-parts/${bomId}`, {
    method: 'DELETE',
  });

/** Tài liệu đính kèm của thiết bị. */
export const loadAssetDocuments = (assetCode: string) =>
  request<AssetDocument[]>(`/assets/${encodeURIComponent(assetCode)}/documents`, {
    cache: 'no-store',
  });

/**
 * Tải tệp lên: xin URL ký trước rồi PUT thẳng lên kho lưu trữ.
 *
 * Tệp KHÔNG đi qua server ứng dụng — nó chỉ ký URL và giữ siêu dữ liệu, nên
 * tệp lớn không chiếm bộ nhớ của API.
 */
export async function uploadAssetDocument(
  assetCode: string,
  file: File,
  note?: string,
): Promise<AssetDocument> {
  const created = await request<CreateAssetDocumentResponse>(
    `/assets/${encodeURIComponent(assetCode)}/documents`,
    {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        note,
      }),
    },
  );
  const uploaded = await fetch(created.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error('Không tải được tệp lên kho lưu trữ.');
  return created.document;
}

export const assetDocumentDownloadUrl = (assetCode: string, documentId: string) =>
  request<{ url: string }>(
    `/assets/${encodeURIComponent(assetCode)}/documents/${documentId}/download`,
  );

export const removeAssetDocument = (assetCode: string, documentId: string) =>
  request<void>(`/assets/${encodeURIComponent(assetCode)}/documents/${documentId}`, {
    method: 'DELETE',
  });

/**
 * Tải lịch sử sự cố và bảo trì từ module Maintenance (nếu có entitlement).
 * Trả về undefined nếu module Maintenance không bật hoặc không phản hồi.
 */
export async function loadMaintenanceHistoryForAsset(assetCode: string): Promise<{
  items: Array<{
    id: string;
    kind: 'preventive' | 'incident';
    code?: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    dueAt: string;
    completedAt?: string;
    assigneeName?: string;
    createdByName?: string;
    procedureInstanceCode?: string;
  }>;
  stats: { total: number; completed: number; onTimeRate: number };
} | undefined> {
  try {
    const response = await fetch(
      `/api/maintenance/v1/occurrences/history?assetCode=${encodeURIComponent(assetCode)}`,
      { cache: 'no-store', credentials: 'include' },
    );
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export interface MaintenanceScheduleSummary {
  readonly id: string;
  readonly title: string;
  readonly frequency: string;
  readonly nextDueAt?: string;
  readonly status: string;
  readonly assetCode?: string;
}

export async function loadMaintenanceSchedulesForAsset(
  assetCode: string,
): Promise<MaintenanceScheduleSummary[] | undefined> {
  try {
    const response = await fetch('/api/maintenance/v1/workspace', {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!response.ok) return undefined;
    const workspace = (await response.json()) as {
      schedules?: MaintenanceScheduleSummary[];
    };
    return (workspace.schedules ?? []).filter((schedule) => schedule.assetCode === assetCode);
  } catch {
    return undefined;
  }
}

export async function loadLatestStocktakeForMaterial(
  materialCode: string,
  workspace?: InventoryWorkspace,
): Promise<{ session: StocktakeSession; line: StocktakeLine } | undefined> {
  try {
    const sessions = await loadStocktakes(workspace);
    const candidates = sessions
      .filter((session) => !['CANCELLED', 'DRAFT'].includes(session.status))
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));

    for (const session of candidates) {
      const lines = await loadStocktakeLines(session.id, workspace);
      const line = lines.find((entry) => entry.materialCode === materialCode);
      if (line) return { session, line };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Ghi nhận sự cố khẩn cấp đồng bộ sang module Maintenance.
 */
export async function createMaintenanceIncidentForAsset(input: {
  assetCode: string;
  title: string;
  description?: string;
  priority?: 'High' | 'Normal' | 'Low';
}): Promise<boolean> {
  try {
    const response = await fetch('/api/maintenance/v1/occurrences/incidents', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf(),
      },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// STOCKTAKE (KIỂM KÊ KHO) API
// ============================================================================

const STOCKTAKES_STORAGE_KEY = 'ep:inventory:stocktakes';
const STOCKTAKE_LINES_STORAGE_KEY = 'ep:inventory:stocktake_lines';

function initMockStocktakes(warehouses: Warehouse[], _materials?: Material[], _stock?: MaterialInventory[]): StocktakeSession[] {
  const defaultWarehouse = warehouses[0]?.code ?? 'WH-CENTRAL';
  const defaultWhName = warehouses[0]?.name ?? 'Kho Vật tư Trung tâm';
  const whId = warehouses[0]?.id ?? 'wh-central-id';

  const s1: StocktakeSession = {
    id: 'st-2026-00018',
    code: 'KK-2026-00018',
    title: 'Kiểm kê định kỳ Kho Trung tâm - Tháng 9/2026',
    warehouseId: whId,
    warehouseCode: defaultWarehouse,
    warehouseName: defaultWhName,
    status: 'COUNTING',
    scopeType: 'ALL',
    snapshotAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
    leadAuditor: 'Nguyễn Văn An (Tổ trưởng)',
    auditors: ['Trần Thị Mai', 'Phạm Quốc Bảo'],
    note: 'Kiểm đếm toàn bộ vật tư và linh kiện tiêu hao phục vụ quyết toán quý 3.',
    totalItems: 8,
    countedItems: 5,
    differenceItems: 2,
    totalVarianceValue: -4500000,
    createdAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const s2: StocktakeSession = {
    id: 'st-2026-00017',
    code: 'KK-2026-00017',
    title: 'Kiểm kê đột xuất nhóm Cáp & Thiết bị điện',
    warehouseId: whId,
    warehouseCode: defaultWarehouse,
    warehouseName: defaultWhName,
    status: 'PENDING_APPROVAL',
    scopeType: 'CATEGORY',
    scopeCategories: ['EQUIPMENT', 'CONSUMABLE'],
    snapshotAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
    leadAuditor: 'Trần Thị Mai',
    auditors: ['Nguyễn Văn An'],
    note: 'Đã hoàn tất đếm 2 vòng, phát hiện lệch 1 máy đo nhiệt do chưa làm phiếu xuất công trình.',
    totalItems: 12,
    countedItems: 12,
    differenceItems: 1,
    totalVarianceValue: -12500000,
    createdAt: new Date(Date.now() - 3600 * 1000 * 50).toISOString(),
    updatedAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
  };

  const s3: StocktakeSession = {
    id: 'st-2026-00016',
    code: 'KK-2026-00016',
    title: 'Kiểm kê định kỳ Quý 2/2026',
    warehouseId: whId,
    warehouseCode: defaultWarehouse,
    warehouseName: defaultWhName,
    status: 'POSTED',
    scopeType: 'ALL',
    snapshotAt: new Date(Date.now() - 3600 * 1000 * 24 * 70).toISOString(),
    leadAuditor: 'Nguyễn Văn An (Tổ trưởng)',
    auditors: ['Lê Hoàng Nam', 'Đỗ Hải Đăng'],
    approvedBy: 'Trần Quốc Tuấn (Phó Giám đốc Kỹ thuật)',
    approvedAt: new Date(Date.now() - 3600 * 1000 * 24 * 68).toISOString(),
    note: 'Đã duyệt biên bản và ghi sổ bút toán cân kho hoàn tất.',
    totalItems: 25,
    countedItems: 25,
    differenceItems: 0,
    totalVarianceValue: 0,
    createdAt: new Date(Date.now() - 3600 * 1000 * 24 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 3600 * 1000 * 24 * 68).toISOString(),
  };

  const list = [s1, s2, s3];
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(list));
  }
  return list;
}

function initMockLinesForSession(session: StocktakeSession, workspace: InventoryWorkspace): StocktakeLine[] {
  const stockRows = workspace.stock.filter((s) => s.warehouseCode === session.warehouseCode || !s.warehouseCode);
  const materials = workspace.materials;
  const matMap = new Map(materials.map((m) => [m.id, m]));

  const lines: StocktakeLine[] = [];
  const sampleMats = stockRows.length > 0 ? stockRows.slice(0, 10) : materials.slice(0, 8).map((m) => ({
    materialId: m.id,
    quantity: 50,
    quantityReserved: 0,
    available: 50,
    warehouseCode: session.warehouseCode,
    updatedAt: new Date().toISOString(),
  }));

  sampleMats.forEach((item, idx) => {
    const mat = matMap.get(item.materialId) || {
      id: item.materialId,
      code: `VT-${100 + idx}`,
      name: `Vật tư kiểm kê mẫu ${idx + 1}`,
      unit: 'Cái',
      purchasePrice: 250000 + idx * 50000,
      isSerialized: idx % 3 === 0,
    };

    const sysQty = item.quantity ?? 20;
    // Tạo giả lập một vài dòng có chênh lệch cho sinh động
    let actualQty: number | undefined;
    let round1: number | undefined;
    let round2: number | undefined;
    let reason: string | undefined;

    if (session.status === 'POSTED' || session.status === 'PENDING_APPROVAL' || idx < 4) {
      if (idx === 1) {
        actualQty = sysQty - 2;
        round1 = sysQty - 2;
        round2 = sysQty - 2;
        reason = 'Hao hụt rách vỡ trong quá trình vận chuyển bốc dỡ';
      } else if (idx === 3) {
        actualQty = sysQty + 1;
        round1 = sysQty + 1;
        reason = 'Nhập thừa từ đợt bảo trì hoàn trả chưa ghi phiếu';
      } else {
        actualQty = sysQty;
        round1 = sysQty;
      }
    }

    const diff = actualQty !== undefined ? actualQty - sysQty : 0;
    const unitCost = (mat as any).purchasePrice ?? 350000;
    const diffVal = diff * unitCost;

    let status: StocktakeLine['status'] = 'UNCOUNTED';
    if (actualQty !== undefined) {
      if (diff === 0) status = 'MATCHED';
      else if (diff > 0) status = 'SURPLUS';
      else status = 'DEFICIT';
    }

    lines.push({
      id: `line-${session.id}-${idx}`,
      sessionId: session.id,
      materialId: mat.id,
      materialCode: mat.code,
      materialName: mat.name,
      unit: mat.unit || 'Cái',
      binLocation: undefined,
      isSerialized: mat.isSerialized,
      isLotTracked: mat.code.includes('DAU') || mat.code.includes('CAP'),
      systemQuantity: sysQty,
      countRound1: round1,
      countRound2: round2,
      actualQuantity: actualQty,
      difference: diff,
      unitCost,
      differenceValue: diffVal,
      reason,
      status,
      updatedAt: new Date().toISOString(),
      audits: round1 !== undefined ? [
        {
          id: `audit-${session.id}-${idx}-1`,
          lineId: `line-${session.id}-${idx}`,
          previousQuantity: undefined,
          newQuantity: round1,
          operator: session.leadAuditor || 'Thủ kho',
          timestamp: session.snapshotAt || new Date().toISOString(),
          reason: 'Ghi nhận kết quả đếm lần 1',
        },
      ] : [],
    });
  });

  return lines;
}

// Biến cờ kiểm tra xem server backend đã hỗ trợ API /stocktakes chưa để tránh bắn 404 đỏ lòm ra console
let isBackendStocktakeSupported: boolean | null = null;

export async function loadStocktakes(workspace?: InventoryWorkspace): Promise<StocktakeSession[]> {
  if (isBackendStocktakeSupported !== false) {
    try {
      const res = await request<StocktakeSession[]>('/stocktakes').catch(() => null);
      if (res && Array.isArray(res)) {
        isBackendStocktakeSupported = true;
        return res;
      }
      if (res === null) {
        // Backend trả về 404/500 hoặc không kết nối được
        isBackendStocktakeSupported = false;
      }
    } catch {
      isBackendStocktakeSupported = false;
    }
  }

  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(STOCKTAKES_STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* ignore invalid cached json */
    }
  }

  if (workspace) {
    return initMockStocktakes(workspace.warehouses, workspace.materials, workspace.stock);
  }
  return [];
}

export async function loadStocktakeLines(sessionId: string, workspace?: InventoryWorkspace): Promise<StocktakeLine[]> {
  if (isBackendStocktakeSupported) {
    try {
      const res = await request<StocktakeLine[]>(`/stocktakes/${encodeURIComponent(sessionId)}/lines`).catch(() => null);
      if (res && Array.isArray(res)) return res;
    } catch {
      /* ignore backend failure and fall back */
    }
  }

  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(`${STOCKTAKE_LINES_STORAGE_KEY}:${sessionId}`);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* ignore invalid cached json */
    }
  }

  // Khởi tạo mock lines nếu chưa có
  if (workspace) {
    const sessions = await loadStocktakes(workspace);
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      const generated = initMockLinesForSession(session, workspace);
      localStorage.setItem(`${STOCKTAKE_LINES_STORAGE_KEY}:${sessionId}`, JSON.stringify(generated));
      return generated;
    }
  }

  return [];
}

export async function createStocktakeSession(
  input: CreateStocktakeRequest,
  workspace: InventoryWorkspace,
): Promise<StocktakeSession> {
  const current = await loadStocktakes(workspace);
  const nextNum = current.length + 1;
  const year = new Date().getFullYear();
  const code = input.code || `KK-${year}-${String(nextNum).padStart(5, '0')}`;
  const wh = workspace.warehouses.find((w) => w.code === input.warehouseCode);

  const newSession: StocktakeSession = {
    id: `st-${Date.now()}`,
    code,
    title: input.title,
    warehouseId: wh?.id ?? 'wh-id',
    warehouseCode: input.warehouseCode,
    warehouseName: wh?.name ?? input.warehouseCode,
    status: 'DRAFT',
    scopeType: input.scopeType,
    scopeCategories: input.scopeCategories,
    leadAuditor: input.leadAuditor || 'Thủ kho trưởng',
    auditors: input.auditors || [],
    note: input.note,
    totalItems: 0,
    countedItems: 0,
    differenceItems: 0,
    totalVarianceValue: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated = [newSession, ...current];
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(updated));
  }
  return newSession;
}

export async function startStocktakeCounting(
  sessionId: string,
  workspace: InventoryWorkspace,
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  const sessions = await loadStocktakes(workspace);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  // Tạo snapshot từ số tồn hiện tại của kho
  const stockRows = workspace.stock.filter((s) => s.warehouseCode === session.warehouseCode || !s.warehouseCode);
  const matMap = new Map(workspace.materials.map((m) => [m.id, m]));

  const lines: StocktakeLine[] = stockRows.map((item, idx) => {
    const mat = matMap.get(item.materialId) || {
      id: item.materialId,
      code: `VT-${100 + idx}`,
      name: `Vật tư ${idx + 1}`,
      unit: 'Cái',
      purchasePrice: 200000,
    };
    return {
      id: `line-${sessionId}-${idx}`,
      sessionId,
      materialId: mat.id,
      materialCode: mat.code,
      materialName: mat.name,
      unit: mat.unit || 'Cái',
      binLocation: undefined,
      isSerialized: Boolean((mat as any).isSerialized),
      isLotTracked: mat.code.includes('DAU') || mat.code.includes('CAP'),
      systemQuantity: item.quantity,
      difference: 0,
      unitCost: (mat as any).purchasePrice || 200000,
      differenceValue: 0,
      status: 'UNCOUNTED',
      updatedAt: new Date().toISOString(),
      audits: [],
    };
  });

  const updatedSession: StocktakeSession = {
    ...session,
    status: 'COUNTING',
    snapshotAt: new Date().toISOString(),
    totalItems: lines.length,
    countedItems: 0,
    differenceItems: 0,
    totalVarianceValue: 0,
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
    localStorage.setItem(`${STOCKTAKE_LINES_STORAGE_KEY}:${sessionId}`, JSON.stringify(lines));
  }

  return { session: updatedSession, lines };
}

export async function saveStocktakeLines(
  sessionId: string,
  updatedLines: StocktakeLine[],
  _operator = 'Thủ kho',
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  const sessions = await loadStocktakes();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  let counted = 0;
  let diffCount = 0;
  let totalVariance = 0;

  const processedLines = updatedLines.map((line) => {
    const isCounted = line.actualQuantity !== undefined && line.actualQuantity !== null;
    if (isCounted) counted++;
    const diff = isCounted ? (line.actualQuantity ?? 0) - line.systemQuantity : 0;
    const diffVal = diff * (line.unitCost ?? 0);
    if (diff !== 0) {
      diffCount++;
      totalVariance += diffVal;
    }

    let status: StocktakeLine['status'] = 'UNCOUNTED';
    if (isCounted) {
      if (diff === 0) status = 'MATCHED';
      else if (diff > 0) status = 'SURPLUS';
      else status = 'DEFICIT';
    }

    return {
      ...line,
      difference: diff,
      differenceValue: diffVal,
      status,
      updatedAt: new Date().toISOString(),
    };
  });

  const updatedSession: StocktakeSession = {
    ...session,
    countedItems: counted,
    differenceItems: diffCount,
    totalVarianceValue: totalVariance,
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
    localStorage.setItem(`${STOCKTAKE_LINES_STORAGE_KEY}:${sessionId}`, JSON.stringify(processedLines));
  }

  return { session: updatedSession, lines: processedLines };
}

export async function submitStocktakeForApproval(sessionId: string): Promise<StocktakeSession> {
  const sessions = await loadStocktakes();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  const updatedSession: StocktakeSession = {
    ...session,
    status: 'PENDING_APPROVAL',
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
  }
  return updatedSession;
}

export async function approveAndPostStocktake(
  sessionId: string,
  approvedBy = 'Trưởng phòng Kho vận',
  onSubmitMovement?: (input: any) => Promise<void>,
): Promise<StocktakeSession> {
  const sessions = await loadStocktakes();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  const lines = await loadStocktakeLines(sessionId);

  // Sinh các bút toán cân kho ADJUSTMENT cho các dòng chênh lệch
  const diffLines = lines.filter((l) => l.difference !== 0 && l.actualQuantity !== undefined);
  if (onSubmitMovement && diffLines.length > 0) {
    for (const line of diffLines) {
      try {
        await onSubmitMovement({
          kind: line.difference > 0 ? 'receipt' : 'issue',
          materialCode: line.materialCode,
          warehouseCode: session.warehouseCode,
          quantity: Math.abs(line.difference),
          note: `[Cân kho đợt ${session.code}] ${line.difference > 0 ? 'Thừa' : 'Thiếu'} ${Math.abs(line.difference)} ${line.unit}. Lý do: ${line.reason || 'Đối soát kiểm kê'}`,
        });
      } catch (err) {
        console.warn('Không thể tự động post adjustment lên ledger:', err);
      }
    }
  }

  const updatedSession: StocktakeSession = {
    ...session,
    status: 'POSTED',
    approvedBy,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
  }
  return updatedSession;
}

export async function cancelStocktakeSession(sessionId: string, reason?: string): Promise<StocktakeSession> {
  const sessions = await loadStocktakes();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  const updatedSession: StocktakeSession = {
    ...session,
    status: 'CANCELLED',
    note: [session.note, reason ? `Lý do hủy: ${reason}` : ''].filter(Boolean).join(' | '),
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
  }
  return updatedSession;
}

export async function rejectStocktakeSession(sessionId: string, reason?: string): Promise<StocktakeSession> {
  const sessions = await loadStocktakes();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Không tìm thấy đợt kiểm kê.');

  const updatedSession: StocktakeSession = {
    ...session,
    status: 'COUNTING',
    note: [session.note, reason ? `Yêu cầu đếm lại: ${reason}` : 'Yêu cầu kiểm đếm lại số liệu'].filter(Boolean).join(' | '),
    updatedAt: new Date().toISOString(),
  };

  const newSessions = sessions.map((s) => (s.id === sessionId ? updatedSession : s));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STOCKTAKES_STORAGE_KEY, JSON.stringify(newSessions));
  }
  return updatedSession;
}
