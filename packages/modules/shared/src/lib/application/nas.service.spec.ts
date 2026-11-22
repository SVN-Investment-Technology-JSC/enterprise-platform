import { Readable } from 'node:stream';
import { SharedForbiddenError, SharedNasNotFoundError, SharedValidationError } from '../domain/shared.error.js';
import type { NasCredentials, NasDirectorySnapshot, NasGateway } from './nas-gateway.port.js';
import type { NasAccountRecord, NasRuleRecord } from './nas-rules.js';
import { NasService, type NasTicketSigner } from './nas.service.js';
import type { SharedActor } from './shared-actor.js';
import type { NasConnectionRow, NasGroupRecord, SharedStore, TenantPerson } from './shared-store.port.js';

const TENANT = 'tenant-1';

function actor(patch: Partial<SharedActor> = {}): SharedActor {
  return {
    tenantId: TENANT,
    userId: 'u-thuy',
    displayName: 'Thúy',
    isTenantAdmin: false,
    canManage: false,
    canWriteDocuments: true,
    canDeleteDocuments: false,
    ...patch,
  };
}
const admin = actor({ userId: 'u-admin', isTenantAdmin: true, canManage: true });

const SNAPSHOT: NasDirectorySnapshot = {
  accounts: [
    { name: 'thuyptd', description: '', disabled: false, groups: ['users', 'Văn Thư'] },
    { name: 'baodt', description: '', disabled: false, groups: ['users', 'Kinh Doanh'] },
    { name: 'nghiviec', description: '', disabled: true, groups: ['users', 'Văn Thư'] },
    { name: 'khach', description: '', disabled: false, groups: ['users'] },
  ],
  groups: [
    { name: 'users', description: '', members: 4 },
    { name: 'Văn Thư', description: '', members: 2 },
    { name: 'Kinh Doanh', description: '', members: 1 },
  ],
  permissions: [
    { share: 'SAVINA', principalType: 'group', principalName: 'users', rule: 'read' },
    { share: 'SAVINA', principalType: 'group', principalName: 'Văn Thư', rule: 'write' },
    { share: 'KINH DOANH', principalType: 'group', principalName: 'Kinh Doanh', rule: 'write' },
    { share: 'KINH DOANH', principalType: 'user', principalName: 'thuyptd', rule: 'deny' },
  ],
};

const PEOPLE: TenantPerson[] = [
  { id: 'u-thuy', name: 'Phạm Thị Diễm Thúy', active: true },
  { id: 'u-bao', name: 'Đỗ Thanh Bảo', active: true },
  { id: 'u-admin', name: 'Quản Trị Viên', active: true },
];

