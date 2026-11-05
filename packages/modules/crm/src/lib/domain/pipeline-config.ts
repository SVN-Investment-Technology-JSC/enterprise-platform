import {
  OPPORTUNITY_REQUIRED_FIELDS,
  PIPELINE_PROFILES,
  STAGE_ASSIGNEE_RULES,
  STAGE_REQUIREMENT_KINDS,
  STAGE_SEMANTICS,
  TENDER_REQUIRED_FIELDS,
  type Pipeline,
  type PipelineProfile,
  type PipelineStage,
  type StageAssigneeRule,
  type StageRequirementInput,
  type StageRequirementKind,
  type StageSemantic,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';
import { isUuid } from './fields.js';

/**
 * Quy tắc cấu hình luồng cơ hội (GĐ G, P2G-01, P2G-02). Thuần: không đọc DB, không biết HTTP.
 *
 * Quy tắc an toàn đã chốt:
 * - giai đoạn đã dùng (có cơ hội ở đó, có trong lịch sử, hoặc kế hoạch đã xử lý) không xoá, không đổi mã,
 *   không đổi nghĩa; chỉ tắt. Cơ hội ở giai đoạn đã tắt vẫn xem và chuyển đi được (có sẵn ở `allowedTransitions`);
 * - mỗi luồng luôn có ít nhất một giai đoạn OPEN, một WON và một LOST đang bật;
 * - luồng đang có cơ hội không xoá, chỉ tắt; luồng mặc định không tắt, không xoá và phải là STANDARD;
 * - luồng TENDER không bật gợi ý chăm sóc lại;
 * - bước chuyển chỉ giữa giai đoạn cùng luồng, không tự trỏ về chính nó, không đi ra từ WON hoặc LOST;
 * - đổi cấu hình không đụng `opportunity_stage_history`.
 */

export const MAX_STAGES_PER_PIPELINE = 40;
export const MAX_PIPELINES = 50;
export const MAX_REQUIREMENTS_PER_STAGE = 20;
export const MAX_MANAGER_LEVEL_PARAM = 10;

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

/** Mã luồng hoặc giai đoạn: chữ in hoa, số, gạch dưới; bắt đầu bằng chữ; tối đa 32 ký tự. Chữ thường được đổi sang hoa. */
export function normalizeCode(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!text) throw new CrmValidationError('CODE_REQUIRED', `Vui lòng nhập mã ${label}.`);
  if (!CODE_PATTERN.test(text)) {
    throw new CrmValidationError(
      'INVALID_CODE',
      `Mã ${label} chỉ gồm chữ không dấu, số và gạch dưới, bắt đầu bằng chữ, tối đa 32 ký tự.`,
    );
  }
  return text;
}

export function normalizeName(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CrmValidationError('NAME_REQUIRED', `Vui lòng nhập tên ${label}.`);
  if (text.length > 200) throw new CrmValidationError('NAME_TOO_LONG', `Tên ${label} tối đa 200 ký tự.`);
  return text;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], code: string, message: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new CrmValidationError(code, message);
  }
  return value as T;
}

function optionalBoolean(value: unknown, message: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new CrmValidationError('INVALID_FLAG', message);
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CrmValidationError('INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.');
  }
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LUỒNG
// ---------------------------------------------------------------------------

export interface NewPipelineInput {
  readonly code: string;
  readonly name: string;
  readonly profile: PipelineProfile | null;
  readonly templateId: string | null;
}

export function parseNewPipeline(body: unknown): NewPipelineInput {
  const input = asObject(body);
  const profile =
    input['profile'] === undefined || input['profile'] === null
      ? null
      : oneOf(input['profile'], PIPELINE_PROFILES, 'INVALID_PROFILE', 'Loại luồng không hợp lệ (STANDARD hoặc TENDER).');
  const templateId = typeof input['templateId'] === 'string' && input['templateId'].trim() ? input['templateId'].trim() : null;
  return {
    code: normalizeCode(input['code'], 'luồng'),
    name: normalizeName(input['name'], 'luồng'),
    profile,
    templateId,
  };
}

export interface PipelinePatch {
  readonly name?: string;
  readonly active?: boolean;
  readonly careSuggestion?: boolean;
}

