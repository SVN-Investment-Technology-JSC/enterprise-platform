import {
  SAVED_FILTER_VIEWS,
  type CreateSavedFilterRequest,
  type CreateTagRequest,
  type SavedFilter,
  type SavedFilterView,
  type Tag,
  type UpdateTagRequest,
} from '@enterprise-platform/contracts-workspace';
import { ProjectForbiddenError, WorkspaceValidationError } from '../domain/workspace.error.js';
import type { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const COLOR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Danh mục dùng chung của Workspace: nhãn (cả tenant) và mẫu lọc (của từng
 * người, chia sẻ được trong một dự án).
 */
export class CatalogService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  tags(actor: WorkspaceActor): Promise<readonly Tag[]> {
    return this.store.tag.list(actor.tenantId);
  }

  /** Ai ghi được công việc cũng tạo được nhãn, để gắn nhãn không phải chờ ai. */
  createTag(actor: WorkspaceActor, input: CreateTagRequest): Promise<Tag> {
    return this.store.tag.create(actor.tenantId, actor.userId, {
      name: tagName(input.name),
      color: tagColor(input.color) ?? undefined,
    });
  }

  /** Đổi tên, đổi màu hay ẩn nhãn ảnh hưởng cả tenant: chỉ quản trị viên. */
  async updateTag(actor: WorkspaceActor, tagId: string, input: UpdateTagRequest): Promise<Tag> {
    if (!actor.isTenantAdmin) throw new ProjectForbiddenError();
    if (!UUID.test(tagId)) throw new WorkspaceValidationError('Nhãn không tồn tại.');
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch['name'] = tagName(input.name);
    if (input.color !== undefined) patch['color'] = tagColor(input.color);
    if (input.isActive !== undefined) patch['isActive'] = Boolean(input.isActive);
    const updated = await this.store.tag.update(actor.tenantId, tagId, patch);
    if (!updated) throw new WorkspaceValidationError('Nhãn không tồn tại.');
    return updated;
  }

  async savedFilters(
    actor: WorkspaceActor,
    query: { readonly view?: string; readonly projectId?: string },
  ): Promise<readonly SavedFilter[]> {
    const viewKey = viewOf(query.view);
    const projectId = query.projectId?.trim() || undefined;
    if (projectId) await this.projects.access(actor, projectId);
    return this.store.savedFilter.list(actor.tenantId, actor.userId, viewKey, projectId);
  }

  async createSavedFilter(
    actor: WorkspaceActor,
    input: CreateSavedFilterRequest,
  ): Promise<SavedFilter> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new WorkspaceValidationError('Tên mẫu lọc không được để trống.');
    if (name.length > 120) {
      throw new WorkspaceValidationError('Tên mẫu lọc không được dài quá 120 ký tự.');
    }
    const filter = input.filter;
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new WorkspaceValidationError('Nội dung mẫu lọc không hợp lệ.');
    }
    if (JSON.stringify(filter).length > 8000) {
      throw new WorkspaceValidationError('Mẫu lọc quá lớn.');
    }
    const projectId = input.projectId?.trim() || undefined;
    if (projectId) await this.projects.access(actor, projectId);
    if (input.isShared && !projectId) {
      throw new WorkspaceValidationError('Chỉ chia sẻ được mẫu lọc gắn với một dự án.');
    }
    return this.store.savedFilter.create(actor.tenantId, actor.userId, {
      viewKey: viewOf(input.viewKey),
      name,
      filter,
      isShared: Boolean(input.isShared),
      projectId,
    });
  }

  /** Chỉ người lưu (hoặc quản trị viên tenant) xoá được, kể cả mẫu đã chia sẻ. */
  async removeSavedFilter(actor: WorkspaceActor, filterId: string): Promise<void> {
    if (!UUID.test(filterId)) throw new WorkspaceValidationError('Mẫu lọc không tồn tại.');
    const filter = await this.store.savedFilter.findById(actor.tenantId, filterId);
    if (!filter) throw new WorkspaceValidationError('Mẫu lọc không tồn tại.');
    if (filter.ownerUserId !== actor.userId && !actor.isTenantAdmin) {
      throw new ProjectForbiddenError();
    }
    await this.store.savedFilter.remove(actor.tenantId, filterId);
  }
}

/** Tên nhãn về chữ thường để UNIQUE chặn được "Khẩn" lẫn "khẩn". */
function tagName(value: unknown): string {
  const name = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi');
  if (!name) throw new WorkspaceValidationError('Tên nhãn không được để trống.');
  if (name.length > 40) throw new WorkspaceValidationError('Tên nhãn không được dài quá 40 ký tự.');
  return name;
}

function tagColor(value: unknown): string | null {
  if (value == null || value === '') return null;
  const color = String(value).trim();
  if (!COLOR.test(color)) throw new WorkspaceValidationError('Màu nhãn phải có dạng #rrggbb.');
  return color.toLowerCase();
}

function viewOf(value: unknown): SavedFilterView {
  const view = String(value ?? '');
  if (!(SAVED_FILTER_VIEWS as readonly string[]).includes(view)) {
    throw new WorkspaceValidationError(`Màn hình "${view}" không có mẫu lọc.`);
  }
  return view as SavedFilterView;
}
