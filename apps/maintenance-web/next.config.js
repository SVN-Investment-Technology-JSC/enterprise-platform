//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/maintenance',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
};

module.exports = nextConfig;
