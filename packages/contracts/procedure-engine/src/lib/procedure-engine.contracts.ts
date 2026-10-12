import type {
  ProcedureAssignmentResolution,
  ProcedureAttributeDefinition,
  ProcedureAttributeValue,
  ProcedureAttributeValueRecord,
  ProcedureFlowSnapshot,
  ProcedureGatewayDecision,
  ProcedureGatewayDefinition,
  ProcedurePathEntry,
  ProcedureProgress,
} from './procedure-flow.types.js';

export const PROCEDURE_KINDS = [
  'process',
  'maintenance_linked',
  'maintenance_direct',
] as const;

export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

export const PROCEDURE_DEFINITION_STATUSES = [
  'draft',
  'published',
  'archived',
] as const;

export type ProcedureDefinitionStatus =
  (typeof PROCEDURE_DEFINITION_STATUSES)[number];

export const PROCEDURE_RACI_ROLES = ['R', 'A', 'C', 'S', 'I', 'E'] as const;

export type ProcedureRaciRole = (typeof PROCEDURE_RACI_ROLES)[number];

export const PROCEDURE_STAGE_ORDER: ProcedureRaciRole[] = [
  'S',
  'R',
  'E',
  'C',
  'A',
];

export const PROCEDURE_RUNTIME_ACTIONS = [
  'approve',
  'reject',
  'return',
  'complete',
  'cancel',
  'comment',
] as const;

export type ProcedureRuntimeAction = (typeof PROCEDURE_RUNTIME_ACTIONS)[number];

/**
 * `initiator_manager` là chủ thể động: không trỏ vào ai cố định mà được phân giải
 * thành chức danh cụ thể lúc bước được kích hoạt, theo quan hệ "Báo cáo cho"
 * tính từ chức danh của người khởi tạo.
 */
export type ProcedureSubjectType =
  | 'organization_unit'
  | 'position'
  | 'user'
  | 'initiator_manager';

/** Chủ thể cố định dùng làm dự phòng khi leo hết chuỗi quản lý mà vẫn không có ai. */
export interface ProcedureManagerFallback {
  readonly subjectType: 'organization_unit' | 'position' | 'user';
  readonly subjectId: string;
  readonly subjectLabel?: string;
}

export const E_TASK_SOURCES = [
  'task_list',
  'equipment_template',
  'manual',
  'inventory_asset',
  'inventory_material',
] as const;

export type ETaskSource = (typeof E_TASK_SOURCES)[number];

/**
 * Configuration for a Role E assignment, stored in raci_assignments.e_task_config.
 *
 * `taskTemplate` is resolved once at publish time and then frozen: a published
 * version must keep executing the same task list even if the source asset is
 * edited later, so it is never re-read at runtime.
 *
 * Ngoại lệ duy nhất là BẢN SAO trong hồ sơ: khi hồ sơ mang `assetCode` riêng
 * (work order mở cho một thiết bị cụ thể), bản sao đó được nạp lại theo đúng
 * thiết bị đang làm. Định nghĩa vẫn giữ nguyên bản đóng băng, nên một quy trình
 * bảo trì dùng chung cho cả dãy máy không còn chạy theo đầu việc của mỗi máy
 * đầu tiên được gõ vào lúc thiết kế.
 */
export interface ProcedureETaskConfig {
  /** Source asset code when eTaskSource is 'inventory_asset'. */
  readonly assetCode?: string;
  /** Source material code when eTaskSource is 'inventory_material'. */
  readonly materialCode?: string;
  /** Snapshot taken at publish; absent while the definition is still a draft. */
  readonly taskTemplate?: readonly Record<string, unknown>[];
  readonly resolvedAt?: string;
}

export interface ProcedureRaciAssignment {
  id: string;
  role: ProcedureRaciRole;
  subjectType: ProcedureSubjectType;
  subjectId: string;
  subjectLabel?: string;
  fixedRollbackStepId?: string;
  eTaskSource?: ETaskSource;
  eTaskConfig?: ProcedureETaskConfig;
  /** Chỉ với `initiator_manager`; bắt buộc lúc công bố. */
  managerFallback?: ProcedureManagerFallback;
}

/**
 * Vật tư/dụng cụ mà một bước cần để làm được.
 *
 * `materialName` và `unit` được chụp lại **lúc công bố**, cùng khuôn với
 * `eTaskConfig.taskTemplate`: hồ sơ đang chạy không được đổi nội dung khi Kho
 * sửa danh mục. Còn số tồn thì ngược lại — luôn đọc mới lúc chạy.
 */
export interface ProcedureStepMaterial {
  readonly materialCode: string;
  readonly quantity: number;
  readonly note?: string;
  /** Chụp lúc công bố; vắng mặt khi quy trình còn là bản nháp. */
  readonly materialName?: string;
  readonly unit?: string;
}

