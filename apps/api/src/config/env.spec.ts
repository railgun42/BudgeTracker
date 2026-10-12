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

  it('exige SMTP et S3 en production', () => {
    const prod = { ...valid, NODE_ENV: 'production', SMTP_URL: 'smtp://mail', S3_ENDPOINT: 'https://s3.gra.io.cloud.ovh.net', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(() => loadEnv(prod)).not.toThrow();
    for (const name of ['SMTP_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
      expect(() => loadEnv({ ...prod, [name]: undefined })).toThrow(new RegExp(name));
  });

  it('applique le port par défaut', () => {
    expect(loadEnv(valid)).toEqual({ DATABASE_URL: 'postgresql://x', PORT: 3000 });
  });
});
