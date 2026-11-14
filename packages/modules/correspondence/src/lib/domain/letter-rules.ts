import {
  isOpenStage,
  type AttachmentKind,
  type LetterActions,
  type LetterDirection,
  type LetterStage,
  type LetterStepStatus,
  type ReturnTarget,
  type StepType,
} from '@enterprise-platform/contracts-correspondence';

/** Người đang thao tác, đủ để quyết định quyền theo bước. */
export interface LetterViewer {
  readonly userId: string;
  readonly isTenantAdmin: boolean;
  /** Văn thư: tiếp nhận, giao phòng ban, kiểm tra và trình công văn đi, huỷ. */
  readonly canRegister: boolean;
  readonly canCreateOutgoing: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  /** Đơn vị người đó trực tiếp thuộc về theo sơ đồ tổ chức (không tính đơn vị cha). */
  readonly unitIds: ReadonlySet<string>;
  /** Đơn vị người đó là trưởng. */
  readonly headUnitIds: ReadonlySet<string>;
  /**
   * Việc của văn thư tính là việc của người này: cấu hình chưa chỉ định người làm văn thư, hoặc
   * người này được chỉ định. Người có quyền mà không được chỉ định vẫn làm thay được.
   */
  readonly clerkOnDuty: boolean;
}

export interface StepFacts {
  readonly seq: number;
  /** Phòng ban xử lý, văn thư kiểm tra hay duyệt; trống là duyệt. */
  readonly kind?: StepType;
  readonly status: LetterStepStatus;
  readonly assigneeUserIds: readonly string[];
  readonly actedBy?: string;
  readonly rejectTo?: ReturnTarget;
}

export interface AssignmentFacts {
  readonly unitId: string;
  readonly status: 'pending' | 'submitted';
  readonly submittedBy?: string;
  readonly handlerUserId?: string;
}

/** Phần công văn mà luật quyền cần. */
export interface LetterFacts {
  readonly direction: LetterDirection;
  readonly stage: LetterStage;
  readonly receivedBy: string;
  readonly authorUserId?: string;
  readonly authorUnitId?: string;
  readonly restricted: boolean;
  readonly steps: readonly StepFacts[];
  readonly assignments: readonly AssignmentFacts[];
  readonly mentionedUserIds: readonly string[];
  /** Đề nghị huỷ đang chờ (giai đoạn `revoking`): người đề nghị, người có thẩm quyền xác nhận. */
  readonly revokeRequestedBy?: string;
  readonly revokeApproverIds?: readonly string[];
}

export function activeStep(letter: Pick<LetterFacts, 'steps'>): StepFacts | undefined {
  return letter.steps.find((step) => step.status === 'active');
}

/** Người xem được giao bước duyệt đang chạy; quản trị tenant làm thay được khi người duyệt vắng. */
export function actsOnActiveStep(viewer: LetterViewer, letter: Pick<LetterFacts, 'steps'>): boolean {
  const step = activeStep(letter);
  return Boolean(step && (step.assigneeUserIds.includes(viewer.userId) || viewer.isTenantAdmin));
}

export function memberOf(viewer: LetterViewer, unitId: string | undefined): boolean {
  return Boolean(unitId && viewer.unitIds.has(unitId));
}

/** Người soạn hay người cùng phòng soạn thảo (công văn đi). */
export function isAuthorSide(viewer: LetterViewer, letter: Pick<LetterFacts, 'authorUserId' | 'authorUnitId'>): boolean {
  return letter.authorUserId === viewer.userId || memberOf(viewer, letter.authorUnitId);
}

/** Người tiếp nhận, người soạn, người được giao hay đã làm một bước, người thuộc phòng ban xử lý, người được nhắc tên. */
export function involves(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (letter.receivedBy === viewer.userId || isAuthorSide(viewer, letter)) return true;
  if (letter.mentionedUserIds.includes(viewer.userId)) return true;
  if (letter.revokeApproverIds?.includes(viewer.userId)) return true;
  if (
    letter.steps.some(
      (step) => step.actedBy === viewer.userId || (step.status !== 'waiting' && step.assigneeUserIds.includes(viewer.userId)),
    )
  ) {
    return true;
  }
  return letter.assignments.some(
    (assignment) =>
      memberOf(viewer, assignment.unitId) || assignment.submittedBy === viewer.userId || assignment.handlerUserId === viewer.userId,
  );
}

