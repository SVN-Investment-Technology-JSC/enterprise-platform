import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Trang `/roles` cũ (dữ liệu giả) đã bỏ; vai trò quản lý ở màn "Vai trò & phân quyền".
  if (pathname === '/roles' || pathname.startsWith('/roles/')) {
    return NextResponse.redirect(new URL('/authorization', request.url));
  }
  const protectedPlatformRoute = pathname === '/platform' || pathname.startsWith('/platform/');
  const protectedTenantRoute = ['/dashboard', '/organization', '/applications', '/users', '/authorization', '/account']
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (!request.cookies.has('ep_access')) {
    if (protectedPlatformRoute) return NextResponse.redirect(new URL('/login/admin', request.url));
    if (protectedTenantRoute) return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/platform', '/platform/:path*', '/dashboard/:path*', '/organization/:path*', '/applications/:path*', '/users/:path*', '/authorization/:path*', '/account/:path*', '/roles/:path*'],
};
