/**
 * Quy tắc sinh mã dự án, dùng chung cho server (cấp mã khi tạo) và giao diện (xem trước ở Cài đặt và form).
 *
 * Quy tắc là một mẫu gồm chữ cố định và token, vd `DA_{NHOM}_{SO:4}` → `DA_DVTN_0001`, `DA_{NAM}_{SO:3}` →
 * `DA_2026_001`. Số thứ tự đếm riêng theo phần đứng trước và sau nó: `DA_DVTN_…` và `DA_KT_…` mỗi bên một dãy,
 * `DA_2026_…` sang năm 2027 tự về 001.
 */

/** Quy tắc khi tenant chưa đặt gì, khớp ví dụ cũ trên form (DA-2026-001). */
export const DEFAULT_PROJECT_CODE_TEMPLATE = 'DA-{NAM}-{SO:3}';

/** Mã dự án hợp lệ: chữ in hoa, số, gạch ngang, gạch dưới; 2 đến 32 ký tự. */
export const PROJECT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** Mã viết tắt của nhóm dự án (token `{NHOM}`): chữ in hoa và số, tối đa 16 ký tự. */
export const PROJECT_GROUP_CODE_PATTERN = /^[A-Z0-9]{1,16}$/;

/** Các token dùng được trong quy tắc, kèm giải thích cho màn Cài đặt. */
export const PROJECT_CODE_TOKENS = [
  { token: '{NHOM}', label: 'Mã viết tắt của nhóm dự án (đặt ở Cài đặt > Nhóm dự án)' },
  { token: '{NAM}', label: 'Năm tạo dự án, 4 chữ số (2026)' },
  { token: '{NAM2}', label: 'Năm tạo dự án, 2 chữ số (26)' },
  { token: '{THANG}', label: 'Tháng tạo dự án, 2 chữ số (01–12)' },
  { token: '{SO:4}', label: 'Số thứ tự, đủ số chữ số ghi sau dấu hai chấm (2–6), vd {SO:3} → 001' },
] as const;

/** Thông tin dùng để điền token khi sinh mã. */
export interface ProjectCodeContext {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** Mã viết tắt của nhóm dự án; cần khi quy tắc có `{NHOM}`. */
  readonly groupCode?: string;
  /** Tên nhóm, chỉ để báo lỗi dễ hiểu khi nhóm chưa có mã viết tắt. */
  readonly groupName?: string;
}

/** Mã sau khi điền token, tách quanh số thứ tự. */
export interface ProjectCodeParts {
  readonly prefix: string;
  readonly suffix: string;
  /** Số chữ số tối thiểu của số thứ tự. */
  readonly width: number;
}

const TOKEN = /\{(NHOM|NAM2|NAM|THANG|SO:(\d))\}/g;
const LITERAL = /^[A-Z0-9_-]*$/;
const MIN_WIDTH = 2;
const MAX_WIDTH = 6;
/** Độ dài giả định của mã nhóm khi ước lượng độ dài mã ở bước kiểm quy tắc. */
const TYPICAL_GROUP_CODE = 4;

