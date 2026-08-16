import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedPlatformRoute = pathname.startsWith('/platform') && pathname !== '/platform/login';
  const protectedTenantRoute = pathname.startsWith('/t/');
  if (!request.cookies.has('ep_access')) {
    if (protectedPlatformRoute) return NextResponse.redirect(new URL('/platform/login', request.url));
    if (protectedTenantRoute) return NextResponse.redirect(new URL('/tenant/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/platform/:path*', '/t/:path*'] };
