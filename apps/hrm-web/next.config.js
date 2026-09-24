//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    ...(process.env.DEV_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    '192.168.88.16',
    '192.168.88.16:3000',
    '192.168.88.16:3004',
    '192.168.88.16:4200',
  ],
  basePath: '/modules/hrm',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async rewrites() {
    const hrmApiBaseUrl = (process.env.HRM_API_BASE_URL ?? 'http://localhost:3337')
      .trim()
      .replace(/\/$/, '');

    return [
      {
        source: '/api/hrm/:path*',
        destination: `${hrmApiBaseUrl}/api/hrm/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
