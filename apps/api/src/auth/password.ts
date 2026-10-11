import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

// Paramètres minimaux recommandés par l'OWASP pour Argon2id (19 Mio, 2 passes).
const PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

const derive = (password: string, nonce: Buffer, p: typeof PARAMS) =>
  argon2Async('argon2id', { message: password, nonce, ...p });

// Format PHC standard : $argon2id$v=19$m=…,t=…,p=…$sel$hash (base64 sans remplissage).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, PARAMS);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(phc);
  if (!m) return false;
  const expected = Buffer.from(m[5], 'base64');
  const params = { memory: +m[1], passes: +m[2], parallelism: +m[3], tagLength: expected.length };
  const actual = await derive(password, Buffer.from(m[4], 'base64'), params);
  return timingSafeEqual(actual, expected);
}
