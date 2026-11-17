/**
 * Hợp đồng dữ liệu của phân hệ Văn thư, hai luồng:
 *
 * - Công văn đến: văn thư tiếp nhận, phân loại, chọn phòng ban xử lý → phòng ban phân công
 *   người xử lý, chuẩn bị nội dung → lãnh đạo xem xét theo quy trình cấu hình (nhiều cấp)
 *   → văn thư hoàn tất → lưu trữ, tra cứu.
 * - Công văn đi: phòng ban soạn thảo → văn thư kiểm tra thể thức → trình duyệt theo quy
 *   trình cấu hình → văn thư đánh số, ban hành, gửi đi → lưu trữ, theo dõi tình trạng gửi.
 *
 * Ở mọi bước, người đang giữ bước trả lại được bước trước kèm lý do; trao đổi theo từng bước
 * ghi ngay trên công văn. Danh mục, quy trình, người duyệt do tenant cấu hình và lấy theo sơ
 * đồ tổ chức. Tệp nằm trong kho tài liệu của Hệ dùng chung.
 */

export const CORRESPONDENCE_MODULE_KEY = 'correspondence';
export const CORRESPONDENCE_LAUNCH_URL = '/modules/correspondence';
export const CORRESPONDENCE_API_ROOT = '/api/correspondence/v1';

/** Quyền của phân hệ; nhãn hiển thị nằm ở `TENANT_PERMISSION_ACTIONS`. */
export const CORRESPONDENCE_PERMISSIONS = [
  'correspondence.read',
  'correspondence.letter.read-all',
  'correspondence.letter.confidential',
  'correspondence.letter.register',
  'correspondence.outgoing.create',
  'correspondence.letter.direct',
  'correspondence.letter.publish',
  'correspondence.letter.archive',
  'correspondence.report.read',
  'correspondence.config',
  'correspondence.manage',
] as const;
export type CorrespondencePermission = (typeof CORRESPONDENCE_PERMISSIONS)[number];

/* ------------------------------------------------------------- luồng */

export const LETTER_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type LetterDirection = (typeof LETTER_DIRECTIONS)[number];

export const LETTER_DIRECTION_LABELS: Readonly<Record<LetterDirection, string>> = {
  incoming: 'Công văn đến',
  outgoing: 'Công văn đi',
};

/**
 * Giai đoạn. Công văn đến: received → processing → reviewing → closing → archived.
 * Công văn đi: drafting → checking → reviewing → publishing → archived. `reviewing` là đang ở
 * một bước duyệt của quy trình (không có bước nào thì bỏ qua).
 */
export const LETTER_STAGES = [
  'received',
  'processing',
  'drafting',
  'checking',
  'reviewing',
  'closing',
  'publishing',
  'archived',
  'revoking',
  'cancelled',
] as const;
export type LetterStage = (typeof LETTER_STAGES)[number];

export const LETTER_STAGE_LABELS: Readonly<Record<LetterStage, string>> = {
  received: 'Văn thư tiếp nhận',
  processing: 'Phòng ban xử lý',
  drafting: 'Đang soạn thảo',
  checking: 'Văn thư kiểm tra',
  reviewing: 'Đang trình duyệt',
  closing: 'Chờ hoàn tất',
  publishing: 'Chờ ban hành',
  archived: 'Đã lưu trữ',
  revoking: 'Chờ duyệt huỷ',
  cancelled: 'Đã huỷ',
};

/**
 * Huỷ công văn đã ban hành (đi) hay đã hoàn tất (đến): văn thư đề nghị thu hồi, hoặc sửa đổi,
 * thay thế bằng văn bản khác; người có thẩm quyền ở bước duyệt cuối xác nhận.
 */
export const REVOKE_KINDS = ['recall', 'amend'] as const;
export type RevokeKind = (typeof REVOKE_KINDS)[number];

export const REVOKE_KIND_LABELS: Readonly<Record<RevokeKind, string>> = {
  recall: 'Thu hồi',
  amend: 'Sửa đổi, thay thế',
};

export const OPEN_LETTER_STAGES: readonly LetterStage[] = [
  'received',
  'processing',
  'drafting',
  'checking',
  'reviewing',
  'closing',
  'publishing',
];

/** Các giai đoạn còn mở theo luồng, đúng thứ tự trên luồng. */
export const DIRECTION_STAGES: Readonly<Record<LetterDirection, readonly LetterStage[]>> = {
  incoming: ['received', 'processing', 'reviewing', 'closing'],
  outgoing: ['drafting', 'checking', 'reviewing', 'publishing'],
};

export function isOpenStage(stage: LetterStage): boolean {
  return OPEN_LETTER_STAGES.includes(stage);
}

/* ------------------------------------------------------------- danh mục */

