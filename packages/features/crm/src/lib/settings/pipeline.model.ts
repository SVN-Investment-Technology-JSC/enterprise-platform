import {
  OPPORTUNITY_REQUIRED_FIELDS,
  STAGE_REQUIREMENT_KINDS,
  TENDER_REQUIRED_FIELDS,
  type AdminPipeline,
  type AdminPipelineStage,
  type PipelineProfile,
  type StageAssigneeRule,
  type StageRequirementInput,
  type StageRequirementKind,
} from '@enterprise-platform/contracts-crm';

/** Mã luồng, giai đoạn: chữ hoa đầu, chữ hoa, số, gạch dưới, tối đa 32 ký tự (khớp server). */
export const PIPELINE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
export const MAX_MANAGER_LEVEL = 10;

export function normalizePipelineCode(value: string): string {
  return value.trim().toUpperCase();
}

export const PIPELINE_PROFILE_LABELS: Readonly<Record<PipelineProfile, string>> = {
  STANDARD: 'Bán hàng tiêu chuẩn',
  TENDER: 'Chào thầu',
};

export const ASSIGNEE_RULE_LABELS: Readonly<Record<StageAssigneeRule, string>> = {
  NONE: 'Không gán',
  FIXED_USER: 'Người cố định',
  PROJECT_OWNER: 'Chủ dự án',
  DIRECT_MANAGER: 'Quản lý trực tiếp',
  MANAGER_LEVEL: 'Cấp trên N bậc',
  POSITION: 'Theo chức danh',
};

export const REQUIREMENT_KIND_LABELS: Readonly<Record<StageRequirementKind, string>> = {
  FIELD: 'Trường cơ hội phải có giá trị',
  QUOTE_APPROVED: 'Có báo giá khách chấp nhận',
  REASON: 'Phải ghi lý do',
  DOCUMENT_TYPE: 'Có tài liệu thuộc loại',
  TENDER_PLAN_APPROVED: 'Phương án chào thầu đã duyệt',
  TENDER_FIELD: 'Trường hồ sơ thầu phải có giá trị',
};

/** Loại điều kiện chọn được: loại thầu chỉ có ở luồng TENDER. */
export function requirementKindsFor(profile: PipelineProfile): StageRequirementKind[] {
  return STAGE_REQUIREMENT_KINDS.filter((kind) => profile === 'TENDER' || (kind !== 'TENDER_PLAN_APPROVED' && kind !== 'TENDER_FIELD'));
}

export function requirementNeedsRef(kind: StageRequirementKind): boolean {
  return kind === 'FIELD' || kind === 'DOCUMENT_TYPE' || kind === 'TENDER_FIELD';
}

/** Tuỳ chọn tham chiếu cho `FIELD` và `TENDER_FIELD` (giá trị là khoá trường, nhãn tiếng Việt). */
export function fieldRefOptions(kind: StageRequirementKind): { value: string; label: string }[] {
  const source: Readonly<Record<string, string>> =
    kind === 'FIELD' ? OPPORTUNITY_REQUIRED_FIELDS : kind === 'TENDER_FIELD' ? TENDER_REQUIRED_FIELDS : {};
  return Object.entries(source).map(([value, label]) => ({ value, label }));
}

/** Gợi ý thông báo khi người dùng chưa gõ. */
export function defaultRequirementMessage(kind: StageRequirementKind, refLabel?: string): string {
  switch (kind) {
    case 'FIELD':
    case 'TENDER_FIELD':
      return refLabel ? `Vui lòng nhập ${refLabel.toLowerCase()}.` : 'Vui lòng nhập thông tin còn thiếu.';
    case 'QUOTE_APPROVED':
      return 'Cần có báo giá khách đã chấp nhận.';
    case 'REASON':
      return 'Vui lòng ghi lý do.';
    case 'DOCUMENT_TYPE':
      return refLabel ? `Cần tải lên tài liệu loại "${refLabel}".` : 'Cần tải lên tài liệu còn thiếu.';
    case 'TENDER_PLAN_APPROVED':
      return 'Phương án chào thầu cần được duyệt.';
  }
}

export function requirementFormError(item: StageRequirementInput): string | undefined {
  if (requirementNeedsRef(item.kind) && !item.ref?.trim()) {
    return item.kind === 'DOCUMENT_TYPE' ? 'Vui lòng chọn loại tài liệu.' : 'Vui lòng chọn trường.';
  }
  if (!item.message.trim()) return 'Vui lòng nhập thông báo khi thiếu điều kiện.';
  if (item.message.length > 500) return 'Thông báo tối đa 500 ký tự.';
  return undefined;
}

