//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/crm',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Mã không dùng next/image; tắt bộ tối ưu ảnh để đóng endpoint /_next/image (ISS-OPS-002).
  images: { unoptimized: true },
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async rewrites() {
    const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3333').trim().replace(/\/$/, '');
    return [
      { source: '/api/platform/:path*', destination: `${apiBaseUrl}/api/platform/:path*`, basePath: false },
    ];
  },
};

module.exports = nextConfig;
