import type { CatalogMaterial, CatalogReader } from '../application/pricing-store.port.js';

/**
 * Danh mục mặt hàng khi Kho chưa có API nội bộ `GET /v1/internal/materials`.
 *
 * Không biết mặt hàng nào, nên service giữ mã, tên, đơn vị, loại hàng theo dữ
 * liệu người dùng nhập. Bản gọi HTTP sang Kho thay lớp này ở composition root
 * (`crm.module.ts`) khi làm T1-24; không phân hệ nào đọc thẳng schema của Kho.
 */
export class PendingCatalogReader implements CatalogReader {
  async materials(): Promise<ReadonlyMap<string, CatalogMaterial>> {
    return new Map();
  }
}
