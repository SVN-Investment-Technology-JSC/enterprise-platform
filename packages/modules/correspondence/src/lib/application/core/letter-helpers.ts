import {
  APPROVER_RULE_LABELS,
  ASSIGNMENT_ROLE_LABELS,
  ATTACHMENT_KIND_LABELS,
  CORRESPONDENCE_ATTACHMENT_MAX_BYTES,
  FLOW_END_NAMES,
  FLOW_START_NAMES,
  numberFormatError,
  stepApplies,
  LETTER_STAGE_LABELS,
  OPEN_LETTER_STAGES,
  type ApproverRule,
  type AttachmentKind,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceSettings,
  type FlowNode,
  type LetterHistoryEntry,
  type LetterAttachment,
  type LetterCondition,
  type LetterDirection,
  type LetterStage,
  type LetterStepStatus,
  type LetterSummary,
  type StepType,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import {
  addDays,
  awaitsViewer,
  canRespondFor,
  letterActions,
  type LetterFacts,
  type LetterViewer,
} from '../../domain/letter-rules.js';
import { memberUnits, type OrganizationSnapshot } from '../../domain/organization.js';
import {
  type AssignmentRecord,
  type AttachmentRecord,
  type LetterListRow,
  type LetterRecord,
  type LetterTransaction,
  type StepRecord,
} from '../ports.js';

/**
 * Hằng số, kiểu và hàm thuần dùng chung cho mọi phần của Văn thư: không đọc ghi gì, không
 * phụ thuộc hạ tầng. Tách nguyên văn từ `CorrespondenceService` cũ.
 */
export const LIST_LIMIT = 500;
export const OVERVIEW_LIMIT = 2000;
export const REPORT_LIMIT = 10000;
export const MAX_UNITS_PER_LETTER = 30;
export const MAX_MENTIONS = 20;
/** Tên thư mục gốc của Văn thư trong kho tài liệu của Hệ dùng chung. */
export const CORRESPONDENCE_FILING_ROOT = 'Văn thư';
export const FOLDER_BY_DIRECTION: Readonly<Record<LetterDirection, string>> = { incoming: 'Công văn đến', outgoing: 'Công văn đi' };
export const DRAFT_SUFFIX = 'DT';
/** Bước công văn chưa chép quy trình: thanh tiến trình vẽ theo quy trình sẽ áp dụng. */
/** Công văn còn ở ô đầu: chưa chép bước, thanh tiến trình vẽ theo quy trình sẽ áp dụng. */
export const PLANNING_STAGES: readonly LetterStage[] = ['received', 'drafting'];
/** "Cần tôi xử lý": các bước còn mở và đề nghị huỷ đang chờ xác nhận. */
export const AWAITING_STAGES: readonly LetterStage[] = [...OPEN_LETTER_STAGES, 'revoking'];
/** Kho lưu trữ: đã lưu trữ, kể cả đang chờ xác nhận huỷ. */
export const ARCHIVE_STAGES: readonly LetterStage[] = ['archived', 'revoking'];
export const ROUTE_PERMISSIONS = {
  register: 'correspondence.letter.register',
  publish: 'correspondence.letter.publish',
  archive: 'correspondence.letter.archive',
} as const;

export type Catalog = ReadonlyMap<CatalogKind, ReadonlyMap<string, CatalogItem>>;
export type Row = LetterRecord & {
  readonly replied?: boolean;
  readonly steps: LetterListRow['steps'];
  readonly assignments: LetterListRow['assignments'];
  readonly mentionedUserIds: readonly string[];
};
export type Loaded = {
  readonly letter: LetterRecord;
  readonly steps: StepRecord[];
  readonly assignments: AssignmentRecord[];
  readonly row: Row;
};



/* ---------------------------------------------------------------- hàm thuần */

/** Đầu vào khi chuyển sang bước kế tiếp. */
export interface AdvanceInput {
  /** Phòng ban cho bước phòng ban xử lý (dạng thô từ yêu cầu, kiểm ở `dispatchUnits`). */
  readonly units?: unknown;
  /** Người được chọn cho bước duyệt kế tiếp (luật "chọn trong nhóm"). */
  readonly chosen?: string;
  /** Ghi chú, chỉ đạo kèm khi giao phòng ban. */
  readonly note?: string;
  /** Thời hạn hoàn thành khi giao phòng ban. */
  readonly dueOn?: unknown;
  /** Chuyển từ ô đầu (giao lại từ đầu). */
  readonly restart?: boolean;
}

export interface FlowStep {
  readonly seq: number;
  readonly name: string;
  readonly kind: StepType;
  readonly approver?: ApproverRule;
  readonly status: LetterStepStatus;
  readonly assigneeUserIds: readonly string[];
  readonly chosenUserId?: string;
  readonly actedBy?: string;
  readonly actedAt?: string;
}

/** Ký hiệu đơn vị trong số văn bản: mỗi đơn vị một ký hiệu, tối đa 20 ký tự. */
export function unitCodeList(raw: unknown): { unitId: string; code: string }[] {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length > 500) throw new CorrespondenceValidationError('Tối đa 500 ký hiệu đơn vị.');
  const seen = new Set<string>();
  return items.flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>;
    const unitId = String(value['unitId'] ?? '').trim();
    const code = String(value['code'] ?? '').trim();
    if (!unitId || !code || seen.has(unitId)) return [];
    if (code.length > 20) throw new CorrespondenceValidationError(`Ký hiệu đơn vị "${code}" dài quá 20 ký tự.`);
    seen.add(unitId);
    return [{ unitId, code }];
  });
}

