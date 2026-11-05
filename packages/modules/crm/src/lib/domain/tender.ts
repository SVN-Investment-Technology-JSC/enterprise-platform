import {
  TENDER_SUBMISSION_METHODS,
  TENDER_RESULTS,
  type TenderPlanStatus,
  type TenderResult,
  type TenderSubmissionMethod,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';
import { optionalEnum, optionalId, optionalInstant, optionalMoney, optionalText, requiredText } from './fields.js';

/**
 * Luật hồ sơ thầu (GĐ E). Hàm thuần: nhận dữ liệu thô từ request (kiểu có thể sai bất kỳ), trả dữ liệu đã chuẩn
 * hoá hoặc ném lỗi tiếng Việt; không đụng DB.
 */

export const TENDER_PACKAGE_NAME_MAX = 300;
export const TENDER_SCENARIO_MAX = 4000;
export const TENDER_PARTNER_MAX = 50;

/** Hồ sơ thầu đã chuẩn hoá để ghi. `undefined` ở bản cập nhật là giữ nguyên. */
export interface TenderProfileFields {
  readonly packageName: string;
  readonly inviterName: string;
  readonly packageCode: string | null;
  readonly submissionDeadline: string | null;
  readonly submissionMethod: TenderSubmissionMethod | null;
  readonly submitterUserId: string | null;
  readonly hasJointVenture: boolean;
  readonly scenario: string | null;
}

export type TenderProfilePatch = Partial<TenderProfileFields> & { readonly submittedAt?: string | null };

type RawFields = Readonly<Record<string, unknown>>;

function hasKey(raw: RawFields, key: string): boolean {
  return raw[key] !== undefined;
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new CrmValidationError('INVALID', `${label} không hợp lệ.`);
  return value;
}

/** Hạn nộp: thời điểm hợp lệ và không ở quá khứ so với `now`. */
export function assertDeadlineNotPast(deadline: string | null, now: Date): void {
  if (deadline && Date.parse(deadline) < now.getTime()) {
    throw new CrmValidationError('DEADLINE_IN_PAST', 'Hạn nộp thầu không được ở quá khứ.');
  }
}

/** Chuẩn hoá yêu cầu tạo hồ sơ thầu. Tên gói và bên mời thầu bắt buộc; hạn nộp không ở quá khứ. */
export function normalizeNewTenderProfile(raw: unknown, now: Date): TenderProfileFields {
  const input = (raw && typeof raw === 'object' ? raw : {}) as RawFields;
  const submissionDeadline = optionalInstant(input['submissionDeadline'], 'hạn nộp');
  assertDeadlineNotPast(submissionDeadline, now);
  return {
    packageName: requiredText(input['packageName'], TENDER_PACKAGE_NAME_MAX, 'tên gói thầu'),
    inviterName: requiredText(input['inviterName'], 300, 'bên mời thầu'),
    packageCode: optionalText(input['packageCode'], 100, 'mã gói thầu'),
    submissionDeadline,
    submissionMethod: normalizeSubmissionMethod(input['submissionMethod']),
    submitterUserId: optionalId(input['submitterUserId'], 'người nộp'),
    hasJointVenture: hasKey(input, 'hasJointVenture') ? booleanField(input['hasJointVenture'], 'Thông tin liên danh') : false,
    scenario: optionalText(input['scenario'], TENDER_SCENARIO_MAX, 'kịch bản chọn'),
  };
}

/**
 * Chuẩn hoá yêu cầu sửa: chỉ trường có trong request mới đổi. Hạn nộp chỉ kiểm quá khứ khi người dùng đổi sang
 * giá trị khác (`currentDeadline`), để sửa hồ sơ có hạn đã qua vẫn lưu được các trường khác.
 */
export function normalizeTenderProfilePatch(raw: unknown, currentDeadline: string | null, now: Date): TenderProfilePatch {
  const input = (raw && typeof raw === 'object' ? raw : {}) as RawFields;
  const patch: { -readonly [K in keyof TenderProfilePatch]: TenderProfilePatch[K] } = {};
  if (hasKey(input, 'packageName')) patch.packageName = requiredText(input['packageName'], TENDER_PACKAGE_NAME_MAX, 'tên gói thầu');
  if (hasKey(input, 'inviterName')) patch.inviterName = requiredText(input['inviterName'], 300, 'bên mời thầu');
  if (hasKey(input, 'packageCode')) patch.packageCode = optionalText(input['packageCode'], 100, 'mã gói thầu');
  if (hasKey(input, 'submissionDeadline')) {
    const deadline = optionalInstant(input['submissionDeadline'], 'hạn nộp');
    const unchanged = deadline !== null && currentDeadline !== null && Date.parse(deadline) === Date.parse(currentDeadline);
    if (!unchanged) assertDeadlineNotPast(deadline, now);
    patch.submissionDeadline = deadline;
  }
  if (hasKey(input, 'submissionMethod')) patch.submissionMethod = normalizeSubmissionMethod(input['submissionMethod']);
  if (hasKey(input, 'submitterUserId')) patch.submitterUserId = optionalId(input['submitterUserId'], 'người nộp');
  if (hasKey(input, 'hasJointVenture')) patch.hasJointVenture = booleanField(input['hasJointVenture'], 'Thông tin liên danh');
  if (hasKey(input, 'scenario')) patch.scenario = optionalText(input['scenario'], TENDER_SCENARIO_MAX, 'kịch bản chọn');
  if (hasKey(input, 'submittedAt')) patch.submittedAt = optionalInstant(input['submittedAt'], 'ngày nộp');
  return patch;
}

export function normalizeSubmissionMethod(value: unknown): TenderSubmissionMethod | null {
  return optionalEnum(value, TENDER_SUBMISSION_METHODS, 'hình thức nộp') ?? null;
}

/** Đối tác liên danh: tên bắt buộc, phạm vi không bắt buộc. */
export function normalizeTenderPartner(raw: unknown): { readonly name: string; readonly scope: string | null } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as RawFields;
  return {
    name: requiredText(input['name'], 300, 'tên đối tác'),
    scope: optionalText(input['scope'], 1000, 'phạm vi đảm nhận'),
  };
}

