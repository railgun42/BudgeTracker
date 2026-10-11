import { BadRequestException } from '@nestjs/common';
import { isLocalDate, LocalDate } from '@budgetracker/shared';
import { isUUID } from 'class-validator';

// Curseur opaque de pagination sur le tri (date, id) : position de la dernière ligne servie.
export interface Cursor {
  date: LocalDate;
  id: string;
}

export const encodeCursor = ({ date, id }: Cursor): string => Buffer.from(`${date}|${id}`).toString('base64url');

export function decodeCursor(cursor: string): Cursor {
  const [date, id, ...rest] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (rest.length || !isLocalDate(date) || !isUUID(id)) throw new BadRequestException('Curseur invalide');
  return { date, id };
}
