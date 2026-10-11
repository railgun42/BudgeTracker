import { loadEnv } from './env';

const valid = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };

describe('loadEnv', () => {
  it('refuse une variable obligatoire manquante', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuse un PORT invalide', () => {
    expect(() => loadEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('refuse un JWT_SECRET trop court', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });

  it('exige SMTP_URL en production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMTP_URL/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', SMTP_URL: 'smtp://mail' })).not.toThrow();
  });

  it('applique le port par défaut', () => {
    expect(loadEnv(valid)).toEqual({ DATABASE_URL: 'postgresql://x', PORT: 3000 });
  });
});
