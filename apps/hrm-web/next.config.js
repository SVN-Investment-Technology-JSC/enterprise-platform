//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/hrm',
  experimental: {
    // Trang chỉ nạp phần HRM mình dùng thay vì cả gói (antd, xlsx, mọi màn hình).
    optimizePackageImports: ['@enterprise-platform/feature-hrm', 'antd', 'lucide-react'],
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  // Mã không dùng next/image; tắt bộ tối ưu ảnh để đóng endpoint /_next/image (ISS-OPS-002).
  images: { unoptimized: true },
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async rewrites() {
    const hrmApiBaseUrl = (process.env.HRM_API_BASE_URL ?? 'http://localhost:3339')
      .trim()
      .replace(/\/$/, '');
    const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3333')
      .trim()
      .replace(/\/$/, '');

    return [
      {
        source: '/api/auth/:path*',
        destination: `${apiBaseUrl}/api/auth/:path*`,
        basePath: false,
      },
      {
        source: '/api/platform/:path*',
        destination: `${apiBaseUrl}/api/platform/:path*`,
        basePath: false,
      },
      {
        source: '/api/hrm/:path*',
        destination: `${hrmApiBaseUrl}/api/hrm/:path*`,
        basePath: false,
      },
    ];
  },
};

module.exports = nextConfig;
