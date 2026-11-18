import {
  amountInWordsVi,
  bindQuoteText,
  decodeBase64,
  defaultQuoteLayout,
  formatQuoteDate,
  formatQuoteMoney,
  formatQuoteNumber,
  formatQuotePercent,
  QUOTE_LAYOUT_LIMITS,
  quoteLayoutTextLength,
  splitQuoteText,
  validateQuoteLayout,
  type QuoteLayoutBlock,
  type QuoteLayoutValidation,
} from './quote-layout.js';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const KB = 1024;
const CUSTOM_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

function dataUrl(mime: string, header: readonly number[], size: number): string {
  const bytes = Buffer.alloc(size, 0x41);
  Buffer.from(header).copy(bytes);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
const png = (size: number) => dataUrl('image/png', PNG_HEADER, size);
const jpeg = (size: number) => dataUrl('image/jpeg', JPEG_HEADER, size);

/** Bố cục tối thiểu hợp lệ quanh các khối cho trước. */
function layoutWith(blocks: readonly unknown[], page: Record<string, unknown> = {}): Record<string, unknown> {
  const base = defaultQuoteLayout();
  return { ...base, blocks, ...page };
}
const spacer = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'spacer', heightMm: 5, ...extra });
const textBlock = (text: string, id = 'text') => ({ id, type: 'text', align: 'left', runs: [{ text }] });

function errorsOf(result: QuoteLayoutValidation) {
  if (result.ok) throw new Error('Bố cục được nhận nhưng mong đợi bị từ chối.');
  return result.errors;
}
function codesOf(input: unknown): string[] {
  const result = validateQuoteLayout(input);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe('TC-TL-01: bố cục mặc định', () => {
  it('hợp lệ, đủ các khối theo BG.pdf, id không trùng', () => {
    const layout = defaultQuoteLayout();
    const result = validateQuoteLayout(layout);
    expect(result).toEqual({ ok: true, layout });
    const types = layout.blocks.map((block) => block.type);
    expect(types).toEqual(expect.arrayContaining(['companyHeader', 'title', 'fieldGrid', 'lineTable', 'totals', 'terms', 'signature']));
    expect(layout.blocks.find((block) => block.type === 'title')).toMatchObject({ text: 'BÁO GIÁ' });
    const ids = layout.blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Gọi lại cho bản mới, sửa bản này không ảnh hưởng bản sau.
    expect(defaultQuoteLayout()).not.toBe(layout);
  });
});

describe('TC-TL-02: thay biến', () => {
  const values = { 'quote.code': 'BG2600001', 'customer.name': 'Công ty A', 'quote.note': '' };

  it('biến có giá trị thì thay; chuỗi không có biến giữ nguyên', () => {
    expect(bindQuoteText('Số: {{quote.code}}', values)).toBe('Số: BG2600001');
    expect(bindQuoteText('Không có biến', values)).toBe('Không có biến');
    expect(bindQuoteText('', values)).toBe('');
  });

  it('biến rỗng: chế độ xem là chuỗi rỗng, chế độ thiết kế giữ {{…}}', () => {
    expect(bindQuoteText('Ghi chú: {{quote.note}}.', values, 'view')).toBe('Ghi chú: .');
    expect(bindQuoteText('Ghi chú: {{quote.note}}.', values, 'design')).toBe('Ghi chú: {{quote.note}}.');
    expect(bindQuoteText('{{customer.phone}}', values, 'view')).toBe('');
    expect(bindQuoteText('{{customer.phone}}', values, 'design')).toBe('{{customer.phone}}');
  });

  it('biến lạ, có khoảng trắng, thiếu đóng, ngoặc thừa: giữ nguyên văn, không lỗi', () => {
    for (const mode of ['view', 'design'] as const) {
      expect(bindQuoteText('{{customer.secret}}', values, mode)).toBe('{{customer.secret}}');
      expect(bindQuoteText('{{ quote.code }}', values, mode)).toBe('{{ quote.code }}');
      expect(bindQuoteText('{{{quote.code}}}', values, mode)).toBe('{{{quote.code}}}');
      expect(bindQuoteText('Số {{quote.code', values, mode)).toBe('Số {{quote.code');
    }
  });

  it('hai biến liền nhau; giá trị chứa ngoặc nhọn không bị thay lần nữa', () => {
    expect(bindQuoteText('{{quote.code}}{{customer.name}}', values)).toBe('BG2600001Công ty A');
    expect(bindQuoteText('{{customer.name}}', { 'customer.name': '{{quote.code}} <b>' })).toBe('{{quote.code}} <b>');
  });

  it('custom.<uuid> là biến hợp lệ; tách đoạn cho chip thiết kế', () => {
    expect(bindQuoteText(`TT: {{custom.${CUSTOM_ID}}}`, { [`custom.${CUSTOM_ID}`]: '30 ngày' })).toBe('TT: 30 ngày');
    expect(splitQuoteText('A {{quote.code}} {{x.y}}')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'variable', name: 'quote.code', raw: '{{quote.code}}' },
      { kind: 'text', text: ' {{x.y}}' },
    ]);
  });
});

