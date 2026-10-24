/**
 * Cổng quyền đăng bài và chủ đề của nhóm (đợt 2). BE-G hiện thực trên `groups`,
 * `group_post_permitted`, `group_topics`; BE-V (đường ghi bài) chỉ dùng cổng này, không đọc các bảng đó.
 * Mọi phương thức nhận `tenantId` đầu tiên và không ném lỗi khi không tìm thấy.
 */
export const GROUP_POSTING = Symbol('SOCIAL_GROUP_POSTING');

export interface GroupPostingDecision {
  readonly allowed: boolean;
  /** Lý do khi `allowed = false`: `not-member` (403 `GROUP_NOT_MEMBER`) hoặc `restricted` (403 `GROUP_POST_NOT_ALLOWED`). */
  readonly reason?: 'not-member' | 'restricted' | 'group-missing';
}

export interface GroupTopicRef {
  readonly id: string;
  readonly name: string;
}

export interface GroupPostingPort {
  /**
   * Người này đăng bài thường vào nhóm được không: thành viên, và `post_permission` cho phép
   * (`all`: mọi thành viên; `admins`: chỉ admin nhóm; `selected`: admin nhóm và người được chọn).
   * Quản trị toàn hệ thống KHÔNG được đăng nếu không là thành viên (như đợt 1).
   */
  canPost(tenantId: string, groupId: string, userId: string): Promise<GroupPostingDecision>;

  /** Chủ đề (chưa xoá) theo id; chỉ trả chủ đề thuộc `groupId`. Khoá là id viết thường. */
  topicsOfGroup(
    tenantId: string,
    groupId: string,
    topicIds: readonly string[],
  ): Promise<ReadonlyMap<string, GroupTopicRef>>;

  /** Chủ đề theo id bất kể nhóm; dùng khi dựng danh sách bài từ nhiều nhóm (`SocialPost.groupTopic`). */
  topicRefs(tenantId: string, topicIds: readonly string[]): Promise<ReadonlyMap<string, GroupTopicRef>>;
}
