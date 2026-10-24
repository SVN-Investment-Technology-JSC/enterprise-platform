import type { SocialGroupColor, SocialGroupIcon, SocialGroupPrivacy, SocialGroupRole } from '@enterprise-platform/contracts-social';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostVisibilityScope } from './ports/post-visibility.port.js';

/** Token DI của store tìm kiếm và đếm bài của hồ sơ (BE-3). */
export const SOCIAL_SEARCH_STORE = Symbol('SOCIAL_SEARCH_STORE');

export interface SearchPostsFilter {
  /** Các từ đã gập, chỉ `[a-z0-9]` (xem `normalizeSearchQuery`); mọi từ đều phải khớp tiền tố. */
  readonly tokens: readonly string[];
  readonly topicId?: string;
  readonly groupId?: string;
  readonly authorId?: string;
  /** ISO UTC, bao gồm cả hai đầu; lọc theo `published_at`. */
  readonly from?: string;
  readonly to?: string;
  /** Số dòng tối đa (người gọi xin thêm một dòng để biết còn trang sau). */
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface GroupSearchRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
  readonly memberCount: number;
  readonly myRole?: SocialGroupRole;
  readonly myJoinedAt?: string;
  readonly myJoinRequestId?: string;
  /** ISO UTC giữ micro giây (cho con trỏ phân trang). */
  readonly createdAt: string;
}

export interface SearchGroupsFilter {
  readonly tokens: readonly string[];
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface SocialSearchStore {
  /**
   * Bài đã đăng khớp từ khoá, mới nhất trước. Luôn áp luật nhìn thấy bài (`scope`) và chỉ lấy bài
   * `published` không phải bài tự sinh: bài chờ duyệt, hẹn giờ, bị từ chối không bao giờ lộ qua tìm kiếm.
   */
  searchPosts(tenantId: string, scope: PostVisibilityScope, filter: SearchPostsFilter): Promise<ExtendedPostRow[]>;

  /** Nhóm chưa xoá khớp từ khoá; nhóm riêng tư chỉ có cho thành viên và quản trị toàn hệ thống. */
  searchGroups(tenantId: string, scope: PostVisibilityScope, filter: SearchGroupsFilter): Promise<GroupSearchRow[]>;

  /** Số bài đã đăng của `authorId` mà người xem thấy được; không tính bài tự sinh. */
  countVisibleAuthorPosts(tenantId: string, scope: PostVisibilityScope, authorId: string): Promise<number>;
}
