/**
 * Kiểu dữ liệu cho rẽ nhánh: thuộc tính, điều kiện, điểm rẽ nhánh và dấu vết
 * chạy của hồ sơ.
 *
 * Mô hình là "danh sách bước + khối rẽ nhánh có cấu trúc", không phải graph tự
 * do: mỗi gateway đứng sau một bước trục chính, mỗi nhánh là một danh sách bước,
 * và mọi nhánh hợp về bước trục chính kế tiếp. Nhờ vậy không thể cấu hình ra
 * vòng lặp hay nhánh cụt, và quy trình tuyến tính cũ chỉ là trường hợp không có
 * gateway nào.
 */

// ------------------------------------------------------------------ Thuộc tính

export const PROCEDURE_ATTRIBUTE_TYPES = [
  'text',
  'number',
  'money',
  'percent',
  'date',
  'select',
  'boolean',
  'file',
  'user',
] as const;

export type ProcedureAttributeType = (typeof PROCEDURE_ATTRIBUTE_TYPES)[number];

export const PROCEDURE_ATTRIBUTE_TYPE_LABELS: Readonly<Record<ProcedureAttributeType, string>> = {
  text: 'Văn bản',
  number: 'Số',
  money: 'Số tiền',
  percent: 'Phần trăm',
  date: 'Ngày',
  select: 'Danh sách chọn',
  boolean: 'Có/Không',
  file: 'Tệp',
  user: 'Người dùng',
};

export interface ProcedureAttributeOption {
  readonly code: string;
  readonly label: string;
}

export interface ProcedureAttributeDefinition {
  readonly id: string;
  /** Duy nhất trong phạm vi của nó (quy trình, hoặc một bước); điều kiện tham chiếu bằng mã này. */
  readonly code: string;
  readonly name: string;
  readonly type: ProcedureAttributeType;
  readonly required: boolean;
  /** Chỉ dùng với kiểu 'select'. */
  readonly options?: readonly ProcedureAttributeOption[];
}

/** Trỏ tới một thuộc tính: của quy trình, hoặc của một bước cụ thể (theo id bước định nghĩa). */
export type ProcedureAttributeRef =
  | { readonly scope: 'process'; readonly code: string }
  | { readonly scope: 'step'; readonly stepId: string; readonly code: string };

/**
 * Giá trị đã nhập, mang theo kiểu để khi định nghĩa đổi kiểu thì giá trị cũ
 * không bị hiểu nhầm. Ngày lưu dạng YYYY-MM-DD, không giờ.
 */
export type ProcedureAttributeValue =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'number' | 'money' | 'percent'; readonly value: number }
  | { readonly type: 'date'; readonly value: string }
  | { readonly type: 'select'; readonly value: string }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'file'; readonly value: readonly string[] }
  | { readonly type: 'user'; readonly value: string; readonly label?: string };

export interface ProcedureAttributeValueRecord {
  readonly value: ProcedureAttributeValue;
  readonly enteredBy: string;
  readonly enteredAt: string;
}

// ------------------------------------------------------------------ Điều kiện

export const PROCEDURE_CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is',
  'is_not',
  'in',
  'before',
  'after',
  'date_between',
  'empty',
  'not_empty',
] as const;

export type ProcedureConditionOperator = (typeof PROCEDURE_CONDITION_OPERATORS)[number];

export interface ProcedureConditionRule {
  readonly id: string;
  readonly attribute: ProcedureAttributeRef;
  readonly operator: ProcedureConditionOperator;
  /** Vắng mặt với empty/not_empty; là mảng mã với 'in'. */
  readonly value?: number | string | boolean | readonly string[];
  /** Cận trên cho between / date_between. */
  readonly valueTo?: number | string;
}

export interface ProcedureConditionGroup {
  readonly combinator: 'and' | 'or';
  readonly rules: readonly ProcedureConditionRule[];
}

// ------------------------------------------------------------------ Rẽ nhánh