/** Kết quả thầu đã chuẩn hoá. */
export interface TenderResultInput {
  readonly result: TenderResult;
  readonly winningPrice: number | null;
  readonly winnerName: string | null;
  /** Lý do trượt; luôn rỗng khi Trúng. */
  readonly reason: string | null;
}

/**
 * Chuẩn hoá kết quả thầu. Trúng: bắt buộc giá trúng lớn hơn 0 (giá của chính mình). Trượt: bắt buộc lý do (tối
 * đa 2000 ký tự); giá trúng và đơn vị trúng (của bên thắng) không bắt buộc.
 */
export function normalizeTenderResult(raw: unknown): TenderResultInput {
  const input = (raw && typeof raw === 'object' ? raw : {}) as RawFields;
  const result = optionalEnum(input['result'], TENDER_RESULTS, 'kết quả thầu');
  if (!result) throw new CrmValidationError('RESULT_REQUIRED', 'Vui lòng chọn kết quả thầu (Trúng hoặc Trượt).');
  const winningPrice = optionalMoney(input['winningPrice'], 'giá trúng thầu');
  const winnerName = optionalText(input['winnerName'], 300, 'đơn vị trúng thầu');
  if (result === 'WON') {
    if (!winningPrice) throw new CrmValidationError('WINNING_PRICE_REQUIRED', 'Phải nhập giá trúng thầu lớn hơn 0.');
    return { result, winningPrice, winnerName, reason: null };
  }
  const reason = optionalText(input['reason'], 2000, 'lý do trượt');
  if (!reason) throw new CrmValidationError('LOST_REASON_REQUIRED', 'Phải ghi lý do trượt thầu.');
  return { result, winningPrice, winnerName, reason };
}

/** Phương án chỉ trình được khi đang soạn hoặc bị trả về sửa. */
export function assertTenderPlanSubmittable(status: TenderPlanStatus): void {
  if (status === 'PENDING') {
    throw new CrmConflictError('PLAN_PENDING', 'Phương án chào thầu đang chờ duyệt.');
  }
  if (status === 'APPROVED') {
    throw new CrmConflictError('PLAN_ALREADY_APPROVED', 'Phương án chào thầu đã được duyệt; sửa kịch bản hoặc liên danh để trình lại.');
  }
}

/**
 * Điều kiện đủ để trình duyệt (áp dụng CẢ HAI nhánh có và không có liên danh): có kịch bản chọn; có liên danh thì
 * có ít nhất một đối tác.
 */
export function assertTenderPlanReady(profile: { scenario: string | null; hasJointVenture: boolean }, partnerCount: number): void {
  if (!profile.scenario?.trim()) {
    throw new CrmValidationError('SCENARIO_REQUIRED', 'Vui lòng nhập kịch bản chọn (nội dung phương án) trước khi trình duyệt.');
  }
  if (profile.hasJointVenture && partnerCount < 1) {
    throw new CrmConflictError('PARTNERS_REQUIRED', 'Hồ sơ có liên danh cần ít nhất một đối tác trước khi trình duyệt phương án.');
  }
}

/**
 * Sửa kịch bản, liên danh hoặc danh sách đối tác khi phương án đang chờ duyệt: 409 (khoá sửa). Đã duyệt thì được
 * sửa nhưng phương án quay về Đang soạn và phải trình duyệt lại (`resetsApproval`).
 */
export function tenderPlanImpact(status: TenderPlanStatus): { readonly resetsApproval: boolean } {
  if (status === 'PENDING') {
    throw new CrmConflictError('PLAN_LOCKED', 'Phương án đang chờ duyệt, chưa sửa kịch bản, liên danh hay đối tác được.');
  }
  return { resetsApproval: status === 'APPROVED' };
}