describe('TC-TL-03: số tiền bằng chữ', () => {
  it.each([
    [0, 'Không đồng'],
    [5, 'Năm đồng'],
    [10, 'Mười đồng'],
    [15, 'Mười lăm đồng'],
    [21, 'Hai mươi mốt đồng'],
    [24, 'Hai mươi tư đồng'],
    [25, 'Hai mươi lăm đồng'],
    [101, 'Một trăm linh một đồng'],
    [105, 'Một trăm linh năm đồng'],
    [1_000, 'Một nghìn đồng'],
    [1_005_000, 'Một triệu không trăm linh năm nghìn đồng'],
    [1_000_000_000, 'Một tỷ đồng'],
    [1_234_567_890, 'Một tỷ hai trăm ba mươi tư triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi đồng'],
    [
      999_999_999_999,
      'Chín trăm chín mươi chín tỷ chín trăm chín mươi chín triệu chín trăm chín mươi chín nghìn chín trăm chín mươi chín đồng',
    ],
    [1_500.6, 'Một nghìn năm trăm linh một đồng'],
    [-2_000, 'Âm hai nghìn đồng'],
    [2_000_000_005, 'Hai tỷ không trăm linh năm đồng'],
  ])('%p → %s', (amount, words) => {
    expect(amountInWordsVi(amount)).toBe(words);
  });

  it('giá trị không phải số: chuỗi rỗng', () => {
    expect(amountInWordsVi(Number.NaN)).toBe('');
    expect(amountInWordsVi(null)).toBe('');
  });
});

describe('định dạng', () => {
  it('tiền, số, phần trăm, ngày theo kiểu Việt Nam', () => {
    expect(formatQuoteMoney(1_234_567)).toBe('1.234.567');
    expect(formatQuoteMoney(1_234_567.6)).toBe('1.234.568');
    expect(formatQuoteMoney(-1_000)).toBe('-1.000');
    expect(formatQuoteMoney(0)).toBe('0');
    expect(formatQuoteNumber(1_234.5)).toBe('1.234,5');
    expect(formatQuotePercent(10)).toBe('10%');
    expect(formatQuotePercent(7.5)).toBe('7,5%');
    expect(formatQuoteDate('2026-11-06')).toBe('06/11/2026');
    expect(formatQuoteDate('2026-11-06T10:00:00.000Z')).toBe('06/11/2026');
    expect(formatQuoteDate(null)).toBe('');
  });
});

describe('TC-TL-04: phiên bản bố cục', () => {
  it('version 2 hoặc thiếu version: LAYOUT_VERSION_UNSUPPORTED, câu tiếng Việt', () => {
    const missing: Record<string, unknown> = { ...defaultQuoteLayout() };
    delete missing['version'];
    for (const input of [{ ...defaultQuoteLayout(), version: 2 }, missing]) {
      const [error] = errorsOf(validateQuoteLayout(input));
      expect(error).toMatchObject({ path: 'version', code: 'LAYOUT_VERSION_UNSUPPORTED' });
      expect(error.message).toContain('Phiên bản bố cục');
    }
    expect(codesOf(null)).toEqual(['LAYOUT_INVALID']);
    expect(codesOf('chuỗi')).toEqual(['LAYOUT_INVALID']);
  });
});

