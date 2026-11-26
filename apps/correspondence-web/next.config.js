//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/correspondence',
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'lucide-react', '@enterprise-platform/shared-ui'],
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
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
