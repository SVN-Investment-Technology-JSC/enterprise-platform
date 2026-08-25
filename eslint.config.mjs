import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/test-output'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:platform',
                'type:module',
                'type:feature',
                'type:plugin',
                'type:contract',
                'type:adapter',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: [
                'type:app',
                'type:platform',
                'type:module',
                'type:feature',
                'type:contract',
                'type:adapter',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:module',
              onlyDependOnLibsWithTags: [
                'type:platform',
                'type:contract',
                'type:adapter',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:contract',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:platform',
              onlyDependOnLibsWithTags: [
                'type:platform',
                'type:contract',
                'type:adapter',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:plugin',
              onlyDependOnLibsWithTags: [
                'type:plugin',
                'type:platform',
                'type:contract',
                'type:adapter',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:contract',
              onlyDependOnLibsWithTags: ['type:contract', 'type:shared'],
            },
            {
              sourceTag: 'type:adapter',
              onlyDependOnLibsWithTags: [
                'type:adapter',
                'type:contract',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:shared',
              onlyDependOnLibsWithTags: ['type:shared'],
            },
            {
              sourceTag: 'scope:procedure-engine',
              onlyDependOnLibsWithTags: [
                'scope:procedure-engine',
                'scope:platform',
                'scope:identity',
                'scope:tenancy',
                'scope:database',
                'scope:integration',
                'scope:shared',
                'scope:ui',
              ],
            },
            {
              sourceTag: 'scope:maintenance',
              onlyDependOnLibsWithTags: [
                'scope:maintenance',
                'scope:platform',
                'scope:identity',
                'scope:tenancy',
                'scope:database',
                'scope:integration',
                'scope:shared',
                'scope:ui',
              ],
            },
            {
              sourceTag: 'scope:inventory',
              onlyDependOnLibsWithTags: [
                'scope:inventory',
                'scope:platform',
                'scope:identity',
                'scope:tenancy',
                'scope:database',
                'scope:integration',
                'scope:shared',
                'scope:ui',
              ],
            },
            {
              sourceTag: 'scope:crm',
              onlyDependOnLibsWithTags: [
                'scope:crm',
                'scope:platform',
                'scope:identity',
                'scope:tenancy',
                'scope:database',
                'scope:integration',
                'scope:shared',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/application/**',
            '**/infrastructure/**',
            '**/presentation/**',
            '@nestjs/**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/infrastructure/**',
            '**/presentation/**',
            '@nestjs/**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/src/**/presentation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/infrastructure/**'],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