/**
 * Kết quả kiểm tồn của một bước.
 *
 * Cố ý **không** thêm giá trị mới vào `ProcedureInstanceStepStatus`: enum đó điều
 * khiển máy trạng thái `advance()`, thêm một giá trị buộc mọi nhánh switch phải
 * sửa và rất dễ sinh lỗi câm. Bước thiếu hàng vẫn ở `active`, chỉ bị chặn hoàn
 * tất và hiện cảnh báo.
 */
/** Một dòng đối chiếu cần–có; `short` là phần thiếu, 0 nghĩa là đủ. */
export interface ProcedureStepMaterialCheckLine {
  readonly materialCode: string;
  readonly materialName?: string;
  readonly unit?: string;
  readonly required: number;
  readonly available: number;
  readonly short: number;
}

export interface ProcedureStepMaterialCheck {
  readonly state: 'ok' | 'short';
  readonly checkedAt: string;
  readonly lines: readonly ProcedureStepMaterialCheckLine[];
}

export interface ProcedureStepDefinition {
  id: string;
  key: string;
  order: number;
  name: string;
  description?: string;
  linkedDefinitionId?: string;
  /** Vật tư bước này cần; thiếu hàng thì bước bị chặn hoàn tất. */
  materials?: ProcedureStepMaterial[];
  /** Cam kết thời gian hoàn thành bước, tính bằng giờ. Bỏ trống = bước không có SLA. */
  slaHours?: number;
  /** Trường dữ liệu người thực hiện bước nhập khi chạy hồ sơ. */
  attributes?: ProcedureAttributeDefinition[];
  assignments: ProcedureRaciAssignment[];
}

