import type {
  ChatConversationKind,
  ChatMemberView,
  ChatMessagePreview,
  ChatMessageView,
  ChatPerson,
  ChatSystemEvent,
} from '@enterprise-platform/contracts-chat';

/* -------------------------------- Chữ và tên -------------------------------- */

/** Bỏ dấu, chữ thường: gõ "binh" tìm được "Bình". */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function matchesPerson(person: Pick<ChatPerson, 'fullName' | 'email'>, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fold(person.fullName).includes(needle) || fold(person.email).includes(needle);
}

/* --------------------------------- Nhắc tên --------------------------------- */

export interface MentionQuery {
  /** Vị trí ký tự "@". */
  readonly start: number;
  readonly query: string;
}

/**
 * Đang gõ một lời nhắc tên ngay trước con trỏ: "@" ở đầu dòng hoặc sau khoảng trắng, theo sau là chữ (cho phép
 * khoảng trắng vì tên tiếng Việt có nhiều tiếng), chưa xuống dòng và chưa quá dài.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s{2,}/.test(query)) return null;
  return { start: at, query };
}

export function suggestPeople(
  people: readonly ChatPerson[],
  query: string,
  options: { readonly excludeId?: string; readonly allowedIds?: ReadonlySet<string>; readonly limit?: number } = {},
): ChatPerson[] {
  const exclude = options.excludeId?.toLowerCase();
  return people
    .filter((person) => person.id.toLowerCase() !== exclude)
    .filter((person) => !options.allowedIds || options.allowedIds.has(person.id.toLowerCase()))
    .filter((person) => matchesPerson(person, query))
    .slice(0, options.limit ?? 8);
}

/** Thay "@truy-van" trước con trỏ bằng "@Họ Tên " và trả vị trí con trỏ mới. */
export function applyMention(text: string, mention: MentionQuery, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  const next = text.slice(0, mention.start) + inserted + text.slice(caret);
  return { text: next, caret: mention.start + inserted.length };
}

/** Chỉ giữ người còn "@Họ Tên" trong nội dung (người dùng có thể đã xoá lời nhắc). */
export function keptMentions(text: string, picked: ReadonlyMap<string, string>): string[] {
  return [...picked.entries()].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
}

export type BodySegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly text: string; readonly userId: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

