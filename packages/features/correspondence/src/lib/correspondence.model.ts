import {
  daysUntil,
  isOpenStage,
  LETTER_STAGE_LABELS,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceConfig,
  type LetterDirection,
  type LetterStage,
  type LetterSummary,
  type Workflow,
} from '@enterprise-platform/contracts-correspondence';

/** Màn hình của phân hệ; `letters` là liên kết mở thẳng một công văn (`#letters/<id>`). */
export const CORRESPONDENCE_VIEWS = ['overview', 'mine', 'incoming', 'outgoing', 'archive', 'reports', 'settings', 'letters'] as const;
export type CorrespondenceView = (typeof CORRESPONDENCE_VIEWS)[number];

export type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'muted';

/** Màu nhãn của bước: việc của văn thư xám, đang duyệt vàng, phòng ban / chờ văn thư hoàn tất xanh, lưu trữ xanh lá. */
export function stageTone(stage: LetterStage): Tone {
  switch (stage) {
    case 'received':
    case 'drafting':
    case 'checking':
      return 'neutral';
    case 'reviewing':
      return 'warning';
    case 'processing':
    case 'publishing':
    case 'closing':
      return 'info';
    case 'archived':
      return 'success';
    case 'revoking':
      return 'danger';
    default:
      return 'muted';
  }
}

export function urgencyTone(letter: Pick<LetterSummary, 'urgencyHighlight'>): Tone {
  return letter.urgencyHighlight ? 'danger' : 'neutral';
}

/** Lựa chọn của một danh mục: mục đang dùng, theo thứ tự; giữ cả mục `keep` (giá trị cũ đã ngừng dùng). */
export function catalogOptions(catalog: readonly CatalogItem[], kind: CatalogKind, keep?: string) {
  return catalog
    .filter((item) => item.kind === kind && (item.isActive || item.code === keep))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'vi'))
    .map((item) => ({ value: item.code, label: item.isActive ? item.name : `${item.name} (ngừng dùng)` }));
}

/**
 * Quy trình sẽ áp dụng theo cấu hình: quy trình gắn với loại văn bản cho luồng đó, không có thì
 * quy trình mặc định của luồng. Người dùng không chọn quy trình khi trình.
 */
export function plannedWorkflow(config: CorrespondenceConfig, direction: LetterDirection, kind: string): Workflow | undefined {
  const type = config.catalog.find((item) => item.kind === 'letter_type' && item.code === kind);
  const wanted = direction === 'incoming' ? type?.workflowId : type?.outgoingWorkflowId;
  const usable = config.workflows.filter((workflow) => workflow.isActive && workflow.direction === direction);
  return usable.find((workflow) => workflow.id === wanted) ?? usable.find((workflow) => workflow.isDefault);
}

export function stageLabel(stage: LetterStage): string {
  return LETTER_STAGE_LABELS[stage];
}

/** `YYYY-MM-DD` → `dd/mm/yyyy`; rỗng thì rỗng. */
export function formatDay(value: string | undefined): string {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/** "Còn 3 ngày", "Đến hạn hôm nay", "Quá hạn 2 ngày" cho công văn còn mở; đã đóng thì không ghi gì. */
export function dueText(letter: Pick<LetterSummary, 'dueOn' | 'stage'>, today: string): { text: string; tone: Tone } | undefined {
  if (!letter.dueOn || !isOpenStage(letter.stage)) return undefined;
  const days = daysUntil(letter.dueOn, today);
  if (days < 0) return { text: `Quá hạn ${-days} ngày`, tone: 'danger' };
  if (days === 0) return { text: 'Đến hạn hôm nay', tone: 'warning' };
  return { text: `Còn ${days} ngày`, tone: days <= 2 ? 'warning' : 'muted' };
}

/** Ngày hôm nay theo giờ máy người dùng, `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'Đang tải lên';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
}

/* ------------------------------------------------------------ xem trước */

export type PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'docx' | 'sheet' | 'pptx' | 'none';

const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'json', 'xml', 'log', 'html', 'htm', 'yaml', 'yml', 'ini', 'sql']);
const SHEET_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv']);

/**
 * Cách xem trước một tệp ngay trong trang, không cần tải về: PDF, ảnh, video, âm thanh bằng
 * trình xem của trình duyệt; Word (.docx), bảng tính (.xlsx, .xls, .ods, .csv), trình chiếu
 * (.pptx), văn bản thuần dựng ngay trong trình duyệt. Chỉ định dạng nhị phân đời cũ
 * (.doc, .ppt) và tệp nén là phải tải về.
 */
export function previewKind(contentType: string, fileName: string): PreviewKind {
  const type = contentType.toLowerCase();
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'ogv'].includes(extension)) return 'video';
  if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(extension)) return 'audio';
  if (extension === 'docx' || type.includes('wordprocessingml')) return 'docx';
  if (extension === 'pptx' || type.includes('presentationml')) return 'pptx';
  if (SHEET_EXTENSIONS.has(extension) || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel' || type === 'text/csv') {
    return 'sheet';
  }
  if (type.startsWith('text/') || TEXT_EXTENSIONS.has(extension) || type === 'application/json' || type === 'application/xml') return 'text';
  return 'none';
}

/* ------------------------------------------------------------ nhắc tên */

export interface MentionQuery {
  readonly start: number;
  readonly query: string;
}

/** "@truy-van" ngay trước con trỏ (sau khoảng trắng hay đầu dòng), như ô chat. */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s{2,}/.test(query)) return null;
  return { start: at, query };
}

/** Thay "@truy-van" trước con trỏ bằng "@Họ Tên " và trả vị trí con trỏ mới. */
export function applyMention(text: string, mention: MentionQuery, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, mention.start) + inserted + text.slice(caret), caret: mention.start + inserted.length };
}

/** Chỉ giữ người còn "@Họ Tên" trong nội dung (người dùng có thể đã xoá lời nhắc). */
export function keptMentions(text: string, picked: ReadonlyMap<string, string>): string[] {
  return [...picked.entries()].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
}

/** Tách nội dung thành chữ và lời nhắc tên để tô màu; dò tên dài trước. */
export function splitMentions(
  body: string,
  mentions: readonly { readonly userId: string; readonly name?: string }[],
): { readonly text: string; readonly mention: boolean }[] {
  const names = mentions
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) return [{ text: body, mention: false }];
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return parts.filter((part) => part !== '').map((part) => ({ text: part, mention: part.startsWith('@') && names.includes(part.slice(1)) }));
}

/** Gợi ý người theo tên, không phân biệt dấu. */
export function suggestPeople<T extends { readonly userId: string; readonly name: string }>(
  people: readonly T[],
  query: string,
  excludeId?: string,
  limit = 8,
): T[] {
  const needle = normalize(query.trim());
  return people
    .filter((person) => person.userId !== excludeId && (!needle || normalize(person.name).includes(needle)))
    .slice(0, limit);
}

/** Lọc nhanh trong danh sách đã tải: số, trích yếu, cơ quan, nơi nhận, phòng soạn, không phân biệt dấu. */
export function matchesSearch(letter: LetterSummary, search: string): boolean {
  const needle = normalize(search.trim());
  if (!needle) return true;
  return [
    letter.displayNo,
    letter.incomingNo,
    letter.subject,
    letter.senderOrg,
    letter.senderRef,
    letter.outgoingNo,
    letter.archiveCode,
    letter.recipient,
    letter.authorUnitName,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value).includes(needle));
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