export function parsePipelinePatch(body: unknown): PipelinePatch {
  const input = asObject(body);
  if (input['profile'] !== undefined) {
    throw new CrmValidationError('PROFILE_LOCKED', 'Không đổi loại luồng sau khi tạo. Hãy tạo luồng mới.');
  }
  if (input['code'] !== undefined) {
    throw new CrmValidationError('PIPELINE_CODE_LOCKED', 'Không đổi mã luồng sau khi tạo.');
  }
  const patch = {
    ...(input['name'] !== undefined ? { name: normalizeName(input['name'], 'luồng') } : {}),
    ...(input['active'] !== undefined ? { active: optionalBoolean(input['active'], 'Trạng thái bật tắt của luồng không hợp lệ.') } : {}),
    ...(input['careSuggestion'] !== undefined
      ? { careSuggestion: optionalBoolean(input['careSuggestion'], 'Vui lòng chọn bật hoặc tắt gợi ý chăm sóc lại.') }
      : {}),
  } as PipelinePatch;
  if (Object.keys(patch).length === 0) {
    throw new CrmValidationError('NOTHING_TO_UPDATE', 'Không có thay đổi nào để lưu.');
  }
  return patch;
}

export function assertPipelineCodeFree(pipelines: readonly Pipeline[], code: string): void {
  if (pipelines.some((pipeline) => pipeline.code === code)) {
    throw new CrmConflictError('PIPELINE_CODE_TAKEN', `Mã luồng "${code}" đã tồn tại.`);
  }
  if (pipelines.length >= MAX_PIPELINES) {
    throw new CrmConflictError('TOO_MANY_PIPELINES', `Tối đa ${MAX_PIPELINES} luồng.`);
  }
}

/** Luồng TENDER không bật gợi ý chăm sóc lại (400). */
export function assertCareSuggestionAllowed(profile: PipelineProfile, enabled: boolean): void {
  if (enabled && profile === 'TENDER') {
    throw new CrmValidationError('CARE_SUGGESTION_NOT_APPLICABLE', 'Luồng chào thầu không dùng gợi ý chăm sóc lại.');
  }
}

/** Luồng mặc định phải là STANDARD và đang bật (409). */
export function assertCanBeDefault(pipeline: Pipeline): void {
  if (pipeline.profile !== 'STANDARD') {
    throw new CrmConflictError('DEFAULT_MUST_BE_STANDARD', 'Luồng mặc định phải là luồng bán hàng thường, không phải luồng chào thầu.');
  }
  if (!pipeline.active) {
    throw new CrmConflictError('DEFAULT_MUST_BE_ACTIVE', 'Phải bật luồng trước khi đặt làm mặc định.');
  }
}

/** Luồng mặc định không tắt được (409). */
export function assertCanDeactivatePipeline(pipeline: Pipeline): void {
  if (pipeline.isDefault) {
    throw new CrmConflictError('DEFAULT_PIPELINE_LOCKED', 'Không tắt được luồng mặc định. Hãy đặt luồng khác làm mặc định trước.');
  }
}

/** Không xoá luồng mặc định, luồng đang có cơ hội (409, đề nghị tắt). */
export function assertCanDeletePipeline(pipeline: Pipeline, opportunityCount: number): void {
  if (pipeline.isDefault) {
    throw new CrmConflictError('DEFAULT_PIPELINE_LOCKED', 'Không xoá được luồng mặc định. Hãy đặt luồng khác làm mặc định trước.');
  }
  if (opportunityCount > 0) {
    throw new CrmConflictError(
      'PIPELINE_IN_USE',
      `Luồng "${pipeline.name}" đang có ${opportunityCount} cơ hội, không xoá được. Hãy tắt luồng để không tạo cơ hội mới.`,
      { opportunityCount },
    );
  }
}

/** `ids` phải đúng bằng tập `expected` (không thiếu, không thừa, không trùng). */
export function assertSameIdSet(ids: readonly string[], expected: readonly string[], label: string): void {
  const given = new Set(ids);
  if (given.size !== ids.length || ids.length !== expected.length || expected.some((id) => !given.has(id))) {
    throw new CrmValidationError('INVALID_ORDER', `Danh sách sắp xếp phải gồm đủ và đúng các ${label} hiện có.`);
  }
}