describe('TC-TL-05: số khối', () => {
  it('0 khối: LAYOUT_EMPTY; 1 và 100: hợp lệ; 101: LAYOUT_TOO_MANY_BLOCKS', () => {
    const blocks = (count: number) => Array.from({ length: count }, (_, index) => spacer(`s-${index}`));
    expect(codesOf(layoutWith([]))).toEqual(['LAYOUT_EMPTY']);
    expect(validateQuoteLayout(layoutWith(blocks(1))).ok).toBe(true);
    expect(validateQuoteLayout(layoutWith(blocks(100))).ok).toBe(true);
    expect(codesOf(layoutWith(blocks(101)))).toEqual(['LAYOUT_TOO_MANY_BLOCKS']);
  });
});

describe('TC-TL-06: kích thước bố cục', () => {
  /**
   * Bố cục gồm các khối chữ ASCII, hai khối cuối đệm cho đủ đúng `target` byte. Đầu vào đã ở dạng chuẩn
   * (không có trường lạ) nên kích thước JSON bằng kích thước bản chuẩn hoá.
   */
  function layoutOfSize(target: number): Record<string, unknown> {
    const blocks: unknown[] = [];
    const sizeOf = () => Buffer.byteLength(JSON.stringify(layoutWith(blocks)));
    // Khối nhiều đoạn (mỗi đoạn 4.000 ký tự) để không vượt giới hạn 100 khối.
    const bulk = (id: string) => ({ id, type: 'text', align: 'left', runs: Array.from({ length: 20 }, () => ({ text: 'x'.repeat(4_000) })) });
    while (sizeOf() + 90_000 < target) blocks.push(bulk(`b-${blocks.length}`));
    while (sizeOf() + 8_000 < target) blocks.push(textBlock('x'.repeat(4_000), `t-${blocks.length}`));
    // Hai khối đệm cuối, mỗi khối không quá 4.000 ký tự.
    for (let pad = 0; pad < 2; pad += 1) {
      const id = `t-${blocks.length}`;
      blocks.push(textBlock('', id));
      blocks[blocks.length - 1] = textBlock('x'.repeat(Math.min(4_000, target - sizeOf())), id);
    }
    expect(sizeOf()).toBe(target);
    return layoutWith(blocks);
  }

  it('dưới và đúng 1 MB hợp lệ; trên 1 MB: LAYOUT_TOO_LARGE', () => {
    const exact = layoutOfSize(QUOTE_LAYOUT_LIMITS.maxBytes);
    const exactResult = validateQuoteLayout(exact);
    expect(exactResult.ok).toBe(true);
    if (exactResult.ok) expect(Buffer.byteLength(JSON.stringify(exactResult.layout))).toBe(QUOTE_LAYOUT_LIMITS.maxBytes);
    expect(validateQuoteLayout(layoutOfSize(QUOTE_LAYOUT_LIMITS.maxBytes - 10)).ok).toBe(true);
    expect(codesOf(layoutOfSize(QUOTE_LAYOUT_LIMITS.maxBytes + 1))).toEqual(['LAYOUT_TOO_LARGE']);
  });
});

