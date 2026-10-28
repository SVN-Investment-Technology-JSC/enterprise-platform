import type { CatalogMaterial, CatalogMaterialStock, CatalogReader } from '../application/pricing-store.port.js';
import { CrmError } from '../domain/crm.error.js';

/** Kho không trả lời: không đoán giá vốn hay tồn. */
export const inventoryUnavailable = () =>
  new CrmError('INVENTORY_UNAVAILABLE', 'Không kết nối được Kho để lấy danh mục mặt hàng. Vui lòng thử lại sau.', 503);

/** Hàng tồn kho và dịch vụ; không truyền `kind` thì Kho chỉ trả STOCK (giữ hành vi cũ cho Quy trình). */
const ALL_KINDS = 'STOCK,SERVICE';
/** Số id tối đa một lần hỏi, để URL không quá dài. */
const IDS_PER_REQUEST = 100;

interface WireStock {
  warehouseId?: unknown;
  warehouseCode?: unknown;
  available?: unknown;
}

interface WireMaterial {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  unit?: unknown;
  kind?: unknown;
  category?: unknown;
  avgCost?: unknown;
  totalAvailable?: unknown;
  availableByWarehouse?: unknown;
  warrantyMonths?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function toMaterial(row: WireMaterial): CatalogMaterial | null {
  const id = text(row.id);
  const code = text(row.code);
  if (!id || !code) return null;
  const stocks = Array.isArray(row.availableByWarehouse)
    ? (row.availableByWarehouse as WireStock[])
        .map((stock): CatalogMaterialStock | null => {
          const warehouseId = text(stock?.warehouseId);
          const available = number(stock?.available);
          return warehouseId && available !== null
            ? { warehouseId, warehouseCode: text(stock?.warehouseCode) ?? '', available }
            : null;
        })
        .filter((stock): stock is CatalogMaterialStock => stock !== null)
    : null;
  return {
    id: id.toLowerCase(),
    code,
    name: text(row.name) ?? code,
    unit: text(row.unit),
    kind: text(row.kind),
    category: text(row.category),
    avgCost: number(row.avgCost),
    totalAvailable: number(row.totalAvailable),
    availableByWarehouse: stocks,
    warrantyMonths: number(row.warrantyMonths),
  };
}

/**
 * Danh mục mặt hàng của Kho qua `GET {INVENTORY_API_URL}/v1/internal/materials`
 * (header `x-service-token`, `x-tenant-id`), không đọc schema của Kho. Lỗi mạng,
 * token, 5xx đều thành 503 `INVENTORY_UNAVAILABLE`.
 */
export class HttpInventoryCatalogReader implements CatalogReader {
  constructor(
    private readonly baseUrl: string = process.env['INVENTORY_API_URL'] ?? 'http://localhost:3336/api/inventory',
    private readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  async materials(tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMaterial>> {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    const result = new Map<string, CatalogMaterial>();
    for (let index = 0; index < unique.length; index += IDS_PER_REQUEST) {
      const chunk = unique.slice(index, index + IDS_PER_REQUEST);
      for (const material of await this.fetch(tenantId, { ids: chunk.join(','), kind: ALL_KINDS })) {
        result.set(material.id, material);
      }
    }
    return result;
  }

  search(tenantId: string, query: string, limit: number): Promise<CatalogMaterial[]> {
    return this.fetch(tenantId, { search: query.trim(), kind: ALL_KINDS, limit: String(limit) });
  }

  private async fetch(tenantId: string, params: Record<string, string>): Promise<CatalogMaterial[]> {
    const token = this.token();
    if (!token) throw inventoryUnavailable();
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ''));
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/internal/materials?${query}`, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw inventoryUnavailable();
    }
    if (!response.ok) throw inventoryUnavailable();
    let body: { materials?: unknown };
    try {
      body = (await response.json()) as { materials?: unknown };
    } catch {
      throw inventoryUnavailable();
    }
    if (!Array.isArray(body?.materials)) throw inventoryUnavailable();
    return (body.materials as WireMaterial[]).map(toMaterial).filter((material): material is CatalogMaterial => material !== null);
  }
}