/** Mẫu số riêng của loại văn bản: trống là theo sổ. */
export function optionalNumberFormat(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const error = numberFormatError(value);
  if (error) throw new CorrespondenceValidationError(error);
  return value;
}

/**
 * Phòng phải gửi kết quả thì bước phòng ban xử lý mới xong: phòng nhận để biết không tính; bước "phòng
 * chủ trì gửi là xong" chỉ tính phòng chủ trì (không có phòng chủ trì thì tính mọi phòng).
 */
export function blockingAssignments<T extends Pick<AssignmentRecord, 'role'>>(assignments: readonly T[], step?: Pick<StepRecord, 'mode'>): T[] {
  const handling = assignments.filter((item) => item.role !== 'info');
  const leads = handling.filter((item) => item.role === 'lead');
  return step?.mode === 'lead' && leads.length > 0 ? leads : handling;
}

/** Số mục điều kiện đặt: quy trình đặt nhiều điều kiện hơn là cụ thể hơn. */
export function conditionWeight(condition: LetterCondition | undefined): number {
  return [condition?.kinds, condition?.urgency, condition?.confidentiality].filter((values) => (values?.length ?? 0) > 0).length;
}

/** Bước của quy trình áp dụng cho công văn (bỏ bước có điều kiện không khớp). */
export function applicableSteps(
  workflow: Pick<Workflow, 'steps'>,
  letter: Pick<LetterRecord, 'kind' | 'urgency' | 'confidentiality'>,
): WorkflowStep[] {
  return workflow.steps.filter((step) => stepApplies(step, letter));
}

export function txRow(tx: LetterTransaction): Row {
  return { ...tx.letter, steps: tx.steps, assignments: tx.assignments, mentionedUserIds: tx.mentionedUserIds };
}

export function facts(row: Row, catalog: Catalog): LetterFacts {
  return {
    direction: row.direction,
    stage: row.stage,
    receivedBy: row.receivedBy,
    authorUserId: row.authorUserId,
    authorUnitId: row.authorUnitId,
    restricted: Boolean(catalog.get('confidentiality')?.get(row.confidentiality)?.restricted),
    steps: row.steps.map((step) => ({
      ...step,
      ownActors: 'ownActors' in step ? step.ownActors : step.kind === 'check' && Boolean((step as StepRecord).approver),
    })),
    assignments: row.assignments,
    mentionedUserIds: row.mentionedUserIds,
    revokeRequestedBy: row.revokeRequestedBy,
    revokeApproverIds: row.revokeApproverIds ?? [],
    addressedUserId: row.addressedUserId,
    closerIds: row.closerIds ?? [],
    personal: row.personal === true,
    sentAs: row.sentAs,
  };
}