function setup(options: { connection?: Partial<NasConnectionRow> | null } = {}) {
  const state: {
    connection?: NasConnectionRow;
    accounts: NasAccountRecord[];
    groups: NasGroupRecord[];
    rules: NasRuleRecord[];
    logs: { share: string; path: string; action: string }[];
    syncs: { ok: boolean; message: string }[];
  } = {
    connection:
      options.connection === null
        ? undefined
        : {
            enabled: true,
            label: 'NAS văn phòng',
            provider: 'synology',
            baseUrl: 'http://100.79.184.77:5000',
            username: 'erp-connector',
            secretCiphertext: 'enc:mat-khau',
            shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH', label: 'Kinh doanh' }],
            syncMinutes: 15,
            lastSyncAt: new Date().toISOString(),
            version: 1,
            updatedBy: 'u-admin',
            updatedAt: '2026-11-22T00:00:00.000Z',
            ...options.connection,
          },
    accounts: [],
    groups: [],
    rules: [],
    logs: [],
    syncs: [],
  };
  const store = {
    people: { list: async () => PEOPLE },
    nas: {
      connection: async () => state.connection,
      saveConnection: async (_t: string, userId: string, input: Omit<NasConnectionRow, 'version' | 'updatedBy' | 'updatedAt'>, expected?: number) => {
        if (expected !== undefined && state.connection && state.connection.version !== expected) return undefined;
        state.connection = { ...input, version: (state.connection?.version ?? 0) + 1, updatedBy: userId, updatedAt: 'now' };
        return state.connection;
      },
      recordSync: async (_t: string, status: { ok: boolean; message: string }) => {
        state.syncs.push(status);
        if (state.connection) state.connection = { ...state.connection, lastSyncAt: new Date().toISOString(), lastSyncOk: status.ok };
      },
      accounts: async () => state.accounts,
      accountForUser: async (_t: string, userId: string) => state.accounts.find((account) => account.erpUserId === userId),
      replaceDirectory: async (_t: string, snapshot: { accounts: NasAccountRecord[]; groups: NasGroupRecord[]; rules: NasRuleRecord[] }) => {
        state.accounts = [...snapshot.accounts];
        state.groups = [...snapshot.groups];
        state.rules = [...snapshot.rules];
      },
      linkAccount: async (_t: string, name: string, erpUserId: string | null) => {
        const target = state.accounts.find((account) => account.name === name);
        if (!target) return false;
        state.accounts = state.accounts.map((account) =>
          account.name === name
            ? { ...account, erpUserId: erpUserId ?? undefined, linkSource: 'manual' as const }
            : erpUserId && account.erpUserId === erpUserId
              ? { ...account, erpUserId: undefined, linkSource: 'manual' as const }
              : account,
        );
        return true;
      },
      rules: async () => state.rules,
      groups: async () => state.groups,
      log: async (_t: string, _u: string, entry: { share: string; path: string; action: string }) => {
        state.logs.push(entry);
      },
    },
  } as unknown as SharedStore;

  const calls: string[] = [];
  const gateway: NasGateway = {
    shares: async () => [{ name: 'SAVINA' }, { name: 'KINH DOANH' }, { name: 'docker' }],
    directory: async (_credentials, shares) => {
      calls.push(`directory ${shares.join(',')}`);
      return SNAPSHOT;
    },
    list: async (_credentials, fullPath) => {
      calls.push(`list ${fullPath}`);
      return {
        total: 3,
        entries: [
          { name: '@eaDir', path: `${fullPath}/@eaDir`, isDir: true },
          { name: 'HỢP ĐỒNG', path: `${fullPath}/HỢP ĐỒNG`, isDir: true },
          { name: 'Báo giá.pdf', path: `${fullPath}/Báo giá.pdf`, isDir: false, sizeBytes: 1200 },
        ],
      };
    },
    createFolder: async (_c, parent, name) => void calls.push(`mkdir ${parent} ${name}`),
    rename: async (_c, path, name) => void calls.push(`rename ${path} ${name}`),
    remove: async (_c, path) => void calls.push(`remove ${path}`),
    download: async () => ({ body: Readable.from([]), partial: false }),
    upload: async (credentials: NasCredentials, folder, name, _body, size) =>
      void calls.push(`upload ${credentials.password} ${folder} ${name} ${size}`),
  };
  const secrets = {
    available: true,
    encryptSecret: (plain: string) => `enc:${plain}`,
    decryptSecret: (cipher: string) => cipher.replace(/^enc:/, ''),
    checkEndpoint: async (endpoint: string) => (endpoint.includes('10.0.0.') ? 'Địa chỉ kho không được phép.' : undefined),
  };
  const tickets: NasTicketSigner = {
    nasDownloadUrl: (input) => `/files/get:${input.fullPath}:${input.inline ? 'inline' : 'attachment'}`,
    nasUploadUrl: (input) => `/files/put:${input.folderFullPath}:${input.fileName}:${input.sizeBytes}`,
  };
  return { state, calls, service: new NasService(store, gateway, secrets, tickets) };
}

async function synced(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  await context.service.sync(admin);
  return context;
}

