//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/finance',
  experimental: {
    // Trang chỉ nạp phần Tài chính mình dùng thay vì cả gói (antd, mọi màn hình).
    optimizePackageImports: ['@enterprise-platform/feature-finance', 'antd', 'lucide-react'],
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async rewrites() {
    const financeApiBaseUrl = (process.env.FINANCE_API_BASE_URL ?? 'http://localhost:3341').trim().replace(/\/$/, '');
    const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3333').trim().replace(/\/$/, '');

    // Chạy cục bộ không qua gateway: web tự chuyển tiếp API sang dịch vụ tương ứng.
    return [
      { source: '/api/auth/:path*', destination: `${apiBaseUrl}/api/auth/:path*`, basePath: false },
      { source: '/api/finance/:path*', destination: `${financeApiBaseUrl}/api/finance/:path*`, basePath: false },
    ];
  },
};

module.exports = nextConfig;
