import type {
  AccessDecisionResponse,
  AuthenticatedPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Tenant và database đã phân giải cho một lời gọi service-to-service. */
export interface ServiceCaller {
  readonly tenantId: string;
  readonly database: TenantDatabaseReference;
}

export interface ModuleAccessOptions {
  /** `moduleKey` gửi lên Platform: `workspace`, `inventory`, `procedure-engine`… */
  readonly moduleKey: string;
  /** Thay `fetch` trong test; mặc định dùng `fetch` toàn cục. */
  readonly fetcher?: typeof fetch;
  /** Thay bộ xác minh JWT trong test; mặc định là JWKS của Platform. */
  readonly verifyToken?: (token: string) => Promise<AuthenticatedPrincipal>;
}

/**
 * Phần xác thực dùng chung cho guard của các module nghiệp vụ.
 *
 * Trước đây mỗi app (Inventory, Maintenance, Procedure, Workspace) giữ một bản
 * copy khoảng 180 dòng giống nhau từng chữ: đọc JWT, chặn CSRF, hỏi
 * access-decision, xác minh service token và tra database của
 * tenant. Sửa một lỗi bảo mật ở đó nghĩa là phải nhớ sửa đủ bốn chỗ.
 *
 * Lớp này **không** phải một guard Nest và không quyết định quyền nghiệp vụ.
 * Mỗi guard vẫn tự ánh xạ đường dẫn → quyền, tự dựng actor của module và tự
 * chọn quyền gì cấp cho bên gọi nội bộ — đó là phần thật sự khác nhau giữa các
 * module, nên nó ở lại với module.
 */
export class ModuleAccess {
  private readonly fetcher: typeof fetch;
  private readonly verifyToken: (token: string) => Promise<AuthenticatedPrincipal>;

  constructor(private readonly options: ModuleAccessOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.verifyToken = options.verifyToken ?? platformTokenVerifier();
  }

  /** Probe sống/sẵn sàng của hạ tầng không mang danh tính nào. */
  isHealthCheck(request: Request): boolean {
    return request.path.endsWith('/health/live') || request.path.endsWith('/health/ready');
  }

  /**
   * Route service-to-service. Không mang phiên trình duyệt, nên CSRF và
   * access-decision theo người dùng không áp dụng; chúng xác thực bằng
   * service token qua `authorizeService`.
   */
  isInternal(request: Request): boolean {
    return request.path.includes('/v1/internal/');
  }

  requireCsrfForMutation(request: Request): void {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value !== request.cookies?.ep_csrf) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'CSRF token không hợp lệ.' });
    }
  }

  /** Principal từ `Authorization: Bearer` hoặc cookie `ep_access`, đã xác minh chữ ký. */
  async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ')
      ? bearer.slice(7)
      : (request.cookies?.ep_access as string | undefined);
    if (!token) throw new UnauthorizedException();
    try {
      return await this.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Access token không hợp lệ.');
    }
  }

  /**
   * Principal của một tenant-user. Platform Admin không bao giờ chạm dữ liệu
   * tenant qua module nghiệp vụ.
   */
  async tenantUser(request: Request): Promise<TenantUserPrincipal> {
    const principal = await this.principal(request);
    if (principal.kind === 'platform-admin') {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_NOT_ALLOWED',
        message: 'Platform Admin không truy cập dữ liệu tenant.',
      });
    }
    return principal;
  }

  /**
   * Hỏi Platform người dùng có vào được module với `permission` không.
   *
   * **Không cache.** Bản cache 30 giây từng có ở đây đã được gỡ theo hướng của
   * `dev/release`: đổi quyền hay tắt module phải có hiệu lực ngay, chờ hết hạn
   * cache là để người vừa bị thu quyền vẫn thao tác được thêm nửa phút.
   * Platform không trả lời được thì từ chối an toàn.
   */
  async decision(
    principal: TenantUserPrincipal,
    permission: string,
  ): Promise<AccessDecisionResponse> {
    try {
      const response = await this.fetcher(
        process.env.PLATFORM_ACCESS_DECISION_URL ??
          'http://localhost:3333/api/platform/internal/v1/access-decisions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({
            sessionId: principal.sessionId,
            userId: principal.userId,
            tenantId: principal.tenantId,
            moduleKey: this.options.moduleKey,
            permission,
          }),
        },
      );
      if (!response.ok) throw new Error(`Platform access decision returned ${response.status}.`);
      return (await response.json()) as AccessDecisionResponse;
    } catch {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_ACCESS_UNAVAILABLE',
        message: 'Không thể xác minh quyền truy cập; yêu cầu bị từ chối an toàn.',
      });
    }
  }

  /**
   * Xác thực bên gọi là một dịch vụ tin cậy rồi phân giải database của tenant
   * trong `x-tenant-id`.
   *
   * Fail closed khi `INTERNAL_SERVICE_TOKEN` chưa đặt, để một bản deploy cấu
   * hình sai không thể bị gọi bằng header rỗng.
   */
  async authorizeService(request: Request): Promise<ServiceCaller> {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const presented = request.headers['x-service-token'];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!expected || token !== expected) {
      throw new UnauthorizedException({
        code: 'SERVICE_IDENTITY_INVALID',
        message: 'Service identity không hợp lệ.',
      });
    }

    const header = request.headers['x-tenant-id'];
    const tenantId = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'MISSING_TENANT',
        message: 'X-Tenant-ID là bắt buộc cho lời gọi nội bộ.',
      });
    }

    // Đây là endpoint HTTP của Platform, không phải connection string. Tên cũ
    // PLATFORM_TENANT_DATABASE_URL đọc như một DSN nên vẫn được chấp nhận để
    // không phá môi trường đang chạy, nhưng tên đúng là ..._API_URL.
    const root =
      process.env.PLATFORM_TENANT_DATABASE_API_URL ??
      process.env.PLATFORM_TENANT_DATABASE_URL ??
      'http://localhost:3333/api/platform/internal/v1/tenant-databases';
    try {
      const response = await this.fetcher(
        `${root}/${encodeURIComponent(tenantId)}?moduleKey=${encodeURIComponent(this.options.moduleKey)}`,
        { headers: { 'x-service-token': expected } },
      );
      if (!response.ok) throw new Error(`Tenant database lookup returned ${response.status}.`);
      const body = (await response.json()) as { database: TenantDatabaseReference };
      return { tenantId, database: body.database };
    } catch {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_ACCESS_UNAVAILABLE',
        message: 'Không thể phân giải database của tenant; yêu cầu bị từ chối an toàn.',
      });
    }
  }
}

/** Bộ xác minh JWT của Platform: RS256, đúng issuer và audience. */
function platformTokenVerifier(): (token: string) => Promise<AuthenticatedPrincipal> {
  const jwks = createRemoteJWKSet(
    new URL(process.env.PLATFORM_JWKS_URL ?? 'http://localhost:3333/api/auth/v1/jwks'),
  );
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: 'enterprise-platform',
      audience: 'enterprise-platform-apps',
    });
    return payload.principal as unknown as AuthenticatedPrincipal;
  };
}
