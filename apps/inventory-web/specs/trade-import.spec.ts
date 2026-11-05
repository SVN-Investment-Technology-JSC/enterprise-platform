import {
  buildImportRows,
  catalogAdditionsFor,
  collectImportValues,
  detectMapping,
  guessDefaultKind,
  parseAmount,
  parseImportDate,
  sheetFromRecords,
  tradeTemplateGuide,
  tradeTemplateRows,
  unimportedLines,
  unimportedRecords,
} from '@enterprise-platform/feature-inventory';

const catalog = { goodsCategories: ['HH_1'], serviceCategories: ['DV_1'], usageModes: ['Chỉ bán'] };

// Tiêu đề và giá trị theo tệp "Dịch vụ" xuất từ hệ cũ.
const serviceSheet = () =>
  sheetFromRecords([
    {
      'Mã dịch vụ': 'DV-368',
      'Nhóm dịch vụ': 'TN-DV',
      'Tên dịch vụ': 'Lắp đặt hệ thống',
      'Đơn vị': 'Gói',
      'Loại dịch vụ': 'Chỉ bán',
      'Thông tin dịch vụ': 'không có PSS',
      'Ngày tạo': '02/07/2026',
      'Người tạo': 'Cao Khánh Ngọc',
      'Giá bán mặc định': 116400000,
      'Giá vốn mặc định': '',
      'Trạng thái': 'Hoạt động',
      'Hình ảnh': '',
    },
    {
      'Mã dịch vụ': 'DV-1',
      'Nhóm dịch vụ': '',
      'Tên dịch vụ': 'Dịch vụ cũ',
      'Đơn vị': 'Cái',
      'Loại dịch vụ': 'Có thể bán và quà tặng',
      'Thông tin dịch vụ': '',
      'Ngày tạo': '13/09/2022',
      'Người tạo': 'Admin',
      'Giá bán mặc định': '',
      'Giá vốn mặc định': '',
      'Trạng thái': 'Không hoạt động',
      'Hình ảnh': '',
    },
  ]);

const baseOptions = (sheet: ReturnType<typeof serviceSheet>) => ({
  mapping: detectMapping(sheet),
  defaultKind: guessDefaultKind(sheet),
  catalog,
  categoryDecisions: {},
  usageDecisions: {},
  blankAuthors: new Set<string>(),
});

describe('Nhập hàng hóa: ghép cột tự động', () => {
  it('nhận đúng cột của tệp dịch vụ hệ cũ: Nhóm dịch vụ là phân loại, Loại dịch vụ là sử dụng', () => {
    expect(detectMapping(serviceSheet())).toEqual({
      code: 'Mã dịch vụ',
      name: 'Tên dịch vụ',
      unit: 'Đơn vị',
      category: 'Nhóm dịch vụ',
      usage: 'Loại dịch vụ',
      price: 'Giá bán mặc định',
      cost: 'Giá vốn mặc định',
      description: 'Thông tin dịch vụ',
      createdBy: 'Người tạo',
      createdAt: 'Ngày tạo',
      status: 'Trạng thái',
    });
    expect(guessDefaultKind(serviceSheet())).toBe('SERVICE');
  });

  it('không ghép nhầm "Đơn vị quy đổi", "Seri sản phẩm" hay "Loại hàng hóa" vào trường khác', () => {
    const sheet = sheetFromRecords([
      {
        'Mã sản phẩm': '1324',
        'Tên sản phẩm': 'Relay',
        'Đơn vị quy đổi': 'Gói',
        'Đơn vị': 'Cái',
        'Seri sản phẩm': '2140',
        'Loại hàng hóa': 'Hàng không thường xuyên',
        'Nhóm sản phẩm': 'Nhóm sản phẩm khác',
      },
    ]);
    const mapping = detectMapping(sheet);
    expect(mapping.unit).toBe('Đơn vị');
    expect(Object.values(mapping)).not.toContain('Seri sản phẩm');
    expect(Object.values(mapping)).not.toContain('Đơn vị quy đổi');
    expect(mapping.kind).toBeUndefined();
    expect(mapping.category).toBe('Nhóm sản phẩm');
  });

  it('cột "Nhóm" chỉ là loại khi mọi giá trị là Hàng hóa hoặc Dịch vụ (tệp mẫu cũ)', () => {
    const template = sheetFromRecords([{ Mã: 'A', Tên: 'B', 'Đơn vị': 'Cái', Nhóm: 'Dịch vụ', 'Phân loại': '' }]);
    expect(detectMapping(template)).toMatchObject({ kind: 'Nhóm', category: 'Phân loại' });
  });
});

