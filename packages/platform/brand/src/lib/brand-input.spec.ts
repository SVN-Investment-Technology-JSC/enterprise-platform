import {
  BRAND_NOTE_MAX_LENGTH,
  DEFAULT_PALETTE,
  DEFAULT_RULES,
} from '@enterprise-platform/shared-brand-icon';
import { BrandError } from './brand.errors.js';
import {
  assertIconId,
  assertSlotId,
  cleanNote,
  deriveSlotGroupKey,
  parseCustomSlotInput,
  parseCustomSlotPatch,
  parseDocument,
  parseOptionalVersion,
  parseSlotGroupCreate,
  parseStatuses,
  parseStandards,
  parseSvgMode,
  parseVersionNumber,
  uniqueSlotGroupKey,
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

describe('assertSlotId', () => {
  it('nhận slot có định dạng hợp lệ và từ chối slot sai định dạng', () => {
    expect(codeOf(() => assertSlotId('brand.logo'))).toBeUndefined();
    expect(codeOf(() => assertSlotId('nav.dashboard'))).toBeUndefined();
    expect(codeOf(() => assertSlotId('custom.test-banner'))).toBeUndefined();
    for (const bad of ['', 'INVALID_UPPER', '123startWithDigit', 'brand/logo', '../x', 123, null]) {
      expect(codeOf(() => assertSlotId(bad))).toBe('BRAND_SLOT_NOT_FOUND');
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
      strokeWidth: 100,
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

describe('parseCustomSlotInput', () => {
  it('nhận dữ liệu hợp lệ và thiết lập giá trị mặc định', () => {
    const result = parseCustomSlotInput(
      { id: 'custom.my-slot', label: 'Vị trí của tôi' },
      'user-1',
    );
    expect(result).toEqual({
      id: 'custom.my-slot',
      label: 'Vị trí của tôi',
      description: '',
      groupKey: 'custom',
      colorMode: 'brand',
      recommendedSize: 24,
      createdBy: 'user-1',
    });
  });

  it('nhận nhóm qua trường group (kiểu dùng chung) và groupKey (tương thích)', () => {
    expect(parseCustomSlotInput({ id: 'custom.a1', label: 'A', group: 'trung-tam-tro-giup' }, 'u').groupKey).toBe('trung-tam-tro-giup');
    expect(parseCustomSlotInput({ id: 'custom.a1', label: 'A', groupKey: 'cu' }, 'u').groupKey).toBe('cu');
    expect(parseCustomSlotPatch({ group: 'nhom-moi' }).groupKey).toBe('nhom-moi');
    expect(parseCustomSlotPatch({ groupKey: 'nhom-cu' }).groupKey).toBe('nhom-cu');
  });

  it('từ chối mã vị trí trùng với vị trí hệ thống cố định', () => {
    expect(
      codeOf(() =>
        parseCustomSlotInput({ id: 'brand.logo', label: 'Logo mới' }),
      ),
    ).toBe('BRAND_SLOT_CONFLICT');
  });

  it('từ chối mã vị trí sai định dạng hoặc thiếu tên', () => {
    expect(codeOf(() => parseCustomSlotInput({ id: '123bad', label: 'Tên' }))).toBe(
      'BRAND_REQUEST_INVALID',
    );
    expect(codeOf(() => parseCustomSlotInput({ id: 'custom.ok', label: '   ' }))).toBe(
      'BRAND_REQUEST_INVALID',
    );
  });
});

describe('parseCustomSlotPatch', () => {
  it('cho phép cập nhật từng phần', () => {
    const patch = parseCustomSlotPatch({
      label: 'Tên mới',
      colorMode: 'mono',
      recommendedSize: 32,
    });
    expect(patch).toEqual({
      label: 'Tên mới',
      colorMode: 'mono',
      recommendedSize: 32,
    });
  });

  it('từ chối tên rỗng hoặc kích thước ngoài khoảng 8-512', () => {
    expect(codeOf(() => parseCustomSlotPatch({ label: '  ' }))).toBe(
      'BRAND_REQUEST_INVALID',
    );
    expect(codeOf(() => parseCustomSlotPatch({ recommendedSize: 2 }))).toBe(
      'BRAND_REQUEST_INVALID',
    );
  });
});

describe('deriveSlotGroupKey và parseSlotGroupCreate', () => {
  it('sinh mã từ tên tiếng Việt', () => {
    expect(deriveSlotGroupKey('Trung tâm trợ giúp')).toBe('trung-tam-tro-giup');
    expect(deriveSlotGroupKey('Đồ  dùng -- văn phòng!')).toBe(
      'do-dung-van-phong',
    );
    expect(deriveSlotGroupKey('9 nhóm')).toBe('g-9-nhom');
    expect(deriveSlotGroupKey('A')).toBe('g-a');
    expect(deriveSlotGroupKey('!!!')).toBe('g-nhom');
  });

  it('cắt tối đa 32 ký tự và không kết thúc bằng gạch ngang', () => {
    const key = deriveSlotGroupKey(`${'a'.repeat(31)} b`);
    expect(key.length).toBeLessThanOrEqual(32);
    expect(key.endsWith('-')).toBe(false);
    expect(/^[a-z][a-z0-9_-]{1,31}$/.test(deriveSlotGroupKey('x'.repeat(80)))).toBe(
      true,
    );
  });

  it('uniqueSlotGroupKey thêm hậu tố mà vẫn tối đa 32 ký tự', () => {
    const base = 'a'.repeat(32);
    expect(uniqueSlotGroupKey(base, new Set([base]))).toBe(
      `${'a'.repeat(30)}-2`,
    );
    expect(uniqueSlotGroupKey('abc', new Set(['abc', 'abc-2']))).toBe('abc-3');
  });

  it('parseSlotGroupCreate cắt khoảng trắng, kiểm mã chỉ định', () => {
    expect(parseSlotGroupCreate({ label: ' Nhóm ' })).toEqual({
      label: 'Nhóm',
    });
    expect(parseSlotGroupCreate({ label: 'N', key: 'ok-key' })).toEqual({
      label: 'N',
      key: 'ok-key',
    });
    expect(() => parseSlotGroupCreate({ label: 'N', key: '1abc' })).toThrow();
    expect(() => parseSlotGroupCreate(null)).toThrow();
  });
});
