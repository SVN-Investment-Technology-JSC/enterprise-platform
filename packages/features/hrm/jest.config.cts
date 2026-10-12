module.exports = {
  displayName: 'feature-hrm',
  preset: '../../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // Ant Design DatePicker không chạy được trong jsdom: test dùng ô nhập dd/mm/yyyy cùng props.
  moduleNameMapper: {
    '^@enterprise-platform/shared-ui/date-picker$':
      '<rootDir>/src/test-support/date-picker-input.tsx',
  },
  coverageDirectory: 'test-output/jest/coverage',
};
