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
  PostedStockDocument,
  StockDocument,
  StockDocumentListQuery,
  StockDocumentLotInput,
  StockDocumentPage,
  UninstallMaterialRequest,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSerialRequest,
  UpdateStockDocumentRequest,
  UpdateWarehouseRequest,
  Warehouse,
  StocktakeSession,
  StocktakeLine,
  UpdateStocktakeLineInput,
  AuditorCandidate,
  MovementCounterparty,
  CreateStocktakeRequest,
  StockApprovalReport,
  StockApprovalReportQuery,
  StockMovementReport,
  StockMovementReportQuery,
  StockReport,
  StockReportQuery,
} from '@enterprise-platform/contracts-inventory';
import { authFetch, todayInVietnam } from '@enterprise-platform/shared-ui';

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

/** Kiểm tra trên toàn bộ sổ cái server xem các mã bảng kê nào đã có bút toán xuất kho. */
export async function loadFulfilledRequisitionCodes(
  codes: readonly string[],
): Promise<string[]> {
  const clean = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (clean.length === 0) return [];
  try {
    const query = encodeURIComponent(clean.join(','));
    const data = await request<{ fulfilledCodes?: string[] }>(
      `/requisitions/fulfilled?codes=${query}`,
    );
    return data.fulfilledCodes ?? [];
  } catch {
    return [];
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
    const requisitions: ProcedureRequisition[] = [];

    // 1. Thu thập từ `materialOrders` ghi trên hồ sơ cha
    for (const inst of instances) {
      if (inst.materialOrders && inst.materialOrders.length > 0) {
        for (const order of inst.materialOrders) {
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

    // Lọc các bảng kê đã được xuất kho trên sổ cái server (không giới hạn 50 giao dịch gần nhất)
    const serverFulfilled = new Set(
      await loadFulfilledRequisitionCodes(requisitions.map((r) => r.code)),
    );
    const pendingRequisitions = requisitions.filter((r) => !serverFulfilled.has(r.code));

    // Lấy đính kèm downloadUrl cho từng yêu cầu còn chờ xuất
    await Promise.all(
      pendingRequisitions.map(async (req) => {
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

    return pendingRequisitions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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
}): Promise<InventoryTransaction> {
  return request<InventoryTransaction>('/receipts', { method: 'POST', body: JSON.stringify(input) });
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
}): Promise<InventoryTransaction> {
  return request<InventoryTransaction>('/issues', { method: 'POST', body: JSON.stringify(input) });
}

/** Ghi nhiều dòng nhập hoặc xuất của một phiếu: một dòng lỗi thì không dòng nào được ghi. */
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
}): Promise<InventoryTransaction[]> {
  return request<InventoryTransaction[]>('/movements/batch', {
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
let maintenanceAccessDenied = false;

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
  if (maintenanceAccessDenied) return undefined;
  try {
    const response = await authFetch(
      `/api/maintenance/v1/occurrences/history?assetCode=${encodeURIComponent(assetCode)}`,
      { cache: 'no-store' },
    );
    if (response.status === 401 || response.status === 403) {
      maintenanceAccessDenied = true;
      return undefined;
    }
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
  if (maintenanceAccessDenied) return undefined;
  try {
    const response = await authFetch('/api/maintenance/v1/workspace', {
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      maintenanceAccessDenied = true;
      return undefined;
    }
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
// STOCKTAKE (KIỂM KÊ KHO) API (chạy hoàn toàn trên server)
// ============================================================================

export type { AuditorCandidate };

export function loadAuditorCandidates(): Promise<AuditorCandidate[]> {
  return request<AuditorCandidate[]>('/auditor-candidates').catch(() => []);
}

export function loadStocktakes(_workspace?: InventoryWorkspace): Promise<StocktakeSession[]> {
  return request<StocktakeSession[]>('/stocktakes');
}

export function loadStocktakeLines(
  sessionId: string,
  _workspace?: InventoryWorkspace,
): Promise<StocktakeLine[]> {
  return request<StocktakeLine[]>(`/stocktakes/${encodeURIComponent(sessionId)}/lines`);
}

export function createStocktakeSession(
  input: CreateStocktakeRequest,
  _workspace?: InventoryWorkspace,
): Promise<StocktakeSession> {
  return request<StocktakeSession>('/stocktakes', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      stocktakeDate: input.stocktakeDate || todayInVietnam(),
    }),
  });
}

export function startStocktakeCounting(
  sessionId: string,
  _workspace?: InventoryWorkspace,
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  return request<{ session: StocktakeSession; lines: StocktakeLine[] }>(
    `/stocktakes/${encodeURIComponent(sessionId)}/start`,
    { method: 'POST' },
  );
}

export function saveStocktakeLines(
  sessionId: string,
  updates: readonly UpdateStocktakeLineInput[],
  _operator?: string,
): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
  return request<{ session: StocktakeSession; lines: StocktakeLine[] }>(
    `/stocktakes/${encodeURIComponent(sessionId)}/lines`,
    {
      method: 'PATCH',
      body: JSON.stringify({ lines: updates }),
    },
  );
}

export function submitStocktakeForApproval(sessionId: string): Promise<StocktakeSession> {
  return request<StocktakeSession>(
    `/stocktakes/${encodeURIComponent(sessionId)}/submit`,
    { method: 'POST' },
  );
}

export async function approveAndPostStocktake(
  sessionId: string,
  _approvedBy?: string,
  _onSubmitMovement?: unknown,
): Promise<StocktakeSession> {
  const result = await request<{ session: StocktakeSession; transactionsCreated: number }>(
    `/stocktakes/${encodeURIComponent(sessionId)}/approve`,
    { method: 'POST' },
  );
  return result.session;
}

export function cancelStocktakeSession(
  sessionId: string,
  reason?: string,
): Promise<StocktakeSession> {
  return request<StocktakeSession>(
    `/stocktakes/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export function rejectStocktakeSession(
  sessionId: string,
  reason?: string,
): Promise<StocktakeSession> {
  return request<StocktakeSession>(
    `/stocktakes/${encodeURIComponent(sessionId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
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