describe('TC-TL-07: ảnh', () => {
  const imageBlock = (src: unknown) => ({ id: 'logo', type: 'image', src, heightMm: 20, align: 'left' });
  const withImage = (src: unknown) => layoutWith([spacer('top'), imageBlock(src)]);

  it('PNG ≤ 300 KB và JPEG hợp lệ thì nhận', () => {
    expect(validateQuoteLayout(withImage(png(299 * KB))).ok).toBe(true);
    expect(validateQuoteLayout(withImage(png(300 * KB))).ok).toBe(true);
    expect(validateQuoteLayout(withImage(jpeg(50 * KB))).ok).toBe(true);
  });

  it.each([
    ['PNG 301 KB', png(301 * KB)],
    ['SVG', `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`],
    ['GIF', `data:image/gif;base64,${Buffer.from('GIF89a....').toString('base64')}`],
    ['URL ngoài', 'https://example.com/logo.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['base64 hỏng', 'data:image/png;base64,iVBORw0KGgo$$$=='],
    ['đuôi PNG nhưng nội dung là chữ', `data:image/png;base64,${Buffer.from('day la file van ban').toString('base64')}`],
    ['khai JPEG nhưng là PNG', `data:image/jpeg;base64,${png(1 * KB).split(',')[1]}`],
    ['chuỗi rỗng', ''],
    ['không phải chuỗi', 42],
  ])('%s: LAYOUT_IMAGE_INVALID nêu khối số mấy', (_name, src) => {
    const [error] = errorsOf(validateQuoteLayout(withImage(src)));
    expect(error).toMatchObject({ path: 'blocks[1].src', code: 'LAYOUT_IMAGE_INVALID' });
    expect(error.message).toContain('khối 2');
  });

  it('ảnh quá cỡ báo đúng câu "vượt 300 KB"; logo đầu trang cũng được kiểm', () => {
    expect(errorsOf(validateQuoteLayout(withImage(png(301 * KB))))[0].message).toBe('Ảnh ở khối 2 vượt 300 KB.');
    const header = { ...defaultQuoteLayout().blocks[0], logo: 'https://example.com/a.png' };
    expect(errorsOf(validateQuoteLayout(layoutWith([header])))[0]).toMatchObject({ path: 'blocks[0].logo', code: 'LAYOUT_IMAGE_INVALID' });
    expect(validateQuoteLayout(layoutWith([{ ...header, logo: png(10 * KB) }])).ok).toBe(true);
  });

  it('giải mã base64 thật: đệm sai chỗ, ký tự lạ, độ dài sai đều bị chặn', () => {
    expect(Buffer.from(decodeBase64(Buffer.from('xin chào').toString('base64')) as Uint8Array).toString()).toBe('xin chào');
    expect(decodeBase64('AB=C')).toBeNull();
    expect(decodeBase64('ABC')).toBeNull();
    expect(decodeBase64('AB C')).toBeNull();
    expect(decodeBase64('A===')).toBeNull();
  });
});

describe('TC-TL-08: chữ quá dài', () => {
  it('4.000 ký tự hợp lệ, 4.001 LAYOUT_TEXT_TOO_LONG; nhãn 200/201', () => {
    expect(validateQuoteLayout(layoutWith([textBlock('a'.repeat(4_000))])).ok).toBe(true);
    expect(codesOf(layoutWith([textBlock('a'.repeat(4_001))]))).toEqual(['LAYOUT_TEXT_TOO_LONG']);
    const grid = (label: string) => ({ id: 'grid', type: 'fieldGrid', columns: 1, labelWidthPct: 30, items: [{ label, value: '' }] });
    expect(validateQuoteLayout(layoutWith([grid('n'.repeat(200))])).ok).toBe(true);
    const [error] = errorsOf(validateQuoteLayout(layoutWith([grid('n'.repeat(201))])));
    expect(error).toMatchObject({ code: 'LAYOUT_TEXT_TOO_LONG', path: 'blocks[0].items[0].label' });
  });

  it('đếm theo ký tự, không theo byte; chữ Việt tổ hợp đếm như chữ dựng sẵn', () => {
    const composed = 'ế'.repeat(4_000); // 3 byte UTF-8 mỗi ký tự
    expect(validateQuoteLayout(layoutWith([textBlock(composed)])).ok).toBe(true);
    const decomposed = 'ế'.normalize('NFD').repeat(4_000); // e + dấu mũ + dấu sắc
    expect(quoteLayoutTextLength(decomposed)).toBe(4_000);
    expect(validateQuoteLayout(layoutWith([textBlock(decomposed)])).ok).toBe(true);
    expect(codesOf(layoutWith([textBlock(`${composed}ế`)]))).toEqual(['LAYOUT_TEXT_TOO_LONG']);
  });
});

describe('TC-TL-09: giá trị ngoài khoảng, enum sai', () => {
  it.each([
    ['paper', { paper: 'A5' }, 'paper'],
    ['orientation', { orientation: 'up' }, 'orientation'],
    ['fontSizePt 8', { fontSizePt: 8 }, 'fontSizePt'],
    ['fontSizePt 17', { fontSizePt: 17 }, 'fontSizePt'],
    ['fontSizePt chuỗi', { fontSizePt: '12' }, 'fontSizePt'],
    ['fontSizePt NaN', { fontSizePt: Number.NaN }, 'fontSizePt'],
    ['margin 4', { marginsMm: { top: 4, right: 10, bottom: 10, left: 10 } }, 'marginsMm.top'],
    ['margin 41', { marginsMm: { top: 41, right: 10, bottom: 10, left: 10 } }, 'marginsMm.top'],
    ['fontFamily null', { fontFamily: null }, 'fontFamily'],
  ])('%s: LAYOUT_INVALID ở %s', (_name, page, path) => {
    const errors = errorsOf(validateQuoteLayout(layoutWith([spacer('a')], page)));
    expect(errors).toEqual([expect.objectContaining({ code: 'LAYOUT_INVALID', path })]);
    expect(errors[0].message).toMatch(/[ạảãáàâăêôơưđ]/);
  });

  it('thuộc tính khối sai báo đúng đường dẫn khối', () => {
    const blocks = [spacer('a'), spacer('b'), spacer('c'), { id: 'img', type: 'image', src: png(KB), heightMm: -1, align: 'left' }];
    expect(errorsOf(validateQuoteLayout(layoutWith(blocks)))).toEqual([
      expect.objectContaining({ code: 'LAYOUT_INVALID', path: 'blocks[3].heightMm' }),
    ]);
    const justify = { id: 't', type: 'text', align: 'justify', runs: [] };
    expect(errorsOf(validateQuoteLayout(layoutWith([justify])))[0]).toMatchObject({ code: 'LAYOUT_INVALID', path: 'blocks[0].align' });
    const nullTitle = { id: 't', type: 'title', text: null, fontSizePt: 20, align: 'center', uppercase: true };
    expect(errorsOf(validateQuoteLayout(layoutWith([nullTitle])))[0]).toMatchObject({ code: 'LAYOUT_INVALID', path: 'blocks[0].text' });
    expect(codesOf(layoutWith([{ id: 'x', type: 'html' }]))).toEqual(['LAYOUT_INVALID']);
    expect(codesOf(layoutWith([{ id: 'x', type: 'spacer', heightMm: 5, marginTopMm: 51 }]))).toEqual(['LAYOUT_INVALID']);
  });

  it('không trả bản chuẩn hoá một phần khi có lỗi', () => {
    const result = validateQuoteLayout(layoutWith([spacer('a'), { id: 'b', type: 'spacer', heightMm: 0 }]));
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ path: 'blocks[1].heightMm' })] });
    expect('layout' in result).toBe(false);
  });
});

