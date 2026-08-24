import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedPlatformRoute = pathname.startsWith('/platform') && pathname !== '/platform/login';
  const tenantMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const tenantSlug = tenantMatch?.[1];
  const tenantPublicRoute = pathname === `/t/${tenantSlug}/login`
    || pathname === `/t/${tenantSlug}/reset-password`;
  const protectedTenantRoute = Boolean(tenantSlug) && !tenantPublicRoute;
  if (!request.cookies.has('ep_access')) {
    if (protectedPlatformRoute) return NextResponse.redirect(new URL('/platform/login', request.url));
    if (protectedTenantRoute) return NextResponse.redirect(new URL(`/t/${tenantSlug}/login`, request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/platform/:path*', '/t/:path*'] };