export interface ProcedureDefinition {
  id: string;
  code: string;
  name: string;
  description?: string;
  kind: ProcedureKind;
  /**
   * Mã nhóm, lấy từ danh mục nhóm trong cấu hình module.
   *
   * Là chuỗi tự do chứ không phải union: admin thêm/xoá nhóm được nên không thể
   * đóng cứng danh sách trong code. Bản nháp phải có nhóm mới công bố được;
   * những bản đã công bố từ trước đợt này thì không có, và vẫn hợp lệ.
   */
  category?: string;
  status: ProcedureDefinitionStatus;
  versionNumber: number;
  steps: ProcedureStepDefinition[];
  /** Thuộc tính cấp quy trình, dùng chung cho mọi bước. */
  attributes?: ProcedureAttributeDefinition[];
  /** Điểm rẽ nhánh. Vắng mặt hoặc rỗng = quy trình tuyến tính. */
  gateways?: ProcedureGatewayDefinition[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export type ProcedureInstanceStatus =
  | 'running'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  /**
   * Hồ sơ đã hoàn thành nhưng bị admin huỷ hiệu lực. Lịch sử duyệt giữ nguyên;
   * kết quả của nó không còn được tính, và các module liên kết tự hoàn tác.
   */
  | 'reversed';

/** Ai, khi nào, vì sao huỷ hiệu lực một hồ sơ đã hoàn thành. */
export interface ProcedureInstanceReversal {
  reversedAt: string;
  reversedBy: string;
  reversedByName?: string;
  reason: string;
  /** Có yêu cầu người giữ vai S lập hồ sơ điều chỉnh hay không. */
  adjustmentRequested: boolean;
}

export type ProcedureInstanceStepStatus =
  | 'pending'
  | 'active'
  | 'ready'
  | 'completed'
  | 'returned'
  | 'rejected'
  | 'cancelled'
  /** Bước thuộc nhánh không được chọn. Trả về qua điểm rẽ nhánh thì về lại 'pending'. */
  | 'skipped';

export interface ProcedureInstanceStep {
  id: string;
  definitionStepId: string;
  key: string;
  order: number;
  name: string;
  status: ProcedureInstanceStepStatus;
  currentRoleStage: ProcedureRaciRole | null;
  assignments: ProcedureRaciAssignment[];
  /** Quy trình mở tiếp khi bước này xong; chép từ định nghĩa lúc khởi tạo. */
  linkedDefinitionId?: string;
  startedAt?: string;
  completedAt?: string;
  /** Chép lại từ định nghĩa lúc khởi tạo, để hồ sơ đang chạy không đổi luật giữa chừng. */
  slaHours?: number;
  /** Hạn tuyệt đối, tính khi bước bắt đầu. Xoá khi bước bị trả về. */
  slaDueAt?: string;
  /** Cách chạy đầu việc E(x) của bước này. Bỏ trống = 'parallel'. */
  subtaskExecutionMode?: ProcedureSubtaskExecutionMode;
  /** Chép từ định nghĩa lúc khởi tạo, cùng cách làm với slaHours. */
  materials?: ProcedureStepMaterial[];
  /** Kết quả lần kiểm tồn gần nhất; chưa kiểm thì vắng mặt. */
  materialCheck?: ProcedureStepMaterialCheck;
  /**
   * Mã phiếu giữ chỗ đang giữ vật tư cho bước này.
   *
   * Giữ chỗ khi bước đủ hàng, nhả khi bước xong / hồ sơ đóng / bước bị trả lại.
   * Không nhả thì kho kẹt hàng ảo vĩnh viễn, nên mọi lối ra đều phải gọi nhả.
   */
  materialReservations?: string[];
  /** Chụp từ định nghĩa lúc khởi tạo. */
  attributes?: ProcedureAttributeDefinition[];
  /**
   * Bản gốc của các assignment động trước khi phân giải. Giữ lại để khi bước bị
   * trả về thì lần kích hoạt sau phân giải lại theo tổ chức lúc đó.
   */
  dynamicAssignments?: ProcedureRaciAssignment[];
  /** Log phân giải người duyệt động, một mục cho mỗi lần kích hoạt. */
  resolutions?: ProcedureAssignmentResolution[];
}

/**
 * Một lần đã mở đơn vật tư từ hồ sơ này.
 *
 * Lưu lại để biết phần nào ĐÃ đặt: lần sau chỉ mở đơn cho phần vật tư khai
 * THÊM, chứ không đặt lại từ đầu. Không có nó thì mỗi lần bấm là một đơn trùng
 * toàn bộ, và thủ kho nhận ba phiếu cho cùng một lô hàng.
 *
 * Đọc ngược từ nhật ký cũng ra, nhưng nhật ký là chuỗi đã định dạng cho người
 * đọc — phân tích lại chuỗi đó là mời gọi lỗi ngay lần đầu ai sửa câu chữ.
 */
export interface ProcedureMaterialOrder {
  /** Mã hồ sơ đã mở. */
  readonly code: string;
  readonly kind: ProcedureMaterialRequestKind;
  readonly createdAt: string;
  readonly lines: readonly ProcedureStepMaterial[];
}

export interface ProcedureActivity {
  id: string;
  action: ProcedureRuntimeAction | 'start' | 'publish' | 'reverse';
  actorId: string;
  actorName: string;
  summary: string;
  comment?: string;
  createdAt: string;
  /** Người được nhắc tên trong nội dung. Chỉ để tô đậm khi hiển thị — không gửi thông báo. */
  mentions?: string[];
  /**
   * Id của trao đổi mà mục này trả lời.
   *
   * Lưu id chứ không nhúng bản trích vào nội dung: nhúng thì phần trích thành
   * văn bản tự do, sửa được và không bao giờ khớp lại nếu bản gốc đổi. Bản gốc
   * bị xoá thì client tự xử lý bằng cách hiện "trao đổi đã bị gỡ".
   */
  replyToId?: string;
  /** Step the action was taken on; absent for instance-level events. */
  stepInstanceId?: string;
  /**
   * Key of the request that produced this entry. Carried so the audit row in
   * procedure_schema.actions can be rebuilt with its original key.
   */
  idempotencyKey?: string;
}

/**
 * One person handing their claim on a step to another.
 *
 * `roles` is captured at delegation time from the delegator's own matches. The
 * delegator's org units are known then but not later, so resolving the inherited
 * roles lazily would be impossible.
 */
export interface ProcedureDelegation {
  id: string;
  /** Limits the delegation to one step; absent means the whole instance. */
  stepInstanceId?: string;
  delegatedBy: string;
  delegatedByName: string;
  delegatedTo: string;
  roles: ProcedureRaciRole[];
  reason?: string;
  createdAt: string;
}

export interface CreateProcedureDelegationRequest {
  delegatedTo: string;
  stepInstanceId?: string;
  reason?: string;
}

export interface ProcedureRuntimeAuthorization {
  myRoles: ProcedureRaciRole[];
  currentRoleStage: ProcedureRaciRole | null;
  availableActions: ProcedureRuntimeAction[];
  canManageSubtasks: boolean;
  isOverride: boolean;
  /** True when the actor's roles come from a delegation rather than an assignment. */
  isDelegated?: boolean;
  /**
   * True when the actor holds the role only because the assigned unit has no
   * head and responsibility rose to theirs. Worth surfacing: they are acting for
   * another unit, not their own.
   */
  isEscalated?: boolean;
  /**
   * Đầu việc E(x) mà chính người này được phân công. Người thực hiện không giữ
   * vai trò RACI nào, nên nếu không có danh sách này họ sẽ không biết phần việc
   * nào là của mình.
   */
  mySubtaskIds?: readonly string[];
  /**
   * Được đọc dòng trao đổi và danh sách tệp của hồ sơ. Đúng bằng "có mặt trong
   * hồ sơ" — rộng hơn quyền hành động, vì vai trò I hay người nhận đầu việc E(x)
   * vẫn phải theo dõi được.
   */
  canReadFeed?: boolean;
  /** Được gửi trao đổi mới. Hồ sơ đã đóng thì chỉ đọc. */
  canComment?: boolean;
  /** Khoá thuộc tính người này được nhập ngay lúc này (xem `attributeValues`). */
  editableAttributeKeys?: string[];
  /** Id bước (step instance) trên đường đã đi mà người này được chọn để trả về. */
  returnTargetStepIds?: string[];
}

export interface PostProcedureCommentRequest {
  readonly body: string;
  readonly idempotencyKey: string;
  /** Id người được nhắc tên; client tự phân giải từ nội dung. */
  readonly mentions?: readonly string[];
  /** Trả lời một trao đổi đã có. Id không tồn tại thì bị bỏ qua, không chặn gửi. */
  readonly replyToId?: string;
}

export interface ProcedureInstance {
  id: string;
  code: string;
  title: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  definitionVersion: number;
  status: ProcedureInstanceStatus;
  currentStepId?: string;
  initiatedBy: string;
  /** Where this instance came from; 'manual' when a user started it directly. */
  sourceType?: ProcedureInstanceSourceType;
  /** Id of the originating record, e.g. a maintenance occurrence. */
  sourceId?: string;
  /** Liên kết với một công việc trong dự án Workspace, nếu hồ sơ được mở kèm dự án. */
  workspaceLink?: ProcedureWorkspaceLink;
  /** Thiết bị hồ sơ gắn vào; đầu việc của vai E được nạp theo thiết bị này. */
  assetCode?: string;
  /** Thời gian bắt đầu và kết thúc theo kế hoạch (Thông tin chung) */
  startDueAt?: string;
  endDueAt?: string;
  isHourlyScheduling?: boolean;
  managerId?: string;
  managerName?: string;
  observerIds?: string[];
  observerNames?: string[];
  startedAt: string;
  completedAt?: string;
  /** Có khi hồ sơ bị huỷ hiệu lực (`status = 'reversed'`). */
  reversal?: ProcedureInstanceReversal;
  /** Hồ sơ này là hồ sơ điều chỉnh của một hồ sơ đã bị huỷ hiệu lực. */
  adjustmentOf?: { instanceId: string; instanceCode: string };
  steps: ProcedureInstanceStep[];
  activity: ProcedureActivity[];
  delegations?: ProcedureDelegation[];
  /** Role E decomposition of the current step's work. */
  subtasks?: ProcedureSubtask[];
  /** Các đơn vật tư đã mở từ hồ sơ này; dùng để chỉ đặt THÊM phần khai mới. */
  materialOrders?: ProcedureMaterialOrder[];
  /** Luật rẽ nhánh và thuộc tính quy trình, chụp lúc khởi tạo. Vắng mặt ở hồ sơ cũ = tuyến tính. */
  flow?: ProcedureFlowSnapshot;
  /** Chức danh của người khởi tạo lúc mở hồ sơ — gốc để tìm quản lý trực tiếp. */
  initiatorPositionId?: string;
  /** Khoá: 'process:<code>' hoặc 'step:<definitionStepId>:<code>'. */
  attributeValues?: Record<string, ProcedureAttributeValueRecord>;
  /** Đường đi thực tế; đoạn đã bị trả về qua vẫn nằm đây, đánh dấu supersededAt. */
  path?: ProcedurePathEntry[];
  decisions?: ProcedureGatewayDecision[];
  /** Server tính trên đường đi thực tế; client chỉ hiển thị. */
  progress?: ProcedureProgress;
  authorization?: ProcedureRuntimeAuthorization;
}

export interface ProcedureWorkspacePermissions {
  canManageDefinitions: boolean;
  canPublishDefinitions: boolean;
  canCreateInstances: boolean;
  canOverrideActions: boolean;
}

export interface ProcedureWorkspace {
  tenantId: string;
  actor: {
    id: string;
    name: string;
  };
  permissions: ProcedureWorkspacePermissions;
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
}

export interface CreateProcedureRaciAssignmentInput {
  role: ProcedureRaciRole;
  subjectType: ProcedureSubjectType;
  subjectId: string;
  subjectLabel?: string;
  fixedRollbackStepId?: string;
  eTaskSource?: ETaskSource;
  eTaskConfig?: ProcedureETaskConfig;
  managerFallback?: ProcedureManagerFallback;
}

export interface CreateProcedureStepInput {
  key: string;
  order: number;
  name: string;
  description?: string;
  linkedDefinitionId?: string;
  slaHours?: number;
  /** Vật tư bước cần; tên và đơn vị sẽ được server điền lúc công bố. */
  materials?: ProcedureStepMaterial[];
  attributes?: ProcedureAttributeDefinition[];
  assignments: CreateProcedureRaciAssignmentInput[];
}

export interface CreateProcedureDefinitionRequest {
  code: string;
  name: string;
  description?: string;
  kind: ProcedureKind;
  /** Mã nhóm; có thể để trống lúc tạo nháp, nhưng phải có trước khi công bố. */
  category?: string;
  steps: CreateProcedureStepInput[];
  attributes?: ProcedureAttributeDefinition[];
  /**
   * Lúc TẠO MỚI bước chưa có id, nên gateway được phép tham chiếu bước bằng
   * `key`; server đổi sang id khi lưu.
   */
  gateways?: ProcedureGatewayDefinition[];
}

/**
 * Thay toàn bộ nội dung một bản nháp. Ma trận RCSI lưu theo kiểu thay-cả-bản-nháp
 * thay vì vá từng ô, để mọi ràng buộc (1 C/bước, E phải có C…) luôn được kiểm
 * trên trạng thái đầy đủ chứ không trên một ô rời rạc.
 */
export interface UpdateProcedureDefinitionRequest {
  name?: string;
  description?: string;
  kind?: ProcedureKind;
  category?: string;
  steps: CreateProcedureStepInput[];
  /** Bỏ trống = giữ nguyên; client cũ không biết trường này thì không làm mất nó. */
  attributes?: ProcedureAttributeDefinition[];
  /**
   * Bỏ trống = giữ nguyên; `[]` = xoá hết điểm rẽ nhánh. Tham chiếu bước bằng id
   * hoặc bằng `key` (cho bước vừa thêm, chưa có id).
   */
  gateways?: ProcedureGatewayDefinition[];
}

export interface StartProcedureInstanceRequest {
  definitionId: string;
  title: string;
  /** Thiết bị hồ sơ gắn vào, khi người mở chọn một thiết bị cụ thể. */
  assetCode?: string;
  /** Thời gian bắt đầu và kết thúc theo kế hoạch (Thông tin chung) */
  startDueAt?: string;
  endDueAt?: string;
  isHourlyScheduling?: boolean;
  managerId?: string;
  managerName?: string;
  observerIds?: string[];
  observerNames?: string[];
  /** Giá trị thuộc tính cấp quy trình, nhập ngay lúc mở hồ sơ. Khoá là mã thuộc tính. */
  processAttributeValues?: Record<string, ProcedureAttributeValue>;
  /** Initial process/current-step values, using canonical process:/step: keys. */
  attributeValues?: Record<string, ProcedureAttributeValue>;
  /** Reject stale queued submissions rather than silently changing their flow. */
  expectedDefinitionSnapshot?: ProcedureDefinition;
  /** Chức danh người mở chọn khi họ kiêm nhiều chức danh; bỏ trống = chức danh chính. */
  initiatorPositionId?: string;
  idempotencyKey: string;
  /** Set by service callers; a user-started instance is 'manual'. */
  sourceType?: ProcedureInstanceSourceType;
  sourceId?: string;
  initiatedBy?: string;
  initiatedByName?: string;
  /** Chỉ dịch vụ nội bộ (sourceType 'hrm_request'): xem CreateProcedureInstanceRequest. */
  autoCompleteInitiatorStep?: boolean;
  /**
   * Gắn hồ sơ vào một dự án Workspace: hồ sơ mở ngay, còn công việc tương ứng
   * do Workspace tự tạo khi nhận sự kiện, rồi báo mã công việc về.
   */
  workspaceLink?: {
    projectId: string;
    projectCode: string;
    workItem?: ProcedureWorkspaceWorkItemDraft;
  };
  /** Mở hồ sơ điều chỉnh cho một hồ sơ đã bị huỷ hiệu lực. */
  adjustmentOfInstanceId?: string;
}

/** Huỷ hiệu lực một hồ sơ đã hoàn thành (chỉ admin). */
export interface ReverseProcedureInstanceRequest {
  reason: string;
  /** Báo người giữ vai S lập hồ sơ điều chỉnh, form điền sẵn từ hồ sơ này. */
  createAdjustment: boolean;
}

/** Phát khi một hồ sơ đã hoàn thành bị huỷ hiệu lực; module liên kết tự hoàn tác. */
export const PROCEDURE_INSTANCE_REVERSED = 'procedure.instance.reversed';
/** Phát khi admin yêu cầu lập hồ sơ điều chỉnh; gửi tới người giữ vai S. */
export const PROCEDURE_INSTANCE_ADJUSTMENT_REQUESTED = 'procedure.instance.adjustment_requested';

export interface ProcedureInstanceReversedPayload {
  instanceId: string;
  instanceCode: string;
  title: string;
  definitionId: string;
  sourceType?: ProcedureInstanceSourceType;
  sourceId?: string;
  /** Công việc Workspace liên kết, nếu có. */
  workItemId?: string;
  projectId?: string;
  reason: string;
  reversedBy: string;
  reversedByName?: string;
  adjustmentRequested: boolean;
}

export interface ApplyProcedureActionRequest {
  action: ProcedureRuntimeAction;
  comment?: string;
  idempotencyKey: string;
  /**
   * Bước muốn trả về, chỉ dùng với hành động `return`.
   *
   * Vai trò A là người phê duyệt cuối nên được chọn đúng bước cần làm lại. Vai
   * trò C thì không: điểm quay về của C đã được cấu hình từ lúc thiết kế
   * (`fixedRollbackStepId`), đó chính là ý nghĩa của ký hiệu C(x).
   */
  returnToStepId?: string;
  /**
   * Giá trị thuộc tính nhập cùng lúc với hành động — ghi và đánh giá rẽ nhánh
   * trong cùng một transaction. Khoá theo `ProcedureInstance.attributeValues`.
   */
  attributeValues?: Record<string, ProcedureAttributeValue>;
}

export interface SaveProcedureAttributeValuesRequest {
  readonly values: Record<string, ProcedureAttributeValue>;
  readonly idempotencyKey: string;
}

export interface ProcedureAttachment {
  readonly id: string;
  readonly instanceId: string;
  readonly stepInstanceId?: string;
  /** Đính kèm là bằng chứng của một đầu việc E(x) cụ thể. */
  readonly subtaskId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly downloadUrl?: string;
}

/**
 * Định dạng tệp đính kèm được phép (AC-ATT-08).
 *
 * Kiểm cả đuôi tên tệp lẫn content-type và bắt hai thứ phải khớp nhau. Lưu ý
 * `sizeBytes` là do client khai và KHÔNG kiểm chứng được ở đây: URL ký trước chỉ
 * ghim Bucket/Key/ContentType, không ghim độ dài. Giới hạn 50MB vì vậy là rào
 * thiện chí, không phải rào an ninh.
 */
export const PROCEDURE_ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  // Bảng kê vật tư do hệ thống sinh ra khi mở đơn kho; mở thẳng bằng Excel.
  csv: 'text/csv',
};

export const PROCEDURE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

export interface CreateProcedureAttachmentRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly stepInstanceId?: string;
  readonly subtaskId?: string;
}

