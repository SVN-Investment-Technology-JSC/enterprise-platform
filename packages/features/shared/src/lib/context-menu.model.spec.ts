import type {
  SharedCapabilities,
  SharedDocumentSummary,
  SharedFolder,
  SharedFolderRole,
  SharedTrashItem,
} from '@enterprise-platform/contracts-shared';
import { buildMenu, rightsOf, type MenuContext, type MenuEntry, type MenuTarget } from './context-menu.model';

const ME = 'user-me';

const caps = (overrides: Partial<SharedCapabilities> = {}): SharedCapabilities => ({
  isTenantAdmin: false,
  canManage: false,
  canWriteDocuments: false,
  canDeleteDocuments: false,
  ...overrides,
});

const READER = caps();
const WRITER = caps({ canWriteDocuments: true });
const DELETER = caps({ canWriteDocuments: true, canDeleteDocuments: true });
const MANAGER = caps({ canWriteDocuments: true, canManage: true });
const KEEPER = caps({ canWriteDocuments: true, canManage: true, canDeleteDocuments: true });
const ADMIN = caps({ isTenantAdmin: true, canWriteDocuments: true, canManage: true, canDeleteDocuments: true });

/** Mặc định mọi thư mục người dùng có quyền Sửa: các ca cũ chỉ còn xét quyền phân hệ. */
const context = (capabilities: SharedCapabilities, overrides: Partial<MenuContext> = {}): MenuContext => ({
  capabilities,
  currentUserId: ME,
  flat: false,
  roleOf: () => 'editor',
  canUploadSomewhere: true,
  ...overrides,
});

const role = (value: SharedFolderRole | undefined): Partial<MenuContext> => ({ roleOf: () => value });

const document = (overrides: Partial<SharedDocumentSummary> = {}): SharedDocumentSummary => ({
  id: 'doc-1',
  folderId: 'folder-1',
  name: 'HĐ 01',
  confidentiality: 'internal',
  tags: [],
  status: 'active',
  createdBy: 'user-other',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  versionCount: 1,
  folderPath: 'Hợp đồng',
  currentVersionId: 'version-1',
  currentVersion: {
    id: 'version-1',
    documentId: 'doc-1',
    versionNo: 1,
    fileName: 'hd01.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1000,
    uploadedBy: 'user-other',
    createdAt: '2026-10-01T00:00:00Z',
  },
  ...overrides,
});

