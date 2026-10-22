import { createDocument, createPresetDocuments, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import {
  backupFileName,
  describeImport,
  documentFromSvg,
  nameFromFile,
  planImport,
  readImportFiles,
  serializeLibrary,
  type ImportReport,
} from './library-io';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="12" cy="12" r="9" />
  <path d="M8 12h8" />
</svg>`;

const withShape = (id: string, name: string): IconDocument =>
  createDocument({ id, name, shapes: [createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 8, ry: 8 })] });

const emptyReport: ImportReport = { docs: [], skipped: 0, failures: [], warnings: [] };

describe('nameFromFile', () => {
  it('bỏ phần mở rộng, đổi gạch nối và gạch dưới thành khoảng trắng', () => {
    expect(nameFromFile('cloud-upload_2.svg')).toBe('cloud upload 2');
    expect(nameFromFile('C:\\icons\\kho hàng.SVG')).toBe('kho hàng');
    expect(nameFromFile('thu-muc/logo.svg')).toBe('logo');
  });

  it('tên rỗng thì có tên dự phòng, tên dài bị cắt 80 ký tự', () => {
    expect(nameFromFile('.svg')).toBe('Icon nhập');
    expect(nameFromFile(`${'a'.repeat(120)}.svg`)).toHaveLength(80);
  });
});

describe('documentFromSvg', () => {
  it('tạo icon nháp tuỳ biến, đặt tên theo tệp, mỗi phần tử một lớp', () => {
    const { doc } = documentFromSvg(SVG, 'dong-ho.svg');
    expect(doc.name).toBe('dong ho');
    expect(doc.status).toBe('draft');
    expect(doc.category).toBe('custom');
    expect(doc.size).toBe(24);
    expect(doc.shapes).toHaveLength(2);
    expect(doc.shapes[0].geometry.type).toBe('ellipse');
  });

  it('ném lỗi khi SVG không có hình nào', () => {
    expect(() => documentFromSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'rong.svg')).toThrow();
  });
});

describe('readImportFiles', () => {
  it('đọc nhiều tệp SVG một lúc', () => {
    const report = readImportFiles([
      { name: 'a.svg', text: SVG },
      { name: 'b.svg', text: SVG },
    ]);
    expect(report.docs.map((doc) => doc.name)).toEqual(['a', 'b']);
    expect(report.docs[0].id).not.toBe(report.docs[1].id);
    expect(report.failures).toEqual([]);
  });

  it('đọc tệp JSON dạng mảng, dạng { icons } và một icon đơn lẻ', () => {
    const one = withShape('json-1', 'Một');
    const two = withShape('json-2', 'Hai');
    const report = readImportFiles([
      { name: 'mang.json', text: JSON.stringify([one, two]) },
      { name: 'boc.json', text: JSON.stringify({ icons: [withShape('json-3', 'Ba')] }) },
      { name: 'le.json', text: JSON.stringify(withShape('json-4', 'Bốn')) },
    ]);
    expect(report.docs.map((doc) => doc.id)).toEqual(['json-1', 'json-2', 'json-3', 'json-4']);
    expect(report.failures).toEqual([]);
  });

  it('nhận tệp sao lưu kiểu cũ (một khung và một nét chính)', () => {
    const legacy = {
      id: 'cu-1',
      name: 'Icon cũ',
      category: 'custom',
      description: '',
      viewBoxSize: 24,
      containerShape: 'circle',
      containerFill: 'none',
      strokeWidth: 1.75,
      colorTone: 'sapphire',
      cornerRadius: 4,
      accentDot: false,
      glyphPath: 'M 6 6 L 18 18',
      isCustom: true,
    };
    const report = readImportFiles([{ name: 'cu.json', text: JSON.stringify([legacy]) }]);
    expect(report.docs).toHaveLength(1);
    expect(report.docs[0].shapes.length).toBeGreaterThanOrEqual(2);
  });

  it('tệp lỗi không làm hỏng tệp khác và được ghi lại kèm lý do', () => {
    const report = readImportFiles([
      { name: 'tot.svg', text: SVG },
      { name: 'hong.json', text: '{ không phải json' },
      { name: 'la.txt', text: 'xin chào' },
      { name: 'rong.json', text: '[]' },
      { name: 'sai.json', text: '"chuoi"' },
    ]);
    expect(report.docs).toHaveLength(1);
    expect(report.failures.map((failure) => failure.file)).toEqual(['hong.json', 'la.txt', 'rong.json', 'sai.json']);
    expect(report.failures[0].reason).toMatch(/JSON/);
    expect(report.failures[1].reason).toMatch(/svg|json/i);
  });

  it('đoán loại tệp theo nội dung khi tên không có đuôi', () => {
    const report = readImportFiles([
      { name: 'khong-duoi', text: SVG },
      { name: 'khong-duoi-2', text: JSON.stringify([withShape('doan-1', 'Đoán')]) },
    ]);
    expect(report.docs.map((doc) => doc.name)).toEqual(['khong duoi', 'Đoán']);
  });

  it('đếm mục JSON sai định dạng bị bỏ qua', () => {
    const report = readImportFiles([{ name: 'lan.json', text: JSON.stringify([withShape('ok-1', 'Ổn'), { id: '!!', name: 'Sai', shapes: [] }, 42]) }]);
    expect(report.docs).toHaveLength(1);
    expect(report.skipped).toBe(2);
  });
});

describe('planImport', () => {
  const existing = [withShape('keep-1', 'Giữ')];

  it('bỏ icon giống hệt icon đã có, kể cả khi mã lớp hình khác nhau', () => {
    const rebuilt = createPresetDocuments(); // mỗi lần dựng sinh mã lớp mới
    const library = createPresetDocuments();
    const plan = planImport(library, rebuilt);
    expect(plan.fresh).toHaveLength(0);
    expect(plan.duplicates).toBe(rebuilt.length);
  });

  it('cùng mã nhưng khác nội dung thì vẫn thêm (store sẽ cấp mã mới)', () => {
    const changed = { ...existing[0], name: 'Đã sửa tên' };
    const plan = planImport(existing, [changed, withShape('new-1', 'Mới')]);
    expect(plan.fresh.map((doc) => doc.id)).toEqual(['keep-1', 'new-1']);
    expect(plan.duplicates).toBe(0);
  });

  it('chỉ thêm tới khi đầy thư viện, phần dư được đếm', () => {
    const plan = planImport(existing, [withShape('n-1', '1'), withShape('n-2', '2'), withShape('n-3', '3')], 3);
    expect(plan.fresh.map((doc) => doc.id)).toEqual(['n-1', 'n-2']);
    expect(plan.overflow).toBe(1);
  });

  it('thư viện đã đầy thì không thêm gì', () => {
    const plan = planImport(existing, [withShape('n-1', '1')], 1);
    expect(plan.fresh).toEqual([]);
    expect(plan.overflow).toBe(1);
  });
});

describe('describeImport', () => {
  const plan = (fresh: IconDocument[], duplicates = 0, overflow = 0) => ({ fresh, duplicates, overflow });
  const docsOf = (count: number) => Array.from({ length: count }, (_, index) => withShape(`d-${index}`, `D${index}`));

  it('nhập sạch thì báo xanh, ngắn gọn', () => {
    const fresh = docsOf(3);
    const notice = describeImport({ ...emptyReport, docs: fresh }, plan(fresh));
    expect(notice).toEqual({ tone: 'ok', text: 'Đã nhập 3 icon.', details: [] });
  });

  it('có icon bị bỏ hoặc tệp lỗi thì báo vàng và liệt kê chi tiết', () => {
    const fresh = docsOf(2);
    const notice = describeImport(
      { docs: fresh, skipped: 1, failures: [{ file: 'hong.json', reason: 'không phải JSON hợp lệ' }], warnings: ['SVG dùng màu chuyển sắc'] },
      plan(fresh, 1),
    );
    expect(notice.tone).toBe('warn');
    expect(notice.text).toBe('Đã nhập 2 icon, 1 icon đã có sẵn, bỏ qua 1 mục lỗi, 1 tệp lỗi.');
    expect(notice.details).toEqual(['hong.json: không phải JSON hợp lệ', 'SVG dùng màu chuyển sắc']);
  });

  it('không nhập được gì vì tệp lỗi thì báo đỏ', () => {
    const notice = describeImport({ ...emptyReport, failures: [{ file: 'x.txt', reason: 'chỉ nhận tệp .svg hoặc .json' }] }, plan([]));
    expect(notice.tone).toBe('error');
    expect(notice.text).toBe('1 tệp lỗi.');
  });

  it('toàn icon đã có sẵn thì không phải lỗi', () => {
    const existing = docsOf(2);
    const notice = describeImport({ ...emptyReport, docs: existing }, plan([], 2));
    expect(notice.tone).toBe('ok');
    expect(notice.text).toBe('2 icon đã có sẵn.');
  });

  it('báo icon vượt giới hạn và rút gọn danh sách chi tiết dài', () => {
    const fresh = docsOf(1);
    const failures = Array.from({ length: 7 }, (_, index) => ({ file: `f${index}.json`, reason: 'lỗi' }));
    const notice = describeImport({ ...emptyReport, docs: fresh, failures }, plan(fresh, 0, 4));
    expect(notice.text).toContain('4 icon vượt giới hạn');
    expect(notice.details).toHaveLength(5);
    expect(notice.details[4]).toBe('và 3 mục khác');
  });

  it('không có gì để nhập thì báo lỗi', () => {
    expect(describeImport(emptyReport, plan([])).tone).toBe('error');
  });
});

describe('sao lưu', () => {
  it('serializeLibrary cho ra mảng JSON đọc lại được', () => {
    const docs = [withShape('s-1', 'Một'), withShape('s-2', 'Hai')];
    const parsed = JSON.parse(serializeLibrary(docs)) as IconDocument[];
    expect(parsed.map((doc) => doc.id)).toEqual(['s-1', 's-2']);
  });

  it('backupFileName có ngày dạng yyyymmdd', () => {
    expect(backupFileName(new Date(2026, 9, 5))).toBe('svndts-brand-icons-20261005.json');
  });

  it('sao lưu rồi nhập lại chính thư viện thì không sinh bản trùng', () => {
    const library = createPresetDocuments();
    const report = readImportFiles([{ name: backupFileName(), text: serializeLibrary(library) }]);
    const plan = planImport(library, report.docs);
    expect(plan.fresh).toHaveLength(0);
    expect(plan.duplicates).toBe(library.length);
  });
});
