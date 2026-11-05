import type {
  Pipeline,
  PipelineProfile,
  PipelineStage,
  StageAssigneeRule,
  StageRequirementKind,
  StageSemantic,
} from './opportunities.js';

/**
 * Cấu hình luồng cơ hội cho quản trị viên (GĐ G, P2G-01). Mọi API dưới `/v1/pipelines` chỉ cho `crm.manage`.
 * Đổi cấu hình chỉ áp cho lần chuyển giai đoạn kế tiếp, không viết lại lịch sử.
 */

/** Giai đoạn kèm số liệu dùng để màn cấu hình biết có xoá, đổi mã, đổi nghĩa được không. */
export interface AdminPipelineStage extends PipelineStage {
  /** Số cơ hội đang đứng ở giai đoạn này. */
  readonly opportunityCount: number;
  /** Đã từng dùng (có cơ hội ở đó, có trong lịch sử chuyển, hoặc kế hoạch đã xử lý): khoá mã và nghĩa, không xoá. */
  readonly used: boolean;
}

export interface AdminPipeline extends Omit<Pipeline, 'stages'> {
  /** Số cơ hội thuộc luồng. */
  readonly opportunityCount: number;
  readonly stages: readonly AdminPipelineStage[];
}

/** Một dòng điều kiện trong mẫu luồng. */
export interface PipelineTemplateRequirement {
  readonly stageCode: string;
  readonly kind: StageRequirementKind;
  readonly ref: string;
  readonly required: boolean;
  readonly message: string;
}

export interface PipelineTemplateStage {
  readonly code: string;
  readonly name: string;
  readonly semantic: StageSemantic;
  readonly defaultProbability: number;
  readonly skippable: boolean;
  readonly assigneeRule: StageAssigneeRule;
}

/** Mẫu luồng có sẵn (P2G-04). */
export interface PipelineTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly profile: PipelineProfile;
  readonly stages: readonly PipelineTemplateStage[];
  /** Cặp `[mã giai đoạn từ, mã giai đoạn đến]`. */
  readonly transitions: readonly (readonly [string, string])[];
  readonly requirements: readonly PipelineTemplateRequirement[];
}

/** Tạo luồng trống (gồm sẵn giai đoạn Mới, Thắng, Thua) hoặc từ mẫu khi có `templateId`. */
export interface CreatePipelineRequest {
  readonly code: string;
  readonly name: string;
  /** Bỏ qua khi có `templateId` (lấy theo mẫu). Mặc định STANDARD. */
  readonly profile?: PipelineProfile;
  readonly templateId?: string;
}

/** Sửa luồng. Không đổi `profile` sau khi tạo. Các trường vắng là giữ nguyên. */
export interface UpdatePipelineRequest {
  readonly name?: string;
  readonly active?: boolean;
  readonly careSuggestion?: boolean;
}

export interface ReorderPipelinesRequest {
  /** Đủ mọi luồng của tenant, theo thứ tự mới. */
  readonly pipelineIds: readonly string[];
}

export interface CreateStageRequest {
  readonly code: string;
  readonly name: string;
  readonly semantic?: StageSemantic;
  readonly defaultProbability?: number;
  readonly active?: boolean;
  readonly skippable?: boolean;
  readonly assigneeRule?: StageAssigneeRule;
  readonly assigneeParam?: string | null;
}

/** Sửa giai đoạn. `code` và `semantic` chỉ đổi được khi giai đoạn chưa dùng. */
export interface UpdateStageRequest {
  readonly code?: string;
  readonly name?: string;
  readonly semantic?: StageSemantic;
  readonly defaultProbability?: number;
  readonly active?: boolean;
  readonly skippable?: boolean;
  readonly assigneeRule?: StageAssigneeRule;
  readonly assigneeParam?: string | null;
}

export interface ReorderStagesRequest {
  /** Đủ mọi giai đoạn của luồng (cả đã tắt), theo thứ tự mới. */
  readonly stageIds: readonly string[];
}

/** Đặt lại toàn bộ tập bước chuyển đi từ một giai đoạn. */
export interface SetStageTransitionsRequest {
  readonly toStageIds: readonly string[];
}

export interface StageRequirementInput {
  readonly kind: StageRequirementKind;
  /** Mã loại tài liệu (DOCUMENT_TYPE), tên trường (FIELD, TENDER_FIELD); bỏ trống với loại khác. */
  readonly ref?: string;
  readonly required?: boolean;
  readonly message: string;
}

/** Đặt lại toàn bộ điều kiện chuyển vào một giai đoạn. */
export interface SetStageRequirementsRequest {
  readonly requirements: readonly StageRequirementInput[];
}
