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

export type ProcedureSubjectType = 'organization_unit' | 'position' | 'user';

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
export interface ProcedureStepMaterialCheck {
  readonly state: 'ok' | 'short';
  readonly checkedAt: string;
  readonly lines: readonly {
    readonly materialCode: string;
    readonly materialName?: string;
    readonly unit?: string;
    readonly required: number;
    readonly available: number;
    readonly short: number;
  }[];
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
  assignments: ProcedureRaciAssignment[];
}

export interface ProcedureDefinition {
  id: string;
  code: string;
  name: string;
  description?: string;
  kind: ProcedureKind;
  status: ProcedureDefinitionStatus;
  versionNumber: number;
  steps: ProcedureStepDefinition[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export type ProcedureInstanceStatus =
  | 'running'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type ProcedureInstanceStepStatus =
  | 'pending'
  | 'active'
  | 'ready'
  | 'completed'
  | 'returned'
  | 'rejected'
  | 'cancelled';

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
}

export interface ProcedureActivity {
  id: string;
  action: ProcedureRuntimeAction | 'start' | 'publish';
  actorId: string;
  actorName: string;
  summary: string;
  comment?: string;
  createdAt: string;
  /** Người được nhắc tên trong nội dung. Chỉ để tô đậm khi hiển thị — không gửi thông báo. */
  mentions?: string[];
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
}

export interface PostProcedureCommentRequest {
  readonly body: string;
  readonly idempotencyKey: string;
  /** Id người được nhắc tên; client tự phân giải từ nội dung. */
  readonly mentions?: readonly string[];
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
  startedAt: string;
  completedAt?: string;
  steps: ProcedureInstanceStep[];
  activity: ProcedureActivity[];
  delegations?: ProcedureDelegation[];
  /** Role E decomposition of the current step's work. */
  subtasks?: ProcedureSubtask[];
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
  assignments: CreateProcedureRaciAssignmentInput[];
}

export interface CreateProcedureDefinitionRequest {
  code: string;
  name: string;
  description?: string;
  kind: ProcedureKind;
  steps: CreateProcedureStepInput[];
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
  steps: CreateProcedureStepInput[];
}

export interface StartProcedureInstanceRequest {
  definitionId: string;
  title: string;
  idempotencyKey: string;
  /** Set by service callers; a user-started instance is 'manual'. */
  sourceType?: ProcedureInstanceSourceType;
  sourceId?: string;
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
}

export interface ProcedureSubtaskInput {
  readonly title: string;
  /** Share of the step's work, in percent. The set must total 100. */
  readonly weight: number;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
  readonly dueAt?: string;
}

export interface SetProcedureSubtasksRequest {
  /** Omit to seed from the frozen taskTemplate on the step's Role E assignment. */
  readonly items?: readonly ProcedureSubtaskInput[];
  /** Bỏ trống giữ nguyên chế độ đang có của bước; lần đầu phân rã mặc định 'parallel'. */
  readonly executionMode?: ProcedureSubtaskExecutionMode;
}

export type ProcedureInstanceSourceType =
  | 'manual'
  | 'maintenance_occurrence'
  | 'auto_from_parent';

/**
 * Actor recorded as initiator when a service, not a person, starts an instance.
 * instances.initiated_by is a uuid column, so service callers need a real id.
 */
export const PROCEDURE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export interface CreateProcedureInstanceRequest {
  readonly definitionId: string;
  readonly title?: string;
  readonly sourceType?: ProcedureInstanceSourceType;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
}

export interface CreateProcedureInstanceResponse {
  readonly instance: {
    readonly id: string;
    readonly code: string;
    readonly status: ProcedureInstanceStatus;
  };
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