export function parseIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new CrmValidationError('INVALID_BODY', `Thiếu danh sách ${label}.`);
  const ids = value.map((id) => {
    if (!isUuid(id)) throw new CrmValidationError('INVALID_REFERENCE', `Danh sách ${label} có mã không hợp lệ.`);
    return id.toLowerCase();
  });
  return ids;
}

// ---------------------------------------------------------------------------
// GIAI ĐOẠN
// ---------------------------------------------------------------------------

export interface StageFields {
  readonly name: string;
  readonly semantic: StageSemantic;
  readonly defaultProbability: number;
  readonly active: boolean;
  readonly skippable: boolean;
  readonly assigneeRule: StageAssigneeRule;
  readonly assigneeParam: string | null;
}

export interface NewStageInput extends StageFields {
  readonly code: string;
}

function parseProbability(value: unknown): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new CrmValidationError('INVALID_PROBABILITY', 'Xác suất mặc định phải là số nguyên từ 0 đến 100.');
  }
  return number;
}

/**
 * Quy tắc gán người và tham số: FIXED_USER cần id người dùng, POSITION cần id chức danh, MANAGER_LEVEL cần số bậc
 * 1 đến 10; các quy tắc còn lại không có tham số. Trả tham số đã chuẩn hoá.
 */
export function normalizeAssignee(rule: StageAssigneeRule, param: unknown): string | null {
  const text = typeof param === 'number' ? String(param) : typeof param === 'string' ? param.trim() : '';
  switch (rule) {
    case 'NONE':
    case 'PROJECT_OWNER':
    case 'DIRECT_MANAGER':
      return null;
    case 'FIXED_USER':
      if (!isUuid(text)) throw new CrmValidationError('INVALID_ASSIGNEE_PARAM', 'Vui lòng chọn người được gán cố định.');
      return text.toLowerCase();
    case 'POSITION':
      if (!isUuid(text)) throw new CrmValidationError('INVALID_ASSIGNEE_PARAM', 'Vui lòng chọn chức danh được gán.');
      return text.toLowerCase();
    case 'MANAGER_LEVEL': {
      const level = Number(text);
      if (!text || !Number.isInteger(level) || level < 1 || level > MAX_MANAGER_LEVEL_PARAM) {
        throw new CrmValidationError('INVALID_ASSIGNEE_PARAM', `Số bậc cấp trên phải là số nguyên từ 1 đến ${MAX_MANAGER_LEVEL_PARAM}.`);
      }
      return String(level);
    }
  }
}

function parseSemantic(value: unknown): StageSemantic {
  return oneOf(value, STAGE_SEMANTICS, 'INVALID_SEMANTIC', 'Nghĩa của giai đoạn phải là Đang chạy, Thắng hoặc Thua.');
}

function parseRule(value: unknown): StageAssigneeRule {
  return oneOf(value, STAGE_ASSIGNEE_RULES, 'INVALID_ASSIGNEE_RULE', 'Quy tắc gán người đảm nhận không hợp lệ.');
}

export function parseNewStage(body: unknown): NewStageInput {
  const input = asObject(body);
  const semantic = input['semantic'] === undefined ? 'OPEN' : parseSemantic(input['semantic']);
  const rule = input['assigneeRule'] === undefined ? 'NONE' : parseRule(input['assigneeRule']);
  const skippable = optionalBoolean(input['skippable'], 'Cờ "có thể bỏ qua" không hợp lệ.') ?? false;
  if (skippable && semantic !== 'OPEN') {
    throw new CrmValidationError('INVALID_SKIPPABLE', 'Chỉ giai đoạn đang chạy mới đặt được "có thể bỏ qua".');
  }
  return {
    code: normalizeCode(input['code'], 'giai đoạn'),
    name: normalizeName(input['name'], 'giai đoạn'),
    semantic,
    defaultProbability: input['defaultProbability'] === undefined ? (semantic === 'WON' ? 100 : 0) : parseProbability(input['defaultProbability']),
    active: optionalBoolean(input['active'], 'Trạng thái bật tắt của giai đoạn không hợp lệ.') ?? true,
    skippable,
    assigneeRule: rule,
    assigneeParam: normalizeAssignee(rule, input['assigneeParam']),
  };
}