describe('Nhập hàng hóa: chuẩn hóa dòng', () => {
  it('giữ mô tả, giá, người tạo, ngày tạo và trạng thái; dịch vụ không phải hàng tồn', () => {
    const sheet = serviceSheet();
    const [first, second] = buildImportRows(sheet, baseOptions(sheet));
    expect(first.input).toMatchObject({
      line: 2,
      code: 'DV-368',
      kind: 'SERVICE',
      unit: 'Gói',
      tradeCategory: 'TN-DV',
      tradeMode: 'Chỉ bán',
      salePrice: 116400000,
      currency: 'VND',
      description: 'không có PSS',
      createdBy: 'Cao Khánh Ngọc',
      createdAt: '2026-07-02T00:00:00+07:00',
      isActive: true,
    });
    expect(second.input).toMatchObject({ salePrice: undefined, currency: undefined, isActive: false, tradeCategory: undefined });
  });

  it('người đã nghỉ việc được đánh dấu thì người tạo để trống, không rơi về người đang nhập', () => {
    const sheet = serviceSheet();
    const rows = buildImportRows(sheet, { ...baseOptions(sheet), blankAuthors: new Set(['Admin']) });
    expect(rows[0].input?.createdBy).toBe('Cao Khánh Ngọc');
    expect(rows[1].input?.createdBy).toBe('');
  });

  it('báo giá trị lạ để hỏi, và tính mục cần thêm vào Cài đặt theo đúng nhóm', () => {
    const sheet = serviceSheet();
    const options = baseOptions(sheet);
    expect(collectImportValues(sheet, options)).toEqual({
      categories: ['TN-DV'],
      usages: ['Có thể bán và quà tặng'],
      authors: ['Admin', 'Cao Khánh Ngọc'],
    });
    const rows = buildImportRows(sheet, options);
    expect(catalogAdditionsFor(rows, options)).toEqual({
      goodsCategories: [],
      serviceCategories: ['TN-DV'],
      usageModes: ['Có thể bán và quà tặng'],
    });
  });

  it('quyết định bỏ trống hoặc ghép vào mục có sẵn thì không thêm vào Cài đặt', () => {
    const sheet = serviceSheet();
    const options = {
      ...baseOptions(sheet),
      categoryDecisions: { 'TN-DV': { action: 'map', to: 'DV_1' } as const },
      usageDecisions: { 'Có thể bán và quà tặng': { action: 'blank' } as const },
    };
    const rows = buildImportRows(sheet, options);
    expect(rows[0].input?.tradeCategory).toBe('DV_1');
    expect(rows[1].input?.tradeMode).toBeUndefined();
    expect(catalogAdditionsFor(rows, options)).toEqual({ goodsCategories: [], serviceCategories: [], usageModes: [] });
  });

  it('báo lỗi theo dòng: thiếu mã, mã lặp, giá âm, ngày sai; mã vạch hỏng bị bỏ', () => {
    const sheet = sheetFromRecords([
      { Mã: 'A', Tên: 'x', 'Đơn vị': 'Cái', 'Giá bán': '-5' },
      { Mã: '', Tên: 'x', 'Đơn vị': 'Cái' },
      { Mã: 'C', Tên: 'y', 'Đơn vị': 'Cái', 'Ngày tạo': '31/13/2020' },
      { Mã: 'B', Tên: 'z', 'Đơn vị': 'Cái', Barcode: '·ên·ến' },
      { Mã: 'b', Tên: 'z', 'Đơn vị': 'Cái' },
    ]);
    const rows = buildImportRows(sheet, baseOptions(sheet));
    expect(rows[0].error).toBe('Giá bán phải là số không âm.');
    expect(rows[1].error).toBe('Thiếu mã.');
    expect(rows[2].error).toMatch(/Ngày tạo/);
    expect(rows[3].input?.barcode).toBeUndefined();
    expect(rows[4].error).toBe('Mã B bị lặp trong tệp.');
  });
});

describe('Nhập hàng hóa: đọc số và ngày', () => {
  it('đọc số kiểu Việt và ô số của Excel', () => {
    expect(parseAmount(116400000)).toBe(116400000);
    expect(parseAmount('1.250.000')).toBe(1250000);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('45000')).toBe(45000);
    expect(parseAmount('abc')).toBeNaN();
  });

  it('đọc ngày dd/mm/yyyy và yyyy-mm-dd; ngày sai là undefined', () => {
    expect(parseImportDate('13/09/2022')).toBe('2022-09-13T00:00:00+07:00');
    expect(parseImportDate('2022-09-13')).toBe('2022-09-13T00:00:00+07:00');
    expect(parseImportDate('31/13/2022')).toBeUndefined();
    expect(parseImportDate('')).toBeUndefined();
  });
});

