import {
  DEFAULT_PROJECT_CODE_TEMPLATE,
  normalizeProjectCodeTemplate,
  nextProjectCodeNumber,
  formatProjectCode,
  projectCodeParts,
  projectCodeTemplateError,
  type ProjectCodeParts,
  type ProjectCodePreview,
  type ProjectCodeSettings,
  type SaveProjectCodeRuleRequest,
} from '@enterprise-platform/contracts-workspace';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import { ProjectForbiddenError, WorkspaceValidationError } from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Khoá của quy tắc trong `workspace_settings`. */
const RULE_KEY = 'project_code_rule';

/**
 * Quy tắc sinh mã dự án của tenant (Cài đặt > Mã dự án).
 *
 * Ai cũng đọc được quy tắc và xem trước mã (để form tạo dự án hiện mã dự kiến); chỉ quản trị (canManage hoặc quản
 * trị tenant) được đổi quy tắc, như danh mục nhóm dự án. Đổi quy tắc không đổi mã các dự án đã có.
 */
export class ProjectCodeService {
  constructor(private readonly store: WorkspaceStore) {}

  async settings(actor: WorkspaceActor): Promise<ProjectCodeSettings> {
    const saved = await this.savedTemplate(actor.tenantId);
    return {
      template: saved ?? DEFAULT_PROJECT_CODE_TEMPLATE,
      isDefault: saved === undefined,
      canEdit: canEdit(actor),
    };
  }

  async saveRule(actor: WorkspaceActor, input: SaveProjectCodeRuleRequest): Promise<ProjectCodeSettings> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const template = normalizeProjectCodeTemplate(input?.template ?? '');
    const error = projectCodeTemplateError(template);
    if (error) throw new WorkspaceValidationError(error);
    await this.store.settings.set(actor.tenantId, RULE_KEY, { template }, actor.userId);
    return this.settings(actor);
  }

  /**
   * Mã dự kiến cho một dự án sắp tạo trong nhóm `projectType`. Chỉ để xem: số thật được cấp lúc lưu, nên có thể
   * nhảy lên nếu người khác tạo dự án cùng dãy ngay trước đó.
   */
  async preview(actor: WorkspaceActor, projectType?: string): Promise<ProjectCodePreview> {
    try {
      const parts = await this.partsFor(actor.tenantId, projectType);
      const existing = await this.store.project.codesMatching(actor.tenantId, parts);
      return { code: formatProjectCode(parts, nextProjectCodeNumber(parts, existing)) };
    } catch (cause) {
      if (cause instanceof WorkspaceValidationError) return { error: cause.message };
      throw cause;
    }
  }

  /**
   * Phần đầu và phần cuối mã của dự án sắp tạo, theo quy tắc hiện hành, nhóm dự án và ngày hôm nay (múi giờ
   * tenant). Ném lỗi kiểm tra khi quy tắc cần mã nhóm mà nhóm chưa có.
   */
  async partsFor(tenantId: string, projectType?: string | null): Promise<ProjectCodeParts> {
    const template = (await this.savedTemplate(tenantId)) ?? DEFAULT_PROJECT_CODE_TEMPLATE;
    const [year, month] = todayKey(timezoneOf(tenantId)).split('-').map(Number);
    const name = String(projectType ?? '').trim();
    const group = name
      ? (await this.store.projectGroup.list(tenantId)).find(
          (entry) => entry.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'),
        )
      : undefined;
    try {
      return projectCodeParts(template, {
        year: year ?? new Date().getFullYear(),
        month: month ?? 1,
        ...(group?.code ? { groupCode: group.code } : {}),
        ...(name ? { groupName: group?.name ?? name } : {}),
      });
    } catch (cause) {
      throw new WorkspaceValidationError((cause as Error).message);
    }
  }

  private async savedTemplate(tenantId: string): Promise<string | undefined> {
    const value = (await this.store.settings.get(tenantId, RULE_KEY)) as { template?: unknown } | undefined;
    const template = typeof value?.template === 'string' ? value.template : undefined;
    // Quy tắc lưu từ trước mà nay không hợp lệ (quy tắc kiểm chặt hơn) thì dùng mặc định thay vì chặn tạo dự án.
    return template && !projectCodeTemplateError(template) ? template : undefined;
  }
}

function canEdit(actor: WorkspaceActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}
