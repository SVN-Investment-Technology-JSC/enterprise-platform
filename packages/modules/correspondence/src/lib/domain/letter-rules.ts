import {
  isOpenStage,
  type AttachmentKind,
  type LetterActions,
  type LetterDirection,
  type LetterStage,
  type LetterStepStatus,
  type AssignmentRole,
  type ReturnTarget,
  type StepMode,
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
  /** Văn thư hay bộ phận tổng hợp: theo dõi, đôn đốc việc giải quyết công văn. */
  readonly canTrack?: boolean;
}

export interface StepFacts {
  readonly seq: number;
  readonly name?: string;
  /** Phòng ban xử lý, văn thư kiểm tra hay duyệt; trống là duyệt. */
  readonly kind?: StepType;
  readonly status: LetterStepStatus;
  readonly assigneeUserIds: readonly string[];
  readonly actedBy?: string;
  readonly rejectTo?: ReturnTarget;
  /** Bước văn thư kiểm tra giao người riêng: chỉ những người đó làm (không phải mọi người làm văn thư). */
  readonly ownActors?: boolean;
  /** Bước "tất cả cùng duyệt": người đã duyệt thì không duyệt lại. */
  readonly approvedBy?: readonly string[];
  /** Cách xong bước; bước phòng ban `lead` = phòng chủ trì gửi là xong, không chờ phối hợp. */
  readonly mode?: StepMode;
}

export interface AssignmentFacts {
  readonly unitId: string;
  /** Chủ trì, phối hợp hay nhận để biết (không phải gửi kết quả); trống là chủ trì. */
  readonly role?: AssignmentRole;
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
  /** Văn bản gửi đích danh người này. */
  readonly addressedUserId?: string;
  /** Người làm ô cuối theo cấu hình quy trình; trống là văn thư. */
  readonly closerIds?: readonly string[];
  /** Thư riêng gửi đích danh: người nhận xác nhận đã nhận, hay trả văn thư nếu là việc chung. */
  readonly personal?: boolean;
  /** Công văn đi gửi với danh nghĩa cá nhân: chỉ người soạn làm việc của người soạn. */
  readonly sentAs?: 'person' | 'unit';
  /** Người được giao bước kế tiếp (hay ô cuối), đang chờ bước hiện tại xong; tính khi xem chi tiết, đôn đốc. */
  readonly waitingUserIds?: readonly string[];
}

/** Người xem làm được ô cuối (hoàn tất / ban hành): người được cấu hình, không cấu hình thì văn thư có quyền. */
export function closesLetter(viewer: LetterViewer, letter: Pick<LetterFacts, 'closerIds' | 'direction'>, onDutyOnly = false): boolean {
  if (letter.closerIds && letter.closerIds.length > 0) return letter.closerIds.includes(viewer.userId) || (!onDutyOnly && viewer.isTenantAdmin);
  const right = letter.direction === 'incoming' ? viewer.canArchive : viewer.canPublish;
  return right && (!onDutyOnly || viewer.clerkOnDuty);
}

export function activeStep(letter: Pick<LetterFacts, 'steps'>): StepFacts | undefined {
  return letter.steps.find((step) => step.status === 'active');
}

/**
 * Người xem được giao bước duyệt đang chạy (bước "tất cả cùng duyệt": chưa duyệt); quản trị tenant làm
 * thay được khi người duyệt vắng.
 */
export function actsOnActiveStep(viewer: LetterViewer, letter: Pick<LetterFacts, 'steps'>): boolean {
  const step = activeStep(letter);
  if (!step || step.approvedBy?.includes(viewer.userId)) return false;
  return step.assigneeUserIds.includes(viewer.userId) || viewer.isTenantAdmin;
}

/** Làm bước văn thư kiểm tra đang chạy: người riêng của bước nếu cấu hình có, không thì người có quyền văn thư. */
export function actsOnCheck(viewer: LetterViewer, letter: Pick<LetterFacts, 'steps' | 'stage'>): boolean {
  if (letter.stage !== 'checking') return false;
  const step = activeStep(letter);
  if (step?.ownActors) return step.assigneeUserIds.includes(viewer.userId) || viewer.isTenantAdmin;
  return viewer.canRegister;
}

/** Phòng nhận để biết: không gửi kết quả, không chặn bước. */
export function handles(assignment: Pick<AssignmentFacts, 'role'>): boolean {
  return assignment.role !== 'info';
}

