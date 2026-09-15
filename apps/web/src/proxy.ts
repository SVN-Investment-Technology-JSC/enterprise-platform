import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedPlatformRoute = pathname === '/platform'
    || pathname.startsWith('/platform/tenants')
    || pathname.startsWith('/platform/data-import');
  const protectedTenantRoute = ['/dashboard', '/organization', '/applications', '/crm', '/users']
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (!request.cookies.has('ep_access')) {
    if (protectedPlatformRoute) return NextResponse.redirect(new URL('/admin', request.url));
    if (protectedTenantRoute) return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/platform', '/platform/tenants/:path*', '/platform/data-import/:path*', '/dashboard/:path*', '/organization/:path*', '/applications/:path*', '/crm/:path*', '/users/:path*'],
};