/** Phòng ban xử lý (công văn đến) hay phòng ban soạn thảo (công văn đi): dùng cho luật "trưởng phòng ban xử lý". */
export function handlingUnits(letter: Pick<LetterRecord, 'direction' | 'authorUnitId'>, assignments: readonly Pick<AssignmentRecord, 'unitId'>[]): string[] {
  if (letter.direction === 'incoming') return assignments.map((item) => item.unitId);
  return letter.authorUnitId ? [letter.authorUnitId] : [];
}

/**
 * Tệp được thêm theo loại ở bước hiện tại; kết quả xử lý của công văn đến phải gắn với một
 * phòng ban người đó gửi kết quả được.
 */
export function attachTarget(
  viewer: LetterViewer,
  letterFacts: LetterFacts,
  assignments: readonly AssignmentRecord[],
  kind: AttachmentKind,
  assignmentId: string | undefined,
): AssignmentRecord | undefined {
  if (!letterActions(viewer, letterFacts).attachKinds.includes(kind)) {
    throw new CorrespondenceForbiddenError(`Bạn không đính kèm được ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()} ở bước này.`);
  }
  if (kind !== 'draft' || letterFacts.direction === 'outgoing') return undefined;
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment || !canRespondFor(viewer, letterFacts, assignment)) {
    throw new CorrespondenceValidationError('Chọn phòng ban gửi kết quả trong số phòng ban bạn xử lý.');
  }
  return assignment;
}

/** Tải phiên bản mới: như quyền đính kèm loại tệp đó ở bước hiện tại. */
export function canAddVersion(
  viewer: LetterViewer,
  letterFacts: LetterFacts,
  attachment: Pick<AttachmentRecord, 'kind' | 'assignmentId'>,
  assignment: AssignmentRecord | undefined,
): boolean {
  if (!letterActions(viewer, letterFacts).attachKinds.includes(attachment.kind)) return false;
  if (attachment.kind !== 'draft' || letterFacts.direction === 'outgoing') return true;
  return Boolean(assignment && canRespondFor(viewer, letterFacts, assignment));
}

export function requireActive(tx: LetterTransaction): StepRecord {
  const step = tx.steps.find((item) => item.status === 'active');
  if (!step) throw new LetterStageConflictError();
  return step;
}

export function sortedSteps<T extends { readonly seq: number }>(steps: readonly T[]): T[] {
  return [...steps].sort((left, right) => left.seq - right.seq);
}

export function nextWaiting(tx: LetterTransaction, fromSeq: number): StepRecord | undefined {
  return sortedSteps(tx.steps).find((step) => step.seq > fromSeq && step.status === 'waiting');
}

/** Bước đã xong ngay trước `seq` (không có `seq` thì bước xong cuối cùng), có thể lọc theo loại. */
export function lastDoneBefore(tx: LetterTransaction, seq: number | undefined, kind?: StepType): StepRecord | undefined {
  return sortedSteps(tx.steps)
    .filter((step) => step.status === 'done' && (seq === undefined || step.seq < seq) && (!kind || step.kind === kind))
    .at(-1);
}

export function firstActive(catalog: Catalog, kind: CatalogKind): string {
  const item = [...(catalog.get(kind)?.values() ?? [])].filter((entry) => entry.isActive).sort((left, right) => left.sortOrder - right.sortOrder)[0];
  if (!item) throw new CorrespondenceValidationError('Danh mục chưa có mục nào đang dùng. Vào Cấu hình để thêm.');
  return item.code;
}

export function defaultDue(catalog: Catalog, settings: CorrespondenceSettings, kind: string, from: string): string | undefined {
  const days = catalog.get('letter_type')?.get(kind)?.defaultDueDays ?? settings.defaultDueDays;
  return days > 0 ? addDays(from, days) : undefined;
}

/** Phòng ban trực tiếp của người dùng (đơn vị được bổ nhiệm, hay đơn vị cha của chức danh). */
export function ownUnits(snapshot: OrganizationSnapshot, userId: string): string[] {
  return [...memberUnits(snapshot, userId)];
}

