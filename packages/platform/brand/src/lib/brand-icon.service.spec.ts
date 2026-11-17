import { Logger } from '@nestjs/common';
import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  LIMITS,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { BrandError } from './brand.errors.js';
import { BrandIconService, type SvgViewer } from './brand-icon.service.js';
import { iconObjectKeys, standardsObjectKey } from './brand-codec.js';
import { FakeBrandStore, FakeObjectStore } from './testing/brand-fakes.js';
import {
  oversizedDocument,
  sampleDocument,
} from './testing/sample-documents.js';

const ADMIN = { userId: '00000000-0000-4000-8000-000000000001' };

function setup() {
  const store = new FakeBrandStore();
  const objects = new FakeObjectStore();
  const flags = { publicRead: true };
  const service = new BrandIconService(store, objects, {
    publicRead: () => flags.publicRead,
    now: () => new Date('2026-03-01T00:00:00.000Z'),
  });
  return { store, objects, flags, service };
}

async function rejection(promise: Promise<unknown>): Promise<BrandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BrandError);
    return error as BrandError;
  }
  throw new Error('Expected the promise to reject');
}

const viewerOf = (kind: SvgViewer) => jest.fn(async () => kind);

const KEYS_V1 = Object.values(iconObjectKeys('icon-a', 1)).sort();
const KEYS_V2 = Object.values(iconObjectKeys('icon-a', 2)).sort();

beforeAll(() => Logger.overrideLogger(false));
afterAll(() => Logger.overrideLogger(['log', 'error', 'warn']));

describe('BrandIconService – tạo icon', () => {
  it('ghi spec và hai SVG dưới khoá phiên bản 1 rồi ghi DB, kèm nhật ký kiểm toán', async () => {
    const { service, store, objects } = setup();
    const result = await service.create(ADMIN, {
      document: sampleDocument(),
      note: '  Bản đầu  ',
    });

    expect(result.unchanged).toBe(false);
    expect(result.icon).toMatchObject({
      id: 'icon-a',
      slug: 'bieu-tuong-a',
      name: 'Biểu tượng A',
      category: 'brand',
      status: 'draft',
      tags: ['mau'],
      currentVersion: 1,
      publishedVersion: null,
      hasUnpublishedChanges: false,
      createdBy: ADMIN.userId,
    });
    expect(result.version).toMatchObject({
      version: 1,
      standardsVersion: 0,
      note: 'Bản đầu',
      createdBy: ADMIN.userId,
    });

    expect(objects.keys()).toEqual(KEYS_V1);
    const [row] = store.versions;
    expect(row).toMatchObject({
      specKey: 'platform/brand/icons/icon-a/v1/spec.json',
      svgKey: 'platform/brand/icons/icon-a/v1/icon.svg',
      monoSvgKey: 'platform/brand/icons/icon-a/v1/icon.mono.svg',
    });
    expect(row.specSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.audits).toEqual([
      {
        action: 'platform.brand-icon.created',
        actorId: ADMIN.userId,
        metadata: { iconId: 'icon-a', version: 1 },
      },
    ]);
  });

  it('server tự dựng SVG: chế độ thương hiệu có màu cứng, chế độ mono dùng currentColor', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const svg = objects.objects.get('platform/brand/icons/icon-a/v1/icon.svg');
    const mono = objects.objects.get(
      'platform/brand/icons/icon-a/v1/icon.mono.svg',
    );
    expect(svg?.contentType).toContain('image/svg+xml');
    expect(svg?.body).toContain('#2563eb');
    expect(svg?.body).not.toContain('brand:');
    expect(mono?.body).toContain('currentColor');
    expect(mono?.body).not.toContain('#2563eb');
    const spec = JSON.parse(
      objects.objects.get('platform/brand/icons/icon-a/v1/spec.json')?.body ??
        '{}',
    ) as IconDocument;
    expect(spec).toMatchObject({
      id: 'icon-a',
      status: 'draft',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('bỏ qua status do client gửi: icon luôn bắt đầu là nháp', async () => {
    const { service } = setup();
    const result = await service.create(ADMIN, {
      document: { ...sampleDocument(), status: 'published' },
    });
    expect(result.icon.status).toBe('draft');
    expect(result.icon.publishedVersion).toBeNull();
  });

  it('thêm hậu tố số vào slug khi tên trùng', async () => {
    const { service } = setup();
    const first = await service.create(ADMIN, { document: sampleDocument() });
    const second = await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-b' }),
    });
    const third = await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-c' }),
    });
    expect([first.icon.slug, second.icon.slug, third.icon.slug]).toEqual([
      'bieu-tuong-a',
      'bieu-tuong-a-2',
      'bieu-tuong-a-3',
    ]);
  });

  it('thử lại với slug khác khi hai người tạo cùng tên một lúc', async () => {
    const { service, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    store.forcedSlug = 'bieu-tuong-a';
    const result = await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-b' }),
    });
    expect(result.icon.slug).toBe('bieu-tuong-a-2');
  });

  it('từ chối mã đã có (409) mà không ghi thêm object nào', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const before = objects.puts.length;
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument({ name: 'Tên khác' }) }),
    );
    expect([error.status, error.code]).toEqual([409, 'BRAND_ICON_EXISTS']);
    expect(objects.puts).toHaveLength(before);
  });

  it.each([
    ['không phải đối tượng', 'chuỗi'],
    ['thiếu mã', { ...sampleDocument(), id: undefined }],
    ['mã sai mẫu', { ...sampleDocument(), id: '../tenants/x' }],
    ['tên rỗng', { ...sampleDocument(), name: '   ' }],
    ['shapes không phải mảng', { ...sampleDocument(), shapes: 'x' }],
    [
      'quá nhiều lớp hình',
      {
        ...sampleDocument(),
        shapes: Array(LIMITS.maxShapes + 1).fill(sampleDocument().shapes[0]),
      },
    ],
    [
      'toạ độ vượt giới hạn',
      {
        ...sampleDocument(),
        shapes: [
          {
            ...sampleDocument().shapes[0],
            geometry: {
              type: 'rect',
              x: 1e9,
              y: 0,
              width: 1,
              height: 1,
              rx: 0,
            },
          },
        ],
      },
    ],
    [
      'hình học lạ',
      {
        ...sampleDocument(),
        shapes: [
          { ...sampleDocument().shapes[0], geometry: { type: 'script' } },
        ],
      },
    ],
  ])(
    'từ chối đầu vào xấu (%s) với 400 và không ghi gì',
    async (_label, document) => {
      const { service, store, objects } = setup();
      const error = await rejection(service.create(ADMIN, { document }));
      expect([error.status, error.code]).toEqual([400, 'BRAND_ICON_INVALID']);
      expect(error.message).toMatch(
        /[ạảãáàăắằẵặẳâấầẫậẩđêếềễệểôốồỗộổơớờỡợởưứừữựửíìĩịỉúùũụủýỳỹỵỷéèẽẹẻóòõọỏ]/i,
      );
      expect(store.icons).toHaveLength(0);
      expect(objects.puts).toHaveLength(0);
    },
  );

  it('từ chối icon quá lớn (413) trước khi ghi', async () => {
    const { service, store, objects } = setup();
    const error = await rejection(
      service.create(ADMIN, { document: oversizedDocument() }),
    );
    expect([error.status, error.code]).toEqual([
      413,
      'BRAND_PAYLOAD_TOO_LARGE',
    ]);
    expect(store.icons).toHaveLength(0);
    expect(objects.puts).toHaveLength(0);
  });

  it('từ chối khi đã đủ số icon tối đa', async () => {
    const { service, store } = setup();
    await store.transaction(async (tx) => {
      for (let index = 0; index < LIMITS.maxIcons; index += 1) {
        await tx.insertIcon({
          id: `seed-${index}`,
          slug: `seed-${index}`,
          name: 'Seed',
          category: 'custom',
          tags: [],
          createdBy: ADMIN.userId,
          now: '2026-01-01T00:00:00.000Z',
        });
      }
    });
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument() }),
    );
    expect([error.status, error.code]).toEqual([
      409,
      'BRAND_ICON_LIMIT_REACHED',
    ]);
  });

  it('icon đã lưu trữ không tính vào giới hạn số icon tối đa khi tạo mới', async () => {
    const { service, store } = setup();
    await store.transaction(async (tx) => {
      for (let index = 0; index < LIMITS.maxIcons; index += 1) {
        await tx.insertIcon({
          id: `seed-${index}`,
          slug: `seed-${index}`,
          name: 'Seed',
          category: 'custom',
          tags: [],
          createdBy: ADMIN.userId,
          now: '2026-01-01T00:00:00.000Z',
        });
      }
      await tx.setState('seed-0', {
        status: 'archived',
        publishedVersion: null,
        now: '2026-01-02T00:00:00.000Z',
      });
    });

    const created = await service.create(ADMIN, { document: sampleDocument() });
    expect(created.icon.id).toBe('icon-a');
  });
});

