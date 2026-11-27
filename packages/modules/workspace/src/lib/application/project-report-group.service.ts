import { randomUUID } from 'node:crypto';
import type {
  Project,
  ProjectReportGroup,
  ProjectReportGroupList,
  ProjectRole,
  SaveProjectReportGroupsRequest,
  SetProjectReportGroupRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectForbiddenError,
  ProjectNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { seesAllProjects } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Khoá của danh mục nhóm báo cáo trong `workspace_settings`: mảng `{ id, name, sortOrder }`. */
export const PROJECT_REPORT_GROUPS_KEY = 'project_report_groups';
export const PROJECT_REPORT_GROUP_NAME_MAX_LENGTH = 80;
export const PROJECT_REPORT_GROUPS_MAX = 30;

/**
 * Danh mục nhóm báo cáo của tenant (Cài đặt > Nhóm báo cáo) và nhóm báo cáo của từng dự án.
 *
 * Khác nhóm dự án: ít nhóm hơn, chỉ dùng khi xuất báo cáo doanh thu theo lĩnh vực. Không có bảng riêng: danh mục nằm
 * trong `workspace_settings`, nhóm của dự án nằm trong `projects.metadata.reportGroupId`.
 *
 * Ai dùng Workspace cũng đọc được danh mục; chỉ quản trị (canManage hoặc quản trị tenant) được sửa, cùng luật với nhóm
 * dự án. Id dự án trỏ tới nhóm không còn trong danh mục thì coi là chưa phân nhóm.
 */
export class ProjectReportGroupService {
  constructor(
    private readonly store: WorkspaceStore,
    /** Sinh id cho nhóm mới; test truyền hàm cố định. */
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(actor: WorkspaceActor): Promise<ProjectReportGroupList> {
    return { items: await this.items(actor.tenantId), canEdit: canEditReportGroups(actor) };
  }

  /** Danh mục hiện tại, đã sắp theo thứ tự. */
  async items(tenantId: string): Promise<ProjectReportGroup[]> {
    return parseReportGroups(await this.store.settings.get(tenantId, PROJECT_REPORT_GROUPS_KEY));
  }

  /**
   * Thay cả danh sách theo đúng thứ tự gửi lên. Dòng có `id` của nhóm cũ giữ id đó (dự án đã gán không mất nhóm); dòng
   * không có id là nhóm mới. Nhóm bị bỏ khỏi danh sách thì các dự án đang gán nhóm đó về chưa phân nhóm.
   */
  async save(actor: WorkspaceActor, input: SaveProjectReportGroupsRequest): Promise<ProjectReportGroupList> {
    if (!canEditReportGroups(actor)) throw new ProjectForbiddenError();
    const existing = await this.items(actor.tenantId);
    const next = buildReportGroups(input, existing, this.newId);
    await this.store.settings.set(actor.tenantId, PROJECT_REPORT_GROUPS_KEY, next, actor.userId);
    const kept = new Set(next.map((group) => group.id));
    const removed = existing.filter((group) => !kept.has(group.id)).map((group) => group.id);
    if (removed.length > 0) await this.store.project.clearReportGroups(actor.tenantId, removed);
    return { items: next, canEdit: true };
  }

  /**
   * Gán (hoặc bỏ, `null`) nhóm báo cáo của một dự án. Dự án không có thì 404; người không được sửa thì 403, cùng mã như
   * các endpoint dự án khác khi không phải thành viên.
   *
   * Cố ý KHÔNG chặn dự án đã lưu trữ: nhóm báo cáo là phân loại để làm báo cáo, dự án đã xong vẫn phải gom đúng lĩnh vực
   * trong báo cáo doanh thu của năm.
   */
  async setForProject(
    actor: WorkspaceActor,
    projectId: string,
    input: SetProjectReportGroupRequest,
  ): Promise<Project> {
    const value = (input as { reportGroupId?: unknown } | undefined)?.reportGroupId;
    if (value !== null && typeof value !== 'string') {
      throw new WorkspaceValidationError('Thiếu nhóm báo cáo (gửi null để bỏ nhóm).');
    }
    const project = await this.store.project.findById(actor.tenantId, projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
    if (!canSetProjectReportGroup(actor, project, role)) throw new ProjectForbiddenError();

    const reportGroupId = value === null ? null : value.trim() || null;
    if (reportGroupId !== null) {
      const known = (await this.items(actor.tenantId)).some((group) => group.id === reportGroupId);
      if (!known) {
        throw new WorkspaceValidationError('Nhóm báo cáo không còn trong danh mục. Tải lại trang rồi chọn lại.');
      }
    }
    if ((project.reportGroupId ?? null) === reportGroupId) return project;
    return this.store.project.setReportGroup(actor.tenantId, projectId, reportGroupId);
  }
}

/** Sửa danh mục nhóm báo cáo: cùng luật với danh mục nhóm dự án. */
export function canEditReportGroups(actor: Pick<WorkspaceActor, 'canManage' | 'isTenantAdmin'>): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

/**
 * Ai được đổi nhóm báo cáo của một dự án: người tạo, chủ nhiệm, mọi thành viên (vai nào cũng được, kể cả người xem),
 * quản trị tenant và người giữ `workspace.project.admin`. Người ngoài dự án thì không.
 */
export function canSetProjectReportGroup(
  actor: Pick<WorkspaceActor, 'userId' | 'isTenantAdmin' | 'canAdminProjects'>,
  project: Pick<Project, 'createdBy' | 'ownerUserId'>,
  role: ProjectRole | undefined,
): boolean {
  if (seesAllProjects(actor)) return true;
  if (role) return true;
  return project.createdBy === actor.userId || project.ownerUserId === actor.userId;
}

/** Id nhóm của dự án nếu còn trong danh mục; id lạ (nhóm đã xoá) hay rỗng là chưa phân nhóm. */
export function knownReportGroupId(
  groups: readonly Pick<ProjectReportGroup, 'id'>[],
  reportGroupId: string | null | undefined,
): string | null {
  if (!reportGroupId) return null;
  return groups.some((group) => group.id === reportGroupId) ? reportGroupId : null;
}

/** Đọc giá trị đã lưu; dòng hỏng bị bỏ qua, không làm hỏng cả danh mục. */
export function parseReportGroups(value: unknown): ProjectReportGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const groups: ProjectReportGroup[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const { id, name, sortOrder } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id)) return;
    const cleanName = typeof name === 'string' ? normalize(name) : '';
    if (!cleanName) return;
    seen.add(id);
    groups.push({
      id,
      name: cleanName,
      sortOrder: typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : index,
    });
  });
  return groups.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Kiểm danh sách gửi lên và dựng danh mục mới: tên gọn khoảng trắng, 1 tới 80 ký tự, không trùng (không phân biệt hoa
 * thường), tối đa 30 nhóm. Id phải là nhóm đang có và không lặp; dòng không id nhận id mới. `sortOrder` theo thứ tự gửi.
 */
