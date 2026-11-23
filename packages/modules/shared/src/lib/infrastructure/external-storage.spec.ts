import type { S3ObjectStorageOptions } from '@enterprise-platform/adapter-storage';
import { Readable } from 'node:stream';
import type { SharedActor } from '../application/shared-actor.js';
import type { PlatformObject, SharedStore, StorageSettingsInput, StorageSettingsRow } from '../application/shared-store.port.js';
import { StorageSettingsService } from '../application/storage-settings.service.js';
import { SharedForbiddenError, SharedStorageUnavailableError, SharedValidationError } from '../domain/shared.error.js';
import { endpointPolicy } from './endpoint-policy.js';
import { StorageSecrets } from './storage-secrets.js';
import { TenantStorageRouter, type StreamingStorage } from './tenant-storage-router.js';

const SECRET = 'khoa-goc-cua-may-chu-dai-hon-32-ky-tu-0123';
const TENANT = 'tenant-1';

describe('StorageSecrets', () => {
  const secrets = StorageSecrets.fromSecret(SECRET);

  it('mã hoá rồi giải mã lại đúng; mỗi lần mã ra một bản khác', () => {
    const first = secrets.encrypt('mat-khau-kho');
    const second = secrets.encrypt('mat-khau-kho');
    expect(first).not.toContain('mat-khau-kho');
    expect(first).not.toEqual(second);
    expect(secrets.decrypt(first)).toBe('mat-khau-kho');
  });

  it('bản mã bị sửa hoặc mã bằng khoá gốc khác thì không giải được', () => {
    const cipher = secrets.encrypt('mat-khau-kho');
    const parts = cipher.split('.');
    parts[3] = Buffer.from('khac').toString('base64url');
    expect(() => secrets.decrypt(parts.join('.'))).toThrow();
    expect(() => StorageSecrets.fromSecret(`${SECRET}-khac`).decrypt(cipher)).toThrow();
  });

  it('chưa đặt khoá gốc, hoặc khoá ngắn hơn 32 ký tự, thì coi như chưa bật', () => {
    expect(StorageSecrets.fromEnv({})).toBeUndefined();
    expect(StorageSecrets.fromEnv({ SHARED_STORAGE_SECRET_KEY: 'ngan' })).toBeUndefined();
    expect(StorageSecrets.fromEnv({ SHARED_STORAGE_SECRET_KEY: SECRET })).toBeInstanceOf(StorageSecrets);
  });

  it('phiếu chỉ hợp lệ khi đúng chữ ký, còn hạn và đúng thao tác', () => {
    const now = 1_800_000_000_000;
    const token = secrets.signTicket({ t: TENANT, k: 'a/b.pdf', o: 'get', e: now / 1000 + 60 });
    expect(secrets.verifyTicket(token, 'get', now)).toMatchObject({ t: TENANT, k: 'a/b.pdf' });
    expect(secrets.verifyTicket(token, 'put', now)).toBeUndefined();
    expect(secrets.verifyTicket(token, 'get', now + 61_000)).toBeUndefined();
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'tenant-khac', k: 'a/b.pdf', o: 'get', e: now / 1000 + 60 })).toString('base64url');
    expect(secrets.verifyTicket(`${forged}.${signature}`, 'get', now)).toBeUndefined();
    expect(StorageSecrets.fromSecret(`${SECRET}-khac`).verifyTicket(token, 'get', now)).toBeUndefined();
    expect(secrets.verifyTicket(`${payload}`, 'get', now)).toBeUndefined();
  });
});

