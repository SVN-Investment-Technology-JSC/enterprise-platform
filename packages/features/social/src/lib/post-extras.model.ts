import {
  SOCIAL_POLL_OPTION_MAX,
  SOCIAL_POLL_OPTIONS_MAX,
  SOCIAL_POLL_OPTIONS_MIN,
  SOCIAL_POLL_QUESTION_MAX,
  SOCIAL_POST_STATUS_LABELS,
  SOCIAL_SCHEDULE_MAX_DAYS,
  SOCIAL_SCHEDULE_MIN_LEAD_SECONDS,
  type CreateSocialPollRequest,
  type SocialPost,
} from '@enterprise-platform/contracts-social';

/** Logic thuần của bài viết P2: hẹn giờ theo giờ Việt Nam, bản nháp bình chọn, huy hiệu trạng thái. */

/** Việt Nam dùng UTC+7 quanh năm, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** Ghép ngày `YYYY-MM-DD` và giờ `HH:mm` (giờ Việt Nam) thành chuỗi ISO UTC; `undefined` khi sai định dạng. */
export function vnPartsToIso(date: string, time: string): string | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return undefined;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return undefined;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS;
  // Loại ngày không có thật (30/02): ngày tính ngược phải khớp.
  const back = new Date(utc + VN_OFFSET_MS);
  if (back.getUTCDate() !== day || back.getUTCMonth() !== month - 1)
    return undefined;
  return new Date(utc).toISOString();
}

/** Tách chuỗi ISO thành ngày và giờ theo giờ Việt Nam. */
export function isoToVnParts(
  iso: string,
): { readonly date: string; readonly time: string } | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  const vn = new Date(ms + VN_OFFSET_MS);
  return {
    date: `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`,
    time: `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`,
  };
}

/** `HH:mm dd/mm/yyyy` theo giờ Việt Nam. */
export function formatVnDateTime(iso: string): string {
  const parts = isoToVnParts(iso);
  if (!parts) return '';
  const [year, month, day] = parts.date.split('-');
  return `${parts.time} ${day}/${month}/${year}`;
}

/** Ngày hiện tại (giờ Việt Nam) dạng `YYYY-MM-DD`, dùng làm cận dưới ô chọn ngày. */
export function vnToday(now: number = Date.now()): string {
  return isoToVnParts(new Date(now).toISOString())?.date ?? '';
}

/** Kiểm giờ hẹn người dùng nhập; trả lời nhắn lỗi tiếng Việt hoặc `undefined` nếu hợp lệ. */
export function validateSchedule(
  date: string,
  time: string,
  now: number = Date.now(),
): string | undefined {
  if (!date || !time) return 'Hãy chọn ngày và giờ đăng.';
  const iso = vnPartsToIso(date, time);
  if (!iso) return 'Ngày giờ hẹn không hợp lệ.';
  const at = Date.parse(iso);
  if (at < now + SOCIAL_SCHEDULE_MIN_LEAD_SECONDS * 1000) {
    return 'Giờ hẹn phải cách hiện tại ít nhất 1 phút.';
  }
  if (at > now + SOCIAL_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000) {
    return `Giờ hẹn không được quá ${SOCIAL_SCHEDULE_MAX_DAYS} ngày.`;
  }
  return undefined;
}

/* ------------------------------------------------------------------ bình chọn */

export interface PollDraft {
  readonly question: string;
  readonly options: readonly string[];
  readonly allowMultiple: boolean;
  readonly anonymous: boolean;
  /** Hạn đóng theo giờ Việt Nam; cả hai rỗng là không hạn. */
  readonly closeDate: string;
  readonly closeTime: string;
}

export const emptyPollDraft = (): PollDraft => ({
  question: '',
  options: ['', ''],
  allowMultiple: false,
  anonymous: false,
  closeDate: '',
  closeTime: '',
});

export function addPollOption(draft: PollDraft): PollDraft {
  if (draft.options.length >= SOCIAL_POLL_OPTIONS_MAX) return draft;
  return { ...draft, options: [...draft.options, ''] };
}

export function removePollOption(draft: PollDraft, index: number): PollDraft {
  if (draft.options.length <= SOCIAL_POLL_OPTIONS_MIN) return draft;
  return {
    ...draft,
    options: draft.options.filter((_, position) => position !== index),
  };
}

export function setPollOption(
  draft: PollDraft,
  index: number,
  text: string,
): PollDraft {
  return {
    ...draft,
    options: draft.options.map((item, position) =>
      position === index ? text : item,
    ),
  };
}

/** Hạn đóng đã nhập (ISO) nếu có; `null` khi để trống; `undefined` khi nhập dở/sai. */
export function pollCloseIso(
  draft: Pick<PollDraft, 'closeDate' | 'closeTime'>,
): string | null | undefined {
  if (!draft.closeDate && !draft.closeTime) return null;
  if (!draft.closeDate || !draft.closeTime) return undefined;
  return vnPartsToIso(draft.closeDate, draft.closeTime);
}

