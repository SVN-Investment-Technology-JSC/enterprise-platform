import {
  isOpenStage,
  type AttachmentKind,
  type LetterActions,
  type LetterStage,
  type LetterStepStatus,
} from '@enterprise-platform/contracts-correspondence';

/** Người đang thao tác, đủ để quyết định quyền theo bước. */
export interface LetterViewer {
  readonly userId: string;
  readonly isTenantAdmin: boolean;
  /** Tiếp nhận, phân loại, trình, huỷ, sửa thông tin. */
  readonly canRegister: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  /** Xem mọi công văn không mật. */
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  /** Đơn vị và chức danh người đó thuộc về, gồm cả đơn vị cha (sơ đồ tổ chức). */
  readonly unitIds: ReadonlySet<string>;
}

export interface StepFacts {
  readonly seq: number;
  readonly kind: 'direct' | 'approve';
  readonly status: LetterStepStatus;
  readonly assigneeUserIds: readonly string[];
  readonly actedBy?: string;
}

/** Phần công văn mà luật quyền cần. */
export interface LetterFacts {
  readonly stage: LetterStage;
  readonly receivedBy: string;
  /** Độ mật đang dùng có cờ "chỉ người liên quan". */
  readonly restricted: boolean;
  readonly steps: readonly StepFacts[];
  readonly assignments: readonly {
    readonly unitId: string;
    readonly status: 'pending' | 'submitted';
    readonly submittedBy?: string;
  }[];
}

export function activeStep(letter: Pick<LetterFacts, 'steps'>): StepFacts | undefined {
  return letter.steps.find((step) => step.status === 'active');
}

function directSeq(letter: Pick<LetterFacts, 'steps'>): number {
  return letter.steps.find((step) => step.kind === 'direct')?.seq ?? Number.MAX_SAFE_INTEGER;
}

/** Người xem được giao bước đang chạy; quản trị tenant làm thay được khi người duyệt vắng. */
export function actsOnActiveStep(viewer: LetterViewer, letter: Pick<LetterFacts, 'steps'>): boolean {
  const step = activeStep(letter);
  return Boolean(step && (step.assigneeUserIds.includes(viewer.userId) || viewer.isTenantAdmin));
}

export function memberOf(viewer: LetterViewer, unitId: string): boolean {
  return viewer.unitIds.has(unitId);
}

/** Người tiếp nhận, người được giao hay đã làm một bước, người thuộc phòng ban được giao. */
export function involves(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (letter.receivedBy === viewer.userId) return true;
  if (letter.steps.some((step) => step.actedBy === viewer.userId || (step.status !== 'waiting' && step.assigneeUserIds.includes(viewer.userId)))) {
    return true;
  }
  return letter.assignments.some(
    (assignment) => memberOf(viewer, assignment.unitId) || assignment.submittedBy === viewer.userId,
  );
}

/**
 * Ai thấy công văn: người liên quan; người có quyền xem mọi công văn (công văn mật thì cần
 * quyền xem công văn mật); quản trị tenant.
 */
export function canViewLetter(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (viewer.isTenantAdmin || involves(viewer, letter)) return true;
  return letter.restricted ? viewer.canReadConfidential : viewer.canReadAll;
}

export function canRespondFor(
  viewer: LetterViewer,
  letter: Pick<LetterFacts, 'stage'>,
  assignment: { readonly unitId: string; readonly status: 'pending' | 'submitted' },
): boolean {
  return (
    letter.stage === 'processing' &&
    assignment.status === 'pending' &&
    (viewer.canRegister || memberOf(viewer, assignment.unitId))
  );
}

/** Người xem có việc phải làm ở bước hiện tại (không tính quyền làm thay của quản trị). */
export function awaitsViewer(viewer: LetterViewer, letter: LetterFacts): boolean {
  switch (letter.stage) {
    case 'received':
    case 'registered':
      return viewer.canRegister;
    case 'reviewing':
    case 'directing':
      return Boolean(activeStep(letter)?.assigneeUserIds.includes(viewer.userId));
    case 'processing':
      return letter.assignments.some((assignment) => assignment.status === 'pending' && memberOf(viewer, assignment.unitId));
    case 'publishing':
      return viewer.canPublish;
    case 'closing':
      return viewer.canArchive;
    default:
      return false;
  }
}

/** Thao tác người xem làm được ở bước hiện tại. Service kiểm lại đúng các luật này trước khi ghi. */
export function letterActions(viewer: LetterViewer, letter: LetterFacts): LetterActions {
  const open = isOpenStage(letter.stage);
  const stage = letter.stage;
  const step = activeStep(letter);
  const onStep = actsOnActiveStep(viewer, letter);
  const beforeDirect = Boolean(step && step.seq < directSeq(letter));
  const attachKinds: AttachmentKind[] = [];
  if (viewer.canRegister && open) attachKinds.push('incoming', 'reference');
  else if (onStep && (stage === 'reviewing' || stage === 'directing')) attachKinds.push('reference');
  if (letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment))) attachKinds.push('draft');
  if (viewer.canPublish && (stage === 'publishing' || stage === 'closing')) attachKinds.push('outgoing');
  return {
    edit: viewer.canRegister && open,
    classify: viewer.canRegister && stage === 'received',
    submit: viewer.canRegister && stage === 'registered',
    approve: onStep && stage === 'reviewing',
    returnToClerk: onStep && ((stage === 'reviewing' && beforeDirect) || stage === 'directing'),
    direct: onStep && stage === 'directing',
    closeForInfo: onStep && stage === 'directing',
    requestRevision: onStep && stage === 'reviewing' && !beforeDirect,
    publish: viewer.canPublish && stage === 'publishing',
    archive: viewer.canArchive && stage === 'closing',
    cancel: viewer.canRegister && (stage === 'received' || stage === 'registered'),
    attachKinds,
  };
}

export function canDeleteAttachment(
  viewer: LetterViewer,
  letter: LetterFacts,
  attachment: {
    readonly kind: AttachmentKind;
    readonly uploadedBy: string;
    readonly assignment?: { readonly status: 'pending' | 'submitted' };
  },
): boolean {
  if (!isOpenStage(letter.stage)) return false;
  if (attachment.uploadedBy !== viewer.userId && !viewer.canRegister) return false;
  if (attachment.kind === 'draft') return letter.stage === 'processing' && attachment.assignment?.status === 'pending';
  return true;
}

/* -------------------------------------------------------------- định dạng */

export function vietnamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** "41/CVĐ" */
export function formatSequenceNo(seq: number, suffix: string): string {
  return suffix ? `${seq}/${suffix}` : String(seq);
}

/** "HS-2026-0391" */
export function formatArchiveCode(prefix: string, year: number, seq: number): string {
  return `${prefix ? `${prefix}-` : ''}${year}-${String(seq).padStart(4, '0')}`;
}

/** Tên thư mục hồ sơ bên Hệ dùng chung: "41/CVĐ - Trích yếu…", tối đa 180 ký tự. */
export function dossierFolderName(incomingNo: string, subject: string): string {
  const name = `${incomingNo} - ${subject.replace(/\s+/g, ' ').trim()}`;
  return name.length <= 180 ? name : `${name.slice(0, 179).trimEnd()}…`;
}