describe('endpointPolicy', () => {
  const resolve = async (host: string) => (host === 'kho.congty.vn' ? ['203.0.113.10'] : ['10.0.0.5']);

  it('có danh sách cho phép: chỉ máy chủ khớp tên, đuôi tên hay dải CIDR; http cũng được', async () => {
    const policy = endpointPolicy({ allowList: '100.64.0.0/10, nas.congty.vn, *.s3.congty.vn', resolve });
    await expect(policy.check('http://100.101.2.3:9000')).resolves.toBeUndefined();
    await expect(policy.check('http://nas.congty.vn:9000')).resolves.toBeUndefined();
    await expect(policy.check('https://hn.s3.congty.vn')).resolves.toBeUndefined();
    await expect(policy.check('http://10.0.0.5:9000')).resolves.toMatch(/danh sách kho được phép/);
    await expect(policy.check('http://minio:9000')).resolves.toMatch(/danh sách kho được phép/);
  });

  it('không có danh sách: chỉ kho công khai qua https, chặn địa chỉ và tên máy nội bộ', async () => {
    const policy = endpointPolicy({ allowList: '', resolve });
    await expect(policy.check('https://kho.congty.vn')).resolves.toBeUndefined();
    await expect(policy.check('http://kho.congty.vn')).resolves.toMatch(/https/);
    await expect(policy.check('https://192.168.1.10:9000')).resolves.toMatch(/mạng nội bộ/);
    await expect(policy.check('https://127.0.0.1')).resolves.toMatch(/mạng nội bộ/);
    await expect(policy.check('https://[::1]:9000')).resolves.toMatch(/mạng nội bộ/);
    await expect(policy.check('https://minio:9000')).resolves.toMatch(/tên nội bộ/);
    await expect(policy.check('https://kho-noi-bo.vn')).resolves.toMatch(/trỏ vào mạng nội bộ/);
  });

  it('chỉ nhận giao thức, máy chủ và cổng', async () => {
    const policy = endpointPolicy({ allowList: '*', resolve });
    await expect(policy.check('ftp://nas:21')).resolves.toMatch(/http/);
    await expect(policy.check('http://user:pass@nas:9000')).resolves.toMatch(/tài khoản/);
    await expect(policy.check('http://nas:9000/bucket')).resolves.toMatch(/đường dẫn/);
    await expect(policy.check('khong phai url')).resolves.toMatch(/URL/);
  });
});

/** Kho giả ghi nhớ object trong bộ nhớ, đọc ghi được bằng luồng như kho thật. */
function memoryStorage(name: string) {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const log: string[] = [];
  const storage: StreamingStorage = {
    createUploadUrl: async (input) => `https://${name}/upload/${input.key}`,
    createDownloadUrl: async (key) => `https://${name}/download/${key}`,
    putObject: async (input) => {
      objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
    },
    copyObject: async (input) => {
      log.push(`copy ${input.from} -> ${input.to}`);
      objects.set(input.to, objects.get(input.from)!);
    },
    deleteObjects: async (keys) => {
      for (const key of keys) objects.delete(key);
      log.push(`delete ${keys.join(',')}`);
      return { failed: [] };
    },
    openStream: async (key) => {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return { body: Readable.from([object.body]), contentType: object.contentType, contentLength: object.body.length };
    },
    uploadStream: async (key, body, contentType) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
      const buffer = Buffer.concat(chunks);
      objects.set(key, { body: buffer, contentType });
      return { sizeBytes: buffer.length };
    },
  };
  return { storage, objects, log };
}

function settingsRow(patch: Partial<StorageSettingsRow> = {}): StorageSettingsRow {
  return {
    enabled: true,
    label: 'NAS văn phòng',
    accessMode: 'proxy',
    endpoint: 'http://100.101.2.3:9000',
    publicEndpoint: null,
    region: 'us-east-1',
    bucket: 'erp-documents',
    pathStyle: true,
    accessKeyId: 'erp-key',
    secretCiphertext: StorageSecrets.fromSecret(SECRET).encrypt('erp-secret'),
    version: 1,
    updatedBy: 'admin-1',
    updatedAt: '2026-11-22T00:00:00.000Z',
    ...patch,
  };
}