export interface CreateProcedureAttachmentResponse {
  readonly attachment: ProcedureAttachment;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

/**
 * Cách chạy các đầu việc do vai trò E phân rã.
 *
 * `parallel` — ai làm trước cũng được, đây là hành vi mặc định và là hành vi duy
 * nhất tồn tại trước 19/08, nên hồ sơ đang chạy không đổi cách hoạt động.
 * `sequential` — chủ E xếp thứ tự, đầu việc thứ N chỉ mở khi N−1 đã xong.
 */
export type ProcedureSubtaskExecutionMode = 'parallel' | 'sequential';

export interface ProcedureSubtask {
  readonly id: string;
  readonly instanceId: string;
  readonly stepInstanceId?: string;
  readonly title: string;
  /** Vị trí trong chuỗi, bắt đầu từ 1. Chỉ có nghĩa khi bước chạy tuần tự. */
  readonly order: number;
  /** Người trong đơn vị được vai trò E phân công thực hiện đầu việc này. */
  readonly assigneeId?: string;
  /** Tên chụp lại lúc gán, để hiển thị không phải tra lại Core. */
  readonly assigneeName?: string;
  readonly weight: number;
  readonly status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  readonly dueAt?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  /**
   * Vật tư cần cho riêng đầu việc này.
   *
   * Khác `ProcedureStepMaterial` ở chỗ chọn LÚC CHẠY chứ không lúc thiết kế:
   * người giữ vai E khi phân rã công việc mới biết từng đầu việc cần gì. Cùng
   * hình dạng nên tái dùng luôn kiểu, kể cả luật đóng băng `materialName`/`unit`.
   */
  readonly materials?: readonly ProcedureStepMaterial[];
}

export interface ProcedureSubtaskInput {
  readonly title: string;
  /** Share of the step's work, in percent. The set must total 100. */
  readonly weight: number;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
  readonly dueAt?: string;
  /**
   * Chỉ cần `materialCode` và `quantity`; tên và đơn vị được tra từ Kho lúc lưu
   * chứ không tin theo client — client cũ có thể gửi tên đã lỗi thời.
   */
  readonly materials?: readonly ProcedureStepMaterial[];
}

/**
 * Xin vật tư.
 *
 * Hai đường vào, dùng đúng một đường mỗi lần:
 *  - `subtaskId`: vai E xin cho một đầu việc đã phân rã, vật tư lấy từ đầu việc.
 *  - `materials`: chủ vai BẤT KỲ xin cho bước hiện tại của mình, không cần có
 *    đầu việc nào — vai R, C, A cũng cần dụng cụ để làm phần việc của họ.
 *
 * Người bấm luôn tự chọn quy trình mượn/xuất và mua. Cố ý KHÔNG lấy từ cấu hình
 * tenant: mỗi lần xin là một tình huống khác nhau, và một mặc định đặt sẵn sẽ
 * âm thầm mở nhầm thủ tục khi tình huống đổi.
 *
 * Vẫn KHÔNG có trường chọn "mượn hay mua": quyết định đó thuộc về tồn kho thật
 * tại thời điểm bấm nên server tự tính.
 */
export interface RequestProcedureMaterialsRequest {
  readonly subtaskId?: string;
  readonly materials?: readonly ProcedureStepMaterial[];
  readonly issueDefinitionId?: string;
  readonly purchaseDefinitionId?: string;
}

export type ProcedureMaterialRequestKind = 'issue' | 'purchase';

/**
 * Một hồ sơ vừa được mở để xin vật tư.
 *
 * `lines` chụp lại con số tại thời điểm bấm — đây là cơ sở để người duyệt sau đó
 * hiểu vì sao hồ sơ này được mở, kể cả khi tồn đã đổi.
 */
export interface ProcedureMaterialRequestResult {
  readonly kind: ProcedureMaterialRequestKind;
  readonly instanceId: string;
  readonly code: string;
  readonly definitionName: string;
  readonly lines: readonly ProcedureStepMaterialCheckLine[];
}

export interface RequestProcedureMaterialsResponse {
  readonly opened: readonly ProcedureMaterialRequestResult[];
  /** Hồ sơ cha sau khi đã ghi nhật ký, để client vẽ lại ngay. */
  readonly instance: ProcedureInstance;
}

export interface SetProcedureSubtasksRequest {
  /** Omit to seed from the frozen taskTemplate on the step's Role E assignment. */
  readonly items?: readonly ProcedureSubtaskInput[];
  /** Bỏ trống giữ nguyên chế độ đang có của bước; lần đầu phân rã mặc định 'parallel'. */
  readonly executionMode?: ProcedureSubtaskExecutionMode;
}

export type ProcedureInstanceSourceType =
  | 'hrm_request'
  | 'manual'
  | 'maintenance_occurrence'
  | 'auto_from_parent'
  /** Mở theo yêu cầu của một công việc "Theo quy trình" bên Workspace. */
  | 'workspace_work_item';

/**
 * Các trường của công việc sẽ được Workspace tạo khi hồ sơ gắn một dự án.
 *
 * Quy trình chỉ chuyển nguyên các trường này sang Workspace qua sự kiện; nó
 * không kiểm, không ghi gì vào dữ liệu của Workspace.
 */
export interface ProcedureWorkspaceWorkItemDraft {
  itemType?: 'task' | 'milestone';
  description?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assigneeUserId?: string;
  plannedStart?: string;
  plannedEnd?: string;
  estimateHours?: number;
  estimatedCost?: number;
}

/**
 * Liên kết hồ sơ ↔ công việc trong một dự án Workspace.
 *
 * `pending`: đã gửi yêu cầu, chờ Workspace tạo công việc. `linked`: Workspace
 * đã tạo và trả mã công việc; tên hồ sơ đã gắn mã. `rejected`: Workspace từ
 * chối (thiếu quyền, dự án đóng…), hồ sơ vẫn chạy bình thường.
 */
export interface ProcedureWorkspaceLink {
  status: 'pending' | 'linked' | 'rejected';
  projectId: string;
  projectCode: string;
  /** Tên người dùng nhập — cũng là tên công việc bên Workspace. */
  baseTitle: string;
  workItem: ProcedureWorkspaceWorkItemDraft;
  requestedBy: string;
  /** Người yêu cầu là quản trị tenant lúc mở hồ sơ; Workspace bỏ qua kiểm thành viên dự án. */
  requestedByIsTenantAdmin?: boolean;
  requestedAt: string;
  workItemId?: string;
  workItemCode?: string;
  error?: string;
  resolvedAt?: string;
  /** Hồ sơ điều chỉnh: công việc mới là công việc điều chỉnh của công việc đã huỷ hiệu lực này. */
  adjustmentOfWorkItemId?: string;
}

/**
 * Actor recorded as initiator when a service, not a person, starts an instance.
 * instances.initiated_by is a uuid column, so service callers need a real id.
 */
export const PROCEDURE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export interface CreateProcedureInstanceRequest {
  readonly definitionId: string;
  readonly attributeValues?: Record<string, ProcedureAttributeValue>;
  readonly expectedDefinitionSnapshot?: ProcedureDefinition;
  readonly title?: string;
  readonly sourceType?: ProcedureInstanceSourceType;
  readonly sourceId?: string;
  /**
   * Thiết bị mà hồ sơ này gắn vào, lấy từ Kho.
   *
   * Bắt buộc phải mang theo, không suy ra từ định nghĩa: mã thiết bị trong
   * `eTaskConfig` được đóng băng lúc CÔNG BỐ, nên mọi work order sinh từ một quy
   * trình đều trỏ về đúng một thiết bị. Có trường này thì phiếu bảo trì cho máy
   * T2 mới nạp được đầu việc của T2 thay vì của T1.
   */
  readonly assetCode?: string;
  readonly idempotencyKey?: string;
  readonly initiatedBy?: string;
  readonly initiatedByName?: string;
  /**
   * Tự hoàn thành bước S của người khởi tạo ngay trong giao dịch tạo hồ sơ.
   * Chỉ nhận khi `sourceType = 'hrm_request'` và gọi bằng service token. Không đủ
   * điều kiện (bước đầu không chỉ có vai S, người khởi tạo không khớp phân công S)
   * thì bỏ qua, hồ sơ nằm ở bước đầu và kết quả có cảnh báo.
   */
  readonly autoCompleteInitiatorStep?: boolean;
}

export interface CreateProcedureInstanceResponse {
  readonly id: string;
  readonly code: string;
  readonly status?: string;
  readonly currentStepId?: string;
  readonly currentStepName?: string;
  readonly currentRoleStage?: ProcedureRaciRole | null;
  /** Tên người/đơn vị/chức danh đang được giao ở pha hiện tại (nếu có). */
  readonly currentAssigneeName?: string;
  /** Số thứ tự tiến độ của hồ sơ (cùng nghĩa với sequence của step_changed). */
  readonly sequence?: number;
  /** Kết quả tự hoàn thành bước S; vắng mặt khi không yêu cầu. */
  readonly autoComplete?: {
    readonly status: 'completed' | 'skipped';
    readonly warning?: string;
  };
  readonly warnings?: readonly string[];
}

/** Tiến độ một hồ sơ, trả cho module khác qua API nội bộ (không đọc DB của Procedure). */
export interface ProcedureInstanceProgress {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly status: ProcedureInstance['status'];
  readonly currentStepId?: string;
  readonly currentStepName?: string;
  /** Nhãn người/đơn vị/chức danh đang được giao ở pha hiện tại. */
  readonly currentAssigneeName?: string;
  readonly completedAt?: string;
  /** Có khi bên gọi truyền actorUserId: người này đang được giao bước hiện tại (duyệt/hoàn thành/trả lại). */
  readonly canAct?: boolean;
  readonly steps: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: ProcedureInstanceStepStatus;
    readonly order: number;
    readonly currentRoleStage: ProcedureRaciRole | null;
    readonly slaHours?: number;
    readonly slaDueAt?: string;
    readonly completedAt?: string;
    readonly roleTitle: string;
  }[];
  readonly activity: ProcedureInstance['activity'];
}