describe('NasService – cấu hình', () => {
  it('chỉ quản trị tenant lưu; lưu mã hoá mật khẩu, kiểm thư mục có trên NAS, rồi đồng bộ ngay', async () => {
    const { service, state, calls } = setup({ connection: null });
    const input = {
      enabled: true,
      provider: 'synology' as const,
      baseUrl: 'http://100.79.184.77:5000/',
      username: 'erp-connector',
      password: 'mat-khau',
      shares: [{ name: 'SAVINA' }, { name: 'SAVINA' }, { name: 'KINH DOANH', label: 'Kinh doanh' }],
    };
    await expect(service.save(actor({ canManage: true }), input)).rejects.toBeInstanceOf(SharedForbiddenError);
    const view = await service.save(admin, input);
    expect(state.connection).toMatchObject({ baseUrl: 'http://100.79.184.77:5000', secretCiphertext: 'enc:mat-khau' });
    expect(state.connection!.shares).toEqual([{ name: 'SAVINA' }, { name: 'KINH DOANH', label: 'Kinh doanh' }]);
    expect(calls).toContain('directory SAVINA,KINH DOANH');
    expect(view).toMatchObject({ enabled: true, hasSecret: true, accounts: 4 });
    expect(JSON.stringify(view)).not.toContain('mat-khau');
  });

  it('thư mục không có trên NAS, địa chỉ không được phép, thiếu mật khẩu lần đầu thì không lưu', async () => {
    const { service } = setup({ connection: null });
    const base = { enabled: true, provider: 'synology' as const, baseUrl: 'http://100.79.184.77:5000', username: 'erp', password: 'x', shares: [{ name: 'SAVINA' }] };
    await expect(service.save(admin, { ...base, shares: [{ name: 'KHONG CO' }] })).rejects.toThrow(/KHONG CO/);
    await expect(service.save(admin, { ...base, baseUrl: 'http://10.0.0.5:5000' })).rejects.toBeInstanceOf(SharedValidationError);
    await expect(service.save(admin, { ...base, password: '' })).rejects.toThrow(/mật khẩu/);
    await expect(service.save(admin, { ...base, shares: [] })).rejects.toThrow(/ít nhất một/);
  });

  it('thử kết nối trả danh sách thư mục chia sẻ để chọn', async () => {
    const { service } = setup();
    await expect(service.test(admin, {})).resolves.toMatchObject({ ok: true, shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH' }, { name: 'docker' }] });
  });
});

describe('NasService – đồng bộ và ghép tài khoản', () => {
  it('tự ghép theo quy tắc đặt tên; tài khoản không khớp để trống; ghi trạng thái đồng bộ', async () => {
    const { state } = await synced();
    expect(state.accounts.find((account) => account.name === 'thuyptd')).toMatchObject({ erpUserId: 'u-thuy', linkSource: 'auto' });
    expect(state.accounts.find((account) => account.name === 'baodt')).toMatchObject({ erpUserId: 'u-bao', linkSource: 'auto' });
    expect(state.accounts.find((account) => account.name === 'khach')).toMatchObject({ erpUserId: undefined, linkSource: 'none' });
    expect(state.syncs.at(-1)).toMatchObject({ ok: true, message: expect.stringContaining('4 tài khoản') });
  });

  it('ghép tay không bị lượt đồng bộ sau ghi đè; bỏ ghép tay thì không tự ghép lại', async () => {
    const { service, state } = await synced();
    await service.link(admin, 'khach', 'u-admin');
    await service.link(admin, 'baodt', null);
    await service.sync(admin);
    expect(state.accounts.find((account) => account.name === 'khach')).toMatchObject({ erpUserId: 'u-admin', linkSource: 'manual' });
    expect(state.accounts.find((account) => account.name === 'baodt')).toMatchObject({ erpUserId: undefined, linkSource: 'manual' });
    await expect(service.link(admin, 'khach', 'khong-co')).rejects.toThrow(/Không thấy nhân sự/);
    await expect(service.link(actor({ canManage: true }), 'khach', 'u-admin')).rejects.toBeInstanceOf(SharedForbiddenError);
  });
});

describe('NasService – duyệt và thao tác tệp', () => {
  it('chỉ hiện thư mục được vào, kèm quyền và lý do; NAS cho ghi mà ERP chỉ xem thì báo', async () => {
    const { service } = await synced();
    const overview = await service.overview(actor());
    expect(overview).toMatchObject({ enabled: true, account: 'thuyptd' });
    // thuyptd bị chặn đích danh ở KINH DOANH dù nhóm users đọc được SAVINA.
    expect(overview.shares).toEqual([{ name: 'SAVINA', label: 'SAVINA', access: 'write', via: ['nhóm Văn Thư'], writeCappedByErp: false }]);
    const reader = await service.overview(actor({ canWriteDocuments: false }));
    expect(reader.shares[0]).toMatchObject({ access: 'write', writeCappedByErp: true });
    const bao = await service.overview(actor({ userId: 'u-bao' }));
    expect(bao.shares.map((share) => [share.name, share.access])).toEqual([
      ['SAVINA', 'read'],
      ['KINH DOANH', 'write'],
    ]);
  });

  it('chưa ghép tài khoản NAS thì không vào được; kết nối tắt thì không có kho NAS', async () => {
    const { service } = await synced();
    const stranger = actor({ userId: 'u-la' });
    expect((await service.overview(stranger)).shares).toEqual([]);
    await expect(service.list(stranger, 'SAVINA', '')).rejects.toThrow(/chưa được ghép/);
    const off = setup({ connection: { enabled: false } });
    await expect(off.service.overview(actor())).resolves.toEqual({ enabled: false, label: '', shares: [] });
    await expect(off.service.list(actor(), 'SAVINA', '')).rejects.toBeInstanceOf(SharedNasNotFoundError);
  });

  it('liệt kê: đường dẫn tương đối, ẩn thư mục hệ thống; chặn thư mục không ánh xạ, không quyền, đường dẫn thoát ra ngoài', async () => {
    const { service, calls } = await synced();
    const listing = await service.list(actor(), 'SAVINA', 'HỢP ĐỒNG 2025/');
    expect(calls).toContain('list /SAVINA/HỢP ĐỒNG 2025');
    expect(listing).toMatchObject({ path: 'HỢP ĐỒNG 2025', access: 'write', canWrite: true });
    expect(listing.entries.map((entry) => entry.path)).toEqual(['HỢP ĐỒNG 2025/HỢP ĐỒNG', 'HỢP ĐỒNG 2025/Báo giá.pdf']);
    await expect(service.list(actor(), 'docker', '')).rejects.toBeInstanceOf(SharedNasNotFoundError);
    await expect(service.list(actor(), 'KINH DOANH', '')).rejects.toThrow(/không có quyền vào/);
    await expect(service.list(actor(), 'SAVINA', '../KINH DOANH')).rejects.toBeInstanceOf(SharedValidationError);
  });

  it('tải xuống, xem trước: phiếu trỏ đúng tệp; chỉ PDF, ảnh xem tại chỗ; ghi nhật ký', async () => {
    const { service, state } = await synced();
    const ticket = await service.download(actor(), 'SAVINA', 'HỢP ĐỒNG/HĐ 01.pdf', 'preview');
    expect(ticket).toMatchObject({ downloadUrl: '/files/get:/SAVINA/HỢP ĐỒNG/HĐ 01.pdf:inline', fileName: 'HĐ 01.pdf', contentType: 'application/pdf' });
    await expect(service.download(actor(), 'SAVINA', 'Bảng tính.xlsx', 'preview')).rejects.toThrow(/xem trước/);
    await service.download(actor(), 'SAVINA', 'Bảng tính.xlsx');
    expect(state.logs.map((log) => log.action)).toEqual(['view', 'download']);
  });

  it('ghi cần NAS cho ghi và ERP cho ghi; tải lên ký phiếu đúng thư mục, tên, dung lượng', async () => {
    const { service, calls } = await synced();
    await expect(service.uploadTicket(actor(), 'SAVINA', { path: 'HỢP ĐỒNG', fileName: 'HĐ 02.pdf', sizeBytes: 500 })).resolves.toEqual({
      uploadUrl: '/files/put:/SAVINA/HỢP ĐỒNG:HĐ 02.pdf:500',
      expiresInSeconds: 300,
    });
    await expect(service.uploadTicket(actor({ userId: 'u-bao' }), 'SAVINA', { fileName: 'a.pdf', sizeBytes: 1 })).rejects.toThrow(/chỉ có quyền đọc/);
    await expect(service.uploadTicket(actor({ canWriteDocuments: false }), 'SAVINA', { fileName: 'a.pdf', sizeBytes: 1 })).rejects.toThrow(/tài khoản ERP/);
    await expect(service.uploadTicket(actor(), 'SAVINA', { fileName: 'a.pdf', sizeBytes: 6 * 1024 ** 3 })).rejects.toThrow(/5 GB/);
    await service.createFolder(actor(), 'SAVINA', { path: 'HỢP ĐỒNG', name: 'Năm 2026' });
    await service.rename(actor(), 'SAVINA', { path: 'HỢP ĐỒNG/Năm 2026', name: 'Năm 2027' });
    await service.remove(actor(), 'SAVINA', { path: 'HỢP ĐỒNG/Năm 2027' });
    expect(calls.slice(-3)).toEqual([
      'mkdir /SAVINA/HỢP ĐỒNG Năm 2026',
      'rename /SAVINA/HỢP ĐỒNG/Năm 2026 Năm 2027',
      'remove /SAVINA/HỢP ĐỒNG/Năm 2027',
    ]);
    await expect(service.remove(actor(), 'SAVINA', { path: '' })).rejects.toThrow(/thư mục chia sẻ/);
  });

  it('route chuyển tiếp dùng mật khẩu đã giải mã của kết nối', async () => {
    const { service, calls } = await synced();
    await service.acceptUpload(TENANT, '/SAVINA/HỢP ĐỒNG', 'HĐ 02.pdf', Readable.from([]), 500);
    expect(calls.at(-1)).toBe('upload mat-khau /SAVINA/HỢP ĐỒNG HĐ 02.pdf 500');
  });

  it('bảng quyền của thư mục chỉ quản trị kho xem', async () => {
    const { service } = await synced();
    await expect(service.permissions(actor(), 'SAVINA')).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.permissions(admin, 'SAVINA')).resolves.toEqual([
      { principalType: 'group', principalName: 'users', rule: 'read', members: 4 },
      { principalType: 'group', principalName: 'Văn Thư', rule: 'write', members: 2 },
    ]);
  });
});