/** Ai thấy công văn: người liên quan; người xem mọi công văn (công văn mật cần quyền xem mật); quản trị tenant. */
export function canViewLetter(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (viewer.isTenantAdmin || involves(viewer, letter)) return true;
  return letter.restricted ? viewer.canReadConfidential : viewer.canReadAll;
}

/**
 * Gửi được kết quả cho phòng ban: văn thư, trưởng phòng; phòng đã có người xử lý thì người
 * đó, chưa có thì mọi nhân sự của phòng.
 */
export function canRespondFor(viewer: LetterViewer, letter: Pick<LetterFacts, 'stage'>, assignment: AssignmentFacts): boolean {
  if (letter.stage !== 'processing' || assignment.status !== 'pending') return false;
  if (viewer.canRegister || viewer.headUnitIds.has(assignment.unitId)) return true;
  return assignment.handlerUserId ? assignment.handlerUserId === viewer.userId : memberOf(viewer, assignment.unitId);
}

/** Phân công người xử lý cho phòng: văn thư, trưởng phòng; phòng chưa có người xử lý thì nhân sự của phòng nhận việc. */
export function canAssignHandler(viewer: LetterViewer, letter: Pick<LetterFacts, 'stage'>, assignment: AssignmentFacts): boolean {
  if (letter.stage !== 'processing' || assignment.status !== 'pending') return false;
  if (viewer.canRegister || viewer.headUnitIds.has(assignment.unitId)) return true;
  return !assignment.handlerUserId && memberOf(viewer, assignment.unitId);
}

/** Người xem có việc phải làm ở bước hiện tại (không tính quyền làm thay của quản trị). */
export function awaitsViewer(viewer: LetterViewer, letter: LetterFacts): boolean {
  switch (letter.stage) {
    case 'received':
    case 'checking':
      return viewer.canRegister && viewer.clerkOnDuty;
    case 'drafting':
      return letter.authorUserId === viewer.userId;
    case 'reviewing':
      return Boolean(activeStep(letter)?.assigneeUserIds.includes(viewer.userId));
    case 'processing':
      return letter.assignments.some(
        (assignment) =>
          assignment.status === 'pending' &&
          (assignment.handlerUserId ? assignment.handlerUserId === viewer.userId : memberOf(viewer, assignment.unitId)),
      );
    case 'closing':
      return viewer.canArchive && viewer.clerkOnDuty;
    case 'publishing':
      return viewer.canPublish && viewer.clerkOnDuty;
    case 'revoking':
      return Boolean(letter.revokeApproverIds?.includes(viewer.userId));
    default:
      return false;
  }
}

/** Văn thư của luồng: ban hành (công văn đi) hay hoàn tất, lưu trữ (công văn đến). */
function clerkOfDirection(viewer: LetterViewer, direction: LetterDirection): boolean {
  return viewer.isTenantAdmin || (direction === 'incoming' ? viewer.canArchive : viewer.canPublish);
}

/** Bước đã xong gần nhất trước bước đang chạy (không có bước đang chạy thì bước xong cuối), có thể lọc theo loại. */
export function doneBefore(letter: Pick<LetterFacts, 'steps'>, kind?: StepType): StepFacts | undefined {
  const active = activeStep(letter);
  return [...letter.steps]
    .sort((left, right) => left.seq - right.seq)
    .filter((step) => step.status === 'done' && (!active || step.seq < active.seq) && (!kind || (step.kind ?? 'approve') === kind))
    .at(-1);
}

/**
 * Nơi trả về có được ở bước hiện tại:
 * - `previous-step`: bước đã xong ngay trước (bất kể loại);
 * - `handlers`: công văn đến về bước phòng ban xử lý gần nhất, công văn đi về người soạn;
 * - `clerk`: công văn đến về văn thư tiếp nhận (giao lại), công văn đi về bước văn thư kiểm tra gần nhất.
 */
function availableTargets(letter: LetterFacts): ReturnTarget[] {
  const incoming = letter.direction === 'incoming';
  const targets: ReturnTarget[] = [];
  if (doneBefore(letter)) targets.push('previous-step');
  if (incoming ? doneBefore(letter, 'process') : true) targets.push('handlers');
  if (incoming || doneBefore(letter, 'check')) targets.push('clerk');
  return targets;
}

