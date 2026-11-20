import { SupplierNotInCatalogError } from './inventory.error.js';
import {
  buildSupplierPolicy,
  groupLegacySuppliers,
  normalizeSupplierKey,
} from './supplier-catalog.js';

describe('normalizeSupplierKey', () => {
  it.each([
    ['Công ty A', 'cong ty a'],
    ['CÔNG TY A ', 'cong ty a'],
    ['Cong ty A.', 'cong ty a'],
    ['  Công   ty\tA  ', 'cong ty a'],
    ['Công-ty, A', 'cong ty a'],
    ['Đại Phát', 'dai phat'],
    ['ABB (Việt Nam)', 'abb viet nam'],
  ])('%j có khóa %j', (input, expected) => {
    expect(normalizeSupplierKey(input)).toBe(expected);
  });

  it('chữ khác nhau thật thì khóa khác nhau; viết tắt không bị đoán là cùng một nhà', () => {
    expect(normalizeSupplierKey('Cty A')).not.toBe(normalizeSupplierKey('Công ty A'));
    expect(normalizeSupplierKey('Công ty A')).not.toBe(normalizeSupplierKey('Công ty B'));
  });

  it.each([[''], ['   '], ['...'], [null], [undefined]])('%j không có khóa (chuỗi rỗng)', (input) => {
    expect(normalizeSupplierKey(input as string | null | undefined)).toBe('');
  });
});

describe('buildSupplierPolicy', () => {
  const catalog = ['Công ty A', 'ABB Việt Nam'];

  it('CATALOG_ONLY với danh mục có mục: có hiệu lực chặn', () => {
    expect(buildSupplierPolicy(catalog, 'CATALOG_ONLY').enforced).toBe(true);
  });

  it('CATALOG_ONLY với danh mục RỖNG: không chặn, để tenant chưa khai danh mục vẫn nhập kho được', () => {
    const policy = buildSupplierPolicy([], 'CATALOG_ONLY');
    expect(policy.enforced).toBe(false);
    expect(policy.resolve('  Nhà bất kỳ ')).toBe('Nhà bất kỳ');
  });

  it('danh mục chỉ gồm mục trống cũng coi là rỗng', () => {
    expect(buildSupplierPolicy(['', '  ', '...'], 'CATALOG_ONLY').enforced).toBe(false);
  });

  it('CATALOG_OR_FREE: không chặn dù danh mục có mục, trả chữ đã cắt khoảng trắng', () => {
    const policy = buildSupplierPolicy(catalog, 'CATALOG_OR_FREE');
    expect(policy.enforced).toBe(false);
    expect(policy.resolve(' Nhà lạ ')).toBe('Nhà lạ');
  });

  it('đang chặn: tên khớp sau chuẩn hóa được đổi thành đúng tên trong danh mục', () => {
    const policy = buildSupplierPolicy(catalog, 'CATALOG_ONLY');
    expect(policy.resolve('CONG TY A')).toBe('Công ty A');
    expect(policy.resolve(' abb viet nam. ')).toBe('ABB Việt Nam');
  });

  it('đang chặn: tên ngoài danh mục bị từ chối với mã SUPPLIER_NOT_IN_CATALOG và thông báo tiếng Việt', () => {
    const policy = buildSupplierPolicy(catalog, 'CATALOG_ONLY');
    expect(() => policy.resolve('Nhà lạ')).toThrow(SupplierNotInCatalogError);
    try {
      policy.resolve('Nhà lạ', 'Dòng 2: ');
      throw new Error('phải ném lỗi');
    } catch (error) {
      const failure = error as SupplierNotInCatalogError;
      expect(failure.code).toBe('SUPPLIER_NOT_IN_CATALOG');
      expect(failure.statusCode).toBe(400);
      expect(failure.message).toBe(
        'Dòng 2: Nhà cung cấp "Nhà lạ" chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt.',
      );
    }
  });

  it.each([[undefined], [null], [''], ['   ']])('chữ trống %j trả undefined, không ném lỗi dù đang chặn', (raw) => {
    expect(buildSupplierPolicy(catalog, 'CATALOG_ONLY').resolve(raw)).toBeUndefined();
  });

  it('sameSupplier so theo khóa chuẩn hóa, và hai chữ trống không được coi là cùng một nhà', () => {
    const policy = buildSupplierPolicy(catalog, 'CATALOG_ONLY');
    expect(policy.sameSupplier('Công ty A', 'cong ty a')).toBe(true);
    expect(policy.sameSupplier('Công ty A', 'Công ty B')).toBe(false);
    expect(policy.sameSupplier('', '')).toBe(false);
    expect(policy.sameSupplier(undefined, 'Công ty A')).toBe(false);
  });
});

describe('groupLegacySuppliers', () => {
  it('gộp biến thể viết khác nhau, lấy cách viết nhiều nhất làm tên đề xuất, cộng số bản ghi theo từng nguồn', () => {
    const result = groupLegacySuppliers(
      [
        { name: 'Công ty A', source: 'MATERIAL', count: 3 },
        { name: 'CONG TY A', source: 'LOT', count: 1 },
        { name: 'Công ty A', source: 'TRANSACTION', count: 5 },
        { name: 'ABB', source: 'LOT', count: 2 },
      ],
      [],
    );
    expect(result).toEqual([
      {
        name: 'Công ty A',
        variants: ['Công ty A', 'CONG TY A'],
        materialCount: 3,
        lotCount: 1,
        transactionCount: 5,
        inCatalog: false,
      },
      {
        name: 'ABB',
        variants: ['ABB'],
        materialCount: 0,
        lotCount: 2,
        transactionCount: 0,
        inCatalog: false,
      },
    ]);
  });

  it('đánh dấu inCatalog khi nhóm đã có trong danh mục (so sau chuẩn hóa), không bỏ nhóm đi', () => {
    const [candidate] = groupLegacySuppliers(
      [{ name: 'cong ty a', source: 'MATERIAL', count: 1 }],
      ['Công ty A'],
    );
    expect(candidate.inCatalog).toBe(true);
    expect(candidate.name).toBe('cong ty a');
  });

  it('bỏ giá trị không có khóa; hòa số lần thì chọn tên theo chữ cái để kết quả ổn định', () => {
    const result = groupLegacySuppliers(
      [
        { name: '...', source: 'MATERIAL', count: 9 },
        { name: 'Beta', source: 'MATERIAL', count: 1 },
        { name: 'beta', source: 'LOT', count: 1 },
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].variants).toEqual(['beta', 'Beta']);
  });

  it('xếp nhóm dùng nhiều trước, hòa thì theo tên', () => {
    const result = groupLegacySuppliers(
      [
        { name: 'B', source: 'MATERIAL', count: 1 },
        { name: 'A', source: 'MATERIAL', count: 1 },
        { name: 'C', source: 'MATERIAL', count: 4 },
      ],
      [],
    );
    expect(result.map((candidate) => candidate.name)).toEqual(['C', 'A', 'B']);
  });
});
