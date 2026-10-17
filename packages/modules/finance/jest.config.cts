const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'module-finance',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  // sanitize-html -> htmlparser2 and its dom* / entities dependencies ship ESM-only ("type": "module");
  // transform them like our own source instead of leaving pnpm's default node_modules ignore rule skip them.
  transformIgnorePatterns: ['node_modules/\\.pnpm/(?!(htmlparser2|entities|domhandler|domutils|domelementtype|dom-serializer)@)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