export function displayNo(letter: Pick<LetterRecord, 'direction' | 'incomingNo' | 'outgoingNo'>): string {
  return letter.direction === 'outgoing' ? (letter.outgoingNo ?? letter.incomingNo) : letter.incomingNo;
}

export function withNo(letter: LetterRecord): LetterRecord & { readonly displayNo: string } {
  return { ...letter, displayNo: displayNo(letter) };
}

/** Người sẽ làm bước duyệt chưa tới: tên người theo sơ đồ tổ chức, không giải được thì mô tả luật. */
export function peopleLabel(
  userIds: readonly string[],
  nameOf: (userId: string) => string,
  rule: ApproverRule,
  direction: LetterDirection,
): string {
  if (userIds.length > 0) return userIds.map(nameOf).join(', ');
  if (rule.type === 'choose') return rule.pool === 'leaders' ? 'Lãnh đạo được chọn khi trình' : 'Người được chọn khi trình';
  if (rule.type === 'handling_unit_heads') return direction === 'incoming' ? 'Trưởng phòng ban xử lý' : 'Trưởng phòng soạn thảo';
  return APPROVER_RULE_LABELS[rule.type];
}

/** Người, thời điểm ở ô đầu và ô cuối; ô cuối chưa làm thì ghi người làm văn thư được chỉ định. */
export function fixedPeople(
  letter: LetterRecord,
  nameOf: (userId: string) => string,
  history: readonly Pick<LetterHistoryEntry, 'action' | 'actorUserId' | 'at'>[] = [],
  clerkUserIds: readonly string[] = [],
): FlowEnds {
  const clerks = clerkUserIds.map(nameOf).join(', ') || undefined;
  const lastBy = (action: LetterHistoryEntry['action']) => [...history].reverse().find((item) => item.action === action);
  const doneBy = (action: LetterHistoryEntry['action'], extra?: string) => {
    const entry = lastBy(action);
    return {
      people: [entry?.actorUserId ? nameOf(entry.actorUserId) : undefined, extra].filter(Boolean).join(' · ') || undefined,
      at: entry?.at,
    };
  };
  const incoming = letter.direction === 'incoming';
  const archived = letter.stage === 'archived' || letter.stage === 'revoking' || Boolean(letter.archiveCode);
  return {
    start: incoming
      ? { people: nameOf(letter.receivedBy), at: letter.createdAt }
      : {
          people: [letter.authorUserId ? nameOf(letter.authorUserId) : undefined, letter.authorUnitName].filter(Boolean).join(' · ') || undefined,
          at: letter.createdAt,
        },
    end: !archived
      ? { people: clerks }
      : incoming
        ? doneBy('complete', letter.archiveCode ? `Hồ sơ ${letter.archiveCode}` : undefined)
        : doneBy('publish', [letter.outgoingNo ? `Số ${letter.outgoingNo}` : undefined, letter.archiveCode ? `Hồ sơ ${letter.archiveCode}` : undefined].filter(Boolean).join(', ')),
  };
}

export interface FlowEnds {
  readonly start?: { readonly people?: string; readonly at?: string };
  readonly end?: { readonly people?: string; readonly at?: string };
}

/** Người ở một bước giữa: đã làm, đang được giao, hay sẽ làm. */
export function stepPeople(
  step: Pick<FlowStep, 'kind' | 'status' | 'actedBy' | 'assigneeUserIds' | 'approver'>,
  context: {
    readonly nameOf: (userId: string) => string;
    readonly assignments: readonly AssignmentRecord[];
    readonly clerkUserIds: readonly string[];
    readonly expected: readonly string[];
    readonly direction: LetterDirection;
  },
): string | undefined {
  const { nameOf } = context;
  if (step.kind === 'process') {
    if (step.status === 'waiting' || step.status === 'skipped') return 'Phòng ban do người làm bước trước chọn';
    return (
      context.assignments
        .map((item) => (item.handlerUserId ? `${item.unitName} (${nameOf(item.handlerUserId)})` : item.unitName))
        .join(', ') || undefined
    );
  }
  if (step.status === 'done' && step.actedBy) return nameOf(step.actedBy);
  if (step.status === 'active' && (step.kind !== 'check' || step.approver)) return step.assigneeUserIds.map(nameOf).join(', ') || undefined;
  if (step.kind === 'check' && !step.approver) return context.clerkUserIds.map(nameOf).join(', ') || undefined;
  return step.approver ? peopleLabel(context.expected, nameOf, step.approver, context.direction) : undefined;
}

