import {
  BRAND_NOTE_MAX_LENGTH,
  DEFAULT_PALETTE,
  DEFAULT_RULES,
} from '@enterprise-platform/shared-brand-icon';
import { BrandError } from './brand.errors.js';
import {
  assertIconId,
  cleanNote,
  parseDocument,
  parseOptionalVersion,
  parseStatuses,
  parseStandards,
  parseSvgMode,
  parseVersionNumber,
} from './brand-input.js';
import { sampleDocument } from './testing/sample-documents.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof BrandError ? error.code : 'NOT_A_BRAND_ERROR';
  }
  return undefined;
};

describe('assertIconId', () => {
  it('nhận mã đúng mẫu và từ chối mã có thể thoát khỏi tiền tố khoá object', () => {
    expect(codeOf(() => assertIconId('icon_A-1'))).toBeUndefined();
    for (const id of [
      '',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a b',
      '-a',
      '_a',
      'a'.repeat(65),
      'ă',
      undefined,
      7,
    ]) {
      expect(codeOf(() => assertIconId(id))).toBe('BRAND_REQUEST_INVALID');
    }
  });
});

describe('parseDocument', () => {
  it('trả tài liệu đã chuẩn hoá và làm sạch giá trị', () => {
    const document = parseDocument({
      ...sampleDocument(),
      name: '  Tên\u0007 có ký tự lạ  ',
      tags: ['a', 'a', 'b'],
      size: 9999,
    });
    expect(document.name).toBe('Tên có ký tự lạ');
    expect(document.tags).toEqual(['a', 'b']);
    expect(document.size).toBe(128);
  });

  it('chuyển icon kiểu cũ (khung + nét chính) sang nhiều lớp', () => {
    const legacy = {
      id: 'cu',
      name: 'Icon cũ',
      category: 'brand',
      description: '',
      viewBoxSize: 24,
      containerShape: 'circle',
      containerFill: 'none',
      strokeWidth: 1.75,
      colorTone: 'sapphire',
      cornerRadius: 4,
      accentDot: false,
      glyphPath: 'M4 12h16',
    };
    const document = parseDocument(legacy);
    expect(document.id).toBe('cu');
    expect(document.shapes.length).toBeGreaterThanOrEqual(2);
  });

  it('giới hạn mọi giá trị số và bỏ màu không hợp lệ về mặc định', () => {
    const base = sampleDocument();
    const document = parseDocument({
      ...base,
      shapes: [
        {
          ...base.shapes[0],
          strokeWidth: 999,
          opacity: 7,
          stroke: 'url(javascript:alert(1))',
          fill: 'expression(1)',
        },
      ],
    });
    expect(document.shapes[0]).toMatchObject({
      strokeWidth: 6,
      opacity: 1,
      stroke: 'currentColor',
      fill: 'none',
    });
  });

  it('từ chối mọi thứ không dùng được bằng lỗi tiếng Việt có dấu', () => {
    for (const bad of [
      null,
      undefined,
      5,
      [],
      {},
      { id: 'a' },
      { id: 'a', name: 'x' },
    ]) {
      expect(codeOf(() => parseDocument(bad))).toBe('BRAND_ICON_INVALID');
    }
  });
});

describe('cleanNote', () => {
  it('rỗng hoặc vắng mặt là null, cắt độ dài và bỏ ký tự điều khiển', () => {
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(' a\u0000b\n ')).toBe('ab');
    expect(cleanNote('x'.repeat(BRAND_NOTE_MAX_LENGTH + 50))).toHaveLength(
      BRAND_NOTE_MAX_LENGTH,
    );
    expect(codeOf(() => cleanNote(5))).toBe('BRAND_REQUEST_INVALID');
  });
});

describe('parseVersionNumber', () => {
  it('nhận số nguyên dương, cả dạng chuỗi số', () => {
    expect(parseVersionNumber(3, 'v')).toBe(3);
    expect(parseVersionNumber('12', 'v')).toBe(12);
    expect(parseVersionNumber(0, 'v', true)).toBe(0);
  });

  it('từ chối số không hợp lệ', () => {
    for (const bad of [
      0,
      -1,
      1.5,
      '1.5',
      '-1',
      '1e3',
      '',
      ' 1',
      'abc',
      null,
      undefined,
      {},
      1_000_001,
      '99999999',
    ]) {
      expect(codeOf(() => parseVersionNumber(bad, 'v'))).toBe(
        'BRAND_REQUEST_INVALID',
      );
    }
    expect(codeOf(() => parseVersionNumber(-1, 'v', true))).toBe(
      'BRAND_REQUEST_INVALID',
    );
  });

  it('phiên bản tuỳ chọn: vắng mặt là null', () => {
    expect(parseOptionalVersion(undefined, 'v')).toBeNull();
    expect(parseOptionalVersion('', 'v')).toBeNull();
    expect(parseOptionalVersion('4', 'v')).toBe(4);
    expect(codeOf(() => parseOptionalVersion('x', 'v'))).toBe(
      'BRAND_REQUEST_INVALID',
    );
  });
});

describe('parseSvgMode và parseStatuses', () => {
  it('chế độ mặc định là brand', () => {
    expect(parseSvgMode(undefined)).toBe('brand');
    expect(parseSvgMode('mono')).toBe('mono');
    expect(codeOf(() => parseSvgMode('color'))).toBe('BRAND_REQUEST_INVALID');
    expect(codeOf(() => parseSvgMode(['mono']))).toBe('BRAND_REQUEST_INVALID');
  });

  it('lọc trạng thái theo danh sách phân tách bằng dấu phẩy', () => {
    expect(parseStatuses(undefined)).toBeUndefined();
    expect(parseStatuses('')).toBeUndefined();
    expect(parseStatuses('draft, published,draft')).toEqual([
      'draft',
      'published',
    ]);
    expect(codeOf(() => parseStatuses('draft,nope'))).toBe(
      'BRAND_REQUEST_INVALID',
    );
    expect(codeOf(() => parseStatuses(['draft']))).toBe(
      'BRAND_REQUEST_INVALID',
    );
  });
});

describe('parseStandards', () => {
  it('nhận bảng màu và quy chuẩn đúng, chuẩn hoá mã màu', () => {
    const result = parseStandards({
      palette: { tokens: [{ key: 'chinh', label: 'Màu chính', hex: '#ABC' }] },
      rules: { ...DEFAULT_RULES, maxShapes: 500 },
    });
    expect(result.palette.tokens).toEqual([
      { key: 'chinh', label: 'Màu chính', hex: '#aabbcc' },
    ]);
    expect(result.rules.maxShapes).toBe(100);
  });

  it('không lặng lẽ thay bảng màu sai bằng mặc định', () => {
    expect(
      codeOf(() =>
        parseStandards({
          palette: { tokens: [{ key: 'X', hex: 'no' }] },
          rules: DEFAULT_RULES,
        }),
      ),
    ).toBe('BRAND_STANDARDS_INVALID');
    expect(
      codeOf(() => parseStandards({ palette: DEFAULT_PALETTE, rules: 'x' })),
    ).toBe('BRAND_STANDARDS_INVALID');
    expect(codeOf(() => parseStandards(null))).toBe('BRAND_STANDARDS_INVALID');
  });
});
