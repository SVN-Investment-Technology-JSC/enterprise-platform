import type { CatalogMaterial, CatalogReader } from '../application/pricing-store.port.js';

/**
 * Danh mục rỗng: không biết mặt hàng nào, nên service giữ mã, tên, đơn vị, loại
 * hàng theo dữ liệu người dùng nhập. Chỉ dùng trong test của bảng giá; app dùng
 * `HttpInventoryCatalogReader` (API nội bộ của Kho).
 */
export class PendingCatalogReader implements CatalogReader {
  async materials(): Promise<ReadonlyMap<string, CatalogMaterial>> {
    return new Map();
  }

  async search(): Promise<CatalogMaterial[]> {
    return [];
  }
}
