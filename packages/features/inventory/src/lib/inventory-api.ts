import type {
  AddAssetBomRequest,
  Asset,
  AssetBomLine,
  AssetDocument,
  ChangeQualityRequest,
  CreateAssetDocumentResponse,
  CreateAssetRequest,
  CreateMaterialRequest,
  ImportMaterialsRequest,
  ImportMaterialsResult,
  CreateStockDocumentRequest,
  CreateStockReservationRequest,
  CreateWarehouseRequest,
  InstallItemRequest,
  InstalledMaterial,
  InventoryItem,
  InventorySettingsKey,
  InventorySettingsSnapshot,
  InventoryTransaction,
  Lot,
  LotAllocationInput,
  LotDetail,
  LotSuggestion,
  Material,
  MaterialInventory,
  RegisterSerialsRequest,
  Reservation,
  MaterialDeleteResult,
  RetireResult,
  ReturnItemToStockRequest,
  SerialHistory,
  SerialTracking,
  SettingsEntry,
  PendingStockMovement,
  PostedStockDocument,
  StockDocument,
  StockDocumentListQuery,
  StockDocumentLotInput,
  StockDocumentPage,
  StockMovementListQuery,
  StockMovementPage,
  UninstallMaterialRequest,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSerialRequest,
  UpdateStockDocumentRequest,
  UpdateWarehouseRequest,
  Warehouse,
  StocktakeSession,
  StocktakeLine,
  StocktakeLinesResult,
  StocktakePage,
  StocktakePostResult,
  UpdateStocktakeLineInput,
  MovementCounterparty,
  CreateStocktakeRequest,
  StockApprovalReport,
  StockApprovalReportQuery,
  StockMovementReport,
  StockMovementReportQuery,
  StockReport,
  StockReportQuery,
} from '@enterprise-platform/contracts-inventory';
import { authFetch } from '@enterprise-platform/shared-ui';

const API = '/api/inventory/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (response.status === 401) {
    /**
     * Về trang chủ Platform, KHÔNG về `/tenant/login` — route đó không tồn tại
     * (trả 404), và slug tenant thì client không đọc được: nó nằm trong cookie
     * `ep_access` httpOnly, còn đường dẫn module (`/modules/...`) không mang
     * slug. Trang chủ sẽ đưa người dùng tới đúng chỗ đăng nhập.
     */
    if (typeof window !== 'undefined') window.location.assign('/');
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
  readonly permissions?: {
    canManage: boolean;
    canWriteTransactions: boolean;
    canWriteQuality?: boolean;
    canApproveDocuments?: boolean;
    canCreateStocktake?: boolean;
    canApproveStocktake?: boolean;
  };
  readonly warehouses: Warehouse[];
  readonly materials: Material[];
  readonly assets: Asset[];
  readonly stock: Array<MaterialInventory & { warehouseCode?: string; materialCode?: string }>;
}

