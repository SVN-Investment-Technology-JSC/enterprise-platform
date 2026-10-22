import {
  PROJECT_GROUP_CODE_PATTERN,
  type ProjectGroup,
  type ProjectGroupList,
  type SaveProjectGroupRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectForbiddenError,
  ProjectGroupNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Danh mục nhóm dự án do tenant tự quản.
 *
 * Ai cũng đọc được (để chọn nhóm khi tạo dự án và lọc); chỉ quản trị (canManage
 * hoặc quản trị tenant) được thêm, đổi tên, xoá. Đổi tên kéo theo mọi dự án
 * thuộc nhóm; xoá nhóm đưa dự án của nhóm về "Chưa phân loại".
 */
export class ProjectGroupService {
  constructor(private readonly store: WorkspaceStore) {}

  async list(actor: WorkspaceActor): Promise<ProjectGroupList> {
    return { items: await this.store.projectGroup.list(actor.tenantId), canEdit: canEdit(actor) };
  }

  async create(actor: WorkspaceActor, input: SaveProjectGroupRequest): Promise<ProjectGroupList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const existing = await this.store.projectGroup.list(actor.tenantId);
    const name = requireGroupName(input?.name, existing);
    const code = requireGroupCode(input?.code, existing) ?? null;
    await this.store.projectGroup.create(actor.tenantId, actor.userId, name, code);
    return this.list(actor);
  }

  async rename(
    actor: WorkspaceActor,
    id: string,
    input: SaveProjectGroupRequest,
  ): Promise<ProjectGroupList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const existing = await this.store.projectGroup.list(actor.tenantId);
    if (!existing.some((group) => group.id === id)) throw new ProjectGroupNotFoundError(id);
    const name = requireGroupName(input?.name, existing, id);
    // Không gửi `code` thì giữ mã cũ; gửi chuỗi rỗng là bỏ mã.
    const code = input?.code === undefined ? undefined : (requireGroupCode(input.code, existing, id) ?? null);
    await this.store.projectGroup.rename(actor.tenantId, actor.userId, id, name, code);
    return this.list(actor);
  }

  async remove(actor: WorkspaceActor, id: string): Promise<ProjectGroupList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const existing = await this.store.projectGroup.list(actor.tenantId);
    if (!existing.some((group) => group.id === id)) throw new ProjectGroupNotFoundError(id);
    await this.store.projectGroup.remove(actor.tenantId, id);
    return this.list(actor);
  }

  /**
   * Tên nhóm hợp lệ cho một dự án: phải có trong danh mục; trả về đúng cách viết
   * trong danh mục. Rỗng nghĩa là gỡ dự án khỏi nhóm.
   */
  async resolve(tenantId: string, value: unknown): Promise<string | null> {
    const name = normalize(value);
    if (!name) return null;
    const folded = name.toLocaleLowerCase('vi');
    const match = (await this.store.projectGroup.list(tenantId)).find(
      (group) => group.name.toLocaleLowerCase('vi') === folded,
    );
    if (!match) {
      throw new WorkspaceValidationError(
        `Nhóm dự án "${name}" chưa có trong danh mục. Thêm nhóm ở Cài đặt trước.`,
      );
    }
    return match.name;
  }
}

function canEdit(actor: WorkspaceActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function requireGroupName(
  value: unknown,
  existing: readonly ProjectGroup[],
  selfId?: string,
): string {
  const name = normalize(value);
  if (!name) throw new WorkspaceValidationError('Tên nhóm dự án không được để trống.');
  if (name.length > 80) {
    throw new WorkspaceValidationError('Tên nhóm dự án không được dài quá 80 ký tự.');
  }
  const folded = name.toLocaleLowerCase('vi');
  if (
    existing.some(
      (group) => group.id !== selfId && group.name.toLocaleLowerCase('vi') === folded,
    )
  ) {
    throw new WorkspaceValidationError(`Đã có nhóm dự án tên "${name}".`);
  }
  return name;
}

/**
 * Mã viết tắt của nhóm (token `{NHOM}` trong quy tắc mã dự án): chữ in hoa không dấu và số, không trùng nhóm khác.
 * Rỗng là không có mã.
 */
function requireGroupCode(
  value: unknown,
  existing: readonly ProjectGroup[],
  selfId?: string,
): string | undefined {
  const code = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!code) return undefined;
  if (!PROJECT_GROUP_CODE_PATTERN.test(code)) {
    throw new WorkspaceValidationError(
      'Mã viết tắt của nhóm chỉ gồm chữ in hoa không dấu và số, tối đa 16 ký tự.',
    );
  }
  const taken = existing.find((group) => group.id !== selfId && group.code?.toUpperCase() === code);
  if (taken) throw new WorkspaceValidationError(`Mã viết tắt "${code}" đã dùng cho nhóm "${taken.name}".`);
  return code;
}