describe('BrandIconService – lưu phiên bản mới', () => {
  const edited = (overrides: Partial<IconDocument> = {}) => ({
    ...sampleDocument(),
    name: 'Biểu tượng A2',
    ...overrides,
  });

  it('tạo phiên bản 2 với khoá mới, cập nhật đầu mục và không đụng object phiên bản 1', async () => {
    const { service, store, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const v1Bodies = KEYS_V1.map((key) => objects.objects.get(key)?.body);

    const result = await service.update(ADMIN, 'icon-a', {
      document: edited({ tags: ['moi'] }),
      baseVersion: 1,
      note: 'Đổi tên',
    });

    expect(result.unchanged).toBe(false);
    expect(result.icon).toMatchObject({
      name: 'Biểu tượng A2',
      tags: ['moi'],
      currentVersion: 2,
      slug: 'bieu-tuong-a',
    });
    expect(result.version).toMatchObject({ version: 2, note: 'Đổi tên' });
    expect(objects.keys()).toEqual([...KEYS_V1, ...KEYS_V2].sort());
    expect(KEYS_V1.map((key) => objects.objects.get(key)?.body)).toEqual(
      v1Bodies,
    );
    expect(objects.puts.filter((key) => KEYS_V1.includes(key))).toHaveLength(
      KEYS_V1.length,
    );
    expect(store.versions).toHaveLength(2);
    expect(store.audits.map((entry) => entry.action)).toEqual([
      'platform.brand-icon.created',
      'platform.brand-icon.updated',
    ]);
  });

  it('không tạo phiên bản khi nội dung giống hệt bản hiện hành, dù status và mốc thời gian khác', async () => {
    const { service, store, objects } = setup();
    const created = await service.create(ADMIN, { document: sampleDocument() });
    const puts = objects.puts.length;
    const result = await service.update(ADMIN, 'icon-a', {
      document: {
        ...sampleDocument(),
        status: 'published',
        updatedAt: '2040-01-01T00:00:00.000Z',
      },
      baseVersion: 1,
      note: 'Không lưu',
    });
    expect(result.unchanged).toBe(true);
    expect(result.version).toEqual(created.version);
    expect(result.icon.currentVersion).toBe(1);
    expect(objects.puts).toHaveLength(puts);
    expect(store.versions).toHaveLength(1);
  });

  it('gửi lại nội dung đã lưu với baseVersion cũ (mất phản hồi) trả về bản hiện hành, không báo xung đột', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const saved = await service.update(ADMIN, 'icon-a', {
      document: edited(),
      baseVersion: 1,
    });
    const retry = await service.update(ADMIN, 'icon-a', {
      document: edited(),
      baseVersion: 1,
    });
    expect(retry.unchanged).toBe(true);
    expect(retry.version.version).toBe(saved.version.version);
  });

  it('báo 409 kèm phiên bản hiện hành khi baseVersion lệch và nội dung khác', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.update(ADMIN, 'icon-a', {
      document: edited(),
      baseVersion: 1,
    });
    const puts = objects.puts.length;
    const error = await rejection(
      service.update(ADMIN, 'icon-a', {
        document: edited({ name: 'Người khác sửa' }),
        baseVersion: 1,
      }),
    );
    expect([error.status, error.code]).toEqual([
      409,
      'BRAND_ICON_VERSION_CONFLICT',
    ]);
    expect(error.extra).toEqual({ currentVersion: 2 });
    expect(objects.puts).toHaveLength(puts);
  });

  it('hai lần lưu đồng thời cùng baseVersion: một thành công, một xung đột, object người thắng được giữ', async () => {
    const { service, objects, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const results = await Promise.allSettled([
      service.update(ADMIN, 'icon-a', {
        document: edited({ name: 'Bản A' }),
        baseVersion: 1,
      }),
      service.update(ADMIN, 'icon-a', {
        document: edited({ name: 'Bản B' }),
        baseVersion: 1,
      }),
    ]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0].reason as BrandError).code).toBe(
      'BRAND_ICON_VERSION_CONFLICT',
    );

    expect(store.versions.map((row) => row.version).sort()).toEqual([1, 2]);
    expect(objects.keys()).toEqual([...KEYS_V1, ...KEYS_V2].sort());
    const stored = JSON.parse(
      objects.objects.get('platform/brand/icons/icon-a/v2/spec.json')?.body ??
        '{}',
    ) as IconDocument;
    const head = store.icons[0];
    expect(stored.name).toBe(head.name);
  });

  it('404 khi icon không có, 400 khi mã trong nội dung lệch đường dẫn hoặc baseVersion sai', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    expect(
      (
        await rejection(
          service.update(ADMIN, 'khong-co', {
            document: sampleDocument({ id: 'khong-co' }),
            baseVersion: 1,
          }),
        )
      ).code,
    ).toBe('BRAND_ICON_NOT_FOUND');
    expect(
      (
        await rejection(
          service.update(ADMIN, 'icon-a', {
            document: sampleDocument({ id: 'icon-z' }),
            baseVersion: 1,
          }),
        )
      ).code,
    ).toBe('BRAND_ICON_ID_MISMATCH');
    for (const baseVersion of [undefined, 0, -1, 1.5, 'abc', null]) {
      const error = await rejection(
        service.update(ADMIN, 'icon-a', { document: edited(), baseVersion }),
      );
      expect([error.status, error.code]).toEqual([
        400,
        'BRAND_REQUEST_INVALID',
      ]);
    }
    expect(
      (
        await rejection(
          service.update(ADMIN, '../x', {
            document: sampleDocument(),
            baseVersion: 1,
          }),
        )
      ).code,
    ).toBe('BRAND_REQUEST_INVALID');
  });

  it('từ chối lưu vào icon đã lưu trữ', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.archive(ADMIN, 'icon-a');
    const error = await rejection(
      service.update(ADMIN, 'icon-a', { document: edited(), baseVersion: 1 }),
    );
    expect([error.status, error.code]).toEqual([409, 'BRAND_ICON_ARCHIVED']);
  });
});

