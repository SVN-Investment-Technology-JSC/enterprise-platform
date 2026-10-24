import {
  SOCIAL_POLL_OPTIONS_MAX,
  SOCIAL_POLL_OPTIONS_MIN,
  SOCIAL_POLL_OPTION_MAX,
  SOCIAL_POLL_QUESTION_MAX,
} from '@enterprise-platform/contracts-social';
import { requireUuid } from './social-rules.js';
import { SocialValidationError } from './social.error.js';

export interface NormalizedPoll {
  readonly question: string;
  readonly options: readonly string[];
  readonly allowMultiple: boolean;
  readonly anonymous: boolean;
  /** ISO UTC; thiếu là không hạn. */
  readonly closesAt?: string;
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new SocialValidationError(`${label} không hợp lệ.`);
  return value;
}

/** Hạn đóng phải là thời điểm hợp lệ ở tương lai. */
export function normalizeClosesAt(value: unknown, now: Date): string {
  if (typeof value !== 'string' || !value.trim()) throw new SocialValidationError('Hạn đóng bình chọn không hợp lệ.');
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new SocialValidationError('Hạn đóng bình chọn không hợp lệ.');
  if (time <= now.getTime()) throw new SocialValidationError('Hạn đóng bình chọn phải ở tương lai.');
  return new Date(time).toISOString();
}

/** Làm sạch và kiểm bình chọn của bài mới: 2–10 lựa chọn, không trùng, độ dài trong giới hạn. */
export function normalizePoll(input: unknown, now: Date): NormalizedPoll {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SocialValidationError('Bình chọn không hợp lệ.');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw['question'] !== 'string') throw new SocialValidationError('Hãy nhập câu hỏi cho bình chọn.');
  const question = raw['question'].trim().replace(/\s+/g, ' ');
  if (!question) throw new SocialValidationError('Hãy nhập câu hỏi cho bình chọn.');
  if (question.length > SOCIAL_POLL_QUESTION_MAX) {
    throw new SocialValidationError(`Câu hỏi bình chọn tối đa ${SOCIAL_POLL_QUESTION_MAX} ký tự.`);
  }

  if (!Array.isArray(raw['options'])) throw new SocialValidationError('Bình chọn cần danh sách lựa chọn.');
  const options = raw['options'].map((item) => {
    if (typeof item !== 'string') throw new SocialValidationError('Lựa chọn của bình chọn không hợp lệ.');
    const text = item.trim().replace(/\s+/g, ' ');
    if (!text) throw new SocialValidationError('Lựa chọn của bình chọn không được để trống.');
    if (text.length > SOCIAL_POLL_OPTION_MAX) {
      throw new SocialValidationError(`Mỗi lựa chọn tối đa ${SOCIAL_POLL_OPTION_MAX} ký tự.`);
    }
    return text;
  });
  if (options.length < SOCIAL_POLL_OPTIONS_MIN || options.length > SOCIAL_POLL_OPTIONS_MAX) {
    throw new SocialValidationError(
      `Bình chọn cần từ ${SOCIAL_POLL_OPTIONS_MIN} đến ${SOCIAL_POLL_OPTIONS_MAX} lựa chọn.`,
    );
  }
  if (new Set(options.map((text) => text.toLowerCase())).size !== options.length) {
    throw new SocialValidationError('Các lựa chọn của bình chọn không được trùng nhau.');
  }

  const closesAt =
    raw['closesAt'] === undefined || raw['closesAt'] === null ? undefined : normalizeClosesAt(raw['closesAt'], now);

  return {
    question,
    options,
    allowMultiple: optionalBoolean(raw['allowMultiple'], 'Kiểu chọn nhiều'),
    anonymous: optionalBoolean(raw['anonymous'], 'Kiểu ẩn danh'),
    ...(closesAt ? { closesAt } : {}),
  };
}

export interface PollTiming {
  readonly closedAt?: string;
  readonly closesAt?: string;
}

/** Bình chọn đã đóng: đóng sớm thủ công hoặc quá hạn. */
export function isPollClosed(poll: PollTiming, now: Date): boolean {
  if (poll.closedAt) return true;
  return poll.closesAt !== undefined && new Date(poll.closesAt).getTime() <= now.getTime();
}

/**
 * Lựa chọn của một lần bỏ phiếu: đúng UUID, không trùng, thuộc bình chọn; chọn một thì tối đa một
 * phần tử. Mảng rỗng là bỏ phiếu.
 */
export function normalizeVoteOptions(
  optionIds: unknown,
  poll: { readonly allowMultiple: boolean; readonly options: readonly { readonly id: string }[] },
): string[] {
  if (!Array.isArray(optionIds)) throw new SocialValidationError('Danh sách lựa chọn không hợp lệ.');
  const ids = [...new Set(optionIds.map((id) => requireUuid(id, 'Mã lựa chọn').toLowerCase()))];
  const known = new Set(poll.options.map((option) => option.id.toLowerCase()));
  if (ids.some((id) => !known.has(id))) throw new SocialValidationError('Có lựa chọn không thuộc bình chọn này.');
  if (!poll.allowMultiple && ids.length > 1) {
    throw new SocialValidationError('Bình chọn này chỉ cho chọn một lựa chọn.');
  }
  return ids;
}
