import {
  DEFAULT_WORK_ITEM_PRIORITY,
  DEFAULT_WORKSPACE_LABEL_SETTINGS,
  type SaveWorkspaceLabelSettingsRequest,
  type WorkspaceLabelOption,
  type WorkspaceLabelSettings,
  type WorkspaceLabelSettingsView,
} from '@enterprise-platform/contracts-workspace';
import { randomBytes } from 'node:crypto';
import { ProjectForbiddenError, WorkspaceValidationError } from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Khoá của cài đặt trong `workspace_settings`. */
const SETTINGS_KEY = 'label_settings';
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_LABEL = 40;
const MAX_PRIORITIES = 10;

/**
 * Tên và màu của trạng thái công việc, trạng thái dự án và mức ưu tiên (Cài đặt > Trạng thái và ưu tiên).
 *
 * Trạng thái giữ nguyên bộ khoá vì logic duyệt, đóng việc và báo cáo dựa vào chúng; chỉ đổi tên, màu, thứ tự. Mức ưu
 * tiên thêm, bớt được, trừ mức mặc định và mức còn việc đang dùng. Ai cũng đọc được; quản trị (canManage hoặc quản
 * trị tenant) sửa, như các cài đặt khác của Workspace.
 */
export class WorkspaceLabelService {
  constructor(private readonly store: WorkspaceStore) {}

  async settings(actor: WorkspaceActor): Promise<WorkspaceLabelSettingsView> {
    return { ...(await this.current(actor.tenantId)), canEdit: canEdit(actor) };
  }

  async save(
    actor: WorkspaceActor,
    input: SaveWorkspaceLabelSettingsRequest,
  ): Promise<WorkspaceLabelSettingsView> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const defaults = DEFAULT_WORKSPACE_LABEL_SETTINGS;
    const next: WorkspaceLabelSettings = {
      workItemStatuses: fixedOptions(
        input?.workItemStatuses,
        defaults.workItemStatuses,
        'trạng thái công việc',
      ),
      projectStatuses: fixedOptions(input?.projectStatuses, defaults.projectStatuses, 'trạng thái dự án'),
      priorities: priorityOptions(input?.priorities),
    };

    const before = await this.current(actor.tenantId);
    const kept = new Set(next.priorities.map((option) => option.key));
    const removed = before.priorities.map((option) => option.key).filter((key) => !kept.has(key));
    const inUse = await this.store.settings.prioritiesInUse(actor.tenantId, removed);
    if (inUse.length > 0) {
      const names = before.priorities
        .filter((option) => inUse.includes(option.key))
        .map((option) => `"${option.label}"`)
        .join(', ');
      throw new WorkspaceValidationError(
        `Không xoá được mức ưu tiên ${names} vì còn công việc đang dùng; hãy đổi mức của các việc đó trước.`,
      );
    }

    await this.store.settings.set(actor.tenantId, SETTINGS_KEY, next, actor.userId);
    return { ...next, canEdit: true };
  }

  /** Mức ưu tiên hợp lệ của tenant; rỗng thì lấy mức mặc định. */
  async requirePriority(tenantId: string, value: unknown): Promise<string> {
    const key = String(value ?? '').trim();
    if (!key) return DEFAULT_WORK_ITEM_PRIORITY;
    const { priorities } = await this.current(tenantId);
    if (!priorities.some((option) => option.key === key)) {
      throw new WorkspaceValidationError('Mức ưu tiên không có trong danh mục ở Cài đặt.');
    }
    return key;
  }

  /** Cài đặt đã lưu ghép với mặc định: thiếu trạng thái nào (bản lưu cũ) thì lấy mặc định của trạng thái đó. */
  private async current(tenantId: string): Promise<WorkspaceLabelSettings> {
    const saved = (await this.store.settings.get(tenantId, SETTINGS_KEY)) as
      | Partial<WorkspaceLabelSettings>
      | undefined;
    const defaults = DEFAULT_WORKSPACE_LABEL_SETTINGS;
    return {
      workItemStatuses: mergeFixed(saved?.workItemStatuses, defaults.workItemStatuses),
      projectStatuses: mergeFixed(saved?.projectStatuses, defaults.projectStatuses),
      priorities: saved?.priorities?.length ? saved.priorities : defaults.priorities,
    };
  }
}