describe('BrandIconService – lỗi giữa chừng', () => {
  it('xoá object vừa ghi và hoàn tác DB khi ghi dòng phiên bản lỗi (tạo mới)', async () => {
    const { service, store, objects } = setup();
    store.failAt = 'insertVersion';
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument() }),
    );
    expect([error.status, error.code]).toEqual([500, 'BRAND_INTERNAL_ERROR']);
    expect(objects.puts).toHaveLength(3);
    expect(objects.keys()).toEqual([]);
    expect(store.icons).toHaveLength(0);
    expect(store.versions).toHaveLength(0);
  });

  it('khi lưu phiên bản 2 lỗi thì chỉ xoá object phiên bản 2, phiên bản 1 còn nguyên', async () => {
    const { service, store, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    store.failAt = 'saveHead';
    const error = await rejection(
      service.update(ADMIN, 'icon-a', {
        document: { ...sampleDocument(), name: 'Mới' },
        baseVersion: 1,
      }),
    );
    expect(error.code).toBe('BRAND_INTERNAL_ERROR');
    expect(objects.keys()).toEqual(KEYS_V1);
    expect(store.icons[0].currentVersion).toBe(1);
    expect(store.versions).toHaveLength(1);

    store.failAt = null;
    const retry = await service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Mới' },
      baseVersion: 1,
    });
    expect(retry.version.version).toBe(2);
  });

  it('kho lỗi ở lần ghi thứ hai: 503, dọn lần ghi đầu, DB không có gì', async () => {
    const { service, store, objects } = setup();
    objects.failPut = (key) => key.endsWith('/icon.svg');
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument() }),
    );
    expect([error.status, error.code]).toEqual([
      503,
      'BRAND_STORAGE_UNAVAILABLE',
    ]);
    expect(objects.keys()).toEqual([]);
    expect(store.icons).toHaveLength(0);
  });

  it('dọn object lỗi không che lỗi gốc', async () => {
    const { service, store, objects } = setup();
    store.failAt = 'insertVersion';
    objects.failRemove = true;
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument() }),
    );
    expect(error.code).toBe('BRAND_INTERNAL_ERROR');
  });

  it('lỗi lúc chốt giao dịch (không rõ đã chốt chưa) thì giữ object, tránh mất dữ liệu đã chốt', async () => {
    const { service, store, objects } = setup();
    store.failCommit = true;
    const error = await rejection(
      service.create(ADMIN, { document: sampleDocument() }),
    );
    expect(error.code).toBe('BRAND_INTERNAL_ERROR');
    expect(objects.removed).toEqual([]);
    expect(objects.keys()).toEqual(KEYS_V1);
  });

  it('mất kết nối DB: 503 để client thử lại, không phải 500', async () => {
    const { service, store } = setup();
    for (const failure of [
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      }),
      Object.assign(new Error('terminating connection'), { code: '57P01' }),
      new Error('timeout exceeded when trying to connect'),
    ]) {
      store.failReads = failure;
      const error = await rejection(service.list());
      expect([error.status, error.code]).toEqual([
        503,
        'BRAND_DATABASE_UNAVAILABLE',
      ]);
      expect(error.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });

  it('lỗi lạ không lộ chi tiết cho client', async () => {
    const { service, store } = setup();
    store.failReads = new Error(
      'postgresql://user:secret@host/platform refused',
    );
    const error = await rejection(service.list());
    expect([error.status, error.code]).toEqual([500, 'BRAND_INTERNAL_ERROR']);
    expect(error.message).not.toMatch(/secret|postgresql/);
  });
});

describe('BrandIconService – trạng thái', () => {
  async function published() {
    const ctx = setup();
    await ctx.service.create(ADMIN, { document: sampleDocument() });
    await ctx.service.publish(ADMIN, 'icon-a');
    return ctx;
  }

  it('phát hành ghim phiên bản hiện hành; lưu thêm bản mới không làm bản công khai đổi', async () => {
    const { service } = await published();
    const detail = await service.detail('icon-a');
    expect(detail).toMatchObject({
      status: 'published',
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });

    const saved = await service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Mới' },
      baseVersion: 1,
    });
    expect(saved.icon).toMatchObject({
      status: 'published',
      currentVersion: 2,
      publishedVersion: 1,
      hasUnpublishedChanges: true,
    });

    const again = await service.publish(ADMIN, 'icon-a');
    expect(again).toMatchObject({
      publishedVersion: 2,
      hasUnpublishedChanges: false,
    });
  });

  it('phát hành lại bản đang phát hành thì không đổi và không ghi thêm kiểm toán', async () => {
    const { service, store } = await published();
    const audits = store.audits.length;
    expect((await service.publish(ADMIN, 'icon-a')).publishedVersion).toBe(1);
    expect(store.audits).toHaveLength(audits);
  });

  it('không phát hành icon chưa có hình nào hiển thị (422)', async () => {
    const { service } = setup();
    await service.create(ADMIN, {
      document: sampleDocument({ id: 'trong', name: 'Trống', shapes: [] }),
    });
    const error = await rejection(service.publish(ADMIN, 'trong'));
    expect([error.status, error.code]).toEqual([
      422,
      'BRAND_ICON_NOT_PUBLISHABLE',
    ]);
    expect(error.message).toContain('Icon chưa có hình nào hiển thị');
    expect((await service.detail('trong')).status).toBe('draft');
  });

  it('gỡ phát hành đưa icon về nháp và bỏ bản công khai; gọi lại thì giữ nguyên', async () => {
    const { service } = await published();
    expect(await service.unpublish(ADMIN, 'icon-a')).toMatchObject({
      status: 'draft',
      publishedVersion: null,
    });
    expect(await service.unpublish(ADMIN, 'icon-a')).toMatchObject({
      status: 'draft',
      publishedVersion: null,
    });
  });

  it('lưu trữ không xoá object hay phiên bản; khôi phục về nháp, không tự phát hành lại', async () => {
    const { service, objects, store } = await published();
    const keys = objects.keys();
    expect(await service.archive(ADMIN, 'icon-a')).toMatchObject({
      status: 'archived',
      publishedVersion: null,
    });
    expect(objects.keys()).toEqual(keys);
    expect(objects.removed).toEqual([]);
    expect(store.versions).toHaveLength(1);

    expect((await rejection(service.publish(ADMIN, 'icon-a'))).code).toBe(
      'BRAND_ICON_ARCHIVED',
    );
    expect(await service.restore(ADMIN, 'icon-a')).toMatchObject({
      status: 'draft',
      publishedVersion: null,
    });
    expect(await service.restore(ADMIN, 'icon-a')).toMatchObject({
      status: 'draft',
    });
  });

  it('chặn khôi phục icon đã lưu trữ khi số icon đang hoạt động đã đạt tối đa', async () => {
    const { service, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.archive(ADMIN, 'icon-a');

    await store.transaction(async (tx) => {
      for (let index = 0; index < LIMITS.maxIcons; index += 1) {
        await tx.insertIcon({
          id: `seed-${index}`,
          slug: `seed-${index}`,
          name: 'Seed',
          category: 'custom',
          tags: [],
          createdBy: ADMIN.userId,
          now: '2026-01-01T00:00:00.000Z',
        });
      }
    });

    const error = await rejection(service.restore(ADMIN, 'icon-a'));
    expect([error.status, error.code]).toEqual([
      409,
      'BRAND_ICON_LIMIT_REACHED',
    ]);
    expect((await service.detail('icon-a')).status).toBe('archived');
  });

  it('purge xoá vĩnh viễn icon đã lưu trữ, dọn kho object và ghi kiểm toán; từ chối nếu chưa lưu trữ', async () => {
    const { service, store, objects } = await published();
    await service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Bản hai' },
      baseVersion: 1,
    });

    // Từ chối khi đang published hoặc draft
    const errPublished = await rejection(service.purge(ADMIN, 'icon-a'));
    expect([errPublished.status, errPublished.code]).toEqual([
      400,
      'BRAND_REQUEST_INVALID',
    ]);
    await service.unpublish(ADMIN, 'icon-a');
    const errDraft = await rejection(service.purge(ADMIN, 'icon-a'));
    expect([errDraft.status, errDraft.code]).toEqual([
      400,
      'BRAND_REQUEST_INVALID',
    ]);

    // Lưu trữ rồi xoá vĩnh viễn
    await service.archive(ADMIN, 'icon-a');
    await service.purge(ADMIN, 'icon-a');

    expect(store.icons).toHaveLength(0);
    expect(store.versions).toHaveLength(0);
    expect(objects.keys()).toEqual([]);
    expect(objects.removed.sort()).toEqual([...KEYS_V1, ...KEYS_V2].sort());
    expect(store.audits.at(-1)).toEqual({
      action: 'platform.brand-icon.purged',
      actorId: ADMIN.userId,
      metadata: { iconId: 'icon-a', name: 'Bản hai' },
    });
  });

  it('báo 404 khi đổi trạng thái icon không có', async () => {
    const { service } = setup();
    for (const action of [
      'publish',
      'unpublish',
      'archive',
      'restore',
      'purge',
    ] as const) {
      expect((await rejection(service[action](ADMIN, 'khong-co'))).code).toBe(
        'BRAND_ICON_NOT_FOUND',
      );
    }
  });

  it('liệt kê theo trạng thái và trả danh sách phiên bản mới nhất trước', async () => {
    const { service } = await published();
    await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-b', name: 'B' }),
    });
    await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-c', name: 'C' }),
    });
    await service.archive(ADMIN, 'icon-c');
    await service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Mới' },
      baseVersion: 1,
    });

    expect((await service.list()).icons.map((icon) => icon.id).sort()).toEqual([
      'icon-a',
      'icon-b',
      'icon-c',
    ]);
    expect(
      (await service.list(['published'])).icons.map((icon) => icon.id),
    ).toEqual(['icon-a']);
    expect(
      (await service.list(['draft', 'archived'])).icons
        .map((icon) => icon.id)
        .sort(),
    ).toEqual(['icon-b', 'icon-c']);
    expect(
      (await service.detail('icon-a')).versions.map(
        (version) => version.version,
      ),
    ).toEqual([2, 1]);
    expect((await rejection(service.detail('khong-co'))).code).toBe(
      'BRAND_ICON_NOT_FOUND',
    );
  });
});

