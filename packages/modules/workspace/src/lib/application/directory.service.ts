import type { DirectoryResponse } from '@enterprise-platform/contracts-workspace';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { WorkspaceActor } from './workspace.application.js';

/**
 * Danh bạ người trong tổ chức.
 *
 * Mọi người dùng Workspace đọc được: đây chỉ là tên và đơn vị, thứ đã hiện
 * công khai trong sơ đồ tổ chức. Không có quyền hay vai trò nào đi kèm.
 */
export class DirectoryService {
  constructor(private readonly directory: OrganizationDirectory) {}

  /**
   * Khi tenant chưa bổ nhiệm ai (danh bạ rỗng), người có quyền quản lý dự án
   * thấy người dùng đang hoạt động của tenant để còn gán thành viên. Người khác
   * giữ nguyên danh bạ cũ — không lộ danh sách nhân sự.
   */
  async list(actor: WorkspaceActor): Promise<DirectoryResponse> {
    const { tenantUsers, ...snapshot } = await this.directory.list(actor.tenantId);
    const privileged = actor.isTenantAdmin || actor.canManage || actor.canCreateProjects === true;
    if (snapshot.people.length === 0 && privileged && tenantUsers && tenantUsers.length > 0) {
      return { ...snapshot, people: tenantUsers };
    }
    return snapshot;
  }

  /**
   * Những id KHÔNG có trong tổ chức.
   *
   * Trả `undefined` khi danh bạ không đọc được: không biết thì không chặn.
   * Một cuộc họp không nên hỏng chỉ vì Tenant Core chậm vài giây — người lạ
   * lọt vào danh sách mời cũng không thấy được gì ngoài chính sự kiện đó.
   */
  async unknownUserIds(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<string[] | undefined> {
    if (userIds.length === 0) return [];
    const snapshot = await this.directory.list(tenantId);
    if (snapshot.degraded) return undefined;
    const people = snapshot.people.length > 0 ? snapshot.people : (snapshot.tenantUsers ?? []);
    const known = new Set(people.map((person) => person.userId));
    return userIds.filter((userId) => !known.has(userId));
  }
}