export function memberOf(viewer: LetterViewer, unitId: string | undefined): boolean {
  return Boolean(unitId && viewer.unitIds.has(unitId));
}

/** Người soạn hay người cùng phòng soạn thảo (công văn đi). */
export function isAuthorSide(viewer: LetterViewer, letter: Pick<LetterFacts, 'authorUserId' | 'authorUnitId'>): boolean {
  return letter.authorUserId === viewer.userId || memberOf(viewer, letter.authorUnitId);
}

/**
 * Làm việc của người soạn (sửa, gửi bản soạn): công văn gửi với danh nghĩa cá nhân thì chỉ người soạn,
 * cả phòng ban thì mọi người trong phòng soạn thảo.
 */
export function actsAsAuthor(viewer: LetterViewer, letter: Pick<LetterFacts, 'authorUserId' | 'authorUnitId' | 'sentAs'>): boolean {
  return letter.authorUserId === viewer.userId || (letter.sentAs !== 'person' && memberOf(viewer, letter.authorUnitId));
}

/**
 * Người đang chờ bước hiện tại xong nên được đôn đốc nó: người đã chuyển công văn sang bước này (làm bước
 * liền trước; chưa có thì người tiếp nhận / người soạn), người được giao bước kế tiếp, phòng chủ trì đang
 * chờ phòng phối hợp, người soạn công văn đi khi công văn đã rời tay mình.
 */
export function waitsOnCurrentStep(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (letter.waitingUserIds?.includes(viewer.userId)) return true;
  const previous = doneBefore(letter);
  if (previous ? previous.actedBy === viewer.userId : letter.direction === 'incoming' ? letter.receivedBy === viewer.userId : letter.authorUserId === viewer.userId) {
    return true;
  }
  if (letter.direction === 'outgoing' && letter.stage !== 'drafting' && actsAsAuthor(viewer, letter)) return true;
  return (
    letter.stage === 'processing' &&
    letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment) && supportPending(letter, assignment).length > 0)
  );
}

/** Người tiếp nhận, người soạn, người được giao hay đã làm một bước, người thuộc phòng ban xử lý, người được nhắc tên. */
export function involves(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (letter.receivedBy === viewer.userId || isAuthorSide(viewer, letter)) return true;
  if (letter.mentionedUserIds.includes(viewer.userId)) return true;
  if (letter.revokeApproverIds?.includes(viewer.userId)) return true;
  if (letter.addressedUserId === viewer.userId) return true;
  if (letter.closerIds?.includes(viewer.userId)) return true;
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
  if (letter.stage !== 'processing' || assignment.status !== 'pending' || !handles(assignment)) return false;
  if (viewer.canRegister || viewer.headUnitIds.has(assignment.unitId)) return true;
  return assignment.handlerUserId ? assignment.handlerUserId === viewer.userId : memberOf(viewer, assignment.unitId);
}

/**
 * Phòng phối hợp chưa gửi kết quả mà phòng chủ trì phải chờ: chủ trì tổng hợp ý kiến phối hợp nên gửi sau
 * cùng. Bước đặt "phòng chủ trì gửi là xong" thì không chờ.
 */
export function supportPending<T extends AssignmentFacts>(
  letter: { readonly steps: readonly StepFacts[]; readonly assignments: readonly T[] },
  assignment: AssignmentFacts,
): T[] {
  if ((assignment.role ?? 'lead') !== 'lead') return [];
  const step = letter.steps.find((item) => item.status === 'active' && item.kind === 'process');
  if (step?.mode === 'lead') return [];
  return letter.assignments.filter((item) => item.role === 'support' && item.status === 'pending');
}

/** Phân công người xử lý cho phòng: văn thư, trưởng phòng; phòng chưa có người xử lý thì nhân sự của phòng nhận việc. */
export function canAssignHandler(viewer: LetterViewer, letter: Pick<LetterFacts, 'stage'>, assignment: AssignmentFacts): boolean {
  if (letter.stage !== 'processing' || assignment.status !== 'pending' || !handles(assignment)) return false;
  if (viewer.canRegister || viewer.headUnitIds.has(assignment.unitId)) return true;
  return !assignment.handlerUserId && memberOf(viewer, assignment.unitId);
}

