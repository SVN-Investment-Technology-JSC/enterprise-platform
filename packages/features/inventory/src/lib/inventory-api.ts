import type {
  Asset,
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  RetireResult,
  UpdateMaterialRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  UpdateAssetRequest,
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
    window.location.assign(
      `/tenant/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.hash)}`,
    );
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Không thể hoàn tất yêu cầu kho.');
  }
  return response.json() as Promise<T>;
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
