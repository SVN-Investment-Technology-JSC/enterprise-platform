//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // Next 16 chặn request dev đến từ origin khác localhost. Không khai báo thì
  // mở trang qua IP LAN sẽ không hydrate được và form rơi về submit GET thuần.
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  output:
    process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  poweredByHeader: false,
  typedRoutes: true,
  async rewrites() {
    const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3333')
      .trim()
      .replace(/\/$/, '');
    const procedureApiBaseUrl = (
      process.env.PROCEDURE_API_BASE_URL ?? 'http://localhost:3334'
    )
      .trim()
      .replace(/\/$/, '');

    return [
      {
        source: '/api/procedure/:path*',
        destination: `${procedureApiBaseUrl}/api/procedure/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