/** Dữ liệu gửi lên: chỉ DOCUMENT_TYPE có `required`; loại không cần `ref` thì bỏ `ref`. */
export function toRequirementInput(item: StageRequirementInput): StageRequirementInput {
  return {
    kind: item.kind,
    ...(requirementNeedsRef(item.kind) ? { ref: item.ref?.trim() } : {}),
    required: item.kind === 'DOCUMENT_TYPE' ? item.required !== false : true,
    message: item.message.trim(),
  };
}

export function stageFormError(input: { code?: string; name: string; probability: string }): string | undefined {
  if (input.code !== undefined && !PIPELINE_CODE_PATTERN.test(normalizePipelineCode(input.code))) {
    return 'Mã gồm chữ hoa, số, gạch dưới, bắt đầu bằng chữ, tối đa 32 ký tự.';
  }
  if (!input.name.trim()) return 'Vui lòng nhập tên.';
  const text = input.probability.trim();
  if (text !== '' && (!/^\d{1,3}$/.test(text) || Number(text) > 100)) return 'Xác suất là số nguyên từ 0 đến 100.';
  return undefined;
}

/** Lỗi của tham số quy tắc gán, hoặc undefined nếu hợp lệ. */
export function assigneeParamError(rule: StageAssigneeRule, param: string): string | undefined {
  const text = param.trim();
  if (rule === 'FIXED_USER' && !text) return 'Vui lòng chọn người được gán.';
  if (rule === 'POSITION' && !text) return 'Vui lòng nhập mã chức danh.';
  if (rule === 'MANAGER_LEVEL') {
    const level = Number(text);
    if (!text || !Number.isInteger(level) || level < 1 || level > MAX_MANAGER_LEVEL) return `Số bậc cấp trên là số nguyên từ 1 đến ${MAX_MANAGER_LEVEL}.`;
  }
  return undefined;
}

export function assigneeNeedsParam(rule: StageAssigneeRule): boolean {
  return rule === 'FIXED_USER' || rule === 'MANAGER_LEVEL' || rule === 'POSITION';
}

/** Tham số gửi lên: null khi quy tắc không dùng tham số. */
export function assigneeParamValue(rule: StageAssigneeRule, param: string): string | null {
  return assigneeNeedsParam(rule) ? param.trim() : null;
}

/** Lý do (tiếng Việt) không xoá được giai đoạn, hoặc undefined. Server vẫn kiểm lại. */
export function stageDeleteBlock(stage: AdminPipelineStage): string | undefined {
  if (stage.used) return 'Giai đoạn đã được dùng nên không xoá được. Hãy tắt giai đoạn này.';
  return undefined;
}

export const STAGE_LOCK_HINT = 'Giai đoạn đã được dùng nên không đổi được.';

export function pipelineDeleteBlock(pipeline: AdminPipeline): string | undefined {
  if (pipeline.isDefault) return 'Luồng mặc định không xoá được. Hãy đặt luồng khác làm mặc định trước.';
  if (pipeline.opportunityCount > 0) return `Luồng đang có ${pipeline.opportunityCount} cơ hội nên không xoá được. Hãy tắt luồng.`;
  return undefined;
}

export function pipelineActiveBlock(pipeline: AdminPipeline): string | undefined {
  return pipeline.isDefault ? 'Luồng mặc định không tắt hoặc xoá được. Hãy đặt luồng khác làm mặc định trước.' : undefined;
}

/** Lý do không đặt làm mặc định được: phải là luồng tiêu chuẩn và đang bật. */
export function pipelineDefaultBlock(pipeline: AdminPipeline): string | undefined {
  if (pipeline.isDefault) return 'Đây đang là luồng mặc định.';
  if (pipeline.profile !== 'STANDARD') return 'Luồng mặc định phải là luồng bán hàng tiêu chuẩn.';
  if (!pipeline.active) return 'Hãy bật luồng trước khi đặt làm mặc định.';
  return undefined;
}

export const TENDER_CARE_HINT = 'Luồng chào thầu không dùng gợi ý chăm sóc lại.';

/** Dời phần tử `id` lên (-1) hoặc xuống (+1); trả danh sách cũ nếu không dời được. */
export function moveId(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Giai đoạn đích chọn được từ một giai đoạn: mọi giai đoạn khác (đang bật hoặc đang là đích). Giai đoạn kết thúc không có bước chuyển đi. */
export function transitionTargets(pipeline: AdminPipeline, from: AdminPipelineStage): AdminPipelineStage[] {
  if (from.semantic !== 'OPEN') return [];
  return pipeline.stages.filter((stage) => stage.id !== from.id && (stage.active || from.nextStageIds.includes(stage.id)));
}

/** Gói tuỳ chọn tên giai đoạn kèm mã. */
export function stageLabel(stage: AdminPipelineStage): string {
  return `${stage.name} (${stage.code})${stage.active ? '' : ' - đã tắt'}`;
}
