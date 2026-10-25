//@ts-check

const fs = require('node:fs');
const path = require('node:path');

// Dữ liệu emoji tiếng Việt cho hộp chọn emoji, tự host để không phụ thuộc CDN. Sao chép từ `emojibase-data` mỗi lần
// dựng cấu hình (dev và build); thư mục đích nằm trong .gitignore.
const emojiSource = path.join(path.dirname(require.resolve('emojibase-data/package.json')), 'vi');
const emojiTarget = path.join(__dirname, 'public/emoji-data/vi');
fs.mkdirSync(emojiTarget, { recursive: true });
for (const file of ['data.json', 'messages.json']) {
  fs.copyFileSync(path.join(emojiSource, file), path.join(emojiTarget, file));
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  basePath: '/modules/social',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: process.env.NEXT_BUILD_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async headers() {
    return [
      // Dữ liệu emoji đổi rất hiếm (theo phiên bản gói), cho phép trình duyệt giữ một ngày.
      { source: '/emoji-data/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    ];
  },
};

module.exports = nextConfig;