export const CATALOG_KINDS = ['letter_type', 'urgency', 'confidentiality'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_KIND_LABELS: Readonly<Record<CatalogKind, string>> = {
  letter_type: 'Loại văn bản',
  urgency: 'Độ khẩn',
  confidentiality: 'Độ mật',
};

export interface CatalogItem {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  /** Loại văn bản: hạn xử lý mặc định (ngày); trống là theo cấu hình sổ. */
  readonly defaultDueDays?: number;
  /** Loại văn bản: quy trình duyệt mặc định của công văn đến. */
  readonly workflowId?: string;
  /** Loại văn bản: quy trình duyệt mặc định của công văn đi. */
  readonly outgoingWorkflowId?: string;
  /** Loại văn bản: phòng ban gợi ý khi văn thư giao xử lý công văn đến. */
  readonly defaultUnitIds?: readonly string[];
  /** Độ khẩn: tô đỏ trong danh sách. */
  readonly highlight?: boolean;
  /** Độ mật: chỉ người liên quan và người có quyền xem công văn mật thấy. */
  readonly restricted?: boolean;
  /** Loại văn bản: ký hiệu viết tắt trong số văn bản (QĐ, TB, CV…); trống là chữ cái đầu của tên. */
  readonly abbreviation?: string;
  /** Loại văn bản: mẫu số riêng khi ban hành (ví dụ công văn "{so}/{coquan}-{donvi}"); trống là mẫu của sổ. */
  readonly numberFormat?: string;
  readonly inUse?: boolean;
}

export interface SaveCatalogItemRequest {
  readonly kind: CatalogKind;
  readonly code: string;
  readonly name: string;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
  readonly defaultDueDays?: number | null;
  readonly workflowId?: string | null;
  readonly outgoingWorkflowId?: string | null;
  readonly defaultUnitIds?: readonly string[];
  readonly highlight?: boolean;
  readonly restricted?: boolean;
  readonly abbreviation?: string | null;
  readonly numberFormat?: string | null;
}

/* ------------------------------------------------------------- sổ đăng ký, số văn bản */

/**
 * Sổ đăng ký văn bản đến / đi: mỗi sổ cấp số riêng theo năm. Văn bản vào sổ theo độ mật (sổ mật
 * cho văn bản có độ mật) và loại văn bản; không sổ nào hợp thì vào sổ mặc định của luồng.
 */
export interface Register {
  readonly id: string;
  readonly direction: LetterDirection;
  readonly name: string;
  /** Mẫu số, xem `NUMBER_TOKENS`; bắt buộc có `{so}`. */
  readonly numberFormat: string;
  /** Sổ văn bản mật: văn bản có độ mật vào sổ này, cấp số riêng. */
  readonly confidential: boolean;
  /** Chỉ văn bản thuộc các loại này (mã loại văn bản); trống là mọi loại. */
  readonly letterTypes: readonly string[];
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
  /** Số đã cấp trong năm hiện tại. */
  readonly issuedThisYear: number;
  readonly inUse: boolean;
}

export interface SaveRegisterRequest {
  readonly direction: LetterDirection;
  readonly name: string;
  readonly numberFormat: string;
  readonly confidential?: boolean;
  readonly letterTypes?: readonly string[];
  readonly isDefault?: boolean;
  readonly isActive?: boolean;
  readonly sortOrder?: number;
}

/**
 * Sổ tự chọn cho một văn bản: sổ đang dùng cùng luồng hợp độ mật (văn bản có độ mật vào sổ mật, văn bản
 * thường không vào sổ mật) và loại văn bản, sổ ghi đúng loại văn bản trước, rồi sổ mặc định; không sổ
 * nào hợp thì sổ mặc định của luồng.
 */
export function suggestRegister(
  registers: readonly Register[],
  direction: LetterDirection,
  letter: { readonly kind: string; readonly restricted: boolean },
): Register | undefined {
  const usable = registers.filter((item) => item.isActive && item.direction === direction);
  const fits = usable.filter(
    (item) => item.confidential === letter.restricted && (item.letterTypes.length === 0 || item.letterTypes.includes(letter.kind)),
  );
  return (
    fits.find((item) => item.letterTypes.includes(letter.kind)) ??
    fits.find((item) => item.isDefault) ??
    fits[0] ??
    usable.find((item) => item.isDefault) ??
    usable[0]
  );
}

/** Phần ghép được trong mẫu số văn bản. */
export const NUMBER_TOKENS: readonly { readonly token: string; readonly label: string }[] = [
  { token: '{so}', label: 'Số thứ tự trong sổ (dưới 10 thêm số 0)' },
  { token: '{nam}', label: 'Năm' },
  { token: '{loai}', label: 'Ký hiệu loại văn bản (QĐ, TB, CV…)' },
  { token: '{coquan}', label: 'Ký hiệu cơ quan' },
  { token: '{donvi}', label: 'Ký hiệu đơn vị soạn thảo' },
];

/** Chữ cái đầu viết hoa của các từ: "Quyết định" → "QĐ"; tên đơn vị bỏ chữ "Phòng", "Ban" ở đầu: "Phòng Kinh doanh" → "KD". */
export function abbreviate(name: string, stripUnitPrefix = false): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const body = stripUnitPrefix && words.length > 1 && /^(phòng|ban)$/i.test(words[0]) ? words.slice(1) : words;
  return body.map((word) => word.charAt(0).toUpperCase()).join('');
}

/**
 * Số văn bản theo mẫu: "{so}/{loai}-{coquan}" → "05/QĐ-SVN". Số dưới 10 thêm 0 (Nghị định 30). Phần
 * nào trống thì bỏ luôn dấu nối thừa ("05/QĐ" khi chưa có ký hiệu cơ quan).
 */
export function formatLetterNumber(
  format: string,
  parts: { readonly seq: number; readonly year: number; readonly type?: string; readonly org?: string; readonly unit?: string },
): string {
  const values: Record<string, string> = {
    '{so}': parts.seq < 10 ? `0${parts.seq}` : String(parts.seq),
    '{nam}': String(parts.year),
    '{loai}': parts.type ?? '',
    '{coquan}': parts.org ?? '',
    '{donvi}': parts.unit ?? '',
  };
  const filled = format.replace(/\{(so|nam|loai|coquan|donvi)\}/g, (token) => values[token] ?? '');
  return filled
    .replace(/([-/.])[-/.]+/g, '$1')
    .replace(/^[-/.]+|[-/.]+$/g, '')
    .trim();
}

/** Mẫu số hợp lệ: có `{so}`, chỉ dùng các phần trong `NUMBER_TOKENS`, tối đa 80 ký tự. */
export function numberFormatError(format: string): string | undefined {
  const value = format.trim();
  if (!value) return 'Nhập mẫu số.';
  if (value.length > 80) return 'Mẫu số tối đa 80 ký tự.';
  if (!value.includes('{so}')) return 'Mẫu số phải có {so} (số thứ tự).';
  const unknown = (value.match(/\{[^}]*\}/g) ?? []).filter((token) => !NUMBER_TOKENS.some((item) => item.token === token));
  if (unknown.length > 0) return `Mẫu số có phần không hiểu: ${unknown.join(', ')}.`;
  return undefined;
}

/** Thêm nhanh một mục danh mục ngay lúc nhập công văn: chỉ cần tên, mã tự sinh. */
export interface QuickCatalogItemRequest {
  readonly kind: CatalogKind;
  readonly name: string;
}

/* --------------------------------------------------------- quy trình duyệt */

/**
 * Ai duyệt một bước, theo sơ đồ tổ chức:
 *
 * - `choose`: người trình (văn thư, hay người duyệt bước trước) chọn một người trong nhóm:
 *   người có quyền lãnh đạo (`leaders`), người giữ các chức danh, người thuộc các phòng ban;
 * - `users`: một trong những người được chỉ định;
 * - `positions`: người đang giữ một trong các chức danh;
 * - `unit_heads`: trưởng các đơn vị chỉ định (chưa có trưởng thì lên đơn vị cha);
 * - `handling_unit_heads`: trưởng phòng ban xử lý (công văn đến) hay phòng ban soạn thảo (công văn đi).
 */
export type ApproverRule =
  | { readonly type: 'choose'; readonly pool: 'leaders' | 'positions' | 'units'; readonly ids?: readonly string[] }
  | { readonly type: 'users'; readonly userIds: readonly string[] }
  | { readonly type: 'positions'; readonly positionIds: readonly string[] }
  | { readonly type: 'unit_heads'; readonly unitIds: readonly string[] }
  | { readonly type: 'handling_unit_heads' };

export type ApproverRuleType = ApproverRule['type'];

export const APPROVER_RULE_LABELS: Readonly<Record<ApproverRuleType, string>> = {
  choose: 'Người trình chọn trong một nhóm',
  users: 'Người được chỉ định',
  positions: 'Người giữ chức danh',
  unit_heads: 'Trưởng đơn vị',
  handling_unit_heads: 'Trưởng phòng ban xử lý / soạn thảo',
};

