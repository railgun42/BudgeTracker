import { RedactingLogger, redact } from './redacting-logger';

function capture(stream: 'stdout' | 'stderr', fn: () => void): string {
  const spy = jest.spyOn(process[stream], 'write').mockImplementation(() => true);
  try {
    fn();
    return spy.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    spy.mockRestore();
  }
}

describe('RedactingLogger', () => {
  const logger = new RedactingLogger();

  it('écrit du JSON et masque un email et un montant dans le texte', () => {
    const out = capture('stdout', () => logger.log('Connexion de Alice.Martin@example.com pour 12,34 €', 'Auth'));
    const line = JSON.parse(out);
    expect(line).toMatchObject({ level: 'log', context: 'Auth' });
    expect(line.message).toBe('Connexion de [email] pour [montant]');
    expect(out).not.toMatch(/example\.com|12,34/);
  });

  it('masque les clés sensibles des objets', () => {
    const out = capture('stdout', () => logger.log({ id: 'tx-1', userEmail: 'bob@test.fr', amountCents: 1234 }));
    expect(JSON.parse(out).message).toEqual({ id: 'tx-1', userEmail: '[redacted]', amountCents: '[redacted]' });
  });

  it("masque l'email dans le message et la stack d'une erreur", () => {
    const err = new Error('échec pour bob@test.fr');
    const out = capture('stderr', () => logger.error(err.message, err.stack, 'Test'));
    expect(out).toContain('[email]');
    expect(out).not.toContain('bob@test.fr');
  });
});

describe('redact', () => {
  it('laisse intactes les valeurs non sensibles', () => {
    expect(redact({ id: 'abc', count: 3, date: '2026-10-11' })).toEqual({ id: 'abc', count: 3, date: '2026-10-11' });
  });
});
