import { timingSafeEqual } from 'node:crypto';
import {
  PostgresPoolRegistry,
  inTransaction,
  type PostgresClient,
} from '@enterprise-platform/adapter-database';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformIdentityService } from './platform-identity.service.js';

type TenantPool = Awaited<ReturnType<PostgresPoolRegistry['forTenant']>>;

/** Thông tin DB tenant giữ trong bộ nhớ ngắn hạn, để không hỏi DB platform ở mỗi request. */
const REFERENCE_TTL_MS = 60_000;

/**
 * Cổng vào cho tính năng core mà MỌI người dùng doanh nghiệp đều có (chat nội bộ, ảnh đại diện, danh bạ):
 * không gắn với phân hệ nào nên không đi qua quyết định truy cập phân hệ, chỉ cần phiên còn sống.
 *
 * Khác `withTenantCoreDatabase` của dịch vụ định danh (tạo pool mới ở mỗi lần gọi), ở đây giữ pool theo tenant
 * trong một registry có giới hạn, vì chat gọi API dày hơn các màn quản trị nhiều.
 */
@Injectable()
export class TenantCoreAccess implements OnModuleDestroy {
  private readonly pools = new PostgresPoolRegistry(undefined, {
    maxPools: Number(process.env.CORE_TENANT_MAX_POOLS ?? 24),
    maxConnectionsPerPool: Number(process.env.CORE_TENANT_POOL_SIZE ?? 6),
  });
  private readonly references = new Map<string, { readonly reference: TenantDatabaseReference; readonly expiresAt: number }>();

  constructor(private readonly identity: PlatformIdentityService) {}

  /** Người dùng doanh nghiệp đang đăng nhập; quản trị nền tảng hay phiên hết hạn đều bị từ chối. */
  async principal(request: Request): Promise<TenantUserPrincipal> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : (request.cookies?.ep_access as string | undefined);
    if (!token) throw new UnauthorizedException('Vui lòng đăng nhập.');
    try {
      return await this.identity.verifyTenantSession(token);
    } catch {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
  }

  /** Request ghi phải mang `x-csrf-token` đúng bằng cookie `ep_csrf` (double-submit, như các API core khác). */
  requireCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    const cookie = request.cookies?.ep_csrf as string | undefined;
    if (!value || !cookie) throw new ForbiddenException('Thiếu mã chống giả mạo yêu cầu.');
    const a = Buffer.from(value);
    const b = Buffer.from(cookie);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Mã chống giả mạo yêu cầu không hợp lệ.');
  }

  async pool(tenantId: string): Promise<TenantPool> {
    return this.pools.forTenant(await this.reference(tenantId));
  }

  async transaction<T>(tenantId: string, work: (client: PostgresClient) => Promise<T>): Promise<T> {
    return inTransaction(await this.pool(tenantId), work);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pools.closeAll();
  }

  private async reference(tenantId: string): Promise<TenantDatabaseReference> {
    const cached = this.references.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.reference;
    const reference = await this.identity.tenantCoreDatabase(tenantId);
    if (!reference) {
      this.references.delete(tenantId);
      throw new ServiceUnavailableException('Doanh nghiệp chưa có cơ sở dữ liệu đang hoạt động.');
    }
    this.references.set(tenantId, { reference, expiresAt: Date.now() + REFERENCE_TTL_MS });
    return reference;
  }
}