/** Một dòng đối soát: trạng thái và bước hiện tại của hồ sơ. */
export interface ProcedureInstanceStatusEntry {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly status: ProcedureInstance['status'];
  readonly currentStepId?: string;
  readonly currentStepName?: string;
  readonly currentAssigneeName?: string;
  readonly completedAt?: string;
  /** Người thực hiện hành động gần nhất (nhật ký mới nhất). */
  readonly lastActorId?: string;
  /** Số thứ tự tăng dần theo hồ sơ, cùng nghĩa với `sequence` của sự kiện step_changed. */
  readonly sequence: number;
}

/** Payload sự kiện `procedure.instance.step_changed`. */
export interface ProcedureInstanceStepChangedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly stepId?: string;
  readonly stepName?: string;
  readonly assignees: readonly string[];
  readonly status: ProcedureInstance['status'];
  readonly sequence: number;
  readonly occurredAt: string;
}

export interface ProcedureApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export const PROCEDURE_PERMISSIONS = [
  'procedure.access',
  'procedure.definition.view',
  'procedure.definition.manage',
  'procedure.definition.publish',
  'procedure.instance.view',
  'procedure.instance.create',
  'procedure.instance.action',
  'procedure.execution.manage',
  'procedure.execution.submit',
  'procedure.request.create',
  'procedure.request.triage',
] as const;