export function buildReportGroups(
  input: SaveProjectReportGroupsRequest | undefined,
  existing: readonly ProjectReportGroup[],
  newId: () => string,
): ProjectReportGroup[] {
  const rows = (input as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(rows)) throw new WorkspaceValidationError('Danh sách nhóm báo cáo không hợp lệ.');
  if (rows.length > PROJECT_REPORT_GROUPS_MAX) {
    throw new WorkspaceValidationError(`Tối đa ${PROJECT_REPORT_GROUPS_MAX} nhóm báo cáo.`);
  }
  const known = new Set(existing.map((group) => group.id));
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  return rows.map((row, index) => {
    const { id, name } = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const cleanName = typeof name === 'string' ? normalize(name) : '';
    if (!cleanName) throw new WorkspaceValidationError('Tên nhóm báo cáo không được để trống.');
    if (cleanName.length > PROJECT_REPORT_GROUP_NAME_MAX_LENGTH) {
      throw new WorkspaceValidationError(
        `Tên nhóm báo cáo không được dài quá ${PROJECT_REPORT_GROUP_NAME_MAX_LENGTH} ký tự.`,
      );
    }
    const folded = cleanName.toLocaleLowerCase('vi');
    if (usedNames.has(folded)) throw new WorkspaceValidationError(`Trùng tên nhóm báo cáo "${cleanName}".`);
    usedNames.add(folded);

    let groupId: string;
    if (id === undefined || id === null || id === '') {
      groupId = newId();
    } else {
      if (typeof id !== 'string' || !known.has(id)) {
        throw new WorkspaceValidationError(
          `Nhóm báo cáo "${cleanName}" không còn trong danh mục. Tải lại trang rồi sửa lại.`,
        );
      }
      if (usedIds.has(id)) throw new WorkspaceValidationError(`Nhóm báo cáo "${cleanName}" bị gửi hai lần.`);
      groupId = id;
    }
    usedIds.add(groupId);
    return { id: groupId, name: cleanName, sortOrder: index };
  });
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
