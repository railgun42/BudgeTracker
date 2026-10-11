import { ConsoleLogger, LogLevel } from '@nestjs/common';

const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi;
const MONEY = /-?\d[\d.,\s]{0,20}(?:€|EUR\b)/gi;
const SENSITIVE_KEY = /email|amount|balance|cents/i;

// Masque emails et montants (texte libre et clés d'objets) avant écriture d'un log.
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(EMAIL, '[email]').replace(MONEY, '[montant]');
  if (value instanceof Error) return Object.assign(new Error(redact(value.message) as string), { stack: redact(value.stack) });
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

// Logger JSON natif de Nest, avec redaction de chaque message et de la stack.
export class RedactingLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(messages.map(redact), context, logLevel, writeStreamType, redact(errorStack));
  }
}