/** Người xem có việc phải làm ở bước hiện tại (không tính quyền làm thay của quản trị). */
export function awaitsViewer(viewer: LetterViewer, letter: LetterFacts): boolean {
  switch (letter.stage) {
    case 'received':
      return viewer.canRegister && viewer.clerkOnDuty;
    case 'checking':
      return activeStep(letter)?.ownActors
        ? Boolean(activeStep(letter)?.assigneeUserIds.includes(viewer.userId))
        : viewer.canRegister && viewer.clerkOnDuty;
    case 'drafting':
      return letter.authorUserId === viewer.userId;
    case 'reviewing': {
      const step = activeStep(letter);
      return Boolean(step?.assigneeUserIds.includes(viewer.userId) && !step.approvedBy?.includes(viewer.userId));
    }
    case 'processing':
      return letter.assignments.some(
        (assignment) =>
          assignment.status === 'pending' &&
          handles(assignment) &&
          supportPending(letter, assignment).length === 0 &&
          (assignment.handlerUserId ? assignment.handlerUserId === viewer.userId : memberOf(viewer, assignment.unitId)),
      );
    case 'closing':
    case 'publishing':
      return closesLetter(viewer, letter, true);
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
      if (!actsOnCheck(viewer, letter)) return [];
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
      // Thư riêng: người nhận trả văn thư (việc chung). Người hoàn tất thường là văn thư: không trả về chính văn thư tiếp nhận.
      if (letter.personal) return closesLetter(viewer, letter) ? ['clerk'] : [];
      return closesLetter(viewer, letter) ? available.filter((target) => target !== 'clerk') : [];
    case 'publishing':
      return closesLetter(viewer, letter) ? available : [];
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
  const authorSide = !incoming && actsAsAuthor(viewer, letter);
  const respondsSomewhere = letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment));

  const attachKinds = new Set<AttachmentKind>();
  if (incoming && viewer.canRegister && open) ['incoming', 'reference'].forEach((kind) => attachKinds.add(kind as AttachmentKind));
  if (respondsSomewhere) attachKinds.add('draft');
  if (!incoming && ((stage === 'drafting' && (authorSide || viewer.canRegister)) || actsOnCheck(viewer, letter))) {
    attachKinds.add('draft');
    attachKinds.add('reference');
  }
  if (!incoming && stage === 'publishing' && closesLetter(viewer, letter)) {
    attachKinds.add('outgoing');
    attachKinds.add('reference');
  }
  if (onStep) attachKinds.add('reference');

  const targets = returnTargets(viewer, letter);
  const active = activeStep(letter);
  // Ngoài các nơi mặc định: về đúng một bước đã xong bất kỳ trước bước hiện tại (phòng ban chỉ trả về người giao).
  const returnSteps =
    stage !== 'processing' && targets.length > 0
      ? [...letter.steps]
          .filter((step) => step.status === 'done' && (!active || step.seq < active.seq))
          .sort((left, right) => left.seq - right.seq)
          .map((step) => ({ seq: step.seq, name: step.name ?? `Bước ${step.seq}` }))
      : [];
  return {
    edit: open && (viewer.canRegister || (stage === 'drafting' && authorSide)),
    dispatch: incoming && stage === 'received' && viewer.canRegister,
    sendToClerk: !incoming && stage === 'drafting' && (authorSide || viewer.canRegister),
    submit: actsOnCheck(viewer, letter),
    approve: onStep,
    complete: incoming && stage === 'closing' && closesLetter(viewer, letter),
    publish: !incoming && stage === 'publishing' && closesLetter(viewer, letter),
    updateDelivery: !incoming && stage === 'archived' && viewer.canPublish,
    cancel: open && (viewer.canRegister || (stage === 'drafting' && letter.authorUserId === viewer.userId)),
    requestRevoke: stage === 'archived' && clerkOfDirection(viewer, letter.direction),
    decideRevoke: stage === 'revoking' && (Boolean(letter.revokeApproverIds?.includes(viewer.userId)) || viewer.isTenantAdmin),
    withdrawRevoke:
      stage === 'revoking' && (letter.revokeRequestedBy === viewer.userId || clerkOfDirection(viewer, letter.direction)),
    remind: open && stage !== 'received' && (Boolean(viewer.canTrack || viewer.isTenantAdmin) || waitsOnCurrentStep(viewer, letter)),
    remove: stage === 'cancelled' && (viewer.isTenantAdmin || viewer.canRegister || viewer.canPublish || viewer.canArchive),
    returnTargets: targets,
    returnSteps,
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