describe('BrandIconService – đọc tài liệu', () => {
  it('trả phiên bản mới nhất mặc định hoặc đúng phiên bản yêu cầu; status phản ánh bản đang phát hành', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Phiên bản hai' },
      baseVersion: 1,
    });
    await service.publish(ADMIN, 'icon-a');

    const latest = await service.spec('icon-a', null);
    expect(latest).toMatchObject({ version: 2, iconStatus: 'published' });
    expect(latest.document).toMatchObject({
      id: 'icon-a',
      name: 'Phiên bản hai',
      status: 'published',
    });
    const first = await service.spec('icon-a', 1);
    expect(first.document).toMatchObject({
      name: 'Biểu tượng A',
      status: 'draft',
    });
    expect(first.specSha256).not.toBe(latest.specSha256);
  });

  it('404 khi icon hoặc phiên bản không có; 502 khi object trong kho bị mất', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    expect((await rejection(service.spec('khong-co', null))).code).toBe(
      'BRAND_ICON_NOT_FOUND',
    );
    expect((await rejection(service.spec('icon-a', 9))).code).toBe(
      'BRAND_ICON_VERSION_NOT_FOUND',
    );
    objects.objects.delete('platform/brand/icons/icon-a/v1/spec.json');
    const error = await rejection(service.spec('icon-a', null));
    expect([error.status, error.code]).toEqual([502, 'BRAND_STORAGE_CORRUPT']);
  });

  it('báo 502 khi spec.json trong kho hỏng', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    objects.objects.set('platform/brand/icons/icon-a/v1/spec.json', {
      contentType: 'application/json',
      body: '{không phải json',
    });
    expect((await rejection(service.spec('icon-a', null))).code).toBe(
      'BRAND_STORAGE_CORRUPT',
    );
  });
});

describe('BrandIconService – đọc SVG', () => {
  const read = (
    service: BrandIconService,
    viewer: ReturnType<typeof viewerOf>,
    query: { version?: number | null; mode?: 'brand' | 'mono' } = {},
    ifNoneMatch?: string,
    id = 'icon-a',
  ) =>
    service.readSvg(
      id,
      { version: query.version ?? null, mode: query.mode ?? 'brand' },
      viewer,
      ifNoneMatch,
    );

  async function publishedWithDraft() {
    const ctx = setup();
    await ctx.service.create(ADMIN, { document: sampleDocument() });
    await ctx.service.publish(ADMIN, 'icon-a');
    // Bản 2 là nháp chưa phát hành, đổi tên để phân biệt.
    await ctx.service.update(ADMIN, 'icon-a', {
      document: { ...sampleDocument(), name: 'Bản nháp hai' },
      baseVersion: 1,
    });
    return ctx;
  }

  it('bản đã phát hành đọc công khai, không cần kiểm tra phiên', async () => {
    const { service } = await publishedWithDraft();
    const viewer = viewerOf('anonymous');
    const result = await read(service, viewer, { version: 1 });
    expect(viewer).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      notModified: false,
      cacheControl: 'public, max-age=31536000, immutable',
      filename: 'bieu-tuong-a.svg',
    });
    if (result.notModified) throw new Error('unreachable');
    expect(result.body).toContain('<svg');
    expect(result.body).toContain('#2563eb');
  });

  it('không chỉ định phiên bản thì trả bản đang phát hành (không phải bản nháp mới hơn), cache ngắn', async () => {
    const { service } = await publishedWithDraft();
    const viewer = viewerOf('anonymous');
    const result = await read(service, viewer);
    expect(result.cacheControl).toBe('public, max-age=300');
    if (result.notModified) throw new Error('unreachable');
    expect(result.body).toContain('Biểu tượng A');
    expect(result.body).not.toContain('Bản nháp hai');
    expect(viewer).not.toHaveBeenCalled();
  });

  it('phiên bản mới hơn bản phát hành là nháp: khách và người dùng thường không đọc được, quản trị đọc được', async () => {
    const { service } = await publishedWithDraft();
    expect(
      (await rejection(read(service, viewerOf('anonymous'), { version: 2 })))
        .code,
    ).toBe('BRAND_ICON_NOT_FOUND');
    expect(
      (await rejection(read(service, viewerOf('user'), { version: 2 }))).code,
    ).toBe('BRAND_ICON_NOT_FOUND');
    const admin = await read(service, viewerOf('admin'), { version: 2 });
    expect(admin.cacheControl).toBe('private, max-age=31536000, immutable');
    if (admin.notModified) throw new Error('unreachable');
    expect(admin.body).toContain('Bản nháp hai');
  });

  it('bản nháp và bản lưu trữ chỉ quản trị đọc được; khách nhận 404 như icon không tồn tại', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    const anonymous = viewerOf('anonymous');
    expect((await rejection(read(service, anonymous))).code).toBe(
      'BRAND_ICON_NOT_FOUND',
    );
    expect(anonymous).toHaveBeenCalledTimes(1);
    expect((await rejection(read(service, viewerOf('user')))).code).toBe(
      'BRAND_ICON_NOT_FOUND',
    );
    expect(
      (await rejection(read(service, anonymous, {}, undefined, 'khong-co')))
        .code,
    ).toBe('BRAND_ICON_NOT_FOUND');

    const draft = await read(service, viewerOf('admin'));
    expect(draft.cacheControl).toBe('private, no-cache');

    await service.publish(ADMIN, 'icon-a');
    await service.archive(ADMIN, 'icon-a');
    expect(
      (await rejection(read(service, viewerOf('anonymous'), { version: 1 })))
        .code,
    ).toBe('BRAND_ICON_NOT_FOUND');
    expect(
      (await read(service, viewerOf('admin'), { version: 1 })).notModified,
    ).toBe(false);
  });

  it('gỡ phát hành thì bản đã công khai không còn đọc được', async () => {
    const { service } = await publishedWithDraft();
    await service.unpublish(ADMIN, 'icon-a');
    expect(
      (await rejection(read(service, viewerOf('anonymous'), { version: 1 })))
        .code,
    ).toBe('BRAND_ICON_NOT_FOUND');
  });

  it('quản trị không chỉ định phiên bản: bản đang phát hành nếu có, bản nháp mới nhất nếu chưa phát hành', async () => {
    const { service } = await publishedWithDraft();
    const live = await read(service, viewerOf('admin'));
    if (live.notModified) throw new Error('unreachable');
    expect(live.body).toContain('Biểu tượng A');
    await service.unpublish(ADMIN, 'icon-a');
    const latest = await read(service, viewerOf('admin'));
    if (latest.notModified) throw new Error('unreachable');
    expect(latest.body).toContain('Bản nháp hai');
  });

  it('ETag lấy từ sha của spec và trả 304 mà không đọc kho', async () => {
    const { service, objects } = await publishedWithDraft();
    const [, v1] = (await service.detail('icon-a')).versions;
    const first = await read(service, viewerOf('anonymous'), { version: 1 });
    expect(first.etag).toBe(`"${v1.specSha256}-brand-s0"`);
    const gets = objects.gets.length;
    const second = await read(
      service,
      viewerOf('anonymous'),
      { version: 1 },
      `W/"khac", ${first.etag}`,
    );
    expect(second).toMatchObject({ notModified: true, etag: first.etag });
    expect(objects.gets).toHaveLength(gets);
    expect(
      (await read(service, viewerOf('anonymous'), { version: 1 }, '*'))
        .notModified,
    ).toBe(true);
    expect(
      (await read(service, viewerOf('anonymous'), { version: 1 }, '"khac"'))
        .notModified,
    ).toBe(false);
    const mono = await read(service, viewerOf('anonymous'), {
      version: 1,
      mode: 'mono',
    });
    expect(mono.etag).toBe(`"${v1.specSha256}-mono"`);
  });

  it('chế độ mono trả SVG currentColor với tên tệp .mono.svg', async () => {
    const { service } = await publishedWithDraft();
    const mono = await read(service, viewerOf('anonymous'), {
      version: 1,
      mode: 'mono',
    });
    if (mono.notModified) throw new Error('unreachable');
    expect(mono.filename).toBe('bieu-tuong-a.mono.svg');
    expect(mono.body).toContain('currentColor');
    expect(mono.body).not.toContain('#2563eb');
  });

  it('BRAND_ICON_PUBLIC_READ=false: khách nhận 401, người đã đăng nhập đọc được bản phát hành (cache riêng)', async () => {
    const { service, flags } = await publishedWithDraft();
    flags.publicRead = false;
    expect(
      (await rejection(read(service, viewerOf('anonymous'), { version: 1 })))
        .status,
    ).toBe(401);
    expect(
      (
        await rejection(
          read(service, viewerOf('anonymous'), {}, undefined, 'khong-co'),
        )
      ).status,
    ).toBe(401);
    const user = await read(service, viewerOf('user'), { version: 1 });
    expect(user.cacheControl).toBe('private, max-age=31536000, immutable');
    expect(
      (await rejection(read(service, viewerOf('user'), { version: 2 }))).code,
    ).toBe('BRAND_ICON_NOT_FOUND');
    expect(
      (await read(service, viewerOf('admin'), { version: 2 })).notModified,
    ).toBe(false);
  });

  it('404 khi phiên bản không có và 400 khi mã không hợp lệ', async () => {
    const { service } = await publishedWithDraft();
    expect(
      (await rejection(read(service, viewerOf('admin'), { version: 9 }))).code,
    ).toBe('BRAND_ICON_VERSION_NOT_FOUND');
    expect(
      (await rejection(read(service, viewerOf('admin'), {}, undefined, '../x')))
        .code,
    ).toBe('BRAND_REQUEST_INVALID');
  });

  it('502 khi DB còn trỏ tới object đã mất, và bộ nhớ đệm không che việc mất object ở lần đọc đầu', async () => {
    const { service, objects } = await publishedWithDraft();
    objects.objects.delete('platform/brand/icons/icon-a/v1/icon.svg');
    expect(
      (await rejection(read(service, viewerOf('anonymous'), { version: 1 })))
        .code,
    ).toBe('BRAND_STORAGE_CORRUPT');
  });

  it('dùng bộ nhớ đệm cho object bất biến: đọc lần hai không gọi kho', async () => {
    const { service, objects } = await publishedWithDraft();
    await read(service, viewerOf('anonymous'), { version: 1 });
    const gets = objects.gets.length;
    await read(service, viewerOf('anonymous'), { version: 1 });
    expect(objects.gets).toHaveLength(gets);
  });
});

