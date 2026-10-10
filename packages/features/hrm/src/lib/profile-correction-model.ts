import { HrmApiError } from './hrm-api';

/**
 * Trường định danh nhân viên không được sửa trực tiếp: mọi thay đổi phải gửi đơn đính chính.
 * Họ tên do Core quản lý nên không nằm trong danh sách này.
 */
export type ProfileCorrectionField =
  | 'dateOfBirth'
  | 'identityCardNumber'
  | 'identityCardIssuedDate'
  | 'identityCardIssuedPlace';

export interface ProfileCorrectionFieldDef {
  label: string;
  kind: 'text' | 'date';
  placeholder: string;
}

export const PROFILE_CORRECTION_FIELDS: Record<
  ProfileCorrectionField,
  ProfileCorrectionFieldDef
> = {
  dateOfBirth: { label: 'Ngày sinh', kind: 'date', placeholder: 'dd/mm/yyyy' },
  identityCardNumber: {
    label: 'Số CCCD / CMND',
    kind: 'text',
    placeholder: 'Nhập số CCCD / CMND',
  },
  identityCardIssuedDate: {
    label: 'Ngày cấp',
    kind: 'date',
    placeholder: 'dd/mm/yyyy',
  },
  identityCardIssuedPlace: {
    label: 'Nơi cấp',
    kind: 'text',
    placeholder: 'Nhập nơi cấp CCCD / CMND',
  },
};

/** Hai nhóm hiển thị trên màn hình Hồ sơ của tôi, mỗi nhóm có một nút Đề nghị đính chính. */
export const PROFILE_CORRECTION_GROUPS: {
  key: 'personal' | 'identity';
  title: string;
  fields: ProfileCorrectionField[];
}[] = [
  {
    key: 'personal',
    title: 'Đính chính ngày sinh',
    fields: ['dateOfBirth'],
  },
  {
    key: 'identity',
    title: 'Đính chính giấy tờ định danh (CCCD)',
    fields: [
      'identityCardNumber',
      'identityCardIssuedDate',
      'identityCardIssuedPlace',
    ],
  },
];

export const PROFILE_CHANGE_REQUIRES_APPROVAL = 'HRM_PROFILE_CHANGE_REQUIRES_APPROVAL';

export function isProfileCorrectionField(
  value: unknown,
): value is ProfileCorrectionField {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PROFILE_CORRECTION_FIELDS, value)
  );
}

/** Danh sách trường bị từ chối khi lỗi là HRM_PROFILE_CHANGE_REQUIRES_APPROVAL; null với lỗi khác. */
export function protectedFieldsFromError(
  error: unknown,
): ProfileCorrectionField[] | null {
  if (!(error instanceof HrmApiError)) return null;
  const body = (error.body ?? {}) as { code?: string; fields?: unknown };
  if ((error.code ?? body.code) !== PROFILE_CHANGE_REQUIRES_APPROVAL) return null;
  const fields = Array.isArray(body.fields)
    ? body.fields.filter(isProfileCorrectionField)
    : [];
  return fields;
}

export function profileFieldLabels(fields: readonly ProfileCorrectionField[]) {
  return fields.map((field) => PROFILE_CORRECTION_FIELDS[field].label);
}

/** Dữ liệu ngày dạng ISO (YYYY-MM-DD) -> dd/mm/yyyy để hiển thị; giá trị trống hiển thị ----. */
export function formatProfileValue(
  field: ProfileCorrectionField,
  value: string | null | undefined,
): string {
  const text = (value ?? '').trim();
  if (!text) return '----';
  if (PROFILE_CORRECTION_FIELDS[field].kind !== 'date') return text;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

export interface ProfileCorrectionPayload {
  changes: Partial<Record<ProfileCorrectionField, string>>;
  reason: string;
  changedFields: ProfileCorrectionField[];
}

/**
 * Dựng thân yêu cầu POST /profile-corrections: chỉ gồm trường có giá trị đề xuất khác giá trị hiện tại.
 * Chuỗi lý do giữ định dạng của biểu mẫu trong màn hình Đơn từ của tôi để người duyệt thấy cùng một dạng.
 */
export function buildProfileCorrectionPayload(input: {
  fields: readonly ProfileCorrectionField[];
  current: Partial<Record<ProfileCorrectionField, string | null>>;
  proposed: Partial<Record<ProfileCorrectionField, string>>;
  reason: string;
  evidence?: string;
}): ProfileCorrectionPayload {
  const changes: Partial<Record<ProfileCorrectionField, string>> = {};
  const lines: string[] = [];
  const changedFields: ProfileCorrectionField[] = [];
  for (const field of input.fields) {
    const next = (input.proposed[field] ?? '').trim();
    const previous = (input.current[field] ?? '').trim();
    if (!next || next === previous) continue;
    changes[field] = next;
    changedFields.push(field);
    const def = PROFILE_CORRECTION_FIELDS[field];
    lines.push(
      `${def.label}: "${formatProfileValue(field, previous)}" -> "${formatProfileValue(field, next)}"`,
    );
  }
  const evidence = (input.evidence ?? '').trim();
  const reason =
    `[Đề nghị điều chỉnh hồ sơ (${changedFields.length} mục)]\n- ${lines.join('\n- ')}\n` +
    `${evidence ? `• Minh chứng kèm theo: ${evidence}\n` : ''}` +
    `• Lý do điều chỉnh: ${input.reason.trim()}`;
  return { changes, reason, changedFields };
}

/** So sánh hai bản ghi chuỗi và chỉ trả về các khóa đã đổi giá trị (dùng cho PATCH /my-profile). */
export function changedValues<T extends Record<string, string>>(
  saved: T,
  next: T,
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== saved[key]) result[key] = next[key];
  }
  return result;
}

/** Thân PATCH /my-profile cho khối nhân thân: giới tính và hôn nhân trống được gửi dưới dạng null. */
export function identityPatchBody(
  edits: Partial<Record<'gender' | 'nationality' | 'ethnicity' | 'maritalStatus', string>>,
): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(edits)) {
    body[key] =
      key === 'gender' || key === 'maritalStatus' ? value || null : (value ?? '');
  }
  return body;
}
