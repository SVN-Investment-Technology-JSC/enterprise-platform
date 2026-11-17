import {
  QUOTE_LAYOUT_BLOCK_TYPES,
  QUOTE_LAYOUT_LIMITS,
  defaultQuoteLayout,
  validateQuoteLayout,
  type QuoteLayout,
  type QuoteLayoutCompanyHeaderBlock,
  type QuoteLayoutLineTableBlock,
  type QuoteLayoutTitleBlock,
} from '@enterprise-platform/contracts-crm';
import {
  LAYOUT_HISTORY_LIMIT,
  LAYOUT_IMPORT_NOT_JSON_MESSAGE,
  addBlock,
  blockIndexFromPath,
  canRedo,
  canUndo,
  commitLayout,
  createBlock,
  createLayoutHistory,
  duplicateBlock,
  endTyping,
  equalizeColumnWidths,
  errorsByBlock,
  layoutJsonFileName,
  lineTableError,
  moveBlock,
  moveBlockBy,
  moveBlockToGap,
  parseLayoutJson,
  redoLayout,
  removeBlock,
  safeFileName,
  undoLayout,
  uniqueBlockId,
  updateBlock,
  updatePage,
  visibleWidthTotal,
} from './layout-designer.model';

const ids = (layout: QuoteLayout) => layout.blocks.map((block) => block.id);
const base = () => defaultQuoteLayout();

describe('thao tác khối', () => {
  it('thêm cuối khi chưa chọn, thêm ngay sau khối đang chọn', () => {
    const layout = base();
    const divider = createBlock('divider', ids(layout));
    expect(ids(addBlock(layout, divider, null)).at(-1)).toBe(divider.id);
    const afterSecond = addBlock(layout, divider, layout.blocks[1].id);
    expect(ids(afterSecond)[2]).toBe(divider.id);
    expect(afterSecond.blocks).toHaveLength(layout.blocks.length + 1);
    expect(layout.blocks).toHaveLength(defaultQuoteLayout().blocks.length);
  });

  it('khối mới mọi loại có id hợp lệ, không trùng; bố cục thêm khối (trừ ảnh chưa tải) vẫn hợp lệ', () => {
    let layout = base();
    for (const type of QUOTE_LAYOUT_BLOCK_TYPES) {
      const block = createBlock(type, ids(layout));
      expect(block.type).toBe(type);
      expect(block.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(ids(layout)).not.toContain(block.id);
      layout = addBlock(layout, block);
    }
    const result = validateQuoteLayout(layout);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.every((error) => error.code === 'LAYOUT_IMAGE_INVALID')).toBe(true);
  });

  it('TC-DS-06: xoá khối; xoá hết thì bố cục rỗng và kiểm báo LAYOUT_EMPTY', () => {
    let layout = base();
    layout = removeBlock(layout, 'title');
    expect(ids(layout)).not.toContain('title');
    for (const id of ids(layout)) layout = removeBlock(layout, id);
    expect(layout.blocks).toHaveLength(0);
    const result = validateQuoteLayout(layout);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.code)).toContain('LAYOUT_EMPTY');
    expect(removeBlock(layout, 'khong-co')).toBe(layout);
  });

  it('di chuyển lên, xuống, tới vị trí; ở đầu thì lên không đổi', () => {
    const layout = base();
    expect(moveBlockBy(layout, 'company', -1)).toBe(layout);
    expect(ids(moveBlockBy(layout, 'company', 1)).slice(0, 2)).toEqual(['company-divider', 'company']);
    expect(ids(moveBlock(layout, 'signature', 0))[0]).toBe('signature');
  });

  it('TC-DS-04: thả vào khe; thả ngay trước hoặc sau chính nó thì không đổi', () => {
    const layout = base();
    const last = ids(layout).at(-1) as string;
    expect(ids(moveBlockToGap(layout, last, 0))[0]).toBe(last);
    expect(ids(moveBlockToGap(layout, 'company', layout.blocks.length)).at(-1)).toBe('company');
    expect(moveBlockToGap(layout, 'title', 2)).toBe(layout);
    expect(moveBlockToGap(layout, 'title', 3)).toBe(layout);
  });

  it('TC-DS-05: nhân đôi nằm ngay sau, id mới, nội dung giống, sửa bản sao không ảnh hưởng bản gốc', () => {
    const layout = base();
    const result = duplicateBlock(layout, 'lines');
    expect(result.id).toBe('lines-2');
    const index = ids(result.layout).indexOf('lines');
    expect(ids(result.layout)[index + 1]).toBe('lines-2');
    const original = result.layout.blocks[index] as QuoteLayoutLineTableBlock;
    const copy = result.layout.blocks[index + 1] as QuoteLayoutLineTableBlock;
    expect({ ...copy, id: 'lines' }).toEqual(original);
    expect(copy.columns).not.toBe(original.columns);
    const edited = updateBlock<QuoteLayoutLineTableBlock>(result.layout, 'lines-2', {
      columns: copy.columns.map((column) => ({ ...column, label: 'Đổi' })),
    });
    expect((edited.blocks[index] as QuoteLayoutLineTableBlock).columns[0].label).toBe('TT');
    expect(duplicateBlock(result.layout, 'lines').id).toBe('lines-3');
  });

  it('id sinh ra luôn đúng mẫu và không quá 40 ký tự', () => {
    const long = 'a'.repeat(40);
    expect(uniqueBlockId(long, [long])).toHaveLength(QUOTE_LAYOUT_LIMITS.maxIdLength);
    expect(uniqueBlockId(long, [long])).toMatch(/^a+-2$/);
    expect(uniqueBlockId('Đầu trang Công ty!', [])).toBe('dau-trang-cong-ty');
    expect(uniqueBlockId('', [])).toBe('khoi');
  });

  it('sửa thuộc tính không đổi id, type; undefined bỏ trường tuỳ chọn; sửa trang giữ khối', () => {
    const layout = base();
    const withLogo = updateBlock<QuoteLayoutCompanyHeaderBlock>(layout, 'company', { name: 'Công ty ABC', logo: 'data:image/png;base64,AAAA' });
    const block = withLogo.blocks[0] as QuoteLayoutCompanyHeaderBlock;
    expect(block).toMatchObject({ id: 'company', type: 'companyHeader', name: 'Công ty ABC' });
    const noLogo = updateBlock<QuoteLayoutCompanyHeaderBlock>(withLogo, 'company', { logo: undefined });
    expect('logo' in noLogo.blocks[0]).toBe(false);
    const page = updatePage(layout, { paper: 'A3', orientation: 'landscape', fontFamily: 'Arial', fontSizePt: 12, marginsMm: { top: 10, right: 10, bottom: 10, left: 30 } });
    expect(page).toMatchObject({ paper: 'A3', orientation: 'landscape', fontFamily: 'Arial', version: 1 });
    expect(page.blocks).toBe(layout.blocks);
  });
});