function routerSetup(options: { row?: StorageSettingsRow; secrets?: StorageSecrets | null; probeFails?: boolean } = {}) {
  const platform = memoryStorage('platform');
  const external = memoryStorage('nas');
  const created: S3ObjectStorageOptions[] = [];
  const state: { row?: StorageSettingsRow; reads: number } = { row: options.row, reads: 0 };
  const settingsStore: Pick<SharedStore, 'storageSettings'> = {
    storageSettings: {
      get: async () => {
        state.reads += 1;
        return state.row;
      },
      save: async (_tenant, userId, input: StorageSettingsInput, expectedVersion) => {
        if (expectedVersion !== undefined && state.row && state.row.version !== expectedVersion) return undefined;
        state.row = { ...input, version: (state.row?.version ?? 0) + 1, updatedBy: userId, updatedAt: '2026-11-22T01:00:00.000Z' };
        return state.row;
      },
    },
  };
  const clock = { now: 1_800_000_000_000 };
  const router = new TenantStorageRouter(settingsStore, {
    platform: platform.storage,
    secrets: options.secrets === undefined ? StorageSecrets.fromSecret(SECRET) : options.secrets,
    policy: endpointPolicy({ allowList: '100.64.0.0/10', resolve: async () => [] }),
    createStorage: (storageOptions) => {
      created.push(storageOptions);
      if (options.probeFails) {
        return {
          ...external.storage,
          putObject: async () => {
            throw Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
          },
        };
      }
      return external.storage;
    },
    now: () => clock.now,
    probeTimeoutMs: 1000,
  });
  return { router, platform, external, created, state, settingsStore, clock };
}

