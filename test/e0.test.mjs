// E0 — squelette monorepo. Lancer après `npm run build -w @budgetracker/shared`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('la racine déclare les workspaces apps/* et packages/*', () => {
  assert.deepEqual(JSON.parse(read('package.json')).workspaces, ['apps/*', 'packages/*']);
});

test('chaque variable du compose dev est déclarée dans .env.example', () => {
  const declared = new Set(
    read('.env.example').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => l.split('=')[0]),
  );
  // ${VAR...} mais pas $${VAR} (échappement compose, résolu dans le conteneur)
  const used = [...read('docker-compose.dev.yml').matchAll(/(?<!\$)\$\{(\w+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  assert.deepEqual(used.filter((v) => !declared.has(v)), []);
});

test('les ports du compose dev ne sont publiés que sur 127.0.0.1', () => {
  const ports = [...read('docker-compose.dev.yml').matchAll(/^\s*-\s*"(\d[^"]*:\d+)"/gm)].map((m) => m[1]);
  assert.ok(ports.length > 0);
  assert.deepEqual(ports.filter((p) => !p.startsWith('127.0.0.1:')), []);
});

test('@budgetracker/shared se résout via le workspace', () => {
  const require = createRequire(import.meta.url);
  assert.match(require.resolve('@budgetracker/shared'), /packages[\\/]shared[\\/]dist[\\/]index\.js$/);
  assert.equal(typeof require('@budgetracker/shared'), 'object');
});