describe('Nhập hàng hóa: tệp mẫu', () => {
  it('nhập lại đúng tệp mẫu thì tự ghép đủ cột và mọi dòng hợp lệ, không phải hỏi giá trị lạ', () => {
    const rows = tradeTemplateRows(catalog);
    const sheet = sheetFromRecords(rows);
    const options = baseOptions(sheet);
    expect(Object.keys(options.mapping)).toHaveLength(14);
    const built = buildImportRows(sheet, options);
    expect(built.map((row) => row.error)).toEqual([undefined, undefined]);
    expect(built[0].input).toMatchObject({ kind: 'STOCK', tradeCategory: 'HH_1', manufacturer: 'Cadivi', purchasePrice: 32000, isActive: true });
    expect(built[1].input).toMatchObject({ kind: 'SERVICE', tradeCategory: 'DV_1', isActive: false, createdBy: '' });
    expect(collectImportValues(sheet, options).categories).toEqual([]);
  });

  it('có giải thích cho từng cột của tệp mẫu', () => {
    expect(tradeTemplateGuide().map((line) => line['Cột'])).toEqual(Object.keys(tradeTemplateRows(catalog)[0]));
  });
});

describe('Nhập hàng hóa: độ dài cột', () => {
  it('tên quá 255 ký tự bị báo đúng dòng ở bước xem trước, không đợi Kho từ chối', () => {
    const sheet = sheetFromRecords([
      { Mã: 'A', Tên: 'x'.repeat(261), 'Đơn vị': 'Gói' },
      { Mã: 'B', Tên: 'x'.repeat(255), 'Đơn vị': 'Gói' },
    ]);
    const rows = buildImportRows(sheet, baseOptions(sheet));
    expect(rows[0].error).toBe('Tên tối đa 255 ký tự (hiện 261).');
    expect(rows[1].error).toBeUndefined();
  });
});

describe('Nhập hàng hóa: xuất các dòng chưa nhập được', () => {
  const sheet = () =>
    sheetFromRecords([
      { Mã: 'A', Tên: 'Đã tạo', 'Đơn vị': 'Cái', 'Ghi chú': 'a' },
      { Mã: 'B', Tên: 'Trùng với hàng đang có', 'Đơn vị': 'Cái', 'Ghi chú': 'b' },
      { Mã: 'C', Tên: 'x'.repeat(300), 'Đơn vị': 'Cái', 'Ghi chú': 'c' },
      { Mã: '', Tên: 'Thiếu mã', 'Đơn vị': 'Cái', 'Ghi chú': 'd' },
      { Mã: 'A', Tên: 'Lặp trong tệp', 'Đơn vị': 'Cái', 'Ghi chú': 'e' },
      { Mã: 'F', Tên: 'Kho từ chối', 'Đơn vị': 'Cái', 'Ghi chú': 'f' },
    ]);

  it('chỉ lấy dòng lỗi dữ liệu và dòng Kho từ chối; bỏ dòng trùng mã, dòng lặp và dòng đã tạo', () => {
    const data = sheet();
    const built = buildImportRows(data, baseOptions(data));
    // Dòng 3 (B) bị Kho báo trùng mã; dòng 7 (F) bị Kho từ chối vì lỗi khác.
    const lines = unimportedLines(built, [
      { line: 3, duplicate: true },
      { line: 7 },
    ]);
    expect(lines).toEqual([4, 5, 7]);
  });

  it('giữ nguyên tiêu đề, thứ tự cột và giá trị từng ô của tệp gốc', () => {
    const data = sheet();
    const records = unimportedRecords(data, [5, 7]);
    expect(records).toEqual([
      { Mã: '', Tên: 'Thiếu mã', 'Đơn vị': 'Cái', 'Ghi chú': 'd' },
      { Mã: 'F', Tên: 'Kho từ chối', 'Đơn vị': 'Cái', 'Ghi chú': 'f' },
    ]);
    expect(Object.keys(records[0])).toEqual(data.headers);
  });

  it('lỗi không gắn với dòng nào (chưa nhập được gì) thì mọi dòng hợp lệ đều còn lại', () => {
    const data = sheet();
    const built = buildImportRows(data, baseOptions(data));
    expect(unimportedLines(built, [{ line: 0 }])).toEqual([2, 3, 4, 5, 7]);
  });
});