export function lastSubmittedAt(assignments: readonly AssignmentRecord[]): string | undefined {
  return assignments
    .map((item) => item.submittedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);
}

/** Ô "Xác nhận huỷ" khi công văn đã ban hành / hoàn tất được đề nghị huỷ. */
export function revokeNode(
  letter: LetterRecord,
  history: readonly Pick<LetterHistoryEntry, 'action' | 'actorUserId' | 'at'>[],
  nameOf: (userId: string) => string,
): { readonly label: string; readonly people?: string; readonly at?: string } | undefined {
  if (!letter.revokeKind) return undefined;
  const label = letter.revokeKind === 'recall' ? 'Xác nhận thu hồi, huỷ' : 'Xác nhận huỷ để sửa đổi';
  if (letter.stage === 'cancelled') {
    const decided = [...history].reverse().find((item) => item.action === 'revoke-approve' || item.action === 'cancel');
    return { label, people: decided?.actorUserId ? nameOf(decided.actorUserId) : undefined, at: decided?.at };
  }
  return { label, people: (letter.revokeApproverIds ?? []).map(nameOf).join(', ') || undefined };
}

/**
 * Thanh tiến trình dựng theo quy trình cấu hình: ô đầu (tiếp nhận / soạn thảo), các bước ở giữa
 * theo đúng thứ tự cấu hình (phòng ban xử lý, văn thư kiểm tra, duyệt), ô cuối (hoàn tất / ban
 * hành, lưu trữ). Trạng thái từng ô theo bước đang chạy của công văn.
 */
export function flowOf(
  direction: LetterDirection,
  stage: LetterStage,
  steps: readonly {
    readonly seq: number;
    readonly name: string;
    readonly kind?: StepType;
    readonly status: LetterStepStatus;
    readonly people?: string;
    readonly at?: string;
  }[],
  fixed: FlowEnds = {},
  revoke?: { readonly label: string; readonly people?: string; readonly at?: string },
  labels: { readonly start?: string; readonly end?: string } = {},
): FlowNode[] {
  const ordered = sortedSteps(steps);
  const start: FlowNode = {
    key: direction === 'incoming' ? 'received' : 'drafting',
    label: labels.start || FLOW_START_NAMES[direction],
    kind: 'start',
    state: 'todo',
    approval: false,
    ...fixed.start,
  };
  const end: FlowNode = {
    key: direction === 'incoming' ? 'closing' : 'publishing',
    label: labels.end || FLOW_END_NAMES[direction],
    kind: 'end',
    state: 'todo',
    approval: false,
    ...fixed.end,
  };
  const middle: FlowNode[] = ordered.map((step) => ({
    key: `step-${step.seq}`,
    label: step.name,
    kind: step.kind ?? 'approve',
    state: 'todo',
    approval: (step.kind ?? 'approve') === 'approve',
    people: step.people,
    at: step.at,
  }));
  const nodes: FlowNode[] = [start, ...middle, end];
  if (stage === 'archived') return nodes.map((node) => ({ ...node, state: 'done' }));
  // Công văn đã ban hành / hoàn tất rồi mới đề nghị huỷ: luồng cũ đã xong, thêm ô xác nhận huỷ.
  if (revoke && (stage === 'revoking' || stage === 'cancelled')) {
    return [
      ...nodes.map((node) => ({ ...node, state: 'done' as const })),
      {
        key: 'revoke',
        label: revoke.label,
        kind: 'revoke',
        state: stage === 'revoking' ? 'current' : 'done',
        approval: true,
        people: revoke.people,
        at: stage === 'cancelled' ? revoke.at : undefined,
      },
    ];
  }
  if (stage === 'cancelled') {
    const done = new Set(ordered.filter((step) => step.status === 'done').map((step) => `step-${step.seq}`));
    return nodes.map((node, index) => ({ ...node, state: index === 0 || done.has(node.key) ? 'done' : 'todo' }));
  }
  const active = ordered.find((step) => step.status === 'active');
  const firstOpen = ordered.find((step) => step.status !== 'done');
  const key = active
    ? `step-${active.seq}`
    : stage === 'received' || stage === 'drafting'
      ? start.key
      : stage === 'closing' || stage === 'publishing' || !firstOpen
        ? end.key
        : `step-${firstOpen.seq}`;
  const current = Math.max(
    0,
    nodes.findIndex((node) => node.key === key),
  );
  return nodes.map((node, index) => ({
    ...node,
    state: index < current ? 'done' : index === current ? 'current' : 'todo',
    // Ô chưa tới không ghi thời điểm (bước bị trả về còn giữ lúc xong cũ).
    at: index < current ? node.at : undefined,
  }));
}

