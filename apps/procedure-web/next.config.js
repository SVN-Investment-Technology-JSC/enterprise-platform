//@ts-check

const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/modules/procedure',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
};

module.exports = nextConfig;
