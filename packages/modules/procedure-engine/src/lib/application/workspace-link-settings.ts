/**
 * Cài đặt do module Quy trình thực thi nhưng do Workspace giữ (nhóm "Công việc gắn quy trình" của tenant).
 *
 * Engine KHÔNG import `contracts-workspace` để giữ ranh giới phân hệ: kiểu, giá trị hợp lệ và mặc định được khai báo
 * cục bộ ở đây. Bản gốc nằm ở `PROCEDURE_LINK_ENGINE_*` / `DEFAULT_PROCEDURE_LINK_SETTINGS` trong
 * `packages/contracts/workspace`; spec `workspace-link-settings.spec.ts` đối chiếu hai bảng nên sửa một bên phải sửa
 * bên kia. Mặc định == hành vi trước khi có cài đặt.
 */
export const WORKSPACE_LINK_SETTING_OPTIONS = {
  engineChangeEligibility: ['untouched', 'no_step_handled', 'never'],
  engineChangeWho: ['creator_approver_admin', 'approver_admin', 'admin_only'],
  engineChangeOldInstanceFate: ['delete', 'cancel_keep'],
  engineReverseWho: ['admin_only', 'admin_or_approver'],
  engineReverseStatuses: ['completed_or_rejected', 'completed_only'],
  engineDeleteLinkedWho: ['initiator_approver_admin', 'approver_admin', 'admin_only'],
  engineAttachmentMirror: ['all', 'final_step_only', 'none'],
  engineStartWithoutOrgChart: ['block', 'allow_if_role_matches'],
  engineReasonRequired: ['required', 'optional'],
} as const;

type OptionValue<K extends keyof typeof WORKSPACE_LINK_SETTING_OPTIONS> =
  (typeof WORKSPACE_LINK_SETTING_OPTIONS)[K][number];

export interface ProcedureEngineSettings {
  readonly engineChangeEligibility: OptionValue<'engineChangeEligibility'>;
  readonly engineChangeWho: OptionValue<'engineChangeWho'>;
  readonly engineChangeOldInstanceFate: OptionValue<'engineChangeOldInstanceFate'>;
  readonly engineReverseWho: OptionValue<'engineReverseWho'>;
  readonly engineReverseStatuses: OptionValue<'engineReverseStatuses'>;
  readonly engineDeleteLinkedWho: OptionValue<'engineDeleteLinkedWho'>;
  readonly engineAttachmentMirror: OptionValue<'engineAttachmentMirror'>;
  readonly engineStartWithoutOrgChart: OptionValue<'engineStartWithoutOrgChart'>;
  readonly engineReasonRequired: OptionValue<'engineReasonRequired'>;
}

export const DEFAULT_PROCEDURE_ENGINE_SETTINGS: ProcedureEngineSettings = {
  engineChangeEligibility: 'untouched',
  engineChangeWho: 'creator_approver_admin',
  engineChangeOldInstanceFate: 'delete',
  engineReverseWho: 'admin_only',
  engineReverseStatuses: 'completed_or_rejected',
  engineDeleteLinkedWho: 'initiator_approver_admin',
  engineAttachmentMirror: 'all',
  engineStartWithoutOrgChart: 'block',
  engineReasonRequired: 'required',
};

/** Giá trị lạ hoặc thiếu từng trường thì dùng mặc định của trường đó. */
export function normalizeProcedureEngineSettings(value: unknown): ProcedureEngineSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: Record<string, string> = { ...DEFAULT_PROCEDURE_ENGINE_SETTINGS };
  for (const [field, options] of Object.entries(WORKSPACE_LINK_SETTING_OPTIONS)) {
    const candidate = raw[field];
    if (typeof candidate === 'string' && (options as readonly string[]).includes(candidate)) {
      result[field] = candidate;
    }
  }
  return result as unknown as ProcedureEngineSettings;
}