const folder = (overrides: Partial<SharedFolder> = {}): SharedFolder => ({
  id: 'folder-1',
  parentId: 'folder-0',
  name: 'Hồ sơ 2026',
  depth: 1,
  isActive: true,
  documentCount: 0,
  totalDocumentCount: 0,
  totalBytes: 0,
  createdBy: 'user-other',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const trashed = (overrides: Partial<SharedTrashItem> = {}): SharedTrashItem => ({
  kind: 'document',
  id: 'doc-1',
  name: 'HĐ 01',
  location: 'Hợp đồng',
  locationAvailable: true,
  documentCount: 1,
  folderCount: 0,
  totalBytes: 1000,
  deletedAt: '2026-10-10T00:00:00Z',
  deletedBy: 'user-other',
  ...overrides,
});

/** Nhãn từng mục, vạch ngăn thành "|", để so cả thứ tự lẫn nhóm. */
const shape = (entries: readonly MenuEntry[]) =>
  entries.map((entry) => (entry.kind === 'separator' ? '|' : entry.label)).join(' · ');

const entry = (entries: readonly MenuEntry[], id: string) =>
  entries.find((candidate) => candidate.kind === 'item' && candidate.id === id);

const build = (target: MenuTarget, capabilities: SharedCapabilities, overrides: Partial<MenuContext> = {}) =>
  buildMenu(target, context(capabilities, overrides));

describe('rightsOf', () => {
  it('xoá cần quyền xoá hoặc quản trị tenant; xoá vĩnh viễn cần cả quản trị kho', () => {
    expect(rightsOf(READER, 'editor')).toEqual({
      write: false,
      manage: false,
      remove: false,
      purge: false,
      share: false,
      unlockOthers: false,
    });
    expect(rightsOf(DELETER, 'editor')).toMatchObject({ write: true, remove: true, purge: false });
    expect(rightsOf(MANAGER, 'editor')).toMatchObject({ manage: true, remove: false, purge: false });
    expect(rightsOf(KEEPER, 'editor')).toMatchObject({ remove: true, purge: true });
    expect(rightsOf(ADMIN, 'editor')).toMatchObject({ remove: true, purge: true });
  });

  it('ghi và xoá cần cả quyền Sửa ở thư mục; chia sẻ cần quyền Quản lý kèm quyền ghi', () => {
    expect(rightsOf(DELETER, 'viewer')).toMatchObject({ write: false, remove: false, share: false });
    expect(rightsOf(DELETER, undefined)).toMatchObject({ write: false, remove: false });
    expect(rightsOf(DELETER, 'manager')).toMatchObject({ write: true, remove: true, share: true, unlockOthers: true });
    expect(rightsOf(READER, 'manager')).toMatchObject({ write: false, share: false, unlockOthers: true });
    // Quản trị kho làm được ở mọi thư mục, kể cả thư mục chưa ai chia sẻ cho họ.
    expect(rightsOf(MANAGER, undefined)).toMatchObject({ write: true, share: true, unlockOthers: true });
  });
});

describe('menu tài liệu', () => {
  it('người chỉ đọc chỉ xem và tải xuống', () => {
    expect(shape(build({ kind: 'document', document: document() }, READER))).toBe('Xem · Tải xuống');
    const docx = document({
      currentVersion: { ...document().currentVersion!, contentType: 'application/msword', fileName: 'a.doc' },
    });
    expect(shape(build({ kind: 'document', document: docx }, READER))).toBe('Tải xuống');
  });

  it('người có quyền ghi được sửa, nhân bản, khoá nhưng không lưu trữ hay xoá', () => {
    expect(shape(build({ kind: 'document', document: document() }, WRITER))).toBe(
      [
        'Xem · Tải xuống',
        '|',
        'Cập nhật mô tả · Thay đổi tên · Di chuyển tới thư mục',
        '|',
        'Thông tin hồ sơ · Quản lý hiệu lực · Thẻ · Phiên bản mới · Nhân bản · Khoá',
      ].join(' · '),
    );
  });

  it('người có quyền xoá thêm Lưu trữ và Xoá, Xoá đứng riêng một nhóm và là mục nguy hiểm', () => {
    const entries = build({ kind: 'document', document: document() }, DELETER);
    expect(shape(entries).endsWith('Khoá · Lưu trữ · | · Xoá')).toBe(true);
    expect(entry(entries, 'delete')).toMatchObject({ danger: true });
    expect(entry(entries, 'archive')).not.toHaveProperty('danger');
  });

  it('trong kết quả tìm kiếm có thêm "Đến vị trí thư mục"', () => {
    const entries = build({ kind: 'document', document: document() }, WRITER, { flat: true });
    expect(shape(entries)).toContain('| · Đến vị trí thư mục · Cập nhật mô tả');
    expect(entry(build({ kind: 'document', document: document() }, WRITER), 'locate')).toBeUndefined();
  });

  it('người khác đang khoá: sửa, phiên bản mới, xoá bị mờ kèm lý do; không có Khoá; Mở khoá chỉ cho quản trị kho', () => {
    const locked = document({ lockedByUserId: 'user-other' });
    const entries = build({ kind: 'document', document: locked }, DELETER);
    for (const id of ['edit-description', 'rename', 'move', 'record-info', 'validity', 'tags', 'new-version', 'delete']) {
      expect(entry(entries, id)).toMatchObject({ disabledReason: 'Người khác đang khoá tài liệu' });
    }
    expect(entry(entries, 'lock')).toBeUndefined();
    expect(entry(entries, 'unlock')).toBeUndefined();
    // Nhân bản và lưu trữ không đụng tới tài liệu đang bị khoá.
    expect(entry(entries, 'duplicate')).not.toHaveProperty('disabledReason');
    expect(entry(entries, 'archive')).not.toHaveProperty('disabledReason');
    expect(entry(build({ kind: 'document', document: locked }, KEEPER), 'unlock')).toBeDefined();
  });

  it('chính mình đang khoá: có Mở khoá, không có Khoá, không bị mờ', () => {
    const entries = build({ kind: 'document', document: document({ lockedByUserId: ME }) }, WRITER);
    expect(entry(entries, 'unlock')).toBeDefined();
    expect(entry(entries, 'lock')).toBeUndefined();
    expect(entry(entries, 'rename')).not.toHaveProperty('disabledReason');
  });

  it('tài liệu đã lưu trữ: không sửa được, chỉ xem, tải, khôi phục, xoá', () => {
    const archived = document({ status: 'archived' });
    expect(shape(build({ kind: 'document', document: archived }, DELETER))).toBe(
      'Xem · Tải xuống · | · Khôi phục · | · Xoá',
    );
    expect(shape(build({ kind: 'document', document: archived }, WRITER))).toBe('Xem · Tải xuống');
  });

  it('tệp chưa tải lên xong: không Xem, Tải xuống và Nhân bản bị mờ', () => {
    const pending = document({ currentVersion: { ...document().currentVersion!, sizeBytes: undefined } });
    const entries = build({ kind: 'document', document: pending }, WRITER);
    expect(entry(entries, 'view')).toBeUndefined();
    expect(entry(entries, 'download')).toMatchObject({ disabledReason: 'Tệp chưa tải lên xong' });
    expect(entry(entries, 'duplicate')).toMatchObject({ disabledReason: 'Tệp chưa tải lên xong' });
  });
});

describe('menu thư mục', () => {
  it('người chỉ đọc chỉ có Mở', () => {
    expect(shape(build({ kind: 'folder', folder: folder() }, READER))).toBe('Mở');
  });

  it('người có quyền ghi tạo được thư mục con, tải tệp lên, sửa tên, mô tả, thông tin hồ sơ', () => {
    expect(shape(build({ kind: 'folder', folder: folder() }, WRITER))).toBe(
      'Mở · | · Tạo thư mục · Tải file lên · Tải thư mục lên · | · Cập nhật mô tả · Thay đổi tên · Thông tin hồ sơ',
    );
  });

  it('chỉ quản trị kho được Di chuyển tới thư mục', () => {
    expect(entry(build({ kind: 'folder', folder: folder() }, WRITER), 'move')).toBeUndefined();
    expect(entry(build({ kind: 'folder', folder: folder() }, MANAGER), 'move')).toBeDefined();
  });

  it('xoá thư mục: cần quyền xoá; thư mục gốc còn cần quản trị kho', () => {
    expect(entry(build({ kind: 'folder', folder: folder() }, MANAGER), 'delete')).toBeUndefined();
    expect(entry(build({ kind: 'folder', folder: folder() }, DELETER), 'delete')).toMatchObject({ danger: true });
    const root = folder({ parentId: undefined, depth: 0 });
    expect(entry(build({ kind: 'folder', folder: root }, DELETER), 'delete')).toBeUndefined();
    expect(entry(build({ kind: 'folder', folder: root }, KEEPER), 'delete')).toBeDefined();
  });

  it('trong kết quả tìm kiếm có "Đến vị trí thư mục"', () => {
    expect(shape(build({ kind: 'folder', folder: folder() }, WRITER, { flat: true }))).toContain('Đến vị trí thư mục');
  });

  it('quyền Xem ở thư mục chỉ còn Mở; quyền Quản lý thêm Chia sẻ thành một nhóm riêng', () => {
    expect(shape(build({ kind: 'folder', folder: folder() }, DELETER, role('viewer')))).toBe('Mở');
    expect(shape(build({ kind: 'folder', folder: folder() }, WRITER, role('manager')))).toBe(
      'Mở · | · Tạo thư mục · Tải file lên · Tải thư mục lên · | · Chia sẻ · | · Cập nhật mô tả · Thay đổi tên · Thông tin hồ sơ',
    );
    expect(entry(build({ kind: 'folder', folder: folder() }, WRITER, role('editor')), 'share')).toBeUndefined();
    expect(entry(build({ kind: 'folder', folder: folder() }, READER, role('manager')), 'share')).toBeUndefined();
    expect(entry(build({ kind: 'folder', folder: folder() }, MANAGER, role(undefined)), 'share')).toBeDefined();
  });

  it('thư mục không có trong danh sách quyền thì dùng `access` server gửi kèm', () => {
    const owned = folder({ access: 'manager' });
    expect(entry(build({ kind: 'folder', folder: owned }, WRITER, role(undefined)), 'share')).toBeDefined();
  });
});

describe('menu theo quyền ở thư mục chứa tài liệu', () => {
  it('quyền Xem: chỉ xem và tải, dù có quyền ghi và xoá của phân hệ', () => {
    expect(shape(build({ kind: 'document', document: document() }, DELETER, role('viewer')))).toBe('Xem · Tải xuống');
  });

  it('người quản lý thư mục mở được khoá của người khác', () => {
    const locked = document({ lockedByUserId: 'user-other' });
    expect(entry(build({ kind: 'document', document: locked }, DELETER, role('editor')), 'unlock')).toBeUndefined();
    expect(entry(build({ kind: 'document', document: locked }, DELETER, role('manager')), 'unlock')).toBeDefined();
  });
});

describe('menu chỗ trống', () => {
  it('trong một thư mục: như menu thư mục đang mở, không có Mở', () => {
    expect(shape(build({ kind: 'blank', folder: folder() }, DELETER))).toBe(
      'Tạo thư mục · Tải file lên · Tải thư mục lên · | · Cập nhật mô tả · Thay đổi tên · Thông tin hồ sơ · | · Xoá',
    );
  });

  it('ở gốc kho: quản trị kho tạo được thư mục gốc, người có quyền ghi chỉ tải tệp lên, người chỉ đọc không có menu', () => {
    expect(shape(build({ kind: 'blank' }, MANAGER))).toBe('Tạo thư mục · Tải file lên · Tải thư mục lên');
    expect(shape(build({ kind: 'blank' }, WRITER))).toBe('Tải file lên · Tải thư mục lên');
    expect(build({ kind: 'blank' }, READER)).toEqual([]);
  });

  it('ở gốc kho: không có thư mục nào ghi được thì không có Tải file lên', () => {
    expect(build({ kind: 'blank' }, WRITER, { canUploadSomewhere: false })).toEqual([]);
  });
});

describe('menu Thùng rác', () => {
  it('người có quyền xoá khôi phục được; xoá vĩnh viễn cần quản trị kho', () => {
    expect(shape(build({ kind: 'trash', item: trashed() }, DELETER))).toBe('Khôi phục · Khôi phục vào thư mục…');
    const entries = build({ kind: 'trash', item: trashed() }, KEEPER);
    expect(shape(entries)).toBe('Khôi phục · Khôi phục vào thư mục… · | · Xoá vĩnh viễn');
    expect(entry(entries, 'purge')).toMatchObject({ danger: true });
  });

  it('thư mục gốc cũ chỉ quản trị kho khôi phục về chỗ cũ được', () => {
    const root = trashed({ kind: 'folder', location: '' });
    expect(entry(build({ kind: 'trash', item: root }, DELETER), 'restore')).toMatchObject({
      disabledReason: 'Chỉ quản trị kho khôi phục được thư mục gốc',
    });
    expect(entry(build({ kind: 'trash', item: root }, KEEPER), 'restore')).not.toHaveProperty('disabledReason');
  });
});

describe('vạch ngăn', () => {
  const capabilities = [READER, WRITER, DELETER, MANAGER, KEEPER, ADMIN];
  const targets: MenuTarget[] = [
    { kind: 'document', document: document() },
    { kind: 'document', document: document({ status: 'archived' }) },
    { kind: 'document', document: document({ lockedByUserId: 'user-other' }) },
    { kind: 'folder', folder: folder() },
    { kind: 'folder', folder: folder({ parentId: undefined, depth: 0 }) },
    { kind: 'blank', folder: folder() },
    { kind: 'blank' },
    { kind: 'trash', item: trashed() },
    { kind: 'trash', item: trashed({ kind: 'folder', location: '' }) },
  ];

  it('không bao giờ đứng đầu, đứng cuối hay đứng liền nhau', () => {
    for (const target of targets) {
      for (const capability of capabilities) {
        for (const flat of [false, true]) {
          const entries = build(target, capability, { flat });
          const kinds = entries.map((candidate) => candidate.kind);
          if (kinds.length === 0) continue;
          expect(kinds[0]).toBe('item');
          expect(kinds.at(-1)).toBe('item');
          expect(kinds.join(',')).not.toContain('separator,separator');
        }
      }
    }
  });

  it('mỗi mục chỉ xuất hiện một lần', () => {
    for (const target of targets) {
      for (const capability of capabilities) {
        const ids = build(target, capability, { flat: true })
          .filter((candidate) => candidate.kind === 'item')
          .map((candidate) => (candidate as { id: string }).id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