export function summaryOf(row: Row, catalog: Catalog, viewer: LetterViewer, names: ReadonlyMap<string, string>): LetterSummary {
  const item = (kind: CatalogKind, code: string) => catalog.get(kind)?.get(code);
  const active = row.steps.find((step) => step.status === 'active');
  return {
    id: row.id,
    direction: row.direction,
    displayNo: displayNo(row),
    incomingNo: row.incomingNo,
    receivedOn: row.receivedOn,
    senderOrg: row.senderOrg,
    senderRef: row.senderRef,
    senderDate: row.senderDate,
    subject: row.subject,
    kind: row.kind,
    kindName: item('letter_type', row.kind)?.name ?? row.kind,
    urgency: row.urgency,
    urgencyName: item('urgency', row.urgency)?.name ?? row.urgency,
    urgencyHighlight: Boolean(item('urgency', row.urgency)?.highlight),
    confidentiality: row.confidentiality,
    confidentialityName: item('confidentiality', row.confidentiality)?.name ?? row.confidentiality,
    restricted: Boolean(item('confidentiality', row.confidentiality)?.restricted),
    dueOn: row.dueOn,
    stage: row.stage,
    stageLabel: active
      ? active.name
      : row.stage === 'archived' && !row.archiveCode
        ? row.direction === 'incoming'
          ? 'Đã hoàn tất'
          : 'Đã ban hành'
        : (LETTER_STAGE_LABELS[row.stage] ?? row.stage),
    currentStepName: active?.name,
    currentAssigneeNames: (active?.assigneeUserIds ?? []).map((userId) => names.get(userId) ?? 'Người dùng'),
    assignmentsDone: row.assignments.filter((assignment) => assignment.role !== 'info' && assignment.status === 'submitted').length,
    assignmentsTotal: row.assignments.filter((assignment) => assignment.role !== 'info').length,
    authorUserId: row.authorUserId,
    authorName: row.authorUserId ? names.get(row.authorUserId) : undefined,
    authorUnitName: row.authorUnitName,
    sentAs: row.direction === 'outgoing' ? row.sentAs : undefined,
    outgoingNo: row.outgoingNo,
    publishedOn: row.publishedOn,
    recipient: row.recipient,
    deliveryStatus: row.deliveryStatus,
    archiveCode: row.archiveCode,
    archivedOn: row.archivedOn,
    receivedBy: row.receivedBy,
    receivedByName: names.get(row.receivedBy),
    updatedAt: row.updatedAt,
    awaitingMe: awaitsViewer(viewer, facts(row, catalog)),
    unitNames: row.assignments.map((assignment) => `${assignment.unitName} (${ASSIGNMENT_ROLE_LABELS[assignment.role ?? 'lead'].toLowerCase()})`),
    replied: row.replied,
    registerId: row.registerId,
    registerName: row.registerName,
    signerName: row.signerName,
    signerTitle: row.signerTitle,
    copyCount: row.copyCount,
    receiverNames:
      row.direction === 'incoming'
        ? [
            ...new Set(
              [
                row.addressedTo,
                row.addressedUserId ? names.get(row.addressedUserId) : undefined,
                ...row.assignments
                  .filter((assignment) => assignment.role !== 'info')
                  .map((assignment) => assignment.handlerUserId ?? assignment.submittedBy)
                  .map((userId) => (userId ? names.get(userId) : undefined)),
              ].filter((name): name is string => Boolean(name)),
            ),
          ]
        : undefined,
  };
}