export interface StagePatch {
  readonly code?: string;
  readonly name?: string;
  readonly semantic?: StageSemantic;
  readonly defaultProbability?: number;
  readonly active?: boolean;
  readonly skippable?: boolean;
  readonly assigneeRule?: StageAssigneeRule;
  readonly assigneeParam?: string | null;
}

/** Đọc thân sửa giai đoạn; `stage` là giá trị hiện tại để kiểm tham số gán theo quy tắc sau khi sửa. */
export function parseStagePatch(body: unknown, stage: PipelineStage): StagePatch {
  const input = asObject(body);
  const patch: { -readonly [K in keyof StagePatch]: StagePatch[K] } = {};
  if (input['code'] !== undefined) patch.code = normalizeCode(input['code'], 'giai đoạn');
  if (input['name'] !== undefined) patch.name = normalizeName(input['name'], 'giai đoạn');
  if (input['semantic'] !== undefined) patch.semantic = parseSemantic(input['semantic']);
  if (input['defaultProbability'] !== undefined) patch.defaultProbability = parseProbability(input['defaultProbability']);
  if (input['active'] !== undefined) patch.active = optionalBoolean(input['active'], 'Trạng thái bật tắt của giai đoạn không hợp lệ.');
  if (input['skippable'] !== undefined) patch.skippable = optionalBoolean(input['skippable'], 'Cờ "có thể bỏ qua" không hợp lệ.');
  if (input['assigneeRule'] !== undefined || input['assigneeParam'] !== undefined) {
    const rule = input['assigneeRule'] === undefined ? stage.assigneeRule : parseRule(input['assigneeRule']);
    const rawParam = input['assigneeParam'] === undefined ? (input['assigneeRule'] === undefined ? stage.assigneeParam : null) : input['assigneeParam'];
    patch.assigneeRule = rule;
    patch.assigneeParam = normalizeAssignee(rule, rawParam);
  }
  if (Object.keys(patch).length === 0) throw new CrmValidationError('NOTHING_TO_UPDATE', 'Không có thay đổi nào để lưu.');
  const semantic = patch.semantic ?? stage.semantic;
  // Đổi sang nghĩa kết thúc mà không nói gì về "có thể bỏ qua" thì tự bỏ cờ này.
  if (semantic !== 'OPEN' && stage.skippable && patch.skippable === undefined) patch.skippable = false;
  if ((patch.skippable ?? stage.skippable) && semantic !== 'OPEN') {
    throw new CrmValidationError('INVALID_SKIPPABLE', 'Chỉ giai đoạn đang chạy mới đặt được "có thể bỏ qua".');
  }
  return patch;
}

export interface StageUsage {
  readonly opportunityCount: number;
  /** Có cơ hội ở đó, có trong lịch sử chuyển hoặc kế hoạch đã xử lý. */
  readonly used: boolean;
}

export function assertStageCodeFree(pipeline: Pipeline, code: string, exceptStageId?: string): void {
  if (pipeline.stages.some((stage) => stage.code === code && stage.id !== exceptStageId)) {
    throw new CrmConflictError('STAGE_CODE_TAKEN', `Mã giai đoạn "${code}" đã có trong luồng.`);
  }
}

export function assertStageLimit(pipeline: Pipeline): void {
  if (pipeline.stages.length >= MAX_STAGES_PER_PIPELINE) {
    throw new CrmConflictError('TOO_MANY_STAGES', `Mỗi luồng tối đa ${MAX_STAGES_PER_PIPELINE} giai đoạn.`);
  }
}

/**
 * Sửa mã, nghĩa của giai đoạn đã dùng: 409. Lý do: mã là giá trị `OpportunitySummary.stage`, sự kiện đã phát và
 * lịch sử ghi theo mã; nghĩa quyết định cách báo cáo gom cơ hội đã qua giai đoạn đó. Đổi tên thì luôn được.
 */
export function assertStagePatchAllowed(stage: PipelineStage, usage: StageUsage, patch: StagePatch): void {
  if (patch.code !== undefined && patch.code !== stage.code && usage.used) {
    throw new CrmConflictError(
      'STAGE_CODE_LOCKED',
      `Giai đoạn "${stage.name}" đã có cơ hội đi qua, không đổi mã được. Hãy đổi tên hoặc tắt giai đoạn rồi tạo giai đoạn mới.`,
    );
  }
  if (patch.semantic !== undefined && patch.semantic !== stage.semantic && usage.used) {
    throw new CrmConflictError(
      'STAGE_SEMANTIC_LOCKED',
      `Giai đoạn "${stage.name}" đã có cơ hội đi qua, không đổi nghĩa được. Hãy tắt giai đoạn rồi tạo giai đoạn mới.`,
    );
  }
}

