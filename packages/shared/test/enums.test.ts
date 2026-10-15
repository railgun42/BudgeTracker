import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { IntervalUnit, Role, TrackingType, TransactionType } from '../src/enums';

// Les enums partagés doivent rester alignés sur ceux du schéma Prisma.
const schema = readFileSync(new URL('../../../apps/api/prisma/schema.prisma', import.meta.url), 'utf8');
const prismaEnum = (name: string) => schema.match(new RegExp(`enum ${name} [{]([^}]*)[}]`))![1].trim().split(/\s+/);

it.each([
  ['TrackingType', TrackingType],
  ['TransactionType', TransactionType],
  ['IntervalUnit', IntervalUnit],
  ['Role', Role],
])('%s = enum Prisma', (name, values) => {
  expect(Object.values(values)).toEqual(prismaEnum(name));
  expect(Object.keys(values)).toEqual(Object.values(values));
});
