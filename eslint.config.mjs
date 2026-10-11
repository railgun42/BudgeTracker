import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'graphify-out/**', '**/generated/**', '**/.angular/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly' } },
  },
  {
    // Moteurs purs (PLAN §1.1) : ni Nest ni Prisma, testables sans BDD.
    files: ['**/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'prisma', '**/prisma/**'],
              message: 'Les dossiers engine/ sont purs : aucun import Nest/Prisma.',
            },
          ],
        },
      ],
    },
  },
);
