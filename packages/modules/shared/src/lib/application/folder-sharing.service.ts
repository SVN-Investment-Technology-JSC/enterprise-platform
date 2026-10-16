import {
  SHARED_FOLDER_ROLES,
  SHARED_MAX_SHARES_PER_FOLDER,
  SHARED_PRINCIPAL_TYPE_LABELS,
  SHARED_PRINCIPAL_TYPES,
  type SharedDirectory,
  type SharedDirectoryPerson,
  type SharedFolderRole,
  type SharedFolderShare,
  type SharedFolderSharing,
  type SharedInheritedShare,
  type SharedPrincipalType,
  type SharedShareGrant,
  type UpdateSharedFolderSharesRequest,
} from '@enterprise-platform/contracts-shared';
import { SharedFolderNotFoundError, SharedForbiddenError, SharedValidationError } from '../domain/shared.error.js';
import {
  canShare,
  shareActive,
  type AccessFolder,
  type FolderAccess,
  type FolderAccessService,
  type ShareRecord,
} from './folder-access.js';
import { nodePath, type OrganizationNode, type OrganizationReader, type OrganizationSnapshot } from './organization.port.js';
import type { SharedActor } from './shared-actor.js';
import type { SharedStore, TenantPerson } from './shared-store.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const keyOf = (grant: Pick<SharedShareGrant, 'principalType' | 'principalId'>) =>
  `${grant.principalType}:${grant.principalId ?? ''}`;

/**
 * Chia sẻ thư mục của Tài liệu công ty, như hộp thoại "Chia sẻ" của 1Office:
 * mỗi dòng là một đối tượng (mọi người, phòng ban, chức danh, nhân sự), một
 * quyền (Xem, Sửa, Quản lý) và một thời hạn tuỳ chọn.
 *
 * Người chia sẻ được: quản trị kho và ai có quyền Quản lý ở thư mục — chủ sở
 * hữu (người tạo) có sẵn quyền này.
 */
export class FolderSharingService {
  constructor(
    private readonly store: SharedStore,
    private readonly access: FolderAccessService,
    private readonly organization: OrganizationReader,
  ) {}

  async sharing(actor: SharedActor, folderId: string): Promise<SharedFolderSharing> {
    const folder = this.manageable(actor, await this.access.forActor(actor), folderId);
    return this.describe(actor, folder);
  }