describe('lịch sử hoàn tác', () => {
  it('TC-DS-07: thêm, sửa, xoá, di chuyển; hoàn tác 4 lần, làm lại 2 lần; sửa mới thì xoá nhánh làm lại', () => {
    const start = base();
    let history = createLayoutHistory(start);
    const states: QuoteLayout[] = [start];
    const step = (next: QuoteLayout) => {
      history = commitLayout(history, next);
      states.push(next);
    };
    step(addBlock(history.present, createBlock('text', ids(history.present))));
    step(updateBlock<QuoteLayoutTitleBlock>(history.present, 'title', { text: 'BẢNG BÁO GIÁ' }));
    step(removeBlock(history.present, 'terms'));
    step(moveBlockBy(history.present, 'company', 1));
    for (let index = 3; index >= 0; index -= 1) {
      history = undoLayout(history);
      expect(history.present).toBe(states[index]);
    }
    expect(canUndo(history)).toBe(false);
    history = redoLayout(redoLayout(history));
    expect(history.present).toBe(states[2]);
    expect(canRedo(history)).toBe(true);
    history = commitLayout(history, updatePage(history.present, { fontSizePt: 13 }));
    expect(canRedo(history)).toBe(false);
    expect(redoLayout(history)).toBe(history);
  });

  it('TC-DS-08: 101 thao tác thì hoàn tác được đúng 100 bước, không lỗi', () => {
    let history = createLayoutHistory(base());
    for (let index = 0; index < 101; index += 1) history = commitLayout(history, updatePage(history.present, { fontSizePt: 9 + (index % 7) }));
    expect(history.past).toHaveLength(LAYOUT_HISTORY_LIMIT);
    let undone = 0;
    while (canUndo(history)) {
      history = undoLayout(history);
      undone += 1;
    }
    expect(undone).toBe(100);
    expect(undoLayout(history)).toBe(history);
  });

  it('TC-DS-09: gõ "Công ty ABC" từng ký tự trong cùng một ô, hoàn tác 1 lần về giá trị trước khi gõ', () => {
    const start = base();
    let history = createLayoutHistory(start);
    const text = 'Công ty ABC';
    for (let length = 1; length <= text.length; length += 1) {
      history = commitLayout(history, updateBlock<QuoteLayoutCompanyHeaderBlock>(history.present, 'company', { name: text.slice(0, length) }), 'company:name');
    }
    expect((history.present.blocks[0] as QuoteLayoutCompanyHeaderBlock).name).toBe(text);
    expect(history.past).toHaveLength(1);
    history = undoLayout(history);
    expect(history.present).toBe(start);
  });

  it('gõ ô khác, rời ô rồi gõ lại, hoặc thao tác khác thì là bước mới', () => {
    let history = createLayoutHistory(base());
    history = commitLayout(history, updateBlock<QuoteLayoutCompanyHeaderBlock>(history.present, 'company', { name: 'A' }), 'company:name');
    history = commitLayout(history, updateBlock<QuoteLayoutTitleBlock>(history.present, 'title', { text: 'B' }), 'title:text');
    expect(history.past).toHaveLength(2);
    history = endTyping(history);
    history = commitLayout(history, updateBlock<QuoteLayoutTitleBlock>(history.present, 'title', { text: 'BC' }), 'title:text');
    expect(history.past).toHaveLength(3);
    history = commitLayout(history, updatePage(history.present, { paper: 'A3' }));
    history = commitLayout(history, updateBlock<QuoteLayoutTitleBlock>(history.present, 'title', { text: 'BCD' }), 'title:text');
    expect(history.past).toHaveLength(5);
  });

  it('bố cục không đổi thì không thêm bước', () => {
    const history = createLayoutHistory(base());
    expect(commitLayout(history, history.present)).toBe(history);
  });
});