describe('TC-TL-10: id khối', () => {
  it('trùng: LAYOUT_DUPLICATE_ID; sai dạng: LAYOUT_INVALID', () => {
    expect(codesOf(layoutWith([spacer('a'), spacer('a')]))).toEqual(['LAYOUT_DUPLICATE_ID']);
    for (const id of ['co cach', 'ChuHoa', '', 'dấu', 'a'.repeat(41)]) {
      expect(codesOf(layoutWith([spacer(id)]))).toEqual(['LAYOUT_INVALID']);
    }
    expect(validateQuoteLayout(layoutWith([spacer('khoi-1')])).ok).toBe(true);
  });
});

describe('TC-TL-11: bảng dòng hàng', () => {
  const column = (key: string, widthPct: number, visible = true) => ({ key, label: key, widthPct, align: 'left', visible });
  const table = (columns: unknown[]) => layoutWith([{ id: 'lines', type: 'lineTable', columns }]);

  it('tổng độ rộng cột hiện 99..101 hợp lệ; cột ẩn không tính', () => {
    for (const total of [99, 100, 101]) {
      expect(validateQuoteLayout(table([column('index', 10), column('materialName', total - 10), column('unit', 40, false)])).ok).toBe(true);
    }
    expect(validateQuoteLayout(table([column('index', 33.3), column('materialName', 33.3), column('lineTotal', 33.4)])).ok).toBe(true);
  });

  it.each([
    ['tổng 98', [column('index', 10), column('materialName', 88)]],
    ['tổng 102', [column('index', 10), column('materialName', 92)]],
    ['không có cột hiện', [column('index', 100, false)]],
    ['cột giá vốn', [column('estCost', 10), column('materialName', 90)]],
    ['cột trùng', [column('index', 10), column('index', 90)]],
  ])('%s: LAYOUT_TABLE_INVALID', (_name, columns) => {
    expect(codesOf(table(columns))).toContain('LAYOUT_TABLE_INVALID');
  });
});