  /** Thay toàn bộ chia sẻ đặt trên thư mục; trả lại bức tranh mới. */
  async updateSharing(
    actor: SharedActor,
    folderId: string,
    input: UpdateSharedFolderSharesRequest,
  ): Promise<SharedFolderSharing> {
    const access = await this.access.forActor(actor);
    const folder = this.manageable(actor, access, folderId);
    const [shares, people, snapshot] = await Promise.all([
      this.store.shares.list(actor.tenantId),
      this.store.people.list(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const grants = validateGrants(input, {
      current: shares.filter((share) => share.folderId === folder.id),
      people,
      snapshot,
    });
    await this.store.shares.replace(actor.tenantId, folder.id, actor.userId, grants);
    // Không kiểm quyền lại: người vừa sửa có thể đã tự bỏ quyền Quản lý của mình.
    return this.describe(actor, folder);
  }

  /** Danh bạ cho ô chọn đối tượng: người dùng còn hoạt động, phòng ban và chức danh. */
  async directory(actor: SharedActor): Promise<SharedDirectory> {
    const access = await this.access.forActor(actor);
    const sharesAny = access.folders.some(
      (folder) => folder.isActive && canShare(actor, access.roleOf(folder.id)),
    );
    if (!access.everything && !sharesAny) {
      throw new SharedForbiddenError('Bạn không quản lý thư mục nào để chia sẻ.');
    }

    const [people, snapshot] = await Promise.all([
      this.store.people.list(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const labels = new Labels(people, snapshot);
    const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
    return {
      people: people
        .filter((person) => person.active)
        .map((person) => labels.person(person))
        .sort((left, right) => collator.compare(left.displayName, right.displayName)),
      nodes: snapshot.nodes
        .map((node) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          parentId: node.parentId,
          path: labels.pathOf(node.id),
        }))
        .sort((left, right) => collator.compare(`${left.path} ${left.name}`, `${right.path} ${right.name}`)),
      degraded: snapshot.degraded,
    };
  }

  /* ------------------------------------------------------------ nội bộ */

  /** Thư mục đang dùng mà người gọi được chia sẻ; không vào được thì như không có. */
  private manageable(actor: SharedActor, access: FolderAccess, folderId: string): AccessFolder {
    const folder = access.folders.find((item) => item.id === folderId);
    const role = access.roleOf(folderId);
    if (!folder || !folder.isActive || !role) throw new SharedFolderNotFoundError(folderId);
    if (!canShare(actor, role)) {
      throw new SharedForbiddenError('Chỉ người quản lý thư mục mới chia sẻ được thư mục này.');
    }
    return folder;
  }

  private async describe(actor: SharedActor, folder: AccessFolder): Promise<SharedFolderSharing> {
    const [folders, shares, people, snapshot] = await Promise.all([
      this.store.folders.skeleton(actor.tenantId),
      this.store.shares.list(actor.tenantId),
      this.store.people.list(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const labels = new Labels(people, snapshot);
    const today = this.access.currentDate();
    const byId = new Map(folders.map((item) => [item.id, item]));

    // Thư mục cha từ gốc xuống, để dòng kế thừa đọc theo thứ tự của cây.
    const ancestors: AccessFolder[] = [];
    const seen = new Set<string>([folder.id]);
    let current = folder.parentId ? byId.get(folder.parentId) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      ancestors.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    const on = (folderId: string) =>
      sortShares(shares.filter((share) => share.folderId === folderId).map((share) => labels.share(share, today)));

    const inherited: SharedInheritedShare[] = [];
    for (const ancestor of ancestors) {
      const from = { fromFolderId: ancestor.id, fromFolderName: ancestor.name };
      if (ancestor.createdBy !== folder.createdBy) {
        inherited.push({
          ...labels.share({ principalType: 'user', principalId: ancestor.createdBy, role: 'manager' }, today),
          ...from,
          owner: true,
        });
      }
      for (const share of on(ancestor.id)) inherited.push({ ...share, ...from });
    }

    return {
      folderId: folder.id,
      folderName: folder.name,
      owner: { userId: folder.createdBy, name: labels.personName(folder.createdBy) },
      shares: on(folder.id),
      inherited,
    };
  }
}

/** Mọi người, phòng ban, chức danh, nhân sự; trong mỗi nhóm theo tên. */
function sortShares(shares: SharedFolderShare[]): SharedFolderShare[] {
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  return shares.sort(
    (left, right) =>
      SHARED_PRINCIPAL_TYPES.indexOf(left.principalType) - SHARED_PRINCIPAL_TYPES.indexOf(right.principalType) ||
      collator.compare(left.label, right.label),
  );
}

/** Tên, đường dẫn tổ chức của người và node, để hiện trên dòng chia sẻ và ô chọn. */
class Labels {
  private readonly people: Map<string, TenantPerson>;
  private readonly nodes: Map<string, OrganizationNode>;
  private readonly paths = new Map<string, string>();

  constructor(
    people: readonly TenantPerson[],
    private readonly snapshot: OrganizationSnapshot,
  ) {
    this.people = new Map(people.map((person) => [person.id, person]));
    this.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  }

  personName(userId: string): string | undefined {
    return this.people.get(userId)?.name;
  }

  pathOf(nodeId: string): string {
    let path = this.paths.get(nodeId);
    if (path === undefined) {
      path = nodePath(this.nodes, nodeId);
      this.paths.set(nodeId, path);
    }
    return path;
  }

  /** Người kèm phòng ban (node đơn vị gần nhất phía trên chỗ được bổ nhiệm) và chức danh. */
  person(person: TenantPerson): SharedDirectoryPerson {
    const unitNames: string[] = [];
    let positionName: string | undefined;
    for (const assignment of this.snapshot.assignments) {
      if (assignment.userId !== person.id) continue;
      let node = this.nodes.get(assignment.nodeId);
      if (node?.kind === 'position') {
        positionName ??= node.name;
        const seen = new Set<string>();
        while (node?.kind === 'position' && node.parentId && !seen.has(node.parentId)) {
          seen.add(node.parentId);
          node = this.nodes.get(node.parentId);
        }
      }
      if (node && node.kind === 'unit' && !unitNames.includes(node.name)) unitNames.push(node.name);
    }
    return { userId: person.id, displayName: person.name, email: person.email, unitNames, positionName };
  }

  share(share: SharedShareGrant & Partial<Pick<ShareRecord, 'updatedAt' | 'updatedBy'>>, today: string): SharedFolderShare {
    const base = {
      principalType: share.principalType,
      principalId: share.principalId,
      role: share.role,
      expiresOn: share.expiresOn,
      expired: !shareActive(share, today),
      updatedAt: share.updatedAt,
      updatedByName: share.updatedBy ? this.personName(share.updatedBy) : undefined,
    };
    if (share.principalType === 'everyone') {
      return { ...base, label: SHARED_PRINCIPAL_TYPE_LABELS.everyone, missing: false };
    }
    if (share.principalType === 'user') {
      const person = share.principalId ? this.people.get(share.principalId) : undefined;
      if (!person) return { ...base, label: SHARED_PRINCIPAL_TYPE_LABELS.user, missing: true };
      const described = this.person(person);
      const detail = [described.positionName, ...described.unitNames].filter(Boolean).join(' · ') || person.email;
      return { ...base, label: person.name, detail, missing: false };
    }
    const node = share.principalId ? this.nodes.get(share.principalId) : undefined;
    if (!node) {
      // Không đọc được sơ đồ tổ chức thì chưa biết node còn hay mất.
      return { ...base, label: SHARED_PRINCIPAL_TYPE_LABELS[share.principalType], missing: !this.snapshot.degraded };
    }
    return { ...base, label: node.name, detail: this.pathOf(node.id) || undefined, missing: false };
  }
}

/**
 * Kiểm danh sách chia sẻ gửi lên. Đối tượng mới phải có thật; dòng đã có thì
 * giữ được kể cả khi đối tượng đã rời sơ đồ tổ chức, để sửa dòng khác không bị
 * kẹt vì một dòng cũ.
 */
export function validateGrants(
  input: UpdateSharedFolderSharesRequest | undefined,
  context: {
    readonly current: readonly SharedShareGrant[];
    readonly people: readonly TenantPerson[];
    readonly snapshot: OrganizationSnapshot;
  },
): SharedShareGrant[] {
  if (!input || !Array.isArray(input.shares)) {
    throw new SharedValidationError('Danh sách chia sẻ không hợp lệ.');
  }
  if (input.shares.length > SHARED_MAX_SHARES_PER_FOLDER) {
    throw new SharedValidationError(`Một thư mục chia sẻ cho tối đa ${SHARED_MAX_SHARES_PER_FOLDER} đối tượng.`);
  }
  const existing = new Set(context.current.map(keyOf));
  const people = new Map(context.people.map((person) => [person.id, person]));
  const nodes = new Map(context.snapshot.nodes.map((node) => [node.id, node]));

  const grants: SharedShareGrant[] = [];
  const keys = new Set<string>();
  for (const raw of input.shares) {
    const principalType = String(raw?.principalType ?? '') as SharedPrincipalType;
    if (!SHARED_PRINCIPAL_TYPES.includes(principalType)) {
      throw new SharedValidationError('Đối tượng chia sẻ không hợp lệ.');
    }
    const role = String(raw?.role ?? '') as SharedFolderRole;
    if (!SHARED_FOLDER_ROLES.includes(role)) {
      throw new SharedValidationError('Chọn quyền cho mọi đối tượng được chia sẻ.');
    }
    let principalId: string | undefined;
    if (principalType !== 'everyone') {
      principalId = String(raw?.principalId ?? '').trim();
      if (!UUID.test(principalId)) throw new SharedValidationError('Chọn đối tượng cho mọi dòng chia sẻ.');
    }
    const expiresOn = raw?.expiresOn ? String(raw.expiresOn).trim() : undefined;
    if (expiresOn && (!DATE.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`)))) {
      throw new SharedValidationError('Thời hạn chia sẻ phải là ngày dạng YYYY-MM-DD.');
    }

    const grant: SharedShareGrant = { principalType, principalId, role, expiresOn };
    const key = keyOf(grant);
    if (keys.has(key)) throw new SharedValidationError('Mỗi đối tượng chỉ chia sẻ một lần trên một thư mục.');
    keys.add(key);

    if (!existing.has(key)) {
      if (principalType === 'user' && !people.get(principalId as string)?.active) {
        throw new SharedValidationError('Người được chia sẻ không còn trong danh sách người dùng.');
      }
      if (principalType === 'unit' || principalType === 'position') {
        if (context.snapshot.degraded) {
          throw new SharedValidationError(
            'Chưa đọc được sơ đồ tổ chức nên chưa chia sẻ theo phòng ban, chức danh được. Thử lại sau ít phút.',
          );
        }
        if (nodes.get(principalId as string)?.kind !== principalType) {
          throw new SharedValidationError(
            `${SHARED_PRINCIPAL_TYPE_LABELS[principalType]} được chọn không còn trong sơ đồ tổ chức.`,
          );
        }
      }
    }
    grants.push(grant);
  }
  return grants;
}
