/**
 * Hồ sơ thầu của dự án bán hàng luồng Chào thầu (P2E-08, P2E-09): kiểm form, dựng yêu cầu gửi server, quyền hiện nút.
 * Thuần hàm, không phụ thuộc React.
 */
import {
  TENDER_SUBMISSION_METHODS,
  type CreateTenderProfileRequest,
  type CrmCapabilities,
  type RecordTenderResultRequest,
  type TenderPlanStatus,
  type TenderProfile,
  type TenderResult,
  type TenderSubmissionMethod,
  type UpdateTenderProfileRequest,
} from '@enterprise-platform/contracts-crm';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const TENDER_PLAN_STATUS_TONE: Readonly<Record<TenderPlanStatus, Tone>> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/** Luồng của dự án có profile TENDER thì mới hiện khối hồ sơ thầu. */
export function isTenderPipeline(pipeline: { readonly profile: string } | undefined): boolean {
  return pipeline?.profile === 'TENDER';
}

export type TenderUiAction = 'edit' | 'submit' | 'approve' | 'reject' | 'result' | 'partners';

/**
 * Nút hiện được. Sửa, trình, ghi kết quả: người có quyền sửa dự án khi hồ sơ còn sửa được. Duyệt, từ chối: người
 * có quyền duyệt báo giá khi phương án chờ duyệt, không phải người đã trình. Phương án chờ duyệt khoá sửa kịch
 * bản, liên danh, đối tác.
 */
export function tenderActions(
  profile: Pick<TenderProfile, 'editable' | 'planLocked' | 'hasJointVenture' | 'result' | 'scenario'> & {
    readonly plan: Pick<TenderProfile['plan'], 'status' | 'submittedBy'>;
  },
  capabilities: Pick<CrmCapabilities, 'isTenantAdmin' | 'canWriteOpportunity' | 'canApproveQuote'>,
  currentUserId?: string,
): TenderUiAction[] {
  const write = capabilities.isTenantAdmin || capabilities.canWriteOpportunity;
  const approve = capabilities.isTenantAdmin || capabilities.canApproveQuote;
  const actions: TenderUiAction[] = [];
  if (write && profile.editable) {
    actions.push('edit');
    if (!profile.planLocked && profile.hasJointVenture) actions.push('partners');
    if (profile.plan.status === 'DRAFT' || profile.plan.status === 'REJECTED') actions.push('submit');
    if (!profile.result) actions.push('result');
  }
  const self = !!currentUserId && profile.plan.submittedBy === currentUserId;
  if (approve && profile.editable && profile.plan.status === 'PENDING' && !self) actions.push('approve', 'reject');
  return actions;
}

export interface TenderDraft {
  readonly packageName: string;
  readonly inviterName: string;
  readonly packageCode: string;
  /** Giá trị ô `datetime-local` (`YYYY-MM-DDTHH:mm`, giờ máy người dùng). */
  readonly submissionDeadline: string;
  readonly submissionMethod: string;
  readonly submitterUserId: string;
  readonly hasJointVenture: boolean;
  readonly scenario: string;
}

export const EMPTY_TENDER_DRAFT: TenderDraft = {
  packageName: '',
  inviterName: '',
  packageCode: '',
  submissionDeadline: '',
  submissionMethod: '',
  submitterUserId: '',
  hasJointVenture: false,
  scenario: '',
};

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO -> giá trị ô `datetime-local` theo giờ máy. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function draftFromProfile(profile: TenderProfile): TenderDraft {
  return {
    packageName: profile.packageName,
    inviterName: profile.inviterName,
    packageCode: profile.packageCode ?? '',
    submissionDeadline: toLocalInput(profile.submissionDeadline),
    submissionMethod: profile.submissionMethod ?? '',
    submitterUserId: profile.submitterUserId ?? '',
    hasJointVenture: profile.hasJointVenture,
    scenario: profile.scenario ?? '',
  };
}

export type TenderBuild<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly message: string };