describe('TC-TL-12: biến không cho phép, trường lạ', () => {
  it.each(['{{customer.secret}}', '{{custom.abc}}', '{{totals.cost}}', '{{totals.profit}}'])('%s: LAYOUT_VARIABLE_UNKNOWN', (text) => {
    const [error] = errorsOf(validateQuoteLayout(layoutWith([textBlock(`Giá trị ${text}`)])));
    expect(error).toMatchObject({ code: 'LAYOUT_VARIABLE_UNKNOWN', path: 'blocks[0].runs[0].text' });
    expect(error.message).toContain(text);
  });

  it('custom.<uuid> hợp lệ dù trường đã tắt hay đã xoá (không kiểm tồn tại)', () => {
    expect(validateQuoteLayout(layoutWith([textBlock(`{{custom.${CUSTOM_ID}}}`)])).ok).toBe(true);
  });

  it('biến lạ ở nhãn, tiêu đề, chữ ký cũng bị chặn', () => {
    const title = { id: 't', type: 'title', text: 'BÁO GIÁ', subtitle: '{{quote.cost}}', fontSizePt: 20, align: 'center', uppercase: true };
    expect(codesOf(layoutWith([title]))).toEqual(['LAYOUT_VARIABLE_UNKNOWN']);
  });

  it('trường lạ bị bỏ khi chuẩn hoá, không báo lỗi', () => {
    const input = layoutWith([{ ...textBlock('Xin chào'), onclick: 'alert(1)', html: '<b>x</b>', runs: [{ text: 'Xin chào', style: 'x' }] }], {
      script: 'x',
    });
    const result = validateQuoteLayout(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.layout.blocks[0] as QuoteLayoutBlock & Record<string, unknown>;
    expect(block).toEqual({ id: 'text', type: 'text', align: 'left', runs: [{ text: 'Xin chào' }] });
    expect(result.layout).not.toHaveProperty('script');
  });
});

describe('TC-TL-26: giới hạn chi tiết D3-14', () => {
  const column = (key: string, widthPct: number) => ({ key, label: key, widthPct, align: 'left', visible: true });
  const header = () => defaultQuoteLayout().blocks.find((block) => block.type === 'companyHeader') as QuoteLayoutBlock;
  const totals = () => defaultQuoteLayout().blocks.find((block) => block.type === 'totals') as QuoteLayoutBlock & {
    rows: readonly { key: string }[];
  };

  it('widthPct ngoài 0..100: LAYOUT_INVALID kèm path', () => {
    for (const [width, path] of [
      [-1, 'blocks[0].columns[0].widthPct'],
      [101, 'blocks[0].columns[0].widthPct'],
    ] as const) {
      const layout = layoutWith([{ id: 'lines', type: 'lineTable', columns: [column('materialName', width), column('index', 100 - width)] }]);
      expect(errorsOf(validateQuoteLayout(layout))).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'LAYOUT_INVALID', path })]),
      );
    }
  });

  it('logo rỗng: LAYOUT_IMAGE_INVALID; logo null hợp lệ', () => {
    const [error] = errorsOf(validateQuoteLayout(layoutWith([{ ...header(), logo: '' }])));
    expect(error).toMatchObject({ path: 'blocks[0].logo', code: 'LAYOUT_IMAGE_INVALID' });
    expect(validateQuoteLayout(layoutWith([{ ...header(), logo: null }])).ok).toBe(true);
  });

  it('dòng totals trùng key: LAYOUT_INVALID', () => {
    const block = totals();
    const rows = [...block.rows, block.rows[0]];
    expect(codesOf(layoutWith([{ ...block, rows }]))).toContain('LAYOUT_INVALID');
    expect(validateQuoteLayout(layoutWith([block])).ok).toBe(true);
  });

  it('id khối 40 ký tự hợp lệ, 41 ký tự LAYOUT_INVALID', () => {
    expect(validateQuoteLayout(layoutWith([spacer('a'.repeat(40))])).ok).toBe(true);
    expect(codesOf(layoutWith([spacer('a'.repeat(41))]))).toEqual(['LAYOUT_INVALID']);
  });
});
