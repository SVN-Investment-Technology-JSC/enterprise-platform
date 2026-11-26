/**
 * Trang của một phân hệ được mở trong popup (iframe) của phân hệ khác, ví dụ phiếu Tài chính ngay trong hồ sơ Quy trình.
 *
 * Hai phân hệ không import code hay hợp đồng của nhau: bên chủ chỉ biết đường dẫn trang nhúng của phân hệ kia, còn trang
 * nhúng tự quyết quyền và nghiệp vụ bằng chính API của phân hệ đó. Chúng chỉ báo cho nhau bằng `postMessage` cùng tên miền ERP,
 * và bên nhận luôn kiểm `event.origin` lẫn `event.source` trước khi đọc.
 */
export const MODULE_EMBED_MESSAGE = {
  /** Trang nhúng đã ghi thay đổi (ví dụ ghi sổ, trả hồ sơ): bên chủ tải lại dữ liệu của mình. */
  changed: 'savina-embed:changed',
  /** Trang nhúng xin đóng popup (ví dụ phiếu vừa bị xoá, không còn gì để xem). */
  close: 'savina-embed:close',
  /** Trang nhúng báo mã và trạng thái hiện tại để bên chủ hiện ở tiêu đề popup (không lặp lại trong trang). */
  summary: 'savina-embed:summary',
} as const;

export type ModuleEmbedMessageType = (typeof MODULE_EMBED_MESSAGE)[keyof typeof MODULE_EMBED_MESSAGE];

/** Màu nhãn trạng thái ở tiêu đề popup; bên chủ tự quyết màu cụ thể, trang nhúng chỉ nêu ý nghĩa. */
export const MODULE_EMBED_BADGE_TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export type ModuleEmbedBadgeTone = (typeof MODULE_EMBED_BADGE_TONES)[number];

export interface ModuleEmbedBadge {
  readonly label: string;
  readonly tone: ModuleEmbedBadgeTone;
}

export interface ModuleEmbedSummary {
  readonly type: typeof MODULE_EMBED_MESSAGE.summary;
  /** Mã đang hiện của bản ghi (ví dụ mã phiếu), ngắn. */
  readonly code?: string;
  /** Ghi chú ngắn kèm mã (ví dụ "Mã nháp: NHAP_PC_…"). */
  readonly note?: string;
  readonly badges?: readonly ModuleEmbedBadge[];
}

export type ModuleEmbedMessage =
  | { readonly type: typeof MODULE_EMBED_MESSAGE.changed | typeof MODULE_EMBED_MESSAGE.close }
  | ModuleEmbedSummary;

const MAX_TEXT = 120;
const MAX_BADGES = 4;
const shortText = (value: unknown): boolean => value === undefined || (typeof value === 'string' && value.length <= MAX_TEXT);

function isBadge(value: unknown): value is ModuleEmbedBadge {
  if (typeof value !== 'object' || value === null) return false;
  const badge = value as Record<string, unknown>;
  return (
    typeof badge['label'] === 'string' &&
    badge['label'].length > 0 &&
    badge['label'].length <= MAX_TEXT &&
    MODULE_EMBED_BADGE_TONES.includes(badge['tone'] as ModuleEmbedBadgeTone)
  );
}

/** Kiểm hình dạng tin nhắn nhận qua `postMessage` (chữ ngắn, tối đa 4 nhãn); không thay cho việc kiểm `event.origin` và `event.source`. */
export function isModuleEmbedMessage(value: unknown): value is ModuleEmbedMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['type'] === MODULE_EMBED_MESSAGE.changed || record['type'] === MODULE_EMBED_MESSAGE.close) return true;
  if (record['type'] !== MODULE_EMBED_MESSAGE.summary) return false;
  const badges = record['badges'];
  return (
    shortText(record['code']) &&
    shortText(record['note']) &&
    (badges === undefined || (Array.isArray(badges) && badges.length <= MAX_BADGES && badges.every(isBadge)))
  );
}

/** `true` khi trang đang nằm trong iframe (không phải cửa sổ ngoài cùng). */
export function isInsideFrame(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return false;
  }
}

/** Trang nhúng báo bên chủ. Không làm gì khi trang đang mở ở cửa sổ ngoài cùng. */
export function postModuleEmbedMessage(type: typeof MODULE_EMBED_MESSAGE.changed | typeof MODULE_EMBED_MESSAGE.close): void {
  if (!isInsideFrame()) return;
  const message: ModuleEmbedMessage = { type };
  window.parent.postMessage(message, window.location.origin);
}

/** Trang nhúng báo mã và trạng thái để bên chủ hiện ở tiêu đề popup. */
export function postModuleEmbedSummary(summary: Omit<ModuleEmbedSummary, 'type'>): void {
  if (!isInsideFrame()) return;
  const message: ModuleEmbedSummary = { type: MODULE_EMBED_MESSAGE.summary, ...summary };
  window.parent.postMessage(message, window.location.origin);
}

/**
 * Bên chủ nghe tin của đúng iframe của mình: chỉ nhận khi cùng tên miền và đúng cửa sổ con. Trả hàm gỡ nghe.
 */
export function listenModuleEmbed(
  frame: () => Window | null | undefined,
  onMessage: (message: ModuleEmbedMessage) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    const target = frame();
    if (!target || event.origin !== window.location.origin || event.source !== target) return;
    if (isModuleEmbedMessage(event.data)) onMessage(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Phần tử cho biết trang nhúng đang có lớp phủ mở (danh sách chọn, hộp xác nhận, lịch…): Esc lúc đó dành cho lớp phủ. */
const OPEN_OVERLAY_SELECTOR = [
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="tooltip"]',
  '[aria-expanded="true"]',
  '.ant-popover:not(.ant-popover-hidden)',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
].join(',');

/**
 * Esc trong trang nhúng: tiêu điểm nằm trong iframe nên phím không tới popup của bên chủ. Chỉ khi không còn lớp phủ nào
 * đang mở và không ai xử lý phím này thì xin bên chủ đóng popup (Esc đóng lớp phủ trước, popup sau).
 */
export function forwardEscapeToHost(
  event: { key: string; defaultPrevented: boolean; target: EventTarget | null },
  root: ParentNode = document,
): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || !isInsideFrame()) return false;
  if (root.querySelector(OPEN_OVERLAY_SELECTOR)) return false;
  postModuleEmbedMessage(MODULE_EMBED_MESSAGE.close);
  return true;
}