export type ProcedurePermission = (typeof PROCEDURE_PERMISSIONS)[number];

// ---------------------------------------------------------------- Cấu hình module

/**
 * Khoá cấu hình của module Quy trình.
 *
 * Union đóng, cùng lý do với Kho và Bảo trì: bảng lưu là khoá–giá trị nên đây
 * là lớp chặn duy nhất giữ nó không trôi thành kho dữ liệu tự do.
 */
export const PROCEDURE_SETTINGS_KEYS = [
  'dashboard.cards',
  'catalog.group',
] as const;

export type ProcedureSettingsKey = (typeof PROCEDURE_SETTINGS_KEYS)[number];

/** Danh sách id thẻ dashboard admin đã chọn. Thứ tự trong mảng là thứ tự hiển thị. */
export interface ProcedureDashboardCardSelection {
  readonly cardIds: readonly string[];
}

export interface ProcedureGroupOption {
  readonly code: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/**
 * Danh mục nhóm quy trình.
 *
 * `autoAssignEnabled` là công tắc cho việc tự gán nhóm; tắt đi thì admin tự
 * chọn nhóm cho từng quy trình.
 */
export interface ProcedureGroupCatalog {
  readonly options: readonly ProcedureGroupOption[];
  readonly autoAssignEnabled: boolean;
}

export interface ProcedureSettings {
  readonly 'dashboard.cards': ProcedureDashboardCardSelection;
  readonly 'catalog.group': ProcedureGroupCatalog;
}

export interface ProcedureSettingsEntry<TValue> {
  readonly key: string;
  readonly value: TValue;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Đọc cả module: mọi khoá đều có mặt, khoá thiếu dòng được điền mặc định. */
export type ProcedureSettingsSnapshot = {
  readonly [K in ProcedureSettingsKey]: ProcedureSettingsEntry<
    ProcedureSettings[K]
  >;
};

export interface UpdateProcedureSettingsRequest<TValue> {
  readonly value: TValue;
  /** Version đã đọc; lệch thì trả 409. Bỏ trống là ghi đè bất chấp. */
  readonly expectedVersion?: number;
}