describe('BrandIconService – bảng màu và quy chuẩn', () => {
  const palette = (hex: string) => ({
    tokens: DEFAULT_PALETTE.tokens.map((token) =>
      token.key === 'sapphire' ? { ...token, hex } : token,
    ),
  });

  it('chưa lưu lần nào thì trả mặc định ở phiên bản 0', async () => {
    const { service } = setup();
    expect(await service.standards()).toEqual({
      version: 0,
      palette: DEFAULT_PALETTE,
      rules: DEFAULT_RULES,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it('lưu thành phiên bản 1 trong kho và đọc lại được', async () => {
    const { service, objects, store } = setup();
    const saved = await service.saveStandards(ADMIN, {
      palette: palette('#112233'),
      rules: DEFAULT_RULES,
      baseVersion: 0,
    });
    expect(saved).toMatchObject({
      version: 1,
      unchanged: false,
      updatedBy: ADMIN.userId,
    });
    expect(objects.keys()).toEqual([standardsObjectKey(1)]);
    expect(store.standardsRow).toMatchObject({
      currentVersion: 1,
      specKey: standardsObjectKey(1),
    });
    expect(store.audits.map((entry) => entry.action)).toEqual([
      'platform.brand-standards.updated',
    ]);

    // Dịch vụ mới (bộ nhớ đệm trống) đọc lại từ kho.
    const fresh = new BrandIconService(store, objects);
    const loaded = await fresh.standards();
    expect(loaded.version).toBe(1);
    expect(
      loaded.palette.tokens.find((token) => token.key === 'sapphire')?.hex,
    ).toBe('#112233');
  });

  it('cùng nội dung thì không tạo phiên bản; baseVersion lệch thì 409', async () => {
    const { service, objects } = setup();
    await service.saveStandards(ADMIN, {
      palette: palette('#112233'),
      rules: DEFAULT_RULES,
      baseVersion: 0,
    });
    const puts = objects.puts.length;
    const same = await service.saveStandards(ADMIN, {
      palette: palette('#112233'),
      rules: DEFAULT_RULES,
      baseVersion: 0,
    });
    expect(same).toMatchObject({ version: 1, unchanged: true });
    expect(objects.puts).toHaveLength(puts);

    const error = await rejection(
      service.saveStandards(ADMIN, {
        palette: palette('#445566'),
        rules: DEFAULT_RULES,
        baseVersion: 0,
      }),
    );
    expect([error.status, error.code]).toEqual([
      409,
      'BRAND_STANDARDS_VERSION_CONFLICT',
    ]);
    expect(error.extra).toEqual({ currentVersion: 1 });
    expect(
      (
        await service.saveStandards(ADMIN, {
          palette: palette('#445566'),
          rules: DEFAULT_RULES,
          baseVersion: 1,
        })
      ).version,
    ).toBe(2);
  });

  it.each([
    ['không có bảng màu', { rules: DEFAULT_RULES }],
    ['bảng màu rỗng', { palette: { tokens: [] }, rules: DEFAULT_RULES }],
    [
      'khoá sai mẫu',
      {
        palette: { tokens: [{ key: 'Khoá Sai', label: 'x', hex: '#ffffff' }] },
        rules: DEFAULT_RULES,
      },
    ],
    [
      'mã màu sai',
      {
        palette: { tokens: [{ key: 'ok', label: 'x', hex: 'xanh' }] },
        rules: DEFAULT_RULES,
      },
    ],
    [
      'trùng khoá',
      {
        palette: {
          tokens: [
            { key: 'a', label: 'a', hex: '#fff' },
            { key: 'a', label: 'b', hex: '#000' },
          ],
        },
        rules: DEFAULT_RULES,
      },
    ],
    ['thiếu quy chuẩn', { palette: DEFAULT_PALETTE }],
    [
      'quá nhiều màu',
      {
        palette: {
          tokens: Array.from({ length: 65 }, (_, i) => ({
            key: `c${i}`,
            label: 'c',
            hex: '#000000',
          })),
        },
        rules: DEFAULT_RULES,
      },
    ],
  ])('từ chối %s', async (_label, input) => {
    const { service, objects } = setup();
    const error = await rejection(
      service.saveStandards(ADMIN, { ...input, baseVersion: 0 }),
    );
    expect([error.status, error.code]).toEqual([
      400,
      'BRAND_STANDARDS_INVALID',
    ]);
    expect(objects.puts).toHaveLength(0);
  });

  it('dọn object khi cập nhật DB lỗi', async () => {
    const { service, store, objects } = setup();
    store.failAt = 'updateStandards';
    const error = await rejection(
      service.saveStandards(ADMIN, {
        palette: palette('#112233'),
        rules: DEFAULT_RULES,
        baseVersion: 0,
      }),
    );
    expect(error.code).toBe('BRAND_INTERNAL_ERROR');
    expect(objects.keys()).toEqual([]);
    expect(store.standardsRow.currentVersion).toBe(0);
  });

  it('icon tạo sau đó dùng bảng màu mới và ghi lại phiên bản đã dùng; lưu lại cùng nội dung dựng lại SVG', async () => {
    const { service, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    expect(
      objects.objects.get('platform/brand/icons/icon-a/v1/icon.svg')?.body,
    ).toContain('#2563eb');

    await service.saveStandards(ADMIN, {
      palette: palette('#112233'),
      rules: DEFAULT_RULES,
      baseVersion: 0,
    });
    const again = await service.update(ADMIN, 'icon-a', {
      document: sampleDocument(),
      baseVersion: 1,
    });
    expect(again.unchanged).toBe(false);
    expect(again.version).toMatchObject({ version: 2, standardsVersion: 1 });
    expect(
      objects.objects.get('platform/brand/icons/icon-a/v2/icon.svg')?.body,
    ).toContain('#112233');
    // Bản 1 giữ nguyên màu cũ.
    expect(
      objects.objects.get('platform/brand/icons/icon-a/v1/icon.svg')?.body,
    ).toContain('#2563eb');

    const other = await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-b', name: 'B' }),
    });
    expect(other.version.standardsVersion).toBe(1);
  });

  it('cảnh báo theo quy chuẩn (như quá số lớp gợi ý) không chặn phát hành, chỉ lỗi nặng mới chặn', async () => {
    const { service } = setup();
    await service.saveStandards(ADMIN, {
      palette: palette('#112233'),
      rules: { ...DEFAULT_RULES, maxShapes: 1 },
      baseVersion: 0,
    });
    await service.create(ADMIN, { document: sampleDocument() });
    // Vượt maxShapes chỉ là cảnh báo, không chặn phát hành.
    expect((await service.publish(ADMIN, 'icon-a')).status).toBe('published');
  });
});

describe('BrandIconService – quản lý & phát hành vị trí icon (slots)', () => {
  it('gán icon đã phát hành vào slot, ghi audit và trả danh sách slot', async () => {
    const { service, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.publish(ADMIN, 'icon-a');

    const assigned = await service.assignSlot(ADMIN, 'brand.logo', {
      iconId: 'icon-a',
    });
    expect(assigned).toMatchObject({
      slot: 'brand.logo',
      iconId: 'icon-a',
      iconName: 'Biểu tượng A',
      iconSlug: 'bieu-tuong-a',
      iconStatus: 'published',
      publishedVersion: 1,
      currentVersion: 1,
      updatedBy: ADMIN.userId,
    });

    const list = await service.listSlots();
    expect(list.slots).toHaveLength(1);
    expect(list.slots[0]).toEqual(assigned);
    expect(store.audits.at(-1)).toEqual({
      action: 'platform.brand-slot.assigned',
      actorId: ADMIN.userId,
      metadata: { slot: 'brand.logo', iconId: 'icon-a', publishedVersion: 1 },
    });
  });

  it('từ chối gán slot khi slot không hợp lệ, icon không tồn tại hoặc chưa phát hành', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });

    const badSlot = await rejection(
      service.assignSlot(ADMIN, 'invalid.slot', { iconId: 'icon-a' }),
    );
    expect([badSlot.status, badSlot.code]).toEqual([
      404,
      'BRAND_SLOT_NOT_FOUND',
    ]);

    const badIconId = await rejection(
      service.assignSlot(ADMIN, 'brand.logo', { iconId: '../bad' }),
    );
    expect([badIconId.status, badIconId.code]).toEqual([
      400,
      'BRAND_REQUEST_INVALID',
    ]);

    const missingIcon = await rejection(
      service.assignSlot(ADMIN, 'brand.logo', { iconId: 'missing' }),
    );
    expect([missingIcon.status, missingIcon.code]).toEqual([
      404,
      'BRAND_ICON_NOT_FOUND',
    ]);

    const draftIcon = await rejection(
      service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' }),
    );
    expect([draftIcon.status, draftIcon.code]).toEqual([
      422,
      'BRAND_SLOT_ICON_NOT_PUBLISHED',
    ]);
  });

  it('xoá gán slot idempotent và chỉ ghi audit khi thực sự có xoá', async () => {
    const { service, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.publish(ADMIN, 'icon-a');
    await service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' });
    const auditCountBefore = store.audits.length;

    const first = await service.clearSlot(ADMIN, 'brand.logo');
    expect(first).toEqual({ slot: 'brand.logo', cleared: true });
    expect(store.audits).toHaveLength(auditCountBefore + 1);
    expect(store.audits.at(-1)).toEqual({
      action: 'platform.brand-slot.cleared',
      actorId: ADMIN.userId,
      metadata: { slot: 'brand.logo' },
    });

    const second = await service.clearSlot(ADMIN, 'brand.logo');
    expect(second).toEqual({ slot: 'brand.logo', cleared: false });
    expect(store.audits).toHaveLength(auditCountBefore + 1);
  });

  it('hoàn tác gán/xoá slot khi giao dịch DB lỗi ở bước audit', async () => {
    const { service, store } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.publish(ADMIN, 'icon-a');

    store.failAt = 'audit';
    await rejection(
      service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' }),
    );
    expect(store.slots).toHaveLength(0);

    store.failAt = null;
    await service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' });
    store.failAt = 'audit';
    await rejection(service.clearSlot(ADMIN, 'brand.logo'));
    expect(store.slots).toHaveLength(1);
  });

  it('slotManifest dựng model đúng colorMode & idPrefix, hỗ trợ If-None-Match 304 và bỏ qua icon đã ngừng phát hành', async () => {
    const { service, flags, objects } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.publish(ADMIN, 'icon-a');
    await service.create(ADMIN, {
      document: sampleDocument({ id: 'icon-b', name: 'B' }),
    });
    await service.publish(ADMIN, 'icon-b');

    await service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' });
    await service.assignSlot(ADMIN, 'nav.dashboard', { iconId: 'icon-b' });

    const viewer = viewerOf('anonymous');
    const res = await service.slotManifest(viewer);
    expect(viewer).not.toHaveBeenCalled();
    expect(res.notModified).toBe(false);
    if (res.notModified) throw new Error('expected manifest');
    expect(res.cacheControl).toBe('public, no-cache, must-revalidate');
    expect(Object.keys(res.manifest.slots)).toEqual([
      'brand.logo',
      'nav.dashboard',
    ]);
    expect(res.manifest.slots['brand.logo']).toMatchObject({
      slot: 'brand.logo',
      iconId: 'icon-a',
      version: 1,
      colorMode: 'brand',
    });
    expect(res.manifest.slots['nav.dashboard']).toMatchObject({
      slot: 'nav.dashboard',
      iconId: 'icon-b',
      version: 1,
      colorMode: 'mono',
    });

    // If-None-Match khớp -> 304 mà không đọc lại object
    const getsBefore = objects.gets.length;
    const cached = await service.slotManifest(viewer, res.etag);
    expect(cached).toEqual({
      notModified: true,
      etag: res.etag,
      cacheControl: 'public, no-cache, must-revalidate',
    });
    expect(objects.gets).toHaveLength(getsBefore);

    // Ngừng phát hành icon-b -> biến mất khỏi manifest và đổi etag
    await service.unpublish(ADMIN, 'icon-b');
    const afterUnpublish = await service.slotManifest(viewer);
    expect(afterUnpublish.notModified).toBe(false);
    if (afterUnpublish.notModified) throw new Error('expected manifest');
    expect(Object.keys(afterUnpublish.manifest.slots)).toEqual(['brand.logo']);
    expect(afterUnpublish.etag).not.toBe(res.etag);

    // Khi publicRead = false: anonymous bị 401, user đã đăng nhập đọc được với private cache
    flags.publicRead = false;
    const unauth = await rejection(
      service.slotManifest(viewerOf('anonymous')),
    );
    expect([unauth.status, unauth.code]).toEqual([401, 'UNAUTHORIZED']);
    const authed = await service.slotManifest(viewerOf('user'));
    expect(authed.cacheControl).toBe('private, no-cache');
  });

  it('readSlotSvg trả SVG theo đúng colorMode của slot và hỗ trợ 304', async () => {
    const { service } = setup();
    await service.create(ADMIN, { document: sampleDocument() });
    await service.publish(ADMIN, 'icon-a');
    await service.assignSlot(ADMIN, 'brand.logo', { iconId: 'icon-a' });
    await service.assignSlot(ADMIN, 'nav.dashboard', { iconId: 'icon-a' });

    const brandSvg = await service.readSlotSvg(
      'brand.logo',
      viewerOf('anonymous'),
    );
    expect(brandSvg.notModified).toBe(false);
    if (brandSvg.notModified) throw new Error('expected body');
    expect(brandSvg.body).toContain('#2563eb');
    expect(brandSvg.filename).toBe('brand.logo.svg');

    const monoSvg = await service.readSlotSvg(
      'nav.dashboard',
      viewerOf('anonymous'),
    );
    expect(monoSvg.notModified).toBe(false);
    if (monoSvg.notModified) throw new Error('expected body');
    expect(monoSvg.body).toContain('currentColor');
    expect(monoSvg.filename).toBe('nav.dashboard.mono.svg');

    const cached = await service.readSlotSvg(
      'nav.dashboard',
      viewerOf('anonymous'),
      monoSvg.etag,
    );
    expect(cached.notModified).toBe(true);

    // Slot chưa gán -> 404
    const empty = await rejection(
      service.readSlotSvg('module.finance', viewerOf('anonymous')),
    );
    expect([empty.status, empty.code]).toEqual([404, 'BRAND_SLOT_NOT_FOUND']);
  });

  describe('custom slots', () => {
    it('tạo, cập nhật, xoá vị trí tuỳ chỉnh và đồng bộ với manifest/svg', async () => {
      const { service, store } = setup();
      await service.create(ADMIN, { document: sampleDocument() });
      await service.publish(ADMIN, 'icon-a');

      // 1. Tạo vị trí tuỳ chỉnh mới
      const created = await service.createCustomSlot(ADMIN, {
        id: 'custom.dashboard-banner',
        label: 'Banner trang chủ',
        description: 'Banner kích thước lớn',
        groupKey: 'custom',
        colorMode: 'brand',
        recommendedSize: 48,
      });
      expect(created).toMatchObject({
        id: 'custom.dashboard-banner',
        label: 'Banner trang chủ',
        isCustom: true,
      });
      expect(store.audits.at(-1)).toEqual({
        action: 'platform.brand-slot-definition.created',
        actorId: ADMIN.userId,
        metadata: { slot: 'custom.dashboard-banner', label: 'Banner trang chủ' },
      });

      // 2. Kiểm tra danh sách definitions và slots
      const defs = await service.listSlotDefinitions();
      expect(defs.some((d) => d.id === 'custom.dashboard-banner')).toBe(true);

      const slotsResponse = await service.listSlots();
      expect(slotsResponse.definitions?.some((d) => d.id === 'custom.dashboard-banner')).toBe(true);

      // 3. Gán icon cho vị trí tuỳ chỉnh
      const assigned = await service.assignSlot(ADMIN, 'custom.dashboard-banner', {
        iconId: 'icon-a',
      });
      expect(assigned.slot).toBe('custom.dashboard-banner');

      // 4. Kiểm tra manifest và readSlotSvg
      const manifest = await service.slotManifest(viewerOf('anonymous'));
      if (manifest.notModified) throw new Error('expected manifest');
      expect(manifest.manifest.slots['custom.dashboard-banner']).toBeDefined();

      const svgResult = await service.readSlotSvg(
        'custom.dashboard-banner',
        viewerOf('anonymous'),
      );
      expect(svgResult.notModified).toBe(false);

      // 5. Cập nhật vị trí tuỳ chỉnh
      const updated = await service.updateCustomSlot(
        ADMIN,
        'custom.dashboard-banner',
        { label: 'Banner trang chủ mới' },
      );
      expect(updated.label).toBe('Banner trang chủ mới');

      // 6. Xoá vị trí tuỳ chỉnh -> cascade xoá gán icon
      const del = await service.deleteCustomSlot(ADMIN, 'custom.dashboard-banner');
      expect(del.deleted).toBe(true);
      const afterDel = await service.listSlots();
      expect(afterDel.slots.some((s) => s.slot === 'custom.dashboard-banner')).toBe(false);
      expect(afterDel.definitions?.some((d) => d.id === 'custom.dashboard-banner')).toBe(false);
    });

    it('từ chối can thiệp vào vị trí hệ thống cố định', async () => {
      const { service } = setup();

      const dupBuiltIn = await rejection(
        service.createCustomSlot(ADMIN, {
          id: 'brand.logo',
          label: 'Logo trùng',
        }),
      );
      expect([dupBuiltIn.status, dupBuiltIn.code]).toEqual([
        409,
        'BRAND_SLOT_CONFLICT',
      ]);

      const updateBuiltIn = await rejection(
        service.updateCustomSlot(ADMIN, 'brand.logo', { label: 'Sửa logo' }),
      );
      expect([updateBuiltIn.status, updateBuiltIn.code]).toEqual([
        400,
        'BRAND_SLOT_BUILTIN_CANNOT_MODIFY',
      ]);

      const deleteBuiltIn = await rejection(
        service.deleteCustomSlot(ADMIN, 'brand.logo'),
      );
      expect([deleteBuiltIn.status, deleteBuiltIn.code]).toEqual([
        400,
        'BRAND_SLOT_BUILTIN_CANNOT_MODIFY',
      ]);
    });
  });
});

describe('BrandIconService – nhóm vị trí (slot groups)', () => {
  const codeOf = (error: BrandError) => [error.status, error.code];

  it('liệt kê 8 nhóm có sẵn đúng thứ tự cùng slotCount của vị trí có sẵn', async () => {
    const { service } = setup();
    const { groups } = await service.listSlotGroups();
    expect(groups.slice(0, 8).map((g) => g.key)).toEqual([
      'brand',
      'module',
      'nav',
      'header',
      'shell',
      'dashboard',
      'sidebar',
      'custom',
    ]);
    expect(groups.every((g) => g.isBuiltIn)).toBe(true);
    expect(groups.find((g) => g.key === 'brand')!.slotCount).toBeGreaterThan(0);
  });

  it('tạo nhóm: sinh mã từ tên có dấu, ghi nhật ký và hiện sau nhóm có sẵn', async () => {
    const { service, store } = setup();
    const created = await service.createSlotGroup(ADMIN, {
      label: '  Trung tâm trợ giúp  ',
    });
    expect(created).toEqual({
      key: 'trung-tam-tro-giup',
      label: 'Trung tâm trợ giúp',
      isBuiltIn: false,
      slotCount: 0,
    });
    expect(store.audits.at(-1)).toEqual({
      action: 'platform.brand-slot-group.created',
      actorId: ADMIN.userId,
      metadata: { group: 'trung-tam-tro-giup', label: 'Trung tâm trợ giúp' },
    });
    const { groups } = await service.listSlotGroups();
    expect(groups).toHaveLength(9);
    expect(groups[8]).toMatchObject({
      key: 'trung-tam-tro-giup',
      isBuiltIn: false,
    });
  });

  it('sinh mã: đ thành d, tiền tố g- khi bắt đầu bằng số, hậu tố khi trùng', async () => {
    const { service } = setup();
    expect(
      (await service.createSlotGroup(ADMIN, { label: 'Đường đi' })).key,
    ).toBe('duong-di');
    expect(
      (await service.createSlotGroup(ADMIN, { label: '2024 báo cáo' })).key,
    ).toBe('g-2024-bao-cao');
    expect(
      (await service.createSlotGroup(ADMIN, { label: 'Đường đi' })).key,
    ).toBe('duong-di-2');
    expect(
      (await service.createSlotGroup(ADMIN, { label: 'duong di' })).key,
    ).toBe('duong-di-3');
    // Trùng nhóm có sẵn khi sinh tự động thì thêm hậu tố, không báo lỗi.
    expect(
      (await service.createSlotGroup(ADMIN, { label: 'Brand' })).key,
    ).toBe('brand-2');
  });

  it('mã chỉ định: sai mẫu là 400, trùng nhóm có sẵn hoặc nhóm tùy chỉnh là 409', async () => {
    const { service } = setup();
    const bad = await rejection(
      service.createSlotGroup(ADMIN, { label: 'A', key: 'Sai Mã' }),
    );
    expect(codeOf(bad)).toEqual([400, 'BRAND_REQUEST_INVALID']);

    const builtIn = await rejection(
      service.createSlotGroup(ADMIN, { label: 'A', key: 'nav' }),
    );
    expect(codeOf(builtIn)).toEqual([409, 'BRAND_SLOT_GROUP_CONFLICT']);

    await service.createSlotGroup(ADMIN, { label: 'Một', key: 'nhom-mot' });
    const dup = await rejection(
      service.createSlotGroup(ADMIN, { label: 'Hai', key: 'nhom-mot' }),
    );
    expect(codeOf(dup)).toEqual([409, 'BRAND_SLOT_GROUP_CONFLICT']);
  });

  it('tên nhóm: bắt buộc và tối đa 60 ký tự', async () => {
    const { service } = setup();
    for (const label of ['', '   ', 'x'.repeat(61), 7]) {
      const error = await rejection(service.createSlotGroup(ADMIN, { label }));
      expect(codeOf(error)).toEqual([400, 'BRAND_REQUEST_INVALID']);
    }
    const ok = await service.createSlotGroup(ADMIN, { label: 'y'.repeat(60) });
    expect(ok.label).toHaveLength(60);
    expect(ok.key).toHaveLength(32);
  });

  it('sửa tên chỉ đổi nhãn, giữ mã; nhóm có sẵn 409, không tồn tại 404', async () => {
    const { service, store } = setup();
    await service.createSlotGroup(ADMIN, { label: 'Cũ', key: 'nhom-cu' });
    const updated = await service.updateSlotGroup(ADMIN, 'nhom-cu', {
      label: ' Mới ',
    });
    expect(updated).toMatchObject({
      key: 'nhom-cu',
      label: 'Mới',
      isBuiltIn: false,
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: 'platform.brand-slot-group.updated',
      metadata: { group: 'nhom-cu', label: 'Mới' },
    });

    const builtIn = await rejection(
      service.updateSlotGroup(ADMIN, 'brand', { label: 'X' }),
    );
    expect(codeOf(builtIn)).toEqual([
      409,
      'BRAND_SLOT_GROUP_BUILTIN_CANNOT_MODIFY',
    ]);
    const missing = await rejection(
      service.updateSlotGroup(ADMIN, 'khong-co', { label: 'X' }),
    );
    expect(codeOf(missing)).toEqual([404, 'BRAND_SLOT_GROUP_NOT_FOUND']);
    const empty = await rejection(
      service.updateSlotGroup(ADMIN, 'nhom-cu', { label: ' ' }),
    );
    expect(codeOf(empty)).toEqual([400, 'BRAND_REQUEST_INVALID']);
  });

  it('xoá: nhóm có sẵn 409, không tồn tại 404, đang dùng 409 kèm số vị trí, thành công', async () => {
    const { service, store } = setup();
    const builtIn = await rejection(service.deleteSlotGroup(ADMIN, 'custom'));
    expect(codeOf(builtIn)).toEqual([
      409,
      'BRAND_SLOT_GROUP_BUILTIN_CANNOT_MODIFY',
    ]);
    const missing = await rejection(
      service.deleteSlotGroup(ADMIN, 'khong-co'),
    );
    expect(codeOf(missing)).toEqual([404, 'BRAND_SLOT_GROUP_NOT_FOUND']);

    await service.createSlotGroup(ADMIN, {
      label: 'Trợ giúp',
      key: 'tro-giup',
    });
    await service.createCustomSlot(ADMIN, {
      id: 'custom.help-icon',
      label: 'Icon trợ giúp',
      groupKey: 'tro-giup',
    });
    const inUse = await rejection(service.deleteSlotGroup(ADMIN, 'tro-giup'));
    expect(codeOf(inUse)).toEqual([409, 'BRAND_SLOT_GROUP_IN_USE']);
    expect(inUse.message).toContain('1 vị trí');
    expect(inUse.extra).toEqual({ slotCount: 1 });

    await service.deleteCustomSlot(ADMIN, 'custom.help-icon');
    await expect(service.deleteSlotGroup(ADMIN, 'tro-giup')).resolves.toEqual({
      key: 'tro-giup',
      deleted: true,
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: 'platform.brand-slot-group.deleted',
      metadata: { group: 'tro-giup' },
    });
    expect((await service.listSlotGroups()).groups).toHaveLength(8);
  });

  it('tạo và sửa vị trí với nhóm không tồn tại là 400 BRAND_SLOT_GROUP_NOT_FOUND', async () => {
    const { service } = setup();
    const create = await rejection(
      service.createCustomSlot(ADMIN, {
        id: 'custom.a-icon',
        label: 'A',
        groupKey: 'khong-co',
      }),
    );
    expect(codeOf(create)).toEqual([400, 'BRAND_SLOT_GROUP_NOT_FOUND']);

    // Mặc định là nhóm "custom"; nhóm có sẵn dùng được mà không cần có dòng trong DB.
    const made = await service.createCustomSlot(ADMIN, {
      id: 'custom.a-icon',
      label: 'A',
    });
    expect(made.group).toBe('custom');
    const toBuiltIn = await service.updateCustomSlot(ADMIN, 'custom.a-icon', {
      groupKey: 'nav',
    });
    expect(toBuiltIn.group).toBe('nav');

    const update = await rejection(
      service.updateCustomSlot(ADMIN, 'custom.a-icon', {
        groupKey: 'khong-co',
      }),
    );
    expect(codeOf(update)).toEqual([400, 'BRAND_SLOT_GROUP_NOT_FOUND']);

    await service.createSlotGroup(ADMIN, { label: 'Mới', key: 'nhom-moi' });
    const moved = await service.updateCustomSlot(ADMIN, 'custom.a-icon', {
      groupKey: 'nhom-moi',
    });
    expect(moved.group).toBe('nhom-moi');
  });

  it('listSlots trả groups với slotCount cộng vị trí có sẵn và vị trí tùy chỉnh', async () => {
    const { service } = setup();
    const before = await service.listSlots();
    const customBefore = before.groups!.find((g) => g.key === 'custom')!
      .slotCount;
    const navBefore = before.groups!.find((g) => g.key === 'nav')!.slotCount;

    await service.createSlotGroup(ADMIN, {
      label: 'Trợ giúp',
      key: 'tro-giup',
    });
    await service.createCustomSlot(ADMIN, {
      id: 'custom.x1',
      label: 'X1',
      groupKey: 'tro-giup',
    });
    await service.createCustomSlot(ADMIN, {
      id: 'custom.x2',
      label: 'X2',
      groupKey: 'tro-giup',
    });
    await service.createCustomSlot(ADMIN, {
      id: 'custom.x3',
      label: 'X3',
      groupKey: 'nav',
    });
    await service.createCustomSlot(ADMIN, { id: 'custom.x4', label: 'X4' });

    const after = await service.listSlots();
    const byKey = new Map(after.groups!.map((g) => [g.key, g]));
    expect(byKey.get('tro-giup')).toMatchObject({
      isBuiltIn: false,
      slotCount: 2,
      label: 'Trợ giúp',
    });
    expect(byKey.get('nav')!.slotCount).toBe(navBefore + 1);
    expect(byKey.get('custom')!.slotCount).toBe(customBefore + 1);
  });
});
