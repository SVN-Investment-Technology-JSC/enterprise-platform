import {
  SOCIAL_AUDIENCE_MAX_UNITS,
  SOCIAL_AUDIENCE_MAX_USERS,
  SOCIAL_POST_VISIBILITIES,
  SOCIAL_POST_VISIBILITY_LABELS,
  type SocialPost,
  type SocialPostAudienceInput,
  type SocialPostVisibility,
  type SocialUnitRef,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { isPublished } from './post-extras.model';

/** Logic thuần của quyền xem bài, menu thẻ bài và lịch sử sửa (đợt 2). */

/** Mô tả từng lựa chọn trong hộp "Tùy chỉnh quyền xem". */
export const VISIBILITY_OPTION_HINTS: Readonly<Record<SocialPostVisibility, string>> = {
  company: 'Bất kỳ đồng nghiệp nào cũng có thể xem bài viết',
  unit: 'Chỉ những đồng nghiệp trong phòng ban của bạn mới có thể xem bài viết',
  custom: 'Chỉ những người hoặc phòng ban được chọn mới có thể xem bài viết',
  private: 'Chỉ duy nhất mình tôi có thể xem được bài viết',
};

export const VISIBILITY_OPTIONS = SOCIAL_POST_VISIBILITIES.map((value) => ({
  value,
  label: SOCIAL_POST_VISIBILITY_LABELS[value],
  hint: VISIBILITY_OPTION_HINTS[value],
}));

/** Thông báo, ghim, @all và xác nhận đã đọc chỉ đi với quyền xem Công khai. */
export const allowsCompanyOnlyExtras = (visibility: SocialPostVisibility): boolean =>
  visibility === 'company';

/** Quyền xem của bài (thiếu nghĩa là Công khai). */
export const postVisibility = (post: Pick<SocialPost, 'visibility'>): SocialPostVisibility =>
  post.visibility ?? 'company';

/** Bài có cần huy hiệu quyền xem không (Công khai thì không hiện). */
export function visibilityBadgeLabel(post: Pick<SocialPost, 'visibility' | 'group'>): string | undefined {
  if (post.group) return undefined;
  const visibility = postVisibility(post);
  return visibility === 'company' ? undefined : SOCIAL_POST_VISIBILITY_LABELS[visibility];
}

const plural = (count: number, noun: string) => `${count.toLocaleString('vi-VN')} ${noun}`;

/** Tóm tắt danh sách chia sẻ: "3 người, 2 phòng ban". */
export function summarizeAudience(
  users: readonly SocialUserRef[],
  units: readonly SocialUnitRef[],
): string {
  const parts: string[] = [];
  if (users.length > 0) parts.push(plural(users.length, 'người'));
  const departments = units.filter((unit) => unit.kind === 'unit').length;
  const positions = units.length - departments;
  if (departments > 0) parts.push(plural(departments, 'phòng ban'));
  if (positions > 0) parts.push(plural(positions, 'vị trí'));
  return parts.join(', ');
}

/** Dòng tóm tắt quyền xem ở đầu hộp soạn. */
export function describeVisibility(
  visibility: SocialPostVisibility,
  users: readonly SocialUserRef[],
  units: readonly SocialUnitRef[],
): string {
  if (visibility === 'custom') {
    const summary = summarizeAudience(users, units);
    return summary ? `Chỉ ${summary} được chọn xem được` : 'Chưa chọn người hoặc phòng ban nào';
  }
  return VISIBILITY_OPTION_HINTS[visibility];
}

/** Lỗi tiếng Việt của lựa chọn quyền xem, hoặc `undefined` nếu hợp lệ. */
export function validateVisibility(
  visibility: SocialPostVisibility,
  users: readonly SocialUserRef[],
  units: readonly SocialUnitRef[],
): string | undefined {
  if (visibility !== 'custom') return undefined;
  if (users.length === 0 && units.length === 0) {
    return 'Hãy chọn ít nhất một người hoặc phòng ban được xem bài.';
  }
  if (users.length > SOCIAL_AUDIENCE_MAX_USERS) {
    return `Chỉ chọn được tối đa ${SOCIAL_AUDIENCE_MAX_USERS} người.`;
  }
  if (units.length > SOCIAL_AUDIENCE_MAX_UNITS) {
    return `Chỉ chọn được tối đa ${SOCIAL_AUDIENCE_MAX_UNITS} phòng ban hoặc vị trí.`;
  }
  return undefined;
}

/** Danh sách chia sẻ gửi lên server (id thuần). */
export function buildAudienceInput(
  users: readonly SocialUserRef[],
  units: readonly SocialUnitRef[],
): SocialPostAudienceInput {
  return { userIds: users.map((user) => user.id), unitIds: units.map((unit) => unit.id) };
}

/** Hai danh sách chọn có cùng phần tử (không xét thứ tự) không. */
export function sameIds(a: readonly { readonly id: string }[], b: readonly { readonly id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((item) => item.id));
  return b.every((item) => ids.has(item.id));
}

/** Thêm hoặc bớt một phần tử theo `id`. */
export function toggleById<T extends { readonly id: string }>(list: readonly T[], item: T): readonly T[] {
  return list.some((entry) => entry.id === item.id)
    ? list.filter((entry) => entry.id !== item.id)
    : [...list, item];
}

/**
 * Bài có đang giữ thuộc tính chỉ đi với Công khai (thông báo, ghim, @all, xác nhận đã đọc) không.
 * Có thì không cho đổi sang quyền xem hẹp hơn khi sửa (server trả 400 `VISIBILITY_NOT_ALLOWED`).
 */
export function lockedToCompanyReason(
  post: Pick<SocialPost, 'kind' | 'pinned' | 'mentionsAll' | 'readConfirmation'>,
): string | undefined {
  if (post.kind === 'announcement') return 'Bài thông báo chỉ để Công khai.';
  if (post.pinned) return 'Bài đã ghim chỉ để Công khai. Hãy bỏ ghim trước.';
  if (post.mentionsAll) return 'Bài nhắc tất cả mọi người chỉ để Công khai.';
  if (post.readConfirmation) return 'Bài yêu cầu xác nhận đã đọc chỉ để Công khai.';
  return undefined;
}

/* ----------------------------------------------------------- menu thẻ bài */

export type PostMenuAction =
  | 'detail'
  | 'pin'
  | 'history'
  | 'toggleComments'
  | 'edit'
  | 'delete';

export interface PostMenuItem {
  readonly action: PostMenuAction;
  readonly label: string;
  readonly danger?: boolean;
}

/** Mục menu "⋮" của thẻ bài theo `capabilities`, đúng thứ tự: Xem chi tiết, Ghim, Lịch sử, Bình luận, Sửa, Xóa. */
export function buildPostMenu(
  post: Pick<
    SocialPost,
    'status' | 'pinned' | 'activity' | 'commentsDisabled' | 'editCount' | 'capabilities'
  >,
): readonly PostMenuItem[] {
  const { capabilities } = post;
  const published = isPublished(post);
  const items: PostMenuItem[] = [];
  if (published) items.push({ action: 'detail', label: 'Xem chi tiết' });
  if (capabilities.canPin && published) {
    items.push({ action: 'pin', label: post.pinned ? 'Bỏ ghim bài viết' : 'Ghim bài viết' });
  }
  if (capabilities.canViewHistory && (post.editCount ?? 0) > 0) {
    items.push({ action: 'history', label: 'Lịch sử chỉnh sửa' });
  }
  if (capabilities.canToggleComments && published) {
    items.push({
      action: 'toggleComments',
      label: post.commentsDisabled ? 'Bật tính năng bình luận' : 'Tắt tính năng bình luận',
    });
  }
  if (capabilities.canEdit && !post.activity) items.push({ action: 'edit', label: 'Sửa bài viết' });
  if (capabilities.canDelete) items.push({ action: 'delete', label: 'Xóa bài viết', danger: true });
  return items;
}

/* ------------------------------------------------------------ lịch sử sửa */

/** Nhãn một bản trong lịch sử: bản 1 là bản gốc. */
export const editVersionLabel = (version: number): string =>
  version <= 1 ? 'Bản gốc' : `Bản ${version}`;