describe('TenantStorageRouter', () => {
  it('chưa cấu hình kho ngoài thì tệp mới vào kho của nền tảng', async () => {
    const { router, platform } = routerSetup();
    const target = await router.forUpload(TENANT);
    expect(target.location).toBe('platform');
    expect(target.storage).toBe(platform.storage);
    await expect(router.at(TENANT, 'external')).rejects.toBeInstanceOf(SharedStorageUnavailableError);
  });

  it('bật kho ngoài chế độ proxy: URL trỏ về route chuyển tiếp, phiếu ký đúng tenant và khoá', async () => {
    const { router, created } = routerSetup({ row: settingsRow() });
    const target = await router.forUpload(TENANT);
    expect(target.location).toBe('external');
    expect(created[0]).toMatchObject({
      internalEndpoint: 'http://100.101.2.3:9000',
      bucket: 'erp-documents',
      accessKeyId: 'erp-key',
      secretAccessKey: 'erp-secret',
      forcePathStyle: true,
    });
    const uploadUrl = await target.storage.createUploadUrl({ key: 'tenants/t/shared/x/v1-a.pdf', contentType: 'application/pdf' });
    expect(uploadUrl).toMatch(/^\/api\/shared\/v1\/files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const token = uploadUrl.split('/').pop()!;
    expect(router.verifyTicket(token, 'put')).toMatchObject({ t: TENANT, k: 'tenants/t/shared/x/v1-a.pdf', c: 'application/pdf' });
    expect(router.verifyTicket(token, 'get')).toBeUndefined();
    const downloadUrl = await target.storage.createDownloadUrl('tenants/t/shared/x/v1-a.pdf', 300, { inline: true, fileName: 'a.pdf' });
    expect(router.verifyTicket(downloadUrl.split('/').pop()!, 'get')).toMatchObject({ d: 'inline', n: 'a.pdf' });
  });

  it('chế độ direct trả URL ký sẵn của chính kho; tắt kho thì tệp mới về nền tảng nhưng tệp cũ vẫn đọc được', async () => {
    const { router, external, state } = routerSetup({ row: settingsRow({ accessMode: 'direct', publicEndpoint: 'https://nas.congty.vn' }) });
    expect((await router.forUpload(TENANT)).storage).toBe(external.storage);
    state.row = settingsRow({ enabled: false });
    router.invalidate(TENANT);
    expect((await router.forUpload(TENANT)).location).toBe('platform');
    expect(await router.at(TENANT, 'external')).toBeDefined();
  });

  it('cấu hình giữ 30 giây, lưu mới thì làm mới ngay', async () => {
    const { router, state, clock } = routerSetup({ row: settingsRow() });
    await router.forUpload(TENANT);
    await router.forUpload(TENANT);
    expect(state.reads).toBe(1);
    clock.now += 31_000;
    await router.forUpload(TENANT);
    expect(state.reads).toBe(2);
    router.invalidate(TENANT);
    await router.forUpload(TENANT);
    expect(state.reads).toBe(3);
  });

  it('đã cấu hình kho ngoài mà máy chủ thiếu khoá gốc thì báo lỗi, không lặng lẽ lưu vào nền tảng', async () => {
    const { router } = routerSetup({ row: settingsRow(), secrets: null });
    await expect(router.forUpload(TENANT)).rejects.toBeInstanceOf(SharedStorageUnavailableError);
  });

  it('chép giữa hai kho đi bằng luồng; cùng kho thì chép tại chỗ', async () => {
    const { router, platform, external } = routerSetup({ row: settingsRow() });
    await platform.storage.putObject({ key: 'k1', contentType: 'application/pdf', body: new Uint8Array([1, 2, 3]) });
    await expect(
      router.copy(TENANT, { key: 'k1', location: 'platform' }, { key: 'k1', location: 'external' }, 'application/pdf'),
    ).resolves.toEqual({ sizeBytes: 3 });
    expect([...external.objects.get('k1')!.body]).toEqual([1, 2, 3]);
    await router.copy(TENANT, { key: 'k1', location: 'external' }, { key: 'k2', location: 'external' }, 'application/pdf');
    expect(external.log).toContain('copy k1 -> k2');
  });

  it('thử kết nối: ghi, đọc, xoá tệp thử; lỗi mạng thành câu dễ hiểu', async () => {
    const ok = routerSetup();
    const config = { ...settingsRow(), secretAccessKey: 'erp-secret' };
    await expect(ok.router.probe(config)).resolves.toMatchObject({ ok: true });
    expect(ok.external.objects.size).toBe(0);
    const refused = routerSetup({ probeFails: true });
    await expect(refused.router.probe(config)).resolves.toEqual({ ok: false, message: expect.stringMatching(/từ chối kết nối/) });
    await expect(ok.router.probe({ ...config, endpoint: 'http://10.0.0.5:9000' })).resolves.toMatchObject({ ok: false });
  });
});

function actor(patch: Partial<SharedActor> = {}): SharedActor {
  return {
    tenantId: TENANT,
    userId: 'admin-1',
    displayName: 'Quản trị',
    isTenantAdmin: true,
    canManage: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
    ...patch,
  };
}

function serviceSetup(options: Parameters<typeof routerSetup>[0] & { pending?: PlatformObject[] } = {}) {
  const setup = routerSetup(options);
  const pending = [...(options.pending ?? [])];
  const marked: string[] = [];
  const store = {
    ...setup.settingsStore,
    storage: {
      locationUsage: async () => ({ platform: { files: pending.length, bytes: 10 }, external: { files: marked.length, bytes: 0 } }),
      platformObjects: async (_tenant: string, limit: number) => pending.filter((item) => !marked.includes(item.versionId)).slice(0, limit),
      countPlatformObjects: async () => pending.filter((item) => !marked.includes(item.versionId)).length,
      markExternal: async (_tenant: string, versionId: string) => {
        marked.push(versionId);
        return true;
      },
    },
    people: { list: async () => [{ id: 'admin-1', name: 'Chị Quản trị', active: true }] },
  } as unknown as SharedStore;
  return { ...setup, service: new StorageSettingsService(store, setup.router), marked };
}

const saveInput = {
  enabled: true,
  label: 'NAS văn phòng',
  accessMode: 'proxy' as const,
  endpoint: 'http://100.101.2.3:9000/',
  bucket: 'erp-documents',
  accessKeyId: 'erp-key',
  secretAccessKey: 'erp-secret',
};

describe('StorageSettingsService', () => {
  it('quản trị kho xem được, không thấy secret; chỉ quản trị tenant được sửa', async () => {
    const { service } = serviceSetup({ row: settingsRow() });
    const view = await service.get(actor({ isTenantAdmin: false }));
    expect(view).toMatchObject({ configured: true, enabled: true, hasSecret: true, editable: false, updatedByName: 'Chị Quản trị' });
    expect(JSON.stringify(view)).not.toContain('erp-secret');
    await expect(service.get(actor({ isTenantAdmin: false, canManage: false }))).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.save(actor({ isTenantAdmin: false }), saveInput)).rejects.toBeInstanceOf(SharedForbiddenError);
  });

  it('lưu: chuẩn hoá địa chỉ, mã hoá secret; để trống secret thì giữ secret cũ', async () => {
    const { service, state, router } = serviceSetup();
    await service.save(actor(), saveInput);
    expect(state.row).toMatchObject({ endpoint: 'http://100.101.2.3:9000', enabled: true });
    expect(state.row!.secretCiphertext).not.toContain('erp-secret');
    expect(router.decryptSecret(state.row!.secretCiphertext)).toBe('erp-secret');
    await service.save(actor(), { ...saveInput, secretAccessKey: '', label: 'NAS mới', version: 1 });
    expect(state.row).toMatchObject({ label: 'NAS mới', version: 2 });
    expect(router.decryptSecret(state.row!.secretCiphertext)).toBe('erp-secret');
  });

  it('bật kho mà chưa kết nối được thì không lưu; tắt thì lưu không cần thử', async () => {
    const { service, state } = serviceSetup({ probeFails: true });
    await expect(service.save(actor(), saveInput)).rejects.toThrow(/chưa kết nối được kho/);
    expect(state.row).toBeUndefined();
    await service.save(actor(), { ...saveInput, enabled: false });
    expect(state.row).toMatchObject({ enabled: false });
  });

  it('kiểm dữ liệu nhập: địa chỉ ngoài danh sách cho phép, bucket sai quy tắc, thiếu secret lần đầu', async () => {
    const { service } = serviceSetup();
    await expect(service.save(actor(), { ...saveInput, endpoint: 'http://10.0.0.5:9000' })).rejects.toBeInstanceOf(SharedValidationError);
    await expect(service.save(actor(), { ...saveInput, bucket: 'Bucket_Sai' })).rejects.toThrow(/bucket/);
    await expect(service.save(actor(), { ...saveInput, secretAccessKey: '' })).rejects.toThrow(/secret key/);
    await expect(service.save(actor(), { ...saveInput, accessMode: 'direct' })).rejects.toThrow(/địa chỉ công khai/);
  });

  it('hai người lưu cùng lúc: người sau với phiên bản cũ bị từ chối', async () => {
    const { service } = serviceSetup({ row: settingsRow({ version: 3 }) });
    await expect(service.save(actor(), { ...saveInput, version: 2 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('máy chủ chưa có khoá gốc thì không lưu được, thử kết nối báo rõ', async () => {
    const { service } = serviceSetup({ secrets: null });
    await expect(service.save(actor(), saveInput)).rejects.toBeInstanceOf(SharedStorageUnavailableError);
    await expect(service.test(actor(), saveInput)).resolves.toMatchObject({ ok: false });
  });

  it('chuyển tệp: chép sang kho ngoài, so số byte rồi mới ghi đã chuyển; giữ bản ở nền tảng trừ khi chọn xoá', async () => {
    const pending: PlatformObject[] = [
      { versionId: 'v1', key: 'tenants/t/shared/a/v1-a.pdf', contentType: 'application/pdf', sizeBytes: 3 },
      { versionId: 'v2', key: 'tenants/t/shared/b/v1-b.pdf', contentType: 'application/pdf', sizeBytes: 99 },
      { versionId: 'v3', key: 'tenants/t/shared/c/v1-c.pdf', contentType: 'application/pdf', sizeBytes: 2 },
    ];
    const { service, platform, external, marked } = serviceSetup({ row: settingsRow(), pending });
    await platform.storage.putObject({ key: pending[0]!.key, contentType: 'application/pdf', body: new Uint8Array([1, 2, 3]) });
    await platform.storage.putObject({ key: pending[1]!.key, contentType: 'application/pdf', body: new Uint8Array([1]) });
    await platform.storage.putObject({ key: pending[2]!.key, contentType: 'application/pdf', body: new Uint8Array([7, 8]) });

    const first = await service.transfer(actor(), { limit: 2 });
    expect(first).toMatchObject({ moved: 1, failed: 1, remaining: 2 });
    expect(first.errors[0]).toMatch(/v1-b\.pdf: chỉ chép được 1\/99 byte/);
    expect(marked).toEqual(['v1']);
    expect(platform.objects.has(pending[0]!.key)).toBe(true);
    expect(external.objects.has(pending[0]!.key)).toBe(true);

    await service.transfer(actor(), { limit: 5, removePlatformCopy: true });
    expect(marked).toEqual(['v1', 'v3']);
    expect(platform.objects.has(pending[2]!.key)).toBe(false);
  });

  it('chưa bật kho ngoài thì không chuyển tệp', async () => {
    const { service } = serviceSetup({ row: settingsRow({ enabled: false }) });
    await expect(service.transfer(actor(), {})).rejects.toThrow(/Bật và lưu/);
  });
});