/** Nơi người xem trả công văn về được ở bước hiện tại ("Không đạt", "Trả lại"). */
export function returnTargets(viewer: LetterViewer, letter: LetterFacts): ReturnTarget[] {
  const incoming = letter.direction === 'incoming';
  const available = availableTargets(letter);
  switch (letter.stage) {
    case 'reviewing':
      return actsOnActiveStep(viewer, letter) ? available : [];
    case 'checking': {
      if (!viewer.canRegister) return [];
      const back = available.filter((target) => target !== 'clerk');
      return back.length > 0 ? back : incoming ? ['clerk'] : [];
    }
    case 'processing': {
      // Phòng ban trả lại khi không thuộc phòng mình: về người giao (bước trước), không thì văn thư / người soạn.
      if (viewer.canRegister || !letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment))) return [];
      const start: ReturnTarget = incoming ? 'clerk' : 'handlers';
      return doneBefore(letter) ? ['previous-step', start] : [start];
    }
    case 'closing':
      // Người hoàn tất là văn thư: không trả về chính văn thư tiếp nhận.
      return viewer.canArchive ? available.filter((target) => target !== 'clerk') : [];
    case 'publishing':
      return viewer.canPublish ? available : [];
    default:
      return [];
  }
}

/** Thao tác người xem làm được ở bước hiện tại. Service kiểm lại đúng các luật này trước khi ghi. */
export function letterActions(viewer: LetterViewer, letter: LetterFacts): LetterActions {
  const open = isOpenStage(letter.stage);
  const stage = letter.stage;
  const incoming = letter.direction === 'incoming';
  const onStep = stage === 'reviewing' && actsOnActiveStep(viewer, letter);
  const authorSide = !incoming && isAuthorSide(viewer, letter);
  const respondsSomewhere = letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment));

  const attachKinds = new Set<AttachmentKind>();
  if (incoming && viewer.canRegister && open) ['incoming', 'reference'].forEach((kind) => attachKinds.add(kind as AttachmentKind));
  if (respondsSomewhere) attachKinds.add('draft');
  if (!incoming && ((stage === 'drafting' && (authorSide || viewer.canRegister)) || (stage === 'checking' && viewer.canRegister))) {
    attachKinds.add('draft');
    attachKinds.add('reference');
  }
  if (!incoming && stage === 'publishing' && viewer.canPublish) {
    attachKinds.add('outgoing');
    attachKinds.add('reference');
  }
  if (onStep) attachKinds.add('reference');

  const targets = returnTargets(viewer, letter);
  const active = activeStep(letter);
  return {
    edit: open && (viewer.canRegister || (stage === 'drafting' && authorSide)),
    dispatch: incoming && stage === 'received' && viewer.canRegister,
    sendToClerk: !incoming && stage === 'drafting' && (authorSide || viewer.canRegister),
    submit: stage === 'checking' && viewer.canRegister,
    approve: onStep,
    complete: incoming && stage === 'closing' && viewer.canArchive,
    publish: !incoming && stage === 'publishing' && viewer.canPublish,
    updateDelivery: !incoming && stage === 'archived' && viewer.canPublish,
    cancel: open && (viewer.canRegister || (stage === 'drafting' && letter.authorUserId === viewer.userId)),
    requestRevoke: stage === 'archived' && clerkOfDirection(viewer, letter.direction),
    decideRevoke: stage === 'revoking' && (Boolean(letter.revokeApproverIds?.includes(viewer.userId)) || viewer.isTenantAdmin),
    withdrawRevoke:
      stage === 'revoking' && (letter.revokeRequestedBy === viewer.userId || clerkOfDirection(viewer, letter.direction)),
    remove: stage === 'cancelled' && (viewer.isTenantAdmin || viewer.canRegister || viewer.canPublish || viewer.canArchive),
    returnTargets: targets,
    defaultReturnTarget:
      active?.rejectTo && targets.includes(active.rejectTo) ? active.rejectTo : targets.includes('previous-step') ? 'previous-step' : targets[0],
    comment: letter.stage !== 'cancelled',
    reply: incoming && viewer.canCreateOutgoing && letter.stage !== 'cancelled',
    attachKinds: [...attachKinds],
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
  if (attachment.kind === 'draft') {
    if (attachment.assignment) return letter.stage === 'processing' && attachment.assignment.status === 'pending';
    return letter.stage === 'drafting' || letter.stage === 'checking';
  }
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
export function dossierFolderName(number: string, subject: string): string {
  const name = `${number} - ${subject.replace(/\s+/g, ' ').trim()}`;
  return name.length <= 180 ? name : `${name.slice(0, 179).trimEnd()}…`;
}
