import { hashPassword, verifyPassword } from './password';

describe('password (Argon2id)', () => {
  it('produit un hash PHC Argon2id salé, vérifiable', async () => {
    const [a, b] = [await hashPassword('correct horse'), await hashPassword('correct horse')];
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    await expect(verifyPassword('correct horse', a)).resolves.toBe(true);
  });

  it('refuse un mauvais mot de passe ou un hash mal formé', async () => {
    const hash = await hashPassword('correct horse');
    await expect(verifyPassword('wrong horse', hash)).resolves.toBe(false);
    await expect(verifyPassword('correct horse', 'sha256$abc')).resolves.toBe(false);
  });
});