function canEdit(actor: WorkspaceActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

function mergeFixed(
  saved: readonly WorkspaceLabelOption[] | undefined,
  defaults: readonly WorkspaceLabelOption[],
): readonly WorkspaceLabelOption[] {
  if (!saved?.length) return defaults;
  const known = saved.filter((option) => defaults.some((entry) => entry.key === option.key));
  const missing = defaults.filter((entry) => !known.some((option) => option.key === entry.key));
  return [...known, ...missing];
}

function cleanOption(option: unknown, what: string): Omit<WorkspaceLabelOption, 'key'> {
  const value = (option ?? {}) as Partial<WorkspaceLabelOption>;
  const label = String(value.label ?? '').trim();
  if (!label) throw new WorkspaceValidationError(`Tên ${what} không được để trống.`);
  if (label.length > MAX_LABEL) {
    throw new WorkspaceValidationError(`Tên ${what} dài tối đa ${MAX_LABEL} ký tự.`);
  }
  const color = String(value.color ?? '').trim();
  if (!COLOR.test(color)) throw new WorkspaceValidationError(`Màu của "${label}" không hợp lệ.`);
  return { label, color: color.toLowerCase() };
}

/** Trạng thái: đủ đúng bộ khoá có sẵn, mỗi khoá một lần; thứ tự gửi lên là thứ tự hiển thị. */
function fixedOptions(
  input: readonly WorkspaceLabelOption[] | undefined,
  defaults: readonly WorkspaceLabelOption[],
  what: string,
): WorkspaceLabelOption[] {
  const list = Array.isArray(input) ? input : [];
  const keys = list.map((option) => String(option?.key ?? ''));
  const expected = defaults.map((option) => option.key);
  if (
    keys.length !== expected.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !expected.includes(key))
  ) {
    throw new WorkspaceValidationError(`Danh sách ${what} phải gồm đủ các trạng thái có sẵn.`);
  }
  return list.map((option) => ({ key: option.key, ...cleanOption(option, what) }));
}

/** Mức ưu tiên: thứ tự từ thấp tới cao; mức mới (chưa có khoá) được cấp khoá; phải còn mức mặc định. */
function priorityOptions(
  input: SaveWorkspaceLabelSettingsRequest['priorities'] | undefined,
): WorkspaceLabelOption[] {
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0) throw new WorkspaceValidationError('Phải có ít nhất một mức ưu tiên.');
  if (list.length > MAX_PRIORITIES) {
    throw new WorkspaceValidationError(`Tối đa ${MAX_PRIORITIES} mức ưu tiên.`);
  }
  const options = list.map((option) => {
    const key = String(option?.key ?? '').trim() || `p${randomBytes(4).toString('hex')}`;
    if (key.length > 16) throw new WorkspaceValidationError('Khoá mức ưu tiên không hợp lệ.');
    return { key, ...cleanOption(option, 'mức ưu tiên') };
  });
  if (new Set(options.map((option) => option.key)).size !== options.length) {
    throw new WorkspaceValidationError('Có mức ưu tiên bị trùng.');
  }
  const labels = options.map((option) => option.label.toLocaleLowerCase('vi'));
  if (new Set(labels).size !== labels.length) {
    throw new WorkspaceValidationError('Hai mức ưu tiên không được trùng tên.');
  }
  if (!options.some((option) => option.key === DEFAULT_WORK_ITEM_PRIORITY)) {
    throw new WorkspaceValidationError('Không xoá được mức ưu tiên mặc định của công việc mới.');
  }
  return options;
}
