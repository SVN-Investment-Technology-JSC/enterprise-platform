const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'realtime-api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  // `verifyServiceToken` lấy từ platform-module-access, gói này nạp `jose` 6 (chỉ
  // phát hành ESM), nên phải chừa `jose` ra để Jest biến đổi (đường dẫn pnpm có `.pnpm/`).
  transformIgnorePatterns: ['node_modules/(?!\\.pnpm|jose)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
