import {
  DEFAULT_ROLE_PERMISSIONS,
  PROJECT_PERMISSION_LABELS,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type Paged,
  type Project,
  type ProjectMember,
  type ProjectPermission,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type SetProjectMembersRequest,
  type SystemProjectRole,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectCodeConflictError,
  ProjectForbiddenError,
  ProjectHasOpenWorkItemsError,
  ProjectNotFoundError,
  ProjectPermissionForbiddenError,
  ProjectRoleForbiddenError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import type { DirectoryService } from './directory.service.js';
import type { ProjectGroupService } from './project-group.service.js';
import type { ProjectRoleService } from './project-role.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 60;

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ngữ cảnh truy cập một dự án: vai trò thật trong dự án, kèm cờ override của
 * quản trị viên tenant.
 */
export interface ProjectAccess {
  readonly project: Project;
  /** Rỗng khi người gọi là tenant-admin mà không phải thành viên dự án. */
  readonly role?: ProjectRole;
  readonly isTenantAdmin: boolean;
  /**
   * Quyền của vai trò, đọc từ cấu hình vai trò của tenant. Vắng thì dùng quyền
   * mặc định của vai hệ thống.
   */
  readonly permissions?: readonly ProjectPermission[];
}

/** Phần của `ProjectAccess` quyết định quyền. */
type AccessGrant = Pick<ProjectAccess, 'role' | 'isTenantAdmin' | 'permissions'>;

/** Quyền thật của thành viên (không tính cờ quản trị tenant). */
export function permissionsOf(access: AccessGrant): ReadonlySet<ProjectPermission> {
  if (!access.role) return new Set();
  if (access.role === 'owner') return new Set(PROJECT_PERMISSIONS);
  if (access.permissions) return new Set(access.permissions);
  const defaults = DEFAULT_ROLE_PERMISSIONS[access.role as SystemProjectRole] as
    | readonly ProjectPermission[]
    | undefined;
  return new Set(defaults ?? []);
}

/** Người gọi có quyền này trong dự án không. Quản trị tenant luôn có. */
export function hasProjectPermission(access: AccessGrant, permission: ProjectPermission): boolean {
  if (access.isTenantAdmin) return true;
  return permissionsOf(access).has(permission);
}

/** Như `hasProjectPermission` nhưng ném lỗi thay vì trả về boolean. */
export function requireProjectPermission(
  access: ProjectAccess,
  permission: ProjectPermission,
): void {
  if (!hasProjectPermission(access, permission)) {
    throw new ProjectPermissionForbiddenError(PROJECT_PERMISSION_LABELS[permission]);
  }
}

/** Danh sách quyền gửi xuống giao diện. */
export function effectivePermissions(access: AccessGrant): ProjectPermission[] {
  if (access.isTenantAdmin) return [...PROJECT_PERMISSIONS];
  const granted = permissionsOf(access);
  return PROJECT_PERMISSIONS.filter((permission) => granted.has(permission));
}

/**
 * Người gọi có ít nhất mức thẩm quyền `minimum` trong dự án hay không.
 *
 * Vai trò do tenant tự định nghĩa nên mức thẩm quyền suy ra từ quyền của vai:
 * - `viewer`: là thành viên;
 * - `member`: được cập nhật (toàn bộ hoặc phần liên quan);
 * - `manager`: được cập nhật toàn bộ dự án;
 * - `owner`: là chủ nhiệm.
 *
 * Để ngoài lớp để `WorkItemService` dùng lại mà không phải phụ thuộc vào
 * instance của `ProjectService`.
 */
export function hasProjectRole(access: ProjectAccess, minimum: SystemProjectRole): boolean {
  if (access.isTenantAdmin) return true;
  if (!access.role) return false;
  const granted = permissionsOf(access);
  switch (minimum) {
    case 'viewer':
      return true;
    case 'member':
      return granted.has('project.update_all') || granted.has('project.update_related');
    case 'manager':
      return granted.has('project.update_all');
    case 'owner':
      return access.role === 'owner';
    default:
      return false;
  }
}

/** Như `hasProjectRole` nhưng ném lỗi thay vì trả về boolean. */
export function requireProjectRole(access: ProjectAccess, minimum: SystemProjectRole): void {
  if (!hasProjectRole(access, minimum)) throw new ProjectRoleForbiddenError(minimum);
}

export class ProjectService {
  /**
   * `directory` để trống thì bỏ qua bước đối chiếu danh bạ — dùng trong test
   * chỉ quan tâm quy tắc vai trò.
   */
  constructor(
    private readonly store: WorkspaceStore,
    private readonly directory?: DirectoryService,
    /** Để trống thì dùng quyền mặc định của bốn vai hệ thống (test). */
    private readonly roles?: ProjectRoleService,
    /** Danh mục nhóm dự án. Để trống thì nhận tên nhóm tự do (test). */
    private readonly groups?: ProjectGroupService,
  ) {}

  /**
   * Phân giải quyền truy cập một dự án; dùng chung cho mọi endpoint chạm vào
   * dự án đó.
   *
   * Không phải thành viên và không phải quản trị viên thì nhận `403`, KHÔNG
   * phải `404`: dự án có thật, chỉ là không được xem. Ngược lại dự án không
   * tồn tại thì `404` — hai tình huống khác nhau, đừng trộn.
   */
  async access(actor: WorkspaceActor, projectId: string): Promise<ProjectAccess> {
    const project = await this.store.project.findById(actor.tenantId, projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
    if (!role && !actor.isTenantAdmin) throw new ProjectForbiddenError();

    const permissions =
      role && this.roles ? await this.roles.permissionsOf(actor.tenantId, role) : undefined;
    return { project, role, isTenantAdmin: actor.isTenantAdmin, permissions };
  }

  async list(
    actor: WorkspaceActor,
    query: {
      readonly search?: string;
      readonly status?: string;
      readonly projectType?: string;
      /** `only` | `exclude`; giá trị khác hoặc vắng là mọi dự án. */
      readonly archived?: string;
      readonly page?: number | string;
      readonly pageSize?: number | string;
    },
  ): Promise<Paged<ProjectSummary>> {
    const page = Math.max(Math.trunc(Number(query.page) || 1), 1);
    const pageSize = Math.min(
      Math.max(Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );

    const { items, total } = await this.store.project.list(actor.tenantId, {
      // Quản trị viên tenant bỏ hàng rào thành viên và thấy toàn bộ dự án.
      userId: actor.isTenantAdmin ? undefined : actor.userId,
      search: query.search?.trim() || undefined,
      status: parseStatus(query.status),
      projectType: query.projectType?.trim() || undefined,
      archived:
        query.archived === 'only' || query.archived === 'exclude' ? query.archived : undefined,
      page,
      pageSize,
    });

    // Số liệu tổng hợp và vai trò lấy theo lô cho cả trang, không lặp từng dòng.
    const ids = items.map((project) => project.id);
    const today = todayKey(timezoneOf(actor.tenantId));
    const rollups = await this.store.project.rollup(actor.tenantId, ids, today);
    const byProject = new Map(rollups.map((entry) => [entry.projectId, entry]));
    const myRoles = await this.rolesOf(actor, ids);

    return {
      items: items.map((project) => ({
        ...project,
        totalItems: byProject.get(project.id)?.totalItems ?? 0,
        closedItems: byProject.get(project.id)?.closedItems ?? 0,
        overdueItems: byProject.get(project.id)?.overdueItems ?? 0,
        myRole: myRoles.get(project.id)?.role,
        myPermissions: myRoles.get(project.id)?.permissions,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Nhóm dự án trong danh mục, kèm số dự án người gọi thấy được mỗi nhóm. */
  async types(actor: WorkspaceActor): Promise<readonly ProjectTypeOption[]> {
    return this.store.project.types(
      actor.tenantId,
      actor.isTenantAdmin ? undefined : actor.userId,
    );
  }

  async detail(actor: WorkspaceActor, projectId: string): Promise<ProjectSummary> {
    const access = await this.access(actor, projectId);
    const [rollup] = await this.store.project.rollup(
      actor.tenantId,
      [projectId],
      todayKey(timezoneOf(actor.tenantId)),
    );
    return {
      ...access.project,
      totalItems: rollup?.totalItems ?? 0,
      closedItems: rollup?.closedItems ?? 0,
      overdueItems: rollup?.overdueItems ?? 0,
      myRole: access.role,
      myPermissions: effectivePermissions(access),
    };
  }

  async create(actor: WorkspaceActor, input: CreateProjectRequest): Promise<Project> {
    const code = String(input.code ?? '')
      .trim()
      .toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new WorkspaceValidationError(
        'Mã dự án chỉ gồm chữ in hoa, số và dấu gạch ngang, dài 2 đến 32 ký tự.',
      );
    }
    const name = requireText(input.name, 'Tên dự án', 180);
    assertDateOrder(input.startDate, input.endDate);

    // Kiểm tra trước để trả mã lỗi rõ ràng; UNIQUE trên cột `code` vẫn là chốt
    // chặn thật khi hai request vào cùng lúc.
    const existing = await this.store.project.findByCode(actor.tenantId, code);
    if (existing) throw new ProjectCodeConflictError(code);

    return this.store.project.create(actor.tenantId, actor.userId, {
      ...input,
      code,
      name,
      projectType: (await this.resolveGroup(actor, input.projectType)) ?? undefined,
      tagIds: await this.requireActiveTags(actor, input.tagIds),
    });
  }

  async update(
    actor: WorkspaceActor,
    projectId: string,
    input: UpdateProjectRequest,
  ): Promise<Project> {
    const access = await this.access(actor, projectId);
    // Đổi trạng thái là quyền riêng; sửa các trường khác cần cập nhật toàn bộ dự án.
    const touchesOther = Object.entries(input ?? {}).some(
      ([key, value]) => key !== 'status' && value !== undefined,
    );
    if (input.status !== undefined) requireProjectPermission(access, 'project.update_status');
    if (touchesOther || input.status === undefined) requireProjectRole(access, 'manager');

    const patch: UpdateProjectRequest = { ...input };
    if (input.name !== undefined) {
      Object.assign(patch, { name: requireText(input.name, 'Tên dự án', 180) });
    }
    if (input.projectType !== undefined) {
      Object.assign(patch, { projectType: await this.resolveGroup(actor, input.projectType) });
    }
    if (input.tagIds !== undefined) {
      Object.assign(patch, { tagIds: await this.requireActiveTags(actor, input.tagIds) });
    }
    if (input.status !== undefined && !parseStatus(input.status)) {
      throw new WorkspaceValidationError(`Trạng thái dự án "${input.status}" không hợp lệ.`);
    }
    // Đóng hồ sơ (chốt sổ) là bước một chiều: chặn khi dự án còn công việc chưa
    // đóng, kẻo tiến độ và báo cáo không còn khớp thực tế. Chỉ kiểm khi đang
    // CHUYỂN sang `completed` — sửa dự án đã hoàn thành (vd đổi mô tả) không kích.
    if (input.status === 'completed' && access.project.status !== 'completed') {
      const openItems = await this.store.workItem.openItemCount(actor.tenantId, projectId);
      if (openItems > 0) throw new ProjectHasOpenWorkItemsError();
    }
    // Đổi chủ nhiệm là thay người chịu trách nhiệm cuối cùng: chỉ chủ nhiệm
    // hiện tại hoặc quản trị viên tenant được làm.
    if (input.ownerUserId !== undefined) requireProjectRole(access, 'owner');

    assertDateOrder(
      input.startDate === undefined ? access.project.startDate : input.startDate,
      input.endDate === undefined ? access.project.endDate : input.endDate,
    );

    return this.store.project.update(actor.tenantId, projectId, patch, actor.userId);
  }

  /** Nhóm của dự án phải có trong danh mục; `null` là gỡ khỏi nhóm. */
  private async resolveGroup(actor: WorkspaceActor, value: unknown): Promise<string | null> {
    return this.groups ? this.groups.resolve(actor.tenantId, value) : cleanType(value);
  }

  /** Chỉ gắn được nhãn đang dùng; id lạ hay nhãn đã ẩn bị từ chối. */
  private async requireActiveTags(
    actor: WorkspaceActor,
    tagIds: readonly string[] | undefined,
  ): Promise<string[]> {
    const ids = [...new Set((tagIds ?? []).map(String))];
    if (ids.length === 0) return [];
    if (ids.some((id) => !UUID.test(id))) {
      throw new WorkspaceValidationError('Có nhãn không tồn tại hoặc đã ngừng dùng.');
    }
    const tags = await this.store.tag.findByIds(actor.tenantId, ids);
    const active = new Set(tags.filter((tag) => tag.isActive).map((tag) => tag.id));
    if (ids.some((id) => !active.has(id))) {
      throw new WorkspaceValidationError('Có nhãn không tồn tại hoặc đã ngừng dùng.');
    }
    return ids;
  }

  /**
   * Mở lưu trữ: dự án đã hoàn thành về lại "Đang chạy" để thêm công việc; dấu lưu trữ tự bỏ theo trạng
   * thái. Cùng quyền với đổi trạng thái dự án.
   */
  async unarchive(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectPermission(access, 'project.update_status');
    if (!access.project.archivedAt) {
      throw new WorkspaceValidationError('Dự án này không nằm trong lưu trữ.');
    }
    return this.store.project.update(actor.tenantId, projectId, { status: 'active' }, actor.userId);
  }

  /** Huỷ dự án: chuyển trạng thái, không xoá dòng. Lịch sử phải giữ lại. */
  async cancel(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectRole(access, 'owner');
    return this.store.project.update(actor.tenantId, projectId, { status: 'cancelled' }, actor.userId);
  }

  async members(actor: WorkspaceActor, projectId: string): Promise<readonly ProjectMember[]> {
    await this.access(actor, projectId);
    return this.store.member.list(actor.tenantId, projectId);
  }

  async setMembers(
    actor: WorkspaceActor,
    projectId: string,
    input: SetProjectMembersRequest,
  ): Promise<readonly ProjectMember[]> {
    const access = await this.access(actor, projectId);
    requireProjectPermission(access, 'project.manage_members');

    const members = input.members ?? [];
    // Không có chủ nhiệm thì không ai huỷ hay đổi chủ được dự án nữa; nhiều
    // chủ nhiệm thì không rõ ai chịu trách nhiệm.
    const owners = members.filter((member) => member.role === 'owner');
    if (owners.length !== 1) {
      throw new WorkspaceValidationError('Dự án phải có đúng một chủ nhiệm.');
    }
    const unique = new Set(members.map((member) => member.userId));
    if (unique.size !== members.length) {
      throw new WorkspaceValidationError('Một người chỉ được xuất hiện một lần trong danh sách.');
    }
    for (const member of members) {
      const known = this.roles
        ? await this.roles.exists(actor.tenantId, member.role)
        : (PROJECT_ROLES as readonly string[]).includes(member.role);
      if (!known) {
        throw new WorkspaceValidationError(`Vai trò "${member.role}" không hợp lệ.`);
      }
    }

    const current = await this.store.member.list(actor.tenantId, projectId);

    // Người mới thêm phải có trong tổ chức. Chỉ kiểm người MỚI: một thành
    // viên cũ đã rời tổ chức vẫn giữ được trong danh sách cho tới khi bàn
    // giao xong việc của họ.
    const existing = new Set(current.map((member) => member.userId));
    const added = members.map((member) => member.userId).filter((userId) => !existing.has(userId));
    const unknown = await this.directory?.unknownUserIds(actor.tenantId, added);
    if (unknown && unknown.length > 0) {
      throw new WorkspaceValidationError(
        `Không tìm thấy ${unknown.length} người trong tổ chức. Hãy chọn người từ danh bạ.`,
      );
    }

    // Gỡ người vẫn đang gánh việc chưa đóng sẽ để lại công việc không có chủ.
    const removed = current
      .filter((member) => !unique.has(member.userId))
      .map((member) => member.userId);
    if (removed.length > 0) {
      const open = await this.store.member.openItemCounts(actor.tenantId, projectId, removed);
      const blocked = [...open.values()].filter((count) => count > 0).length;
      if (blocked > 0) {
        throw new WorkspaceValidationError(
          `Không thể gỡ ${blocked} thành viên vẫn còn công việc chưa đóng. ` +
            'Hãy chuyển giao công việc của họ trước.',
        );
      }
    }

    return this.store.member.replaceAll(actor.tenantId, projectId, actor.userId, members);
  }

  /** Vai trò và quyền của người gọi trong nhiều dự án cùng lúc. */
  private async rolesOf(
    actor: WorkspaceActor,
    projectIds: readonly string[],
  ): Promise<Map<string, { role?: ProjectRole; permissions: ProjectPermission[] }>> {
    const roles = new Map<string, { role?: ProjectRole; permissions: ProjectPermission[] }>();
    await Promise.all(
      projectIds.map(async (projectId) => {
        const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
        if (!role && !actor.isTenantAdmin) return;
        const permissions =
          role && this.roles ? await this.roles.permissionsOf(actor.tenantId, role) : undefined;
        roles.set(projectId, {
          role,
          permissions: effectivePermissions({
            role,
            isTenantAdmin: actor.isTenantAdmin,
            permissions,
          }),
        });
      }),
    );
    return roles;
  }
}

function parseStatus(value: unknown): ProjectStatus | undefined {
  if (!value) return undefined;
  const text = String(value);
  return (PROJECT_STATUSES as readonly string[]).includes(text)
    ? (text as ProjectStatus)
    : undefined;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

/** Ngày ở dạng `YYYY-MM-DD` nên so sánh chuỗi là đủ và đúng. */
function assertDateOrder(start?: string | null, end?: string | null): void {
  if (start && end && start > end) {
    throw new WorkspaceValidationError('Ngày kết thúc phải sau ngày bắt đầu.');
  }
}

/** Loại dự án là chữ tự do; rỗng nghĩa là gỡ loại. */
function cleanType(value: unknown): string | null {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length > 80) {
    throw new WorkspaceValidationError('Nhóm dự án không được dài quá 80 ký tự.');
  }
  return text;
}