export interface ProcedureBranchDefinition {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  /** Đúng một nhánh mặc định mỗi gateway: không có điều kiện, luôn xét cuối cùng. */
  readonly isDefault: boolean;
  readonly condition?: ProcedureConditionGroup;
  /** Bước riêng của nhánh theo thứ tự chạy, bằng id bước định nghĩa. Có thể rỗng. */
  readonly stepIds: readonly string[];
}

export interface ProcedureGatewayDefinition {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly type: 'exclusive';
  /** Bước trục chính mà gateway đứng ngay sau. */
  readonly afterStepId: string;
  /** Thứ tự trong mảng là thứ tự xét; nhánh mặc định luôn được xét sau cùng. */
  readonly branches: readonly ProcedureBranchDefinition[];
}

/** Phần luật rẽ nhánh được chụp vào hồ sơ lúc khởi tạo. */
export interface ProcedureFlowSnapshot {
  readonly attributes: readonly ProcedureAttributeDefinition[];
  readonly gateways: readonly ProcedureGatewayDefinition[];
}

// ------------------------------------------------------------------ Dấu vết chạy

export interface ProcedurePathEntry {
  readonly stepInstanceId: string;
  readonly enteredAt: string;
  /** Vào bước này nhờ quyết định rẽ nhánh nào (bước đầu của nhánh hoặc điểm hợp). */
  readonly viaDecisionId?: string;
  /** Có giá trị khi đoạn đường này đã bị trả về qua; giữ lại để kiểm toán. */
  supersededAt?: string;
}

export interface ProcedureRuleResult {
  readonly ruleId: string;
  readonly matched: boolean;
}

export interface ProcedureBranchResult {
  readonly branchId: string;
  readonly matched: boolean;
  readonly rules: readonly ProcedureRuleResult[];
}

export interface ProcedureDecisionInput {
  readonly ref: ProcedureAttributeRef;
  readonly value?: ProcedureAttributeValue;
}

export interface ProcedureGatewayDecision {
  readonly id: string;
  readonly gatewayId: string;
  readonly gatewayName: string;
  readonly afterStepInstanceId: string;
  readonly chosenBranchId: string;
  readonly chosenBranchLabel: string;
  readonly usedDefault: boolean;
  readonly evaluatedAt: string;
  /** Giá trị thật tại lúc đánh giá — bằng chứng vì sao hồ sơ đi nhánh này. */
  readonly inputs: readonly ProcedureDecisionInput[];
  readonly branchResults: readonly ProcedureBranchResult[];
  supersededAt?: string;
}

export interface ProcedureProgress {
  readonly completed: number;
  readonly total: number;
  /** True khi phía trước còn điểm rẽ nhánh chưa quyết, nên tổng chỉ là ước lượng. */
  readonly isEstimate: boolean;
}

// ------------------------------------------------------------------ Người duyệt động

export interface ProcedureManagerChainLink {
  readonly positionId: string;
  readonly positionName: string;
  readonly holderUserIds: readonly string[];
}

export interface ProcedureAssignmentResolution {
  readonly assignmentId: string;
  readonly rule: 'initiator_manager';
  readonly initiatorPositionId?: string;
  readonly chain: readonly { positionId: string; positionName: string; holderCount: number }[];
  readonly resolvedTo: {
    readonly subjectType: 'organization_unit' | 'position' | 'user';
    readonly subjectId: string;
    readonly label?: string;
  };
  readonly usedFallback: boolean;
  readonly resolvedAt: string;
}

// ------------------------------------------------------------------ Kết quả kiểm tra

export interface ProcedureValidationIssue {
  readonly level: 'error' | 'warning';
  readonly message: string;
  readonly stepId?: string;
  readonly gatewayId?: string;
  readonly branchId?: string;
}

export interface ProcedureValidationReport {
  readonly errors: readonly ProcedureValidationIssue[];
  readonly warnings: readonly ProcedureValidationIssue[];
}
