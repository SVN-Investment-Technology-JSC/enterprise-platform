/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'notification-worker',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleNameMapper: {
    '^@enterprise-platform/adapter-database$':
      '<rootDir>/../../packages/adapters/database/src/index.ts',
    '^@enterprise-platform/adapter-events$':
      '<rootDir>/../../packages/adapters/events/src/index.ts',
    '^@enterprise-platform/contracts-integration$':
      '<rootDir>/../../packages/contracts/integration/src/index.ts',
    '^@enterprise-platform/contracts-realtime$':
      '<rootDir>/../../packages/contracts/realtime/src/index.ts',
    '^@enterprise-platform/contracts-tenancy$':
      '<rootDir>/../../packages/contracts/tenancy/src/index.ts',
    '^@enterprise-platform/module-notifications$':
      '<rootDir>/../../packages/modules/notifications/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
