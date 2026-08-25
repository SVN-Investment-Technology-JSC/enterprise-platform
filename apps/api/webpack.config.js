const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  resolve: {
    // The platform intentionally uses node-postgres' JavaScript client.
    alias: { 'pg-native': false },
  },
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // Tạo tenant đọc migrations/tenant/core/*.sql từ đĩa lúc chạy, nên bundle
      // phải mang theo giống migrator và worker; thiếu chúng thì POST
      // /api/platform/v1/tenants chết ENOENT ngay trong image production.
      assets: [
        './src/assets',
        { glob: '**/*.sql', input: '../../migrations', output: 'migrations' },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
