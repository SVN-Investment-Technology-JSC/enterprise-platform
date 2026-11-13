import {
  isOpenStage,
  type AttachmentKind,
  type LetterActions,
  type LetterStage,
} from '@enterprise-platform/contracts-correspondence';

/** Người đang thao tác, đủ để quyết định quyền theo bước. */
export interface LetterViewer {
  readonly userId: string;
  /** Văn thư (tiếp nhận, phát hành, lưu trữ), quản trị văn thư hoặc quản trị tenant. */
  readonly isClerk: boolean;
  readonly isTenantAdmin: boolean;
  /** Đơn vị và chức danh người đó thuộc về, gồm cả đơn vị cha (sơ đồ tổ chức). */
  readonly unitIds: ReadonlySet<string>;
}

/** Phần công văn mà luật quyền cần. */
export interface LetterFacts {
  readonly stage: LetterStage;
  readonly leaderUserId?: string;
  readonly receivedBy: string;
  readonly assignments: readonly {
    readonly unitId: string;
    readonly status: 'pending' | 'submitted';
    readonly submittedBy?: string;
  }[];
}

/** Người xem là lãnh đạo được trình công văn này; quản trị tenant làm thay được khi lãnh đạo vắng. */
export function actsAsLeader(viewer: LetterViewer, letter: LetterFacts): boolean {
  return Boolean(letter.leaderUserId && letter.leaderUserId === viewer.userId) || viewer.isTenantAdmin;
}

/** Người xem thuộc phòng ban được giao (kể cả qua đơn vị cha của chức danh mình). */
export function memberOf(viewer: LetterViewer, unitId: string): boolean {
  return viewer.unitIds.has(unitId);
}

/**
 * Ai được thấy công văn: văn thư thấy tất cả; người khác thấy công văn mình
 * tiếp nhận, được trình, thuộc phòng ban được giao hoặc từng gửi phản hồi.
 */
export function canViewLetter(viewer: LetterViewer, letter: LetterFacts): boolean {
  if (viewer.isClerk || viewer.isTenantAdmin) return true;
  if (letter.receivedBy === viewer.userId || letter.leaderUserId === viewer.userId) return true;
  return letter.assignments.some(
    (assignment) => memberOf(viewer, assignment.unitId) || assignment.submittedBy === viewer.userId,
  );
}

/** Phòng ban này đang chờ phản hồi và người xem gửi được thay cho phòng. */
export function canRespondFor(
  viewer: LetterViewer,
  letter: Pick<LetterFacts, 'stage'>,
  assignment: { readonly unitId: string; readonly status: 'pending' | 'submitted' },
): boolean {
  return (
    letter.stage === 'processing' &&
    assignment.status === 'pending' &&
    (viewer.isClerk || memberOf(viewer, assignment.unitId))
  );
}

/** Người xem có việc phải làm ở bước hiện tại. */
export function awaitsViewer(viewer: LetterViewer, letter: LetterFacts): boolean {
  switch (letter.stage) {
    case 'received':
    case 'registered':
    case 'publishing':
    case 'closing':
      return viewer.isClerk;
    case 'directing':
    case 'reviewing':
      return Boolean(letter.leaderUserId && letter.leaderUserId === viewer.userId);
    case 'processing':
      return letter.assignments.some(
        (assignment) => assignment.status === 'pending' && memberOf(viewer, assignment.unitId),
      );
    default:
      return false;
  }
}

/** Thao tác người xem làm được ở bước hiện tại. Service kiểm lại đúng các luật này trước khi ghi. */
export function letterActions(viewer: LetterViewer, letter: LetterFacts): LetterActions {
  const clerk = viewer.isClerk;
  const open = isOpenStage(letter.stage);
  const leader = actsAsLeader(viewer, letter);
  const stage = letter.stage;
  const attachKinds: AttachmentKind[] = [];
  if (clerk && open) attachKinds.push('incoming', 'reference');
  if (!clerk && leader && (stage === 'directing' || stage === 'reviewing')) attachKinds.push('reference');
  if (letter.assignments.some((assignment) => canRespondFor(viewer, letter, assignment))) attachKinds.push('draft');
  if (clerk && (stage === 'publishing' || stage === 'closing')) attachKinds.push('outgoing');
  return {
    edit: clerk && open,
    classify: clerk && stage === 'received',
    submit: clerk && stage === 'registered',
    direct: leader && stage === 'directing',
    returnToClerk: leader && stage === 'directing',
    closeForInfo: leader && stage === 'directing',
    approve: leader && stage === 'reviewing',
    requestRevision: leader && stage === 'reviewing',
    publish: clerk && stage === 'publishing',
    archive: clerk && stage === 'closing',
    cancel: clerk && (stage === 'received' || stage === 'registered'),
    attachKinds,
  };
}

/** Gỡ được tệp: người tải lên hoặc văn thư, khi hồ sơ còn mở; dự thảo chỉ khi phòng ban chưa gửi. */
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
  if (attachment.uploadedBy !== viewer.userId && !viewer.isClerk) return false;
  if (attachment.kind === 'draft') return letter.stage === 'processing' && attachment.assignment?.status === 'pending';
  return true;
}

/* -------------------------------------------------------------- định dạng */

/** Ngày hôm nay theo giờ Việt Nam, `YYYY-MM-DD`. */
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
