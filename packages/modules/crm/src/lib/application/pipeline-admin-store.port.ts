import type { Pipeline, PipelineProfile, StageAssigneeRule, StageSemantic } from '@enterprise-platform/contracts-crm';
import type { CrmAuditEntry } from '../domain/audit-log.js';
import type { StageUsage, ValidatedRequirement } from '../domain/pipeline-config.js';

/** Token DI của `PipelineAdminStore` (ghi cấu hình luồng). */
export const CRM_PIPELINE_ADMIN_STORE = Symbol('CRM_PIPELINE_ADMIN_STORE');

/** Ảnh chụp cấu hình đọc BÊN TRONG transaction ghi (không qua cache) kèm số liệu sử dụng. */
export interface PipelineAdminSnapshot {
  readonly pipelines: readonly Pipeline[];
  /** Theo id giai đoạn; giai đoạn vắng là chưa dùng. */
  readonly stageUsage: ReadonlyMap<string, StageUsage>;
  /** Số cơ hội theo id luồng; luồng vắng là 0. */
  readonly pipelineOpportunityCount: ReadonlyMap<string, number>;
  /** Mã mọi loại tài liệu có trong kho tài liệu CRM. */
  readonly documentTypeCodes: ReadonlySet<string>;
}

export interface StageColumns {
  readonly code?: string;
  readonly name?: string;
  readonly semantic?: StageSemantic;
  readonly defaultProbability?: number;
  readonly active?: boolean;
  readonly skippable?: boolean;
  readonly assigneeRule?: StageAssigneeRule;
  readonly assigneeParam?: string | null;
}

/** Thao tác ghi trong MỘT transaction, đã giữ khoá tuần tự hoá cấu hình luồng của tenant. */
export interface PipelineAdminTx {
  load(): Promise<PipelineAdminSnapshot>;
  insertPipeline(input: {
    readonly code: string;
    readonly name: string;
    readonly profile: PipelineProfile;
    readonly careSuggestion: boolean;
    readonly actorId: string;
  }): Promise<string>;
  updatePipeline(
    id: string,
    patch: { readonly name?: string; readonly active?: boolean; readonly careSuggestion?: boolean },
    actorId: string,
  ): Promise<void>;
  setPipelineOrder(ids: readonly string[], actorId: string): Promise<void>;
  setDefaultPipeline(id: string, actorId: string): Promise<void>;
  /** Xoá luồng cùng giai đoạn của nó (chỉ gọi khi luồng không có cơ hội). */
  deletePipeline(id: string): Promise<void>;
  insertStage(pipelineId: string, input: Required<StageColumns>, actorId: string): Promise<string>;
  updateStage(id: string, patch: StageColumns, actorId: string): Promise<void>;
  setStageOrder(pipelineId: string, ids: readonly string[], actorId: string): Promise<void>;
  /** Xoá giai đoạn chưa dùng; dọn bước chuyển, điều kiện và dòng kế hoạch còn chờ. */
  deleteStage(id: string): Promise<void>;
  replaceTransitions(fromStageId: string, toStageIds: readonly string[]): Promise<void>;
  replaceRequirements(stageId: string, requirements: readonly ValidatedRequirement[]): Promise<void>;
  audit(entry: CrmAuditEntry): Promise<void>;
}

export interface PipelineAdminStore {
  /** Cấu hình và số liệu sử dụng mới nhất từ DB (không qua cache). */
  snapshot(tenantId: string): Promise<PipelineAdminSnapshot>;
  /** Chạy `work` trong một transaction; lỗi thì huỷ toàn bộ. Huỷ cache là việc của bên gọi, sau khi hàm này xong. */
  run<T>(tenantId: string, work: (tx: PipelineAdminTx) => Promise<T>): Promise<T>;
}
