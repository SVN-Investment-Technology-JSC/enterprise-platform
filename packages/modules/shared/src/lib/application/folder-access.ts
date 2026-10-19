import {
  roleAtLeast,
  SHARED_FOLDER_ROLES,
  type SharedConfidentiality,
  type SharedFolderRole,
  type SharedShareGrant,
} from '@enterprise-platform/contracts-shared';
import { membershipNodes, type OrganizationReader } from './organization.port.js';
import { isSharedManager, type SharedActor } from './shared-actor.js';
import type { SharedStore } from './shared-store.port.js';

/** Một thư mục, đủ để tính quyền; có cả thư mục đang ở Thùng rác. */
export interface AccessFolder {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly createdBy: string;
  readonly isActive: boolean;
}

/** Một dòng chia sẻ đã lưu. */
export interface ShareRecord extends SharedShareGrant {
  readonly folderId: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

/** Người được xét quyền: chính họ và mọi node sơ đồ tổ chức họ thuộc về, kể cả node cha. */
export interface AccessSubject {
  readonly userId: string;
  readonly nodeIds: ReadonlySet<string>;
}

export function higherRole(
  left: SharedFolderRole | undefined,
  right: SharedFolderRole | undefined,
): SharedFolderRole | undefined {
  if (!left) return right;
  if (!right) return left;
  return SHARED_FOLDER_ROLES.indexOf(left) >= SHARED_FOLDER_ROLES.indexOf(right) ? left : right;
}

/** Còn hiệu lực vào ngày `today` (`YYYY-MM-DD`): hết hạn là sau hết ngày `expiresOn`. */
export function shareActive(share: Pick<SharedShareGrant, 'expiresOn'>, today: string): boolean {
  return !share.expiresOn || share.expiresOn >= today;
}

export function shareMatches(
  share: Pick<SharedShareGrant, 'principalType' | 'principalId'>,
  subject: AccessSubject,
): boolean {
  switch (share.principalType) {
    case 'everyone':
      return true;
    case 'user':
      return share.principalId === subject.userId;
    case 'unit':
    case 'position':
      return Boolean(share.principalId) && subject.nodeIds.has(share.principalId as string);
    default:
      return false;
  }
}

/**
 * Quyền của `subject` trên từng thư mục. Quyền đặt thẳng trên một thư mục là
 * mức cao nhất của các dòng chia sẻ khớp còn hạn — chủ sở hữu là Quản lý —
 * rồi lấy cao nhất với quyền của thư mục cha. Thư mục vắng trong kết quả là
 * không được vào.
 *
 * Chỉ cộng thêm, không trừ: thư mục con không hẹp hơn thư mục cha được. Tài
 * liệu cần hẹp hơn thì đặt độ mật.
 */
export function folderRoles(
  folders: readonly AccessFolder[],
  shares: readonly ShareRecord[],
  subject: AccessSubject,
  today: string,
): Map<string, SharedFolderRole> {
  const direct = new Map<string, SharedFolderRole>();
  for (const share of shares) {
    if (!shareActive(share, today) || !shareMatches(share, subject)) continue;
    direct.set(share.folderId, higherRole(direct.get(share.folderId), share.role) ?? share.role);
  }
  for (const folder of folders) {
    if (folder.createdBy === subject.userId) direct.set(folder.id, 'manager');
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const resolved = new Map<string, SharedFolderRole | undefined>();
  const resolve = (id: string, guard: number): SharedFolderRole | undefined => {
    if (resolved.has(id)) return resolved.get(id);
    const folder = byId.get(id);
    if (!folder) return undefined;
    // Cây tối đa 6 cấp; chặn vòng lặp nếu dữ liệu hỏng.
    const inherited = folder.parentId && guard < 16 ? resolve(folder.parentId, guard + 1) : undefined;
    const role = higherRole(direct.get(id), inherited);
    resolved.set(id, role);
    return role;
  };

  const roles = new Map<string, SharedFolderRole>();
  for (const folder of folders) {
    const role = resolve(folder.id, 0);
    if (role) roles.set(folder.id, role);
  }
  return roles;
}

/** Quyền của người gọi trên các thư mục của kho, tính một lần cho mỗi lượt gọi. */
export interface FolderAccess {
  /** Quản trị kho, quản trị tenant: mọi thư mục, quyền Quản lý. */
  readonly everything: boolean;
  /** Mọi thư mục, kể cả thư mục trong Thùng rác. */
  readonly folders: readonly AccessFolder[];
  roleOf(folderId: string | undefined): SharedFolderRole | undefined;
}

/** Ghi trong thư mục: quyền Sửa trở lên ở thư mục, và quyền ghi của phân hệ. */
export function canWriteIn(actor: SharedActor, role: SharedFolderRole | undefined): boolean {
  return roleAtLeast(role, 'editor') && (actor.canWriteDocuments || isSharedManager(actor));
}

/** Lưu trữ, xoá, khôi phục trong thư mục: quyền Sửa trở lên ở thư mục, và quyền xoá của phân hệ. */
export function canDeleteIn(actor: SharedActor, role: SharedFolderRole | undefined): boolean {
  return roleAtLeast(role, 'editor') && (actor.canDeleteDocuments || actor.isTenantAdmin);
}

/**
 * Chia sẻ thư mục: quản trị kho, hoặc quyền Quản lý ở thư mục (chủ sở hữu có
 * sẵn) kèm quyền ghi của phân hệ — người chỉ có quyền xem thì không đổi gì
 * trong kho, kể cả quyền vào.
 */
export function canShare(actor: SharedActor, role: SharedFolderRole | undefined): boolean {
  return isSharedManager(actor) || (role === 'manager' && actor.canWriteDocuments);
}

/**
 * Ai thấy tài liệu nào, theo quyền ở thư mục chứa nó và độ mật:
 *
 * - Nội bộ: ai vào được thư mục;
 * - Hạn chế: quyền Sửa trở lên ở thư mục;
 * - Mật: quyền Quản lý ở thư mục, và chính người tạo.
 *
 * Quản trị kho thấy hết; không vào được thư mục thì không thấy gì trong đó,
 * kể cả tài liệu chính mình tạo.
 */
export function canSee(
  actor: SharedActor,
  document: { readonly confidentiality: SharedConfidentiality; readonly createdBy: string },
  role: SharedFolderRole | undefined,
): boolean {
  if (isSharedManager(actor)) return true;
  if (!role) return false;
  if (document.createdBy === actor.userId) return true;
  if (document.confidentiality === 'confidential') return role === 'manager';
  if (document.confidentiality === 'restricted') return roleAtLeast(role, 'editor');
  return true;
}

/** Hôm nay theo giờ Việt Nam, `YYYY-MM-DD`: thời hạn chia sẻ tính theo ngày ở đây. */
export function vietnamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Dựng `FolderAccess` cho người gọi: cây thư mục, các dòng chia sẻ và chỗ của
 * người đó trong sơ đồ tổ chức.
 *
 * Không đọc được sơ đồ tổ chức thì người đó chỉ còn quyền từ chia sẻ đích danh,
 * chia sẻ cho mọi người và thư mục mình tạo — thiếu quyền chứ không thừa.
 */
export class FolderAccessService {
  constructor(
    private readonly store: SharedStore,
    private readonly organization: OrganizationReader,
    private readonly today: () => string = () => vietnamToday(),
  ) {}

  async forActor(actor: SharedActor): Promise<FolderAccess> {
    const folders = await this.store.folders.skeleton(actor.tenantId);
    if (isSharedManager(actor)) {
      const ids = new Set(folders.map((folder) => folder.id));
      return {
        everything: true,
        folders,
        roleOf: (folderId) => (folderId && ids.has(folderId) ? 'manager' : undefined),
      };
    }
    const shares = await this.store.shares.list(actor.tenantId);
    // Sơ đồ tổ chức chỉ cần khi có dòng chia sẻ cho phòng ban hay chức danh.
    const byOrganization = shares.some(
      (share) => share.principalType === 'unit' || share.principalType === 'position',
    );
    const nodeIds = byOrganization
      ? membershipNodes(await this.organization.snapshot(actor.tenantId), actor.userId)
      : new Set<string>();
    const roles = folderRoles(folders, shares, { userId: actor.userId, nodeIds }, this.today());
    return {
      everything: false,
      folders,
      roleOf: (folderId) => (folderId ? roles.get(folderId) : undefined),
    };
  }

  /** Ngày dùng để xét thời hạn chia sẻ. */
  currentDate(): string {
    return this.today();
  }
}