function buildFields(draft: TenderDraft, now: Date): TenderBuild<CreateTenderProfileRequest> {
  const packageName = draft.packageName.trim();
  const inviterName = draft.inviterName.trim();
  if (!packageName) return { ok: false, message: 'Vui lòng nhập tên gói thầu.' };
  if (!inviterName) return { ok: false, message: 'Vui lòng nhập bên mời thầu.' };
  let submissionDeadline: string | null = null;
  if (draft.submissionDeadline) {
    const date = new Date(draft.submissionDeadline);
    if (Number.isNaN(date.getTime())) return { ok: false, message: 'Hạn nộp không hợp lệ.' };
    if (date.getTime() < now.getTime()) return { ok: false, message: 'Hạn nộp không được ở quá khứ.' };
    submissionDeadline = date.toISOString();
  }
  const method = (TENDER_SUBMISSION_METHODS as readonly string[]).includes(draft.submissionMethod)
    ? (draft.submissionMethod as TenderSubmissionMethod)
    : null;
  return {
    ok: true,
    body: {
      packageName,
      inviterName,
      packageCode: draft.packageCode.trim() || null,
      submissionDeadline,
      submissionMethod: method,
      submitterUserId: draft.submitterUserId || null,
      hasJointVenture: draft.hasJointVenture,
      scenario: draft.scenario.trim() || null,
    },
  };
}

export function buildCreateRequest(draft: TenderDraft, now: Date = new Date()): TenderBuild<CreateTenderProfileRequest> {
  return buildFields(draft, now);
}

/**
 * Yêu cầu sửa: hạn nộp không đổi so với hồ sơ thì không kiểm "quá khứ" (hạn đã qua vẫn lưu được các trường khác)
 * và không gửi lại.
 */
export function buildUpdateRequest(
  draft: TenderDraft,
  profile: Pick<TenderProfile, 'submissionDeadline' | 'version'>,
  now: Date = new Date(),
): TenderBuild<UpdateTenderProfileRequest> {
  const unchangedDeadline = draft.submissionDeadline === toLocalInput(profile.submissionDeadline);
  const built = buildFields(unchangedDeadline ? { ...draft, submissionDeadline: '' } : draft, now);
  if (!built.ok) return built;
  const { submissionDeadline, ...rest } = built.body;
  const body: UpdateTenderProfileRequest = unchangedDeadline ? { ...rest, version: profile.version } : { ...rest, submissionDeadline, version: profile.version };
  return { ok: true, body };
}

/** Giá trúng: chữ số, có thể có dấu phân cách nghìn; phải lớn hơn 0. */
export function parseWinningPrice(text: string): number | undefined {
  const digits = text.replace(/[.,\s]/g, '');
  if (!/^\d{1,15}$/.test(digits)) return undefined;
  const value = Number(digits);
  return value > 0 ? value : undefined;
}

export interface TenderResultDraft {
  readonly result: TenderResult;
  readonly winningPrice: string;
  readonly winnerName: string;
  readonly reason: string;
}

/** Trúng cần giá trúng > 0; Trượt cần lý do. */
export function buildResultRequest(draft: TenderResultDraft, version: number): TenderBuild<RecordTenderResultRequest> {
  if (draft.result === 'WON') {
    const winningPrice = parseWinningPrice(draft.winningPrice);
    if (winningPrice === undefined) return { ok: false, message: 'Giá trúng thầu phải là số lớn hơn 0.' };
    return {
      ok: true,
      body: { version, result: 'WON', winningPrice, winnerName: draft.winnerName.trim() || null, reason: null },
    };
  }
  const reason = draft.reason.trim();
  if (!reason) return { ok: false, message: 'Vui lòng nhập lý do trượt thầu.' };
  return { ok: true, body: { version, result: 'LOST', winnerName: draft.winnerName.trim() || null, reason } };
}

/** Hồ sơ đã bị người khác đổi (phiên bản cũ): cần tải lại. */
export function isTenderConflict(cause: unknown): boolean {
  return (cause as { code?: string } | undefined)?.code === 'STALE_VERSION';
}

export function tenderErrorMessage(cause: unknown, fallback: string): string {
  const error = (cause ?? {}) as { code?: string; message?: string; missing?: readonly { message?: string }[] };
  if (error.code === 'STALE_VERSION') {
    return 'Hồ sơ thầu vừa được người khác thay đổi. Đã tải lại bản mới nhất, vui lòng kiểm tra rồi thao tác lại.';
  }
  const missing = (error.missing ?? []).map((item) => item.message?.trim()).filter((text): text is string => !!text);
  if (missing.length) return `Chưa đủ điều kiện chuyển giai đoạn. Còn thiếu: ${missing.join('; ')}`;
  return typeof error.message === 'string' && error.message ? error.message : fallback;
}
