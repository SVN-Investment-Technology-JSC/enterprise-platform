import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { principalHome } from './auth-session';

/** Kết quả hỏi phiên ở phía server (layout, trang gốc). */
export type ServerSession =
  | { readonly status: 'authenticated'; readonly principal: AuthenticatedPrincipal }
  | { readonly status: 'unauthenticated' }
  /** Không hỏi được dịch vụ đăng nhập (mạng, lỗi máy chủ): coi như chưa đăng nhập, không mở khung trang. */
  | { readonly status: 'unavailable' };

/**
 * Hỏi `GET /api/auth/v1/me` bằng cookie của request. Không ném lỗi, để nơi gọi gọi `redirect()` NGOÀI try/catch:
 * `redirect()` của Next ném `NEXT_REDIRECT`, bọc trong try/catch là nuốt mất lệnh chuyển hướng.
 */
export async function loadServerSession(
  cookieHeader: string,
  apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3333',
  fetchImpl: typeof fetch = fetch,
): Promise<ServerSession> {
  try {
    const response = await fetchImpl(`${apiBaseUrl}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) return { status: 'unauthenticated' };
    if (!response.ok) return { status: 'unavailable' };
    const principal = (await response.json()) as AuthenticatedPrincipal | null;
    return principal?.kind ? { status: 'authenticated', principal } : { status: 'unauthenticated' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Trang gốc `/`: đã đăng nhập thì về trang chính của loại tài khoản, chưa thì về đăng nhập. */
export function rootDestination(session: ServerSession): string {
  return session.status === 'authenticated' ? principalHome(session.principal) : '/login';
}

/** Layout Platform: chỉ Platform Admin ở lại; tài khoản tenant về dashboard; phiên lỗi về đăng nhập quản trị. */
export function platformRedirect(session: ServerSession): string | undefined {
  if (session.status !== 'authenticated') return '/login/admin';
  return session.principal.kind === 'platform-admin' ? undefined : principalHome(session.principal);
}

/** Layout tenant: phiên hỏng, hết hạn hay không hỏi được thì về đăng nhập thay vì dựng khung trang rỗng. */
export function tenantRedirect(session: ServerSession): string | undefined {
  return session.status === 'authenticated' ? undefined : '/login';
}
