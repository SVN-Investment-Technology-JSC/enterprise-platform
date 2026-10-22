import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { PeopleProfilePort } from './ports/people-profile.port.js';

/**
 * Phạm vi người cần xác nhận đã đọc: bài Tường công ty là mọi người đang làm việc, bài nhóm là
 * thành viên nhóm; luôn trừ tác giả. Id trả về viết thường, không trùng.
 */
export class ReadAudience {
  constructor(
    private readonly people: Pick<PeopleProfilePort, 'listActiveUserIds'>,
    private readonly groups: Pick<GroupMembershipPort, 'listMemberIds'>,
  ) {}

  /** Bộ nhớ đệm cho một lần xử lý: danh sách công ty và từng nhóm chỉ tra một lần. */
  session(tenantId: string): ReadAudienceSession {
    return new ReadAudienceSession(this.people, this.groups, tenantId);
  }
}

export class ReadAudienceSession {
  private wall?: Promise<readonly string[]>;
  private readonly byGroup = new Map<string, Promise<readonly string[]>>();

  constructor(
    private readonly people: Pick<PeopleProfilePort, 'listActiveUserIds'>,
    private readonly groups: Pick<GroupMembershipPort, 'listMemberIds'>,
    private readonly tenantId: string,
  ) {}

  async of(post: { readonly authorId: string; readonly groupId?: string }): Promise<string[]> {
    let source: Promise<readonly string[]>;
    if (post.groupId) {
      const cached = this.byGroup.get(post.groupId);
      source = cached ?? this.groups.listMemberIds(this.tenantId, post.groupId);
      if (!cached) this.byGroup.set(post.groupId, source);
    } else {
      this.wall ??= this.people.listActiveUserIds(this.tenantId);
      source = this.wall;
    }
    const author = post.authorId.toLowerCase();
    return [...new Set((await source).map((id) => id.toLowerCase()))].filter((id) => id !== author);
  }
}
