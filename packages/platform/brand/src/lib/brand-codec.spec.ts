import {
  DEFAULT_PALETTE,
  normalizeDocument,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import {
  buildIconArtifacts,
  iconObjectKeys,
  sha256Hex,
  specSha256,
  stableStringify,
  standardsObjectKey,
} from './brand-codec.js';
import { sampleDocument } from './testing/sample-documents.js';

const context = {
  palette: DEFAULT_PALETTE,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-02T00:00:00.000Z',
};

describe('khoá object', () => {
  it('đặt khoá dưới platform/brand, ngoài tiền tố tenants/', () => {
    expect(iconObjectKeys('icon-a', 3)).toEqual({
      spec: 'platform/brand/icons/icon-a/v3/spec.json',
      svg: 'platform/brand/icons/icon-a/v3/icon.svg',
      monoSvg: 'platform/brand/icons/icon-a/v3/icon.mono.svg',
    });
    expect(standardsObjectKey(2)).toBe('platform/brand/standards/v2.json');
    expect(iconObjectKeys('icon-a', 1).spec.startsWith('tenants/')).toBe(false);
  });

  it.each(['../tenants/x', 'a/b', 'a b', '', '-a', 'a'.repeat(65)])(
    'từ chối mã icon %p khi dựng khoá',
    (id) => {
      expect(() => iconObjectKeys(id, 1)).toThrow();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'từ chối phiên bản %p',
    (version) => {
      expect(() => iconObjectKeys('icon-a', version)).toThrow();
      expect(() => standardsObjectKey(version)).toThrow();
    },
  );
});

describe('stableStringify', () => {
  it('không phụ thuộc thứ tự khoá, ở mọi cấp', () => {
    const a = { b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('giữ thứ tự mảng và bỏ khoá undefined', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('specSha256', () => {
  it('giống nhau khi chỉ khác status, createdAt, updatedAt', () => {
    const base = sampleDocument();
    const other: IconDocument = {
      ...base,
      status: 'published',
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2031-01-01T00:00:00.000Z',
    };
    expect(specSha256(other)).toBe(specSha256(base));
    expect(specSha256(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('khác nhau khi nội dung đổi (tên, màu, hình)', () => {
    const base = sampleDocument();
    expect(specSha256({ ...base, name: 'Tên khác' })).not.toBe(
      specSha256(base),
    );
    expect(specSha256({ ...base, shapes: base.shapes.slice(0, 1) })).not.toBe(
      specSha256(base),
    );
    expect(
      specSha256({
        ...base,
        shapes: [
          { ...base.shapes[0], stroke: 'brand:emerald' },
          base.shapes[1],
        ],
      }),
    ).not.toBe(specSha256(base));
  });

  it('ổn định khi tài liệu đi qua JSON và chuẩn hoá lại', () => {
    const base = sampleDocument();
    const again = normalizeDocument(JSON.parse(JSON.stringify(base)));
    expect(again && specSha256(again)).toBe(specSha256(base));
  });

  it('là sha256 của JSON ổn định', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('buildIconArtifacts', () => {
  it('ghi tài liệu với status draft và mốc thời gian của máy chủ', () => {
    const build = buildIconArtifacts(
      { ...sampleDocument(), status: 'published' },
      context,
    );
    const stored = JSON.parse(build.specJson) as IconDocument;
    expect(stored).toMatchObject({
      status: 'draft',
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    });
    expect(build.sizeBytes).toBe(Buffer.byteLength(build.specJson));
    expect(normalizeDocument(stored)?.id).toBe('icon-a');
  });

  it('dựng SVG màu thương hiệu từ bảng màu và SVG mono bằng currentColor', () => {
    const build = buildIconArtifacts(sampleDocument(), context);
    expect(build.svg).toContain('#2563eb');
    expect(build.svg).toContain('#09192e');
    expect(build.svg).not.toContain('brand:');
    expect(build.monoSvg).not.toMatch(/#[0-9a-f]{6}/);
    expect(build.monoSvg).toContain('currentColor');
  });

  it('đổi bảng màu thì SVG thương hiệu đổi nhưng spec và sha không đổi', () => {
    const recolored = {
      tokens: DEFAULT_PALETTE.tokens.map((token) =>
        token.key === 'sapphire' ? { ...token, hex: '#112233' } : token,
      ),
    };
    const before = buildIconArtifacts(sampleDocument(), context);
    const after = buildIconArtifacts(sampleDocument(), {
      ...context,
      palette: recolored,
    });
    expect(after.svg).toContain('#112233');
    expect(after.svg).not.toBe(before.svg);
    expect(after.specSha256).toBe(before.specSha256);
    expect(after.monoSvg).toBe(before.monoSvg);
  });

  it('không để tên icon thoát ra khỏi chú thích SVG', () => {
    const hostile = normalizeDocument({
      ...sampleDocument(),
      name: '--><script>alert(1)</script><!--',
    });
    expect(hostile).not.toBeNull();
    const build = buildIconArtifacts(hostile as IconDocument, context);
    expect(build.svg).not.toContain('<script');
    expect(build.monoSvg).not.toContain('<script');
    expect(build.svg.match(/<!--/g)).toHaveLength(1);
    expect(build.svg.match(/-->/g)).toHaveLength(1);
  });
});