/**
 * Khi người duyệt chọn "Không đạt", công văn về đâu (mặc định của bước; người duyệt vẫn
 * chọn được nơi khác trong số nơi hợp lệ):
 * - `previous-step`: bước duyệt trước; bước duyệt đầu tiên thì về người xử lý;
 * - `handlers`: phòng ban xử lý (công văn đến) hay người soạn thảo (công văn đi);
 * - `clerk`: văn thư.
 */
export const RETURN_TARGETS = ['previous-step', 'handlers', 'clerk'] as const;
export type ReturnTarget = (typeof RETURN_TARGETS)[number];

export function returnTargetLabel(target: ReturnTarget, direction: LetterDirection): string {
  if (target === 'previous-step') return 'Bước trước';
  if (target === 'clerk') return 'Văn thư';
  return direction === 'incoming' ? 'Phòng ban xử lý' : 'Người soạn thảo';
}

/**
 * Loại bước ở giữa quy trình (giữa ô tiếp nhận / soạn thảo và ô hoàn tất / ban hành, lưu trữ):
 * phòng ban xử lý (phòng do người làm bước liền trước chọn), văn thư kiểm tra, duyệt theo luật
 * người duyệt. Thêm, bớt, đổi thứ tự tự do trong cấu hình.
 */
export const STEP_TYPES = ['process', 'check', 'approve'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_TYPE_LABELS: Readonly<Record<StepType, string>> = {
  process: 'Phòng ban xử lý',
  check: 'Văn thư kiểm tra',
  // Lãnh đạo xem xét: duyệt rồi chuyển tiếp, hay chỉ đạo, phân công phòng ban khi bước liền sau là phòng ban xử lý.
  approve: 'Lãnh đạo duyệt / chỉ đạo',
};

/**
 * Điều kiện theo phân loại công văn: mỗi mục có giá trị thì công văn phải thuộc một trong các giá trị đó
 * (các mục cùng lúc là "và"). Dùng chọn quy trình và bật / tắt một bước.
 */
export interface LetterCondition {
  readonly kinds?: readonly string[];
  readonly urgency?: readonly string[];
  readonly confidentiality?: readonly string[];
}

/** Bước có điều kiện: `skip` là bỏ qua khi khớp, không thì chỉ chạy khi khớp. */
export interface StepCondition extends LetterCondition {
  readonly skip?: boolean;
}

export function conditionSet(condition: LetterCondition | undefined): boolean {
  return Boolean(condition && ((condition.kinds?.length ?? 0) > 0 || (condition.urgency?.length ?? 0) > 0 || (condition.confidentiality?.length ?? 0) > 0));
}

/** Công văn khớp điều kiện; điều kiện trống là khớp. */
export function matchesCondition(
  condition: LetterCondition | undefined,
  letter: { readonly kind: string; readonly urgency: string; readonly confidentiality: string },
): boolean {
  if (!condition) return true;
  const fits = (values: readonly string[] | undefined, value: string) => !values || values.length === 0 || values.includes(value);
  return fits(condition.kinds, letter.kind) && fits(condition.urgency, letter.urgency) && fits(condition.confidentiality, letter.confidentiality);
}

/** Bước áp dụng cho công văn: không có điều kiện, chỉ chạy khi khớp, hay bỏ qua khi khớp. */
export function stepApplies(
  step: { readonly condition?: StepCondition },
  letter: { readonly kind: string; readonly urgency: string; readonly confidentiality: string },
): boolean {
  if (!conditionSet(step.condition)) return true;
  const matched = matchesCondition(step.condition, letter);
  return step.condition?.skip ? !matched : matched;
}

/**
 * Khi nào một bước coi là xong:
 * - bước duyệt: `any` một người trong nhóm duyệt là đủ (mặc định), `all` mọi người trong nhóm đều phải duyệt;
 * - bước phòng ban xử lý: `all` mọi phòng chủ trì, phối hợp gửi kết quả (mặc định), `lead` phòng chủ trì gửi là xong.
 */
export const STEP_MODES = ['any', 'all', 'lead'] as const;
export type StepMode = (typeof STEP_MODES)[number];
export const APPROVE_MODE_LABELS: Readonly<Record<'any' | 'all', string>> = {
  any: 'Một người trong nhóm duyệt là đủ',
  all: 'Tất cả người trong nhóm đều phải duyệt',
};
export const PROCESS_MODE_LABELS: Readonly<Record<'all' | 'lead', string>> = {
  all: 'Mọi phòng chủ trì, phối hợp gửi kết quả',
  lead: 'Phòng chủ trì gửi kết quả là xong',
};
/** Cách xong mặc định của loại bước (bước văn thư kiểm tra: một người làm là xong). */
export function stepModeOf(step: { readonly type?: StepType; readonly mode?: StepMode }): StepMode {
  const type = step.type ?? 'approve';
  if (type === 'process') return step.mode === 'lead' ? 'lead' : 'all';
  if (type === 'approve') return step.mode === 'all' ? 'all' : 'any';
  return 'any';
}

/** Tên mặc định của ô đầu (nơi công văn được tạo) và ô cuối (đánh số, lưu trữ) theo luồng. */
export const FLOW_START_NAMES: Readonly<Record<LetterDirection, string>> = {
  incoming: 'Văn thư tiếp nhận',
  outgoing: 'Phòng ban soạn thảo',
};
export const FLOW_END_NAMES: Readonly<Record<LetterDirection, string>> = {
  incoming: 'Văn thư hoàn tất, lưu trữ',
  outgoing: 'Văn thư ban hành, lưu trữ',
};

/** Loại của bước; bước cũ không ghi loại là bước duyệt. */
export function stepTypeOf(step: { readonly type?: StepType }): StepType {
  return step.type ?? 'approve';
}

/** Một bước ở giữa quy trình. */
export interface WorkflowStep {
  readonly key: string;
  readonly name: string;
  /** Trống là bước duyệt (dữ liệu trước khi có loại bước). */
  readonly type?: StepType;
  /**
   * Ai làm bước: bước duyệt bắt buộc có; bước văn thư kiểm tra có thì giao đúng những người này (thư ký,
   * phòng hành chính…), trống là người làm văn thư; bước phòng ban xử lý không có.
   */
  readonly approver?: ApproverRule;
  /** Khi nào bước xong (xem `STEP_MODES`); trống là mặc định của loại bước. */
  readonly mode?: StepMode;
  /**
   * Bước phòng ban xử lý: phòng ban cố định của bước. Người làm bước trước không chọn thì giao các phòng
   * này; `lockUnits` thì luôn giao đúng các phòng này, không ai chọn lại.
   */
  readonly units?: readonly { readonly unitId: string; readonly role: AssignmentRole }[];
  readonly lockUnits?: boolean;
  /** Bước chỉ chạy khi (hay bỏ qua khi) công văn khớp điều kiện; trống là luôn chạy. */
  readonly condition?: StepCondition;
  /**
   * Bước duyệt là bước chỉ đạo (bút phê): người duyệt ghi ý kiến chỉ đạo, chọn đơn vị / cá nhân
   * chủ trì, phối hợp và thời hạn; bước phòng ban xử lý sau đó giao theo bút phê.
   */
  readonly directs?: boolean;
  /** Không đạt thì trả về đâu; trống là bước trước. */
  readonly rejectTo?: ReturnTarget;
  /** Số ngày cho bước, để nhắc hạn; trống là theo hạn của công văn. */
  readonly dueDays?: number;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly direction: LetterDirection;
  readonly isActive: boolean;
  /** Dùng khi loại văn bản chưa gắn quy trình của luồng này. */
  readonly isDefault: boolean;
  /** Tên ô đầu, ô cuối của thanh tiến trình; trống là tên mặc định của luồng. */
  readonly startName?: string;
  readonly endName?: string;
  /**
   * Công văn đến: văn thư vào sổ xong là tự chuyển sang bước đầu (bước đầu là phòng ban xử lý thì
   * giao phòng ban gợi ý của loại văn bản), không cần bước phân loại riêng.
   */
  readonly autoStart?: boolean;
  /** Người làm ô cuối (hoàn tất / ban hành); trống là văn thư. */
  readonly endActor?: ApproverRule;
  /** Xong bước cuối là tự hoàn tất (đến) / tự cấp số đi, ban hành (đi), không chờ ai bấm. */
  readonly autoEnd?: boolean;
  /** Ô cuối cấp số hồ sơ, lưu trữ (mặc định có). */
  readonly archive?: boolean;
  /** Các bước ở giữa theo thứ tự; rỗng là đi thẳng từ ô đầu tới ô cuối. */
  readonly steps: readonly WorkflowStep[];
  /**
   * Áp dụng cho công văn khớp điều kiện (loại văn bản, độ khẩn, độ mật): quy trình có điều kiện khớp
   * được chọn trước quy trình gắn với loại văn bản và quy trình mặc định.
   */
  readonly conditions?: LetterCondition;
  readonly updatedAt: string;
}

export interface SaveWorkflowRequest {
  readonly name: string;
  readonly description?: string;
  readonly direction: LetterDirection;
  readonly isActive?: boolean;
  readonly isDefault?: boolean;
  readonly startName?: string;
  readonly endName?: string;
  readonly autoStart?: boolean;
  readonly endActor?: ApproverRule | null;
  readonly autoEnd?: boolean;
  readonly archive?: boolean;
  readonly steps: readonly WorkflowStep[];
  readonly conditions?: LetterCondition | null;
}

export const MAX_WORKFLOW_STEPS = 30;

/* ------------------------------------------------------------- bước thật */

export const LETTER_STEP_STATUSES = ['waiting', 'active', 'done', 'skipped'] as const;
export type LetterStepStatus = (typeof LETTER_STEP_STATUSES)[number];

export type LetterStepDecision = 'approved' | 'returned';

/** Một bước trên một công văn cụ thể (chép từ quy trình khi công văn rời ô đầu). */
export interface LetterStep {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  readonly type: StepType;
  readonly approver?: ApproverRule;
  /** Bước chỉ đạo (bút phê). */
  readonly directs?: boolean;
  readonly mode?: StepMode;
  /** Bước duyệt "tất cả cùng duyệt": ai đã duyệt, và tổng số người phải duyệt. */
  readonly approvedBy?: readonly { readonly userId: string; readonly name?: string }[];
  readonly requiredCount?: number;
  /** Bước phòng ban xử lý: phòng ban cố định, có khoá chọn lại hay không. */
  readonly units?: readonly { readonly unitId: string; readonly role: AssignmentRole }[];
  readonly lockUnits?: boolean;
  readonly status: LetterStepStatus;
  readonly assignees: readonly { readonly userId: string; readonly name?: string }[];
  readonly actedBy?: string;
  readonly actedByName?: string;
  readonly actedAt?: string;
  readonly decision?: LetterStepDecision;
  readonly note?: string;
}

/**
 * Ô trên thanh tiến trình, dựng theo quy trình cấu hình của công văn: các bước cố định của
 * luồng (tiếp nhận, phòng ban xử lý, ban hành…) xen các bước duyệt. Khi công văn chưa trình,
 * các bước duyệt là của quy trình sẽ áp dụng (theo loại văn bản hay quy trình mặc định).
 */
export interface FlowNode {
  readonly key: string;
  readonly label: string;
  /** Ô đầu, ô cuối, hay loại bước ở giữa; ô xác nhận huỷ là `revoke`. */
  readonly kind: 'start' | 'end' | 'revoke' | StepType;
  readonly state: 'done' | 'current' | 'todo';
  /** Bước duyệt của quy trình (không phải bước cố định của luồng). */
  readonly approval: boolean;
  /** Người đã làm, đang được giao hay sẽ làm bước này. */
  readonly people?: string;
  /** Lúc xong bước (ISO). */
  readonly at?: string;
}

/* ------------------------------------------------------------- tệp */

/**
 * Loại tệp: bản quét công văn đến (văn thư), dự thảo / kết quả (phòng ban, người soạn),
 * bản ban hành đã ký (văn thư), tài liệu kèm theo.
 */
export const ATTACHMENT_KINDS = ['incoming', 'draft', 'outgoing', 'reference'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Readonly<Record<AttachmentKind, string>> = {
  incoming: 'Công văn đến',
  draft: 'Dự thảo, kết quả xử lý',
  outgoing: 'Bản ban hành',
  reference: 'Tài liệu kèm theo',
};

export const CORRESPONDENCE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

export interface LetterAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  /** Phiên bản hiện hành (tải phiên bản mới thì tăng). */
  readonly versionNo: number;
  readonly uploadedBy: string;
  readonly uploadedByName?: string;
  readonly createdAt: string;
  /** Người xem gỡ được tệp ở bước hiện tại. */
  readonly canDelete: boolean;
  /** Người xem tải được phiên bản mới của tệp ở bước hiện tại. */
  readonly canVersion: boolean;
}

/* ------------------------------------------------------------- phòng ban */

export const ASSIGNMENT_STATUSES = ['pending', 'submitted'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * Vai trò của đơn vị được giao: chủ trì (chịu trách nhiệm kết quả), phối hợp, hay nhận để biết (được
 * xem, được báo, không phải gửi kết quả, không chặn bước).
 */
export const ASSIGNMENT_ROLES = ['lead', 'support', 'info'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];
export const ASSIGNMENT_ROLE_LABELS: Readonly<Record<AssignmentRole, string>> = { lead: 'Chủ trì', support: 'Phối hợp', info: 'Để biết' };

/** Bút phê của bước chỉ đạo: ý kiến chỉ đạo, đơn vị / cá nhân chủ trì, phối hợp, thời hạn. */
export interface LetterDirective {
  readonly note?: string;
  readonly dueOn?: string;
  readonly units: readonly {
    readonly unitId: string;
    readonly unitName: string;
    readonly role: AssignmentRole;
    readonly handlerUserId?: string;
    readonly handlerName?: string;
  }[];
  readonly stepName?: string;
  readonly by?: string;
  readonly byName?: string;
  readonly at?: string;
}

/** Tình trạng bì văn bản đến lúc tiếp nhận. */
export const ENVELOPE_STATUSES = ['intact', 'damaged', 'electronic'] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];
export const ENVELOPE_STATUS_LABELS: Readonly<Record<EnvelopeStatus, string>> = {
  intact: 'Bì nguyên vẹn',
  damaged: 'Bì rách, có dấu hiệu bóc mở',
  electronic: 'Văn bản điện tử',
};

export interface LetterAssignment {
  readonly id: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly role: AssignmentRole;
  readonly round: number;
  readonly status: AssignmentStatus;
  /** Người xử lý do phòng ban phân công. */
  readonly handlerUserId?: string;
  readonly handlerName?: string;
  readonly responseNote?: string;
  readonly submittedBy?: string;
  readonly submittedByName?: string;
  readonly submittedAt?: string;
  readonly revisionReason?: string;
  readonly headNames: readonly string[];
  /** Người xem phân công được người xử lý cho phòng. */
  readonly canAssignHandler: boolean;
  /** Người xem gửi được kết quả của phòng. */
  readonly canRespond: boolean;
  /** Phòng chủ trì: các phòng phối hợp còn chưa gửi kết quả (chủ trì gửi sau khi đủ). */
  readonly waitingFor?: readonly string[];
}

/* ------------------------------------------------------------- nhật ký, trao đổi */

export const LETTER_HISTORY_ACTIONS = [
  'receive',
  'create',
  'update',
  'dispatch',
  'assign-handler',
  'respond',
  'send-to-clerk',
  'submit',
  'approve',
  'return',
  'complete',
  'publish',
  'delivery',
  'archive',
  'cancel',
  'attach',
  'detach',
  'version',
  'remind',
  'revoke-request',
  'revoke-approve',
  'revoke-reject',
  'revoke-withdraw',
  'delete',
  // Giá trị của luồng cũ, còn trong nhật ký công văn trước đây.
  'classify',
  'direct',
  'close-for-info',
  'review-requested',
  'request-revision',
] as const;
export type LetterHistoryAction = (typeof LETTER_HISTORY_ACTIONS)[number];

export interface LetterHistoryEntry {
  readonly id: string;
  readonly action: LetterHistoryAction;
  readonly summary: string;
  readonly note?: string;
  readonly actorUserId?: string;
  readonly actorName?: string;
  readonly at: string;
}

export interface LetterComment {
  readonly id: string;
  /** Bước của công văn lúc viết: tên giai đoạn hay tên bước duyệt. */
  readonly stepLabel: string;
  readonly body: string;
  /** Người được nhắc tên (@) trong trao đổi; họ thấy được công văn và nhận thông báo. */
  readonly mentions: readonly { readonly userId: string; readonly name?: string }[];
  readonly authorId: string;
  readonly authorName?: string;
  readonly at: string;
}

/* ------------------------------------------------------------- công văn */

export const DELIVERY_STATUSES = ['pending', 'sent', 'received', 'returned'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  pending: 'Chưa gửi',
  sent: 'Đã gửi',
  received: 'Nơi nhận đã nhận',
  returned: 'Bị trả lại',
};

export interface LetterSummary {
  readonly id: string;
  readonly direction: LetterDirection;
  /** Số hiển thị: số đến; công văn đi là số ban hành, chưa có thì số dự thảo. */
  readonly displayNo: string;
  /** Số đến (công văn đến) hay số dự thảo (công văn đi). */
  readonly incomingNo: string;
  readonly receivedOn: string;
  /** Công văn đến: cơ quan gửi. Công văn đi: đơn vị soạn thảo. */
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: string;
  readonly kindName: string;
  readonly urgency: string;
  readonly urgencyName: string;
  readonly urgencyHighlight: boolean;
  readonly confidentiality: string;
  readonly confidentialityName: string;
  readonly restricted: boolean;
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly stageLabel: string;
  readonly currentStepName?: string;
  readonly currentAssigneeNames: readonly string[];
  readonly assignmentsDone: number;
  readonly assignmentsTotal: number;
  readonly authorUserId?: string;
  readonly authorName?: string;
  readonly authorUnitName?: string;
  /** Công văn đi: gửi với danh nghĩa cá nhân người soạn hay cả phòng ban. */
  readonly sentAs?: SentAs;
  readonly outgoingNo?: string;
  readonly publishedOn?: string;
  readonly recipient?: string;
  readonly deliveryStatus?: DeliveryStatus;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly receivedBy: string;
  readonly receivedByName?: string;
  readonly updatedAt: string;
  readonly awaitingMe: boolean;
  /** Phòng ban được giao, kèm vai trò: "Phòng Kế toán (chủ trì)". */
  readonly unitNames: readonly string[];
  /** Có công văn đi trả lời công văn đến này. */
  readonly replied?: boolean;
  /** Sổ đăng ký (công văn đến: lúc vào sổ; công văn đi: lúc ban hành). */
  readonly registerId?: string;
  readonly registerName?: string;
  /** Công văn đi: người ký, chức vụ người ký. */
  readonly signerName?: string;
  readonly signerTitle?: string;
  /** Số bản (đến: lúc tiếp nhận; đi: số bản phát hành). */
  readonly copyCount?: number;
}

export interface LetterDetail extends LetterSummary {
  /** Ghi chú của văn thư khi giao phòng ban (công văn đến). */
  readonly instruction?: string;
  readonly workflowId?: string;
  readonly workflowName?: string;
  readonly relatedLetterId?: string;
  readonly relatedLetterNo?: string;
  readonly cancelReason?: string;
  /** Phân loại sơ bộ lúc tiếp nhận. */
  readonly envelopeStatus?: EnvelopeStatus;
  readonly sealed?: boolean;
  readonly pageCount?: number;
  readonly copyCount?: number;
  readonly addressedTo?: string;
  readonly addressedUserId?: string;
  readonly addressedUserName?: string;
  /** Thư riêng gửi đích danh: chuyển thẳng người nhận, không vào quy trình xử lý. */
  readonly personal?: boolean;
  /** Bút phê của bước chỉ đạo gần nhất. */
  readonly directive?: LetterDirective;
  /** Đề nghị huỷ công văn đã ban hành / hoàn tất: đang chờ xác nhận (giai đoạn `revoking`) hay đã được đồng ý. */
  readonly revoke?: LetterRevoke;
  readonly completionNote?: string;
  readonly deliveryMethod?: string;
  readonly deliveryNote?: string;
  readonly deliveredOn?: string;
  readonly sharedFolderId?: string;
  readonly steps: readonly LetterStep[];
  readonly flow: readonly FlowNode[];
  readonly assignments: readonly LetterAssignment[];
  readonly attachments: readonly LetterAttachment[];
  readonly comments: readonly LetterComment[];
  readonly history: readonly LetterHistoryEntry[];
  readonly actions: LetterActions;
}

export interface LetterRevoke {
  readonly kind: RevokeKind;
  readonly kindLabel: string;
  readonly reason: string;
  readonly requestedBy?: string;
  readonly requestedByName?: string;
  readonly requestedAt?: string;
  /** Người có thẩm quyền xác nhận (bước duyệt cuối của quy trình). */
  readonly approverNames: readonly string[];
}

/** Thao tác người xem làm được ở bước hiện tại; quyền thật vẫn kiểm ở API. */
export interface LetterActions {
  readonly edit: boolean;
  /** Công văn đến: văn thư phân loại, chọn phòng ban, giao xử lý. */
  readonly dispatch: boolean;
  /** Công văn đi: người soạn gửi văn thư. */
  readonly sendToClerk: boolean;
  /** Công văn đi: văn thư xác nhận hợp lệ và trình duyệt. */
  readonly submit: boolean;
  /** Bước duyệt đang chờ người xem. */
  readonly approve: boolean;
  /** Công văn đến: văn thư xác nhận hoàn tất và lưu trữ. */
  readonly complete: boolean;
  /** Công văn đi: văn thư đánh số, ban hành, lưu trữ. */
  readonly publish: boolean;
  /** Công văn đi đã ban hành: cập nhật tình trạng gửi. */
  readonly updateDelivery: boolean;
  readonly cancel: boolean;
  /** Văn thư đề nghị huỷ (thu hồi, sửa đổi) công văn đã ban hành / hoàn tất. */
  readonly requestRevoke: boolean;
  /** Người có thẩm quyền xác nhận huỷ hay không. */
  readonly decideRevoke: boolean;
  /** Văn thư rút đề nghị huỷ khi chưa được xác nhận. */
  readonly withdrawRevoke: boolean;
  /** Xoá công văn đã huỷ khỏi Văn thư. */
  readonly remove: boolean;
  /** Văn thư / bộ phận tổng hợp đôn đốc người đang xử lý. */
  readonly remind: boolean;
  /** Người xem trả lại được về đâu ở bước hiện tại ("Không đạt"). */
  readonly returnTargets: readonly ReturnTarget[];
  /** Ngoài các nơi trên: trả về đúng một bước đã xong bất kỳ trước bước hiện tại. */
  readonly returnSteps?: readonly { readonly seq: number; readonly name: string }[];
  /** Nơi trả về mặc định của bước hiện tại (cấu hình của bước duyệt). */
  readonly defaultReturnTarget?: ReturnTarget;
  readonly comment: boolean;
  /** Tạo công văn đi trả lời công văn đến này. */
  readonly reply: boolean;
  readonly attachKinds: readonly AttachmentKind[];
}

/** Ứng viên cho bước duyệt sắp bắt đầu khi bước đó để người thao tác chọn người duyệt. */
export interface StepChoice {
  readonly stepName: string;
  readonly candidates: readonly { readonly userId: string; readonly name: string; readonly detail?: string }[];
}

/* -------------------------------------------------------------- yêu cầu */

/** Phân loại sơ bộ lúc tiếp nhận: bì, niêm phong, số tờ, số bản, văn bản gửi đích danh. */
/** Phân loại sơ bộ lúc tiếp nhận; khi sửa, `null` là xoá giá trị đã ghi. */
export interface IntakeCheck {
  readonly envelopeStatus?: EnvelopeStatus | null;
  /** Văn bản mật: dấu niêm phong còn nguyên. */
  readonly sealed?: boolean;
  readonly pageCount?: number | null;
  readonly copyCount?: number | null;
  /** Gửi đích danh cá nhân hay tổ chức đoàn thể (ghi tên); `addressedUserId` khi là người trong hệ thống. */
  readonly addressedTo?: string | null;
  readonly addressedUserId?: string | null;
}

export interface CreateLetterRequest extends IntakeCheck {
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly receivedOn?: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
  /** Sổ đăng ký; trống là sổ theo độ mật và loại văn bản. */
  readonly registerId?: string;
  /**
   * Thư riêng gửi đích danh (`addressedUserId`): không bóc bì, chuyển thẳng người nhận, không vào quy trình
   * xử lý; người nhận trả văn thư được nếu là việc chung.
   */
  readonly personal?: boolean;
}

/** Soạn công văn đi. Đơn vị soạn thảo mặc định là phòng ban của người soạn, chọn lại được phòng khác trong sơ đồ tổ chức. */
/** Công văn đi gửi với danh nghĩa cá nhân người soạn hay cả phòng ban soạn thảo. */
export const SENT_AS = ['person', 'unit'] as const;
export type SentAs = (typeof SENT_AS)[number];
export const SENT_AS_LABELS: Readonly<Record<SentAs, string>> = {
  person: 'Cá nhân người soạn',
  unit: 'Cả phòng ban soạn thảo',
};

/** Người gửi công văn đi để hiện: cá nhân "Tên (Phòng)", cả phòng "Phòng". */
export function outgoingSender(letter: { readonly sentAs?: SentAs; readonly authorName?: string; readonly authorUnitName?: string; readonly senderOrg: string }): string {
  if (letter.sentAs === 'person' && letter.authorName) {
    return letter.authorUnitName ? `${letter.authorName} (${letter.authorUnitName})` : letter.authorName;
  }
  return letter.authorUnitName ?? letter.senderOrg;
}

export interface CreateOutgoingRequest {
  readonly subject: string;
  readonly recipient: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
  /** Phòng ban soạn thảo khi người soạn thuộc nhiều phòng. */
  readonly authorUnitId?: string;
  /** Gửi với danh nghĩa cá nhân (mặc định) hay cả phòng ban. */
  readonly sentAs?: SentAs;
  /** Công văn đến mà công văn đi này trả lời. */
  readonly relatedLetterId?: string;
}

export interface UpdateLetterRequest extends IntakeCheck {
  readonly senderOrg?: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject?: string;
  readonly receivedOn?: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
  readonly recipient?: string;
  readonly sentAs?: SentAs;
}

/**
 * Một phòng ban được giao. Không chọn người xử lý thì mọi nhân sự của phòng cùng nhận (và
 * phòng phân công sau được); chọn thì người đó nhận và xử lý.
 */
export interface DispatchUnit {
  readonly unitId: string;
  readonly handlerUserId?: string;
  /** Trống là chủ trì. */
  readonly role?: AssignmentRole;
}

/** Văn thư / bộ phận tổng hợp nhắc người đang phải xử lý công văn. */
export interface RemindRequest {
  readonly note?: string;
}

/** Văn thư phân loại, chọn phòng ban xử lý và giao (công văn đến). */
/**
 * Khi chuyển sang bước kế tiếp: bước đó là "Phòng ban xử lý" thì người làm bước liền trước chọn
 * phòng ban (`units`); bước duyệt để người trình chọn người thì chọn người (`assigneeUserId` /
 * `nextAssigneeUserId`).
 */
export interface NextStepInput {
  readonly units?: readonly DispatchUnit[];
  /** Thời hạn hoàn thành khi giao phòng ban / bút phê; đặt lại hạn xử lý của công văn. */
  readonly dueOn?: string;
}

export interface DispatchLetterRequest extends NextStepInput {
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality?: string;
  readonly dueOn?: string;
  readonly note?: string;
  /** Quy trình lãnh đạo xem xét sau khi phòng ban xử lý xong; trống là mặc định. */
  readonly workflowId?: string;
  /** Người duyệt bước đầu khi bước đó để người trình chọn. */
  readonly assigneeUserId?: string;
}

export interface AssignHandlerRequest {
  readonly handlerUserId: string;
  readonly note?: string;
}

export interface SubmitLetterRequest extends NextStepInput {
  readonly workflowId?: string;
  readonly assigneeUserId?: string;
  readonly note?: string;
}

/** Người soạn gửi công văn đi sang bước đầu của quy trình. */
export interface SendLetterRequest extends NextStepInput {
  readonly note?: string;
  readonly assigneeUserId?: string;
}

export interface ApproveStepRequest extends NextStepInput {
  readonly note?: string;
  readonly nextAssigneeUserId?: string;
}

export interface ReturnLetterRequest {
  /** `step`: về đúng bước đã xong `stepSeq` (bất kỳ bước nào trước bước hiện tại). */
  readonly target: ReturnTarget | 'step';
  readonly stepSeq?: number;
  readonly reason: string;
  /** Khi trả phòng ban: phòng ban phải làm lại; trống là mọi phòng. */
  readonly assignmentIds?: readonly string[];
}

export interface NoteRequest {
  readonly note?: string;
}

export interface ReasonRequest {
  readonly reason: string;
}

export interface RequestRevokeRequest {
  readonly kind: RevokeKind;
  readonly reason: string;
}

export interface DecideRevokeRequest {
  /** true: đồng ý huỷ; false: giữ công văn. */
  readonly approve: boolean;
  readonly note?: string;
}

export interface RespondAssignmentRequest {
  readonly note: string;
}

export interface PublishLetterRequest {
  readonly recipient: string;
  readonly publishedOn?: string;
  readonly deliveryMethod?: string;
  readonly note?: string;
  /** Sổ cấp số đi; trống là sổ theo độ mật và loại văn bản. */
  readonly registerId?: string;
  /** Người ký (mặc định người duyệt bước cuối), chức vụ người ký, số bản phát hành. */
  readonly signerUserId?: string;
  readonly signerName?: string;
  readonly signerTitle?: string;
  readonly copyCount?: number;
  /** Phòng ban trong công ty nhận văn bản (phát hành nội bộ): được xem, được báo. */
  readonly internalUnitIds?: readonly string[];
}

export interface UpdateDeliveryRequest {
  readonly status: DeliveryStatus;
  readonly deliveredOn?: string;
  readonly note?: string;
}

export interface CommentRequest {
  readonly body: string;
  /** Người được nhắc tên (@) trong nội dung. */
  readonly mentionedUserIds?: readonly string[];
}

export interface CreateAttachmentRequest {
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface CreateAttachmentVersionRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly note?: string;
}

export interface AttachmentUploadTicket {
  readonly attachment: LetterAttachment;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface CompleteAttachmentRequest {
  readonly sizeBytes: number;
}

export type AttachmentDownloadMode = 'download' | 'preview';

export interface AttachmentDownloadTicket {
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
  readonly fileName: string;
  readonly contentType: string;
}

/** `tracking`: theo dõi, đôn đốc công văn còn mở có hạn xử lý (sắp xếp theo hạn). */
export const LETTER_BOXES = ['incoming', 'outgoing', 'mine', 'archive', 'tracking'] as const;
export type LetterBox = (typeof LETTER_BOXES)[number];

export interface LetterQuery {
  readonly box?: LetterBox;
  readonly stage?: LetterStage;
  readonly search?: string;
  /** Chỉ công văn của một sổ đăng ký. */
  readonly registerId?: string;
  /** Ngày vào sổ (đến: ngày đến; đi: ngày soạn) từ, đến (`YYYY-MM-DD`, tính cả hai đầu). */
  readonly fromDate?: string;
  readonly toDate?: string;
  /** Mã loại văn bản. */
  readonly kind?: string;
}

/* ------------------------------------------------------------ tổng quan, báo cáo */

export interface CorrespondenceOverview {
  readonly incomingOpen: number;
  readonly outgoingOpen: number;
  readonly awaitingApproval: number;
  readonly overdue: number;
  readonly archived: number;
  readonly awaitingMe: number;
  readonly byStage: Readonly<Record<LetterDirection, Readonly<Partial<Record<LetterStage, number>>>>>;
  readonly urgent: readonly LetterSummary[];
}

export interface CorrespondenceReportRow {
  readonly label: string;
  readonly incoming: number;
  readonly outgoing: number;
  readonly completed: number;
  /** Đã xong mà quá hạn, hoặc còn mở đã quá hạn. */
  readonly late: number;
}

export interface CorrespondenceReport {
  readonly year: number;
  readonly totals: { readonly incoming: number; readonly outgoing: number; readonly completed: number; readonly open: number; readonly late: number };
  readonly byMonth: readonly CorrespondenceReportRow[];
  readonly byType: readonly CorrespondenceReportRow[];
  /** Phòng ban được giao xử lý công văn đến và phòng ban soạn công văn đi. */
  readonly byUnit: readonly CorrespondenceReportRow[];
}

/* ------------------------------------------------------------ kho lưu trữ */

/** Một tệp trong cây lưu trữ (nằm ở kho tài liệu của Hệ dùng chung). */
export interface ArchiveFile {
  readonly id: string;
  readonly fileName: string;
  readonly kind: AttachmentKind;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly versionNo: number;
  readonly createdAt: string;
  /** Phòng ban gửi tệp kết quả (công văn đến). */
  readonly unitName?: string;
}

/** Thư mục hồ sơ của một công văn, cùng tên với thư mục bên Hệ dùng chung. */
export interface ArchiveDossier {
  readonly letterId: string;
  readonly direction: LetterDirection;
  readonly folderName: string;
  readonly displayNo: string;
  readonly subject: string;
  readonly stage: LetterStage;
  readonly stageLabel: string;
  /** Cơ quan gửi (công văn đến) hay nơi nhận (công văn đi). */
  readonly partner?: string;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly receivedOn: string;
  readonly files: readonly ArchiveFile[];
}

/**
 * Cây lưu trữ như thư mục "Văn thư" bên Hệ dùng chung: năm › công văn đến / đi › hồ sơ › tệp.
 * Chỉ gồm công văn người xem được thấy.
 */
export interface ArchiveTree {
  readonly rootName: string;
  readonly years: readonly {
    readonly year: number;
    readonly groups: readonly { readonly direction: LetterDirection; readonly label: string; readonly dossiers: readonly ArchiveDossier[] }[];
  }[];
}

/* -------------------------------------------------------- sơ đồ tổ chức */

export interface DirectoryMember {
  readonly userId: string;
  readonly name: string;
  readonly positionName?: string;
  readonly isHead: boolean;
}

export interface DirectoryUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly path: string;
  readonly members: readonly DirectoryMember[];
}

export interface DirectoryPosition {
  readonly id: string;
  readonly name: string;
  readonly unitName?: string;
  readonly holderNames: readonly string[];
}

export interface CorrespondenceDirectory {
  readonly units: readonly DirectoryUnit[];
  readonly positions: readonly DirectoryPosition[];
  readonly people: readonly { readonly userId: string; readonly name: string }[];
  /** Người có quyền lãnh đạo (`correspondence.letter.direct`). */
  readonly leaders: readonly { readonly userId: string; readonly name: string }[];
  /** Phòng ban của người đang xem (để soạn công văn đi). */
  readonly myUnitIds: readonly string[];
  readonly degraded: boolean;
}

/* ------------------------------------------------------------- cấu hình */

/**
 * Cách giao phòng ban mặc định: `all` cả phòng cùng nhận (chọn người xử lý là tuỳ chọn),
 * `handler` văn thư phải chọn một người xử lý cho mỗi phòng.
 */
export const DISPATCH_MODES = ['all', 'handler'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

export const DISPATCH_MODE_LABELS: Readonly<Record<DispatchMode, string>> = {
  all: 'Cả phòng ban cùng nhận (chọn người xử lý nếu cần)',
  handler: 'Phải chọn một người xử lý cho mỗi phòng ban',
};

export interface CorrespondenceSettings {
  readonly incomingSuffix: string;
  readonly outgoingSuffix: string;
  readonly archivePrefix: string;
  readonly defaultDueDays: number;
  readonly dispatchMode: DispatchMode;
  /**
   * Người làm văn thư (1–10 người): làm được việc của văn thư trong phân hệ (tiếp nhận, kiểm tra,
   * ban hành, lưu trữ), nhận thông báo việc của văn thư và hiện tên ở các bước của văn thư. Trống
   * là mọi người có quyền văn thư trong Phân quyền.
   */
  readonly clerkUserIds: readonly string[];
  /**
   * Ủy quyền duyệt: trong khoảng ngày, người được ủy quyền (thường là cấp phó) làm được các bước
   * duyệt, bút phê giao cho người ủy quyền.
   */
  readonly delegations: readonly Delegation[];
  /** Ký hiệu cơ quan trong số văn bản (`{coquan}`), ví dụ "SVN". */
  readonly orgCode?: string;
  /** Ký hiệu đơn vị trong số văn bản (`{donvi}`); đơn vị chưa đặt thì lấy chữ cái đầu của tên. */
  readonly unitCodes?: readonly { readonly unitId: string; readonly code: string }[];
}

export interface Delegation {
  readonly fromUserId: string;
  readonly toUserId: string;
  /** `YYYY-MM-DD`, tính cả hai đầu. */
  readonly fromDate: string;
  readonly toDate: string;
  readonly note?: string;
}

export const MAX_CLERKS = 10;
export const MAX_DELEGATIONS = 50;

/** Ủy quyền đang có hiệu lực vào ngày `on`. */
export function activeDelegations(delegations: readonly Delegation[] | undefined, on: string): Delegation[] {
  return (delegations ?? []).filter((item) => item.fromDate <= on && on <= item.toDate);
}

export const DEFAULT_CORRESPONDENCE_SETTINGS: CorrespondenceSettings = {
  incomingSuffix: 'CVĐ',
  outgoingSuffix: 'CV',
  archivePrefix: 'HS',
  defaultDueDays: 7,
  dispatchMode: 'all',
  clerkUserIds: [],
  delegations: [],
  orgCode: '',
  unitCodes: [],
};

export interface CorrespondenceConfig {
  readonly settings: CorrespondenceSettings;
  readonly catalog: readonly CatalogItem[];
  readonly registers: readonly Register[];
  readonly workflows: readonly Workflow[];
}

/* ------------------------------------------------------------ trạng thái */

export interface CorrespondenceCapabilities {
  readonly isTenantAdmin: boolean;
  readonly canRegister: boolean;
  readonly canCreateOutgoing: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  readonly canDirect: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  readonly canReadReports: boolean;
  readonly canConfigure: boolean;
}

export interface CorrespondenceStatus {
  readonly tenantId: string;
  readonly userId: string;
  readonly tablesReady: boolean;
  readonly capabilities: CorrespondenceCapabilities;
}

/* --------------------------------------------------------------- sự kiện */

export const CORRESPONDENCE_EVENTS = {
  /** Phòng ban được giao xử lý công văn đến (giải ra trưởng đơn vị). */
  assigned: 'correspondence.letter.assigned',
  /** Người được phòng ban phân công xử lý. */
  handlerAssigned: 'correspondence.letter.handler-assigned',
  /** Công văn đi gửi văn thư kiểm tra. */
  sentToClerk: 'correspondence.letter.sent-to-clerk',
  /** Bước duyệt bắt đầu, chờ người duyệt. */
  stepAssigned: 'correspondence.letter.step-assigned',
  returned: 'correspondence.letter.returned',
  /** Duyệt xong: chờ văn thư hoàn tất (đến) hay ban hành (đi). */
  approved: 'correspondence.letter.approved',
  completed: 'correspondence.letter.completed',
  published: 'correspondence.letter.published',
  cancelled: 'correspondence.letter.cancelled',
  /** Văn thư đề nghị huỷ công văn đã ban hành / hoàn tất, chờ người có thẩm quyền xác nhận. */
  revokeRequested: 'correspondence.letter.revoke-requested',
  /** Người có thẩm quyền không đồng ý huỷ. */
  revokeRejected: 'correspondence.letter.revoke-rejected',
  /** Văn thư rút đề nghị huỷ. */
  revokeWithdrawn: 'correspondence.letter.revoke-withdrawn',
  /** Văn thư / bộ phận tổng hợp đôn đốc người đang phải xử lý. */
  reminded: 'correspondence.letter.reminded',
  /** Văn bản gửi đích danh một người: báo người đó lúc tiếp nhận. */
  addressed: 'correspondence.letter.addressed',
  commented: 'correspondence.letter.commented',
  mentioned: 'correspondence.letter.mentioned',
  dueSoon: 'correspondence.letter.due-soon',
  overdue: 'correspondence.letter.overdue',
} as const;
export type CorrespondenceEventType = (typeof CORRESPONDENCE_EVENTS)[keyof typeof CORRESPONDENCE_EVENTS];

export function letterDeepLink(letterId: string): string {
  return `${CORRESPONDENCE_LAUNCH_URL}#letters/${encodeURIComponent(letterId)}`;
}

export function letterTitle(letter: { readonly displayNo?: string; readonly incomingNo: string; readonly subject: string }): string {
  return `${letter.displayNo ?? letter.incomingNo} · ${letter.subject}`;
}

export function daysUntil(dueOn: string, today: string): number {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}

export const CATALOG_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
