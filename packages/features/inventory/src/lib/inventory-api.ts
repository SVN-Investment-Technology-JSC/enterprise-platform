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
    request<Material[]>('/materials'),
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
    const requisitions: ProcedureRequisition[] = [];

    // 1. Thu thập từ `materialOrders` ghi trên hồ sơ cha
    for (const inst of instances) {
      if (inst.materialOrders && inst.materialOrders.length > 0) {
        for (const order of inst.materialOrders) {
          const childInst = instances.find((c) => c.code === order.code);
          requisitions.push({
            id: childInst?.id ?? order.code,
            code: order.code,
            title: childInst?.title ?? `Yêu cầu vật tư (${order.kind === 'purchase' ? 'Mua sắm' : 'Xuất kho'}) từ ${inst.code}`,
            status: childInst?.status ?? 'active',
            startedAt: order.createdAt || inst.startedAt,
            sourceType: 'auto_from_parent',
            sourceId: inst.id,
            assetCode: inst.assetCode,
            kind: order.kind,
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
        const isPurchase = inst.title?.toLowerCase().includes('mua sắm');
        requisitions.push({
          id: inst.id,
          code: inst.code,
          title: inst.title ?? inst.code,
          status: inst.status,
          startedAt: inst.startedAt,
          sourceType: inst.sourceType,
          sourceId: inst.sourceId,
          assetCode: inst.assetCode,
          kind: isPurchase ? 'purchase' : 'issue',
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
    const principal = (await response.json()) as { tenantSlug?: string };
    return principal.tenantSlug ? `/t/${principal.tenantSlug}` : '/';
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
