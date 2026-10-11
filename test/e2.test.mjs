// E2 — CI minimale : règle de pureté des engine/ et contenu du workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });
const lint = async (filePath, code) => (await eslint.lintText(code, { filePath }))[0].messages;
const engineFile = 'apps/api/src/recurrences/engine/occurrences.ts';

for (const mod of ['@nestjs/common', '@prisma/client', 'prisma', '../../prisma/prisma.service']) {
  test(`engine/ : importer ${mod} est une erreur de lint`, async () => {
    const messages = await lint(engineFile, `import { x } from '${mod}';\nexport const y = x;\n`);
    assert.deepEqual(messages.map((m) => [m.ruleId, m.severity]), [['no-restricted-imports', 2]]);
  });
}

test('engine/ : un import pur passe le lint', async () => {
  assert.deepEqual(await lint(engineFile, `import { join } from 'node:path';\nexport const y = join;\n`), []);
});

test('hors engine/ : importer Nest reste autorisé', async () => {
  const code = `import { Injectable } from '@nestjs/common';\nexport const y = Injectable;\n`;
  assert.deepEqual(await lint('apps/api/src/accounts/accounts.service.ts', code), []);
});

test('le workflow CI lance install, lint, build et tests avec un service Postgres', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const step of ['npm ci', 'npm run lint', 'npm run build', 'npm test', 'npm test -w api']) {
    assert.match(ci, new RegExp(`- run: ${step}$`, 'm'));
  }
  assert.match(ci, /image: postgres:17/);
  assert.match(ci, /^\s+pull_request:/m);
});
