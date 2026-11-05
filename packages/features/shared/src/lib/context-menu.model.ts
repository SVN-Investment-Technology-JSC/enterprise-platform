import {
  roleAtLeast,
  SHARED_PREVIEWABLE_CONTENT_TYPES,
  type SharedCapabilities,
  type SharedDocumentSummary,
  type SharedFolder,
  type SharedFolderRole,
  type SharedTrashItem,
} from '@enterprise-platform/contracts-shared';

/** Mỗi mục của menu chuột phải ứng với một thao tác; nơi bấm quyết định thao tác chạy trên đối tượng nào. */
export type MenuActionId =
  | 'open'
  | 'view'
  | 'download'
  | 'locate'
  | 'new-folder'
  | 'upload'
  | 'upload-folder'
  | 'share'
  | 'edit-description'
  | 'rename'
  | 'move'
  | 'record-info'
  | 'validity'
  | 'tags'
  | 'new-version'
  | 'duplicate'
  | 'lock'
  | 'unlock'
  | 'archive'
  | 'unarchive'
  | 'delete'
  | 'restore'
  | 'restore-to'
  | 'purge';

/** Generic theo mã hành động để module khác (vd. Tài chính) dựng menu chuột phải riêng, tái dùng component `ContextMenu`. */
export interface MenuItem<TAction extends string = MenuActionId> {
  readonly kind: 'item';
  readonly id: TAction;
  readonly label: string;
  readonly danger?: boolean;
  /** Có giá trị thì mục hiện mờ và không chạy; lý do hiện ở tooltip. */
  readonly disabledReason?: string;
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export type MenuEntry<TAction extends string = MenuActionId> = MenuItem<TAction> | MenuSeparator;

/** Đối tượng bị bấm chuột phải. */
export type MenuTarget =
  | { readonly kind: 'document'; readonly document: SharedDocumentSummary }
  | { readonly kind: 'folder'; readonly folder: SharedFolder }
  /** Chỗ trống của bảng: thao tác trên thư mục đang mở, hoặc gốc kho khi không có `folder`. */
  | { readonly kind: 'blank'; readonly folder?: SharedFolder }
  | { readonly kind: 'trash'; readonly item: SharedTrashItem };

export interface MenuContext {
  readonly capabilities: SharedCapabilities;
  readonly currentUserId: string;
  /** Bảng đang là kết quả tìm kiếm hay lọc toàn kho: dòng nằm ngoài thư mục đang mở. */
  readonly flat: boolean;
  /** Quyền của người dùng ở từng thư mục (`SharedFolder.access`). */
  readonly roleOf: (folderId: string | undefined) => SharedFolderRole | undefined;
  /** Có ít nhất một thư mục người dùng tải lên được: "Tải file lên", "Tải thư mục lên" ở gốc kho mới có chỗ để chọn. */
  readonly canUploadSomewhere: boolean;
}

/**
 * Quyền của người dùng ở một thư mục, ghép quyền phân hệ (`capabilities`) với
 * quyền ở thư mục (`role`) đúng như service phía server: ghi cần quyền ghi của
 * phân hệ và quyền Sửa ở thư mục; xoá cần quyền xoá và quyền Sửa; chia sẻ cần
 * quyền Quản lý ở thư mục kèm quyền ghi. Quản trị kho làm được ở mọi thư mục.
 */
export function rightsOf(capabilities: SharedCapabilities, role?: SharedFolderRole) {
  const keeper = capabilities.isTenantAdmin || capabilities.canManage;
  const editor = keeper || roleAtLeast(role, 'editor');
  return {
    write: editor && (capabilities.canWriteDocuments || capabilities.canManage),
    /** Quản trị kho: dựng và chuyển thư mục gốc, khôi phục về gốc kho. */
    manage: capabilities.canManage,
    remove: editor && (capabilities.canDeleteDocuments || capabilities.isTenantAdmin),
    /** Xoá vĩnh viễn không có đường lùi: quản trị kho có quyền xoá. */
    purge: capabilities.isTenantAdmin || (capabilities.canDeleteDocuments && capabilities.canManage),
    share: keeper || (role === 'manager' && capabilities.canWriteDocuments),
    /** Mở khoá người khác đang giữ. */
    unlockOthers: keeper || role === 'manager',
  };
}

export type FolderRights = ReturnType<typeof rightsOf>;

type Slot = MenuItem | false | undefined;

const item = (id: MenuActionId, label: string, extra: Partial<Omit<MenuItem, 'kind' | 'id' | 'label'>> = {}): MenuItem => ({
  kind: 'item',
  id,
  label,
  ...extra,
});

/** Ghép các nhóm thành một menu: bỏ mục vắng mặt, nhóm rỗng, và không để vạch ngăn thừa ở đầu, cuối hay liền nhau. */
function assemble(groups: readonly (readonly Slot[])[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const group of groups) {
    const items = group.filter((slot): slot is MenuItem => Boolean(slot));
    if (items.length === 0) continue;
    if (entries.length > 0) entries.push({ kind: 'separator' });
    entries.push(...items);
  }
  return entries;
}

function documentMenu(document: SharedDocumentSummary, context: MenuContext): MenuEntry[] {
  const { write, remove, unlockOthers } = rightsOf(context.capabilities, context.roleOf(document.folderId));
  const version = document.currentVersion;
  const uploaded = version?.sizeBytes !== undefined;
  const active = document.status === 'active';
  const lockedByOther = Boolean(document.lockedByUserId && document.lockedByUserId !== context.currentUserId);
  const previewable = uploaded && SHARED_PREVIEWABLE_CONTENT_TYPES.includes(version?.contentType ?? '');
  const locked = lockedByOther ? { disabledReason: 'Người khác đang khoá tài liệu' } : {};
  const pending = uploaded ? {} : { disabledReason: 'Tệp chưa tải lên xong' };
  const editable = write && active;

  return assemble([
    [previewable && item('view', 'Xem'), item('download', 'Tải xuống', pending)],
    [
      context.flat && item('locate', 'Đến vị trí thư mục'),
      editable && item('edit-description', 'Cập nhật mô tả', locked),
      editable && item('rename', 'Thay đổi tên', locked),
      editable && item('move', 'Di chuyển tới thư mục', locked),
    ],
    [
      editable && item('record-info', 'Thông tin hồ sơ', locked),
      editable && item('validity', 'Quản lý hiệu lực', locked),
      editable && item('tags', 'Thẻ', locked),
      editable && item('new-version', 'Phiên bản mới', locked),
      editable && item('duplicate', 'Nhân bản', pending),
      editable && !document.lockedByUserId && item('lock', 'Khoá'),
      active &&
        Boolean(document.lockedByUserId) &&
        (!lockedByOther || unlockOthers) &&
        item('unlock', 'Mở khoá'),
      remove && (active ? item('archive', 'Lưu trữ') : item('unarchive', 'Khôi phục')),
    ],
    [remove && item('delete', 'Xoá', { danger: true, ...locked })],
  ]);
}

/**
 * Menu của một thư mục. `row` là dòng trong bảng hay cây (có "Mở"), `current` là
 * thư mục đang mở bấm ở chỗ trống của bảng.
 */
function folderMenu(folder: SharedFolder, context: MenuContext, mode: 'row' | 'current'): MenuEntry[] {
  const { write, manage, remove, share } = rightsOf(context.capabilities, context.roleOf(folder.id) ?? folder.access);
  const root = !folder.parentId;

  return assemble([
    [mode === 'row' && item('open', 'Mở')],
    [
      write && item('new-folder', 'Tạo thư mục'),
      write && item('upload', 'Tải file lên'),
      write && item('upload-folder', 'Tải thư mục lên'),
    ],
    [share && item('share', 'Chia sẻ')],
    [
      mode === 'row' && context.flat && item('locate', 'Đến vị trí thư mục'),
      write && item('edit-description', 'Cập nhật mô tả'),
      write && item('rename', 'Thay đổi tên'),
      manage && item('move', 'Di chuyển tới thư mục'),
      write && item('record-info', 'Thông tin hồ sơ'),
    ],
    // Thư mục gốc là khung của kho: cũng như dựng, chỉ quản trị kho xoá.
    [remove && (!root || manage) && item('delete', 'Xoá', { danger: true })],
  ]);
}

/** Chỗ trống ở gốc kho: chưa có thư mục nào đang mở. */
function rootMenu(context: MenuContext): MenuEntry[] {
  const { manage } = rightsOf(context.capabilities);
  const upload = context.canUploadSomewhere && (context.capabilities.canWriteDocuments || manage);
  return assemble([
    [
      manage && item('new-folder', 'Tạo thư mục'),
      upload && item('upload', 'Tải file lên'),
      upload && item('upload-folder', 'Tải thư mục lên'),
    ],
  ]);
}

function trashMenu(trashed: SharedTrashItem, context: MenuContext): MenuEntry[] {
  // Server chỉ trả những mục nằm ở thư mục người dùng có quyền Sửa.
  const { manage, remove, purge } = rightsOf(context.capabilities, 'editor');
  // Thư mục gốc của kho chỉ quản trị kho khôi phục về gốc được.
  const rootFolder = trashed.kind === 'folder' && !trashed.location;
  const rootOnly = rootFolder && !manage ? { disabledReason: 'Chỉ quản trị kho khôi phục được thư mục gốc' } : {};
  return assemble([
    [remove && item('restore', 'Khôi phục', rootOnly), remove && item('restore-to', 'Khôi phục vào thư mục…')],
    [purge && item('purge', 'Xoá vĩnh viễn', { danger: true })],
  ]);
}

/** Menu chuột phải cho `target`; rỗng nghĩa là không có thao tác nào người dùng được làm. */
export function buildMenu(target: MenuTarget, context: MenuContext): MenuEntry[] {
  switch (target.kind) {
    case 'document':
      return documentMenu(target.document, context);
    case 'folder':
      return folderMenu(target.folder, context, 'row');
    case 'blank':
      return target.folder ? folderMenu(target.folder, context, 'current') : rootMenu(context);
    case 'trash':
      return trashMenu(target.item, context);
  }
}
