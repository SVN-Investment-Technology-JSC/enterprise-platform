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

export interface ProcedureStepDefinition {
  id: string;
  key: string;
  order: number;
  name: string;
  description?: string;
  linkedDefinitionId?: string;
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
  startedAt?: string;
  completedAt?: string;
}

export interface ProcedureActivity {
  id: string;
  action: ProcedureRuntimeAction | 'start' | 'publish';
  actorId: string;
  actorName: string;
  summary: string;
  comment?: string;
  createdAt: string;
}

export interface ProcedureRuntimeAuthorization {
  myRoles: ProcedureRaciRole[];
  currentRoleStage: ProcedureRaciRole | null;
  availableActions: ProcedureRuntimeAction[];
  canManageSubtasks: boolean;
  isOverride: boolean;
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
  assignments: CreateProcedureRaciAssignmentInput[];
}

export interface CreateProcedureDefinitionRequest {
  code: string;
  name: string;
  description?: string;
  kind: ProcedureKind;
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
}

export interface ProcedureAttachment {
  readonly id: string;
  readonly instanceId: string;
  readonly stepInstanceId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly downloadUrl?: string;
}

export interface CreateProcedureAttachmentRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly stepInstanceId?: string;
}

export interface CreateProcedureAttachmentResponse {
  readonly attachment: ProcedureAttachment;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface ProcedureSubtask {
  readonly id: string;
  readonly instanceId: string;
  readonly stepInstanceId?: string;
  readonly title: string;
  readonly assigneeId?: string;
  readonly weight: number;
  readonly status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  readonly dueAt?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
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