/** Không xoá giai đoạn đã dùng (409, đề nghị tắt). */
export function assertCanDeleteStage(stage: PipelineStage, usage: StageUsage): void {
  if (usage.opportunityCount > 0) {
    throw new CrmConflictError(
      'STAGE_IN_USE',
      `Giai đoạn "${stage.name}" đang có ${usage.opportunityCount} cơ hội, không xoá được. Hãy tắt giai đoạn: cơ hội vẫn xem và chuyển đi được.`,
      { opportunityCount: usage.opportunityCount },
    );
  }
  if (usage.used) {
    throw new CrmConflictError(
      'STAGE_HAS_HISTORY',
      `Giai đoạn "${stage.name}" đã có trong lịch sử chuyển của cơ hội, không xoá được. Hãy tắt giai đoạn.`,
    );
  }
}

/**
 * Luồng sau khi sửa phải còn ít nhất một giai đoạn OPEN, một WON và một LOST đang bật (409). Gọi với tập giai đoạn
 * SAU thay đổi (xoá, tắt, đổi nghĩa).
 */
export function assertOutcomeStages(pipelineName: string, stagesAfter: readonly Pick<PipelineStage, 'semantic' | 'active'>[]): void {
  const has = (semantic: StageSemantic): boolean => stagesAfter.some((stage) => stage.active && stage.semantic === semantic);
  if (!has('WON')) {
    throw new CrmConflictError('LAST_WON_STAGE', `Luồng "${pipelineName}" phải còn ít nhất một giai đoạn Thắng đang bật.`);
  }
  if (!has('LOST')) {
    throw new CrmConflictError('LAST_LOST_STAGE', `Luồng "${pipelineName}" phải còn ít nhất một giai đoạn Thua đang bật.`);
  }
  if (!has('OPEN')) {
    throw new CrmConflictError('LAST_OPEN_STAGE', `Luồng "${pipelineName}" phải còn ít nhất một giai đoạn đang chạy được bật để tạo cơ hội mới.`);
  }
}

// ---------------------------------------------------------------------------
// BƯỚC CHUYỂN
// ---------------------------------------------------------------------------

/**
 * Kiểm tập đích của bước chuyển đi từ `from`: cùng luồng, không về chính nó, không trùng; giai đoạn WON hoặc LOST
 * không có bước chuyển đi. Trả tập đã khử trùng.
 */
export function validateTransitionTargets(pipeline: Pipeline, from: PipelineStage, toStageIds: readonly string[]): string[] {
  const unique = [...new Set(toStageIds)];
  if (unique.length !== toStageIds.length) {
    throw new CrmValidationError('DUPLICATE_TRANSITION', 'Danh sách bước chuyển có giai đoạn đích bị trùng.');
  }
  if (from.semantic !== 'OPEN' && unique.length > 0) {
    throw new CrmValidationError(
      'TERMINAL_STAGE_TRANSITION',
      `Giai đoạn kết thúc "${from.name}" không có bước chuyển đi.`,
    );
  }
  for (const id of unique) {
    if (id === from.id) {
      throw new CrmValidationError('SELF_TRANSITION', 'Giai đoạn không chuyển được về chính nó.');
    }
    if (!pipeline.stages.some((stage) => stage.id === id)) {
      throw new CrmValidationError('TRANSITION_OUT_OF_PIPELINE', 'Giai đoạn đích phải thuộc cùng luồng.');
    }
  }
  return unique;
}

// ---------------------------------------------------------------------------
// ĐIỀU KIỆN
// ---------------------------------------------------------------------------

const REF_KINDS: readonly StageRequirementKind[] = ['DOCUMENT_TYPE', 'FIELD', 'TENDER_FIELD'];
const TENDER_ONLY_KINDS: readonly StageRequirementKind[] = ['TENDER_PLAN_APPROVED', 'TENDER_FIELD'];

export interface ValidatedRequirement {
  readonly kind: StageRequirementKind;
  readonly ref: string;
  readonly required: boolean;
  readonly message: string;
  readonly sortOrder: number;
}