describe('bảng dòng hàng', () => {
  const columns = (base().blocks.find((block) => block.type === 'lineTable') as QuoteLayoutLineTableBlock).columns;

  it('TC-DS-13: tổng 90 báo lỗi; chia đều đưa tổng về 100; ẩn hết cột báo lỗi', () => {
    expect(lineTableError(columns)).toBeNull();
    const ninety = columns.map((column) => (column.key === 'materialName' ? { ...column, widthPct: column.widthPct - 10 } : column));
    expect(visibleWidthTotal(ninety)).toBe(90);
    expect(lineTableError(ninety)).toBe('Tổng độ rộng các cột đang hiện phải là 100% (đang là 90%).');
    const even = equalizeColumnWidths(ninety);
    expect(visibleWidthTotal(even)).toBe(100);
    expect(lineTableError(even)).toBeNull();
    expect(even.filter((column) => !column.visible)).toEqual(ninety.filter((column) => !column.visible));
    expect(lineTableError(columns.map((column) => ({ ...column, visible: false })))).toBe('Bảng phải có ít nhất một cột hiện.');
  });

  it('cột ẩn không tính vào tổng; 99 và 101 vẫn hợp lệ', () => {
    const two = [
      { key: 'index', label: 'TT', widthPct: 49, align: 'left', visible: true },
      { key: 'unit', label: 'ĐVT', widthPct: 50, align: 'left', visible: true },
      { key: 'quantity', label: 'SL', widthPct: 70, align: 'left', visible: false },
    ] as const;
    expect(lineTableError(two)).toBeNull();
    expect(lineTableError([{ ...two[0], widthPct: 51 }, two[1]])).toBeNull();
  });
});

describe('lỗi và file', () => {
  it('đường dẫn lỗi trỏ về khối', () => {
    expect(blockIndexFromPath('blocks[3].heightMm')).toBe(3);
    expect(blockIndexFromPath('blocks[0]')).toBe(0);
    expect(blockIndexFromPath('marginsMm.top')).toBeNull();
    const layout = base();
    const map = errorsByBlock(layout, [
      { path: 'blocks[2].fontSizePt', code: 'LAYOUT_INVALID', message: 'x' },
      { path: 'blocks[99]', code: 'LAYOUT_INVALID', message: 'y' },
      { path: '', code: 'LAYOUT_EMPTY', message: 'z' },
    ]);
    expect([...map.keys()]).toEqual(['title']);
  });

  it('TC-DS-23: tên file xuất thay ký tự không hợp lệ, giữ chữ có dấu', () => {
    expect(layoutJsonFileName('Báo giá thiết bị')).toBe('Mau_Báo giá thiết bị.layout.json');
    expect(layoutJsonFileName('Mẫu A/B: "VIP"?')).toBe('Mau_Mẫu A_B_ _VIP_.layout.json');
    expect(safeFileName('   ')).toBe('Mau');
    expect(safeFileName('a\u0001b')).toBe('a_b');
  });

  it('TC-DS-25, TC-DS-26: nhập file không phải JSON, JSON rỗng, cắt dở, sai cấu trúc', () => {
    for (const text of ['', 'PK\u0003\u0004', '{"version":1,"blocks":[', 'null', '[]', '"x"']) {
      const result = parseLayoutJson(text);
      expect(result).toMatchObject({ ok: false, message: LAYOUT_IMPORT_NOT_JSON_MESSAGE, errors: [] });
    }
    const version2 = parseLayoutJson(JSON.stringify({ ...base(), version: 2 }));
    expect(version2.ok).toBe(false);
    if (!version2.ok) expect(version2.errors.map((error) => error.code)).toContain('LAYOUT_VERSION_UNSUPPORTED');
    const noBlocks: Record<string, unknown> = { ...base() };
    delete noBlocks.blocks;
    expect(parseLayoutJson(JSON.stringify(noBlocks)).ok).toBe(false);
    const unknownVariable = updateBlock<QuoteLayoutTitleBlock>(base(), 'title', { text: '{{khong.co}}' });
    const unknown = parseLayoutJson(JSON.stringify(unknownVariable));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.map((error) => error.code)).toContain('LAYOUT_VARIABLE_UNKNOWN');
  });

  it('TC-DS-24: JSON hợp lệ (cả biến custom.<id> của tenant khác) thì nhập được', () => {
    const layout = updateBlock<QuoteLayoutTitleBlock>(base(), 'title', { subtitle: 'Thanh toán: {{custom.3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f}}' });
    const result = parseLayoutJson(JSON.stringify(layout));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.layout.blocks).toHaveLength(layout.blocks.length);
  });
});