export function validatePollDraft(
  draft: PollDraft,
  now: number = Date.now(),
): string | undefined {
  const question = draft.question.trim();
  if (!question) return 'Hãy nhập câu hỏi bình chọn.';
  if (question.length > SOCIAL_POLL_QUESTION_MAX)
    return 'Câu hỏi bình chọn quá dài.';
  const options = draft.options.map((item) => item.trim());
  if (options.some((item) => !item))
    return 'Mỗi lựa chọn của bình chọn cần có nội dung.';
  if (
    options.length < SOCIAL_POLL_OPTIONS_MIN ||
    options.length > SOCIAL_POLL_OPTIONS_MAX
  ) {
    return `Bình chọn cần từ ${SOCIAL_POLL_OPTIONS_MIN} đến ${SOCIAL_POLL_OPTIONS_MAX} lựa chọn.`;
  }
  if (options.some((item) => item.length > SOCIAL_POLL_OPTION_MAX))
    return 'Có lựa chọn quá dài.';
  if (
    new Set(options.map((item) => item.toLocaleLowerCase('vi'))).size !==
    options.length
  ) {
    return 'Các lựa chọn của bình chọn không được trùng nhau.';
  }
  const close = pollCloseIso(draft);
  if (close === undefined) return 'Hãy chọn đủ ngày và giờ đóng bình chọn.';
  if (close !== null && Date.parse(close) <= now)
    return 'Hạn đóng bình chọn phải ở tương lai.';
  return undefined;
}

export function buildPollRequest(draft: PollDraft): CreateSocialPollRequest {
  const close = pollCloseIso(draft);
  return {
    question: draft.question.trim(),
    options: draft.options.map((item) => item.trim()),
    allowMultiple: draft.allowMultiple,
    anonymous: draft.anonymous,
    ...(close ? { closesAt: close } : {}),
  };
}

/** Phần trăm làm tròn của một lựa chọn trên số người bỏ phiếu. */
export function pollPercent(voteCount: number, totalVoters: number): number {
  if (totalVoters <= 0 || voteCount <= 0) return 0;
  return Math.min(100, Math.round((voteCount / totalVoters) * 100));
}

/** Bật/tắt một lựa chọn: chọn một thì thay thế, chọn nhiều thì thêm/bớt. */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  allowMultiple: boolean,
): readonly string[] {
  if (!allowMultiple)
    return selected.includes(id) && selected.length === 1 ? [] : [id];
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id];
}

export function sameSelection(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/* ------------------------------------------------------------ huy hiệu trạng thái */

export type PostBadgeTone = 'warning' | 'danger' | 'info' | 'neutral';

export interface PostBadgeInfo {
  readonly key: string;
  readonly label: string;
  readonly tone: PostBadgeTone;
}

/** Huy hiệu trạng thái của bài (không gồm nhãn nhóm). Bài đã đăng chỉ có thông báo và ghim. */
export function postStatusBadges(
  post: Pick<SocialPost, 'status' | 'kind' | 'pinned' | 'scheduledAt'>,
): readonly PostBadgeInfo[] {
  const badges: PostBadgeInfo[] = [];
  const status = post.status ?? 'published';
  if (status === 'pending')
    badges.push({
      key: 'pending',
      label: SOCIAL_POST_STATUS_LABELS.pending,
      tone: 'warning',
    });
  if (status === 'rejected')
    badges.push({
      key: 'rejected',
      label: SOCIAL_POST_STATUS_LABELS.rejected,
      tone: 'danger',
    });
  if (status === 'scheduled') {
    const when = post.scheduledAt
      ? ` ${formatVnDateTime(post.scheduledAt)}`
      : '';
    badges.push({
      key: 'scheduled',
      label: `${SOCIAL_POST_STATUS_LABELS.scheduled}${when}`,
      tone: 'info',
    });
  }
  if (post.kind === 'announcement')
    badges.push({ key: 'announcement', label: 'Thông báo', tone: 'neutral' });
  if (post.pinned)
    badges.push({ key: 'pinned', label: 'Đã ghim', tone: 'neutral' });
  return badges;
}

/** Bài đã đăng mới nhận phản ứng, bình luận, bỏ phiếu, xác nhận đã đọc. */
export const isPublished = (post: Pick<SocialPost, 'status'>): boolean =>
  (post.status ?? 'published') === 'published';

/** Tiến độ xác nhận đã đọc (0–100) hoặc `undefined` khi chưa biết số liệu. */
export function readConfirmationProgress(
  confirmed?: number,
  audience?: number,
): number | undefined {
  if (confirmed === undefined || audience === undefined) return undefined;
  if (audience <= 0) return 100;
  return Math.min(100, Math.round((confirmed / audience) * 100));
}
