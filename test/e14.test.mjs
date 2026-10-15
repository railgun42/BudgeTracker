// E14 — front remis à zéro : l'ancien code a disparu, rien n'est stocké côté navigateur, CI teste le front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const src = (dir) => readdirSync(new URL(dir, root), { recursive: true }).map((f) => f.replaceAll('\\', '/'));

test("l'ancien front (services d'auth, modèles, pages…) est supprimé", () => {
  const old = /user-service|auth-service|(^|\/)(models|enums|services|guards|pages|components)\//;
  assert.deepEqual(src('apps/web/src/app').filter((f) => old.test(f)), []);
});

// Seule exception : la préférence de thème (charte §3, `localStorage.theme`, aucune donnée métier) ; les specs ne sont pas livrées.
test('le front ne touche ni localStorage, ni sessionStorage, ni crypto.subtle (sauf la préférence de thème)', () => {
  const theme = /localStorage\.(getItem|setItem|removeItem)\(THEME_KEY[,)]/g;
  const offenders = src('apps/web/src')
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .filter((f) => /localStorage|sessionStorage|crypto\.subtle/.test(read(`apps/web/src/${f}`).replace(theme, '')));
  assert.deepEqual(offenders, []);
});

test('la CI lance les tests du front et le lint couvre apps/web', () => {
  assert.match(read('.github/workflows/ci.yml'), /- run: npm test -w web$/m);
  assert.doesNotMatch(read('eslint.config.mjs'), /'apps\/web\/\*\*'/);
});