function linkify(text: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    segments.push({ kind: 'link', text: match[0], href: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Tách nội dung tin thành chữ thường, lời nhắc tên (tô màu) và liên kết. Lời nhắc chỉ tính với người thật sự được
 * nhắc trong tin (`mentions`), dò tên dài trước để "@Nguyễn Văn An" không bị cắt thành "@Nguyễn".
 */
export function splitBody(body: string, mentioned: readonly { readonly id: string; readonly name: string }[]): BodySegment[] {
  const names = [...mentioned].filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  const segments: BodySegment[] = [];
  let rest = body;
  while (rest.length > 0) {
    let best: { index: number; id: string; token: string } | null = null;
    for (const person of names) {
      const token = `@${person.name}`;
      const index = rest.indexOf(token);
      if (index >= 0 && (!best || index < best.index)) best = { index, id: person.id, token };
    }
    if (!best) {
      segments.push(...linkify(rest));
      break;
    }
    if (best.index > 0) segments.push(...linkify(rest.slice(0, best.index)));
    segments.push({ kind: 'mention', text: best.token, userId: best.id });
    rest = rest.slice(best.index + best.token.length);
  }
  return segments;
}

/* ------------------------------ Danh sách tin ------------------------------ */

/** Gộp trang tin mới tải vào danh sách đang có: tin trùng id lấy bản mới, sắp theo thời gian. */
export function mergeMessages(current: readonly ChatMessageView[], incoming: readonly ChatMessageView[]): ChatMessageView[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const RUN_GAP_MS = 5 * 60_000;

export type ThreadItem =
  | { readonly kind: 'date'; readonly key: string; readonly label: string }
  | { readonly kind: 'system'; readonly key: string; readonly message: ChatMessageView }
  | {
      readonly kind: 'message';
      readonly key: string;
      readonly message: ChatMessageView;
      /** Tin đầu của một chuỗi tin liền nhau của cùng người (hiện tên, ảnh). */
      readonly first: boolean;
      /** Tin cuối của chuỗi. */
      readonly last: boolean;
    };

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** Dải tin để vẽ: mốc ngày, tin hệ thống, và các chuỗi tin liền nhau của cùng một người (cách nhau dưới 5 phút). */
export function threadItems(messages: readonly ChatMessageView[], now: Date = new Date()): ThreadItem[] {
  const items: ThreadItem[] = [];
  let previousDay = '';
  messages.forEach((message, index) => {
    const day = dayKey(message.createdAt);
    if (day !== previousDay) {
      items.push({ kind: 'date', key: `date-${day}`, label: dayLabel(message.createdAt, now) });
      previousDay = day;
    }
    if (message.kind === 'system') {
      items.push({ kind: 'system', key: message.id, message });
      return;
    }
    const before = messages[index - 1];
    const after = messages[index + 1];
    const joins = (other: ChatMessageView | undefined) =>
      Boolean(
        other &&
          other.kind === 'text' &&
          other.senderId === message.senderId &&
          dayKey(other.createdAt) === day &&
          Math.abs(Date.parse(other.createdAt) - Date.parse(message.createdAt)) < RUN_GAP_MS,
      );
    items.push({ kind: 'message', key: message.id, message, first: !joins(before), last: !joins(after) });
  });
  return items;
}

/* ------------------------------ Trạng thái tin ------------------------------ */

export type DeliveryStatus =
  | { readonly kind: 'sending' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'seen'; readonly readers: readonly string[] };

/**
 * Trạng thái tin của chính mình: đã xem khi có ít nhất một người khác đọc tới tin này, đã nhận khi trình duyệt của
 * người khác đã tải về, còn lại là đã gửi. `readers` là những người đã xem (để hiện ảnh nhỏ).
 */
export function deliveryStatus(message: Pick<ChatMessageView, 'createdAt'>, members: readonly ChatMemberView[], me: string): DeliveryStatus {
  const others = members.filter((member) => member.userId.toLowerCase() !== me.toLowerCase());
  const readers = others.filter((member) => member.lastReadAt && member.lastReadAt >= message.createdAt).map((m) => m.userId);
  if (readers.length > 0) return { kind: 'seen', readers };
  if (others.some((member) => member.lastDeliveredAt && member.lastDeliveredAt >= message.createdAt)) return { kind: 'delivered' };
  return { kind: 'sent' };
}

export function canEdit(message: Pick<ChatMessageView, 'createdAt'>, windowMinutes: number, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(message.createdAt) <= windowMinutes * 60_000;
}

/* ------------------------------ Chữ hiển thị ------------------------------ */

export type NameOf = (userId: string) => string;

export function systemText(event: ChatSystemEvent, actor: string, nameOf: NameOf): string {
  switch (event.type) {
    case 'group.created':
      return `${actor} đã tạo nhóm "${event.title}"`;
    case 'members.added':
      return `${actor} đã thêm ${event.userIds.map(nameOf).join(', ')} vào nhóm`;
    case 'member.removed':
      return `${actor} đã mời ${nameOf(event.userId)} ra khỏi nhóm`;
    case 'member.left':
      return `${actor} đã rời nhóm`;
    case 'title.changed':
      return `${actor} đã đổi tên nhóm thành "${event.title}"`;
  }
}

/** Dòng phụ dưới tên cuộc trò chuyện ở danh sách: "Bạn: ...", "An: ...", "[Ảnh]"... */
export function previewText(
  preview: ChatMessagePreview | null,
  options: { readonly me: string; readonly kind: ChatConversationKind; readonly nameOf: NameOf },
): string {
  if (!preview) return 'Chưa có tin nhắn';
  const mine = preview.senderId.toLowerCase() === options.me.toLowerCase();
  const sender = mine ? 'Bạn' : options.nameOf(preview.senderId);
  if (preview.kind === 'system' && preview.systemEvent) return systemText(preview.systemEvent, sender, options.nameOf);
  if (preview.isDeleted) return `${sender} đã thu hồi một tin nhắn`;
  const content =
    preview.excerpt ||
    (preview.hasImage ? (preview.attachmentCount > 1 ? `${preview.attachmentCount} ảnh` : 'Ảnh') : `${preview.attachmentCount} tệp đính kèm`);
  // 1-1 thì tin của người kia không cần ghi tên (đã là tên cuộc trò chuyện).
  return mine || options.kind !== 'direct' ? `${sender}: ${content}` : content;
}

/** Giờ ở danh sách: hôm nay "08:30", trong tuần "Th 3", cũ hơn "12/10". */
export function shortTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) return ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'][date.getDay()];
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Ảnh dán từ khay nhớ tạm hay kéo thả vào (tệp ảnh trong `DataTransfer`). */
export function filesOf(list: FileList | readonly File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list as ArrayLike<File>).filter((file) => file && file.size > 0);
}

/** Ảnh chụp màn hình dán vào thường tên "image.png" ở mọi lần: đặt tên riêng để phân biệt. */
export function namePastedFile(file: File, index: number, now: Date = new Date()): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'blob') return file;
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const extension = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  return new File([file], `anh-dan-${stamp}${index > 0 ? `-${index + 1}` : ''}.${extension}`, { type: file.type || 'image/png' });
}
