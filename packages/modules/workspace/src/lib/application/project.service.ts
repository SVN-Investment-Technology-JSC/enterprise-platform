import {
  CLOSED_WORK_ITEM_STATUSES,
  DEFAULT_CHAT_ON_ARCHIVED_POLICY,
  DEFAULT_PROJECT_TASK_TITLES,
  DEFAULT_REOPEN_PROJECT_POLICY,
  DEFAULT_ROLE_PERMISSIONS,
  WORKSPACE_CODE_MAX_LENGTH,
  PROJECT_PERMISSION_LABELS,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  CHAT_ON_ARCHIVED_POLICIES,
  REOPEN_PROJECT_POLICIES,
  type ChatOnArchivedPolicy,
  type CreateProjectRequest,
  type Paged,
  type Project,
  type ProjectArchiveSettings,
  type ProjectMember,
  type ProjectPermission,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type ReopenProjectPolicy,
  type SaveProjectArchiveSettingsRequest,
  type SetProjectMembersRequest,
  type SystemProjectRole,
  type UpdateProjectRequest,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectArchivedError,
  ProjectCodeConflictError,
  ProjectForbiddenError,
  ProjectHasOpenWorkItemsError,
  ProjectNotFoundError,
  ProjectPermissionForbiddenError,
  ProjectRoleForbiddenError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { parseManualPercent } from '../domain/progress.rules.js';
import { cleanTaskTitles } from '../domain/project-template.rules.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import type { DirectoryService } from './directory.service.js';
import type { ProjectCodeService } from './project-code.service.js';
import type { ProjectGroupService } from './project-group.service.js';
import type { ProjectRoleService } from './project-role.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 60;

/** Khoá của tuỳ chọn "tự đóng hồ sơ" trong `workspace_settings`. Mặc định tắt. */
const AUTO_ARCHIVE_KEY = 'project_auto_archive';
/** Khoá cách xử lý dự án đã Hoàn thành khi có công việc được hoàn tác. Mặc định `reactivate`. */
const REOPEN_PROJECT_KEY = 'project_reopen_policy';
/** Khoá cách xử lý trao đổi (chat) của dự án đã lưu trữ. Mặc định `block`. */
const CHAT_ARCHIVED_KEY = 'project_chat_on_archived';
/** Khoá mẫu công việc tạo sẵn khi tạo dự án: `{ enabled, titles }`. Mặc định tắt, kèm mẫu gợi ý. */
const DEFAULT_TASKS_KEY = 'project_default_tasks';
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
  /** Có `workspace.project.admin`: bỏ hàng rào thành viên như quản trị tenant, nhưng chỉ trong dự án. */
  readonly canAdminProjects?: boolean;
  /**
   * Quyền của vai trò, đọc từ cấu hình vai trò của tenant. Vắng thì dùng quyền
   * mặc định của vai hệ thống.
   */
  readonly permissions?: readonly ProjectPermission[];
}

/** Phần của `ProjectAccess` quyết định quyền. */
type AccessGrant = Pick<
  ProjectAccess,
  'role' | 'isTenantAdmin' | 'canAdminProjects' | 'permissions'
>;

/** Bỏ hàng rào thành viên dự án: quản trị tenant hoặc người giữ `workspace.project.admin`. */
export function seesAllProjects(
  who: { readonly isTenantAdmin: boolean; readonly canAdminProjects?: boolean },
): boolean {
  return who.isTenantAdmin || who.canAdminProjects === true;
}

/**
 * Dự án đã lưu trữ chỉ xem. Gọi ngay sau khi kiểm quyền ở mọi đường ghi vào dự án (công việc, tài liệu, lịch,
 * thành viên, tài chính...). Chỉ `archive` / `unarchive` đứng ngoài luật này.
 */
export function assertProjectWritable(project: Pick<Project, 'code' | 'archivedAt'>): void {
  if (project.archivedAt) throw new ProjectArchivedError(project.code);
}

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

