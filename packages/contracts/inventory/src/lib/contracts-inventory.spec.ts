import { isSupplierCatalogEnforced } from './contracts-inventory.js';

describe('isSupplierCatalogEnforced', () => {
  it('chỉ chọn từ danh mục và danh mục có mục: có hiệu lực', () => {
    expect(isSupplierCatalogEnforced(['Công ty A'], 'CATALOG_ONLY')).toBe(true);
  });

  it('danh mục rỗng thì không chặn, để tenant chưa khai danh mục vẫn nhập kho được', () => {
    expect(isSupplierCatalogEnforced([], 'CATALOG_ONLY')).toBe(false);
    expect(isSupplierCatalogEnforced(['', '  '], 'CATALOG_ONLY')).toBe(false);
  });

  it('cho nhập tự do thì không chặn dù danh mục có mục', () => {
    expect(isSupplierCatalogEnforced(['Công ty A'], 'CATALOG_OR_FREE')).toBe(false);
  });
});
