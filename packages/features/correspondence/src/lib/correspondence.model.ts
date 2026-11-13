import {
  daysUntil,
  isOpenStage,
  LETTER_STAGE_LABELS,
  type CatalogItem,
  type CatalogKind,
  type LetterStage,
  type LetterSummary,
} from '@enterprise-platform/contracts-correspondence';

/** Màn hình của phân hệ; `letters` là liên kết mở thẳng một công văn (`#letters/<id>`). */
export const CORRESPONDENCE_VIEWS = ['overview', 'mine', 'incoming', 'outgoing', 'archive', 'settings', 'letters'] as const;
export type CorrespondenceView = (typeof CORRESPONDENCE_VIEWS)[number];

export type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'muted';

/** Màu nhãn của bước: chờ lãnh đạo vàng, phòng ban xử lý xanh, lưu trữ xanh lá, huỷ xám. */
export function stageTone(stage: LetterStage): Tone {
  switch (stage) {
    case 'received':
    case 'registered':
      return 'neutral';
    case 'directing':
    case 'reviewing':
      return 'warning';
    case 'processing':
    case 'publishing':
    case 'closing':
      return 'info';
    case 'archived':
      return 'success';
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

/** Xem được ngay trong trình duyệt (PDF, ảnh); còn lại thì tải về. */
export function isPreviewable(contentType: string): boolean {
  return contentType === 'application/pdf' || /^image\/(jpeg|png|gif|webp)$/.test(contentType);
}

/** Lọc nhanh trong danh sách đã tải: số đến, số đi, số hồ sơ, trích yếu, cơ quan, không phân biệt dấu. */
export function matchesSearch(letter: LetterSummary, search: string): boolean {
  const needle = normalize(search.trim());
  if (!needle) return true;
  return [letter.incomingNo, letter.subject, letter.senderOrg, letter.senderRef, letter.outgoingNo, letter.archiveCode, letter.recipient]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value).includes(needle));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