/** Chuẩn hoá quy tắc người dùng gõ: bỏ khoảng trắng, chữ in hoa. */
export function normalizeProjectCodeTemplate(template: string): string {
  return String(template ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Lỗi của quy tắc (để hiện cho người đặt), hoặc `undefined` khi hợp lệ. */
export function projectCodeTemplateError(template: string): string | undefined {
  const value = normalizeProjectCodeTemplate(template);
  if (!value) return 'Quy tắc mã dự án không được để trống.';
  const numbers = [...value.matchAll(TOKEN)].filter((match) => match[1]?.startsWith('SO'));
  if (numbers.length !== 1) return 'Quy tắc phải có đúng một token số thứ tự, vd {SO:4}.';
  const width = Number(numbers[0]?.[2]);
  if (width < MIN_WIDTH || width > MAX_WIDTH) {
    return `Số chữ số của {SO:n} phải từ ${MIN_WIDTH} đến ${MAX_WIDTH}.`;
  }
  const literal = value.replace(TOKEN, '');
  if (/[{}]/.test(literal)) {
    return 'Token không hợp lệ. Dùng {NHOM}, {NAM}, {NAM2}, {THANG}, {SO:n}.';
  }
  if (!LITERAL.test(literal)) {
    return 'Ngoài các token, quy tắc chỉ được có chữ in hoa không dấu, số, gạch ngang (-) và gạch dưới (_).';
  }
  const sample = projectCodeParts(value, { year: 2026, month: 1, groupCode: 'X'.repeat(TYPICAL_GROUP_CODE) });
  const length = sample.prefix.length + sample.width + sample.suffix.length;
  if (length > 32) return 'Mã sinh ra dài quá 32 ký tự; rút ngắn quy tắc.';
  if (!/^[A-Z0-9]/.test(sample.prefix || '0')) return 'Mã dự án phải bắt đầu bằng chữ hoặc số.';
  return undefined;
}

/**
 * Điền token (trừ số thứ tự) và tách mã quanh số thứ tự. Ném lỗi có thông điệp tiếng Việt khi quy tắc cần mã nhóm
 * mà dự án chưa chọn nhóm, hoặc nhóm chưa có mã viết tắt.
 */
export function projectCodeParts(template: string, context: ProjectCodeContext): ProjectCodeParts {
  const value = normalizeProjectCodeTemplate(template);
  let width = 0;
  let prefix = '';
  let suffix = '';
  let seenNumber = false;
  let last = 0;
  const append = (text: string) => {
    if (seenNumber) suffix += text;
    else prefix += text;
  };
  for (const match of value.matchAll(TOKEN)) {
    append(value.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const token = match[1] ?? '';
    if (token.startsWith('SO')) {
      width = Number(match[2]);
      seenNumber = true;
    } else if (token === 'NHOM') {
      if (!context.groupCode) {
        throw new Error(
          context.groupName
            ? `Nhóm dự án "${context.groupName}" chưa có mã viết tắt. Đặt mã ở Cài đặt > Nhóm dự án.`
            : 'Quy tắc mã dự án cần nhóm dự án: hãy chọn nhóm dự án trước.',
        );
      }
      append(context.groupCode.toUpperCase());
    } else if (token === 'NAM') append(String(context.year));
    else if (token === 'NAM2') append(String(context.year % 100).padStart(2, '0'));
    else if (token === 'THANG') append(String(context.month).padStart(2, '0'));
  }
  append(value.slice(last));
  return { prefix, suffix, width: width || MIN_WIDTH };
}

/** Mã hoàn chỉnh với số thứ tự `sequence`. */
export function formatProjectCode(parts: ProjectCodeParts, sequence: number): string {
  return `${parts.prefix}${String(sequence).padStart(parts.width, '0')}${parts.suffix}`;
}

/**
 * Số thứ tự kế tiếp: lớn nhất trong các mã đã có cùng phần đầu và phần cuối, cộng một. Mã có số dài hơn độ rộng
 * (vd 1000 với {SO:3}) vẫn được tính, để dãy không quay lại số đã dùng.
 */
export function nextProjectCodeNumber(parts: ProjectCodeParts, existingCodes: readonly string[]): number {
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(parts.prefix) || !code.endsWith(parts.suffix)) continue;
    const middle = code.slice(parts.prefix.length, code.length - parts.suffix.length);
    if (!/^\d+$/.test(middle)) continue;
    max = Math.max(max, Number(middle));
  }
  return max + 1;
}

/** Cài đặt quy tắc mã dự án, kèm cờ người đang xem có được sửa không. */
export interface ProjectCodeSettings {
  readonly template: string;
  /** Đang dùng quy tắc mặc định vì tenant chưa đặt. */
  readonly isDefault: boolean;
  readonly canEdit: boolean;
}

export interface SaveProjectCodeRuleRequest {
  readonly template: string;
}

/** Mã dự kiến cho dự án sắp tạo; server cấp số cuối cùng lúc lưu. */
export interface ProjectCodePreview {
  readonly code?: string;
  /** Lý do chưa sinh được mã, vd nhóm chưa có mã viết tắt. */
  readonly error?: string;
}
