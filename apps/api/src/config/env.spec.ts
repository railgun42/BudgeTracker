import { loadEnv } from './env';

describe('loadEnv', () => {
  it('refuse une variable obligatoire manquante', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuse un PORT invalide', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x', PORT: 'abc' })).toThrow(/PORT/);
  });

  it('applique le port par défaut', () => {
    expect(loadEnv({ DATABASE_URL: 'postgresql://x' })).toEqual({ DATABASE_URL: 'postgresql://x', PORT: 3000 });
  });
});
