import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_CATEGORIES } from '../prisma/seed';

// Une clé du seed sans libellé s'afficherait brute (« state.taxes ») ; une racine sans icône prendrait celle des perso.
const shared = join(__dirname, '../../web/src/app/shared-ui');
const labels = readFileSync(join(shared, 'labels.ts'), 'utf8');
const icons = readFileSync(join(shared, 'category-icons.ts'), 'utf8');
const has = (source: string, key: string) => source.includes(`\n  ${key}: `) || source.includes(`\n  '${key}': `);

describe('catégories du seed côté front', () => {
  const keys = Object.entries(SYSTEM_CATEGORIES).flatMap(([root, children]) => [root, ...children.map((c) => `${root}.${c}`)]);

  it.each(keys)('%s a un libellé', (key) => expect(has(labels, key)).toBe(true));
  it.each(Object.keys(SYSTEM_CATEGORIES))('racine %s a une icône', (root) => expect(has(icons, root)).toBe(true));
});
