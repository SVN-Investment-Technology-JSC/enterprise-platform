import {
  resolveProcedureAssigneeUserIds,
  type ProcedureAssignmentRef,
  type RecipientDirectory,
} from '@enterprise-platform/module-notifications';

/**
 * Đọc sơ đồ tổ chức (organization context) của một tenant từ Tenant Core.
 *
 * Cùng endpoint, cùng biến môi trường và cùng `x-service-token` với `TenantOrganizationContextClient`
 * của procedure-api. Lỗi được ném ra để tin nhắn thử lại, không âm thầm bỏ người nhận: một lần Tenant
 * Core chập chờn không được làm mất thông báo giao việc.
 */
export class HttpOrganizationContext {
  private readonly cache = new Map<string, { readonly value: unknown; readonly expiresAt: number }>();

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = fetch,
    private readonly ttlMs = 30_000,
    private readonly timeoutMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  async load(tenantId: string): Promise<unknown> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Tenant Core organization context returned ${response.status}.`);
      }
      const value: unknown = await response.json();
      this.cache.set(tenantId, { value, expiresAt: this.now() + this.ttlMs });
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Danh bạ người nhận của một tenant, bổ sung khả năng giải vai đơn vị/chức danh thành người dùng. */
export class OrganizationAwareRecipientDirectory implements RecipientDirectory {
  constructor(
    private readonly base: RecipientDirectory,
    private readonly tenantId: string,
    private readonly organization: Pick<HttpOrganizationContext, 'load'>,
  ) {}

  activeUsers(userIds: readonly string[]): Promise<readonly string[]> {
    return this.base.activeUsers(userIds);
  }

  usersWithPermission(permission: string): Promise<readonly string[]> {
    return this.base.usersWithPermission(permission);
  }

  async usersForProcedureAssignments(
    assignments: readonly ProcedureAssignmentRef[],
  ): Promise<readonly string[]> {
    if (assignments.every((assignment) => assignment.subjectType === 'user')) {
      return assignments.map((assignment) => assignment.subjectId);
    }
    return resolveProcedureAssigneeUserIds(assignments, await this.organization.load(this.tenantId));
  }
}