export function attachmentView(
  attachment: AttachmentRecord,
  names: ReadonlyMap<string, string>,
  can: { readonly canDelete: boolean; readonly canVersion: boolean },
): LetterAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    assignmentId: attachment.assignmentId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    versionNo: attachment.versionNo,
    uploadedBy: attachment.uploadedBy,
    uploadedByName: names.get(attachment.uploadedBy),
    createdAt: attachment.createdAt,
    canDelete: can.canDelete,
    canVersion: can.canVersion,
  };
}

/** Người đã tham gia: người tiếp nhận, người soạn, người duyệt, người phòng ban gửi kết quả hay được phân công. */
/** So tên danh mục không phân biệt hoa thường, dấu cách. */
export function foldName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

/** Mã danh mục sinh từ tên: bỏ dấu tiếng Việt, chữ thường, gạch ngang; "Chỉ đạo - điều hành" thành "chi-dao-dieu-hanh". */
export function catalogCode(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return code || 'muc';
}

/** Xoá dấu đề nghị huỷ khi công văn về lại đã lưu trữ. */
export const CLEARED_REVOKE = {
  revokeKind: undefined,
  revokeReason: undefined,
  revokeRequestedBy: undefined,
  revokeRequestedAt: undefined,
  revokeApproverIds: [] as readonly string[],
} as const;

export function participants(tx: LetterTransaction): string[] {
  return [
    tx.letter.receivedBy,
    ...(tx.letter.authorUserId ? [tx.letter.authorUserId] : []),
    ...tx.steps.flatMap((step) => [step.actedBy, ...(step.status === 'done' ? step.assigneeUserIds : [])]),
    ...tx.assignments.flatMap((item) => [item.submittedBy, item.handlerUserId]),
  ].filter((id): id is string => Boolean(id));
}

export function archiveNote(letter: LetterRecord): string {
  const number = letter.direction === 'incoming' ? `Số đến ${letter.incomingNo}` : `Số đi ${letter.outgoingNo ?? letter.incomingNo}`;
  return [`Hồ sơ ${letter.archiveCode}`, number, `Trích yếu: ${letter.subject}`].join(' · ').slice(0, 2000);
}

export function dueText(dueOn: string | undefined): string {
  return dueOn ? ` Hạn ${dueOn.split('-').reverse().join('/')}.` : '';
}

export function validateUpload(input: { readonly fileName?: unknown; readonly contentType?: unknown; readonly sizeBytes?: unknown } | undefined) {
  const fileName = requireText(input?.fileName, 'Tên tệp', 255);
  const contentType = String(input?.contentType ?? '').trim() || 'application/octet-stream';
  const sizeBytes = Number(input?.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new CorrespondenceValidationError('Dung lượng tệp không hợp lệ.');
  if (sizeBytes > CORRESPONDENCE_ATTACHMENT_MAX_BYTES) {
    throw new CorrespondenceValidationError(`Tệp không được vượt quá ${Math.round(CORRESPONDENCE_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`);
  }
  return { fileName, contentType, sizeBytes: Math.round(sizeBytes) };
}

export function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) throw new CorrespondenceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  return text;
}

export function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw new CorrespondenceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  return text;
}

export function requireDate(value: unknown, label: string): string {
  const date = optionalDate(value, label);
  if (!date) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  return date;
}

export function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new CorrespondenceValidationError(`${label} phải là ngày dạng YYYY-MM-DD.`);
  }
  return text;
}

export function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const parsed = parseOptional(value, allowed, label);
  if (!parsed) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  return parsed;
}

export function parseOptional<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (!(allowed as readonly string[]).includes(text)) throw new CorrespondenceValidationError(`${label} "${text.slice(0, 40)}" không hợp lệ.`);
  return text as T;
}