/**
 * Kiểm danh sách điều kiện của một giai đoạn. `ref`: DOCUMENT_TYPE phải là MÃ loại tài liệu có thật
 * (`documentTypeCodes`), FIELD thuộc `OPPORTUNITY_REQUIRED_FIELDS`, TENDER_FIELD thuộc `TENDER_REQUIRED_FIELDS`;
 * loại còn lại không có `ref`. Điều kiện hồ sơ thầu chỉ dùng cho luồng TENDER (luồng thường không có hồ sơ thầu nên
 * không bao giờ đạt). Thứ tự giữ nguyên như gửi lên.
 */
export function validateRequirements(
  input: unknown,
  profile: PipelineProfile,
  documentTypeCodes: ReadonlySet<string>,
): ValidatedRequirement[] {
  if (!Array.isArray(input)) throw new CrmValidationError('INVALID_BODY', 'Thiếu danh sách điều kiện.');
  if (input.length > MAX_REQUIREMENTS_PER_STAGE) {
    throw new CrmValidationError('TOO_MANY_REQUIREMENTS', `Mỗi giai đoạn tối đa ${MAX_REQUIREMENTS_PER_STAGE} điều kiện.`);
  }
  const seen = new Set<string>();
  return (input as Partial<StageRequirementInput>[]).map((raw, index) => {
    const item = asObject(raw);
    const kind = oneOf(item['kind'], STAGE_REQUIREMENT_KINDS, 'INVALID_REQUIREMENT_KIND', 'Loại điều kiện không hợp lệ.');
    if (profile !== 'TENDER' && TENDER_ONLY_KINDS.includes(kind)) {
      throw new CrmValidationError('REQUIREMENT_NOT_FOR_PROFILE', 'Điều kiện về hồ sơ thầu chỉ dùng cho luồng chào thầu.');
    }
    let ref = '';
    if (REF_KINDS.includes(kind)) {
      ref = typeof item['ref'] === 'string' ? item['ref'].trim() : '';
      if (!ref) throw new CrmValidationError('REQUIREMENT_REF_REQUIRED', 'Điều kiện này cần chọn đối tượng kiểm tra.');
      if (kind === 'DOCUMENT_TYPE' && !documentTypeCodes.has(ref)) {
        throw new CrmValidationError('INVALID_DOCUMENT_TYPE', `Loại tài liệu "${ref}" không tồn tại. Hãy chọn mã loại tài liệu trong Cài đặt.`);
      }
      if (kind === 'FIELD' && !Object.prototype.hasOwnProperty.call(OPPORTUNITY_REQUIRED_FIELDS, ref)) {
        throw new CrmValidationError('INVALID_FIELD', `Trường "${ref}" không dùng được làm điều kiện của cơ hội.`);
      }
      if (kind === 'TENDER_FIELD' && !Object.prototype.hasOwnProperty.call(TENDER_REQUIRED_FIELDS, ref)) {
        throw new CrmValidationError('INVALID_FIELD', `Trường "${ref}" không dùng được làm điều kiện của hồ sơ thầu.`);
      }
    } else if (typeof item['ref'] === 'string' && item['ref'].trim()) {
      throw new CrmValidationError('REQUIREMENT_REF_NOT_ALLOWED', 'Điều kiện này không có đối tượng kiểm tra đi kèm.');
    }
    const key = `${kind}\u0000${ref}`;
    if (seen.has(key)) throw new CrmValidationError('DUPLICATE_REQUIREMENT', 'Có điều kiện bị trùng trong danh sách.');
    seen.add(key);
    const required = item['required'] === undefined ? true : optionalBoolean(item['required'], 'Cờ "bắt buộc" không hợp lệ.') ?? true;
    const message = typeof item['message'] === 'string' ? item['message'].trim() : '';
    if (!message) throw new CrmValidationError('REQUIREMENT_MESSAGE_REQUIRED', 'Vui lòng nhập thông báo khi chưa đạt điều kiện.');
    if (message.length > 500) throw new CrmValidationError('REQUIREMENT_MESSAGE_TOO_LONG', 'Thông báo điều kiện tối đa 500 ký tự.');
    return { kind, ref, required, message, sortOrder: (index + 1) * 10 };
  });
}