export async function loadInventoryWorkspace(): Promise<InventoryWorkspace> {
  const [warehouses, materials, assets, permissions] = await Promise.all([
    request<Warehouse[]>('/warehouses'),
    request<Material[]>('/materials?all=true'),
    request<Asset[]>('/assets'),
    request<NonNullable<InventoryWorkspace['permissions']>>('/capabilities'),
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

  return { warehouses, materials, assets, stock: perWarehouse.flat(), permissions };
}

/**
 * Tồn của một kho đọc trực tiếp từ server.
 *
 * Form xuất/chuyển kho dùng nó thay cho `workspace.stock`: bản trong workspace có
 * thể cũ (nạp lại sau một lần ghi bị lỗi thì giữ dữ liệu trước đó), mà kiểm tồn
 * trên số cũ sẽ cho qua hoặc chặn nhầm một phiếu.
 */
export function loadWarehouseStock(warehouseCode: string): Promise<MaterialInventory[]> {
  return request<MaterialInventory[]>(`/warehouses/${encodeURIComponent(warehouseCode)}/stock`);
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
    const response = await authFetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
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
  const response = await authFetch('/api/procedure/v1/instances', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
 * vào đâu. Thiết bị trên cây (có tài sản nguồn) thì trả bút toán; mã không có hồ
 * sơ thiết bị thì phiếu nhập Chờ duyệt (ISS-BE-006).
 */
export function returnItemToStock(
  code: string,
  input: ReturnItemToStockRequest,
): Promise<InventoryTransaction | PendingStockMovement> {
  return request<InventoryTransaction | PendingStockMovement>(`/items/${encodeURIComponent(code)}/return`, {
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
    const response = await authFetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
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
          const attRes = await authFetch(`/api/procedure/v1/instances/${encodeURIComponent(req.id)}/attachments`, {
            cache: 'no-store',
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
    const response = await authFetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
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

// ---------------------------------------------------------------- Lô, serial, chất lượng

/**
 * Lô của một mặt hàng, kèm tồn từng kho. Lô lưu ở server (T1-18): tạo và cộng
 * trừ qua phiếu nhập, xuất, chuyển; giao diện không còn giữ lô trong trình duyệt.
 */
export function loadLots(materialCode: string): Promise<Lot[]> {
  return request<Lot[]>(`/lots?materialCode=${encodeURIComponent(materialCode)}`);
}

/** Gợi ý lô xuất theo FEFO: hạn dùng gần nhất trước, bỏ lô hết hạn và lô không Đạt. */
export function suggestLots(
  materialCode: string,
  warehouseCode: string,
  quantity: number,
): Promise<LotSuggestion> {
  const query = new URLSearchParams({ materialCode, warehouseCode, quantity: String(quantity) });
  return request<LotSuggestion>(`/lots/suggest?${query.toString()}`);
}

/** Đổi trạng thái chất lượng của lô; bắt buộc có lý do. */
export function changeLotQuality(lotId: string, input: ChangeQualityRequest): Promise<LotDetail> {
  return request<LotDetail>(`/lots/${encodeURIComponent(lotId)}/quality`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Đổi trạng thái chất lượng của một serial; bắt buộc có lý do. */
export function changeSerialQuality(serial: string, input: ChangeQualityRequest): Promise<SerialHistory> {
  return request<SerialHistory>(`/serials/${encodeURIComponent(serial)}/quality`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Lịch sử nhập, xuất, chuyển và đổi chất lượng của một serial. */
export function loadSerialHistory(serial: string, materialCode?: string): Promise<SerialHistory> {
  const query = materialCode ? `?materialCode=${encodeURIComponent(materialCode)}` : '';
  return request<SerialHistory>(`/serials/${encodeURIComponent(serial)}/history${query}`);
}

// ---------------------------------------------------------------- Chứng từ kho (T1-28 đến T1-31)

/** Danh sách chứng từ kho, mới nhất trước; lọc theo loại, trạng thái, kho, nguồn, khoảng ngày. */
export function loadStockDocuments(query: StockDocumentListQuery = {}): Promise<StockDocumentPage> {
  const params = new URLSearchParams();
  if (query.docType) params.set('docType', query.docType);
  if (query.docTypes?.length) params.set('docTypes', query.docTypes.join(','));
  if (query.status) params.set('status', query.status);
  if (query.warehouseCode) params.set('warehouseCode', query.warehouseCode);
  if (query.sourceType) params.set('sourceType', query.sourceType);
  if (query.fromDate) params.set('fromDate', query.fromDate);
  if (query.toDate) params.set('toDate', query.toDate);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return request<StockDocumentPage>(`/stock-documents${suffix ? `?${suffix}` : ''}`);
}

/**
 * Danh sách gộp xuất/nhập kho: chứng từ và bút toán cũ chưa có chứng từ, do
 * server gộp, sắp xếp và phân trang. Giao diện không tự ghép hai API cũ.
 */
export function loadStockMovements(query: StockMovementListQuery = {}): Promise<StockMovementPage> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.kind) params.set('kind', query.kind);
  if (query.docType) params.set('docType', query.docType);
  if (query.status) params.set('status', query.status);
  if (query.warehouseCode) params.set('warehouseCode', query.warehouseCode);
  if (query.sourceType) params.set('sourceType', query.sourceType);
  if (query.fromDate) params.set('fromDate', query.fromDate);
  if (query.toDate) params.set('toDate', query.toDate);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return request<StockMovementPage>(`/stock-movements${suffix ? `?${suffix}` : ''}`, { cache: 'no-store' });
}

export function loadStockDocument(id: string): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}`);
}

export function createStockDocument(input: CreateStockDocumentRequest): Promise<StockDocument> {
  return request<StockDocument>('/stock-documents', { method: 'POST', body: JSON.stringify(input) });
}

export function updateStockDocument(id: string, input: UpdateStockDocumentRequest): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function submitStockDocument(id: string): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}/submit`, { method: 'POST' });
}

export function approveStockDocument(id: string): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export function rejectStockDocument(id: string, reason: string): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function postStockDocument(id: string): Promise<PostedStockDocument> {
  return request<PostedStockDocument>(`/stock-documents/${encodeURIComponent(id)}/post`, { method: 'POST' });
}

export function cancelStockDocument(id: string): Promise<StockDocument> {
  return request<StockDocument>(`/stock-documents/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

/** Chứng từ đảo của chứng từ đã ghi sổ; server ghi sổ ngay. */
export function reverseStockDocument(id: string): Promise<PostedStockDocument> {
  return request<PostedStockDocument>(`/stock-documents/${encodeURIComponent(id)}/reverse`, { method: 'POST' });
}

// ---------------------------------------------------------------- Trang thiết bị cá nhân (HRM Custody)
export function loadEmployeeCustody(
  employeeId: string,
): Promise<import('@enterprise-platform/contracts-inventory').Material[]> {
  return request<import('@enterprise-platform/contracts-inventory').Material[]>(
    `/custody/employees/${encodeURIComponent(employeeId)}`,
  );
}

/** Mọi tài sản đã cấp phát cho nhân viên. */
export function loadCustody(): Promise<import('@enterprise-platform/contracts-inventory').Material[]> {
  return request<import('@enterprise-platform/contracts-inventory').Material[]>('/custody');
}

/** Mọi tài sản kèm nhóm, trạng thái và người đang giữ; từ đó suy ra đang sử dụng, bảo trì hay tồn kho. */
export function loadCustodyAssets(): Promise<import('@enterprise-platform/contracts-inventory').Material[]> {
  return request<import('@enterprise-platform/contracts-inventory').Material[]>('/custody/assets');
}

export function assignCustody(
  materialCode: string,
  employeeId: string | null,
): Promise<import('@enterprise-platform/contracts-inventory').Material> {
  return request<import('@enterprise-platform/contracts-inventory').Material>('/custody/assign', {
    method: 'POST',
    body: JSON.stringify({ materialCode, employeeId }),
  });
}

// ---------------------------------------------------------------- Nhật ký Thí nghiệm & Đo kiểm
export function loadAssetTests(
  assetId: string,
): Promise<import('@enterprise-platform/contracts-inventory').AssetTestRecord[]> {
  return request<import('@enterprise-platform/contracts-inventory').AssetTestRecord[]>(
    `/assets/${encodeURIComponent(assetId)}/tests`,
  );
}

export function createAssetTest(
  input: import('@enterprise-platform/contracts-inventory').CreateAssetTestRecordRequest,
): Promise<import('@enterprise-platform/contracts-inventory').AssetTestRecord> {
  return request<import('@enterprise-platform/contracts-inventory').AssetTestRecord>('/assets/tests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
  /** Lô nhận vào: tạo lô mới hoặc cộng vào lô cùng số lô. */
  lot?: StockDocumentLotInput;
  /** Serial nhận vào cùng phiếu, số phần tử bằng số lượng. */
  serials?: readonly string[];
  counterparty?: MovementCounterparty;
}): Promise<InventoryTransaction | PendingStockMovement> {
  // Không có chứng từ nguồn: server tạo phiếu nhập Chờ duyệt, chưa ghi sổ (ISS-BE-006).
  return request<InventoryTransaction | PendingStockMovement>('/receipts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function issueStock(input: {
  warehouseCode: string;
  materialCode: string;
  quantity: number;
  note?: string;
  /** Phân bổ theo lô; phần còn lại xuất không theo lô. */
  lots?: readonly LotAllocationInput[];
  /** Nơi xuất đi đến (bộ phận, khách, dự án…). */
  counterparty?: MovementCounterparty;
}): Promise<InventoryTransaction | PendingStockMovement> {
  // Không có chứng từ nguồn: server tạo phiếu xuất Chờ duyệt, chưa ghi sổ (ISS-BE-006).
  return request<InventoryTransaction | PendingStockMovement>('/issues', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Phiếu nhập khác hoặc xuất khác nhiều dòng: server tạo MỘT chứng từ Chờ duyệt
 * (`transactions: []`); tồn chỉ đổi khi người duyệt duyệt và ghi sổ (ISS-BE-006).
 */
export function recordMovementBatch(input: {
  kind: 'receipt' | 'issue';
  /** Nơi nhập đến từ / nơi xuất đi đến của cả phiếu. */
  counterparty?: MovementCounterparty;
  lines: {
    warehouseCode: string;
    materialCode: string;
    quantity: number;
    unitCost?: number;
    note?: string;
  }[];
}): Promise<PostedStockDocument> {
  return request<PostedStockDocument>('/movements/batch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function transferStock(input: {
  fromWarehouseCode: string;
  toWarehouseCode: string;
  materialCode: string;
  quantity: number;
  note?: string;
  /** Phân bổ theo lô; phần còn lại chuyển không theo lô. */
  lots?: readonly LotAllocationInput[];
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

/** Danh mục hàng hóa (vật tư và dịch vụ), gồm cả mã đã ngừng dùng để trang lọc phía client. */
export function loadTradeItems(): Promise<Material[]> {
  return request<Material[]>('/materials?all=true');
}

export function createMaterial(input: CreateMaterialRequest): Promise<Material> {
  return request<Material>('/materials', { method: 'POST', body: JSON.stringify(input) });
}

/** Nhập hàng hóa, dịch vụ từ hệ cũ theo lô; giữ người tạo, ngày tạo, trạng thái trong tệp. */
export function importMaterials(input: ImportMaterialsRequest): Promise<ImportMaterialsResult> {
  return request<ImportMaterialsResult>('/materials/import', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMaterial(code: string, patch: UpdateMaterialRequest): Promise<Material> {
  return request<Material>(`/materials/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Ngừng dùng vật tư: chỉ hạ cờ hoạt động, lịch sử giữ nguyên. */
export function retireMaterial(code: string): Promise<RetireResult> {
  return request<RetireResult>(`/materials/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

/** Dùng lại một mã đã ngừng dùng. */
export function reactivateMaterial(code: string): Promise<Material> {
  return updateMaterial(code, { isActive: true });
}

/** Xoá hẳn mã chưa có liên kết nào (dữ liệu rác, tạo nhầm); còn liên kết thì server từ chối và nêu lý do. */
export function deleteMaterial(code: string): Promise<MaterialDeleteResult> {
  return request<MaterialDeleteResult>(`/materials/${encodeURIComponent(code)}/permanent`, { method: 'DELETE' });
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
    const response = await authFetch('/api/auth/v1/me');
    if (!response.ok) return '/';
    return '/dashboard';
  } catch {
    return '/';
  }
}

/**
 * Id người đang đăng nhập, để giao diện ẩn nút tự duyệt. Chỉ là gợi ý hiển thị:
 * server vẫn chặn tự duyệt. Không đọc được thì trả `undefined`.
 */
export async function loadCurrentUserId(): Promise<string | undefined> {
  try {
    const response = await authFetch('/api/auth/v1/me', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const principal = (await response.json()) as { userId?: string };
    return principal?.userId || undefined;
  } catch {
    return undefined;
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
    const response = await authFetch(
      `/api/maintenance/v1/occurrences/history?assetCode=${encodeURIComponent(assetCode)}`,
      { cache: 'no-store' },
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
      // Lọc theo mã ở server thay vì tải toàn bộ dòng của từng đợt.
      const lines = await loadStocktakeLines(session.id, workspace, { search: materialCode });
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
    const response = await authFetch('/api/maintenance/v1/occurrences/incidents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

/** Số đợt lấy một lần cho màn danh sách kiểm kê (server cho tối đa 200). */
const STOCKTAKE_LIST_LIMIT = 200;
/** Server nhận tối đa 500 dòng mỗi lần lưu số đếm. */
const STOCKTAKE_SAVE_CHUNK = 500;

export async function loadStocktakes(_workspace?: InventoryWorkspace): Promise<StocktakeSession[]> {
  const page = await request<StocktakePage>(`/stocktakes?limit=${STOCKTAKE_LIST_LIMIT}`, { cache: 'no-store' });
  return [...page.items];
}

export async function loadStocktakeLines(
  sessionId: string,
  _workspace?: InventoryWorkspace,
  filter: { readonly search?: string; readonly hasDiffOnly?: boolean } = {},
): Promise<StocktakeLine[]> {
  const params = new URLSearchParams();
  if (filter.search) params.set('search', filter.search);
  if (filter.hasDiffOnly) params.set('hasDiffOnly', 'true');
  const suffix = params.toString();
  return request<StocktakeLine[]>(
    `/stocktakes/${encodeURIComponent(sessionId)}/lines${suffix ? `?${suffix}` : ''}`,
    { cache: 'no-store' },
  );
}

export interface AuditorCandidate {
  readonly id: string;
  readonly name: string;
  readonly code?: string;
  readonly department?: string;
  readonly position?: string;
  readonly email?: string;
  readonly hasWarehouseAccess?: boolean;
}

let cachedAuditors: AuditorCandidate[] | null = null;

export async function loadAuditorCandidates(): Promise<AuditorCandidate[]> {
  if (cachedAuditors && cachedAuditors.length > 0) return cachedAuditors;

  // 1. Tải danh sách nhân sự kèm thông tin phân quyền kho chính xác từ Inventory API
  try {
    const list = await request<AuditorCandidate[]>('/auditor-candidates');
    if (Array.isArray(list) && list.length > 0) {
      cachedAuditors = list;
      return list;
    }
  } catch {
    // Không gọi được endpoint mới, tiếp tục fallback
  }

  // 2. Thử tải từ HRM Employee Directory nếu có
  try {
    const res = await authFetch('/api/hrm/v1/employees?page_size=100');
    if (res.ok) {
      const json = (await res.json()) as { data?: any[] };
      if (Array.isArray(json?.data) && json.data.length > 0) {
        const candidates: AuditorCandidate[] = json.data.map((emp) => {
          const dept = emp.departmentName || emp.department || '';
          const pos = emp.positionTitle || emp.position || '';
          const d = dept.toLowerCase();
          const p = pos.toLowerCase();
          const isWh =
            d.includes('kho') ||
            d.includes('vật tư') ||
            d.includes('hậu cần') ||
            d.includes('logistics') ||
            p.includes('kho') ||
            p.includes('vật tư') ||
            p.includes('thủ kho') ||
            p.includes('kế toán kho') ||
            p.includes('kế toán vật tư');
          return {
            id: emp.employeeId || emp.id || emp.employeeCode,
            name: emp.fullName || emp.name,
            code: emp.employeeCode || emp.code,
            department: dept,
            position: pos,
            email: emp.workEmail || emp.email,
            hasWarehouseAccess: isWh,
          };
        });
        candidates.sort((a, b) => (b.hasWarehouseAccess ? 1 : 0) - (a.hasWarehouseAccess ? 1 : 0));
        cachedAuditors = candidates;
        return candidates;
      }
    }
  } catch {
    // Không truy cập được HRM, thử tiếp nguồn khác
  }

  // 2. Thử tải từ Directory của Workspace nếu có
  try {
    const res = await authFetch('/api/workspace/v1/directory');
    if (res.ok) {
      const json = (await res.json()) as { people?: any[] };
      if (Array.isArray(json?.people) && json.people.length > 0) {
        const candidates: AuditorCandidate[] = json.people.map((p) => {
          const unit = Array.isArray(p.unitNames) ? p.unitNames.join(', ') : '';
          const pos = p.positionName || '';
          const u = unit.toLowerCase();
          const pLower = pos.toLowerCase();
          const isWh =
            u.includes('kho') ||
            u.includes('vật tư') ||
            u.includes('hậu cần') ||
            u.includes('logistics') ||
            pLower.includes('kho') ||
            pLower.includes('vật tư') ||
            pLower.includes('thủ kho') ||
            pLower.includes('kế toán kho') ||
            pLower.includes('kế toán vật tư');
          return {
            id: p.userId,
            name: p.displayName || p.name,
            code: undefined,
            department: unit,
            position: pos,
            email: p.email,
            hasWarehouseAccess: isWh,
          };
        });
        candidates.sort((a, b) => (b.hasWarehouseAccess ? 1 : 0) - (a.hasWarehouseAccess ? 1 : 0));
        cachedAuditors = candidates;
        return candidates;
      }
    }
  } catch {
    // Bỏ qua
  }

  // 3. Không có nguồn nào trả về người thật: để danh sách rỗng, giao diện báo "Chưa có nhân viên kho".
  return [];
}

export function createStocktakeSession(
  input: CreateStocktakeRequest,
  _workspace?: InventoryWorkspace,
): Promise<StocktakeSession> {
  return request<StocktakeSession>('/stocktakes', { method: 'POST', body: JSON.stringify(input) });
}

/** Chụp snapshot tồn sổ sách ở server và chuyển sang Đang kiểm đếm. */
export async function startStocktakeCounting(
  sessionId: string,
  _workspace?: InventoryWorkspace,
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  const result = await request<StocktakeLinesResult>(`/stocktakes/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
  });
  return { session: result.session, lines: [...result.lines] };
}

/** Dòng có dữ liệu người dùng nhập; dòng chưa đụng tới không cần gửi lại. */
function hasCountData(line: StocktakeLine): boolean {
  return (
    line.actualQuantity !== undefined ||
    line.countRound1 !== undefined ||
    line.countRound2 !== undefined ||
    Boolean(line.reason?.trim()) ||
    Boolean(line.note?.trim())
  );
}

function toLineUpdate(line: StocktakeLine): UpdateStocktakeLineInput {
  return {
    lineId: line.id,
    countRound1: line.countRound1,
    countRound2: line.countRound2,
    actualQuantity: line.actualQuantity,
    reason: line.reason,
    note: line.note,
    lotAllocations: line.lotAllocations,
    serialAllocations: line.serialAllocations,
  };
}

/**
 * Lưu số đếm ở server. Chênh lệch, giá trị lệch và trạng thái dòng do server
 * tính; chia nhóm 500 dòng vì server giới hạn mỗi lần lưu.
 */
export async function saveStocktakeLines(
  sessionId: string,
  updatedLines: StocktakeLine[],
  _operator?: string,
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  const updates = updatedLines.filter(hasCountData).map(toLineUpdate);
  let latest: StocktakeLinesResult | undefined;
  for (let index = 0; index < updates.length; index += STOCKTAKE_SAVE_CHUNK) {
    latest = await request<StocktakeLinesResult>(`/stocktakes/${encodeURIComponent(sessionId)}/lines`, {
      method: 'PATCH',
      body: JSON.stringify({ lines: updates.slice(index, index + STOCKTAKE_SAVE_CHUNK) }),
    });
  }
  if (latest) return { session: latest.session, lines: [...latest.lines] };
  const session = await request<StocktakeSession>(`/stocktakes/${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
  });
  return { session, lines: await loadStocktakeLines(sessionId) };
}

export function submitStocktakeForApproval(sessionId: string): Promise<StocktakeSession> {
  return request<StocktakeSession>(`/stocktakes/${encodeURIComponent(sessionId)}/submit`, { method: 'POST' });
}

/**
 * Duyệt rồi ghi sổ cân kho. Server tạo chứng từ điều chỉnh trong một transaction
 * (nguồn `stocktake`), nên giao diện không còn tự gọi nhập xuất từng dòng.
 * Đợt đã duyệt từ lần trước (ghi sổ lỗi giữa chừng) chỉ cần ghi sổ lại.
 */
export async function approveAndPostStocktake(sessionId: string): Promise<StocktakeSession> {
  const key = encodeURIComponent(sessionId);
  const current = await request<StocktakeSession>(`/stocktakes/${key}`, { cache: 'no-store' });
  if (current.status === 'PENDING_APPROVAL') {
    await request<StocktakeSession>(`/stocktakes/${key}/approve`, { method: 'POST' });
  }
  const result = await request<StocktakePostResult>(`/stocktakes/${key}/post`, { method: 'POST' });
  return result.session;
}

/**
 * Ghi sổ lại đợt đã duyệt (lần trước ghi sổ lỗi). Server có khoá chống lặp theo
 * đợt nên bấm lặp không điều chỉnh tồn hai lần; đợt đã ghi sổ trả kết quả cũ.
 */
export async function postStocktake(sessionId: string): Promise<StocktakeSession> {
  const result = await request<StocktakePostResult>(`/stocktakes/${encodeURIComponent(sessionId)}/post`, {
    method: 'POST',
  });
  return result.session;
}

export function cancelStocktakeSession(sessionId: string, reason?: string): Promise<StocktakeSession> {
  return request<StocktakeSession>(`/stocktakes/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? '' }),
  });
}

export function rejectStocktakeSession(sessionId: string, reason?: string): Promise<StocktakeSession> {
  return request<StocktakeSession>(`/stocktakes/${encodeURIComponent(sessionId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? '' }),
  });
}

// ---------------------------------------------------------------- Báo cáo kho (T7-06, T7-07)

/** Chuỗi query từ object lọc: bỏ giá trị rỗng, false và undefined. */
function reportQuery(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

/** Tồn theo kho, lô hoặc serial với bốn loại tồn; có phân trang và tổng của cả tập đã lọc. */
export function loadStockReport(query: StockReportQuery): Promise<StockReport> {
  return request<StockReport>(`/reports/stock${reportQuery(query)}`);
}

/** Nhập, xuất, điều chuyển, nhập trả, điều chỉnh, chứng từ đảo theo kỳ. */
export function loadMovementReport(query: StockMovementReportQuery): Promise<StockMovementReport> {
  return request<StockMovementReport>(`/reports/movements${reportQuery(query)}`);
}

/** Lịch sử chứng từ phải duyệt: người lập, người duyệt, thời điểm, lý do. */
export function loadApprovalReport(query: StockApprovalReportQuery): Promise<StockApprovalReport> {
  return request<StockApprovalReport>(`/reports/approvals${reportQuery(query)}`);
}