/** Người gọi có quyền này trong dự án không. Quản trị tenant và người giữ `workspace.project.admin` luôn có. */
export function hasProjectPermission(access: AccessGrant, permission: ProjectPermission): boolean {
  if (seesAllProjects(access)) return true;
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
  if (seesAllProjects(access)) return [...PROJECT_PERMISSIONS];
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
  if (seesAllProjects(access)) return true;
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
    /** Quy tắc sinh mã dự án. Để trống thì dùng mã người gọi gửi lên (test). */
    private readonly codes?: ProjectCodeService,
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
    if (!role && !seesAllProjects(actor)) throw new ProjectForbiddenError();

    const permissions =
      role && this.roles ? await this.roles.permissionsOf(actor.tenantId, role) : undefined;
    return {
      project,
      role,
      isTenantAdmin: actor.isTenantAdmin,
      canAdminProjects: actor.canAdminProjects === true,
      permissions,
    };
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
      // Quản trị viên tenant và người giữ `workspace.project.admin` bỏ hàng rào thành viên, thấy toàn bộ dự án.
      userId: seesAllProjects(actor) ? undefined : actor.userId,
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
      seesAllProjects(actor) ? undefined : actor.userId,
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
    const name = requireText(input.name, 'Tên dự án', 180);
    assertDateOrder(input.startDate, input.endDate);
    const projectType = (await this.resolveGroup(actor, input.projectType)) ?? undefined;
    const orgUnitId = (await this.requireOrgUnit(actor, input.orgUnitId)) ?? undefined;
    const tagIds = await this.requireActiveTags(actor, input.tagIds);

    // Mã do server sinh theo quy tắc ở Cài đặt; mã người gọi gửi lên bị bỏ qua. Số được cấp trong transaction tạo
    // dự án (xem store), nên không cần kiểm trùng trước.
    if (this.codes) {
      const codeParts = await this.codes.partsFor(actor.tenantId, projectType);
      return this.store.project.create(actor.tenantId, actor.userId, {
        ...input,
        code: undefined,
        codeParts,
        name,
        projectType,
        orgUnitId,
        tagIds,
      });
    }

    const code = String(input.code ?? '').trim();
    if (!code) throw new WorkspaceValidationError('Mã dự án không được để trống.');
    if (code.length > WORKSPACE_CODE_MAX_LENGTH) {
      throw new WorkspaceValidationError(`Mã dự án dài tối đa ${WORKSPACE_CODE_MAX_LENGTH} ký tự.`);
    }
    // Kiểm tra trước để trả mã lỗi rõ ràng; UNIQUE trên cột `code` vẫn là chốt
    // chặn thật khi hai request vào cùng lúc.
    const existing = await this.store.project.findByCode(actor.tenantId, code);
    if (existing) throw new ProjectCodeConflictError(code);

    return this.store.project.create(actor.tenantId, actor.userId, {
      ...input,
      code,
      name,
      projectType,
      orgUnitId,
      tagIds,
    });
  }

  async update(
    actor: WorkspaceActor,
    projectId: string,
    input: UpdateProjectRequest,
  ): Promise<Project> {
    const access = await this.access(actor, projectId);
    assertProjectWritable(access.project);
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
    if (input.orgUnitId !== undefined) {
      Object.assign(patch, { orgUnitId: await this.requireOrgUnit(actor, input.orgUnitId) });
    }
    if (input.tagIds !== undefined) {
      Object.assign(patch, { tagIds: await this.requireActiveTags(actor, input.tagIds) });
    }
    if (input.manualProgressPercent !== undefined) {
      Object.assign(patch, { manualProgressPercent: parseManualPercent(input.manualProgressPercent) });
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

  /**
   * Phòng ban phụ trách phải là một đơn vị trên cây tổ chức (không phải chức danh). Rỗng là bỏ. Danh bạ không đọc
   * được thì không chặn.
   */
  private async requireOrgUnit(actor: WorkspaceActor, value: unknown): Promise<string | null> {
    const id = String(value ?? '').trim();
    if (!id) return null;
    if (!UUID.test(id)) throw new WorkspaceValidationError('Phòng ban phụ trách không hợp lệ.');
    const known = await this.directory?.isOrgUnit(actor.tenantId, id);
    if (known === false) {
      throw new WorkspaceValidationError('Phòng ban phụ trách không có trong cây tổ chức.');
    }
    return id;
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
  /**
   * Đóng hồ sơ thủ công: đưa dự án vào Lưu trữ, GIỮ NGUYÊN trạng thái. Đóng được cả khi còn công việc chưa xong —
   * người có quyền tự quyết; tự đóng khi mọi việc đã xong là tuỳ chọn riêng ở Cài đặt (`autoArchiveIfDone`).
   */
  async archive(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectPermission(access, 'project.update_status');
    if (access.project.archivedAt) {
      throw new WorkspaceValidationError('Dự án này đã nằm trong lưu trữ.');
    }
    return this.store.project.setArchived(actor.tenantId, projectId, true);
  }

  /** Cài đặt đóng hồ sơ: ai cũng đọc được, quản trị (canManage hoặc quản trị tenant) sửa. */
  async archiveSettings(actor: WorkspaceActor): Promise<ProjectArchiveSettings> {
    return {
      autoArchive: await this.autoArchiveEnabled(actor.tenantId),
      reopenProject: await this.reopenProjectPolicy(actor.tenantId),
      chatOnArchived: await this.chatOnArchivedPolicy(actor.tenantId),
      ...(await this.defaultTaskSettings(actor.tenantId)),
      canEdit: actor.canManage || actor.isTenantAdmin,
    };
  }

  /** Lưu từng phần: trường nào gửi lên thì đổi, trường vắng giữ nguyên. */
  async saveArchiveSettings(
    actor: WorkspaceActor,
    input: SaveProjectArchiveSettingsRequest,
  ): Promise<ProjectArchiveSettings> {
    if (!(actor.canManage || actor.isTenantAdmin)) throw new ProjectForbiddenError();
    if (
      input?.autoArchive === undefined &&
      input?.reopenProject === undefined &&
      input?.chatOnArchived === undefined &&
      input?.defaultTasksEnabled === undefined &&
      input?.defaultTaskTitles === undefined
    ) {
      throw new WorkspaceValidationError('Không có cài đặt nào để lưu.');
    }
    if (input.autoArchive !== undefined) {
      if (typeof input.autoArchive !== 'boolean') {
        throw new WorkspaceValidationError('Chọn Có hoặc Không cho "Tự đóng hồ sơ".');
      }
      await this.store.settings.set(
        actor.tenantId,
        AUTO_ARCHIVE_KEY,
        { enabled: input.autoArchive },
        actor.userId,
      );
    }
    if (input.reopenProject !== undefined) {
      if (!(REOPEN_PROJECT_POLICIES as readonly string[]).includes(input.reopenProject)) {
        throw new WorkspaceValidationError('Chọn cách xử lý dự án khi công việc được hoàn tác.');
      }
      await this.store.settings.set(
        actor.tenantId,
        REOPEN_PROJECT_KEY,
        { policy: input.reopenProject },
        actor.userId,
      );
    }
    if (input.chatOnArchived !== undefined) {
      if (!(CHAT_ON_ARCHIVED_POLICIES as readonly string[]).includes(input.chatOnArchived)) {
        throw new WorkspaceValidationError('Chọn chặn hay cho nhắn trong dự án đã lưu trữ.');
      }
      await this.store.settings.set(
        actor.tenantId,
        CHAT_ARCHIVED_KEY,
        { policy: input.chatOnArchived },
        actor.userId,
      );
    }
    if (input.defaultTasksEnabled !== undefined || input.defaultTaskTitles !== undefined) {
      if (input.defaultTasksEnabled !== undefined && typeof input.defaultTasksEnabled !== 'boolean') {
        throw new WorkspaceValidationError('Chọn Bật hoặc Tắt cho "Tạo sẵn công việc khi tạo dự án".');
      }
      const current = await this.defaultTaskSettings(actor.tenantId);
      await this.store.settings.set(
        actor.tenantId,
        DEFAULT_TASKS_KEY,
        {
          enabled: input.defaultTasksEnabled ?? current.defaultTasksEnabled,
          titles:
            input.defaultTaskTitles === undefined ? [...current.defaultTaskTitles] : cleanTaskTitles(input.defaultTaskTitles),
        },
        actor.userId,
      );
    }
    return this.archiveSettings(actor);
  }

  /** Mẫu công việc tạo sẵn của tenant: tắt và mẫu gợi ý khi chưa cấu hình. */
  async defaultTaskSettings(
    tenantId: string,
  ): Promise<{ defaultTasksEnabled: boolean; defaultTaskTitles: readonly string[] }> {
    const value = (await this.store.settings.get(tenantId, DEFAULT_TASKS_KEY)) as
      | { enabled?: unknown; titles?: unknown }
      | undefined;
    let titles: readonly string[] = DEFAULT_PROJECT_TASK_TITLES;
    if (Array.isArray(value?.titles)) {
      try {
        titles = cleanTaskTitles(value?.titles);
      } catch {
        // Giá trị lưu hỏng thì quay về mẫu gợi ý, không để cả màn tạo dự án lỗi.
        titles = DEFAULT_PROJECT_TASK_TITLES;
      }
    }
    return { defaultTasksEnabled: value?.enabled === true, defaultTaskTitles: titles };
  }

  /** Như `access` nhưng từ chối khi dự án đã lưu trữ: dùng cho mọi đường ghi. */
  async writableAccess(actor: WorkspaceActor, projectId: string): Promise<ProjectAccess> {
    const access = await this.access(actor, projectId);
    assertProjectWritable(access.project);
    return access;
  }

  /**
   * Nhắn tin trong dự án đã lưu trữ: tenant chọn chặn hay vẫn cho. Dự án chưa lưu trữ luôn qua.
   */
  async requireChatOpen(tenantId: string, project: Pick<Project, 'code' | 'archivedAt'>): Promise<void> {
    if (!project.archivedAt) return;
    if ((await this.chatOnArchivedPolicy(tenantId)) === 'allow') return;
    throw new ProjectArchivedError(project.code);
  }

  private async chatOnArchivedPolicy(tenantId: string): Promise<ChatOnArchivedPolicy> {
    const value = (await this.store.settings.get(tenantId, CHAT_ARCHIVED_KEY)) as { policy?: unknown } | undefined;
    return (CHAT_ON_ARCHIVED_POLICIES as readonly unknown[]).includes(value?.policy)
      ? (value?.policy as ChatOnArchivedPolicy)
      : DEFAULT_CHAT_ON_ARCHIVED_POLICY;
  }

  /**
   * Một công việc đã hoàn thành vừa được hoàn tác (hoặc mở lại để thêm việc con). Dự án đang `completed` thì về
   * `active` nếu tenant chọn `reactivate` — chuyển trạng thái tự bỏ dấu lưu trữ do hoàn thành; chọn `keep` thì giữ
   * nguyên trạng thái. Dự án ở trạng thái khác không bị đụng tới.
   */
  async onItemReopened(tenantId: string, actorUserId: string, projectId: string): Promise<void> {
    const project = await this.store.project.findById(tenantId, projectId);
    if (!project || project.status !== 'completed') return;
    if ((await this.reopenProjectPolicy(tenantId)) !== 'reactivate') return;
    await this.store.project.update(tenantId, projectId, { status: 'active' }, actorUserId);
  }

  private async reopenProjectPolicy(tenantId: string): Promise<ReopenProjectPolicy> {
    const value = (await this.store.settings.get(tenantId, REOPEN_PROJECT_KEY)) as { policy?: unknown } | undefined;
    return (REOPEN_PROJECT_POLICIES as readonly unknown[]).includes(value?.policy)
      ? (value?.policy as ReopenProjectPolicy)
      : DEFAULT_REOPEN_PROJECT_POLICY;
  }

  /**
   * Tự đóng hồ sơ khi mọi công việc của dự án đã hoàn thành hoặc đã huỷ, nếu tenant bật tuỳ chọn này. Gọi sau mỗi
   * lần tính lại tiến độ, với trạng thái hiện tại của mọi công việc. Dự án chưa có công việc, đã lưu trữ hay đã
   * huỷ thì không đụng tới; trạng thái dự án giữ nguyên.
   */
  async autoArchiveIfDone(
    tenantId: string,
    projectId: string,
    statuses: readonly string[],
  ): Promise<void> {
    if (statuses.length === 0) return;
    if (statuses.some((status) => !CLOSED_WORK_ITEM_STATUSES.includes(status as WorkItemStatus))) return;
    if (!(await this.autoArchiveEnabled(tenantId))) return;
    const project = await this.store.project.findById(tenantId, projectId);
    if (!project || project.archivedAt || project.status === 'cancelled') return;
    await this.store.project.setArchived(tenantId, projectId, true);
  }

  private async autoArchiveEnabled(tenantId: string): Promise<boolean> {
    const value = (await this.store.settings.get(tenantId, AUTO_ARCHIVE_KEY)) as { enabled?: unknown } | undefined;
    return value?.enabled === true;
  }

  /**
   * Mở lưu trữ: dự án về danh sách đang làm và được sửa lại. Dự án đã Hoàn thành thì về "Đang chạy" hoặc giữ
   * trạng thái Hoàn thành, theo cài đặt của tenant; dự án đóng hồ sơ thủ công thì giữ nguyên trạng thái của nó.
   */
  async unarchive(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectPermission(access, 'project.update_status');
    if (!access.project.archivedAt) {
      throw new WorkspaceValidationError('Dự án này không nằm trong lưu trữ.');
    }
    if (access.project.status === 'completed' && (await this.reopenProjectPolicy(actor.tenantId)) === 'reactivate') {
      return this.store.project.update(actor.tenantId, projectId, { status: 'active' }, actor.userId);
    }
    return this.store.project.setArchived(actor.tenantId, projectId, false);
  }

  /** Huỷ dự án: chuyển trạng thái, không xoá dòng. Lịch sử phải giữ lại. */
  async cancel(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectRole(access, 'owner');
    assertProjectWritable(access.project);
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
    assertProjectWritable(access.project);

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
        if (!role && !seesAllProjects(actor)) return;
        const permissions =
          role && this.roles ? await this.roles.permissionsOf(actor.tenantId, role) : undefined;
        roles.set(projectId, {
          role,
          permissions: effectivePermissions({
            role,
            isTenantAdmin: actor.isTenantAdmin,
            canAdminProjects: actor.canAdminProjects,
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
